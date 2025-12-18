use abi_loader::{flatten, AbiFile};
use std::path::PathBuf;

fn type_library_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../type-library")
}

#[test]
fn flatten_token_program() {
    let file = type_library_path().join("token_program.abi.yaml");
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
    assert!(type_names.contains(&"Hash"), "Should contain Hash from primitives");
    assert!(type_names.contains(&"Pubkey"), "Should contain Pubkey from primitives");
    assert!(type_names.contains(&"Signature"), "Should contain Signature from primitives");

    // Types from state_proof.abi.yaml
    assert!(type_names.contains(&"StateProof"), "Should contain StateProof");

    // Types from root file (token_program.abi.yaml)
    assert!(type_names.contains(&"TokenInstruction"), "Should contain TokenInstruction");
    assert!(type_names.contains(&"TokenProgramAccount"), "Should contain TokenProgramAccount");

    // Verify options are preserved from root file
    assert_eq!(
        result.abi.options.program_metadata.root_types.instruction_root,
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
    assert_eq!(type_names.len(), 3);
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

    let yaml = abi_loader::flatten_to_yaml(&file, &include_dirs).expect("flatten_to_yaml should succeed");

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
    - "nonexistent_file.abi.yaml"
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
    - "{}"
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
    - "{}"
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
