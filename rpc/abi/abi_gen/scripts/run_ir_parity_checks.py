#!/usr/bin/env python3
"""
Run IR parity checks between TypeScript and Rust codegen.

This script invokes the compliance harness in parity mode to ensure
TypeScript and Rust codegen produce equivalent results for all compliance
test cases.

Usage:
    python3 run_ir_parity_checks.py [--verbose] [--test-dir DIR] [--output FILE]
"""

import argparse
import subprocess
import sys
import os
from pathlib import Path


def find_project_root() -> Path:
    """Find the abi_gen project root directory."""
    script_dir = Path(__file__).parent.resolve()
    # Script is in abi_gen/scripts/, so parent is abi_gen
    return script_dir.parent


def find_compliance_tests_dir(project_root: Path) -> Path:
    """Find the compliance test cases directory."""
    tests_dir = project_root / "tests" / "compliance_tests" / "test_cases"
    if tests_dir.exists():
        return tests_dir
    # Fallback to just tests directory
    return project_root / "tests"


def build_compliance_harness(project_root: Path, verbose: bool) -> bool:
    """Build the compliance harness binary."""
    harness_dir = project_root / "tests" / "compliance_harness_rust"

    print("Building compliance harness...")
    cmd = ["cargo", "build", "--release"]
    if not verbose:
        cmd.append("--quiet")

    result = subprocess.run(
        cmd,
        cwd=harness_dir,
        capture_output=not verbose,
        text=True
    )

    if result.returncode != 0:
        print("Failed to build compliance harness:")
        if not verbose and result.stderr:
            print(result.stderr)
        return False

    print("Compliance harness built successfully.")
    return True


def run_parity_checks(
    project_root: Path,
    test_dir: Path,
    verbose: bool,
    output_file: str | None
) -> bool:
    """Run the compliance harness in parity mode."""
    harness_binary = (
        project_root / "tests" / "compliance_harness_rust" /
        "target" / "release" / "compliance_harness"
    )

    if not harness_binary.exists():
        print(f"Compliance harness binary not found at {harness_binary}")
        return False

    cmd = [str(harness_binary), str(test_dir), "--parity"]
    if verbose:
        cmd.append("--verbose")
    if output_file:
        cmd.extend(["--output", output_file])

    print(f"\nRunning parity checks on {test_dir}...")
    print(f"Command: {' '.join(cmd)}\n")

    result = subprocess.run(cmd, text=True)

    return result.returncode == 0


def main():
    parser = argparse.ArgumentParser(
        description="Run IR parity checks between TypeScript and Rust codegen"
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Enable verbose output"
    )
    parser.add_argument(
        "--test-dir",
        type=str,
        help="Directory containing test cases (default: compliance_tests/test_cases)"
    )
    parser.add_argument(
        "--output", "-o",
        type=str,
        help="Output JSON results to file"
    )
    parser.add_argument(
        "--build-only",
        action="store_true",
        help="Only build the harness, don't run tests"
    )

    args = parser.parse_args()

    project_root = find_project_root()
    print(f"Project root: {project_root}")

    # Build the harness
    if not build_compliance_harness(project_root, args.verbose):
        sys.exit(1)

    if args.build_only:
        print("Build completed (--build-only specified)")
        sys.exit(0)

    # Determine test directory
    if args.test_dir:
        test_dir = Path(args.test_dir)
        if not test_dir.is_absolute():
            test_dir = project_root / test_dir
    else:
        test_dir = find_compliance_tests_dir(project_root)

    if not test_dir.exists():
        print(f"Test directory not found: {test_dir}")
        sys.exit(1)

    print(f"Test directory: {test_dir}")

    # Run parity checks
    success = run_parity_checks(project_root, test_dir, args.verbose, args.output)

    if success:
        print("\n=== All parity checks passed! ===")
        sys.exit(0)
    else:
        print("\n=== Parity checks failed! ===")
        sys.exit(1)


if __name__ == "__main__":
    main()
