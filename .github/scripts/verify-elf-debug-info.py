#!/usr/bin/env python3
import argparse
import subprocess
import sys
from pathlib import Path


REQUIRED_SECTIONS = {
    ".symtab": 128,
    ".strtab": 128,
    ".debug_info": 64,
    ".debug_abbrev": 32,
    ".debug_line": 64,
    ".debug_str": 64,
}


GO_METADATA_SECTIONS = (".gopclntab", ".gosymtab", ".go.buildinfo")


def section_names(canonical: str) -> tuple[str, ...]:
    if canonical.startswith(".debug_"):
        return canonical, ".z" + canonical[1:]
    return (canonical,)


def has_go_metadata(sections: dict[str, tuple[int, str]]) -> bool:
    return any(section in sections for section in GO_METADATA_SECTIONS)


def run(args: list[str]) -> str:
    return subprocess.check_output(args, text=True, stderr=subprocess.STDOUT)


def parse_sections(readelf_output: str) -> dict[str, tuple[int, str]]:
    sections: dict[str, tuple[int, str]] = {}

    for raw_line in readelf_output.splitlines():
        if "]" not in raw_line:
            continue
        body = raw_line.split("]", 1)[1].split()
        if len(body) < 7:
            continue
        name = body[0]
        size_hex = body[4]
        flags = body[6]
        try:
            size = int(size_hex, 16)
        except ValueError:
            continue
        sections[name] = (size, flags)

    return sections


def verify(path: Path, require_compressed: bool) -> list[str]:
    errors: list[str] = []

    try:
        file_output = run(["file", str(path)])
    except (FileNotFoundError, subprocess.CalledProcessError) as exc:
        return [f"{path}: failed to inspect file type: {exc}"]

    if "ELF" not in file_output:
        return [f"{path}: expected an ELF binary, got: {file_output.strip()}"]
    if "not stripped" not in file_output:
        errors.append(f"{path}: binary is stripped or lacks a normal symbol table: {file_output.strip()}")

    try:
        sections = parse_sections(run(["readelf", "-SW", str(path)]))
    except (FileNotFoundError, subprocess.CalledProcessError) as exc:
        errors.append(f"{path}: failed to inspect ELF sections: {exc}")
        return errors

    for section, min_size in REQUIRED_SECTIONS.items():
        found_name = None
        found = None
        for name in section_names(section):
            found = sections.get(name)
            if found is not None:
                found_name = name
                break
        if found is None:
            if section == ".debug_str" and has_go_metadata(sections):
                continue
            errors.append(f"{path}: missing required section {section}")
            continue
        size, flags = found
        if size < min_size:
            errors.append(f"{path}: section {found_name} is too small: {size} bytes < {min_size} bytes")
        compressed = found_name is not None and (found_name.startswith(".zdebug_") or "C" in flags)
        if require_compressed and section.startswith(".debug_") and not compressed:
            errors.append(f"{path}: section {section} is not compressed")

    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify ELF binaries keep usable symbol and DWARF debug sections.")
    parser.add_argument("--require-compressed", action="store_true", help="Require DWARF debug sections to be compressed.")
    parser.add_argument("binaries", nargs="+", type=Path)
    args = parser.parse_args()

    all_errors: list[str] = []
    for binary in args.binaries:
        all_errors.extend(verify(binary, args.require_compressed))

    for error in all_errors:
        print(error, file=sys.stderr)

    return 1 if all_errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
