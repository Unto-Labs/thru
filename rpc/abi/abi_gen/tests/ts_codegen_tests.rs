/* TypeScript code generation compliance tests */

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const TEST_OUTPUT_DIR: &str = "target/ts_test_output";

#[test]
fn test_ts_hybrid_fam_u64_length_compiles() {
    let test_dir = setup_test_dir("hybrid_u64_length");
    generate_ts_code(
        "tests/compliance_data/hybrid_u64_length.abi.yaml",
        &test_dir,
    )
    .expect("Code generation failed");
    let ts_file = test_dir.join("compliance/hybrid_u64_length/types.ts");
    let content = fs::read_to_string(&ts_file).expect("Generated TypeScript missing");
    assert!(content.contains("this.set_size(__tnToBigInt(elementCount))"));
    check_typescript_compilation(&ts_file).expect("Hybrid u64 length builder must compile");
}

fn setup_test_dir(test_name: &str) -> PathBuf {
    let dir = PathBuf::from(TEST_OUTPUT_DIR).join(test_name);
    if dir.exists() {
        fs::remove_dir_all(&dir).unwrap();
    }
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn generate_ts_code(abi_file: &str, output_dir: &PathBuf) -> Result<(), String> {
    generate_ts_code_with_includes(abi_file, &[], output_dir)
}

fn resolve_repo_path(path: &str) -> String {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    for ancestor in manifest_dir.ancestors() {
        let candidate = ancestor.join(path);
        if candidate.exists() {
            return candidate.to_string_lossy().into_owned();
        }
    }
    manifest_dir.join(path).to_string_lossy().into_owned()
}

/* Run the `abi-gen` binary cargo built for this test target. Spawning
`cargo run` from parallel tests raced on rebuilding it after a source change
(one invocation saw a half-written binary and generated nothing). */
fn generate_ts_code_with_includes(
    abi_file: &str,
    include_dirs: &[&str],
    output_dir: &PathBuf,
) -> Result<(), String> {
    let mut args = vec![
        "codegen".to_string(),
        "--files".to_string(),
        resolve_repo_path(abi_file),
    ];
    for dir in include_dirs {
        args.push("--include-dir".to_string());
        args.push(resolve_repo_path(dir));
    }
    args.extend_from_slice(&[
        "--language".to_string(),
        "typescript".to_string(),
        "--output".to_string(),
        output_dir.to_str().unwrap().to_string(),
    ]);

    let output = Command::new(env!("CARGO_BIN_EXE_abi-gen"))
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to run codegen: {}", e))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let error_lines: Vec<&str> = stderr
            .lines()
            .filter(|line| line.contains("Error:") || line.contains("panicked"))
            .collect();
        return Err(format!(
            "Codegen failed: {}",
            if error_lines.is_empty() {
                stderr.to_string()
            } else {
                error_lines.join("\n")
            }
        ));
    }
    Ok(())
}

fn check_typescript_compilation(ts_file: &PathBuf) -> Result<(), String> {
    let tsc_path = match resolve_vendored_tsc() {
        Some(path) => path,
        None => {
            println!(
                "WARNING: Vendored TypeScript toolchain missing at tests/ts_toolchain/node_modules/.bin/tsc; skipping strict compile check."
            );
            println!(
                "Run `pnpm install` from rpc/abi/abi_gen/tests/ts_toolchain to restore the toolchain."
            );
            return Ok(());
        }
    };

    let output = Command::new(&tsc_path)
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

fn resolve_vendored_tsc() -> Option<PathBuf> {
    let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    let tsc_path = manifest_dir
        .join("tests")
        .join("ts_toolchain")
        .join("node_modules")
        .join(".bin")
        .join("tsc");
    if tsc_path.exists() {
        Some(tsc_path)
    } else {
        None
    }
}

/* The vendored tsc (tests/ts_toolchain); with ABI_REQUIRE_TSC set its
absence is an error rather than a skip. */
fn ensure_tsc_available() -> bool {
    if resolve_vendored_tsc().is_some() {
        return true;
    }
    if std::env::var_os("ABI_REQUIRE_TSC").is_some() {
        panic!("ABI_REQUIRE_TSC is set but the vendored tsc is missing");
    }
    println!("WARNING: vendored tsc missing; skipping TypeScript execution test.");
    false
}

fn vendored_tsc() -> PathBuf {
    resolve_vendored_tsc().expect("vendored tsc")
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
fn test_ts_state_proof_computed_tag_builder() {
    let test_dir = setup_test_dir("state_proof");
    let abi_file = "rpc/abi/type-library/state_proof.abi.yaml";

    generate_ts_code("rpc/abi/type-library/thru_primitives.abi.yaml", &test_dir)
        .expect("Primitive dependency code generation failed");
    generate_ts_code_with_includes(abi_file, &["rpc/abi/type-library"], &test_dir)
        .expect("StateProof code generation failed");

    let ts_file = test_dir
        .join("thru")
        .join("blockchain")
        .join("state_proof")
        .join("types.ts");
    assert!(ts_file.exists(), "StateProof TypeScript file missing");

    let content = fs::read_to_string(&ts_file).expect("Failed to read StateProof TS file");
    assert!(
        content.contains("export class StateProofBuilder"),
        "StateProof builder not emitted"
    );
    assert!(
        content.contains("__tnComputeSequentialLayout(view, target)"),
        "StateProof builder should validate computed tags via sequential layout helper"
    );

    check_typescript_compilation(&ts_file)
        .expect("StateProof TypeScript failed strict tsc --noEmit");
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
    assert!(
        content.contains("static footprint"),
        "Missing footprint method"
    );
    assert!(content.contains("static new"), "Missing new method");
    assert!(
        content.contains("static from_array"),
        "Missing from_array method"
    );
    assert!(
        content.contains("private buffer: Uint8Array"),
        "Missing buffer field"
    );
    assert!(
        content.contains("private view: DataView"),
        "Missing DataView"
    );

    println!("✓ TypeScript code structure test passed");
}

#[test]
fn test_ts_ir_helpers_are_emitted() {
    let test_dir = setup_test_dir("ir_helpers");

    let abi_file = "tests/compliance_data/dynamic_struct.abi.yaml";
    fs::create_dir_all("tests/compliance_data").unwrap();
    fs::write(
        abi_file,
        r#"abi:
  package: "compliance.dynamic"
  abi-version: 1
  package-version: "1.0.0"
  description: "Dynamic struct with FAM"

types:
  - name: "DynamicStruct"
    kind:
      struct:
        packed: true
        fields:
          - name: "count"
            field-type:
              primitive: u16
          - name: "payload"
            field-type:
              array:
                size:
                  field-ref:
                    path:
                      - count
                element-type:
                  primitive: u8
"#,
    )
    .unwrap();

    generate_ts_code(abi_file, &test_dir).expect("Code generation failed");

    let ts_file = test_dir.join("compliance/dynamic/types.ts");
    let content =
        fs::read_to_string(&ts_file).expect("Failed to read generated dynamic struct file");

    assert!(
        content.contains("static footprintIr("),
        "IR footprint helper missing"
    );
    assert!(
        content.contains("static footprintFromParams"),
        "footprintFromParams helper missing"
    );
    assert!(
        content.contains("static footprintFromValues"),
        "footprintFromValues helper missing"
    );
    assert!(
        content.contains("return this.footprintFromParams(params);"),
        "footprintFromValues should route through footprintFromParams"
    );
    assert!(
        content.contains("opts?: { params?: DynamicStruct.Params }"),
        "from_array did not expose params opts"
    );
    assert!(
        content.contains("__tnToBigInt(buffer.length)"),
        "validate path did not use BigInt-safe helper"
    );

    println!("✓ IR helper emission test passed");
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
    assert!(
        content.contains("set_u64_val(value: bigint): this"),
        "u64 builder setters should require bigint inputs"
    );
    assert!(
        content.contains("set_i64_val(value: bigint): this"),
        "i64 builder setters should require bigint inputs"
    );

    println!("✓ TypeScript BigInt usage test passed");
}

#[test]
fn test_ts_u64_field_ref_array_compile() {
    let test_dir = setup_test_dir("u64_field_ref_array");

    let abi_file = test_dir.join("u64_field_ref_array.abi.yaml");
    fs::write(
        &abi_file,
        r#"abi:
  package: "compliance.u64_field_ref_array"
  abi-version: 1
  package-version: "1.0.0"
  description: "Dynamic arrays driven by u64 length fields"

types:
  - name: "U64FieldRefArray"
    kind:
      struct:
        packed: true
        fields:
          - name: "first_size"
            field-type:
              primitive: u64
          - name: "second_size"
            field-type:
              primitive: u64
          - name: "first"
            field-type:
              array:
                size:
                  field-ref:
                    path:
                      - first_size
                element-type:
                  primitive: u8
          - name: "second"
            field-type:
              array:
                size:
                  field-ref:
                    path:
                      - second_size
                element-type:
                  primitive: u8
"#,
    )
    .unwrap();

    generate_ts_code(abi_file.to_str().unwrap(), &test_dir).expect("Code generation failed");

    let ts_file = test_dir.join("compliance/u64_field_ref_array/types.ts");
    let content = fs::read_to_string(&ts_file).expect("Failed to read generated file");
    assert!(
        content.contains("let __tnFieldValue_first_size: bigint | null = null;"),
        "u64 cached field values should be typed as bigint"
    );

    check_typescript_compilation(&ts_file).expect("TypeScript compilation failed");

    println!("✓ TypeScript u64 field-ref array compilation test passed");
}

#[test]
fn test_ts_enum_builder_uses_physical_u32_tag_field() {
    let test_dir = setup_test_dir("u32_tag_ref_enum_builder");

    let abi_file = test_dir.join("u32_tag_ref_enum_builder.abi.yaml");
    fs::write(
        &abi_file,
        r#"abi:
  package: "compliance.u32_tag_ref_enum_builder"
  abi-version: 1
  package-version: "1.0.0"
  description: "Enum payload tagged by a u32 discriminant field"

types:
  - name: "U32TaggedInstruction"
    kind:
      struct:
        packed: true
        fields:
          - name: "discriminant"
            field-type:
              primitive: u32
          - name: "payload"
            field-type:
              enum:
                packed: true
                tag-ref:
                  field-ref:
                    path:
                      - discriminant
                variants:
                  - name: "first"
                    tag-value: 0
                    variant-type:
                      struct:
                        packed: true
                        fields:
                          - name: "amount"
                            field-type:
                              primitive: u16
                  - name: "second"
                    tag-value: 1
                    variant-type:
                      struct:
                        packed: true
                        fields:
                          - name: "amount"
                            field-type:
                              primitive: u64
"#,
    )
    .unwrap();

    generate_ts_code(abi_file.to_str().unwrap(), &test_dir).expect("Code generation failed");

    let ts_file = test_dir.join("compliance/u32_tag_ref_enum_builder/types.ts");
    let content = fs::read_to_string(&ts_file).expect("Failed to read generated file");
    assert!(
        content
            .contains("payload_discriminant: (() => { if (this.__tnField_discriminant === null)"),
        "u32 tag-ref enum builder params should use the assigned physical tag field"
    );
    assert!(
        !content.contains(
            "payload_discriminant: (() => { return __tnToBigInt(this.__tnPrefixView.getUint32"
        ),
        "u32 tag-ref enum builder params should not read the unwritten prefix buffer"
    );

    check_typescript_compilation(&ts_file).expect("TypeScript compilation failed");

    println!("✓ TypeScript u32 tag-ref enum builder uses physical tag field");
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

#[test]
fn test_ts_ir_validator_error_strings() {
    let test_dir = setup_test_dir("validator_errors");
    let abi_file = "tests/compliance_data/primitives.abi.yaml";

    generate_ts_code(abi_file, &test_dir).expect("Code generation failed");

    let ts_file = test_dir.join("compliance/primitives/types.ts");
    let content = fs::read_to_string(&ts_file).expect("Failed to read generated file");

    assert!(
        content.contains("tn.ir.invalid_tag"),
        "IR validator should surface tn.ir.invalid_tag for bad enum tags"
    );
    assert!(
        content.contains("tn.ir.missing_param"),
        "IR validator should surface tn.ir.missing_param when params are absent"
    );

    println!("✓ TypeScript IR validator reports structured error codes");
}

#[test]
fn test_ts_ir_nested_call_helpers_emitted() {
    let test_dir = setup_test_dir("validator_nested_calls");
    let abi_file = "tests/compliance_data/primitives.abi.yaml";

    generate_ts_code(abi_file, &test_dir).expect("Code generation failed");

    let ts_file = test_dir.join("compliance/primitives/types.ts");
    let content = fs::read_to_string(&ts_file).expect("Failed to read generated file");

    assert!(
        content.contains("const nestedResult = __tnInvokeValidate"),
        "IR runtime should invoke nested validators for Call nodes"
    );
    assert!(
        content.contains("nestedResult.consumed !== undefined"),
        "IR runtime should reuse nested bytes-consumed when wiring Call nodes"
    );

    println!("✓ TypeScript IR runtime wires nested validators and bytes-consumed");
}

#[test]
fn test_ts_nested_inline_struct_field_context_helper() {
    let test_dir = setup_test_dir("nested_inline_struct");
    let abi_file = "tests/compliance_tests/abi_definitions/nested_array_structs.abi.yaml";

    generate_ts_code(abi_file, &test_dir).expect("Code generation failed");

    let ts_file = test_dir.join("compliance/nested_array_structs/types.ts");
    assert!(
        ts_file.exists(),
        "TypeScript file for nested array struct not generated"
    );

    let content = fs::read_to_string(&ts_file).expect("Failed to read generated TypeScript");
    assert!(
        content.contains("__tnFieldContext"),
        "Nested inline structs should cache parent field context"
    );
    assert!(
        content.contains("withFieldContext"),
        "Nested inline structs should expose withFieldContext helper"
    );
    assert!(
        content.contains("__tnResolveFieldRefU64(\"count\")"),
        "Dynamic array length should resolve parent field references through helper"
    );
    if ensure_tsc_available() {
        check_typescript_compilation(&ts_file)
            .expect("Nested inline struct TypeScript failed to compile");
    }

    println!(
        "✓ Nested inline struct arrays resolve parent field references via fieldContext helpers"
    );
}

#[test]
fn test_ts_size_discriminated_union_params() {
    let test_dir = setup_test_dir("size_discriminated_union");
    let abi_file = "tests/compliance_tests/abi_definitions/size_discriminated_unions.abi.yaml";
    generate_ts_code(abi_file, &test_dir).expect("Code generation failed");

    if !ensure_tsc_available() {
        return;
    }

    let ts_script = r#"
import { MessageWithSDU } from "./compliance/size_discriminated_unions/types.js";

const bytes = Uint8Array.from([0x01, 0x02, 0x03, 0x04, 0x05]);
const view = MessageWithSDU.from_array(bytes);
if (!view) {
  throw new Error("MessageWithSDU.from_array returned null");
}
const params = view.dynamicParams();
/* Parameter name is deduplicated: data_payload_size instead of MessageWithSDU__data_payload_size */
if (!params || params.data_payload_size !== 4n) {
  throw new Error("Unexpected payload size parameter");
}
console.log("sdu ok");
"#;
    let script_path = test_dir.join("sdu_test.ts");
    fs::write(&script_path, ts_script.trim()).expect("Failed to write SDU test script");
    let dist_dir = test_dir.join("dist");
    fs::create_dir_all(&dist_dir).unwrap();

    let compile_status = Command::new(vendored_tsc())
        .current_dir(&test_dir)
        .args(&[
            "--strict",
            "--module",
            "NodeNext",
            "--moduleResolution",
            "NodeNext",
            "--target",
            "ES2020",
            "--esModuleInterop",
            "--outDir",
            "dist",
            script_path.file_name().unwrap().to_str().unwrap(),
        ])
        .status()
        .expect("Failed to run tsc for SDU test");
    assert!(
        compile_status.success(),
        "TypeScript compilation failed for SDU test"
    );

    let js_entry = PathBuf::from("dist").join("sdu_test.js");
    let node_status = Command::new("node")
        .current_dir(&test_dir)
        .arg(js_entry)
        .status()
        .expect("Failed to run node for SDU test");
    assert!(node_status.success(), "Node execution failed for SDU test");

    println!("✓ TypeScript SDU param extraction test passed");
}

#[test]
fn test_ts_tail_enum_payload_params() {
    let test_dir = setup_test_dir("tail_enum");
    let abi_file = "tests/compliance_data/tail_enum.abi.yaml";
    generate_ts_code(abi_file, &test_dir).expect("Code generation failed");

    if !ensure_tsc_available() {
        return;
    }

    let ts_script = r#"
import { TailEnumPayload } from "./compliance/tail_enum/types.js";

const dynamicPayload = Uint8Array.from([0x03, 0xaa, 0xbb, 0xcc]);
const buffer = new Uint8Array(1 + dynamicPayload.length);
buffer[0] = 1;
buffer.set(dynamicPayload, 1);

const view = TailEnumPayload.from_array(buffer);
if (!view) {
  throw new Error("TailEnumPayload.from_array returned null");
}
const params = view.dynamicParams();
if (!params || params.payload_payload_size !== 4n) {
  throw new Error(`Unexpected tail payload size: ${params?.payload_payload_size}`);
}

const builder = TailEnumPayload.builder();
builder.payload().select("dynamic").writePayload(dynamicPayload).finish();
const builtView = builder.finish();
const builtParams = builtView.dynamicParams();
if (!builtParams || builtParams.payload_payload_size !== 4n) {
  throw new Error("Builder failed to compute payload size parameter");
}
console.log("tail enum ok");
"#;

    let script_path = test_dir.join("tail_enum_test.ts");
    fs::write(&script_path, ts_script.trim()).expect("Failed to write tail enum test script");
    let dist_dir = test_dir.join("dist");
    fs::create_dir_all(&dist_dir).unwrap();

    let compile_status = Command::new(vendored_tsc())
        .current_dir(&test_dir)
        .args(&[
            "--strict",
            "--module",
            "NodeNext",
            "--moduleResolution",
            "NodeNext",
            "--target",
            "ES2020",
            "--esModuleInterop",
            "--outDir",
            "dist",
            script_path.file_name().unwrap().to_str().unwrap(),
        ])
        .status()
        .expect("Failed to run tsc for tail enum test");
    assert!(
        compile_status.success(),
        "TypeScript compilation failed for tail enum test"
    );

    let js_entry = PathBuf::from("dist").join("tail_enum_test.js");
    let node_status = Command::new("node")
        .current_dir(&test_dir)
        .arg(js_entry)
        .status()
        .expect("Failed to run node for tail enum test");
    assert!(
        node_status.success(),
        "Node execution failed for tail enum test"
    );

    println!("✓ Tail enum payload param test passed");
}

#[test]
fn test_ts_dual_arrays_dynamic_offsets_roundtrip() {
    let test_dir = setup_test_dir("dual_arrays_dynamic_offsets");
    let abi_file = "tests/compliance_tests/abi_definitions/array_structs.abi.yaml";
    generate_ts_code(abi_file, &test_dir).expect("Code generation failed");

    if !ensure_tsc_available() {
        return;
    }

    let ts_script = r#"
import { DualArrays } from "./compliance/array_structs/types.js";

const encoded = Uint8Array.from([
  0x04, 0x00, 0x00, 0x00, // size1 = 4
  0x0a, 0x14, 0x1e, 0x28, // arr1 bytes
  0x03, 0x00, 0x00, 0x00, // size2 = 3
  0xf4, 0x01, 0xee, 0x02, 0xe8, 0x03 // arr2 bytes (500,750,1000)
]);

const dualView = DualArrays.from_array(encoded);
if (!dualView) {
  throw new Error("DualArrays.from_array returned null");
}
if (dualView.get_size1() !== 4) {
  throw new Error(`Unexpected size1: ${dualView.get_size1()}`);
}
const arr2 = dualView.get_arr2();
if (arr2.length !== 3 || arr2[0] !== 500 || arr2[1] !== 750 || arr2[2] !== 1000) {
  throw new Error(`Unexpected arr2 payload: ${arr2.join(",")}`);
}
dualView.set_size1(1234);
if (dualView.get_arr2_at(0) !== 500) {
  throw new Error("Dynamic offset cache returned corrupted arr2");
}

const builder = DualArrays.builder();
const arr1Writer = builder.arr1();
arr1Writer.write(Uint8Array.from([0x05, 0x06, 0x07]));
arr1Writer.finish();
const arr2Writer = builder.arr2();
arr2Writer.write(Uint8Array.from([0x64, 0x00, 0xc8, 0x00]));
arr2Writer.finish();
const rebuilt = DualArrays.fromBuilder(builder);
if (!rebuilt) {
  throw new Error("DualArrays.fromBuilder returned null");
}
const rebuiltArr2 = rebuilt.get_arr2();
if (rebuilt.get_size1() !== 3 || rebuiltArr2.length !== 2 || rebuiltArr2[0] !== 100 || rebuiltArr2[1] !== 200) {
  throw new Error("Builder roundtrip mismatch");
}

console.log("dual arrays ok");
"#;

    let script_path = test_dir.join("dual_arrays_test.ts");
    fs::write(&script_path, ts_script.trim()).expect("Failed to write dual arrays test script");
    let dist_dir = test_dir.join("dist");
    fs::create_dir_all(&dist_dir).unwrap();

    let compile_status = Command::new(vendored_tsc())
        .current_dir(&test_dir)
        .args(&[
            "--strict",
            "--module",
            "NodeNext",
            "--moduleResolution",
            "NodeNext",
            "--target",
            "ES2020",
            "--esModuleInterop",
            "--outDir",
            "dist",
            script_path.file_name().unwrap().to_str().unwrap(),
        ])
        .status()
        .expect("Failed to run tsc for dual arrays test");
    assert!(
        compile_status.success(),
        "TypeScript compilation failed for dual arrays test"
    );

    let js_entry = PathBuf::from("dist").join("dual_arrays_test.js");
    let node_status = Command::new("node")
        .current_dir(&test_dir)
        .arg(js_entry)
        .status()
        .expect("Failed to run node for dual arrays test");
    assert!(
        node_status.success(),
        "Node execution failed for dual arrays test"
    );

    println!("✓ TypeScript dual arrays dynamic offset test passed");
}

#[test]
fn test_ts_enum_builder_supports_variant_selectors() {
    let test_dir = setup_test_dir("token_builder");
    let abi_path = PathBuf::from("..")
        .join("type-library")
        .join("tn_token_program.abi.yaml");

    generate_ts_code(
        abi_path.to_str().expect("token_program.abi.yaml path utf8"),
        &test_dir,
    )
    .expect("Code generation failed");

    let ts_file = test_dir.join("thru/program/token/types.ts");
    let content = fs::read_to_string(&ts_file).expect("Failed to read generated file");

    assert!(
        content.contains("payloadVariantDescriptors = Object.freeze(["),
        "TokenInstruction should expose payloadVariantDescriptors"
    );
    assert!(
        content.contains("createPayloadBuilder: () => __tnMaybeCallBuilder"),
        "Variant descriptors should call the guarded __tnMaybeCallBuilder helper"
    );
    assert!(
        content.contains("__tnCreateVariantSelector"),
        "Builder should leverage __tnCreateVariantSelector helper"
    );
    assert!(
        !content.contains("switch (tag)"),
        "Generated TypeScript should not emit legacy switch(tag) stubs"
    );
    assert!(
        content.contains("private __tnValidateOrThrow"),
        "Builder should validate buffers before returning"
    );
    assert!(
        content.contains("finishView(): TokenInstruction"),
        "Builder should expose finishView() helper"
    );
    assert!(
        content.contains("export const Params = {"),
        "Params helper namespace should expose fromValues/fromBuilder"
    );
    assert!(
        content.contains("fromBuilder(source"),
        "Params namespace should expose fromBuilder helper"
    );
    assert!(
        content.contains("export const ParamKeys = Object.freeze"),
        "ParamKeys should be emitted for reflection hooks"
    );
    assert!(
        content.contains("private static readonly __tnFieldOffset_payload"),
        "Enum reader should expose payload offset constant"
    );
    assert!(
        content.contains(
            "payloadVariant(): typeof TokenInstruction.payloadVariantDescriptors[number] | null"
        ),
        "Reader should expose payloadVariant() helper"
    );
    assert!(
        content.contains("return TokenInstruction_payload_Inner.__tnCreate"),
        "Reader should materialize payload helper class"
    );
    assert!(
        content.contains("static __tnCreate(payload: Uint8Array, descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>): TokenInstruction_payload_Inner"),
        "Nested enum helper should expose __tnCreate factory"
    );
    assert!(
        content.contains("asInitializeMint(): InitializeMintInstruction | null"),
        "Variant helpers should allow downcasting to specific payload views"
    );
    assert!(
        !content.contains("Enum variant accessors would go here"),
        "Generated enums should no longer emit TODO placeholders"
    );

    for (idx, line) in content.lines().enumerate() {
        if line.contains("console.") {
            if line.contains("__tnConsole") || line.contains("__TnConsole") {
                continue;
            }
            panic!(
                "Line {} references console.* without going through the runtime shim: {}",
                idx + 1,
                line.trim()
            );
        }
    }
}

#[test]
fn test_ts_tail_typeref_struct_builders() {
    let test_dir = setup_test_dir("token_tail_typeref_builder");
    let abi_path = PathBuf::from("..")
        .join("type-library")
        .join("tn_token_program.abi.yaml");

    generate_ts_code(
        abi_path.to_str().expect("token_program.abi.yaml path utf8"),
        &test_dir,
    )
    .expect("Code generation failed");

    let ts_file = test_dir.join("thru/program/token/types.ts");
    let content = fs::read_to_string(&ts_file).expect("Failed to read generated file");

    assert!(
        content.contains("class InitializeMintInstructionBuilder"),
        "InitializeMintInstruction should emit a builder"
    );
    assert!(
        content.contains("static builder(): InitializeMintInstructionBuilder"),
        "InitializeMintInstruction should expose a static builder() helper"
    );
    assert!(
        content.contains("set_state_proof(value: StateProof | __TnStructFieldInput): this"),
        "Builder should accept StateProof or raw byte inputs for the trailing type-ref"
    );
    assert!(
        content.contains(
            "__tnResolveStructFieldInput(value as __TnStructFieldInput, \"InitializeMintInstructionBuilder::state_proof\")"
        ),
        "Tail type-ref setters must resolve inputs via the runtime helper"
    );
    assert!(
        content.contains(
            "createPayloadBuilder: () => __tnMaybeCallBuilder(InitializeMintInstruction)"
        ),
        "TokenInstruction payload descriptors should surface nested InitializeMintInstruction builders"
    );
    assert!(
        content.contains("function __tnResolveStructFieldInput("),
        "Runtime helper for struct field inputs should be emitted"
    );
}

#[test]
fn test_ts_fam_struct_with_trailing_typeref_builder_roundtrip() {
    let test_dir = setup_test_dir("passkey_validate_trailing_instruction_data");
    generate_ts_code_with_includes(
        "rpc/abi/type-library/tn_wallet.abi.yaml",
        &["rpc/abi/type-library"],
        &test_dir,
    )
    .expect("Code generation failed");

    let ts_file = test_dir.join("thru/program/wallet/types.ts");
    let content = fs::read_to_string(&ts_file).expect("Failed to read passkey types.ts");
    assert!(
        content.contains("get_target_instruction(): InstructionData"),
        "ValidateArgs should expose the trailing InstructionData field"
    );
    assert!(
        content.contains("class ValidateArgsBuilder"),
        "ValidateArgsBuilder should be emitted for FAM plus trailing type-ref layouts"
    );
    assert!(
        content.contains("data_data_size"),
        "ValidateArgs params should include nested InstructionData payload size"
    );
    assert!(
        content.contains(
            "set_target_instruction(value: InstructionData | __TnStructFieldInput): this"
        ),
        "ValidateArgsBuilder should accept generated views, raw bytes, or builders for the trailing instruction"
    );
    assert!(
        content.contains("createPayloadBuilder: () => __tnMaybeCallBuilder(ValidateArgs)"),
        "Variant descriptors should surface the generated ValidateArgs builder"
    );

    if !ensure_tsc_available() {
        return;
    }

    let ts_script = r#"
import {
  PasskeyInstructionBuilder,
  ValidateArgs,
  ValidateArgsBuilder,
} from "./thru/program/wallet/types.js";
import { InstructionDataBuilder } from "./thru/common/primitives/types.js";

const targetBuilder = new InstructionDataBuilder();
targetBuilder.set_program_idx(7);
targetBuilder.data().write(Uint8Array.from([0xaa, 0xbb, 0xcc])).finish();
const targetBytes = targetBuilder.build();

const builder = new ValidateArgsBuilder()
  .set_wallet_account_idx(0x1234)
  .set_auth_idx(5)
  .set_signature_r(new Uint8Array(32).fill(0x11))
  .set_signature_s(new Uint8Array(32).fill(0x22))
  .set_target_instruction(targetBytes);
builder.authenticator_data().write(Uint8Array.from([0x33, 0x44])).finish();
builder.client_data().write(Uint8Array.from([0x55])).finish();

const bytes = builder.build();
const validation = ValidateArgs.validate(bytes);
if (!validation.ok || validation.consumed !== bytes.length) {
  throw new Error(`ValidateArgs validation failed: ${validation.code}`);
}
const view = ValidateArgs.from_array(bytes);
if (!view) {
  throw new Error("ValidateArgs.from_array returned null");
}
const params = view.dynamicParams();
if (params.authenticator_data_authenticator_data_len !== 2n || params.client_data_client_data_len !== 1n || params.data_data_size !== 3n) {
  throw new Error("ValidateArgs dynamic params were not propagated");
}
const target = view.get_target_instruction();
if (target.get_program_idx() !== 7 || target.get_data().join(",") !== "170,187,204") {
  throw new Error("Nested InstructionData did not roundtrip");
}

const instructionBytes = new PasskeyInstructionBuilder()
  .payload()
  .select("validate")
  .writePayload(builder)
  .finish()
  .build();
if (instructionBytes[0] !== 1) {
  throw new Error("PasskeyInstructionBuilder did not select validate");
}

console.log("validate builder ok");
"#;
    let script_path = test_dir.join("validate_builder_test.ts");
    fs::write(&script_path, ts_script.trim())
        .expect("Failed to write validate builder test script");
    let dist_dir = test_dir.join("dist");
    fs::create_dir_all(&dist_dir).unwrap();

    let compile_status = Command::new(vendored_tsc())
        .current_dir(&test_dir)
        .args(&[
            "--strict",
            "--module",
            "NodeNext",
            "--moduleResolution",
            "NodeNext",
            "--target",
            "ES2020",
            "--esModuleInterop",
            "--outDir",
            "dist",
            script_path.file_name().unwrap().to_str().unwrap(),
        ])
        .status()
        .expect("Failed to run tsc for validate builder test");
    assert!(
        compile_status.success(),
        "TypeScript compilation failed for validate builder test"
    );

    let js_entry = PathBuf::from("dist").join("validate_builder_test.js");
    let node_status = Command::new("node")
        .current_dir(&test_dir)
        .arg(js_entry)
        .status()
        .expect("Failed to run node for validate builder test");
    assert!(
        node_status.success(),
        "Node execution failed for validate builder test"
    );
}

#[test]
fn test_ts_jagged_typeref_array_builder_roundtrip() {
    let test_dir = setup_test_dir("multicall_jagged_builder");
    generate_ts_code_with_includes(
        "rpc/abi/type-library/tn_multicall.abi.yaml",
        &["rpc/abi/type-library"],
        &test_dir,
    )
    .expect("Code generation failed");

    let ts_file = test_dir.join("thru/program/multicall/types.ts");
    let content = fs::read_to_string(&ts_file).expect("Failed to read multicall types.ts");
    assert!(
        content.contains("class MulticallArgsBuilder"),
        "MulticallArgsBuilder should be emitted for jagged type-ref arrays"
    );
    assert!(
        content.contains(
            "set_calls(values: readonly (InstructionData | __TnStructFieldInput)[]): this"
        ),
        "MulticallArgsBuilder should expose a structured jagged-array setter"
    );

    if !ensure_tsc_available() {
        return;
    }

    let ts_script = r#"
import {
  MulticallArgs,
  MulticallArgsBuilder,
} from "./thru/program/multicall/types.js";
import { InstructionDataBuilder } from "./thru/common/primitives/types.js";

function instruction(programIdx: number, data: number[]): Uint8Array {
  const builder = new InstructionDataBuilder();
  builder.set_program_idx(programIdx);
  builder.data().write(Uint8Array.from(data)).finish();
  return builder.build();
}

const builder = new MulticallArgsBuilder().set_calls([
  instruction(2, [0xaa]),
  instruction(5, [0xbb, 0xcc]),
]);
const bytes = builder.build();
const validation = MulticallArgs.validate(bytes);
if (!validation.ok || validation.consumed !== bytes.length) {
  throw new Error(`MulticallArgs validation failed: ${validation.code}`);
}
const view = MulticallArgs.from_array(bytes);
if (!view) {
  throw new Error("MulticallArgs.from_array returned null");
}
if (view.dynamicParams().calls_calls_count !== 2n) {
  throw new Error("MulticallArgs dynamic count was not propagated");
}
const calls = view.get_calls();
if (calls.length !== 2 || calls[0].get_program_idx() !== 2 || calls[1].get_data().join(",") !== "187,204") {
  throw new Error("Jagged multicall elements did not roundtrip");
}

console.log("multicall builder ok");
"#;
    let script_path = test_dir.join("multicall_builder_test.ts");
    fs::write(&script_path, ts_script.trim())
        .expect("Failed to write multicall builder test script");
    let dist_dir = test_dir.join("dist");
    fs::create_dir_all(&dist_dir).unwrap();

    let compile_status = Command::new(vendored_tsc())
        .current_dir(&test_dir)
        .args(&[
            "--strict",
            "--module",
            "NodeNext",
            "--moduleResolution",
            "NodeNext",
            "--target",
            "ES2020",
            "--esModuleInterop",
            "--outDir",
            "dist",
            script_path.file_name().unwrap().to_str().unwrap(),
        ])
        .status()
        .expect("Failed to run tsc for multicall builder test");
    assert!(
        compile_status.success(),
        "TypeScript compilation failed for multicall builder test"
    );

    let js_entry = PathBuf::from("dist").join("multicall_builder_test.js");
    let node_status = Command::new("node")
        .current_dir(&test_dir)
        .arg(js_entry)
        .status()
        .expect("Failed to run node for multicall builder test");
    assert!(
        node_status.success(),
        "Node execution failed for multicall builder test"
    );
}

#[test]
fn test_ts_generated_code_has_no_todo_placeholders() {
    let test_dir = setup_test_dir("token_no_todo");
    let abi_path = PathBuf::from("..")
        .join("type-library")
        .join("tn_token_program.abi.yaml");

    generate_ts_code(
        abi_path.to_str().expect("token_program.abi.yaml path utf8"),
        &test_dir,
    )
    .expect("Code generation failed");

    let ts_file = test_dir.join("thru/program/token/types.ts");
    let content = fs::read_to_string(&ts_file).expect("Failed to read generated file");

    assert!(
        !content.contains("TODO"),
        "Generated Token Program bindings must never contain TODO placeholders"
    );
}

#[test]
fn test_ts_field_derived_dynamic_tail_builder_support() {
    let test_dir = setup_test_dir("flag_tail_struct");
    let abi_file = "tests/compliance_data/flag_tail_struct.abi.yaml";

    generate_ts_code(abi_file, &test_dir).expect("Code generation failed");

    let ts_file = test_dir.join("compliance/flag_tail/types.ts");
    assert!(ts_file.exists(), "Generated TypeScript file missing");

    let content = fs::read_to_string(&ts_file).expect("Failed to read flag-tail types.ts");
    assert!(
        content.contains("export class FlagTailInstructionBuilder"),
        "field-derived dynamic tail structs should get builders"
    );
    assert!(
        content.contains("client_id(): __TnFamWriterResult<FlagTailInstructionBuilder>"),
        "builder should expose a low-level tail writer"
    );
    assert!(
        content.contains("flags: (() => { return __tnToBigInt(this.view.getUint8(0)); })()"),
        "builder params should be derived from the fixed prefix field"
    );
    assert!(
        content.contains(
            "const __tnExpected_client_id_bytes = (((this.view.getUint8(0) >> 6) & 1) * 16);"
        ),
        "builder should compute the expected tail byte length from flag bits"
    );
    assert!(
        content.contains("field 'client_id' length does not match dynamic layout"),
        "builder should reject tails that do not match the dynamic layout"
    );
}

#[test]
fn test_ts_flexible_array_builder_support() {
    let test_dir = setup_test_dir("fam_struct");
    let abi_file = "tests/compliance_data/fam_struct.abi.yaml";

    generate_ts_code(abi_file, &test_dir).expect("Code generation failed");

    let ts_file = test_dir.join("compliance/fam/types.ts");
    assert!(ts_file.exists(), "Generated TypeScript file missing");

    let content = fs::read_to_string(&ts_file).expect("Failed to read FAM types.ts");
    assert!(
        content.contains("proof(): __TnFamWriterResult<CounterCreateInstructionBuilder>"),
        "FAM builder should expose proof() writer returning __TnFamWriterResult"
    );
    assert!(
        content.contains("__tnCreateFamWriter"),
        "Runtime helper __tnCreateFamWriter should be referenced"
    );
    assert!(
        content.contains(
            "static fromBuilder(builder: CounterCreateInstructionBuilder): CounterCreateInstruction | null"
        ),
        "Structs with builders must expose static fromBuilder"
    );
    assert!(
        content.contains("flexibleArrayWriters = Object.freeze(["),
        "Reflection metadata should document flexibleArrayWriters"
    );
    assert!(
        !content.contains("switch (tag)"),
        "FAM builders should not emit legacy switch(tag) snippets"
    );
    assert!(
        content.contains("this.buffer = new Uint8Array(42);"),
        "FAM builder must allocate the constant prefix bytes (42 for this fixture)"
    );
    assert!(
        content.contains("let cursor = this.buffer.length;"),
        "FAM builder should stream payloads using a cursor past the prefix"
    );
    assert!(
        content.contains("target.set(__tnLocal_proof_bytes, cursor);"),
        "FAM payloads should be written at the rolling cursor offset"
    );
    assert!(
        content.contains("cursor += __tnLocal_proof_bytes.length;"),
        "FAM cursor must advance by the payload length after each write"
    );
}

#[test]
fn test_ts_dynamic_offsets_resume_after_fam() {
    let test_dir = setup_test_dir("dynamic_offsets_resume_after_fam");
    let abi_file = "tests/compliance_tests/abi_definitions/array_structs.abi.yaml";

    generate_ts_code(abi_file, &test_dir).expect("Code generation failed");

    let ts_file = test_dir.join("compliance/array_structs/types.ts");
    assert!(ts_file.exists(), "Generated TypeScript file missing");

    let content = fs::read_to_string(&ts_file).expect("Failed to read array_structs types.ts");
    assert!(
        content.contains(
            "static __tnComputeSequentialLayout(view: DataView, buffer: Uint8Array): { params: Record<string, bigint> | null; offsets: Record<string, number> | null; derived: Record<string, bigint> | null } | null"
        ),
        "Structs with dynamic fields should emit a shared sequential layout helper"
    );
    assert!(
        content
            .contains("const __tnLayout = DualArrays.__tnComputeSequentialLayout(view, buffer);"),
        "__tnExtractParams should reuse the sequential layout helper to derive params"
    );
    assert!(
        content.contains(
            "const layout = DualArrays.__tnComputeSequentialLayout(this.view, this.buffer);"
        ),
        "Dynamic offset cache must reuse the sequential layout helper instead of duplicating cursor logic"
    );
    assert!(
        content.contains("const offset = this.__tnGetDynamicOffset(\"size2\");"),
        "Fields following a flexible array should bind their offset via helper"
    );
    assert!(
        content.contains("const offset = this.__tnGetDynamicOffset(\"arr2\");"),
        "Trailing arrays should resolve their starting offset once per getter/setter"
    );
    assert!(
        content.contains("get_arr2_at(index: number): number {"),
        "Array getters after flexible members should still be emitted"
    );
    assert_no_external_private_helper(&content, "__tnFootprintInternal");
    assert_no_external_private_helper(&content, "__tnValidateInternal");
}

fn assert_no_external_private_helper(content: &str, helper: &str) {
    for (idx, _) in content.match_indices(helper) {
        if idx == 0 {
            continue;
        }
        let prefix = &content[..idx];
        if let Some(dot_pos) = prefix.rfind('.') {
            if dot_pos + 1 != idx {
                continue;
            }
            let ident_start = prefix[..dot_pos]
                .rfind(|c: char| !c.is_alphanumeric() && c != '_')
                .map(|pos| pos + 1)
                .unwrap_or(0);
            let ident = &prefix[ident_start..dot_pos];
            if ident == "this" {
                continue;
            }
            panic!("Found external reference to {helper} via '{ident}.{helper}'");
        }
    }
}

#[test]
fn test_ts_enums_fixture_compiles() {
    let test_dir = setup_test_dir("enum_fixture");
    let abi_file = "tests/compliance_tests/abi_definitions/enums.abi.yaml";

    generate_ts_code(abi_file, &test_dir).expect("Code generation failed");

    let ts_file = test_dir.join("compliance/enums/types.ts");
    assert!(ts_file.exists(), "Generated TypeScript file missing");

    let content = fs::read_to_string(&ts_file).expect("Failed to read enums types.ts");
    assert!(
        content.contains("createPayloadBuilder: () => null"),
        "Variant descriptors without nested builders should emit null factories"
    );
    assert!(
        !content.contains("SimpleEnum::body::None.builder"),
        "Generated code must not use C++-style :: separators in identifiers"
    );

    check_typescript_compilation(&ts_file)
        .expect("TypeScript compilation failed for enums fixture");
}

#[test]
fn test_ts_parent_tag_ref_enum_no_duplicate_params() {
    /* Regression test for bug: when a tagged union's tag-ref points to a field in the
    parent struct, the codegen was generating duplicate parameters with different names
    (e.g., "payload_event_type" and "EventEnvelope__payload_event_type") that both
    resolve to the same byte offset. This caused TypeScript compilation errors because
    the Params type required both parameters but __tnComputeParams only provided one.

    The fix deduplicates parameters by their resolved byte offset, keeping the shorter
    parameter name. */
    let test_dir = setup_test_dir("parent_tag_ref_enum");
    let abi_file = "tests/compliance_data/parent_tag_ref_enum.abi.yaml";

    generate_ts_code(abi_file, &test_dir).expect("Code generation failed");

    let ts_file = test_dir.join("compliance/parent_tag_ref_enum/types.ts");
    assert!(ts_file.exists(), "Generated TypeScript file missing");

    let content = fs::read_to_string(&ts_file).expect("Failed to read types.ts");

    /* Verify no duplicate parameters exist.
    Before the fix, we would see both:
    - payload_event_type (shorter, canonical)
    - EventEnvelope__payload_event_type (longer, qualified)
    After the fix, only the shorter one should exist. */
    let param_count = content.matches("payload_event_type").count();
    let qualified_count = content.matches("EventEnvelope__payload_event_type").count();

    assert_eq!(
        qualified_count, 0,
        "Found duplicate qualified parameter name 'EventEnvelope__payload_event_type'. \
         The fix should deduplicate parameters by byte offset, keeping only the shorter name."
    );

    assert!(
        param_count > 0,
        "Expected 'payload_event_type' parameter to exist in generated code"
    );

    /* Verify the Params namespace exists and has the expected structure */
    assert!(
        content.contains("export namespace EventEnvelope"),
        "EventEnvelope namespace should be generated"
    );
    assert!(
        content.contains("export type Params ="),
        "Params type should be generated inside namespace"
    );

    /* Most importantly: verify TypeScript compilation succeeds.
    Before the fix, this would fail with:
    "Property 'EventEnvelope__payload_event_type' is missing" */
    check_typescript_compilation(&ts_file)
        .expect("TypeScript compilation failed - likely duplicate parameter mismatch between Params type and __tnComputeParams");

    println!("✓ Parent tag-ref enum deduplication test passed");
}

#[test]
fn test_ts_clob_program_compiles_with_u64_event_tag() {
    let test_dir = setup_test_dir("clob_program_u64_event_tag");
    let abi_file = "rpc/abi/type-library/tn_clob_program.abi.yaml";

    generate_ts_code_with_includes(abi_file, &["rpc/abi/type-library"], &test_dir)
        .expect("Code generation failed");

    let ts_file = test_dir.join("thru/program/clob/types.ts");
    assert!(ts_file.exists(), "Generated CLOB TypeScript file missing");

    let content = fs::read_to_string(&ts_file).expect("Failed to read generated CLOB types.ts");

    assert!(
        content.contains("private __tnField_event_type: bigint | null = null;"),
        "CLOB event_type tag should use bigint storage because the ABI declares it as u64"
    );
    assert!(
        content.contains("set_event_type(value: number | bigint): this"),
        "CLOB event_type setter should accept number or bigint input for ergonomic u64 assignment"
    );
    assert!(
        content.contains("view.setBigUint64(0, __tnToBigInt(this.__tnField_event_type), true);"),
        "CLOB event_type writer should convert the u64 tag before calling DataView.setBigUint64"
    );
    assert!(
        content.contains("export class SeatArenaAccount"),
        "CLOB TypeScript output should include the seat arena account decoder"
    );
    assert!(
        content.contains("export class OrderArenaAccount"),
        "CLOB TypeScript output should include the order arena account decoder"
    );
    assert!(
        content.contains("export class CbookAccount"),
        "CLOB TypeScript output should include the cbook account decoder"
    );
    assert!(
        content.contains("export class ExchangeInitializeInstruction"),
        "CLOB TypeScript output should include the exchange initializer"
    );
    assert!(
        content.contains("export class ExchangeMetaAccount"),
        "CLOB TypeScript output should include the exchange metadata decoder"
    );
    assert!(
        content.contains("this.buffer.length"),
        "CLOB dynamic account tail lengths should derive from the input buffer size"
    );

    check_typescript_compilation(&ts_file)
        .expect("TypeScript compilation failed for generated CLOB ABI with u64 event tag");
}

#[test]
fn test_ts_oracle_create_feed_uses_raw_payload_path() {
    let test_dir = setup_test_dir("oracle_create_feed_raw_payload");
    let abi_file = "rpc/abi/type-library/tn_oracle_program.abi.yaml";

    generate_ts_code_with_includes(abi_file, &["rpc/abi/type-library"], &test_dir)
        .expect("Code generation failed");

    let ts_file = test_dir.join("thru/program/oracle/types.ts");
    assert!(ts_file.exists(), "Generated Oracle TypeScript file missing");

    let content = fs::read_to_string(&ts_file).expect("Failed to read generated Oracle types.ts");
    assert!(
        !content.contains("export class CreateFeedArgsBuilder"),
        "CreateFeedArgsBuilder should not be emitted until enum-plus-tail-FAM builders are supported"
    );
    assert!(
        !content.contains("static builder(): CreateFeedArgsBuilder"),
        "CreateFeedArgs should not expose a static builder for the unsupported trailing-proof layout"
    );

    /* The struct's variant descriptor table (enum views also map tags to
    names when created from a field context). */
    let table_start = content
        .find("payloadVariantDescriptors = Object.freeze([")
        .expect("OracleInstruction payloadVariantDescriptors missing");
    let descriptor_start = table_start
        + content[table_start..]
            .find("name: \"create_feed\"")
            .expect("OracleInstruction create_feed descriptor missing");
    let descriptor_end = (descriptor_start + 500).min(content.len());
    let descriptor = &content[descriptor_start..descriptor_end];
    assert!(
        descriptor.contains("payloadSize: null"),
        "create_feed should remain a dynamically sized raw payload"
    );
    assert!(
        descriptor.contains("payloadType: \"OracleInstruction::payload::create_feed\""),
        "create_feed descriptor should keep the generated nested variant label"
    );
    assert!(
        content.contains("export class CreateFeedArgs"),
        "CreateFeedArgs should still be emitted as a decoder"
    );
    assert!(
        descriptor.contains("createPayloadBuilder: () => null"),
        "create_feed descriptor should force SDKs onto the raw payload path"
    );
    assert!(
        content.contains("export class OracleInstructionBuilder"),
        "OracleInstructionBuilder should still be emitted for wrapping raw create_feed bytes"
    );

    check_typescript_compilation(&ts_file)
        .expect("TypeScript compilation failed for generated Oracle ABI");
}

/* Write `abi` to `<test_dir>/<name>.abi.yaml`, generate its TypeScript and
 * strictly type-check the package's types.ts (`package` like "test.top_sdu").
 * Returns false when the vendored toolchain is missing (and ABI_REQUIRE_TSC
 * is unset): the caller then skips the runtime checks. */
fn generate_checked_ts(test_dir: &PathBuf, name: &str, abi: &str, package: &str) -> bool {
    let abi_path = fs::canonicalize(test_dir)
        .unwrap()
        .join(format!("{name}.abi.yaml"));
    fs::write(&abi_path, abi).expect("write ABI");
    generate_ts_code(abi_path.to_str().unwrap(), test_dir).expect("Code generation failed");
    let ts_file = test_dir.join(package.replace('.', "/")).join("types.ts");
    assert!(ts_file.exists(), "generated {} missing", ts_file.display());
    if resolve_vendored_tsc().is_none() {
        if std::env::var_os("ABI_REQUIRE_TSC").is_some() {
            panic!("ABI_REQUIRE_TSC is set but the vendored tsc is missing");
        }
        println!("WARNING: vendored tsc missing; skipping");
        return false;
    }
    check_typescript_compilation(&ts_file).expect("generated TypeScript must type-check");
    true
}

/* Compile `script` (TypeScript importing the generated modules relative to
 * `test_dir`) with the vendored tsc and run it with node. */
fn run_ts_script(test_dir: &PathBuf, name: &str, script: &str) {
    let tsc = resolve_vendored_tsc().expect("vendored tsc");
    let script_path = test_dir.join(format!("{name}.ts"));
    fs::write(&script_path, script.trim()).expect("write script");
    let compile = Command::new(&tsc)
        .current_dir(test_dir)
        .args([
            "--strict",
            "--module",
            "NodeNext",
            "--moduleResolution",
            "NodeNext",
            "--target",
            "ES2020",
            "--outDir",
            "dist",
            script_path.file_name().unwrap().to_str().unwrap(),
        ])
        .output()
        .expect("run tsc");
    assert!(
        compile.status.success(),
        "{name}: tsc failed:\n{}{}",
        String::from_utf8_lossy(&compile.stdout),
        String::from_utf8_lossy(&compile.stderr)
    );
    let run = Command::new("node")
        .current_dir(test_dir)
        .arg(PathBuf::from("dist").join(format!("{name}.js")))
        .output()
        .expect("run node");
    assert!(
        run.status.success(),
        "{name}: node failed:\n{}{}",
        String::from_utf8_lossy(&run.stdout),
        String::from_utf8_lossy(&run.stderr)
    );
}

/* A top-level size-discriminated union is a class: the buffer size must equal
 * one variant's size, `variant()` / `as<Variant>()` give typed views, the
 * params carry the payload size, and `new_<variant>` builds a value. */
#[test]
fn test_ts_top_level_size_discriminated_union() {
    let test_dir = setup_test_dir("top_level_sdu");
    let abi = r#"
abi:
  package: "test.top_sdu"
  abi-version: 1
  package-version: "1.0.0"
  description: "Top-level size-discriminated union"
types:
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
          - name: "wide"
            expected-size: 8
            variant-type:
              type-ref:
                name: "Wide"
  - name: "Wide"
    kind:
      struct:
        packed: true
        fields:
          - name: "v"
            field-type:
              primitive: u64
"#;
    if !generate_checked_ts(&test_dir, "top_sdu", abi, "test.top_sdu") {
        return;
    }
    run_ts_script(
        &test_dir,
        "top_sdu_test",
        r#"
import { TopSdu, Wide } from "./test/top_sdu/types.js";

const check = (cond: boolean, what: string): void => {
  if (!cond) throw new Error(`check failed: ${what}`);
};
const throws = (fn: () => unknown): boolean => {
  try { fn(); return false; } catch { return true; }
};

const b = Uint8Array.from([1, 2, 3, 4]);
check(TopSdu.validate(b).ok && TopSdu.validate(b).consumed === 4, "4-byte value validates");
check(TopSdu.validate(b.subarray(0, 1)).consumed === 1, "1-byte value validates");
for (const len of [0, 2, 3, 5]) {
  check(!TopSdu.validate(new Uint8Array(len)).ok, `no variant is ${len} bytes`);
  check(TopSdu.from_array(new Uint8Array(len)) === null, `from_array rejects ${len} bytes`);
}

const big = TopSdu.from_array(b);
check(big !== null, "from_array");
check(big!.variant().name === "big" && big!.tag() === 1, "variant() is big");
check(big!.asBig()!.get_lo() === 0x0201 && big!.asBig()!.get_hi() === 0x0403, "asBig view");
check(big!.asSmall() === null && big!.asWide() === null, "inactive variants are null");
check(TopSdu.footprintFromParams(big!.dynamicParams()) === 4, "params footprint");

const small = TopSdu.from_array(Uint8Array.from([7]))!;
check(small.asSmall() === 7 && small.asBig() === null, "asSmall");
const wide = TopSdu.from_array(Uint8Array.from([1, 0, 0, 0, 0, 0, 0, 0x80]))!;
check(wide.asWide()!.get_v() === 0x8000000000000001n, "asWide is a typed view");

check(TopSdu.variantDescriptors.map((d) => d.name).join() === "small,big,wide", "descriptors");
check(TopSdu.variantDescriptors[1].payloadSize === 4 && TopSdu.variantDescriptors[1].tag === 1, "descriptor sizes");
check(TopSdu.variantByName("wide")!.payloadSize === 8 && TopSdu.variantByName("nope") === null, "variantByName");
check(TopSdu.footprintFromParams(TopSdu.Params.fromValues({ TopSdu_payload_size: 1 })) === 1, "footprint 1");
check(throws(() => TopSdu.footprintFromParams(TopSdu.Params.fromValues({ TopSdu_payload_size: 2 }))), "footprint 2 throws");

check(TopSdu.new_small(9).bytes().join() === "9", "new_small");
const built = TopSdu.new_big(Uint8Array.from([5, 0, 6, 0]));
check(built.asBig()!.get_hi() === 6 && built.bytes().length === 4, "new_big");
check(throws(() => TopSdu.new_big(Uint8Array.from([1, 2, 3]))), "new_big needs 4 bytes");
check(TopSdu.new_wide(Wide.new(5n)).asWide()!.get_v() === 5n, "new_wide");
check(TopSdu.newVariant("small", Uint8Array.from([3])).asSmall() === 3, "newVariant");
check(throws(() => TopSdu.newVariant("small", Uint8Array.from([3, 4]))), "newVariant checks size");
console.log("top-level sdu ok");
"#,
    );
}

/* Unions with a variable-size variant span their largest variant; every
 * variant is read over the same bytes and must fit. The union's params hold
 * its byte size (`<T>.payload_size`, `<field>.payload_size` in a struct). */
#[test]
fn test_ts_variable_size_unions() {
    let test_dir = setup_test_dir("variable_size_unions");
    let single = fs::read_to_string("tests/compliance_data/variable_union.abi.yaml").unwrap();
    if !generate_checked_ts(
        &test_dir,
        "variable_union",
        &single,
        "compliance.variable_union",
    ) {
        return;
    }
    let nested = format!(
        "{}  - name: \"RefHolder\"\n    kind:\n      struct:\n        packed: true\n        fields:\n          - name: \"lead\"\n            field-type:\n              primitive: u8\n          - name: \"pair\"\n            field-type:\n              type-ref:\n                name: \"TwoVar\"\n          - name: \"trail\"\n            field-type:\n              primitive: u8\n",
        fs::read_to_string("tests/compliance_data/variable_union_nested.abi.yaml").unwrap()
    );
    if !generate_checked_ts(
        &test_dir,
        "variable_union_nested",
        &nested,
        "compliance.variable_union_nested",
    ) {
        return;
    }
    run_ts_script(
        &test_dir,
        "variable_unions_test",
        r#"
import { VarUnion } from "./compliance/variable_union/types.js";
import { TwoVar, TagOrSized, VarHolder, RefHolder } from "./compliance/variable_union_nested/types.js";

const check = (cond: boolean, what: string): void => {
  if (!cond) throw new Error(`check failed: ${what}`);
};
const throws = (fn: () => unknown): boolean => {
  try { fn(); return false; } catch { return true; }
};
const u8 = (...xs: number[]) => Uint8Array.from(xs);

/* VarUnion: fixed u32 | sized { len, data[len] } */
for (const [bytes, size] of [
  [u8(4, 0, 0, 0, 0), 5],
  [u8(6, 1, 2, 3, 4, 5, 6), 7],
  [u8(1, 0xaa, 0, 0), 4],
  [u8(3, 9, 8, 7), 4],
] as const) {
  const r = VarUnion.validate(bytes);
  check(r.ok && r.consumed === size, `VarUnion validates ${bytes.join()} as ${size}`);
  const v = VarUnion.from_array(bytes)!;
  check(v.dynamicParams().VarUnion_payload_size === BigInt(size), "payload_size param");
  check(VarUnion.footprintFromParams(v.dynamicParams()) === size, "params footprint");
}
check(!VarUnion.validate(u8(0x2a, 0, 0, 0)).ok, "sized claims 43 bytes");
check(!VarUnion.validate(u8(2, 0xaa, 0xbb)).ok, "fixed needs 4 bytes");
check(VarUnion.from_array(u8(2, 0xaa)) === null, "from_array rejects short buffers");
const vu = VarUnion.from_array(u8(6, 1, 2, 3, 4, 5, 6, 0xee))!;
check(vu.bytes().length === 7, "trailing bytes are not part of the value");
check(vu.get_fixed() === 0x03020106, "get_fixed");
check(vu.get_sized().get_len() === 6 && vu.get_sized().get_data()[5] === 6, "get_sized");
check(VarUnion.variantDescriptors[0].payloadSize === 4 && VarUnion.variantDescriptors[1].payloadSize === null, "descriptors");
const nf = VarUnion.new_fixed(0x01020305);
check(nf.bytes().join() === "5,3,2,1,0,0" && nf.get_fixed() === 0x01020305, "new_fixed spans sized");
check(VarUnion.new_sized(u8(2, 9, 9)).bytes().join() === "2,9,9,0", "new_sized spans fixed");
check(VarUnion.new_sized(u8(5, 1, 2, 3, 4, 5)).bytes().length === 6, "new_sized");
check(throws(() => VarUnion.new_sized(u8(2, 9))), "new_sized rejects an incomplete variant");
check(VarUnion.footprintFromParams(VarUnion.Params.fromValues({ VarUnion_payload_size: 9 })) === 9, "footprint from params");
check(throws(() => VarUnion.footprintFromParams(VarUnion.Params.fromValues({ VarUnion_payload_size: 3 }))), "smaller than fixed");

/* TwoVar: word u16 | bytes { n, xs[n] } | halves { pad, m, ys: u16[m] } */
check(TwoVar.validate(u8(3, 1, 0xaa, 0xbb)).consumed === 4, "TwoVar 4");
const tw = TwoVar.from_array(u8(1, 3, 0, 0, 0, 0, 0, 0))!;
check(tw.bytes().length === 8 && TwoVar.footprintFromParams(tw.dynamicParams()) === 8, "TwoVar 8");
check(tw.get_halves().get_m() === 3 && tw.get_bytes().get_n() === 1 && tw.get_word() === 0x0301, "TwoVar getters");
check(!TwoVar.validate(u8(1, 3, 0, 0, 0, 0, 0)).ok, "TwoVar halves does not fit");

/* TagOrSized: the constant variant's enum tag is checked but does not size. */
check(TagOrSized.validate(u8(2, 9, 0xaa)).consumed === 3, "TagOrSized 3");
check(TagOrSized.validate(u8(1, 9)).consumed === 2, "TagOrSized 2");
check(!TagOrSized.validate(u8(3, 9, 0xaa, 0xbb)).ok, "TagOrSized rejects tag 3");

/* VarHolder: lead, body (inline union), pair (inline union), trail */
const hb = u8(9, 5, 1, 2, 3, 4, 5, 3, 1, 0xaa, 0xbb, 0x77);
check(VarHolder.validate(hb).ok && VarHolder.validate(hb).consumed === 12, "VarHolder 12");
check(!VarHolder.validate(hb.subarray(0, 11)).ok, "VarHolder short");
const h = VarHolder.from_array(hb)!;
check(h.get_trail() === 0x77 && h.get_lead() === 9, "VarHolder primitives");
check(h.get_body().get_sized().get_len() === 5 && h.get_pair().get_bytes().get_n() === 3, "VarHolder unions");
const hp = h.dynamicParams();
check(hp.body_payload_size === 6n && hp.pair_payload_size === 4n, "VarHolder params");
check(VarHolder.footprintFromParams(hp) === 12, "VarHolder params footprint");
check(VarHolder.footprintFromParams(VarHolder.Params.fromValues({ body_payload_size: 4, pair_payload_size: 8 })) === 14, "VarHolder footprint from values");

/* RefHolder: a type-ref to TwoVar between two bytes. */
const rb = u8(9, 1, 3, 0, 0, 0, 0, 0, 0, 0x77);
check(RefHolder.validate(rb).consumed === 10 && !RefHolder.validate(rb.subarray(0, 9)).ok, "RefHolder 10");
const rh = RefHolder.from_array(rb)!;
check(rh.dynamicParams().pair_payload_size === 8n && RefHolder.footprintFromParams(rh.dynamicParams()) === 10, "RefHolder params");
check(rh.get_trail() === 0x77 && rh.get_pair()!.bytes().length === 8, "RefHolder getters");
console.log("variable unions ok");
"#,
    );
}

/* A struct whose enum field (not the last one) has a variant sized by its
 * own count field: the enum's byte size is its `body.payload_size` param. */
const MID_ENUM_ABI: &str = r#"
abi:
  package: "test.mid_enum"
  abi-version: 1
  package-version: "1.0.0"
  description: "Enum with a self-sized variant before another field"
types:
  - name: "MidEnum"
    kind:
      struct:
        packed: true
        fields:
          - name: "kind"
            field-type:
              primitive: u8
          - name: "body"
            field-type:
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
                    tag-value: 1
                    variant-type:
                      struct:
                        packed: true
                        fields:
                          - name: "len"
                            field-type:
                              primitive: u8
                          - name: "data"
                            field-type:
                              array:
                                size:
                                  field-ref:
                                    path: ["len"]
                                element-type:
                                  primitive: u8
          - name: "trail"
            field-type:
              primitive: u8
"#;

/* For every compliance test case (and the MidEnum vectors), the value's
 * params size it exactly: `T.footprintFromParams(view.dynamicParams())`
 * equals the consumed size, including jagged arrays (`<field>.payload_size`
 * = the elements' byte total), enums whose variant sizes itself and types
 * sized by `__buffer_size` (its `buffer_size` param). */
#[test]
fn test_ts_params_footprint_matches_consumed() {
    let test_dir = setup_test_dir("params_footprint");
    let root = fs::canonicalize(&test_dir).unwrap();
    let mut by_abi: std::collections::BTreeMap<PathBuf, Vec<(String, String, String)>> =
        Default::default();
    let cases_dir = PathBuf::from("tests/compliance_tests/test_cases");
    for group in fs::read_dir(&cases_dir).unwrap() {
        let group = group.unwrap().path();
        for case in fs::read_dir(&group).unwrap() {
            let case = case.unwrap().path();
            let doc: serde_yml::Value =
                serde_yml::from_str(&fs::read_to_string(&case).unwrap()).unwrap();
            let tc = &doc["test-case"];
            let abi = fs::canonicalize(group.join(tc["abi-file"].as_str().unwrap())).unwrap();
            let hex: String = tc["binary-hex"]
                .as_str()
                .unwrap()
                .chars()
                .filter(|c| !c.is_whitespace())
                .collect();
            by_abi.entry(abi).or_default().push((
                tc["type"].as_str().unwrap().to_string(),
                hex,
                case.display().to_string(),
            ));
        }
    }
    let mid = root.join("mid_enum.abi.yaml");
    fs::write(&mid, MID_ENUM_ABI).unwrap();
    by_abi.insert(
        mid,
        vec![
            ("MidEnum".into(), "0103aabbcc77".into(), "MidEnum B".into()),
            ("MidEnum".into(), "000577".into(), "MidEnum A".into()),
            ("MidEnum".into(), "010077".into(), "MidEnum empty B".into()),
        ],
    );

    let mut imports = String::new();
    let mut checks = String::new();
    for (idx, (abi, cases)) in by_abi.iter().enumerate() {
        let out = test_dir.join(format!("g{idx}"));
        generate_ts_code(abi.to_str().unwrap(), &out).expect("Code generation failed");
        let content = fs::read_to_string(abi).unwrap();
        let package = content
            .lines()
            .find_map(|l| l.trim().strip_prefix("package:"))
            .unwrap()
            .trim()
            .trim_matches('"')
            .to_string();
        let ts_file = out.join(package.replace('.', "/")).join("types.ts");
        if resolve_vendored_tsc().is_none() {
            if std::env::var_os("ABI_REQUIRE_TSC").is_some() {
                panic!("ABI_REQUIRE_TSC is set but the vendored tsc is missing");
            }
            return;
        }
        check_typescript_compilation(&ts_file).expect("generated TypeScript must type-check");
        imports.push_str(&format!(
            "import * as M{idx} from \"./g{idx}/{}/types.js\";\n",
            package.replace('.', "/")
        ));
        for (ty, hex, name) in cases {
            checks.push_str(&format!(
                "check(M{idx} as Record<string, any>, {ty:?}, {hex:?}, {name:?});\n"
            ));
        }
    }
    let script = format!(
        r#"{imports}
const hex = (h: string): Uint8Array => Uint8Array.from((h.match(/../g) ?? []).map((x) => parseInt(x, 16)));
const failures: string[] = [];
function check(module: Record<string, any>, ty: string, h: string, name: string): void {{
  const T = module[ty];
  const bytes = hex(h);
  try {{
    const view = T.from_array(bytes);
    if (!view) {{ failures.push(`${{name}}: from_array returned null`); return; }}
    const result = T.validate(bytes);
    if (!result.ok || result.consumed !== bytes.length) {{ failures.push(`${{name}}: validate ${{result.code}} consumed ${{result.consumed}}`); return; }}
    let footprint: number;
    if (typeof view.dynamicParams === "function") footprint = T.footprintFromParams(view.dynamicParams());
    else if (typeof T.footprint === "function" && T.footprint.length === 0) footprint = T.footprint();
    else return;
    if (footprint !== bytes.length) failures.push(`${{name}}: params footprint ${{footprint}} != ${{bytes.length}}`);
  }} catch (err) {{
    failures.push(`${{name}}: threw ${{(err as Error).message}}`);
  }}
}}
{checks}
const jagged = M_JAGGED.SingleJaggedRecord;
if (jagged.footprintFromParams(jagged.Params.fromValues({{ record_has_record: 1, record_payload_size: 5 }})) !== 6) failures.push("SingleJaggedRecord footprint from values");
const sized = M_SIZED.BufferSizedEntries;
if (sized.footprintFromParams(sized.Params.fromValues({{ buffer_size: 20 }})) !== 20) failures.push("BufferSizedEntries footprint from buffer_size");
if (sized.footprintFromParams(sized.Params.fromValues({{ buffer_size: 23 }})) !== 20) failures.push("BufferSizedEntries rounds down to whole entries");
const mid = M_MID.MidEnum;
if (mid.from_array(hex("02000077")) !== null) failures.push("MidEnum rejects tag 2");
if (mid.from_array(hex("0105aabb77")) !== null) failures.push("MidEnum rejects a short B");
if (failures.length) throw new Error(failures.join("\n"));
console.log("params footprint ok");
"#
    );
    let jagged_idx = by_abi
        .keys()
        .position(|p| p.ends_with("jagged_arrays.abi.yaml"))
        .unwrap();
    let sized_idx = by_abi
        .keys()
        .position(|p| p.ends_with("buffer_sized.abi.yaml"))
        .unwrap();
    let mid_idx = by_abi
        .keys()
        .position(|p| p.ends_with("mid_enum.abi.yaml"))
        .unwrap();
    let script = script
        .replace(
            "M_JAGGED",
            &format!("(M{jagged_idx} as Record<string, any>)"),
        )
        .replace("M_MID", &format!("(M{mid_idx} as Record<string, any>)"))
        .replace("M_SIZED", &format!("(M{sized_idx} as Record<string, any>)"));
    run_ts_script(&test_dir, "params_footprint_test", &script);
}

/* Arrays sized by a nested struct's count that follows variable-size data
 * (`child.count` after `child.bytes`), inline, through a named child, two
 * offsets deep, and through a child imported from another package: the
 * scan reads the count while measuring the child. */
#[test]
fn test_ts_nested_count_after_variable_data() {
    let test_dir = setup_test_dir("nested_count_after_bytes");
    generate_ts_code(
        "tests/compliance_data/nested_count_after_bytes.abi.yaml",
        &test_dir.join("local"),
    )
    .expect("Code generation failed");
    generate_ts_code_with_includes(
        "rpc/abi/abi_gen/tests/cross_package/count_user.abi.yaml",
        &["rpc/abi/abi_gen/tests/cross_package"],
        &test_dir.join("cross"),
    )
    .expect("Code generation failed");
    let local = test_dir.join("local/compliance/nested_count_after_bytes/types.ts");
    let child = test_dir.join("cross/compliance/cross_package/child/types.ts");
    let user = test_dir.join("cross/compliance/cross_package/user/types.ts");
    for file in [&local, &child, &user] {
        assert!(file.exists(), "generated {} missing", file.display());
    }
    if resolve_vendored_tsc().is_none() {
        if std::env::var_os("ABI_REQUIRE_TSC").is_some() {
            panic!("ABI_REQUIRE_TSC is set but the vendored tsc is missing");
        }
        return;
    }
    for file in [&local, &user] {
        check_typescript_compilation(file).expect("generated TypeScript must type-check");
    }
    run_ts_script(
        &test_dir,
        "nested_count_test",
        r#"
import { NestedCount, NamedCount, DeepCount, CountChild } from "./local/compliance/nested_count_after_bytes/types.js";
import { ImportedCount, WrappedImportedCount } from "./cross/compliance/cross_package/user/types.js";

const check = (cond: boolean, what: string): void => {
  if (!cond) throw new Error(`check failed: ${what}`);
};
const u8 = (...xs: number[]) => Uint8Array.from(xs);
/* The params value whose ABI path ends with `suffix`. */
const param = (T: any, params: Record<string, bigint>, suffix: string): bigint | undefined => {
  const key = Object.entries(T.ParamKeys as Record<string, string>).find(([, path]) => path.endsWith(suffix));
  return key ? params[key[0]] : undefined;
};
const roundtrip = (T: any, bytes: Uint8Array, size: number, name: string): any => {
  const r = T.validate(bytes);
  check(r.ok && r.consumed === size, `${name} validates as ${size} (got ${r.code} ${r.consumed})`);
  check(!T.validate(bytes.subarray(0, size - 1)).ok, `${name} short buffer`);
  const view = T.from_array(bytes);
  check(view !== null, `${name} from_array`);
  check(T.footprintFromParams(view.dynamicParams()) === size, `${name} params footprint`);
  return view;
};

/* child: n=2, bytes, count=3; items: 3 x u16; tail */
const buf = u8(2, 0xa, 0xb, 3, 1, 0, 2, 0, 0x34, 0x12, 0x99);
const nc = roundtrip(NestedCount, buf, 11, "NestedCount");
check(param(NestedCount, nc.dynamicParams(), "child.count") === 3n, "NestedCount child.count param");
check(nc.get_items_at(2) === 0x1234 && nc.get_items().length === 3 && nc.get_tail() === 0x99, "NestedCount getters");

const named = roundtrip(NamedCount, u8(1, 0xa, 3, 7, 8, 9, 0x99), 7, "NamedCount");
check(named.get_items_at(2) === 9 && named.get_tail() === 0x99, "NamedCount getters");
check(CountChild.validate(u8(1, 0xa, 3, 7)).consumed === 3, "CountChild");

const deep = roundtrip(DeepCount, u8(0x55, 1, 0xf0, 1, 0xf1, 2, 0xc0, 0xc1), 8, "DeepCount");
check(deep.get_items_at(1) === 0xc1, "DeepCount getters");

const imported = roundtrip(ImportedCount, buf, 11, "ImportedCount");
check(imported.get_items_at(2) === 0x1234 && imported.get_tail() === 0x99, "ImportedCount getters");
const wrapped = roundtrip(WrappedImportedCount, u8(1, 0xf0, 1, 0xf1, 2, 0xc0, 0xc1), 7, "WrappedImportedCount");
check(wrapped.get_items_at(1) === 0xc1, "WrappedImportedCount getters");
console.log("nested count ok");
"#,
    );
}

/* The top-level ABI of the C and Rust tests: an enum whose tag lives in its
 * container, a struct holding it, a size-discriminated union and a union. */
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

/* A top-level enum's tag is supplied by its container: views take it as
 * params, validation rejects unknown tags, the enum and its holder size
 * from params, and `new_<variant>` / `newVariant` build values. */
#[test]
fn test_ts_top_level_enum() {
    let test_dir = setup_test_dir("top_level_enum");
    if !generate_checked_ts(&test_dir, "top", TOP_LEVEL_ABI, "test.top_level") {
        return;
    }
    run_ts_script(
        &test_dir,
        "top_enum_test",
        r#"
import { TopEnum, Holder, TopUnion } from "./test/top_level/types.js";

const check = (cond: boolean, what: string): void => {
  if (!cond) throw new Error(`check failed: ${what}`);
};
const throws = (fn: () => unknown): boolean => {
  try { fn(); return false; } catch { return true; }
};
const u8 = (...xs: number[]) => Uint8Array.from(xs);
const kind = (k: number) => TopEnum.Params.fromValues({ TopEnum_kind: k });

check(TopEnum.validate(u8(1), { params: kind(0) }).consumed === 1, "A is 1 byte");
check(TopEnum.validate(u8(1, 2), { params: kind(7) }).consumed === 2, "B is 2 bytes");
check(!TopEnum.validate(u8(1), { params: kind(7) }).ok, "B needs 2 bytes");
check(!TopEnum.validate(u8(1, 2), { params: kind(3) }).ok, "tag 3 is unknown");
check(!TopEnum.validate(u8(1, 2)).ok, "the tag is required");
check(TopEnum.from_array(u8(5)) === null, "from_array needs the tag");
const b = TopEnum.from_array(u8(0x34, 0x12, 0xee), { params: kind(7) })!;
check(b.variant()!.name === "B" && b.tag() === 7 && b.bytes().length === 2, "variant B");
check(b.asB()!.get_x() === 0x1234 && b.asA() === null, "asB");
check(TopEnum.from_array(u8(9), { params: kind(0) })!.asA() === 9, "asA");
check(b.dynamicParams().TopEnum_kind === 7n, "dynamicParams is the tag");
check(TopEnum.footprintFromParams(kind(0)) === 1 && TopEnum.footprintFromParams(kind(7)) === 2, "footprint");
check(throws(() => TopEnum.footprintFromParams(kind(3))), "footprint of an unknown tag");
check(TopEnum.variantDescriptors.length === 2 && TopEnum.variantByName("B")!.tag === 7, "descriptors");
check(TopEnum.variantByTag(0)!.name === "A" && TopEnum.variantByTag(1) === null, "variantByTag");
const na = TopEnum.new_A(9);
check(na.bytes().join() === "9" && na.dynamicParams().TopEnum_kind === 0n, "new_A");
const nb = TopEnum.new_B(u8(1, 2));
check(nb.asB()!.get_x() === 0x0201 && nb.dynamicParams().TopEnum_kind === 7n, "new_B");
check(throws(() => TopEnum.newVariant("B", u8(1))), "newVariant checks the payload");

for (const [bytes, size] of [[u8(7, 0x34, 0x12), 3], [u8(0, 5), 2]] as const) {
  const r = Holder.validate(bytes);
  check(r.ok && r.consumed === size, `Holder ${bytes.join()} is ${size}`);
  const h = Holder.from_array(bytes)!;
  check(Holder.footprintFromParams(h.dynamicParams()) === size, "Holder params footprint");
}
check(!Holder.validate(u8(3, 1, 2)).ok && !Holder.validate(u8(7, 1)).ok, "Holder rejects");
const h = Holder.from_array(u8(7, 0x34, 0x12))!;
check(h.get_kind() === 7 && h.get_value().asB()!.get_x() === 0x1234, "Holder value");

const u = TopUnion.from_array(u8(1, 2, 3, 4))!;
check(u.get_word() === 0x04030201 && u.get_bytes().join() === "1,2,3,4", "TopUnion getters");
console.log("top-level enum ok");
"#,
    );
}

/* Generate one fixture under `<test_dir>/<name>` and type-check it; false
 * when the vendored toolchain is missing (and not required). */
fn generate_fixture_checked(test_dir: &PathBuf, name: &str, package: &str) -> bool {
    let out = test_dir.join(name);
    generate_ts_code(&format!("tests/compliance_data/{name}.abi.yaml"), &out)
        .expect("Code generation failed");
    let ts_file = out.join(package.replace('.', "/")).join("types.ts");
    assert!(ts_file.exists(), "generated {} missing", ts_file.display());
    if !ensure_tsc_available() {
        return false;
    }
    check_typescript_compilation(&ts_file).expect("generated TypeScript must type-check");
    true
}

/* A union is valid only when every variant validates over its bytes, so an
 * enum tag inside a fixed-size union variant is checked wherever the union
 * is nested (struct field, type-ref, array element, top level), as in C and
 * Rust. Also: an array sized by a child's count after variable-size data. */
#[test]
fn test_ts_nested_union_tags_and_refs() {
    let test_dir = setup_test_dir("nested_union_tags");
    if !generate_fixture_checked(
        &test_dir,
        "nested_union_tags",
        "compliance.nested_union_tags",
    ) || !generate_fixture_checked(
        &test_dir,
        "nested_union_validation",
        "test.nested_union_validation",
    ) || !generate_fixture_checked(
        &test_dir,
        "nested_ref_after_variable",
        "compliance.nested_ref_after_variable",
    ) {
        return;
    }
    run_ts_script(
        &test_dir,
        "nested_union_tags_test",
        r#"
import { UnionHolder, ChoiceList, TaggedChoice } from "./nested_union_tags/compliance/nested_union_tags/types.js";
import { Holder, Choice, InlineChoice } from "./nested_union_validation/test/nested_union_validation/types.js";
import { RefOuter, InlineOuter } from "./nested_ref_after_variable/compliance/nested_ref_after_variable/types.js";

const check = (cond: boolean, what: string): void => {
  if (!cond) throw new Error(`check failed: ${what}`);
};
const u8 = (...xs: number[]) => Uint8Array.from(xs);

const buf = u8(9, 1, 7, 3);
check(UnionHolder.validate(buf).ok && UnionHolder.validate(buf).consumed === 4, "UnionHolder tag 1");
buf[1] = 2;
check(UnionHolder.validate(buf).ok, "UnionHolder tag 2");
for (const bad of [5, 0]) {
  buf[1] = bad;
  check(!UnionHolder.validate(buf).ok && UnionHolder.from_array(buf) === null, `UnionHolder tag ${bad}`);
}
check(!UnionHolder.validate(u8(9, 1, 7)).ok, "UnionHolder short");
check(UnionHolder.footprint() === 4, "UnionHolder footprint");

const list = u8(1, 7, 2, 8);
check(ChoiceList.validate(list).consumed === 4, "ChoiceList");
check(TaggedChoice.validate(list.subarray(0, 2)).consumed === 2, "TaggedChoice");
list[2] = 6;
check(!ChoiceList.validate(list).ok && !TaggedChoice.validate(list.subarray(2)).ok, "ChoiceList bad tag");

const good = u8(7, 1, 4, 3, 2, 1, 2, 9, 0, 0);
check(Holder.validate(good).consumed === 10, "Holder");
check(Choice.validate(good.subarray(1, 6)).consumed === 5, "Choice");
check(InlineChoice.validate(good.subarray(6)).consumed === 4, "InlineChoice");
const bad1 = u8(...good); bad1[1] = 9;
check(!Choice.validate(bad1.subarray(1, 6)).ok && !Holder.validate(bad1).ok && Holder.from_array(bad1) === null, "type-ref variant tag");
const bad2 = u8(...good); bad2[6] = 0;
check(!InlineChoice.validate(bad2.subarray(6)).ok && !Holder.validate(bad2).ok, "inline variant tag");

/* lead, child (n = 3, bytes, count = 2), items [0x0201, 0x0403], tail */
const ref = u8(9, 3, 0xa, 0xb, 0xc, 2, 1, 2, 3, 4, 0xee);
check(RefOuter.validate(ref).consumed === 11 && !RefOuter.validate(ref.subarray(0, 10)).ok, "RefOuter");
const r = RefOuter.from_array(ref)!;
check(r.get_lead() === 9 && r.get_items_at(1) === 0x0403 && r.get_tail() === 0xee, "RefOuter getters");
check(RefOuter.footprintFromParams(r.dynamicParams()) === 11, "RefOuter params footprint");
const one = u8(...ref); one[5] = 1;
check(RefOuter.validate(one).consumed === 9 && RefOuter.from_array(one)!.get_tail() === 3, "RefOuter count 1");
const inner = ref.subarray(1);
check(InlineOuter.validate(inner).consumed === 10 && !InlineOuter.validate(inner.subarray(0, 9)).ok, "InlineOuter");
const io = InlineOuter.from_array(inner)!;
check(io.get_items_at(1) === 0x0403 && io.get_tail() === 0xee, "InlineOuter getters");
check(InlineOuter.footprintFromParams(io.dynamicParams()) === 10, "InlineOuter params footprint");
console.log("nested union tags ok");
"#,
    );
}

/* Inline enums as array elements (one stride selected by an outside tag,
 * jagged or not), as another enum's payload, inside jagged element structs,
 * and zero-byte elements counted up to 2^64-1 (which must not be walked one
 * by one): the bytes C and Rust accept and reject, and exact params
 * footprints. */
#[test]
fn test_ts_inline_enum_elements_and_payloads() {
    let test_dir = setup_test_dir("inline_enum_elements");
    if !generate_fixture_checked(&test_dir, "enum_nesting", "compliance.enum_nesting")
        || !generate_fixture_checked(
            &test_dir,
            "nested_inline_enums",
            "compliance.nested_inline_enums",
        )
        || !generate_fixture_checked(
            &test_dir,
            "zero_size_elements",
            "compliance.zero_size_elements",
        )
    {
        return;
    }
    run_ts_script(
        &test_dir,
        "inline_enum_elements_test",
        r#"
import { EnumList, EnumInEnum } from "./enum_nesting/compliance/enum_nesting/types.js";
import { EnumArrayHolder, EnumPayloadHolder, TaggedElemHolder } from "./nested_inline_enums/compliance/nested_inline_enums/types.js";
import { EmptyEnumList, JaggedEmptyList, StrideEmptyList } from "./zero_size_elements/compliance/zero_size_elements/types.js";

const check = (cond: boolean, what: string): void => {
  if (!cond) throw new Error(`check failed: ${what}`);
};
const u8 = (...xs: number[]) => Uint8Array.from(xs);
const accepts = (T: any, bytes: Uint8Array, size: number, name: string): void => {
  const r = T.validate(bytes);
  check(r.ok && r.consumed === size, `${name} validates as ${size} (got ${r.code} ${r.consumed})`);
  const view = T.from_array(bytes);
  check(view !== null, `${name} from_array`);
  check(T.footprintFromParams(view.dynamicParams()) === size, `${name} params footprint`);
};
const rejects = (T: any, bytes: Uint8Array, name: string): void => {
  check(!T.validate(bytes).ok && T.from_array(bytes) === null, `${name} is rejected`);
};

const wide = u8(1, 2, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99);
accepts(EnumList, wide, 11, "EnumList wide");
check(EnumList.from_array(wide)!.get_trail() === 0x99, "EnumList trail");
accepts(EnumList, u8(0, 3, 0xa, 0xb, 0xc, 0x99), 6, "EnumList small");
rejects(EnumList, u8(2, 1, 0, 0x99), "EnumList unknown tag");
accepts(EnumList, u8(2, 0, 0x99), 3, "EnumList no elements");
rejects(EnumList, wide.subarray(0, 10), "EnumList short");
check(EnumList.footprintFromParams(EnumList.Params.fromValues({ items_kind: 1, items_count: 3 })) === 15, "EnumList footprint");
accepts(EnumInEnum, u8(1, 1, 1, 2, 3, 4, 5, 6, 7, 8, 0xee), 11, "EnumInEnum quad");
accepts(EnumInEnum, u8(1, 0, 0x5a, 0x77), 4, "EnumInEnum byte");
accepts(EnumInEnum, u8(0, 9, 1, 2, 0xee), 5, "EnumInEnum plain");
rejects(EnumInEnum, u8(1, 1, 1, 2), "EnumInEnum short");

accepts(EnumArrayHolder, u8(1, 2, 1, 0, 0, 0, 2, 0, 0, 0, 9), 11, "EnumArrayHolder wide");
accepts(EnumArrayHolder, u8(0, 3, 5, 6, 7, 9), 6, "EnumArrayHolder small");
rejects(EnumArrayHolder, u8(2, 1, 0, 0), "EnumArrayHolder unknown tag");
rejects(EnumArrayHolder, u8(1, 2, 1, 0, 0, 0, 2), "EnumArrayHolder short");
check(EnumArrayHolder.footprintFromParams(EnumArrayHolder.Params.fromValues({ items_kind: 0, items_count: 3 })) === 6, "EnumArrayHolder footprint");
const quad = u8(0, 1, 8, 7, 6, 5, 4, 3, 2, 1, 0xee);
accepts(EnumPayloadHolder, quad, 11, "EnumPayloadHolder quad");
check(EnumPayloadHolder.from_array(quad)!.get_tail() === 0xee, "EnumPayloadHolder tail");
accepts(EnumPayloadHolder, u8(0, 0, 7, 0xee), 4, "EnumPayloadHolder byte");
accepts(EnumPayloadHolder, u8(1, 9, 1, 2, 0xee), 5, "EnumPayloadHolder plain");
rejects(EnumPayloadHolder, u8(0, 9, 1, 2, 0xee), "EnumPayloadHolder unknown inner tag");
accepts(TaggedElemHolder, u8(2, 0, 7, 1, 1, 0, 2, 0), 8, "TaggedElemHolder");
rejects(TaggedElemHolder, u8(2, 0, 7, 1, 1, 0, 2), "TaggedElemHolder short");
rejects(TaggedElemHolder, u8(2, 0, 7, 2, 1, 0, 2, 0), "TaggedElemHolder unknown tag");

const started = Date.now();
const huge = u8(0, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff);
for (const [T, name] of [[EmptyEnumList, "EmptyEnumList"], [JaggedEmptyList, "JaggedEmptyList"], [StrideEmptyList, "StrideEmptyList"]] as const) {
  accepts(T, huge, 9, `${name} 2^64-1 zero-byte elements`);
  const bad = u8(...huge); bad[0] = 2;
  rejects(T, bad, `${name} unknown tag`);
}
check(JaggedEmptyList.footprintFromParams(JaggedEmptyList.Params.fromValues({ items_tag: 0, items_count: 0xffffffffffffffffn })) === 9, "JaggedEmptyList footprint");
accepts(JaggedEmptyList, u8(1, 2, 0, 0, 0, 0, 0, 0, 0, 7, 8), 11, "JaggedEmptyList bytes");
const short = u8(...huge); short[0] = 1;
rejects(JaggedEmptyList, short, "JaggedEmptyList runs out of bytes");
accepts(StrideEmptyList, u8(1, 3, 0, 0, 0, 0, 0, 0, 0, 7, 8, 9), 12, "StrideEmptyList bytes");
check(Date.now() - started < 5000, "zero-byte elements are not walked one by one");
console.log("inline enum elements ok");
"#,
    );
}

/* Fixtures the CLI rejects for every language (alignment past 1 at top level,
 * or layouts the analysis refuses); asserted to stay rejected. */
const CLI_REJECTED_FIXTURES: &[&str] = &[
    "shared_count",
    "top_level_array_layouts",
    "trailing_padding",
    "trailing_padding_c",
];

/* Every ABI fixture (compliance definitions, compliance data and the
 * cross-package pair) generates TypeScript that type-checks, so no fixture
 * is silently unsupported by the TypeScript backend. */
#[test]
fn test_ts_every_fixture_generates_and_type_checks() {
    let test_dir = setup_test_dir("every_fixture");
    let mut abis: Vec<(PathBuf, Vec<&str>)> = Vec::new();
    for dir in [
        "tests/compliance_tests/abi_definitions",
        "tests/compliance_data",
    ] {
        let mut entries: Vec<PathBuf> = fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().path())
            .filter(|p| p.to_string_lossy().ends_with(".abi.yaml"))
            .collect();
        entries.sort();
        for path in entries {
            let stem = path
                .file_name()
                .unwrap()
                .to_string_lossy()
                .trim_end_matches(".abi.yaml")
                .to_string();
            if CLI_REJECTED_FIXTURES.contains(&stem.as_str()) {
                let out = test_dir.join(format!("rejected_{stem}"));
                assert!(
                    generate_ts_code(path.to_str().unwrap(), &out).is_err(),
                    "{stem} is listed as rejected by the CLI but now generates: test it"
                );
                continue;
            }
            abis.push((path, Vec::new()));
        }
    }
    abis.push((
        PathBuf::from("tests/cross_package/count_child.abi.yaml"),
        Vec::new(),
    ));
    abis.push((
        PathBuf::from("tests/cross_package/count_user.abi.yaml"),
        vec!["rpc/abi/abi_gen/tests/cross_package"],
    ));
    assert!(abis.len() > 40, "fixture directories went missing");
    if !ensure_tsc_available() {
        return;
    }
    let mut failures = Vec::new();
    for (idx, (abi, includes)) in abis.iter().enumerate() {
        let out = test_dir.join(format!("g{idx}"));
        if let Err(err) = generate_ts_code_with_includes(abi.to_str().unwrap(), includes, &out) {
            failures.push(format!("{}: {}", abi.display(), err));
            continue;
        }
        let mut sources = Vec::new();
        let mut stack = vec![out.clone()];
        while let Some(dir) = stack.pop() {
            for entry in fs::read_dir(&dir).unwrap() {
                let path = entry.unwrap().path();
                if path.is_dir() {
                    stack.push(path);
                } else if path.file_name().map_or(false, |n| n == "types.ts") {
                    sources.push(path);
                }
            }
        }
        if sources.is_empty() {
            failures.push(format!("{}: no types.ts generated", abi.display()));
        }
        for source in sources {
            if let Err(err) = check_typescript_compilation(&source) {
                failures.push(format!("{}: {}", abi.display(), err));
            }
        }
    }
    assert!(
        failures.is_empty(),
        "{} fixtures fail:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

/* The validating walk reads floats as numbers: a fractional f32 next to an
 * enum must not make `validate()` throw (`BigInt(1.5)`). */
#[test]
fn test_ts_tag_walk_reads_floats() {
    let test_dir = setup_test_dir("tag_walk_floats");
    let abi = r#"
abi:
  package: "test.float_walk"
  abi-version: 1
  package-version: "1.0.0"
  description: "A float before an enum the validating walk checks"
types:
  - name: "FloatTagged"
    kind:
      struct:
        packed: true
        fields:
          - name: "ratio"
            field-type:
              primitive: f32
          - name: "kind"
            field-type:
              primitive: u8
          - name: "body"
            field-type:
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
                    tag-value: 1
                    variant-type:
                      struct:
                        packed: true
                        fields:
                          - name: "w"
                            field-type:
                              primitive: u16
"#;
    if !generate_checked_ts(&test_dir, "float_walk", abi, "test.float_walk") {
        return;
    }
    run_ts_script(
        &test_dir,
        "float_walk_test",
        r#"
import { FloatTagged } from "./test/float_walk/types.js";

const check = (cond: boolean, what: string): void => {
  if (!cond) throw new Error(`check failed: ${what}`);
};
/* ratio = 1.5f */
const a = Uint8Array.from([0, 0, 0xc0, 0x3f, 0, 7]);
check(FloatTagged.validate(a).ok && FloatTagged.validate(a).consumed === 6, "fractional float, variant A");
check(FloatTagged.from_array(a)!.get_ratio() === 1.5, "ratio");
const b = Uint8Array.from([0, 0, 0xc0, 0x3f, 1, 1, 2]);
check(FloatTagged.validate(b).consumed === 7, "fractional float, variant B");
check(!FloatTagged.validate(Uint8Array.from([0, 0, 0xc0, 0x3f, 2, 7])).ok, "unknown tag");
console.log("float walk ok");
"#,
    );
}

/* `["..", "count"]` in a measured value names the enclosing struct's field
 * even when the inner struct has its own `count` (union variants here are
 * sized by the measuring walk), as in the parent_scope fixtures. */
#[test]
fn test_ts_measure_parent_scope_refs() {
    let test_dir = setup_test_dir("measure_parent_scope");
    let abi = r#"
abi:
  package: "test.scoped_union"
  abi-version: 1
  package-version: "1.0.0"
  description: "A union variant sizing an inner array by the outer count"
types:
  - name: "ScopedUnion"
    kind:
      union:
        packed: true
        variants:
          - name: "word"
            variant-type:
              primitive: u32
          - name: "scoped"
            variant-type:
              struct:
                packed: true
                fields:
                  - name: "count"
                    field-type:
                      primitive: u8
                  - name: "inner"
                    field-type:
                      struct:
                        packed: true
                        fields:
                          - name: "count"
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
"#;
    if !generate_checked_ts(&test_dir, "scoped_union", abi, "test.scoped_union") {
        return;
    }
    let fixtures = test_dir.join("fixtures");
    for name in ["parent_scope_count", "parent_scope_refs"] {
        if !generate_fixture_checked(
            &fixtures,
            name,
            &format!("test.{name}")
                .replace("test.parent_scope_refs", "compliance.parent_scope_refs"),
        ) {
            return;
        }
    }
    run_ts_script(
        &test_dir,
        "measure_parent_scope_test",
        r#"
import { ScopedUnion } from "./test/scoped_union/types.js";
import { Outer } from "./fixtures/parent_scope_count/test/parent_scope_count/types.js";
import { ScopedCount } from "./fixtures/parent_scope_refs/compliance/parent_scope_refs/types.js";

const check = (cond: boolean, what: string): void => {
  if (!cond) throw new Error(`check failed: ${what}`);
};
const u8 = (...xs: number[]) => Uint8Array.from(xs);
/* outer count 2, inner count 9: two items, so `scoped` is 4 bytes. */
check(ScopedUnion.validate(u8(2, 9, 0xa, 0xb)).consumed === 4, "outer count sizes the items");
check(ScopedUnion.validate(u8(3, 0, 0xa, 0xb, 0xc)).consumed === 5, "scoped spans 5");
check(ScopedUnion.validate(u8(1, 9, 0xa, 0xb)).consumed === 4, "word spans 4");
check(!ScopedUnion.validate(u8(5, 0, 0xa, 0xb)).ok, "scoped needs 7 bytes");
check(Outer.validate(u8(2, 5, 0xaa, 0xbb, 0x77)).consumed === 5, "Outer");
check(ScopedCount.validate(u8(1, 2, 0xa, 0xb, 0xc)).consumed === 5, "ScopedCount");
console.log("parent scope ok");
"#,
    );
}

/* A constant-size enum payload that is itself an enum: its tag is checked
 * too (`inner` 5 is not declared), as C and Rust do. */
#[test]
fn test_ts_tag_walk_checks_constant_enum_payloads() {
    let test_dir = setup_test_dir("constant_enum_payload_tags");
    let abi = r#"abi:
  package: "test.nested_tag"
  abi-version: 1
  package-version: "1.0.0"
  description: "A constant-size enum payload that is itself an enum"
types:
  - name: "NestedTagHolder"
    kind:
      struct:
        packed: true
        fields:
          - name: "outer"
            field-type:
              primitive: u8
          - name: "inner"
            field-type:
              primitive: u8
          - name: "body"
            field-type:
              enum:
                packed: true
                tag-ref:
                  field-ref:
                    path: ["outer"]
                variants:
                  - name: "X"
                    tag-value: 0
                    variant-type:
                      enum:
                        packed: true
                        tag-ref:
                          field-ref:
                            path: ["inner"]
                        variants:
                          - name: "p"
                            tag-value: 0
                            variant-type:
                              primitive: u8
                          - name: "q"
                            tag-value: 1
                            variant-type:
                              primitive: u8
                  - name: "Y"
                    tag-value: 1
                    variant-type:
                      primitive: u8
"#;
    if !generate_checked_ts(&test_dir, "nested_tag", abi, "test.nested_tag") {
        return;
    }
    run_ts_script(
        &test_dir,
        "nested_tag_test",
        r#"
import { NestedTagHolder } from "./test/nested_tag/types.js";

const check = (cond: boolean, what: string): void => {
  if (!cond) throw new Error(`check failed: ${what}`);
};
const u8 = (...xs: number[]) => Uint8Array.from(xs);
check(NestedTagHolder.validate(u8(0, 1, 7)).consumed === 3, "X.q");
check(NestedTagHolder.validate(u8(1, 5, 7)).consumed === 3, "Y ignores inner");
check(!NestedTagHolder.validate(u8(0, 5, 7)).ok, "X with undeclared inner tag");
check(NestedTagHolder.from_array(u8(0, 5, 7)) === null, "from_array rejects it");
check(!NestedTagHolder.validate(u8(2, 0, 7)).ok, "undeclared outer tag");
console.log("constant enum payload tags ok");
"#,
    );
}

/* A size-discriminated union validates its selected payload too: the
 * 2-byte variant `{ tag, body: enum by tag }` rejects an undeclared tag,
 * top level and as a struct field. */
#[test]
fn test_ts_sdu_validates_selected_payload() {
    let test_dir = setup_test_dir("sdu_payload_tags");
    let abi = r#"abi:
  package: "test.sdu_tag"
  abi-version: 1
  package-version: "1.0.0"
  description: "Size-discriminated unions whose selected payload holds an enum tag"
types:
  - name: "TaggedSdu"
    kind:
      size-discriminated-union:
        packed: true
        variants:
          - name: "small"
            expected-size: 1
            variant-type:
              primitive: u8
          - name: "tagged"
            expected-size: 2
            variant-type:
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
                          - name: "A"
                            tag-value: 0
                            variant-type:
                              primitive: u8
                          - name: "B"
                            tag-value: 1
                            variant-type:
                              primitive: u8
  - name: "SduHolder"
    kind:
      struct:
        packed: true
        fields:
          - name: "lead"
            field-type:
              primitive: u8
          - name: "data"
            field-type:
              size-discriminated-union:
                packed: true
                variants:
                  - name: "small"
                    expected-size: 1
                    variant-type:
                      primitive: u8
                  - name: "tagged"
                    expected-size: 2
                    variant-type:
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
                                  - name: "A"
                                    tag-value: 0
                                    variant-type:
                                      primitive: u8
                                  - name: "B"
                                    tag-value: 1
                                    variant-type:
                                      primitive: u8
"#;
    if !generate_checked_ts(&test_dir, "sdu_tag", abi, "test.sdu_tag") {
        return;
    }
    run_ts_script(
        &test_dir,
        "sdu_tag_test",
        r#"
import { TaggedSdu, SduHolder } from "./test/sdu_tag/types.js";

const check = (cond: boolean, what: string): void => {
  if (!cond) throw new Error(`check failed: ${what}`);
};
const u8 = (...xs: number[]) => Uint8Array.from(xs);
check(TaggedSdu.validate(u8(1, 0)).consumed === 2 && TaggedSdu.validate(u8(9)).consumed === 1, "TaggedSdu valid");
check(!TaggedSdu.validate(u8(255, 0)).ok && TaggedSdu.from_array(u8(255, 0)) === null, "TaggedSdu undeclared tag");
check(TaggedSdu.from_array(u8(1, 0))!.asTagged() !== null, "asTagged");
check(SduHolder.validate(u8(9, 1, 0)).consumed === 3 && SduHolder.validate(u8(9, 7)).consumed === 2, "SduHolder valid");
check(!SduHolder.validate(u8(9, 255, 0)).ok && SduHolder.from_array(u8(9, 255, 0)) === null, "SduHolder undeclared tag");
console.log("sdu payload tags ok");
"#,
    );
}

/* Measuring untrusted bytes never builds values proportional to them: a
 * nested `{ shift: u64, bytes: u8[1 << shift] }` with shift = 200000000 in
 * an 8-byte buffer is rejected at once (shift counts past 63 overflow, as
 * `__tnCheckedShift` and C/Rust treat them) instead of allocating. */
#[test]
fn test_ts_measure_rejects_huge_shifts_without_allocating() {
    let test_dir = setup_test_dir("measure_huge_shift");
    let abi = r#"abi:
  package: "test.shift_size"
  abi-version: 1
  package-version: "1.0.0"
  description: "A nested array sized by a shift of an untrusted count"
types:
  - name: "ShiftHolder"
    kind:
      struct:
        packed: true
        fields:
          - name: "inner"
            field-type:
              struct:
                packed: true
                fields:
                  - name: "shift"
                    field-type:
                      primitive: u64
                  - name: "bytes"
                    field-type:
                      array:
                        size:
                          left-shift:
                            left:
                              literal:
                                u64: 1
                            right:
                              field-ref:
                                path: ["shift"]
                        element-type:
                          primitive: u8
          - name: "tail"
            field-type:
              primitive: u8
"#;
    if !generate_checked_ts(&test_dir, "shift_size", abi, "test.shift_size") {
        return;
    }
    run_ts_script(
        &test_dir,
        "huge_shift_test",
        r#"
import { ShiftHolder } from "./test/shift_size/types.js";

const check = (cond: boolean, what: string): void => {
  if (!cond) throw new Error(`check failed: ${what}`);
};
const proc = (globalThis as any).process;
const u64 = (n: bigint): number[] => Array.from({ length: 8 }, (_, i) => Number((n >> BigInt(8 * i)) & 0xffn));
const ok = Uint8Array.from([...u64(2n), 1, 2, 3, 4, 9]);
check(ShiftHolder.validate(ok).consumed === 13, "shift 2: four bytes");
check(ShiftHolder.footprintFromParams(ShiftHolder.from_array(ok)!.dynamicParams()) === 13, "params footprint");
for (const shift of [64n, 200000000n, 0xffffffffffffffffn]) {
  const bad = Uint8Array.from(u64(shift));
  proc.memoryUsage();
  const before = proc.memoryUsage().heapUsed + proc.memoryUsage().arrayBuffers;
  const started = Date.now();
  const result = ShiftHolder.validate(bad);
  const grown = proc.memoryUsage().heapUsed + proc.memoryUsage().arrayBuffers - before;
  check(!result.ok && ShiftHolder.from_array(bad) === null, `shift ${shift} is rejected`);
  check(Date.now() - started < 1000, `shift ${shift} is rejected at once`);
  check(grown < 4 * 1024 * 1024, `shift ${shift} allocated ${grown} bytes`);
}
console.log("huge shift ok");
"#,
    );
}

/* The measuring walk aligns a struct's fields relative to that struct's
 * start and only when it is not packed: a packed SDU variant
 * `{ lead: u8, child: { value: u32 } }` (child not packed) holds `value` at
 * byte 1, so the 5-byte value validates. */
#[test]
fn test_ts_measure_aligns_relative_to_struct_start() {
    let test_dir = setup_test_dir("measure_relative_alignment");
    let abi = r#"abi:
  package: "test.unpacked_child"
  abi-version: 1
  package-version: "1.0.0"
  description: "A packed SDU variant holding an unpacked child struct at an odd offset"
types:
  - name: "ChildSdu"
    kind:
      size-discriminated-union:
        packed: true
        variants:
          - name: "small"
            expected-size: 1
            variant-type:
              primitive: u8
          - name: "wrapped"
            expected-size: 5
            variant-type:
              struct:
                packed: true
                fields:
                  - name: "lead"
                    field-type:
                      primitive: u8
                  - name: "child"
                    field-type:
                      struct:
                        fields:
                          - name: "value"
                            field-type:
                              primitive: u32
"#;
    if !generate_checked_ts(&test_dir, "unpacked_child", abi, "test.unpacked_child") {
        return;
    }
    run_ts_script(
        &test_dir,
        "relative_alignment_test",
        r#"
import { ChildSdu } from "./test/unpacked_child/types.js";

const check = (cond: boolean, what: string): void => {
  if (!cond) throw new Error(`check failed: ${what}`);
};
const bytes = Uint8Array.from([7, 0x44, 0x33, 0x22, 0x11]);
const r = ChildSdu.validate(bytes);
check(r.ok && r.consumed === 5, `5-byte variant validates (got ${r.code})`);
const v = ChildSdu.from_array(bytes);
check(v !== null && v.variant().name === "wrapped", "from_array");
check(v!.asWrapped()!.get_lead() === 7, "lead");
check(ChildSdu.validate(Uint8Array.from([7])).consumed === 1, "small");
console.log("relative alignment ok");
"#,
    );
}

/* Computed enum tags use checked u64 arithmetic wherever TypeScript
 * evaluates them (param extraction, view tag getters, params footprints):
 * `(hdr.x << hdr.shift) & 3` overflows when bits leave u64 or the shift is
 * 64 or more with x != 0, exactly where C and Rust reject, and a shift of
 * 200000000 never builds a huge bigint. */
#[test]
fn test_ts_computed_tags_use_checked_arithmetic() {
    let test_dir = setup_test_dir("computed_tag_shift");
    let abi = r#"abi:
  package: "test.shift_tag"
  abi-version: 1
  package-version: "1.0.0"
  description: "An enum whose computed tag shifts by an untrusted count"
types:
  - name: "ShiftTagged"
    kind:
      struct:
        packed: true
        fields:
          - name: "hdr"
            field-type:
              struct:
                packed: true
                fields:
                  - name: "x"
                    field-type:
                      primitive: u64
                  - name: "shift"
                    field-type:
                      primitive: u64
          - name: "body"
            field-type:
              enum:
                packed: true
                tag-ref:
                  bit-and:
                    left:
                      left-shift:
                        left:
                          field-ref:
                            path: ["hdr", "x"]
                        right:
                          field-ref:
                            path: ["hdr", "shift"]
                    right:
                      literal:
                        u64: 3
                variants:
                  - name: "Zero"
                    tag-value: 0
                    variant-type:
                      primitive: u8
                  - name: "One"
                    tag-value: 1
                    variant-type:
                      struct:
                        packed: true
                        fields:
                          - name: "w"
                            field-type:
                              primitive: u16
          - name: "tail"
            field-type:
              primitive: u8
"#;
    if !generate_checked_ts(&test_dir, "shift_tag", abi, "test.shift_tag") {
        return;
    }
    run_ts_script(
        &test_dir,
        "computed_tag_shift_test",
        r#"
import { ShiftTagged } from "./test/shift_tag/types.js";

const check = (cond: boolean, what: string): void => {
  if (!cond) throw new Error(`check failed: ${what}`);
};
const proc = (globalThis as any).process;
const u64 = (n: bigint): number[] => Array.from({ length: 8 }, (_, i) => Number((n >> BigInt(8 * i)) & 0xffn));
const value = (x: bigint, shift: bigint) => Uint8Array.from([...u64(x), ...u64(shift), 1, 2, 3]);
/* [x, shift, accepted size or null], as C and Rust validate them. */
const cases: [bigint, bigint, number | null][] = [
  [1n, 0n, 19], [0n, 0n, 18], [1n, 63n, 18], [1n, 33n, 18], [2n, 0n, null],
  [3n, 63n, null], [1n, 64n, null], [1n, 200000000n, null], [0n, 200000000n, 18],
];
for (const [x, shift, size] of cases) {
  const bytes = value(x, shift).subarray(0, size ?? 19);
  const before = proc.memoryUsage().heapUsed + proc.memoryUsage().arrayBuffers;
  const started = Date.now();
  const r = ShiftTagged.validate(bytes);
  const grown = proc.memoryUsage().heapUsed + proc.memoryUsage().arrayBuffers - before;
  check(Date.now() - started < 1000 && grown < 4 * 1024 * 1024, `x=${x} shift=${shift} is cheap (${grown} bytes)`);
  if (size === null) {
    check(!r.ok && ShiftTagged.from_array(bytes) === null, `x=${x} shift=${shift} is rejected`);
    continue;
  }
  check(r.ok && r.consumed === size, `x=${x} shift=${shift} validates as ${size} (got ${r.code} ${r.consumed})`);
  const view = ShiftTagged.from_array(bytes) as any;
  check(ShiftTagged.footprintFromParams(view.dynamicParams()) === size, `x=${x} shift=${shift} params footprint`);
  check(view.bodyVariant().name === (size === 19 ? "One" : "Zero"), `x=${x} shift=${shift} view variant`);
  check(view.get_tail() === (size === 19 ? 3 : 2), `x=${x} shift=${shift} tail`);
}
console.log("computed tag shift ok");
"#,
    );
}

/* A count read from a signed field can be negative: the measuring walk, the
 * extractor and the params footprint reject it (C and Rust do), instead of
 * moving the cursor back. */
#[test]
fn test_ts_negative_counts_are_rejected() {
    let test_dir = setup_test_dir("negative_counts");
    let abi = r#"abi:
  package: "test.neg_count"
  abi-version: 1
  package-version: "1.0.0"
  description: "Arrays counted by a signed field"
types:
  - name: "SignedUnion"
    kind:
      union:
        packed: true
        variants:
          - name: "raw"
            variant-type:
              primitive: u8
          - name: "sized"
            variant-type:
              struct:
                packed: true
                fields:
                  - name: "n"
                    field-type:
                      primitive: i8
                  - name: "data"
                    field-type:
                      array:
                        size:
                          field-ref:
                            path: ["n"]
                        element-type:
                          primitive: u8
  - name: "SignedCount"
    kind:
      struct:
        packed: true
        fields:
          - name: "n"
            field-type:
              primitive: i8
          - name: "data"
            field-type:
              array:
                size:
                  field-ref:
                    path: ["n"]
                element-type:
                  primitive: u8
          - name: "tail"
            field-type:
              primitive: u8
"#;
    if !generate_checked_ts(&test_dir, "neg_count", abi, "test.neg_count") {
        return;
    }
    run_ts_script(
        &test_dir,
        "negative_counts_test",
        r#"
import { SignedUnion, SignedCount } from "./test/neg_count/types.js";

const check = (cond: boolean, what: string): void => {
  if (!cond) throw new Error(`check failed: ${what}`);
};
const throws = (fn: () => unknown): boolean => {
  try { fn(); return false; } catch { return true; }
};
const u8 = (...xs: number[]) => Uint8Array.from(xs);
check(!SignedUnion.validate(u8(255)).ok && SignedUnion.from_array(u8(255)) === null, "SignedUnion n = -1");
check(!SignedUnion.validate(u8(128, 1, 2)).ok, "SignedUnion n = -128");
check(SignedUnion.validate(u8(2, 7, 8)).consumed === 3, "SignedUnion n = 2");
check(!SignedCount.validate(u8(255, 7, 9)).ok && SignedCount.from_array(u8(255, 7, 9)) === null, "SignedCount n = -1");
const ok = SignedCount.from_array(u8(2, 7, 8, 9))!;
check(SignedCount.validate(u8(2, 7, 8, 9)).consumed === 4 && ok.get_tail() === 9, "SignedCount n = 2");
check(SignedCount.footprintFromParams(ok.dynamicParams()) === 4, "params footprint");
const negative = (SignedCount.Params as any).fromValues(Object.fromEntries(Object.keys(SignedCount.ParamKeys).map((k) => [k, -1])));
check(throws(() => SignedCount.footprintFromParams(negative)), "a negative count does not size anything");
console.log("negative counts ok");
"#,
    );
}

/* `&&` and `||` short-circuit in checked expressions: the right side is not
 * evaluated when the left decides, so `(n != 0) && (4 / n)` with n = 0 is an
 * empty array (as the generated Rust evaluates it), not a division error. */
#[test]
fn test_ts_logical_operators_short_circuit() {
    let test_dir = setup_test_dir("logical_short_circuit");
    let abi = r#"abi:
  package: "test.guarded_div"
  abi-version: 1
  package-version: "1.0.0"
  description: "Union variant counts guarded by short-circuit && and ||"
types:
  - name: "GuardedAnd"
    kind:
      union:
        packed: true
        variants:
          - name: "raw"
            variant-type:
              primitive: u8
          - name: "guarded"
            variant-type:
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
                          and:
                            left:
                              ne:
                                left:
                                  field-ref:
                                    path: ["n"]
                                right:
                                  literal:
                                    u8: 0
                            right:
                              div:
                                left:
                                  literal:
                                    u8: 4
                                right:
                                  field-ref:
                                    path: ["n"]
                        element-type:
                          primitive: u8
  - name: "GuardedOr"
    kind:
      union:
        packed: true
        variants:
          - name: "raw"
            variant-type:
              primitive: u8
          - name: "guarded"
            variant-type:
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
                          or:
                            left:
                              eq:
                                left:
                                  field-ref:
                                    path: ["n"]
                                right:
                                  literal:
                                    u8: 0
                            right:
                              div:
                                left:
                                  literal:
                                    u8: 4
                                right:
                                  field-ref:
                                    path: ["n"]
                        element-type:
                          primitive: u8
"#;
    if !generate_checked_ts(&test_dir, "guarded_div", abi, "test.guarded_div") {
        return;
    }
    run_ts_script(
        &test_dir,
        "logical_short_circuit_test",
        r#"
import { GuardedAnd, GuardedOr } from "./test/guarded_div/types.js";

const check = (cond: boolean, what: string): void => {
  if (!cond) throw new Error(`check failed: ${what}`);
};
const u8 = (...xs: number[]) => Uint8Array.from(xs);
check(GuardedAnd.validate(u8(0)).consumed === 1, "&&: n = 0 is an empty array");
check(GuardedAnd.validate(u8(2, 9)).consumed === 2, "&&: n = 2 is one byte");
check(GuardedAnd.validate(u8(5)).consumed === 1, "&&: n = 5 (4 / 5 = 0) is empty");
check(GuardedOr.validate(u8(0, 9)).consumed === 2, "||: n = 0 is one byte");
check(GuardedOr.validate(u8(5)).consumed === 1, "||: n = 5 is empty");
check(!GuardedOr.validate(u8(0)).ok, "||: n = 0 needs its byte");
console.log("short circuit ok");
"#,
    );
}

/* The guarded-division ABI of `test_c_short_circuit_guards_division`:
 * unions, a struct and an enum tag sized by `(n != 0) && (4 / n)` or
 * `(n == 0) || (4 / n)`. */
const GUARDED_DIV_ABI: &str = r#"
abi:
  package: "test.guarded_div"
  abi-version: 1
  package-version: "1.0.0"
  description: "Sizes and tags guarded by short-circuit && and ||"
types:
  - name: "GuardedAnd"
    kind:
      union:
        packed: true
        variants:
          - name: "raw"
            variant-type:
              primitive: u8
          - name: "guarded"
            variant-type:
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
                          and:
                            left:
                              ne:
                                left:
                                  field-ref:
                                    path: ["n"]
                                right:
                                  literal:
                                    u8: 0
                            right:
                              div:
                                left:
                                  literal:
                                    u8: 4
                                right:
                                  field-ref:
                                    path: ["n"]
                        element-type:
                          primitive: u8
  - name: "GuardedOr"
    kind:
      union:
        packed: true
        variants:
          - name: "raw"
            variant-type:
              primitive: u8
          - name: "guarded"
            variant-type:
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
                          or:
                            left:
                              eq:
                                left:
                                  field-ref:
                                    path: ["n"]
                                right:
                                  literal:
                                    u8: 0
                            right:
                              div:
                                left:
                                  literal:
                                    u8: 4
                                right:
                                  field-ref:
                                    path: ["n"]
                        element-type:
                          primitive: u8
  - name: "GuardedStruct"
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
                  and:
                    left:
                      ne:
                        left:
                          field-ref:
                            path: ["n"]
                        right:
                          literal:
                            u8: 0
                    right:
                      div:
                        left:
                          literal:
                            u8: 4
                        right:
                          field-ref:
                            path: ["n"]
                element-type:
                  primitive: u8
  - name: "GuardedTag"
    kind:
      struct:
        packed: true
        fields:
          - name: "t"
            field-type:
              primitive: u8
          - name: "body"
            field-type:
              enum:
                packed: true
                tag-ref:
                  and:
                    left:
                      ne:
                        left:
                          field-ref:
                            path: ["t"]
                        right:
                          literal:
                            u8: 0
                    right:
                      div:
                        left:
                          literal:
                            u8: 4
                        right:
                          field-ref:
                            path: ["t"]
                variants:
                  - name: "none"
                    tag-value: 0
                    variant-type:
                      struct:
                        packed: true
                        fields: []
                  - name: "some"
                    tag-value: 1
                    variant-type:
                      primitive: u8
"#;

/* A struct's array sized directly by comparisons and short-circuit logic
 * generates (the TypeScript IR sizes it from a derived `data.computed_size`
 * parameter), validates and sizes from params as C and Rust do. */
#[test]
fn test_ts_logical_size_expressions_in_structs() {
    let test_dir = setup_test_dir("logical_struct_sizes");
    /* The guarded array followed by another field (its offset comes from the
    count the param extractor evaluates). */
    let abi = format!(
        "{GUARDED_DIV_ABI}{}",
        r#"  - name: "GuardedTail"
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
                  and:
                    left:
                      ne:
                        left:
                          field-ref:
                            path: ["n"]
                        right:
                          literal:
                            u8: 0
                    right:
                      div:
                        left:
                          literal:
                            u8: 4
                        right:
                          field-ref:
                            path: ["n"]
                element-type:
                  primitive: u8
          - name: "tail"
            field-type:
              primitive: u8
"#
    );
    if !generate_checked_ts(&test_dir, "guarded_div", &abi, "test.guarded_div") {
        return;
    }
    run_ts_script(
        &test_dir,
        "logical_struct_sizes_test",
        r#"
import { GuardedStruct, GuardedTag, GuardedAnd, GuardedOr, GuardedTail } from "./test/guarded_div/types.js";

const check = (cond: boolean, what: string): void => {
  if (!cond) throw new Error(`check failed: ${what}`);
};
const u8 = (...xs: number[]) => Uint8Array.from(xs);
check(GuardedStruct.validate(u8(0)).consumed === 1, "n = 0: no elements");
check(GuardedStruct.validate(u8(2, 0xaa, 0xbb)).consumed === 2, "n = 2: one element");
check(!GuardedStruct.validate(u8(2)).ok, "n = 2 needs two bytes");
const s = GuardedStruct.from_array(u8(2, 0xaa, 0xbb))!;
check(s.get_data_length() === 1 && s.get_data_at(0) === 0xaa, "view");
check(GuardedStruct.footprintFromParams(s.dynamicParams()) === 2, "params footprint");
const P = GuardedStruct.Params as any;
const key = Object.keys(GuardedStruct.ParamKeys)[0];
check(GuardedStruct.footprintFromParams(P.fromValues({ [key]: 0 })) === 1, "footprint n = 0");
check(GuardedStruct.footprintFromParams(P.fromValues({ [key]: 2 })) === 2, "footprint n = 2");
check(GuardedTag.validate(u8(0)).consumed === 1 && GuardedTag.validate(u8(2, 7)).consumed === 2, "GuardedTag");
check(GuardedAnd.validate(u8(0)).consumed === 1 && GuardedOr.validate(u8(0, 9)).consumed === 2, "unions");
const t2 = GuardedTail.from_array(u8(2, 0xaa, 0x77))!;
check(GuardedTail.validate(u8(2, 0xaa, 0x77)).consumed === 3 && t2.get_tail() === 0x77, "tail after one element");
const t0 = GuardedTail.from_array(u8(0, 0x77))!;
check(GuardedTail.validate(u8(0, 0x77)).consumed === 2 && t0.get_tail() === 0x77, "tail after no elements");
check(GuardedTail.footprintFromParams(t2.dynamicParams()) === 3, "tail params footprint");
console.log("logical struct sizes ok");
"#,
    );
}

/* `sizeof` in a count: of a constant-size type it is a constant (C and Rust
 * agree); of a variable-size type C and Rust generate a validator that
 * reports the layout unsupported, and TypeScript generates one that rejects
 * the bytes. Codegen never panics (exit 101) on either. */
#[test]
fn test_ts_sizeof_counts_generate_without_panicking() {
    let test_dir = setup_test_dir("sizeof_counts");
    let abi = r#"
abi:
  package: "test.sizeof_count"
  abi-version: 1
  package-version: "1.0.0"
  description: "Array counts using sizeof next to a field"
types:
  - name: "Four"
    kind:
      struct:
        packed: true
        fields:
          - name: "v"
            field-type:
              primitive: u32
  - name: "Rec"
    kind:
      struct:
        packed: true
        fields:
          - name: "len"
            field-type:
              primitive: u8
          - name: "data"
            field-type:
              array:
                size: {field-ref: {path: ["len"]}}
                element-type:
                  primitive: u8
  - name: "SizeofCount"
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
                size: {add: {left: {field-ref: {path: ["n"]}}, right: {sizeof: {type-name: "Four"}}}}
                element-type:
                  primitive: u8
  - name: "SizeofVar"
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
                size: {add: {left: {field-ref: {path: ["n"]}}, right: {sizeof: {type-name: "Rec"}}}}
                element-type:
                  primitive: u8
"#;
    let path = fs::canonicalize(&test_dir)
        .unwrap()
        .join("sizeof_count.abi.yaml");
    fs::write(&path, abi).unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_abi-gen"))
        .args([
            "codegen",
            "--files",
            path.to_str().unwrap(),
            "--language",
            "typescript",
            "--output",
        ])
        .arg(&test_dir)
        .output()
        .expect("run abi-gen");
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(
        output.status.success() && !stderr.contains("panicked"),
        "codegen failed:\n{stderr}"
    );
    if !ensure_tsc_available() {
        return;
    }
    check_typescript_compilation(&test_dir.join("test/sizeof_count/types.ts"))
        .expect("generated TypeScript must type-check");
    run_ts_script(
        &test_dir,
        "sizeof_counts_test",
        r#"
import { SizeofCount, SizeofVar } from "./test/sizeof_count/types.js";

const check = (cond: boolean, what: string): void => {
  if (!cond) throw new Error(`check failed: ${what}`);
};
const bytes = new Uint8Array(16);
bytes[0] = 1;
check(SizeofCount.validate(bytes).consumed === 6, "n + sizeof(Four) = 5 elements");
check(SizeofCount.footprintFromParams(SizeofCount.from_array(bytes)!.dynamicParams()) === 6, "params footprint");
check(!SizeofVar.validate(bytes).ok, "sizeof of a variable-size type is rejected");
console.log("sizeof counts ok");
"#,
    );
}

/* Every ExprKind, as an array count and as an enum tag, with operand
 * fields `a` and `b` of each type in `EXPR_FIELD_TYPES` over that type's
 * inputs: TypeScript and Go must validate the same bytes as the generated C
 * and Rust, and C and Rust must agree with each other. The test generates,
 * builds and runs all four (Go is skipped when `go` is missing, unless
 * `ABI_REQUIRE_GO` is set). A count type is
 * `{ a, b, data: u8[EXPR], n: u8, bytes: u8[n] }` (the scan must read `n`
 * after `data`); a tag type is `{ a, b, body: enum by EXPR }` with variant
 * k of k + 1 bytes. */
const EXPR_FIELD_TYPES: &[(&str, &str, usize)] = &[
    ("U64", "u64", 8),
    ("I8", "i8", 1),
    ("I32", "i32", 4),
    ("I64", "i64", 8),
];

/* Inputs where the generated C and Rust validate differently (type, input
 * index). Empty: C, Rust, Go and TypeScript agree on every operator and
 * input. */
const EXPR_C_RUST_DISAGREE: &[(&str, usize)] = &[];

/* (a, b) per field type, as two's-complement values of that width. */
fn expr_inputs(suffix: &str) -> Vec<(i128, i128)> {
    const P53: i128 = 1 << 53;
    const P63: i128 = 1 << 63;
    match suffix {
        "U64" => vec![
            (0, 0),
            (1, 0),
            (0, 1),
            (2, 3),
            (5, 2),
            (3, 5),
            (7, 7),
            (2, 64),
            (1, 63),
            (3, 63),
            (P63, 2),
            (u64::MAX as i128, 1),
            (6, 1),
            (P53, P53 + 1),
            (P53 + 1, P53),
            (P53, P53),
            (P63 - 1, P63),
            (P63, P63 - 1),
        ],
        "I8" => vec![
            (-1, 0),
            (-1, 3),
            (-128, 1),
            (5, -2),
            (-3, -5),
            (2, 3),
            (0, -1),
            (127, -128),
            (-1, -1),
            (0, 0),
            (3, 2),
        ],
        "I32" => vec![
            (-1, 0),
            (-1, 3),
            (i32::MIN as i128, 1),
            (5, -2),
            (-3, -5),
            (2, 3),
            (0, -1),
            (i32::MAX as i128, 2),
            (-1, -1),
        ],
        _ => vec![
            (-1, 0),
            (-1, 3),
            (i64::MIN as i128, 1),
            (5, -2),
            (-3, -5),
            (2, 3),
            (0, -1),
            (i64::MAX as i128, 2),
            (-1, -1),
        ],
    }
}

fn expr_operators() -> Vec<(&'static str, String)> {
    let a = r#"{field-ref: {path: ["a"]}}"#;
    let b = r#"{field-ref: {path: ["b"]}}"#;
    let lit = |v: u64| format!("{{literal: {{u64: {v}}}}}");
    let bin = |op: &str, l: &str, r: &str| format!("{{{op}: {{left: {l}, right: {r}}}}}");
    let un = |op: &str, x: &str| format!("{{{op}: {{operand: {x}}}}}");
    vec![
        ("Literal", lit(3)),
        ("FieldRef", a.to_string()),
        ("Sizeof", bin("add", a, r#"{sizeof: {type-name: "Four"}}"#)),
        (
            "Alignof",
            bin("add", a, r#"{alignof: {type-name: "Four"}}"#),
        ),
        ("Add", bin("add", a, b)),
        ("Sub", bin("sub", a, b)),
        ("Mul", bin("mul", a, b)),
        ("Div", bin("div", a, b)),
        ("Mod", bin("mod", a, b)),
        ("Pow", bin("pow", a, b)),
        ("BitAnd", bin("bit-and", a, b)),
        ("BitOr", bin("bit-or", a, b)),
        ("BitXor", bin("bit-xor", a, b)),
        ("LeftShift", bin("left-shift", a, b)),
        ("RightShift", bin("right-shift", a, b)),
        ("BitNot", bin("bit-and", &un("bit-not", a), &lit(7))),
        ("Neg", bin("bit-and", &un("neg", a), &lit(7))),
        ("Not", un("not", a)),
        ("Popcount", un("popcount", a)),
        ("Eq", bin("eq", a, b)),
        ("Ne", bin("ne", a, b)),
        ("Lt", bin("lt", a, b)),
        ("Gt", bin("gt", a, b)),
        ("Le", bin("le", a, b)),
        ("Ge", bin("ge", a, b)),
        ("And", bin("and", &bin("ne", a, &lit(0)), &bin("div", b, a))),
        ("Or", bin("or", &bin("eq", a, &lit(0)), &bin("div", b, a))),
        ("Xor", bin("xor", a, b)),
    ]
}

fn expr_operators_abi() -> String {
    let mut abi = String::from(
        "abi:\n  package: \"test.expr_ops\"\n  abi-version: 1\n  package-version: \"1.0.0\"\n  description: \"Every expression operator as an array count and an enum tag\"\ntypes:\n  - name: \"Four\"\n    kind:\n      struct:\n        packed: true\n        fields:\n          - name: \"v\"\n            field-type:\n              primitive: u32\n",
    );
    let field = |name: &str, prim: &str| {
        format!(
            "          - name: \"{name}\"\n            field-type:\n              primitive: {prim}\n"
        )
    };
    for (suffix, prim, _) in EXPR_FIELD_TYPES {
        for (name, expr) in expr_operators() {
            abi.push_str(&format!(
                "  - name: \"{name}Count{suffix}\"\n    kind:\n      struct:\n        packed: true\n        fields:\n"
            ));
            abi.push_str(&field("a", prim));
            abi.push_str(&field("b", prim));
            abi.push_str(&format!(
                "          - name: \"data\"\n            field-type:\n              array:\n                size: {expr}\n                element-type:\n                  primitive: u8\n"
            ));
            abi.push_str(&field("n", "u8"));
            abi.push_str("          - name: \"bytes\"\n            field-type:\n              array:\n                size: {field-ref: {path: [\"n\"]}}\n                element-type:\n                  primitive: u8\n");
            abi.push_str(&format!(
                "  - name: \"{name}Tag{suffix}\"\n    kind:\n      struct:\n        packed: true\n        fields:\n"
            ));
            abi.push_str(&field("a", prim));
            abi.push_str(&field("b", prim));
            abi.push_str(&format!(
                "          - name: \"body\"\n            field-type:\n              enum:\n                packed: true\n                tag-ref: {expr}\n                variants:\n"
            ));
            for k in 0..8u64 {
                abi.push_str(&format!(
                    "                  - name: \"v{k}\"\n                    tag-value: {k}\n                    variant-type:\n                      array:\n                        size:\n                          literal:\n                            u64: {}\n                        element-type:\n                          primitive: u8\n",
                    k + 1
                ));
            }
        }
    }
    abi
}

/* The 80-byte input for (a, b): both fields at `width` bytes, then zeros. */
fn expr_input_bytes(a: i128, b: i128, width: usize) -> Vec<u8> {
    let mut bytes = Vec::new();
    bytes.extend_from_slice(&(a as u128).to_le_bytes()[..width]);
    bytes.extend_from_slice(&(b as u128).to_le_bytes()[..width]);
    bytes.resize(80, 0);
    bytes
}

/* Parse "Type index result" lines into a map. */
fn parse_expr_results(text: &str) -> std::collections::BTreeMap<(String, usize), String> {
    text.lines()
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let ty = parts.next()?.to_string();
            let idx = parts.next()?.parse().ok()?;
            let result = parts.next()?.to_string();
            Some(((ty, idx), result))
        })
        .collect()
}

#[test]
fn test_ts_every_expression_operator_matches_c_rust_and_go() {
    let test_dir = fs::canonicalize(setup_test_dir("expr_operators")).unwrap();
    let abi_path = test_dir.join("expr_ops.abi.yaml");
    fs::write(&abi_path, expr_operators_abi()).unwrap();
    let generate = |lang: &str, out: &Path| {
        let output = Command::new(env!("CARGO_BIN_EXE_abi-gen"))
            .args([
                "codegen",
                "--files",
                abi_path.to_str().unwrap(),
                "--language",
                lang,
                "--output",
            ])
            .arg(out)
            .output()
            .expect("run abi-gen");
        assert!(
            output.status.success(),
            "{lang} codegen failed:\n{}",
            String::from_utf8_lossy(&output.stderr)
        );
    };
    let ops = expr_operators();
    /* (type, field-type suffix) */
    let types: Vec<(String, &str)> = EXPR_FIELD_TYPES
        .iter()
        .flat_map(|(suffix, _, _)| {
            ops.iter().flat_map(move |(name, _)| {
                [
                    (format!("{name}Count{suffix}"), *suffix),
                    (format!("{name}Tag{suffix}"), *suffix),
                ]
            })
        })
        .collect();
    let byte_list = |bytes: Vec<u8>| {
        bytes
            .iter()
            .map(|x| x.to_string())
            .collect::<Vec<_>>()
            .join(", ")
    };

    /* C */
    let c_dir = test_dir.join("c");
    generate("c", &c_dir);
    let pkg = c_dir.join("test/expr_ops");
    let mut main = String::from("#include <stdio.h>\n#include \"types.h\"\n");
    for (suffix, _, width) in EXPR_FIELD_TYPES {
        let rows: Vec<String> = expr_inputs(suffix)
            .iter()
            .map(|(a, b)| format!("{{ {} }}", byte_list(expr_input_bytes(*a, *b, *width))))
            .collect();
        main.push_str(&format!(
            "static uint8_t const inputs_{suffix}[][ 80 ] = {{\n  {}\n}};\n",
            rows.join(",\n  ")
        ));
    }
    main.push_str("int main( void ) {\n  uint64_t consumed;\n");
    for (ty, suffix) in &types {
        main.push_str(&format!(
            "  for( int i=0; i<{n}; i++ ) {{ consumed = 0; if( {ty}_validate( inputs_{suffix}[i], 80, &consumed )==0 ) printf( \"{ty} %d ok:%lu\\n\", i, (unsigned long)consumed ); else printf( \"{ty} %d err\\n\", i ); }}\n",
            n = expr_inputs(suffix).len()
        ));
    }
    main.push_str("  return 0;\n}\n");
    fs::write(pkg.join("main.c"), main).unwrap();
    let cc = std::env::var("CC").unwrap_or_else(|_| "cc".to_string());
    let build = Command::new(&cc)
        .current_dir(&pkg)
        .args(["-std=c11", "-I.", "main.c", "functions.c", "-o", "expr_ops"])
        .output()
        .expect("run cc");
    assert!(
        build.status.success(),
        "C build failed:\n{}",
        String::from_utf8_lossy(&build.stderr)
    );
    let c_run = Command::new(pkg.join("expr_ops")).output().expect("run C");
    let c_results = parse_expr_results(&String::from_utf8_lossy(&c_run.stdout));

    /* Rust */
    let crate_dir = test_dir.join("rust_crate");
    generate("rust", &crate_dir.join("src/generated"));
    fs::write(
        crate_dir.join("Cargo.toml"),
        "[package]\nname = \"expr_ops\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[workspace]\n",
    )
    .unwrap();
    let mut rs =
        String::from("pub mod generated;\nuse generated::test::expr_ops::*;\nfn main() {\n");
    for (suffix, _, width) in EXPR_FIELD_TYPES {
        let rows: Vec<String> = expr_inputs(suffix)
            .iter()
            .map(|(a, b)| format!("vec![{}]", byte_list(expr_input_bytes(*a, *b, *width))))
            .collect();
        rs.push_str(&format!(
            "    let inputs_{suffix}: Vec<Vec<u8>> = vec![{}];\n",
            rows.join(", ")
        ));
    }
    for (ty, suffix) in &types {
        rs.push_str(&format!(
            "    for (i, buf) in inputs_{suffix}.iter().enumerate() {{ match {ty}::validate(buf) {{ Ok(n) => println!(\"{ty} {{}} ok:{{}}\", i, n), Err(_) => println!(\"{ty} {{}} err\", i) }} }}\n"
        ));
    }
    rs.push_str("}\n");
    fs::write(crate_dir.join("src/main.rs"), rs).unwrap();
    let rust_run = Command::new("cargo")
        .current_dir(&crate_dir)
        .args(["run", "--quiet"])
        .env_remove("RUSTFLAGS")
        .output()
        .expect("cargo run");
    assert!(
        rust_run.status.success(),
        "Rust build failed:\n{}",
        String::from_utf8_lossy(&rust_run.stderr)
    );
    let rust_results = parse_expr_results(&String::from_utf8_lossy(&rust_run.stdout));

    /* Go */
    let go = std::env::var("GO").unwrap_or_else(|_| "go".to_string());
    let have_go = Command::new(&go)
        .arg("version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    if !have_go && std::env::var_os("ABI_REQUIRE_GO").is_some() {
        panic!("ABI_REQUIRE_GO is set but `{go}` is not available");
    }
    let go_results = if have_go {
        let go_dir = test_dir.join("go");
        generate("go", &go_dir);
        let mut main = format!(
            "package main\n\nimport (\n\t\"fmt\"\n\n\tP \"{}/test/expr_ops\"\n)\n\nfunc main() {{\n",
            abi_gen::codegen::go::DEFAULT_MODULE
        );
        for (suffix, _, width) in EXPR_FIELD_TYPES {
            let rows: Vec<String> = expr_inputs(suffix)
                .iter()
                .map(|(a, b)| format!("{{{}}}", byte_list(expr_input_bytes(*a, *b, *width))))
                .collect();
            main.push_str(&format!(
                "\tinputs{suffix} := [][]byte{{{}}}\n",
                rows.join(", ")
            ));
        }
        for (ty, suffix) in &types {
            main.push_str(&format!(
                "\tfor i, buf := range inputs{suffix} {{\n\t\tif n, err := P.Validate{g}(buf); err == nil {{\n\t\t\tfmt.Printf(\"{ty} %d ok:%d\\n\", i, n)\n\t\t}} else {{\n\t\t\tfmt.Printf(\"{ty} %d err\\n\", i)\n\t\t}}\n\t}}\n",
                g = abi_gen::codegen::go_gen::names::type_name(ty)
            ));
        }
        main.push_str("}\n");
        fs::create_dir_all(go_dir.join("cmd/expr")).unwrap();
        fs::write(go_dir.join("cmd/expr/main.go"), main).unwrap();
        let go_run = Command::new(&go)
            .current_dir(&go_dir)
            .args(["run", "./cmd/expr"])
            .env("CGO_ENABLED", "0")
            .output()
            .expect("go run");
        assert!(
            go_run.status.success(),
            "Go build failed:\n{}",
            String::from_utf8_lossy(&go_run.stderr)
        );
        Some(parse_expr_results(&String::from_utf8_lossy(&go_run.stdout)))
    } else {
        println!(
            "WARNING: `{go}` not found; skipping the Go part (set ABI_REQUIRE_GO to require it)."
        );
        None
    };
    let mut go_failures = Vec::new();
    if let Some(go_results) = &go_results {
        for (ty, suffix) in &types {
            for (idx, input) in expr_inputs(suffix).iter().enumerate() {
                let key = (ty.clone(), idx);
                let r = rust_results
                    .get(&key)
                    .cloned()
                    .unwrap_or_else(|| "missing".into());
                let g = go_results
                    .get(&key)
                    .cloned()
                    .unwrap_or_else(|| "missing".into());
                if g != r {
                    go_failures.push(format!("{ty} {input:?}: Rust {r}, Go {g}"));
                }
            }
        }
    }
    assert!(
        go_failures.is_empty(),
        "{} Go mismatches:\n{}",
        go_failures.len(),
        go_failures.join("\n")
    );

    /* TypeScript */
    generate("typescript", &test_dir);
    if !ensure_tsc_available() {
        return;
    }
    check_typescript_compilation(&test_dir.join("test/expr_ops/types.ts"))
        .expect("generated TypeScript must type-check");
    let mut ts = String::from(
        "import * as M from \"./test/expr_ops/types.js\";\nconst lines: string[] = [];\nconst run = (name: string, inputs: number[][]): void => {\n  inputs.forEach((bytes, i) => {\n    let r: string;\n    try {\n      const v = (M as any)[name].validate(Uint8Array.from(bytes));\n      r = v.ok ? `ok:${v.consumed}` : \"err\";\n    } catch (e) {\n      r = \"threw\";\n    }\n    lines.push(`${name} ${i} ${r}`);\n  });\n};\n",
    );
    for (suffix, _, width) in EXPR_FIELD_TYPES {
        let rows: Vec<String> = expr_inputs(suffix)
            .iter()
            .map(|(a, b)| format!("[{}]", byte_list(expr_input_bytes(*a, *b, *width))))
            .collect();
        ts.push_str(&format!(
            "const inputs_{suffix}: number[][] = [{}];\n",
            rows.join(", ")
        ));
    }
    for (ty, suffix) in &types {
        ts.push_str(&format!("run(\"{ty}\", inputs_{suffix});\n"));
    }
    ts.push_str("console.log(lines.join(\"\\n\"));\n");
    fs::write(test_dir.join("expr_ops_test.ts"), ts).unwrap();
    let compile = Command::new(vendored_tsc())
        .current_dir(&test_dir)
        .args([
            "--strict",
            "--module",
            "NodeNext",
            "--moduleResolution",
            "NodeNext",
            "--target",
            "ES2020",
            "--outDir",
            "dist",
            "expr_ops_test.ts",
        ])
        .output()
        .expect("tsc");
    assert!(
        compile.status.success(),
        "tsc failed:\n{}",
        String::from_utf8_lossy(&compile.stdout)
    );
    let ts_run = Command::new("node")
        .current_dir(&test_dir)
        .arg("dist/expr_ops_test.js")
        .output()
        .expect("node");
    assert!(
        ts_run.status.success(),
        "node failed:\n{}",
        String::from_utf8_lossy(&ts_run.stderr)
    );
    let ts_results = parse_expr_results(&String::from_utf8_lossy(&ts_run.stdout));

    let mut failures = Vec::new();
    for (ty, suffix) in &types {
        let inputs = expr_inputs(suffix);
        for (idx, input) in inputs.iter().enumerate() {
            let key = (ty.clone(), idx);
            let c = c_results
                .get(&key)
                .cloned()
                .unwrap_or_else(|| "missing".into());
            let r = rust_results
                .get(&key)
                .cloned()
                .unwrap_or_else(|| "missing".into());
            let t = ts_results
                .get(&key)
                .cloned()
                .unwrap_or_else(|| "missing".into());
            let listed = EXPR_C_RUST_DISAGREE.contains(&(ty.as_str(), idx));
            if c != r {
                if !listed {
                    failures.push(format!(
                        "C/Rust disagree (unlisted): {ty} {input:?}: C {c}, Rust {r}, TS {t}"
                    ));
                }
            } else if listed {
                failures.push(format!(
                    "listed C/Rust disagreement now agrees: {ty} {input:?}"
                ));
            } else if t != c {
                failures.push(format!("{ty} {input:?}: C/Rust {c}, TS {t}"));
            }
        }
    }
    assert!(
        failures.is_empty(),
        "{} mismatches:\n{}",
        failures.len(),
        failures.join("\n")
    );
}

/* Values as C and Rust read them: u64 counts compare exactly past 2^53 in
 * the sequential scan, and a signed field is its u64 two's complement
 * (`i8 -1 & 3` is 3), evaluated in checked u64. */
#[test]
fn test_ts_counts_use_exact_u64_values() {
    let test_dir = setup_test_dir("exact_u64_counts");
    let abi = r#"
abi:
  package: "test.exact_u64"
  abi-version: 1
  package-version: "1.0.0"
  description: "Counts over large and signed values"
types:
  - name: "EqThenBytes"
    kind:
      struct:
        packed: true
        fields:
          - name: "a"
            field-type:
              primitive: u64
          - name: "b"
            field-type:
              primitive: u64
          - name: "data"
            field-type:
              array:
                size: {eq: {left: {field-ref: {path: ["a"]}}, right: {field-ref: {path: ["b"]}}}}
                element-type:
                  primitive: u8
          - name: "n"
            field-type:
              primitive: u8
          - name: "bytes"
            field-type:
              array:
                size: {field-ref: {path: ["n"]}}
                element-type:
                  primitive: u8
  - name: "MaskedSigned"
    kind:
      struct:
        packed: true
        fields:
          - name: "n"
            field-type:
              primitive: i8
          - name: "data"
            field-type:
              array:
                size: {bit-and: {left: {field-ref: {path: ["n"]}}, right: {literal: {u64: 3}}}}
                element-type:
                  primitive: u8
"#;
    if !generate_checked_ts(&test_dir, "exact_u64", abi, "test.exact_u64") {
        return;
    }
    run_ts_script(
        &test_dir,
        "exact_u64_test",
        r#"
import { EqThenBytes, MaskedSigned } from "./test/exact_u64/types.js";

const check = (cond: boolean, what: string): void => {
  if (!cond) throw new Error(`check failed: ${what}`);
};
const value = (a: bigint, b: bigint, rest: number[]): Uint8Array => {
  const bytes = new Uint8Array(16 + rest.length);
  const dv = new DataView(bytes.buffer);
  dv.setBigUint64(0, a, true);
  dv.setBigUint64(8, b, true);
  bytes.set(rest, 16);
  return bytes;
};
const p53 = 2n ** 53n;
/* a != b (they differ only past 2^53): no data byte, then n = 0. */
const ne = value(p53, p53 + 1n, [0]);
check(EqThenBytes.validate(ne).ok && EqThenBytes.validate(ne).consumed === 17, "2^53 vs 2^53+1 is 17 bytes");
check(EqThenBytes.from_array(ne)!.get_n() === 0, "n follows the empty data");
const eq = value(p53, p53, [9, 0]);
check(EqThenBytes.validate(eq).consumed === 18, "equal values: one data byte");
check(MaskedSigned.validate(Uint8Array.from([255, 1, 2, 3])).consumed === 4, "i8 -1 & 3 = 3");
check(MaskedSigned.validate(Uint8Array.from([254, 1, 2, 3])).consumed === 3, "i8 -2 & 3 = 2");
check(!MaskedSigned.validate(Uint8Array.from([255, 1, 2])).ok, "three bytes need four");
console.log("exact u64 counts ok");
"#,
    );
}

/* Views compute counts and tags on the exact u64 values validation used:
 * an array counted by `a == b` with a = 2^53, b = 2^53 + 1 is empty, and a
 * u64 count or tag operand past 2^53 does not throw. */
#[test]
fn test_ts_views_use_exact_u64_values() {
    let test_dir = setup_test_dir("view_exact_u64");
    let abi = r#"
abi:
  package: "test.view_u64"
  abi-version: 1
  package-version: "1.0.0"
  description: "View lengths and tags over large u64 values"
types:
  - name: "EqThenBytes"
    kind:
      struct:
        packed: true
        fields:
          - name: "a"
            field-type:
              primitive: u64
          - name: "b"
            field-type:
              primitive: u64
          - name: "data"
            field-type:
              array:
                size: {eq: {left: {field-ref: {path: ["a"]}}, right: {field-ref: {path: ["b"]}}}}
                element-type:
                  primitive: u8
          - name: "n"
            field-type:
              primitive: u8
          - name: "bytes"
            field-type:
              array:
                size: {field-ref: {path: ["n"]}}
                element-type:
                  primitive: u8
  - name: "MaskedBig"
    kind:
      struct:
        packed: true
        fields:
          - name: "a"
            field-type:
              primitive: u64
          - name: "data"
            field-type:
              array:
                size: {bit-and: {left: {field-ref: {path: ["a"]}}, right: {literal: {u64: 3}}}}
                element-type:
                  primitive: u8
  - name: "BigTag"
    kind:
      struct:
        packed: true
        fields:
          - name: "a"
            field-type:
              primitive: u64
          - name: "b"
            field-type:
              primitive: u64
          - name: "body"
            field-type:
              enum:
                packed: true
                tag-ref: {eq: {left: {field-ref: {path: ["a"]}}, right: {field-ref: {path: ["b"]}}}}
                variants:
                  - name: "differ"
                    tag-value: 0
                    variant-type:
                      primitive: u8
                  - name: "same"
                    tag-value: 1
                    variant-type:
                      primitive: u16
"#;
    if !generate_checked_ts(&test_dir, "view_u64", abi, "test.view_u64") {
        return;
    }
    run_ts_script(
        &test_dir,
        "view_u64_test",
        r#"
import { EqThenBytes, MaskedBig, BigTag } from "./test/view_u64/types.js";

const check = (cond: boolean, what: string): void => {
  if (!cond) throw new Error(`check failed: ${what}`);
};
const u64s = (values: bigint[], rest: number[]): Uint8Array => {
  const bytes = new Uint8Array(values.length * 8 + rest.length);
  const dv = new DataView(bytes.buffer);
  values.forEach((v, i) => dv.setBigUint64(i * 8, v, true));
  bytes.set(rest, values.length * 8);
  return bytes;
};
const p53 = 2n ** 53n;
const e = EqThenBytes.from_array(u64s([p53, p53 + 1n], [0]))!;
check(e.get_data_length() === 0 && e.get_data().length === 0, "a != b past 2^53: empty data");
check(e.get_n() === 0 && e.get_bytes().length === 0, "n follows the empty data");
const m = MaskedBig.from_array(u64s([2n ** 60n + 1n], [7, 8]))!;
check(m.get_data_length() === 1 && m.get_data()[0] === 7, "(2^60 + 1) & 3 = 1 element");
const t = BigTag.from_array(u64s([p53, p53 + 1n], [9]))! as any;
check(t.bodyVariant().name === "differ" && t.get_body_computed_tag() === 0, "tag 0 past 2^53");
console.log("view u64 ok");
"#,
    );
}

/* A field sized by `<field>.payload_size` (here an inline child
 * `{ n, bytes[n], count }`) is still checked against its bytes when the
 * caller supplies params: bytes that no longer match the params are
 * rejected, as are params that disagree with the bytes. */
#[test]
fn test_ts_payload_fields_are_checked_with_supplied_params() {
    let test_dir = setup_test_dir("payload_params_checked");
    if !generate_fixture_checked(
        &test_dir,
        "nested_count_after_bytes",
        "compliance.nested_count_after_bytes",
    ) {
        return;
    }
    run_ts_script(
        &test_dir,
        "payload_params_test",
        r#"
import { NestedCount } from "./nested_count_after_bytes/compliance/nested_count_after_bytes/types.js";

const check = (cond: boolean, what: string): void => {
  if (!cond) throw new Error(`check failed: ${what}`);
};
/* child: n = 1, bytes [42], count = 0; no items; tail 9 */
const bytes = Uint8Array.from([1, 42, 0, 9]);
const params = NestedCount.from_array(bytes)!.dynamicParams();
check(NestedCount.validate(bytes, { params }).consumed === 4, "matching params");
const changed = Uint8Array.from(bytes);
changed[0] = 255;
check(!NestedCount.validate(changed, { params }).ok, "the child needs 255 data bytes");
check(NestedCount.from_array(changed, { params }) === null, "from_array rejects it too");
/* Params of another valid value (child n = 2) do not describe these bytes. */
const other = NestedCount.from_array(Uint8Array.from([2, 7, 8, 0, 9]))!.dynamicParams();
check(!NestedCount.validate(bytes, { params: other }).ok, "params that disagree with the bytes");
console.log("payload params checked");
"#,
    );
}

/* The measuring walk resolves `__buffer_size` (the bytes available to the
 * struct that reads it) and fixed-array elements (`hdr.bits.1`): union
 * variants using them validate as in C and Rust (expected values below were
 * checked against the generated C and Rust). */
#[test]
fn test_ts_measure_resolves_buffer_size_and_array_elements() {
    let test_dir = setup_test_dir("measure_buffer_size");
    let abi = r#"abi:
  package: "test.union_bufsize"
  abi-version: 1
  package-version: "1.0.0"
  description: "Union variants sized by __buffer_size and by fixed-array elements"
types:
  - name: "BufferSizedEntries"
    kind:
      struct:
        packed: true
        fields:
          - name: "version"
            field-type:
              primitive: u32
          - name: "entries"
            field-type:
              array:
                size: {div: {left: {sub: {left: {field-ref: {path: ["__buffer_size"]}}, right: {literal: {u64: 4}}}}, right: {literal: {u64: 8}}}}
                element-type:
                  primitive: u64
  - name: "SizedUnion"
    kind:
      union:
        packed: true
        variants:
          - name: "raw"
            variant-type:
              primitive: u32
          - name: "entries"
            variant-type:
              type-ref:
                name: "BufferSizedEntries"
  - name: "BitsUnion"
    kind:
      union:
        packed: true
        variants:
          - name: "raw"
            variant-type:
              primitive: u8
          - name: "counted"
            variant-type:
              struct:
                packed: true
                fields:
                  - name: "hdr"
                    field-type:
                      struct:
                        packed: true
                        fields:
                          - name: "bits"
                            field-type:
                              array:
                                size: {literal: {u64: 2}}
                                element-type:
                                  primitive: u8
                  - name: "data"
                    field-type:
                      array:
                        size: {field-ref: {path: ["hdr", "bits", "1"]}}
                        element-type:
                          primitive: u8
"#;
    if !generate_checked_ts(&test_dir, "union_bufsize", abi, "test.union_bufsize") {
        return;
    }
    run_ts_script(
        &test_dir,
        "measure_buffer_size_test",
        r#"
import { SizedUnion, BitsUnion } from "./test/union_bufsize/types.js";

const check = (cond: boolean, what: string): void => {
  if (!cond) throw new Error(`check failed: ${what}`);
};
const z = new Uint8Array(20);
z[0] = 1;
/* [len, consumed or null] as C SizedUnion_validate / Rust validate return. */
for (const [len, size] of [[4, 4], [12, 12], [14, 12], [3, null]] as const) {
  const r = SizedUnion.validate(z.subarray(0, len));
  check(size === null ? !r.ok : r.ok && r.consumed === size, `SizedUnion ${len} bytes -> ${size}`);
}
check(SizedUnion.from_array(Uint8Array.from([1, 0, 0, 0]))!.get_raw() === 1, "SizedUnion from_array");
const bits = Uint8Array.from([9, 3, 1, 2, 3, 0]);
for (const [len, size] of [[5, 5], [4, null], [6, 5]] as const) {
  const r = BitsUnion.validate(bits.subarray(0, len));
  check(size === null ? !r.ok : r.ok && r.consumed === size, `BitsUnion ${len} bytes -> ${size}`);
}
console.log("buffer size walk ok");
"#,
    );
}

/* An inline union whose variant is sized by a field of the struct around
 * it (`["..", "n"]`): the struct passes its values to the union's walk, as
 * C passes parent params and Rust the view's context. Expected results are
 * those of the generated C (`T_validate`) and Rust (`validate`), checked on
 * the same inputs: valid, short and over-long. */
#[test]
fn test_ts_union_variants_read_enclosing_struct_fields() {
    let test_dir = setup_test_dir("union_outer_refs");
    let abi = r#"abi:
  package: "test.outer_ref_union"
  abi-version: 1
  package-version: "1.0.0"
  description: "A union variant sized by a field of the enclosing struct"
types:
  - name: "OuterRefUnion"
    kind:
      struct:
        packed: true
        fields:
          - name: "n"
            field-type:
              primitive: u8
          - name: "u"
            field-type:
              union:
                packed: true
                variants:
                  - name: "raw"
                    variant-type:
                      primitive: u8
                  - name: "counted"
                    variant-type:
                      struct:
                        packed: true
                        fields:
                          - name: "data"
                            field-type:
                              array:
                                size: {field-ref: {path: ["..", "n"]}}
                                element-type:
                                  primitive: u8
  - name: "OuterRefTail"
    kind:
      struct:
        packed: true
        fields:
          - name: "n"
            field-type:
              primitive: u8
          - name: "u"
            field-type:
              union:
                packed: true
                variants:
                  - name: "raw"
                    variant-type:
                      primitive: u8
                  - name: "counted"
                    variant-type:
                      struct:
                        packed: true
                        fields:
                          - name: "data"
                            field-type:
                              array:
                                size: {field-ref: {path: ["..", "n"]}}
                                element-type:
                                  primitive: u8
          - name: "tail"
            field-type:
              primitive: u8
"#;
    if !generate_checked_ts(&test_dir, "outer_ref_union", abi, "test.outer_ref_union") {
        return;
    }
    run_ts_script(
        &test_dir,
        "union_outer_refs_test",
        r#"
import { OuterRefUnion, OuterRefTail } from "./test/outer_ref_union/types.js";

const check = (cond: boolean, what: string): void => {
  if (!cond) throw new Error(`check failed: ${what}`);
};
/* [bytes, OuterRefUnion, OuterRefTail]: consumed size, or null if rejected. */
const cases: [number[], number | null, number | null][] = [
  [[2, 10, 11, 7], 3, 4],
  [[0, 9, 7], 2, 3],
  [[5, 1, 2], null, null],
  [[1, 9, 7, 7], 2, 3],
  [[3, 1, 2, 3, 4], 4, 5],
  [[2, 10], null, null],
];
for (const [bytes, union, tail] of cases) {
  const b = Uint8Array.from(bytes);
  for (const [T, size, name] of [[OuterRefUnion, union, "OuterRefUnion"], [OuterRefTail, tail, "OuterRefTail"]] as const) {
    const r = (T as any).validate(b);
    check(size === null ? !r.ok : r.ok && r.consumed === size, `${name} [${bytes}] -> ${size} (got ${r.code} ${r.consumed})`);
    if (size !== null) check((T as any).footprintFromParams((T as any).from_array(b).dynamicParams()) === size, `${name} [${bytes}] params footprint`);
  }
}
const t = OuterRefTail.from_array(Uint8Array.from([2, 10, 11, 7]))!;
check(t.get_tail() === 7 && t.get_u().bytes().length === 2, "views");
/* The variant reached through views reads the outer `n`: [bytes, data] as
   the C (OuterRefUnion_u_counted_get_data_len/_at) and Rust
   (u().counted().data_len()/data()) accessors return them. */
const reads: [number[], number[]][] = [
  [[2, 10, 11, 7], [10, 11]],
  [[0, 9, 7], []],
  [[1, 9, 7, 7], [9]],
  [[3, 1, 2, 3, 4], [1, 2, 3]],
];
for (const [bytes, data] of reads) {
  for (const T of [OuterRefUnion, OuterRefTail] as any[]) {
    const counted = T.from_array(Uint8Array.from(bytes)).get_u().get_counted();
    check(counted.get_data_length() === data.length, `${T.name} [${bytes}] data length`);
    check(counted.get_data().join() === data.join(), `${T.name} [${bytes}] data`);
    data.forEach((x, i) => check(counted.get_data_at(i) === x, `${T.name} [${bytes}] data[${i}]`));
  }
}
console.log("union outer refs ok");
"#,
    );
}

/* An unpacked union with a variable-size variant spans exactly its largest
 * variant (no padding to its alignment), as in C, Rust and the resolver;
 * inside an unpacked struct it is aligned like any field. Expected values
 * are those of the generated C (`T_validate`, `T_get_tail`) and Rust
 * (`validate`, `tail()`) on the same valid, short and over-long inputs.
 * (A top-level unpacked union is rejected by the CLI for every language.) */
#[test]
fn test_ts_unpacked_unions_are_not_padded() {
    let test_dir = setup_test_dir("unpacked_unions");
    let abi = r#"abi:
  package: "test.unpacked_union"
  abi-version: 1
  package-version: "1.0.0"
  description: "An unpacked union with a variable-size variant inside a packed holder"
types:
  - name: "UnpackedUnionHolder"
    kind:
      struct:
        packed: true
        fields:
          - name: "u"
            field-type:
              union:
                variants:
                  - name: "raw"
                    variant-type:
                      primitive: u32
                  - name: "sized"
                    variant-type:
                      struct:
                        packed: true
                        fields:
                          - name: "n"
                            field-type:
                              primitive: u8
                          - name: "data"
                            field-type:
                              array:
                                size: {field-ref: {path: ["n"]}}
                                element-type:
                                  primitive: u8
  - name: "UnpackedUnionTail"
    kind:
      struct:
        packed: true
        fields:
          - name: "lead"
            field-type:
              primitive: u8
          - name: "u"
            field-type:
              union:
                variants:
                  - name: "raw"
                    variant-type:
                      primitive: u32
                  - name: "sized"
                    variant-type:
                      struct:
                        packed: true
                        fields:
                          - name: "n"
                            field-type:
                              primitive: u8
                          - name: "data"
                            field-type:
                              array:
                                size: {field-ref: {path: ["n"]}}
                                element-type:
                                  primitive: u8
          - name: "tail"
            field-type:
              primitive: u8
  - name: "UnpackedStructHolder"
    kind:
      struct:
        packed: true
        fields:
          - name: "inner"
            field-type:
              struct:
                fields:
                  - name: "lead"
                    field-type:
                      primitive: u8
                  - name: "u"
                    field-type:
                      union:
                        variants:
                          - name: "raw"
                            variant-type:
                              primitive: u32
                          - name: "sized"
                            variant-type:
                              struct:
                                packed: true
                                fields:
                                  - name: "n"
                                    field-type:
                                      primitive: u8
                                  - name: "data"
                                    field-type:
                                      array:
                                        size: {field-ref: {path: ["n"]}}
                                        element-type:
                                          primitive: u8
          - name: "tail"
            field-type:
              primitive: u8
"#;
    if !generate_checked_ts(&test_dir, "unpacked_union", abi, "test.unpacked_union") {
        return;
    }
    run_ts_script(
        &test_dir,
        "unpacked_unions_test",
        r#"
import { UnpackedUnionHolder, UnpackedUnionTail, UnpackedStructHolder } from "./test/unpacked_union/types.js";

const check = (cond: boolean, what: string): void => {
  if (!cond) throw new Error(`check failed: ${what}`);
};
/* [type, bytes, consumed or null, tail or undefined] */
const cases: [any, number[], number | null, number | undefined][] = [
  [UnpackedUnionHolder, [4, 1, 2, 3, 4], 5, undefined],
  [UnpackedUnionHolder, [4, 1, 2, 3], null, undefined],
  [UnpackedUnionHolder, [4, 1, 2, 3, 4, 9, 9], 5, undefined],
  [UnpackedUnionHolder, [1, 9, 0, 0], 4, undefined],
  [UnpackedUnionHolder, [1, 9, 0], null, undefined],
  [UnpackedUnionTail, [7, 4, 1, 2, 3, 4, 0x77], 7, 0x77],
  [UnpackedUnionTail, [7, 4, 1, 2, 3, 4], null, undefined],
  [UnpackedUnionTail, [7, 4, 1, 2, 3, 4, 0x77, 0x99], 7, 0x77],
  [UnpackedUnionTail, [7, 1, 9, 0, 0, 0x77], 6, 0x77],
  [UnpackedStructHolder, [7, 0, 0, 0, 4, 1, 2, 3, 4, 0, 0, 0, 0x77], 10, 0],
  [UnpackedStructHolder, [7, 0, 0, 0, 4, 1, 2, 3, 4, 0, 0, 0], 10, 0],
  [UnpackedStructHolder, [7, 0, 0, 0, 4, 1, 2, 3, 4, 0, 0, 0, 0x77, 0x99], 10, 0],
  [UnpackedStructHolder, [7, 0, 0, 0, 1, 9, 0, 0, 0x77], 9, 0x77],
];
for (const [T, bytes, size, tail] of cases) {
  const b = Uint8Array.from(bytes);
  const r = T.validate(b);
  check(size === null ? !r.ok : r.ok && r.consumed === size, `${T.name} [${bytes}] -> ${size} (got ${r.code} ${r.consumed})`);
  if (size !== null) {
    const v = T.from_array(b);
    check(T.footprintFromParams(v.dynamicParams()) === size, `${T.name} [${bytes}] params footprint`);
    if (tail !== undefined) check(v.get_tail() === tail, `${T.name} [${bytes}] tail`);
  }
}
console.log("unpacked unions ok");
"#,
    );
}

/* Enum tag values past 2^53 stay exact: descriptors, variant lookup,
 * `variant()`, `newVariant` params and builders keep 2^53 and 2^53 + 1
 * apart, for a top-level enum, a struct holding it and an enum field. */
#[test]
fn test_ts_enum_tags_past_2_53_are_exact() {
    let test_dir = setup_test_dir("big_enum_tags");
    let abi = r#"
abi:
  package: "test.big_tags"
  abi-version: 1
  package-version: "1.0.0"
  description: "Enum tags past 2^53"
types:
  - name: "TopBigEnum"
    kind:
      enum:
        packed: true
        tag-ref:
          field-ref:
            path: ["kind"]
        variants:
          - name: "a"
            tag-value: 9007199254740992
            variant-type:
              primitive: u8
          - name: "b"
            tag-value: 9007199254740993
            variant-type:
              struct:
                packed: true
                fields:
                  - name: "w"
                    field-type:
                      primitive: u16
  - name: "BigHolder"
    kind:
      struct:
        packed: true
        fields:
          - name: "kind"
            field-type:
              primitive: u64
          - name: "value"
            field-type:
              type-ref:
                name: "TopBigEnum"
  - name: "FieldBig"
    kind:
      struct:
        packed: true
        fields:
          - name: "kind"
            field-type:
              primitive: u64
          - name: "body"
            field-type:
              enum:
                packed: true
                tag-ref:
                  field-ref:
                    path: ["kind"]
                variants:
                  - name: "a"
                    tag-value: 9007199254740992
                    variant-type:
                      primitive: u8
                  - name: "b"
                    tag-value: 9007199254740993
                    variant-type:
                      struct:
                        packed: true
                        fields:
                          - name: "w"
                            field-type:
                              primitive: u16
"#;
    if !generate_checked_ts(&test_dir, "big_tags", abi, "test.big_tags") {
        return;
    }
    run_ts_script(
        &test_dir,
        "big_tags_test",
        r#"
import { TopBigEnum, BigHolder, FieldBig } from "./test/big_tags/types.js";

const check = (cond: boolean, what: string): void => {
  if (!cond) throw new Error(`check failed: ${what}`);
};
const A = 9007199254740992n;
const B = 9007199254740993n;
const withKind = (kind: bigint, rest: number[]): Uint8Array => {
  const bytes = new Uint8Array(8 + rest.length);
  new DataView(bytes.buffer).setBigUint64(0, kind, true);
  bytes.set(rest, 8);
  return bytes;
};
check(TopBigEnum.variantByTag(B)!.name === "b" && TopBigEnum.variantByTag(A)!.name === "a", "variantByTag");
check(BigInt(TopBigEnum.variantByName("b")!.tag) === B, "descriptor tag is exact");
const nb = TopBigEnum.newVariant("b", Uint8Array.of(1, 2));
check(BigInt(nb.tag()) === B && nb.dynamicParams().TopBigEnum_kind === B, "newVariant params carry the exact tag");
check(nb.variant()!.name === "b" && nb.asB()!.get_w() === 0x0201, "newVariant view");
check(TopBigEnum.new_a(7).dynamicParams().TopBigEnum_kind === A, "new_a");
const viaParams = TopBigEnum.from_array(Uint8Array.of(1, 2), { params: TopBigEnum.Params.fromValues({ TopBigEnum_kind: B }) })!;
check(viaParams.variant()!.name === "b", "from_array with the exact tag");
const holder = BigHolder.from_array(withKind(B, [1, 2]))!;
check(BigHolder.validate(withKind(B, [1, 2])).consumed === 10, "BigHolder b is 10 bytes");
check(holder.get_value().variant()!.name === "b", "BigHolder value variant");
check(BigHolder.validate(withKind(A, [1])).consumed === 9, "BigHolder a is 9 bytes");
check(FieldBig.validate(withKind(B, [1, 2])).consumed === 10, "FieldBig b is 10 bytes");
check(FieldBig.validate(withKind(A, [7, 9])).consumed === 9, "FieldBig a is 9 bytes");
check(!FieldBig.validate(withKind(A + 2n, [7, 9])).ok, "FieldBig undeclared tag");
const f = FieldBig.from_array(withKind(B, [1, 2]))! as any;
check(f.bodyVariant().name === "b", "field variant b");
check(BigInt(FieldBig.bodyVariantDescriptors[1].tag) === B, "field descriptor tag is exact");
check((FieldBig.from_array(withKind(A, [7]))! as any).bodyVariant().name === "a", "field variant a");
const built = FieldBig.builder().body().select("b").writePayload(Uint8Array.of(1, 2)).finish().finish();
check(built.dynamicParams !== undefined, "builder");
console.log("big tags ok");
"#,
    );
}

/* Constructors and builders never return a value `validate` rejects: a
 * size-discriminated union's `new_<variant>` / `newVariant` check the
 * selected payload (an undeclared inner tag throws), a constant union's
 * `new_<variant>` and `from_array` check every variant's tags, and constant
 * struct builders validate at `build` / `buildInto` / `finish`. */
#[test]
fn test_ts_constructors_and_builders_validate() {
    let test_dir = setup_test_dir("ctor_checks");
    let abi = r#"
abi:
  package: "test.ctor_checks"
  abi-version: 1
  package-version: "1.0.0"
  description: "Constructors and builders never return values validate rejects"
types:
  - name: "TagPair"
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
                  - name: "A"
                    tag-value: 0
                    variant-type:
                      primitive: u8
                  - name: "B"
                    tag-value: 1
                    variant-type:
                      primitive: u8
  - name: "TaggedSdu"
    kind:
      size-discriminated-union:
        packed: true
        variants:
          - name: "small"
            expected-size: 1
            variant-type:
              primitive: u8
          - name: "tagged"
            expected-size: 2
            variant-type:
              type-ref:
                name: "TagPair"
  - name: "ConstUnion"
    kind:
      union:
        packed: true
        variants:
          - name: "x"
            variant-type:
              primitive: u16
          - name: "y"
            variant-type:
              type-ref:
                name: "TagPair"
  - name: "Outer"
    kind:
      struct:
        packed: true
        fields:
          - name: "lead"
            field-type:
              primitive: u8
          - name: "inner"
            field-type:
              type-ref:
                name: "TagPair"
          - name: "trail"
            field-type:
              primitive: u8
"#;
    if !generate_checked_ts(&test_dir, "ctor_checks", abi, "test.ctor_checks") {
        return;
    }
    run_ts_script(
        &test_dir,
        "ctor_checks_test",
        r#"
import { TagPair, TaggedSdu, ConstUnion, Outer } from "./test/ctor_checks/types.js";

const check = (cond: boolean, what: string): void => {
  if (!cond) throw new Error(`check failed: ${what}`);
};
const throws = (f: () => unknown, what: string): void => {
  let threw = false;
  try { f(); } catch { threw = true; }
  check(threw, `${what} throws`);
};
const u8 = (...xs: number[]) => Uint8Array.from(xs);

/* Size-discriminated union: the selected payload is checked. */
check(!TaggedSdu.validate(u8(255, 0)).ok, "TaggedSdu rejects an undeclared inner tag");
throws(() => TaggedSdu.new_tagged(u8(255, 0)), "TaggedSdu.new_tagged(undeclared tag)");
throws(() => TaggedSdu.newVariant("tagged", u8(255, 0)), "TaggedSdu.newVariant(undeclared tag)");
const sdu = TaggedSdu.new_tagged(u8(1, 7));
check(TaggedSdu.validate(sdu.bytes()).ok && sdu.asTagged() !== null, "TaggedSdu.new_tagged valid");
check(TaggedSdu.validate(TaggedSdu.new_small(9).bytes()).ok, "TaggedSdu.new_small valid");

/* Constant union: every variant's tags are checked. */
check(!ConstUnion.validate(u8(255, 255)).ok, "ConstUnion rejects y's undeclared tag");
check(ConstUnion.from_array(u8(255, 255)) === null, "ConstUnion.from_array agrees with validate");
throws(() => ConstUnion.new_x(0xffff), "ConstUnion.new_x(undeclared y tag)");
const cu = ConstUnion.new_x(0x0701);
check(ConstUnion.validate(cu.bytes()).ok && cu.get_x() === 0x0701, "ConstUnion.new_x valid");
check(ConstUnion.from_array(u8(0, 3)) !== null, "ConstUnion.from_array valid");

/* Constant struct builder: build / buildInto / finish validate. */
const bad = () => Outer.builder().set_lead(1).set_inner(u8(255, 0)).set_trail(2);
throws(() => bad().build(), "OuterBuilder.build(undeclared tag)");
throws(() => bad().buildInto(new Uint8Array(4)), "OuterBuilder.buildInto(undeclared tag)");
throws(() => bad().finish(), "OuterBuilder.finish(undeclared tag)");
const good = Outer.builder().set_lead(1).set_inner(u8(1, 5)).set_trail(2);
check(Outer.validate(good.build()).ok, "OuterBuilder.build valid");
check(good.finish().get_trail() === 2, "OuterBuilder.finish valid");
check(Outer.validate(good.buildInto(new Uint8Array(6), 1).subarray(1, 5)).ok, "OuterBuilder.buildInto valid");

/* Tagged enum struct builder. */
const pair = TagPair.builder().select_B(u8(5)).build();
check(TagPair.validate(pair).ok && pair[0] === 1, "TagPairBuilder.build valid");
console.log("constructors and builders ok");
"#,
    );
}

/* Generates C, Rust, Go and TypeScript for `abi` (package `package`),
 * validates every input of every type with each, and returns, per backend,
 * `(type, input index) -> "ok:<consumed>" | "err"`. Go is skipped when `go`
 * is missing, unless `ABI_REQUIRE_GO` is set; TypeScript when the vendored
 * tsc is missing, unless `ABI_REQUIRE_TSC` is set. */
fn validate_in_every_backend(
    test_name: &str,
    package: &str,
    abi: &str,
    cases: &[(&str, Vec<Vec<u8>>)],
) -> std::collections::BTreeMap<&'static str, std::collections::BTreeMap<(String, usize), String>> {
    let test_dir = fs::canonicalize(setup_test_dir(test_name)).unwrap();
    let abi_path = test_dir.join("input.abi.yaml");
    fs::write(&abi_path, abi).unwrap();
    let pkg_path = package.replace('.', "/");
    let generate = |lang: &str, out: &Path| {
        let output = Command::new(env!("CARGO_BIN_EXE_abi-gen"))
            .args([
                "codegen",
                "--files",
                abi_path.to_str().unwrap(),
                "--language",
                lang,
                "--output",
            ])
            .arg(out)
            .output()
            .expect("run abi-gen");
        assert!(
            output.status.success(),
            "{lang} codegen failed:\n{}",
            String::from_utf8_lossy(&output.stderr)
        );
    };
    let list = |bytes: &[u8]| {
        bytes
            .iter()
            .map(|x| x.to_string())
            .collect::<Vec<_>>()
            .join(", ")
    };
    let mut results = std::collections::BTreeMap::new();

    /* C */
    let c_dir = test_dir.join("c");
    generate("c", &c_dir);
    let pkg = c_dir.join(&pkg_path);
    let mut main = String::from(
        "#include <stdio.h>\n#include \"types.h\"\nint main( void ) {\n  uint64_t consumed;\n",
    );
    for (ty, inputs) in cases {
        for (i, input) in inputs.iter().enumerate() {
            main.push_str(&format!(
                "  {{ static uint8_t const b[] = {{ {}0 }}; consumed = 0; if( {ty}_validate( b, {n}, &consumed )==0 ) printf( \"{ty} {i} ok:%lu\\n\", (unsigned long)consumed ); else printf( \"{ty} {i} err\\n\" ); }}\n",
                if input.is_empty() { String::new() } else { format!("{}, ", list(input)) },
                n = input.len()
            ));
        }
    }
    main.push_str("  return 0;\n}\n");
    fs::write(pkg.join("main.c"), main).unwrap();
    let cc = std::env::var("CC").unwrap_or_else(|_| "cc".to_string());
    let build = Command::new(&cc)
        .current_dir(&pkg)
        .args(["-std=c11", "-I.", "main.c", "functions.c", "-o", "validate"])
        .output()
        .expect("run cc");
    assert!(
        build.status.success(),
        "C build failed:\n{}",
        String::from_utf8_lossy(&build.stderr)
    );
    let run = Command::new(pkg.join("validate")).output().expect("run C");
    results.insert(
        "C",
        parse_expr_results(&String::from_utf8_lossy(&run.stdout)),
    );

    /* Rust */
    let crate_dir = test_dir.join("rust_crate");
    generate("rust", &crate_dir.join("src/generated"));
    fs::write(
        crate_dir.join("Cargo.toml"),
        "[package]\nname = \"validate_all\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[workspace]\n",
    )
    .unwrap();
    let mut rs = format!(
        "pub mod generated;\nuse generated::{}::*;\nfn main() {{\n",
        package.replace('.', "::")
    );
    for (ty, inputs) in cases {
        for (i, input) in inputs.iter().enumerate() {
            rs.push_str(&format!(
                "    match {ty}::validate(&[{}]) {{ Ok(n) => println!(\"{ty} {i} ok:{{}}\", n), Err(_) => println!(\"{ty} {i} err\") }}\n",
                list(input)
            ));
        }
    }
    rs.push_str("}\n");
    fs::write(crate_dir.join("src/main.rs"), rs).unwrap();
    let run = Command::new("cargo")
        .current_dir(&crate_dir)
        .args(["run", "--quiet"])
        .env_remove("RUSTFLAGS")
        .output()
        .expect("cargo run");
    assert!(
        run.status.success(),
        "Rust build failed:\n{}",
        String::from_utf8_lossy(&run.stderr)
    );
    results.insert(
        "Rust",
        parse_expr_results(&String::from_utf8_lossy(&run.stdout)),
    );

    /* Go */
    let go = std::env::var("GO").unwrap_or_else(|_| "go".to_string());
    let have_go = Command::new(&go)
        .arg("version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    if !have_go && std::env::var_os("ABI_REQUIRE_GO").is_some() {
        panic!("ABI_REQUIRE_GO is set but `{go}` is not available");
    }
    if have_go {
        let go_dir = test_dir.join("go");
        generate("go", &go_dir);
        let mut main = format!(
            "package main\n\nimport (\n\t\"fmt\"\n\n\tP \"{}/{pkg_path}\"\n)\n\nfunc main() {{\n",
            abi_gen::codegen::go::DEFAULT_MODULE
        );
        for (ty, inputs) in cases {
            for (i, input) in inputs.iter().enumerate() {
                main.push_str(&format!(
                    "\tif n, err := P.Validate{g}([]byte{{{}}}); err == nil {{\n\t\tfmt.Printf(\"{ty} {i} ok:%d\\n\", n)\n\t}} else {{\n\t\tfmt.Printf(\"{ty} {i} err\\n\")\n\t}}\n",
                    list(input),
                    g = abi_gen::codegen::go_gen::names::type_name(ty)
                ));
            }
        }
        main.push_str("}\n");
        fs::create_dir_all(go_dir.join("cmd/validate")).unwrap();
        fs::write(go_dir.join("cmd/validate/main.go"), main).unwrap();
        let run = Command::new(&go)
            .current_dir(&go_dir)
            .args(["run", "./cmd/validate"])
            .env("CGO_ENABLED", "0")
            .output()
            .expect("go run");
        assert!(
            run.status.success(),
            "Go build failed:\n{}",
            String::from_utf8_lossy(&run.stderr)
        );
        results.insert(
            "Go",
            parse_expr_results(&String::from_utf8_lossy(&run.stdout)),
        );
    } else {
        println!("WARNING: `{go}` not found; skipping Go (set ABI_REQUIRE_GO to require it).");
    }

    /* TypeScript */
    generate("typescript", &test_dir);
    if !ensure_tsc_available() {
        return results;
    }
    check_typescript_compilation(&test_dir.join(&pkg_path).join("types.ts"))
        .expect("generated TypeScript must type-check");
    let mut ts = format!(
        "import * as M from \"./{pkg_path}/types.js\";\nconst lines: string[] = [];\nconst run = (name: string, i: number, bytes: number[]): void => {{\n  let r: string;\n  try {{\n    const v = (M as any)[name].validate(Uint8Array.from(bytes));\n    r = v.ok ? `ok:${{v.consumed}}` : \"err\";\n  }} catch (e) {{\n    r = \"threw\";\n  }}\n  lines.push(`${{name}} ${{i}} ${{r}}`);\n}};\n"
    );
    for (ty, inputs) in cases {
        for (i, input) in inputs.iter().enumerate() {
            ts.push_str(&format!("run(\"{ty}\", {i}, [{}]);\n", list(input)));
        }
    }
    ts.push_str("console.log(lines.join(\"\\n\"));\n");
    fs::write(test_dir.join("validate_all.ts"), ts).unwrap();
    let compile = Command::new(vendored_tsc())
        .current_dir(&test_dir)
        .args([
            "--strict",
            "--module",
            "NodeNext",
            "--moduleResolution",
            "NodeNext",
            "--target",
            "ES2020",
            "--outDir",
            "dist",
            "validate_all.ts",
        ])
        .output()
        .expect("tsc");
    assert!(
        compile.status.success(),
        "tsc failed:\n{}",
        String::from_utf8_lossy(&compile.stdout)
    );
    let run = Command::new("node")
        .current_dir(&test_dir)
        .arg("dist/validate_all.js")
        .output()
        .expect("node");
    assert!(
        run.status.success(),
        "node failed:\n{}",
        String::from_utf8_lossy(&run.stderr)
    );
    results.insert(
        "TypeScript",
        parse_expr_results(&String::from_utf8_lossy(&run.stdout)),
    );
    results
}

/* Asserts every backend in `results` agrees with C on every input. */
fn assert_backends_agree(
    results: &std::collections::BTreeMap<
        &'static str,
        std::collections::BTreeMap<(String, usize), String>,
    >,
    cases: &[(&str, Vec<Vec<u8>>)],
) {
    let c = &results["C"];
    let mut failures = Vec::new();
    for (ty, inputs) in cases {
        for (i, input) in inputs.iter().enumerate() {
            let key = (ty.to_string(), i);
            let expected = c.get(&key).cloned().unwrap_or_else(|| "missing".into());
            for (backend, got) in results {
                let got = got.get(&key).cloned().unwrap_or_else(|| "missing".into());
                if got != expected {
                    failures.push(format!("{ty} {input:?}: C {expected}, {backend} {got}"));
                }
            }
        }
    }
    assert!(
        failures.is_empty(),
        "backends disagree:\n{}",
        failures.join("\n")
    );
}

/* `sizeof` / `alignof` in a count before an enum tag, and in a tag: the
 * walk that checks the tag resolves them as C, Rust and Go do, so an
 * undeclared tag is rejected; `sizeof` of a variable-size type (or of a
 * name that is not a type, `u32`) is rejected everywhere, and the generated
 * TypeScript type-checks. A top-level enum whose payload holds an enum is
 * walked with its tag as context. Each type gets valid inputs, ones with an
 * undeclared tag and short ones. */
#[test]
fn test_ts_type_constants_in_tag_walk_match_c_rust_and_go() {
    let tail = r#"
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
                  - name: "A"
                    tag-value: 0
                    variant-type:
                      primitive: u16
                  - name: "B"
                    tag-value: 1
                    variant-type:
                      primitive: u16"#;
    let count_type = |name: &str, constant: &str| {
        format!(
            r#"
  - name: "{name}"
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
                packed: true
                size: {{add: {{left: {{field-ref: {{path: ["n"]}}}}, right: {constant}}}}}
                element-type:
                  primitive: u8{tail}"#
        )
    };
    let mut abi = String::from(
        r#"abi:
  package: "test.type_constants"
  abi-version: 1
  package-version: "1.0.0"
  description: "sizeof / alignof before and in enum tags"
types:
  - name: "Four"
    kind:
      struct:
        packed: true
        fields:
          - name: "v"
            field-type:
              primitive: u32
  - name: "Rec"
    kind:
      struct:
        packed: true
        fields:
          - name: "len"
            field-type:
              primitive: u8
          - name: "data"
            field-type:
              array:
                size: {field-ref: {path: ["len"]}}
                element-type:
                  primitive: u8"#,
    );
    abi.push_str(&count_type(
        "SizeofNamed",
        "{sizeof: {type-name: \"Four\"}}",
    ));
    abi.push_str(&count_type(
        "AlignofNamed",
        "{alignof: {type-name: \"Four\"}}",
    ));
    abi.push_str(&count_type(
        "SizeofVariable",
        "{sizeof: {type-name: \"Rec\"}}",
    ));
    abi.push_str(&count_type("SizeofPrim", "{sizeof: {type-name: \"u32\"}}"));
    abi.push_str(
        r#"
  - name: "SizeofTag"
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
                tag-ref: {sub: {left: {field-ref: {path: ["tag"]}}, right: {sizeof: {type-name: "Four"}}}}
                variants:
                  - name: "A"
                    tag-value: 0
                    variant-type:
                      primitive: u16
                  - name: "B"
                    tag-value: 1
                    variant-type:
                      primitive: u16
  - name: "TopNested"
    kind:
      enum:
        packed: true
        tag-ref: {field-ref: {path: ["kind"]}}
        variants:
          - name: "Pair"
            tag-value: 0
            variant-type:
              struct:
                packed: true
                fields:
                  - name: "t"
                    field-type:
                      primitive: u8
                  - name: "e"
                    field-type:
                      enum:
                        packed: true
                        tag-ref: {field-ref: {path: ["t"]}}
                        variants:
                          - name: "X"
                            tag-value: 0
                            variant-type:
                              primitive: u8
                          - name: "Y"
                            tag-value: 1
                            variant-type:
                              primitive: u8
          - name: "Wide"
            tag-value: 1
            variant-type:
              struct:
                packed: true
                fields:
                  - name: "w"
                    field-type:
                      primitive: u16
  - name: "HolderNested"
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
                name: "TopNested"
"#,
    );
    /* n = 1: data is n + 4 (sizeof) or n + 1 (alignof) bytes. */
    let with = |data: usize, tag: u8, body: usize| {
        let mut b = vec![1u8];
        b.extend(std::iter::repeat_n(7u8, data));
        b.push(tag);
        b.extend(std::iter::repeat_n(9u8, body));
        b
    };
    let cases: Vec<(&str, Vec<Vec<u8>>)> = vec![
        (
            "SizeofNamed",
            vec![with(5, 1, 2), with(5, 5, 2), with(5, 1, 1)],
        ),
        (
            "AlignofNamed",
            vec![with(2, 0, 2), with(2, 5, 2), with(2, 0, 1)],
        ),
        (
            "SizeofVariable",
            vec![with(5, 1, 2), with(5, 5, 2), with(5, 1, 1)],
        ),
        (
            "SizeofPrim",
            vec![with(5, 1, 2), with(5, 5, 2), with(5, 1, 1)],
        ),
        (
            "SizeofTag",
            vec![vec![5, 9, 9], vec![9, 9, 9], vec![4, 9], vec![1, 9, 9]],
        ),
        (
            "HolderNested",
            vec![
                vec![0, 1, 5],
                vec![0, 9, 5],
                vec![1, 9, 9],
                vec![2, 0, 0],
                vec![0, 0],
            ],
        ),
    ];
    let results = validate_in_every_backend("type_constants", "test.type_constants", &abi, &cases);
    assert_backends_agree(&results, &cases);
    let Some(ts) = results.get("TypeScript") else {
        return;
    };
    assert_eq!(ts[&("SizeofNamed".to_string(), 0)], "ok:9");
    assert_eq!(ts[&("SizeofNamed".to_string(), 1)], "err");
    /* The top-level enum on its own takes its tag as params, as C's
     * `TopNested_validate( .., ext, .. )` and Go's `ValidateTopNestedWith`. */
    run_ts_script(
        &PathBuf::from(TEST_OUTPUT_DIR).join("type_constants"),
        "top_nested_test",
        r#"
import { TopNested } from "./test/type_constants/types.js";

const check = (cond: boolean, what: string): void => {
  if (!cond) throw new Error(`check failed: ${what}`);
};
const u8 = (...xs: number[]) => Uint8Array.from(xs);
const p = (kind: number) => ({ params: TopNested.Params.fromValues({ TopNested_kind: kind }) });
check(TopNested.validate(u8(1, 5), p(0)).ok, "Pair with a declared inner tag");
check(TopNested.validate(u8(9, 5), p(0)).code === "tn.invalid_tag", "Pair with an undeclared inner tag");
check(TopNested.validate(u8(9, 9), p(1)).ok, "Wide");
check(!TopNested.validate(u8(0, 0), p(2)).ok, "undeclared outer tag");
check(!TopNested.validate(u8(0, 0)).ok, "no params");
check(TopNested.new_Pair(u8(1, 5)).dynamicParams().TopNested_kind === 0n, "new_Pair params");
console.log("top nested ok");
"#,
    );
}

/* Packages whose directories differ only in case (`cases.Foo`,
`cases.foo`) used to share one directory on a case-insensitive file system,
so one package's `types.ts` was lost. Every package now gets its own
directory by the rule shared with the other backends (`cases/foo_`), and the
relative imports between packages follow it: both packages' files exist, the
importer type-checks and validates values of every package. */
#[test]
fn test_ts_package_dirs_never_collide() {
    let test_dir = fs::canonicalize(setup_test_dir("package_dirs")).unwrap();
    generate_ts_code_with_includes(
        "rpc/abi/abi_gen/tests/package_fixtures/paths_user.abi.yaml",
        &["rpc/abi/abi_gen/tests/package_fixtures"],
        &test_dir,
    )
    .expect("codegen");
    for d in [
        "cases/Foo",
        "cases/foo_",
        "a/b_c",
        "a_b/c",
        "tn_abi_runtime",
        "pkguser",
        "paths_user",
    ] {
        assert!(
            test_dir.join(d).join("types.ts").exists(),
            "missing {d}/types.ts"
        );
    }
    let user = fs::read_to_string(test_dir.join("pkguser/types.ts")).unwrap();
    assert!(user.contains("../cases/foo_/types"), "{user}");
    assert!(user.contains("../cases/Foo/types"), "{user}");
    if !ensure_tsc_available() {
        return;
    }
    check_typescript_compilation(&test_dir.join("paths_user/types.ts"))
        .expect("generated TypeScript must type-check");
    run_ts_script(
        &test_dir,
        "package_dirs_test",
        r#"
import { Holder } from "./paths_user/types.js";
import { Upper } from "./cases/Foo/types.js";
import { Lower } from "./cases/foo_/types.js";

const check = (cond: boolean, what: string): void => {
  if (!cond) throw new Error(`check failed: ${what}`);
};
const bytes = Uint8Array.from([1, 2, 3, 4, 5, 6]);
check(Holder.validate(bytes).ok && Holder.validate(bytes).consumed === 6, "holder");
check(Upper.validate(Uint8Array.from([1])).consumed === 1, "upper");
check(Lower.validate(Uint8Array.from([2])).consumed === 1, "lower");
console.log("package dirs ok");
"#,
    );
}

/* A top-level enum whose tag is a constant needs no params; it still gets
`from_array`, its descriptors and `tag()`, and a holder reading it as a
field type-checks and decodes. */
#[test]
fn test_ts_constant_tag_enum_decodes() {
    let test_dir = fs::canonicalize(setup_test_dir("constant_tag_enum")).unwrap();
    generate_ts_code("tests/ts_fixtures/const_tag_enum.abi.yaml", &test_dir)
        .expect("Code generation failed");

    if !ensure_tsc_available() {
        return;
    }

    let ts_script = r#"
import { ConstEnum, Holder, SumTagEnum } from "./test/const_tag_enum/types.js";

const e = ConstEnum.from_array(Uint8Array.from([0x2a]));
if (!e) throw new Error("ConstEnum.from_array returned null");
if (e.tag() !== 0 || e.asZero() !== 42 || e.asOne() !== null) {
  throw new Error(`unexpected enum view: tag=${e.tag()}`);
}
if (ConstEnum.from_array(new Uint8Array(0)) !== null) {
  throw new Error("short buffer accepted");
}
if (ConstEnum.variantByName("one")?.tag !== 1 || ConstEnum.variantDescriptors.length !== 2) {
  throw new Error("descriptors missing");
}
const h = Holder.from_array(Uint8Array.from([0x07, 0x09]));
if (!h) throw new Error("Holder.from_array returned null");
if (h.get_head() !== 7 || h.get_body().asZero() !== 9) {
  throw new Error("holder decode mismatch");
}
const sum = SumTagEnum.from_array(Uint8Array.from([0x05]));
if (!sum || sum.tag() !== 1 || sum.asOne() !== 5 || sum.asZero() !== null) {
  throw new Error("arithmetic constant tag mismatch");
}
console.log("constant tag enum ok");
"#;

    let script_path = test_dir.join("const_tag_enum_test.ts");
    fs::write(&script_path, ts_script.trim()).unwrap();
    let compile_status = Command::new(vendored_tsc())
        .current_dir(&test_dir)
        .args(&[
            "--strict",
            "--module",
            "NodeNext",
            "--moduleResolution",
            "NodeNext",
            "--target",
            "ES2020",
            "--outDir",
            "dist",
            "const_tag_enum_test.ts",
        ])
        .status()
        .expect("Failed to run tsc");
    assert!(compile_status.success(), "tsc failed for constant tag enum");
    let node_status = Command::new("node")
        .current_dir(&test_dir)
        .arg(PathBuf::from("dist").join("const_tag_enum_test.js"))
        .status()
        .expect("Failed to run node");
    assert!(node_status.success(), "node failed for constant tag enum");
}

/* An enum tag nested 20 named structs deep is still checked: validating
the outermost type rejects an undeclared tag. */
#[test]
fn test_ts_deep_enum_tag_is_checked() {
    let test_dir = fs::canonicalize(setup_test_dir("deep_tag_chain")).unwrap();
    generate_ts_code("tests/ts_fixtures/deep_tag_chain.abi.yaml", &test_dir)
        .expect("Code generation failed");

    if !ensure_tsc_available() {
        return;
    }

    let ts_script = r#"
import { Level20 } from "./test/deep_tag_chain/types.js";

if (!Level20.validate(Uint8Array.from([1, 7])).ok) throw new Error("valid tag rejected");
if (Level20.validate(Uint8Array.from([5, 7])).ok) throw new Error("undeclared tag accepted");
if (Level20.from_array(Uint8Array.from([5, 7])) !== null) throw new Error("from_array accepted an undeclared tag");
console.log("deep tag ok");
"#;

    fs::write(test_dir.join("deep_tag_test.ts"), ts_script.trim()).unwrap();
    let compile_status = Command::new(vendored_tsc())
        .current_dir(&test_dir)
        .args(&[
            "--strict",
            "--module",
            "NodeNext",
            "--moduleResolution",
            "NodeNext",
            "--target",
            "ES2020",
            "--outDir",
            "dist",
            "deep_tag_test.ts",
        ])
        .status()
        .expect("Failed to run tsc");
    assert!(compile_status.success(), "tsc failed for deep tag chain");
    let node_status = Command::new("node")
        .current_dir(&test_dir)
        .arg(PathBuf::from("dist").join("deep_tag_test.js"))
        .status()
        .expect("Failed to run node");
    assert!(node_status.success(), "node failed for deep tag chain");
}
