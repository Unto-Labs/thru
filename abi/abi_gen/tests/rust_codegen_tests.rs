/* Rust Code Generation Tests
 *
 * These tests verify that the Rust code generator produces valid, compilable Rust code
 * for all ABI features with proper FFI compatibility.
 */

use abi_gen::abi::file::AbiFile;
use abi_gen::abi::resolved::{TypeResolver, ResolvedType};
use abi_gen::codegen::rust::{RustCodeGenerator, RustCodeGeneratorOptions};
use std::process::Command;
use std::fs;
use std::path::Path;

/* Helper to resolve types from ABI file */
fn resolve_types_from_abi(abi_path: &str) -> Result<Vec<ResolvedType>, String> {
    /* Load and parse the ABI file */
    let yaml_content = fs::read_to_string(abi_path)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    let abi: AbiFile = serde_yml::from_str(&yaml_content)
        .map_err(|e| format!("Failed to parse YAML: {}", e))?;

    let mut resolver = TypeResolver::new();
    for typedef in &abi.types {
        resolver.add_typedef(typedef.clone());
    }

    resolver.resolve_all().map_err(|e| format!("Failed to resolve types: {:?}", e))?;

    let resolved_types: Vec<ResolvedType> = resolver
        .resolution_order
        .iter()
        .filter_map(|name| resolver.get_type_info(name).cloned())
        .collect();

    Ok(resolved_types)
}

/* Helper to compile Rust code and check for errors */
fn compile_rust_code(rust_code: &str, test_name: &str) -> Result<(), String> {
    let temp_dir = std::env::temp_dir().join("abi_rust_tests");
    fs::create_dir_all(&temp_dir).map_err(|e| format!("Failed to create temp dir: {}", e))?;

    /* Create a temporary Cargo project */
    let project_dir = temp_dir.join(test_name);
    fs::create_dir_all(&project_dir).map_err(|e| format!("Failed to create project dir: {}", e))?;

    /* Write Cargo.toml */
    let cargo_toml = format!(
        r#"[package]
name = "{}"
version = "0.1.0"
edition = "2021"

[lib]
path = "lib.rs"
"#,
        test_name
    );
    fs::write(project_dir.join("Cargo.toml"), cargo_toml)
        .map_err(|e| format!("Failed to write Cargo.toml: {}", e))?;

    /* Write lib.rs */
    let lib_content = format!("#![allow(dead_code, unused)]\n\n{}", rust_code);
    fs::write(project_dir.join("lib.rs"), lib_content)
        .map_err(|e| format!("Failed to write lib.rs: {}", e))?;

    /* Try to compile with cargo */
    let output = Command::new("cargo")
        .arg("build")
        .arg("--manifest-path")
        .arg(project_dir.join("Cargo.toml"))
        .output()
        .map_err(|e| format!("Failed to run cargo: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Cargo compilation failed:\n{}", stderr));
    }

    /* Run clippy to check for warnings */
    let clippy_output = Command::new("cargo")
        .arg("clippy")
        .arg("--manifest-path")
        .arg(project_dir.join("Cargo.toml"))
        .arg("--")
        .arg("-D")
        .arg("warnings")
        .output()
        .map_err(|e| format!("Failed to run clippy: {}", e))?;

    if !clippy_output.status.success() {
        let stderr = String::from_utf8_lossy(&clippy_output.stderr);
        return Err(format!("Clippy found issues:\n{}", stderr));
    }

    /* Clean up */
    let _ = fs::remove_dir_all(&project_dir);

    Ok(())
}

#[test]
fn test_rust_primitives() {
    let abi_content = r#"
abi:
  package: "test.primitives"
  abi-version: 1
  package-version: "1.0.0"
  description: "Test types"

types:
  - name: "Primitives"
    kind:
      struct:
        packed: true
        fields:
          - name: "u8_field"
            field-type:
              primitive: u8
          - name: "u16_field"
            field-type:
              primitive: u16
          - name: "u32_field"
            field-type:
              primitive: u32
          - name: "u64_field"
            field-type:
              primitive: u64
          - name: "i8_field"
            field-type:
              primitive: i8
          - name: "i16_field"
            field-type:
              primitive: i16
          - name: "i32_field"
            field-type:
              primitive: i32
          - name: "i64_field"
            field-type:
              primitive: i64
          - name: "f32_field"
            field-type:
              primitive: f32
          - name: "f64_field"
            field-type:
              primitive: f64
"#;

    let temp_file = std::env::temp_dir().join("rust_primitives_test.abi.yaml");
    fs::write(&temp_file, abi_content).expect("Failed to write temp ABI file");

    let resolved_types = resolve_types_from_abi(temp_file.to_str().unwrap())
        .expect("Failed to resolve types");
    let resolved_refs: Vec<&ResolvedType> = resolved_types.iter().collect();

    let rust_gen = RustCodeGenerator::new(RustCodeGeneratorOptions {
        output_dir: std::env::temp_dir().to_str().unwrap().to_string(),
        ..Default::default()
    });

    let rust_code = rust_gen.emit_code(&resolved_refs);

    compile_rust_code(&rust_code, "rust_primitives").expect("Rust primitives code should compile");

    let _ = fs::remove_file(&temp_file);
}

#[test]
fn test_rust_fixed_arrays() {
    let abi_content = r#"
abi:
  package: "test.arrays"
  abi-version: 1
  package-version: "1.0.0"
  description: "Test types"

types:
  - name: "FixedArrays"
    kind:
      struct:
        packed: true
        fields:
          - name: "bytes"
            field-type:
              array:
                size:
                  literal:
                    u64: 32
                element-type:
                  primitive: u8
          - name: "matrix"
            field-type:
              array:
                size:
                  literal:
                    u64: 4
                element-type:
                  array:
                    size:
                      literal:
                        u64: 4
                    element-type:
                      primitive: u16
"#;

    let temp_file = std::env::temp_dir().join("rust_arrays_test.abi.yaml");
    fs::write(&temp_file, abi_content).expect("Failed to write temp ABI file");

    let resolved_types = resolve_types_from_abi(temp_file.to_str().unwrap())
        .expect("Failed to resolve types");
    let resolved_refs: Vec<&ResolvedType> = resolved_types.iter().collect();

    let rust_gen = RustCodeGenerator::new(RustCodeGeneratorOptions {
        output_dir: std::env::temp_dir().to_str().unwrap().to_string(),
        ..Default::default()
    });

    let rust_code = rust_gen.emit_code(&resolved_refs);

    compile_rust_code(&rust_code, "rust_fixed_arrays").expect("Rust fixed arrays code should compile");

    let _ = fs::remove_file(&temp_file);
}

#[test]
fn test_rust_simple_fam() {
    let abi_content = r#"
abi:
  package: "test.fam"
  abi-version: 1
  package-version: "1.0.0"
  description: "Test types"

types:
  - name: "SimpleFAM"
    kind:
      struct:
        packed: true
        fields:
          - name: "count"
            field-type:
              primitive: u32
          - name: "data"
            field-type:
              array:
                size:
                  field-ref:
                    path: ["count"]
                element-type:
                  primitive: u8
"#;

    let temp_file = std::env::temp_dir().join("rust_fam_test.abi.yaml");
    fs::write(&temp_file, abi_content).expect("Failed to write temp ABI file");

    let resolved_types = resolve_types_from_abi(temp_file.to_str().unwrap())
        .expect("Failed to resolve types");
    let resolved_refs: Vec<&ResolvedType> = resolved_types.iter().collect();

    let rust_gen = RustCodeGenerator::new(RustCodeGeneratorOptions {
        output_dir: std::env::temp_dir().to_str().unwrap().to_string(),
        ..Default::default()
    });

    let rust_code = rust_gen.emit_code(&resolved_refs);

    compile_rust_code(&rust_code, "rust_simple_fam").expect("Rust simple FAM code should compile");

    let _ = fs::remove_file(&temp_file);
}

#[test]
fn test_rust_advanced_types() {
    /* Test the comprehensive advanced_types.abi.yaml file */
    let abi_path = Path::new("tests/advanced_types.abi.yaml");

    if !abi_path.exists() {
        eprintln!("Warning: advanced_types.abi.yaml not found, skipping test");
        return;
    }

    let resolved_types = resolve_types_from_abi(abi_path.to_str().unwrap())
        .expect("Failed to resolve types");
    let resolved_refs: Vec<&ResolvedType> = resolved_types.iter().collect();

    let rust_gen = RustCodeGenerator::new(RustCodeGeneratorOptions {
        output_dir: std::env::temp_dir().to_str().unwrap().to_string(),
        ..Default::default()
    });

    let rust_code = rust_gen.emit_code(&resolved_refs);

    compile_rust_code(&rust_code, "rust_advanced_types").expect("Rust advanced types code should compile");
}

#[test]
fn test_rust_enums_with_external_tags() {
    let abi_content = r#"
abi:
  package: "test.enums"
  abi-version: 1
  package-version: "1.0.0"
  description: "Test types"

types:
  - name: "Message"
    kind:
      struct:
        packed: true
        fields:
          - name: "msg_type"
            field-type:
              primitive: u8
          - name: "payload"
            field-type:
              enum:
                packed: true
                tag-ref:
                  field-ref:
                    path: ["msg_type"]
                variants:
                  - name: "Ping"
                    tag-value: 1
                    variant-type:
                      primitive: u32
                  - name: "Pong"
                    tag-value: 2
                    variant-type:
                      primitive: u64
"#;

    let temp_file = std::env::temp_dir().join("rust_enums_test.abi.yaml");
    fs::write(&temp_file, abi_content).expect("Failed to write temp ABI file");

    let resolved_types = resolve_types_from_abi(temp_file.to_str().unwrap())
        .expect("Failed to resolve types");
    let resolved_refs: Vec<&ResolvedType> = resolved_types.iter().collect();

    let rust_gen = RustCodeGenerator::new(RustCodeGeneratorOptions {
        output_dir: std::env::temp_dir().to_str().unwrap().to_string(),
        ..Default::default()
    });

    let rust_code = rust_gen.emit_code(&resolved_refs);

    compile_rust_code(&rust_code, "rust_enums").expect("Rust enums code should compile");

    let _ = fs::remove_file(&temp_file);
}

#[test]
fn test_rust_unions() {
    let abi_content = r#"
abi:
  package: "test.unions"
  abi-version: 1
  package-version: "1.0.0"
  description: "Test types"

types:
  - name: "Value"
    kind:
      union:
        packed: true
        variants:
          - name: "byte"
            variant-type:
              primitive: u8
          - name: "word"
            variant-type:
              primitive: u32
          - name: "dword"
            variant-type:
              primitive: u64
"#;

    let temp_file = std::env::temp_dir().join("rust_unions_test.abi.yaml");
    fs::write(&temp_file, abi_content).expect("Failed to write temp ABI file");

    let resolved_types = resolve_types_from_abi(temp_file.to_str().unwrap())
        .expect("Failed to resolve types");
    let resolved_refs: Vec<&ResolvedType> = resolved_types.iter().collect();

    let rust_gen = RustCodeGenerator::new(RustCodeGeneratorOptions {
        output_dir: std::env::temp_dir().to_str().unwrap().to_string(),
        ..Default::default()
    });

    let rust_code = rust_gen.emit_code(&resolved_refs);

    compile_rust_code(&rust_code, "rust_unions").expect("Rust unions code should compile");

    let _ = fs::remove_file(&temp_file);
}

#[test]
fn test_rust_nested_structures() {
    let abi_content = r#"
abi:
  package: "test.nested"
  abi-version: 1
  package-version: "1.0.0"
  description: "Test types"

types:
  - name: "Outer"
    kind:
      struct:
        packed: true
        fields:
          - name: "header"
            field-type:
              struct:
                packed: true
                fields:
                  - name: "version"
                    field-type:
                      primitive: u16
                  - name: "flags"
                    field-type:
                      primitive: u16
          - name: "data"
            field-type:
              primitive: u64
"#;

    let temp_file = std::env::temp_dir().join("rust_nested_test.abi.yaml");
    fs::write(&temp_file, abi_content).expect("Failed to write temp ABI file");

    let resolved_types = resolve_types_from_abi(temp_file.to_str().unwrap())
        .expect("Failed to resolve types");
    let resolved_refs: Vec<&ResolvedType> = resolved_types.iter().collect();

    let rust_gen = RustCodeGenerator::new(RustCodeGeneratorOptions {
        output_dir: std::env::temp_dir().to_str().unwrap().to_string(),
        ..Default::default()
    });

    let rust_code = rust_gen.emit_code(&resolved_refs);

    compile_rust_code(&rust_code, "rust_nested").expect("Rust nested structures code should compile");

    let _ = fs::remove_file(&temp_file);
}

#[test]
fn test_rust_repr_c_attributes() {
    /* Verify that generated Rust code has proper #[repr(C)] attributes */
    let abi_content = r#"
abi:
  package: "test.repr"
  abi-version: 1
  package-version: "1.0.0"
  description: "Test types"

types:
  - name: "PackedStruct"
    kind:
      struct:
        packed: true
        fields:
          - name: "a"
            field-type:
              primitive: u8
          - name: "b"
            field-type:
              primitive: u32

  - name: "AlignedStruct"
    kind:
      struct:
        packed: false
        fields:
          - name: "a"
            field-type:
              primitive: u8
          - name: "b"
            field-type:
              primitive: u32
"#;

    let temp_file = std::env::temp_dir().join("rust_repr_test.abi.yaml");
    fs::write(&temp_file, abi_content).expect("Failed to write temp ABI file");

    let resolved_types = resolve_types_from_abi(temp_file.to_str().unwrap())
        .expect("Failed to resolve types");
    let resolved_refs: Vec<&ResolvedType> = resolved_types.iter().collect();

    let rust_gen = RustCodeGenerator::new(RustCodeGeneratorOptions {
        output_dir: std::env::temp_dir().to_str().unwrap().to_string(),
        ..Default::default()
    });

    let rust_code = rust_gen.emit_code(&resolved_refs);

    /* Verify repr attributes are present */
    assert!(rust_code.contains("#[repr(C, packed)]"), "Packed struct should have #[repr(C, packed)]");
    assert!(rust_code.contains("#[repr(C)]"), "Aligned struct should have #[repr(C)]");

    compile_rust_code(&rust_code, "rust_repr").expect("Rust repr attributes code should compile");

    let _ = fs::remove_file(&temp_file);
}
