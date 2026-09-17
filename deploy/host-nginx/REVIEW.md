# Review surface — what actually changed on the host

Live nginx was applied 2026-09-16 **before** this snapshot existed in git. The files in this directory are the current host copies. This page is the before/after Nick should review (vs `*.bak` still on the host).

**One cutover, two tickets:** OMAD-2967 (prod.* TLS + legacy vhost) made the apex move safe; OMAD-2961 then pointed apex at om-platform. Same PR is linked on both.

Live cutover is **already applied**. Merging this PR does not reload nginx.

## OMAD-2961 — apex → om-platform

### `snippets/orthodoxmetrics-common.conf`

Diff vs `/etc/nginx/snippets/orthodoxmetrics-common.conf.bak-2026-09-16-223004` (pre-apex-root change):

```diff
--- /etc/nginx/snippets/orthodoxmetrics-common.conf.bak-2026-09-16-223004	2026-09-16 21:34:22.262977447 -0400
+++ /etc/nginx/snippets/orthodoxmetrics-common.conf	2026-09-16 22:30:04.907060785 -0400
@@ -1,5 +1,9 @@
 # /etc/nginx/snippets/orthodoxmetrics-common.conf
 # Shared location/serving logic for orthodoxmetrics.com on .239.
+# 2026-09-16: frontend root is om-platform/front-end/dist.
+# The legacy prod-current SPA lives at prod.orthodoxmetrics.com
+# (orthodoxmetrics-legacy-common.conf). Do not fall through to
+# prod/front-end/dist here — that would defeat the hostname split.
 # Included from both the port-80 and port-443 server blocks.
 # X-Build-Type and maintenance-bypass logic migrated from the retired .221 edge.
 
@@ -29,7 +33,7 @@
 }
 # ========== END MAINTENANCE MODE ==========
 
-root /var/www/orthodoxmetrics/prod/front-end/dist;
+root /var/www/om-platform/front-end/dist;
 index index.html;
 
 access_log /var/log/nginx/orthodoxmetrics.access.log;
@@ -253,21 +257,19 @@
 }
 
 # ---------- om-platform (new public marketing site) ----------
-# Incremental cutover: the finished public routes are served from om-platform's
-# build; `location /` below is untouched and continues to serve the full
-# authenticated application for every other path.
+# 2026-09-16 hostname split: this vhost is om-platform for ALL frontend
+# routes, including `location /`. The old authenticated SPA is only on
+# prod.orthodoxmetrics.com. APIs/sockets still proxy to orthodox-backend.
 #
 # om-platform's assets are namespaced under /om-platform/ because both apps build
 # bundles to /assets/index-*.js and both ship public images under
 # /assets/images/ — at one origin those paths are otherwise ambiguous and one
 # app would receive the other's bundles.
 #
-# NOTE: /auth/login is deliberately NOT routed here. It is the real login for
-# every OM user, and om-platform's sign-in redirects to the marketing home on
-# success rather than handing off to the authenticated app. Cutting it over
-# would regress every login.
+# /auth/login on this host is om-platform sign-in. The real OM app login is
+# https://prod.orthodoxmetrics.com/auth/login (legacy SPA).
 location ^~ /om-platform/ {
-    alias /var/www/orthodoxmetrics/prod/front-end/dist-platform/;
+    alias /var/www/om-platform/front-end/dist/;
     include /etc/nginx/snippets/orthodoxmetrics-security-headers.conf;
     expires 1y;
     add_header Cache-Control "public, immutable";
@@ -277,7 +279,7 @@
 # Marketing routes served by om-platform's index.html (client-side routed).
 location ~ ^/(product|products|records|capabilities|ocr|analytics|about|about-us|contact|contact-us|faq|faqs|pricing|enroll|latest-news|terms|privacy|security)$ {
     include /etc/nginx/snippets/orthodoxmetrics-security-headers.conf;
-    root /var/www/orthodoxmetrics/prod/front-end/dist-platform;
+    root /var/www/om-platform/front-end/dist;
     expires off;
     add_header Cache-Control "no-store, no-cache, must-revalidate" always;
     try_files /index.html =404;
@@ -286,7 +288,7 @@
 # Site root.
 location = / {
     include /etc/nginx/snippets/orthodoxmetrics-security-headers.conf;
-    root /var/www/orthodoxmetrics/prod/front-end/dist-platform;
+    root /var/www/om-platform/front-end/dist;
     expires off;
     add_header Cache-Control "no-store, no-cache, must-revalidate" always;
     try_files /index.html =404;
```

### `snippets/orthodoxmetrics-sso.conf`

Diff vs `/etc/nginx/snippets/orthodoxmetrics-sso.conf.bak-2026-09-16-223100`:

```diff
--- /etc/nginx/snippets/orthodoxmetrics-sso.conf.bak-2026-09-16-223100	2026-08-29 16:37:36.751261290 -0400
+++ /etc/nginx/snippets/orthodoxmetrics-sso.conf	2026-09-16 22:31:03.133496913 -0400
@@ -7,11 +7,6 @@
     add_header Cache-Control "no-store, no-cache, must-revalidate" always;
 }
 
-# Legacy alias; parish login UI is the SPA at /auth/login2 (no redirect to /login — that loops).
-location = /auth/login {
-    return 302 /auth/login2$is_args$args;
-}
-
 location = /api/auth/recaptcha-config {
     proxy_pass         http://127.0.0.1:7060/api/auth/recaptcha-config;
     proxy_http_version 1.1;
```

### `sites-available/orthodoxmetrics.com`

A brief unused `map $host $om_legacy_login_redirect` was added then removed. Live file matches the pre-map vhost (TLS/server_name unchanged). Diff vs `orthodoxmetrics.com.bak-2026-09-16-223100` (the version that still had the unused map):

```diff
--- /etc/nginx/sites-available/orthodoxmetrics.com.bak-2026-09-16-223100	2026-09-16 22:30:31.842725141 -0400
+++ /etc/nginx/sites-available/orthodoxmetrics.com	2026-09-16 22:31:03.160497579 -0400
@@ -19,14 +19,6 @@
     "developer"   latest;
 }
 
-# 2026-09-16 hostname split: only the legacy host keeps the parish
-# /auth/login → /auth/login2 bounce. orthodoxmetrics.com serves om-platform
-# sign-in at /auth/login. Used by snippets/orthodoxmetrics-sso.conf.
-map $host $om_legacy_login_redirect {
-    default                    0;
-    prod.orthodoxmetrics.com   1;
-}
-
 # ---- Port 80: redirect to HTTPS ----
 server {
     listen 80;
```

## OMAD-2967 — prod.* TLS + legacy SPA

These files are **new** on the host (no pre-cutover bak of the vhost itself).

- `sites-available/prod.orthodoxmetrics.com` — HTTP ACME + HTTPS; includes `orthodoxmetrics-legacy-common.conf`. Cert **paths** only: `/etc/nginx/ssl/prod.orthodoxmetrics.com/{fullchain,privkey}.pem`.
- `snippets/orthodoxmetrics-legacy-common.conf` — copy of common **without** om-platform marketing; `root` is `/var/www/orthodoxmetrics/prod/front-end/dist`; `/auth/login` 302 → `/auth/login2`; cookie rewrite → `prod.orthodoxmetrics.com`.
- `sbin/issue-prod-le-cert.sh` — HTTP-01 webroot helper (`/var/www/html`). Does not touch the apex GoDaddy cert.
- `letsencrypt/renewal-hooks/deploy/prod-orthodoxmetrics.sh` — copies renewed PEMs into `/etc/nginx/ssl/…` and reloads nginx. No PEM contents in git.

## Secrets check

No `*.pem`, no privkey/fullchain file contents. Cert paths in server blocks are intentional.
