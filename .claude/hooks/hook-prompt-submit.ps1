# hook-prompt-submit.ps1
# GATE 1 — FIRES: Before Claude processes ANY prompt
# RULE: No PLAN.md + OO approval = session dead. No exceptions.
# ─────────────────────────────────────────────────────────────────────────────

$RepoRoot     = git rev-parse --show-toplevel 2>$null
$PlanPath     = Join-Path $RepoRoot "PLAN.md"
$ApprovalPath = Join-Path $RepoRoot ".claude\OO_APPROVED.json"

# ── GATE A: PLAN.md must exist ────────────────────────────────────────────────
if (-not (Test-Path $PlanPath)) {
    Write-Error @"
HARD STOP — NO PLAN.md

You must write a plan before touching a single file.

CREATE PLAN.md NOW with exactly these sections:
  ## APP: [exact app name]
  ## TASK: [one sentence describing what you are building]
  ## IN SCOPE: [bullet list of exact files/folders you will touch]
  ## OUT OF SCOPE: [bullet list of what you will NOT touch — be explicit]
  ## MUST DELIVER: [checklist with [ ] boxes for each required output]
  ## WHAT I WILL NOT DO: [explicit list of forbidden actions]

Then run: powershell -ExecutionPolicy Bypass -File .claude\Submit-PlanToOO.ps1

YOU WILL NOT PROCEED UNTIL OO APPROVES THIS PLAN.
"@
    exit 2
}

# ── GATE B: OO_APPROVED.json must exist ──────────────────────────────────────
if (-not (Test-Path $ApprovalPath)) {
    Write-Error @"
HARD STOP — PLAN NOT APPROVED BY OO

PLAN.md exists but OO has not reviewed it yet.

Submit for review:
  powershell -ExecutionPolicy Bypass -File .claude\Submit-PlanToOO.ps1

YOU WILL NOT PROCEED UNTIL OO RETURNS AN APPROVED VERDICT.
"@
    exit 2
}

# ── GATE C: Hash must match — plan cannot change after OO approves ────────────
$approval    = Get-Content $ApprovalPath -Raw | ConvertFrom-Json
$currentHash = (Get-FileHash $PlanPath -Algorithm SHA256).Hash

if ($approval.plan_hash -ne $currentHash) {
    Write-Error @"
HARD STOP — PLAN.md CHANGED AFTER OO APPROVAL

Approval hash : $($approval.plan_hash)
Current hash  : $currentHash

The plan was modified after OO approved it. The approval is void.
Resubmit: powershell -ExecutionPolicy Bypass -File .claude\Submit-PlanToOO.ps1
"@
    exit 2
}

# ── GATE D: Verdict must be APPROVED ─────────────────────────────────────────
if ($approval.verdict -ne "APPROVED") {
    Write-Error @"
HARD STOP — OO VERDICT: $($approval.verdict)

Reason from OO: $($approval.reason)

Fix the issues, update PLAN.md, and resubmit.
"@
    exit 2
}

# ── All gates passed — inject approved plan as binding context ────────────────
$planContent = Get-Content $PlanPath -Raw

$context = @"
OO-APPROVED PLAN — YOUR ONLY AUTHORITY
Approved by: $($approval.approved_by) at $($approval.approved_at)
Plan hash: $($approval.plan_hash)
-------------------------------------------------------------
$planContent
-------------------------------------------------------------
BINDING RULES — NON-NEGOTIABLE:
1. Touch ONLY files listed under IN SCOPE
2. Do NOT merge, rename, or restructure anything not in this plan
3. Do NOT remove UI — if it is in scope, it ships
4. Do NOT mark gates N/A to hide missing features
5. Do NOT hand terminal commands to Dr. Agyeman — you finish the job
6. You CANNOT EXIT until OO signs off completion
   Run: powershell -ExecutionPolicy Bypass -File .claude\Complete-PlanWithOO.ps1
"@

@{ additionalContext = $context } | ConvertTo-Json -Compress | Write-Output
exit 0
