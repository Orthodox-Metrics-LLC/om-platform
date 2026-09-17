#!/usr/bin/env bash
# Issue/renew helper for prod.orthodoxmetrics.com via HTTP-01 webroot on om-prod01.
# Does not touch orthodoxmetrics.com / omai / omdev / omworkshop / omstudio vhosts.
set -euo pipefail
NAME=prod.orthodoxmetrics.com
EXPECTED_A=73.178.108.121
WEBROOT=/var/www/html
LIVE=/etc/letsencrypt/live/${NAME}
DEST=/etc/nginx/ssl/${NAME}

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
echo "DONE ${NAME}"
