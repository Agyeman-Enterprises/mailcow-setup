# Submit-PlanToOO.ps1
# Claude runs this after writing PLAN.md.
# Submits the plan to OO (4-agent adversarial system) for approval.
# OO writes .claude/OO_APPROVED.json with verdict + plan hash.
# Claude cannot proceed until this file exists with verdict=APPROVED.
# ─────────────────────────────────────────────────────────────────────────────

$RepoRoot     = git rev-parse --show-toplevel 2>$null
$PlanPath     = Join-Path $RepoRoot "PLAN.md"
$ClaudeDir    = Join-Path $RepoRoot ".claude"
$ApprovalPath = Join-Path $ClaudeDir "OO_APPROVED.json"
$OOEndpoint   = $env:OO_APPROVAL_URL  # Set this in your environment

if (-not (Test-Path $PlanPath)) {
    Write-Host "ERROR: PLAN.md not found. Write your plan first." -ForegroundColor Red
    exit 1
}

$planContent = Get-Content $PlanPath -Raw
$planHash    = (Get-FileHash $PlanPath -Algorithm SHA256).Hash

Write-Host ""
Write-Host "Submitting PLAN.md to OO for approval..." -ForegroundColor Cyan
Write-Host "Plan hash: $planHash" -ForegroundColor Gray

New-Item -ItemType Directory -Path $ClaudeDir -Force | Out-Null

# ── Option A: OO is a running HTTP service ────────────────────────────────────
if ($OOEndpoint) {
    $payload = @{
        plan_hash    = $planHash
        plan_content = $planContent
        repo         = $RepoRoot
        submitted_at = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
    } | ConvertTo-Json

    try {
        $response = Invoke-RestMethod -Uri "$OOEndpoint/review-plan" `
                        -Method Post `
                        -ContentType "application/json" `
                        -Body $payload

        $response | ConvertTo-Json -Depth 10 | Set-Content $ApprovalPath
        Write-Host ""

        if ($response.verdict -eq "APPROVED") {
            Write-Host "OO APPROVED your plan." -ForegroundColor Green
            Write-Host "You may now start working." -ForegroundColor Green
        } else {
            Write-Host "OO REJECTED your plan." -ForegroundColor Red
            Write-Host "Reason: $($response.reason)" -ForegroundColor Red
            Write-Host "Fix the issues and resubmit." -ForegroundColor Yellow
        }
    } catch {
        Write-Host "ERROR: Could not reach OO at $OOEndpoint" -ForegroundColor Red
        Write-Host $_.Exception.Message -ForegroundColor Red
        exit 1
    }
}

# ── Option B: OO is file-based (OO reads the pending file and writes approval) ──
else {
    $pendingPath = Join-Path $ClaudeDir "OO_PENDING.json"
    @{
        plan_hash    = $planHash
        plan_content = $planContent
        repo         = $RepoRoot
        submitted_at = (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ")
        status       = "PENDING"
    } | ConvertTo-Json -Depth 5 | Set-Content $pendingPath

    Write-Host ""
    Write-Host "Plan submitted. OO_PENDING.json written to .claude/" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "OO must now:" -ForegroundColor Cyan
    Write-Host "  1. Read PLAN.md and .claude/OO_PENDING.json"
    Write-Host "  2. Run adversarial review"
    Write-Host "  3. Write .claude/OO_APPROVED.json with:"
    Write-Host '     { "verdict": "APPROVED"|"REJECTED", "plan_hash": "<hash>", "reason": "...", "approved_by": "OO", "approved_at": "<iso-date>" }'
    Write-Host ""
    Write-Host "Claude will be blocked from all file writes until OO_APPROVED.json is written." -ForegroundColor Red
    Write-Host ""

    # Poll for approval (waits up to 10 minutes)
    Write-Host "Waiting for OO approval..." -ForegroundColor Cyan
    $timeout = 600
    $elapsed = 0
    while ($elapsed -lt $timeout) {
        if (Test-Path $ApprovalPath) {
            $approval = Get-Content $ApprovalPath -Raw | ConvertFrom-Json
            if ($approval.verdict -eq "APPROVED" -and $approval.plan_hash -eq $planHash) {
                Write-Host ""
                Write-Host "OO APPROVED. You may now start working." -ForegroundColor Green
                exit 0
            } elseif ($approval.verdict -eq "REJECTED") {
                Write-Host ""
                Write-Host "OO REJECTED your plan." -ForegroundColor Red
                Write-Host "Reason: $($approval.reason)" -ForegroundColor Red
                exit 1
            }
        }
        Start-Sleep -Seconds 5
        $elapsed += 5
        Write-Host "  ...waiting ($elapsed / $timeout seconds)" -ForegroundColor Gray
    }
    Write-Host "TIMEOUT: OO did not respond within 10 minutes." -ForegroundColor Red
    exit 1
}
