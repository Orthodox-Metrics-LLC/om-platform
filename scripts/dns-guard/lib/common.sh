#!/usr/bin/env bash
# scripts/dns-guard/lib/common.sh
#
# Shared helpers for the OrthodoxMetrics External DNS Reliability Guard.
#
# Provides: config loading, structured logging, WAN-IP detection (>=2 external
# providers with quorum), DNS resolution helpers, state persistence, and the
# unified alert dispatcher (local log + systemd status + Postfix email + optional
# Slack / OMAI webhooks).
#
# SECURITY: This library NEVER echoes or logs the contents of GODADDY_API_KEY /
# GODADDY_API_SECRET or any Authorization header. Callers must not either.
#
# Source this file from the individual guard scripts:
#   source "$(dirname "$0")/lib/common.sh"

set -o pipefail

# --------------------------------------------------------------------------
# Paths & config
# --------------------------------------------------------------------------
OM_DNS_ENV_FILE="${OM_DNS_ENV_FILE:-/etc/orthodoxmetrics/om-dns-guard.env}"
OM_DNS_STATE_DIR="${OM_DNS_STATE_DIR:-/var/lib/om-dns-guard}"
OM_DNS_LOG_DIR="${OM_DNS_LOG_DIR:-/var/log/om-dns-guard}"

# Sensible defaults; overridable via env file.
OM_DDNS_DOMAIN_DEFAULT="orthodoxmetrics.com"
OM_DDNS_RECORD_DEFAULT="@"
OM_DDNS_TTL_DEFAULT="300"
OM_HEALTH_DOMAIN_DEFAULT="orthodoxmetrics.com"
OM_ALERT_EMAIL_DEFAULT="info@orthodoxmetrics.com"
OM_ALERT_MIN_INTERVAL_DEFAULT="3600"   # seconds between identical alerts
OM_GODADDY_API_BASE_DEFAULT="https://api.godaddy.com/v1"

# External IP providers (IPv4). Quorum requires agreement of >=2.
OM_IP_PROVIDERS=(
  "https://api.ipify.org"
  "https://ifconfig.me/ip"
  "https://icanhazip.com"
  "https://checkip.amazonaws.com"
)

# Public resolvers used to observe DNS as an outside user would.
OM_PUBLIC_RESOLVERS=("8.8.8.8" "1.1.1.1")

# --------------------------------------------------------------------------
# Config loading
# --------------------------------------------------------------------------
om_load_config() {
  if [[ -f "$OM_DNS_ENV_FILE" ]]; then
    # shellcheck disable=SC1090
    set -a; source "$OM_DNS_ENV_FILE"; set +a
  fi
  OM_DDNS_DOMAIN="${OM_DDNS_DOMAIN:-$OM_DDNS_DOMAIN_DEFAULT}"
  OM_DDNS_RECORD="${OM_DDNS_RECORD:-$OM_DDNS_RECORD_DEFAULT}"
  OM_DDNS_TTL="${OM_DDNS_TTL:-$OM_DDNS_TTL_DEFAULT}"
  OM_HEALTH_DOMAIN="${OM_HEALTH_DOMAIN:-$OM_HEALTH_DOMAIN_DEFAULT}"
  OM_ALERT_EMAIL="${OM_ALERT_EMAIL:-$OM_ALERT_EMAIL_DEFAULT}"
  OM_ALERT_MIN_INTERVAL="${OM_ALERT_MIN_INTERVAL:-$OM_ALERT_MIN_INTERVAL_DEFAULT}"
  OM_GODADDY_API_BASE="${OM_GODADDY_API_BASE:-$OM_GODADDY_API_BASE_DEFAULT}"
}

# --------------------------------------------------------------------------
# Logging  (stdout is captured by journald under systemd)
# --------------------------------------------------------------------------
_om_component="${OM_DNS_COMPONENT:-dns-guard}"

_om_ts() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }

_om_logfile() {
  # Best-effort file log; never fatal if the dir isn't writable.
  local f="$OM_DNS_LOG_DIR/${_om_component}.log"
  if [[ -w "$OM_DNS_LOG_DIR" ]] || mkdir -p "$OM_DNS_LOG_DIR" 2>/dev/null; then
    echo "$1" >> "$f" 2>/dev/null || true
  fi
}

om_log() {
  local level="$1"; shift
  local line
  line="$(_om_ts) [$level] [$_om_component] $*"
  echo "$line"
  _om_logfile "$line"
}
om_info()  { om_log INFO  "$@"; }
om_warn()  { om_log WARN  "$@"; }
om_error() { om_log ERROR "$@" >&2; _om_logfile "$(_om_ts) [ERROR] [$_om_component] $*"; }

# --------------------------------------------------------------------------
# State persistence
# --------------------------------------------------------------------------
om_state_get() {
  local key="$1"
  local f="$OM_DNS_STATE_DIR/$key"
  [[ -f "$f" ]] && cat "$f" 2>/dev/null || true
}
om_state_set() {
  local key="$1" val="$2"
  mkdir -p "$OM_DNS_STATE_DIR" 2>/dev/null || return 0
  printf '%s\n' "$val" > "$OM_DNS_STATE_DIR/$key" 2>/dev/null || true
}

# --------------------------------------------------------------------------
# Validation helpers
# --------------------------------------------------------------------------
om_is_ipv4() {
  local ip="$1"
  [[ "$ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]] || return 1
  local IFS='.'; read -ra o <<< "$ip"
  for n in "${o[@]}"; do (( n >= 0 && n <= 255 )) || return 1; done
  return 0
}

om_is_private_ipv4() {
  # RFC1918 / loopback / link-local — used to flag internal-IP leakage.
  local ip="$1"
  [[ "$ip" =~ ^10\. ]] && return 0
  [[ "$ip" =~ ^127\. ]] && return 0
  [[ "$ip" =~ ^192\.168\. ]] && return 0
  [[ "$ip" =~ ^169\.254\. ]] && return 0
  [[ "$ip" =~ ^172\.(1[6-9]|2[0-9]|3[0-1])\. ]] && return 0
  return 1
}

# --------------------------------------------------------------------------
# WAN IP detection with quorum (>=2 providers must agree)
# Prints the agreed IPv4 to stdout; returns non-zero if no quorum.
# --------------------------------------------------------------------------
om_detect_wan_ip() {
  local -A votes=()
  local got=0
  for url in "${OM_IP_PROVIDERS[@]}"; do
    local ip
    ip="$(curl -4 -fsS --max-time 8 "$url" 2>/dev/null | tr -d '[:space:]')"
    if om_is_ipv4 "$ip"; then
      votes["$ip"]=$(( ${votes["$ip"]:-0} + 1 ))
      got=$(( got + 1 ))
    fi
  done
  if (( got == 0 )); then
    om_error "WAN detection: no external IP provider responded"
    return 2
  fi
  # Pick the IP with the most votes.
  local best="" bestn=0
  for ip in "${!votes[@]}"; do
    if (( votes["$ip"] > bestn )); then best="$ip"; bestn=${votes["$ip"]}; fi
  done
  if (( bestn < 2 )); then
    om_warn "WAN detection: no quorum (best '$best' had $bestn vote of $got); providers disagree"
    return 3
  fi
  echo "$best"
  return 0
}

# --------------------------------------------------------------------------
# DNS resolution as an outside user (public resolvers)
# om_resolve_a <fqdn> [resolver] -> prints first A value
# --------------------------------------------------------------------------
om_resolve_a() {
  local fqdn="$1" resolver="${2:-${OM_PUBLIC_RESOLVERS[0]}}"
  dig +short +time=5 +tries=2 A "$fqdn" "@$resolver" 2>/dev/null \
    | grep -E '^([0-9]{1,3}\.){3}[0-9]{1,3}$' | head -n1
}

# --------------------------------------------------------------------------
# Alert dispatcher
# om_alert <severity> <event-key> <subject> <body...>
#   severity: info|warn|critical
#   event-key: used for dedupe throttling (OM_ALERT_MIN_INTERVAL)
# Channels: local log (always) + email (Postfix relay) + optional Slack + OMAI.
# Returns 0 always (alerting failures must not mask the underlying condition).
# --------------------------------------------------------------------------
om_alert() {
  local severity="$1" key="$2" subject="$3"; shift 3
  local body="$*"

  # Always log.
  case "$severity" in
    critical) om_error "ALERT[$key] $subject :: $body" ;;
    warn)     om_warn  "ALERT[$key] $subject :: $body" ;;
    *)        om_info  "ALERT[$key] $subject :: $body" ;;
  esac

  # Dedupe throttle for repeated identical events.
  local now last statekey="alert_${key}_last"
  now="$(date +%s)"
  last="$(om_state_get "$statekey")"
  if [[ -n "$last" ]] && (( now - last < OM_ALERT_MIN_INTERVAL )); then
    om_info "ALERT[$key] suppressed (last sent $(( now - last ))s ago < ${OM_ALERT_MIN_INTERVAL}s)"
    return 0
  fi
  om_state_set "$statekey" "$now"

  local host; host="$(hostname -f 2>/dev/null || hostname)"
  local full_subject="[OM DNS Guard][$severity] $subject"
  local full_body
  full_body="$(cat <<EOF
$body

--
Host: $host
Component: $_om_component
Time: $(_om_ts)
Severity: $severity
Event: $key
EOF
)"

  # Email via local Postfix relay (127.0.0.1:25). No SMTP creds required.
  if [[ -n "${OM_ALERT_EMAIL:-}" ]] && command -v sendmail >/dev/null 2>&1; then
    {
      printf 'To: %s\n' "$OM_ALERT_EMAIL"
      printf 'From: OM DNS Guard <noreply@%s>\n' "$OM_DDNS_DOMAIN"
      printf 'Subject: %s\n' "$full_subject"
      printf 'Content-Type: text/plain; charset=UTF-8\n\n'
      printf '%s\n' "$full_body"
    } | sendmail -t 2>/dev/null \
      && om_info "ALERT[$key] emailed to $OM_ALERT_EMAIL" \
      || om_warn "ALERT[$key] email dispatch failed"
  fi

  # Optional Slack webhook.
  if [[ -n "${OM_ALERT_SLACK_WEBHOOK:-}" ]]; then
    local payload
    payload="$(printf '{"text":"%s\\n%s"}' \
      "$(om_json_escape "$full_subject")" "$(om_json_escape "$full_body")")"
    curl -fsS --max-time 8 -X POST -H 'Content-Type: application/json' \
      -d "$payload" "$OM_ALERT_SLACK_WEBHOOK" >/dev/null 2>&1 \
      && om_info "ALERT[$key] posted to Slack" \
      || om_warn "ALERT[$key] Slack dispatch failed"
  fi

  # Optional OMAI / OMBrain event ingestion webhook.
  if [[ -n "${OM_ALERT_OMAI_WEBHOOK:-}" ]]; then
    local opayload
    opayload="$(printf '{"source":"om-dns-guard","severity":"%s","event":"%s","subject":"%s","body":"%s","host":"%s"}' \
      "$severity" "$key" "$(om_json_escape "$subject")" "$(om_json_escape "$body")" "$host")"
    curl -fsS --max-time 8 -X POST -H 'Content-Type: application/json' \
      ${OM_ALERT_OMAI_TOKEN:+-H "Authorization: Bearer $OM_ALERT_OMAI_TOKEN"} \
      -d "$opayload" "$OM_ALERT_OMAI_WEBHOOK" >/dev/null 2>&1 \
      && om_info "ALERT[$key] posted to OMAI ingestion" \
      || om_warn "ALERT[$key] OMAI dispatch failed"
  fi

  return 0
}

om_json_escape() {
  # Minimal JSON string escaping for embedding in webhook payloads.
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/}"
  s="${s//$'\t'/\\t}"
  printf '%s' "$s"
}
