"""Detect later-stack files, including files removed relative to the CI base."""

import os
import re
import subprocess
from pathlib import Path


def present_or_previously_tracked(root: Path, paths: tuple[str, ...]) -> bool:
    if any((root / path).exists() for path in paths):
        return True
    base = os.environ.get("LEDGER_BASE_SHA", "")
    if not base or base == "0" * 40:
        return False
    if not re.fullmatch(r"[0-9a-fA-F]{40}", base):
        raise ValueError("LEDGER_BASE_SHA must be a full commit SHA")
    subprocess.run(["git", "cat-file", "-e", f"{base}^{{commit}}"], cwd=root, check=True)
    for path in paths:
        result = subprocess.run(
            ["git", "cat-file", "-e", f"{base}:{path}"], cwd=root,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        if result.returncode == 0:
            return True
        if result.returncode != 128:
            raise RuntimeError(f"git cat-file failed for {path}: {result.returncode}")
    return False
