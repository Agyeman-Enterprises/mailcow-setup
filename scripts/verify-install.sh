#!/usr/bin/env bash
# ============================================================
# verify-install.sh — Enforcement install quality gate
#
# Runs IMMEDIATELY after files are written, BEFORE git commit.
# If this fails, the install aborts. Nothing bad reaches GitHub.
#
# Usage:
#   bash scripts/verify-install.sh
#   bash scripts/verify-install.sh --strict   (fails on ANY warning)
#
# Returns:
#   0 = all checks pass — safe to commit
#   1 = quality failures found — DO NOT COMMIT
# ============================================================

set -uo pipefail

STRICT=true
[[ "${1:-}" == "--lenient" ]] && STRICT=false
# STRICT is now DEFAULT. Use --lenient to downgrade failures to warnings.
# There is no room for "maybe" in enforcement.

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

APP_NAME=$(basename "$PWD")
FAILURES=0
WARNINGS=0

fail() { echo -e "${RED}  [FAIL]${NC} $1"; ((FAILURES++)) || true; }
warn() { echo -e "${YELLOW}  [WARN]${NC} $1"; ((WARNINGS++)) || true; }
pass() { echo -e "${GREEN}  [OK]  ${NC} $1"; }

echo -e "\n${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${CYAN}  VERIFY-INSTALL — ${APP_NAME}${NC}"
echo -e "${CYAN}  Checking written files before commit...${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

# ============================================================
# CHECK 1: GATE7.txt exists and is not a blank template
# ============================================================

echo -e "${CYAN}▶ GATE7.txt quality${NC}"

if [ ! -f "GATE7.txt" ]; then
  fail "GATE7.txt does not exist — create it before committing"
else
  GATE7_SIZE=$(wc -c < "GATE7.txt" | tr -d ' ')
  if [ "$GATE7_SIZE" -lt 500 ]; then
    fail "GATE7.txt is only ${GATE7_SIZE} bytes — too small to be real content"
  else
    pass "GATE7.txt exists (${GATE7_SIZE} bytes)"
  fi

  # Bracket placeholders — the specific patterns that mean it was NOT filled in
  BRACKET_PATTERNS=(
    '\[APP_NAME\]'
    '\[One sentence'
    '\[The single most'
    '\[List every route'
    '\[Core entity'
    '\[PORT\]'
    '\[Claude Code must'
    '\[PENDING'
    'Claude Code must fill'
    'fill this in'
    '\[route_\|page_\|entity_'
  )

  for pattern in "${BRACKET_PATTERNS[@]}"; do
    if grep -qE "$pattern" "GATE7.txt" 2>/dev/null; then
      fail "GATE7.txt contains placeholder: pattern '$pattern' found"
      fail "  → Read the actual source code. Replace EVERY bracket with real app content."
    fi
  done

  # Must contain at least one real route (starts with / followed by word chars)
  ROUTE_COUNT=$(grep -cE '^\s+\[ \] /' "GATE7.txt" 2>/dev/null || echo "0")
  if [ "$ROUTE_COUNT" -lt 3 ]; then
    fail "GATE7.txt has only $ROUTE_COUNT route checks (minimum 3) — routes must be read from actual source"
  else
    pass "GATE7.txt has $ROUTE_COUNT route checks"
  fi

  # Must have at least 4 sections
  SECTION_COUNT=$(grep -cE '^===|^SECTION [A-Z]' "GATE7.txt" 2>/dev/null || echo "0")
  if [ "$SECTION_COUNT" -lt 4 ]; then
    fail "GATE7.txt has only $SECTION_COUNT sections — minimum 4 required (Navigation, Core Feature, Persistence, Auth)"
  else
    pass "GATE7.txt has $SECTION_COUNT sections"
  fi
fi

# ============================================================
# CHECK 2: All 6 spec files exist
# ============================================================

echo -e "\n${CYAN}▶ Spec file existence${NC}"

REQUIRED_SPECS=(
  "00.smoke.spec.ts"
  "01.auth.spec.ts"
  "02.crud.spec.ts"
  "03.persistence.spec.ts"
  "04.navigation.spec.ts"
  "05.behavioral.spec.ts"
  "06.api-coverage.spec.ts"
)

SPEC_DIR="e2e/specs"
[ ! -d "$SPEC_DIR" ] && SPEC_DIR="e2e"

MISSING_COUNT=0
for spec in "${REQUIRED_SPECS[@]}"; do
  if [ -f "$SPEC_DIR/$spec" ]; then
    pass "$SPEC_DIR/$spec exists"
  else
    fail "$SPEC_DIR/$spec MISSING"
    ((MISSING_COUNT++)) || true
  fi
done

if [ "$MISSING_COUNT" -gt 0 ]; then
  fail "$MISSING_COUNT spec file(s) missing — all 6 must be written before install can commit"
fi

# ============================================================
# CHECK 3: Spec files contain no stubs/placeholders
# ============================================================

echo -e "\n${CYAN}▶ Spec file quality${NC}"

STUB_PATTERNS=(
  'throw new Error'
  'NOT IMPLEMENTED'
  'GATE7 SECTION.*NOT A PRODUCT\|GATE7 SECTION.*TODO\|GATE7 SECTION.*FILL\|GATE7 SECTION.*PENDING'
  'NOT A PRODUCT TEST'
  'TODO(gate'
  'fill in from gate'
  'fill in from GATE'
  '\[APP_NAME\]'
  '\[ENTITY'
  '\[ROUTE'
  'YOUR_'
  'REPLACE_THIS'
  "test\.skip\(true,.*not implemented"
)

for spec in "${REQUIRED_SPECS[@]}"; do
  SPEC_FILE="$SPEC_DIR/$spec"
  [ ! -f "$SPEC_FILE" ] && continue

  SPEC_FAILURES=0
  for pattern in "${STUB_PATTERNS[@]}"; do
    if grep -qiE "$pattern" "$SPEC_FILE" 2>/dev/null; then
      # Exception: 01.auth may legitimately skip if app has no auth
      if [[ "$spec" == "01.auth.spec.ts" ]] && grep -qE "test\.skip\(true.*no auth\|no.*account\|no.*login" "$SPEC_FILE" 2>/dev/null; then
        pass "$spec — auth skipped (app has no auth — confirmed intentional)"
        break
      fi
      fail "$spec contains stub pattern: '$pattern'"
      fail "  → Read the actual UI. Write a real test with real selectors."
      ((SPEC_FAILURES++)) || true
    fi
  done

  # Check the spec has at least 3 real test() blocks
  TEST_COUNT=$(grep -cE "^\s+test\(" "$SPEC_FILE" 2>/dev/null || echo "0")
  if [ "$TEST_COUNT" -lt 3 ] && [[ "$spec" != "01.auth.spec.ts" ]]; then
    fail "$spec has only $TEST_COUNT test() blocks (minimum 3 for a real spec)"
  elif [ "$TEST_COUNT" -ge 3 ]; then
    pass "$spec has $TEST_COUNT test() blocks"
  fi

  # Check spec references real selectors (not just generic framework patterns)
  HAS_REAL_SELECTOR=$(grep -cE "getByText\(.+\)|getByPlaceholder\(.+\)|getByRole\(.+\)|locator\('" "$SPEC_FILE" 2>/dev/null || echo "0")
  if [ "$HAS_REAL_SELECTOR" -lt 2 ] && [[ "$spec" != "01.auth.spec.ts" ]]; then
    fail "$spec has only $HAS_REAL_SELECTOR selector calls — MUST test real UI elements (minimum 2)"
  fi
done

# ============================================================
# CHECK 4: playwright.config.ts exists
# ============================================================

echo -e "\n${CYAN}▶ Playwright config${NC}"

if [ -f "playwright.config.ts" ]; then
  pass "playwright.config.ts exists"
  if grep -q "baseURL\|BASE_URL" "playwright.config.ts" 2>/dev/null; then
    pass "playwright.config.ts has baseURL configured"
  else
    fail "playwright.config.ts missing baseURL — REQUIRED. Tests must know where to point."
  fi
else
  fail "playwright.config.ts missing"
fi

# ============================================================
# CHECK 5: run-gate.sh installed
# ============================================================

echo -e "\n${CYAN}▶ Gate script${NC}"

if [ -f "scripts/run-gate.sh" ]; then
  pass "scripts/run-gate.sh installed"
else
  fail "scripts/run-gate.sh missing"
fi

if [ -f "scripts/hooks/pre-commit" ]; then
  pass "scripts/hooks/pre-commit installed"
else
  fail "scripts/hooks/pre-commit missing"
fi

# ============================================================
# VERDICT
# ============================================================

echo -e "\n${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

if [ "$FAILURES" -gt 0 ]; then
  echo -e "${RED}  ⛔ INSTALL ABORTED — ${FAILURES} failure(s) found${NC}"
  echo -e "${RED}  DO NOT COMMIT. DO NOT PUSH.${NC}"
  echo -e "${RED}  Fix every failure above. Re-run verify-install.sh.${NC}"
  echo -e "${RED}  Only when this script exits 0 may you commit.${NC}"
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
  exit 1
fi

if [ "$WARNINGS" -gt 0 ] && [ "$STRICT" = "true" ]; then
  echo -e "${YELLOW}  ⚠ STRICT MODE — ${WARNINGS} warning(s) treated as failures${NC}"
  echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
  exit 1
fi

echo -e "${GREEN}  ✅ INSTALL VERIFIED — safe to commit (${WARNINGS} warnings)${NC}"
echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"
exit 0
