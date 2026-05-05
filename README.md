# @pionne/node

Error monitoring SDK for Node.js — by [Pionne](https://pionne.agkgcreations.fr).

Auto-captures `uncaughtException` and `unhandledRejection`, ships rich runtime context (Node version, OS, hostname, pid, memory). Zero external dependencies — uses Node 18+ global `fetch`.

Works with **plain Node, Express, Fastify, NestJS, Koa, Hono, Bun, Deno (with compat shim)**.

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

## Options

Same shape as `@pionne/web` and `@pionne/react-native`. See the type
definitions for the full list.

## License

MIT
