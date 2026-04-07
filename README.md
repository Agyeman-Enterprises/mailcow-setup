# mailcow-setup

Automatically discovers real domain names from GitHub repos and wires up email for them — Cloudflare DNS records + Mailcow domain registration — in one command.

---

## What it does

1. **Scans all repos** across three GitHub orgs (`Agyeman-Enterprises`, `isaalia`, `imho-media`)
2. **Finds real domain names** in config files (`.env.example`, `README.md`, `vercel.json`, `mailcow.conf`, `.env*`)
3. **Skips fake domains** — filters out localhost, Supabase, Vercel, Cloudflare, GitHub, and other infrastructure hostnames automatically
4. **Looks up Cloudflare** — finds the zone for each domain automatically (no manual zone ID list)
5. **Adds DNS records** — `mail` A record → `34.26.207.116`, MX record, SPF TXT record
6. **Adds domain to Mailcow** — so the mail server accepts email for it
7. **Skips anything already done** — safe to run repeatedly, nothing gets duplicated

---

## One-time setup

### 1. Copy the example env file

```
cp .env.example .env
```

### 2. Fill in your credentials

Open `.env` and fill in each line:

| Variable | Where to get it |
|---|---|
| `GITHUB_TOKEN` | GitHub → Settings → Developer settings → Personal access tokens (needs `repo` scope on all 3 orgs) |
| `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard → My Profile → API Tokens → Create Token → Zone DNS Edit |
| `MAILCOW_API_KEY` | Mailcow admin UI → Configuration → Access → API Access |
| `MAILCOW_HOST` | Already set to `mail.agyemanenterprises.com` — leave it |
| `MAIL_SERVER_IP` | Already set to `34.26.207.116` — leave it |

### 3. Install jq (if not already installed)

```
# macOS
brew install jq

# Ubuntu/Debian
sudo apt-get install jq

# Windows (Git Bash)
winget install jqlang.jq
```

---

## Running it

### Scan everything (all three orgs)

```bash
source .env
bash scripts/discover-and-setup.sh
```

### Scan a specific repo only

```bash
source .env
bash scripts/discover-and-setup.sh Agyeman-Enterprises my-repo-name
```

### What the output looks like

```
════════════════════════════════════════════════════════
  Mailcow Domain Discovery + Setup
════════════════════════════════════════════════════════

── Org: Agyeman-Enterprises ──
→ Scanning Agyeman-Enterprises/plotpilot
  plotpilot.io ... ADDED
  www.plotpilot.io ... SKIPPED (already exists)

→ Scanning Agyeman-Enterprises/linahla
  linahla.com ... ADDED

── Org: isaalia ──
→ Scanning isaalia/portfolio
  (no real domains found)

════════════════════════════════════════════════════════
  Summary
────────────────────────────────────────────────────────
  Domains found:    3
  Domains added:    2
  Domains skipped:  1
  No CF zone:       0
  Errors:           0
════════════════════════════════════════════════════════
```

**Status meanings:**
- `ADDED` — DNS records and Mailcow domain created
- `SKIPPED` — already existed, nothing changed
- `NO_ZONE` — domain not found in your Cloudflare account (may be on a different registrar)
- `ERROR` — API call failed (check API keys or network)

---

## Automatic setup for new repos

A GitHub Actions workflow (`auto-mail-setup.yml`) runs the discovery script automatically when a new repo is created in any of the three orgs.

**To enable it:**

1. Add these secrets to this repo (Settings → Secrets → Actions):
   - `GITHUB_TOKEN_ORG` — PAT with repo scope
   - `CLOUDFLARE_API_TOKEN`
   - `MAILCOW_API_KEY`
   - `MAILCOW_HOST`
   - `MAIL_SERVER_IP`

2. Set up a GitHub org webhook (or GitHub App) that fires `repository` `created` events and sends a `repository_dispatch` to this repo with:
   ```json
   {
     "event_type": "repo_created",
     "client_payload": {
       "org": "Agyeman-Enterprises",
       "repo": "new-repo-name"
     }
   }
   ```

---

## Troubleshooting

**"No CF zone found"** — The domain's registrar is not Cloudflare, or the domain uses a nameserver that isn't managed in your Cloudflare account. Add it manually.

**"ERROR (Mailcow)"** — Check that `MAILCOW_API_KEY` is correct and that the Mailcow server is reachable. Try: `curl -H "X-API-Key: YOUR_KEY" https://mail.agyemanenterprises.com/api/v1/get/domain/all`

**"ERROR (DNS)"** — Check that `CLOUDFLARE_API_TOKEN` has `Zone:Read` + `DNS:Edit` permissions.

**Script finds no domains** — The repo files may not contain recognisable domain patterns, or the files listed in `FILES_TO_SCAN` don't exist in that repo. Check the repo manually.
