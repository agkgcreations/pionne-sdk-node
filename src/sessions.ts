// Release Health for Node.js. Same protocol as the browser/RN SDKs.
// We auto-flip on uncaughtException/unhandledRejection through the host
// SDK's existing handlers, and best-effort-emit 'exited' on process.exit.

import * as crypto from 'node:crypto';

export type SessionStatus = 'ok' | 'crashed' | 'errored' | 'abnormal' | 'exited';

export interface SessionContext {
  endpoint: string;
  token: string;
  release?: string;
  environment?: string;
  appVersion?: string;
  osName?: string;
  userIdAnon?: string;
}

interface SessionState {
  id: string;
  startedAt: number;
  status: SessionStatus;
  ctx: SessionContext;
}

let current: SessionState | null = null;

function sessionsUrl(ingestEndpoint: string): string {
  if (ingestEndpoint.endsWith('/ingest')) {
    return ingestEndpoint.slice(0, -'/ingest'.length) + '/sessions';
  }
  return ingestEndpoint.replace(/\/+$/, '') + '/sessions';
}

function postSession(state: SessionState, status: SessionStatus, durationMs?: number): void {
  const url = sessionsUrl(state.ctx.endpoint);
  const body = {
    session_id: state.id,
    status,
    release: state.ctx.release,
    environment: state.ctx.environment,
    app_version: state.ctx.appVersion,
    os_name: state.ctx.osName,
    user_id_anon: state.ctx.userIdAnon,
    duration_ms: durationMs,
  };
  for (const k of Object.keys(body) as (keyof typeof body)[]) {
    if (body[k] === undefined) delete body[k];
  }
  // Node 18+ has global fetch.
  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Pionne-Token': state.ctx.token,
    },
    body: JSON.stringify(body),
  }).catch(() => undefined);
}

export function startSession(ctx: SessionContext): string {
  current = {
    id: crypto.randomUUID(),
    startedAt: Date.now(),
    status: 'ok',
    ctx,
  };
  postSession(current, 'ok');

  // Best-effort 'exited' flip on graceful shutdown. We listen on 'exit'
  // (sync only — no async I/O guaranteed) and 'beforeExit' (where async
  // works). The actual session POST is fire-and-forget anyway.
  const onShutdown = () => {
    if (!current || current.status !== 'ok') return;
    flipSession('exited');
  };
  process.once('beforeExit', onShutdown);

  return current.id;
}

export function flipSession(status: SessionStatus): void {
  if (!current) return;
  const rank: Record<SessionStatus, number> =
    { ok: 0, exited: 1, errored: 2, abnormal: 3, crashed: 4 };
  if (rank[status] <= rank[current.status]) return;
  current.status = status;
  postSession(current, status, Date.now() - current.startedAt);
}

export function endSession(status: SessionStatus = 'exited'): void {
  if (!current) return;
  flipSession(status);
  current = null;
}

export function getCurrentSessionId(): string | null {
  return current?.id ?? null;
}

export function flipFromEvent(
  level: 'fatal' | 'error' | 'warning' | 'info' | undefined,
  mechanismType: string,
): void {
  if (mechanismType === 'manual') return;
  if (level === 'fatal') flipSession('crashed');
  else if (level === 'error') flipSession('errored');
}
