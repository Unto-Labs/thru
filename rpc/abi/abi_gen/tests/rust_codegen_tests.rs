/* Rust Code Generation Tests
 *
 * These tests verify that the Rust code generator produces valid, compilable Rust code
 * for all ABI features with proper FFI compatibility.
 */

use abi_gen::abi::file::AbiFile;
use abi_gen::abi::resolved::{ResolvedType, TypeResolver};
use abi_gen::codegen::rust::{
    RustCodeGenerator, RustCodeGeneratorOptions, get_runtime_module_content,
};
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

    /* Run cargo test.  Only the `roundtrip` target holds tests: a plain
    `cargo test` also compiled the generated library a second time as an
    empty unit-test harness and ran rustdoc for doctests it has none of. */
    let output = Command::new("cargo")
        .arg("test")
        .arg("--test")
        .arg("roundtrip")
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

    compile_and_run_rust_tests(
        &types_code,
        &functions_code,
        test_code,
        "roundtrip_const_struct",
    )
    .expect("Const struct builder roundtrip tests should pass");

    /* Clean up */
    let _ = fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_rust_fam_builder_alignment_roundtrip() {
    /* Exercise both the gap before an unpacked FAM and layouts without a gap. */
    for (case, packed, count_type, prefix_end, payload_offset) in [
        ("padded", false, "u32", 4, 8),
        ("padded_byte_count", false, "u8", 1, 8),
        ("packed", true, "u32", 4, 4),
        ("aligned", false, "u64", 8, 8),
    ] {
        let test_name = format!("rust_fam_alignment_{case}");
        let temp_dir = std::env::temp_dir().join(&test_name);
        fs::create_dir_all(&temp_dir).expect("Failed to create temp dir");
        let abi_content = format!(
            r#"
abi:
  package: "test.fam_alignment"
  abi-version: 1
  package-version: "1.0.0"
  description: "FAM alignment regression"
types:
  - name: "Message"
    kind:
      struct:
        packed: {packed}
        fields:
          - name: "count"
            field-type:
              primitive: {count_type}
          - name: "payload"
            field-type:
              array:
                size:
                  field-ref:
                    path: ["count"]
                element-type:
                  primitive: u64
  - name: "MessageWithTrailer"
    kind:
      struct:
        packed: {packed}
        fields:
          - name: "count"
            field-type:
              primitive: u8
          - name: "payload"
            field-type:
              array:
                size:
                  field-ref:
                    path: ["count"]
                element-type:
                  primitive: u64
          - name: "marker"
            field-type:
              primitive: u8
          - name: "suffix"
            field-type:
              array:
                size:
                  field-ref:
                    path: ["count"]
                element-type:
                  primitive: u8
"#
        );
        let abi_path = temp_dir.join("alignment.abi.yaml");
        fs::write(&abi_path, abi_content).expect("Failed to write temp ABI file");
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
                output_dir: temp_dir.to_str().unwrap().to_string(),
                ..Default::default()
            },
        );
        let types_code = rust_gen.emit_code(&resolved_refs);
        let mut functions_code = fs::read_to_string(temp_dir.join("functions.rs"))
            .expect("Failed to read generated functions");

        /* total_size is private, so test it within its generated module. */
        functions_code.push_str(&format!(
            r#"
#[cfg(test)]
mod alignment_tests {{
    use super::*;

    #[test]
    fn total_size_includes_padding() {{
        assert_eq!(MessageBuilder::new().total_size(), {payload_offset});
        for count in 0..=2 {{
            let values = vec![1u64; count];
            assert_eq!(MessageBuilder::new().set_payload(&values).total_size(),
                       {payload_offset} + count * 8);
        }}
    }}
}}
"#
        ));

        let test_code = r#"
const PREFIX_END: usize = __PREFIX_END__;
const PAYLOAD_OFFSET: usize = __PAYLOAD_OFFSET__;
const TRAILER_PAYLOAD_OFFSET: usize = __TRAILER_PAYLOAD_OFFSET__;

#[test]
fn accessors_preserve_padding_before_earlier_arrays() {
    for count in 0..=2 {
        let trailer_offset = TRAILER_PAYLOAD_OFFSET + count * 8;
        let mut expected = vec![0u8; trailer_offset];
        expected[0] = count as u8;
        for index in 0..count {
            expected[TRAILER_PAYLOAD_OFFSET + index * 8..TRAILER_PAYLOAD_OFFSET + (index + 1) * 8]
                .copy_from_slice(&0x0123456789abcdefu64.to_le_bytes());
        }
        expected.push(0x5a);
        expected.extend(vec![0x42; count]);

        let message = MessageWithTrailer::from_slice(&expected).unwrap();
        assert_eq!(message.marker(), 0x5a);
        assert_eq!(message.suffix(), &vec![0x42; count]);
        assert_eq!(message.size(), expected.len());

        let mut actual = vec![0xa5; expected.len()];
        assert_eq!(MessageWithTrailer::new(&mut actual, count as _).unwrap(), expected.len());
        let mut view = MessageWithTrailerMut::from_slice_mut(&mut actual).unwrap();
        for index in 0..count {
            view.payload_set(index, 0x0123456789abcdef);
        }
        view.set_marker(0x5a);
        assert_eq!(view.marker(), 0x5a);
        view.set_suffix(&vec![0x42; count]);
        assert_eq!(actual, expected);
    }
}

#[test]
fn builder_preserves_fam_alignment() {
    let values = [0x0123456789abcdefu64, 0xfedcba9876543210];
    for count in 0..=values.len() {
        let values = &values[..count];
        let payload: Vec<u8> = values.iter().flat_map(|value| value.to_le_bytes()).collect();
        let mut expected = vec![0u8; PAYLOAD_OFFSET];
        expected[..PREFIX_END].copy_from_slice(&(count as u64).to_le_bytes()[..PREFIX_END]);
        expected.extend_from_slice(&payload);

        let bytes = MessageBuilder::new().set_payload(values).build();
        assert_eq!(bytes, expected);
        assert_eq!(MessageBuilder::new().set_payload_bytes(&payload).build(), expected);

        let message = Message::from_slice(&bytes).expect("Built message should parse");
        assert_eq!(Message::validate(&bytes).unwrap(), expected.len());
        if bytes.len() > PREFIX_END {
            assert!(Message::validate(&bytes[..bytes.len() - 1]).is_err());
        }
        assert_eq!(message.size(), expected.len());
        assert_eq!(message.count() as usize, count);
        assert_eq!(message.payload_len(), count);
        for (index, value) in values.iter().enumerate() {
            assert_eq!(message.payload_get(index), *value);
        }

        let finished = MessageBuilder::new().set_payload(values).finish()
            .expect("Finished message should validate");
        assert_eq!(finished.count() as usize, count);
        assert_eq!(finished.payload_len(), count);
        for (index, value) in values.iter().enumerate() {
            assert_eq!(finished.payload_get(index), *value);
        }

        for extra in [0, 5] {
            let mut target = vec![0xa5; expected.len() + extra];
            let written = MessageBuilder::new().set_payload(values).build_into(&mut target)
                .expect("Sufficient target should succeed");
            assert_eq!(written, expected.len());
            assert_eq!(&target[..written], expected.as_slice());
            assert!(target[written..].iter().all(|byte| *byte == 0xa5));
            assert!(Message::from_slice(&target[..written]).is_ok());
        }

        let mut short = vec![0xa5; expected.len() - 1];
        let err = MessageBuilder::new().set_payload(values).build_into(&mut short).unwrap_err();
        assert_eq!(err.required_size(), Some(expected.len()));
        assert_eq!(err.to_string(), format!("buffer too small: need {} bytes, have {}", expected.len(), short.len()));
        assert!(short.iter().all(|byte| *byte == 0xa5));

        let mut initialized = vec![0xa5; expected.len()];
        assert_eq!(Message::new(&mut initialized, count as _).unwrap(), expected.len());
        let mut view = MessageMut::from_slice_mut(&mut initialized).unwrap();
        for (index, value) in values.iter().enumerate() {
            view.payload_set(index, *value);
        }
        assert_eq!(initialized, expected);
    }
    assert_eq!(MessageBuilder::new().build(), vec![0u8; PAYLOAD_OFFSET]);
}
"#
        .replace("__PREFIX_END__", &prefix_end.to_string())
        .replace("__PAYLOAD_OFFSET__", &payload_offset.to_string())
        .replace("__TRAILER_PAYLOAD_OFFSET__", if packed { "1" } else { "8" });

        compile_and_run_rust_tests(&types_code, &functions_code, &test_code, &test_name)
            .unwrap_or_else(|err| panic!("FAM alignment case {case} failed: {err}"));
        let _ = fs::remove_dir_all(&temp_dir);
    }
}

/* Generate `types.rs` / `functions.rs` for an ABI straight from the resolver
 * (bypassing the CLI's alignment-1 rule for top-level types). */
fn generate_direct(abi_path: &str, out_dir: &Path) -> (String, String) {
    fs::create_dir_all(out_dir).expect("Failed to create temp dir");
    let resolver = resolve_types_from_abi(abi_path).expect("Failed to resolve types");
    let resolved_refs: Vec<&ResolvedType> = resolver
        .resolution_order
        .iter()
        .filter_map(|name| resolver.get_type_info(name))
        .collect();
    let rust_gen = RustCodeGenerator::new(
        &resolver,
        RustCodeGeneratorOptions {
            output_dir: out_dir.to_str().unwrap().to_string(),
            ..Default::default()
        },
    );
    let types_code = rust_gen.emit_code(&resolved_refs);
    let functions_code =
        fs::read_to_string(out_dir.join("functions.rs")).expect("Failed to read functions");
    (types_code, functions_code)
}

/* A variable-size struct's encoded size rounds up to the struct alignment,
 * as the shared layout IR does: validate, size(), the params footprint, new()
 * and builders all agree, and padding bytes are zeroed. */
#[test]
fn test_rust_variable_struct_trailing_padding() {
    let test_name = "rust_trailing_padding";
    let temp_dir = std::env::temp_dir().join(test_name);
    let (types_code, functions_code) =
        generate_direct("tests/compliance_data/trailing_padding.abi.yaml", &temp_dir);
    assert!(
        functions_code.contains("pub fn aligned_trailer_footprint_ir("),
        "IR footprint helper missing"
    );
    let test_code = r#"
use rust_trailing_padding::runtime::AbiError;

#[test]
fn aligned_trailer_rounds_to_eight() {
    /* count 0: 8 + 1 = 9 bytes of fields, 16 with padding. */
    let mut bytes = vec![0u8; 16];
    bytes[8] = 0x5a;
    assert_eq!(AlignedTrailer::validate(&bytes[..9]), Err(AbiError::BufferTooSmall { needed: 16, have: 9 }));
    assert_eq!(AlignedTrailer::validate(&bytes[..15]), Err(AbiError::BufferTooSmall { needed: 16, have: 15 }));
    assert_eq!(AlignedTrailer::validate(&bytes), Ok(16));
    assert!(AlignedTrailer::from_slice(&bytes[..9]).is_err());
    let view = AlignedTrailer::from_slice(&bytes).unwrap();
    assert_eq!((view.size(), view.marker()), (16, 0x5a));
    let p = AlignedTrailerParams::from_buffer(&bytes).unwrap();
    assert_eq!(AlignedTrailer::footprint_from_params(&p), Ok(16));
    assert_eq!(p.footprint(), Ok(16));
    assert_eq!(aligned_trailer_footprint_ir(0, 0), 16);

    let mut buf = vec![0xa5u8; 20];
    assert_eq!(AlignedTrailer::new(&mut buf, 0), Ok(16));
    assert_eq!(&buf[..16], &[0u8; 16]);
    assert_eq!(&buf[16..], &[0xa5u8; 4]);
    assert_eq!(AlignedTrailer::new(&mut [0u8; 9], 0), Err(AbiError::BufferTooSmall { needed: 16, have: 9 }));
    let mut buf = vec![0xa5u8; 16];
    assert_eq!(AlignedTrailer::new_from_params(&mut buf, &p), Ok(16));
    assert_eq!(buf, vec![0u8; 16]);

    let built = AlignedTrailerBuilder::new().set_marker(0x5a).build();
    assert_eq!(built, bytes);
    let mut target = vec![0xa5u8; 16];
    assert_eq!(AlignedTrailerBuilder::new().set_marker(0x5a).build_into(&mut target), Ok(16));
    assert_eq!(target, bytes);
    let err = AlignedTrailerBuilder::new().set_marker(0x5a).build_into(&mut [0u8; 9]).unwrap_err();
    assert_eq!(err, AbiError::BufferTooSmall { needed: 16, have: 9 });

    /* count 1: 8 + 8 + 1 + 1 = 18 bytes of fields, 24 with padding. */
    let built = AlignedTrailerBuilder::new().set_payload(&[7]).set_marker(1).set_suffix(&[2]).build();
    let mut expected = vec![0u8; 24];
    expected[0] = 1;
    expected[8] = 7;
    expected[16] = 1;
    expected[17] = 2;
    assert_eq!(built, expected);
    assert_eq!(AlignedTrailer::validate(&built), Ok(24));
    assert!(AlignedTrailer::validate(&built[..18]).is_err());
    assert_eq!(aligned_trailer_footprint_ir(1, 1), 24);
    assert_eq!(AlignedTrailerParams::from_buffer(&built).unwrap().footprint(), Ok(24));
}

#[test]
fn padded_tail_rounds_to_four() {
    for count in 0..=5usize {
        let size = (4 + count + 3) / 4 * 4;
        let data: Vec<u8> = (1..=count as u8).collect();
        let built = PaddedTailBuilder::new().set_data(&data).build();
        assert_eq!(built.len(), size);
        assert_eq!(&built[4 + count..], &vec![0u8; size - 4 - count][..]);
        assert_eq!(PaddedTail::validate(&built), Ok(size));
        if size > 4 + count {
            assert_eq!(
                PaddedTail::validate(&built[..4 + count]),
                Err(AbiError::BufferTooSmall { needed: size, have: 4 + count })
            );
        }
        assert_eq!(PaddedTail::from_slice(&built).unwrap().size(), size);
        assert_eq!(padded_tail_footprint_ir(count as u64), size as u64);
        let mut buf = vec![0xa5u8; size];
        assert_eq!(PaddedTail::new(&mut buf, count as u32), Ok(size));
        let mut expected = vec![0u8; size];
        expected[0] = count as u8;
        assert_eq!(buf, expected);
    }
}

#[test]
fn padded_child_moves_following_fields() {
    /* head @0, inner @4 (count 1 + data: 5 bytes, padded to 8), tail @12.
     * The holder itself aligns to 1 (its only fixed field is `head`). */
    let inner = PaddedTailBuilder::new().set_data(&[9]).build();
    let built = PaddedHolderBuilder::new().set_head(1).set_inner(&inner).set_tail(3).build();
    let expected = [1, 0, 0, 0, 1, 0, 0, 0, 9, 0, 0, 0, 3];
    assert_eq!(built, expected);
    let view = PaddedHolder::from_slice(&built).unwrap();
    assert_eq!((view.inner().size(), view.tail(), view.size()), (8, 3, 13));
    assert_eq!(PaddedHolderParams::from_buffer(&built).unwrap().footprint(), Ok(13));
    /* The child's padding is part of the child. */
    assert!(PaddedHolderBuilder::new().set_head(1).set_inner(&inner[..5]).set_tail(3).try_build().is_err());
}

#[test]
fn byte_aligned_trailer_has_no_padding() {
    /* Only the u8 count is fixed, so the struct (and its IR) align to 1. */
    let mut bytes = vec![0u8; 9];
    bytes[8] = 0x5a;
    assert_eq!(MessageWithTrailer::validate(&bytes), Ok(9));
    assert_eq!(message_with_trailer_footprint_ir(0, 0), 9);
    assert_eq!(MessageWithTrailerParams::from_buffer(&bytes).unwrap().footprint(), Ok(9));
}
"#;
    compile_and_run_rust_tests(&types_code, &functions_code, test_code, test_name)
        .unwrap_or_else(|err| panic!("trailing padding tests failed: {err}"));
    let _ = fs::remove_dir_all(&temp_dir);
}

/* =============================================================================
 * Generated API parity tests: typed enum views, dynamic params, deep
 * validation, builders for every enum/array shape, and `#![no_std]` support.
 * ============================================================================= */

const DEEP_VALIDATION_ABI: &str = r#"
abi:
  package: "test.deep"
  abi-version: 1
  package-version: "1.0.0"
  description: "Constant-size struct whose nested enum tag must be validated"
types:
  - name: "Inner"
    kind:
      struct:
        packed: true
        fields:
          - name: "tag"
            field-type:
              primitive: u8
          - name: "value"
            field-type:
              enum:
                packed: true
                tag-ref:
                  field-ref:
                    path: ["tag"]
                variants:
                  - name: "A"
                    tag-value: 0
                    variant-type:
                      primitive: u32
                  - name: "B"
                    tag-value: 1
                    variant-type:
                      primitive: u32
  - name: "Outer"
    kind:
      struct:
        packed: true
        fields:
          - name: "x"
            field-type:
              primitive: u8
          - name: "inner"
            field-type:
              type-ref:
                name: "Inner"
"#;

/* Generate Rust for `abis` with `abi codegen` into `<crate>/src/generated`. */
fn generate_crate(name: &str, abis: &[(&str, String)]) -> std::path::PathBuf {
    let project =
        std::env::temp_dir().join(format!("abi_rust_api_{}_{}", name, std::process::id()));
    let _ = fs::remove_dir_all(&project);
    let abi_dir = project.join("abis");
    fs::create_dir_all(&abi_dir).unwrap();
    let mut files = Vec::new();
    for (file, content) in abis {
        let path = abi_dir.join(file);
        fs::write(&path, content).unwrap();
        files.push(path);
    }
    abi_gen::cmds::codegen::run(
        files,
        Vec::new(),
        abi_gen::cmds::codegen::Language::Rust,
        project.join("src/generated"),
        false,
    )
    .expect("codegen");
    project
}

fn compliance_abi(name: &str) -> (&'static str, String) {
    let file: &'static str = Box::leak(format!("{}.abi.yaml", name).into_boxed_str());
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/compliance_tests/abi_definitions")
        .join(file);
    (file, fs::read_to_string(path).unwrap())
}

fn run_cargo(project: &Path, args: &[&str]) -> Result<(), String> {
    let output = Command::new("cargo")
        .args(args)
        .arg("--manifest-path")
        .arg(project.join("Cargo.toml"))
        .env_remove("RUSTFLAGS")
        .output()
        .map_err(|e| e.to_string())?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "cargo {:?} failed:\n{}\n{}",
            args,
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        ))
    }
}

#[test]
fn test_rust_generated_api_parity() {
    let mut abis = vec![("deep.abi.yaml", DEEP_VALIDATION_ABI.to_string())];
    for name in [
        "nested_refs",
        "jagged_arrays",
        "multi_enums",
        "interleaved_enums",
        "wide_tag_enums",
        "buffer_sized",
        "size_discriminated_unions",
    ] {
        abis.push(compliance_abi(name));
    }
    let project = generate_crate("parity", &abis);
    fs::write(
        project.join("Cargo.toml"),
        "[package]\nname = \"abi_rust_api_parity\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[lib]\npath = \"src/lib.rs\"\n\n[workspace]\n",
    )
    .unwrap();
    fs::write(
        project.join("src/lib.rs"),
        r#"pub mod generated;

#[cfg(test)]
mod tests {
    use crate::generated::compliance::buffer_sized::*;
    use crate::generated::compliance::interleaved_enums::*;
    use crate::generated::compliance::jagged_arrays::*;
    use crate::generated::compliance::multi_enums::*;
    use crate::generated::compliance::nested_refs::*;
    use crate::generated::compliance::size_discriminated_unions::*;
    use crate::generated::compliance::wide_tag_enums::*;
    use crate::generated::test::deep::*;
    use crate::generated::tn_abi_runtime::AbiError;

    fn proof_bytes() -> (Vec<u8>, Vec<u8>, Vec<u8>) {
        let hdr = ProofHeaderBuilder::new()
            .set_type_slot(1u64 << 62)
            .set_bitset(&[0b0000_0011, 0b0000_0001])
            .build();
        let payload = Proof_body_updatingBuilder::new()
            .set_leaf(7)
            .set_siblings(&[10, 20, 30])
            .build();
        let bytes = ProofBuilder::new().set_hdr(&hdr).set_body_updating(&payload).build();
        (hdr, payload, bytes)
    }

    #[test]
    fn typed_enum_views_and_nested_refs() {
        let (_, _, bytes) = proof_bytes();
        assert_eq!(bytes.len(), 10 + 4 + 12);
        let proof = Proof::from_slice(&bytes).unwrap();
        assert_eq!(proof.body_tag(), 1);
        match proof.body() {
            ProofBodyRef::Updating(u) => {
                assert_eq!(u.leaf(), 7);
                assert_eq!(u.siblings_len(), 3);
                assert_eq!(u.siblings_get(2), 30);
                assert_eq!((u.siblings_try_get(2), u.siblings_try_get(3)), (Some(30), None));
                assert_eq!(u.context().hdr_bitset_0, 3);
            }
            _ => panic!("expected the updating variant"),
        }
        assert_eq!(proof.body_tag(), Proof::BODY_TAG_UPDATING);
        let info = Proof::body_variant_by_name("updating").unwrap();
        assert_eq!((info.tag, info.payload_size), (1, None));
        assert_eq!(Proof::body_variant_by_tag(proof.body_tag()), Some(info));
        assert_eq!(Proof::BODY_VARIANTS.len(), 2);
        assert!(proof.body_as_updating().is_some() && proof.body_as_existing().is_none());
        let mut bad = bytes.clone();
        bad[7] = 0xc0; /* type_slot >> 62 == 3: no such variant */
        assert_eq!(Proof::validate(&bad), Err(AbiError::InvalidVariant));
        assert!(Proof::from_slice(&bad).is_err());
        let view = Proof::from_slice_unchecked(&bad);
        assert_eq!(view.body_tag(), 3);
    }

    #[test]
    fn params_footprint_and_new() {
        let (_, _, bytes) = proof_bytes();
        let params = ProofParams::from_buffer(&bytes).unwrap();
        assert_eq!(params, Proof::from_slice(&bytes).unwrap().dynamic_params());
        assert_eq!(
            ProofParams::KEYS,
            &[
                ("hdr_type_slot", "hdr.type_slot"),
                ("hdr_bitset_0", "hdr.bitset.0"),
                ("hdr_bitset_1", "hdr.bitset.1"),
            ]
        );
        let mut generic = ProofParams::default();
        for (field, path) in ProofParams::KEYS {
            assert!(generic.set(path, params.get(field).unwrap()));
        }
        assert_eq!(generic, params);
        assert_eq!(MessageWithSDUParams::KEYS, &[("data_variant", "data.variant")]);
        assert_eq!(params.hdr_type_slot, 1u64 << 62);
        assert_eq!((params.hdr_bitset_0, params.hdr_bitset_1), (3, 1));
        assert_eq!(Proof::footprint_from_params(&params), Ok(bytes.len()));
        assert_eq!(params.footprint(), Ok(bytes.len()));

        let mut buf = vec![0xffu8; bytes.len()];
        assert_eq!(Proof::new_from_params(&mut buf, &params), Ok(bytes.len()));
        {
            let mut m = ProofMut::from_slice_mut(&mut buf).unwrap();
            match m.body_mut() {
                ProofBodyRefMut::Updating(mut u) => {
                    u.set_leaf(7);
                    assert_eq!(u.try_set_siblings(&[1]), Err(AbiError::LengthMismatch));
                    assert_eq!(u.siblings_try_set(3, 1), Err(AbiError::OutOfBounds));
                    u.set_siblings(&[10, 20, 0]);
                    assert_eq!(u.siblings_try_set(2, 30), Ok(()));
                }
                _ => panic!("new() selected the wrong variant"),
            }
        }
        assert_eq!(buf, bytes);
        assert_eq!(
            Proof::new(&mut buf[..5], 0, 0, 0),
            Err(AbiError::BufferTooSmall { needed: 10, have: 5 })
        );
        /* A truncated value reports the full size its bytes determine. */
        assert_eq!(
            Proof::validate(&bytes[..bytes.len() - 1]),
            Err(AbiError::BufferTooSmall { needed: bytes.len(), have: bytes.len() - 1 })
        );
        assert_eq!(
            Proof::validate(&bytes[..3]).map_err(|e| e.required_size().is_some()),
            Err(true)
        );

        let entries = BufferSizedEntriesBuilder::new().set_version(9).set_entries(&[1, 2]).build();
        let p = BufferSizedEntriesParams::from_buffer(&entries).unwrap();
        assert_eq!(p.buffer_size, 20);
        assert_eq!(BufferSizedEntries::footprint_from_params(&p), Ok(20));
        assert_eq!(BufferSizedEntries::from_slice(&entries).unwrap().entries_len(), 2);
    }

    #[test]
    fn builders_select_variants_by_name_and_report_params() {
        let (hdr, payload, bytes) = proof_bytes();
        let b = ProofBuilder::new()
            .set_hdr(&hdr)
            .set_body_variant_by_name("updating", &payload);
        assert_eq!(b.dynamic_params(), ProofParams::from_buffer(&bytes));
        assert_eq!(b.build(), bytes);
        let b = ProofBuilder::new()
            .set_hdr(&hdr)
            .try_set_body_variant(Proof::BODY_TAG_UPDATING, &payload)
            .unwrap();
        assert_eq!(b.build(), bytes);
        assert_eq!(ProofBuilder::new().try_set_hdr(&hdr[..3]).unwrap_err(), AbiError::LengthMismatch);
        assert_eq!(
            ProofBuilder::new().try_set_body_variant_by_name("nope", &payload).unwrap_err(),
            AbiError::InvalidVariant
        );
        assert_eq!(
            ProofBuilder::new().try_set_body_variant(9, &payload).unwrap_err(),
            AbiError::InvalidVariant
        );
        assert_eq!(
            ProofHeaderBuilder::new().try_set_bitset(&[1]).unwrap_err(),
            AbiError::LengthMismatch
        );
        assert_eq!(
            MessageWithSDUBuilder::new().try_set_data_medium(&[0; 7]).unwrap_err(),
            AbiError::LengthMismatch
        );
        let m = MessageWithSDUBuilder::new()
            .set_header(1)
            .try_set_data_variant_by_name("medium", &[1, 0, 0, 0, 2, 0, 0, 0])
            .unwrap();
        assert_eq!(m.dynamic_params().map(|p| p.data_variant), Ok(MessageWithSDU::DATA_TAG_MEDIUM as u64));
        assert_eq!(m.build().len(), 9);
        /* An incomplete builder (header selects `updating`, no body) has no params. */
        assert_eq!(
            ProofBuilder::new().set_hdr(&hdr).dynamic_params().map_err(|e| e.required_size().is_some()),
            Err(true)
        );
    }

    #[test]
    fn builders_check_the_selected_variant() {
        let (hdr, payload, _) = proof_bytes();
        let existing = Proof_body_existingBuilder::new().set_siblings(&[1, 2, 3, 4]).build();
        assert_eq!(
            ProofBuilder::new().set_hdr(&hdr).set_body_existing(&existing).try_build(),
            Err(AbiError::InvalidVariant)
        );
        assert!(ProofBuilder::new().set_hdr(&hdr).set_body_updating(&payload[..8]).try_build().is_err());
        let finished = ProofBuilder::new().set_hdr(&hdr).set_body_updating(&payload).finish().unwrap();
        assert_eq!(finished.size(), 26);
    }

    #[test]
    #[should_panic(expected = "index out of range: the len is 3 but the index is 3")]
    fn indexed_accessors_panic_like_slices() {
        let (_, payload, _) = proof_bytes();
        let u = Proof_body_updating::from_slice_with(
            &payload,
            Proof_body_updating__Ext { hdr_bitset_0: 3, hdr_bitset_1: 1 },
        )
        .unwrap();
        let _ = u.siblings_get(3);
    }

    #[test]
    fn deep_validation_reaches_nested_types() {
        assert_eq!(Outer::validate(&[1, 0, 1, 2, 3, 4]), Ok(6));
        assert_eq!(Outer::validate(&[1, 9, 1, 2, 3, 4]), Err(AbiError::InvalidVariant));
        let outer = Outer::from_slice(&[1, 1, 4, 3, 2, 1]).unwrap();
        match outer.inner().value() {
            InnerValueRef::B(v) => assert_eq!(v, 0x0102_0304),
            _ => panic!("expected B"),
        }
    }

    #[test]
    fn jagged_arrays_round_trip() {
        let rec = |d: &[u8]| VarRecordBuilder::new().set_data(d).build();
        let bytes = JaggedRecordsBuilder::new()
            .push_records(&rec(&[1]))
            .push_records(&rec(&[2, 3]))
            .build();
        assert_eq!(bytes, [2, 0, 0, 0, 1, 1, 2, 2, 3]);
        let v = JaggedRecords::from_slice(&bytes).unwrap();
        assert_eq!(v.records_len(), 2);
        assert_eq!(v.records_get(1).data(), &[2, 3]);
        assert_eq!(v.records_try_get(1).map(|r| r.size()), Some(3));
        assert!(v.records_try_get(2).is_none());
        assert!(JaggedRecords::validate(&bytes[..bytes.len() - 1]).is_err());
        assert_eq!(JaggedRecordsParams::from_buffer(&bytes).unwrap().count, 2);

        /* The params carry the jagged field's byte size, not just its count. */
        let single = [1, 4, 0xde, 0xad, 0xbe, 0xef];
        let p = SingleJaggedRecordParams::from_buffer(&single).unwrap();
        assert_eq!((p.has_record, p.record_payload_size), (1, 5));
        assert_eq!(SingleJaggedRecord::footprint_from_params(&p), Ok(6));
        assert_eq!(p.footprint(), Ok(6));
        let mut buf = [0xa5u8; 6];
        assert_eq!(SingleJaggedRecord::new_from_params(&mut buf, &p), Ok(6));
        assert_eq!(buf, [1, 0, 0, 0, 0, 0]);
    }

    #[test]
    fn builders_handle_multiple_interior_and_wide_enums() {
        let dual = DualEnumBuilder::new()
            .set_first_enum_large(&DualEnum_first_enum_LargeBuilder::new().set_value(5).build())
            .set_second_enum_pair(
                &DualEnum_second_enum_PairBuilder::new().set_first(1).set_second(2).build(),
            )
            .build();
        assert_eq!(dual, [1, 1, 5, 0, 0, 0, 1, 0, 2, 0]);
        match DualEnum::from_slice(&dual).unwrap().second_enum() {
            DualEnumSecondEnumRef::Pair(p) => assert_eq!((p.first(), p.second()), (1, 2)),
            _ => panic!("expected pair"),
        }

        let interleaved = InterleavedEnumBuilder::new()
            .set_enum1_word(&InterleavedEnum_enum1_WordBuilder::new().set_value(0x0203).build())
            .set_enum2_single(&InterleavedEnum_enum2_SingleBuilder::new().set_data(9).build())
            .build();
        assert_eq!(interleaved, [1, 3, 2, 1, 9, 0, 0, 0]);

        let wide = U16TagEnumBuilder::new()
            .set_body_big(&U16TagEnum_body_BigBuilder::new().set_value(7).build())
            .build();
        assert_eq!(wide, [2, 1, 7, 0, 0, 0]);
        let view = U16TagEnum::from_slice(&wide).unwrap();
        assert_eq!(view.body_tag(), 258);
        assert!(matches!(view.body(), U16TagEnumBodyRef::Big(_)));

        let sdu = MessageWithSDUBuilder::new()
            .set_header(1)
            .set_data_medium(&MessageWithSDU_data_mediumBuilder::new().set_value1(1).set_value2(2).build())
            .build();
        let v = MessageWithSDU::from_slice(&sdu).unwrap();
        assert_eq!(v.data_tag(), 1);
        assert_eq!(v.data_tag(), MessageWithSDU::DATA_TAG_MEDIUM);
        assert_eq!(MessageWithSDU::data_variant_by_name("medium").and_then(|i| i.payload_size), Some(8));
        assert_eq!(v.data_as_medium().map(|m| (m.value1(), m.value2())), Some((1, 2)));
        assert_eq!(DualEnum::SECOND_ENUM_TAG_PAIR, 1);
        assert!(matches!(v.data(), MessageWithSDUDataRef::Medium(_)));
    }
}
"#,
    )
    .unwrap();
    let result = run_cargo(&project, &["test", "--lib", "--quiet"]);
    let _ = fs::remove_dir_all(&project);
    result.expect("generated API parity tests");
}

/* Top-level enum (tag supplied from outside), union and size-discriminated
 * union, plus a struct embedding the enum. */
const TOP_LEVEL_ABI: &str = r#"
abi:
  package: "test.top_level"
  abi-version: 1
  package-version: "1.0.0"
  description: "Top-level enum, union and size-discriminated union"

types:
  - name: "TopEnum"
    kind:
      enum:
        packed: true
        tag-ref:
          field-ref:
            path: ["kind"]
        variants:
          - name: "A"
            tag-value: 0
            variant-type:
              primitive: u8
          - name: "B"
            tag-value: 7
            variant-type:
              struct:
                packed: true
                fields:
                  - name: "x"
                    field-type:
                      primitive: u16
  - name: "Holder"
    kind:
      struct:
        packed: true
        fields:
          - name: "kind"
            field-type:
              primitive: u8
          - name: "value"
            field-type:
              type-ref:
                name: "TopEnum"
  - name: "TopSdu"
    kind:
      size-discriminated-union:
        packed: true
        variants:
          - name: "small"
            expected-size: 1
            variant-type:
              primitive: u8
          - name: "big"
            expected-size: 4
            variant-type:
              struct:
                packed: true
                fields:
                  - name: "lo"
                    field-type:
                      primitive: u16
                  - name: "hi"
                    field-type:
                      primitive: u16
  - name: "TopUnion"
    kind:
      union:
        packed: true
        variants:
          - name: "word"
            variant-type:
              primitive: u32
          - name: "bytes"
            variant-type:
              array:
                size:
                  literal:
                    u32: 4
                element-type:
                  primitive: u8
"#;

/* Generate `abis` into a fresh crate whose `src/lib.rs` holds `tests`, then
 * run `cargo test` over it. */
fn run_generated_crate_tests(name: &str, abis: &[(&str, String)], tests: &str) {
    let project = generate_crate(name, abis);
    fs::write(
        project.join("Cargo.toml"),
        format!(
            "[package]\nname = \"abi_rust_{}\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[lib]\npath = \"src/lib.rs\"\n\n[workspace]\n",
            name
        ),
    )
    .unwrap();
    fs::write(
        project.join("src/lib.rs"),
        format!(
            "pub mod generated;\n\n#[cfg(test)]\nmod tests {{\n{}\n}}\n",
            tests
        ),
    )
    .unwrap();
    let result = run_cargo(&project, &["test", "--lib", "--quiet"]);
    let _ = fs::remove_dir_all(&project);
    result.unwrap_or_else(|e| panic!("{} generated tests failed: {}", name, e));
}

#[test]
fn test_rust_top_level_sdu_enum_and_union() {
    run_generated_crate_tests(
        "top_level",
        &[("top.abi.yaml", TOP_LEVEL_ABI.to_string())],
        r#"
    use crate::generated::test::top_level::*;
    use crate::generated::tn_abi_runtime::{AbiError, VariantInfo};

    #[test]
    fn variant_metadata_and_tag_constants() {
        assert_eq!((TopEnum::TAG_A, TopEnum::TAG_B), (0, 7));
        assert_eq!(
            TopEnum::VARIANTS,
            &[
                VariantInfo { name: "A", tag: 0, payload_size: Some(1), payload_type: "u8" },
                VariantInfo { name: "B", tag: 7, payload_size: Some(2), payload_type: "TopEnum::B" },
            ]
        );
        assert_eq!(TopEnum::variant_by_name("B").map(|v| v.tag), Some(TopEnum::TAG_B));
        assert_eq!(TopEnum::variant_by_tag(0).map(|v| v.name), Some("A"));
        assert!(TopEnum::variant_by_name("C").is_none());

        let sdu = TopSdu::from_slice(&[1, 2, 3, 4]).unwrap();
        assert_eq!(sdu.tag(), TopSdu::TAG_BIG);
        assert_eq!(TopSdu::TAG_SMALL, 0);
        assert_eq!(TopSdu::variant_by_name("big").and_then(|v| v.payload_size), Some(4));
        assert_eq!(TopSdu::VARIANTS[0].payload_size, Some(1));

        assert_eq!(TopUnion::VARIANTS.len(), 2);
        assert_eq!(TopUnion::variant_by_name("bytes").map(|v| (v.tag, v.payload_size)), Some((1, Some(4))));
    }

    #[test]
    fn top_level_sdu_is_size_checked() {
        let b = [1u8, 2, 3, 4];
        assert_eq!(TopSdu::validate(&b), Ok(4));
        assert_eq!(TopSdu::validate(&b[..1]), Ok(1));
        /* No variant is 3 bytes (or 0, or 5). */
        assert_eq!(TopSdu::validate(&b[..3]), Err(AbiError::InvalidSize));
        assert_eq!(TopSdu::validate(&[]), Err(AbiError::InvalidSize));
        assert_eq!(TopSdu::validate(&[0u8; 5]), Err(AbiError::InvalidSize));
        assert!(TopSdu::from_slice(&b[..3]).is_err());
        assert!(TopSduMut::from_slice_mut(&mut [0u8; 2]).is_err());

        let v = TopSdu::from_slice(&b).unwrap();
        assert_eq!(v.size(), 4);
        assert_eq!(v.tag(), 1);
        assert_eq!(v.body(), &b);
        match v.variant() {
            TopSduRef::Big(big) => assert_eq!((big.lo(), big.hi()), (0x0201, 0x0403)),
            _ => panic!("expected big"),
        }
        assert_eq!(v.as_big().map(|x| x.hi()), Some(0x0403));
        assert!(v.as_small().is_none());
        let small = TopSdu::from_slice(&b[..1]).unwrap();
        assert_eq!((small.tag(), small.as_small()), (0, Some(1)));

        let p = TopSduParams::from_buffer(&b).unwrap();
        assert_eq!(p, TopSduParams { variant: 1 });
        assert_eq!(TopSduParams::KEYS, &[("variant", "variant")]);
        assert_eq!(p.get("variant"), Some(1));
        assert_eq!(p, v.dynamic_params());
        assert_eq!(p.footprint(), Ok(4));
        assert_eq!(TopSdu::footprint_from_params(&TopSduParams { variant: 0 }), Ok(1));
        assert_eq!(
            TopSdu::footprint_from_params(&TopSduParams { variant: 2 }),
            Err(AbiError::InvalidVariant)
        );

        let mut buf = [0xffu8; 4];
        assert_eq!(TopSdu::new(&mut buf, 1), Ok(4));
        assert_eq!(buf, [0; 4]);
        {
            let mut m = TopSduMut::from_slice_mut(&mut buf).unwrap();
            m.as_big_mut().unwrap().set_hi(0x0403);
            match m.variant_mut() {
                TopSduRefMut::Big(mut big) => big.set_lo(0x0201),
                _ => panic!("expected big"),
            }
            assert!(m.as_small_mut().is_none());
        }
        assert_eq!(buf, b);
        assert_eq!(
            TopSdu::new(&mut buf[..2], 1),
            Err(AbiError::BufferTooSmall { needed: 4, have: 2 })
        );
    }

    #[test]
    fn top_level_enum_takes_its_tag_from_outside() {
        let b = [0x34u8, 0x12];
        let e = TopEnum::from_slice_with(&b, TopEnum__Ext { kind: 7 }).unwrap();
        assert_eq!(e.tag(), 7);
        assert_eq!(e.size(), 2);
        assert_eq!(e.as_b().map(|x| x.x()), Some(0x1234));
        assert!(e.as_a().is_none());
        assert_eq!(
            TopEnum::validate_with(&b, &TopEnum__Ext { kind: 3 }),
            Err(AbiError::InvalidVariant)
        );
        let a = TopEnum::from_slice_with(&b[..1], TopEnum__Ext { kind: 0 }).unwrap();
        assert_eq!(a.as_a(), Some(0x34));

        let h = Holder::from_slice(&[7, 0x34, 0x12]).unwrap();
        assert_eq!(h.value().as_b().map(|x| x.x()), Some(0x1234));

        /* Params: the outside inputs, with the same footprint/new API as structs. */
        let mut p = TopEnumParams::from_values(7);
        assert_eq!(p, e.dynamic_params());
        assert_eq!(TopEnumParams::KEYS, &[("kind", "kind")]);
        assert_eq!(p.footprint(), Ok(2));
        assert_eq!(TopEnum::footprint_from_params(&p), Ok(2));
        assert!(p.set("kind", 0));
        assert_eq!((p.get("kind"), p.footprint()), (Some(0), Ok(1)));
        assert!(!p.set("nope", 1));
        assert_eq!(p.get("nope"), None);
        p.kind = 3;
        assert_eq!(p.footprint(), Err(AbiError::InvalidVariant));
        let mut buf = [0xffu8; 2];
        assert_eq!(TopEnum::new(&mut buf, 7), Ok(2));
        assert_eq!(buf, [0, 0]);
        assert_eq!(TopEnum::new_from_params(&mut buf, &TopEnumParams { kind: 0 }), Ok(1));
        let mut m = TopEnumMut::from_slice_mut_with(&mut buf, TopEnumParams { kind: 7 }).unwrap();
        m.as_b_mut().unwrap().set_x(0x1234);
        assert_eq!(buf, b);

        /* Struct roots expose the same generic accessors. */
        let hp = HolderParams::from_buffer(&[7, 0x34, 0x12]).unwrap();
        assert_eq!(HolderParams::KEYS, &[("kind", "kind")]);
        assert_eq!(hp.get("kind"), Some(7));
    }

    #[test]
    fn variant_builders_select_by_setter_or_name() {
        let bytes = TopSduBuilder::new().try_set_big(&[1, 2, 3, 4]).unwrap().build();
        assert_eq!(bytes, [1, 2, 3, 4]);
        assert_eq!(TopSduBuilder::new().try_set_big(&[1, 2, 3]).unwrap_err(), AbiError::LengthMismatch);
        let b = TopSduBuilder::new().set_variant_by_name("small", &[9]);
        assert_eq!(b.dynamic_params(), Ok(TopSduParams { variant: TopSdu::TAG_SMALL as u64 }));
        assert_eq!(b.clone().finish().unwrap().as_small(), Some(9));
        assert_eq!(b.build_into(&mut [0u8; 0]), Err(AbiError::BufferTooSmall { needed: 1, have: 0 }));
        assert_eq!(
            TopSduBuilder::new().try_set_variant_by_name("huge", &[1]).unwrap_err(),
            AbiError::InvalidVariant
        );
        assert_eq!(
            TopSduBuilder::new().try_set_variant_by_name("small", &[1, 2]).unwrap_err(),
            AbiError::LengthMismatch
        );
        /* Nothing selected: no variant is zero bytes long. */
        assert_eq!(TopSduBuilder::new().try_build(), Err(AbiError::InvalidSize));

        /* A top-level enum's builder reports the tag its container must store. */
        let b = TopEnumBuilder::new().set_b(&[0x34, 0x12]);
        assert_eq!(b.dynamic_params(), Ok(TopEnumParams { kind: TopEnum::TAG_B }));
        assert_eq!(b.clone().finish().unwrap().as_b().map(|x| x.x()), Some(0x1234));
        assert_eq!(b.build(), [0x34, 0x12]);
        let a = TopEnumBuilder::new().try_set_variant(0, &[5]).unwrap();
        assert_eq!(a.dynamic_params(), Ok(TopEnumParams { kind: 0 }));
        assert_eq!(TopEnumBuilder::new().try_set_variant(3, &[0]).unwrap_err(), AbiError::InvalidVariant);
        assert_eq!(TopEnumBuilder::new().try_set_a(&[0, 0]).unwrap_err(), AbiError::LengthMismatch);
        assert_eq!(TopEnumBuilder::new().try_build(), Err(AbiError::InvalidVariant));
        assert_eq!(TopEnumBuilder::new().dynamic_params(), Err(AbiError::InvalidVariant));

        /* Struct builders expose the params of what they would build. */
        let enum_bytes = TopEnumBuilder::new().set_variant_by_name("B", &[0x34, 0x12]).build();
        let holder = HolderBuilder::new().set_kind(7).set_value(&enum_bytes);
        assert_eq!(holder.dynamic_params(), Ok(HolderParams { kind: 7 }));
        assert_eq!(holder.build(), [7, 0x34, 0x12]);

        let u = TopUnionBuilder::new();
        assert_eq!(u.clone().try_set_bytes(&[0; 5]).unwrap_err(), AbiError::LengthMismatch);
        assert_eq!(u.clone().try_set_encoding(&[0; 3]).unwrap_err(), AbiError::LengthMismatch);
        assert_eq!(u.set_bytes(&[1, 0, 0, 0]).build(), [1, 0, 0, 0]);
    }

    #[test]
    #[should_panic(expected = "invalid builder input: length mismatch")]
    fn panicking_setters_report_the_try_error() {
        let _ = TopSduBuilder::new().set_big(&[1]);
    }

    #[test]
    fn top_level_union_views_share_bytes() {
        let b = [0x0d, 0x0c, 0x0b, 0x0a];
        let u = TopUnion::from_slice(&b).unwrap();
        assert_eq!(u.word(), 0x0a0b0c0d);
        assert_eq!(u.bytes(), &b);
        assert_eq!(
            TopUnion::validate(&b[..3]),
            Err(AbiError::BufferTooSmall { needed: 4, have: 3 })
        );
    }
"#,
    );
}

/* A union is valid only when every variant validates over its bytes, so an
 * undeclared enum tag inside a union variant fails the union's validation
 * and that of every type embedding it. */
#[test]
fn test_rust_union_variants_validate_nested_values() {
    let abi = fs::read_to_string("tests/compliance_data/nested_union_validation.abi.yaml").unwrap();
    run_generated_crate_tests(
        "nested_union_validation",
        &[("nested_union_validation.abi.yaml", abi)],
        r#"
    use crate::generated::test::nested_union_validation::*;
    use crate::generated::tn_abi_runtime::AbiError;

    const GOOD: [u8; 10] = [7, 1, 4, 3, 2, 1, 2, 9, 0, 0];

    #[test]
    fn valid_tags_pass() {
        assert_eq!(Holder::validate(&GOOD), Ok(10));
        assert_eq!(Choice::validate(&GOOD[1..6]), Ok(5));
        assert_eq!(InlineChoice::validate(&GOOD[6..]), Ok(4));
        let holder = Holder::from_slice(&GOOD).unwrap();
        assert_eq!(holder.choice().tagged().tag(), 1);
    }

    #[test]
    fn undeclared_tag_in_a_type_ref_variant_fails() {
        let mut bad = GOOD;
        bad[1] = 9;
        assert_eq!(Choice::validate(&bad[1..6]), Err(AbiError::InvalidVariant));
        assert_eq!(Holder::validate(&bad), Err(AbiError::InvalidVariant));
        assert!(Holder::from_slice(&bad).is_err());
        assert!(HolderParams::from_buffer(&bad).is_err());
    }

    #[test]
    fn undeclared_tag_in_an_inline_variant_fails() {
        let mut bad = GOOD;
        bad[6] = 0;
        assert_eq!(InlineChoice::validate(&bad[6..]), Err(AbiError::InvalidVariant));
        assert_eq!(Holder::validate(&bad), Err(AbiError::InvalidVariant));
        assert!(HolderMut::from_slice_mut(&mut bad).is_err());
    }
"#,
    );
}

/* `["..", "count"]` inside an inline child that has its own `count` names
 * the enclosing struct's field, never the child's sibling. */
#[test]
fn test_rust_parent_scope_ref_uses_outer_field() {
    let abi = fs::read_to_string("tests/compliance_data/parent_scope_count.abi.yaml").unwrap();
    run_generated_crate_tests(
        "parent_scope_count",
        &[("parent_scope_count.abi.yaml", abi)],
        r#"
    use crate::generated::test::parent_scope_count::*;

    #[test]
    fn outer_count_sizes_the_child_array() {
        /* Outer.count = 2, inner.count = 5, two items, tail. */
        let bytes = [2u8, 5, 0xaa, 0xbb, 0x77];
        assert_eq!(Outer::validate(&bytes), Ok(5));
        let view = Outer::from_slice(&bytes).unwrap();
        let inner = view.inner();
        assert_eq!((inner.count(), inner.items()), (5, &[0xaa, 0xbb][..]));
        assert_eq!((inner.size(), view.tail()), (3, 0x77));
        assert!(Outer::validate(&bytes[..4]).is_err());

        let p = OuterParams::from_buffer(&bytes).unwrap();
        assert_eq!(p.count, 2);
        assert_eq!(Outer::footprint_from_params(&p), Ok(5));
        let mut buf = [0xa5u8; 5];
        assert_eq!(Outer::new(&mut buf, 2), Ok(5));
        assert_eq!(buf, [2, 0, 0, 0, 0]);

        /* The child's own count does not size the array. */
        let other = [1u8, 9, 0xaa, 0x77];
        assert_eq!(Outer::validate(&other), Ok(4));
        assert_eq!(Outer::from_slice(&other).unwrap().inner().items(), &[0xaa]);
    }
"#,
    );
}

/* Views, validation, params and initialization build without `std`. */
#[test]
fn test_rust_generated_code_is_no_std() {
    let abis: Vec<(&str, String)> = [
        "enums",
        "nested_refs",
        "jagged_arrays",
        "unions",
        "size_discriminated_unions",
        "buffer_sized",
        "array_structs",
    ]
    .into_iter()
    .map(compliance_abi)
    .collect();
    let project = generate_crate("no_std", &abis);
    let mut generated = Vec::new();
    for entry in walk(&project.join("src/generated")) {
        let text = fs::read_to_string(&entry).unwrap();
        assert!(
            !text.contains("std::"),
            "{} uses std (generated code must be core/alloc only)",
            entry.display()
        );
        assert!(
            !text.contains("_ => 0"),
            "{} has a zero-size fallback",
            entry.display()
        );
        assert!(!text.contains("Box::leak"), "{} leaks", entry.display());
        generated.push(entry);
    }
    assert!(!generated.is_empty());
    fs::write(
        project.join("Cargo.toml"),
        "[package]\nname = \"abi_rust_no_std\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[lib]\npath = \"src/lib.rs\"\n\n[workspace]\n",
    )
    .unwrap();
    fs::write(
        project.join("src/lib.rs"),
        r#"#![no_std]
pub mod generated;

use generated::compliance::nested_refs::{Proof, ProofParams};

/* Exercise the allocation-free surface from no_std code. */
pub fn proof_size(data: &[u8]) -> Result<usize, generated::tn_abi_runtime::AbiError> {
    let params = ProofParams::from_buffer(data)?;
    let size = Proof::footprint_from_params(&params)?;
    let _ = Proof::from_slice(data)?.body_tag();
    Ok(size)
}
"#,
    )
    .unwrap();
    let result = run_cargo(&project, &["check", "--quiet"]);
    let _ = fs::remove_dir_all(&project);
    result.expect("generated code should build in a #![no_std] crate");
}

fn walk(dir: &Path) -> Vec<std::path::PathBuf> {
    let mut out = Vec::new();
    for entry in fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            out.extend(walk(&path));
        } else if path.extension().and_then(|e| e.to_str()) == Some("rs") {
            out.push(path);
        }
    }
    out
}

/* Parsed `test_cases/<group>/<case>.yaml`: (ABI file name, type, bytes). */
fn compliance_cases() -> Vec<(String, String, Vec<u8>)> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/compliance_tests/test_cases");
    let mut files = walk_ext(&root, "yaml");
    files.sort();
    let mut out = Vec::new();
    for path in files {
        let text = fs::read_to_string(&path).unwrap();
        let value: serde_yml::Value = serde_yml::from_str(&text).unwrap();
        let case = &value["test-case"];
        let abi = case["abi-file"].as_str().unwrap();
        let abi = Path::new(abi).file_name().unwrap().to_str().unwrap();
        let ty = case["type"].as_str().unwrap();
        let hex: String = case["binary-hex"]
            .as_str()
            .unwrap()
            .chars()
            .filter(|c| c.is_ascii_hexdigit())
            .collect();
        let bytes = (0..hex.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap())
            .collect();
        out.push((abi.to_string(), ty.to_string(), bytes));
    }
    out
}

fn walk_ext(dir: &Path, ext: &str) -> Vec<std::path::PathBuf> {
    let mut out = Vec::new();
    for entry in fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            out.extend(walk_ext(&path, ext));
        } else if path.extension().and_then(|e| e.to_str()) == Some(ext) {
            out.push(path);
        }
    }
    out
}

/* For every type with `<T>Params::from_buffer` in every compliance ABI (and
 * the type-library `TokenInstruction`, whose initialize variants carry a state
 * proof): `from_buffer(bytes).footprint()` and `new_from_params` must give the
 * size `validate` reports. Bytes come from the compliance cases and from a
 * deterministic fuzzer over small byte values (small counts and tags). */
#[test]
fn test_rust_params_footprint_roundtrip() {
    use abi_gen::codegen::rust_gen::emit::Emitter;
    use abi_gen::codegen::rust_gen::model::Model;

    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    /* (module stem, ABI file): the compliance definitions plus the
     * standalone compliance_data ABIs (EventEnvelope, TailEnumPayload, ...). */
    let mut abi_files: Vec<(String, std::path::PathBuf)> = Vec::new();
    for (dir, prefix) in [
        ("tests/compliance_tests/abi_definitions", ""),
        ("tests/compliance_data", "data_"),
    ] {
        let mut paths = walk_ext(&manifest.join(dir), "yaml");
        paths.sort();
        for p in paths {
            let stem = p.file_name().unwrap().to_str().unwrap();
            /* Deliberately rejected by layout analysis: these fixtures have
             * top-level types aligned past 1, which the CLI refuses. */
            if stem == "top_level_array_layouts.abi.yaml"
                || stem == "trailing_padding.abi.yaml"
                || stem == "trailing_padding_c.abi.yaml"
                || stem == "shared_count.abi.yaml"
            {
                continue;
            }
            let stem = format!("{}{}", prefix, stem.trim_end_matches(".abi.yaml"));
            abi_files.push((stem, p));
        }
    }

    let mut checks = String::new();
    /* (module stem, type, check fn) */
    let mut types: Vec<(String, String, String)> = Vec::new();
    for (stem, path) in &abi_files {
        let text = fs::read_to_string(path).unwrap();
        let abi: AbiFile = serde_yml::from_str(&text).unwrap();
        /* Compliance ABIs reuse type names, so each gets its own module. */
        let package: Vec<String> = abi
            .package()
            .split('.')
            .map(abi_gen::codegen::rust_gen::model::escape_ident)
            .collect();
        let module = format!("crate::gen_{}::{}", stem, package.join("::"));
        let resolver = resolve_types_from_abi(path.to_str().unwrap()).unwrap();
        let model = Model::new(&resolver);
        let e = Emitter::new(&model);
        let mut names: Vec<&String> = resolver.types.keys().collect();
        names.sort();
        for name in names {
            model.collect_named(name);
            let vname = e.nm(name).ty.clone();
            let Some(v) = e.info(name) else { continue };
            if !e.has_params_struct(&v) {
                continue;
            }
            let check = format!("check_{}_{}", stem, vname.trim_start_matches("r#"));
            checks.push_str(&format!(
                r#"
fn {check}(data: &[u8]) -> bool {{
    let Ok(n) = {module}::{vname}::validate(data) else {{ return false }};
    let d = &data[..n];
    if {module}::{vname}::validate(d) != Ok(n) {{ return false; }}
    let p = {module}::{pt}::from_buffer(d).expect("from_buffer");
    assert_eq!(p.footprint(), Ok(n), "{name}: footprint of {{:?}} for {{:02x?}}", p, d);
    let mut buf = vec![0xa5u8; n];
    assert_eq!({module}::{vname}::new_from_params(&mut buf, &p), Ok(n), "{name}: new_from_params for {{:02x?}}", d);
    let mut generic = {module}::{pt}::default();
    for (field, path) in {module}::{pt}::KEYS {{ assert!(generic.set(path, p.get(field).expect("key"))); }}
    assert_eq!(generic, p, "{name}: params rebuilt from KEYS");
    true
}}
"#,
                pt = e.nm(name).params,
            ));
            types.push((stem.clone(), name.clone(), check));
        }
    }
    assert!(
        types.len() > 20,
        "too few parameterized types: {}",
        types.len()
    );

    let mut case_lines = String::new();
    for (abi, ty, bytes) in compliance_cases() {
        let stem = abi.trim_end_matches(".abi.yaml");
        if let Some((_, _, check)) = types.iter().find(|(f, t, _)| f == stem && *t == ty) {
            case_lines.push_str(&format!(
                "    assert!({check}(&{bytes:?}), \"{abi} {ty}: case does not validate\");\n    covered.insert(\"{check}\");\n"
            ));
        }
    }
    let fuzz_list = types
        .iter()
        .map(|(_, _, c)| format!("(\"{c}\", {c} as fn(&[u8]) -> bool)"))
        .collect::<Vec<_>>()
        .join(",\n        ");

    let tests = format!(
        r#"
{checks}

/* tag 0 (initialize_mint), 141 bytes of mint fields, then a state proof:
 * type_slot 0 (existing) and a path bitset with 2 bits set -> 2 sibling hashes. */
fn token_initialize_mint() -> Vec<u8> {{
    let mut d = vec![0u8; 1 + 141];
    d.extend_from_slice(&[0u8; 8]);
    let mut bitset = [0u8; 32];
    bitset[0] = 0b11;
    d.extend_from_slice(&bitset);
    d.extend_from_slice(&[0x11u8; 64]);
    d
}}

#[test]
fn token_instruction_footprint() {{
    use crate::gen_token::thru::program::token::{{TokenInstruction, TokenInstructionParams}};
    let data = token_initialize_mint();
    assert_eq!(data.len(), 246);
    assert_eq!(TokenInstruction::validate(&data), Ok(246));
    let p = TokenInstructionParams::from_buffer(&data).unwrap();
    assert_eq!(p.footprint(), Ok(246));
    assert_eq!(TokenInstruction::footprint_from_params(&p), Ok(246));
    let mut buf = vec![0xa5u8; 246];
    assert_eq!(TokenInstruction::new_from_params(&mut buf, &p), Ok(246));
    assert_eq!(p.get("payload.payload_size"), Some(245));
}}

#[test]
fn compliance_cases_and_fuzzed_values() {{
    let mut covered = std::collections::BTreeSet::new();
{case_lines}
    let checks: &[(&str, fn(&[u8]) -> bool)] = &[
        {fuzz_list}
    ];
    let mut rng: u64 = 0x9e37_79b9_7f4a_7c15;
    let mut next = move || {{ rng ^= rng << 13; rng ^= rng >> 7; rng ^= rng << 17; rng }};
    for (name, check) in checks {{
        for _ in 0..4000 {{
            let len = (next() % 160) as usize;
            let buf: Vec<u8> = (0..len)
                .map(|_| match next() % 16 {{
                    0..=7 => 0,
                    8..=10 => 1,
                    11 => 2,
                    12 => 3,
                    _ => next() as u8,
                }})
                .collect();
            if check(&buf) {{
                covered.insert(*name);
            }}
        }}
    }}
    let missing: Vec<&str> = checks.iter().map(|(n, _)| *n).filter(|n| !covered.contains(n)).collect();
    assert!(missing.is_empty(), "no valid bytes for {{:?}}", missing);
}}
"#
    );

    let project = std::env::temp_dir().join(format!("abi_rust_params_fp_{}", std::process::id()));
    let _ = fs::remove_dir_all(&project);
    let library = manifest.join("../type-library");
    let mut units = abi_files.clone();
    units.push((
        "token".to_string(),
        library.join("tn_token_program.abi.yaml"),
    ));
    let mut mods = String::new();
    for (stem, file) in &units {
        abi_gen::cmds::codegen::run(
            vec![file.clone()],
            vec![library.clone()],
            abi_gen::cmds::codegen::Language::Rust,
            project.join(format!("src/gen_{}", stem)),
            false,
        )
        .expect("codegen");
        mods.push_str(&format!(
            "#[path = \"gen_{0}/mod.rs\"]\npub mod gen_{0};\n",
            stem
        ));
    }
    fs::write(
        project.join("Cargo.toml"),
        "[package]\nname = \"abi_rust_params_fp\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[lib]\npath = \"src/lib.rs\"\n\n[workspace]\n",
    )
    .unwrap();
    fs::write(
        project.join("src/lib.rs"),
        format!(
            "#![allow(dead_code)]\n{}\n#[cfg(test)]\nmod tests {{\n{}\n}}\n",
            mods, tests
        ),
    )
    .unwrap();
    let result = run_cargo(&project, &["test", "--lib", "--quiet"]);
    if result.is_ok() {
        let _ = fs::remove_dir_all(&project);
    }
    result.unwrap_or_else(|e| panic!("params footprint round-trip failed: {}", e));
}

/* Types named after std prelude items (and the `core` / `alloc` crates).
 * Generated code spells std items by absolute path, so these must not
 * shadow anything. `Ok` / `Err` / `Some` / `None` live in the value
 * namespace, which generated items (type aliases, braced structs) never
 * occupy. Each name in `PRELUDE_TRAIT_NAMES` becomes a struct with an enum
 * field; the fixed types below cover views, params, builders, a top-level
 * enum, a size-discriminated union, a union and an array. */
const PRELUDE_NAMES_ABI: &str = r#"
abi:
  package: "test.prelude_names"
  abi-version: 1
  package-version: "1.0.0"
  description: "Types named after std prelude items"

types:
  - name: "Option"
    kind:
      struct:
        packed: true
        fields:
          - name: "n"
            field-type:
              primitive: u8
          - name: "items"
            field-type:
              array:
                size:
                  field-ref:
                    path: ["n"]
                element-type:
                  primitive: u16
  - name: "Some"
    kind:
      struct:
        packed: true
        fields:
          - name: "value"
            field-type:
              primitive: u32
  - name: "Box"
    kind:
      struct:
        packed: true
        fields:
          - name: "a"
            field-type:
              primitive: u8
          - name: "b"
            field-type:
              primitive: u64
  - name: "Sized"
    kind:
      enum:
        packed: true
        tag-ref:
          field-ref:
            path: ["kind"]
        variants:
          - name: "Ok"
            tag-value: 0
            variant-type:
              type-ref:
                name: "Some"
          - name: "Err"
            tag-value: 1
            variant-type:
              type-ref:
                name: "Option"
  - name: "Vec"
    kind:
      size-discriminated-union:
        packed: true
        variants:
          - name: "String"
            expected-size: 4
            variant-type:
              type-ref:
                name: "Some"
          - name: "Clone"
            expected-size: 9
            variant-type:
              type-ref:
                name: "Box"
  - name: "Default"
    kind:
      union:
        packed: true
        variants:
          - name: "Copy"
            variant-type:
              primitive: u32
          - name: "Iterator"
            variant-type:
              type-ref:
                name: "Some"
  - name: "Ok"
    kind:
      struct:
        packed: true
        fields:
          - name: "len"
            field-type:
              primitive: u8
          - name: "bytes"
            field-type:
              array:
                size:
                  field-ref:
                    path: ["len"]
                element-type:
                  primitive: u8
  - name: "Err"
    kind:
      array:
        size:
          literal:
            u32: 2
        element-type:
          type-ref:
            name: "Some"
  - name: "Result"
    kind:
      struct:
        packed: true
        fields:
          - name: "kind"
            field-type:
              primitive: u8
          - name: "count"
            field-type:
              primitive: u8
          - name: "sized"
            field-type:
              type-ref:
                name: "Sized"
          - name: "option"
            field-type:
              type-ref:
                name: "Option"
          - name: "records"
            field-type:
              array:
                jagged: true
                size:
                  field-ref:
                    path: ["count"]
                element-type:
                  type-ref:
                    name: "Ok"
          - name: "default"
            field-type:
              type-ref:
                name: "Default"
          - name: "err"
            field-type:
              type-ref:
                name: "Err"
          - name: "boxed"
            field-type:
              type-ref:
                name: "Box"
"#;

const PRELUDE_TRAIT_NAMES: &[&str] = &[
    "None",
    "String",
    "Clone",
    "Copy",
    "Iterator",
    "From",
    "Into",
    "AsRef",
    "AsMut",
    "PartialEq",
    "Eq",
    "Send",
    "Sync",
    "Unpin",
    "Drop",
    "FnMut",
    "FnOnce",
    "ToString",
    "ToOwned",
    "TryFrom",
    "TryInto",
    "IntoIterator",
    "Extend",
    "FromIterator",
    "Ord",
    "PartialOrd",
    "DoubleEndedIterator",
    "ExactSizeIterator",
    "Debug",
    "core",
    "alloc",
];

fn prelude_names_abi() -> String {
    let mut abi = PRELUDE_NAMES_ABI.to_string();
    for name in PRELUDE_TRAIT_NAMES {
        abi.push_str(&format!(
            r#"  - name: "{name}"
    kind:
      struct:
        packed: true
        fields:
          - name: "tag"
            field-type:
              primitive: u8
          - name: "body"
            field-type:
              enum:
                packed: true
                tag-ref:
                  field-ref:
                    path: ["tag"]
                variants:
                  - name: "a"
                    tag-value: 0
                    variant-type:
                      type-ref:
                        name: "Ok"
                  - name: "b"
                    tag-value: 1
                    variant-type:
                      type-ref:
                        name: "Some"
"#
        ));
    }
    abi
}

#[test]
fn test_rust_prelude_named_types() {
    let mut per_name = String::new();
    for name in PRELUDE_TRAIT_NAMES {
        let ty = abi_gen::codegen::rust_gen::model::view_name(name);
        per_name.push_str(&format!(
            r#"
        {{
            let data = [0u8, 2, 0xab, 0xcd];
            assert_eq!(p::{ty}::validate(&data), Ok(4));
            let v = p::{ty}::from_slice(&data).unwrap();
            assert_eq!(v.body_as_a().unwrap().bytes(), &[0xab, 0xcd]);
            let params = p::{ty}Params::from_buffer(&data).unwrap();
            assert_eq!(params.footprint(), Ok(4));
            let built = p::{ty}Builder::new().set_tag(1).set_body_b(&some(9)).build();
            assert_eq!(p::{ty}::from_slice(&built).unwrap().body_as_b().unwrap().value(), 9);
        }}
"#
        ));
    }
    let tests = format!(
        r#"
    use crate::generated::test::prelude_names as p;

    fn some(v: u32) -> Vec<u8> {{ p::SomeBuilder::new().set_value(v).build() }}
    fn option(items: &[u16]) -> Vec<u8> {{ p::OptionBuilder::new().set_items(items).build() }}
    fn ok(bytes: &[u8]) -> Vec<u8> {{ p::OkBuilder::new().set_bytes(bytes).build() }}
    fn boxed(a: u8, b: u64) -> Vec<u8> {{ p::BoxBuilder::new().set_a(a).set_b(b).build() }}

    #[test]
    fn result_struct_views_params_and_builders() {{
        let sized = p::SizedBuilder::new().set_err(&option(&[1, 2])).build();
        let mut err = some(1);
        err.extend_from_slice(&some(2));
        let data = p::ResultBuilder::new()
            .set_kind(1)
            .set_sized(&sized)
            .set_option(&option(&[7]))
            .set_records(&[&ok(&[0xaa]), &ok(&[])])
            .set_default(&7u32.to_le_bytes())
            .set_err(&err)
            .set_boxed(&boxed(3, 9))
            .build();
        assert_eq!(data.len(), 34);
        assert_eq!(p::Result::validate(&data), Ok(34));

        let v = p::Result::from_slice(&data).unwrap();
        assert_eq!((v.kind(), v.count()), (1, 2));
        match v.sized().variant() {{
            p::SizedRef::Err(o) => assert_eq!((o.items_len(), o.items_get(1)), (2, 2)),
            _ => panic!("sized variant"),
        }}
        assert!(v.sized().as_ok().is_none());
        assert_eq!(v.option().items_get(0), 7);
        assert_eq!(v.records_get(0).bytes(), &[0xaa]);
        assert_eq!(v.records_get(1).len(), 0);
        assert_eq!(v.err().get(1).value(), 2);
        assert_eq!(v.boxed().b(), 9);

        let params = p::ResultParams::from_buffer(&data).unwrap();
        assert_eq!(params.footprint(), Ok(34));
        assert_eq!(params.get("sized.payload_size"), Some(5));
        assert_eq!(params.get("option.payload_size"), Some(3));
        assert_eq!(params.get("records.payload_size"), Some(3));
        let mut buf = vec![0xa5u8; 34];
        assert_eq!(p::Result::new_from_params(&mut buf, &params), Ok(34));
        let built = p::ResultBuilder::new().set_kind(1).set_sized(&sized);
        assert!(built.dynamic_params().is_err());

        let owned = p::ResultBuilder::new()
            .set_kind(0)
            .set_sized(&some(5))
            .set_option(&option(&[]))
            .set_default(&[0; 4])
            .set_err(&err)
            .set_boxed(&boxed(0, 0))
            .finish()
            .unwrap();
        assert_eq!(owned.sized().as_ok().unwrap().value(), 5);
    }}

    #[test]
    fn vec_sdu_default_union_and_sized_enum() {{
        let data = p::VecBuilder::new().set_clone(&boxed(1, 2)).build();
        let v = p::Vec::from_slice(&data).unwrap();
        assert_eq!(v.tag(), p::Vec::TAG_CLONE);
        assert_eq!(v.as_clone().unwrap().b(), 2);
        assert_eq!(p::VecParams::from_buffer(&data).unwrap().footprint(), Ok(9));
        assert_eq!(p::Vec::variant_by_name("String").map(|x| x.payload_size), Some(Some(4)));

        let d = p::Default::from_slice(&[7, 0, 0, 0]).unwrap();
        assert_eq!(d.Copy(), 7);
        assert_eq!(d.Iterator().value(), 7);

        let ext = p::SizedParams::from_values(0);
        assert_eq!(p::Sized::footprint_from_params(&ext), Ok(4));
        let s = p::Sized::from_slice_with(&[5, 0, 0, 0], ext).unwrap();
        assert_eq!(s.as_ok().unwrap().value(), 5);
    }}

    #[test]
    fn trait_named_types() {{
{per_name}
    }}
"#
    );
    run_generated_crate_tests(
        "prelude_names",
        &[("prelude_names.abi.yaml", prelude_names_abi())],
        &tests,
    );
}

/* On a short buffer, `validate` reports the exact required size whenever the
 * bytes present fix it (every length/tag field read and every jagged element
 * start lies inside them), matching the C backend's MEASURE walk. Inputs and
 * sizes come from a C/Rust differential fuzz where Rust used to report a
 * smaller lower bound; padding each input to the reported size validates. */
#[test]
fn test_rust_short_buffer_reports_exact_required_size() {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let library = manifest.join("../type-library");
    let units = [
        (
            "psc",
            manifest.join("tests/compliance_data/parent_scope_count.abi.yaml"),
        ),
        (
            "psr",
            manifest.join("tests/compliance_data/parent_scope_refs.abi.yaml"),
        ),
        (
            "vu",
            manifest.join("tests/compliance_data/variable_union.abi.yaml"),
        ),
        (
            "dna",
            manifest.join(
                "tests/compliance_tests/abi_definitions/deeply_nested_array_structs.abi.yaml",
            ),
        ),
        ("sp", library.join("state_proof.abi.yaml")),
    ];
    let project = std::env::temp_dir().join(format!("abi_rust_short_need_{}", std::process::id()));
    let _ = fs::remove_dir_all(&project);
    let mut mods = String::new();
    for (stem, file) in &units {
        abi_gen::cmds::codegen::run(
            vec![file.clone()],
            vec![library.clone()],
            abi_gen::cmds::codegen::Language::Rust,
            project.join(format!("src/gen_{}", stem)),
            false,
        )
        .expect("codegen");
        mods.push_str(&format!(
            "#[path = \"gen_{0}/mod.rs\"]\npub mod gen_{0};\n",
            stem
        ));
    }
    let tests = r#"
    use crate::gen_psc::tn_abi_runtime::AbiError;

    fn hex(s: &str) -> Vec<u8> {
        (0..s.len() / 2).map(|i| u8::from_str_radix(&s[2 * i..2 * i + 2], 16).unwrap()).collect()
    }

    /* `validate(input)` reports `need`; the input zero-padded to `need`
     * validates and consumes exactly `need`. */
    macro_rules! exact_need {
        ($ty:path, $input:expr, $need:expr) => {{
            let mut b = hex($input);
            let have = b.len();
            match <$ty>::validate(&b) {
                Err(e) => assert_eq!(
                    (e.required_size(), format!("{:?}", e).starts_with("BufferTooSmall")),
                    (Some($need), true),
                    "{} {}",
                    stringify!($ty),
                    $input
                ),
                Ok(n) => panic!("{} {} validated ({} bytes)", stringify!($ty), $input, n),
            }
            let _ = AbiError::Unsupported;
            assert!(have < $need);
            b.resize($need, 0);
            assert_eq!(<$ty>::validate(&b), Ok($need), "{} {} padded", stringify!($ty), $input);
        }};
    }

    #[test]
    fn short_buffers_report_exact_sizes() {
        /* Child array sized by the enclosing struct's count, read first. */
        exact_need!(crate::gen_psc::test::parent_scope_count::Outer, "34", 55);
        exact_need!(crate::gen_psr::compliance::parent_scope_refs::ScopedDeep, "00", 3);
        /* Every union variant is measured; the union spans the largest. */
        exact_need!(crate::gen_vu::compliance::variable_union::VarUnion, "01", 4);
        /* Jagged elements that start inside the bytes present are measured. */
        exact_need!(
            crate::gen_dna::compliance::deeply_nested_array_structs::ParentWithDeeplyNestedArray,
            "0000020003990000",
            39183
        );
        /* Size computed from the header's type and all 256 path-bitset
        bits, so the whole 40-byte header must be present: type 1, 19 bits
        set, 40 + (1 + 19) * 32 = 680. */
        exact_need!(
            crate::gen_sp::thru::blockchain::state_proof::StateProof,
            "a675e6888e29044bb752c4fd00000000000000000000000000000000000000000000000000000000",
            680
        );
    }

    #[test]
    fn undetermined_sizes_stay_lower_bounds() {
        use crate::gen_psc::test::parent_scope_count::Outer;
        /* No bytes: the count is unread, so only the bytes to read it are known. */
        assert_eq!(Outer::validate(&[]).unwrap_err().required_size(), Some(1));
    }
"#;
    fs::write(
        project.join("Cargo.toml"),
        "[package]\nname = \"abi_rust_short_need\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[lib]\npath = \"src/lib.rs\"\n\n[workspace]\n",
    )
    .unwrap();
    fs::write(
        project.join("src/lib.rs"),
        format!(
            "#![allow(dead_code)]\n{}\n#[cfg(test)]\nmod tests {{\n{}\n}}\n",
            mods, tests
        ),
    )
    .unwrap();
    let result = run_cargo(&project, &["test", "--lib", "--quiet"]);
    if result.is_ok() {
        let _ = fs::remove_dir_all(&project);
    }
    result.unwrap_or_else(|e| panic!("short-buffer required sizes: {}", e));
}

/* Inline enums used as array elements or as another enum's payload are views
 * of their own: walkers size each by its tag (variants of different sizes),
 * so validation, accessors, params footprints and builders all work. The tag
 * may live in the enclosing struct or in the element struct holding the
 * enum (an enum has no fields, so its own bytes cannot hold its tag). */
#[test]
fn test_rust_nested_inline_enums() {
    let abi = fs::read_to_string("tests/compliance_data/nested_inline_enums.abi.yaml").unwrap();
    run_generated_crate_tests(
        "nested_inline_enums",
        &[("nested_inline_enums.abi.yaml", abi)],
        r#"
    use crate::generated::compliance::nested_inline_enums::*;

    #[test]
    fn enum_array_elements() {
        /* kind 1 (u32 elements), two items, tail. */
        let wide = [1u8, 2, 1, 0, 0, 0, 2, 0, 0, 0, 9];
        assert_eq!(EnumArrayHolder::validate(&wide), Ok(11));
        let v = EnumArrayHolder::from_slice(&wide).unwrap();
        assert_eq!(v.items_len(), 2);
        assert_eq!(v.items_get(1).tag(), 1);
        assert_eq!(v.items_get(1).as_wide().unwrap().value(), 2);
        assert_eq!(v.items_get(0).size(), 4);
        assert_eq!(v.tail(), 9);
        /* kind 0 (u8 elements). */
        let small = [0u8, 3, 5, 6, 7, 9];
        assert_eq!(EnumArrayHolder::validate(&small), Ok(6));
        let v = EnumArrayHolder::from_slice(&small).unwrap();
        assert_eq!(v.items_get(2).as_small(), Some(7));
        assert_eq!(v.tail(), 9);
        /* Unknown element tag. A short buffer reports the exact size once
         * every element starts inside it, else a lower bound. */
        assert!(EnumArrayHolder::validate(&[2u8, 1, 0, 0]).is_err());
        assert_eq!(EnumArrayHolder::validate(&wide[..7]).unwrap_err().required_size(), Some(11));
        assert_eq!(EnumArrayHolder::validate(&wide[..5]).unwrap_err().required_size(), Some(6));

        let p = EnumArrayHolderParams::from_buffer(&wide).unwrap();
        assert_eq!((p.kind, p.count), (1, 2));
        assert_eq!(p.footprint(), Ok(11));
        assert_eq!(EnumArrayHolder::footprint_from_params(&EnumArrayHolderParams::from_values(0, 3)), Ok(6));
        let mut buf = [0xa5u8; 11];
        assert_eq!(EnumArrayHolder::new(&mut buf, 1, 2), Ok(11));
        assert_eq!(buf, [1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        let mut m = EnumArrayHolderMut::from_slice_mut(&mut buf).unwrap();
        m.items_get_mut(1).as_wide_mut().unwrap().set_value(2);
        m.items_get_mut(0).as_wide_mut().unwrap().set_value(1);
        m.set_tail(9);
        assert_eq!(buf, wide);

        let built = EnumArrayHolderBuilder::new()
            .set_kind(1)
            .push_items(&[1, 0, 0, 0])
            .push_items(&[2, 0, 0, 0])
            .set_tail(9)
            .build();
        assert_eq!(built, wide);
    }

    #[test]
    fn enum_payload_of_enum() {
        /* outer 0 -> nested enum, inner 1 -> u64. */
        let quad = [0u8, 1, 8, 7, 6, 5, 4, 3, 2, 1, 0xee];
        assert_eq!(EnumPayloadHolder::validate(&quad), Ok(11));
        let v = EnumPayloadHolder::from_slice(&quad).unwrap();
        let nested = v.body_as_nested().unwrap();
        assert_eq!(nested.tag(), 1);
        assert_eq!(nested.as_quad(), Some(0x0102_0304_0506_0708));
        assert_eq!(v.tail(), 0xee);
        let byte = [0u8, 0, 7, 0xee];
        assert_eq!(EnumPayloadHolder::validate(&byte), Ok(4));
        assert_eq!(EnumPayloadHolder::from_slice(&byte).unwrap().body_as_nested().unwrap().as_byte(), Some(7));
        assert_eq!(EnumPayloadHolder::validate(&[1u8, 9, 1, 2, 0xee]), Ok(5));
        assert!(EnumPayloadHolder::validate(&[0u8, 9, 1, 2, 0xee]).is_err());

        let p = EnumPayloadHolderParams::from_buffer(&quad).unwrap();
        assert_eq!(p.footprint(), Ok(11));
        assert_eq!(EnumPayloadHolder::footprint_from_params(&EnumPayloadHolderParams::from_values(0, 0)), Ok(4));
        let mut buf = [0xa5u8; 11];
        assert_eq!(EnumPayloadHolder::new(&mut buf, 0, 1), Ok(11));
        assert_eq!(buf[..2], [0, 1]);

        let built = EnumPayloadHolderBuilder::new()
            .set_outer_tag(0)
            .set_inner_tag(1)
            .set_body_nested(&quad[2..10])
            .set_tail(0xee)
            .build();
        assert_eq!(built, quad);
    }

    #[test]
    fn element_struct_holds_the_tag() {
        /* Two elements: tag 0 -> u8; tag 1 -> two u16 enum elements. */
        let bytes = [2u8, 0, 7, 1, 1, 0, 2, 0];
        assert_eq!(TaggedElemHolder::validate(&bytes), Ok(8));
        let v = TaggedElemHolder::from_slice(&bytes).unwrap();
        assert_eq!(v.items_get(0).size(), 2);
        assert_eq!(v.items_get(1).size(), 5);
        let p = TaggedElemHolderParams::from_buffer(&bytes).unwrap();
        assert_eq!(p.footprint(), Ok(8));
        assert_eq!(TaggedElemHolder::validate(&bytes[..7]).unwrap_err().required_size(), Some(8));
    }
"#,
    );
}

/* `new_from_params` lays a `__buffer_size` type out over the parameter's
 * byte count, as `footprint_from_params` does, not over the destination:
 * spare destination bytes stay untouched and a shorter destination is
 * `BufferTooSmall`. The builder's `build_into` writes only the value too. */
#[test]
fn test_rust_construction_uses_buffer_size_param() {
    run_generated_crate_tests(
        "buffer_size_param",
        &[compliance_abi("buffer_sized")],
        r#"
    use crate::generated::compliance::buffer_sized::*;
    use crate::generated::tn_abi_runtime::AbiError;

    #[test]
    fn spare_bytes_are_left_alone() {
        /* version + two u64 entries. */
        let mut value = [0u8; 20];
        value[0] = 7;
        value[4] = 1;
        value[12] = 2;
        assert_eq!(BufferSizedEntries::validate(&value), Ok(20));
        let p = BufferSizedEntriesParams::from_buffer(&value).unwrap();
        assert_eq!(p.buffer_size, 20);
        assert_eq!(BufferSizedEntries::footprint_from_params(&p), Ok(20));

        let mut dst = [0xa5u8; 28];
        assert_eq!(BufferSizedEntries::new_from_params(&mut dst, &p), Ok(20));
        assert_eq!(dst[..20], [0u8; 20]);
        assert_eq!(dst[20..], [0xa5u8; 8]);

        let mut short = [0xa5u8; 16];
        assert_eq!(
            BufferSizedEntries::new_from_params(&mut short, &p),
            Err(AbiError::BufferTooSmall { needed: 20, have: 16 })
        );
        assert_eq!(short, [0xa5u8; 16]);

        /* `new` sizes the value by the whole destination. */
        let mut whole = [0xa5u8; 28];
        assert_eq!(BufferSizedEntries::new(&mut whole), Ok(28));

        let mut target = [0xa5u8; 28];
        let built = BufferSizedEntriesBuilder::new()
            .set_version(7)
            .set_entries(&[1, 2])
            .build_into(&mut target);
        assert_eq!(built, Ok(20));
        assert_eq!(target[..20], value);
        assert_eq!(target[20..], [0xa5u8; 8]);
    }
"#,
    );
}

/* A struct field that type-refs a named union with variable-size variants
 * (`variable_union_nested`'s `TwoVar`, appended as `RefHolder` like the C
 * test): the union's IR helper takes a variant selector its caller does not
 * pass, so the struct's IR helpers are left out instead of emitting a call
 * that does not compile. The field's `pair_payload_size` param makes the
 * params footprint exact. */
#[test]
fn test_rust_variable_union_type_ref_field() {
    let fixture = fs::read_to_string("tests/compliance_data/variable_union_nested.abi.yaml")
        .expect("read variable_union_nested fixture");
    let abi = format!(
        "{fixture}  - name: \"RefHolder\"\n    kind:\n      struct:\n        packed: true\n        fields:\n          - name: \"lead\"\n            field-type:\n              primitive: u8\n          - name: \"pair\"\n            field-type:\n              type-ref:\n                name: \"TwoVar\"\n          - name: \"trail\"\n            field-type:\n              primitive: u8\n"
    );
    run_generated_crate_tests(
        "variable_union_type_ref",
        &[("ref_holder.abi.yaml", abi)],
        r#"
    use crate::generated::compliance::variable_union_nested::*;

    #[test]
    fn type_ref_to_variable_union() {
        /* lead, pair (n=1, pad=1 m=3: 2+6 bytes), trail */
        let buf = [9u8, 1, 3, 0, 0, 0, 0, 0, 0, 0x77];
        assert_eq!(RefHolder::validate(&buf), Ok(10));
        let v = RefHolder::from_slice(&buf).unwrap();
        assert_eq!((v.lead(), v.pair().size(), v.trail()), (9, 8, 0x77));
        assert_eq!(TwoVar::validate(&buf[1..9]), Ok(8));
        assert_eq!(RefHolder::validate(&buf[..9]).unwrap_err().required_size(), Some(10));

        let p = RefHolderParams::from_buffer(&buf).unwrap();
        assert_eq!(p.get("pair.payload_size"), Some(8));
        assert_eq!(p.footprint(), Ok(10));
        assert_eq!(RefHolder::footprint_from_params(&p), Ok(10));
        let mut ib = [0xeeu8; 12];
        assert_eq!(RefHolder::new_from_params(&mut ib, &p), Ok(10));
        assert_eq!(ib[10..], [0xee, 0xee]);
        ib[1..9].copy_from_slice(&buf[1..9]);
        assert_eq!(RefHolder::validate(&ib[..10]), Ok(10));
    }
"#,
    );
}

/* A named union with variable-size variants gets `<T>Params { payload_size }`
 * (ABI path `payload_size`): which variant spans the union is not encoded,
 * so its byte size is the parameter, like a struct field's
 * `<field>.payload_size`. The params footprint is exact:
 * `from_buffer(bytes)?.footprint() == validate(bytes)?`. */
#[test]
fn test_rust_variable_union_params_footprint() {
    let abi = fs::read_to_string("tests/compliance_data/variable_union.abi.yaml").unwrap();
    run_generated_crate_tests(
        "variable_union_params",
        &[("variable_union.abi.yaml", abi)],
        r#"
    use crate::generated::compliance::variable_union::*;

    #[test]
    fn union_size_is_the_parameter() {
        /* sized: len 4 + 4 bytes spans 5 > fixed's 4. */
        let long = [4u8, 1, 2, 3, 4];
        assert_eq!(VarUnion::validate(&long), Ok(5));
        let p = VarUnionParams::from_buffer(&long).unwrap();
        assert_eq!(VarUnionParams::KEYS, &[("payload_size", "payload_size")]);
        assert_eq!(p.get("payload_size"), Some(5));
        assert_eq!(p.footprint(), Ok(5));
        assert_eq!(VarUnion::footprint_from_params(&p), Ok(5));
        assert_eq!(VarUnion::from_slice(&long).unwrap().dynamic_params(), p);
        /* fixed spans it: len 1. */
        let short = [1u8, 9, 0, 0];
        assert_eq!(VarUnion::validate(&short), Ok(4));
        assert_eq!(VarUnionParams::from_buffer(&short).unwrap().footprint(), Ok(4));

        let mut dst = [0xa5u8; 7];
        assert_eq!(VarUnion::new_from_params(&mut dst, &p), Ok(5));
        assert_eq!(dst, [0, 0, 0, 0, 0, 0xa5, 0xa5]);
        dst[..5].copy_from_slice(&long);
        assert_eq!(VarUnion::validate(&dst[..5]), Ok(5));
        let mut buf = [0xa5u8; 6];
        assert_eq!(VarUnion::new(&mut buf, 6), Ok(6));
        assert_eq!(buf, [0u8; 6]);
    }
"#,
    );
}

/* `enum_nesting`: a non-jagged array of inline enums selected by an outside
 * tag has one element size (the stride), as in the C backend, so a short
 * buffer reports the exact size even when later elements start past the
 * bytes present; an enum payload that is itself an enum decodes too. */
#[test]
fn test_rust_enum_nesting_fixture() {
    let abi = fs::read_to_string("tests/compliance_data/enum_nesting.abi.yaml").unwrap();
    run_generated_crate_tests(
        "enum_nesting",
        &[("enum_nesting.abi.yaml", abi)],
        r#"
    use crate::generated::compliance::enum_nesting::*;

    #[test]
    fn arrays_and_payloads() {
        let wide = [1u8, 2, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99];
        assert_eq!(EnumList::validate(&wide), Ok(11));
        let l = EnumList::from_slice(&wide).unwrap();
        assert_eq!((l.items_len(), l.trail()), (2, 0x99));
        assert_eq!(l.items_get(1).as_wide(), Some(0x88776655));
        assert_eq!(EnumListParams::from_buffer(&wide).unwrap().footprint(), Ok(11));
        let small = [0u8, 3, 0xa, 0xb, 0xc, 0x99];
        assert_eq!(EnumList::validate(&small), Ok(6));
        assert_eq!(EnumList::from_slice(&small).unwrap().items_get(2).as_small(), Some(0xc));
        assert!(EnumList::validate(&[2u8, 1, 0, 0x99]).is_err());
        assert_eq!(EnumList::validate(&[2u8, 0, 0x99]), Ok(3));
        assert_eq!(EnumList::footprint_from_params(&EnumListParams::from_values(1, 3)), Ok(15));

        /* Exact sizes past the bytes present (C reports the same). */
        for (bytes, need) in [(&[0u8, 1][..], 4usize), (&[1, 4, 0, 0xa4, 0x41], 19), (&wide[..10], 11)] {
            assert_eq!(EnumList::validate(bytes).unwrap_err().required_size(), Some(need));
            let mut padded = bytes.to_vec();
            padded.resize(need, 0);
            assert_eq!(EnumList::validate(&padded), Ok(need));
        }

        let quad = [1u8, 1, 1, 2, 3, 4, 5, 6, 7, 8, 0xee];
        assert_eq!(EnumInEnum::validate(&quad), Ok(11));
        let v = EnumInEnum::from_slice(&quad).unwrap();
        assert_eq!(v.body_as_nested().unwrap().as_quad(), Some(0x0807_0605_0403_0201));
        assert_eq!(EnumInEnum::validate(&[0u8, 9, 1, 2, 0xee]), Ok(5));
        assert_eq!(EnumInEnum::validate(&quad[..3]).unwrap_err().required_size(), Some(11));
    }
"#,
    );
}

/* `zero_size_elements`: arrays whose elements take no bytes (an inline enum
 * whose selected variant is an empty struct). A count of `u64::MAX` in a
 * 9-byte input must not start one check per element: every zero-byte element
 * at the same offset looks the same, so one stands for all of them in
 * validation, sizing, accessors, the params footprint and the builders.
 * Fixed-size (all variants empty), jagged and stride arrays are covered. */
#[test]
fn test_rust_zero_size_elements_do_not_stall() {
    let abi = fs::read_to_string("tests/compliance_data/zero_size_elements.abi.yaml").unwrap();
    run_generated_crate_tests(
        "zero_size_elements",
        &[("zero_size_elements.abi.yaml", abi)],
        r#"
    use crate::generated::compliance::zero_size_elements::*;
    use crate::generated::tn_abi_runtime::AbiError;

    /* Run `f` on a worker thread; fail instead of hanging when it stalls. */
    fn quick<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> T {
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || { let _ = tx.send(f()); });
        rx.recv_timeout(std::time::Duration::from_secs(20)).expect("stalled on zero-size elements")
    }

    const HUGE: [u8; 9] = [0, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];

    #[test]
    fn fixed_size_elements() {
        quick(|| {
            assert_eq!(EmptyEnumList::validate(&HUGE), Ok(9));
            let mut bad = HUGE;
            bad[0] = 2;
            assert!(EmptyEnumList::validate(&bad).is_err());
            let v = EmptyEnumList::from_slice(&HUGE).unwrap();
            assert_eq!((v.size(), v.items_len()), (9, usize::MAX));
            assert_eq!(v.items_get(usize::MAX - 1).size(), 0);
            assert!(v.items_get(usize::MAX - 1).as_none().is_some());
            let p = EmptyEnumListParams::from_buffer(&HUGE).unwrap();
            assert_eq!((p.tag, p.count), (0, u64::MAX));
            assert_eq!(p.footprint(), Ok(9));
            let mut buf = [0xa5u8; 9];
            assert_eq!(EmptyEnumList::new(&mut buf, 0, u64::MAX), Ok(9));
            assert_eq!(buf, HUGE);
            let built = EmptyEnumListBuilder::new().set_count(u64::MAX).build();
            assert_eq!(built, HUGE);
            let pushed = EmptyEnumListBuilder::new().set_tag(1).push_items(&[]).push_items(&[]).build();
            assert_eq!(pushed, [1, 2, 0, 0, 0, 0, 0, 0, 0]);
            assert_eq!(EmptyEnumListBuilder::new().try_push_items(&[0]).unwrap_err(), AbiError::LengthMismatch);
        });
    }

    #[test]
    fn jagged_elements() {
        quick(|| {
            assert_eq!(JaggedEmptyList::validate(&HUGE), Ok(9));
            let v = JaggedEmptyList::from_slice(&HUGE).unwrap();
            assert_eq!((v.size(), v.items_len()), (9, usize::MAX));
            assert_eq!(v.items_get(usize::MAX - 1).size(), 0);
            assert_eq!(JaggedEmptyListParams::from_buffer(&HUGE).unwrap().footprint(), Ok(9));
            assert_eq!(JaggedEmptyList::footprint_from_params(&JaggedEmptyListParams::from_values(0, u64::MAX)), Ok(9));
            let mut buf = [0xa5u8; 9];
            assert_eq!(JaggedEmptyList::new(&mut buf, 0, u64::MAX), Ok(9));
            assert_eq!(buf, HUGE);
            assert_eq!(JaggedEmptyListBuilder::new().set_count(u64::MAX).build(), HUGE);
            /* Non-empty elements still walk (and still run out of bytes). */
            let bytes = [1u8, 2, 0, 0, 0, 0, 0, 0, 0, 7, 8];
            assert_eq!(JaggedEmptyList::validate(&bytes), Ok(11));
            assert_eq!(JaggedEmptyList::from_slice(&bytes).unwrap().items_get(1).as_byte(), Some(8));
            let mut short = HUGE;
            short[0] = 1;
            assert!(JaggedEmptyList::validate(&short).is_err());
        });
    }

    #[test]
    fn stride_elements() {
        quick(|| {
            assert_eq!(StrideEmptyList::validate(&HUGE), Ok(9));
            let v = StrideEmptyList::from_slice(&HUGE).unwrap();
            assert_eq!((v.size(), v.items_len()), (9, usize::MAX));
            assert_eq!(v.items_get(usize::MAX - 1).size(), 0);
            assert_eq!(StrideEmptyListParams::from_buffer(&HUGE).unwrap().footprint(), Ok(9));
            assert_eq!(StrideEmptyListBuilder::new().set_count(u64::MAX).build(), HUGE);
            let bytes = [1u8, 3, 0, 0, 0, 0, 0, 0, 0, 7, 8, 9];
            assert_eq!(StrideEmptyList::validate(&bytes), Ok(12));
            assert_eq!(StrideEmptyList::from_slice(&bytes).unwrap().items_get(2).as_byte(), Some(9));
        });
    }
"#,
    );
}

/* `shared_count`: arrays sized by one count field. The builder writes a
 * single count, so every array it was given must have that many elements:
 * otherwise (`a` = 1 byte, `b` = 3 bytes) the trailing padding of the
 * non-packed struct can absorb the difference and the value validates with
 * `a` decoding part of `b`. `try_build` reports `LengthMismatch` and `build`
 * panics with it; zero-byte elements, whose lengths take no bytes, too.
 * (Generated directly: the CLI rejects top-level alignment past 1.) */
#[test]
fn test_rust_builder_checks_shared_counts() {
    let test_name = "rust_shared_count";
    let temp_dir = std::env::temp_dir().join(test_name);
    let (types_code, functions_code) =
        generate_direct("tests/compliance_data/shared_count.abi.yaml", &temp_dir);
    let test_code = r#"
use rust_shared_count::runtime::AbiError;

#[test]
fn mismatched_arrays_are_rejected() {
    let ok = SharedCountBuilder::new().set_a(&[1, 2]).set_b(&[3, 4]).build();
    assert_eq!(ok, [2, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 0, 0, 0, 0]);
    let v = SharedCount::from_slice(&ok).unwrap();
    assert_eq!((v.a(), v.b()), (&[1u8, 2][..], &[3u8, 4][..]));

    for (a, b) in [(&[1u8][..], &[2u8, 3, 4][..]), (&[1, 2, 3], &[4])] {
        let err = SharedCountBuilder::new().set_a(a).set_b(b).try_build();
        assert_eq!(err, Err(AbiError::LengthMismatch));
        let mut target = [0u8; 16];
        let into = SharedCountBuilder::new().set_a(a).set_b(b).build_into(&mut target);
        assert_eq!(into, Err(AbiError::LengthMismatch));
    }
    /* An array left out has no elements, so it cannot share b's count. */
    assert_eq!(SharedCountBuilder::new().set_b(&[2, 3, 4]).try_build(), Err(AbiError::LengthMismatch));
    assert_eq!(SharedCountBuilder::new().set_a(&[2, 3, 4]).try_build(), Err(AbiError::LengthMismatch));

    let panic = std::panic::catch_unwind(|| SharedCountBuilder::new().set_a(&[1]).set_b(&[2, 3, 4]).build())
        .unwrap_err();
    let msg = panic.downcast_ref::<String>().cloned().unwrap_or_default();
    assert!(msg.ends_with(&AbiError::LengthMismatch.to_string()), "{}", msg);
}

#[test]
fn zero_byte_elements_count_too() {
    let ok = SharedEmptyCountBuilder::new().push_a(&[]).push_a(&[]).push_b(&[]).push_b(&[]).build();
    assert_eq!(ok, [0, 2]);
    let err = SharedEmptyCountBuilder::new().push_a(&[]).push_b(&[]).push_b(&[]).push_b(&[]).try_build();
    assert_eq!(err, Err(AbiError::LengthMismatch));
}
"#;
    let result = compile_and_run_rust_tests(&types_code, &functions_code, test_code, test_name);
    let _ = fs::remove_dir_all(&temp_dir);
    result.unwrap_or_else(|e| panic!("shared count tests failed: {}", e));
}

/* Jagged-array builders keep the boundaries of the elements they are given:
 * `VarRecord` `[0, 1]` (len 0 plus a stray byte) followed by `[42]` has the
 * right total size and count but decodes as `[0]` and `[1, 42]`. Each element
 * must validate on its own and decode, in place, to exactly the bytes supplied
 * for it; `try_build`/`build_into` report `LengthMismatch` and `build` panics
 * with it. */
#[test]
fn test_rust_jagged_builder_keeps_element_boundaries() {
    let test_name = "rust_jagged_boundaries";
    let temp_dir = std::env::temp_dir().join(test_name);
    let (types_code, functions_code) = generate_direct(
        "tests/compliance_tests/abi_definitions/jagged_arrays.abi.yaml",
        &temp_dir,
    );
    let test_code = r#"
use rust_jagged_boundaries::runtime::AbiError;

#[test]
fn elements_keep_their_boundaries() {
    let pushed = || JaggedRecordsBuilder::new().push_records(&[0, 1]).push_records(&[42]);
    assert_eq!(pushed().try_build(), Err(AbiError::LengthMismatch));
    let mut target = [0u8; 16];
    assert_eq!(pushed().build_into(&mut target), Err(AbiError::LengthMismatch));
    let set = JaggedRecordsBuilder::new().set_records(&[&[0, 1], &[42]]).try_build();
    assert_eq!(set, Err(AbiError::LengthMismatch));

    let panic = std::panic::catch_unwind(|| pushed().build()).unwrap_err();
    let msg = panic.downcast_ref::<String>().cloned().unwrap_or_default();
    assert!(msg.ends_with(&AbiError::LengthMismatch.to_string()), "{}", msg);
}

#[test]
fn elements_validate_on_their_own() {
    /* `[2, 7]` is short for its length; with `[8, 1, 5]` the whole decodes
    as `[2, 7, 8]` and `[1, 5]`. */
    let bytes = [2, 0, 0, 0, 2, 7, 8, 1, 5];
    assert_eq!(JaggedRecords::validate(&bytes), Ok(9));
    assert!(JaggedRecordsBuilder::new().push_records(&[2, 7]).push_records(&[8, 1, 5]).try_build().is_err());
    assert!(JaggedRecordsBuilder::new().set_records(&[&[2, 7], &[8, 1, 5]]).try_build().is_err());
}

#[test]
fn well_formed_elements_still_build() {
    let pushed = JaggedRecordsBuilder::new().push_records(&[0]).push_records(&[1, 42]).build();
    let set = JaggedRecordsBuilder::new().set_records(&[&[0], &[1, 42]]).build();
    assert_eq!(pushed, [2, 0, 0, 0, 0, 1, 42]);
    assert_eq!(set, pushed);
    let reset = JaggedRecordsBuilder::new().push_records(&[0, 1]).set_records(&[&[1, 9]]).build();
    assert_eq!(reset, [1, 0, 0, 0, 1, 9]);
    let large = JaggedLargeRecordsBuilder::new()
        .push_records(&[1, 0, 0, 0, 2, 0, 7, 8])
        .push_records(&[2, 0, 0, 0, 0, 0])
        .build();
    let v = JaggedLargeRecords::from_slice(&large).unwrap();
    assert_eq!((v.records_get(0).payload(), v.records_get(1).id()), (&[7u8, 8][..], 2));
    assert_eq!(JaggedRecordsBuilder::new().set_records(&[]).build(), [0, 0, 0, 0]);
}
"#;
    let result = compile_and_run_rust_tests(&types_code, &functions_code, test_code, test_name);
    let _ = fs::remove_dir_all(&temp_dir);
    result.unwrap_or_else(|e| panic!("jagged boundary tests failed: {}", e));
}

/* `nested_ref_after_variable`: an outer array sized by `["child", "count"]`
 * where the child's `count` follows variable-size data (`bytes: u8[n]`), so
 * its offset comes from the child's own layout. Validation, accessors, the
 * params footprint, `new_from_params` and the builder all find it there, for a
 * named child (`RefOuter`) and an inline one (`InlineOuter`). */
#[test]
fn test_rust_nested_ref_after_variable_data() {
    let abi =
        fs::read_to_string("tests/compliance_data/nested_ref_after_variable.abi.yaml").unwrap();
    run_generated_crate_tests(
        "nested_ref_after_variable",
        &[("nested_ref_after_variable.abi.yaml", abi)],
        r#"
    use crate::generated::compliance::nested_ref_after_variable::*;
    use crate::generated::tn_abi_runtime::AbiError;

    /* lead, child (n = 3, bytes, count = 2), items [0x0201, 0x0403], tail */
    const REF: [u8; 11] = [9, 3, 0xa, 0xb, 0xc, 2, 1, 2, 3, 4, 0xee];

    #[test]
    fn named_child() {
        assert_eq!(RefOuter::validate(&REF), Ok(11));
        assert_eq!(RefOuter::validate(&REF[..10]).unwrap_err().required_size(), Some(11));
        assert_eq!(RefOuter::validate(&REF[..7]).unwrap_err().required_size(), Some(11));
        let v = RefOuter::from_slice(&REF).unwrap();
        assert_eq!((v.lead(), v.child().n(), v.child().bytes(), v.child().count()), (9, 3, &[0xa, 0xb, 0xc][..], 2));
        assert_eq!((v.items_len(), v.items_get(0), v.items_get(1), v.tail()), (2, 0x0201, 0x0403, 0xee));
        /* count 1 instead: the array ends one element earlier. */
        let mut one = REF;
        one[5] = 1;
        assert_eq!(RefOuter::validate(&one), Ok(9));
        assert_eq!(RefOuter::from_slice(&one).unwrap().tail(), 3);

        let p = RefOuterParams::from_buffer(&REF).unwrap();
        assert_eq!((p.child_count, p.child_payload_size), (2, 5));
        assert_eq!(p.footprint(), Ok(11));
        assert_eq!(RefOuter::footprint_from_params(&RefOuterParams::from_values(2, 5)), Ok(11));
        assert_eq!(RefOuter::footprint_from_params(&RefOuterParams::from_values(4, 2)), Ok(12));
        assert_eq!(ref_outer_footprint_ir(2, 3), 11);
        let mut buf = [0xa5u8; 13];
        assert_eq!(RefOuter::new_from_params(&mut buf, &p), Ok(11));
        assert_eq!(buf[11..], [0xa5, 0xa5]);
        buf[1..6].copy_from_slice(&REF[1..6]);
        let mut m = RefOuterMut::from_slice_mut(&mut buf[..11]).unwrap();
        m.set_lead(9);
        m.items_set(0, 0x0201);
        m.items_set(1, 0x0403);
        m.set_tail(0xee);
        assert_eq!(buf[..11], REF);

        let child = ChildBuilder::new().set_bytes(&[0xa, 0xb, 0xc]).set_count(2).build();
        let built = RefOuterBuilder::new().set_lead(9).set_child(&child).set_items(&[0x0201, 0x0403]).set_tail(0xee).build();
        assert_eq!(built, REF);
        /* The child's count disagrees with the items given. */
        let err = RefOuterBuilder::new().set_lead(9).set_child(&child).set_items(&[1, 2, 3]).set_tail(0xee).try_build();
        assert_eq!(err, Err(AbiError::LengthMismatch));
    }

    #[test]
    fn inline_child() {
        let bytes = &REF[1..];
        assert_eq!(InlineOuter::validate(bytes), Ok(10));
        assert_eq!(InlineOuter::validate(&bytes[..9]).unwrap_err().required_size(), Some(10));
        let v = InlineOuter::from_slice(bytes).unwrap();
        assert_eq!((v.child().bytes(), v.child().count(), v.items_get(1), v.tail()), (&[0xa, 0xb, 0xc][..], 2, 0x0403, 0xee));
        let p = InlineOuterParams::from_buffer(bytes).unwrap();
        assert_eq!(p.footprint(), Ok(10));
        assert_eq!(InlineOuter::footprint_from_params(&p), Ok(10));
        let built = InlineOuterBuilder::new().set_child(&bytes[..5]).set_items(&[0x0201, 0x0403]).set_tail(0xee).build();
        assert_eq!(built, bytes);
    }
"#,
    );
}

/* An inline struct reading `__buffer_size` sees the bytes left for it, in
 * the walker and in the IR helpers: their `buf_sz` is the root's, less the
 * bytes before the inline struct. */
#[test]
fn test_rust_inline_struct_reads_its_own_buffer_size() {
    let abi = fs::read_to_string("tests/go_fixtures/inline_buffer_sized.abi.yaml").unwrap();
    run_generated_crate_tests(
        "inline_buffer_sized",
        &[("inline_buffer_sized.abi.yaml", abi)],
        r#"
    use crate::generated::test::inline_buffer_sized::*;

    #[test]
    fn inner_is_sized_by_its_own_bytes() {
        /* n, then inner: m = 1, head = [aa], tail = [bb]. */
        let bytes = [9u8, 1, 0xaa, 0xbb];
        assert_eq!(Outer::validate(&bytes), Ok(4));
        assert_eq!(outer_validate_ir(4, 1, 0, 0), Ok(4));
        assert_eq!(outer_footprint_ir(4, 1, 0, 0), 4);
    }
"#,
    );
}

/* Two inline structs each holding a named variable-size child: each child's
 * count is its own IR input, so the helpers size children with different
 * counts. */
#[test]
fn test_rust_inline_children_keep_separate_ir_inputs() {
    let abi = fs::read_to_string("tests/go_fixtures/inline_child_inputs.abi.yaml").unwrap();
    run_generated_crate_tests(
        "inline_child_inputs",
        &[("inline_child_inputs.abi.yaml", abi)],
        r#"
    use crate::generated::test::inline_child_inputs::*;

    #[test]
    fn children_are_sized_by_their_own_counts() {
        /* left: n = 1, [aa]; right: n = 2, [bb cc]. */
        assert_eq!(Outer::validate(&[1u8, 0xaa, 2, 0xbb, 0xcc]), Ok(5));
        assert_eq!(outer_validate_ir(5, 1, 2), Ok(5));
        assert_eq!(outer_footprint_ir(1, 2), 5);
        assert_eq!(outer_footprint_ir(2, 0), 4);
    }
"#,
    );
}

/* Computed enum tags and payload sizes in inline structs (and an enum in a
 * packed struct, not rounded up to its alignment): the walker sizes them
 * from the bytes, the IR helpers from the tag and payload the caller gives. */
#[test]
fn test_rust_inline_struct_computed_tags_and_payloads() {
    let abi = fs::read_to_string("tests/go_fixtures/inline_computed_tag.abi.yaml").unwrap();
    run_generated_crate_tests(
        "inline_computed_tag",
        &[("inline_computed_tag.abi.yaml", abi)],
        r#"
    use crate::generated::test::inline_computed_tag::*;

    #[test]
    fn tags_and_payloads_size_the_values() {
        assert_eq!(Outer::validate(&[0u8, 7]), Ok(2));
        assert_eq!(Outer::validate(&[1u8, 8, 7]), Ok(3));
        assert_eq!(Flat::validate(&[0u8, 7]), Ok(2));
        assert_eq!(Sized::validate(&[9u8, 1, 2]), Ok(3));
        assert_eq!(outer_validate_ir(2, 0, 0, 0), Ok(2));
        assert_eq!(outer_validate_ir(3, 1, 1, 1), Ok(3));
        assert_eq!((outer_footprint_ir(0, 0, 0), outer_footprint_ir(1, 1, 1)), (2, 3));
        assert_eq!((flat_footprint_ir(0, 0, 0), flat_footprint_ir(1, 1, 1)), (2, 3));
        assert_eq!(sized_validate_ir(3, 2, 2), Ok(3));
        assert_eq!(sized_footprint_ir(2, 2), 3);
    }
"#,
    );
}

/* A holder whose IR calls the helper of a `__buffer_size`-sized type cannot
 * pass that size (the bytes left for the nested value are not an IR value),
 * so the holder gets no IR helpers; the nested type keeps its own. */
#[test]
fn test_rust_ir_helpers_skip_nested_buffer_size() {
    let abi = fs::read_to_string("tests/go_fixtures/buffer_sized_holder.abi.yaml").unwrap();
    let files = [("buffer_sized_holder.abi.yaml", abi)];
    let project = generate_crate("bufholder_src", &files);
    let src =
        fs::read_to_string(project.join("src/generated/test/buffer_sized_holder/functions.rs"))
            .unwrap();
    let _ = fs::remove_dir_all(&project);
    assert!(
        !src.contains("fn sized_holder_footprint_ir")
            && !src.contains("fn sized_holder_validate_ir"),
        "holder IR helpers emitted"
    );
    run_generated_crate_tests(
        "bufholder",
        &files,
        r#"
    use crate::generated::test::buffer_sized_holder::*;

    #[test]
    fn nested_helpers_and_holder_walker() {
        assert_eq!(buffer_sized_entries_validate_ir(20), Ok(20));
        assert_eq!(buffer_sized_entries_footprint_ir(28), 28);
        assert_eq!(buffer_sized_entries_footprint_ir_checked(12), Ok(12));
        let b = [0u8; 13];
        assert_eq!(SizedHolder::validate(&b), Ok(13));
        assert_eq!(SizedHolder::from_slice(&b).unwrap().body().entries_len(), 1);
    }
"#,
    );
}

/* Declared types named like generated items (`MessageBuilder`,
 * `KindBodyRef`, `Thing__Ext`, `foo` next to `Foo`): every module-level
 * Rust name comes from one table per package, declared types first, and a
 * generated item that would clash gets a `_` suffix. */
#[test]
fn test_rust_generated_names_never_clash() {
    let abi = fs::read_to_string("tests/go_fixtures/name_clashes.abi.yaml").unwrap();
    run_generated_crate_tests(
        "name_clashes",
        &[("name_clashes.abi.yaml", abi)],
        r#"
    use crate::generated::test::name_clashes::*;

    #[test]
    fn declared_types_keep_their_names() {
        assert_eq!(Foo::from_slice(&[7]).unwrap().a(), 7);
        assert_eq!(foo::from_slice(&[1, 2]).unwrap().b(), 0x0201);
        assert_eq!(MessageBuilder::from_slice(&[5]).unwrap().y(), 5);
        assert_eq!(MessageParams::from_slice(&[6]).unwrap().z(), 6);
        assert_eq!(ParseMessage::from_slice(&[8]).unwrap().w(), 8);
        assert_eq!(KindBodyRef::from_slice(&[3]).unwrap().r(), 3);
        assert_eq!(KindBodyTagA::from_slice(&[4]).unwrap().t(), 4);
        assert_eq!(KindBodyVariants::from_slice(&[9]).unwrap().v(), 9);
        assert_eq!(Thing__Ext::from_slice(&[2]).unwrap().e(), 2);
    }

    #[test]
    fn clashing_items_get_a_suffix() {
        let bytes = MessageBuilder_::new().set_data(&[1, 2]).build();
        assert_eq!(bytes, [2, 1, 2]);
        let p: MessageParams_ = Message::from_slice(&bytes).unwrap().dynamic_params();
        assert_eq!(Message::footprint_from_params(&p), Ok(3));
        match Kind::from_slice(&[1, 0x34, 0x12]).unwrap().body() {
            KindBodyRef_::B(v) => assert_eq!(v, 0x1234),
            _ => panic!("variant"),
        }
        let mut raw = [0u8, 0];
        match KindMut::from_slice_mut(&mut raw).unwrap().body_mut() {
            KindBodyRefMut_::A(s) => s[0] = 9,
            _ => panic!("variant"),
        }
        assert_eq!(raw, [0, 9]);
        let thing = Thing::from_slice(&[4]).unwrap();
        let _: &Thing__Ext_ = thing.context();
        assert_eq!(thing.x(), 4);
        /* `Foo` sorts before `foo`, so it keeps the plain IR helper names. */
        assert_eq!((foo_footprint_ir(), foo_footprint_ir_()), (1, 2));
        assert_eq!((foo_validate_ir(1), foo_validate_ir_(2)), (Ok(1), Ok(2)));
    }
"#,
    );
}

const RUST_NAME_CLASHES_ABI: &str = r#"abi:
  package: "test.rust_name_clashes"
  abi-version: 1
  package-version: "1.0.0"
  description: "Declared types named like the Rust items generated for T, its inline view and Child"

types:
  # Variable-size child; `child` shares its IR helper names.
  - name: "Child"
    kind:
      struct:
        packed: true
        fields:
          - name: "n"
            field-type:
              primitive: u8
          - name: "data"
            field-type:
              array:
                size:
                  field-ref:
                    path: ["n"]
                element-type:
                  primitive: u8
  - name: "child"
    kind:
      struct:
        packed: true
        fields:
          - name: "v"
            field-type:
              primitive: u16
  # Every item of T has a namesake below: inline view (T_inner), typed
  # enums (TBodyRef / TBodyRefMut), params, builder and owned view.
  - name: "T"
    kind:
      struct:
        packed: true
        fields:
          - name: "count"
            field-type:
              primitive: u8
          - name: "tag"
            field-type:
              primitive: u8
          - name: "inner"
            field-type:
              struct:
                packed: true
                fields:
                  - name: "a"
                    field-type:
                      primitive: u8
                  - name: "items"
                    field-type:
                      array:
                        size:
                          field-ref:
                            path: ["..", "count"]
                        element-type:
                          primitive: u8
          - name: "kid"
            field-type:
              type-ref:
                name: "Child"
          - name: "pair"
            field-type:
              array:
                size:
                  literal:
                    u8: 2
                element-type:
                  type-ref:
                    name: "child"
          - name: "body"
            field-type:
              enum:
                packed: true
                tag-ref:
                  field-ref:
                    path: ["tag"]
                variants:
                  - name: "A"
                    tag-value: 0
                    variant-type:
                      primitive: u8
                  - name: "B"
                    tag-value: 1
                    variant-type:
                      type-ref:
                        name: "child"
  - name: "TView"
    kind:
      struct:
        packed: true
        fields:
          - name: "x"
            field-type:
              primitive: u8
  - name: "TMut"
    kind:
      struct:
        packed: true
        fields:
          - name: "x"
            field-type:
              primitive: u8
  - name: "T__Ext"
    kind:
      struct:
        packed: true
        fields:
          - name: "x"
            field-type:
              primitive: u8
  - name: "T__layout"
    kind:
      struct:
        packed: true
        fields:
          - name: "x"
            field-type:
              primitive: u8
  - name: "TParams"
    kind:
      struct:
        packed: true
        fields:
          - name: "x"
            field-type:
              primitive: u8
  - name: "TBuilder"
    kind:
      struct:
        packed: true
        fields:
          - name: "x"
            field-type:
              primitive: u8
  - name: "TOwned"
    kind:
      struct:
        packed: true
        fields:
          - name: "x"
            field-type:
              primitive: u8
  - name: "TBodyRef"
    kind:
      struct:
        packed: true
        fields:
          - name: "x"
            field-type:
              primitive: u8
  - name: "TBodyRefMut"
    kind:
      struct:
        packed: true
        fields:
          - name: "x"
            field-type:
              primitive: u8
  - name: "T_innerView"
    kind:
      struct:
        packed: true
        fields:
          - name: "x"
            field-type:
              primitive: u8
  - name: "T_innerMut"
    kind:
      struct:
        packed: true
        fields:
          - name: "x"
            field-type:
              primitive: u8
  - name: "T_inner__Ext"
    kind:
      struct:
        packed: true
        fields:
          - name: "x"
            field-type:
              primitive: u8
  - name: "T_inner__layout"
    kind:
      struct:
        packed: true
        fields:
          - name: "x"
            field-type:
              primitive: u8
  - name: "ChildView"
    kind:
      struct:
        packed: true
        fields:
          - name: "x"
            field-type:
              primitive: u8
  - name: "ChildMut"
    kind:
      struct:
        packed: true
        fields:
          - name: "x"
            field-type:
              primitive: u8
  - name: "Child__Ext"
    kind:
      struct:
        packed: true
        fields:
          - name: "x"
            field-type:
              primitive: u8
  - name: "Child__layout"
    kind:
      struct:
        packed: true
        fields:
          - name: "x"
            field-type:
              primitive: u8
  - name: "ChildParams"
    kind:
      struct:
        packed: true
        fields:
          - name: "x"
            field-type:
              primitive: u8
  - name: "ChildBuilder"
    kind:
      struct:
        packed: true
        fields:
          - name: "x"
            field-type:
              primitive: u8
  - name: "ChildOwned"
    kind:
      struct:
        packed: true
        fields:
          - name: "x"
            field-type:
              primitive: u8
  - name: "childView"
    kind:
      struct:
        packed: true
        fields:
          - name: "x"
            field-type:
              primitive: u8
  - name: "childBuilder"
    kind:
      struct:
        packed: true
        fields:
          - name: "x"
            field-type:
              primitive: u8
  # `t` shares T's IR helper names.
  - name: "t"
    kind:
      struct:
        packed: true
        fields:
          - name: "y"
            field-type:
              primitive: u16
"#;

/* Declared types named like every item generated for `T` (its view, Mut,
 * __Ext, __layout, Params, Builder, Owned and typed enums), its inline view
 * `T_inner`, a type-ref child and the IR helpers (`t`, `child`). Each
 * reference to a renamed item must use the table's name. */
#[test]
fn test_rust_generated_names_cover_every_item() {
    run_generated_crate_tests(
        "rust_name_clashes",
        &[(
            "rust_name_clashes.abi.yaml",
            RUST_NAME_CLASHES_ABI.to_string(),
        )],
        r#"
    use crate::generated::test::rust_name_clashes::*;

    /* count 2, tag 1, inner { a 5, items [7, 8] }, kid { n 1, [9] },
     * pair [0x0102, 0x0304], body B(child 0x0506) */
    const T_BYTES: [u8; 13] = [2, 1, 5, 7, 8, 1, 9, 2, 1, 4, 3, 6, 5];

    #[test]
    fn renamed_items_work() {
        assert_eq!(T::validate(&T_BYTES), Ok(13));
        let v: TView_<&[u8]> = T::from_slice(&T_BYTES).unwrap();
        let _: &T__Ext_ = v.context();
        let inner: T_inner<'_> = v.inner();
        let _: &T_inner__Ext_ = inner.context();
        assert_eq!((inner.a(), inner.items()), (5, &[7, 8][..]));
        let kid: Child<'_> = v.kid();
        assert_eq!(kid.data(), &[9][..]);
        assert_eq!(v.pair_get(1).v(), 0x0304);
        match v.body() {
            TBodyRef_::B(c) => assert_eq!(c.v(), 0x0506),
            _ => panic!("variant"),
        }
        let p: TParams_ = v.dynamic_params();
        assert_eq!(T::footprint_from_params(&p), Ok(13));

        let mut bytes = T_BYTES;
        let mut m: TMut_<'_> = TMut_::from_slice_mut(&mut bytes).unwrap();
        let mut im: T_innerMut_<'_> = m.inner_mut();
        im.set_a(6);
        let _: ChildMut_<'_> = m.kid_mut();
        match m.body_mut() {
            TBodyRefMut__::B(mut c) => c.set_v(0x0708),
            _ => panic!("variant"),
        }
        assert_eq!((bytes[2], bytes[11], bytes[12]), (6, 8, 7));

        let kid = ChildBuilder_::new().set_data(&[9]).build();
        let owned: TOwned_ = TBuilder_::new()
            .set_count(2)
            .set_inner(&[5, 7, 8])
            .set_kid(&kid)
            .push_pair(&[2, 1])
            .push_pair(&[4, 3])
            .set_body_b(&[6, 5])
            .finish()
            .unwrap();
        assert_eq!(owned.as_bytes(), &T_BYTES[..]);
        let co: ChildOwned_ = ChildBuilder_::new().set_data(&[1, 2]).finish().unwrap();
        let cp: ChildParams_ = co.dynamic_params();
        assert_eq!(Child::footprint_from_params(&cp), Ok(3));
        let _: childView_<&[u8]> = child::from_slice(&[0, 0]).unwrap();
        let _: childBuilder_ = childBuilder_::new();
        let layouts = [
            ::core::mem::size_of::<Child__layout_>(),
            ::core::mem::size_of::<T__layout_>(),
            ::core::mem::size_of::<T_inner__layout_>(),
        ];
        assert_eq!(layouts, [0, 0, 0]);
        let t = T::from_slice(&T_BYTES).unwrap();
        let _: ChildView_<&[u8]> = t.kid();
    }

    #[test]
    fn declared_namesakes_keep_their_names() {
        for b in [
            TView::from_slice(&[1]).unwrap().x(),
            TMut::from_slice(&[1]).unwrap().x(),
            T__Ext::from_slice(&[1]).unwrap().x(),
            T__layout::from_slice(&[1]).unwrap().x(),
            TParams::from_slice(&[1]).unwrap().x(),
            TBuilder::from_slice(&[1]).unwrap().x(),
            TOwned::from_slice(&[1]).unwrap().x(),
            TBodyRef::from_slice(&[1]).unwrap().x(),
            TBodyRefMut::from_slice(&[1]).unwrap().x(),
            T_innerView::from_slice(&[1]).unwrap().x(),
            T_innerMut::from_slice(&[1]).unwrap().x(),
            T_inner__Ext::from_slice(&[1]).unwrap().x(),
            T_inner__layout::from_slice(&[1]).unwrap().x(),
            ChildView::from_slice(&[1]).unwrap().x(),
            ChildMut::from_slice(&[1]).unwrap().x(),
            Child__Ext::from_slice(&[1]).unwrap().x(),
            Child__layout::from_slice(&[1]).unwrap().x(),
            ChildParams::from_slice(&[1]).unwrap().x(),
            ChildBuilder::from_slice(&[1]).unwrap().x(),
            ChildOwned::from_slice(&[1]).unwrap().x(),
            childView::from_slice(&[1]).unwrap().x(),
            childBuilder::from_slice(&[1]).unwrap().x(),
        ] {
            assert_eq!(b, 1);
        }
    }

    #[test]
    fn ir_helpers_are_disambiguated() {
        /* `Child` (sorted first) keeps `child_*`; `child` gets `child_*_`. */
        assert_eq!(child_footprint_ir(3), 4);
        assert_eq!(child_footprint_ir_(), 2);
        assert_eq!(child_validate_ir_(2), Ok(2));
        assert_eq!(t_footprint_ir_(), 2);
        assert_eq!(t_validate_ir_(2), Ok(2));
        assert_eq!((child_view_footprint_ir(), child_view_footprint_ir_()), (1, 1));
    }
"#,
    );
}

/* A declared `A_b` next to `A { b: inline struct }`: the inline type
 * `A::b` is spelled like `A_b`, but each keeps its own view and layout
 * (the inline one is emitted as `A_b_`). */
#[test]
fn test_rust_declared_type_named_like_inline_view() {
    let abi = fs::read_to_string("tests/go_fixtures/inline_view_clash.abi.yaml").unwrap();
    run_generated_crate_tests(
        "inline_view_clash",
        &[("inline_view_clash.abi.yaml", abi)],
        r#"
    use crate::generated::test::inline_view_clash::*;

    #[test]
    fn both_decode_their_own_layout() {
        let d = [1u8, 0, 0, 0, 0, 0, 0, 0, 2];
        assert_eq!((A_b::validate(&d), A_b::FOOTPRINT), (Ok(9), 9));
        let v = A_b::from_slice(&d).unwrap();
        assert_eq!((v.x(), v.y()), (1, 2));

        let a = [9u8, 3, 4, 0, 7];
        assert_eq!((A::validate(&a), A::FOOTPRINT), (Ok(5), 5));
        let v = A::from_slice(&a).unwrap();
        let b: A_b_<'_> = v.b();
        assert_eq!((v.n(), b.p(), b.q(), v.tail()), (9, 3, 4, 7));
        assert_eq!(b.size(), 3);
        let built = A_bBuilder::new().set_x(1).set_y(2).build();
        assert_eq!(built, d);
    }
"#,
    );
}

/* An importer whose own items are named like items of the package it
 * imports (its inline `A::b` is `A_b`, its `Msg` builds `MsgBuilder`, its
 * `FOO` has `foo_footprint_ir...`) and whose `Holder` uses the imported
 * `A_b`, `MsgBuilder` and `Foo`. The `pub use dep::*` glob would let the
 * local items shadow the imported ones, so those references are spelled by
 * path. (Two packages cannot declare the same simple name: the loader
 * rejects it.) */
#[test]
fn test_rust_imported_items_are_not_shadowed() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/cross_package");
    let read = |f: &str| fs::read_to_string(dir.join(f)).unwrap();
    run_generated_crate_tests(
        "import_shadowing",
        &[
            ("shadow_dep.abi.yaml", read("shadow_dep.abi.yaml")),
            ("shadow_user.abi.yaml", read("shadow_user.abi.yaml")),
        ],
        r#"
    use crate::generated::test::cross_package::shadow_dep as dep;
    use crate::generated::test::cross_package::shadow_user::*;

    /* ab: A_b { x 1, y 2 }, mb: MsgBuilder { z 0x1234 }, foo: Foo { n 2, [7, 8] } */
    const HOLDER: [u8; 14] = [1, 0, 0, 0, 0, 0, 0, 0, 2, 0x34, 0x12, 2, 7, 8];

    #[test]
    fn holder_uses_the_imported_types() {
        assert_eq!(Holder::validate(&HOLDER), Ok(14));
        let h = Holder::from_slice(&HOLDER).unwrap();
        let ab: dep::A_b<'_> = h.ab();
        assert_eq!((ab.x(), ab.y(), ab.size()), (1, 2, 9));
        let mb: dep::MsgBuilder<'_> = h.mb();
        assert_eq!(mb.z(), 0x1234);
        assert_eq!(h.foo().data(), &[7, 8][..]);
        assert_eq!(holder_footprint_ir(2), 14);
        assert_eq!(holder_validate_ir(14, 2), Ok(14));

        let ab = dep::A_bBuilder::new().set_x(1).set_y(2).build();
        let foo = dep::FooBuilder::new().set_data(&[7, 8]).build();
        let built = HolderBuilder::new()
            .set_ab(&ab)
            .set_mb(&[0x34, 0x12])
            .set_foo(&foo)
            .build();
        assert_eq!(built, HOLDER);
    }

    /* Through the package module both namesakes are glob re-exports (an
     * ambiguous name there is a compile error, never a silent pick), so the
     * local ones are named through `types` / `functions`. */
    #[test]
    fn local_namesakes_keep_their_meaning() {
        use crate::generated::test::cross_package::shadow_user::{functions, types};
        let a = A::from_slice(&[9, 3, 4, 0]).unwrap();
        let b: types::A_b<'_> = a.b();
        assert_eq!((b.p(), b.q(), b.size()), (3, 4, 3));
        assert_eq!(functions::MsgBuilder::new().set_m(5).build(), [5]);
        assert_eq!(functions::foo_footprint_ir(), 4);
        assert_eq!(dep::foo_footprint_ir(2), 3);
    }
"#,
    );
}

/* Declared types named like items of the generated runtime (`AbiError`,
 * `TnBuf`, `VariantInfo`, ...): `functions.rs` imports both `types::*` and
 * `runtime::*`, so the name table reserves every runtime item first and the
 * declared types get a `_` suffix. */
#[test]
fn test_rust_types_named_like_runtime_items() {
    /* The reserved set is read from the runtime template: module-level
     * items only, not methods. */
    let rt = abi_gen::codegen::rust_gen::names::runtime_names();
    for name in [
        "AbiError",
        "AbiIrValidateError",
        "VariantInfo",
        "TnBuf",
        "TnBufMut",
        "TnLayout",
        "TnVirtual",
        "TnFootprintFn",
        "tn_expect",
        "tn_e_add",
        "tn_short",
    ] {
        assert!(rt.contains(name), "runtime name {name} not reserved");
    }
    for method in ["new", "as_str", "required_size", "len"] {
        assert!(!rt.contains(method), "method {method} reserved");
    }
    run_generated_crate_tests(
        "runtime_names",
        &[("runtime_names.abi.yaml", RUNTIME_NAMES_ABI.to_string())],
        r#"
    use crate::generated::test::runtime_names::*;
    use crate::generated::tn_abi_runtime as rt;

    #[test]
    fn renamed_types_and_runtime_items_both_work() {
        assert_eq!(AbiError_::from_slice(&[1]).unwrap().code(), 1);
        assert_eq!(TnBuf_::from_slice(&[2]).unwrap().a(), 2);
        assert_eq!(VariantInfo_::from_slice(&[3]).unwrap().b(), 3);
        assert_eq!(TnLayout_::from_slice(&[4]).unwrap().c(), 4);
        assert_eq!(TnVirtual_::from_slice(&[5]).unwrap().d(), 5);
        assert_eq!(AbiIrValidateError_::from_slice(&[6]).unwrap().e(), 6);
        assert_eq!(tn_expect_::from_slice(&[7]).unwrap().f(), 7);

        /* tag 0 (Info), two items, payload VariantInfo_ { b: 9 } */
        let bytes = [0u8, 2, 5, 6, 9];
        assert_eq!(Uses::validate(&bytes), Ok(5));
        let u = Uses::from_slice(&bytes).unwrap();
        assert_eq!((u.items_len(), u.items_get(1).code()), (2, 6));
        match u.body() {
            UsesBodyRef::Info(v) => assert_eq!(v.b(), 9),
            _ => panic!("variant"),
        }
        let err: rt::AbiError = Uses::validate(&bytes[..4]).unwrap_err();
        assert_eq!(err.required_size(), Some(5));
        let info: &rt::VariantInfo = Uses::body_variant_by_tag(1).unwrap();
        assert_eq!(info.name, "Wide");
        let built = UsesBuilder::new()
            .push_items(&[5])
            .push_items(&[6])
            .set_body_info(&[9])
            .build();
        assert_eq!(built, bytes);
    }
"#,
    );
}

const RUNTIME_NAMES_ABI: &str = r#"abi:
  package: "test.runtime_names"
  abi-version: 1
  package-version: "1.0.0"
  description: "Declared types named like items of the generated Rust runtime"

types:
  - name: "AbiError"
    kind:
      struct:
        packed: true
        fields:
          - name: "code"
            field-type:
              primitive: u8
  - name: "TnBuf"
    kind:
      struct:
        packed: true
        fields:
          - name: "a"
            field-type:
              primitive: u8
  - name: "VariantInfo"
    kind:
      struct:
        packed: true
        fields:
          - name: "b"
            field-type:
              primitive: u8
  - name: "TnLayout"
    kind:
      struct:
        packed: true
        fields:
          - name: "c"
            field-type:
              primitive: u8
  - name: "TnVirtual"
    kind:
      struct:
        packed: true
        fields:
          - name: "d"
            field-type:
              primitive: u8
  - name: "AbiIrValidateError"
    kind:
      struct:
        packed: true
        fields:
          - name: "e"
            field-type:
              primitive: u8
  - name: "tn_expect"
    kind:
      struct:
        packed: true
        fields:
          - name: "f"
            field-type:
              primitive: u8
  # An enum (variant tables use VariantInfo, tag reads use tn_expect) and a
  # variable-size array (layout walkers use TnLayout, TnBuf, AbiError).
  - name: "Uses"
    kind:
      struct:
        packed: true
        fields:
          - name: "tag"
            field-type:
              primitive: u8
          - name: "n"
            field-type:
              primitive: u8
          - name: "items"
            field-type:
              array:
                size:
                  field-ref:
                    path: ["n"]
                element-type:
                  type-ref:
                    name: "AbiError"
          - name: "body"
            field-type:
              enum:
                packed: true
                tag-ref:
                  field-ref:
                    path: ["tag"]
                variants:
                  - name: "Info"
                    tag-value: 0
                    variant-type:
                      type-ref:
                        name: "VariantInfo"
                  - name: "Wide"
                    tag-value: 1
                    variant-type:
                      primitive: u16
"#;

/* Package paths that would collide: `cases.Foo` / `cases.foo` (one
directory on a case-insensitive file system), a package named
`tn_abi_runtime` (the shared runtime module of the output root), and
`a.b_c` / `a_b.c`. Every package gets its own directory and module by the
shared rule (`shared::package_paths`: `cases/foo_`, `tn_abi_runtime_`), the
module tree and `use` paths follow it, and the crate compiles and validates a
value built from all of them. */
#[test]
fn test_rust_package_paths_never_collide() {
    let project = std::env::temp_dir().join(format!("abi_rust_paths_{}", std::process::id()));
    let _ = fs::remove_dir_all(&project);
    let gen_dir = project.join("src/generated");
    abi_gen::cmds::codegen::run(
        vec![
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("tests/package_fixtures/paths_user.abi.yaml"),
        ],
        vec![Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/package_fixtures")],
        abi_gen::cmds::codegen::Language::Rust,
        gen_dir.clone(),
        false,
    )
    .expect("codegen");
    for d in [
        "cases/Foo",
        "cases/foo_",
        "tn_abi_runtime_",
        "a/b_c",
        "a_b/c",
        "pkguser",
        "paths_user",
    ] {
        assert!(
            gen_dir.join(d).join("types.rs").exists(),
            "missing {d}/types.rs"
        );
    }
    let runtime = fs::read_to_string(gen_dir.join("tn_abi_runtime.rs")).unwrap();
    assert_eq!(runtime, get_runtime_module_content());
    fs::write(
        project.join("Cargo.toml"),
        "[package]\nname = \"abi_rust_paths\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[lib]\npath = \"src/lib.rs\"\n\n[workspace]\n",
    )
    .unwrap();
    fs::write(
        project.join("src/lib.rs"),
        r#"pub mod generated;

#[cfg(test)]
mod tests {
    use crate::generated::cases::{foo_ as lower, Foo as upper};
    use crate::generated::paths_user::*;
    use crate::generated::tn_abi_runtime_::RuntimeNamed;

    #[test]
    fn every_package_is_its_own_module() {
        assert_eq!(upper::Upper::validate(&[1]), Ok(1));
        assert_eq!(lower::Lower::validate(&[2]), Ok(1));
        assert_eq!(RuntimeNamed::validate(&[1, 2]), Ok(2));
        let bytes = [1u8, 2, 3, 4, 5, 6];
        let h = Holder::from_slice(&bytes).unwrap();
        assert_eq!(h.size(), 6);
        assert_eq!(h.rt().v(), 0x0605);
        assert_eq!(h.both().lower().v(), 4);
    }
}
"#,
    )
    .unwrap();
    let result = run_cargo(&project, &["test", "--lib", "--quiet"]);
    let _ = fs::remove_dir_all(&project);
    result.unwrap_or_else(|e| panic!("package path tests failed: {e}"));
}

/* A package that is also the parent of another (`nest` and `nest.inner`):
`nest/mod.rs` must declare both the package's own modules (`types`,
`functions`, `runtime`) and the child module (`inner`). It used to be
written twice, the second write dropping `pub mod inner;`. */
#[test]
fn test_rust_parent_package_keeps_its_children() {
    let project = std::env::temp_dir().join(format!("abi_rust_nest_{}", std::process::id()));
    let _ = fs::remove_dir_all(&project);
    let gen_dir = project.join("src/generated");
    abi_gen::cmds::codegen::run(
        vec![Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/package_fixtures/nest.abi.yaml")],
        vec![Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/package_fixtures")],
        abi_gen::cmds::codegen::Language::Rust,
        gen_dir.clone(),
        false,
    )
    .expect("codegen");
    let nest_mod = fs::read_to_string(gen_dir.join("nest/mod.rs")).unwrap();
    for line in [
        "pub mod inner;",
        "pub mod types;",
        "pub mod functions;",
        "pub use types::*;",
    ] {
        assert!(
            nest_mod.contains(line),
            "nest/mod.rs lacks `{line}`:\n{nest_mod}"
        );
    }
    fs::write(
        project.join("Cargo.toml"),
        "[package]\nname = \"abi_rust_nest\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[lib]\npath = \"src/lib.rs\"\n\n[workspace]\n",
    )
    .unwrap();
    fs::write(
        project.join("src/lib.rs"),
        r#"pub mod generated;

#[cfg(test)]
mod tests {
    use crate::generated::nest::inner::InnerItem;
    use crate::generated::nest::Outer;

    #[test]
    fn parent_and_child_modules() {
        assert_eq!(InnerItem::validate(&[1, 2]), Ok(2));
        let o = Outer::from_slice(&[9, 0x34, 0x12]).unwrap();
        assert_eq!((o.tag(), o.item().v()), (9, 0x1234));
    }
}
"#,
    )
    .unwrap();
    let result = run_cargo(&project, &["test", "--lib", "--quiet"]);
    let _ = fs::remove_dir_all(&project);
    result.unwrap_or_else(|e| panic!("parent package tests failed: {e}"));
}

/* A field named like a view method is renamed with a trailing `_`, and
with more while a sibling field already has that name: `size` next to
`size_` becomes `size__`, so the two getters and setters stay distinct. */
#[test]
fn test_rust_reserved_accessor_names_never_clash() {
    let abi = fs::read_to_string("tests/rust_fixtures/accessor_clash.abi.yaml").unwrap();
    run_generated_crate_tests(
        "accessor_clash",
        &[("accessor_clash.abi.yaml", abi)],
        r#"
    use crate::generated::test::accessor_clash::*;

    #[test]
    fn size_and_size_underscore_are_distinct() {
        let v = Sized::from_slice(&[1, 2, 3]).unwrap();
        assert_eq!(v.size__(), 1);
        assert_eq!(v.size_(), 2);
        assert_eq!(v.check_(), 3);
    }
"#,
    );
}
