#!/usr/bin/env bash
# scripts/dns-guard/om-ddns-update.sh
#
# GoDaddy Dynamic DNS updater for orthodoxmetrics.com.
#
# Flow: detect current WAN IP (quorum of external providers) -> read the current
# GoDaddy A record via the GoDaddy API -> compare -> UPDATE ONLY WHEN DIFFERENT.
# Logs every check/update. Exits NON-ZERO on any API failure so the systemd unit
# is marked failed and OnFailure alerting fires.
#
# Modes:
#   (default)      apply changes when WAN != DNS
#   --dry-run      detect + compare + log, but never call the GoDaddy write API
#   --once         alias for default single run (documentation clarity)
#
# Config comes ONLY from the env file (default /etc/orthodoxmetrics/om-dns-guard.env):
#   GODADDY_API_KEY, GODADDY_API_SECRET   (required for live updates; root:600)
#   OM_DDNS_DOMAIN=orthodoxmetrics.com
#   OM_DDNS_RECORD=@
#   OM_DDNS_TTL=300
#
# SECURITY: the API key/secret are never printed. curl reads the Authorization
# header from a variable; it is not passed on any logged command line.
#
# Exit codes:
#   0  success (updated, already correct, clean dry-run, or compare-only no-creds)
#   2  WAN detection failed / no provider
#   3  WAN detection had no quorum
#   5  GoDaddy API read failure
#   6  GoDaddy API write failure
# (Missing credentials is NOT an error: it degrades to compare-only + exit 0,
#  still alerting on a stale DNS record. API call failures exit non-zero.)

set -o pipefail
export OM_DNS_COMPONENT="om-ddns"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --once)    : ;;
    -h|--help)
      grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) om_error "unknown argument: $arg"; exit 64 ;;
  esac
done

om_load_config

om_info "starting DDNS check (domain=$OM_DDNS_DOMAIN record=$OM_DDNS_RECORD ttl=$OM_DDNS_TTL dry_run=$DRY_RUN)"

# --- 1. Detect WAN IP -----------------------------------------------------
wan_ip="$(om_detect_wan_ip)"; rc=$?
if (( rc != 0 )); then
  case "$rc" in
    2) om_alert critical wan_detect_fail "WAN IP detection failed" \
         "No external IP provider responded; cannot verify or update DNS." ;;
    3) om_alert warn wan_no_quorum "WAN IP providers disagree" \
         "External IP providers returned conflicting values; skipping update this cycle." ;;
  esac
  exit "$rc"
fi
om_info "detected WAN IP: $wan_ip"

# Track WAN changes across runs for alerting context.
prev_wan="$(om_state_get last_wan_ip)"
wan_changed=0
if [[ -n "$prev_wan" && "$prev_wan" != "$wan_ip" ]]; then
  wan_changed=1
  om_warn "WAN IP changed: $prev_wan -> $wan_ip"
fi

# --- 2. Read current GoDaddy A record ------------------------------------
if [[ -z "${GODADDY_API_KEY:-}" || -z "${GODADDY_API_SECRET:-}" ]]; then
  # No creds: this is the documented "build fully, can't exercise live" path.
  om_warn "GoDaddy API credentials not present in $OM_DNS_ENV_FILE"
  # Still surface a mismatch vs public DNS so a stale record can't hide silently.
  pub_ip="$(om_resolve_a "$OM_DDNS_DOMAIN")"
  om_info "public DNS A($OM_DDNS_DOMAIN) = ${pub_ip:-<none>}"
  om_state_set last_wan_ip "$wan_ip"
  if [[ -n "$pub_ip" && "$pub_ip" != "$wan_ip" ]]; then
    om_alert critical ddns_mismatch_nocreds "DNS does not match WAN (no DDNS creds)" \
      "Public A record for $OM_DDNS_DOMAIN is $pub_ip but WAN IP is $wan_ip. Automatic update is NOT possible because GoDaddy API credentials are not configured. Update the record manually or install credentials at $OM_DNS_ENV_FILE."
  fi
  # No credentials is a config-absent state, NOT an API failure. Degrade
  # gracefully to compare-only so the scheduled timer does not mark the unit
  # failed every cycle (which would desensitise operators). A genuine stale
  # record is still surfaced via the critical mismatch alert above.
  om_info "compare-only mode: no GoDaddy credentials; live update path unavailable until creds are installed at $OM_DNS_ENV_FILE"
  exit 0
fi

AUTH_HEADER="Authorization: sso-key ${GODADDY_API_KEY}:${GODADDY_API_SECRET}"
api_url="$OM_GODADDY_API_BASE/domains/$OM_DDNS_DOMAIN/records/A/$OM_DDNS_RECORD"

read_resp="$(curl -fsS --max-time 15 -H "$AUTH_HEADER" -H 'Accept: application/json' "$api_url" 2>/dev/null)"
if [[ $? -ne 0 || -z "$read_resp" ]]; then
  om_alert critical godaddy_read_fail "GoDaddy API read failed" \
    "Could not read A/$OM_DDNS_RECORD for $OM_DDNS_DOMAIN. Check API credentials/quota/endpoint. WAN IP is $wan_ip."
  exit 5
fi

current_ip="$(echo "$read_resp" | jq -r '.[0].data // empty' 2>/dev/null)"
current_ttl="$(echo "$read_resp" | jq -r '.[0].ttl // empty' 2>/dev/null)"
if ! om_is_ipv4 "$current_ip"; then
  om_alert critical godaddy_parse_fail "GoDaddy API returned no usable A record" \
    "Response did not contain a valid A record data field for $OM_DDNS_RECORD.$OM_DDNS_DOMAIN."
  exit 5
fi
om_info "GoDaddy current A($OM_DDNS_RECORD.$OM_DDNS_DOMAIN) = $current_ip (ttl=$current_ttl)"

# --- 3. Compare -----------------------------------------------------------
if [[ "$current_ip" == "$wan_ip" ]]; then
  om_info "no change needed: GoDaddy A record already matches WAN IP ($wan_ip)"
  om_state_set last_wan_ip "$wan_ip"
  om_state_set last_dns_ip "$current_ip"
  exit 0
fi

om_warn "mismatch: GoDaddy=$current_ip WAN=$wan_ip -> update required"

if (( DRY_RUN == 1 )); then
  om_info "dry-run: WOULD update A/$OM_DDNS_RECORD to $wan_ip (ttl=$OM_DDNS_TTL); no write performed"
  om_state_set last_wan_ip "$wan_ip"
  exit 0
fi

# --- 4. Update only when different ---------------------------------------
put_body="$(printf '[{"data":"%s","ttl":%s}]' "$wan_ip" "$OM_DDNS_TTL")"
http_code="$(curl -sS --max-time 20 -o /tmp/om-ddns-put.$$ -w '%{http_code}' \
  -X PUT -H "$AUTH_HEADER" -H 'Content-Type: application/json' \
  -d "$put_body" "$api_url" 2>/dev/null)"
put_rc=$?
put_out="$(cat /tmp/om-ddns-put.$$ 2>/dev/null)"; rm -f /tmp/om-ddns-put.$$

if (( put_rc != 0 )) || [[ ! "$http_code" =~ ^2 ]]; then
  om_alert critical ddns_update_fail "GoDaddy DDNS update FAILED" \
    "Attempted to update A/$OM_DDNS_RECORD from $current_ip to $wan_ip but the GoDaddy API returned HTTP $http_code. The public site may become unreachable. Manual intervention required. Detail: ${put_out:-none}"
  exit 6
fi

om_info "SUCCESS: updated GoDaddy A/$OM_DDNS_RECORD $current_ip -> $wan_ip (ttl=$OM_DDNS_TTL, http=$http_code)"
om_state_set last_wan_ip "$wan_ip"
om_state_set last_dns_ip "$wan_ip"

if (( wan_changed == 1 )); then
  om_alert warn ddns_update_ok "WAN IP changed; DNS auto-updated" \
    "WAN IP changed $prev_wan -> $wan_ip and the GoDaddy A record for $OM_DDNS_DOMAIN was updated automatically. TTL=$OM_DDNS_TTL; allow propagation."
else
  om_alert info ddns_corrected "GoDaddy A record corrected" \
    "GoDaddy A record was $current_ip but WAN is $wan_ip; record updated to match."
fi
exit 0
