# Book intake and OM Importer on OM Server

Implemented locally against the supplied OM Server snapshot. Production has not been changed.

## Access

After signing in to the existing website, open `/apps/`. Select an authorized church, then open Book intake or OM Importer. Bookmark this address or add it to the website portal menu. No platform frontend source was supplied in `om-server/front-end/` (only `public/`), so the integration provides its own launcher without rebuilding the website frontend.

OM Viewer needs the included desktop source update: it permits `/apps/*` on the existing trusted website origin and adds **Applications → Open OM Applications**. Rebuild/distribute Viewer using its existing packaging workflow. An already installed Viewer that blocks `/apps/` needs this update; server deployment alone cannot change that desktop restriction. Website and Viewer use the same hosted pages and website session. No desktop importer installation or public database port is required.

Browser URLs: `/apps/books/` and `/apps/importer/`. Launcher links pin the selected church in each tab. Direct links without a church use the session selection or assigned church. Go back to Applications to change churches.

## Ubuntu prerequisites

- Node 24+ for the existing OM Server process (`node:sqlite` is used by Book intake). Confirm the **actual PM2/systemd process interpreter** uses that version, not just your interactive shell.
- Python 3.11+ with venv/pip, MariaDB privileges already used by the server tenant connections.
- A single OM Server worker for this initial integration. Import confirmation replay protection and library lifecycle are process-local; do not run this release in PM2 cluster mode.
- Existing HTTPS and website session/authentication configuration.

## Apply the update

The companion `OM-Hosted-Apps-Server-2026-10-16.zip` contains an allowlisted patch and prebuilt book frontend/backend, no server `.env`, `.credentials`, source documents, library SQLite, logs or node_modules. Extract it into a temporary directory and run:

```sh
node apply-update.cjs /absolute/path/to/server
```

The updater validates `orthodoxmetrics-backend`, backs up changed files, copies the manifest, and idempotently inserts the app mount immediately after `/api/om-viewer`. It does not install dependencies, start a service, change environment variables or connect to a database. Keep the backup path printed by the updater.

In the target server directory, using the existing service account where appropriate:

```sh
python3 -m venv apps/importer/.venv
apps/importer/.venv/bin/python -m pip install -e ./apps/importer
cd apps/book-intake
npm ci --omit=dev --ignore-scripts
cd ../..
node --test tests/om-apps.test.js tests/om-apps-routes.test.js tests/om-apps-books.test.mjs tests/om-viewer-policy.test.js tests/om-viewer-scope.test.js
apps/importer/.venv/bin/python tests/om-apps-importer-smoke.py
npm run build:ts
npm run build:copy
npm run build:verify
npm run build:verify:imports
```

Set `OM_APPS_DATA_DIR=/var/lib/om-apps` in the existing backend process environment. Create that directory with mode 0700, owned by its existing unprivileged service account. If systemd filesystem protection is enabled, allow writes there. Keep the directory on a local filesystem, outside any nginx static location. The fallback is `server/apps/data`; an explicit external directory is preferred so releases cannot replace runtime data. `OM_IMPORTER_PYTHON` may override the engine's venv interpreter.

Restart OM Server through its normal PM2/systemd procedure after these checks pass, ensuring updated environment values are loaded. There is no additional public listener or separate book service. Do not use the all-in-one build command that flushes website sessions.

nginx must proxy `/apps/` and `/api/om-apps/` to the same OM backend, alongside the existing API proxy. If nginx serves the React website directly, add these locations **before deploying** (replace the example backend port with the existing one):

```nginx
location ^~ /apps/ {
    proxy_pass http://127.0.0.1:YOUR_EXISTING_BACKEND_PORT;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    client_max_body_size 1g;
    proxy_read_timeout 660s;
}
location = /apps { return 302 /apps/; }
location ^~ /api/om-apps/ {
    proxy_pass http://127.0.0.1:YOUR_EXISTING_BACKEND_PORT;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

Run `sudo nginx -t` before reloading nginx. If the existing server already proxies all paths, no extra locations are needed.

## Permissions and storage

Each request refreshes website account status, role, church membership and the active church registry. Browser and Viewer sessions share that policy. Disabled, locked, expired or password-change accounts are rejected. CSRF tokens are bound to the website session. A church supplied by the client cannot grant membership. Credentials stay on the server.

Book libraries live at `$OM_APPS_DATA_DIR/books/<church-id>/`. Website church administrators and higher map to library administrators; record managers map to preparers; other dashboard-authorized accounts map to readers. Existing per-book read/prepare grants still apply. A website user appears in a library's account list after first opening that library; its administrator can then grant book access. Local account creation, password reset and installation restore are disabled in hosted mode. Manage accounts on the website. Existing desktop library accounts are **not automatically mapped** to website identities. Importing an old full installation backup needs a separate identity migration; do not copy an old SQLite database into this release and assume accounts match.

OCR is configured separately for each church in Administration; cloud keys stay in its private configuration. Optional speech settings come from the backend environment. Reader activity stays scoped to the website account. No fixture book is shipped. Stop the backend for a filesystem backup of the full data directory, or use the library's consistent backup export.

Importer originals live at `$OM_APPS_DATA_DIR/sources/<website-user-id>/<upload-id>/`, with their original filenames. Files are private, immutable uploads, limited to 25 MiB each. JSON processing is limited to 30 MB and packages stay in the browser's memory until downloaded; save before leaving or restarting the page. Uploads are retained for subsequent extraction and provenance; arrange retention/backups for this private directory. The initial hosted release does not provide a saved-project repository or resumable browser workspace.

Importer retains the supplied engine's configurable XLSX extraction, parish DOCX preset, JSON correction, approval, SQL preview, new-table import and resource editing. Actual database imports retain its existing cemetery XLSX/parish DOCX support; arbitrary new document schemas still require extending the engine. There is no new empty-table Wizard in the supplied 0.9.0 importer snapshot. Source evidence and rules remain intact. Import preflight is read-only. Execution needs a fresh server-side package/church-bound review, exact table name and browser confirmation; existing tables are never replaced. Audit operations use the fresh website identity. Interrupted writes still require inspecting staging/destination tables before retrying.

## Validation and activation checks

Local backend TypeScript check passed. Automated tests cover the existing Viewer policy and scope plus browser-session policy, CSRF, church isolation, fresh roles, trusted audit identity, private upload ownership and single-use import review. SQLite tests create isolated temporary libraries; no production database is used. A real Chrome browser smoke check passed for the launcher, website-authenticated library, OCR setup deferral, and importer upload/configuration/extraction/review with no browser exceptions. Screenshots are included beside this document. A Python smoke check exercises a temporary XLSX through inspect/extract/validate with a server-selected church database.

Before production use, test login from browser and updated Viewer, church switching, an unauthorized church, reader/preparer/admin permissions, website logout and account disabling. Use a designated test church for the first confirmed MariaDB import and verify the published table and audit. No live MariaDB import has been executed during local preparation.

Rollback: stop/revert the backend through your normal deployment procedure, restore the files from the updater backup (or remove newly added manifest files listed there), rebuild/restart with the previous source, and preserve `OM_APPS_DATA_DIR`. Unmounting the routes does not drop imported tables or delete books. A database import itself is not reversed by reverting code.
