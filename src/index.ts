import * as os from 'node:os';
import * as process from 'node:process';

import { RateLimiter, validateEndpoint, validateToken } from './security';
import {
  endSession as _endSession,
  flipFromEvent,
  getCurrentSessionId,
  startSession as _startSession,
} from './sessions';

export type Level = 'fatal' | 'error' | 'warning' | 'info';
export type MechanismType =
  | 'uncaughtException'
  | 'unhandledRejection'
  | 'manual';

export interface Mechanism {
  type: MechanismType;
  handled: boolean;
}

export interface PionneEvent {
  exception_type: string;
  message?: string | null;
  stack?: string[];
  level?: Level;

  release?: string;
  environment?: string;
  app_version?: string;
  os_name?: string;
  os_version?: string;
  user_id_anon?: string;
  locale?: string;
  timezone?: string;

  contexts?: Record<string, Record<string, unknown> | undefined>;
  mechanism?: Mechanism;
  tags?: Record<string, string>;
}

export interface PionneOptions {
  /** Project token (starts with `pio_live_`). Required. */
  token: string;
  endpoint?: string;
  release?: string;
  environment?: string;
  enabled?: boolean;
  captureUncaughtExceptions?: boolean;
  captureUnhandledRejections?: boolean;
  autoContext?: boolean;
  beforeSend?: (event: PionneEvent) => PionneEvent | null;
  userIdAnon?: string;
  tags?: Record<string, string>;
  maxStackFrames?: number;
  /**
   * Release Health — opens a session at init() with status='ok', flips to
   * 'crashed'/'errored' if a fatal/error fires through the global handlers.
   * The dashboard derives crash-free user rate per release. Default: true.
   */
  releaseHealth?: boolean;
  /** Token-bucket rate limit (events/sec). Default 10, set 0 to disable. */
  maxEventsPerSecond?: number;
}

const DEFAULT_ENDPOINT = 'https://pionne.agkgcreations.fr/api/ingest';
const DEFAULT_MAX_STACK = 50;
const SDK_NAME = 'pionne.node';
const SDK_VERSION = '0.1.0';

type ResolvedConfig = Required<
  Omit<PionneOptions, 'beforeSend' | 'userIdAnon' | 'tags' | 'release' | 'releaseHealth' | 'maxEventsPerSecond'>
> & {
  beforeSend?: PionneOptions['beforeSend'];
  userIdAnon?: string;
  tags?: Record<string, string>;
  release?: string;
};

let config: ResolvedConfig | null = null;
let rateLimiter: RateLimiter | null = null;
let droppedByRateLimit = 0;
let staticContext: Partial<PionneEvent> = {};
let onUncaught: ((err: Error) => void) | null = null;
let onRejection: ((reason: unknown) => void) | null = null;

function gatherStaticContext(): Partial<PionneEvent> {
  let timezone: string | undefined;
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    // ignore
  }
  return {
    os_name: os.type(),
    os_version: os.release(),
    timezone,
    contexts: {
      sdk: { name: SDK_NAME, version: SDK_VERSION },
      runtime: {
        name: 'node',
        version: process.versions.node,
        v8: process.versions.v8,
      },
      os: {
        name: os.type(),
        version: os.release(),
        platform: process.platform,
        arch: process.arch,
        cpu_count: os.cpus().length,
        total_memory: os.totalmem(),
        free_memory: os.freemem(),
      },
      app: {
        hostname: os.hostname(),
        pid: process.pid,
        cwd: process.cwd(),
      },
    },
  };
}

function parseStack(error: Error, max: number): string[] {
  if (!error.stack) return [];
  return error.stack
    .split('\n')
    .slice(0, max)
    .map((s) => s.trim())
    .filter(Boolean);
}

function buildEvent(
  err: unknown,
  level: Level,
  mechanism: MechanismType,
  handled: boolean,
  extra?: Partial<PionneEvent>,
): PionneEvent | null {
  if (!config || !config.enabled) return null;
  const e = err instanceof Error ? err : new Error(String(err));
  const event: PionneEvent = {
    ...staticContext,
    exception_type: e.name || 'Error',
    message: e.message || null,
    stack: parseStack(e, config.maxStackFrames),
    level,
    release: config.release,
    environment: config.environment,
    user_id_anon: config.userIdAnon,
    tags: config.tags,
    mechanism: { type: mechanism, handled },
    ...extra,
  };
  if (config.beforeSend) {
    const result = config.beforeSend(event);
    if (!result) return null;
    return result;
  }
  return event;
}

async function send(event: PionneEvent): Promise<void> {
  if (rateLimiter && !rateLimiter.allow()) {
    droppedByRateLimit++;
    if (process.env.NODE_ENV !== 'production' && droppedByRateLimit % 50 === 1) {
      console.warn(`[Pionne] rate-limit reached (${droppedByRateLimit} events dropped). Bump maxEventsPerSecond if intentional.`);
    }
    return;
  }

  if (!config) return;
  try {
    // Node >=18 has global `fetch`. We rely on it instead of pulling in
    // node-fetch / undici as a dependency.
    if (typeof fetch !== 'function') return;
    await fetch(config.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Pionne-Token': config.token,
      },
      body: JSON.stringify(event),
    });
  } catch {
    // Best-effort: a monitoring SDK must never crash the host process.
  }
}

function installUncaughtHandler(): void {
  onUncaught = (err: Error) => {
    const event = buildEvent(err, 'fatal', 'uncaughtException', false);
    if (event) {
      // Fire-and-forget: process is going to die anyway. Best we can do is
      // try to flush before exit, but Node will tear down imminently.
      void send(event);
      flipFromEvent(event.level, event.mechanism?.type ?? 'uncaughtException');
    }
  };
  process.on('uncaughtException', onUncaught);
}

function installRejectionHandler(): void {
  onRejection = (reason: unknown) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    const event = buildEvent(err, 'error', 'unhandledRejection', false);
    if (event) {
      void send(event);
      flipFromEvent(event.level, event.mechanism?.type ?? 'unhandledRejection');
    }
  };
  process.on('unhandledRejection', onRejection);
}

export const Pionne = {
  init(options: PionneOptions): void {
    try {
      const isDev = process.env.NODE_ENV !== 'production';
      if (!options?.token || !validateToken(options.token)) {
        if (isDev) {
          console.warn('[Pionne] Missing or invalid token (expected pio_live_<≥16 chars>, no placeholders).');
        }
        return;
      }
      const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
      if (!validateEndpoint(endpoint, isDev)) {
        console.warn('[Pionne] Refusing non-HTTPS endpoint in production:', endpoint);
        return;
      }
      const rps = options.maxEventsPerSecond ?? 10;
      rateLimiter = rps > 0 ? new RateLimiter(rps, rps) : null;

    const autoContext = options.autoContext ?? true;
    staticContext = autoContext ? gatherStaticContext() : {};

    config = {
      token: options.token,
      endpoint: options.endpoint ?? DEFAULT_ENDPOINT,
      release: options.release,
      environment:
        options.environment ?? process.env.NODE_ENV ?? 'production',
      enabled: options.enabled ?? true,
      captureUncaughtExceptions: options.captureUncaughtExceptions ?? true,
      captureUnhandledRejections: options.captureUnhandledRejections ?? true,
      autoContext,
      beforeSend: options.beforeSend,
      userIdAnon: options.userIdAnon,
      tags: options.tags,
      maxStackFrames: options.maxStackFrames ?? DEFAULT_MAX_STACK,
    };

    if (config.captureUncaughtExceptions) installUncaughtHandler();
    if (config.captureUnhandledRejections) installRejectionHandler();

    // Release Health — open a session unless the host opted out.
    if (options.releaseHealth !== false) {
      _startSession({
        endpoint: config.endpoint,
        token: config.token,
        release: config.release,
        environment: config.environment,
        appVersion: staticContext.app_version,
        osName: staticContext.os_name,
        userIdAnon: config.userIdAnon,
      });
    }
    } catch (e) {
      console.warn('[Pionne] init failed silently — monitoring disabled.', e);
      config = null;
    }
  },

  captureException(err: unknown, extra?: Partial<PionneEvent>): void {
    const event = buildEvent(
      err,
      extra?.level ?? 'error',
      'manual',
      true,
      extra,
    );
    if (event) void send(event);
  },

  captureMessage(message: string, extra?: Partial<PionneEvent>): void {
    const event = buildEvent(
      new Error(message),
      extra?.level ?? 'info',
      'manual',
      true,
      { exception_type: 'Message', ...extra },
    );
    if (event) void send(event);
  },

  setUser(userIdAnon: string | null): void {
    if (!config) return;
    config.userIdAnon = userIdAnon ?? undefined;
  },

  setTags(tags: Record<string, string> | null): void {
    if (!config) return;
    config.tags = tags ?? undefined;
  },

  setEnabled(enabled: boolean): void {
    if (!config) return;
    config.enabled = enabled;
  },

  /**
   * Detach all auto handlers. Useful in tests / CLI scripts that need a
   * clean shutdown. Re-init by calling `init()` again.
   */
  uninstall(): void {
    if (onUncaught) process.removeListener('uncaughtException', onUncaught);
    if (onRejection) process.removeListener('unhandledRejection', onRejection);
    onUncaught = null;
    onRejection = null;
    config = null;
    staticContext = {};
  },

  // ─── Release Health ───────────────────────────────────────────────────

  /** Manually end the current session (status='exited'). */
  endSession(): void {
    _endSession();
  },

  /** UUID of the current open session (for diagnostics). */
  getSessionId(): string | null {
    return getCurrentSessionId();
  },
};

/**
 * Express / Connect / NestJS error middleware. Reports the error then passes
 * it down the chain. Mount it AFTER your routes:
 *
 *   import { Pionne, expressErrorHandler } from '@pionne/node';
 *   app.use(expressErrorHandler);
 *   // your fallback error handler here
 */
export function expressErrorHandler(
  err: unknown,
  _req: unknown,
  _res: unknown,
  next: (err?: unknown) => void,
): void {
  Pionne.captureException(err);
  next(err);
}
