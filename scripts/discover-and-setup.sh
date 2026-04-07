#!/usr/bin/env bash
# scripts/discover-and-setup.sh
#
# Scans repos across Agyeman-Enterprises, isaalia, and imho-media orgs.
# Extracts real domain names from known config files in each repo.
# For each domain: looks up Cloudflare zone, adds DNS records, adds to Mailcow.
# All operations are idempotent — check before create, skip if exists.
#
# Usage:
#   bash scripts/discover-and-setup.sh                 # scan all orgs
#   bash scripts/discover-and-setup.sh ORG REPO        # scope to one repo (webhook mode)
#
# Required env vars: GITHUB_TOKEN, CLOUDFLARE_API_TOKEN, MAILCOW_API_KEY, MAILCOW_HOST, MAIL_SERVER_IP

set -euo pipefail

# ── Config ───────────────────────────────────────────────────

ORGS=("Agyeman-Enterprises" "isaalia" "imho-media")
FILES_TO_SCAN=(".env.example" "README.md" "vercel.json" "mailcow.conf")
# .env* handled separately via search API

MAIL_IP="${MAIL_SERVER_IP:-34.26.207.116}"
MAIL_MX="${MAILCOW_HOST:-mail.agyemanenterprises.com}"

SCOPE_ORG="${1:-}"
SCOPE_REPO="${2:-}"

# ── Validation ───────────────────────────────────────────────

missing=()
for var in GITHUB_TOKEN CLOUDFLARE_API_TOKEN MAILCOW_API_KEY MAILCOW_HOST MAIL_SERVER_IP; do
  [[ -z "${!var:-}" ]] && missing+=("$var")
done
if [[ ${#missing[@]} -gt 0 ]]; then
  echo "ERROR: Missing required env vars: ${missing[*]}"
  exit 1
fi

command -v jq >/dev/null 2>&1 || { echo "ERROR: jq is required"; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "ERROR: curl is required"; exit 1; }

# ── Counters ─────────────────────────────────────────────────

DOMAINS_FOUND=0
DOMAINS_ADDED=0
DOMAINS_SKIPPED=0
DOMAINS_ERROR=0
DOMAINS_NO_ZONE=0

# ── Domain exclusion filter ──────────────────────────────────

is_excluded() {
  local domain="$1"
  # Exact/prefix exclusions
  local excluded_patterns=(
    "localhost"
    "example.com"
    "example.org"
    "test.com"
    "127.0.0.1"
    "0.0.0.0"
  )
  for pat in "${excluded_patterns[@]}"; do
    [[ "$domain" == "$pat" ]] && return 0
  done
  # Suffix exclusions
  local excluded_suffixes=(
    ".supabase.co"
    ".vercel.app"
    ".cloudflare.net"
    ".googleapis.com"
    ".github.com"
    ".github.io"
    ".docker.internal"
    ".amazonaws.com"
    ".azure.com"
    ".azurewebsites.net"
    ".railway.app"
    ".fly.dev"
    ".onrender.com"
    ".netlify.app"
    ".herokuapp.com"
    ".worker.dev"
    ".pages.dev"
    ".up.railway.app"
    ".coolify.io"
  )
  for suffix in "${excluded_suffixes[@]}"; do
    [[ "$domain" == *"$suffix" ]] && return 0
  done
  # Must have at least one dot and a real TLD (2+ chars)
  [[ "$domain" != *.* ]] && return 0
  local tld="${domain##*.}"
  [[ ${#tld} -lt 2 ]] && return 0
  return 1
}

# ── Extract domain names from text ──────────────────────────

extract_domains() {
  local content="$1"
  # Match strings that look like real domain names
  echo "$content" | \
    grep -oE '[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+\.[a-zA-Z]{2,}' | \
    tr '[:upper:]' '[:lower:]' | \
    sort -u || true
}

# ── Get root domain (strip subdomains for zone lookup) ───────

get_root_domain() {
  local domain="$1"
  # Take last two dot-separated parts (works for .com, .io, .app, .co, etc.)
  echo "$domain" | rev | cut -d. -f1-2 | rev
}

# ── GitHub API helper ────────────────────────────────────────

gh_api() {
  curl -sf \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "$@"
}

# ── Cloudflare API helper ────────────────────────────────────

cf_api() {
  local method="$1"; shift
  local path="$1"; shift
  curl -sf \
    -X "$method" \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -H "Content-Type: application/json" \
    "https://api.cloudflare.com/client/v4${path}" \
    "$@"
}

# ── Mailcow API helper ───────────────────────────────────────

mailcow_api() {
  local method="$1"; shift
  local path="$1"; shift
  curl -sf \
    -X "$method" \
    -H "X-API-Key: $MAILCOW_API_KEY" \
    -H "Content-Type: application/json" \
    "https://${MAILCOW_HOST}${path}" \
    "$@"
}

# ── List repos for an org (paginated) ───────────────────────

list_repos() {
  local org="$1"
  local page=1
  while true; do
    local response
    response=$(gh_api "https://api.github.com/orgs/${org}/repos?per_page=100&page=${page}&type=all" 2>/dev/null || echo "[]")
    local count
    count=$(echo "$response" | jq 'length' 2>/dev/null || echo "0")
    [[ "$count" -eq 0 ]] && break
    echo "$response" | jq -r '.[].name'
    [[ "$count" -lt 100 ]] && break
    ((page++))
  done
}

# ── Fetch file content from GitHub (base64-decoded) ──────────

fetch_file() {
  local org="$1"
  local repo="$2"
  local path="$3"
  local response
  response=$(gh_api "https://api.github.com/repos/${org}/${repo}/contents/${path}" 2>/dev/null || echo "{}")
  local content
  content=$(echo "$response" | jq -r '.content // empty' 2>/dev/null || true)
  [[ -z "$content" ]] && return
  echo "$content" | base64 -d 2>/dev/null || true
}

# ── Scan a single repo for domain names ──────────────────────

scan_repo() {
  local org="$1"
  local repo="$2"
  local all_domains=""

  # Scan known static files
  for file in "${FILES_TO_SCAN[@]}"; do
    local content
    content=$(fetch_file "$org" "$repo" "$file")
    [[ -z "$content" ]] && continue
    local found
    found=$(extract_domains "$content")
    [[ -n "$found" ]] && all_domains+=$'\n'"$found"
  done

  # Scan .env* files via GitHub search API (search in repo)
  local env_files
  env_files=$(gh_api "https://api.github.com/search/code?q=repo:${org}/${repo}+filename:.env&per_page=10" 2>/dev/null | \
    jq -r '.items[].path' 2>/dev/null || true)
  for env_file in $env_files; do
    # Only scan .env*, not .env.local (may have secrets) — but we're searching public info
    local content
    content=$(fetch_file "$org" "$repo" "$env_file")
    [[ -z "$content" ]] && continue
    local found
    found=$(extract_domains "$content")
    [[ -n "$found" ]] && all_domains+=$'\n'"$found"
  done

  # Return unique domains that pass the exclusion filter
  local filtered=""
  while IFS= read -r domain; do
    [[ -z "$domain" ]] && continue
    ! is_excluded "$domain" && filtered+="$domain"$'\n'
  done <<< "$(echo "$all_domains" | sort -u)"

  echo "$filtered"
}

# ── Look up Cloudflare Zone ID by domain name ────────────────

get_zone_id() {
  local domain="$1"
  local root
  root=$(get_root_domain "$domain")
  local response
  response=$(cf_api GET "/zones?name=${root}&status=active" 2>/dev/null || echo '{"result":[]}')
  echo "$response" | jq -r '.result[0].id // empty' 2>/dev/null || true
}

# ── Check if DNS record exists ───────────────────────────────

dns_record_exists() {
  local zone_id="$1"
  local type="$2"
  local name="$3"
  local content="${4:-}"
  local query="/zones/${zone_id}/dns_records?type=${type}&name=${name}"
  local response
  response=$(cf_api GET "$query" 2>/dev/null || echo '{"result":[]}')
  local count
  count=$(echo "$response" | jq '[.result[] | select(.content == "'"$content"'")] | length' 2>/dev/null || echo "0")
  [[ "$count" -gt 0 ]]
}

# ── Add DNS record (idempotent) ──────────────────────────────

add_dns_record() {
  local zone_id="$1"
  local type="$2"
  local name="$3"
  local content="$4"
  local priority="${5:-}"
  local ttl=3600

  # Check existence first
  if dns_record_exists "$zone_id" "$type" "$name" "$content"; then
    return 0  # already exists
  fi

  local body
  if [[ -n "$priority" ]]; then
    body=$(jq -n \
      --arg type "$type" \
      --arg name "$name" \
      --arg content "$content" \
      --argjson ttl "$ttl" \
      --argjson priority "$priority" \
      '{type:$type, name:$name, content:$content, ttl:$ttl, priority:$priority}')
  else
    body=$(jq -n \
      --arg type "$type" \
      --arg name "$name" \
      --arg content "$content" \
      --argjson ttl "$ttl" \
      '{type:$type, name:$name, content:$content, ttl:$ttl}')
  fi

  cf_api POST "/zones/${zone_id}/dns_records" -d "$body" >/dev/null 2>&1
}

# ── Check if domain exists in Mailcow ────────────────────────

mailcow_domain_exists() {
  local domain="$1"
  local response
  response=$(mailcow_api GET "/api/v1/get/domain/all" 2>/dev/null || echo "[]")
  local found
  found=$(echo "$response" | jq --arg d "$domain" '[.[] | select(.domain == $d)] | length' 2>/dev/null || echo "0")
  [[ "$found" -gt 0 ]]
}

# ── Configure a single domain ────────────────────────────────

setup_domain() {
  local domain="$1"
  local root
  root=$(get_root_domain "$domain")

  echo -n "  $domain ... "

  # Get Cloudflare zone ID
  local zone_id
  zone_id=$(get_zone_id "$domain")
  if [[ -z "$zone_id" ]]; then
    echo "NO_ZONE (root: $root not found in Cloudflare)"
    ((DOMAINS_NO_ZONE++)) || true
    return
  fi

  local dns_ok=true
  local mc_ok=true

  # Add DNS records
  add_dns_record "$zone_id" "A"   "mail.${root}" "$MAIL_IP"          || dns_ok=false
  add_dns_record "$zone_id" "MX"  "$root"         "$MAIL_MX"  10     || dns_ok=false
  add_dns_record "$zone_id" "TXT" "$root"         "v=spf1 mx a:${MAIL_MX} ~all" || dns_ok=false

  # Add to Mailcow
  if mailcow_domain_exists "$root"; then
    : # already exists, dns_ok drives the status
  else
    local body
    body=$(jq -n --arg d "$root" '{domain:$d, description:"Auto-added by mailcow-setup",active:1}')
    mailcow_api POST "/api/v1/add/domain" -d "$body" >/dev/null 2>&1 || mc_ok=false
  fi

  if $dns_ok && $mc_ok; then
    echo "ADDED"
    ((DOMAINS_ADDED++)) || true
  elif ! $dns_ok; then
    echo "ERROR (DNS)"
    ((DOMAINS_ERROR++)) || true
  else
    echo "ERROR (Mailcow)"
    ((DOMAINS_ERROR++)) || true
  fi
}

# ── Main ──────────────────────────────────────────────────────

echo ""
echo "════════════════════════════════════════════════════════"
echo "  Mailcow Domain Discovery + Setup"
[[ -n "$SCOPE_ORG" ]] && echo "  Scoped to: ${SCOPE_ORG}/${SCOPE_REPO:-all}"
echo "════════════════════════════════════════════════════════"
echo ""

declare -A seen_domains  # track already-processed domains

process_repo() {
  local org="$1"
  local repo="$2"
  echo "→ Scanning ${org}/${repo}"
  local domains
  domains=$(scan_repo "$org" "$repo")
  while IFS= read -r domain; do
    [[ -z "$domain" ]] && continue
    [[ -n "${seen_domains[$domain]+_}" ]] && continue
    seen_domains["$domain"]=1
    ((DOMAINS_FOUND++)) || true
    setup_domain "$domain"
  done <<< "$domains"
}

if [[ -n "$SCOPE_ORG" && -n "$SCOPE_REPO" ]]; then
  # Webhook mode: single repo
  process_repo "$SCOPE_ORG" "$SCOPE_REPO"
elif [[ -n "$SCOPE_ORG" ]]; then
  # Single org mode
  while IFS= read -r repo; do
    process_repo "$SCOPE_ORG" "$repo"
  done < <(list_repos "$SCOPE_ORG")
else
  # Full scan: all three orgs
  for org in "${ORGS[@]}"; do
    echo ""
    echo "── Org: $org ──"
    while IFS= read -r repo; do
      process_repo "$org" "$repo"
    done < <(list_repos "$org")
  done
fi

# ── Summary ───────────────────────────────────────────────────

echo ""
echo "════════════════════════════════════════════════════════"
echo "  Summary"
echo "────────────────────────────────────────────────────────"
echo "  Domains found:    $DOMAINS_FOUND"
echo "  Domains added:    $DOMAINS_ADDED"
echo "  Domains skipped:  $DOMAINS_SKIPPED"
echo "  No CF zone:       $DOMAINS_NO_ZONE"
echo "  Errors:           $DOMAINS_ERROR"
echo "════════════════════════════════════════════════════════"
echo ""

[[ "$DOMAINS_ERROR" -gt 0 ]] && exit 1 || exit 0
