#!/usr/bin/env python3
"""Advisory audit of @thru/ledger's runtime dependency closure (audit U6).

`pnpm audit` reports on the whole web/ workspace lockfile, and its JSON
findings list a single example path, so it cannot say whether an advisory
reaches @thru/ledger. This script computes the runtime closure of
web/packages/ledger from web/pnpm-lock.yaml: its dependencies, its peer
dependencies (the Ledger DMK transports users install next to it; the lock
records them under devDependencies) and workspace packages it links
(@thru/sdk), followed transitively through the lockfile's snapshots. It then
runs `pnpm audit --json` and fails if any advisory's affected version is in
that closure.

Usage: python3 .github/scripts/ledger-npm-audit.py [--web DIR] [--audit-json FILE]
  --audit-json FILE  use a saved `pnpm audit --json` report instead of running it

Needs PyYAML and, unless --audit-json is given, pnpm and registry access.
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

import yaml
from ledger_stack_presence import present_or_previously_tracked


PACKAGE = "packages/ledger"


def base_version(v: str) -> str:
    return str(v).split("(", 1)[0]


def closure(lock: dict, web: Path) -> set[tuple[str, str]]:
    importers = lock["importers"]
    snapshots = lock["snapshots"]
    if not isinstance(snapshots, dict):
        raise ValueError("pnpm lockfile has no snapshots mapping")
    seen: set[str] = set()
    out: set[tuple[str, str]] = set()
    stack: list[tuple[str, str]] = []

    def add_importer(path: str, include_peers: bool) -> None:
        imp = importers[path]
        deps = dict(imp.get("dependencies", {}))
        deps.update(imp.get("optionalDependencies", {}))
        if include_peers:
            pkg = json.loads((web / path / "package.json").read_text())
            dev = imp.get("devDependencies", {})
            for name in pkg.get("peerDependencies", {}):
                if name in dev:
                    deps[name] = dev[name]
        for name, spec in deps.items():
            version = str(spec["version"])
            if version.startswith("link:"):
                linked = _norm(f"{path}/{version[len('link:'):]}")
                if linked not in importers:
                    raise ValueError(f"missing linked lockfile importer: {linked}")
                if linked not in seen:
                    seen.add(linked)
                    add_importer(linked, include_peers=False)
                continue
            stack.append((name, version))

    add_importer(PACKAGE, include_peers=True)
    while stack:
        name, version = stack.pop()
        key = f"{name}@{version}"
        if key in seen:
            continue
        seen.add(key)
        out.add((name, base_version(version)))
        if key not in snapshots:
            raise ValueError(f"missing lockfile snapshot: {key}")
        snap = snapshots[key] or {}
        for section in ("dependencies", "optionalDependencies"):
            for dep, dep_version in (snap.get(section) or {}).items():
                stack.append((dep, str(dep_version)))
    return out


def _norm(path: str) -> str:
    parts: list[str] = []
    for p in path.split("/"):
        if p == "..":
            parts.pop()
        elif p not in ("", "."):
            parts.append(p)
    return "/".join(parts)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--web", type=Path, default=Path(__file__).resolve().parents[2] / "web")
    ap.add_argument("--audit-json", type=Path)
    args = ap.parse_args()

    lock = yaml.safe_load((args.web / "pnpm-lock.yaml").read_text())
    if not isinstance(lock, dict) or not isinstance(lock.get("importers"), dict):
        raise ValueError("pnpm lockfile has no importers mapping")
    manifest = args.web / PACKAGE / "package.json"
    if (PACKAGE not in lock["importers"]
            and not manifest.exists()
            and not present_or_previously_tracked(
                args.web.parent, ("web/packages/ledger/package.json",))):
        print("SKIP: @thru/ledger is not present in this stack")
        return 0
    if PACKAGE not in lock["importers"] or not manifest.is_file():
        raise ValueError("@thru/ledger requires both its package.json and lockfile importer")
    pkgs = closure(lock, args.web)
    print(f"@thru/ledger runtime closure: {len(pkgs)} packages")

    if args.audit_json:
        report = json.loads(args.audit_json.read_text())
    else:
        r = subprocess.run(["pnpm", "audit", "--json"], cwd=args.web, capture_output=True, text=True)
        if r.returncode not in (0, 1):
            print(f"pnpm audit failed (rc={r.returncode}):\n{r.stderr}", file=sys.stderr)
            return 2
        try:
            report = json.loads(r.stdout)
        except json.JSONDecodeError:
            print(f"pnpm audit failed (rc={r.returncode}):\n{r.stderr}", file=sys.stderr)
            return 2
    if not isinstance(report, dict) or not isinstance(report.get("advisories"), dict):
        print("unexpected pnpm audit output: missing advisories mapping", file=sys.stderr)
        return 2
    if not args.audit_json and r.returncode == 1 and not report["advisories"]:
        print("pnpm audit failed without advisory details", file=sys.stderr)
        return 2

    hits = []
    for adv in report["advisories"].values():
        if (not isinstance(adv, dict) or not isinstance(adv.get("module_name"), str)
                or not isinstance(adv.get("severity"), str)
                or not isinstance(adv.get("findings"), list)
                or not adv["findings"]
                or any(not isinstance(f, dict) or not isinstance(f.get("version"), str)
                       for f in adv["findings"])):
            raise ValueError("pnpm advisory is missing required findings")
        versions = {f.get("version") for f in adv.get("findings", [])}
        for v in sorted(v for v in versions if (adv["module_name"], v) in pkgs):
            hits.append((adv["severity"], adv["module_name"], v, adv.get("title", ""), adv.get("url", "")))
    total = report.get("metadata", {}).get("vulnerabilities", {})
    print(f"workspace-wide pnpm audit totals (all packages): {total}")
    if hits:
        print(f"FAIL: {len(hits)} advisories reach @thru/ledger:")
        for sev, name, v, title, url in sorted(hits):
            print(f"  {sev:<9} {name}@{v}: {title} {url}")
        return 1
    print("OK: no known advisories in @thru/ledger's runtime dependency closure")
    return 0


if __name__ == "__main__":
    sys.exit(main())
