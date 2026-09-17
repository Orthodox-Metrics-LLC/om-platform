# om-platform — migration contract

**Date:** 2026-09-16
**Purpose:** keep `/var/www/om-platform/front-end` clean while migrating from
`/var/www/orthodoxmetrics/prod/front-end`, and keep the later `server/` migration cheap.

---

## 1. Structural constraints (verified in code, not assumed)

These dictate the directory layout. Breaking them costs refactoring.

**The backend hard-codes its own depth and its sibling's name.**

```js
// prod/server/src/index.ts:1476
const prodRoot = path.resolve(__dirname, '../..');   // server/dist -> server -> root
app.use('/assets', express.static(path.join(prodRoot, 'front-end/dist/assets')));
```

So in the new root: `server/` must sit exactly one level down, and `front-end/` must be its
sibling under that exact name. `apps/server/` + `apps/front-end/` would break both lines.

**The front-end is self-contained.** `vite.config.ts` uses `resolve(__dirname, 'src/...')`
and `tsconfig.json` uses `baseUrl: "."`. Nothing points outside its own directory, so the
tree moves with zero import changes.

**Resulting layout:**

```
/var/www/om-platform/
├── front-end/     new app (full Minimal template; OM components migrate in)
├── server/        migrates from prod/server with zero internal change
├── config/  docs/  scripts/  packages/
```

---

## 2. What must NOT migrate — deny list

Total pollution identified: **~280 MB**, concentrated in a handful of directories rather
than scattered through the source.

| Path | Size | What it is |
|---|---|---|
| `src/features/marketing-site/` | **189 MB** | See breakdown below |
| `dist.workshop-prev/` | 87 MB | Stale build artifact |
| `docs/` (inside front-end) | 11 MB | Belongs at platform root, not inside the app |
| `report/` | 4.0 MB | Tooling output |
| `.cache/`, `.vite/` | 400 KB | Build caches |
| `vendor/` | 88 KB | Needs review — likely vendored one-offs |
| `dist/`, `dist-public/` | — | Build outputs |

### The 189 MB `marketing-site` directory

| Sub-path | Size | Note |
|---|---|---|
| `reference-material-i-created-for-you/` | 169 MB | Operator-supplied reference images and video. **Source material, not code.** Belongs in an asset store, not in a source tree. |
| `src/vite-ts/` | 20 MB | The Minimal template, vendored inside the OM source tree |
| `your_work/` | 8 KB | The original abandoned target directory |

This directory is also the cause of a real defect: it sits inside `front-end/src`, which
`tsconfig.json` includes wholesale, so `tsc --noEmit` in the OM front-end OOMs. Removing
it from `prod` fixes that independently of any migration.

---

## 3. What is genuinely there — allow list candidates

Real OM front-end source is **~18 MB** across 25 feature directories plus
`shared/`, `components/`, `layouts/`, `app/`, `routes/`.

**Encouraging finding:** a scan for `*.bak`, `*.old`, `*copy*`, `*.orig`, `*deprecated*`,
`*.disabled` outside `marketing-site` returned **zero files**. Only one version-suffixed
directory exists (`features/onboarding/components/v1`). The source is not littered — the
pollution is a few large directories, which makes this a tractable migration.

### Feature triage list — needs operator decision

Operator said "there are only certain things I want refactored into the new front-end", so
each of these is opt-in. Nothing migrates by default.

| Feature | Size | Migrate? |
|---|---|---|
| `public-site` | 4.4 MB | Largely superseded by the new public site — likely **no**, cherry-pick copy only |
| `devel-tools` | 3.4 MB | Contains the parish map (`us-church-map`) |
| `portal` | 2.0 MB | ? |
| `admin` | 1.3 MB | ? |
| `records-centralized` | 1008 KB | Core product |
| `apps` | 580 KB | ? |
| `assets-library` | 508 KB | ? |
| `account` | 444 KB | ? |
| `auth` | 300 KB | Superseded by the new auth work? |
| `tables` | 256 KB | ? |
| `blueprints` | 248 KB | ? |
| `onboarding` | 232 KB | The 2,037-line enrolment wizard |
| `certificate-studio` | 196 KB | Core product |
| `social`, `ai` | 120 KB each | ? |
| `liturgical-calendar` | 80 KB | ? |
| `logs`, `church` | 72 KB each | ? |
| `system` | 64 KB | ? |
| `dashboard` | 56 KB | ? |
| `integrations` | 40 KB | ? |
| `help` | 36 KB | ? |
| `ocr` | 24 KB | Core product |
| `forms` | 20 KB | ? |
| `events` | 12 KB | ? |

---

## 4. The second pollution source: the template itself

The new `front-end/` starts as the **full** Minimal template, deliberately — it is the
destination that OM components migrate into, so its dashboard shell, layouts and routing
need to be present.

But the full template also ships content that must not survive to production:

- `src/_mock/` — fake users, products, invoices, blog posts, avatars
- Demo sections: e-commerce, banking, booking, chat, mail, calendar, kanban, file manager, tour
- `src/auth/` provider demos: Auth0, Amplify, Supabase, Firebase (OM uses its own backend)
- `src/pages/auth-demo/`, `components/` showcase pages
- Placeholder branding and `minimals.cc` links

**These are on loan.** As each OM feature migrates into its slot, the corresponding template
demo should be deleted in the same commit — not left to be cleaned up "later", which is how
`prod/front-end` accumulated 280 MB in the first place.

Tracking suggestion: a `TEMPLATE-DEBT.md` in `front-end/`, listing every template
directory still present, removed line by line as it is replaced. The file reaching empty is
the definition of the migration being finished.

---

## 5. Enforcement — how to keep it clean

Migration is **allow-list only**. No `cp -r` of `prod/front-end` at any point, and no
"copy then delete" — that is how cruft arrives.

Proposed guard, run in CI or pre-commit on the new repo:

1. Fail if any path matches the deny list in §2.
2. Fail if `src/features/marketing-site` appears at all.
3. Fail if total `src/` size grows by more than an agreed threshold in one commit
   (catches an accidental bulk copy).
4. Fail on `*.bak`, `*.old`, `*.orig`, `*copy*`, `*.disabled` anywhere in `src/`.
5. Warn if a template demo directory is still present past its agreed removal date.

---

## 6. Open decisions

1. **Root path.** Operator specified `/var/www/om-platform`. Agent cannot create it —
   sandbox refuses writes to `/var/www` even under `sudo` (which is otherwise
   `NOPASSWD: ALL` and works in `/etc/nginx` and inside `prod/`). Needs either
   `sudo mkdir -p /var/www/om-platform && sudo chown -R next:next /var/www/om-platform`
   from the operator, or agreement to use `/var/www/workspaces/om-platform`, which is
   verified writable.
2. **Feature triage** — §3 table needs operator marks.
3. **`reference-material-i-created-for-you` (169 MB)** — where should operator source
   material live? Not in a source tree. OM Home asset library is the documented home for
   reusable assets.
4. **The live site currently serves from `design-systems/om-public`** via the applied nginx
   cutover. Once `om-platform/front-end` becomes the real app, the nginx alias and the build
   source must be repointed, and `om-public` retired — otherwise two copies drift.
5. **`vendor/` (88 KB)** — contents not yet reviewed.
