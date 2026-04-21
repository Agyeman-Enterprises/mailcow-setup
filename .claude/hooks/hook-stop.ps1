# hook-stop.ps1
# GATE 3 — FIRES: When Claude tries to stop / declare done
# RULE: Claude CANNOT EXIT until OO_COMPLETE.json exists and is valid.
#       If deliverables are missing or OO rejected completion — Claude stays running.
# EXIT 2 on Stop = Claude is FORCED TO KEEP WORKING.
# ─────────────────────────────────────────────────────────────────────────────

$RepoRoot     = git rev-parse --show-toplevel 2>$null
$PlanPath     = Join-Path $RepoRoot "PLAN.md"
$ApprovalPath = Join-Path $RepoRoot ".claude\OO_APPROVED.json"
$CompletePath = Join-Path $RepoRoot ".claude\OO_COMPLETE.json"

# ── If no plan was ever approved, don't trap (session may be pre-plan) ────────
if (-not (Test-Path $ApprovalPath)) { exit 0 }

# ── OO_COMPLETE.json must exist ───────────────────────────────────────────────
if (-not (Test-Path $CompletePath)) {
    Write-Error @"
HARD STOP — YOU CANNOT EXIT WITHOUT OO COMPLETION SIGN-OFF

You have not submitted your work for OO completion review.

Before you can stop:
  1. Verify all items in PLAN.md ## MUST DELIVER are done
  2. Run: powershell -ExecutionPolicy Bypass -File .claude\Complete-PlanWithOO.ps1
  3. Wait for OO to issue OO_COMPLETE.json
  4. Only then may you stop

YOU ARE NOT DONE. DO NOT SAY DONE. DO NOT SAY COMPLETE. KEEP WORKING.
"@
    exit 2
}

# ── OO_COMPLETE verdict must be ACCEPTED ─────────────────────────────────────
$completion = Get-Content $CompletePath -Raw | ConvertFrom-Json

if ($completion.verdict -ne "ACCEPTED") {
    Write-Error @"
HARD STOP — OO REJECTED YOUR COMPLETION CLAIM

OO verdict : $($completion.verdict)
Reason     : $($completion.reason)

Issues to fix:
$($completion.issues | ForEach-Object { "  - $_" } | Out-String)

Fix all issues listed above. Then rerun Complete-PlanWithOO.ps1.
YOU ARE NOT DONE.
"@
    exit 2
}

# ── Completion hash must match approved plan ──────────────────────────────────
$approval    = Get-Content $ApprovalPath -Raw | ConvertFrom-Json
$currentHash = (Get-FileHash $PlanPath -Algorithm SHA256).Hash

if ($completion.plan_hash -ne $approval.plan_hash) {
    Write-Error "SCOPE GUARD: Completion was signed against a different plan version. Resubmit completion."
    exit 2
}

# ── All clear — Claude may stop ───────────────────────────────────────────────
exit 0
