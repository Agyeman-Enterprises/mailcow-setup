#!/usr/bin/env python3
"""
Fully onboard a single product domain to the Agyeman Enterprises mail stack.

Usage:
    python onboard-domain.py <domain>
    python onboard-domain.py <domain> --stage       # skip MX swap (CF routing / GWS retained)
    python onboard-domain.py <domain> --verify-only # audit, don't change

What it does (idempotent):
  1. CF zone exists?                       (hard-fail if not)
  2. Mailcow: add domain
  3. Mailcow: generate DKIM (dkim._domainkey)
  4. Resend: add domain
  5. Resend: fetch DKIM record
  6. CF DNS upserts (per project_mail_architecture.md):
       A    mail.<d>       -> 34.26.207.116
       MX   <d>            -> mail.agyemanenterprises.com  (SKIP if --stage)
       TXT  <d>            -> SPF
       TXT  dkim._domainkey.<d>   -> Mailcow DKIM
       TXT  resend._domainkey.<d> -> Resend DKIM
       MX   send.<d>       -> feedback-smtp.ap-northeast-1.amazonses.com
       TXT  send.<d>       -> v=spf1 include:amazonses.com ~all
  7. Mailcow: create alias set
       admin, contact, privacy, sales, legal, aagyeman, hosei, aanderson, mattk
       + catchall  @<d>
       All -> admin@agyemanenterprises.com
  8. Print a compact status table

Hard rules enforced in code:
  - Refuses to touch agyemanenterprises.com (belongs on Google Workspace, not Mailcow).
  - Does NOT disable CF Email Routing. If a domain already has CF Routing enabled,
    the MX swap will fail cleanly with status "EMAIL_ROUTING_LOCKED" and we'll
    configure SPF to include `_spf.mx.cloudflare.net` instead.

Env required:
  CLOUDFLARE_API_TOKEN, MAILCOW_API_KEY, MAILCOW_HOST, MAIL_SERVER_IP, RESEND_API_KEY
"""
from __future__ import annotations
import os, sys, json, time, argparse
from typing import Any
import urllib.request, urllib.error

HOLDING_CO = "agyemanenterprises.com"
MAIL_HOST  = os.environ["MAILCOW_HOST"]
MAIL_IP    = os.environ["MAIL_SERVER_IP"]
MC_KEY     = os.environ["MAILCOW_API_KEY"]
CF_TOKEN   = os.environ["CLOUDFLARE_API_TOKEN"]
RESEND_KEY = os.environ["RESEND_API_KEY"]

DEST = "admin@agyemanenterprises.com"
LOCAL_PARTS = ["admin","contact","privacy","sales","legal","aagyeman","hosei","aanderson","mattk"]

SPF_MAILCOW = "v=spf1 mx include:_spf.resend.com ~all"
SPF_CF_ROUTING = "v=spf1 include:_spf.mx.cloudflare.net include:_spf.resend.com ~all"

# ── HTTP ──────────────────────────────────────────────────

def req(method: str, url: str, headers: dict[str,str], body: Any = None) -> tuple[int, Any]:
    headers = {**headers, "User-Agent":"curl/8.4.0"}
    data = None
    if body is not None:
        data = json.dumps(body).encode()
        headers["Content-Type"] = "application/json"
    r = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            raw = resp.read().decode()
            try: return resp.status, json.loads(raw) if raw else {}
            except: return resp.status, raw
    except urllib.error.HTTPError as e:
        raw = e.read().decode() if e.fp else ""
        try: return e.code, json.loads(raw) if raw else {}
        except: return e.code, raw

# ── Cloudflare ────────────────────────────────────────────

CF_HDR = {"Authorization": f"Bearer {CF_TOKEN}"}

def cf(method, path, body=None):
    return req(method, f"https://api.cloudflare.com/client/v4{path}", CF_HDR, body)

def cf_zone_id(name: str) -> str | None:
    s, d = cf("GET", f"/zones?name={name}")
    r = d.get("result", []) if isinstance(d, dict) else []
    return r[0]["id"] if r else None

def cf_records(zid, type_, name):
    s, d = cf("GET", f"/zones/{zid}/dns_records?type={type_}&name={name}&per_page=50")
    return d.get("result", []) if isinstance(d, dict) else []

def cf_email_routing_enabled(zid):
    s, d = cf("GET", f"/zones/{zid}/email/routing")
    if s != 200 or not isinstance(d, dict): return False
    return bool(d.get("result", {}).get("enabled"))

def cf_upsert(zid, type_, name, content, priority=None, replace_all=False):
    existing = cf_records(zid, type_, name)
    body = {"type":type_,"name":name,"content":content,"ttl":3600}
    if priority is not None: body["priority"] = priority

    # Filter out read_only records (CF Email Routing manages these)
    writable = [r for r in existing if not r.get("meta", {}).get("read_only")]
    readonly = [r for r in existing if r.get("meta", {}).get("read_only")]
    if readonly and not writable:
        return "EMAIL_ROUTING_LOCKED"

    if replace_all:
        match = None
        for r in writable:
            if r["content"] == content and r.get("priority") == priority:
                match = r
            else:
                cf("DELETE", f"/zones/{zid}/dns_records/{r['id']}")
        if match: return "exists"
        s, _ = cf("POST", f"/zones/{zid}/dns_records", body)
        return "created" if s in (200,201) else "error"
    else:
        for r in writable:
            if r["content"] == content and r.get("priority") == priority:
                return "exists"
        s, _ = cf("POST", f"/zones/{zid}/dns_records", body)
        return "created" if s in (200,201) else "error"

def cf_upsert_spf(zid, name, new_value):
    existing = cf_records(zid, "TXT", name)
    spf = [r for r in existing if r["content"].strip('"').startswith("v=spf1")]
    body = {"type":"TXT","name":name,"content":new_value,"ttl":3600}
    if not spf:
        s, _ = cf("POST", f"/zones/{zid}/dns_records", body)
        return "created" if s in (200,201) else "error"
    kept = spf[0]
    for extra in spf[1:]: cf("DELETE", f"/zones/{zid}/dns_records/{extra['id']}")
    if kept["content"].strip('"') == new_value: return "exists"
    s, _ = cf("PUT", f"/zones/{zid}/dns_records/{kept['id']}", body)
    return "updated" if s == 200 else "error"

# ── Mailcow ───────────────────────────────────────────────

MC_HDR = {"X-API-Key": MC_KEY}

def mc(method, path, body=None):
    return req(method, f"https://{MAIL_HOST}/api/v1{path}", MC_HDR, body)

def mc_domains() -> set[str]:
    s, d = mc("GET", "/get/domain/all")
    if s != 200 or not isinstance(d, list): return set()
    return {x["domain_name"] for x in d}

def mc_add_domain(d):
    body = {"domain":d,"description":"auto-onboarded",
            "aliases":400,"mailboxes":10,"defquota":3072,"maxquota":10240,"quota":10240,
            "active":1,"restart_sogo":0,"relay_all_recipients":0,"backupmx":0}
    s, r = mc("POST","/add/domain", body)
    if isinstance(r, list) and r: return r[0].get("type","?")
    return "error"

def mc_dkim(d):
    s, r = mc("GET", f"/get/dkim/{d}")
    return r if s == 200 and isinstance(r, dict) and r.get("dkim_txt") else None

def mc_add_dkim(d):
    mc("POST","/add/dkim", {"domains":d,"dkim_selector":"dkim","key_size":2048})
    time.sleep(1)
    return mc_dkim(d)

def mc_aliases() -> set[str]:
    s, d = mc("GET","/get/alias/all")
    return {a["address"] for a in d} if isinstance(d, list) else set()

def mc_mailboxes() -> set[str]:
    s, d = mc("GET","/get/mailbox/all")
    return {m["username"] for m in d} if isinstance(d, list) else set()

def mc_add_alias(addr, goto):
    body = {"address":addr,"goto":goto,"active":"1","sogo_visible":"0"}
    s, r = mc("POST","/add/alias", body)
    return isinstance(r, list) and r and r[0].get("type") == "success"

# ── Resend ────────────────────────────────────────────────

RS_HDR = {"Authorization": f"Bearer {RESEND_KEY}"}

def rs_all():
    s, d = req("GET", "https://api.resend.com/domains", RS_HDR)
    return {x["name"]: x for x in d.get("data", [])} if s == 200 else {}

def rs_add(d):
    s, r = req("POST", "https://api.resend.com/domains", RS_HDR,
               {"name": d, "region": "ap-northeast-1"})
    return r if s in (200, 201) and isinstance(r, dict) else None

def rs_detail(did):
    s, d = req("GET", f"https://api.resend.com/domains/{did}", RS_HDR)
    return d if s == 200 else None

def rs_verify(did):
    req("POST", f"https://api.resend.com/domains/{did}/verify", RS_HDR)

# ── Main ──────────────────────────────────────────────────

def onboard(domain: str, stage: bool, verify_only: bool):
    if domain.strip().lower() == HOLDING_CO:
        print(f"REFUSED: {HOLDING_CO} is the Google Workspace holding-co desk — "
              f"never put in Mailcow. See project_mail_architecture.md.")
        sys.exit(2)

    steps: dict[str, str] = {}

    zid = cf_zone_id(domain)
    if not zid:
        print(f"FAIL: no Cloudflare zone for '{domain}' — add it to CF first.")
        sys.exit(3)
    steps["cf zone"] = zid

    routing_on = cf_email_routing_enabled(zid)
    steps["cf email routing"] = "enabled" if routing_on else "disabled"
    effective_stage = stage or routing_on
    steps["mode"] = "staged (no MX swap)" if effective_stage else "full (MX -> Mailcow)"

    if verify_only:
        print(f"[{domain}] VERIFY ONLY")
        print(f"  mailcow registered: {domain in mc_domains()}")
        print(f"  mailcow DKIM: {'yes' if mc_dkim(domain) else 'no'}")
        print(f"  resend registered: {domain in rs_all()}")
        print(f"  CF Email Routing: {'on' if routing_on else 'off'}")
        for name, type_ in [(f"mail.{domain}","A"), (domain,"MX"), (domain,"TXT"),
                            (f"dkim._domainkey.{domain}","TXT"),
                            (f"resend._domainkey.{domain}","TXT"),
                            (f"send.{domain}","MX"), (f"send.{domain}","TXT")]:
            recs = cf_records(zid, type_, name)
            print(f"  {type_:4s} {name}: {len(recs)} record(s)")
        return

    # 1. Mailcow domain
    if domain in mc_domains(): steps["mc_domain"] = "exists"
    else: steps["mc_domain"] = mc_add_domain(domain)

    # 2. Mailcow DKIM
    dk = mc_dkim(domain) or mc_add_dkim(domain)
    steps["mc_dkim"] = "ready" if dk else "error"
    mc_dkim_txt = dk["dkim_txt"] if dk else None

    # 3. Resend
    rs_map = rs_all()
    if domain in rs_map:
        detail = rs_detail(rs_map[domain]["id"])
        steps["resend"] = f"exists ({rs_map[domain].get('status','?')})"
    else:
        added = rs_add(domain)
        detail = rs_detail(added["id"]) if added and added.get("id") else None
        steps["resend"] = "created" if detail else "error"

    resend_dkim = resend_mx = resend_spf = None
    if detail and "records" in detail:
        for r in detail["records"]:
            if r["record"] == "DKIM" and r["type"] == "TXT":
                val = r["value"].strip()
                if not val.startswith("k="): val = "k=rsa;" + val
                resend_dkim = val
            elif r.get("type") == "MX" and r.get("name","").startswith("send"):
                resend_mx = r["value"]
            elif r.get("type") == "TXT" and r.get("name","").startswith("send"):
                resend_spf = r["value"]

    # 4. CF DNS
    cf_out = {}
    cf_out["A mail"] = cf_upsert(zid, "A", f"mail.{domain}", MAIL_IP)

    if effective_stage:
        cf_out["MX root"] = "skipped (staged)"
        cf_out["SPF root"] = cf_upsert_spf(zid, domain, SPF_CF_ROUTING)
    else:
        mx_res = cf_upsert(zid, "MX", domain, MAIL_HOST, priority=10, replace_all=True)
        cf_out["MX root"] = mx_res
        if mx_res == "EMAIL_ROUTING_LOCKED":
            cf_out["SPF root"] = cf_upsert_spf(zid, domain, SPF_CF_ROUTING)
        else:
            cf_out["SPF root"] = cf_upsert_spf(zid, domain, SPF_MAILCOW)

    if mc_dkim_txt:
        cf_out["mailcow DKIM"] = cf_upsert(zid, "TXT", f"dkim._domainkey.{domain}",
                                            mc_dkim_txt, replace_all=True)
    if resend_dkim:
        cf_out["resend DKIM"] = cf_upsert(zid, "TXT", f"resend._domainkey.{domain}",
                                           resend_dkim, replace_all=True)
    if resend_mx:
        cf_out["send MX"] = cf_upsert(zid, "MX", f"send.{domain}", resend_mx,
                                       priority=10, replace_all=True)
    if resend_spf:
        cf_out["send SPF"] = cf_upsert_spf(zid, f"send.{domain}", resend_spf)

    # 5. Aliases
    existing_aliases = mc_aliases()
    existing_mboxes = mc_mailboxes()
    alias_out = {"created":0, "existed":0, "skipped":0}
    for lp in LOCAL_PARTS + ["@"]:
        addr = f"{lp}@{domain}" if lp != "@" else f"@{domain}"
        if addr == DEST: alias_out["skipped"] += 1; continue
        if addr in existing_mboxes: alias_out["skipped"] += 1; continue
        if addr in existing_aliases: alias_out["existed"] += 1; continue
        if mc_add_alias(addr, DEST): alias_out["created"] += 1
        else: alias_out["skipped"] += 1

    # Report
    print(f"\n─── Onboarded: {domain} ───")
    for k, v in steps.items(): print(f"  {k:22s} {v}")
    print("  CF DNS:")
    for k, v in cf_out.items(): print(f"    {k:20s} {v}")
    print(f"  Aliases: created={alias_out['created']} existed={alias_out['existed']} skipped={alias_out['skipped']}")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("domain")
    ap.add_argument("--stage", action="store_true",
                    help="Skip MX swap (use when keeping domain on CF Email Routing / Google W/S)")
    ap.add_argument("--verify-only", action="store_true",
                    help="Audit current state, don't change anything")
    args = ap.parse_args()
    onboard(args.domain.lower().strip(), args.stage, args.verify_only)

if __name__ == "__main__":
    main()
