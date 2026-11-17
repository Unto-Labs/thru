/* Regression tests for reflection bugs the Go port (`sdks/go/abi`) used to
 * mirror: `__buffer_size`, computed enum tags, unions, arithmetic overflow,
 * structural `validate_buffer`, decode limits, nested field lookup and
 * inline struct sizes. */

use abi_gen::abi::file::AbiFile;
use abi_gen::abi::resolved::TypeResolver;
use abi_reflect::{format_reflection, Reflector};
use serde_json::{json, Value as JsonValue};
use std::fs;
use std::path::PathBuf;

fn reflector_from_yaml(yaml: &str) -> Reflector {
    try_reflector_from_yaml(yaml).expect("build reflector")
}

fn try_reflector_from_yaml(yaml: &str) -> Result<Reflector, String> {
    let abi: AbiFile = serde_yml::from_str(yaml).expect("parse ABI");
    let roots = abi.root_types().clone();
    let mut resolver = TypeResolver::new();
    for typedef in abi.types {
        resolver.add_typedef(typedef);
    }
    resolver.resolve_all().expect("resolve ABI");
    Reflector::with_root_types(resolver, Default::default(), roots).map_err(|e| e.to_string())
}

fn compliance_reflector(name: &str) -> Reflector {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../abi_gen/tests/compliance_tests/abi_definitions")
        .join(name);
    reflector_from_yaml(&fs::read_to_string(path).expect("read ABI"))
}

fn formatted(reflector: &Reflector, type_name: &str, data: &[u8]) -> JsonValue {
    let value = reflector
        .reflect(data, type_name)
        .unwrap_or_else(|err| panic!("reflect {type_name}: {err}"));
    format_reflection(&value).value
}

fn hex(s: &str) -> Vec<u8> {
    let s: String = s.chars().filter(|c| !c.is_whitespace()).collect();
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).expect("hex"))
        .collect()
}

/* 1. `__buffer_size` is the bytes available to the struct that reads it. */

#[test]
fn buffer_size_types_reflect() {
    let reflector = compliance_reflector("buffer_sized.abi.yaml");
    let data = hex("01000000 1111111111111111 2222222222222222");
    assert_eq!(
        formatted(&reflector, "BufferSizedEntries", &data),
        json!({
            "version": 1,
            "entries": [0x1111111111111111u64, 0x2222222222222222u64],
            "typeName": "BufferSizedEntries"
        })
    );
    assert_eq!(
        formatted(&reflector, "BufferSizedEntries", &hex("01000000")),
        json!({ "version": 1, "entries": [], "typeName": "BufferSizedEntries" })
    );
    let validation = reflector
        .validate_buffer("BufferSizedEntries", &data)
        .expect("validate");
    assert_eq!(validation.bytes_consumed, 20);
}

#[test]
fn buffer_size_resolves_at_the_reading_struct() {
    let reflector = reflector_from_yaml(
        r#"
abi:
  package: "test.buffer_size_nested"
  abi-version: 1
  package-version: "1.0.0"
  description: "test"
types:
  - name: "Sized"
    kind:
      struct:
        packed: true
        fields:
          - name: "version"
            field-type: { primitive: u8 }
          - name: "entries"
            field-type:
              array:
                size: { div: { left: { sub: { left: { field-ref: { path: ["__buffer_size"] } }, right: { literal: { u64: 1 } } } }, right: { literal: { u64: 2 } } } }
                element-type: { primitive: u16 }
  - name: "Holder"
    kind:
      struct:
        packed: true
        fields:
          - name: "tag"
            field-type: { primitive: u16 }
          - name: "body"
            field-type: { type-ref: { name: "Sized" } }
"#,
    );
    /* body starts at byte 2 and has 7 bytes: version + 3 u16 entries. */
    assert_eq!(
        formatted(&reflector, "Holder", &hex("0100 07 0100 0200 0300")),
        json!({
            "tag": 1,
            "body": { "version": 7, "entries": [1, 2, 3], "typeName": "Sized" },
            "typeName": "Holder"
        })
    );
    assert_eq!(
        reflector
            .validate_buffer("Holder", &hex("0100 07 0100 0200 0300"))
            .expect("validate")
            .bytes_consumed,
        9
    );
}

#[test]
fn buffer_size_with_extracted_params() {
    let reflector = reflector_from_yaml(
        r#"
abi:
  package: "test.buffer_size_params"
  abi-version: 1
  package-version: "1.0.0"
  description: "test"
types:
  - name: "Mixed"
    kind:
      struct:
        packed: true
        fields:
          - name: "n"
            field-type: { primitive: u8 }
          - name: "head"
            field-type:
              array:
                size: { field-ref: { path: ["n"] } }
                element-type: { primitive: u8 }
          - name: "tail"
            field-type:
              array:
                size: { sub: { left: { sub: { left: { field-ref: { path: ["__buffer_size"] } }, right: { literal: { u64: 1 } } } }, right: { field-ref: { path: ["n"] } } } }
                element-type: { primitive: u8 }
"#,
    );
    let data = hex("02 aabb ccdd");
    assert_eq!(
        formatted(&reflector, "Mixed", &data),
        json!({ "n": 2, "head": "0xaabb", "tail": "0xccdd", "typeName": "Mixed" })
    );
    assert_eq!(
        reflector
            .validate_buffer("Mixed", &data)
            .expect("validate")
            .bytes_consumed,
        5
    );
}

/* 2. Enums whose tag is a computed expression validate and reflect. */

#[test]
fn computed_tag_enums_validate() {
    let reflector = compliance_reflector("computed_enums.abi.yaml");
    for (data, variant, consumed) in [
        ("00 00 2a", "Small", 3u128),
        ("01 00 3412", "Medium", 4),
        ("01 01 78563412", "Large", 6),
    ] {
        let bytes = hex(data);
        let validation = reflector
            .validate_buffer("ComputedTagEnum", &bytes)
            .unwrap_or_else(|err| panic!("validate {data}: {err}"));
        assert_eq!(validation.bytes_consumed, consumed, "{data}");
        let value = formatted(&reflector, "ComputedTagEnum", &bytes);
        assert_eq!(value["data"]["variant"], json!(variant), "{data}");
    }
    let err = reflector
        .reflect(&hex("02 01 00"), "ComputedTagEnum")
        .expect_err("tag 3 has no variant");
    assert_eq!(
        err.to_string(),
        "dynamic parameter 'data' for type 'ComputedTagEnum' is not supported: enum tag value 3 not found"
    );
}

const UNARY_TAG_ABI: &str = r#"
abi:
  package: "test.unary_tags"
  abi-version: 1
  package-version: "1.0.0"
  description: "test"
types:
  - name: "Inverted"
    kind:
      struct:
        packed: true
        fields:
          - name: "flags"
            field-type: { primitive: u8 }
          - name: "body"
            field-type:
              enum:
                packed: true
                tag-ref: { bit-and: { left: { bit-not: { operand: { field-ref: { path: ["flags"] } } } }, right: { literal: { u64: 1 } } } }
                variants:
                  - { name: "Even", tag-value: 0, variant-type: { primitive: u8 } }
                  - { name: "Odd", tag-value: 1, variant-type: { array: { size: { literal: { u64: 2 } }, element-type: { primitive: u8 } } } }
  - name: "Counted"
    kind:
      struct:
        packed: true
        fields:
          - name: "bits"
            field-type: { primitive: u8 }
          - name: "body"
            field-type:
              enum:
                packed: true
                tag-ref: { popcount: { operand: { field-ref: { path: ["bits"] } } } }
                variants:
                  - { name: "None", tag-value: 0, variant-type: { primitive: u8 } }
                  - { name: "Two", tag-value: 2, variant-type: { array: { size: { literal: { u64: 4 } }, element-type: { primitive: u8 } } } }
"#;

/* Computed tags may use any operator the parser evaluates, unary ones too. */
#[test]
fn computed_tags_with_unary_operators_validate() {
    let reflector = reflector_from_yaml(UNARY_TAG_ABI);
    for (type_name, data, variant, consumed) in [
        /* ~0 & 1 = 1 */
        ("Inverted", "00 3412", "Odd", 3u128),
        /* ~1 & 1 = 0 */
        ("Inverted", "01 07", "Even", 2),
        ("Counted", "00 07", "None", 2),
        ("Counted", "05 78563412", "Two", 5),
    ] {
        let bytes = hex(data);
        let validation = reflector
            .validate_buffer(type_name, &bytes)
            .unwrap_or_else(|err| panic!("validate {type_name} {data}: {err}"));
        assert_eq!(validation.bytes_consumed, consumed, "{type_name} {data}");
        let value = formatted(&reflector, type_name, &bytes);
        assert_eq!(
            value["body"]["variant"],
            json!(variant),
            "{type_name} {data}"
        );
    }
}

/* 3. A union has no tag: every variant is a view of the same bytes. */

#[test]
fn unions_decode_every_variant() {
    let reflector = compliance_reflector("unions.abi.yaml");
    /* f32 pi */
    let value = reflector
        .reflect(&hex("d00f4940"), "SimpleUnion")
        .expect("reflect");
    let abi_reflect::Value::Union { variants } = value.get_value() else {
        panic!("expected a union, got {:?}", value.get_value());
    };
    let names: Vec<&str> = variants.iter().map(|(name, _)| name.as_str()).collect();
    assert_eq!(names, ["int_value", "float_value", "bytes"]);

    let formatted = format_reflection(&value).value;
    assert_eq!(formatted["int_value"], json!(0x40490fd0));
    let pi = formatted["float_value"].as_f64().expect("float view");
    assert_eq!(pi, f32::from_bits(0x40490fd0) as f64);
    assert_eq!(formatted["bytes"], json!("0xd00f4940"));

    /* A union field inside a struct: every view, then the next field. */
    let holder = formatted_union_holder(&reflector);
    assert_eq!(holder["value"]["int_value"], json!(-272716322));
    assert_eq!(holder["value"]["bytes"], json!("0xdeadbeef"));
    assert_eq!(holder["trailer"], json!(0x1234));
}

fn formatted_union_holder(reflector: &Reflector) -> JsonValue {
    formatted(reflector, "UnionHolder", &hex("01 deadbeef 3412"))
}

#[test]
fn union_byte_offsets_cover_the_union() {
    let reflector = compliance_reflector("unions.abi.yaml");
    let value = reflector
        .reflect(&hex("01 deadbeef 3412"), "UnionHolder")
        .expect("reflect");
    let options = abi_reflect::FormatOptions {
        include_byte_offsets: true,
        ..Default::default()
    };
    let formatted = abi_reflect::format_reflection_with_options(&value, &options).value;
    assert_eq!(
        formatted["value"]["_byteRange"],
        json!({ "offset": 1, "size": 4 })
    );
    assert_eq!(
        formatted["value"]["float_value"]["_byteRange"],
        json!({ "offset": 1, "size": 4 })
    );
}

/* 4. Overflow in size, offset and expression evaluation is an error. */

const OVERFLOW_ABI: &str = r#"
abi:
  package: "test.overflow"
  abi-version: 1
  package-version: "1.0.0"
  description: "test"
types:
  - name: "WideCount"
    kind:
      struct:
        packed: true
        fields:
          - name: "count"
            field-type: { primitive: u64 }
          - name: "items"
            field-type:
              array:
                size: { field-ref: { path: ["count"] } }
                element-type: { primitive: u8 }
          - name: "tail"
            field-type: { primitive: u8 }
  - name: "Sum"
    kind:
      struct:
        packed: true
        fields:
          - name: "a"
            field-type: { primitive: u64 }
          - name: "b"
            field-type: { primitive: u64 }
          - name: "items"
            field-type:
              array:
                size: { add: { left: { field-ref: { path: ["a"] } }, right: { field-ref: { path: ["b"] } } } }
                element-type: { primitive: u8 }
  - name: "Difference"
    kind:
      struct:
        packed: true
        fields:
          - name: "a"
            field-type: { primitive: u64 }
          - name: "b"
            field-type: { primitive: u64 }
          - name: "items"
            field-type:
              array:
                size: { sub: { left: { field-ref: { path: ["a"] } }, right: { field-ref: { path: ["b"] } } } }
                element-type: { primitive: u8 }
  - name: "Product"
    kind:
      struct:
        packed: true
        fields:
          - name: "a"
            field-type: { primitive: u64 }
          - name: "b"
            field-type: { primitive: u64 }
          - name: "c"
            field-type: { primitive: u64 }
          - name: "items"
            field-type:
              array:
                size: { mul: { left: { mul: { left: { field-ref: { path: ["a"] } }, right: { field-ref: { path: ["b"] } } } }, right: { field-ref: { path: ["c"] } } } }
                element-type: { primitive: u8 }
  - name: "Shifted"
    kind:
      struct:
        packed: true
        fields:
          - name: "count"
            field-type: { primitive: u64 }
          - name: "shift"
            field-type: { primitive: u8 }
          - name: "items"
            field-type:
              array:
                size: { left-shift: { left: { field-ref: { path: ["count"] } }, right: { field-ref: { path: ["shift"] } } } }
                element-type: { primitive: u8 }
"#;

fn raw_parse(reflector: &Reflector, type_name: &str, data: &[u8]) -> String {
    let resolved = reflector
        .resolver()
        .get_type_info(type_name)
        .expect("type exists");
    let mut parser = abi_reflect::Parser::new(reflector.resolver(), Default::default());
    match parser.parse(data, resolved) {
        Ok(value) => panic!("{type_name} parsed: {:?}", value.get_value()),
        Err(err) => err.to_string(),
    }
}

fn reflect_error(reflector: &Reflector, type_name: &str, data: &[u8]) -> String {
    match reflector.reflect(data, type_name) {
        Ok(value) => panic!("{type_name} reflected: {:?}", value.get_value()),
        Err(err) => err.to_string(),
    }
}

#[test]
fn parser_offsets_and_expressions_report_overflow() {
    let reflector = reflector_from_yaml(OVERFLOW_ABI);
    /* items end = 8 + u64::MAX wraps past the buffer length check. */
    assert_eq!(
        raw_parse(&reflector, "WideCount", &hex("ffffffffffffffff 0102")),
        "Expression evaluation failed: Offset overflow"
    );
    assert_eq!(
        raw_parse(&reflector, "Sum", &hex("0000000000000080 0000000000000080")),
        "Expression evaluation failed: Addition overflow"
    );
    assert_eq!(
        raw_parse(
            &reflector,
            "Difference",
            &hex("0100000000000000 0200000000000000")
        ),
        "Expression evaluation failed: Subtraction overflow"
    );
    assert_eq!(
        raw_parse(
            &reflector,
            "Product",
            &hex("0000000001000000 0000000001000000 0100000000000000")
        ),
        "Expression evaluation failed: Multiplication overflow"
    );
    assert_eq!(
        raw_parse(&reflector, "Shifted", &hex("0100000000000000 41 aa")),
        "Expression evaluation failed: Left shift overflow"
    );
}

#[test]
fn param_extraction_reports_overflow() {
    let reflector = reflector_from_yaml(OVERFLOW_ABI);
    /* (2^32)^3 = 2^96 fits i128 but not a usize count. */
    assert_eq!(
        reflect_error(
            &reflector,
            "Product",
            &hex("0000000001000000 0000000001000000 0000000001000000")
        ),
        "type 'Product' overflowed during array count conversion"
    );
    /* u64::MAX^3 overflows i128. */
    assert_eq!(
        reflect_error(
            &reflector,
            "Product",
            &hex("ffffffffffffffff ffffffffffffffff ffffffffffffffff")
        ),
        "type 'Product' overflowed during multiplication"
    );
    /* A shift by 200 is past the width of the value. */
    assert_eq!(
        reflect_error(&reflector, "Shifted", &hex("0100000000000000 c8 aa")),
        "type 'Shifted' overflowed during left shift"
    );
    /* 1 << 65 does not fit a usize count. */
    assert_eq!(
        reflect_error(&reflector, "Shifted", &hex("0100000000000000 41 aa")),
        "type 'Shifted' overflowed during array count conversion"
    );
}

/* 5. `validate_buffer` checks structure, not just the footprint. */

fn oracle_reflector() -> Reflector {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../type-library");
    let mut imports = abi_gen::abi::file::ImportResolver::new(vec![root.clone()]);
    imports
        .load_file_with_imports(&root.join("tn_oracle_program.abi.yaml"), false)
        .expect("load oracle ABI");
    let mut resolver = TypeResolver::new();
    for typedef in imports.get_all_types() {
        resolver.add_typedef(typedef.clone());
    }
    resolver.resolve_all().expect("resolve oracle ABI");
    Reflector::new(resolver).expect("build reflector")
}

#[test]
fn validate_buffer_rejects_sdu_payload_matching_no_variant() {
    let reflector = oracle_reflector();
    /* A four-byte post-update payload; the variants take 11 or 18 bytes. */
    let err = reflector
        .validate_buffer("OracleInstruction", &hex("01000000 dcbabe3e"))
        .expect_err("payload size matches no variant");
    assert_eq!(
        err.to_string(),
        "failed to parse type 'OracleInstruction': Invalid size-discriminated union size: 4, expected one of [18, 11]"
    );
}

const STRUCTURE_ABI: &str = r#"
abi:
  package: "test.validate_structure"
  abi-version: 1
  package-version: "1.0.0"
  description: "test"
types:
  - name: "Count"
    kind:
      struct:
        packed: true
        fields:
          - name: "n"
            field-type: { primitive: u8 }
  - name: "Bytes"
    kind:
      array:
        size: { field-ref: { path: ["n"] } }
        element-type: { primitive: u8 }
"#;

#[test]
fn validate_buffer_still_reports_the_footprint() {
    let reflector = oracle_reflector();
    let mut update = hex("01000000");
    update.extend_from_slice(&[0u8; 11]);
    assert_eq!(
        reflector
            .validate_buffer("OracleInstruction", &update)
            .expect("an 11-byte payload is a declared variant")
            .bytes_consumed,
        15
    );
}

#[test]
fn validate_buffer_fails_closed_for_parameterized_non_structs() {
    let reflector = reflector_from_yaml(STRUCTURE_ABI);
    let type_ir = reflector.type_ir("Bytes").expect("IR");
    assert!(!type_ir.parameters.is_empty(), "Bytes reads a parameter");
    let err = reflector
        .validate_buffer("Bytes", &hex("0102"))
        .expect_err("parameters of a non-struct cannot be extracted");
    assert_eq!(
        err.to_string(),
        "unsupported operation 'validate_buffer': type 'Bytes' has dynamic parameters, which can only be extracted from a struct"
    );
}

/* 6. Decoding is bounded: zero-byte type graphs cannot expand
 * exponentially, and deep nesting fails before the stack does. */

fn abi_header(package: &str) -> String {
    format!(
        "abi:\n  package: \"{package}\"\n  abi-version: 1\n  package-version: \"1.0.0\"\n  description: \"test\"\ntypes:\n"
    )
}

/* `T0` is empty; each `Tn` holds two `T(n-1)`: 2^levels zero-byte values. */
fn zero_byte_graph(levels: usize) -> String {
    let mut yaml = abi_header("test.zero_byte_graph");
    yaml.push_str(
        "  - name: \"T0\"\n    kind:\n      struct:\n        packed: true\n        fields: []\n",
    );
    for n in 1..=levels {
        yaml.push_str(&format!(
            "  - name: \"T{n}\"\n    kind:\n      struct:\n        packed: true\n        fields:\n          - name: \"a\"\n            field-type: {{ type-ref: {{ name: \"T{p}\" }} }}\n          - name: \"b\"\n            field-type: {{ type-ref: {{ name: \"T{p}\" }} }}\n",
            p = n - 1
        ));
    }
    /* A root with a dynamic parameter, so parameter extraction walks the graph. */
    yaml.push_str(&format!(
        "  - name: \"Root\"\n    kind:\n      struct:\n        packed: true\n        fields:\n          - name: \"n\"\n            field-type: {{ primitive: u8 }}\n          - name: \"graph\"\n            field-type: {{ type-ref: {{ name: \"T{levels}\" }} }}\n          - name: \"items\"\n            field-type:\n              array:\n                size: {{ field-ref: {{ path: [\"n\"] }} }}\n                element-type: {{ primitive: u8 }}\n"
    ));
    yaml
}

#[test]
fn zero_byte_type_graphs_hit_the_value_budget() {
    let reflector = reflector_from_yaml(&zero_byte_graph(40));
    assert_eq!(
        reflect_error(&reflector, "T40", &[]),
        "failed to parse type 'T40': Decode limit exceeded: more than 65536 values"
    );
    assert_eq!(
        reflect_error(&reflector, "Root", &[0]),
        "type 'Root' exceeded a decode limit: more than 65544 values"
    );
    let err = reflector
        .validate_buffer("T40", &[])
        .expect_err("validation decodes the graph too");
    assert_eq!(
        err.to_string(),
        "failed to parse type 'T40': Decode limit exceeded: more than 65536 values"
    );
    /* Small graphs still reflect. */
    assert!(reflector.reflect(&[], "T4").is_ok());
}

/* `D0` holds a byte; each `Dn` holds one `D(n-1)`. */
fn deep_chain(levels: usize) -> String {
    let mut yaml = abi_header("test.deep_chain");
    yaml.push_str("  - name: \"D0\"\n    kind:\n      struct:\n        packed: true\n        fields:\n          - name: \"x\"\n            field-type: { primitive: u8 }\n");
    for n in 1..=levels {
        yaml.push_str(&format!(
            "  - name: \"D{n}\"\n    kind:\n      struct:\n        packed: true\n        fields:\n          - name: \"inner\"\n            field-type: {{ type-ref: {{ name: \"D{p}\" }} }}\n",
            p = n - 1
        ));
    }
    yaml
}

#[test]
fn deep_nesting_hits_the_depth_limit() {
    let reflector = reflector_from_yaml(&deep_chain(150));
    assert_eq!(
        reflect_error(&reflector, "D150", &[7]),
        "failed to parse type 'D150': Decode limit exceeded: nesting deeper than 256 levels"
    );
    assert!(reflector.reflect(&[7], "D100").is_ok());
}

#[test]
fn large_arrays_stay_within_the_budget() {
    let reflector = reflector_from_yaml(
        &(abi_header("test.large_array")
            + "  - name: \"Blob\"\n    kind:\n      array:\n        size: { literal: { u64: 2000000 } }\n        element-type: { primitive: u8 }\n"),
    );
    let value = reflector
        .reflect(&vec![0u8; 2_000_000], "Blob")
        .expect("2M bytes fit the per-byte budget");
    let abi_reflect::Value::Array { elements } = value.get_value() else {
        panic!("expected an array");
    };
    assert_eq!(elements.len(), 2_000_000);
}

/* 7. A size field resolves to the instance that reads it before any outer
 * field of the same name: each jagged `Item` sizes `data` from its own `n`,
 * not the root's. */

const NESTED_SAME_NAME_ABI: &str = r#"
abi:
  package: "test.nested_field_lookup"
  abi-version: 1
  package-version: "1.0.0"
  description: "test"
  options:
    program-metadata:
      root-types:
        instruction-root: "Root"
types:
  - name: "Item"
    kind:
      struct:
        packed: true
        fields:
          - name: "n"
            field-type: { primitive: u8 }
          - name: "data"
            field-type:
              array:
                size: { field-ref: { path: ["n"] } }
                element-type: { primitive: u8 }
  - name: "Root"
    kind:
      struct:
        packed: true
        fields:
          - name: "n"
            field-type: { primitive: u8 }
          - name: "items"
            field-type:
              array:
                jagged: true
                size: { field-ref: { path: ["n"] } }
                element-type: { type-ref: { name: "Item" } }
"#;

#[test]
fn nested_size_fields_resolve_to_their_own_instance() {
    let reflector = reflector_from_yaml(NESTED_SAME_NAME_ABI);
    let value = reflector
        .reflect_instruction(&hex("02 01aa 03bbccdd"))
        .expect("reflect instruction");
    assert_eq!(
        format_reflection(&value).value,
        json!({
            "n": 2,
            "items": [
                { "n": 1, "data": "0xaa", "typeName": "Item" },
                { "n": 3, "data": "0xbbccdd", "typeName": "Item" }
            ],
            "typeName": "Root"
        })
    );
}

/* 8. A parent reference (`["..", "count"]`) skips its own scope before the
 * lookup, so it names the enclosing struct's `count`, not the inline child's
 * own `count`. */

const PARENT_REF_ABI: &str = r#"
abi:
  package: "test.parent_field_lookup"
  abi-version: 1
  package-version: "1.0.0"
  description: "test"
types:
  - name: "Outer"
    kind:
      struct:
        packed: true
        fields:
          - name: "count"
            field-type: { primitive: u8 }
          - name: "inner"
            field-type:
              struct:
                packed: true
                fields:
                  - name: "count"
                    field-type: { primitive: u8 }
                  - name: "items"
                    field-type:
                      array:
                        size: { field-ref: { path: ["..", "count"] } }
                        element-type: { primitive: u8 }
                  - name: "m"
                    field-type: { primitive: u8 }
                  - name: "bytes"
                    field-type:
                      array:
                        size: { field-ref: { path: ["m"] } }
                        element-type: { primitive: u8 }
"#;

#[test]
fn parent_field_refs_skip_to_their_scope() {
    let reflector = reflector_from_yaml(PARENT_REF_ABI);
    let data = hex("02 01 aabb 00");
    let value = formatted(&reflector, "Outer", &data);
    assert_eq!(value["count"], json!(2));
    assert_eq!(value["inner"]["count"], json!(1));
    assert_eq!(value["inner"]["items"], json!("0xaabb"));
    assert_eq!(value["inner"]["m"], json!(0));
    let params = reflector.dynamic_params("Outer", &data).expect("params");
    assert_eq!(
        serde_json::to_string(&params).expect("params json"),
        r#"{"inner.items....count":2,"inner.m":0}"#
    );
    assert_eq!(
        reflector
            .validate_buffer("Outer", &data)
            .expect("validate")
            .bytes_consumed,
        5
    );
}

/* A parent reference whose first enclosing struct (`mid`) lacks the field
 * keeps searching outwards, as the resolver does: `["..", "count"]` in
 * `mid.inner` names the root's `count`. */

const PARENT_REF_OUTWARD_ABI: &str = r#"
abi:
  package: "test.parent_field_outward"
  abi-version: 1
  package-version: "1.0.0"
  description: "test"
types:
  - name: "Outer"
    kind:
      struct:
        packed: true
        fields:
          - name: "count"
            field-type: { primitive: u8 }
          - name: "mid"
            field-type:
              struct:
                packed: true
                fields:
                  - name: "inner"
                    field-type:
                      struct:
                        packed: true
                        fields:
                          - name: "count"
                            field-type: { primitive: u8 }
                          - name: "items"
                            field-type:
                              array:
                                size: { field-ref: { path: ["..", "count"] } }
                                element-type: { primitive: u8 }
                          - name: "m"
                            field-type: { primitive: u8 }
                          - name: "bytes"
                            field-type:
                              array:
                                size: { field-ref: { path: ["m"] } }
                                element-type: { primitive: u8 }
"#;

#[test]
fn parent_field_refs_search_outward_past_scopes_without_the_field() {
    let reflector = reflector_from_yaml(PARENT_REF_OUTWARD_ABI);
    let data = hex("02 01 aabb 00");
    let value = formatted(&reflector, "Outer", &data);
    assert_eq!(value["count"], json!(2));
    assert_eq!(value["mid"]["inner"]["count"], json!(1));
    assert_eq!(value["mid"]["inner"]["items"], json!("0xaabb"));
    assert_eq!(value["mid"]["inner"]["m"], json!(0));
    assert_eq!(
        reflector
            .validate_buffer("Outer", &data)
            .expect("validate")
            .bytes_consumed,
        5
    );
}

/* 9. The layout IR sizes a variable-size inline struct by all of its fields:
 * the fixed ones too, and each array element at its own width. */

fn inline_struct_abi(element: &str) -> String {
    abi_header("test.inline_struct_size")
        + &format!(
            r#"  - name: "Outer"
    kind:
      struct:
        packed: true
        fields:
          - name: "count"
            field-type: {{ primitive: u8 }}
          - name: "inner"
            field-type:
              struct:
                packed: true
                fields:
                  - name: "m"
                    field-type: {{ primitive: u8 }}
                  - name: "bytes"
                    field-type:
                      array:
                        size: {{ field-ref: {{ path: ["m"] }} }}
                        element-type: {{ primitive: {element} }}
                  - name: "z"
                    field-type: {{ primitive: u8 }}
"#
        )
}

#[test]
fn inline_variable_structs_count_their_fixed_fields() {
    let reflector = reflector_from_yaml(&inline_struct_abi("u8"));
    let data = hex("09 02 aabb 07");
    assert_eq!(
        reflector
            .validate_buffer("Outer", &data)
            .expect("validate")
            .bytes_consumed,
        5
    );
    assert_eq!(
        formatted(&reflector, "Outer", &data)["inner"]["z"],
        json!(7)
    );
}

#[test]
fn inline_variable_structs_size_wide_array_elements() {
    let reflector = reflector_from_yaml(&inline_struct_abi("u16"));
    let data = hex("09 02 0100 0200 07");
    assert_eq!(
        reflector
            .validate_buffer("Outer", &data)
            .expect("validate")
            .bytes_consumed,
        7
    );
    assert_eq!(
        formatted(&reflector, "Outer", &data)["inner"],
        json!({ "m": 2, "bytes": [1, 2], "z": 7, "typeName": "Outer::inner" })
    );
}

/* An inline struct's `__buffer_size` is the bytes left for it (the
 * enclosing struct's bytes from its offset on), not the root buffer: `tail`
 * here takes what `inner` has after `m` and `head`. */

const INLINE_BUFFER_SIZE_ABI: &str = r#"
abi:
  package: "test.inline_buffer_size"
  abi-version: 1
  package-version: "1.0.0"
  description: "test"
types:
  - name: "Outer"
    kind:
      struct:
        packed: true
        fields:
          - name: "n"
            field-type: { primitive: u8 }
          - name: "inner"
            field-type:
              struct:
                packed: true
                fields:
                  - name: "m"
                    field-type: { primitive: u8 }
                  - name: "head"
                    field-type:
                      array:
                        size: { field-ref: { path: ["m"] } }
                        element-type: { primitive: u8 }
                  - name: "tail"
                    field-type:
                      array:
                        size: { sub: { left: { sub: { left: { field-ref: { path: ["__buffer_size"] } }, right: { literal: { u64: 1 } } } }, right: { field-ref: { path: ["m"] } } } }
                        element-type: { primitive: u8 }
"#;

#[test]
fn inline_structs_read_their_own_buffer_size() {
    let reflector = reflector_from_yaml(INLINE_BUFFER_SIZE_ABI);
    let data = hex("09 01 aa bb");
    assert_eq!(
        formatted(&reflector, "Outer", &data),
        json!({
            "n": 9,
            "inner": { "m": 1, "head": "0xaa", "tail": "0xbb", "typeName": "Outer::inner" },
            "typeName": "Outer"
        })
    );
    assert_eq!(
        reflector
            .validate_buffer("Outer", &data)
            .expect("validate")
            .bytes_consumed,
        4
    );
}

/* Each inline struct read by `__buffer_size` is sized from the bytes before
 * it, so a layout IR tree for many such siblings doubles per sibling. Past
 * a node budget, building it fails fast with an error instead. */

/* `Root { lead: u8, s0..: { data: u8[__buffer_size / 2] } }`. */
fn buffer_sized_siblings(count: usize) -> String {
    let mut yaml = abi_header("test.buffer_sized_siblings");
    yaml.push_str("  - name: \"Root\"\n    kind:\n      struct:\n        packed: true\n        fields:\n          - name: \"lead\"\n            field-type: { primitive: u8 }\n");
    for i in 0..count {
        yaml.push_str(&format!(
            "          - name: \"s{i}\"\n            field-type:\n              struct:\n                packed: true\n                fields:\n                  - name: \"data\"\n                    field-type:\n                      array:\n                        size: {{ div: {{ left: {{ field-ref: {{ path: [\"__buffer_size\"] }} }}, right: {{ literal: {{ u64: 2 }} }} }} }}\n                        element-type: {{ primitive: u8 }}\n"
        ));
    }
    yaml
}

#[test]
fn buffer_sized_inline_siblings_stay_within_the_ir_node_budget() {
    let start = std::time::Instant::now();
    let err = match try_reflector_from_yaml(&buffer_sized_siblings(25)) {
        Ok(_) => panic!("25 buffer-sized siblings built a layout IR"),
        Err(err) => err,
    };
    assert!(
        start.elapsed() < std::time::Duration::from_secs(5),
        "took {:?}",
        start.elapsed()
    );
    assert_eq!(
        err,
        "failed to build layout IR: type 'Root' layout IR would exceed 65536 nodes"
    );

    /* Fewer siblings still build. One validates: lead, then 4 of the 8
     * bytes left. */
    assert!(try_reflector_from_yaml(&buffer_sized_siblings(8)).is_ok());
    let reflector = reflector_from_yaml(&buffer_sized_siblings(1));
    assert_eq!(
        reflector
            .validate_buffer("Root", &[0u8; 9])
            .expect("validate")
            .bytes_consumed,
        5
    );
}

/* Parameters an inline struct's layout IR adds keep resolving: an enum
 * tagged by a computed expression (`flags & 1`), the same enum one inline
 * struct deeper and directly in a packed struct (its size is not rounded up
 * to the u16 variant's alignment), and a size-discriminated union whose
 * payload is the bytes after `x`, not the whole inline struct. Shared with
 * the C, Rust and Go codegen tests. */

fn inline_computed_tag_reflector() -> Reflector {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../abi_gen/tests/go_fixtures/inline_computed_tag.abi.yaml");
    reflector_from_yaml(&fs::read_to_string(path).expect("read ABI"))
}

fn expect_reflected(
    reflector: &Reflector,
    type_name: &str,
    data: &str,
    want: JsonValue,
    consumed: u128,
) {
    let bytes = hex(data);
    assert_eq!(
        formatted(reflector, type_name, &bytes),
        want,
        "{type_name} {data}"
    );
    assert_eq!(
        reflector
            .validate_buffer(type_name, &bytes)
            .unwrap_or_else(|err| panic!("validate {type_name} {data}: {err}"))
            .bytes_consumed,
        consumed,
        "{type_name} {data}"
    );
}

#[test]
fn inline_struct_computed_tags_and_payloads_resolve() {
    let reflector = inline_computed_tag_reflector();
    expect_reflected(
        &reflector,
        "Outer",
        "00 07",
        json!({
            "inner": { "flags": 0, "body": { "variant": "small", "value": 7 }, "typeName": "Outer::inner" },
            "typeName": "Outer"
        }),
        2,
    );
    expect_reflected(
        &reflector,
        "Outer",
        "01 0807",
        json!({
            "inner": { "flags": 1, "body": { "variant": "wide", "value": 0x0708 }, "typeName": "Outer::inner" },
            "typeName": "Outer"
        }),
        3,
    );
    expect_reflected(
        &reflector,
        "Flat",
        "00 07",
        json!({ "flags": 0, "body": { "variant": "small", "value": 7 }, "typeName": "Flat" }),
        2,
    );
    expect_reflected(
        &reflector,
        "Sized",
        "09 0201",
        json!({
            "inner": { "x": 9, "body": { "variant": "two", "value": 0x0102 }, "typeName": "Sized::inner" },
            "typeName": "Sized"
        }),
        3,
    );
}

#[test]
fn computed_tags_resolve_two_inline_structs_deep() {
    let reflector = reflector_from_yaml(
        r#"
abi:
  package: "test.nested_inline_computed_tag"
  abi-version: 1
  package-version: "1.0.0"
  description: "test"
types:
  - name: "Outer"
    kind:
      struct:
        packed: true
        fields:
          - name: "mid"
            field-type:
              struct:
                packed: true
                fields:
                  - name: "inner"
                    field-type:
                      struct:
                        packed: true
                        fields:
                          - name: "flags"
                            field-type: { primitive: u8 }
                          - name: "body"
                            field-type:
                              enum:
                                packed: true
                                tag-ref: { bit-and: { left: { field-ref: { path: ["flags"] } }, right: { literal: { u64: 1 } } } }
                                variants:
                                  - name: "small"
                                    tag-value: 0
                                    variant-type: { primitive: u8 }
                                  - name: "wide"
                                    tag-value: 1
                                    variant-type: { primitive: u16 }
"#,
    );
    expect_reflected(
        &reflector,
        "Outer",
        "00 07",
        json!({
            "mid": {
                "inner": { "flags": 0, "body": { "variant": "small", "value": 7 }, "typeName": "Outer::mid::inner" },
                "typeName": "Outer::mid"
            },
            "typeName": "Outer"
        }),
        2,
    );
}

/* Two inline structs each holding a named variable-size child
 * (`A { n, items: u8[n] }`): each child's count is its own IR input
 * (`left.items.n`, `right.items.n`), so the IR sizes children with
 * different counts. Reflecting these bytes end to end also needs parameter
 * extraction to bind a named child's inputs and the parser to accept a
 * variable-size inline struct before the last field; neither does yet. */
#[test]
fn inline_children_keep_separate_ir_inputs() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../abi_gen/tests/go_fixtures/inline_child_inputs.abi.yaml");
    let reflector = reflector_from_yaml(&fs::read_to_string(path).expect("read ABI"));
    let names: Vec<&str> = reflector
        .type_ir("Outer")
        .expect("Outer IR")
        .parameters
        .iter()
        .map(|param| param.name.as_str())
        .collect();
    assert_eq!(names, ["left.items.n", "right.items.n"]);
    for (data, left, right, consumed) in [
        ("01 aa 02 bbcc", 1u128, 2u128, 5u128),
        ("02 aabb 00", 2, 0, 4),
    ] {
        let params = abi_reflect::ir::ParamMap::from([
            ("left.items.n".to_string(), left),
            ("right.items.n".to_string(), right),
        ]);
        assert_eq!(
            reflector
                .validate_buffer_ir("Outer", &hex(data), &params)
                .unwrap_or_else(|err| panic!("validate {data}: {err}"))
                .bytes_consumed,
            consumed,
            "{data}"
        );
    }
}
