# hook-violation-scanner.ps1
# Fires on PreToolUse (Write/Edit/Bash) AND as a PostToolUse audit.
# Scans code being written for MUST-NEVER violations.
# Any hit = HARD STOP + OO_VIOLATION.json written + Claude redirected to OO.
# ─────────────────────────────────────────────────────────────────────────────

$raw        = [Console]::In.ReadToEnd()
$input_json = $raw | ConvertFrom-Json
$ToolName   = $input_json.tool_name
$ToolInput  = $input_json.tool_input
$RepoRoot   = git rev-parse --show-toplevel 2>$null
$ClaudeDir  = Join-Path $RepoRoot ".claude"
$ViolLog    = Join-Path $ClaudeDir "VIOLATIONS.log"
$ViolJson   = Join-Path $ClaudeDir "OO_VIOLATION.json"

New-Item -ItemType Directory -Path $ClaudeDir -Force | Out-Null

# ── What content are we scanning? ────────────────────────────────────────────
$contentToScan = ""
$targetFile    = ""

if ($ToolName -eq 'Write') {
    $contentToScan = $ToolInput.content ?? $ToolInput.file_text ?? ""
    $targetFile    = $ToolInput.file_path ?? $ToolInput.path ?? ""
}
elseif ($ToolName -in @('Edit','MultiEdit','StrReplace')) {
    $contentToScan = $ToolInput.new_str ?? $ToolInput.new_content ?? ""
    $targetFile    = $ToolInput.file_path ?? $ToolInput.path ?? ""
}
elseif ($ToolName -eq 'Bash') {
    $contentToScan = $ToolInput.command ?? ""
    $targetFile    = "bash_command"
}

if (-not $contentToScan) { exit 0 }

# ── MUST-NEVER violation patterns ────────────────────────────────────────────
$violations = @(

    # ── CATEGORY 2: Completion fraud ─────────────────────────────────────────
    @{
        category = "COMPLETION FRAUD"
        rule     = "TODO/FIXME/STUB/PLACEHOLDER left in production code"
        pattern  = '(TODO|FIXME|STUB|PLACEHOLDER|NOT IMPLEMENTED|throw new Error\([''"]Not implemented)'
        severity = "HIGH"
    },

    # ── CATEGORY 3: Code quality ──────────────────────────────────────────────
    @{
        category = "CODE QUALITY"
        rule     = "Empty catch block — swallowed error, silent failure"
        pattern  = 'catch\s*\([^)]*\)\s*\{\s*\}'
        severity = "HIGH"
    },
    @{
        category = "CODE QUALITY"
        rule     = "Bare try-catch without @agyeman/error-handling Result pattern"
        pattern  = '^\s*\}\s*catch\s*\('
        severity = "HIGH"
        requiresAbsence = "@agyeman/error-handling"
    },
    @{
        category = "CODE QUALITY"
        rule     = "console.log left in production code"
        pattern  = 'console\.(log|warn|error|debug|info)\s*\('
        severity = "MEDIUM"
    },
    @{
        category = "CODE QUALITY"
        rule     = "Hardcoded secret or credential"
        pattern  = '(?i)(password|secret|api_key|apikey|private_key)\s*[=:]\s*[''"][^''"\$\{]{6,}'
        severity = "CRITICAL"
    },
    @{
        category = "CODE QUALITY"
        rule     = "Hardcoded port number"
        pattern  = '(?<!\w)(3000|3001|4000|4004|8000|8080|5000|5173)(?!\w)'
        severity = "MEDIUM"
    },
    @{
        category = "CODE QUALITY"
        rule     = "TypeScript 'any' type used without justification"
        pattern  = ':\s*any\b(?!\s*\/\/\s*justified)'
        severity = "MEDIUM"
    },

    # ── CATEGORY 4: Enforcement bypass ───────────────────────────────────────
    @{
        category = "ENFORCEMENT BYPASS"
        rule     = "--no-verify used to bypass git hooks"
        pattern  = 'git\s+commit.*--no-verify'
        severity = "CRITICAL"
    },
    @{
        category = "ENFORCEMENT BYPASS"
        rule     = "Attempting to delete enforcement infrastructure"
        pattern  = '(rm|Remove-Item|del|rmdir).*(\bOO_|\bhook-|ae-enforce|PLAN\.md|MUST-NEVERS)'
        severity = "CRITICAL"
    },
    @{
        category = "ENFORCEMENT BYPASS"
        rule     = "Bash heredoc used to bypass Write tool block"
        pattern  = 'cat\s*<<\s*[''"]?EOF'
        severity = "HIGH"
    },

    # ── CATEGORY 5: Operator handoff ─────────────────────────────────────────
    @{
        category = "OPERATOR HANDOFF"
        rule     = "Leaving manual steps for Dr. Agyeman in comments"
        pattern  = '(?i)(manually run|run this command|you.ll need to|ask dr\. agyeman|tell the user to run)'
        severity = "HIGH"
    },

    # ── CATEGORY 6: Architectural violations ─────────────────────────────────
    @{
        category = "ARCHITECTURE"
        rule     = "Direct database write from frontend (no API route)"
        pattern  = '(?i)(supabase\.from|createClient\(\)).*\.(insert|update|delete|upsert)\s*\('
        severity = "HIGH"
        filePattern = "(page|component|layout|client)\.(ts|tsx|js|jsx)$"
    },
    @{
        category = "ARCHITECTURE"
        rule     = "HIPAA data path without auth check"
        pattern  = '(?i)(patient|diagnosis|medication|clinical|phi|hipaa)'
        severity = "HIGH"
        requiresPresence = "(getUser|auth|session|authenticated)"
    },
    @{
        category = "ARCHITECTURE"
        rule     = "Wrong Supabase project ref (mixed projects)"
        pattern  = "createClient\([^)]*'(?!tzjygaxpzrtevlnganjs|udtlbxzinpuzsfpdqqsj|qkybmlrxdfpvhzjiksjs)[a-z]{20}'"
        severity = "MEDIUM"
    },

    # ── CATEGORY 8: Windows/stack violations ─────────────────────────────────
    @{
        category = "STACK VIOLATION"
        rule     = "Bash script written instead of PowerShell"
        pattern  = '^#!/(bin/bash|bin/sh|usr/bin/env bash)'
        severity = "HIGH"
    }
)

# ── Scan content ──────────────────────────────────────────────────────────────
$hits = @()

foreach ($v in $violations) {
    # File-type filter
    if ($v.filePattern -and $targetFile -notmatch $v.filePattern) { continue }

    if ($contentToScan -match $v.pattern) {
        # Check requiresAbsence (only a violation if the guard import is missing)
        if ($v.requiresAbsence) {
            if ($contentToScan -match [regex]::Escape($v.requiresAbsence)) { continue }
        }
        # Check requiresPresence (only a violation if the guard pattern is absent)
        if ($v.requiresPresence) {
            if ($contentToScan -match $v.requiresPresence) { continue }
        }
        $hits += $v
    }
}

if ($hits.Count -eq 0) { exit 0 }

# ── Violations found — log, write OO_VIOLATION.json, hard stop ───────────────
$timestamp = Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ"

# Append to VIOLATIONS.log
$logEntry = @"
[$timestamp] VIOLATION in $targetFile (tool: $ToolName)
$($hits | ForEach-Object { "  [$($_.severity)] [$($_.category)] $($_.rule)" } | Out-String)
"@
Add-Content -Path $ViolLog -Value $logEntry

# Write OO_VIOLATION.json — triggers OO review requirement
@{
    timestamp    = $timestamp
    tool         = $ToolName
    target_file  = $targetFile
    violations   = @($hits | ForEach-Object {
        @{
            category = $_.category
            rule     = $_.rule
            severity = $_.severity
        }
    })
    status       = "PENDING_OO_REVIEW"
    resume_requires = "New OO_APPROVED.json after Dr. Agyeman reviews violations"
} | ConvertTo-Json -Depth 5 | Set-Content $ViolJson

# Build error message for Claude
$criticalCount = ($hits | Where-Object { $_.severity -eq "CRITICAL" }).Count
$highCount     = ($hits | Where-Object { $_.severity -eq "HIGH" }).Count

$violationLines = $hits | ForEach-Object { "  [$($_.severity)] [$($_.category)] $($_.rule)" }

Write-Error @"
HARD STOP — MUST-NEVER VIOLATION DETECTED
File: $targetFile
Violations found: $($hits.Count) ($criticalCount critical, $highCount high)

$($violationLines -join "`n")

THIS IS JUNIOR DEVELOPER BEHAVIOR. IT IS NOT ACCEPTABLE.

What happens now:
  1. This write is BLOCKED
  2. OO_VIOLATION.json has been written to .claude/
  3. OO must review before work resumes
  4. Run: powershell -ExecutionPolicy Bypass -File .claude\Submit-PlanToOO.ps1

A senior developer with a PhD does not:
  - Leave TODO stubs in production code
  - Swallow errors silently
  - Hardcode credentials
  - Bypass enforcement hooks
  - Leave work for Dr. Agyeman to finish manually

Fix the violations. Resubmit to OO. Then continue.
"@

exit 2
