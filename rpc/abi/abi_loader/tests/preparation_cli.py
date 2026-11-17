#!/usr/bin/env python3
"""Cross-process preparation contract. Run after building both Rust workspaces.

python3 rpc/abi/abi_loader/tests/preparation_cli.py --abi rpc/abi/target/debug/abi \
    --abi-flatten rpc/abi/target/debug/abi-flatten --thru rpc/cli/target/debug/thru
"""
import argparse
import json
import pathlib
import subprocess
import tempfile


def document(package, types, imports=()):
    return {"abi": {"package": package, "name": "Authored display name", "abi-version": 1,
                    "package-version": "2.3.4", "description": "Authored description",
                    "imports": list(imports), "options": {"program-metadata": {"root-types": {
                        "instruction-root": "Root", "account-root": "Root", "events": "Root", "errors": "Root"}}}},
            "types": types}


def packed_value(name):
    return {"name": name, "kind": {"struct": {"packed": True, "fields": [
        {"name": "value", "field-type": {"primitive": "u64"}},
    ]}}}


def local(path):
    return {"type": "path", "path": path}


def remote(network="testnet"):
    return {"type": "onchain", "address": "taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQE", "network": network}


def reference(name, package=None):
    value = {"name": name}
    if package is not None:
        value["package"] = package
    return {"name": "Root", "kind": {"type-ref": value}}


def write(directory, name, value):
    path = directory / name
    path.write_text(json.dumps(value), encoding="utf-8")
    return path


def invoke(command, source, destination, success):
    result = subprocess.run([*command, "--file", str(source), "--output", str(destination)],
                            capture_output=True, text=True)
    assert (result.returncode == 0) == success, (command, result.stdout, result.stderr)
    if success:
        return destination.read_bytes()
    assert not destination.exists(), (command, "failed command published output")
    return result.stderr


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for binary in ("abi", "abi-flatten", "thru"):
        parser.add_argument("--" + binary, required=True, type=pathlib.Path)
    args = parser.parse_args()
    abi, flat, thru = (str(path.resolve()) for path in (args.abi, args.abi_flatten, args.thru))
    prepare = [[abi, "prep-for-publish", "--network", "testnet"],
               [thru, "abi", "prep-for-publish", "--target-network", "testnet"]]
    flatten = [[flat], [abi, "flatten"], [thru, "abi", "flatten"]]
    field = lambda name, kind: {"name": name, "field-type": kind}
    variant = lambda name, tag: {"name": name, "tag-value": tag, "variant-type": {"primitive": "u8"}}
    root_type = {"name": "Root", "kind": {"struct": {"packed": True, "fields": [
        field("z_first", {"primitive": "u8"}),
        field("a_second", {"type-ref": {"name": "fixture.shared.Shared", "package": "fixture.shared"}}),
        field("enum_payload", {"enum": {"packed": True, "tag-ref": {"field-ref": {"path": ["z_first"]}},
              "variants": [variant("ZVariant", 9), variant("AVariant", 2)]}}),
        field("union_payload", {"union": {"packed": True, "variants": [
            {"name": "ZUnion", "variant-type": {"primitive": "u64"}},
            {"name": "AUnion", "variant-type": {"primitive": "u8"}}]}}),
    ]}}}
    outputs = []
    # Each invocation is a fresh process; each iteration is an independent checkout.
    for reverse in (False, True):
        with tempfile.TemporaryDirectory() as temporary:
            directory = pathlib.Path(temporary)
            write(directory, "shared.yaml", document("fixture.shared", [packed_value("Shared")]))
            write(directory, "left.yaml", document("fixture.left", [packed_value("Left")], [local("./shared.yaml")]))
            write(directory, "right.yaml", document("fixture.right", [packed_value("Right")], [local("shared.yaml")]))
            imports = [local("left.yaml"), local("right.yaml")]
            if reverse:
                imports.reverse()
            source = write(directory, "root.yaml", document("fixture.root", [root_type], imports))
            for number, command in enumerate(prepare + flatten):
                output = invoke(command, source, directory / f"output-{number}.yaml", True)
                outputs.append(output)
                for first, second in ((b"z_first", b"a_second"), (b"ZVariant", b"AVariant"), (b"ZUnion", b"AUnion")):
                    assert output.index(first) < output.index(second)
                for metadata in (b"Authored display name", b"Authored description", b"2.3.4",
                                 b"instruction-root: Root", b"account-root: Root", b"events: Root", b"errors: Root"):
                    assert metadata in output
                assert b"imports: []" in output
    assert all(output == outputs[0] for output in outputs), "CLI/process/checkout bytes differ"

    with tempfile.TemporaryDirectory() as temporary:
        directory = pathlib.Path(temporary)
        for role in ("instruction-root", "account-root", "errors", "events"):
            missing = document("fixture.root", [packed_value("Root")])
            missing["abi"]["options"]["program-metadata"]["root-types"][role] = "Missing"
            source = write(directory, "root.yaml", missing)
            for index, command in enumerate(prepare + flatten):
                error = invoke(command, source, directory / f"missing-root-{role}-{index}.yaml", False)
                assert f"Unresolved declared {role} root 'Missing'" in error
        # Resolvable references can still form an impossible recursive layout.
        recursive = document("fixture.root", [reference("Root")])
        source = write(directory, "root.yaml", recursive)
        for index, command in enumerate(prepare):
            invoke(command, source, directory / f"recursive-{index}.yaml", False)
        write(directory, "dep.yaml", document("fixture.dep", [packed_value("Shared")]))
        invalid_references = [reference("fixture.dep.extra.Shared"), reference("Shared", "fixture.dep.extra"),
                              reference("fixture.Shared"), reference("Shared", "fixture"),
                              reference("fixture.dep.Missing"), reference("Missing", "fixture.dep"),
                              reference("unknown.Shared"), reference("Shared", "unknown"),
                              reference("fixture.dep.Shared", "unknown")]
        for number, invalid in enumerate(invalid_references):
            source = write(directory, "root.yaml", document("fixture.root", [invalid], [local("dep.yaml")]))
            for index, command in enumerate(prepare + flatten):
                invoke(command, source, directory / f"bad-{number}-{index}.yaml", False)
        # Both valid qualification spellings use the exact package, not a prefix.
        for number, valid in enumerate([reference("fixture.dep.Shared"), reference("Shared", "fixture.dep")]):
            source = write(directory, "root.yaml", document("fixture.root", [valid], [local("dep.yaml")]))
            results = [invoke(command, source, directory / f"good-{number}-{index}.yaml", True)
                       for index, command in enumerate(prepare + flatten)]
            assert all(result == results[0] for result in results)
        # Equal layouts still collide, including two different files in one package.
        for number, package in enumerate(("fixture.root", "fixture.dep", "fixture.other")):
            write(directory, "other.yaml", document(package, [packed_value("Shared")]))
            source = write(directory, "root.yaml", document("fixture.root", [], [local("dep.yaml"), local("other.yaml")]))
            for index, command in enumerate(prepare + flatten):
                error = invoke(command, source, directory / f"collision-{number}-{index}.yaml", False)
                assert "Conflicting declarations" in error
        for number, import_ in enumerate((remote("mainnet"), {"type": "http", "url": "https://invalid.example/abi"},
                                          {"type": "git", "url": "https://invalid.example/git", "ref": "main", "path": "abi.yaml"})):
            source = write(directory, "root.yaml", document("fixture.root", [packed_value("Root")], [import_]))
            for index, command in enumerate(prepare):
                invoke(command, source, directory / f"policy-{number}-{index}.yaml", False)
        write(directory, "dep.yaml", document("fixture.dep", [packed_value("Shared")], [remote()]))
        source = write(directory, "root.yaml", document("fixture.root", [packed_value("Root")], [local("dep.yaml")]))
        for index, command in enumerate(prepare):
            error = invoke(command, source, directory / f"dependency-{index}.yaml", False)
            assert "Remote import found in local dependency" in error
        for number, external in enumerate((reference("external.pkg.Item"), reference("Item", "external.pkg"))):
            source = write(directory, "root.yaml", document("fixture.root", [external], [remote()]))
            results = [invoke(command, source, directory / f"remote-{number}-{index}.yaml", True)
                       for index, command in enumerate(prepare)]
            assert results[0] == results[1]
            assert (b"name: external.pkg.Item" if number == 0 else b"package: external.pkg") in results[0]
    print("Preparation and flatten CLI contracts passed")


if __name__ == "__main__":
    main()
