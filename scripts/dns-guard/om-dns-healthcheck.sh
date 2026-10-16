#!/usr/bin/env bash
# scripts/dns-guard/om-dns-healthcheck.sh
#
# External health checker for orthodoxmetrics.com — validates the site the way an
# OUTSIDE user experiences it, using PUBLIC resolvers (8.8.8.8 / 1.1.1.1) and the
# public hostname so results are NOT masked by LAN behaviour.
#
# Checks:
#   1. DNS resolution for apex (+ www if enabled) via public resolvers
#   2. DNS still pointing at an old / stale IP (vs detected WAN)
#   3. HTTPS status (expect 2xx/3xx) on apex and www
#   4. TLS certificate validity + days-to-expiry (warn threshold configurable)
#   5. HTTP -> HTTPS redirect on port 80
#   6. Expected body/title/header sanity
#   7. Optional protected-route check (login page loads, not a raw API error)
#   8. Internal-IP / dev-host leakage in the public HTML/headers
#      (192.168.x.x, 10.x, 127.0.0.1, localhost, .local, :3001/:7060 etc.)
#
# Designed to run from ANY host (prod server, external VPS, or a laptop on mobile
# data). See docs/internal for placement guidance — an EXTERNAL host is preferred.
#
# Exit code = number of FAILED checks (0 = all healthy). Warnings do not fail.

set -o pipefail
export OM_DNS_COMPONENT="om-dns-health"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"
om_load_config

CERT_WARN_DAYS="${OM_HEALTH_CERT_WARN_DAYS:-21}"
CHECK_WWW="${OM_HEALTH_WWW:-1}"
PROTECTED_PATH="${OM_HEALTH_PROTECTED_PATH:-/auth/login}"
EXPECT_TITLE="${OM_HEALTH_EXPECT_TITLE:-}"    # optional substring, e.g. "Orthodox"
DOMAIN="$OM_HEALTH_DOMAIN"

FAILS=0
WARNS=0
declare -a FAIL_MSGS=()
declare -a WARN_MSGS=()

fail() { FAILS=$((FAILS+1)); FAIL_MSGS+=("$1"); om_error "CHECK FAIL: $1"; }
warn() { WARNS=$((WARNS+1)); WARN_MSGS+=("$1"); om_warn  "CHECK WARN: $1"; }
pass() { om_info "CHECK OK: $1"; }

om_info "external health check starting for $DOMAIN (www=$CHECK_WWW)"

# --- 1/2. DNS resolution + staleness vs WAN ------------------------------
apex_ip="$(om_resolve_a "$DOMAIN")"
if [[ -z "$apex_ip" ]]; then
  fail "DNS: apex $DOMAIN did not resolve to an A record via public resolvers"
else
  pass "DNS: $DOMAIN -> $apex_ip"
  # Cross-check a second resolver for consistency.
  apex_ip2="$(om_resolve_a "$DOMAIN" "${OM_PUBLIC_RESOLVERS[1]}")"
  if [[ -n "$apex_ip2" && "$apex_ip2" != "$apex_ip" ]]; then
    warn "DNS: resolvers disagree for $DOMAIN (${OM_PUBLIC_RESOLVERS[0]}=$apex_ip, ${OM_PUBLIC_RESOLVERS[1]}=$apex_ip2) — propagation in progress?"
  fi
  # Staleness: compare public DNS to the WAN IP as seen from where we run.
  wan_ip="$(om_detect_wan_ip 2>/dev/null || true)"
  if [[ -n "$wan_ip" ]]; then
    if [[ "$wan_ip" == "$apex_ip" ]]; then
      pass "DNS matches locally-detected WAN IP ($wan_ip) — not stale"
    else
      # If run externally (VPS/mobile) the "WAN" is that host's egress, so this
      # is only authoritative when run from the prod network. Flag as warn there.
      warn "DNS ($apex_ip) != WAN IP detected from this host ($wan_ip). If this is the prod server, DNS is STALE and may be pointing at an old IP."
    fi
  fi
fi

if [[ "$CHECK_WWW" == "1" ]]; then
  www_ip="$(om_resolve_a "www.$DOMAIN")"
  if [[ -z "$www_ip" ]]; then
    # www may legitimately be a CNAME; verify it resolves through CNAME.
    if dig +short "www.$DOMAIN" @"${OM_PUBLIC_RESOLVERS[0]}" | grep -q .; then
      pass "DNS: www.$DOMAIN resolves (via CNAME)"
    else
      fail "DNS: www.$DOMAIN did not resolve"
    fi
  else
    pass "DNS: www.$DOMAIN -> $www_ip"
  fi
fi

# --- 3/6. HTTPS status + body/title/header sanity ------------------------
check_https() {
  local host="$1"
  local url="https://$host/"
  local tmp="/tmp/om-health-body-$host.$$"
  local htmp="/tmp/om-health-hdr-$host.$$"
  local code
  # Single GET captures both response headers (-D) and body (-o) exactly as an
  # outside user would receive them (HEAD can omit add_header-injected headers).
  code="$(curl -4 -sS --max-time 20 -o "$tmp" -D "$htmp" -w '%{http_code}' \
           -H 'Cache-Control: no-cache' "$url" 2>/dev/null)"
  local rc=$?
  local body; body="$(cat "$tmp" 2>/dev/null)"
  local hdrs; hdrs="$(cat "$htmp" 2>/dev/null)"
  rm -f "$tmp" "$htmp"

  if (( rc != 0 )); then
    fail "HTTPS: request to $url failed (curl rc=$rc) — site may be unreachable"
    return
  fi
  if [[ "$code" =~ ^(200|301|302|307|308)$ ]]; then
    pass "HTTPS: $url -> $code"
  else
    fail "HTTPS: $url returned $code (expected 2xx/3xx)"
  fi

  # Security header sanity (warn-only).
  echo "$hdrs" | grep -qi '^strict-transport-security\|^x-frame-options\|^x-content-type-options' \
    && pass "HTTPS: $host has baseline security headers" \
    || warn "HTTPS: $host missing common security headers (HSTS/X-Frame-Options)"

  # Optional expected title/body substring.
  if [[ -n "$EXPECT_TITLE" ]]; then
    if echo "$body" | grep -qi "$EXPECT_TITLE"; then
      pass "BODY: $host contains expected marker '$EXPECT_TITLE'"
    else
      warn "BODY: $host did not contain expected marker '$EXPECT_TITLE'"
    fi
  fi

  # Internal-IP / dev-host leakage scan (this is a FAIL — never OK in prod).
  om_scan_leakage "$host" "$body" "$hdrs"
}

# --- 8. Internal-IP / dev-host leakage scan ------------------------------
om_scan_leakage() {
  local host="$1" body="$2" hdrs="$3"
  local combined="$body
$hdrs"
  local hits=""
  # Private IP ranges.
  grep -oE '(^|[^0-9])(192\.168\.[0-9]+\.[0-9]+|10\.[0-9]+\.[0-9]+\.[0-9]+|172\.(1[6-9]|2[0-9]|3[0-1])\.[0-9]+\.[0-9]+|127\.0\.0\.1)' <<<"$combined" \
    | grep -oE '(192\.168\.[0-9.]+|10\.[0-9.]+|172\.[0-9.]+|127\.0\.0\.1)' | sort -u > /tmp/om-leak.$$ 2>/dev/null
  if [[ -s /tmp/om-leak.$$ ]]; then hits+="private-ip:$(tr '\n' ',' </tmp/om-leak.$$) "; fi
  rm -f /tmp/om-leak.$$
  # localhost / .local / dev hostnames.
  grep -qiE 'localhost|\.local\b|orthodoxmetrics\.local' <<<"$combined" && hits+="localhost/.local "
  # Wrong / internal ports referenced in URLs.
  grep -qoE 'https?://[a-zA-Z0-9._-]+:(3001|7060|3000|5173|8080)' <<<"$combined" && hits+="internal-port "

  if [[ -n "$hits" ]]; then
    fail "LEAK: $host public response references internal addresses [$hits] — this exposes internal infrastructure"
  else
    pass "LEAK: $host public response has no internal-IP/dev-host leakage"
  fi
}

check_https "$DOMAIN"
[[ "$CHECK_WWW" == "1" ]] && check_https "www.$DOMAIN"

# --- 4. TLS certificate validity + expiry --------------------------------
cert_info="$(echo | openssl s_client -servername "$DOMAIN" -connect "$DOMAIN:443" 2>/dev/null | openssl x509 -noout -enddate -checkend 0 2>/dev/null)"
if echo "$cert_info" | grep -q 'Certificate will expire'; then
  fail "TLS: certificate for $DOMAIN is EXPIRED or invalid"
elif [[ -z "$cert_info" ]]; then
  fail "TLS: could not retrieve certificate for $DOMAIN:443"
else
  end="$(echo | openssl s_client -servername "$DOMAIN" -connect "$DOMAIN:443" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)"
  end_epoch="$(date -d "$end" +%s 2>/dev/null || echo 0)"
  now_epoch="$(date +%s)"
  days_left=$(( (end_epoch - now_epoch) / 86400 ))
  if (( days_left <= 0 )); then
    fail "TLS: certificate for $DOMAIN expired ($end)"
  elif (( days_left <= CERT_WARN_DAYS )); then
    warn "TLS: certificate for $DOMAIN expires in $days_left day(s) ($end) — renew soon"
  else
    pass "TLS: certificate valid, $days_left day(s) remaining ($end)"
  fi
fi

# --- 5. HTTP -> HTTPS redirect -------------------------------------------
redir="$(curl -4 -sSI --max-time 15 "http://$DOMAIN/" 2>/dev/null)"
rcode="$(echo "$redir" | awk 'NR==1{print $2}')"
loc="$(echo "$redir" | grep -i '^location:' | tr -d '\r' | awk '{print $2}')"
if [[ "$rcode" =~ ^30 ]] && [[ "$loc" =~ ^https:// ]]; then
  pass "REDIRECT: http://$DOMAIN -> $loc ($rcode)"
elif [[ "$rcode" == "200" ]]; then
  fail "REDIRECT: http://$DOMAIN served 200 over plain HTTP (no HTTPS redirect)"
else
  warn "REDIRECT: http://$DOMAIN returned '$rcode' (location='${loc:-none}')"
fi

# --- 7. Optional protected-route check -----------------------------------
if [[ -n "$PROTECTED_PATH" ]]; then
  pcode="$(curl -4 -sS --max-time 15 -o /tmp/om-prot.$$ -w '%{http_code}' "https://$DOMAIN$PROTECTED_PATH" 2>/dev/null)"
  pbody="$(cat /tmp/om-prot.$$ 2>/dev/null)"; rm -f /tmp/om-prot.$$
  if [[ "$pcode" =~ ^(200|302|401|403)$ ]]; then
    # Should look like an app page, not a raw backend error/stack.
    if echo "$pbody" | grep -qiE 'cannot GET|internal server error|ECONNREFUSED|stack trace|502 Bad Gateway|503 Service'; then
      fail "PROTECTED: $PROTECTED_PATH returned $pcode but body looks like a backend error, not the login page"
    else
      pass "PROTECTED: $PROTECTED_PATH reachable ($pcode)"
    fi
  else
    warn "PROTECTED: $PROTECTED_PATH returned $pcode"
  fi
fi

# --- Summary + alerting ---------------------------------------------------
om_info "health check complete: $FAILS failure(s), $WARNS warning(s)"

if (( FAILS > 0 )); then
  # Escalate repeated failures harder (state counter).
  streak="$(om_state_get health_fail_streak)"; streak="${streak:-0}"; streak=$((streak+1))
  om_state_set health_fail_streak "$streak"
  sev="warn"; (( streak >= 3 || FAILS >= 3 )) && sev="critical"
  om_alert "$sev" "health_fail" "External health check failed ($FAILS issue(s), streak=$streak)" \
    "$(printf '%s\n' "${FAIL_MSGS[@]}")"
else
  prev="$(om_state_get health_fail_streak)"
  if [[ -n "$prev" && "$prev" != "0" ]]; then
    om_alert info health_recovered "External health check recovered" \
      "Site checks are healthy again after $prev consecutive failing run(s)."
  fi
  om_state_set health_fail_streak 0
fi

# Warnings that matter operationally still get a low-severity alert (throttled).
if (( WARNS > 0 && FAILS == 0 )); then
  om_alert info health_warn "External health check warnings ($WARNS)" \
    "$(printf '%s\n' "${WARN_MSGS[@]}")"
fi

exit "$FAILS"
