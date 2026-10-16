#!/usr/bin/env bash
# scripts/dns-guard/install.sh
#
# Installs (or rolls back) the OM External DNS Reliability Guard systemd units.
# Run as root on the prod host. This does NOT create or overwrite the secret
# env file — that is a manual step (see om-dns-guard.env.example).
#
# Usage:
#   sudo ./install.sh install     # install units, create dirs, enable timers
#   sudo ./install.sh uninstall   # disable + remove units (rollback)
#   sudo ./install.sh status      # show timer/service status

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UNIT_SRC="$SCRIPT_DIR/systemd"
UNIT_DST="/etc/systemd/system"
UNITS=(om-ddns.service om-ddns.timer om-dns-healthcheck.service om-dns-healthcheck.timer)
STATE_DIR="/var/lib/om-dns-guard"
LOG_DIR="/var/log/om-dns-guard"
ENV_DIR="/etc/orthodoxmetrics"
ENV_FILE="$ENV_DIR/om-dns-guard.env"

require_root() { [[ "$(id -u)" -eq 0 ]] || { echo "Must run as root." >&2; exit 1; }; }

cmd_install() {
  require_root
  echo "==> Creating state/log directories"
  install -d -m 750 -o root -g root "$STATE_DIR" "$LOG_DIR"
  install -d -m 750 -o root -g root "$ENV_DIR"

  if [[ ! -f "$ENV_FILE" ]]; then
    echo "==> NOTE: $ENV_FILE not found."
    echo "    The guard runs in dry-run/compare-only mode until you create it:"
    echo "      cp $SCRIPT_DIR/om-dns-guard.env.example $ENV_FILE"
    echo "      chmod 600 $ENV_FILE && chown root:root $ENV_FILE && edit it"
  else
    chmod 600 "$ENV_FILE"; chown root:root "$ENV_FILE"
    echo "==> Verified $ENV_FILE permissions (root:600)"
  fi

  echo "==> Installing systemd units"
  for u in "${UNITS[@]}"; do
    install -m 644 -o root -g root "$UNIT_SRC/$u" "$UNIT_DST/$u"
    echo "    installed $u"
  done

  chmod 755 "$SCRIPT_DIR"/*.sh

  echo "==> Reloading systemd + enabling timers"
  systemctl daemon-reload
  systemctl enable --now om-ddns.timer
  systemctl enable --now om-dns-healthcheck.timer

  echo "==> Done. Timers:"
  systemctl list-timers om-ddns.timer om-dns-healthcheck.timer --no-pager || true
}

cmd_uninstall() {
  require_root
  echo "==> Disabling timers"
  systemctl disable --now om-ddns.timer om-dns-healthcheck.timer 2>/dev/null || true
  echo "==> Removing units"
  for u in "${UNITS[@]}"; do rm -f "$UNIT_DST/$u"; echo "    removed $u"; done
  systemctl daemon-reload
  echo "==> Rollback complete. (State $STATE_DIR, logs $LOG_DIR, and $ENV_FILE left intact.)"
  echo "    To fully purge: rm -rf $STATE_DIR $LOG_DIR   (env file removal is manual)"
}

cmd_status() {
  systemctl status om-ddns.timer om-dns-healthcheck.timer --no-pager || true
  echo "---- last DDNS run ----";        journalctl -u om-ddns.service -n 20 --no-pager 2>/dev/null || true
  echo "---- last health run ----";      journalctl -u om-dns-healthcheck.service -n 20 --no-pager 2>/dev/null || true
}

case "${1:-}" in
  install)   cmd_install ;;
  uninstall) cmd_uninstall ;;
  status)    cmd_status ;;
  *) echo "Usage: $0 {install|uninstall|status}" >&2; exit 64 ;;
esac
