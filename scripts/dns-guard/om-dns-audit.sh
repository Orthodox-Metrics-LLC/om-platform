#!/usr/bin/env bash
# scripts/dns-guard/om-dns-audit.sh
#
# Part 1 — Current-state DNS audit for orthodoxmetrics.com.
#
# Enumerates the DNS records production needs, detects the WAN IP from >=2
# external providers, and compares WAN IP vs public DNS A-record vs the
# nginx-expected IP, printing a clear mismatch report. Read-only; safe to run
# any time. No credentials required.
#
# Usage: ./om-dns-audit.sh [--json]

set -o pipefail
export OM_DNS_COMPONENT="om-dns-audit"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
om_load_config

JSON=0; [[ "${1:-}" == "--json" ]] && JSON=1
DOMAIN="$OM_DDNS_DOMAIN"

# Records production relies on (public-facing A/CNAME that point at the WAN IP).
APP_HOSTS=("$DOMAIN" "www.$DOMAIN" "api.$DOMAIN")

echo "=================================================================="
echo " OrthodoxMetrics DNS Reliability Audit — $(_om_ts)"
echo " Domain: $DOMAIN"
echo "=================================================================="

# --- WAN IP (quorum) ------------------------------------------------------
wan_ip="$(om_detect_wan_ip)"; wan_rc=$?
echo
echo "[WAN] Detected public WAN IP (>=2 external providers): ${wan_ip:-UNKNOWN} (rc=$wan_rc)"

# --- Nginx-expected IP ----------------------------------------------------
# This host terminates TLS directly (.239); the "expected" public IP is the WAN
# IP that NATs to it. nginx binds no explicit public IP, so we report the host's
# LAN IP + note the port-forward assumption.
lan_ip="$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^192\.168\.' | head -n1)"
echo "[NGINX] TLS terminated on this host (LAN $lan_ip); expected public IP = current WAN via NAT/port-forward"

# --- Authoritative nameservers -------------------------------------------
ns="$(dig +short NS "$DOMAIN" @${OM_PUBLIC_RESOLVERS[0]} | sort | tr '\n' ' ')"
echo "[NS] Authoritative nameservers: ${ns:-UNKNOWN}"

# --- Per-record comparison -----------------------------------------------
echo
printf "%-28s %-18s %-8s %s\n" "RECORD" "PUBLIC DNS" "TYPE" "STATUS vs WAN"
echo "------------------------------------------------------------------"
mismatches=0
for h in "${APP_HOSTS[@]}"; do
  a="$(om_resolve_a "$h")"
  cname="$(dig +short CNAME "$h" @${OM_PUBLIC_RESOLVERS[0]} | head -n1)"
  rtype="A"; [[ -n "$cname" ]] && rtype="CNAME"
  shown="${a:-${cname:-<none>}}"
  status="—"
  if [[ -z "$a" && -z "$cname" ]]; then
    status="NO RECORD"
    # apex/www missing is a real problem; api. may be intentionally internal.
    [[ "$h" == "$DOMAIN" || "$h" == "www.$DOMAIN" ]] && { status="MISSING (critical)"; mismatches=$((mismatches+1)); }
    [[ "$h" == "api.$DOMAIN" ]] && status="no public record (nginx block exists — internal only?)"
  elif [[ -n "$a" && -n "$wan_ip" ]]; then
    if [[ "$a" == "$wan_ip" ]]; then status="MATCH"; else status="MISMATCH (stale?)"; mismatches=$((mismatches+1)); fi
  fi
  printf "%-28s %-18s %-8s %s\n" "$h" "$shown" "$rtype" "$status"
done

# --- Other record types (informational) ----------------------------------
echo
echo "[MX ] $(dig +short MX "$DOMAIN" @${OM_PUBLIC_RESOLVERS[0]} | tr '\n' ' ')"
echo "[TXT] $(dig +short TXT "$DOMAIN" @${OM_PUBLIC_RESOLVERS[0]} | tr '\n' ' ')"

echo
echo "=================================================================="
if (( mismatches == 0 )); then
  echo " RESULT: ✅ No critical mismatches. Public DNS aligns with WAN IP."
else
  echo " RESULT: ⚠️  $mismatches mismatch(es) detected — see rows above."
fi
echo "=================================================================="

if (( JSON == 1 )); then
  echo
  printf '{"ts":"%s","domain":"%s","wan_ip":"%s","apex":"%s","www":"%s","api":"%s","mismatches":%d}\n' \
    "$(_om_ts)" "$DOMAIN" "${wan_ip:-}" \
    "$(om_resolve_a "$DOMAIN")" "$(om_resolve_a "www.$DOMAIN")" "$(om_resolve_a "api.$DOMAIN")" \
    "$mismatches"
fi

exit "$mismatches"
