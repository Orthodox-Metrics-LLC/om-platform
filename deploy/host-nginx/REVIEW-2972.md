# OMAD-2972 — review surface (four-hostname HTTPS)

Live apply was done on 2026-09-16 **before** this snapshot. Merging this PR does not reload nginx.

## What was already working (no vhost rewrite)

| Host | LAN A (DC01) | TLS | Notes |
|---|---|---|---|
| `prod.orthodoxmetrics.com` | `192.168.1.239` | LE YE1, exp 2026-12-16 | nginx listen `0.0.0.0:443`, HTTP→HTTPS 301, SPA 200. Laptop `192.168.1.77` was already getting 200s on this vhost while Chrome also reported CONNECTION_CLOSED (see gap). |
| `omai.orthodoxmetrics.com` | `192.168.1.239` | LE YE2, exp 2026-12-13 | `/` → 302 `/omai/`; `/omai/` 200. |
| apex `orthodoxmetrics.com` | `192.168.1.239` | GoDaddy, exp 2026-11-01 | Unchanged om-platform split. |

## What we changed

### OMStudio `192.168.1.242`

LAN split-horizon A is **`.242`**, which refused `:443`. WAN still hits `.239` (Porkbun `73.178.108.121`).

- Copied the existing LE cert (issued on `.239` HTTP-01) to `/etc/nginx/ssl/omstudio.orthodoxmetrics.com/` on `.242`.
- Added TLS server + HTTP→HTTPS on `.242` (product locations unchanged).
- Pointed the `.239` edge `proxy_pass` at **`https://192.168.1.242`** so WAN does not 301-loop through `.242:80`.
- Renew hook + `issue-omstudio-le-cert.sh` now scp the renewed cert to `.242` and reload nginx there.

### OM Workshop `192.168.1.251`

Cert and `:443` already existed. Named vhost only served MCP/preview (`/` 404).

- Named HTTPS now includes Workshop UI locations (LAN `https://omworkshop.orthodoxmetrics.com` serves the app).
- Named HTTP: ACME + Figma snippet (so `.239` edge can still proxy MCP to `:80`) + `/` → HTTPS.
- Catch-all `om-workshop` on `:80` / `server_name _` is unchanged.
- `.239` public vhost stays MCP/preview-only (no full Workshop on the WAN edge).

## Remaining gap — WAN hairpin from LAN

From this LAN, `curl --resolve …:443:73.178.108.121` **times out**. Porkbun A for the four names is `73.178.108.121`. Chrome Secure DNS / DoH uses that public A and never sees DC01.

That matches Nick’s laptop: `ping` (system DNS) → `192.168.1.239`, browser → CONNECTION_CLOSED / can’t be reached.

Fix is **router NAT loopback** for `80/443` → `192.168.1.239` (and the other product hosts if those WAN forwards exist). Not an nginx listen/SNI/cert bug on `.239`.

## Do not

- Commit PEMs.
- Point apex or prod.* at `dist-platform/`.
- Treat merge as a live nginx deploy (already applied).
