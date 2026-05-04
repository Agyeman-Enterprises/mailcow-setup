INFRASTRUCTURE REFERENCE — READ BEFORE ANY DEPLOY

Containers: Podman, NOT Docker. No Docker Desktop, no Docker daemon.
  Install: winget install RedHat.Podman (Windows) / apt install podman (Linux)
  Commands: same as docker — podman run, podman build, podman ps
  Compose: podman-compose (pip install podman-compose)

Secrets: Sanctum (NOT .env files, NOT hardcoded)
  Status: API endpoint being built — until live, use local .env as temporary bridge
  When live: all services pull secrets from Sanctum API on startup

Servers:
  THE BEAST     → development, local builds, CC runs here
  aa-hztnr-ub24-amiacoda → testbed (Srvrsup, AkuaWatch, AEnIO, MiBase, AeGit)
  aa-hztnr-ub24-aurora   → production apps (Coolify until Srvrsup replaces it)
  aa-gcp-ub24-aurora     → production mail (Mailcow)

Storage: AEnIO (MinIO) at http://5.9.153.215:8082
Database: MiBase at localhost:8000 (THE BEAST) — Postgres backend pending
Git: AeGit at aegit.agyemanenterprises.com — Stage 1 building
Auth: Zitadel — queued after AeGit
Monitoring: Srvrsup + AkuaWatch
Secrets vault: Sanctum
DNS: Cloudflare (all domains)
Domains: GoDaddy (migrating to Cloudflare Registrar)
Outbound email: Resend (smarthost)
VPN/mesh: RiftDesk (WireGuard)

Enforcement: AEGIS
  Hooks: C:\Users\YEMAY\.claude\hooks\hook-*.ps1
  Rules: OO_APPROVED.json required before code
  CI: Cerberus 3-panel (Haiku → Sonnet → Gemini/Kimi)
  Signing: Vantage (Ed25519)
  Scanning: VouchSafe

DEPENDENCY ORDER for current builds:
  1. Sanctum API (no dependencies)
  2. AEGIS bug fixes (no dependencies)
  3. AeBase wiring (needs Sanctum API)
  4. AeGit wiring (needs Sanctum API)
  5. Srvrsup wiring (needs Sanctum API)

PowerShell rules: plain ASCII only. No smart quotes, em dashes, arrow chars.
Zip files: output to same parent folder as source, never Desktop/Downloads.