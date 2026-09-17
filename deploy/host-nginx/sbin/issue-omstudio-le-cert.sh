#!/usr/bin/env bash
# Issue/renew helper for omstudio.orthodoxmetrics.com via HTTP-01 webroot on om-prod01.
# Copies the cert to OMStudio .242 so LAN split-horizon HTTPS works.
# Does not touch orthodoxmetrics.com / omdev / omworkshop / omai vhosts.
set -euo pipefail
NAME=omstudio.orthodoxmetrics.com
EXPECTED_A=73.178.108.121
WEBROOT=/var/www/html
LIVE=/etc/letsencrypt/live/${NAME}
DEST=/etc/nginx/ssl/${NAME}
PRODUCT=192.168.1.242

A_CF="$(dig +short "${NAME}" A @1.1.1.1 +time=3 +tries=1 | head -1)"
A_GG="$(dig +short "${NAME}" A @8.8.8.8 +time=3 +tries=1 | head -1)"
echo "1.1.1.1 A=${A_CF:-NONE}  8.8.8.8 A=${A_GG:-NONE}"
if [[ "${A_CF}" != "${EXPECTED_A}" && "${A_GG}" != "${EXPECTED_A}" ]]; then
  echo "Refusing: ${NAME} must be A ${EXPECTED_A}" >&2
  exit 3
fi
sudo mkdir -p "${WEBROOT}/.well-known/acme-challenge"
sudo certbot certonly --webroot -w "${WEBROOT}" -d "${NAME}" --agree-tos --non-interactive --key-type ecdsa
sudo install -d -m 0755 "${DEST}"
sudo install -m 0644 "${LIVE}/fullchain.pem" "${DEST}/fullchain.pem"
sudo install -m 0600 "${LIVE}/privkey.pem" "${DEST}/privkey.pem"
sudo openssl x509 -in "${DEST}/fullchain.pem" -noout -issuer -subject -dates -ext subjectAltName
sudo nginx -t
sudo systemctl reload nginx

echo "=== copy cert to product host ${PRODUCT} ==="
ssh -o BatchMode=yes "next@${PRODUCT}" "sudo mkdir -p '${DEST}' && sudo chmod 755 '${DEST}'"
sudo cat "${LIVE}/fullchain.pem" | ssh -o BatchMode=yes "next@${PRODUCT}" "sudo tee '${DEST}/fullchain.pem' >/dev/null && sudo chmod 644 '${DEST}/fullchain.pem'"
sudo cat "${LIVE}/privkey.pem" | ssh -o BatchMode=yes "next@${PRODUCT}" "sudo tee '${DEST}/privkey.pem' >/dev/null && sudo chmod 600 '${DEST}/privkey.pem'"
ssh -o BatchMode=yes "next@${PRODUCT}" "sudo nginx -t && sudo systemctl reload nginx"
echo "DONE ${NAME}"
