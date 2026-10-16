# server/src/scripts/

Manually-invoked, idempotent operational/maintenance scripts (DB migrations,
seeders, one-off backfills). These are run directly with `node` or `ts-node`
against a specific environment — they are **not** part of the TypeScript build
(`npm run build`) and are not copied into `dist/`.

Each script documents its own invocation in a header comment, e.g.:

```
Usage:  node server/src/scripts/migrate-record-supplements.js
```

This is a distinct location from **`server/scripts/`** (repo-root-relative,
one level up), which holds the build/deploy pipeline tooling that
`server/package.json` references directly (`build:ts`, `build:copy`,
`build:verify`, `cemetery:*`, `workflow:*`, `sync-tasks`, etc.). Do not move
files between the two without updating both the `package.json` scripts and
each file's own `Usage:` docstring.

If you're adding a new one-off maintenance script that a human runs by hand,
it belongs here. If you're adding tooling that the build/deploy pipeline
depends on, it belongs in `server/scripts/`.
