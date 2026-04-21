# hook-pre-tool-use.ps1
# GATE 2 — FIRES: Before every Write / Edit / MultiEdit / Bash
# RULE: Every file written must be in the OO-approved IN SCOPE list.
# ─────────────────────────────────────────────────────────────────────────────

$raw          = [Console]::In.ReadToEnd()
$input_json   = $raw | ConvertFrom-Json
$ToolName     = $input_json.tool_name
$ToolInput    = $input_json.tool_input
$RepoRoot     = git rev-parse --show-toplevel 2>$null
$ApprovalPath = Join-Path $RepoRoot ".claude\OO_APPROVED.json"
$PlanPath     = Join-Path $RepoRoot "PLAN.md"

# ── Require OO approval for all file writes ───────────────────────────────────
if ($ToolName -in @('Write','Edit','MultiEdit','StrReplace')) {
    if (-not (Test-Path $ApprovalPath)) {
        Write-Error "SCOPE GUARD: No OO approval. Run Submit-PlanToOO.ps1 before writing any files."
        exit 2
    }

    $approval    = Get-Content $ApprovalPath -Raw | ConvertFrom-Json
    $currentHash = (Get-FileHash $PlanPath -Algorithm SHA256).Hash

    if ($approval.plan_hash -ne $currentHash) {
        Write-Error "SCOPE GUARD: PLAN.md changed since OO approval. Resubmit to OO before any writes."
        exit 2
    }

    # Parse IN SCOPE from PLAN.md
    $allowedPaths = @()
    $blockedPaths = @()
    $inSec = $false; $outSec = $false
    foreach ($line in (Get-Content $PlanPath)) {
        if ($line -match '^##\s*IN SCOPE')    { $inSec = $true;  $outSec = $false; continue }
        if ($line -match '^##\s*OUT OF SCOPE') { $outSec = $true; $inSec = $false;  continue }
        if ($line -match '^##')               { $inSec = $false; $outSec = $false;  continue }
        if ($inSec  -and $line -match '^\s*[-*]\s+(.+)') { $allowedPaths += $Matches[1].Trim() -replace '\\','/' }
        if ($outSec -and $line -match '^\s*[-*]\s+(.+)') { $blockedPaths += $Matches[1].Trim() -replace '\\','/' }
    }

    $fp = ($ToolInput.file_path ?? $ToolInput.path ?? "") -replace '\\','/'

    # Always allow enforcement/config files
    $alwaysAllow = @('PLAN.md','SCOPE.md','CLAUDE.md','.claude/','OO_','GATE','package-lock')
    $exempt = $false
    foreach ($a in $alwaysAllow) { if ($fp -like "*$a*") { $exempt = $true; break } }

    if (-not $exempt) {
        # Check blocked first
        foreach ($b in $blockedPaths) { 
            if ($fp -like "*$b*") {
                Write-Error "SCOPE GUARD BLOCKED: $fp is explicitly OUT OF SCOPE in your OO-approved plan."
                exit 2
            }
        }
        # Check allowed
        if ($allowedPaths.Count -gt 0) {
            $inScope = $false
            foreach ($a in $allowedPaths) { if ($fp -like "*$a*") { $inScope = $true; break } }
            if (-not $inScope) {
                Write-Error @"
SCOPE GUARD BLOCKED — $ToolName rejected
File: $fp
This file is NOT in your OO-approved IN SCOPE list.
Either: delete it from your plan, or STOP and ask Dr. Agyeman to update PLAN.md then resubmit to OO.
"@
                exit 2
            }
        }
    }
}

# ── Bash guardrails ───────────────────────────────────────────────────────────
if ($ToolName -eq 'Bash') {
    $cmd = $ToolInput.command ?? ""

    if ($cmd -match 'git\s+commit.*--no-verify') {
        Write-Error "SCOPE GUARD BLOCKED: --no-verify is absolutely forbidden. It bypasses all enforcement."
        exit 2
    }

    if ($cmd -match '(rm\s|Remove-Item|del\s).*(\bOO_|\bhook-|ae-enforce|PLAN\.md)') {
        Write-Error "SCOPE GUARD BLOCKED: Attempted deletion of enforcement infrastructure. Hard stop."
        exit 2
    }
}

exit 0
