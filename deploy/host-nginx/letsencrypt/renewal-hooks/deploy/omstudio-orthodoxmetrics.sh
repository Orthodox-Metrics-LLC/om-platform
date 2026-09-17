#!/bin/bash
# Deploy hook: omstudio.orthodoxmetrics.com only.
# Edge (.239) + product host (.242). HTTP-01 stays on om-prod01.
set -euo pipefail
if [ "${RENEWED_LINEAGE:-}" != "/etc/letsencrypt/live/omstudio.orthodoxmetrics.com" ]; then
  exit 0
fi
DEST=/etc/nginx/ssl/omstudio.orthodoxmetrics.com
install -d -m 0755 "$DEST"
install -m 0644 "${RENEWED_LINEAGE}/fullchain.pem" "${DEST}/fullchain.pem"
install -m 0600 "${RENEWED_LINEAGE}/privkey.pem" "${DEST}/privkey.pem"
nginx -t
systemctl reload nginx
if [ "$(id -u)" -eq 0 ]; then
  sudo -u next ssh -o BatchMode=yes next@192.168.1.242 "sudo mkdir -p '$DEST' && sudo chmod 755 '$DEST'"
  cat "${RENEWED_LINEAGE}/fullchain.pem" | sudo -u next ssh -o BatchMode=yes next@192.168.1.242 "sudo tee '${DEST}/fullchain.pem' >/dev/null && sudo chmod 644 '${DEST}/fullchain.pem'"
  cat "${RENEWED_LINEAGE}/privkey.pem" | sudo -u next ssh -o BatchMode=yes next@192.168.1.242 "sudo tee '${DEST}/privkey.pem' >/dev/null && sudo chmod 600 '${DEST}/privkey.pem'"
  sudo -u next ssh -o BatchMode=yes next@192.168.1.242 "sudo nginx -t && sudo systemctl reload nginx" || true
fi
