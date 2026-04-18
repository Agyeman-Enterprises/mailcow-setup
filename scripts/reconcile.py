#!/usr/bin/env python3
"""
Reconcile: read domains.yml, call onboard-domain for each declared domain.
Fully idempotent — reruns are no-ops on already-configured domains.

Usage:
  python scripts/reconcile.py                # run against all domains
  python scripts/reconcile.py --verify-only  # audit all, no changes
  python scripts/reconcile.py --only a.com,b.com   # scope to specific domains
"""
from __future__ import annotations
import argparse, os, subprocess, sys
from pathlib import Path

def load_yaml(p: Path) -> dict:
    """Minimal YAML loader — avoids requiring pyyaml in CI."""
    try:
        import yaml
        return yaml.safe_load(p.read_text())
    except ImportError:
        pass
    # Tiny hand-rolled parser for this file's shape only.
    data: dict = {}
    current: str | None = None
    for raw in p.read_text().splitlines():
        line = raw.rstrip()
        if not line or line.lstrip().startswith("#"): continue
        if not line.startswith((" ", "-", "\t")):
            key = line.rstrip(":").strip()
            data[key] = []
            current = key
        elif line.lstrip().startswith("-"):
            val = line.lstrip()[1:].strip()
            if val.startswith("{"):
                # { domain: X, mode: Y, ... }
                body = val.strip("{} ").split(",")
                entry = {}
                for kv in body:
                    k, v = kv.split(":", 1)
                    entry[k.strip()] = v.strip().strip('"')
                if current: data[current].append(entry)
            else:
                if current: data[current].append({"domain": val.strip()})
    return data

def call_onboard(domain: str, stage: bool, verify_only: bool) -> int:
    script = Path(__file__).parent / "onboard-domain.py"
    cmd = [sys.executable, str(script), domain]
    if stage: cmd.append("--stage")
    if verify_only: cmd.append("--verify-only")
    print(f"\n>>> {domain}" + (" [stage]" if stage else "") + (" [verify]" if verify_only else ""))
    return subprocess.call(cmd)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--verify-only", action="store_true")
    ap.add_argument("--only", default="", help="Comma-separated list of domains to scope to")
    args = ap.parse_args()

    cfg_path = Path(__file__).parent.parent / "domains.yml"
    if not cfg_path.exists():
        print(f"missing: {cfg_path}"); sys.exit(1)
    cfg = load_yaml(cfg_path)

    only = {d.strip() for d in args.only.split(",") if d.strip()}

    plan: list[tuple[str, bool]] = []
    for entry in cfg.get("full", []):
        d = entry.get("domain") if isinstance(entry, dict) else entry
        plan.append((d, False))
    for entry in cfg.get("stage", []):
        d = entry.get("domain") if isinstance(entry, dict) else entry
        plan.append((d, True))
    for entry in cfg.get("cf_email_routing", []):
        d = entry.get("domain") if isinstance(entry, dict) else entry
        plan.append((d, True))

    if only:
        plan = [p for p in plan if p[0] in only]
        if not plan:
            print(f"no matches for --only {args.only}"); sys.exit(0)

    print(f"Reconciling {len(plan)} domain(s){'  [VERIFY ONLY]' if args.verify_only else ''}")
    fails = 0
    for domain, stage in plan:
        rc = call_onboard(domain, stage, args.verify_only)
        if rc != 0: fails += 1
    print(f"\n─── done: {len(plan)} attempted, {fails} failed ───")
    sys.exit(1 if fails else 0)

if __name__ == "__main__":
    main()
