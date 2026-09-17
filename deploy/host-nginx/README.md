# Host nginx snapshot — apex + prod.* cutover + four-hostname HTTPS

**Work items:** OMAD-2961 (apex → om-platform), OMAD-2967 (prod.* TLS + legacy SPA), **OMAD-2972** (LAN+WAN HTTPS for prod / omai / omstudio / omworkshop).

This directory is a **reviewable snapshot** of live host nginx (and cert helpers). It is **not** deployed by `om-deploy.sh` or `omai-deploy.sh`. Merging a PR here does **not** reload nginx.

Live files remain under `/etc/nginx/**` on `.239` / `.242` / `.251`, `/usr/local/sbin/issue-*-le-cert.sh`, and `/etc/letsencrypt/renewal-hooks/deploy/`.

## Why this lives here

`/var/omai-ops` is **not** a git repo (confirmed). start-work has no `omai-ops` workspace. Host nginx is also not under `/etc/nginx/.git`. The first cutover therefore had no governed branch and no PR.

House practice is **not** to initialize `/var/omai-ops` as a new repo. Host nginx changes for this migration are reviewed in **`Orthodox-Metrics-LLC/om-platform`** at `deploy/host-nginx/` (this tree). Future host-nginx edits still need a start-work branch and a PR here — do not treat “nginx is not in git” as a reason to skip review.

No private keys or Let’s Encrypt PEM contents are in this tree. Cert **paths** in the server blocks are intentional.

## What Nick should look at

| File | Role | Item |
|---|---|---|
| [`REVIEW.md`](REVIEW.md) | Unified diffs vs pre-cutover `*.bak` (the actual change) | 2961 + 2967 |
| [`snippets/orthodoxmetrics-common.conf`](snippets/orthodoxmetrics-common.conf) | Apex/api frontend `root` → `/var/www/om-platform/front-end/dist` | 2961 |
| [`snippets/orthodoxmetrics-sso.conf`](snippets/orthodoxmetrics-sso.conf) | Shared `/auth/login` → `/auth/login2` bounce **removed** so apex can serve om-platform sign-in | 2961 |
| [`sites-available/prod.orthodoxmetrics.com`](sites-available/prod.orthodoxmetrics.com) | New HTTPS vhost for the legacy SPA | 2967 |
| [`snippets/orthodoxmetrics-legacy-common.conf`](snippets/orthodoxmetrics-legacy-common.conf) | Legacy common (prod-current dist, cookie rewrite → prod.*) | 2967 |
| [`sbin/issue-prod-le-cert.sh`](sbin/issue-prod-le-cert.sh) | HTTP-01 issue/renew helper | 2967 |
| [`letsencrypt/renewal-hooks/deploy/prod-orthodoxmetrics.sh`](letsencrypt/renewal-hooks/deploy/prod-orthodoxmetrics.sh) | Copies renewed certs to `/etc/nginx/ssl/…` and reloads nginx | 2967 |
| [`sites-available/orthodoxmetrics.com`](sites-available/orthodoxmetrics.com) | Apex/api vhost (TLS/server_name unchanged; a brief unused map was added then removed) | context |
| [`sites-available/omai.orthodoxmetrics.com`](sites-available/omai.orthodoxmetrics.com) | OMAI TLS vhost on `.239` → `127.0.0.1:7060` | 2972 |
| [`sites-available/omstudio.orthodoxmetrics.com`](sites-available/omstudio.orthodoxmetrics.com) | WAN edge on `.239` now proxies **HTTPS** to `.242:443` | 2972 |
| [`omstudio-242/sites-available/omstudio.orthodoxmetrics.com`](omstudio-242/sites-available/omstudio.orthodoxmetrics.com) | Product-host TLS + HTTP→HTTPS on `.242` | 2972 |
| [`sbin/issue-omstudio-le-cert.sh`](sbin/issue-omstudio-le-cert.sh) | HTTP-01 on `.239`, copies cert to `.242` | 2972 |
| [`letsencrypt/renewal-hooks/deploy/omstudio-orthodoxmetrics.sh`](letsencrypt/renewal-hooks/deploy/omstudio-orthodoxmetrics.sh) | Renew hook copies cert to `.239` nginx ssl dir **and** `.242` | 2972 |
| [`omworkshop-251/`](omworkshop-251/) | Named-host TLS + Workshop UI on `.251`; HTTP keeps Figma MCP for the `.239` edge | 2972 |

Directions: `start-here/cursor/prod-and-apex-hostnames.md` and `start-here/today/to_nick/2026-09-16-https-four-hostnames.md` (workspace docs, not this repo).

## Do not

- Copy PEM files from `/etc/letsencrypt/live/**` or `/etc/nginx/ssl/**` into git.
- Point either vhost at `dist-platform/`.
- Treat a merge of this PR as a live nginx deploy. Host apply is a separate, explicit operator step.
