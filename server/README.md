# server

Reserved for the Orthodox Metrics backend, migrating from
`/var/www/orthodoxmetrics/prod/server`.

## Do not change its depth or its sibling's name

`prod/server/src/index.ts` hard-codes both:

```js
const prodRoot = path.resolve(__dirname, '../..');   // server/dist -> server -> root
app.use('/assets', express.static(path.join(prodRoot, 'front-end/dist/assets')));
```

So `server/` must stay exactly one level below the repo root, with `front-end/` as its
sibling under that exact name. Moving either into an `apps/` directory breaks both lines
plus the deploy script. That constraint is why this repo is flat rather than a conventional
`apps/` + `packages/` monorepo — see `docs/migration-contract.md`.

## Other rules that travel with it

- TypeScript compiles `server/src` -> `server/dist`; the running service loads from `dist/`.
- Plain `.js` files are **not** copied by the compiler and must be present in both trees.
- SQL lives in `server/database/migrations/` — the one documented exception outside `src/`.
- Build/deploy tooling lives in `server/scripts/`; hand-run ops scripts in `server/src/scripts/`.
