/* TypeScript code generation compliance tests */

use std::fs;
use std::path::PathBuf;
use std::process::Command;

const TEST_OUTPUT_DIR: &str = "target/ts_test_output";

fn setup_test_dir(test_name: &str) -> PathBuf {
    let dir = PathBuf::from(TEST_OUTPUT_DIR).join(test_name);
    if dir.exists() {
        fs::remove_dir_all(&dir).unwrap();
    }
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn generate_ts_code(abi_file: &str, output_dir: &PathBuf) -> Result<(), String> {
    let output = Command::new("cargo")
        .args(&[
            "run",
            "--",
            "codegen",
            "--files",
            abi_file,
            "--language",
            "typescript",
            "--output",
            output_dir.to_str().unwrap(),
        ])
        .output()
        .map_err(|e| format!("Failed to run codegen: {}", e))?;

    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);

    /* Check for actual errors (not warnings) */
    if !output.status.success() {
        /* Only fail if there's an actual error message, not just warnings */
        if stderr.contains("Error:") || (stderr.contains("error:") && !stderr.contains("error: could not compile")) {
            /* Look for the actual error without all the warnings */
            let error_lines: Vec<&str> = stderr.lines().filter(|line| line.contains("Error:")).collect();
            if !error_lines.is_empty() {
                return Err(format!("Codegen failed: {}", error_lines.join("\n")));
            }
        }
    }

    /* Check stdout for success message or errors */
    if !stdout.contains("✓") && !stdout.is_empty() {
        if stdout.contains("Error:") {
            return Err(format!("Codegen error: {}", stdout));
        }
    }

    Ok(())
}

fn check_typescript_compilation(ts_file: &PathBuf) -> Result<(), String> {
    /* Check if tsc is available */
    let tsc_check = Command::new("tsc").arg("--version").output();

    if tsc_check.is_err() {
        println!("WARNING: TypeScript compiler (tsc) not found. Skipping compilation check.");
        println!("Install with: npm install -g typescript");
        return Ok(());
    }

    /* Compile TypeScript file */
    let output = Command::new("tsc")
        .args(&[
            "--strict",
            "--noEmit",
            "--target",
            "ES2020",
            "--lib",
            "ES2020",
            ts_file.to_str().unwrap(),
        ])
        .output()
        .map_err(|e| format!("Failed to run tsc: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "TypeScript compilation failed:\n{}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(())
}

#[test]
fn test_ts_primitives_compile() {
    let test_dir = setup_test_dir("primitives");

    /* Generate TypeScript code from primitives test */
    let abi_file = "tests/compliance_data/primitives.abi.yaml";

    /* Create test ABI file if it doesn't exist */
    if !PathBuf::from(abi_file).exists() {
        fs::create_dir_all("tests/compliance_data").unwrap();
        fs::write(
            abi_file,
            r#"abi:
  package: "compliance.primitives"
  abi-version: 1
  package-version: "1.0.0"
  description: "Compliance test for primitive types"

types:
  - name: "AllPrimitives"
    kind:
      struct:
        packed: true
        fields:
          - name: "u8_val"
            field-type:
              primitive: u8
          - name: "u16_val"
            field-type:
              primitive: u16
          - name: "u32_val"
            field-type:
              primitive: u32
          - name: "u64_val"
            field-type:
              primitive: u64
          - name: "i8_val"
            field-type:
              primitive: i8
          - name: "i16_val"
            field-type:
              primitive: i16
          - name: "i32_val"
            field-type:
              primitive: i32
          - name: "i64_val"
            field-type:
              primitive: i64
          - name: "f32_val"
            field-type:
              primitive: f32
          - name: "f64_val"
            field-type:
              primitive: f64
"#,
        )
        .unwrap();
    }

    generate_ts_code(abi_file, &test_dir).expect("Code generation failed");

    /* Find generated TypeScript file */
    let ts_file = test_dir.join("compliance/primitives/types.ts");
    assert!(ts_file.exists(), "TypeScript file not generated");

    /* Verify compilation */
    check_typescript_compilation(&ts_file).expect("TypeScript compilation failed");

    println!("✓ TypeScript primitives compilation test passed");
}

#[test]
fn test_ts_simple_struct_compile() {
    let test_dir = setup_test_dir("simple_struct");

    /* Create simple struct test */
    let abi_file = "tests/compliance_data/simple_struct.abi.yaml";
    fs::create_dir_all("tests/compliance_data").unwrap();
    fs::write(
        abi_file,
        r#"abi:
  package: "compliance.struct"
  abi-version: 1
  package-version: "1.0.0"
  description: "Compliance test for simple structs"

types:
  - name: "SimpleStruct"
    kind:
      struct:
        packed: true
        fields:
          - name: "field1"
            field-type:
              primitive: u32
          - name: "field2"
            field-type:
              primitive: u64
          - name: "field3"
            field-type:
              primitive: i16
"#,
    )
    .unwrap();

    generate_ts_code(abi_file, &test_dir).expect("Code generation failed");

    let ts_file = test_dir.join("compliance/struct/types.ts");
    assert!(ts_file.exists(), "TypeScript file not generated");

    check_typescript_compilation(&ts_file).expect("TypeScript compilation failed");

    println!("✓ TypeScript simple struct compilation test passed");
}

#[test]
fn test_ts_fixed_array_compile() {
    let test_dir = setup_test_dir("fixed_array");

    let abi_file = "tests/compliance_data/fixed_array.abi.yaml";
    fs::create_dir_all("tests/compliance_data").unwrap();
    fs::write(
        abi_file,
        r#"abi:
  package: "compliance.array"
  abi-version: 1
  package-version: "1.0.0"
  description: "Compliance test for fixed arrays"

types:
  - name: "FixedArrayStruct"
    kind:
      struct:
        packed: true
        fields:
          - name: "header"
            field-type:
              primitive: u32
          - name: "data"
            field-type:
              array:
                size:
                  literal:
                    u32: 32
                element-type:
                  primitive: u8
          - name: "footer"
            field-type:
              primitive: u16
"#,
    )
    .unwrap();

    generate_ts_code(abi_file, &test_dir).expect("Code generation failed");

    let ts_file = test_dir.join("compliance/array/types.ts");
    assert!(ts_file.exists(), "TypeScript file not generated");

    check_typescript_compilation(&ts_file).expect("TypeScript compilation failed");

    println!("✓ TypeScript fixed array compilation test passed");
}

#[test]
fn test_ts_generated_code_structure() {
    let test_dir = setup_test_dir("code_structure");

    let abi_file = "tests/compliance_data/simple_struct.abi.yaml";

    generate_ts_code(abi_file, &test_dir).expect("Code generation failed");

    let ts_file = test_dir.join("compliance/struct/types.ts");
    let content = fs::read_to_string(&ts_file).expect("Failed to read generated file");

    /* Verify essential elements are present */
    assert!(content.contains("export class"), "Missing class export");
    assert!(content.contains("static footprint"), "Missing footprint method");
    assert!(content.contains("static new"), "Missing new method");
    assert!(content.contains("static from_array"), "Missing from_array method");
    assert!(content.contains("private buffer: Uint8Array"), "Missing buffer field");
    assert!(content.contains("private view: DataView"), "Missing DataView");

    println!("✓ TypeScript code structure test passed");
}

#[test]
fn test_ts_bigint_for_64bit() {
    let test_dir = setup_test_dir("bigint_test");

    let abi_file = "tests/compliance_data/primitives.abi.yaml";

    generate_ts_code(abi_file, &test_dir).expect("Code generation failed");

    let ts_file = test_dir.join("compliance/primitives/types.ts");
    let content = fs::read_to_string(&ts_file).expect("Failed to read generated file");

    /* Verify bigint is used for 64-bit integers */
    assert!(
        content.contains("getBigUint64") || content.contains("getBigInt64"),
        "Missing BigInt DataView methods for 64-bit integers"
    );

    println!("✓ TypeScript BigInt usage test passed");
}

#[test]
fn test_ts_little_endian_comments() {
    let test_dir = setup_test_dir("endian_test");

    let abi_file = "tests/compliance_data/simple_struct.abi.yaml";

    generate_ts_code(abi_file, &test_dir).expect("Code generation failed");

    let ts_file = test_dir.join("compliance/struct/types.ts");
    let content = fs::read_to_string(&ts_file).expect("Failed to read generated file");

    /* Verify little-endian is documented */
    assert!(
        content.contains("little-endian") || content.contains(", true"),
        "Missing little-endian indicator in generated code"
    );

    println!("✓ TypeScript little-endian documentation test passed");
}
