# Server ops scripts (moved out of `server/scripts/`)

Canonical home for one-off / ops Node scripts that are **not** the server package build toolchain.

- `cemetery/` — cemetery map import/validate/render tooling (paths assume repo root; see each script)
- `ops/` — backfills, pickup drop, workflow smoke, OCR regression helpers

Build/copy/verify scripts remain in `server/scripts/` next to the server `package.json`.
