#!/usr/bin/env bash
# ============================================================
# run-gate.sh — Agyeman Enterprises Universal Release Gate
# Blocks terminal. Sends results to alrtme. Polls for approval.
# Only releases control when Akua taps APPROVE on her phone.
# Any other response = hard stop with her instructions shown.
# ============================================================

set -uo pipefail

ALRTME_API_KEY="${ALRTME_API_KEY:-d13e8dec-cf04-4e79-a046-711990271acd}"
ALRTME_URL="https://alrtme.co"
GATE_CERT_FILE=".claude/GATE_CERT.json"   # signed artifact — written by server, verified by CI
PLAN_APPROVED_FILE=".claude/PLAN_APPROVED"
APP_NAME=$(basename "$PWD")
TIMESTAMP=$(date +%s)
GATE2_PID=""
OVERALL="PASS"
RESULTS=""
PORT=3000

# ── Git context (bound into the signed cert) ────────────────
GIT_SHA=$(git rev-parse HEAD 2>/dev/null || echo "unknown")
GIT_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
GIT_REMOTE=$(git remote get-url origin 2>/dev/null || echo "unknown")
# Normalise remote → "owner/repo" (handles https and ssh remotes)
GIT_REPO=$(echo "$GIT_REMOTE" | sed -E 's|.*[:/]([^/]+/[^/]+?)(\.git)?$|\1|')
GATE_TYPE="${GATE_TYPE:-RELEASE}"

# ── Colors ──────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

# ── Helpers ─────────────────────────────────────────────────
log()  { echo -e "$1"; }
pass() { log "${GREEN}  [PASS]${NC} $1"; RESULTS+="✅ $1\n"; }
fail() { log "${RED}  [FAIL]${NC} $1"; RESULTS+="❌ $1\n"; OVERALL="FAIL"; }
warn() { log "${YELLOW}  [WARN]${NC} $1"; RESULTS+="⚠️  $1\n"; }
header() { log "\n${CYAN}▶ $1${NC}"; }

# ── Cleanup ─────────────────────────────────────────────────
cleanup() {
  if [ -n "$GATE2_PID" ]; then
    kill "$GATE2_PID" 2>/dev/null || true
    GATE2_PID=""
  fi
}
trap cleanup EXIT

mkdir -p .claude

# ============================================================
# PREFLIGHT CHECKS — hard stops before any gate runs
# ============================================================

log "\n${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
log "${CYAN}  RELEASE GATE — ${APP_NAME}${NC}"
log "${CYAN}  $(date)${NC}"
log "${CYAN}  Repo:   ${GIT_REPO}${NC}"
log "${CYAN}  Branch: ${GIT_BRANCH}${NC}"
log "${CYAN}  SHA:    ${GIT_SHA:0:12}${NC}"
log "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

# 1. PLAN_APPROVED must exist
if [ ! -f "$PLAN_APPROVED_FILE" ]; then
  log "${RED}⛔ HARD STOP: .claude/PLAN_APPROVED does not exist.${NC}"
  log "   You must get Akua's approval on PLAN.md before running gates."
  log "   Workflow: write PLAN.md → show Akua → wait for 'go' → echo \"approved \$(date)\" > .claude/PLAN_APPROVED"
  exit 1
fi

# 2. GATE7.txt must exist
if [ ! -f "GATE7.txt" ]; then
  log "${RED}⛔ HARD STOP: GATE7.txt does not exist in this repo.${NC}"
  log "   This repo has no behavioral test spec."
  log "   Copy scripts/GATE7.template.txt to GATE7.txt and fill it in for this app."
  log "   Then write Playwright specs in e2e/specs/ covering every section."
  exit 1
fi

# 3. Playwright must be configured
PW_CONFIG=""
if [ -f "playwright.config.ts" ]; then
  PW_CONFIG="playwright.config.ts"
elif [ -f "e2e/playwright.config.ts" ]; then
  PW_CONFIG="e2e/playwright.config.ts"
else
  log "${RED}⛔ HARD STOP: No Playwright configuration found.${NC}"
  log "   playwright.config.ts is required at repo root or e2e/ directory."
  log "   Template: scripts/playwright-template/playwright.config.ts"
  log "   Run: npm install -D @playwright/test && npx playwright install"
  exit 1
fi

# 4. All required spec files must exist
REQUIRED_SPECS=(
  "00.smoke.spec.ts"
  "01.auth.spec.ts"
  "02.crud.spec.ts"
  "03.persistence.spec.ts"
  "04.navigation.spec.ts"
  "05.behavioral.spec.ts"
)
SPEC_DIR="e2e/specs"
[ ! -d "$SPEC_DIR" ] && SPEC_DIR="e2e"

MISSING_SPECS=()
for spec in "${REQUIRED_SPECS[@]}"; do
  if [ ! -f "$SPEC_DIR/$spec" ]; then
    MISSING_SPECS+=("$spec")
  fi
done

if [ ${#MISSING_SPECS[@]} -gt 0 ]; then
  log "${RED}⛔ HARD STOP: Missing required Playwright spec files:${NC}"
  for s in "${MISSING_SPECS[@]}"; do
    log "   - $SPEC_DIR/$s"
  done
  log "   Write these specs covering GATE7.txt before proceeding."
  exit 1
fi

# 5. Spec files must contain real tests — not placeholders
PLACEHOLDER_PATTERNS=(
  "NOT IMPLEMENTED"
  "throw new Error.*NOT IMPLEMENTED"
  "TODO(gate7):"
  "Claude Code must fill"
  "fill in from GATE7"
  "\[Claude Code"
  "\[APP_NAME\]"
  "coming soon"
  "PLACEHOLDER"
)

PLACEHOLDER_FILES=()
for spec in "${REQUIRED_SPECS[@]}"; do
  SPEC_FILE="$SPEC_DIR/$spec"
  [ ! -f "$SPEC_FILE" ] && continue
  for pattern in "${PLACEHOLDER_PATTERNS[@]}"; do
    if grep -qiE "$pattern" "$SPEC_FILE" 2>/dev/null; then
      PLACEHOLDER_FILES+=("$SPEC_FILE (pattern: $pattern)")
      break
    fi
  done
done

if [ ${#PLACEHOLDER_FILES[@]} -gt 0 ]; then
  log "${RED}⛔ HARD STOP: Spec files contain placeholder/stub code:${NC}"
  for f in "${PLACEHOLDER_FILES[@]}"; do
    log "   - $f"
  done
  log ""
  log "   These are not real tests. The gate cannot run against fake specs."
  log "   Read the actual app code. Write tests against real routes,"
  log "   real entity names, real selectors, real flows."
  log "   Existence of a file is not a test. A throw statement is not a test."
  exit 1
fi

# 6. GATE7.txt must not be a blank template
GATE7_PLACEHOLDERS=(
  "\[APP_NAME\]"
  "\[One sentence"
  "\[The single most"
  "Claude Code must fill"
  "\[PORT\]"
)
for pattern in "${GATE7_PLACEHOLDERS[@]}"; do
  if grep -qE "$pattern" "GATE7.txt" 2>/dev/null; then
    log "${RED}⛔ HARD STOP: GATE7.txt is still the blank template — it has not been filled in.${NC}"
    log "   Replace every [placeholder] with the real behavior of THIS app."
    log "   Real routes, real entities, real critical flow. No brackets."
    exit 1
  fi
done

# ============================================================
# CREDENTIAL DISCOVERY — Auto-finds test credentials
# NO BYPASS PERMITTED — if credentials exist, they WILL be used
# ============================================================

header "Credential Discovery"

CREDS_FILE=""

SEARCH_PATHS=(
  "C:/Users/Admin/.claude/credentials.md"
  "/c/Users/Admin/.claude/credentials.md"
  "$HOME/.claude/credentials.md"
  ".env.local"
  ".env.test"
  ".env"
)

for cpath in "${SEARCH_PATHS[@]}"; do
  if [ -f "$cpath" ]; then
    CREDS_FILE="$cpath"
    log "  ${GREEN}Found credentials at:${NC} $cpath"
    break
  fi
done

APP_LOWER=$(echo "$APP_NAME" | tr '[:upper:]' '[:lower:]')

if [ -n "$CREDS_FILE" ]; then
  # Extract Supabase credentials scoped to this app
  SUPA_URL=$(grep -A30 -i "$APP_LOWER" "$CREDS_FILE" 2>/dev/null \
    | grep -iE "supabase.*url|NEXT_PUBLIC_SUPABASE_URL" | head -1 \
    | sed 's/.*[=:] *//' | tr -d '"' | xargs 2>/dev/null || true)
  SUPA_KEY=$(grep -A30 -i "$APP_LOWER" "$CREDS_FILE" 2>/dev/null \
    | grep -iE "anon.*key|SUPABASE_ANON_KEY|NEXT_PUBLIC_SUPABASE_ANON_KEY" | head -1 \
    | sed 's/.*[=:] *//' | tr -d '"' | xargs 2>/dev/null || true)

  # Fall back to global test user defined in credentials.md
  TEST_EMAIL=$(grep -iE "test.*email|imatesta" "$CREDS_FILE" 2>/dev/null \
    | head -1 | sed 's/.*[=:] *//' | tr -d '"' | xargs 2>/dev/null || echo "imatesta@gmail.com")
  TEST_PASS=$(grep -iE "test.*password|testpass" "$CREDS_FILE" 2>/dev/null \
    | head -1 | sed 's/.*[=:] *//' | tr -d '"' | xargs 2>/dev/null || echo "TestPass123!")
fi

# Always pull from repo's .env.local if it exists (overrides/supplements credentials.md)
if [ -f ".env.local" ]; then
  ENV_SUPA_URL=$(grep "NEXT_PUBLIC_SUPABASE_URL" .env.local 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | xargs 2>/dev/null || true)
  ENV_SUPA_KEY=$(grep "NEXT_PUBLIC_SUPABASE_ANON_KEY" .env.local 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | xargs 2>/dev/null || true)
  ENV_BASE_URL=$(grep "^NEXT_PUBLIC_APP_URL\|^BASE_URL\|^APP_URL" .env.local 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | xargs 2>/dev/null || true)
  [ -n "$ENV_SUPA_URL" ] && SUPA_URL="$ENV_SUPA_URL"
  [ -n "$ENV_SUPA_KEY" ] && SUPA_KEY="$ENV_SUPA_KEY"
fi

# Windows Sticky Notes (credential hints stored there)
STICKY_DB="C:/Users/Admin/AppData/Local/Packages/Microsoft.MicrosoftStickyNotes_8wekyb3d8bbwe/LocalState/plum.sqlite"
if [ -f "$STICKY_DB" ] && command -v sqlite3 &>/dev/null; then
  STICKY_CREDS=$(sqlite3 "$STICKY_DB" \
    "SELECT Text FROM Note;" 2>/dev/null \
    | grep -iE "password|supabase|anon.*key|service.*key" | head -5 || true)
  if [ -n "$STICKY_CREDS" ]; then
    log "  ${YELLOW}Sticky Notes contain credential hints. Checking for $APP_LOWER...${NC}"
    STICKY_KEY=$(echo "$STICKY_CREDS" | grep -i "$APP_LOWER" | grep -iE "anon|key" | head -1 \
      | sed 's/.*[=:] *//' | tr -d '"' | xargs 2>/dev/null || true)
    [ -n "$STICKY_KEY" ] && SUPA_KEY="$STICKY_KEY"
  fi
fi

# Export everything for Playwright
[ -n "${SUPA_URL:-}" ]    && export NEXT_PUBLIC_SUPABASE_URL="$SUPA_URL"   && export SUPABASE_URL="$SUPA_URL"
[ -n "${SUPA_KEY:-}" ]    && export NEXT_PUBLIC_SUPABASE_ANON_KEY="$SUPA_KEY" && export SUPABASE_ANON_KEY="$SUPA_KEY"
[ -n "${TEST_EMAIL:-}" ]  && export TEST_EMAIL="$TEST_EMAIL"
[ -n "${TEST_PASS:-}" ]   && export TEST_PASSWORD="$TEST_PASS"
[ -n "${ENV_BASE_URL:-}" ] && export BASE_URL="$ENV_BASE_URL"

if [ -n "${SUPA_URL:-}" ]; then
  pass "Credential Discovery — Supabase URL loaded (${SUPA_URL:0:40}...)"
else
  warn "Credential Discovery — no Supabase URL found. Tests that require DB access may fail."
fi
if [ -n "${TEST_EMAIL:-}" ]; then
  pass "Credential Discovery — test user: ${TEST_EMAIL}"
else
  warn "Credential Discovery — no test user email found. Auth tests will use spec defaults."
fi

# ============================================================
# GATE 1: CODE INTEGRITY
# ============================================================

header "GATE 1: Code Integrity"

TSC_OUT=$(npx tsc --noEmit 2>&1)
TSC_EXIT=$?
if [ $TSC_EXIT -eq 0 ]; then
  pass "Gate 1a — tsc --noEmit: 0 errors"
else
  fail "Gate 1a — tsc errors found"
  log "${RED}$(echo "$TSC_OUT" | head -20)${NC}"
fi

# Ensure .eslintignore exists so --ignore-path doesn't error
if [ ! -f ".eslintignore" ]; then
  cat > .eslintignore << 'ESLINTIGNORE'
.next/
node_modules/
dist/
out/
public/
ESLINTIGNORE
  log "  ${YELLOW}[auto-created] .eslintignore with default exclusions${NC}"
fi

ESLINT_OUT=$(npx eslint . --ext .ts,.tsx,.js,.jsx --ignore-path .eslintignore --max-warnings=0 2>&1)
ESLINT_EXIT=$?
if [ $ESLINT_EXIT -eq 0 ]; then
  pass "Gate 1b — eslint: 0 errors, 0 warnings"
else
  fail "Gate 1b — eslint errors found"
  log "${RED}$(echo "$ESLINT_OUT" | head -20)${NC}"
fi

AUDIT_OUT=$(npm audit --audit-level=high 2>&1)
AUDIT_EXIT=$?
if [ $AUDIT_EXIT -eq 0 ]; then
  pass "Gate 1c — npm audit: 0 high/critical vulnerabilities"
else
  fail "Gate 1c — npm audit: high/critical vulnerabilities found"
  log "${RED}$(echo "$AUDIT_OUT" | head -10)${NC}"
fi

if command -v semgrep &>/dev/null; then
  SEMGREP_OUT=$(semgrep --config=auto src/ --error 2>&1)
  SEMGREP_EXIT=$?
  if [ $SEMGREP_EXIT -eq 0 ]; then
    pass "Gate 1d — semgrep: 0 high/critical findings"
  else
    fail "Gate 1d — semgrep: high/critical findings"
    log "${RED}$(echo "$SEMGREP_OUT" | head -20)${NC}"
  fi
else
  warn "Gate 1d — semgrep not installed (run: pip install semgrep)"
fi

# ============================================================
# GATE 2: APP LOADS
# ============================================================

header "GATE 2: App Loads"

# Detect port from port_manager or package.json or default
if [ -f "port_manager.py" ]; then
  PORT=$(node port_manager.py 2>/dev/null || python port_manager.py 2>/dev/null || echo 3000)
elif grep -q '"PORT"' .env.local 2>/dev/null; then
  PORT=$(grep '"PORT"' .env.local | head -1 | tr -d '"' | awk -F'=' '{print $2}' | tr -d ' ')
fi
PORT=${PORT:-3000}

# Detect start command
if grep -q '"dev"' package.json 2>/dev/null; then
  START_CMD="npm run dev"
elif grep -q '"start"' package.json 2>/dev/null; then
  START_CMD="npm start"
else
  fail "Gate 2 — cannot detect start command in package.json"
  START_CMD=""
fi

if [ -n "$START_CMD" ]; then
  log "  Starting app on port $PORT..."
  $START_CMD > /tmp/app-gate-output.log 2>&1 &
  GATE2_PID=$!

  MAX_WAIT=90
  COUNT=0
  APP_STARTED=0
  until curl -sf "http://localhost:$PORT" > /dev/null 2>&1; do
    sleep 2
    COUNT=$((COUNT + 2))
    if ! kill -0 "$GATE2_PID" 2>/dev/null; then
      fail "Gate 2a — app process crashed on startup"
      log "${RED}Last log output:${NC}"
      tail -20 /tmp/app-gate-output.log | while read -r line; do log "  $line"; done
      APP_STARTED=0
      break
    fi
    if [ $COUNT -ge $MAX_WAIT ]; then
      fail "Gate 2a — app did not respond within ${MAX_WAIT}s on port $PORT"
      APP_STARTED=0
      break
    fi
    APP_STARTED=1
  done

  if curl -sf "http://localhost:$PORT" > /dev/null 2>&1; then
    APP_STARTED=1
    pass "Gate 2a — app starts and responds on port $PORT"

    # Check page title is not default
    TITLE=$(curl -s "http://localhost:$PORT" | grep -o '<title>[^<]*</title>' | sed 's/<title>//;s/<\/title>//' | head -1)
    if [[ "$TITLE" == "React App" ]] || [[ "$TITLE" == "Next.js" ]] || [[ "$TITLE" == "Vite App" ]] || [[ -z "$TITLE" ]]; then
      fail "Gate 2b — page title is default or missing: '${TITLE}'"
    else
      pass "Gate 2b — page title: '${TITLE}'"
    fi

    # Check for JS console errors via Playwright smoke
    CONSOLE_CHECK=$(npx playwright test "$SPEC_DIR/00.smoke.spec.ts" --config="$PW_CONFIG" 2>&1)
    if echo "$CONSOLE_CHECK" | grep -q "passed"; then
      pass "Gate 2c — 0 console errors on load (smoke test)"
    else
      fail "Gate 2c — console errors detected on load"
      log "${RED}$(echo "$CONSOLE_CHECK" | tail -10)${NC}"
    fi
  fi
fi

# ============================================================
# GATES 3–8: PLAYWRIGHT E2E
# ============================================================

header "GATES 3–8: Playwright E2E"

declare -A GATE_MAP=(
  ["01.auth"]="Gate 3 (Auth Flow)"
  ["02.crud"]="Gate 4 (CRUD)"
  ["03.persistence"]="Gate 5/6 (Navigation + Data Integrity)"
  ["04.navigation"]="Gate 5 (Navigation)"
  ["05.behavioral"]="Gate 7/8 (Behavioral — GATE7.txt)"
)

NOT_IMPLEMENTED_SPECS=()

for spec_prefix in "01.auth" "02.crud" "03.persistence" "04.navigation" "05.behavioral"; do
  GATE_LABEL="${GATE_MAP[$spec_prefix]}"
  SPEC_FILE="$SPEC_DIR/${spec_prefix}.spec.ts"

  log "  Running ${spec_prefix}.spec.ts..."
  SPEC_OUT=$(npx playwright test "$SPEC_FILE" --config="$PW_CONFIG" --reporter=list 2>&1)
  SPEC_EXIT=$?

  # ── HARD STOP: detect unimplemented stubs in output ──────────
  if echo "$SPEC_OUT" | grep -qiE "NOT IMPLEMENTED|GATE7 SECTION|NOT A PRODUCT TEST|TODO\(gate|fill in from gate|Claude Code must fill|throw.*Error.*GATE"; then
    log ""
    log "${RED}╔══════════════════════════════════════════════════════════╗${NC}"
    log "${RED}║  ⛔  THIS IS NOT A PRODUCT TEST — MANDATE: GO BACK       ║${NC}"
    log "${RED}╠══════════════════════════════════════════════════════════╣${NC}"
    log "${RED}║  Spec: ${spec_prefix}.spec.ts                            ${NC}"
    log "${RED}║                                                          ║${NC}"
    log "${RED}║  What you MUST do before running this gate again:        ║${NC}"
    log "${RED}║  1. Read the actual app source code in src/              ║${NC}"
    log "${RED}║  2. Identify real routes, real entity names, real UX     ║${NC}"
    log "${RED}║  3. Write tests against real selectors from the live app ║${NC}"
    log "${RED}║  4. Tests must CREATE real data, VERIFY persistence,     ║${NC}"
    log "${RED}║     and ASSERT exact visible text                        ║${NC}"
    log "${RED}║  5. Remove every throw, every TODO, every placeholder    ║${NC}"
    log "${RED}║                                                          ║${NC}"
    log "${RED}║  'tsc passed' is NOT a product test.                     ║${NC}"
    log "${RED}║  'build succeeded' is NOT a product test.                ║${NC}"
    log "${RED}║  A throw statement is NOT a test.                        ║${NC}"
    log "${RED}║  Only the full end-to-end browser flow counts.           ║${NC}"
    log "${RED}╚══════════════════════════════════════════════════════════╝${NC}"
    log ""
    OVERALL="FAIL"
    NOT_IMPLEMENTED_SPECS+=("$spec_prefix")
    continue
  fi

  if [ $SPEC_EXIT -eq 0 ]; then
    PASSED=$(echo "$SPEC_OUT" | grep -oE '[0-9]+ passed' | head -1)
    pass "$GATE_LABEL — $PASSED"
  else
    FAILED=$(echo "$SPEC_OUT" | grep -oE '[0-9]+ failed' | head -1)
    fail "$GATE_LABEL — $FAILED"
    echo "$SPEC_OUT" | grep -A3 "●" | head -30 | while read -r line; do
      log "${RED}    $line${NC}"
    done
  fi
done

# If ANY spec was unimplemented — hard exit before anything else
if [ ${#NOT_IMPLEMENTED_SPECS[@]} -gt 0 ]; then
  log ""
  log "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  log "${RED}  ⛔ HARD STOP: ${#NOT_IMPLEMENTED_SPECS[@]} spec file(s) are NOT real product tests:${NC}"
  for s in "${NOT_IMPLEMENTED_SPECS[@]}"; do
    log "${RED}     - $s.spec.ts${NC}"
  done
  log "${RED}  Gate cannot pass until every spec tests the LIVE running app.${NC}"
  log "${RED}  Go back. Read the source. Write real tests.${NC}"
  log "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  exit 1
fi

# Full suite summary for Gate 8
log "\n  Running full suite for Gate 8 report..."
FULL_OUT=$(npx playwright test --config="$PW_CONFIG" --reporter=list 2>&1)
FULL_PASS=$(echo "$FULL_OUT" | grep -oE '[0-9]+ passed' | tail -1)
FULL_FAIL=$(echo "$FULL_OUT" | grep -oE '[0-9]+ failed' | tail -1)
FULL_SKIP=$(echo "$FULL_OUT" | grep -oE '[0-9]+ skipped' | tail -1)

if [ -z "$FULL_FAIL" ]; then
  pass "Gate 8 — Playwright suite: ${FULL_PASS:-0 passed}, ${FULL_SKIP:-0 skipped}"
else
  fail "Gate 8 — Playwright suite: ${FULL_PASS:-0 passed}, $FULL_FAIL, ${FULL_SKIP:-0 skipped}"
fi

# ============================================================
# GATE 9: MARKET FITNESS
# ============================================================

header "GATE 9: Market Fitness"

BASE_URL="http://localhost:$PORT"

# Favicon — must exist and must not be the default Next.js icon
FAVICON_HTTP=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/favicon.ico")
if [ "$FAVICON_HTTP" = "200" ]; then
  FAVICON_SIZE=$(curl -s "$BASE_URL/favicon.ico" | wc -c | tr -d ' ')
  # Default Next.js favicon is exactly 25931 bytes
  if [ "$FAVICON_SIZE" -eq 25931 ]; then
    fail "Gate 9a — favicon is the default Next.js icon — replace it with a custom one"
  else
    pass "Gate 9a — custom favicon present (${FAVICON_SIZE} bytes)"
  fi
else
  fail "Gate 9a — favicon.ico not found (HTTP $FAVICON_HTTP)"
fi

# OG meta tags
HTML=$(curl -s "$BASE_URL")
if echo "$HTML" | grep -q 'property="og:title"'; then
  pass "Gate 9b — og:title meta tag present"
else
  fail "Gate 9b — og:title meta tag missing"
fi

if echo "$HTML" | grep -q 'property="og:description"'; then
  pass "Gate 9c — og:description meta tag present"
else
  fail "Gate 9c — og:description meta tag missing"
fi

# Lighthouse
if command -v lighthouse &>/dev/null; then
  log "  Running Lighthouse..."
  LH_JSON=$(lighthouse "$BASE_URL" --output=json --quiet --chrome-flags="--headless" 2>/dev/null)
  PERF=$(echo "$LH_JSON" | node -e "const c=[]; process.stdin.on('data',x=>c.push(x)); process.stdin.on('end',()=>{try{const d=JSON.parse(c.join(''));process.stdout.write(String(Math.round(d.categories.performance.score*100)));}catch(e){process.stdout.write('0');}});" 2>/dev/null || echo "0")
  A11Y=$(echo "$LH_JSON" | node -e "const c=[]; process.stdin.on('data',x=>c.push(x)); process.stdin.on('end',()=>{try{const d=JSON.parse(c.join(''));process.stdout.write(String(Math.round(d.categories.accessibility.score*100)));}catch(e){process.stdout.write('0');}});" 2>/dev/null || echo "0")

  if [ "$PERF" -ge 70 ]; then
    pass "Gate 9d — Lighthouse performance: ${PERF}/100"
  else
    fail "Gate 9d — Lighthouse performance: ${PERF}/100 (minimum 70)"
  fi

  if [ "$A11Y" -ge 80 ]; then
    pass "Gate 9e — Lighthouse accessibility: ${A11Y}/100"
  else
    fail "Gate 9e — Lighthouse accessibility: ${A11Y}/100 (minimum 80)"
  fi
else
  warn "Gate 9d/e — Lighthouse not installed (npm install -g lighthouse)"
fi

# Mobile responsive — Playwright viewport test
MOBILE_OUT=$(npx playwright test "$SPEC_DIR/04.navigation.spec.ts" --config="$PW_CONFIG" --grep="mobile" 2>&1 || true)
if echo "$MOBILE_OUT" | grep -qE "passed|0 failed"; then
  pass "Gate 9f — mobile responsive at 375px"
else
  fail "Gate 9f — mobile test failed or no mobile test found in 04.navigation.spec.ts"
fi

# ============================================================
# KILL APP PROCESS
# ============================================================

if [ -n "$GATE2_PID" ]; then
  kill "$GATE2_PID" 2>/dev/null || true
  GATE2_PID=""
fi

# ============================================================
# COMPILE FULL REPORT
# ============================================================

log "\n${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
log "${CYAN}  RELEASE GATE REPORT — ${APP_NAME}${NC}"
log "${CYAN}  $(date)${NC}"
log "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "$RESULTS"

if [ "$OVERALL" = "PASS" ]; then
  log "${GREEN}  VERDICT: ALL GATES PASS — Awaiting Akua's final approval${NC}"
else
  log "${RED}  VERDICT: GATE FAILURES — Fix before proceeding${NC}"
fi
log "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

# ============================================================
# ALRTME NOTIFICATION — two-way push → Approve / Reject
# ============================================================

RESULTS_ESCAPED=$(echo -e "$RESULTS" | head -60)

RESULTS_JSON=$(echo -e "$RESULTS_ESCAPED" | node -e "
const chunks = []; process.stdin.on('data', c => chunks.push(c));
process.stdin.on('end', () => { process.stdout.write(JSON.stringify(chunks.join(''))); });
" 2>/dev/null || echo '""')

GATE_RESP=$(curl -s -X POST "${ALRTME_URL}/api/gate-request" \
  -H "Content-Type: application/json" \
  -d "{
    \"api_key\": \"${ALRTME_API_KEY}\",
    \"app_name\": \"${APP_NAME}\",
    \"verdict\": \"${OVERALL}\",
    \"results\": ${RESULTS_JSON},
    \"repo\": \"${GIT_REPO}\",
    \"branch\": \"${GIT_BRANCH}\",
    \"sha\": \"${GIT_SHA}\",
    \"gate_type\": \"${GATE_TYPE}\"
  }" 2>/dev/null || echo '{}')

GATE_TOKEN=$(echo "$GATE_RESP" | node -e "
const chunks = []; process.stdin.on('data', c => chunks.push(c));
process.stdin.on('end', () => {
  try {
    const d = JSON.parse(chunks.join(''));
    process.stdout.write(d.token || '');
  } catch(e) {}
});
" 2>/dev/null || true)

if [ -z "$GATE_TOKEN" ]; then
  log "${RED}⚠️  alrtme notification failed (no token returned). Response: ${GATE_RESP}${NC}"
  log "${YELLOW}   Falling back — enter APPROVE manually to continue:${NC}"
  read -r MANUAL_RESPONSE
  GATE_TOKEN="manual"
fi

log "📱 Push notification sent via alrtme"
log "⏳ TERMINAL BLOCKED — Tap Approve or Reject on your phone...\n"
log "   Token: ${CYAN}${GATE_TOKEN}${NC}"
log "   Poll: ${ALRTME_URL}/api/respond/${GATE_TOKEN}\n"

# ============================================================
# POLL FOR RESPONSE — BLOCKS UNTIL AKUA TAPS APPROVE/REJECT
# ============================================================

RESPONSE=""

if [ "$GATE_TOKEN" = "manual" ]; then
  RESPONSE="${MANUAL_RESPONSE}"
else
  POLL_START=$(date +%s)
  while true; do
    sleep 5

    POLL_RESP=$(curl -s "${ALRTME_URL}/api/respond/${GATE_TOKEN}" 2>/dev/null || echo '{}')

    # Check for expiry
    EXPIRED=$(echo "$POLL_RESP" | node -e "
const chunks = []; process.stdin.on('data', c => chunks.push(c));
process.stdin.on('end', () => {
  try { const d = JSON.parse(chunks.join('')); process.stdout.write(d.expired ? 'true' : ''); } catch(e) {}
});
" 2>/dev/null || true)

    if [ "$EXPIRED" = "true" ]; then
      log "${RED}⏰ Gate token expired (2-hour window). Re-run gates to send a fresh notification.${NC}"
      exit 1
    fi

    RESPONSE=$(echo "$POLL_RESP" | node -e "
const chunks = []; process.stdin.on('data', c => chunks.push(c));
process.stdin.on('end', () => {
  try {
    const d = JSON.parse(chunks.join(''));
    process.stdout.write(d.response || '');
  } catch(e) {}
});
" 2>/dev/null || true)

    if [ -n "$RESPONSE" ]; then
      break
    fi

    # Progress indicator every 60s
    ELAPSED=$(( $(date +%s) - POLL_START ))
    if [ $((ELAPSED % 60)) -lt 5 ] && [ $ELAPSED -gt 10 ]; then
      log "  Still waiting... (${ELAPSED}s elapsed). Check alrtme notification on your phone."
    fi
  done
fi

log "\n📨 Response received from Akua:\n"
log "  \"${RESPONSE}\"\n"

# ============================================================
# PROCESS RESPONSE
# ============================================================

# alrtme returns exact lowercase "approve" or "reject" — manual fallback is still normalized
RESPONSE_NORMALIZED=$(echo "$RESPONSE" | tr '[:upper:]' '[:lower:]' | xargs)

if [ "$RESPONSE_NORMALIZED" = "approve" ]; then
  log "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  log "${GREEN}  ✅ APPROVED — Issuing signed gate certificate...${NC}"
  log "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

  # Request signed cert from alrtme — only the server can produce a valid sig
  CERT_RESP=$(curl -s -X POST "${ALRTME_URL}/api/gate-certify" \
    -H "Content-Type: application/json" \
    -d "{\"token\": \"${GATE_TOKEN}\"}" 2>/dev/null || echo '{}')

  CERT_ERROR=$(echo "$CERT_RESP" | node -e "
const c=[]; process.stdin.on('data',d=>c.push(d));
process.stdin.on('end',()=>{try{const d=JSON.parse(c.join(''));process.stdout.write(d.error||'');}catch(e){}});
" 2>/dev/null || true)

  if [ -n "$CERT_ERROR" ]; then
    log "${RED}⛔ Gate cert issuance failed: ${CERT_ERROR}${NC}"
    log "   The approval was received but the cert could not be issued."
    log "   Contact support or re-run gates."
    exit 1
  fi

  CERT_JSON=$(echo "$CERT_RESP" | node -e "
const c=[]; process.stdin.on('data',d=>c.push(d));
process.stdin.on('end',()=>{
  try{
    const d=JSON.parse(c.join(''));
    if(d.cert) process.stdout.write(JSON.stringify(d.cert,null,2));
  }catch(e){}
});
" 2>/dev/null || true)

  if [ -z "$CERT_JSON" ]; then
    log "${RED}⛔ Gate cert issuance returned empty cert.${NC}"
    exit 1
  fi

  # Augment cert with machine identity for CI verification
  CERT_JSON=$(echo "$CERT_JSON" | python3 -c "
import json, sys
cert = json.load(sys.stdin)
cert['machine_id'] = '${MACHINE_ID:-unknown}'
cert['machine_public_key_fingerprint'] = '${MACHINE_FINGERPRINT:-}'
cert['enforcement_version'] = '${ENFORCEMENT_VERSION:-0.0.0}'
cert['policy_version'] = '${ENFORCEMENT_VERSION:-0.0.0}'
print(json.dumps(cert, indent=2))
" 2>/dev/null || echo "$CERT_JSON")

  mkdir -p .claude
  echo "$CERT_JSON" > "$GATE_CERT_FILE"

  log "${GREEN}  📜 Signed cert written to ${GATE_CERT_FILE}${NC}"
  log "${GREEN}  Repo:      ${GIT_REPO}${NC}"
  log "${GREEN}  Branch:    ${GIT_BRANCH}${NC}"
  log "${GREEN}  SHA:       ${GIT_SHA:0:12}${NC}"
  log "${GREEN}  Gate type: ${GATE_TYPE}${NC}"
  log ""
  log "${GREEN}  CI will verify this cert before allowing merge.${NC}"
  log "${GREEN}  Proceed to next phase.${NC}\n"
  exit 0

else
  rm -f "$GATE_CERT_FILE"

  log "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  log "${RED}  ⛔ REJECTED — DO NOT PROCEED${NC}"
  log "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
  log "${YELLOW}  Akua rejected this gate via alrtme.${NC}"
  log "  Review the gate failures above. Fix every failing check."
  log "  Then re-run from the beginning: ${CYAN}bash scripts/run-gate.sh${NC}"
  log "  DO NOT write new code until this gate passes.\n"
  exit 1
fi
