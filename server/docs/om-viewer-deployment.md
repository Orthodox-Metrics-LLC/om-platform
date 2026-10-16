# OM Viewer hosted integration (0.2.1)

Status: implemented and tested locally. No production deployment or live database changes have been performed.

## Source changes

- `src/routes/om-viewer.js`: authenticated GET `/api/om-viewer/session` and POST `/api/om-viewer/resource`.
- `src/services/omViewerPolicy.js`: fresh account lookup, active/expiry/password checks, canonical roles, assigned/authorized churches, session CSRF and trusted audit identity.
- `src/services/omViewerEngine.js`: bounded Python subprocess; obtains DB settings only from the existing server tenant pool and registered church database. No credentials reach the desktop.
- `viewer-engine/`: standalone Python resource engine and its schema validation data.
- `tests/om-viewer-policy.test.js`: authorization boundary checks.
- `src/index.ts`: after mounting authRoutes, mount `app.use('/api/om-viewer', require('./routes/om-viewer'));`.

The read policy is the shared `canViewDashboard`; edits/additions use `canManageRecords`, matching the existing baptism API's deacon-level record gate. This does not grant desktop users any independent role. Registry entries must have an active `om_church_<id>` database. The backend account needs the same resource table/audit privileges as the previous viewer engine. Existing unrelated/sacramental tables are not automatically exposed; the viewer discovers published OM importer resources only.

## Install on the backend host

1. Extract `OM-Viewer-Server-0.2.1.zip` into a temporary directory. It contains only the listed viewer source, engine and tests, never the server .env, .credentials, logs or application data.
2. Run `node apply-update.cjs /absolute/path/to/your/server` from the extracted directory. It validates the backend package identity, copies only the manifest files, backs up changed destination files, and inserts the route mount idempotently. It does not run a build, restart a service, connect to a database, or alter configuration.
3. From the installed server directory, create the engine environment:

```sh
python3 -m venv viewer-engine/.venv
viewer-engine/.venv/bin/python -m pip install -e ./viewer-engine
```

The default engine interpreter is `server/viewer-engine/.venv/bin/python` (Windows uses Scripts/python.exe). `OM_VIEWER_PYTHON` can specify an installed interpreter; it must have the viewer package dependencies. The Node service account must be able to execute it and read the engine source.

4. Run `node --test tests/om-viewer-policy.test.js`. With the server's existing Node dependencies installed, run `npm run build:ts`, `npm run build:copy`, `npm run build:verify`, and `npm run build:verify:imports` through your normal deployment pipeline, then restart the backend using its normal service procedure. Keep `viewer-engine/` beside `dist/` on the server. Do not use build:flush-sessions for this feature; it is unnecessary. A full repo build was not run locally because the supplied server has no node_modules and its all-in-one build includes session flushing.
5. Before distributing the desktop app, verify: unauthenticated session request is rejected; assigned-church login sees only its resources; viewer role cannot save even with a forged request; deacon+ can save with the actual account recorded; cross-church selection is rejected for ordinary members; admin selection works only for active registered churches; logout/session expiry returns to sign-in. Run real edit tests on a designated test church, not production records.

GET session establishes a session-bound CSRF token; resource POSTs must supply X-OM-Viewer-CSRF. Database names, role claims, account labels and credentials provided by clients are ignored. Resource actions are an explicit allowlist. Role changes are refreshed on every call. No new auth account, password store, schema migrations or record import routes are created.

## Desktop

`desktop/dist/OM Viewer Setup 0.2.1.exe` opens the existing production login page. It requires the backend update above. If that API has not been deployed it displays an explicit service-not-deployed message; it never falls back to a MariaDB login. The installer is unsigned.


## 0.2.1: authentication client separation

The package now targets the platform root's sibling `server/` and `front-end/` directories. Invoke its updater with the server root as before. It validates both package identities, backs up changed files, applies the viewer-specific login branch and early session-scope middleware, and installs the frontend login context/completion route.

Additional backend files are `services/omViewerLogin.js` and `middleware/viewerClientScope.js`. The login branch runs only after the existing password, active-account, lock and onboarding gates. It rotates/saves a viewer-only session and does not issue general website JWT or refresh tokens. Ordinary browser logins follow the existing code. Fresh viewer policy also rejects locked or lifecycle-disabled accounts. The raw login-body debug log is replaced by a client-type log to avoid recording passwords.

The middleware must be mounted immediately after `app.use(sessionMiddleware)` and before application routes. It restricts viewer sessions to `/api/om-viewer/*`, selected auth endpoints, auth pages and static assets. In particular `/api/auth/refresh`, portal/homepage navigation and general website APIs are denied. Normal browser sessions remain unaffected. Accounts requiring organization/Keycloak login are still subject to the existing login API's onboarding rules; this update does not add a new IdP flow.

The frontend sends `client: om-viewer` only for the viewer login URL, disables logo and non-auth navigation, and returns to `/auth/viewer-complete` instead of a portal/dashboard. Build and deploy the changed frontend through its normal pipeline as well as the backend. The package deliberately contains source only; do not serve it as compiled assets. Frontend TS/TSX syntax/transpile checks passed locally, but a full platform build was not run (its dependency trees are not installed here).

Additional checks: `node --test tests/om-viewer-scope.test.js tests/om-viewer-policy.test.js` on the backend, and `npm run test:hosted`, `npm run test:navigation`, `npm run test:desktop` in desktop. The native navigation regression uses a loopback-only fixture and verifies both homepage links and SPA history navigation are contained even with an undeployed API. Confirm ordinary browser logins still reach their normal portal, while a viewer login cannot follow the OM logo or access unrelated website APIs.

## Desktop update feeds

Downloads are public. Uploads are not. Only the `next` release account may publish, and only packaged build output belongs in the feed.

| Platform | URL | Directory |
| --- | --- | --- |
| Windows x64 | `https://orthodoxmetrics.com/updates/om-viewer/windows/x64/` | `/var/www/orthodoxmetrics-updates/om-viewer/windows/x64/` |
| Linux x64 | `https://orthodoxmetrics.com/updates/om-viewer/linux/x64/` | `/var/www/orthodoxmetrics-updates/om-viewer/linux/x64/` |

Nginx serves those directories with `alias`. A missing file is a real 404. It is not the website login page and not the React app. `POST` and `PUT` are denied.

Electron Builder writes the metadata. Do not hand-write `latest.yml` or `latest-linux.yml`. Publish with:

```sh
scripts/server/ops/publish-om-viewer-update.sh windows /path/to/dist
scripts/server/ops/publish-om-viewer-update.sh linux /path/to/dist
```

The script copies the installer or AppImage first and the metadata last. Older versioned files stay in the directory.

Each Windows release needs `OM Viewer Setup <version>.exe`, `OM Viewer Setup <version>.exe.blockmap`, and `latest.yml`. Each Linux release needs `OM-Viewer-<version>.AppImage` and `latest-linux.yml`.

Point electron-builder at the feeds:

```yaml
win:
  publish:
    provider: generic
    url: https://orthodoxmetrics.com/updates/om-viewer/windows/x64
linux:
  target: AppImage
  publish:
    provider: generic
    url: https://orthodoxmetrics.com/updates/om-viewer/linux/x64
```

The desktop app should check at startup and on a timer, offer Check for updates, show download progress, and ask before Restart and install. It must not restart while a record save is in progress. Windows code signing is still required for a Program Files install; that update may prompt for administrator approval. On Linux, keep the AppImage somewhere the user can write, such as `~/Applications`, and `chmod +x` it so the updater can replace it without root.
