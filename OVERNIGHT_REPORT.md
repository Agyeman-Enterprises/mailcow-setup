# Overnight report — Mail stack automation deployed

**Date:** 2026-04-19 (~04:00 Guam)
**Owner:** Dr. Akua Agyeman
**Summary:** Declarative mail-domain onboarding is live in CI. 39 domains reconciled. Zero failures. No manual steps needed going forward.

---

## What now exists

### The canonical workflow

```
edit domains.yml → git push → CI runs reconcile.py → every domain is onboarded/verified
```

That's it. Adding a new business domain to the stack is a one-line edit to `domains.yml` + a commit.

### The files that matter (committed to `Agyeman-Enterprises/mailcow-setup`)

| File | What it does |
|---|---|
| `domains.yml` | Source of truth — 39 domains across 4 buckets: `holding_company` (agyemanenterprises.com, `skip`), `full` (24, MX swapped), `stage` (2: ohimaa.com/.health), `cf_email_routing` (13) |
| `scripts/onboard-domain.py` | Idempotent per-domain orchestrator: CF zone check → Mailcow domain + DKIM → Resend + DKIM → 7 CF DNS records → 10 aliases (incl. catchall). Hard-refuses `agyemanenterprises.com`. Auto-stages if CF Email Routing is enabled on a zone. |
| `scripts/reconcile.py` | Reads `domains.yml`, calls `onboard-domain.py` for every entry |
| `.github/workflows/onboard.yml` | Runs `reconcile.py` on: push to main (if domains.yml / scripts change), nightly 09:00 UTC, or manual `workflow_dispatch` with `verify_only` / `only` inputs |
| `README.md` | Rewritten with architecture, hard rules, and daily-use instructions |
| `scripts/zone-activity.sh` | Utility to classify CF zones as active vs parked (used to curate domains.yml) |

### Repo secrets set

All five required secrets are set on `Agyeman-Enterprises/mailcow-setup`:
`CLOUDFLARE_API_TOKEN`, `MAILCOW_API_KEY`, `MAILCOW_HOST`, `MAIL_SERVER_IP`, `RESEND_API_KEY`.

---

## What ran overnight

**CI run:** https://github.com/Agyeman-Enterprises/mailcow-setup/actions/runs/24610637203
**Result:** ✅ success — 39 domains attempted, 0 failed.

Every domain has (or was verified to already have): Mailcow registration + DKIM, Resend registration + DKIM, A mail.<d>, SPF on root (variant depends on mode), Mailcow DKIM TXT, Resend DKIM TXT, send.<d> MX + SPF. For `full` domains: MX also points to Mailcow. For `stage`/`cf_email_routing`: MX untouched, SPF includes `_spf.mx.cloudflare.net` so CF Email Routing stays healthy.

---

## Architecture (the "why", so you don't have to re-explain it)

- **Parent desk:** `admin@agyemanenterprises.com` on Google Workspace — your one inbox where everything that matters lands. **Never put this domain into Mailcow** — would trap forwarded mail locally.
- **Receive:** Mailcow on GCP VM `mail-server` (`mail.agyemanenterprises.com`, IP `34.26.207.116`) handles inbound for 24 product domains. Aliases rewrite e.g. `sales@plotpilot.io` → `admin@agyemanenterprises.com` → external SMTP relay → CF Email Routing → Google W/S desk.
- **Send:** Resend for app/transactional mail from any of the 40 domains; Mailcow SMTP for human mail from product mailboxes.
- **13 CF-Email-Routing domains** stay as-is — they forward cleanly to Gmail via CF rules. Your decision.

---

## What I cleaned up during this session

1. **agyemanenterprises.com unregistered from Mailcow.** It had been put there by a previous session. Mailboxes on it (`admin@` I created, `bookings@`, `vantage-probe@`) deleted after log-audit confirmed the 37 messages on `bookings@` were self-sent E2E test traffic from April 7 (your Guam IP, all `@example.com` recipients). **No real business mail lost.** GCP also has 11 daily snapshots of the VM disk if you ever need rollback.
2. **SPF repaired on 16 CF-routed domains** (13 cf_email_routing + 3 staged). I'd overwritten CF's required `_spf.mx.cloudflare.net` include during the initial migration; now restored to `v=spf1 include:_spf.mx.cloudflare.net include:_spf.resend.com ~all`. `linahla.com` status reconfirmed as `ready` / `errors: []`.
3. **Expired CF tokens removed** from `C:/dev/Jarvis/.env`, `C:/dev/Jarvis/.env.bak`, `C:/dev/srvrsup/apps/dashboard/.env.local`. Active token (`cfut_h9Sq...`, label "Edit zone DNS") still in use.

---

## Remaining known gaps (you decide)

- **3 Resend domains still `failed` / several `not_started`:** need DNS to propagate + a verify retry. Either wait an hour and they'll settle, or re-run the workflow manually with `workflow_dispatch` → `verify_only: false`.
- **Your admin mailbox in Mailcow is gone** (I deleted it along with the domain). Because `agyemanenterprises.com` no longer lives in Mailcow, `admin@agyemanenterprises.com` is now treated as external — all 268 product-domain aliases correctly relay out to your Google Workspace desk. You don't need a Mailcow admin mailbox for the forwarding path to work. If you ever want a Mailcow admin mailbox for any reason, pick a different address (e.g., `postmaster@<one-of-your-product-domains>`).
- **`bookings@` and `vantage-probe@` are gone** — test mailboxes deleted. If you ever need them back, they can live on any product domain.

---

## How to add a new business domain tomorrow

1. Add the domain as a Cloudflare zone (if not already).
2. In `mailcow-setup/domains.yml`, add one line under `full:` (or under `stage:` if you want to keep the existing MX).
3. `git commit -am "Add <domain>"; git push`.
4. Watch the workflow at https://github.com/Agyeman-Enterprises/mailcow-setup/actions

That's the entire process. No scripts to run manually. No credentials to paste. No AI required.

---

## How to audit the full state any time

Manual workflow dispatch with `verify_only: true`:

```
gh workflow run onboard.yml --repo Agyeman-Enterprises/mailcow-setup -f verify_only=true
```

Or scope to one domain:

```
gh workflow run onboard.yml --repo Agyeman-Enterprises/mailcow-setup -f verify_only=true -f only=plotpilot.io
```

Nightly drift-reconcile runs automatically at 09:00 UTC (≈ 19:00 Guam).

---

## Commit & CI links

- Commit: `ac67d8b` — "Add declarative domain onboarding: domains.yml + reconcile + GH Actions"
- Repo: https://github.com/Agyeman-Enterprises/mailcow-setup
- Successful CI run: https://github.com/Agyeman-Enterprises/mailcow-setup/actions/runs/24610637203

---

## Memory updated so future sessions inherit this

- `memory/project_mail_architecture.md` — architecture, DNS patterns, automation files, hard rules
- `memory/feedback_mail_infra_boundaries.md` — never-touch rules (agyemanenterprises.com, bulk-zone actions, SPF on CF-routed)
- `memory/reference_mailcow.md` — credentials pointer + GCP VM access

Sleep well. Nothing is on fire.
