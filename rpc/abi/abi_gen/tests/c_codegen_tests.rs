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

fn collect_resolved_refs(resolver: &TypeResolver) -> Vec<&ResolvedType> {
    resolver
        .resolution_order
        .iter()
        .filter_map(|name| resolver.get_type_info(name))
        .collect()
}

/* Per-test output directory (tests run in parallel). */
fn test_dir(test_name: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir().join("abi_c_tests").join(format!(
        "{}-{}",
        test_name,
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("create test dir");
    dir
}

/* Generate types.h/functions.c for every resolved type into a fresh directory. */
fn generate_c(resolver: &TypeResolver, test_name: &str) -> std::path::PathBuf {
    let dir = test_dir(test_name);
    CCodeGenerator::new(
        resolver,
        CCodeGeneratorOptions {
            output_dir: dir.to_string_lossy().into_owned(),
            ..Default::default()
        },
    )
    .emit_code(&collect_resolved_refs(resolver));
    dir
}

/* Names of the functions a generated header declares. */
fn declared_functions(header: &str) -> Vec<String> {
    let mut names = Vec::new();
    for line in header.lines() {
        if line.starts_with(' ')
            || line.starts_with('#')
            || line.starts_with("typedef")
            || line.starts_with("struct")
            || line.starts_with("/*")
            || !line.ends_with(");")
        {
            continue;
        }
        let Some(paren) = line.find('(') else {
            continue;
        };
        let name: String = line[..paren]
            .trim_end()
            .chars()
            .rev()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        if !name.is_empty() {
            names.push(name);
        }
    }
    names.sort();
    names.dedup();
    names
}

/* Compile the generated header and functions.c warning-free as strict C11,
link them with `main_body` (run as `int main( void )`), and run the binary.
A second translation unit takes the address of every declared function so
a declaration without a definition fails the link. */
fn build_and_run(dir: &Path, main_body: &str) -> Result<(), String> {
    build_and_run_packages(dir, &["."], main_body)
}

/* `build_and_run` over the `types.h` / `functions.c` of several package
directories (relative to `dir`), compiled and linked together. */
fn build_and_run_packages(dir: &Path, packages: &[&str], main_body: &str) -> Result<(), String> {
    let mut names = Vec::new();
    let mut includes = String::new();
    for pkg in packages {
        let header =
            fs::read_to_string(dir.join(pkg).join("types.h")).map_err(|e| e.to_string())?;
        names.extend(declared_functions(&header));
        includes.push_str(&format!("#include \"{pkg}/types.h\"\n"));
    }
    names.sort();
    names.dedup();
    let mut refs = String::new();
    for name in &names {
        refs.push_str(&format!("extern void {name}( void );\n"));
    }
    refs.push_str("void ( * volatile tn_test_refs[] )( void ) = {\n");
    for name in &names {
        refs.push_str(&format!("  {name},\n"));
    }
    refs.push_str("  0\n};\n");
    fs::write(dir.join("refs.c"), refs).map_err(|e| e.to_string())?;
    fs::write(
        dir.join("main.c"),
        format!(
            "#include <assert.h>\n#include <string.h>\n{includes}int main( void ) {{\n{main_body}\n  return 0;\n}}\n"
        ),
    )
    .map_err(|e| e.to_string())?;
    let cc = std::env::var("CC").unwrap_or_else(|_| "cc".to_string());
    let strict = &["-std=c11", "-Wall", "-Wextra", "-Werror"][..];
    let mut units: Vec<(String, &[&str])> = packages
        .iter()
        .map(|pkg| (format!("{pkg}/functions.c"), strict))
        .collect();
    units.push((
        "main.c".to_string(),
        &["-std=c11", "-Wall", "-Werror", "-Wno-unused-variable"][..],
    ));
    units.push(("refs.c".to_string(), &["-std=c11", "-w"][..]));
    let mut objects = Vec::new();
    for (idx, (src, flags)) in units.iter().enumerate() {
        let object = format!("unit{idx}.o");
        let output = Command::new(&cc)
            .args(*flags)
            .arg("-c")
            .arg(src)
            .arg("-o")
            .arg(&object)
            .current_dir(dir)
            .output()
            .map_err(|e| format!("failed to run {cc}: {e}"))?;
        if !output.status.success() {
            return Err(format!(
                "{src} failed to compile:\n{}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
        objects.push(object);
    }
    let output = Command::new(&cc)
        .args(&objects)
        .args(["-o", "test"])
        .current_dir(dir)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(format!(
            "link failed:\n{}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    let output = run_with_timeout(&dir.join("test"), std::time::Duration::from_secs(60))?;
    if !output.status.success() {
        return Err(format!(
            "test binary failed:\n{}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }
    Ok(())
}

/* Run a test binary, killing it (and failing) if it runs past `limit`: a
generated loop that never ends must fail the test, not hang it. */
fn run_with_timeout(
    bin: &Path,
    limit: std::time::Duration,
) -> Result<std::process::Output, String> {
    let mut child = Command::new(bin)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let start = std::time::Instant::now();
    loop {
        if child.try_wait().map_err(|e| e.to_string())?.is_some() {
            return child.wait_with_output().map_err(|e| e.to_string());
        }
        if start.elapsed() > limit {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!("test binary ran past {limit:?}"));
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
}

/* Set ABI_C_TESTS_KEEP=1 to keep generated directories for inspection. */
fn cleanup(dir: &Path) {
    if std::env::var_os("ABI_C_TESTS_KEEP").is_none() {
        let _ = fs::remove_dir_all(dir);
    }
}

/* Generated C must compile, link every declared function and run. */
fn compile_c_code(resolver: &TypeResolver, test_name: &str) -> Result<(), String> {
    let dir = generate_c(resolver, test_name);
    build_and_run(&dir, "")?;
    cleanup(&dir);
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

    compile_c_code(&resolver, "primitives").expect("C primitives code should compile");

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
    compile_c_code(&resolver, "fixed_arrays").expect("C fixed arrays code should compile");

    let _ = fs::remove_file(&temp_file);
}

#[test]
fn test_c_advanced_types() {
    /* Inline variant types are named Parent::variant by the resolver; the C
    backend must turn them into valid identifiers. */
    let abi_path = Path::new("tests/advanced_types.abi.yaml");

    assert!(
        abi_path.exists(),
        "tests/advanced_types.abi.yaml is missing"
    );

    let resolver =
        resolve_types_from_abi(abi_path.to_str().unwrap()).expect("Failed to resolve types");
    compile_c_code(&resolver, "advanced_types").expect("C advanced types code should compile");
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

/* ---- Runtime API tests against the compliance ABI definitions ---- */

fn run_compliance_program(abi: &str, test_name: &str, body: &str) {
    let resolver = resolve_types_from_abi(&format!(
        "tests/compliance_tests/abi_definitions/{abi}.abi.yaml"
    ))
    .expect("resolve compliance ABI");
    let dir = generate_c(&resolver, test_name);
    build_and_run(&dir, body).unwrap_or_else(|e| panic!("{test_name}: {e}"));
    cleanup(&dir);
}

#[test]
fn test_c_enum_variant_views_build_and_validate() {
    run_compliance_program(
        "enums",
        "enum_variant_views",
        r#"
  /* Size the buffer from params, then build the Pair variant field by field. */
  SimpleEnum_params_t p;
  memset( &p, 0, sizeof p );
  p.tag = 2;
  uint64_t fp = 0;
  assert( SimpleEnum_footprint_from_params( &p, &fp )==TN_ABI_OK && fp==5 );
  uint8_t buf[ 16 ] = { 0 };
  SimpleEnum_t * e = (SimpleEnum_t *)buf;
  assert( SimpleEnum_body_select_Pair( e )==TN_ABI_OK );
  assert( SimpleEnum_get_body_tag( e )==SimpleEnum_body_TAG_Pair );
  assert( SimpleEnum_body_as_Value( e )==NULL && SimpleEnum_body_as_Bytes( e )==NULL );
  SimpleEnum_body_Pair_t * pair = SimpleEnum_body_as_Pair_mut( e );
  assert( pair );
  assert( SimpleEnum_body_Pair_set_first( pair, 0x1234 )==TN_ABI_OK );
  assert( SimpleEnum_body_Pair_set_second( pair, 0xabcd )==TN_ABI_OK );
  uint8_t const want[ 5 ] = { 2, 0x34, 0x12, 0xcd, 0xab };
  assert( !memcmp( buf, want, 5 ) );
  uint64_t consumed = 0;
  assert( SimpleEnum_validate( buf, fp, &consumed )==TN_ABI_OK && consumed==5 );
  assert( SimpleEnum_from_slice( buf, fp )==(SimpleEnum_t const *)buf );
  assert( SimpleEnum_size( e )==5 );

  /* params extracted by generated code match the inputs. */
  SimpleEnum_params_t q;
  assert( SimpleEnum_params_from_buffer( buf, fp, &q )==TN_ABI_OK && q.tag==2 );

  /* Distinct error codes. */
  assert( SimpleEnum_validate( buf, 4, NULL )==TN_ABI_ERR_SHORT_BUFFER );
  buf[0] = 9;
  assert( SimpleEnum_validate( buf, 5, NULL )==TN_ABI_ERR_BAD_TAG );
  assert( SimpleEnum_get_body_tag( e )==9 && SimpleEnum_body_as_Pair( e )==NULL );
  assert( SimpleEnum_validate( NULL, 5, NULL )==TN_ABI_ERR_INVALID_ARG );

  /* Fixed-array payload. */
  memset( buf, 0, sizeof buf );
  assert( SimpleEnum_body_select_Bytes( e )==TN_ABI_OK );
  SimpleEnum_body_Bytes_t * bytes = SimpleEnum_body_as_Bytes_mut( e );
  assert( SimpleEnum_body_Bytes_get_data_len( bytes )==8 );
  for( uint64_t i=0; i<8; i++ ) assert( SimpleEnum_body_Bytes_set_data_at( bytes, i, (uint8_t)( i+1 ) )==TN_ABI_OK );
  assert( SimpleEnum_body_Bytes_set_data_at( bytes, 8, 0 )==TN_ABI_ERR_INDEX );
  assert( SimpleEnum_validate( buf, 9, &consumed )==TN_ABI_OK && consumed==9 && buf[8]==8 );
"#,
    );
}

#[test]
fn test_c_wide_tags_compare_full_width() {
    run_compliance_program(
        "wide_tag_enums",
        "wide_tags",
        r#"
  uint8_t buf[ 12 ] = { 0x00, 0x00, 0x01, 0x00, 1, 2, 3, 4, 5, 6, 7, 8 };
  U32TagEnum_t const * e = U32TagEnum_from_slice( buf, sizeof buf );
  assert( e );
  assert( U32TagEnum_get_body_tag( e )==65536UL && U32TagEnum_body_TAG_High==65536UL );
  U32TagEnum_body_High_t const * high = U32TagEnum_body_as_High( e );
  assert( high && U32TagEnum_body_High_get_value( high )==0x0807060504030201UL );
  /* 0x00010000 must not alias tag 0 through truncation. */
  assert( U32TagEnum_body_as_Zero( e )==NULL );
  buf[2] = 0x02;
  assert( U32TagEnum_validate( buf, sizeof buf, NULL )==TN_ABI_ERR_BAD_TAG );
"#,
    );
}

#[test]
fn test_c_jagged_array_build_from_params() {
    run_compliance_program(
        "jagged_arrays",
        "jagged_build",
        r#"
  JaggedRecords_params_t p;
  memset( &p, 0, sizeof p );
  p.count = 2;
  p.records.tn_bytes = 3 + 2;
  uint64_t fp = 0;
  assert( JaggedRecords_footprint_from_params( &p, &fp )==TN_ABI_OK && fp==9 );
  uint8_t buf[ 9 ] = { 0 };
  JaggedRecords_t * r = (JaggedRecords_t *)buf;
  assert( JaggedRecords_set_count( r, 2 )==TN_ABI_OK );
  VarRecord_t * r0 = JaggedRecords_get_records_at_mut( r, 0 );
  assert( r0 && VarRecord_set_len( r0, 2 )==TN_ABI_OK );
  assert( VarRecord_set_data_at( r0, 0, 0xaa )==TN_ABI_OK && VarRecord_set_data_at( r0, 1, 0xbb )==TN_ABI_OK );
  /* The second element is located after the first one's runtime size. */
  VarRecord_t * r1 = JaggedRecords_get_records_at_mut( r, 1 );
  assert( (uint8_t *)r1==buf+7 );
  assert( VarRecord_set_len( r1, 1 )==TN_ABI_OK && VarRecord_set_data_at( r1, 0, 0xcc )==TN_ABI_OK );
  assert( JaggedRecords_get_records_at( r, 2 )==NULL );
  uint8_t const want[ 9 ] = { 2, 0, 0, 0, 2, 0xaa, 0xbb, 1, 0xcc };
  assert( !memcmp( buf, want, 9 ) );
  uint64_t consumed = 0;
  assert( JaggedRecords_validate( buf, 9, &consumed )==TN_ABI_OK && consumed==9 );
  JaggedRecords_params_t q;
  assert( JaggedRecords_params_from_buffer( buf, 9, &q )==TN_ABI_OK && q.count==2 && q.records.tn_bytes==5 );
  /* A third record would run past the buffer; a nested record is validated. */
  buf[0] = 3;
  assert( JaggedRecords_validate( buf, 9, NULL )==TN_ABI_ERR_SHORT_BUFFER );
  buf[0] = 2; buf[7] = 5;
  assert( JaggedRecords_validate( buf, 9, NULL )==TN_ABI_ERR_SHORT_BUFFER );
"#,
    );
}

#[test]
fn test_c_nested_refs_params_and_variant_payloads() {
    run_compliance_program(
        "nested_refs",
        "nested_refs_build",
        r#"
  /* The tag comes from hdr.type_slot >> 62 and the FAM size from popcounts of
     hdr.bitset: all extracted by generated code. */
  Proof_params_t p;
  memset( &p, 0, sizeof p );
  p.hdr_type_slot = 1UL<<62;
  p.hdr_bitset_0  = 0x03;
  p.hdr_bitset_1  = 0x01;
  uint64_t fp = 0;
  assert( Proof_footprint_from_params( &p, &fp )==TN_ABI_OK && fp==10+4+12 );
  uint8_t buf[ 26 ] = { 0 };
  Proof_t * proof = (Proof_t *)buf;
  ProofHeader_t * hdr = Proof_get_hdr_mut( proof );
  assert( ProofHeader_set_type_slot( hdr, 1UL<<62 )==TN_ABI_OK );
  ProofHeader_bitset_t * bits = ProofHeader_get_bitset_mut( hdr );
  assert( ProofHeader_bitset_set_at( bits, 0, 0x03 )==TN_ABI_OK && ProofHeader_bitset_set_at( bits, 1, 0x01 )==TN_ABI_OK );
  assert( Proof_get_body_tag( proof )==Proof_body_TAG_updating );
  assert( Proof_body_as_existing( proof, NULL )==NULL );
  Proof_body_updating_params_t vp;
  Proof_body_updating_t * upd = Proof_body_as_updating_mut( proof, &vp );
  assert( upd && vp.hdr_bitset_0==3 && vp.hdr_bitset_1==1 );
  assert( Proof_body_updating_set_leaf( upd, &vp, 7 )==TN_ABI_OK );
  assert( Proof_body_updating_get_siblings_len( upd, &vp )==3 );
  for( uint64_t i=0; i<3; i++ ) assert( Proof_body_updating_set_siblings_at( upd, &vp, i, (uint32_t)( 100+i ) )==TN_ABI_OK );
  assert( Proof_body_updating_set_siblings_at( upd, &vp, 3, 0 )==TN_ABI_ERR_INDEX );
  uint64_t consumed = 0;
  assert( Proof_validate( buf, sizeof buf, &consumed )==TN_ABI_OK && consumed==26 );
  Proof_params_t q;
  assert( Proof_params_from_buffer( buf, sizeof buf, &q )==TN_ABI_OK );
  assert( q.hdr_type_slot==1UL<<62 && q.hdr_bitset_0==3 && q.hdr_bitset_1==1 );
  assert( q.body.updating.siblings.hdr_bitset_0==3 );
  assert( buf[22]==102 );
"#,
    );
}

#[test]
fn test_c_alignment_padding_and_buffer_size() {
    run_compliance_program(
        "fam_alignment",
        "fam_alignment_offsets",
        r#"
  PaddedFam_params_t p;
  memset( &p, 0, sizeof p );
  uint64_t fp = 0;
  assert( PaddedFam_footprint_from_params( &p, &fp )==TN_ABI_OK && fp==8 );
  p.count = 2;
  assert( PaddedFam_footprint_from_params( &p, &fp )==TN_ABI_OK && fp==24 );
  uint8_t buf[ 24 ] = { 0 };
  PaddedFam_t * v = (PaddedFam_t *)buf;
  assert( PaddedFam_set_count( v, 2 )==TN_ABI_OK );
  assert( PaddedFam_set_values_at( v, 1, 0x1122334455667788UL )==TN_ABI_OK );
  assert( buf[16]==0x88 && buf[23]==0x11 );
  assert( PaddedFam_validate( buf, 24, NULL )==TN_ABI_OK );
  assert( PaddedFam_validate( buf, 23, NULL )==TN_ABI_ERR_SHORT_BUFFER );
"#,
    );
    run_compliance_program(
        "buffer_sized",
        "buffer_sized_params",
        r#"
  BufferSizedEntries_params_t p;
  memset( &p, 0, sizeof p );
  p.buf_sz = 20;
  uint64_t fp = 0;
  assert( BufferSizedEntries_footprint_from_params( &p, &fp )==TN_ABI_OK && fp==20 );
  uint8_t buf[ 20 ] = { 1, 0, 0, 0 };
  BufferSizedEntries_t * b = (BufferSizedEntries_t *)buf;
  assert( BufferSizedEntries_get_entries_len( b, &p )==2 );
  assert( BufferSizedEntries_set_entries_at( b, &p, 1, 42 )==TN_ABI_OK && buf[12]==42 );
  uint64_t consumed = 0;
  assert( BufferSizedEntries_validate( buf, 20, &consumed )==TN_ABI_OK && consumed==20 );
  assert( BufferSizedEntries_validate( buf, 3, NULL )==TN_ABI_ERR_SHORT_BUFFER );
"#,
    );
}

#[test]
fn test_c_top_level_enum_union_and_sdu() {
    let abi = r#"
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
              primitive: u32
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
    let path = std::env::temp_dir().join(format!("top_level_{}.abi.yaml", std::process::id()));
    fs::write(&path, abi).unwrap();
    let resolver = resolve_types_from_abi(path.to_str().unwrap()).expect("resolve");
    let _ = fs::remove_file(&path);
    let dir = generate_c(&resolver, "top_level_kinds");
    build_and_run(
        &dir,
        r#"
  /* Top-level enum: the tag is an external input. */
  uint8_t eb[ 2 ] = { 0x34, 0x12 };
  TopEnum_params_t ep;
  memset( &ep, 0, sizeof ep );
  ep.kind = 7;
  uint64_t consumed = 0;
  assert( TopEnum_validate( eb, 2, &ep, &consumed )==TN_ABI_OK && consumed==2 );
  TopEnum_t const * e = TopEnum_from_slice( eb, 2, &ep );
  assert( e && TopEnum_get_tag( e, &ep )==TopEnum_TAG_B );
  assert( TopEnum_as_A( e, &ep )==NULL );
  assert( TopEnum_B_get_x( TopEnum_as_B( e, &ep ) )==0x1234 );
  assert( TopEnum_size( e, &ep )==2 );
  uint64_t fp = 0;
  assert( TopEnum_footprint_from_params( &ep, &fp )==TN_ABI_OK && fp==2 );
  ep.kind = 3;
  assert( TopEnum_validate( eb, 2, &ep, NULL )==TN_ABI_ERR_BAD_TAG );

  /* The same enum as a struct field takes its tag from the sibling field. */
  uint8_t hb[ 2 ] = { 0, 0x55 };
  Holder_t * h = (Holder_t *)hb;
  assert( Holder_validate( hb, 2, &consumed )==TN_ABI_OK && consumed==2 );
  assert( Holder_get_value_tag( h )==TopEnum_TAG_A );
  TopEnum_A_t * a = Holder_value_as_A_mut( h );
  assert( a && TopEnum_A_get( a )==0x55 && TopEnum_A_set( a, 0x66 )==TN_ABI_OK && hb[1]==0x66 );

  /* Top-level SDU: the variant follows the buffer size. */
  uint8_t sb[ 4 ] = { 1, 2, 3, 4 };
  TopSdu_params_t sp;
  memset( &sp, 0, sizeof sp );
  assert( TopSdu_params_from_buffer( sb, 4, &sp )==TN_ABI_OK && sp.buf_sz==4 );
  TopSdu_t const * s = TopSdu_from_slice( sb, 4 );
  assert( s && TopSdu_get_variant( s, &sp )==TopSdu_TAG_big );
  assert( TopSdu_big_get( TopSdu_as_big( s, &sp ) )==0x04030201u );
  assert( TopSdu_as_small( s, &sp )==NULL );
  assert( TopSdu_validate( sb, 3, NULL )==TN_ABI_ERR_BAD_SIZE );
  assert( TopSdu_validate( sb, 1, &consumed )==TN_ABI_OK && consumed==1 );
  assert( TopSdu_footprint( &sp )==4 );

  /* Top-level union: every variant views the same bytes. */
  uint8_t ub[ 4 ] = { 0 };
  TopUnion_t * u = (TopUnion_t *)ub;
  assert( TopUnion_set_word( u, 0x0a0b0c0du )==TN_ABI_OK );
  assert( TopUnion_get_bytes_at( u, 0 )==0x0d && TopUnion_get_bytes_at( u, 3 )==0x0a );
  assert( TopUnion_validate( ub, 4, &consumed )==TN_ABI_OK && consumed==4 );
  assert( TopUnion_validate( ub, 3, NULL )==TN_ABI_ERR_SHORT_BUFFER );
  assert( TopUnion_footprint()==4 && TopUnion_size( u )==4 );
"#,
    )
    .unwrap_or_else(|e| panic!("top-level kinds: {e}"));
    cleanup(&dir);
}

/* A union spans its largest variant; variable-size variants are walked over
the same bytes, and every variant must fit for the buffer to validate. */
#[test]
fn test_c_variable_size_union() {
    let resolver = resolve_types_from_abi("tests/compliance_data/variable_union.abi.yaml")
        .expect("resolve variable union ABI");
    let dir = generate_c(&resolver, "variable_union");
    build_and_run(
        &dir,
        r#"
  uint64_t consumed = 0;
  uint8_t fits[ 7 ] = { 6, 1, 2, 3, 4, 5, 6 };
  assert( VarUnion_validate( fits, sizeof fits, &consumed )==TN_ABI_OK && consumed==7UL );
  /* 'fixed' (4 bytes) is the larger variant here. */
  uint8_t small[ 4 ] = { 1, 0xaa, 0, 0 };
  assert( VarUnion_validate( small, sizeof small, &consumed )==TN_ABI_OK && consumed==4UL );
  /* 'sized' claims 1+42 bytes. */
  uint8_t claims[ 4 ] = { 0x2a, 0, 0, 0 };
  assert( VarUnion_validate( claims, sizeof claims, NULL )==TN_ABI_ERR_SHORT_BUFFER );
  /* 'fixed' needs 4 bytes. */
  uint8_t shortb[ 3 ] = { 2, 0xaa, 0xbb };
  assert( VarUnion_validate( shortb, sizeof shortb, NULL )==TN_ABI_ERR_SHORT_BUFFER );
  VarUnion_t const * u = VarUnion_from_slice( fits, sizeof fits );
  assert( u && VarUnion_size( u )==7UL );
  VarUnion_sized_t const * s = VarUnion_get_sized( u );
  assert( s && VarUnion_sized_get_len( s )==6 && VarUnion_sized_get_data_len( s )==6UL );
  assert( VarUnion_sized_get_data_at( s, 5 )==6 );
  assert( VarUnion_get_fixed( u )==0x03020106U );
"#,
    )
    .unwrap_or_else(|e| panic!("variable_union: {e}"));
    cleanup(&dir);
}

/* On TN_ABI_ERR_SHORT_BUFFER, validate reports the required size when the
bytes present determine it, and 0 otherwise. */
#[test]
fn test_c_validate_reports_required_size() {
    run_compliance_program(
        "enums",
        "required_size_enum",
        r#"
  uint8_t buf[ 5 ] = { 2, 0x34, 0x12, 0xcd, 0xab };
  uint64_t need = 99;
  assert( SimpleEnum_validate( buf, 2, &need )==TN_ABI_ERR_SHORT_BUFFER && need==5 );
  need = 99;
  assert( SimpleEnum_validate( buf, 0, &need )==TN_ABI_ERR_SHORT_BUFFER && need==0 );
  buf[0] = 9;
  need = 99;
  assert( SimpleEnum_validate( buf, 2, &need )==TN_ABI_ERR_BAD_TAG && need==0 );
  buf[0] = 0;
  assert( SimpleEnum_validate( buf, 1, &need )==TN_ABI_OK && need==1 );
"#,
    );
    run_compliance_program(
        "fam_alignment",
        "required_size_fam",
        r#"
  uint8_t buf[ 24 ] = { 2 };
  uint64_t need = 0;
  assert( PaddedFam_validate( buf, 23, &need )==TN_ABI_ERR_SHORT_BUFFER && need==24 );
  /* The count byte alone determines the size. */
  assert( PaddedFam_validate( buf, 1, &need )==TN_ABI_ERR_SHORT_BUFFER && need==24 );
  assert( PaddedFam_validate( buf, 0, &need )==TN_ABI_ERR_SHORT_BUFFER && need==0 );
"#,
    );
    run_compliance_program(
        "jagged_arrays",
        "required_size_jagged",
        r#"
  uint8_t buf[ 9 ] = { 2, 0, 0, 0, 2, 0xaa, 0xbb, 1, 0xcc };
  uint64_t need = 0;
  /* Both record headers are present. */
  assert( JaggedRecords_validate( buf, 8, &need )==TN_ABI_ERR_SHORT_BUFFER && need==9 );
  /* The second record's length byte is missing. */
  assert( JaggedRecords_validate( buf, 6, &need )==TN_ABI_ERR_SHORT_BUFFER && need==0 );
  assert( JaggedRecords_validate( buf, 7, &need )==TN_ABI_ERR_SHORT_BUFFER && need==0 );
"#,
    );
    run_compliance_program(
        "buffer_sized",
        "required_size_buffer_sized",
        r#"
  /* Length-dependent layouts never report a requirement. */
  uint8_t buf[ 20 ] = { 1 };
  uint64_t need = 7;
  assert( BufferSizedEntries_validate( buf, 3, &need )==TN_ABI_ERR_SHORT_BUFFER && need==0 );
"#,
    );
}

/* Builder-API fixture: a header holding the enum tag and the FAM count, a
payload with its own FAM, a top-level SDU and a union. */
const BUILD_API_ABI: &str = r#"
abi:
  package: "test.build_api"
  abi-version: 1
  package-version: "1.0.0"
  description: "C builder API fixture"

types:
  - name: "Hdr"
    kind:
      struct:
        packed: true
        fields:
          - name: "kind"
            field-type:
              primitive: u8
          - name: "count"
            field-type:
              primitive: u16
  - name: "Msg"
    kind:
      struct:
        packed: true
        fields:
          - name: "hdr"
            field-type:
              type-ref:
                name: "Hdr"
          - name: "items"
            field-type:
              array:
                size:
                  field-ref:
                    path: ["hdr", "count"]
                element-type:
                  primitive: u32
          - name: "body"
            field-type:
              enum:
                packed: true
                tag-ref:
                  field-ref:
                    path: ["hdr", "kind"]
                variants:
                  - name: "Ping"
                    tag-value: 0
                    variant-type:
                      struct:
                        packed: true
                        fields: []
                  - name: "Data"
                    tag-value: 1
                    variant-type:
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
                  - name: "Word"
                    tag-value: 5
                    variant-type:
                      primitive: u64
  - name: "Sized"
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
              primitive: u32
  - name: "Either"
    kind:
      union:
        packed: true
        variants:
          - name: "word"
            variant-type:
              primitive: u32
          - name: "half"
            variant-type:
              array:
                size:
                  literal:
                    u32: 2
                element-type:
                  primitive: u16
"#;

fn run_build_api_program(test_name: &str, body: &str) {
    let path = std::env::temp_dir().join(format!(
        "build_api_{test_name}_{}.abi.yaml",
        std::process::id()
    ));
    fs::write(&path, BUILD_API_ABI).unwrap();
    let resolver = resolve_types_from_abi(path.to_str().unwrap()).expect("resolve");
    let _ = fs::remove_file(&path);
    let dir = generate_c(&resolver, test_name);
    build_and_run(&dir, body).unwrap_or_else(|e| panic!("{test_name}: {e}"));
    cleanup(&dir);
}

/* Variant descriptor tables, lookup by name and selection by name. */
#[test]
fn test_c_variant_tables_and_select_by_name() {
    run_build_api_program(
        "variant_tables",
        r#"
  /* Enum field: name, tag, payload size (UINT64_MAX when variable), ABI payload type. */
  assert( Msg_body_VARIANT_CNT==3 );
  assert( !strcmp( Msg_body_variants[0].name, "Ping" ) && Msg_body_variants[0].tag==Msg_body_TAG_Ping );
  assert( Msg_body_variants[0].payload_size==0 );
  assert( Msg_body_variants[1].payload_size==UINT64_MAX );
  assert( Msg_body_variants[2].tag==5 && Msg_body_variants[2].payload_size==8 );
  assert( !strcmp( Msg_body_variants[2].payload_type, "Msg::body::Word" ) );
  assert( Msg_body_variants[3].name==NULL );
  tn_abi_variant_t const * v = Msg_body_variant_by_name( "Data" );
  assert( v==&Msg_body_variants[1] && v->tag==Msg_body_TAG_Data );
  assert( Msg_body_variant_by_name( "data" )==NULL && Msg_body_variant_by_name( NULL )==NULL );

  /* Selecting by name writes the nested tag field hdr.kind. */
  uint8_t buf[ 16 ] = { 0 };
  Msg_t * m = (Msg_t *)buf;
  assert( Msg_body_select_by_name( m, "Word" )==TN_ABI_OK && buf[0]==5 );
  assert( Msg_get_body_tag( m )==Msg_body_TAG_Word );
  assert( Msg_body_select_by_name( m, "Nope" )==TN_ABI_ERR_BAD_TAG && buf[0]==5 );
  assert( Msg_body_select_Ping( m )==TN_ABI_OK && buf[0]==0 );
  assert( Msg_body_as_Ping( m )!=NULL && Msg_body_as_Word( m )==NULL );

  /* Size-discriminated union: the tag is the variant index, the size the expected size. */
  assert( Sized_VARIANT_CNT==2 && Sized_variants[1].tag==Sized_TAG_big && Sized_variants[1].payload_size==4 );
  assert( !strcmp( Sized_variants[0].payload_type, "Sized::small" ) );
  assert( Sized_variant_by_name( "big" )==&Sized_variants[1] );

  /* Union: variant index and size; primitive payloads report the ABI primitive. */
  assert( Either_VARIANT_CNT==2 && Either_variants[0].payload_size==4 && !strcmp( Either_variants[0].payload_type, "u32" ) );
  assert( Either_variant_by_name( "half" )->tag==1 && Either_variants[1].payload_size==4 );
"#,
    );
    run_compliance_program(
        "enums",
        "variant_tables_enums",
        r#"
  uint8_t buf[ 9 ] = { 0 };
  SimpleEnum_t * e = (SimpleEnum_t *)buf;
  for( uint64_t i=0; i<SimpleEnum_body_VARIANT_CNT; i++ ) {
    tn_abi_variant_t const * v = &SimpleEnum_body_variants[i];
    assert( SimpleEnum_body_select_by_name( e, v->name )==TN_ABI_OK );
    assert( SimpleEnum_get_body_tag( e )==v->tag );
    SimpleEnum_params_t p;
    assert( SimpleEnum_params_from_buffer( buf, sizeof buf, &p )==TN_ABI_OK );
    assert( SimpleEnum_footprint( &p )==1+v->payload_size );
  }
"#,
    );
}

/* The params key table names every params member, its ABI path and whether
the caller supplies it; offsets let generic code fill params by path. */
#[test]
fn test_c_param_keys() {
    run_build_api_program(
        "param_keys",
        r#"
  static char const * const want[][ 2 ] = {
    { "hdr_count", "hdr.count" },
    { "hdr_kind", "hdr.kind" },
    { "items.hdr_count", "items.hdr.count" },
    { "body.hdr_kind", "body.hdr.kind" },
    { "body.Data.len", "body.Data.len" },
    { "body.Data.bytes.len", "body.Data.bytes.len" },
  };
  static int const want_input[] = { 1, 1, 0, 0, 1, 0 };
  assert( Msg_PARAM_KEY_CNT==6 && Msg_param_keys[6].member==NULL );
  for( uint64_t i=0; i<Msg_PARAM_KEY_CNT; i++ ) {
    assert( !strcmp( Msg_param_keys[i].member, want[i][0] ) );
    assert( !strcmp( Msg_param_keys[i].path, want[i][1] ) );
    assert( Msg_param_keys[i].input==want_input[i] );
  }
  assert( Msg_param_keys[4].offset==offsetof( Msg_params_t, body.Data.len ) );

  /* Fill the inputs by ABI path and size the value. */
  Msg_params_t p;
  memset( &p, 0, sizeof p );
  static char const * const paths[] = { "hdr.count", "hdr.kind", "body.Data.len" };
  static uint64_t const vals[] = { 2, 1, 3 };
  for( uint64_t j=0; j<3; j++ ) {
    for( uint64_t i=0; i<Msg_PARAM_KEY_CNT; i++ ) {
      if( !strcmp( Msg_param_keys[i].path, paths[j] ) ) {
        uint64_t v = vals[j];
        memcpy( (uint8_t *)&p + Msg_param_keys[i].offset, &v, sizeof v );
      }
    }
  }
  assert( p.hdr_count==2 && p.hdr_kind==1 && p.body.Data.len==3 );
  assert( Msg_footprint( &p )==3+8+1+3 );

  /* Types without inputs still get a (sentinel-only) table. */
  assert( Hdr_PARAM_KEY_CNT==0 && Hdr_param_keys[0].member==NULL );
  /* Length-dependent roots: buf_sz is an input at __buffer_size. */
  assert( Sized_PARAM_KEY_CNT==1 && !strcmp( Sized_param_keys[0].path, "__buffer_size" ) && Sized_param_keys[0].input==1 );
"#,
    );
}

/* T_init sizes, zeroes and writes every field params imply (counts and tag
fields, nested ones too); FAM setters then copy the data at that count. */
#[test]
fn test_c_init_and_fam_setters() {
    run_build_api_program(
        "init_and_setters",
        r#"
  Msg_params_t p;
  memset( &p, 0, sizeof p );
  p.hdr_kind      = Msg_body_TAG_Data;
  p.hdr_count     = 2;
  p.body.Data.len = 3;
  uint8_t buf[ 32 ];
  memset( buf, 0xee, sizeof buf );
  uint64_t sz = 0;
  /* Too small: nothing is written and the required size is reported. */
  assert( Msg_init( buf, 14, &p, &sz )==TN_ABI_ERR_SHORT_BUFFER && sz==15 && buf[0]==0xee );
  assert( Msg_init( NULL, 14, &p, &sz )==TN_ABI_ERR_INVALID_ARG && sz==0 );
  assert( Msg_init( buf, sizeof buf, &p, &sz )==TN_ABI_OK && sz==15 );
  uint8_t const want_init[ 15 ] = { 1, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0 };
  assert( !memcmp( buf, want_init, 15 ) && buf[15]==0xee );
  uint64_t consumed = 0;
  assert( Msg_validate( buf, sz, &consumed )==TN_ABI_OK && consumed==15 );

  /* Fill the payload values at the counts init wrote. */
  Msg_t * m = (Msg_t *)buf;
  uint32_t const items[ 2 ] = { 0x11223344u, 0x55667788u };
  assert( Msg_set_items( m, items, 2 )==TN_ABI_OK );
  assert( Msg_get_items_len( m )==2 && Msg_get_items_at( m, 1 )==0x55667788u );
  Msg_body_Data_t * d = Msg_body_as_Data_mut( m );
  assert( d && Msg_body_Data_set_bytes( d, "xyz", 3 )==TN_ABI_OK );
  uint8_t const want[ 15 ] = { 1, 2, 0, 0x44, 0x33, 0x22, 0x11, 0x88, 0x77, 0x66, 0x55, 3, 'x', 'y', 'z' };
  assert( !memcmp( buf, want, 15 ) );
  assert( Msg_validate( buf, 15, &consumed )==TN_ABI_OK && consumed==15 );
  /* A count the field cannot hold is rejected before anything is written. */
  assert( Msg_set_items( m, items, 70000 )==TN_ABI_ERR_OVERFLOW && buf[1]==2 );
  assert( Msg_set_items( m, NULL, 1 )==TN_ABI_ERR_INVALID_ARG );
  /* Another count would resize the value in place: refused, nothing written. */
  assert( Msg_set_items( m, items, 1 )==TN_ABI_ERR_BAD_SIZE );
  assert( Msg_body_Data_set_bytes( d, NULL, 0 )==TN_ABI_ERR_BAD_SIZE );
  assert( Msg_body_Data_set_bytes( d, "wxyz", 4 )==TN_ABI_ERR_BAD_SIZE );
  assert( !memcmp( buf, want, 15 ) && buf[15]==0xee );

  /* Another variant: the tag is written, the payload left zeroed. */
  p.hdr_kind = Msg_body_TAG_Word;
  p.hdr_count = 0;
  assert( Msg_init( buf, sizeof buf, &p, &sz )==TN_ABI_OK && sz==3+8 );
  assert( buf[0]==5 && buf[1]==0 && Msg_body_as_Word( m )!=NULL );
  /* An unknown tag fails while sizing, before the buffer is touched. */
  p.hdr_kind = 9;
  buf[0] = 0xee;
  assert( Msg_init( buf, sizeof buf, &p, &sz )==TN_ABI_ERR_BAD_TAG && buf[0]==0xee );

  /* Length-dependent root: buf_sz selects the SDU variant. */
  Sized_params_t sp;
  memset( &sp, 0, sizeof sp );
  sp.buf_sz = 4;
  assert( Sized_init( buf, sizeof buf, &sp, &sz )==TN_ABI_OK && sz==4 );
  assert( Sized_validate( buf, sz, &consumed )==TN_ABI_OK && consumed==4 );
"#,
    );
    run_compliance_program(
        "fam_alignment",
        "init_overflow",
        r#"
  /* A params value the field cannot hold is reported, not truncated. */
  static uint8_t big[ 4096 ];
  PaddedFam_params_t p;
  memset( &p, 0, sizeof p );
  p.count = 300;
  uint64_t sz = 0;
  assert( PaddedFam_init( big, sizeof big, &p, &sz )==TN_ABI_ERR_OVERFLOW && sz==8+300*8 );
  p.count = 2;
  assert( PaddedFam_init( big, sizeof big, &p, &sz )==TN_ABI_OK && sz==24 && big[0]==2 );
  uint64_t const vals[ 2 ] = { 7, 9 };
  assert( PaddedFam_set_values( (PaddedFam_t *)big, vals, 2 )==TN_ABI_OK && big[16]==9 );
  assert( PaddedFam_validate( big, 24, NULL )==TN_ABI_OK );
"#,
    );
    run_compliance_program(
        "jagged_arrays",
        "init_jagged",
        r#"
  /* Jagged elements are not described by params: init writes the count and
     the caller sizes and fills each element in order. */
  JaggedRecords_params_t p;
  memset( &p, 0, sizeof p );
  p.count = 2;
  p.records.tn_bytes = 5;
  uint8_t buf[ 9 ];
  uint64_t sz = 0;
  assert( JaggedRecords_init( buf, sizeof buf, &p, &sz )==TN_ABI_OK && sz==9 && buf[0]==2 );
  JaggedRecords_t * r = (JaggedRecords_t *)buf;
  VarRecord_t * r0 = JaggedRecords_get_records_at_mut( r, 0 );
  assert( VarRecord_set_data( r0, "\xaa\xbb", 2 )==TN_ABI_ERR_BAD_SIZE && buf[4]==0 );
  assert( VarRecord_set_len( r0, 2 )==TN_ABI_OK && VarRecord_set_data( r0, "\xaa\xbb", 2 )==TN_ABI_OK );
  VarRecord_t * r1 = JaggedRecords_get_records_at_mut( r, 1 );
  assert( VarRecord_set_len( r1, 1 )==TN_ABI_OK && VarRecord_set_data( r1, "\xcc", 1 )==TN_ABI_OK );
  uint8_t const want[ 9 ] = { 2, 0, 0, 0, 2, 0xaa, 0xbb, 1, 0xcc };
  assert( !memcmp( buf, want, 9 ) );
  assert( JaggedRecords_validate( buf, 9, NULL )==TN_ABI_OK );
"#,
    );
}

/* Whole-value setters of nested struct / type-ref fields and struct union
variants: a constant-size value is copied, a variable-size one is replaced in
place only at its current size and only with bytes that validate. */
#[test]
fn test_c_nested_value_setters() {
    let abi = r#"
abi:
  package: "test.value_setters"
  abi-version: 1
  package-version: "1.0.0"
  description: "Nested value setters"

types:
  - name: "Point"
    kind:
      struct:
        packed: true
        fields:
          - name: "x"
            field-type:
              primitive: u32
          - name: "y"
            field-type:
              primitive: u32
  - name: "Blob"
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
                size:
                  field-ref:
                    path: ["len"]
                element-type:
                  primitive: u8
  - name: "Holder"
    kind:
      struct:
        packed: true
        fields:
          - name: "pt"
            field-type:
              type-ref:
                name: "Point"
          - name: "inl"
            field-type:
              struct:
                packed: true
                fields:
                  - name: "a"
                    field-type:
                      primitive: u16
                  - name: "b"
                    field-type:
                      primitive: u8
          - name: "blob"
            field-type:
              type-ref:
                name: "Blob"
          - name: "tail"
            field-type:
              primitive: u8
  - name: "Clash"
    kind:
      struct:
        packed: true
        fields:
          - name: "v"
            field-type:
              type-ref:
                name: "Blob"
          - name: "v_bytes"
            field-type:
              primitive: u8
  - name: "Choice"
    kind:
      union:
        packed: true
        variants:
          - name: "p"
            variant-type:
              type-ref:
                name: "Point"
          - name: "raw"
            variant-type:
              array:
                size:
                  literal:
                    u32: 8
                element-type:
                  primitive: u8
"#;
    let path = std::env::temp_dir().join(format!("value_setters_{}.abi.yaml", std::process::id()));
    fs::write(&path, abi).unwrap();
    let resolver = resolve_types_from_abi(path.to_str().unwrap()).expect("resolve");
    let _ = fs::remove_file(&path);
    let dir = generate_c(&resolver, "value_setters");
    /* `Clash_set_v_bytes` is the primitive setter of `v_bytes`; the
    variable-size setter of `v` would clash and is omitted. */
    let src = fs::read_to_string(dir.join("functions.c")).unwrap();
    assert!(src.contains("/* Clash_set_v_bytes: name already used, wrapper omitted */"));
    build_and_run(
        &dir,
        r#"
  uint8_t buf[ 32 ];
  memset( buf, 0, sizeof buf );
  Holder_t * h = (Holder_t *)buf;

  /* Constant-size type-ref field: the value's bytes are copied. */
  Point_t v;
  memset( &v, 0, sizeof v );
  assert( Point_set_x( &v, 1 )==TN_ABI_OK && Point_set_y( &v, 2 )==TN_ABI_OK );
  assert( Holder_set_pt( h, &v )==TN_ABI_OK );
  uint8_t const want_pt[ 8 ] = { 1, 0, 0, 0, 2, 0, 0, 0 };
  assert( !memcmp( buf, want_pt, 8 ) );
  assert( Holder_set_pt( h, NULL )==TN_ABI_ERR_INVALID_ARG && Holder_set_pt( NULL, &v )==TN_ABI_ERR_INVALID_ARG );
  assert( Holder_set_pt( h, Holder_get_pt( h ) )==TN_ABI_OK && !memcmp( buf, want_pt, 8 ) );

  /* Inline nested struct. */
  uint8_t const inl[ 3 ] = { 0x34, 0x12, 9 };
  assert( Holder_set_inl( h, (Holder_inl_t const *)inl )==TN_ABI_OK );
  assert( Holder_inl_get_a( Holder_get_inl( h ) )==0x1234 && buf[10]==9 );

  /* Variable-size type-ref field: replaced in place at its current size. */
  Blob_t * blob = Holder_get_blob_mut( h );
  assert( blob && Blob_set_len( blob, 2 )==TN_ABI_OK );
  assert( Holder_set_tail( h, 0x5a )==TN_ABI_OK && buf[14]==0x5a );
  uint8_t const want_blob[ 3 ] = { 2, 0xaa, 0xbb };
  assert( Holder_set_blob_bytes( h, want_blob, 3 )==TN_ABI_OK && !memcmp( buf+11, want_blob, 3 ) );
  /* Another size would move the tail. */
  uint8_t const longer[ 4 ] = { 3, 1, 2, 3 };
  assert( Holder_set_blob_bytes( h, longer, 4 )==TN_ABI_ERR_BAD_SIZE );
  /* Bytes that are not a Blob of that size. */
  uint8_t const short_len[ 3 ] = { 1, 7, 8 };
  assert( Holder_set_blob_bytes( h, short_len, 3 )==TN_ABI_ERR_BAD_SIZE );
  uint8_t const long_len[ 3 ] = { 5, 7, 8 };
  assert( Holder_set_blob_bytes( h, long_len, 3 )==TN_ABI_ERR_SHORT_BUFFER );
  assert( Holder_set_blob_bytes( h, NULL, 3 )==TN_ABI_ERR_INVALID_ARG );
  assert( !memcmp( buf+11, want_blob, 3 ) && buf[14]==0x5a );
  uint64_t consumed = 0;
  assert( Holder_validate( buf, sizeof buf, &consumed )==TN_ABI_OK && consumed==15 );

  /* A struct union variant. */
  uint8_t u[ 8 ] = { 0 };
  assert( Choice_set_p( (Choice_t *)u, &v )==TN_ABI_OK && !memcmp( u, want_pt, 8 ) );
  assert( Choice_get_raw_at( (Choice_t const *)u, 4 )==2 );

  /* The clashing name stays the primitive setter. */
  uint8_t c[ 2 ] = { 0 };
  assert( Clash_set_v_bytes( (Clash_t *)c, 7 )==TN_ABI_OK && c[1]==7 );
"#,
    )
    .unwrap_or_else(|e| panic!("value_setters: {e}"));
    cleanup(&dir);

    /* The child's inputs come from the parent: the nested array is sized by
    the parent's count. */
    run_compliance_program(
        "nested_array_structs",
        "value_setters_params",
        r#"
  uint8_t buf[ 7 ] = { 3, 0, 0, 0, 0, 0, 0 };
  ParentWithNestedArray_t * p = (ParentWithNestedArray_t *)buf;
  uint8_t const data[ 3 ] = { 7, 8, 9 };
  assert( ParentWithNestedArray_set_nested_bytes( p, data, 3 )==TN_ABI_OK && buf[4]==7 && buf[6]==9 );
  assert( ParentWithNestedArray_set_nested_bytes( p, data, 2 )==TN_ABI_ERR_BAD_SIZE );
  assert( ParentWithNestedArray_validate( buf, sizeof buf, NULL )==TN_ABI_OK );
"#,
    );
}

/* ---- Regression tests against fixtures in tests/compliance_data ---- */

fn run_fixture_program(fixture: &str, test_name: &str, body: &str) {
    let resolver = resolve_types_from_abi(&format!("tests/compliance_data/{fixture}.abi.yaml"))
        .unwrap_or_else(|e| panic!("resolve {fixture}: {e}"));
    let dir = generate_c(&resolver, test_name);
    build_and_run(&dir, body).unwrap_or_else(|e| panic!("{test_name}: {e}"));
    cleanup(&dir);
}

/* A variable-size aligned struct ends in padding up to its alignment: the
padded size must fit the buffer, footprint and init must agree on it, and
init must zero the padding. */
#[test]
fn test_c_trailing_padding_needs_bytes() {
    run_fixture_program(
        "trailing_padding_c",
        "trailing_padding",
        r#"
  /* count=0: count@0, kind@2, values@4, tail@4, padded from 5 to 6 bytes. */
  uint8_t tail[ 6 ] = { 0, 0, 0x34, 0x12, 7, 0 };
  uint64_t consumed = 99;
  assert( PadTail_validate( tail, 5, &consumed )==TN_ABI_ERR_SHORT_BUFFER && consumed==6 );
  assert( PadTail_from_slice( tail, 5 )==NULL );
  assert( PadTail_validate( tail, 6, &consumed )==TN_ABI_OK && consumed==6 );

  PadTail_params_t tp;
  memset( &tp, 0, sizeof tp );
  uint64_t fp = 0;
  assert( PadTail_footprint_from_params( &tp, &fp )==TN_ABI_OK && fp==6 );
  assert( PadTail_footprint( &tp )==6 );
  uint8_t tbuf[ 8 ];
  memset( tbuf, 0xee, sizeof tbuf );
  uint64_t sz = 0;
  assert( PadTail_init( tbuf, 5, &tp, &sz )==TN_ABI_ERR_SHORT_BUFFER && sz==6 );
  assert( PadTail_init( tbuf, sizeof tbuf, &tp, &sz )==TN_ABI_OK && sz==6 );
  for( uint64_t i=0; i<6; i++ ) assert( tbuf[i]==0 );
  assert( tbuf[6]==0xee );
  assert( PadTail_validate( tbuf, sz, &consumed )==TN_ABI_OK && consumed==6 );

  /* count=1 (u64) followed by one byte: 9 bytes padded to 16. */
  uint8_t wide[ 16 ] = { 1, 0, 0, 0, 0, 0, 0, 0, 0xaa };
  for( uint64_t len=9; len<16; len++ ) {
    consumed = 0;
    assert( PadWide_validate( wide, len, &consumed )==TN_ABI_ERR_SHORT_BUFFER && consumed==16 );
    PadWide_params_t q;
    assert( PadWide_params_from_buffer( wide, len, &q )==TN_ABI_ERR_SHORT_BUFFER );
  }
  assert( PadWide_validate( wide, 16, &consumed )==TN_ABI_OK && consumed==16 );
  PadWide_params_t wp;
  memset( &wp, 0, sizeof wp );
  wp.count = 1;
  assert( PadWide_footprint( &wp )==16 );
  uint8_t wbuf[ 16 ];
  memset( wbuf, 0xee, sizeof wbuf );
  assert( PadWide_init( wbuf, sizeof wbuf, &wp, &sz )==TN_ABI_OK && sz==16 );
  for( uint64_t i=9; i<16; i++ ) assert( wbuf[i]==0 );
  assert( wbuf[0]==1 && PadWide_validate( wbuf, 16, NULL )==TN_ABI_OK );
"#,
    );
}

/* `..` steps out one struct scope: a child array sized by `["..", "count"]`
reads the enclosing struct's `count` even when the child has its own
`count` field. */
#[test]
fn test_c_parent_scope_refs() {
    run_fixture_program(
        "parent_scope_refs",
        "parent_scope_refs",
        r#"
  /* outer count=3, child count=1: 3 outer-sized bytes, then 1 own-sized byte. */
  uint8_t buf[ 7 ] = { 3, 1, 0xa0, 0xa1, 0xa2, 0xb0, 0xee };
  uint64_t consumed = 0;
  assert( ScopedCount_validate( buf, 6, &consumed )==TN_ABI_OK && consumed==6 );
  assert( ScopedCount_validate( buf, 5, &consumed )==TN_ABI_ERR_SHORT_BUFFER && consumed==6 );
  ScopedCount_t const * s = ScopedCount_from_slice( buf, 6 );
  assert( s && ScopedCount_size( s )==6 );

  /* The outer count flows into the child's params as parent_count. */
  ScopedCount_child_params_t cp;
  ScopedCount_child_t const * c = ScopedCount_get_child( s, &cp );
  assert( c && cp.parent_count==3 );
  assert( ScopedCount_child_get_count( c, &cp )==1 );
  assert( ScopedCount_child_get_outer_sized_len( c, &cp )==3 );
  assert( ScopedCount_child_get_outer_sized_at( c, &cp, 2 )==0xa2 );
  assert( ScopedCount_child_get_own_sized_len( c, &cp )==1 );
  assert( ScopedCount_child_get_own_sized_at( c, &cp, 0 )==0xb0 );
  ScopedCount_params_t q;
  assert( ScopedCount_params_from_buffer( buf, 6, &q )==TN_ABI_OK );
  assert( q.count==3 && q.child.count==1 && q.child.parent_count==3 );
  assert( q.child.outer_sized.parent_count==3 && q.child.own_sized.count==1 );
  assert( ScopedCount_footprint( &q )==6 );

  /* Param keys tell the derived outer value from the child's own field. */
  static char const * const want[][ 2 ] = {
    { "count", "count" },
    { "child.parent_count", "child.../count" },
    { "child.count", "child.count" },
    { "child.outer_sized.parent_count", "child.outer_sized.../count" },
    { "child.own_sized.count", "child.own_sized.count" },
  };
  static int const want_input[] = { 1, 0, 1, 0, 0 };
  assert( ScopedCount_PARAM_KEY_CNT==5 );
  for( uint64_t i=0; i<ScopedCount_PARAM_KEY_CNT; i++ ) {
    assert( !strcmp( ScopedCount_param_keys[i].member, want[i][0] ) );
    assert( !strcmp( ScopedCount_param_keys[i].path, want[i][1] ) );
    assert( ScopedCount_param_keys[i].input==want_input[i] );
  }

  /* Swapped counts move the boundary. */
  uint8_t swapped[ 6 ] = { 1, 3, 0xa0, 0xb0, 0xb1, 0xb2 };
  assert( ScopedCount_validate( swapped, 6, &consumed )==TN_ABI_OK && consumed==6 );
  c = ScopedCount_get_child( (ScopedCount_t const *)swapped, &cp );
  assert( c && ScopedCount_child_get_outer_sized_len( c, &cp )==1 );
  assert( ScopedCount_child_get_own_sized_at( c, &cp, 2 )==0xb2 );

  /* Building from params sizes the child's arrays from both counts. */
  ScopedCount_params_t p;
  memset( &p, 0, sizeof p );
  p.count       = 4;
  p.child.count = 2;
  uint64_t fp = 0;
  assert( ScopedCount_footprint_from_params( &p, &fp )==TN_ABI_OK && fp==8 );
  uint8_t ibuf[ 8 ];
  uint64_t sz = 0;
  assert( ScopedCount_init( ibuf, sizeof ibuf, &p, &sz )==TN_ABI_OK && sz==8 );
  assert( ibuf[0]==4 && ibuf[1]==2 );
  assert( ScopedCount_validate( ibuf, sz, &consumed )==TN_ABI_OK && consumed==8 );

  /* `["..", "..", "n"]` skips two scopes that each have an `n`. */
  uint8_t deep[ 6 ] = { 3, 7, 9, 0xc0, 0xc1, 0xc2 };
  assert( ScopedDeep_validate( deep, 6, &consumed )==TN_ABI_OK && consumed==6 );
  assert( ScopedDeep_validate( deep, 5, NULL )==TN_ABI_ERR_SHORT_BUFFER );
  ScopedDeep_params_t dq;
  assert( ScopedDeep_params_from_buffer( deep, 6, &dq )==TN_ABI_OK );
  assert( dq.n==3 && dq.mid.parent_n==3 && dq.mid.inner.parent_parent_n==3 );
"#,
    );
}

/* A union is valid only when every variant validates over its bytes, so a
fixed-size union whose variant holds an enum tag is walked (not skipped as
plain bytes) wherever it is nested. */
#[test]
fn test_c_nested_union_tags() {
    run_fixture_program(
        "nested_union_tags",
        "nested_union_tags",
        r#"
  /* lead, choice (tag, payload), trail */
  uint8_t buf[ 4 ] = { 9, 1, 7, 3 };
  uint64_t consumed = 0;
  assert( UnionHolder_validate( buf, 4, &consumed )==TN_ABI_OK && consumed==4 );
  buf[1] = 2;
  assert( UnionHolder_validate( buf, 4, NULL )==TN_ABI_OK );
  buf[1] = 5;
  assert( UnionHolder_validate( buf, 4, NULL )==TN_ABI_ERR_BAD_TAG );
  assert( UnionHolder_from_slice( buf, 4 )==NULL );
  buf[1] = 0;
  assert( UnionHolder_validate( buf, 4, NULL )==TN_ABI_ERR_BAD_TAG );
  assert( UnionHolder_validate( buf, 3, NULL )==TN_ABI_ERR_SHORT_BUFFER );

  /* Sizing and building do not depend on which variant is meant. */
  assert( UnionHolder_footprint()==4 );
  UnionHolder_params_t hp;
  memset( &hp, 0, sizeof hp );
  uint64_t fp = 0;
  assert( UnionHolder_footprint_from_params( &hp, &fp )==TN_ABI_OK && fp==4 );
  uint8_t ibuf[ 4 ];
  uint64_t sz = 0;
  assert( UnionHolder_init( ibuf, sizeof ibuf, &hp, &sz )==TN_ABI_OK && sz==4 );
  buf[1] = 5;
  UnionHolder_t const * h = (UnionHolder_t const *)buf;
  assert( UnionHolder_size( h )==4 && UnionHolder_get_trail( h )==3 );

  /* The same holds for unions in arrays and for a top-level union. */
  uint8_t list[ 4 ] = { 1, 7, 2, 8 };
  assert( ChoiceList_validate( list, 4, &consumed )==TN_ABI_OK && consumed==4 );
  list[2] = 6;
  assert( ChoiceList_validate( list, 4, NULL )==TN_ABI_ERR_BAD_TAG );
  assert( TaggedChoice_validate( list, 2, &consumed )==TN_ABI_OK && consumed==2 );
  assert( TaggedChoice_validate( list+2, 2, NULL )==TN_ABI_ERR_BAD_TAG );
"#,
    );
}

/* A union spans its largest variant, so its params carry the inputs of every
variable-size variant (`sized.len`): for every buffer that validates,
params_from_buffer then footprint_from_params gives the consumed size, and
init from those params builds a value of that size. Holds for unions nested
in structs, inline or by type-ref. */
#[test]
fn test_c_variable_union_params() {
    run_fixture_program(
        "variable_union",
        "variable_union_params",
        r#"
  static uint8_t const cases[][ 8 ] = {
    { 4, 0, 0, 0, 0 },          /* sized: 1+4 > fixed: 4 */
    { 6, 1, 2, 3, 4, 5, 6 },    /* sized: 7 */
    { 1, 0xaa, 0, 0 },          /* fixed: 4 > sized: 2 */
    { 3, 9, 8, 7 },             /* both 4 */
  };
  static uint64_t const lens[] = { 5, 7, 4, 4 };
  for( uint64_t i=0; i<4; i++ ) {
    uint64_t consumed = 0;
    assert( VarUnion_validate( cases[i], lens[i], &consumed )==TN_ABI_OK && consumed==lens[i] );
    VarUnion_params_t p;
    assert( VarUnion_params_from_buffer( cases[i], lens[i], &p )==TN_ABI_OK );
    assert( p.sized.len==cases[i][0] );
    uint64_t fp = 0;
    assert( VarUnion_footprint_from_params( &p, &fp )==TN_ABI_OK && fp==consumed );
    assert( VarUnion_footprint( &p )==consumed );
    uint8_t buf[ 16 ];
    memset( buf, 0xee, sizeof buf );
    uint64_t sz = 0;
    assert( VarUnion_init( buf, consumed-1, &p, &sz )==TN_ABI_ERR_SHORT_BUFFER && sz==consumed );
    assert( VarUnion_init( buf, sizeof buf, &p, &sz )==TN_ABI_OK && sz==consumed );
    assert( buf[0]==cases[i][0] && buf[consumed]==0xee );
    assert( VarUnion_validate( buf, sz, &consumed )==TN_ABI_OK && consumed==sz );
  }
  /* Built from params alone: the variable variant's count sizes the union. */
  VarUnion_params_t q;
  memset( &q, 0, sizeof q );
  assert( VarUnion_footprint( &q )==4 );
  q.sized.len = 10;
  assert( VarUnion_footprint( &q )==11 );
  assert( VarUnion_PARAM_KEY_CNT==2 );
  assert( !strcmp( VarUnion_param_keys[0].member, "sized.len" ) );
  assert( !strcmp( VarUnion_param_keys[0].path, "sized.len" ) );
  assert( VarUnion_param_keys[0].input==1 );
  assert( VarUnion_param_keys[0].offset==offsetof( VarUnion_params_t, sized.len ) );
  assert( !strcmp( VarUnion_param_keys[1].member, "sized.data.len" ) );
  assert( VarUnion_param_keys[1].input==0 );
"#,
    );
    run_fixture_program(
        "variable_union_nested",
        "variable_union_nested_params",
        r#"
  uint64_t consumed = 0;
  uint64_t fp       = 0;
  uint64_t sz       = 0;

  /* Two variable-size variants over the same bytes: n=3 gives 4 bytes,
     pad=3 m=1 gives 4 bytes. */
  uint8_t tv[ 4 ] = { 3, 1, 0xaa, 0xbb };
  assert( TwoVar_validate( tv, 4, &consumed )==TN_ABI_OK && consumed==4 );
  TwoVar_params_t tp;
  assert( TwoVar_params_from_buffer( tv, 4, &tp )==TN_ABI_OK );
  assert( tp.bytes.n==3 && tp.halves.m==1 );
  assert( TwoVar_footprint_from_params( &tp, &fp )==TN_ABI_OK && fp==4 );
  /* n=1, m=3: the second variable variant is the largest (2+6). */
  uint8_t tw[ 8 ] = { 1, 3, 0, 0, 0, 0, 0, 0 };
  assert( TwoVar_validate( tw, 8, &consumed )==TN_ABI_OK && consumed==8 );
  assert( TwoVar_params_from_buffer( tw, 8, &tp )==TN_ABI_OK && TwoVar_footprint( &tp )==8 );
  uint8_t tb[ 12 ];
  memset( tb, 0xee, sizeof tb );
  assert( TwoVar_init( tb, sizeof tb, &tp, &sz )==TN_ABI_OK && sz==8 );
  assert( tb[0]==1 && tb[1]==3 && tb[8]==0xee );
  assert( TwoVar_validate( tb, sz, &consumed )==TN_ABI_OK && consumed==8 );
  static char const * const two_keys[] = { "bytes.n", "bytes.xs.n", "halves.m", "halves.ys.m" };
  assert( TwoVar_PARAM_KEY_CNT==4 );
  for( uint64_t i=0; i<4; i++ ) assert( !strcmp( TwoVar_param_keys[i].member, two_keys[i] ) );

  /* A constant-size variant's enum tag does not take part in sizing. */
  uint8_t ts[ 3 ] = { 2, 9, 0xaa };
  assert( TagOrSized_validate( ts, 3, &consumed )==TN_ABI_OK && consumed==3 );
  TagOrSized_params_t sp;
  assert( TagOrSized_params_from_buffer( ts, 3, &sp )==TN_ABI_OK && sp.sized.len==2 );
  assert( TagOrSized_footprint_from_params( &sp, &fp )==TN_ABI_OK && fp==3 );
  memset( &sp, 0, sizeof sp );
  assert( TagOrSized_footprint_from_params( &sp, &fp )==TN_ABI_OK && fp==2 );
  assert( TagOrSized_init( tb, sizeof tb, &sp, &sz )==TN_ABI_OK && sz==2 );

  /* lead, body (inline union: len=5 -> 6 bytes), pair (TwoVar: 4 bytes), trail */
  uint8_t hb[ 12 ] = { 9, 5, 1, 2, 3, 4, 5, 3, 1, 0xaa, 0xbb, 0x77 };
  assert( VarHolder_validate( hb, 12, &consumed )==TN_ABI_OK && consumed==12 );
  assert( VarHolder_validate( hb, 11, NULL )==TN_ABI_ERR_SHORT_BUFFER );
  VarHolder_t const * h = VarHolder_from_slice( hb, 12 );
  assert( h && VarHolder_size( h )==12 && VarHolder_get_trail( h )==0x77 );
  VarHolder_params_t hp;
  assert( VarHolder_params_from_buffer( hb, 12, &hp )==TN_ABI_OK );
  assert( hp.body.sized.len==5 && hp.pair.bytes.n==3 && hp.pair.halves.m==1 );
  assert( VarHolder_footprint_from_params( &hp, &fp )==TN_ABI_OK && fp==12 );
  uint8_t ib[ 20 ];
  memset( ib, 0xee, sizeof ib );
  assert( VarHolder_init( ib, sizeof ib, &hp, &sz )==TN_ABI_OK && sz==12 );
  assert( ib[1]==5 && ib[7]==3 && ib[8]==1 && ib[12]==0xee );
  assert( VarHolder_validate( ib, sz, &consumed )==TN_ABI_OK && consumed==12 );
  /* The fixed variant dominates a short `sized`: body stays 4 bytes. */
  memset( &hp, 0, sizeof hp );
  hp.body.sized.len = 1;
  hp.pair.halves.m  = 3;
  assert( VarHolder_footprint( &hp )==1+4+8+1 );
  assert( VarHolder_init( ib, sizeof ib, &hp, &sz )==TN_ABI_OK && sz==14 );
  assert( VarHolder_validate( ib, sz, &consumed )==TN_ABI_OK && consumed==14 );
  static char const * const holder_keys[][ 2 ] = {
    { "body.sized.len", "body.sized.len" },
    { "body.sized.data.len", "body.sized.data.len" },
    { "pair.bytes.n", "pair.bytes.n" },
    { "pair.bytes.xs.n", "pair.bytes.xs.n" },
    { "pair.halves.m", "pair.halves.m" },
    { "pair.halves.ys.m", "pair.halves.ys.m" },
  };
  static int const holder_input[] = { 1, 0, 1, 0, 1, 0 };
  assert( VarHolder_PARAM_KEY_CNT==6 );
  for( uint64_t i=0; i<6; i++ ) {
    assert( !strcmp( VarHolder_param_keys[i].member, holder_keys[i][0] ) );
    assert( !strcmp( VarHolder_param_keys[i].path, holder_keys[i][1] ) );
    assert( VarHolder_param_keys[i].input==holder_input[i] );
  }
"#,
    );
}

/* A struct field that type-refs a named union with variable-size variants:
the union's params nest in the struct's, and the IR helpers (whose union IR
takes a variant selector the caller does not pass) are left out instead of
emitting a call that does not compile. */
#[test]
fn test_c_variable_union_type_ref_field() {
    let fixture = fs::read_to_string("tests/compliance_data/variable_union_nested.abi.yaml")
        .expect("read variable_union_nested fixture");
    let abi = format!(
        "{fixture}  - name: \"RefHolder\"\n    kind:\n      struct:\n        packed: true\n        fields:\n          - name: \"lead\"\n            field-type:\n              primitive: u8\n          - name: \"pair\"\n            field-type:\n              type-ref:\n                name: \"TwoVar\"\n          - name: \"trail\"\n            field-type:\n              primitive: u8\n"
    );
    let src = test_dir("variable_union_type_ref_src").join("ref_holder.abi.yaml");
    fs::write(&src, abi).expect("write ABI");
    let resolver = resolve_types_from_abi(src.to_str().unwrap()).expect("resolve RefHolder ABI");
    let dir = generate_c(&resolver, "variable_union_type_ref");
    build_and_run(
        &dir,
        r#"
  /* lead, pair (n=1, pad=1 m=3: 2+6 bytes), trail */
  uint8_t buf[ 10 ] = { 9, 1, 3, 0, 0, 0, 0, 0, 0, 0x77 };
  uint64_t consumed = 0;
  assert( RefHolder_validate( buf, 10, &consumed )==TN_ABI_OK && consumed==10 );
  RefHolder_params_t p;
  assert( RefHolder_params_from_buffer( buf, 10, &p )==TN_ABI_OK );
  assert( p.pair.bytes.n==1 && p.pair.halves.m==3 );
  assert( RefHolder_footprint( &p )==10 );
  uint8_t ib[ 12 ];
  uint64_t sz = 0;
  memset( ib, 0xee, sizeof ib );
  assert( RefHolder_init( ib, sizeof ib, &p, &sz )==TN_ABI_OK && sz==10 && ib[10]==0xee );
  assert( RefHolder_validate( ib, sz, &consumed )==TN_ABI_OK && consumed==10 );
  assert( RefHolder_PARAM_KEY_CNT==4 );
  assert( !strcmp( RefHolder_param_keys[2].member, "pair.halves.m" ) );
"#,
    )
    .unwrap_or_else(|e| panic!("variable_union_type_ref: {e}"));
    cleanup(&dir);
    cleanup(src.parent().unwrap());
}

/* An inline enum whose variants differ in size, used as an array element
(every element selected by the same outside tag) or as another enum's
payload, validates, decodes and sizes like any other value. */
#[test]
fn test_c_enum_nesting_variable_variants() {
    run_fixture_program(
        "enum_nesting",
        "enum_nesting",
        r#"
  uint64_t consumed = 0;
  uint64_t fp       = 0;
  uint64_t sz       = 0;

  /* kind=1 (Wide, 4 bytes), count=2, two elements, trail */
  uint8_t wide[ 11 ] = { 1, 2, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99 };
  assert( EnumList_validate( wide, 11, &consumed )==TN_ABI_OK && consumed==11 );
  assert( EnumList_validate( wide, 10, &consumed )==TN_ABI_ERR_SHORT_BUFFER && consumed==11 );
  EnumList_t const * l = EnumList_from_slice( wide, 11 );
  assert( l && EnumList_size( l )==11 && EnumList_get_trail( l )==0x99 );
  assert( EnumList_get_items_len( l )==2 );
  EnumList_items_elem_params_t ep;
  EnumList_items_elem_t const * e = EnumList_get_items_at( l, 1, &ep );
  assert( e && EnumList_items_elem_get_tag( e, &ep )==1 && EnumList_items_elem_size( e, &ep )==4 );
  assert( EnumList_items_elem_as_Small( e, &ep )==NULL );
  assert( EnumList_items_elem_Wide_get( EnumList_items_elem_as_Wide( e, &ep ) )==0x88776655U );
  EnumList_params_t lp;
  assert( EnumList_params_from_buffer( wide, 11, &lp )==TN_ABI_OK && lp.kind==1 && lp.count==2 );
  assert( EnumList_footprint_from_params( &lp, &fp )==TN_ABI_OK && fp==11 );

  /* kind=0 (Small, 1 byte) */
  uint8_t small[ 6 ] = { 0, 3, 0xa, 0xb, 0xc, 0x99 };
  assert( EnumList_validate( small, 6, &consumed )==TN_ABI_OK && consumed==6 );
  e = EnumList_get_items_at( (EnumList_t const *)small, 2, &ep );
  assert( e && EnumList_items_elem_Small_get( EnumList_items_elem_as_Small( e, &ep ) )==0xc );
  assert( EnumList_params_from_buffer( small, 6, &lp )==TN_ABI_OK && EnumList_footprint( &lp )==6 );

  /* An undeclared tag fails; with no elements there is nothing to select. */
  uint8_t badtag[ 4 ] = { 2, 1, 0, 0x99 };
  assert( EnumList_validate( badtag, 4, NULL )==TN_ABI_ERR_BAD_TAG );
  uint8_t empty[ 3 ] = { 2, 0, 0x99 };
  assert( EnumList_validate( empty, 3, &consumed )==TN_ABI_OK && consumed==3 );

  /* Sized and built from the tag and count alone. */
  memset( &lp, 0, sizeof lp );
  lp.kind  = 1;
  lp.count = 3;
  assert( EnumList_footprint( &lp )==15 );
  uint8_t ib[ 20 ];
  memset( ib, 0xee, sizeof ib );
  assert( EnumList_init( ib, sizeof ib, &lp, &sz )==TN_ABI_OK && sz==15 );
  assert( ib[0]==1 && ib[1]==3 && ib[15]==0xee );
  assert( EnumList_validate( ib, sz, &consumed )==TN_ABI_OK && consumed==15 );
  EnumList_items_elem_t * em = EnumList_get_items_at_mut( (EnumList_t *)ib, 2, &ep );
  assert( em && EnumList_items_elem_Wide_set( EnumList_items_elem_as_Wide_mut( em, &ep ), 0xdeadbeefU )==TN_ABI_OK );
  assert( ib[10]==0xef && ib[13]==0xde && ib[14]==0 );

  /* outer=1 (Nested), inner=1 (Quad, 8 bytes), trail */
  uint8_t quad[ 11 ] = { 1, 1, 1, 2, 3, 4, 5, 6, 7, 8, 0x77 };
  assert( EnumInEnum_validate( quad, 11, &consumed )==TN_ABI_OK && consumed==11 );
  EnumInEnum_t const * n = EnumInEnum_from_slice( quad, 11 );
  assert( n && EnumInEnum_size( n )==11 && EnumInEnum_get_trail( n )==0x77 );
  assert( EnumInEnum_get_body_tag( n )==EnumInEnum_body_TAG_Nested );
  assert( EnumInEnum_body_as_Plain( n )==NULL );
  EnumInEnum_body_Nested_params_t np;
  EnumInEnum_body_Nested_t const * nb = EnumInEnum_body_as_Nested( n, &np );
  assert( nb && EnumInEnum_body_Nested_get_tag( nb, &np )==EnumInEnum_body_Nested_TAG_Quad );
  assert( EnumInEnum_body_Nested_size( nb, &np )==8 );
  assert( EnumInEnum_body_Nested_as_Byte( nb, &np )==NULL );
  assert( EnumInEnum_body_Nested_Quad_get( EnumInEnum_body_Nested_as_Quad( nb, &np ) )==0x0807060504030201UL );
  EnumInEnum_params_t xp;
  assert( EnumInEnum_params_from_buffer( quad, 11, &xp )==TN_ABI_OK );
  assert( EnumInEnum_footprint_from_params( &xp, &fp )==TN_ABI_OK && fp==11 );

  /* inner=0 (Byte): the payload shrinks to one byte. */
  uint8_t byte[ 4 ] = { 1, 0, 0x5a, 0x77 };
  assert( EnumInEnum_validate( byte, 4, &consumed )==TN_ABI_OK && consumed==4 );
  assert( EnumInEnum_params_from_buffer( byte, 4, &xp )==TN_ABI_OK && EnumInEnum_footprint( &xp )==4 );
  /* outer=0 (Plain, u16): inner is not read. */
  uint8_t plain[ 5 ] = { 0, 9, 0x34, 0x12, 0x77 };
  assert( EnumInEnum_validate( plain, 5, &consumed )==TN_ABI_OK && consumed==5 );
  assert( EnumInEnum_body_Plain_get( EnumInEnum_body_as_Plain( (EnumInEnum_t const *)plain ) )==0x1234 );
  uint8_t badin[ 4 ] = { 1, 2, 0, 0x77 };
  assert( EnumInEnum_validate( badin, 4, NULL )==TN_ABI_ERR_BAD_TAG );
  assert( EnumInEnum_validate( quad, 10, &consumed )==TN_ABI_ERR_SHORT_BUFFER && consumed==11 );

  /* Built from params: both tags are written. */
  memset( &xp, 0, sizeof xp );
  xp.outer = 1;
  xp.inner = 1;
  memset( ib, 0xee, sizeof ib );
  assert( EnumInEnum_init( ib, sizeof ib, &xp, &sz )==TN_ABI_OK && sz==11 );
  assert( ib[0]==1 && ib[1]==1 && ib[11]==0xee );
  assert( EnumInEnum_validate( ib, sz, &consumed )==TN_ABI_OK && consumed==11 );
"#,
    );
}

/* `__buffer_size` comes from params (`buf_sz`), never from the buffer handed
to init: a value read from 20 bytes is rebuilt as exactly 20 bytes, even in
a larger buffer, whose spare bytes stay untouched. */
#[test]
fn test_c_init_sizes_buffer_sized_arrays_from_params() {
    run_compliance_program(
        "buffer_sized",
        "buffer_sized_init",
        r#"
  /* version, two u64 entries */
  uint8_t val[ 20 ] = { 7, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0 };
  uint64_t consumed = 0;
  assert( BufferSizedEntries_validate( val, 20, &consumed )==TN_ABI_OK && consumed==20 );
  BufferSizedEntries_params_t p;
  assert( BufferSizedEntries_params_from_buffer( val, 20, &p )==TN_ABI_OK && p.buf_sz==20 );
  uint64_t fp = 0;
  assert( BufferSizedEntries_footprint_from_params( &p, &fp )==TN_ABI_OK && fp==20 );
  assert( BufferSizedEntries_footprint( &p )==20 );

  uint8_t buf[ 28 ];
  memset( buf, 0xee, sizeof buf );
  uint64_t sz = 0;
  assert( BufferSizedEntries_init( buf, 19, &p, &sz )==TN_ABI_ERR_SHORT_BUFFER && sz==20 );
  for( uint64_t i=0; i<28; i++ ) assert( buf[i]==0xee );
  assert( BufferSizedEntries_init( buf, sizeof buf, &p, &sz )==TN_ABI_OK && sz==20 );
  for( uint64_t i=0;  i<20; i++ ) assert( buf[i]==0 );
  for( uint64_t i=20; i<28; i++ ) assert( buf[i]==0xee );
  assert( BufferSizedEntries_validate( buf, sz, &consumed )==TN_ABI_OK && consumed==20 );
  BufferSizedEntries_params_t q;
  assert( BufferSizedEntries_params_from_buffer( buf, sz, &q )==TN_ABI_OK && q.buf_sz==20 );
  assert( BufferSizedEntries_get_entries_len( (BufferSizedEntries_t const *)buf, &q )==2 );
"#,
    );
}

/* Kept out of tests/compliance_data: the Rust params round trip sweeps that
directory, and the Rust backend still validates zero-size fixed-stride
elements one by one. */
const ZERO_SIZE_ELEMENTS_ABI: &str = r#"
abi:
  package: "compliance.zero_size_elements"
  abi-version: 1
  package-version: "1.0.0"
  description: "Arrays of zero-size elements: inline enums whose variants are all empty structs"

types:
  - name: "EmptyEnumList"
    kind:
      struct:
        packed: true
        fields:
          - name: "tag"
            field-type:
              primitive: u8
          - name: "count"
            field-type:
              primitive: u64
          - name: "items"
            field-type:
              array:
                size:
                  field-ref:
                    path: ["count"]
                element-type:
                  enum:
                    packed: true
                    tag-ref:
                      field-ref:
                        path: ["tag"]
                    variants:
                      - name: "first"
                        tag-value: 0
                        variant-type:
                          struct:
                            packed: true
                            fields: []
                      - name: "second"
                        tag-value: 1
                        variant-type:
                          struct:
                            packed: true
                            fields: []
"#;

/* Elements of an inline enum whose variants are all empty structs take no
bytes: a 9-byte value may declare UINT64_MAX of them. Validation checks the
shared tag once instead of once per element, and sizing, init and the element
accessors never walk the elements. */
#[test]
fn test_c_zero_size_elements() {
    let path = std::env::temp_dir().join(format!(
        "zero_size_elements_{}.abi.yaml",
        std::process::id()
    ));
    fs::write(&path, ZERO_SIZE_ELEMENTS_ABI).unwrap();
    let resolver = resolve_types_from_abi(path.to_str().unwrap()).expect("resolve");
    let _ = fs::remove_file(&path);
    let dir = generate_c(&resolver, "zero_size_elements");
    build_and_run(
        &dir,
        r#"
  /* tag=1, count=UINT64_MAX, no element bytes */
  uint8_t buf[ 9 ] = { 1, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff };
  uint64_t consumed = 0;
  assert( EmptyEnumList_validate( buf, 9, &consumed )==TN_ABI_OK && consumed==9 );
  /* The count is cut short: the required size is unknown. */
  assert( EmptyEnumList_validate( buf, 8, &consumed )==TN_ABI_ERR_SHORT_BUFFER && consumed==0 );
  EmptyEnumList_t const * l = EmptyEnumList_from_slice( buf, 9 );
  assert( l && EmptyEnumList_size( l )==9 );
  assert( EmptyEnumList_get_items_len( l )==UINT64_MAX );
  EmptyEnumList_items_elem_params_t ep;
  EmptyEnumList_items_elem_t const * e = EmptyEnumList_get_items_at( l, UINT64_MAX-1UL, &ep );
  assert( e==(EmptyEnumList_items_elem_t const *)( buf+9 ) );
  assert( EmptyEnumList_items_elem_get_tag( e, &ep )==1 );
  assert( EmptyEnumList_items_elem_as_second( e, &ep )!=NULL );
  assert( EmptyEnumList_items_elem_as_first( e, &ep )==NULL );
  EmptyEnumList_params_t p;
  assert( EmptyEnumList_params_from_buffer( buf, 9, &p )==TN_ABI_OK );
  assert( p.tag==1 && p.count==UINT64_MAX && EmptyEnumList_footprint( &p )==9 );

  /* An undeclared tag fails; with no elements there is nothing to select. */
  buf[0] = 2;
  assert( EmptyEnumList_validate( buf, 9, NULL )==TN_ABI_ERR_BAD_TAG );
  uint8_t none[ 9 ] = { 2 };
  assert( EmptyEnumList_validate( none, 9, &consumed )==TN_ABI_OK && consumed==9 );

  /* Built from params alone. */
  memset( &p, 0, sizeof p );
  p.tag   = 0;
  p.count = UINT64_MAX;
  uint8_t ib[ 12 ];
  memset( ib, 0xee, sizeof ib );
  uint64_t sz = 0;
  assert( EmptyEnumList_init( ib, sizeof ib, &p, &sz )==TN_ABI_OK && sz==9 );
  assert( ib[0]==0 && ib[1]==0xff && ib[8]==0xff && ib[9]==0xee );
  assert( EmptyEnumList_validate( ib, sz, &consumed )==TN_ABI_OK && consumed==9 );
"#,
    )
    .unwrap_or_else(|e| panic!("zero_size_elements: {e}"));
    cleanup(&dir);
}

/* A jagged array of zero-byte elements (`JaggedEmptyList`, tag 0): each
element starts where the previous one did with the same inputs, so one stands
for all of them however large the count, as in the Rust and Go backends. It
needs no bytes (validate, the element locator and footprint do not loop over
the count); one-byte elements (tag 1) still need theirs. */
#[test]
fn test_c_jagged_zero_size_elements() {
    run_fixture_program(
        "zero_size_elements",
        "jagged_zero_size_elements",
        r#"
  uint8_t buf[ 10 ] = { 0, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x77 };
  uint64_t consumed = 0;
  assert( JaggedEmptyList_validate( buf, 9, &consumed )==TN_ABI_OK && consumed==9 );
  assert( JaggedEmptyList_validate( buf, 10, &consumed )==TN_ABI_OK && consumed==9 );
  JaggedEmptyList_t const * l = JaggedEmptyList_from_slice( buf, 9 );
  assert( l && JaggedEmptyList_get_items_len( l )==UINT64_MAX );
  JaggedEmptyList_items_elem_params_t ep;
  JaggedEmptyList_items_elem_t const * e = JaggedEmptyList_get_items_at( l, UINT64_MAX-1UL, &ep );
  assert( e==(JaggedEmptyList_items_elem_t const *)( buf+9 ) );
  JaggedEmptyList_params_t p;
  assert( JaggedEmptyList_params_from_buffer( buf, 9, &p )==TN_ABI_OK );
  uint64_t fp = 0;
  assert( JaggedEmptyList_footprint_from_params( &p, &fp )==TN_ABI_OK && fp==9 );

  /* One count of zero-byte elements and a stray byte after them. */
  uint8_t one[ 10 ] = { 0, 1, 0, 0, 0, 0, 0, 0, 0, 0x77 };
  assert( JaggedEmptyList_validate( one, 10, &consumed )==TN_ABI_OK && consumed==9 );

  /* One-byte elements need their bytes. */
  uint8_t two[ 11 ] = { 1, 2, 0, 0, 0, 0, 0, 0, 0, 5, 6 };
  assert( JaggedEmptyList_validate( two, 11, &consumed )==TN_ABI_OK && consumed==11 );
  assert( JaggedEmptyList_validate( two, 10, &consumed )==TN_ABI_ERR_SHORT_BUFFER );
  buf[0] = 1;
  assert( JaggedEmptyList_validate( buf, 10, &consumed )==TN_ABI_ERR_SHORT_BUFFER );
"#,
    );
}

/* A later field sized by a field of a nested struct that follows
variable-size data (`child.count` after `child.bytes`): the child's walker
reads the value into its params (`child.count`), where the outer layout,
params_from_buffer, footprint_from_params and init find it. */
#[test]
fn test_c_nested_ref_after_variable_data() {
    run_fixture_program(
        "nested_count_after_bytes",
        "nested_count_after_bytes",
        r#"
  uint64_t consumed = 0;
  uint64_t sz       = 0;
  /* child: n=2, bytes, count=3; items: 3 x u16; tail */
  uint8_t buf[ 11 ] = { 2, 0xa, 0xb, 3, 1, 0, 2, 0, 0x34, 0x12, 0x99 };
  assert( NestedCount_validate( buf, 11, &consumed )==TN_ABI_OK && consumed==11 );
  assert( NestedCount_validate( buf, 10, &consumed )==TN_ABI_ERR_SHORT_BUFFER && consumed==11 );
  /* The count itself is missing: the required size is unknown. */
  assert( NestedCount_validate( buf, 3, &consumed )==TN_ABI_ERR_SHORT_BUFFER && consumed==0 );
  NestedCount_t const * v = NestedCount_from_slice( buf, 11 );
  assert( v && NestedCount_size( v )==11 );
  assert( NestedCount_get_items_len( v )==3 && NestedCount_get_items_at( v, 2 )==0x1234 );
  assert( NestedCount_get_tail( v )==0x99 );
  assert( NestedCount_child_get_count( NestedCount_get_child( v ) )==3 );
  NestedCount_params_t p;
  assert( NestedCount_params_from_buffer( buf, 11, &p )==TN_ABI_OK );
  assert( p.child.n==2 && p.child.count==3 && NestedCount_footprint( &p )==11 );
  uint64_t k = 0;
  while( k<NestedCount_PARAM_KEY_CNT && strcmp( NestedCount_param_keys[k].member, "child.count" ) ) k++;
  assert( k<NestedCount_PARAM_KEY_CNT && NestedCount_param_keys[k].input==1 );
  assert( !strcmp( NestedCount_param_keys[k].path, "child.count" ) );

  /* Built from params: both counts are written. */
  memset( &p, 0, sizeof p );
  p.child.n     = 1;
  p.child.count = 2;
  uint8_t ib[ 16 ];
  memset( ib, 0xee, sizeof ib );
  assert( NestedCount_init( ib, sizeof ib, &p, &sz )==TN_ABI_OK && sz==8 );
  assert( ib[0]==1 && ib[2]==2 && ib[7]==0 && ib[8]==0xee );
  assert( NestedCount_validate( ib, sz, &consumed )==TN_ABI_OK && consumed==8 );
  /* A count the field cannot hold is reported, not truncated. */
  static uint8_t big[ 1024 ];
  p.child.count = 300;
  assert( NestedCount_init( big, sizeof big, &p, &sz )==TN_ABI_ERR_OVERFLOW && sz==1+1+1+600+1 );

  /* Through a named child type. */
  uint8_t nb[ 7 ] = { 1, 0xa, 3, 7, 8, 9, 0x99 };
  assert( NamedCount_validate( nb, 7, &consumed )==TN_ABI_OK && consumed==7 );
  assert( NamedCount_validate( nb, 6, &consumed )==TN_ABI_ERR_SHORT_BUFFER && consumed==7 );
  assert( NamedCount_get_items_at( (NamedCount_t const *)nb, 2 )==9 );
  NamedCount_params_t np;
  assert( NamedCount_params_from_buffer( nb, 7, &np )==TN_ABI_OK && np.child.count==3 );
  assert( NamedCount_footprint( &np )==7 );
  memset( &np, 0, sizeof np );
  np.child.n     = 2;
  np.child.count = 1;
  assert( NamedCount_init( ib, sizeof ib, &np, &sz )==TN_ABI_OK && sz==6 );
  assert( ib[0]==2 && ib[3]==1 && NamedCount_validate( ib, sz, NULL )==TN_ABI_OK );
  assert( CountChild_validate( nb, 3, &consumed )==TN_ABI_OK && consumed==3 );

  /* Two dynamic offsets deep. */
  uint8_t db[ 9 ] = { 0x55, 1, 0xf0, 1, 0xf1, 2, 0xc0, 0xc1, 0xee };
  assert( DeepCount_validate( db, 8, &consumed )==TN_ABI_OK && consumed==8 );
  assert( DeepCount_validate( db, 7, &consumed )==TN_ABI_ERR_SHORT_BUFFER && consumed==8 );
  assert( DeepCount_get_items_at( (DeepCount_t const *)db, 1 )==0xc1 );
  DeepCount_params_t dp;
  assert( DeepCount_params_from_buffer( db, 8, &dp )==TN_ABI_OK );
  assert( dp.outer.m==1 && dp.outer.inner.k==1 && dp.outer.inner.count==2 );
  assert( DeepCount_footprint( &dp )==8 );
  memset( &dp, 0, sizeof dp );
  dp.outer.m           = 2;
  dp.outer.inner.k     = 0;
  dp.outer.inner.count = 3;
  assert( DeepCount_init( ib, sizeof ib, &dp, &sz )==TN_ABI_OK && sz==1+1+2+1+1+3 );
  assert( ib[1]==2 && ib[4]==0 && ib[5]==3 && DeepCount_validate( ib, sz, NULL )==TN_ABI_OK );
"#,
    );
}

/* The same through a named child imported from another package (two ABI
files, generated together with an include dir): the child's params carry
`count` because an importer in the generated set reads it, so both
packages compile and link together and every entry point works. */
#[test]
fn test_c_imported_nested_ref_after_variable_data() {
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/cross_package");
    let dir = test_dir("imported_nested_count");
    abi_gen::cmds::codegen::run(
        vec![fixtures.join("count_user.abi.yaml")],
        vec![fixtures.clone()],
        abi_gen::cmds::codegen::Language::C,
        dir.clone(),
        false,
    )
    .expect("codegen cross_package");
    let child = "compliance/cross_package/child";
    let user = "compliance/cross_package/user";
    let child_src = fs::read_to_string(dir.join(child).join("functions.c")).unwrap();
    let user_src = fs::read_to_string(dir.join(user).join("functions.c")).unwrap();
    assert!(
        !child_src.contains("unsupported") && !user_src.contains("unsupported"),
        "imported child reference must be supported"
    );
    build_and_run_packages(
        &dir,
        &[child, user],
        r#"
  uint64_t consumed = 0;
  uint64_t sz       = 0;
  /* child: n=2, bytes, count=3; items: 3 x u16; tail */
  uint8_t buf[ 11 ] = { 2, 0xa, 0xb, 3, 1, 0, 2, 0, 0x34, 0x12, 0x99 };
  assert( ImportedCount_validate( buf, 11, &consumed )==TN_ABI_OK && consumed==11 );
  assert( ImportedCount_validate( buf, 10, &consumed )==TN_ABI_ERR_SHORT_BUFFER && consumed==11 );
  assert( ImportedCount_validate( buf, 3, &consumed )==TN_ABI_ERR_SHORT_BUFFER && consumed==0 );
  ImportedCount_t const * v = ImportedCount_from_slice( buf, 11 );
  assert( v && ImportedCount_size( v )==11 );
  assert( ImportedCount_get_items_len( v )==3 && ImportedCount_get_items_at( v, 2 )==0x1234 );
  assert( ImportedCount_get_tail( v )==0x99 );
  ImportedCount_params_t p;
  uint64_t fp = 0;
  assert( ImportedCount_params_from_buffer( buf, 11, &p )==TN_ABI_OK );
  assert( p.child.n==2 && p.child.count==3 );
  assert( ImportedCount_footprint_from_params( &p, &fp )==TN_ABI_OK && fp==11 );
  uint64_t k = 0;
  while( k<ImportedCount_PARAM_KEY_CNT && strcmp( ImportedCount_param_keys[k].member, "child.count" ) ) k++;
  assert( k<ImportedCount_PARAM_KEY_CNT && ImportedCount_param_keys[k].input==1 );
  assert( !strcmp( ImportedCount_param_keys[k].path, "child.count" ) );

  /* Built from params: both counts are written. */
  memset( &p, 0, sizeof p );
  p.child.n     = 1;
  p.child.count = 2;
  uint8_t ib[ 16 ];
  memset( ib, 0xee, sizeof ib );
  assert( ImportedCount_init( ib, 4, &p, &sz )==TN_ABI_ERR_SHORT_BUFFER && sz==8 && ib[0]==0xee );
  assert( ImportedCount_init( ib, sizeof ib, &p, &sz )==TN_ABI_OK && sz==8 );
  assert( ib[0]==1 && ib[2]==2 && ib[7]==0 && ib[8]==0xee );
  assert( ImportedCount_validate( ib, sz, &consumed )==TN_ABI_OK && consumed==8 );
  static uint8_t big[ 1024 ];
  p.child.count = 300;
  assert( ImportedCount_init( big, sizeof big, &p, &sz )==TN_ABI_ERR_OVERFLOW && sz==1+1+1+600+1 );

  /* The child on its own (package A). */
  CountChild_params_t cp;
  assert( CountChild_validate( buf, 4, &consumed )==TN_ABI_OK && consumed==4 );
  assert( CountChild_params_from_buffer( buf, 4, &cp )==TN_ABI_OK && cp.n==2 && cp.count==3 );
  assert( CountChild_footprint_from_params( &cp, &fp )==TN_ABI_OK && fp==4 );

  /* The imported struct itself after variable-size data. */
  uint8_t wb[ 7 ] = { 1, 0xf0, 1, 0xf1, 2, 0xc0, 0xc1 };
  assert( WrappedImportedCount_validate( wb, 7, &consumed )==TN_ABI_OK && consumed==7 );
  assert( WrappedImportedCount_validate( wb, 6, &consumed )==TN_ABI_ERR_SHORT_BUFFER && consumed==7 );
  assert( WrappedImportedCount_get_items_at( (WrappedImportedCount_t const *)wb, 1 )==0xc1 );
  WrappedImportedCount_params_t wp;
  assert( WrappedImportedCount_params_from_buffer( wb, 7, &wp )==TN_ABI_OK );
  assert( wp.wrap.m==1 && wp.wrap.child.n==1 && wp.wrap.child.count==2 );
  assert( WrappedImportedCount_footprint_from_params( &wp, &fp )==TN_ABI_OK && fp==7 );
  memset( &wp, 0, sizeof wp );
  wp.wrap.m           = 2;
  wp.wrap.child.n     = 0;
  wp.wrap.child.count = 3;
  assert( WrappedImportedCount_init( ib, sizeof ib, &wp, &sz )==TN_ABI_OK && sz==1+2+1+1+3 );
  assert( ib[0]==2 && ib[3]==0 && ib[4]==3 && WrappedImportedCount_validate( ib, sz, NULL )==TN_ABI_OK );
"#,
    )
    .unwrap_or_else(|e| panic!("imported_nested_count: {e}"));
    cleanup(&dir);
}

/* Two arrays sized by one count field: a different `n` in
`S_set_<f>( self, src, n )` would resize the other array too. It is refused
(TN_ABI_ERR_BAD_SIZE, nothing written) unless `n` is the current count, as
for an array with a count of its own. */
#[test]
fn test_c_shared_count_setters() {
    run_fixture_program(
        "shared_count_c",
        "shared_count",
        r#"
  SharedCount_params_t p;
  memset( &p, 0, sizeof p );
  p.count = 2;
  uint8_t buf[ 32 ];
  uint64_t sz = 0;
  assert( SharedCount_init( buf, sizeof buf, &p, &sz )==TN_ABI_OK && sz==14 );
  SharedCount_t * s = (SharedCount_t *)buf;
  uint32_t const a[ 3 ] = { 0x11111111u, 0x22222222u, 0x33333333u };
  uint16_t const b[ 3 ] = { 0x4444, 0x5555, 0x6666 };
  assert( SharedCount_set_a( s, a, 2 )==TN_ABI_OK );
  assert( SharedCount_set_b( s, b, 2 )==TN_ABI_OK );
  assert( SharedCount_set_tail( s, 0x77 )==TN_ABI_OK );
  uint8_t snap[ 14 ];
  memcpy( snap, buf, 14 );
  assert( SharedCount_validate( buf, 14, NULL )==TN_ABI_OK );
  assert( SharedCount_get_b_at( s, 1 )==0x5555 && SharedCount_get_tail( s )==0x77 );

  /* Another count would move `b` and resize `a`: refused, nothing written. */
  assert( SharedCount_set_b( s, b, 3 )==TN_ABI_ERR_BAD_SIZE );
  assert( SharedCount_set_a( s, a, 1 )==TN_ABI_ERR_BAD_SIZE );
  assert( SharedCount_set_a( s, a, 0 )==TN_ABI_ERR_BAD_SIZE );
  assert( SharedCount_set_a( s, a, 300 )==TN_ABI_ERR_OVERFLOW );
  assert( !memcmp( buf, snap, 14 ) );

  /* Resizing both is explicit: write the count, then the arrays. */
  memset( buf, 0, sizeof buf );
  assert( SharedCount_set_a( s, a, 3 )==TN_ABI_ERR_BAD_SIZE && buf[0]==0 );
  assert( SharedCount_set_count( s, 3 )==TN_ABI_OK );
  assert( SharedCount_set_a( s, a, 3 )==TN_ABI_OK && SharedCount_set_b( s, b, 3 )==TN_ABI_OK );
  assert( SharedCount_validate( buf, 1+12+6+1, NULL )==TN_ABI_OK );
  assert( SharedCount_get_a_at( s, 2 )==0x33333333u && SharedCount_get_b_at( s, 2 )==0x6666 );

  /* A count of its own is not written by the setter either. */
  uint8_t solo[ 4 ] = { 0 };
  assert( SoloCount_set_a( (SoloCount_t *)solo, "xyz", 3 )==TN_ABI_ERR_BAD_SIZE && solo[0]==0 && solo[1]==0 );
  assert( SoloCount_set_count( (SoloCount_t *)solo, 3 )==TN_ABI_OK );
  assert( SoloCount_set_a( (SoloCount_t *)solo, "xyz", 3 )==TN_ABI_OK );
  assert( solo[0]==3 && solo[3]=='z' && SoloCount_validate( solo, 4, NULL )==TN_ABI_OK );
"#,
    );
}

/* `S_set_<f>( self, src, n )` has no idea how many bytes the value spans: on
a jagged element a different `n` would overwrite the next element and move
every later boundary, and on a standalone value a larger `n` would write past
it. Every count-writing array setter refuses an `n` other than the current
count (TN_ABI_ERR_BAD_SIZE, nothing written); counts come from `T_init`. */
#[test]
fn test_c_fam_setter_keeps_extent() {
    run_compliance_program(
        "jagged_arrays",
        "fam_setter_extent",
        r#"
  JaggedRecords_params_t p;
  memset( &p, 0, sizeof p );
  p.count = 2;
  p.records.tn_bytes = 3 + 2;
  uint8_t buf[ 10 ];
  memset( buf, 0xee, sizeof buf );
  uint64_t sz = 0;
  assert( JaggedRecords_init( buf, 9, &p, &sz )==TN_ABI_OK && sz==9 );
  JaggedRecords_t * r = (JaggedRecords_t *)buf;

  /* Each element is sized by its own params, then filled at that size. */
  VarRecord_params_t vp;
  memset( &vp, 0, sizeof vp );
  vp.len = 2;
  VarRecord_t * r0 = JaggedRecords_get_records_at_mut( r, 0 );
  assert( r0 && VarRecord_init( (uint8_t *)r0, 3, &vp, &sz )==TN_ABI_OK && sz==3 );
  assert( VarRecord_set_data( r0, "\xaa\xbb", 2 )==TN_ABI_OK );
  vp.len = 1;
  VarRecord_t * r1 = JaggedRecords_get_records_at_mut( r, 1 );
  assert( r1 && (uint8_t *)r1==buf+7 );
  assert( VarRecord_init( (uint8_t *)r1, 2, &vp, &sz )==TN_ABI_OK && sz==2 );
  assert( VarRecord_set_data( r1, "\xcc", 1 )==TN_ABI_OK );
  uint8_t const want[ 10 ] = { 2, 0, 0, 0, 2, 0xaa, 0xbb, 1, 0xcc, 0xee };
  assert( !memcmp( buf, want, 10 ) );
  assert( JaggedRecords_validate( buf, 9, NULL )==TN_ABI_OK );

  /* Growing r0 would overwrite r1's count; shrinking it would move r1. */
  assert( VarRecord_set_data( r0, "\x11\x22\x33", 3 )==TN_ABI_ERR_BAD_SIZE );
  assert( VarRecord_set_data( r0, "\x11", 1 )==TN_ABI_ERR_BAD_SIZE );
  assert( VarRecord_set_data( r0, NULL, 0 )==TN_ABI_ERR_BAD_SIZE );
  /* Growing the last element would write past the value. */
  assert( VarRecord_set_data( r1, "\x11\x22", 2 )==TN_ABI_ERR_BAD_SIZE );
  assert( VarRecord_set_data( r1, "\x11\x22\x33", 300 )==TN_ABI_ERR_OVERFLOW );
  assert( !memcmp( buf, want, 10 ) );
  assert( VarRecord_set_data( r0, "\x12\x34", 2 )==TN_ABI_OK && buf[5]==0x12 && buf[6]==0x34 );
  assert( buf[7]==1 && JaggedRecords_validate( buf, 9, NULL )==TN_ABI_OK );

  /* A standalone value: zeroed bytes hold count 0, so only n==0 is accepted. */
  uint8_t solo[ 3 ] = { 0, 0xee, 0xee };
  assert( VarRecord_set_data( (VarRecord_t *)solo, "\x01\x02", 2 )==TN_ABI_ERR_BAD_SIZE );
  assert( solo[0]==0 && solo[1]==0xee && solo[2]==0xee );
  assert( VarRecord_set_data( (VarRecord_t *)solo, NULL, 0 )==TN_ABI_OK && solo[1]==0xee );
"#,
    );
}

/* Kept out of tests/compliance_data: TypeScript codegen cannot yet lower
comparison and logical operators in a struct's array size (GuardedStruct). */
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

/* `&&` and `||` evaluate their right operand only when the left one does not
decide the result, and yield 0 or 1: a division guarded by `n != 0` (or
skipped by `n == 0 ||`) never divides by zero, in validation, params, sizing
and init alike. */
#[test]
fn test_c_short_circuit_guards_division() {
    let path = std::env::temp_dir().join(format!("guarded_div_{}.abi.yaml", std::process::id()));
    fs::write(&path, GUARDED_DIV_ABI).unwrap();
    let resolver = resolve_types_from_abi(path.to_str().unwrap()).expect("resolve");
    let _ = fs::remove_file(&path);
    let dir = generate_c(&resolver, "guarded_div");
    build_and_run(
        &dir,
        r#"
  uint64_t consumed = 99;
  uint64_t fp       = 0;
  uint64_t sz       = 0;
  uint8_t  ib[ 4 ];

  /* n=0: `n != 0` is false, so `4 / n` is skipped and the count is 0. */
  uint8_t const and0[ 1 ] = { 0 };
  assert( GuardedAnd_validate( and0, 1, &consumed )==TN_ABI_OK && consumed==1 );
  GuardedAnd_params_t ap;
  assert( GuardedAnd_params_from_buffer( and0, 1, &ap )==TN_ABI_OK && ap.guarded.n==0 );
  assert( GuardedAnd_footprint_from_params( &ap, &fp )==TN_ABI_OK && fp==1 );

  /* n=0: `n == 0` is true, so `4 / n` is skipped and the count is 1. */
  uint8_t const or0[ 2 ] = { 0, 9 };
  assert( GuardedOr_validate( or0, 2, &consumed )==TN_ABI_OK && consumed==2 );
  GuardedOr_params_t op;
  assert( GuardedOr_params_from_buffer( or0, 2, &op )==TN_ABI_OK && op.guarded.n==0 );
  assert( GuardedOr_footprint_from_params( &op, &fp )==TN_ABI_OK && fp==2 );
  /* n=2: the right operand runs; `4 / 2` is nonzero, so the count is 1. */
  uint8_t const or2[ 2 ] = { 2, 9 };
  assert( GuardedOr_validate( or2, 2, &consumed )==TN_ABI_OK && consumed==2 );

  /* The same guard sizing a struct's array directly. */
  uint8_t const s0[ 1 ] = { 0 };
  assert( GuardedStruct_validate( s0, 1, &consumed )==TN_ABI_OK && consumed==1 );
  uint8_t const s2[ 3 ] = { 2, 0xaa, 0xbb };
  assert( GuardedStruct_validate( s2, 3, &consumed )==TN_ABI_OK && consumed==2 );
  assert( GuardedStruct_validate( s2, 1, &consumed )==TN_ABI_ERR_SHORT_BUFFER && consumed==2 );
  GuardedStruct_t const * s = GuardedStruct_from_slice( s2, 3 );
  assert( s && GuardedStruct_get_data_len( s )==1 && GuardedStruct_get_data_at( s, 0 )==0xaa );
  GuardedStruct_params_t sp;
  memset( &sp, 0, sizeof sp );
  assert( GuardedStruct_footprint( &sp )==1 );
  memset( ib, 0xee, sizeof ib );
  assert( GuardedStruct_init( ib, sizeof ib, &sp, &sz )==TN_ABI_OK && sz==1 && ib[0]==0 && ib[1]==0xee );
  sp.n = 2;
  assert( GuardedStruct_footprint( &sp )==2 );
  memset( ib, 0xee, sizeof ib );
  assert( GuardedStruct_init( ib, sizeof ib, &sp, &sz )==TN_ABI_OK && sz==2 && ib[0]==2 && ib[1]==0 );

  /* A tag guarded the same way. */
  uint8_t const t0[ 1 ] = { 0 };
  assert( GuardedTag_validate( t0, 1, &consumed )==TN_ABI_OK && consumed==1 );
  uint8_t const t2[ 2 ] = { 2, 7 };
  assert( GuardedTag_validate( t2, 2, &consumed )==TN_ABI_OK && consumed==2 );
  GuardedTag_params_t tp;
  memset( &tp, 0, sizeof tp );
  assert( GuardedTag_footprint( &tp )==1 );
"#,
    )
    .unwrap_or_else(|e| panic!("guarded_div: {e}"));
    cleanup(&dir);
}

/* `tests/go_fixtures/buffer_sized_holder.abi.yaml` plus a holder of the
holder. */
const BUFFER_SIZED_HOLDER_ABI: &str = r#"
abi:
  package: "test.buffer_sized_holder"
  abi-version: 1
  package-version: "1.0.0"
  description: "Types holding a type sized by __buffer_size"

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
                size:
                  div:
                    left:
                      sub:
                        left:
                          field-ref:
                            path: ["__buffer_size"]
                        right:
                          literal:
                            u64: 4
                    right:
                      literal:
                        u64: 8
                element-type:
                  primitive: u64
  - name: "SizedHolder"
    kind:
      struct:
        packed: true
        fields:
          - name: "tag"
            field-type:
              primitive: u8
          - name: "body"
            field-type:
              type-ref:
                name: "BufferSizedEntries"
  - name: "OuterHolder"
    kind:
      struct:
        packed: true
        fields:
          - name: "kind"
            field-type:
              primitive: u16
          - name: "holder"
            field-type:
              type-ref:
                name: "SizedHolder"
"#;

/* An inline struct reading `__buffer_size` sees the bytes left for it, in
the walker and in the IR helpers: their `buf_sz` is the root's, less the
bytes before the inline struct. */
#[test]
fn test_c_inline_struct_reads_its_own_buffer_size() {
    let resolver =
        resolve_types_from_abi("tests/go_fixtures/inline_buffer_sized.abi.yaml").expect("resolve");
    let dir = generate_c(&resolver, "inline_buffer_sized");
    build_and_run(
        &dir,
        r#"
  /* n, then inner: m = 1, head = [aa], tail = [bb]. */
  uint8_t buf[ 4 ] = { 9, 1, 0xaa, 0xbb };
  uint64_t consumed = 0;
  assert( Outer_validate( buf, 4, &consumed )==TN_ABI_OK && consumed==4 );
  assert( Outer_validate_ir( 4, &consumed, 1, 0, 0 )==0 && consumed==4 );
  assert( Outer_footprint_ir( 4, 1, 0, 0 )==4 );
"#,
    )
    .unwrap_or_else(|e| panic!("inline_buffer_sized: {e}"));
    cleanup(&dir);
}

/* Two inline structs each holding a named variable-size child: each child's
count is its own IR input, so the helpers size children with different
counts. */
#[test]
fn test_c_inline_children_keep_separate_ir_inputs() {
    let resolver =
        resolve_types_from_abi("tests/go_fixtures/inline_child_inputs.abi.yaml").expect("resolve");
    let dir = generate_c(&resolver, "inline_child_inputs");
    build_and_run(
        &dir,
        r#"
  /* left: n = 1, [aa]; right: n = 2, [bb cc]. */
  uint8_t buf[ 5 ] = { 1, 0xaa, 2, 0xbb, 0xcc };
  uint64_t consumed = 0;
  assert( Outer_validate( buf, 5, &consumed )==TN_ABI_OK && consumed==5 );
  assert( Outer_validate_ir( 5, &consumed, 1, 2 )==0 && consumed==5 );
  assert( Outer_footprint_ir( 1, 2 )==5 && Outer_footprint_ir( 2, 0 )==4 );
"#,
    )
    .unwrap_or_else(|e| panic!("inline_child_inputs: {e}"));
    cleanup(&dir);
}

/* Computed enum tags and payload sizes in inline structs (and an enum in a
packed struct, not rounded up to its alignment): the walker sizes them from
the bytes, the IR helpers from the tag and payload the caller gives. */
#[test]
fn test_c_inline_struct_computed_tags_and_payloads() {
    let resolver =
        resolve_types_from_abi("tests/go_fixtures/inline_computed_tag.abi.yaml").expect("resolve");
    let dir = generate_c(&resolver, "inline_computed_tag");
    build_and_run(
        &dir,
        r#"
  uint8_t small[ 2 ] = { 0, 7 };
  uint8_t wide[ 3 ] = { 1, 8, 7 };
  uint8_t sized[ 3 ] = { 9, 1, 2 };
  uint64_t consumed = 0;
  assert( Outer_validate( small, 2, &consumed )==TN_ABI_OK && consumed==2 );
  assert( Outer_validate( wide, 3, &consumed )==TN_ABI_OK && consumed==3 );
  assert( Flat_validate( small, 2, &consumed )==TN_ABI_OK && consumed==2 );
  assert( Sized_validate( sized, 3, &consumed )==TN_ABI_OK && consumed==3 );
  assert( Outer_validate_ir( 2, &consumed, 0, 0, 0 )==0 && consumed==2 );
  assert( Outer_validate_ir( 3, &consumed, 1, 1, 1 )==0 && consumed==3 );
  assert( Outer_footprint_ir( 0, 0, 0 )==2 && Outer_footprint_ir( 1, 1, 1 )==3 );
  assert( Flat_footprint_ir( 0, 0, 0 )==2 && Flat_footprint_ir( 1, 1, 1 )==3 );
  assert( Sized_validate_ir( 3, &consumed, 2, 2 )==0 && consumed==3 );
  assert( Sized_footprint_ir( 2, 2 )==3 );
"#,
    )
    .unwrap_or_else(|e| panic!("inline_computed_tag: {e}"));
    cleanup(&dir);
}

/* The bytes left for a nested `__buffer_size`-sized value are not an IR
value: a holder's IR helper could only pass its own buffer size on (13
bytes for a 5-byte holder in 12). Types whose IR calls such a helper,
directly or through other calls, get no IR helpers; the nested type keeps
its own, and the walker-based API sizes the holder from the bytes left. */
#[test]
fn test_c_ir_helpers_skip_nested_buffer_size() {
    let path = std::env::temp_dir().join(format!(
        "buffer_sized_holder_{}.abi.yaml",
        std::process::id()
    ));
    fs::write(&path, BUFFER_SIZED_HOLDER_ABI).unwrap();
    let resolver = resolve_types_from_abi(path.to_str().unwrap()).expect("resolve");
    let _ = fs::remove_file(&path);
    let dir = generate_c(&resolver, "buffer_sized_holder");
    let header = fs::read_to_string(dir.join("types.h")).unwrap();
    let source = fs::read_to_string(dir.join("functions.c")).unwrap();
    for name in [
        "SizedHolder_validate_ir",
        "SizedHolder_footprint_ir",
        "OuterHolder_validate_ir",
        "OuterHolder_footprint_ir",
    ] {
        assert!(
            !header.contains(name) && !source.contains(name),
            "{name} emitted"
        );
    }
    build_and_run(
        &dir,
        r#"
  uint64_t consumed = 0;
  assert( BufferSizedEntries_validate_ir( 20, &consumed )==0 && consumed==20 );
  assert( BufferSizedEntries_footprint_ir( 28 )==28 );
  assert( BufferSizedEntries_validate_ir( 3, &consumed )!=0 );

  /* tag, version, one entry */
  uint8_t buf[ 13 ] = { 9, 7, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0 };
  assert( SizedHolder_validate( buf, 13, &consumed )==TN_ABI_OK && consumed==13 );
  /* 11 bytes left for the body: no entry fits, the holder is 5 bytes. */
  assert( SizedHolder_validate( buf, 12, &consumed )==TN_ABI_OK && consumed==5 );
  SizedHolder_params_t p;
  assert( SizedHolder_params_from_buffer( buf, 12, &p )==TN_ABI_OK && p.buf_sz==12 );
  uint64_t fp = 0;
  assert( SizedHolder_footprint_from_params( &p, &fp )==TN_ABI_OK && fp==5 );
  p.buf_sz = 13;
  assert( SizedHolder_footprint_from_params( &p, &fp )==TN_ABI_OK && fp==13 );

  uint8_t outer[ 15 ] = { 1, 0, 9, 7, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0 };
  assert( OuterHolder_validate( outer, 15, &consumed )==TN_ABI_OK && consumed==15 );
  assert( OuterHolder_validate( outer, 14, &consumed )==TN_ABI_OK && consumed==7 );
  OuterHolder_params_t op;
  memset( &op, 0, sizeof op );
  op.buf_sz = 14;
  assert( OuterHolder_footprint_from_params( &op, &fp )==TN_ABI_OK && fp==7 );
"#,
    )
    .unwrap_or_else(|e| panic!("buffer_sized_holder: {e}"));
    cleanup(&dir);
}

/* Declared type names that spell names generated for other types: the
params struct of `Message`, inline types (`Holder.inner`, enum payload
`Pick.body.A`, array element `Bag.items`), tag and count macros, and helper
functions (`Message_get_size` is both the getter of `Message.size` and the
size of union `Message_get`), and names of the runtime (`tn_abi_variant_t`)
and of `<stdint.h>` (`uint8_t`). `Choice_variants` (a struct tag) does not
clash with the table `Choice_variants` and keeps its name. */
const NAME_CLASHES_ABI: &str = r#"
abi:
  package: "test.name_clashes"
  abi-version: 1
  package-version: "1.0.0"
  description: "Declared type names that spell generated C names"

types:
  - name: "Message"
    kind:
      struct:
        packed: true
        fields:
          - name: "count"
            field-type:
              primitive: u8
          - name: "size"
            field-type:
              primitive: u8
          - name: "init"
            field-type:
              primitive: u8
          - name: "tn_walk"
            field-type:
              primitive: u8
          - name: "param_keys"
            field-type:
              primitive: u8
          - name: "variants"
            field-type:
              primitive: u8
          - name: "items"
            field-type:
              array:
                size:
                  field-ref:
                    path: ["count"]
                element-type:
                  primitive: u16
  - name: "Message_params"
    kind:
      struct:
        packed: true
        fields:
          - name: "a"
            field-type:
              primitive: u32
  - name: "Message_PARAM_KEY_CNT"
    kind:
      struct:
        packed: true
        fields:
          - name: "b"
            field-type:
              primitive: u8
  - name: "Message_get"
    kind:
      union:
        packed: true
        variants:
          - name: "small"
            variant-type:
              primitive: u8
          - name: "wide"
            variant-type:
              primitive: u16
  - name: "Choice"
    kind:
      union:
        packed: true
        variants:
          - name: "a"
            variant-type:
              primitive: u8
          - name: "b"
            variant-type:
              primitive: u32
  - name: "Choice_VARIANT_CNT"
    kind:
      struct:
        packed: true
        fields:
          - name: "c"
            field-type:
              primitive: u8
  - name: "Choice_variants"
    kind:
      struct:
        packed: true
        fields:
          - name: "d"
            field-type:
              primitive: u8
  - name: "Holder"
    kind:
      struct:
        packed: true
        fields:
          - name: "inner"
            field-type:
              struct:
                packed: true
                fields:
                  - name: "x"
                    field-type:
                      primitive: u16
                  - name: "y"
                    field-type:
                      primitive: u8
  - name: "Holder_inner"
    kind:
      struct:
        packed: true
        fields:
          - name: "z"
            field-type:
              primitive: u32
  - name: "Pick"
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
                      struct:
                        packed: true
                        fields:
                          - name: "v"
                            field-type:
                              primitive: u8
                  - name: "B"
                    tag-value: 1
                    variant-type:
                      primitive: u16
  - name: "Pick_body_TAG_B"
    kind:
      struct:
        packed: true
        fields:
          - name: "q"
            field-type:
              primitive: u8
  - name: "Pick_body_A"
    kind:
      struct:
        packed: true
        fields:
          - name: "r"
            field-type:
              primitive: u64
  - name: "Bag"
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
                  struct:
                    packed: true
                    fields:
                      - name: "e"
                        field-type:
                          primitive: u8
                      - name: "f"
                        field-type:
                          primitive: u8
  - name: "Bag_items_elem"
    kind:
      struct:
        packed: true
        fields:
          - name: "g"
            field-type:
              primitive: u32
  - name: "uint8"
    kind:
      struct:
        packed: true
        fields:
          - name: "h"
            field-type:
              primitive: u8
  - name: "tn_abi_variant"
    kind:
      struct:
        packed: true
        fields:
          - name: "k"
            field-type:
              primitive: u16
"#;

/* Every file-scope C name comes from one table: declared types keep their
names, and a generated name that would clash gets `_` appended. */
#[test]
fn test_c_generated_names_never_clash() {
    let path = std::env::temp_dir().join(format!("name_clashes_{}.abi.yaml", std::process::id()));
    fs::write(&path, NAME_CLASHES_ABI).unwrap();
    let resolver = resolve_types_from_abi(path.to_str().unwrap()).expect("resolve");
    let _ = fs::remove_file(&path);
    let dir = generate_c(&resolver, "name_clashes");
    build_and_run(
        &dir,
        r#"
  uint64_t consumed = 0;

  /* The declared Message_params and Message's params (Message_params_t_). */
  assert( sizeof( Message_params_t )==4 );
  uint8_t mp[ 4 ] = { 1, 2, 3, 4 };
  assert( Message_params_validate( mp, 4, &consumed )==TN_ABI_OK && consumed==4 );
  assert( Message_params_get_a( Message_params_from_slice( mp, 4 ) )==0x04030201U );
  /* count, size, init, tn_walk, param_keys, variants, two u16 items */
  uint8_t m[ 10 ] = { 2, 1, 2, 3, 4, 5, 0x11, 0, 0x22, 0 };
  assert( Message_validate( m, 10, &consumed )==TN_ABI_OK && consumed==10 );
  Message_params_t_ p;
  assert( Message_params_from_buffer( m, 10, &p )==TN_ABI_OK && p.count==2 );
  assert( Message_footprint( &p )==10 );
  Message_t const * msg = Message_from_slice( m, 10 );
  assert( Message_get_size( msg )==1 && Message_get_init( msg )==2 );
  assert( Message_get_tn_walk( msg )==3 && Message_get_param_keys( msg )==4 );
  assert( Message_get_variants( msg )==5 && Message_get_items_at( msg, 1 )==0x22 );
  assert( Message_PARAM_KEY_CNT_==2 && !strcmp( Message_param_keys[0].path, "count" ) );
  assert( sizeof( Message_PARAM_KEY_CNT_t )==1 && Message_PARAM_KEY_CNT_PARAM_KEY_CNT==0 );

  /* Union Message_get: helpers taken by Message's getters get `_`. */
  uint8_t u[ 2 ] = { 0x34, 0x12 };
  assert( Message_get_validate( u, 2, &consumed )==TN_ABI_OK && consumed==2 );
  Message_get_t const * mg = Message_get_from_slice( u, 2 );
  assert( Message_get_size_( mg )==2 && Message_get_get_wide( mg )==0x1234 );
  assert( Message_get_VARIANT_CNT==2 && !strcmp( Message_get_variants_[1].name, "wide" ) );
  assert( Message_get_variant_by_name( "small" )==&Message_get_variants_[0] );
  assert( Message_get_PARAM_KEY_CNT==0 && Message_get_param_keys_[0].member==NULL );
  Message_get_params_t gp;
  memset( &gp, 0, sizeof gp );
  uint8_t ib[ 2 ];
  uint64_t sz = 0;
  assert( Message_get_init_( ib, sizeof ib, &gp, &sz )==TN_ABI_OK && sz==2 );
  assert( Message_get_tn_walk_( u, 2, &gp, TN_ABI_MODE_VALIDATE, &sz )==TN_ABI_OK && sz==2 );

  /* Union Choice keeps its table; its count macro gets `_`. */
  assert( Choice_VARIANT_CNT_==2 && !strcmp( Choice_variants[1].name, "b" ) );
  assert( sizeof( Choice_VARIANT_CNT_t )==1 && sizeof( Choice_variants_t )==1 );

  /* Inline Holder.inner vs the declared Holder_inner. */
  uint8_t h[ 3 ] = { 0x78, 0x56, 9 };
  assert( Holder_validate( h, 3, &consumed )==TN_ABI_OK && consumed==3 );
  Holder_inner__t const * in = Holder_get_inner( Holder_from_slice( h, 3 ) );
  assert( Holder_inner__get_x( in )==0x5678 && Holder_inner__get_y( in )==9 );
  assert( sizeof( Holder_inner_t )==4 );
  uint8_t hi[ 4 ] = { 1, 0, 0, 0 };
  assert( Holder_inner_validate( hi, 4, &consumed )==TN_ABI_OK && consumed==4 );
  assert( Holder_inner_get_z( Holder_inner_from_slice( hi, 4 ) )==1 );

  /* Enum payload Pick.body.A vs the declared Pick_body_A; tag macro vs the
     declared Pick_body_TAG_B. */
  assert( Pick_body_TAG_A==0 && Pick_body_TAG_B_==1 && sizeof( Pick_body_TAG_B_t )==1 );
  uint8_t pk[ 2 ] = { 0, 7 };
  assert( Pick_validate( pk, 2, &consumed )==TN_ABI_OK && consumed==2 );
  Pick_t const * pick = Pick_from_slice( pk, 2 );
  assert( Pick_get_body_tag( pick )==Pick_body_TAG_A );
  assert( Pick_body_A__get_v( Pick_body_as_A( pick ) )==7 );
  assert( sizeof( Pick_body_A_t )==8 );
  uint8_t pa[ 8 ] = { 5 };
  assert( Pick_body_A_validate( pa, 8, &consumed )==TN_ABI_OK && consumed==8 );
  assert( Pick_body_A_get_r( Pick_body_A_from_slice( pa, 8 ) )==5 );

  /* Array element Bag.items vs the declared Bag_items_elem. */
  uint8_t bg[ 5 ] = { 2, 1, 2, 3, 4 };
  assert( Bag_validate( bg, 5, &consumed )==TN_ABI_OK && consumed==5 );
  Bag_items_elem__t const * e = Bag_get_items_at( Bag_from_slice( bg, 5 ), 1 );
  assert( Bag_items_elem__get_e( e )==3 && Bag_items_elem__get_f( e )==4 );
  assert( sizeof( Bag_items_elem_t )==4 );
  uint8_t be[ 4 ] = { 0, 1, 0, 0 };
  assert( Bag_items_elem_validate( be, 4, &consumed )==TN_ABI_OK && consumed==4 );
  assert( Bag_items_elem_get_g( Bag_items_elem_from_slice( be, 4 ) )==0x100 );

  /* Runtime and standard names stay theirs. */
  assert( sizeof( uint8__t )==1 && sizeof( tn_abi_variant__t )==2 );
  uint8_t tv[ 2 ] = { 3, 1 };
  assert( tn_abi_variant__validate( tv, 2, &consumed )==TN_ABI_OK && consumed==2 );
  assert( tn_abi_variant__get_k( tn_abi_variant__from_slice( tv, 2 ) )==0x103 );
  assert( uint8__validate( tv, 1, &consumed )==TN_ABI_OK && consumed==1 );
"#,
    )
    .unwrap_or_else(|e| panic!("name_clashes: {e}"));
    cleanup(&dir);
}

/* Names clash across packages too: an importer's header includes the
imported package's, so a declared `Bar_params` in the importer would
redefine the imported `Bar`'s params struct. One table covers the run. */
#[test]
fn test_c_generated_names_never_clash_across_packages() {
    let dir = test_dir("name_clashes_packages");
    let src = dir.join("abi");
    fs::create_dir_all(&src).unwrap();
    fs::write(
        src.join("clash_base.abi.yaml"),
        r#"
abi:
  package: "clash.base"
  abi-version: 1
  package-version: "1.0.0"
  description: "Imported type"
types:
  - name: "Bar"
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
"#,
    )
    .unwrap();
    fs::write(
        src.join("clash_user.abi.yaml"),
        r#"
abi:
  package: "clash.user"
  abi-version: 1
  package-version: "1.0.0"
  description: "Declares a name generated for the imported type"
  imports:
    - type: path
      path: "clash_base.abi.yaml"
types:
  - name: "Bar_params"
    kind:
      struct:
        packed: true
        fields:
          - name: "a"
            field-type:
              primitive: u16
  - name: "User"
    kind:
      struct:
        packed: true
        fields:
          - name: "bar"
            field-type:
              type-ref:
                name: "Bar"
                package: "clash.base"
          - name: "tail"
            field-type:
              primitive: u8
"#,
    )
    .unwrap();
    abi_gen::cmds::codegen::run(
        vec![src.join("clash_user.abi.yaml")],
        vec![src.clone()],
        abi_gen::cmds::codegen::Language::C,
        dir.clone(),
        false,
    )
    .expect("codegen clash packages");
    build_and_run_packages(
        &dir,
        &["clash/base", "clash/user"],
        r#"
  uint64_t consumed = 0;
  /* bar: n=2, two bytes; tail */
  uint8_t buf[ 4 ] = { 2, 7, 8, 9 };
  assert( User_validate( buf, 4, &consumed )==TN_ABI_OK && consumed==4 );
  assert( User_get_tail( User_from_slice( buf, 4 ) )==9 );
  Bar_params_t_ bp;
  assert( Bar_params_from_buffer( buf, 3, &bp )==TN_ABI_OK && bp.n==2 );
  assert( Bar_footprint( &bp )==3 );
  assert( sizeof( Bar_params_t )==2 );
  uint8_t pb[ 2 ] = { 1, 2 };
  assert( Bar_params_validate( pb, 2, &consumed )==TN_ABI_OK && consumed==2 );
"#,
    )
    .unwrap_or_else(|e| panic!("name_clashes_packages: {e}"));
    cleanup(&dir);
}

/* Packages whose directories differ only in case (`cases.Foo`,
`cases.foo`) used to share one directory on a case-insensitive file system,
so one package's files were lost. Every package now gets its own directory
by the rule shared with the other backends (`cases/foo_`), and the
`#include` paths between packages follow it: both packages' files exist and
everything compiles, links and validates a value built from every package. */
#[test]
fn test_c_package_dirs_never_collide() {
    let dir = test_dir("c_package_dirs");
    abi_gen::cmds::codegen::run(
        vec![
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("tests/package_fixtures/paths_user.abi.yaml"),
        ],
        vec![Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/package_fixtures")],
        abi_gen::cmds::codegen::Language::C,
        dir.clone(),
        false,
    )
    .expect("codegen");
    let packages = [
        "cases/Foo",
        "cases/foo_",
        "a/b_c",
        "a_b/c",
        "tn_abi_runtime",
        "pkguser",
        "paths_user",
    ];
    for p in packages {
        assert!(dir.join(p).join("types.h").exists(), "missing {p}/types.h");
        assert!(
            dir.join(p).join("functions.c").exists(),
            "missing {p}/functions.c"
        );
    }
    let user = fs::read_to_string(dir.join("pkguser/types.h")).unwrap();
    assert!(
        user.contains("#include \"../cases/foo_/types.h\""),
        "{user}"
    );
    assert!(user.contains("#include \"../cases/Foo/types.h\""), "{user}");
    build_and_run_packages(
        &dir,
        &packages,
        r#"
  uint8_t buf[ 6 ] = { 1, 2, 3, 4, 5, 6 };
  uint64_t consumed = 0;
  assert( Holder_validate( buf, 6, &consumed )==TN_ABI_OK && consumed==6 );
  assert( Upper_validate( buf, 1, &consumed )==TN_ABI_OK && consumed==1 );
  assert( Lower_validate( buf, 1, &consumed )==TN_ABI_OK && consumed==1 );
  assert( RuntimeNamed_validate( buf, 2, &consumed )==TN_ABI_OK && consumed==2 );
"#,
    )
    .unwrap_or_else(|e| panic!("package dirs: {e}"));
    cleanup(&dir);
}
