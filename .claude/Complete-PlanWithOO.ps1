# Complete-PlanWithOO.ps1
# Claude runs this when it believes all work is done.
# OO audits the deliverables against PLAN.md ## MUST DELIVER.
# If OO accepts: writes OO_COMPLETE.json — Claude may stop.
# If OO rejects: Claude remains blocked from stopping.
# ─────────────────────────────────────────────────────────────────────────────

$RepoRoot     = git rev-parse --show-toplevel 2>$null
$PlanPath     = Join-Path $RepoRoot "PLAN.md"
$ClaudeDir    = Join-Path $RepoRoot ".claude"
$ApprovalPath = Join-Path $ClaudeDir "OO_APPROVED.json"
$CompletePath = Join-Path $ClaudeDir "OO_COMPLETE.json"
$OOEndpoint   = $env:OO_APPROVAL_URL

if (-not (Test-Path $ApprovalPath)) {
    Write-Host "ERROR: No OO approval on record. You cannot complete an unapproved task." -ForegroundColor Red
    exit 1
}

$approval    = Get-Content $ApprovalPath -Raw | ConvertFrom-Json
$currentHash = (Get-FileHash $PlanPath -Algorithm SHA256).Hash

if ($approval.plan_hash -ne $currentHash) {
    Write-Host "ERROR: PLAN.md changed after approval. Resubmit to OO." -ForegroundColor Red
    exit 1
}

# Collect modified files for OO to audit
$modifiedFiles = git diff --name-only HEAD 2>$null
$planContent   = Get-Content $PlanPath -Raw

Write-Host ""
Write-Host "Submitting completion claim to OO..." -ForegroundColor Cyan

# ── Option A: OO HTTP endpoint ────────────────────────────────────────────────
if ($OOEndpoint) {
    $payload = @{
        plan_hash      = $currentHash
        plan_content   = $planContent
        modified_files = @($modifiedFiles)
        repo           = $RepoRoot
        submitted_at   = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
    } | ConvertTo-Json -Depth 5

    try {
        $response = Invoke-RestMethod -Uri "$OOEndpoint/review-completion" `
                        -Method Post `
                        -ContentType "application/json" `
                        -Body $payload

        $response | ConvertTo-Json -Depth 10 | Set-Content $CompletePath

        if ($response.verdict -eq "ACCEPTED") {
            Write-Host "OO ACCEPTED. You may now stop." -ForegroundColor Green
        } else {
            Write-Host "OO REJECTED completion." -ForegroundColor Red
            Write-Host "Reason: $($response.reason)" -ForegroundColor Red
            Write-Host "Issues:" -ForegroundColor Yellow
            $response.issues | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
            Write-Host "Fix all issues and rerun Complete-PlanWithOO.ps1" -ForegroundColor Red
        }
    } catch {
        Write-Host "ERROR: Could not reach OO at $OOEndpoint" -ForegroundColor Red
        exit 1
    }
}

# ── Option B: File-based OO ───────────────────────────────────────────────────
else {
    $pendingCompletePath = Join-Path $ClaudeDir "OO_COMPLETE_PENDING.json"
    @{
        plan_hash      = $currentHash
        plan_content   = $planContent
        modified_files = @($modifiedFiles)
        repo           = $RepoRoot
        submitted_at   = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
        status         = "PENDING"
    } | ConvertTo-Json -Depth 5 | Set-Content $pendingCompletePath

    Write-Host ""
    Write-Host "Completion submitted. OO_COMPLETE_PENDING.json written." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "OO must now:" -ForegroundColor Cyan
    Write-Host "  1. Read PLAN.md ## MUST DELIVER checklist"
    Write-Host "  2. Verify each deliverable exists and is correct"
    Write-Host "  3. Write .claude/OO_COMPLETE.json with:"
    Write-Host '     { "verdict": "ACCEPTED"|"REJECTED", "plan_hash": "<hash>", "reason": "...", "issues": [] }'
    Write-Host ""
    Write-Host "Claude is BLOCKED from stopping until OO_COMPLETE.json is written with verdict=ACCEPTED." -ForegroundColor Red

    # Poll for completion sign-off
    Write-Host "Waiting for OO completion review..." -ForegroundColor Cyan
    $timeout = 600
    $elapsed = 0
    while ($elapsed -lt $timeout) {
        if (Test-Path $CompletePath) {
            $completion = Get-Content $CompletePath -Raw | ConvertFrom-Json
            if ($completion.verdict -eq "ACCEPTED") {
                Write-Host ""
                Write-Host "OO ACCEPTED. You may now stop." -ForegroundColor Green
                exit 0
            } elseif ($completion.verdict -eq "REJECTED") {
                Write-Host ""
                Write-Host "OO REJECTED completion." -ForegroundColor Red
                Write-Host "Reason: $($completion.reason)" -ForegroundColor Red
                $completion.issues | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
                exit 1
            }
        }
        Start-Sleep -Seconds 5
        $elapsed += 5
        Write-Host "  ...waiting ($elapsed / $timeout seconds)" -ForegroundColor Gray
    }
    Write-Host "TIMEOUT: OO did not respond." -ForegroundColor Red
    exit 1
}
