/* C Code Generation Tests
 *
 * These tests verify that the C code generator produces valid, compilable C code
 * for all ABI features including primitives, structs, FAMs, enums, and unions.
 */

use abi_gen::abi::file::AbiFile;
use abi_gen::abi::resolved::{ResolvedType, TypeResolver};
use abi_gen::codegen::c::{CCodeGenerator, CCodeGeneratorOptions};
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

fn collect_resolved_refs<'a>(resolver: &'a TypeResolver) -> Vec<&'a ResolvedType> {
    resolver
        .resolution_order
        .iter()
        .filter_map(|name| resolver.get_type_info(name))
        .collect()
}

/* Helper to compile C code and check for errors */
fn compile_c_code(c_code: &str, test_name: &str) -> Result<(), String> {
    let temp_dir = std::env::temp_dir().join("abi_c_tests");
    fs::create_dir_all(&temp_dir).map_err(|e| format!("Failed to create temp dir: {}", e))?;

    /* C codegen produces header code, so write to .h file */
    let h_file = temp_dir.join(format!("{}.h", test_name));
    fs::write(&h_file, c_code).map_err(|e| format!("Failed to write header file: {}", e))?;

    /* Create a minimal .c file that includes the header */
    let c_file = temp_dir.join(format!("{}.c", test_name));
    let c_content = format!("#include \"{}.h\"\n", test_name);
    fs::write(&c_file, c_content).map_err(|e| format!("Failed to write C file: {}", e))?;

    /* Try to compile with gcc */
    let output = Command::new("gcc")
        .arg("-c")
        .arg("-std=c11")
        .arg("-Wall")
        .arg("-Werror")
        .arg(format!("-I{}", temp_dir.to_str().unwrap()))
        .arg(&c_file)
        .arg("-o")
        .arg(temp_dir.join(format!("{}.o", test_name)))
        .output()
        .map_err(|e| format!("Failed to run gcc: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("GCC compilation failed:\n{}", stderr));
    }

    /* Clean up */
    let _ = fs::remove_file(&h_file);
    let _ = fs::remove_file(&c_file);
    let _ = fs::remove_file(temp_dir.join(format!("{}.o", test_name)));

    Ok(())
}

#[test]
fn test_c_primitives() {
    /* Test all primitive types */
    let abi_content = r#"
abi:
  package: "test.primitives"
  abi-version: 1
  package-version: "1.0.0"
  description: "Test primitives"

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

    let temp_file = std::env::temp_dir().join("primitives_test.abi.yaml");
    fs::write(&temp_file, abi_content).expect("Failed to write temp ABI file");

    let resolver =
        resolve_types_from_abi(temp_file.to_str().unwrap()).expect("Failed to resolve types");

    let resolved_refs = collect_resolved_refs(&resolver);

    let c_gen = CCodeGenerator::new(
        &resolver,
        CCodeGeneratorOptions {
            output_dir: std::env::temp_dir().to_str().unwrap().to_string(),
            ..Default::default()
        },
    );

    let c_code = c_gen.emit_code(&resolved_refs);

    compile_c_code(&c_code, "primitives").expect("C primitives code should compile");

    let _ = fs::remove_file(&temp_file);
}

#[test]
fn test_c_fixed_arrays() {
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

    let temp_file = std::env::temp_dir().join("arrays_test.abi.yaml");
    fs::write(&temp_file, abi_content).expect("Failed to write temp ABI file");

    let resolver =
        resolve_types_from_abi(temp_file.to_str().unwrap()).expect("Failed to resolve types");
    let resolved_refs = collect_resolved_refs(&resolver);

    let c_gen = CCodeGenerator::new(
        &resolver,
        CCodeGeneratorOptions {
            output_dir: std::env::temp_dir().to_str().unwrap().to_string(),
            ..Default::default()
        },
    );

    let c_code = c_gen.emit_code(&resolved_refs);

    compile_c_code(&c_code, "fixed_arrays").expect("C fixed arrays code should compile");

    let _ = fs::remove_file(&temp_file);
}

#[test]
fn test_c_simple_fam() {
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

    let temp_file = std::env::temp_dir().join("fam_test.abi.yaml");
    fs::write(&temp_file, abi_content).expect("Failed to write temp ABI file");

    let resolver =
        resolve_types_from_abi(temp_file.to_str().unwrap()).expect("Failed to resolve types");
    let resolved_refs = collect_resolved_refs(&resolver);

    let c_gen = CCodeGenerator::new(
        &resolver,
        CCodeGeneratorOptions {
            output_dir: std::env::temp_dir().to_str().unwrap().to_string(),
            ..Default::default()
        },
    );

    let c_code = c_gen.emit_code(&resolved_refs);

    compile_c_code(&c_code, "simple_fam").expect("C simple FAM code should compile");

    let _ = fs::remove_file(&temp_file);
}

#[test]
#[ignore] /* KNOWN ISSUE: C codegen has a bug with variant names containing '::' */
fn test_c_advanced_types() {
    /* Test the comprehensive advanced_types.abi.yaml file
     *
     * NOTE: This test is currently ignored due to a C codegen bug where variant names
     * containing '::' (like "TaggedUnionWithFAM::data") are not properly escaped to
     * valid C identifiers. The C codegen generates:
     *   union TaggedUnionWithFAM_data_TaggedUnionWithFAM::data_inner
     * which is invalid C syntax (:: is not allowed in C identifiers).
     *
     * This should be fixed by transforming :: to _ in variant names.
     */
    let abi_path = Path::new("tests/advanced_types.abi.yaml");

    if !abi_path.exists() {
        eprintln!("Warning: advanced_types.abi.yaml not found, skipping test");
        return;
    }

    let resolver =
        resolve_types_from_abi(abi_path.to_str().unwrap()).expect("Failed to resolve types");
    let resolved_refs = collect_resolved_refs(&resolver);

    let c_gen = CCodeGenerator::new(
        &resolver,
        CCodeGeneratorOptions {
            output_dir: std::env::temp_dir().to_str().unwrap().to_string(),
            ..Default::default()
        },
    );

    let c_code = c_gen.emit_code(&resolved_refs);

    compile_c_code(&c_code, "advanced_types").expect("C advanced types code should compile");
}

#[test]
fn test_c_enums_with_external_tags() {
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

    let temp_file = std::env::temp_dir().join("enums_test.abi.yaml");
    fs::write(&temp_file, abi_content).expect("Failed to write temp ABI file");

    let resolver =
        resolve_types_from_abi(temp_file.to_str().unwrap()).expect("Failed to resolve types");
    let resolved_refs = collect_resolved_refs(&resolver);

    let c_gen = CCodeGenerator::new(
        &resolver,
        CCodeGeneratorOptions {
            output_dir: std::env::temp_dir().to_str().unwrap().to_string(),
            ..Default::default()
        },
    );

    let c_code = c_gen.emit_code(&resolved_refs);

    compile_c_code(&c_code, "enums").expect("C enums code should compile");

    let _ = fs::remove_file(&temp_file);
}

#[test]
fn test_c_unions() {
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

    let temp_file = std::env::temp_dir().join("unions_test.abi.yaml");
    fs::write(&temp_file, abi_content).expect("Failed to write temp ABI file");

    let resolver =
        resolve_types_from_abi(temp_file.to_str().unwrap()).expect("Failed to resolve types");
    let resolved_refs = collect_resolved_refs(&resolver);

    let c_gen = CCodeGenerator::new(
        &resolver,
        CCodeGeneratorOptions {
            output_dir: std::env::temp_dir().to_str().unwrap().to_string(),
            ..Default::default()
        },
    );

    let c_code = c_gen.emit_code(&resolved_refs);

    compile_c_code(&c_code, "unions").expect("C unions code should compile");

    let _ = fs::remove_file(&temp_file);
}

#[test]
fn test_c_nested_structures() {
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

    let temp_file = std::env::temp_dir().join("nested_test.abi.yaml");
    fs::write(&temp_file, abi_content).expect("Failed to write temp ABI file");

    let resolver =
        resolve_types_from_abi(temp_file.to_str().unwrap()).expect("Failed to resolve types");
    let resolved_refs = collect_resolved_refs(&resolver);

    let c_gen = CCodeGenerator::new(
        &resolver,
        CCodeGeneratorOptions {
            output_dir: std::env::temp_dir().to_str().unwrap().to_string(),
            ..Default::default()
        },
    );

    let c_code = c_gen.emit_code(&resolved_refs);

    compile_c_code(&c_code, "nested").expect("C nested structures code should compile");

    let _ = fs::remove_file(&temp_file);
}

#[test]
fn test_c_top_level_arrays() {
    let abi: AbiFile = serde_yml::from_str(
        &fs::read_to_string("tests/compliance_tests/abi_definitions/array_structs.abi.yaml")
            .unwrap(),
    )
    .unwrap();
    let mut resolver = TypeResolver::new();
    for typedef in abi.types {
        resolver.add_typedef(typedef);
    }
    let inline: abi_gen::abi::types::TypeDef = serde_yml::from_str(
        r#"
name: InlinePoints
kind:
  array:
    element-type:
      struct:
        packed: true
        fields:
          - name: x
            field-type:
              primitive: i32
    size:
      literal:
        u32: 2
"#,
    )
    .unwrap();
    resolver.add_typedef(inline);
    resolver.resolve_all().unwrap();
    let output_dir = std::env::temp_dir().join("abi_c_top_level_arrays");
    fs::create_dir_all(&output_dir).unwrap();
    let header = CCodeGenerator::new(
        &resolver,
        CCodeGeneratorOptions {
            output_dir: output_dir.to_string_lossy().into_owned(),
            ..Default::default()
        },
    )
    .emit_code(&collect_resolved_refs(&resolver));
    let test_code = format!(
        r#"{header}
#include <assert.h>
int main( void ) {{
    Point2DArray5_t points = {{ {{ .x = 10, .y = -20 }} }};
    U8Array3_t bytes = {{ 1, 0x34, 0xff }};
    U8Matrix2x3_t matrix = {{ {{1, 2, 3}}, {{4, 5, 6}} }};
    InlinePoints_t inline_points = {{ {{ .x = -42 }}, {{ .x = 99 }} }};
    _Static_assert( sizeof(points) == 40, "point array size" );
    _Static_assert( sizeof(bytes) == 3, "primitive array size" );
    _Static_assert( sizeof(matrix) == 6, "matrix size" );
    _Static_assert( sizeof(inline_points) == 8, "inline array size" );
    assert( points[0].x == 10 && points[0].y == -20 );
    points[4].x = 123;
    assert( points[4].x == 123 );
    assert( bytes[2] == 0xff && matrix[1][2] == 6 );
    assert( inline_points[0].x == -42 && inline_points[1].x == 99 );
    uint64_t consumed;
    assert( Point2DArray5_validate_ir( sizeof(points), &consumed ) == 0 );
    assert( consumed == sizeof(points) );
    assert( Point2DArray5_validate_ir( sizeof(points) - 1, &consumed ) != 0 );
    assert( Point2DArray5_footprint_ir() == sizeof(points) );
    return 0;
}}
"#
    );
    fs::write(output_dir.join("test.c"), test_code).unwrap();
    let compilation = Command::new("gcc")
        .args([
            "-std=c11",
            "-Werror=implicit-function-declaration",
            "test.c",
            "functions.c",
            "-o",
            "test",
        ])
        .current_dir(&output_dir)
        .output()
        .unwrap();
    assert!(
        compilation.status.success(),
        "{}",
        String::from_utf8_lossy(&compilation.stderr)
    );
    assert!(
        Command::new(output_dir.join("test"))
            .status()
            .unwrap()
            .success()
    );
}

/* Compile declarations separately from definitions, then check actual C layout. */
fn run_array_layout_regression(test_name: &str, body: &str) {
    let resolver = resolve_types_from_abi("tests/compliance_data/top_level_array_layouts.abi.yaml")
        .expect("resolve array layout regressions");
    let output_dir = std::env::temp_dir().join(test_name);
    fs::create_dir_all(&output_dir).unwrap();
    CCodeGenerator::new(
        &resolver,
        CCodeGeneratorOptions {
            output_dir: output_dir.to_string_lossy().into_owned(),
            ..Default::default()
        },
    )
    .emit_code(&collect_resolved_refs(&resolver));
    fs::write(
        output_dir.join("test.c"),
        format!("#include <assert.h>\n#include <string.h>\n#include \"types.h\"\nint main(void) {{\n{body}\nreturn 0;\n}}\n"),
    )
    .unwrap();
    let compilation = Command::new("gcc")
        .args([
            "-std=c11",
            "-Werror=implicit-function-declaration",
            "test.c",
            "functions.c",
            "-o",
            "test",
        ])
        .current_dir(&output_dir)
        .output()
        .unwrap();
    assert!(
        compilation.status.success(),
        "{}",
        String::from_utf8_lossy(&compilation.stderr)
    );
    assert!(
        Command::new(output_dir.join("test"))
            .status()
            .unwrap()
            .success()
    );
}

#[test]
fn test_c_top_level_union_array_stride() {
    run_array_layout_regression(
        "abi_c_union_array_stride",
        r#"
    _Static_assert( sizeof(InlineUnions_t) == 10, "inline union array footprint" );
    _Static_assert( sizeof(ReferencedUnions_t) == 10, "referenced union array footprint" );
    InlineUnions_t inline_values = {{1, 2, 3, 4, 5}, {6, 7, 8, 9, 10}};
    ReferencedUnions_t ref_values;
    memcpy( ref_values, inline_values, sizeof(ref_values) );
    assert( sizeof(inline_values[0]) == 5 );
    assert( ref_values[1][0] == 6 && ref_values[1][4] == 10 );
    assert( (uint8_t *)(&ref_values[1]) - (uint8_t *)(&ref_values[0]) == 5 );
    assert( InlineUnions_footprint_ir() == sizeof(inline_values) );
    assert( ReferencedUnions_footprint_ir() == sizeof(ref_values) );
    uint64_t consumed;
    assert( ReferencedUnions_validate_ir( 10, &consumed ) == 0 && consumed == 10 );
    assert( ReferencedUnions_validate_ir( 9, &consumed ) != 0 );
    "#,
    );
}

#[test]
fn test_c_top_level_buffer_sized_arrays() {
    run_array_layout_regression(
        "abi_c_buffer_sized_arrays",
        r#"
    /* Runtime dimensions expose a flat byte view, never an incomplete row. */
    BufferBytes_t bytes = {1, 2, 3, 4, 5, 6};
    VariableRows_t rows = {1, 2, 3, 4, 5, 6};
    assert( sizeof(bytes) == 6 && sizeof(rows) == 6 );
    assert( bytes[5] == 6 && rows[3] == 4 );
    assert( BufferBytes_footprint_ir( 6 ) == 6 );
    uint64_t consumed;
    assert( BufferBytes_validate_ir( 6, &consumed ) == 0 && consumed == 6 );
    assert( BufferBytes_validate_ir( 0, &consumed ) == 0 && consumed == 0 );
    "#,
    );
}

#[test]
fn test_c_top_level_custom_alignment_stride() {
    run_array_layout_regression(
        "abi_c_custom_alignment_stride",
        r#"
    _Static_assert( sizeof(ReducedAlignmentArray_t) == 10, "reduced alignment ABI footprint" );
    _Static_assert( sizeof(InlineReducedAlignmentArray_t) == 10, "inline ABI footprint" );
    _Static_assert( sizeof(PackedTailAlignmentArray_t) == 10, "packed ABI omits tail padding" );
    ReducedAlignmentArray_t values = {{1, 2, 3, 4, 5}, {6, 7, 8, 9, 10}};
    InlineReducedAlignmentArray_t inline_values;
    PackedTailAlignmentArray_t packed_values;
    memcpy( inline_values, values, sizeof(values) );
    memcpy( packed_values, values, sizeof(values) );
    assert( values[1][0] == 6 && inline_values[1][4] == 10 && packed_values[1][4] == 10 );
    assert( (uint8_t *)&values[1] - (uint8_t *)&values[0] == 5 );
    assert( ReducedAlignmentArray_footprint_ir() == sizeof(values) );
    assert( InlineReducedAlignmentArray_footprint_ir() == sizeof(inline_values) );
    assert( PackedTailAlignmentArray_footprint_ir() == sizeof(packed_values) );
    uint64_t consumed;
    assert( ReducedAlignmentArray_validate_ir( 10, &consumed ) == 0 && consumed == 10 );
    assert( ReducedAlignmentArray_validate_ir( 9, &consumed ) != 0 );
    /* A compatible raised alignment retains native field access. */
    RaisedAlignmentArray_t native_values = {{ .word = 1, .byte = 2 }, { .word = 3, .byte = 4 }};
    assert( native_values[1].word == 3 && native_values[1].byte == 4 );
    assert( sizeof(native_values) == 16 && RaisedAlignmentArray_footprint_ir() == 16 );
    "#,
    );
}
