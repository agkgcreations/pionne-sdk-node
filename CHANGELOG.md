# Changelog

## 0.3.3 — 2026-05-08

### Documentation

- README clarifié : nouveau bloc "Bundle ID pinning — N/A on Node" qui
  explique que la protection anti-vol-de-token par pinning du Bundle ID
  est mobile-only (iOS/Android/RN/Flutter), parce que sur un serveur
  Node le token vit dans `.env` / un secrets manager — jamais dans un
  binaire décompilable. Ne pas remplir ce champ sur un projet Node dans
  l'app mobile Pionne — sinon 403 sur 100 % des events. Lien vers la
  doc complète. Aucun changement de code.

## 0.3.2 — 2026-05-08

### Documentation

- README enrichi : tableau des options complet (avant on renvoyait juste
  vers les types), notes par option, et nouveau bloc "Rate limit serveur"
  qui documente le cap 600 req/min/token côté API Pionne. Recommandation
  pratique d'utiliser `sampleRate` sur les workers high-volume. Aucun
  changement de code SDK.

## 0.2.0

Pionne backend got a major security hardening pass. The SDK API is unchanged
but now talks to a stricter, more observable server:

- **2FA TOTP** for the dashboard account.
- **Audit log** of every sensitive action (1-year retention, visible in app).
- **Anomaly detection** — auto-alerts on volume spikes vs 7-day baseline,
  auto-pauses on critical spikes.
- **Server-side PII scrub** — defense-in-depth re-redaction of emails, JWTs,
  card numbers at ingest.
- **Token grace period** — opt-in 24h overlap on regenerate for zero-downtime
  rotation.

## 0.1.2

- README: "Get your token" section pointing to the Pionne mobile app.

## 0.1.1

- Repository URL pointing to `agkgcreations/pionne-sdk-node`.

## 0.1.0

- Initial release.
- Auto-capture via `process.on('uncaughtException')` and `'unhandledRejection'`.
- Express / Connect / NestJS error middleware bundled.
- Runtime context (Node version, OS, hostname, pid, memory).
- Zero external dependencies — uses Node 18+ global `fetch`.
