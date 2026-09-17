# Toolchain

## Node 22 — and why it is not the system Node

`front-end/package.json` (the Minimal template) requires `node >= 22.12.0`. This host's
system Node is **v20.20.2**, installed system-wide from NodeSource apt at `/usr/bin/node`.

**That binary is shared by four running production services:** `orthodox-backend`,
`omai`, `om-ocr-worker`, `om-stop-watcher`.

The OM backend also carries native modules compiled against the Node 20 ABI — `canvas`,
`@img` (sharp) and `node-pty`, 15 `.node` binaries in total. Node 20 to 22 changes
`NODE_MODULE_VERSION` from 115 to 127, so every one of those needs rebuilding, and `canvas`
routinely fails to rebuild without cairo/pango dev packages present.

Replacing `/usr/bin/node` would not break anything *visibly*: running processes keep the old
binary mapped via its inode. It would instead arm a latent outage that fires on the next
restart, deploy or reboot — the worst possible failure mode, because it looks fine until it
is far too late to associate with the change.

So Node 22 is installed **alongside**:

```
/opt/nodejs/node-v22.20.0-linux-x64/
/opt/nodejs/current -> node-v22.20.0-linux-x64      # stable symlink
```

Verified against the official `SHASUMS256.txt` before extraction.

### Using it

```bash
export PATH=/opt/nodejs/current/bin:$PATH
node -v   # v22.20.0
```

`.nvmrc` and `.node-version` in the repo root pin `22.20.0` for anyone using nvm/fnm/asdf.

### If the system Node is ever upgraded

Do it as a planned change, not a side effect:

1. Rebuild the backend's native modules against the new ABI (`npm rebuild` in
   `prod/server`), confirming `canvas`, `@img` and `node-pty` all compile.
2. Confirm cairo/pango/pixman dev packages are present for `canvas`.
3. Restart and smoke-test all four services individually.
4. Have a rollback: NodeSource keeps prior versions, so pin and reinstall 20.x if needed.

## Heap size

The full template is ~5,660 modules and **`tsc` and `vite` both OOM at Node's default heap
on this host** (14 GB total, ~8 GB available). The first typecheck attempt aborted with a
core dump, not a useful error message.

`package.json`'s `build`, `dev` and a new `tsc` script therefore carry
`NODE_OPTIONS=--max-old-space-size=6144`. This should shrink as template demo content is
deleted (see `front-end/TEMPLATE-DEBT.md`), but leave the flag until it demonstrably is not
needed — an OOM here presents as an abort with a stack of hex addresses, which is a poor
thing to hand the next person.

## Verified

- `npx tsc --noEmit` — clean
- `npx vite build` — 5,661 modules, 24.22s
- All four production services still `active` and the backend health endpoint returning 200
  after installing Node 22, confirming `/usr/bin/node` was untouched

## Live serving (2026-09-16)

`orthodoxmetrics.com` now serves its public marketing routes from **this repo's**
`front-end/dist`, staged to `/var/www/orthodoxmetrics/prod/front-end/dist-platform/`.

Routes served by om-platform:
`/` `/product` `/products` `/records` `/capabilities` `/ocr` `/analytics` `/about`
`/contact` `/faq` `/pricing` `/enroll` `/latest-news` `/terms` `/privacy` `/security`
plus redirects from `/about-us`, `/contact-us`, `/faqs`.

Everything else — the whole authenticated application, `/auth/login`, `/api/*`, sockets,
the embeds — still serves from the legacy `front-end/dist` and is untouched.

Assets are namespaced under `/om-platform/` (see `vite.config.ts`) because the legacy SPA
also builds bundles to `/assets/index-*.js` and ships images under `/assets/images/`.

nginx snippet backup taken before the change:
`/etc/nginx/snippets/orthodoxmetrics-common.conf.bak-2026-09-16-213408`

### Deploying a change

```bash
cd /var/www/om-platform/front-end
export PATH=/opt/nodejs/current/bin:$PATH
npx vite build
sudo rsync -a --delete dist/ /var/www/orthodoxmetrics/prod/front-end/dist-platform/
sudo chown -R next:next /var/www/orthodoxmetrics/prod/front-end/dist-platform
```

No nginx reload needed for a content change — only if the route list changes.

**Still no pipeline.** `om-deploy.sh` does not build this repo, so the public site goes
stale unless the above is run. Adding it to the deploy script remains the top follow-up.
