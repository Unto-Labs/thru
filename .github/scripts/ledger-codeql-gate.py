#!/usr/bin/env python3
"""Fail the Ledger CodeQL job on blocking findings without code scanning.

thru-net has no GitHub Advanced Security, so the CodeQL action cannot upload
its SARIF to code scanning (ledger-app.yml sets `upload: never` and keeps the
SARIF as an artifact). This script reads that SARIF and applies the rule of
GitHub's default code-scanning check: a result blocks if its level is "error"
or its rule's security severity is 7.0 or more (high or critical). Every
unsuppressed result is listed and annotated; only blocking results fail.

Usage: ledger-codeql-gate.py [--path-prefix PREFIX] SARIF_FILE_OR_DIR...
Exit status: 0 no blocking results, 1 blocking results, 2 no SARIF found.
"""

import argparse
import json
import sys
from pathlib import Path

BLOCKING_SECURITY_SEVERITY = 7.0


def sarif_files(paths):
    for path in map(Path, paths):
        if path.is_dir():
            yield from sorted(path.rglob("*.sarif"))
        elif path.is_file():
            yield path


def find_rule(run, result):
    """Return the rule object of a result, or {} if the SARIF has none."""
    tool = run.get("tool", {})
    extensions = tool.get("extensions", [])
    ref = result.get("rule", {})
    if "index" in ref:
        component = tool.get("driver", {})
        if "toolComponent" in ref:
            index = ref["toolComponent"].get("index", -1)
            component = extensions[index] if 0 <= index < len(extensions) else {}
        rules = component.get("rules", [])
        if 0 <= ref["index"] < len(rules):
            return rules[ref["index"]]
    rule_id = result.get("ruleId") or ref.get("id")
    for component in [tool.get("driver", {}), *extensions]:
        for rule in component.get("rules", []):
            if rule.get("id") == rule_id:
                return rule
    return {}


def suppressed(result):
    return any(s.get("status", "accepted") == "accepted" for s in result.get("suppressions", []))


def escape(text, prop=False):
    text = str(text).replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
    return text.replace(":", "%3A").replace(",", "%2C") if prop else text


def findings(paths, prefix):
    for sarif in sarif_files(paths):
        for run in json.loads(sarif.read_text()).get("runs", []):
            for result in run.get("results", []):
                if suppressed(result):
                    continue
                rule = find_rule(run, result)
                level = result.get("level") or rule.get("defaultConfiguration", {}).get("level", "warning")
                try:
                    severity = float(rule.get("properties", {}).get("security-severity", ""))
                except ValueError:
                    severity = None
                location = (result.get("locations") or [{}])[0].get("physicalLocation", {})
                uri = location.get("artifactLocation", {}).get("uri", "")
                yield {
                    "rule": result.get("ruleId") or rule.get("id", "?"),
                    "level": level,
                    "severity": severity,
                    "path": f"{prefix.rstrip('/')}/{uri}" if prefix and uri else uri,
                    "line": location.get("region", {}).get("startLine", 1),
                    "message": result.get("message", {}).get("text", ""),
                    "blocking": level == "error" or (severity or 0.0) >= BLOCKING_SECURITY_SEVERITY,
                }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--path-prefix", default="", help="repository path of the CodeQL source root")
    parser.add_argument("sarif", nargs="+", help="SARIF files or directories holding *.sarif")
    args = parser.parse_args(argv)

    if not any(sarif_files(args.sarif)):
        print(f"no SARIF found in {' '.join(args.sarif)}", file=sys.stderr)
        return 2

    results = list(findings(args.sarif, args.path_prefix))
    for f in results:
        severity = "-" if f["severity"] is None else f"{f['severity']:.1f}"
        tag = "BLOCKING" if f["blocking"] else "listed"
        print(f"{tag:8} {f['level']:7} sev={severity:4} {f['rule']} {f['path']}:{f['line']}: {f['message']}")
        command = "error" if f["blocking"] else "warning"
        print(f"::{command} file={escape(f['path'], True)},line={f['line']},"
              f"title={escape(f['rule'], True)}::{escape(f['message'])}")

    blocking = sum(f["blocking"] for f in results)
    print(f"CodeQL: {len(results)} result(s), {blocking} blocking "
          f"(level error, or security severity >= {BLOCKING_SECURITY_SEVERITY}).")
    return 1 if blocking else 0


if __name__ == "__main__":
    sys.exit(main())
