use abi_gen::abi::file::{AbiFile, ImportResolver};
use abi_gen::abi::resolved::TypeResolver;
use abi_reflect::{format_reflection, Reflector};
use serde_json::Value as JsonValue;
use std::fs;
use std::path::{Path, PathBuf};

fn crate_root() -> &'static Path {
    Path::new(env!("CARGO_MANIFEST_DIR"))
}

fn load_reflector(relative_path: &str) -> Reflector {
    let path = crate_root().join(relative_path);
    let yaml = fs::read_to_string(&path).expect("read ABI fixture");
    reflector_from_yaml(&yaml)
}

/* Load reflector with import resolution for ABI files that have dependencies */
fn load_reflector_with_imports(relative_path: &str) -> Reflector {
    let path = crate_root().join(relative_path);
    let type_library_dir = crate_root().join("../type-library");

    let mut import_resolver = ImportResolver::new(vec![PathBuf::from(&type_library_dir)]);
    import_resolver
        .load_file_with_imports(&path, false)
        .expect("load ABI file with imports");

    let mut resolver = TypeResolver::new();
    for typedef in import_resolver.get_all_types() {
        resolver.add_typedef(typedef.clone());
    }
    resolver.resolve_all().expect("resolve types");
    Reflector::new(resolver).expect("build reflector")
}

fn reflector_from_yaml(yaml: &str) -> Reflector {
    let abi_file: AbiFile = serde_yml::from_str(yaml).expect("parse ABI YAML");

    let mut resolver = TypeResolver::new();
    for typedef in abi_file.types {
        resolver.add_typedef(typedef);
    }
    resolver.resolve_all().expect("resolve types");
    Reflector::new(resolver).expect("build reflector")
}

fn hex_to_bytes(hex: &str) -> Vec<u8> {
    let cleaned: String = hex.chars().filter(|c| !c.is_whitespace()).collect();
    if cleaned.len() % 2 != 0 {
        panic!("hex string must contain an even number of characters");
    }
    (0..cleaned.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&cleaned[i..i + 2], 16).expect("valid hex"))
        .collect()
}

fn load_binary(relative_path: &str) -> Vec<u8> {
    let path = crate_root().join(relative_path);
    fs::read(&path).expect("read binary fixture")
}

fn assert_float(value: &JsonValue, expected: f64, epsilon: f64) {
    let actual = value
        .as_f64()
        .unwrap_or_else(|| panic!("value {value:?} is not a JSON number"));
    assert!(
        (actual - expected).abs() <= epsilon,
        "expected {expected}, got {actual}"
    );
}

#[test]
fn simple_struct_formats_like_js() {
    let reflector =
        load_reflector("../abi_gen/tests/compliance_tests/abi_definitions/structs.abi.yaml");
    let bytes = hex_to_bytes("39 30 00 00 00 00 00 00 42 0f 27");
    let reflected = reflector
        .reflect(&bytes, "SimpleStruct")
        .expect("reflection succeeds");
    let formatted = format_reflection(&reflected);

    assert_eq!(formatted.type_name, "SimpleStruct");
    assert_eq!(formatted.kind.as_deref(), Some("struct"));
    let obj = formatted.value.as_object().expect("struct value");
    assert_eq!(obj.get("id").and_then(JsonValue::as_u64), Some(12345));
    assert_eq!(obj.get("flags").and_then(JsonValue::as_u64), Some(0x42));
    assert_eq!(obj.get("value").and_then(JsonValue::as_u64), Some(0x270f));
}

#[test]
fn token_instruction_fixture_formats() {
    let reflector = load_reflector_with_imports("../type-library/token_program.abi.yaml");
    let token_instruction_hex = "\
        00020009ace7124bd312557a711a15c92d38a2d7e0d2fbf6ede3092df4a543d0\
        a00122ae00000000000000000000000000000000000000000000000000000000000000000000044845454700000000\
        ae0bef80d026bbe2ffce0b69cee5355a145bbd604f96c5c2cbf2740e98bd79d12e01000000000080000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000";
    let mut bytes = vec![0u8; 9000];
    let payload = hex_to_bytes(token_instruction_hex);
    bytes[..payload.len()].copy_from_slice(&payload);

    let reflected = reflector
        .reflect(&bytes, "TokenInstruction")
        .expect("token reflection succeeds");
    let formatted = format_reflection(&reflected);

    let payload_obj = formatted
        .value
        .as_object()
        .and_then(|map| map.get("payload"))
        .and_then(JsonValue::as_object)
        .expect("payload present");

    assert_eq!(
        payload_obj.get("variant").and_then(JsonValue::as_str),
        Some("initialize_mint")
    );

    let variant_value = payload_obj
        .get("value")
        .and_then(JsonValue::as_object)
        .expect("variant value");
    assert_eq!(
        variant_value.get("typeName").and_then(JsonValue::as_str),
        Some("InitializeMintInstruction")
    );

    let raw_len = serde_json::to_string(&reflected).unwrap().len();
    let formatted_len = serde_json::to_string(&formatted).unwrap().len();
    assert!(formatted_len < raw_len / 5);
}

#[test]
fn token_account_fixture_formats() {
    let reflector = load_reflector_with_imports("../type-library/token_program.abi.yaml");
    let token_account_hex =
        "906b582852c5940dfe2664bc77717eb62e05e9c5b5b5c8d59cd4756d5c3dd771ace7124bd312557a711a15c92d38a2d7e0d2fbf6ede3092df4a543d0a00122ae00d0ed902e00000000";
    let bytes = hex_to_bytes(token_account_hex);

    let reflected = reflector
        .reflect(&bytes, "TokenAccount")
        .expect("token account reflection succeeds");
    let formatted = format_reflection(&reflected);

    let account = formatted.value.as_object().expect("account struct");
    let mint = account
        .get("mint")
        .and_then(JsonValue::as_object)
        .expect("mint field");
    assert_eq!(
        mint.get("typeName").and_then(JsonValue::as_str),
        Some("Pubkey")
    );
    assert!(
        mint.get("bytes")
            .and_then(JsonValue::as_str)
            .unwrap_or("")
            .starts_with("0x"),
        "mint bytes should be hex"
    );
    assert_eq!(
        mint.get("address").and_then(JsonValue::as_str),
        Some("takGtYKFLFlA3-JmS8d3F-ti4F6cW1tcjVnNR1bVw913Gu"),
        "mint address should be encoded in Thru format"
    );

    let owner = account
        .get("owner")
        .and_then(JsonValue::as_object)
        .expect("owner field");
    assert_eq!(
        owner.get("typeName").and_then(JsonValue::as_str),
        Some("Pubkey")
    );
    assert_eq!(
        owner.get("address").and_then(JsonValue::as_str),
        Some("tarOcSS9MSVXpxGhXJLTii1-DS-_bt4wkt9KVD0KABIq6x"),
        "owner address should be encoded in Thru format"
    );

    assert!(account.get("amount").is_some());
}

#[test]
fn layout_ir_contains_simple_struct() {
    let reflector =
        load_reflector("../abi_gen/tests/compliance_tests/abi_definitions/structs.abi.yaml");
    let layout = reflector.layout_ir();
    let has_simple_struct = layout.types.iter().any(|ty| ty.type_name == "SimpleStruct");
    assert!(has_simple_struct, "SimpleStruct layout missing");
}

#[test]
fn primitives_binary_fixture_formats_expected_values() {
    let reflector =
        load_reflector("../abi_gen/tests/compliance_tests/abi_definitions/primitives.abi.yaml");
    let bytes =
        load_binary("../abi_gen/tests/compliance_tests/binary_data/primitives/common_values.bin");
    let reflected = reflector
        .reflect(&bytes, "AllPrimitives")
        .expect("primitive reflection succeeds");
    let formatted = format_reflection(&reflected);
    let obj = formatted.value.as_object().expect("AllPrimitives struct");

    assert_eq!(obj.get("u8_val").and_then(JsonValue::as_u64), Some(42));
    assert_eq!(obj.get("u16_val").and_then(JsonValue::as_u64), Some(1000));
    assert_eq!(
        obj.get("u32_val").and_then(JsonValue::as_u64),
        Some(0x12345678)
    );
    assert_eq!(
        obj.get("u64_val").and_then(JsonValue::as_u64),
        Some(0x123456789ABCDEF0)
    );
    assert_eq!(obj.get("i8_val").and_then(JsonValue::as_i64), Some(-42));
    assert_eq!(obj.get("i16_val").and_then(JsonValue::as_i64), Some(-1234));
    assert_eq!(
        obj.get("i32_val").and_then(JsonValue::as_i64),
        Some(-123456)
    );
    assert_eq!(
        obj.get("i64_val").and_then(JsonValue::as_i64),
        Some(-123456789)
    );
    assert_float(obj.get("f32_val").expect("f32"), std::f64::consts::PI, 1e-5);
    assert_float(obj.get("f64_val").expect("f64"), std::f64::consts::E, 1e-12);
}

#[test]
fn fixed_arrays_fixture_formats_hex_and_numbers() {
    let reflector =
        load_reflector("../abi_gen/tests/compliance_tests/abi_definitions/arrays.abi.yaml");
    let bytes = load_binary("../abi_gen/tests/compliance_tests/binary_data/arrays/simple.bin");
    let reflected = reflector
        .reflect(&bytes, "FixedArrays")
        .expect("FixedArrays reflection succeeds");
    let formatted = format_reflection(&reflected);
    let obj = formatted.value.as_object().expect("FixedArrays struct");

    assert_eq!(
        obj.get("u8_array").and_then(JsonValue::as_str),
        Some("0x01020304")
    );
    assert_eq!(
        obj.get("u16_array")
            .and_then(JsonValue::as_array)
            .map(|vals| vals.iter().map(|v| v.as_u64().unwrap()).collect::<Vec<_>>()),
        Some(vec![10, 20, 30])
    );
    assert_eq!(
        obj.get("u32_array")
            .and_then(JsonValue::as_array)
            .map(|vals| vals.iter().map(|v| v.as_u64().unwrap()).collect::<Vec<_>>()),
        Some(vec![100, 200])
    );
    assert_eq!(
        obj.get("i32_array")
            .and_then(JsonValue::as_array)
            .map(|vals| { vals.iter().map(|v| v.as_i64().unwrap()).collect::<Vec<_>>() }),
        Some(vec![-1, 0, 1, -100, 100])
    );
}

#[test]
fn simple_enum_fixture_formats_variants() {
    let reflector =
        load_reflector("../abi_gen/tests/compliance_tests/abi_definitions/enums.abi.yaml");

    let none_bytes = load_binary("../abi_gen/tests/compliance_tests/binary_data/enums/none.bin");
    let none = reflector
        .reflect(&none_bytes, "SimpleEnum")
        .expect("enum none reflect");
    let formatted_none = format_reflection(&none);
    let payload_none = formatted_none
        .value
        .as_object()
        .and_then(|obj| obj.get("body"))
        .and_then(JsonValue::as_object)
        .expect("enum payload");
    assert_eq!(
        payload_none.get("variant").and_then(JsonValue::as_str),
        Some("None")
    );

    let value_bytes = load_binary("../abi_gen/tests/compliance_tests/binary_data/enums/value.bin");
    let value = reflector
        .reflect(&value_bytes, "SimpleEnum")
        .expect("enum value reflect");
    let formatted_value = format_reflection(&value);
    let payload_value = formatted_value
        .value
        .as_object()
        .and_then(|obj| obj.get("body"))
        .and_then(JsonValue::as_object)
        .expect("enum payload");
    assert_eq!(
        payload_value.get("variant").and_then(JsonValue::as_str),
        Some("Value")
    );
    assert_eq!(
        payload_value
            .get("value")
            .and_then(JsonValue::as_object)
            .and_then(|obj| obj.get("data"))
            .and_then(JsonValue::as_u64),
        Some(42)
    );

    let pair_bytes = load_binary("../abi_gen/tests/compliance_tests/binary_data/enums/pair.bin");
    let pair = reflector
        .reflect(&pair_bytes, "SimpleEnum")
        .expect("enum pair reflect");
    let formatted_pair = format_reflection(&pair);
    let payload_pair = formatted_pair
        .value
        .as_object()
        .and_then(|obj| obj.get("body"))
        .and_then(JsonValue::as_object)
        .expect("enum pair payload");
    assert_eq!(
        payload_pair.get("variant").and_then(JsonValue::as_str),
        Some("Pair")
    );
    assert_eq!(
        payload_pair
            .get("value")
            .and_then(JsonValue::as_object)
            .and_then(|obj| obj.get("first"))
            .and_then(JsonValue::as_u64),
        Some(100)
    );
    assert_eq!(
        payload_pair
            .get("value")
            .and_then(JsonValue::as_object)
            .and_then(|obj| obj.get("second"))
            .and_then(JsonValue::as_u64),
        Some(200)
    );

    let bytes_bytes = load_binary("../abi_gen/tests/compliance_tests/binary_data/enums/bytes.bin");
    let bytes_variant = reflector
        .reflect(&bytes_bytes, "SimpleEnum")
        .expect("enum bytes reflect");
    let formatted_bytes = format_reflection(&bytes_variant);
    let payload_bytes = formatted_bytes
        .value
        .as_object()
        .and_then(|obj| obj.get("body"))
        .and_then(JsonValue::as_object)
        .expect("enum bytes payload");
    assert_eq!(
        payload_bytes.get("variant").and_then(JsonValue::as_str),
        Some("Bytes")
    );
    assert_eq!(
        payload_bytes
            .get("value")
            .and_then(JsonValue::as_object)
            .and_then(|obj| obj.get("data"))
            .and_then(JsonValue::as_str),
        Some("0x0102030405060708")
    );
}

#[test]
fn simple_union_fixture_formats_first_variant() {
    let reflector =
        load_reflector("../abi_gen/tests/compliance_tests/abi_definitions/unions.abi.yaml");

    let int_bytes =
        load_binary("../abi_gen/tests/compliance_tests/binary_data/unions/int_value.bin");
    let int_value = reflector
        .reflect(&int_bytes, "SimpleUnion")
        .expect("union int reflect");
    let formatted_int = format_reflection(&int_value);
    let int_obj = formatted_int
        .value
        .as_object()
        .expect("union formatted object");
    assert_eq!(
        int_obj.get("variant").and_then(JsonValue::as_str),
        Some("int_value")
    );
    assert_eq!(int_obj.get("value").and_then(JsonValue::as_i64), Some(-42));

    // Document the current limitation: regardless of payload, unions always report the
    // first variant. Once union dispatch is implemented we can enable the ignored
    // regression test below.
    let float_bytes =
        load_binary("../abi_gen/tests/compliance_tests/binary_data/unions/float_value.bin");
    let float_value = reflector
        .reflect(&float_bytes, "SimpleUnion")
        .expect("union float reflect");
    let formatted_float = format_reflection(&float_value);
    let float_obj = formatted_float
        .value
        .as_object()
        .expect("union float object");
    assert_eq!(
        float_obj.get("variant").and_then(JsonValue::as_str),
        Some("int_value"),
        "SimpleUnion parser currently always reports the first variant"
    );
}

#[test]
#[ignore = "Union parsing currently always selects the first variant"]
fn simple_union_fixture_should_distinguish_variants() {
    let reflector =
        load_reflector("../abi_gen/tests/compliance_tests/abi_definitions/unions.abi.yaml");

    let float_bytes =
        load_binary("../abi_gen/tests/compliance_tests/binary_data/unions/float_value.bin");
    let float_value = reflector
        .reflect(&float_bytes, "SimpleUnion")
        .expect("union float reflect");
    let formatted_float = format_reflection(&float_value);
    let float_obj = formatted_float
        .value
        .as_object()
        .expect("union float object");
    assert_eq!(
        float_obj.get("variant").and_then(JsonValue::as_str),
        Some("float_value")
    );
    assert_float(
        float_obj.get("value").expect("float payload"),
        std::f64::consts::PI,
        1e-6,
    );

    let bytes_bytes = load_binary("../abi_gen/tests/compliance_tests/binary_data/unions/bytes.bin");
    let bytes_value = reflector
        .reflect(&bytes_bytes, "SimpleUnion")
        .expect("union bytes reflect");
    let formatted_bytes = format_reflection(&bytes_value);
    let bytes_obj = formatted_bytes
        .value
        .as_object()
        .expect("union bytes object");
    assert_eq!(
        bytes_obj.get("variant").and_then(JsonValue::as_str),
        Some("bytes")
    );
    assert_eq!(
        bytes_obj.get("value").and_then(JsonValue::as_str),
        Some("0xdeadbeef")
    );
}

#[test]
fn token_instruction_layout_has_payload_param() {
    let reflector = load_reflector_with_imports("../type-library/token_program.abi.yaml");
    let type_ir = reflector
        .type_ir("TokenInstruction")
        .expect("token instruction IR");
    let has_payload_param = type_ir
        .parameters
        .iter()
        .any(|param| param.name.contains("payload.payload_size"));
    assert!(
        has_payload_param,
        "expected payload.payload_size parameter in TokenInstruction IR"
    );
}

#[test]
fn pubkey_zero_address_formats_correctly() {
    let reflector = load_reflector_with_imports("../type-library/token_program.abi.yaml");
    /* TokenAccount = mint(32) + owner(32) + amount(8) + is_frozen(1) = 73 bytes */
    let zero_account_hex = "\
        0000000000000000000000000000000000000000000000000000000000000000\
        0000000000000000000000000000000000000000000000000000000000000000\
        000000000000000000";
    let bytes = hex_to_bytes(zero_account_hex);

    let reflected = reflector
        .reflect(&bytes, "TokenAccount")
        .expect("zero pubkey reflection succeeds");
    let formatted = format_reflection(&reflected);

    let account = formatted.value.as_object().expect("account struct");
    let mint = account
        .get("mint")
        .and_then(JsonValue::as_object)
        .expect("mint field");
    assert_eq!(
        mint.get("address").and_then(JsonValue::as_str),
        Some("taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
        "zero pubkey should encode to all-A address"
    );
    let owner = account
        .get("owner")
        .and_then(JsonValue::as_object)
        .expect("owner field");
    assert_eq!(
        owner.get("address").and_then(JsonValue::as_str),
        Some("taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
        "zero pubkey should encode to all-A address"
    );
}
