# mailcow-setup

Declarative source-of-truth + GitHub-Actions-driven reconciler for the Agyeman
Enterprises mail stack. Add a domain to `domains.yml`, push, and CI fully configures
Mailcow + Resend + Cloudflare DNS.

---

## Architecture (read first)

- **Mailcow** (on the GCP VM `mail-server`, host `mail.agyemanenterprises.com`) =
  receive server for all product-domain mail.
- **Resend** = outbound transactional sender. Each product domain gets its own
  verified Resend domain + DKIM.
- **Google Workspace on `agyemanenterprises.com`** = the holding-co's single reading
  inbox (the "desk"). Every alias on every product domain forwards here.
- **`agyemanenterprises.com` never goes into Mailcow.** If it's there, aliases
  targeting `admin@agyemanenterprises.com` get trapped locally instead of relayed
  out — the whole one-inbox design breaks. `scripts/onboard-domain.py` refuses
  it in code.

Full flow for inbound on a product domain:

```
sender → MX(<product>.com) → Mailcow → alias rewrites to admin@agyemanenterprises.com
       → external SMTP relay → MX(agyemanenterprises.com) → Cloudflare Email Routing
       → Google Workspace desk
```

---

## Daily use

### Adding a new product domain

1. Make sure the domain is a zone in Cloudflare.
2. Edit `domains.yml`, add the domain under the right list:
   - `full` — MX swapped to Mailcow, all DNS records set, aliases created
   - `stage` — keep existing inbound (CF Email Routing / Google W/S), but still set
     up Mailcow registration, DKIM, Resend, SPF-with-CF-include, aliases
   - `cf_email_routing` — treated same as `stage`; included for documentation of
     domains you've decided to leave on CF
3. Commit, push to `main`.
4. The **Onboard domains** workflow runs automatically (also nightly at 09:00 UTC
   and on-demand via `workflow_dispatch`).

### Manual run locally

```bash
cp .env.example .env      # fill in creds
set -a && source .env && set +a

# Verify everything (no changes)
python scripts/reconcile.py --verify-only

# Onboard just one domain
python scripts/onboard-domain.py some-new-app.com

# Onboard but keep existing MX (Google W/S / CF routing)
python scripts/onboard-domain.py some-new-app.com --stage

# Verify a single domain's current state
python scripts/onboard-domain.py some-new-app.com --verify-only
```

---

## What `onboard-domain.py` does (per domain)

1. Refuses to touch `agyemanenterprises.com`.
2. Looks up the Cloudflare zone. If none, hard-fails.
3. Detects Cloudflare Email Routing — auto-stages if enabled (MX won't be swapped,
   SPF gets the `_spf.mx.cloudflare.net` include).
4. Mailcow: add domain (idempotent), generate DKIM (idempotent).
5. Resend: add domain (idempotent), fetch DKIM + send-subdomain records.
6. Cloudflare DNS upserts (idempotent):
   - `A mail.<d>` → `34.26.207.116`
   - `MX <d>` → `mail.agyemanenterprises.com` priority 10 (unless staged)
   - `TXT <d>` SPF (Mailcow or CF-routing variant, depending on mode)
   - `TXT dkim._domainkey.<d>` → Mailcow DKIM
   - `TXT resend._domainkey.<d>` → Resend DKIM
   - `MX send.<d>` → Resend bounce MX
   - `TXT send.<d>` → Resend SPF
7. Mailcow aliases: `admin`, `contact`, `privacy`, `sales`, `legal`, `aagyeman`,
   `hosei`, `aanderson`, `mattk`, and a `@<d>` catchall — all forwarding to
   `admin@agyemanenterprises.com`.

All steps are idempotent. Reruns are no-ops on anything already correct.

---

## Files

| Path | Role |
|---|---|
| `domains.yml` | Source of truth — edit this to add/move domains |
| `scripts/onboard-domain.py` | Per-domain orchestrator |
| `scripts/reconcile.py` | Reads `domains.yml`, calls onboard for each |
| `scripts/zone-activity.sh` | Utility: classify CF zones as active vs parked |
| `.github/workflows/onboard.yml` | CI: push, nightly schedule, manual dispatch |
| `.env.example` | Credentials template |

---

## CI / secrets

GitHub Actions workflow `Onboard domains` runs on:

- `push` to `main` when `domains.yml` or `scripts/**` changes
- `schedule`: nightly drift-reconcile (09:00 UTC / ≈ 19:00 Guam)
- `workflow_dispatch`: manual trigger with optional `verify_only` / `only` inputs

Repository secrets required (set via `gh secret set --repo Agyeman-Enterprises/mailcow-setup`):

| Secret | Source |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard, DNS:Edit on all zones |
| `MAILCOW_API_KEY` | Mailcow admin UI → Access → API |
| `MAILCOW_HOST` | `mail.agyemanenterprises.com` |
| `MAIL_SERVER_IP` | `34.26.207.116` |
| `RESEND_API_KEY` | resend.com → API Keys |

---

## Hard rules (enforced in code and in review)

1. `agyemanenterprises.com` is NEVER in Mailcow's domain registry.
2. Do not bulk-act on all 227 Cloudflare zones — use `domains.yml` as the curated
   active set.
3. On a domain currently using CF Email Routing, SPF must include
   `_spf.mx.cloudflare.net` — otherwise CF flags the zone as misconfigured and
   forwarded mail can fail SPF at Gmail.
4. Destructive actions (delete mailbox, delete domain, disable email routing)
   never run from automation. If it's in this repo, it's additive/reconciling.
