# @pionne/node

Error monitoring SDK for Node.js — by [Pionne](https://pionne.agkgcreations.fr).

Auto-captures `uncaughtException` and `unhandledRejection`, ships rich runtime context (Node version, OS, hostname, pid, memory). Zero external dependencies — uses Node 18+ global `fetch`.

Works with **plain Node, Express, Fastify, NestJS, Koa, Hono, Bun, Deno (with compat shim)**.

## 🎫 Get your token

Pionne is **mobile-first**: you sign up, create projects, and watch your error feed **from the Pionne mobile app**, not a web dashboard.

1. **Download the app**:
   - 🍎 [App Store](https://apps.apple.com/app/pionne) *(coming soon)*
   - 🤖 [Google Play](https://play.google.com/store/apps/details?id=fr.agkgcreations.pionne) *(coming soon)*
2. Create your account (30 days free, no card required)
3. **+ New project** → pick **Node.js** → copy the token displayed (`pio_live_…`)
4. Paste it into `Pionne.init({ token })` below

⚠️ The token is only shown **once** at project creation — store it as `PIONNE_TOKEN` in your env / secrets manager, never commit it.

## Install

```bash
npm install @pionne/node
```

## Usage

```ts
// At the top of your entrypoint (server.ts / index.ts)
import { Pionne } from '@pionne/node';

Pionne.init({
  token: 'pio_live_xxx',
  release: process.env.GIT_SHA, // optional
  environment: process.env.NODE_ENV ?? 'production',
});
```

That's it. Crashes and unhandled rejections are reported automatically.

### Express / NestJS / Connect

```ts
import express from 'express';
import { Pionne, expressErrorHandler } from '@pionne/node';

Pionne.init({ token: 'pio_live_xxx' });

const app = express();
app.get('/boom', () => { throw new Error('boom'); });

// Mount AFTER your routes:
app.use(expressErrorHandler);
```

### Manual capture

```ts
try {
  await processOrder(orderId);
} catch (err) {
  Pionne.captureException(err, {
    tags: { feature: 'checkout' },
    user_id_anon: req.user?.id,
  });
  throw err;
}
```

### User identity, tags, opt-out

```ts
Pionne.setUser('u_42');
Pionne.setTags({ tier: 'pro' });
Pionne.setEnabled(false);
```

### Profiling — preview (coming soon)

Continuous-ish CPU profiling is **shipped on `@pionne/react-native@0.8.0`**
(Hermes sampler) and is on the roadmap for `@pionne/node` next. The Node
implementation will use the V8 inspector profiler (`node:inspector`,
`Profiler.start`/`Profiler.stop`) and ship the resulting CPU profile to
the same `POST /api/profiles` endpoint.

The API will mirror RN exactly:

```ts
// Coming in @pionne/node ~v0.4.0
await Pionne.profile('checkoutHandler', async () => {
  await processOrder(orderId);
}, { route: 'POST /api/checkout' });
```

Same backend, same retention (raw 7 d, aggregates 90 d), same flame graph
view + cross-release regression chart in the mobile dashboard. If you want
profiling **today** on the server, you can post CPU profiles to the
endpoint directly — the JSON shape is documented at
[pionne.agkgcreations.fr/profiling/intro](https://pionne.agkgcreations.fr/profiling/intro).

Heads-up : V8 profiling has a 3–8 % CPU overhead during capture. We'll
default to manual transaction-scoped (start/stop) rather than continuous
to keep that cost off your hot path.

### Bundle ID pinning — N/A on Node

The "Bundle ID" anti-token-theft check on Pionne projects is **mobile only**
(iOS/Android/RN/Flutter). On Node, your token lives in `.env` / a secrets
manager / EAS env vars — never in a decompilable binary — so the threat
doesn't exist. The field is hidden in the mobile dashboard for Node
projects; **don't set it manually via the API** — the SDK does not send a
top-level `app_id`, so a non-null `bundle_id` would 403 every event. Use
`tags` to differentiate deployments instead. See the
[Bundle ID Pinning docs](https://pionne.agkgcreations.fr/security/bundle-id#backends-sans-bundle_id).

### Geography (opt-in)

Approximate server location (city, region, country) attached to every event,
just like Sentry. Off by default for privacy — flip `sendGeography` to enable:

```ts
Pionne.init({
  token: 'pio_live_xxx',
  sendGeography: true,
});
```

Resolved once at startup via a free IP→geo lookup (`https://ipapi.co/json/`
by default), with a 4 s timeout. If the lookup fails the SDK silently keeps
shipping events without geo. Override the endpoint via `geographyEndpoint`
if you have your own.

## Options

Same shape as `@pionne/web` and `@pionne/react-native`. Highlights :

| Option                | Type                       | Default                  |
| --------------------- | -------------------------- | ------------------------ |
| `token`               | `string` (required)        | —                        |
| `endpoint`            | `string`                   | Pionne production        |
| `release`             | `string`                   | unset                    |
| `environment`         | `string`                   | `NODE_ENV` ou `production` |
| `enabled`             | `boolean`                  | `true`                   |
| `captureUncaughtErrors`        | `boolean`        | `true`                   |
| `captureUnhandledRejections`   | `boolean`        | `true`                   |
| `tags`                | `Record<string, string>`   | unset                    |
| `userIdAnon`          | `string`                   | unset                    |
| `maxStackFrames`      | `number`                   | `50`                     |
| `beforeSend`          | `(event) => event \| null` | unset (drop if `null`)   |
| `sendGeography`       | `boolean`                  | `false`                  |
| `geographyEndpoint`   | `string`                   | `https://ipapi.co/json/` |
| `releaseHealth`       | `boolean`                  | `true`                   |
| `maxEventsPerSecond`  | `number`                   | `10`                     |

### Notes

- **`maxEventsPerSecond`** — token-bucket process-wide. Au-delà, les events sont droppés silencieusement. Protège contre une boucle d'erreur dans un worker. `0` désactive (déconseillé sur des serveurs longue durée).
- **`releaseHealth`** — ouvre une session au `init()`, utile pour les services Node longue durée que tu veux mesurer comme un mobile (crash-free uptime).
- **`sendGeography`** — opt-in : résout city/region/country côté IP via [ipapi.co](https://ipapi.co/json/) par défaut. Sur un serveur, l'IP source est l'IP publique du serveur lui-même (pas celle d'un user). Customize via `geographyEndpoint` pour pointer sur ta propre lookup ou un proxy interne.

Voir les types TypeScript pour la liste complète.

## Rate limit serveur

L'API Pionne cap **600 req/min/token** (= 10/sec) sur tous les endpoints publics (`/ingest`, `/sessions`, `/feedback`). Au-delà → `HTTP 429` avec un header `Retry-After`. Le SDK fait silencieusement échouer (try/catch interne). Empêche un token leaké (ou un worker qui boucle) de drainer ton infra ou ton quota mensuel. Voir [doc rate limits](https://pionne.agkgcreations.fr/security/rate-limits).

## License

MIT
