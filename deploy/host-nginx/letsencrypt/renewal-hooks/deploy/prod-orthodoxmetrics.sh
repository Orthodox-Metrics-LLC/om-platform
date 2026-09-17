#!/bin/bash
set -euo pipefail
if [ "${RENEWED_LINEAGE:-}" != "/etc/letsencrypt/live/prod.orthodoxmetrics.com" ]; then
  exit 0
fi
DEST=/etc/nginx/ssl/prod.orthodoxmetrics.com
install -d -m 0755 "$DEST"
install -m 0644 "${RENEWED_LINEAGE}/fullchain.pem" "${DEST}/fullchain.pem"
install -m 0600 "${RENEWED_LINEAGE}/privkey.pem" "${DEST}/privkey.pem"
nginx -t
systemctl reload nginx
