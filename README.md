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

Same shape as `@pionne/web` and `@pionne/react-native`. See the type
definitions for the full list.

## License

MIT
