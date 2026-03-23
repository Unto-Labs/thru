/* Rust Code Generation Tests
 *
 * These tests verify that the Rust code generator produces valid, compilable Rust code
 * for all ABI features with proper FFI compatibility.
 */

use abi_gen::abi::file::AbiFile;
use abi_gen::abi::resolved::{ResolvedType, TypeResolver};
use abi_gen::codegen::rust::{RustCodeGenerator, RustCodeGeneratorOptions, get_runtime_module_content};
use std::fs;
use std::path::Path;
use std::process::Command;

/* Helper to resolve types from ABI file */
fn resolve_types_from_abi(abi_path: &str) -> Result<TypeResolver, String> {
    /* Load and parse the ABI file */
    let yaml_content =
        fs::read_to_string(abi_path).map_err(|e| format!("Failed to read file: {}", e))?;

    let abi: AbiFile =
        serde_yml::from_str(&yaml_content).map_err(|e| format!("Failed to parse YAML: {}", e))?;

    let mut resolver = TypeResolver::new();
    for typedef in &abi.types {
        resolver.add_typedef(typedef.clone());
    }

    resolver
        .resolve_all()
        .map_err(|e| format!("Failed to resolve types: {:?}", e))?;

    Ok(resolver)
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

/* Helper to compile Rust types and functions together with module structure */
fn compile_rust_full_output(
    types_code: &str,
    functions_code: &str,
    test_name: &str,
) -> Result<(), String> {
    let temp_dir = std::env::temp_dir().join("abi_rust_tests");
    fs::create_dir_all(&temp_dir).map_err(|e| format!("Failed to create temp dir: {}", e))?;

    /* Create a temporary Cargo project */
    let project_dir = temp_dir.join(test_name);
    let src_dir = project_dir.join("src");
    fs::create_dir_all(&src_dir).map_err(|e| format!("Failed to create src dir: {}", e))?;

    /* Write Cargo.toml */
    let cargo_toml = format!(
        r#"[package]
name = "{}"
version = "0.1.0"
edition = "2021"

[lib]
path = "src/lib.rs"
"#,
        test_name
    );
    fs::write(project_dir.join("Cargo.toml"), cargo_toml)
        .map_err(|e| format!("Failed to write Cargo.toml: {}", e))?;

    /* Write lib.rs - include runtime module if functions reference it */
    let lib_content = r#"#![allow(dead_code, unused, non_camel_case_types, non_snake_case)]

pub mod types;
pub mod runtime;
pub mod functions;
"#;
    fs::write(src_dir.join("lib.rs"), lib_content)
        .map_err(|e| format!("Failed to write lib.rs: {}", e))?;

    /* Write runtime.rs */
    let runtime_content = get_runtime_module_content();
    fs::write(src_dir.join("runtime.rs"), runtime_content)
        .map_err(|e| format!("Failed to write runtime.rs: {}", e))?;

    /* Write types.rs */
    let types_content = format!(
        "#![allow(dead_code, unused, non_camel_case_types, non_snake_case)]\n\n{}",
        types_code
    );
    fs::write(src_dir.join("types.rs"), types_content)
        .map_err(|e| format!("Failed to write types.rs: {}", e))?;

    /* Write functions.rs */
    let functions_content = format!(
        "#![allow(dead_code, unused, non_camel_case_types, non_snake_case)]\n\n{}",
        functions_code
    );
    fs::write(src_dir.join("functions.rs"), functions_content)
        .map_err(|e| format!("Failed to write functions.rs: {}", e))?;

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

    let resolver =
        resolve_types_from_abi(temp_file.to_str().unwrap()).expect("Failed to resolve types");
    let resolved_refs: Vec<&ResolvedType> = resolver
        .resolution_order
        .iter()
        .filter_map(|name| resolver.get_type_info(name))
        .collect();

    let rust_gen = RustCodeGenerator::new(
        &resolver,
        RustCodeGeneratorOptions {
            output_dir: std::env::temp_dir().to_str().unwrap().to_string(),
            ..Default::default()
        },
    );

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

    let resolver =
        resolve_types_from_abi(temp_file.to_str().unwrap()).expect("Failed to resolve types");
    let resolved_refs: Vec<&ResolvedType> = resolver
        .resolution_order
        .iter()
        .filter_map(|name| resolver.get_type_info(name))
        .collect();

    let rust_gen = RustCodeGenerator::new(
        &resolver,
        RustCodeGeneratorOptions {
            output_dir: std::env::temp_dir().to_str().unwrap().to_string(),
            ..Default::default()
        },
    );

    let rust_code = rust_gen.emit_code(&resolved_refs);

    compile_rust_code(&rust_code, "rust_fixed_arrays")
        .expect("Rust fixed arrays code should compile");

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

    let resolver =
        resolve_types_from_abi(temp_file.to_str().unwrap()).expect("Failed to resolve types");
    let resolved_refs: Vec<&ResolvedType> = resolver
        .resolution_order
        .iter()
        .filter_map(|name| resolver.get_type_info(name))
        .collect();

    let rust_gen = RustCodeGenerator::new(
        &resolver,
        RustCodeGeneratorOptions {
            output_dir: std::env::temp_dir().to_str().unwrap().to_string(),
            ..Default::default()
        },
    );

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

    let resolver =
        resolve_types_from_abi(abi_path.to_str().unwrap()).expect("Failed to resolve types");
    let resolved_refs: Vec<&ResolvedType> = resolver
        .resolution_order
        .iter()
        .filter_map(|name| resolver.get_type_info(name))
        .collect();

    let rust_gen = RustCodeGenerator::new(
        &resolver,
        RustCodeGeneratorOptions {
            output_dir: std::env::temp_dir().to_str().unwrap().to_string(),
            ..Default::default()
        },
    );

    let rust_code = rust_gen.emit_code(&resolved_refs);

    compile_rust_code(&rust_code, "rust_advanced_types")
        .expect("Rust advanced types code should compile");
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

    let resolver =
        resolve_types_from_abi(temp_file.to_str().unwrap()).expect("Failed to resolve types");
    let resolved_refs: Vec<&ResolvedType> = resolver
        .resolution_order
        .iter()
        .filter_map(|name| resolver.get_type_info(name))
        .collect();

    let rust_gen = RustCodeGenerator::new(
        &resolver,
        RustCodeGeneratorOptions {
            output_dir: std::env::temp_dir().to_str().unwrap().to_string(),
            ..Default::default()
        },
    );

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

    let resolver =
        resolve_types_from_abi(temp_file.to_str().unwrap()).expect("Failed to resolve types");
    let resolved_refs: Vec<&ResolvedType> = resolver
        .resolution_order
        .iter()
        .filter_map(|name| resolver.get_type_info(name))
        .collect();

    let rust_gen = RustCodeGenerator::new(
        &resolver,
        RustCodeGeneratorOptions {
            output_dir: std::env::temp_dir().to_str().unwrap().to_string(),
            ..Default::default()
        },
    );

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

    let resolver =
        resolve_types_from_abi(temp_file.to_str().unwrap()).expect("Failed to resolve types");
    let resolved_refs: Vec<&ResolvedType> = resolver
        .resolution_order
        .iter()
        .filter_map(|name| resolver.get_type_info(name))
        .collect();

    let rust_gen = RustCodeGenerator::new(
        &resolver,
        RustCodeGeneratorOptions {
            output_dir: std::env::temp_dir().to_str().unwrap().to_string(),
            ..Default::default()
        },
    );

    let rust_code = rust_gen.emit_code(&resolved_refs);

    compile_rust_code(&rust_code, "rust_nested")
        .expect("Rust nested structures code should compile");

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

    let resolver =
        resolve_types_from_abi(temp_file.to_str().unwrap()).expect("Failed to resolve types");
    let resolved_refs: Vec<&ResolvedType> = resolver
        .resolution_order
        .iter()
        .filter_map(|name| resolver.get_type_info(name))
        .collect();

    let rust_gen = RustCodeGenerator::new(
        &resolver,
        RustCodeGeneratorOptions {
            output_dir: std::env::temp_dir().to_str().unwrap().to_string(),
            ..Default::default()
        },
    );

    let rust_code = rust_gen.emit_code(&resolved_refs);

    /* Verify repr attributes are present */
    assert!(
        rust_code.contains("#[repr(C, packed)]"),
        "Packed struct should have #[repr(C, packed)]"
    );
    assert!(
        rust_code.contains("#[repr(C)]"),
        "Aligned struct should have #[repr(C)]"
    );

    compile_rust_code(&rust_code, "rust_repr").expect("Rust repr attributes code should compile");

    let _ = fs::remove_file(&temp_file);
}

#[test]
fn test_rust_full_output_compiles() {
    /* Test that both types.rs and functions.rs compile together */
    let abi_content = r#"
abi:
  package: "test.full"
  abi-version: 1
  package-version: "1.0.0"
  description: "Test types with functions"

types:
  - name: "SimpleStruct"
    kind:
      struct:
        packed: true
        fields:
          - name: "count"
            field-type:
              primitive: u32
          - name: "value"
            field-type:
              primitive: u64
"#;

    let temp_dir = std::env::temp_dir().join("rust_full_test");
    fs::create_dir_all(&temp_dir).expect("Failed to create temp dir");

    let temp_file = temp_dir.join("full_test.abi.yaml");
    fs::write(&temp_file, abi_content).expect("Failed to write temp ABI file");

    let resolver =
        resolve_types_from_abi(temp_file.to_str().unwrap()).expect("Failed to resolve types");
    let resolved_refs: Vec<&ResolvedType> = resolver
        .resolution_order
        .iter()
        .filter_map(|name| resolver.get_type_info(name))
        .collect();

    let rust_gen = RustCodeGenerator::new(
        &resolver,
        RustCodeGeneratorOptions {
            output_dir: temp_dir.to_str().unwrap().to_string(),
            ..Default::default()
        },
    );

    let types_code = rust_gen.emit_code(&resolved_refs);

    /* Read the functions output from the file */
    let functions_path = temp_dir.join("functions.rs");
    let functions_code = fs::read_to_string(&functions_path)
        .unwrap_or_else(|_| "/* No functions generated */".to_string());

    /* Compile both together */
    compile_rust_full_output(&types_code, &functions_code, "rust_full_output")
        .expect("Full Rust output (types + functions) should compile");

    /* Clean up */
    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_rust_full_output_with_fam_compiles() {
    /* Test that types with FAMs compile with their IR functions */
    let abi_content = r#"
abi:
  package: "test.fam_full"
  abi-version: 1
  package-version: "1.0.0"
  description: "Test FAM types with functions"

types:
  - name: "Message"
    kind:
      struct:
        packed: true
        fields:
          - name: "length"
            field-type:
              primitive: u16
          - name: "payload"
            field-type:
              array:
                size:
                  field-ref:
                    path: ["length"]
                element-type:
                  primitive: u8
"#;

    let temp_dir = std::env::temp_dir().join("rust_fam_full_test");
    fs::create_dir_all(&temp_dir).expect("Failed to create temp dir");

    let temp_file = temp_dir.join("fam_full_test.abi.yaml");
    fs::write(&temp_file, abi_content).expect("Failed to write temp ABI file");

    let resolver =
        resolve_types_from_abi(temp_file.to_str().unwrap()).expect("Failed to resolve types");
    let resolved_refs: Vec<&ResolvedType> = resolver
        .resolution_order
        .iter()
        .filter_map(|name| resolver.get_type_info(name))
        .collect();

    let rust_gen = RustCodeGenerator::new(
        &resolver,
        RustCodeGeneratorOptions {
            output_dir: temp_dir.to_str().unwrap().to_string(),
            ..Default::default()
        },
    );

    let types_code = rust_gen.emit_code(&resolved_refs);

    /* Read the functions output from the file */
    let functions_path = temp_dir.join("functions.rs");
    let functions_code = fs::read_to_string(&functions_path)
        .unwrap_or_else(|_| "/* No functions generated */".to_string());

    /* Compile both together */
    compile_rust_full_output(&types_code, &functions_code, "rust_fam_full_output")
        .expect("Full Rust output with FAM should compile");

    /* Clean up */
    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_rust_full_output_with_enum_compiles() {
    /* Test that enum types compile with their IR functions */
    let abi_content = r#"
abi:
  package: "test.enum_full"
  abi-version: 1
  package-version: "1.0.0"
  description: "Test enum types with functions"

types:
  - name: "TaggedMessage"
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
                  - name: "Empty"
                    tag-value: 0
                    variant-type:
                      primitive: u8
                  - name: "Data"
                    tag-value: 1
                    variant-type:
                      primitive: u64
"#;

    let temp_dir = std::env::temp_dir().join("rust_enum_full_test");
    fs::create_dir_all(&temp_dir).expect("Failed to create temp dir");

    let temp_file = temp_dir.join("enum_full_test.abi.yaml");
    fs::write(&temp_file, abi_content).expect("Failed to write temp ABI file");

    let resolver =
        resolve_types_from_abi(temp_file.to_str().unwrap()).expect("Failed to resolve types");
    let resolved_refs: Vec<&ResolvedType> = resolver
        .resolution_order
        .iter()
        .filter_map(|name| resolver.get_type_info(name))
        .collect();

    let rust_gen = RustCodeGenerator::new(
        &resolver,
        RustCodeGeneratorOptions {
            output_dir: temp_dir.to_str().unwrap().to_string(),
            ..Default::default()
        },
    );

    let types_code = rust_gen.emit_code(&resolved_refs);

    /* Read the functions output from the file */
    let functions_path = temp_dir.join("functions.rs");
    let functions_code = fs::read_to_string(&functions_path)
        .unwrap_or_else(|_| "/* No functions generated */".to_string());

    /* Compile both together */
    compile_rust_full_output(&types_code, &functions_code, "rust_enum_full_output")
        .expect("Full Rust output with enum should compile");

    /* Clean up */
    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_rust_post_fam_field_compiles() {
    /* Test that structs with fields after FAMs compile correctly */
    /* This tests the offset computation for post-FAM fields */
    let abi_content = r#"
abi:
  package: "test.post_fam"
  abi-version: 1
  package-version: "1.0.0"
  description: "Test post-FAM fields"

types:
  - name: "DualArrays"
    kind:
      struct:
        packed: true
        fields:
          - name: "count1"
            field-type:
              primitive: u16
          - name: "count2"
            field-type:
              primitive: u16
          - name: "data1"
            field-type:
              array:
                size:
                  field-ref:
                    path: ["count1"]
                element-type:
                  primitive: u8
          - name: "data2"
            field-type:
              array:
                size:
                  field-ref:
                    path: ["count2"]
                element-type:
                  primitive: u32
          - name: "footer"
            field-type:
              primitive: u64
"#;

    let temp_dir = std::env::temp_dir().join("rust_post_fam_test");
    fs::create_dir_all(&temp_dir).expect("Failed to create temp dir");

    let temp_file = temp_dir.join("post_fam_test.abi.yaml");
    fs::write(&temp_file, abi_content).expect("Failed to write temp ABI file");

    let resolver =
        resolve_types_from_abi(temp_file.to_str().unwrap()).expect("Failed to resolve types");
    let resolved_refs: Vec<&ResolvedType> = resolver
        .resolution_order
        .iter()
        .filter_map(|name| resolver.get_type_info(name))
        .collect();

    let rust_gen = RustCodeGenerator::new(
        &resolver,
        RustCodeGeneratorOptions {
            output_dir: temp_dir.to_str().unwrap().to_string(),
            ..Default::default()
        },
    );

    let types_code = rust_gen.emit_code(&resolved_refs);

    /* Read the functions output from the file */
    let functions_path = temp_dir.join("functions.rs");
    let functions_code = fs::read_to_string(&functions_path)
        .unwrap_or_else(|_| "/* No functions generated */".to_string());

    /* Compile both together */
    compile_rust_full_output(&types_code, &functions_code, "rust_post_fam_output")
        .expect("Post-FAM struct (with footer after FAMs) should compile");

    /* Clean up */
    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_rust_nested_enum_compiles() {
    /* Test that deeply nested enum types compile correctly */
    let abi_content = r#"
abi:
  package: "test.nested_enum"
  abi-version: 1
  package-version: "1.0.0"
  description: "Test nested enums"

types:
  - name: "Wrapper"
    kind:
      struct:
        packed: true
        fields:
          - name: "outer_tag"
            field-type:
              primitive: u8
          - name: "inner"
            field-type:
              struct:
                packed: true
                fields:
                  - name: "inner_tag"
                    field-type:
                      primitive: u8
                  - name: "inner_payload"
                    field-type:
                      enum:
                        packed: true
                        tag-ref:
                          field-ref:
                            path: ["inner_tag"]
                        variants:
                          - name: "Small"
                            tag-value: 1
                            variant-type:
                              primitive: u8
                          - name: "Large"
                            tag-value: 2
                            variant-type:
                              primitive: u64
          - name: "outer_payload"
            field-type:
              enum:
                packed: true
                tag-ref:
                  field-ref:
                    path: ["outer_tag"]
                variants:
                  - name: "TypeA"
                    tag-value: 10
                    variant-type:
                      primitive: u32
                  - name: "TypeB"
                    tag-value: 20
                    variant-type:
                      primitive: u16
"#;

    let temp_dir = std::env::temp_dir().join("rust_nested_enum_test");
    fs::create_dir_all(&temp_dir).expect("Failed to create temp dir");

    let temp_file = temp_dir.join("nested_enum_test.abi.yaml");
    fs::write(&temp_file, abi_content).expect("Failed to write temp ABI file");

    let resolver =
        resolve_types_from_abi(temp_file.to_str().unwrap()).expect("Failed to resolve types");
    let resolved_refs: Vec<&ResolvedType> = resolver
        .resolution_order
        .iter()
        .filter_map(|name| resolver.get_type_info(name))
        .collect();

    let rust_gen = RustCodeGenerator::new(
        &resolver,
        RustCodeGeneratorOptions {
            output_dir: temp_dir.to_str().unwrap().to_string(),
            ..Default::default()
        },
    );

    let types_code = rust_gen.emit_code(&resolved_refs);

    /* Read the functions output from the file */
    let functions_path = temp_dir.join("functions.rs");
    let functions_code = fs::read_to_string(&functions_path)
        .unwrap_or_else(|_| "/* No functions generated */".to_string());

    /* Compile both together */
    compile_rust_full_output(&types_code, &functions_code, "rust_nested_enum_output")
        .expect("Nested enum struct should compile");

    /* Clean up */
    let _ = fs::remove_dir_all(&temp_dir);
}

/* =============================================================================
 * Guard tests - verify no legacy fallback occurs
 * ============================================================================= */

#[test]
fn test_rust_no_ir_unavailable_warnings() {
    /* Test that well-formed types generate IR-backed code without warnings */
    let temp_dir = std::env::temp_dir().join("abi_rust_ir_guard_test");
    let _ = fs::create_dir_all(&temp_dir);

    let abi_content = r#"
abi:
  package: "test.ir_guard"
  abi-version: 1
  package-version: "1.0.0"
  description: "IR Guard Test Types"

types:
  - name: "SimpleStruct"
    kind:
      struct:
        packed: true
        fields:
          - name: "value"
            field-type:
              primitive: u32
          - name: "count"
            field-type:
              primitive: u16
  - name: "WithFAM"
    kind:
      struct:
        packed: true
        fields:
          - name: "length"
            field-type:
              primitive: u16
          - name: "data"
            field-type:
              array:
                size:
                  field-ref:
                    path: ["length"]
                element-type:
                  primitive: u8
"#;
    let abi: AbiFile = serde_yml::from_str(abi_content).expect("Parse test ABI");
    let mut resolver = TypeResolver::new();
    for typedef in &abi.types {
        resolver.add_typedef(typedef.clone());
    }
    resolver.resolve_all().expect("Resolve types");

    let resolved_refs: Vec<&ResolvedType> = resolver
        .resolution_order
        .iter()
        .filter_map(|name| resolver.get_type_info(name))
        .collect();

    let rust_gen = RustCodeGenerator::new(
        &resolver,
        RustCodeGeneratorOptions {
            output_dir: temp_dir.to_str().unwrap().to_string(),
            emit_type_definitions: true,
            emit_accessors: true,
            package: None,
            all_packages: Vec::new(),
            import_resolver: None,
        },
    );

    let types_code = rust_gen.emit_code(&resolved_refs);
    let functions_path = temp_dir.join("functions.rs");
    let functions_code = fs::read_to_string(&functions_path).unwrap_or_default();

    /* Guard: Verify no "IR unavailable" warnings in generated code */
    let combined = format!("{}\n{}", types_code, functions_code);
    assert!(
        !combined.contains("IR validator unavailable"),
        "Generated code should not contain IR unavailable warnings for well-formed types"
    );
    assert!(
        !combined.contains("IR helpers unavailable"),
        "Generated code should not contain IR helpers unavailable comments for well-formed types"
    );
    assert!(
        !combined.contains("Failed to emit IR"),
        "Generated code should not contain IR emission failures for well-formed types"
    );

    /* Verify IR functions ARE present */
    assert!(
        functions_code.contains("_footprint_ir"),
        "Generated code should include IR footprint functions"
    );
    assert!(
        functions_code.contains("_validate_ir"),
        "Generated code should include IR validate functions"
    );

    /* Phase 5 Guard: Verify no legacy patterns in generated code */
    assert!(
        !combined.contains("_legacy"),
        "Generated code should not contain _legacy function names"
    );
    assert!(
        !combined.contains("legacy_"),
        "Generated code should not contain legacy_ prefixed symbols"
    );

    /* Clean up */
    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_rust_generated_code_has_no_todo_placeholders() {
    /* Test that generated code does not contain TODO placeholders
       This mirrors TypeScript's test_ts_generated_code_has_no_todo_placeholders */
    let temp_dir = std::env::temp_dir().join("abi_rust_no_todo_test");
    let _ = fs::create_dir_all(&temp_dir);

    /* Use a comprehensive ABI that exercises many code paths */
    let abi_content = r#"
abi:
  package: "test.no_todo"
  abi-version: 1
  package-version: "1.0.0"
  description: "Comprehensive Test Types"

types:
  - name: "PrimitiveTypes"
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

  - name: "NestedStruct"
    kind:
      struct:
        packed: true
        fields:
          - name: "header"
            field-type:
              type-ref:
                name: "PrimitiveTypes"
          - name: "value"
            field-type:
              primitive: u32

  - name: "FixedArray"
    kind:
      struct:
        packed: true
        fields:
          - name: "data"
            field-type:
              array:
                size:
                  literal:
                    u32: 32
                element-type:
                  primitive: u8

  - name: "VariableArray"
    kind:
      struct:
        packed: true
        fields:
          - name: "length"
            field-type:
              primitive: u32
          - name: "data"
            field-type:
              array:
                size:
                  field-ref:
                    path: ["length"]
                element-type:
                  primitive: u8

  - name: "SimpleEnum"
    kind:
      struct:
        packed: true
        fields:
          - name: "tag"
            field-type:
              primitive: u8
          - name: "payload"
            field-type:
              enum:
                packed: true
                tag-ref:
                  field-ref:
                    path: ["tag"]
                variants:
                  - name: "None"
                    tag-value: 0
                    variant-type:
                      struct:
                        packed: true
                        fields: []
                  - name: "Some"
                    tag-value: 1
                    variant-type:
                      struct:
                        packed: true
                        fields:
                          - name: "value"
                            field-type:
                              primitive: u32

  - name: "MessageWithSDU"
    kind:
      struct:
        packed: true
        fields:
          - name: "header"
            field-type:
              primitive: u8
          - name: "data"
            field-type:
              size-discriminated-union:
                variants:
                  - name: "small"
                    expected-size: 4
                    variant-type:
                      struct:
                        packed: true
                        fields:
                          - name: "value"
                            field-type:
                              primitive: u32
                  - name: "medium"
                    expected-size: 8
                    variant-type:
                      struct:
                        packed: true
                        fields:
                          - name: "value1"
                            field-type:
                              primitive: u32
                          - name: "value2"
                            field-type:
                              primitive: u32
"#;

    let temp_file = temp_dir.join("no_todo_test.abi.yaml");
    fs::write(&temp_file, abi_content).expect("Failed to write temp ABI file");

    let resolver =
        resolve_types_from_abi(temp_file.to_str().unwrap()).expect("Failed to resolve types");

    let resolved_refs: Vec<&ResolvedType> = resolver
        .resolution_order
        .iter()
        .filter_map(|name| resolver.get_type_info(name))
        .collect();

    let rust_gen = RustCodeGenerator::new(
        &resolver,
        RustCodeGeneratorOptions {
            output_dir: temp_dir.to_str().unwrap().to_string(),
            ..Default::default()
        },
    );

    let types_code = rust_gen.emit_code(&resolved_refs);
    let functions_path = temp_dir.join("functions.rs");
    let functions_code = fs::read_to_string(&functions_path).unwrap_or_default();

    let combined = format!("{}\n{}", types_code, functions_code);

    /* Check for TODO placeholders in generated code */
    let todo_patterns = [
        "// TODO:",
        "/* TODO",
        "// TODO ",
        "/* TODO */",
        "0 /* TODO */",
    ];

    for pattern in &todo_patterns {
        let count = combined.matches(pattern).count();
        if count > 0 {
            /* Find the lines with TODOs for better error messages */
            let todo_lines: Vec<&str> = combined
                .lines()
                .filter(|line| line.contains(pattern))
                .take(5)
                .collect();
            panic!(
                "Generated code contains {} TODO placeholder(s) matching '{}'. Examples:\n{}",
                count,
                pattern,
                todo_lines.join("\n")
            );
        }
    }

    /* Clean up */
    let _ = fs::remove_dir_all(&temp_dir);
}

/* =============================================================================
 * Builder tests - verify builders are generated and work correctly
 * ============================================================================= */

#[test]
fn test_rust_builder_generation() {
    /* Test that builders are generated for constant-size structs */
    let temp_dir = std::env::temp_dir().join("abi_rust_builder_test");
    let _ = fs::create_dir_all(&temp_dir);

    let abi_content = r#"
abi:
  package: "test.builder"
  abi-version: 1
  package-version: "1.0.0"
  description: "Builder Test Types"

types:
  - name: "SimplePacket"
    kind:
      struct:
        packed: true
        fields:
          - name: "version"
            field-type:
              primitive: u8
          - name: "flags"
            field-type:
              primitive: u8
          - name: "length"
            field-type:
              primitive: u16
          - name: "sequence"
            field-type:
              primitive: u32
"#;

    let temp_file = temp_dir.join("builder_test.abi.yaml");
    fs::write(&temp_file, abi_content).expect("Failed to write temp ABI file");

    let resolver =
        resolve_types_from_abi(temp_file.to_str().unwrap()).expect("Failed to resolve types");
    let resolved_refs: Vec<&ResolvedType> = resolver
        .resolution_order
        .iter()
        .filter_map(|name| resolver.get_type_info(name))
        .collect();

    let rust_gen = RustCodeGenerator::new(
        &resolver,
        RustCodeGeneratorOptions {
            output_dir: temp_dir.to_str().unwrap().to_string(),
            ..Default::default()
        },
    );

    let types_code = rust_gen.emit_code(&resolved_refs);

    /* Read the functions output from the file */
    let functions_path = temp_dir.join("functions.rs");
    let functions_code = fs::read_to_string(&functions_path)
        .unwrap_or_else(|_| "/* No functions generated */".to_string());

    /* Verify builder is generated */
    assert!(
        functions_code.contains("pub struct SimplePacketBuilder"),
        "Builder should be generated for constant-size struct"
    );
    assert!(
        functions_code.contains("pub fn set_version"),
        "Builder should have setter for version field"
    );
    assert!(
        functions_code.contains("pub fn set_flags"),
        "Builder should have setter for flags field"
    );
    assert!(
        functions_code.contains("pub fn set_length"),
        "Builder should have setter for length field"
    );
    assert!(
        functions_code.contains("pub fn set_sequence"),
        "Builder should have setter for sequence field"
    );
    assert!(
        functions_code.contains("pub fn build(self) -> Vec<u8>"),
        "Builder should have build() method"
    );
    assert!(
        functions_code.contains("pub fn build_into"),
        "Builder should have build_into() method"
    );

    /* Compile to ensure it works */
    compile_rust_full_output(&types_code, &functions_code, "rust_builder_test")
        .expect("Builder code should compile");

    /* Clean up */
    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_rust_fam_builder_generation() {
    /* Test that FAM builders are generated for variable-size structs */
    let temp_dir = std::env::temp_dir().join("abi_rust_fam_builder_test");
    let _ = fs::create_dir_all(&temp_dir);

    /* Note: Field name 'length' used instead of 'payload_len' to avoid
       naming conflict with the generated payload_len() accessor method */
    let abi_content = r#"
abi:
  package: "test.fam_builder"
  abi-version: 1
  package-version: "1.0.0"
  description: "FAM Builder Test Types"

types:
  - name: "Message"
    kind:
      struct:
        packed: true
        fields:
          - name: "msg_type"
            field-type:
              primitive: u8
          - name: "length"
            field-type:
              primitive: u16
          - name: "payload"
            field-type:
              array:
                size:
                  field-ref:
                    path: ["length"]
                element-type:
                  primitive: u8
"#;

    let temp_file = temp_dir.join("fam_builder_test.abi.yaml");
    fs::write(&temp_file, abi_content).expect("Failed to write temp ABI file");

    let resolver =
        resolve_types_from_abi(temp_file.to_str().unwrap()).expect("Failed to resolve types");
    let resolved_refs: Vec<&ResolvedType> = resolver
        .resolution_order
        .iter()
        .filter_map(|name| resolver.get_type_info(name))
        .collect();

    let rust_gen = RustCodeGenerator::new(
        &resolver,
        RustCodeGeneratorOptions {
            output_dir: temp_dir.to_str().unwrap().to_string(),
            ..Default::default()
        },
    );

    let types_code = rust_gen.emit_code(&resolved_refs);

    /* Read the functions output from the file */
    let functions_path = temp_dir.join("functions.rs");
    let functions_code = fs::read_to_string(&functions_path)
        .unwrap_or_else(|_| "/* No functions generated */".to_string());

    /* Verify FAM builder is generated */
    assert!(
        functions_code.contains("pub struct MessageBuilder"),
        "FAM Builder should be generated for variable-size struct"
    );
    assert!(
        functions_code.contains("payload_data: Option<Vec<u8>>"),
        "FAM Builder should have payload data storage"
    );
    assert!(
        functions_code.contains("pub fn set_payload"),
        "FAM Builder should have setter for payload field"
    );
    assert!(
        functions_code.contains("fn total_size"),
        "FAM Builder should have total_size helper"
    );

    /* Compile to ensure it works */
    compile_rust_full_output(&types_code, &functions_code, "rust_fam_builder_test")
        .expect("FAM Builder code should compile");

    /* Clean up */
    let _ = fs::remove_dir_all(&temp_dir);
}

/* =============================================================================
 * Builder round-trip tests - verify builders produce valid data that can be read back
 * ============================================================================= */

/* Helper to compile and run Rust code with tests */
fn compile_and_run_rust_tests(
    types_code: &str,
    functions_code: &str,
    test_code: &str,
    test_name: &str,
) -> Result<(), String> {
    let temp_dir = std::env::temp_dir().join("abi_rust_roundtrip_tests");
    fs::create_dir_all(&temp_dir).map_err(|e| format!("Failed to create temp dir: {}", e))?;

    let project_dir = temp_dir.join(test_name);
    let src_dir = project_dir.join("src");
    fs::create_dir_all(&src_dir).map_err(|e| format!("Failed to create src dir: {}", e))?;

    /* Write Cargo.toml */
    let cargo_toml = format!(
        r#"[package]
name = "{}"
version = "0.1.0"
edition = "2021"

[lib]
path = "src/lib.rs"

[[test]]
name = "roundtrip"
path = "src/tests.rs"
"#,
        test_name
    );
    fs::write(project_dir.join("Cargo.toml"), cargo_toml)
        .map_err(|e| format!("Failed to write Cargo.toml: {}", e))?;

    /* Write lib.rs */
    let lib_content = r#"#![allow(dead_code, unused, non_camel_case_types, non_snake_case)]

pub mod types;
pub mod runtime;
pub mod functions;
"#;
    fs::write(src_dir.join("lib.rs"), lib_content)
        .map_err(|e| format!("Failed to write lib.rs: {}", e))?;

    /* Write runtime.rs */
    let runtime_content = get_runtime_module_content();
    fs::write(src_dir.join("runtime.rs"), runtime_content)
        .map_err(|e| format!("Failed to write runtime.rs: {}", e))?;

    /* Write types.rs */
    let types_content = format!(
        "#![allow(dead_code, unused, non_camel_case_types, non_snake_case)]\n\n{}",
        types_code
    );
    fs::write(src_dir.join("types.rs"), types_content)
        .map_err(|e| format!("Failed to write types.rs: {}", e))?;

    /* Write functions.rs */
    let functions_content = format!(
        "#![allow(dead_code, unused, non_camel_case_types, non_snake_case)]\n\n{}",
        functions_code
    );
    fs::write(src_dir.join("functions.rs"), functions_content)
        .map_err(|e| format!("Failed to write functions.rs: {}", e))?;

    /* Write tests.rs */
    let tests_content = format!(
        r#"#![allow(dead_code, unused, non_camel_case_types, non_snake_case)]

use {}::types::*;
use {}::functions::*;

{}
"#,
        test_name, test_name, test_code
    );
    fs::write(src_dir.join("tests.rs"), tests_content)
        .map_err(|e| format!("Failed to write tests.rs: {}", e))?;

    /* Run cargo test */
    let output = Command::new("cargo")
        .arg("test")
        .arg("--manifest-path")
        .arg(project_dir.join("Cargo.toml"))
        .output()
        .map_err(|e| format!("Failed to run cargo test: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(format!(
            "Cargo test failed:\nSTDOUT:\n{}\nSTDERR:\n{}",
            stdout, stderr
        ));
    }

    /* Clean up */
    let _ = fs::remove_dir_all(&project_dir);

    Ok(())
}

#[test]
fn test_rust_const_struct_builder_roundtrip() {
    /* Test that const struct builder produces valid data that readers can parse */
    let abi_content = r#"
abi:
  package: "test.roundtrip"
  abi-version: 1
  package-version: "1.0.0"
  description: "Roundtrip Test Types"

types:
  - name: "SimplePacket"
    kind:
      struct:
        packed: true
        fields:
          - name: "version"
            field-type:
              primitive: u8
          - name: "flags"
            field-type:
              primitive: u8
          - name: "length"
            field-type:
              primitive: u16
          - name: "sequence"
            field-type:
              primitive: u32
"#;

    let temp_dir = std::env::temp_dir().join("rust_roundtrip_const_test");
    fs::create_dir_all(&temp_dir).expect("Failed to create temp dir");

    let temp_file = temp_dir.join("roundtrip_const_test.abi.yaml");
    fs::write(&temp_file, abi_content).expect("Failed to write temp ABI file");

    let resolver =
        resolve_types_from_abi(temp_file.to_str().unwrap()).expect("Failed to resolve types");
    let resolved_refs: Vec<&ResolvedType> = resolver
        .resolution_order
        .iter()
        .filter_map(|name| resolver.get_type_info(name))
        .collect();

    let rust_gen = RustCodeGenerator::new(
        &resolver,
        RustCodeGeneratorOptions {
            output_dir: temp_dir.to_str().unwrap().to_string(),
            ..Default::default()
        },
    );

    let types_code = rust_gen.emit_code(&resolved_refs);
    let functions_path = temp_dir.join("functions.rs");
    let functions_code = fs::read_to_string(&functions_path)
        .unwrap_or_else(|_| "/* No functions generated */".to_string());

    /* Test code that exercises the builder and validates output */
    let test_code = r#"
#[test]
fn test_builder_roundtrip() {
    /* Build a packet using the builder */
    let bytes = SimplePacketBuilder::new()
        .set_version(1)
        .set_flags(0x42)
        .set_length(100)
        .set_sequence(0xDEADBEEF)
        .build();

    /* Verify the bytes are correct size */
    assert_eq!(bytes.len(), 8, "SimplePacket should be 8 bytes");

    /* Verify individual byte values (little-endian) */
    assert_eq!(bytes[0], 1, "version should be 1");
    assert_eq!(bytes[1], 0x42, "flags should be 0x42");
    assert_eq!(bytes[2], 100, "length low byte");
    assert_eq!(bytes[3], 0, "length high byte");
    /* sequence = 0xDEADBEEF in little-endian: EF BE AD DE */
    assert_eq!(bytes[4], 0xEF, "sequence byte 0");
    assert_eq!(bytes[5], 0xBE, "sequence byte 1");
    assert_eq!(bytes[6], 0xAD, "sequence byte 2");
    assert_eq!(bytes[7], 0xDE, "sequence byte 3");

    /* Use the reader to verify the data can be parsed back */
    let packet = SimplePacket::from_slice(&bytes).expect("Should parse successfully");
    assert_eq!(packet.version(), 1);
    assert_eq!(packet.flags(), 0x42);
    assert_eq!(packet.length(), 100);
    assert_eq!(packet.sequence(), 0xDEADBEEF);
}

#[test]
fn test_builder_build_into() {
    /* Test building into a pre-allocated buffer */
    let mut buffer = vec![0u8; 16];
    let builder = SimplePacketBuilder::new()
        .set_version(2)
        .set_flags(0xFF)
        .set_length(200)
        .set_sequence(12345);

    let written = builder.build_into(&mut buffer).expect("Should succeed");
    assert_eq!(written, 8, "Should write 8 bytes");

    /* Verify the data */
    let packet = SimplePacket::from_slice(&buffer[..8]).expect("Should parse");
    assert_eq!(packet.version(), 2);
    assert_eq!(packet.flags(), 0xFF);
    assert_eq!(packet.length(), 200);
    assert_eq!(packet.sequence(), 12345);
}
"#;

    compile_and_run_rust_tests(&types_code, &functions_code, test_code, "roundtrip_const_struct")
        .expect("Const struct builder roundtrip tests should pass");

    /* Clean up */
    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_rust_size_discriminated_union_compiles() {
    /* Test that size-discriminated union types compile correctly */
    let temp_dir = std::env::temp_dir().join("rust_sdu_test");
    fs::create_dir_all(&temp_dir).expect("Failed to create temp dir");

    /* Use the compliance test SDU ABI */
    let abi_path = Path::new("tests/compliance_tests/abi_definitions/size_discriminated_unions.abi.yaml");

    if !abi_path.exists() {
        eprintln!("Warning: size_discriminated_unions.abi.yaml not found, skipping test");
        return;
    }

    let resolver =
        resolve_types_from_abi(abi_path.to_str().unwrap()).expect("Failed to resolve SDU types");
    let resolved_refs: Vec<&ResolvedType> = resolver
        .resolution_order
        .iter()
        .filter_map(|name| resolver.get_type_info(name))
        .collect();

    let rust_gen = RustCodeGenerator::new(
        &resolver,
        RustCodeGeneratorOptions {
            output_dir: temp_dir.to_str().unwrap().to_string(),
            ..Default::default()
        },
    );

    let types_code = rust_gen.emit_code(&resolved_refs);

    /* Read the functions output from the file */
    let functions_path = temp_dir.join("functions.rs");
    let functions_code = fs::read_to_string(&functions_path)
        .unwrap_or_else(|_| "/* No functions generated */".to_string());

    /* Verify SDU-related code is generated */
    assert!(
        types_code.contains("MessageWithSDU") || functions_code.contains("MessageWithSDU"),
        "SDU type should be generated"
    );

    /* Compile to ensure SDU code works */
    compile_rust_full_output(&types_code, &functions_code, "rust_sdu_output")
        .expect("Size-discriminated union code should compile");

    /* Verify no TODO placeholders in SDU code */
    let combined = format!("{}\n{}", types_code, functions_code);
    assert!(
        !combined.contains("/* TODO"),
        "SDU generated code should not contain TODO placeholders"
    );

    /* Clean up */
    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_rust_computed_enum_tags_compile() {
    /* Test that computed enum tag types compile correctly */
    let temp_dir = std::env::temp_dir().join("rust_computed_enum_test");
    fs::create_dir_all(&temp_dir).expect("Failed to create temp dir");

    let abi_path = Path::new("tests/compliance_tests/abi_definitions/computed_enums.abi.yaml");

    if !abi_path.exists() {
        eprintln!("Warning: computed_enums.abi.yaml not found, skipping test");
        return;
    }

    let resolver = resolve_types_from_abi(abi_path.to_str().unwrap())
        .expect("Failed to resolve computed enum types");
    let resolved_refs: Vec<&ResolvedType> = resolver
        .resolution_order
        .iter()
        .filter_map(|name| resolver.get_type_info(name))
        .collect();

    let rust_gen = RustCodeGenerator::new(
        &resolver,
        RustCodeGeneratorOptions {
            output_dir: temp_dir.to_str().unwrap().to_string(),
            ..Default::default()
        },
    );

    let types_code = rust_gen.emit_code(&resolved_refs);
    let functions_path = temp_dir.join("functions.rs");
    let functions_code = fs::read_to_string(&functions_path)
        .unwrap_or_else(|_| "/* No functions generated */".to_string());

    /* Compile to ensure computed enum code works */
    compile_rust_full_output(&types_code, &functions_code, "rust_computed_enum_output")
        .expect("Computed enum tag code should compile");

    /* Clean up */
    let _ = fs::remove_dir_all(&temp_dir);
}
