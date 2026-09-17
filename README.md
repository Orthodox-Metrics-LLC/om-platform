# om-platform

Target structure for the Orthodox Metrics platform. Everything currently under
`/var/www/orthodoxmetrics/prod` migrates here.

```
om-platform/
├── front-end/     new front-end — full Minimal UI template; OM components migrate in
├── server/        reserved — migrates from prod/server with zero internal change
├── config/        reserved
├── docs/          platform documentation (NOT inside front-end, where it is today)
├── scripts/       reserved
└── packages/      reserved
```

## Why the layout is flat

Not a stylistic choice. `prod/server/src/index.ts` hard-codes its own depth and its
sibling's name:

```js
const prodRoot = path.resolve(__dirname, '../..');   // server/dist -> server -> root
app.use('/assets', express.static(path.join(prodRoot, 'front-end/dist/assets')));
```

Keeping `server/` one level down with `front-end/` beside it means those trees migrate by
moving the directory — no import rewrites, no path fixes, no deploy-script surgery. An
`apps/` monorepo layout would be tidier and would cost real refactoring.

The front-end is the easy half: its Vite aliases are `__dirname`-relative and `tsconfig`
uses `baseUrl: "."`, so it is fully self-contained.

## Two rules that keep this repo clean

**1. Migration is allow-list only.** Never `cp -r` from `prod/front-end`. Around 280 MB
there is not source: a vendored copy of this very template, 169 MB of operator reference
images, stale build output. `docs/migration-contract.md` has the deny list and the
per-feature triage table.

**2. The template is on loan.** `front-end/` is the complete Minimal template so OM
components have somewhere to land, but it ships `_mock` fixtures, e-commerce/banking/chat
demos and four unused auth providers. As each OM feature lands, the demo it replaces gets
deleted **in the same commit** — deferring that cleanup is how `prod/front-end` accumulated
its cruft.

## Documentation

**Authoritative documentation lives outside this repo:**

```
/var/www/workspaces/prod-current-to-om-platform/start-here/devin/README.md
```

`docs/` here contains pointers, not copies, so the two cannot drift. The one exception is
`front-end/TEMPLATE-DEBT.md`, which stays in the repo because it is edited in the same
commit as the code change that clears a line.

## .gitignore

Written deliberately, not inherited. `prod` bans media by extension repo-wide (`*.png`,
`*.jpg`) and re-admits paths one negation rule at a time; its own comments record a
production build breaking because of it, and it is why the template could not live there.

Here, images are source and are tracked. Exclusions are for build output, secrets and
non-source only — never file extension. Large binaries stay out by placement, not pattern.

## Status

Scaffolded. `front-end/` holds the unmodified full template. Still to do: fold in the
completed public-site work (currently live from `design-systems/om-public`), then begin the
component-by-component front-end migration.

The live public site is presently served from `design-systems/om-public` via an nginx
cutover. When `front-end/` becomes the real app, that alias and its build source must be
repointed and `om-public` retired, so the two do not drift.
