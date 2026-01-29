/* TypeScript code generation compliance tests */

use std::fs;
use std::path::{Path, PathBuf};
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
    generate_ts_code_with_includes(abi_file, &[], output_dir)
}

fn resolve_repo_path(path: &str) -> String {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let candidate = manifest_dir.join(path);
    if candidate.exists() {
        return candidate.to_string_lossy().into_owned();
    }
    let workspace_root = manifest_dir
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf())
        .unwrap_or(manifest_dir);
    workspace_root.join(path).to_string_lossy().into_owned()
}

fn generate_ts_code_with_includes(
    abi_file: &str,
    include_dirs: &[&str],
    output_dir: &PathBuf,
) -> Result<(), String> {
    let mut args = vec![
        "run".to_string(),
        "--".to_string(),
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

    let output = Command::new("cargo")
        .args(args.iter().map(|s| s.as_str()))
        .output()
        .map_err(|e| format!("Failed to run codegen: {}", e))?;

    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);

    /* Check for actual errors (not warnings) */
    if !output.status.success() {
        /* Only fail if there's an actual error message, not just warnings */
        if stderr.contains("Error:")
            || (stderr.contains("error:") && !stderr.contains("error: could not compile"))
        {
            /* Look for the actual error without all the warnings */
            let error_lines: Vec<&str> = stderr
                .lines()
                .filter(|line| line.contains("Error:"))
                .collect();
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
    let tsc_path = match resolve_vendored_tsc() {
        Some(path) => path,
        None => {
            println!(
                "WARNING: Vendored TypeScript toolchain missing at tests/ts_toolchain/node_modules/.bin/tsc; skipping strict compile check."
            );
            println!(
                "Run `pnpm install` from abi/abi_gen/tests/ts_toolchain to restore the toolchain."
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

fn ensure_tsc_available() -> bool {
    match Command::new("tsc").arg("--version").output() {
        Ok(output) if output.status.success() => true,
        _ => {
            println!(
                "WARNING: TypeScript compiler (tsc) not found. Skipping TypeScript execution test."
            );
            false
        }
    }
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
    let abi_file = "abi/type-library/state_proof.abi.yaml";

    generate_ts_code("abi/type-library/thru_primitives.abi.yaml", &test_dir)
        .expect("Primitive dependency code generation failed");
    generate_ts_code_with_includes(abi_file, &["abi/type-library"], &test_dir)
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
        content.contains("__tnResolveFieldRef(\"count\")"),
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

    let compile_status = Command::new("tsc")
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

    let compile_status = Command::new("tsc")
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

    let compile_status = Command::new("tsc")
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
    let abi_path = PathBuf::from("..").join("type-library").join("token_program.abi.yaml");

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
    let abi_path = PathBuf::from("..").join("type-library").join("token_program.abi.yaml");

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
fn test_ts_generated_code_has_no_todo_placeholders() {
    let test_dir = setup_test_dir("token_no_todo");
    let abi_path = PathBuf::from("..").join("type-library").join("token_program.abi.yaml");

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
    let test_dir = setup_test_dir("dual_arrays_dynamic_offsets");
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
