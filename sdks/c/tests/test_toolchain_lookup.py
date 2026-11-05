#!/usr/bin/env python3
"""Offline GNU make regression tests; fixture compilers only answer --version."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


class ToolchainLookupTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="thru-lookup-")
        self.root = Path(self.temp.name)
        self.project = self.root / "workspace" / "project"
        self.project.mkdir(parents=True)
        self.installed = self.root / "installed" / "toolchain"
        self.compiler(self.installed)
        self.makefile = Path(os.environ.get(
            "THRU_GCC_MK", Path(__file__).resolve().parents[1] /
            "thru-sdk/config/extra/with-gcc.mk"))
        self.addCleanup(self.temp.cleanup)

    @staticmethod
    def compiler(root, prefix="riscv64-unknown-elf-"):
        binary = root / "bin" / (prefix + "gcc")
        binary.parent.mkdir(parents=True, exist_ok=True)
        binary.write_text("#!/bin/sh\n[ \"$1\" = --version ] || exit 99\n"
                          "printf 'fixture compiler (path lookup only)\\n'\n")
        binary.chmod(0o755)

    def make(self, expression, toolchain=None, sysroot=None):
        selected = toolchain or self.installed
        source = f"RISCV_TOOLCHAIN_ROOT := {selected}\n"
        if sysroot is not None:
            source += f"RISCV_SYSROOT := {sysroot}\n"
        source += f"include {self.makefile}\n"
        source += f"RESULT := {expression}\n.PHONY: probe\n"
        source += "probe:\n\t@printf 'RESULT=%s\\n' '$(RESULT)'\n"
        return subprocess.run(["make", "--no-print-directory", "-f", "-", "probe"],
                              cwd=self.project, input=source, text=True,
                              capture_output=True, timeout=10)

    def lookup(self, start=None, fallback=None):
        start = start or self.project
        fallback = fallback or self.installed
        return self.make(f"$(call _find-thru-toolchain-rec,{start},{fallback})")

    def assert_path(self, result, expected):
        self.assertEqual(result.returncode, 0, result.stderr)
        actual = next(line.removeprefix("RESULT=").strip()
                      for line in result.stdout.splitlines() if line.startswith("RESULT="))
        self.assertEqual(Path(actual), expected)

    def test_installation_outside_project_ancestry(self):
        self.assert_path(self.lookup(), self.installed)

    def test_project_local_wins_over_installation(self):
        local = self.project / ".thru/sdk/toolchain"
        self.compiler(local)
        self.assert_path(self.lookup(), local)

    def test_ancestor_wins_over_installation(self):
        local = self.project.parent / ".thru/sdk/toolchain"
        self.compiler(local)
        self.assert_path(self.lookup(), local)

    def test_nearest_local_installation_wins(self):
        ancestor = self.project.parent / ".thru/sdk/toolchain"
        local = self.project / ".thru/sdk/toolchain"
        self.compiler(ancestor)
        self.compiler(local)
        self.assert_path(self.lookup(), local)

    def test_incomplete_local_directory_is_ignored(self):
        (self.project / ".thru/sdk/toolchain/bin").mkdir(parents=True)
        self.assert_path(self.lookup(), self.installed)

    def test_wrong_prefix_local_compiler_is_ignored(self):
        self.compiler(self.project / ".thru/sdk/toolchain", "another-target-")
        self.assert_path(self.lookup(), self.installed)

    def test_search_reaching_filesystem_root_uses_installation(self):
        self.assert_path(self.lookup(start=Path("/")), self.installed)

    def test_missing_installation_reports_recovery_options(self):
        missing = self.root / "missing"
        result = self.lookup(fallback=missing)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn(str(missing), result.stderr)
        self.assertIn("thru dev toolchain install", result.stderr)
        self.assertIn("RISCV_TOOLCHAIN_ROOT", result.stderr)

    def test_installation_without_compiler_is_rejected(self):
        missing = self.root / "incomplete"
        (missing / "bin").mkdir(parents=True)
        result = self.lookup(fallback=missing)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("RISCV_TOOLCHAIN_ROOT", result.stderr)

    def test_explicit_toolchain_override_is_preserved(self):
        custom = self.root / "custom"
        self.compiler(custom)
        self.assert_path(self.make("$(RISCV_TOOLCHAIN_ROOT)", toolchain=custom), custom)

    def test_sysroot_uses_selected_toolchain(self):
        self.assert_path(self.make("$(RISCV_SYSROOT)"), self.installed / "picolibc/thruvm")

    def test_explicit_sysroot_override_is_preserved(self):
        custom = self.root / "custom-sysroot"
        self.assert_path(self.make("$(RISCV_SYSROOT)", sysroot=custom), custom)

    def test_explicit_nix_prefix_detection_is_preserved(self):
        custom = self.root / "nix"
        self.compiler(custom, "riscv64-none-elf-")
        result = self.make("$(RISCV_PREFIX)", toolchain=custom)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("RESULT=riscv64-none-elf-\n", result.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
