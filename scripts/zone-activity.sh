#!/usr/bin/env bash
# For each Cloudflare zone, count non-NS/SOA DNS records.
# A zone with A/CNAME/MX records is "active" (points somewhere real).
# Output: CSV rows "zone,records,is_active" — active zones also listed in /tmp/active-zones.txt
set -euo pipefail
: "${CLOUDFLARE_API_TOKEN:?}"

cf_api() {
  curl -sf -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -H "Content-Type: application/json" \
    "https://api.cloudflare.com/client/v4$1"
}

# List all zones with id+name, paginated
list_zones() {
  local page=1
  while true; do
    local resp
    resp=$(cf_api "/zones?per_page=50&page=$page") || break
    local rows
    rows=$(echo "$resp" | python -c "import sys,json; [print(z['id']+','+z['name']) for z in json.load(sys.stdin).get('result',[])]")
    [[ -z "$rows" ]] && break
    echo "$rows"
    local c
    c=$(echo "$rows" | wc -l)
    [[ $c -lt 50 ]] && break
    ((page++))
  done
}

# Count records in a zone that are NOT NS/SOA (defaults)
count_real_records() {
  local zid="$1"
  # Pull up to 200 records, count those not in default set
  cf_api "/zones/${zid}/dns_records?per_page=200" \
    | python -c "import sys,json
d=json.load(sys.stdin)
real=[r for r in d.get('result',[]) if r['type'] not in ('NS','SOA')]
types=sorted(set(r['type'] for r in real))
print(f'{len(real)}|{\",\".join(types)}')"
}

> /tmp/active-zones.txt
> /tmp/parked-zones.txt

zones=$(list_zones)
total=$(echo "$zones" | wc -l)
echo "Checking $total zones..." >&2

idx=0
while IFS=, read -r zid zname; do
  [[ -z "$zid" ]] && continue
  ((idx++)) || true
  result=$(count_real_records "$zid" 2>/dev/null || echo "0|")
  count="${result%%|*}"
  types="${result#*|}"
  if [[ "$count" -gt 0 ]]; then
    printf "[%3d/%3d] %-30s ACTIVE (%s records: %s)\n" "$idx" "$total" "$zname" "$count" "$types" >&2
    echo "$zname" >> /tmp/active-zones.txt
  else
    printf "[%3d/%3d] %-30s parked\n" "$idx" "$total" "$zname" >&2
    echo "$zname" >> /tmp/parked-zones.txt
  fi
done <<< "$zones"

echo "" >&2
echo "─── Summary ───" >&2
echo "Active: $(wc -l < /tmp/active-zones.txt)" >&2
echo "Parked: $(wc -l < /tmp/parked-zones.txt)" >&2
