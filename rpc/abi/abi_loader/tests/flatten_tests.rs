use abi_loader::{flatten, flatten_to_yaml, AbiFile};
use std::path::PathBuf;

fn type_library_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../type-library")
}

#[test]
fn flatten_token_program() {
    let file = type_library_path().join("tn_token_program.abi.yaml");
    let include_dirs = vec![type_library_path()];

    let result = flatten(&file, &include_dirs).expect("flatten should succeed");

    // Verify imports are cleared
    assert!(
        result.abi.imports.is_empty(),
        "Flattened ABI should have no imports"
    );

    // Verify types from imports are included
    let type_names: Vec<&str> = result.types.iter().map(|t| t.name.as_str()).collect();

    // Types from thru_primitives.abi.yaml
    assert!(
        type_names.contains(&"Hash"),
        "Should contain Hash from primitives"
    );
    assert!(
        type_names.contains(&"Pubkey"),
        "Should contain Pubkey from primitives"
    );
    assert!(
        type_names.contains(&"Signature"),
        "Should contain Signature from primitives"
    );

    // Types from state_proof.abi.yaml
    assert!(
        type_names.contains(&"StateProof"),
        "Should contain StateProof"
    );

    // Types from root file (tn_token_program.abi.yaml)
    assert!(
        type_names.contains(&"TokenInstruction"),
        "Should contain TokenInstruction"
    );
    assert!(
        type_names.contains(&"TokenProgramAccount"),
        "Should contain TokenProgramAccount"
    );

    // Verify options are preserved from root file
    assert_eq!(
        result
            .abi
            .options
            .program_metadata
            .root_types
            .instruction_root,
        Some("TokenInstruction".to_string())
    );
    assert_eq!(
        result.abi.options.program_metadata.root_types.account_root,
        Some("TokenProgramAccount".to_string())
    );

    // Verify package info from root file
    assert_eq!(result.abi.package, "thru.program.token");
}

#[test]
fn flatten_primitives_no_imports() {
    let file = type_library_path().join("thru_primitives.abi.yaml");
    let include_dirs = vec![type_library_path()];

    let result = flatten(&file, &include_dirs).expect("flatten should succeed");

    // File with no imports should still work
    assert!(result.abi.imports.is_empty());

    let type_names: Vec<&str> = result.types.iter().map(|t| t.name.as_str()).collect();
    assert!(type_names.contains(&"Hash"));
    assert!(type_names.contains(&"Pubkey"));
    assert!(type_names.contains(&"Signature"));
    assert!(type_names.contains(&"Timestamp"));
    assert!(type_names.contains(&"Duration"));
    assert!(type_names.contains(&"Date"));
    assert!(type_names.contains(&"FixedPoint"));
    assert!(type_names.contains(&"InstructionData"));
    assert_eq!(type_names.len(), 8);
}

#[test]
fn flatten_state_proof_with_single_import() {
    let file = type_library_path().join("state_proof.abi.yaml");
    let include_dirs = vec![type_library_path()];

    let result = flatten(&file, &include_dirs).expect("flatten should succeed");

    assert!(result.abi.imports.is_empty());

    let type_names: Vec<&str> = result.types.iter().map(|t| t.name.as_str()).collect();

    // Should include types from thru_primitives
    assert!(type_names.contains(&"Hash"));
    assert!(type_names.contains(&"Pubkey"));

    // Should include types from state_proof itself
    assert!(type_names.contains(&"StateProof"));
}

#[test]
fn flatten_to_yaml_produces_valid_yaml() {
    let file = type_library_path().join("thru_primitives.abi.yaml");
    let include_dirs = vec![type_library_path()];

    let yaml =
        abi_loader::flatten_to_yaml(&file, &include_dirs).expect("flatten_to_yaml should succeed");

    // Should be parseable back as AbiFile
    let parsed: AbiFile = serde_yml::from_str(&yaml).expect("Should parse as valid ABI YAML");

    assert_eq!(parsed.abi.package, "thru.common.primitives");
    assert!(parsed.abi.imports.is_empty());
}

#[test]
fn flatten_fails_for_missing_import() {
    // Create a temp file with a non-existent import
    let temp_dir = std::env::temp_dir();
    let temp_file = temp_dir.join("test_missing_import.abi.yaml");

    let content = r#"
abi:
  package: test.missing
  abi-version: 1
  package-version: "1.0.0"
  description: "Test file with missing import"
  imports:
    - type: path
      path: "nonexistent_file.abi.yaml"
types: []
"#;

    std::fs::write(&temp_file, content).expect("Failed to write temp file");

    let result = flatten(&temp_file, &[]);

    assert!(result.is_err(), "Should fail when import is not found");

    // Cleanup
    let _ = std::fs::remove_file(&temp_file);
}

#[test]
fn import_resolver_handles_circular_imports() {
    use abi_loader::ImportResolver;

    // Both files import each other - should not cause infinite loop
    // because ImportResolver tracks loaded files
    let temp_dir = std::env::temp_dir();
    let file_a = temp_dir.join("circular_a.abi.yaml");
    let file_b = temp_dir.join("circular_b.abi.yaml");

    let content_a = format!(
        r#"
abi:
  package: test.circular.a
  abi-version: 1
  package-version: "1.0.0"
  description: "Circular import test A"
  imports:
    - type: path
      path: "{}"
types:
  - name: TypeA
    kind:
      primitive: u32
"#,
        file_b.file_name().unwrap().to_str().unwrap()
    );

    let content_b = format!(
        r#"
abi:
  package: test.circular.b
  abi-version: 1
  package-version: "1.0.0"
  description: "Circular import test B"
  imports:
    - type: path
      path: "{}"
types:
  - name: TypeB
    kind:
      primitive: u64
"#,
        file_a.file_name().unwrap().to_str().unwrap()
    );

    std::fs::write(&file_a, content_a).expect("Failed to write file_a");
    std::fs::write(&file_b, content_b).expect("Failed to write file_b");

    let mut resolver = ImportResolver::new(vec![temp_dir.clone()]);
    let result = resolver.load_file_with_imports(&file_a, false);

    // Should succeed without infinite loop
    assert!(result.is_ok(), "Should handle circular imports gracefully");

    // Should have loaded both files exactly once
    assert_eq!(resolver.loaded_file_count(), 2);

    // Cleanup
    let _ = std::fs::remove_file(&file_a);
    let _ = std::fs::remove_file(&file_b);
}

#[test]
fn name_field_parsed_from_yaml() {
    let yaml = r#"
abi:
  package: thru.program.token
  name: "Token Program"
  abi-version: 1
  package-version: "0.1.0"
  description: "Test"
types: []
"#;
    let parsed: AbiFile = serde_yml::from_str(yaml).expect("Should parse YAML with name");
    assert_eq!(parsed.abi.name, Some("Token Program".to_string()));
    assert_eq!(parsed.name(), Some("Token Program"));
}

#[test]
fn name_field_defaults_to_none() {
    let yaml = r#"
abi:
  package: thru.common.primitives
  abi-version: 1
  package-version: "0.1.0"
  description: "Test without name"
types: []
"#;
    let parsed: AbiFile = serde_yml::from_str(yaml).expect("Should parse YAML without name");
    assert_eq!(parsed.abi.name, None);
    assert_eq!(parsed.name(), None);
}

#[test]
fn name_field_preserved_through_flatten() {
    let file = type_library_path().join("tn_token_program.abi.yaml");
    let include_dirs = vec![type_library_path()];

    let result = flatten(&file, &include_dirs).expect("flatten should succeed");
    assert_eq!(result.abi.name, Some("Token Program".to_string()));
    assert_eq!(result.name(), Some("Token Program"));
}

#[test]
fn name_field_survives_yaml_roundtrip() {
    let file = type_library_path().join("tn_token_program.abi.yaml");
    let include_dirs = vec![type_library_path()];

    let yaml = flatten_to_yaml(&file, &include_dirs).expect("flatten_to_yaml should succeed");
    let parsed: AbiFile = serde_yml::from_str(&yaml).expect("Should parse roundtripped YAML");
    assert_eq!(parsed.abi.name, Some("Token Program".to_string()));
}

#[test]
fn name_field_absent_after_flatten_when_not_set() {
    let file = type_library_path().join("thru_primitives.abi.yaml");
    let include_dirs = vec![type_library_path()];

    let result = flatten(&file, &include_dirs).expect("flatten should succeed");
    assert_eq!(result.abi.name, None);
}

#[test]
fn flatten_nft_market_program() {
    let file = type_library_path().join("tn_nft_market_program.abi.yaml");
    let include_dirs = vec![type_library_path()];

    let result = flatten(&file, &include_dirs).expect("flatten should succeed");

    assert!(
        result.abi.imports.is_empty(),
        "Flattened ABI should have no imports"
    );

    let type_names: Vec<&str> = result.types.iter().map(|t| t.name.as_str()).collect();

    // Types from thru_primitives (imported via onchain)
    assert!(
        type_names.contains(&"Pubkey"),
        "Should contain Pubkey from primitives"
    );
    assert!(
        type_names.contains(&"Hash"),
        "Should contain Hash from primitives"
    );

    // Types from state_proof (imported via onchain)
    assert!(
        type_names.contains(&"StateProof"),
        "Should contain StateProof"
    );

    // Types from root file
    assert!(
        type_names.contains(&"NftMarketInstruction"),
        "Should contain NftMarketInstruction"
    );
    assert!(
        type_names.contains(&"NftMarketOrder"),
        "Should contain NftMarketOrder"
    );
    assert!(
        type_names.contains(&"NftMarketConfig"),
        "Should contain NftMarketConfig"
    );
    assert!(
        type_names.contains(&"NftMarketProgramAccount"),
        "Should contain NftMarketProgramAccount"
    );
    assert!(
        type_names.contains(&"NftMarketEvent"),
        "Should contain NftMarketEvent"
    );

    // Verify no type-refs have a package field in flattened output
    fn assert_no_packages(kind: &abi_types::TypeKind) {
        match kind {
            abi_types::TypeKind::TypeRef(tr) => {
                assert!(
                    tr.package.is_none(),
                    "TypeRef '{}' should have no package in flattened output",
                    tr.name
                );
            }
            abi_types::TypeKind::Struct(s) => {
                for f in &s.fields {
                    assert_no_packages(&f.field_type);
                }
            }
            abi_types::TypeKind::Enum(e) => {
                for v in &e.variants {
                    assert_no_packages(&v.variant_type);
                }
            }
            abi_types::TypeKind::Array(a) => {
                assert_no_packages(&a.element_type);
            }
            abi_types::TypeKind::Union(u) => {
                for v in &u.variants {
                    assert_no_packages(&v.variant_type);
                }
            }
            abi_types::TypeKind::SizeDiscriminatedUnion(sdu) => {
                for v in &sdu.variants {
                    assert_no_packages(&v.variant_type);
                }
            }
            abi_types::TypeKind::Primitive(_) => {}
        }
    }

    for typedef in &result.types {
        assert_no_packages(&typedef.kind);
    }

    // Verify roundtrip: flat YAML should parse back correctly and type-refs
    // should have no package fields (only the top-level abi.package remains)
    let yaml = serde_yml::to_string(&result).expect("Should serialize to YAML");
    let reparsed: AbiFile = serde_yml::from_str(&yaml).expect("Should re-parse flattened YAML");
    assert_eq!(reparsed.abi.package, "thru.program.nft_market");
    assert!(reparsed.types.iter().any(|t| t.name == "Pubkey"));
    assert!(reparsed.types.iter().any(|t| t.name == "StateProof"));
}

#[test]
fn flatten_preserves_package_in_non_flat_roundtrip() {
    // Verify that the package field is preserved when parsing non-flat ABI files
    let yaml = r#"
abi:
  package: test.with.packages
  abi-version: 1
  package-version: "1.0.0"
  description: "Test package field preservation"
types:
  - name: MyStruct
    kind:
      struct:
        packed: true
        fields:
          - name: key
            field-type:
              type-ref:
                name: Pubkey
                package: "thru.common.primitives"
"#;
    let parsed: AbiFile = serde_yml::from_str(yaml).expect("Should parse YAML with package field");
    let field = &parsed.types[0];
    if let abi_types::TypeKind::Struct(s) = &field.kind {
        if let abi_types::TypeKind::TypeRef(tr) = &s.fields[0].field_type {
            assert_eq!(tr.package.as_deref(), Some("thru.common.primitives"));
        } else {
            panic!("Expected TypeRef");
        }
    } else {
        panic!("Expected Struct");
    }
}

fn fixture(
    dir: &std::path::Path,
    file: &str,
    package: &str,
    imports: &str,
    types: &str,
) -> PathBuf {
    let path = dir.join(file);
    std::fs::write(&path, format!(
        "abi:\n  package: {package}\n  name: Authored name\n  abi-version: 1\n  package-version: 1.2.3\n  description: Authored description\n  imports: {imports}\ntypes: {types}\n"
    )).unwrap();
    path
}

fn primitive(name: &str) -> String {
    format!("[{{name: {name}, kind: {{primitive: u64}}}}]")
}

fn path_import(file: &str) -> String {
    format!("[{{type: path, path: {file}}}]")
}

#[test]
fn exact_dotted_and_separate_qualification() {
    let dir = tempfile::tempdir().unwrap();
    fixture(
        dir.path(),
        "dep.yaml",
        "example.dep",
        "[]",
        &primitive("Shared"),
    );
    for reference in [
        "{name: example.dep.Shared}",
        "{name: Shared, package: example.dep}",
        "{name: example.dep.Shared, package: example.dep}",
    ] {
        let root = fixture(
            dir.path(),
            "root.yaml",
            "example.root",
            &path_import("dep.yaml"),
            &format!("[{{name: Root, kind: {{type-ref: {reference}}}}}]"),
        );
        let flat = flatten(&root, &[]).unwrap();
        let root_ty = flat.types.iter().find(|ty| ty.name == "Root").unwrap();
        match &root_ty.kind {
            abi_types::TypeKind::TypeRef(reference) => {
                assert_eq!(reference.name, "Shared");
                assert_eq!(reference.package, None);
            }
            _ => panic!("expected reference"),
        }
    }
    for reference in [
        "{name: example.dep.extra.Shared}",
        "{name: Shared, package: example.dep.extra}",
        "{name: example.Shared}",
        "{name: Shared, package: example}",
        "{name: example.dep.Missing}",
        "{name: Missing, package: example.dep}",
        "{name: unknown.Shared}",
        "{name: Shared, package: unknown}",
        "{name: example.dep.Shared, package: other}",
        "{name: Missing}",
    ] {
        let root = fixture(
            dir.path(),
            "root.yaml",
            "example.root",
            &path_import("dep.yaml"),
            &format!("[{{name: Root, kind: {{type-ref: {reference}}}}}]"),
        );
        assert!(flatten(&root, &[]).is_err(), "{reference}");
        assert!(
            abi_loader::prepare_for_publish(&root, &[], "testnet", false).is_err(),
            "{reference}"
        );
    }
}

#[test]
fn collisions_reject_equal_layouts_and_report_sorted_identities() {
    let dir = tempfile::tempdir().unwrap();
    fixture(
        dir.path(),
        "dep.yaml",
        "example.dep",
        "[]",
        &primitive("Shared"),
    );
    let root = fixture(
        dir.path(),
        "root.yaml",
        "example.root",
        &path_import("dep.yaml"),
        &primitive("Shared"),
    );
    let error = flatten(&root, &[]).unwrap_err().to_string();
    assert!(error.contains("example.dep.Shared"));
    assert!(error.contains("example.root.Shared"));
    fixture(
        dir.path(),
        "other.yaml",
        "example.other",
        "[]",
        &primitive("Shared"),
    );
    let mut errors = Vec::new();
    for imports in [
        "[{type: path, path: other.yaml}, {type: path, path: dep.yaml}]",
        "[{type: path, path: dep.yaml}, {type: path, path: other.yaml}]",
    ] {
        let root = fixture(dir.path(), "root.yaml", "example.root", imports, "[]");
        errors.push(flatten(&root, &[]).unwrap_err().to_string());
    }
    assert_eq!(errors[0], errors[1]);
    // Same package/name from distinct physical declarations is also ambiguous.
    fixture(
        dir.path(),
        "other.yaml",
        "example.dep",
        "[]",
        &primitive("Shared"),
    );
    assert!(flatten(&root, &[]).is_err());
}

#[test]
fn diamond_reuses_canonical_source_and_emits_stable_bytes() {
    let mut outputs = Vec::new();
    for reversed in [false, true] {
        let dir = tempfile::tempdir().unwrap();
        fixture(
            dir.path(),
            "shared.yaml",
            "example.shared",
            "[]",
            &primitive("Shared"),
        );
        fixture(
            dir.path(),
            "left.yaml",
            "example.left",
            &path_import("./shared.yaml"),
            &primitive("Left"),
        );
        fixture(
            dir.path(),
            "right.yaml",
            "example.right",
            &path_import("shared.yaml"),
            &primitive("Right"),
        );
        let imports = if reversed {
            "[{type: path, path: right.yaml}, {type: path, path: left.yaml}]"
        } else {
            "[{type: path, path: left.yaml}, {type: path, path: right.yaml}]"
        };
        let root = fixture(
            dir.path(),
            "root.yaml",
            "example.root",
            imports,
            &primitive("Root"),
        );
        let yaml = abi_loader::prepare_for_publish(&root, &[], "testnet", false).unwrap();
        let flat: AbiFile = serde_yml::from_str(&yaml).unwrap();
        assert_eq!(
            flat.types.iter().filter(|ty| ty.name == "Shared").count(),
            1
        );
        assert_eq!(flat.abi.name.as_deref(), Some("Authored name"));
        assert_eq!(flat.abi.package_version, "1.2.3");
        assert_eq!(flat.abi.description, "Authored description");
        outputs.push(yaml);
    }
    assert_eq!(outputs[0], outputs[1]);
}

#[test]
fn retained_remote_references_are_not_claimed_as_local() {
    let dir = tempfile::tempdir().unwrap();
    let remote = "[{type: onchain, address: taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQE, network: testnet}]";
    let types = "[{name: Dotted, kind: {type-ref: {name: external.pkg.Item}}}, {name: Separate, kind: {type-ref: {name: Item, package: external.pkg}}}]";
    let root = fixture(dir.path(), "root.yaml", "example.root", remote, types);
    let output = abi_loader::prepare_for_publish(&root, &[], "testnet", false).unwrap();
    let prepared: AbiFile = serde_yml::from_str(&output).unwrap();
    let original: AbiFile = serde_yml::from_str(&std::fs::read_to_string(&root).unwrap()).unwrap();
    assert_eq!(prepared.abi.imports, original.abi.imports);
    assert_eq!(
        serde_yml::to_string(&prepared.types).unwrap(),
        serde_yml::to_string(&original.types).unwrap()
    );
    assert!(abi_loader::prepare_for_publish(&root, &[], "mainnet", false).is_err());
    // A retained import must not hide a reference to a missing local declaration.
    fixture(
        dir.path(),
        "root.yaml",
        "example.root",
        remote,
        "[{name: Root, kind: {type-ref: {name: Missing, package: example.root}}}]",
    );
    assert!(abi_loader::prepare_for_publish(&root, &[], "testnet", false).is_err());
}

#[test]
fn retained_remote_qualifiers_use_exact_local_package_membership() {
    for (local, remote) in [("acme", "acme.shared"), ("acme.shared", "acme")] {
        let dir = tempfile::tempdir().unwrap();
        fixture(dir.path(), "dep.yaml", local, "[]", &primitive("Key"));
        let imports = "[{type: path, path: dep.yaml}, {type: onchain, address: taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQE, network: testnet}]";
        for separate in [false, true] {
            let reference = |package: &str, name: &str| {
                if separate {
                    format!("{{name: {name}, package: {package}}}")
                } else {
                    format!("{{name: {package}.{name}}}")
                }
            };
            let root = fixture(
                dir.path(),
                "root.yaml",
                "application",
                imports,
                &format!(
                    "[{{name: Local, kind: {{type-ref: {}}}}}, {{name: Remote, kind: {{type-ref: {}}}}}]",
                    reference(local, "Key"), reference(remote, "Key")
                ),
            );
            let output = abi_loader::prepare_for_publish(&root, &[], "testnet", false).unwrap();
            let prepared: AbiFile = serde_yml::from_str(&output).unwrap();
            assert_eq!(prepared.imports().len(), 1);
            assert!(matches!(
                prepared.imports()[0],
                abi_loader::file::ImportSource::Onchain { .. }
            ));
            for (name, expected_name, expected_package) in [
                ("Local", "Key".to_owned(), None),
                (
                    "Remote",
                    if separate {
                        "Key".to_owned()
                    } else {
                        format!("{remote}.Key")
                    },
                    separate.then_some(remote),
                ),
            ] {
                let ty = prepared.types.iter().find(|ty| ty.name == name).unwrap();
                match &ty.kind {
                    abi_types::TypeKind::TypeRef(reference) => {
                        assert_eq!(reference.name, expected_name);
                        assert_eq!(reference.package.as_deref(), expected_package);
                    }
                    _ => panic!("expected reference"),
                }
            }
            // Retaining a remote import must not mask a missing declaration in
            // either the exact dependency package or the exact root package.
            for package in [local, "application"] {
                fixture(
                    dir.path(),
                    "root.yaml",
                    "application",
                    imports,
                    &format!(
                        "[{{name: Root, kind: {{type-ref: {}}}}}]",
                        reference(package, "Missing")
                    ),
                );
                let error =
                    abi_loader::prepare_for_publish(&root, &[], "testnet", false).unwrap_err();
                assert!(error.to_string().contains("Unresolved type reference"));
            }
        }
        // Program roots use the same exact-package classification as type refs.
        for (package, name, expected) in [
            (remote, "Key", Some(format!("{remote}.Key"))),
            (local, "Key", Some("Key".to_owned())),
            (local, "Missing", None),
            ("application", "Missing", None),
        ] {
            let root = fixture(
                dir.path(),
                "root.yaml",
                "application",
                imports,
                &primitive("Root"),
            );
            let contents = std::fs::read_to_string(&root).unwrap().replace(
                "types:",
                &format!("  options:\n    program-metadata:\n      root-types:\n        errors: {package}.{name}\ntypes:"),
            );
            std::fs::write(&root, contents).unwrap();
            let output = abi_loader::prepare_for_publish(&root, &[], "testnet", false);
            if let Some(expected) = expected {
                let prepared: AbiFile = serde_yml::from_str(&output.unwrap()).unwrap();
                assert_eq!(
                    prepared.abi.options.program_metadata.root_types.errors,
                    Some(expected)
                );
            } else {
                assert!(output
                    .unwrap_err()
                    .to_string()
                    .contains("Unresolved declared errors root"));
            }
        }
    }
}

#[test]
fn preparation_rejects_remote_dependencies_and_root_git_http() {
    let dir = tempfile::tempdir().unwrap();
    for remote in [
        "[{type: onchain, address: taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQE, network: testnet}]",
        "[{type: http, url: 'https://invalid.example/abi.yaml'}]",
        "[{type: git, url: 'https://invalid.example/repo', ref: main, path: abi.yaml}]",
    ] {
        fixture(dir.path(), "dep.yaml", "example.dep", remote, &primitive("Shared"));
        let root = fixture(dir.path(), "root.yaml", "example.root", &path_import("dep.yaml"), &primitive("Root"));
        let error = abi_loader::prepare_for_publish(&root, &[], "testnet", false).unwrap_err();
        assert!(error.to_string().contains("Remote import found in local dependency"));
        if !remote.contains("onchain") {
            fixture(dir.path(), "root.yaml", "example.root", remote, &primitive("Root"));
            assert!(abi_loader::prepare_for_publish(&root, &[], "testnet", false).is_err());
        }
    }
}

#[test]
fn flatten_binary_propagates_resolution_errors() {
    let dir = tempfile::tempdir().unwrap();
    let root = fixture(
        dir.path(),
        "root.yaml",
        "example.root",
        "[]",
        &primitive("Root"),
    );
    let output = dir.path().join("flat.yaml");
    let run = || {
        std::process::Command::new(env!("CARGO_BIN_EXE_abi-flatten"))
            .arg("--file")
            .arg(&root)
            .arg("--output")
            .arg(&output)
            .output()
            .unwrap()
    };
    assert!(run().status.success());
    assert_eq!(
        std::fs::read_to_string(&output).unwrap(),
        flatten_to_yaml(&root, &[]).unwrap()
    );
    std::fs::remove_file(&output).unwrap();
    fixture(
        dir.path(),
        "root.yaml",
        "example.root",
        "[]",
        "[{name: Root, kind: {type-ref: {name: missing.Type}}}]",
    );
    assert!(!run().status.success());
    assert!(!output.exists());
}

#[test]
fn preparation_preserves_metadata_and_wire_significant_order() {
    let dir = tempfile::tempdir().unwrap();
    let types = r#"
  - name: Root
    kind:
      struct:
        packed: true
        fields:
          - name: z_first
            field-type: {primitive: u8}
          - name: a_second
            field-type:
              enum:
                packed: true
                tag-ref: {field-ref: {path: [z_first]}}
                variants:
                  - {name: ZVariant, tag-value: 9, variant-type: {primitive: u64}}
                  - {name: AVariant, tag-value: 2, variant-type: {primitive: u8}}
          - name: union_payload
            field-type:
              union:
                packed: true
                variants:
                  - {name: ZUnion, variant-type: {primitive: u64}}
                  - {name: AUnion, variant-type: {primitive: u8}}
"#;
    let root = fixture(dir.path(), "root.yaml", "example.root", "[]", types);
    let contents = std::fs::read_to_string(&root).unwrap().replace(
        "  imports: []",
        "  imports: []\n  options:\n    program-metadata:\n      root-types:\n        instruction-root: Root\n        account-root: Root\n        errors: Root\n        events: Root",
    );
    std::fs::write(&root, &contents).unwrap();
    let original: AbiFile = serde_yml::from_str(&contents).unwrap();
    let yaml = abi_loader::prepare_for_publish(&root, &[], "testnet", false).unwrap();
    let prepared: AbiFile = serde_yml::from_str(&yaml).unwrap();
    assert_eq!(prepared.types, original.types);
    assert_eq!(
        serde_yml::to_string(&prepared.abi).unwrap(),
        serde_yml::to_string(&original.abi).unwrap()
    );
    assert_eq!(yaml, flatten_to_yaml(&root, &[]).unwrap());
}

#[test]
fn distinct_same_basename_sources_have_distinct_diagnostics() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::create_dir(dir.path().join("left")).unwrap();
    std::fs::create_dir(dir.path().join("right")).unwrap();
    for branch in ["left", "right"] {
        fixture(
            &dir.path().join(branch),
            "dep.yaml",
            "example.dep",
            "[]",
            &primitive("Shared"),
        );
    }
    let root = fixture(
        dir.path(),
        "root.yaml",
        "example.root",
        "[{type: path, path: left/dep.yaml}, {type: path, path: right/dep.yaml}]",
        "[]",
    );
    let error = flatten(&root, &[]).unwrap_err().to_string();
    assert!(error.contains("left/dep.yaml"));
    assert!(error.contains("right/dep.yaml"));
    assert!(!error.contains(&dir.path().display().to_string()));
}

#[test]
fn loaded_prefix_package_cannot_supply_another_packages_type() {
    let dir = tempfile::tempdir().unwrap();
    fixture(
        dir.path(),
        "short.yaml",
        "example.dep",
        "[]",
        &primitive("Shared"),
    );
    fixture(
        dir.path(),
        "long.yaml",
        "example.dep.extra",
        "[]",
        &primitive("LongOnly"),
    );
    let imports = "[{type: path, path: long.yaml}, {type: path, path: short.yaml}]";
    for reference in [
        "{name: example.dep.extra.Shared}",
        "{name: Shared, package: example.dep.extra}",
    ] {
        let root = fixture(
            dir.path(),
            "root.yaml",
            "example.root",
            imports,
            &format!("[{{name: Root, kind: {{type-ref: {reference}}}}}]"),
        );
        assert!(flatten(&root, &[]).is_err());
    }
    let root = fixture(
        dir.path(),
        "root.yaml",
        "example.root",
        imports,
        "[{name: Root, kind: {type-ref: {name: example.dep.extra.LongOnly}}}]",
    );
    assert!(flatten(&root, &[]).is_ok());
}

#[test]
fn preparation_retains_root_import_declaration_order() {
    let dir = tempfile::tempdir().unwrap();
    let imports = "[{type: onchain, address: taBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBQE, network: testnet, revision: 7}, {type: onchain, address: taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQE, network: testnet, revision: 2}]";
    let root = fixture(
        dir.path(),
        "root.yaml",
        "example.root",
        imports,
        &primitive("Root"),
    );
    let original: AbiFile = serde_yml::from_str(&std::fs::read_to_string(&root).unwrap()).unwrap();
    let prepared: AbiFile = serde_yml::from_str(
        &abi_loader::prepare_for_publish(&root, &[], "testnet", false).unwrap(),
    )
    .unwrap();
    assert_eq!(prepared.abi.imports, original.abi.imports);
}

#[test]
fn preparation_rejects_every_missing_declared_root() {
    let dir = tempfile::tempdir().unwrap();
    for role in ["instruction-root", "account-root", "errors", "events"] {
        let root = fixture(
            dir.path(),
            "root.yaml",
            "example.root",
            "[]",
            &primitive("Root"),
        );
        let contents = std::fs::read_to_string(&root).unwrap().replace(
            "  imports: []",
            &format!("  imports: []\n  options:\n    program-metadata:\n      root-types:\n        {role}: Missing"),
        );
        std::fs::write(&root, &contents).unwrap();
        let error = abi_loader::prepare_for_publish(&root, &[], "testnet", false)
            .unwrap_err()
            .to_string();
        assert!(error.contains(&format!("Unresolved declared {role} root 'Missing'")));
        let abi: AbiFile = serde_yml::from_str(&contents).unwrap();
        assert!(abi_loader::validate_root_types(&abi).is_err());
    }
}

#[test]
fn preparation_resolves_local_roots_and_retains_qualified_remote_roots() {
    let dir = tempfile::tempdir().unwrap();
    fixture(
        dir.path(),
        "dep.yaml",
        "example.dep",
        "[]",
        &primitive("Shared"),
    );
    let root = fixture(
        dir.path(),
        "root.yaml",
        "example.root",
        &path_import("dep.yaml"),
        &primitive("Root"),
    );
    let contents = std::fs::read_to_string(&root).unwrap().replace(
        "types:", "  options:\n    program-metadata:\n      root-types:\n        errors: example.dep.Shared\ntypes:",
    );
    std::fs::write(&root, &contents).unwrap();
    let prepared: AbiFile = serde_yml::from_str(
        &abi_loader::prepare_for_publish(&root, &[], "testnet", false).unwrap(),
    )
    .unwrap();
    assert_eq!(
        prepared
            .abi
            .options
            .program_metadata
            .root_types
            .errors
            .as_deref(),
        Some("Shared")
    );
    abi_loader::validate_root_types(&prepared).unwrap();

    let remote = "[{type: onchain, address: taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQE, network: testnet}]";
    let root = fixture(
        dir.path(),
        "root.yaml",
        "example.root",
        remote,
        &primitive("Root"),
    );
    let contents = std::fs::read_to_string(&root).unwrap().replace(
        "types:", "  options:\n    program-metadata:\n      root-types:\n        errors: external.pkg.Errors\ntypes:",
    );
    std::fs::write(&root, &contents).unwrap();
    let prepared: AbiFile = serde_yml::from_str(
        &abi_loader::prepare_for_publish(&root, &[], "testnet", false).unwrap(),
    )
    .unwrap();
    assert_eq!(
        prepared
            .abi
            .options
            .program_metadata
            .root_types
            .errors
            .as_deref(),
        Some("external.pkg.Errors")
    );
}
