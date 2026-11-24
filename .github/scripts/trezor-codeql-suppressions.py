#!/usr/bin/env python3
"""Mark only reviewed Trezor test-only false positives as accepted in SARIF.

Reviewed against CodeQL 2.27.5 at 059a6f3f2fd639fc15a7dc032087beaec7ae28c1.
Rule, source-root-relative URI, both location fingerprints and source digests
must match. Digests also pin the cfg(test) boundaries, not just flagged lines.
A source/fingerprint change requires re-review; it is never blanket-exempted.
The unchanged ledger-codeql-gate.py still decides which findings block CI.
"""

import argparse
import hashlib
import json
from pathlib import Path


SOURCE_ROOT = Path(__file__).resolve().parents[2] / "rpc/thru-trezor"
SOURCE_DIGESTS = {
    "src/lib.rs": "746d32451a4698c0a69c8120042c280d7e3459ca961726a85386f4fa8ddf6b6c",
    "src/vectors.rs": "df7c9b1f3a96b1450c0b05d775e41b81e21f2e0e712f1303d6499e37cbb4f7d5",
    "src/signer.rs": "4ed8d134bf8a4620b601d526091d8782bcf6030765301f63206e59098d107692",
}
REVIEWS = (
    {
        "rule": "rust/hard-coded-cryptographic-value",
        "uri": "src/vectors.rs",
        "sources": ("src/lib.rs", "src/vectors.rs"),
        "fingerprints": (
            ("cbeed9a89ac6448d:1", "10"),
            ("41e7a3aa496b151d:1", "1"),
            ("393ad23f96a5d5a6:1", "1"),
            ("105e28201cc58bf3:1", "1"),
            ("c5ff9aafe316aea3:1", "1"),
            ("fd8a01643f7a9151:1", "1"),
            ("a7a5a5db44ee1479:1", "1"),
            ("26ec7ecc262876ff:1", "1"),
        ),
        "justification": (
            "Reviewed Trezor test-only false positive: aead_json deliberately uses "
            "fixed nonce counters at byte boundaries with a public label-derived "
            "key to generate reproducible AEAD reference vectors. The vectors "
            "module is compiled only under cfg(test); these are not production nonces."
        ),
    },
    {
        "rule": "rust/cleartext-logging",
        "uri": "src/signer.rs",
        "sources": ("src/signer.rs",),
        "fingerprints": (("c23ef299e3c0e790:1", "0"),),
        "justification": (
            "Reviewed Trezor test-only false positive: the assertion diagnostic in "
            "eoa_auth_requests_are_checked_before_the_device formats an InvalidRequest "
            "containing public account addresses derived from fixed test seeds, "
            "not private keys or credentials. The assertion is in a cfg(test) module."
        ),
    },
)


def suppress_reviewed(document, source_root=SOURCE_ROOT):
    current = {}
    for uri in SOURCE_DIGESTS:
        try:
            current[uri] = hashlib.sha256((source_root / uri).read_bytes()).hexdigest()
        except FileNotFoundError:
            current[uri] = None

    approved = {}
    for review in REVIEWS:
        if not all(current[uri] == SOURCE_DIGESTS[uri] for uri in review["sources"]):
            print(f"Review expired for {review['uri']}: source changed or missing; findings remain gated.")
            continue
        for line_hash, column_hash in review["fingerprints"]:
            approved[(review["rule"], review["uri"], line_hash, column_hash)] = review["justification"]

    justifications = {review["justification"] for review in REVIEWS}
    count = 0
    for run in document.get("runs", []):
        for result in run.get("results", []):
            # Recompute our own suppressions on reruns, revoking expired reviews.
            if "suppressions" in result:
                result["suppressions"] = [
                    s for s in result["suppressions"] if s.get("justification") not in justifications
                ]
            locations = result.get("locations", [])
            if len(locations) != 1:
                continue
            artifact = locations[0].get("physicalLocation", {}).get("artifactLocation", {})
            if artifact.get("uriBaseId") != "%SRCROOT%":
                continue
            fingerprints = result.get("partialFingerprints", {})
            key = (
                result.get("ruleId"),
                artifact.get("uri"),
                fingerprints.get("primaryLocationLineHash"),
                fingerprints.get("primaryLocationStartColumnFingerprint"),
            )
            if key in approved:
                result.setdefault("suppressions", []).append({
                    "kind": "external",
                    "status": "accepted",
                    "justification": approved[key],
                })
                count += 1
    return count


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("sarif", type=Path, help="host CodeQL SARIF file to annotate in place")
    args = parser.parse_args()
    document = json.loads(args.sarif.read_text())
    count = suppress_reviewed(document)
    args.sarif.write_text(json.dumps(document, indent=2) + "\n")
    print(f"CodeQL: {count} reviewed test-only result(s) suppressed; all other results remain gated.")


if __name__ == "__main__":
    main()
