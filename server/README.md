# server

Orthodox Metrics backend. Migrated from `/var/www/orthodoxmetrics/prod/server`
(source commit `49215a843b5f8987ce503fcdeaed7dc8e80343dc`, plus the path fix
that keeps uploads, `.build-info`, and `package.json` valid from this parent).

## Depth

`server/` stays one level below the repo root, with `front-end/` as its sibling.
`src/index.ts` resolves `front-end/dist` from that parent.

Uploads stay at `/var/www/orthodoxmetrics/prod/uploads` (`UPLOADS_ROOT` overrides).
Deploy metadata is `server/.build-info`. The version read is `server/package.json`.

## Runtime, not git

Do not commit `.env`, `.credentials/`, `node_modules/`, `dist/`, `logs/`, or the
runtime blobs under `storage/`. The service runs `dist/index.js` after `npm run build`.
