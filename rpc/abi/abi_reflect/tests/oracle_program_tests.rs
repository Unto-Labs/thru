/* Golden reflection tests for the packed oracle program wire format. */

use abi_gen::abi::file::ImportResolver;
use abi_gen::abi::resolved::TypeResolver;
use abi_reflect::ir::ParamMap;
use abi_reflect::parser::{ParseError, Parser};
use abi_reflect::value::{PrimitiveValue, ReflectedValue, Value};
use std::path::PathBuf;

fn load_oracle_resolver() -> TypeResolver {
    let type_library_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../type-library");
    let oracle_path = type_library_dir.join("tn_oracle_program.abi.yaml");

    let mut import_resolver = ImportResolver::new(vec![type_library_dir]);
    import_resolver
        .load_file_with_imports(&oracle_path, false)
        .expect("load oracle ABI");

    let mut resolver = TypeResolver::new();
    for typedef in import_resolver.get_all_types() {
        resolver.add_typedef(typedef.clone());
    }
    resolver.resolve_all().expect("resolve oracle ABI types");
    resolver
}

fn parse(
    resolver: &TypeResolver,
    type_name: &str,
    data: &[u8],
) -> Result<ReflectedValue, ParseError> {
    let resolved_type = resolver
        .get_type_info(type_name)
        .unwrap_or_else(|| panic!("{type_name} type resolved"));
    Parser::new(resolver, ParamMap::new()).parse(data, resolved_type)
}

fn struct_field<'a>(value: &'a ReflectedValue, name: &str) -> &'a ReflectedValue {
    let Value::Struct { fields } = &value.value else {
        panic!("expected struct, got {:?}", value.value);
    };
    &fields
        .iter()
        .find(|(field_name, _)| field_name == name)
        .unwrap_or_else(|| panic!("missing field {name}"))
        .1
}

fn unwrap_type_ref(value: &ReflectedValue) -> &ReflectedValue {
    match &value.value {
        Value::TypeRef { value, .. } => unwrap_type_ref(value),
        _ => value,
    }
}

fn enum_variant<'a>(value: &'a ReflectedValue, expected: &str) -> &'a ReflectedValue {
    let Value::Enum {
        variant_name,
        variant_value,
        ..
    } = &value.value
    else {
        panic!("expected enum, got {:?}", value.value);
    };
    assert_eq!(variant_name, expected);
    unwrap_type_ref(variant_value)
}

fn size_variant<'a>(value: &'a ReflectedValue, expected: &str) -> &'a ReflectedValue {
    let Value::SizeDiscriminatedUnion {
        variant_name,
        variant_value,
    } = &value.value
    else {
        panic!("expected size-discriminated union, got {:?}", value.value);
    };
    assert_eq!(variant_name, expected);
    unwrap_type_ref(variant_value)
}

fn primitive(value: &ReflectedValue) -> &PrimitiveValue {
    let value = unwrap_type_ref(value);
    let Value::Primitive(primitive) = &value.value else {
        panic!("expected primitive, got {:?}", value.value);
    };
    primitive
}

fn u8_value(value: &ReflectedValue) -> u8 {
    let PrimitiveValue::U8(value) = primitive(value) else {
        panic!("expected u8, got {:?}", value.value);
    };
    value.value
}

fn u16_value(value: &ReflectedValue) -> u16 {
    let PrimitiveValue::U16(value) = primitive(value) else {
        panic!("expected u16, got {:?}", value.value);
    };
    value.value
}

fn u32_value(value: &ReflectedValue) -> u32 {
    let PrimitiveValue::U32(value) = primitive(value) else {
        panic!("expected u32, got {:?}", value.value);
    };
    value.value
}

fn u64_value(value: &ReflectedValue) -> u64 {
    let PrimitiveValue::U64(value) = primitive(value) else {
        panic!("expected u64, got {:?}", value.value);
    };
    value.value
}

fn i32_value(value: &ReflectedValue) -> i32 {
    let PrimitiveValue::I32(value) = primitive(value) else {
        panic!("expected i32, got {:?}", value.value);
    };
    value.value
}

fn array_bytes(value: &ReflectedValue) -> Vec<u8> {
    let value = unwrap_type_ref(value);
    if let Value::Struct { .. } = &value.value {
        return array_bytes(struct_field(value, "bytes"));
    }
    let Value::Array { elements } = &value.value else {
        panic!("expected array, got {:?}", value.value);
    };
    elements.iter().map(u8_value).collect()
}

fn assert_common_feed_fields(common: &ReflectedValue) {
    let common = unwrap_type_ref(common);
    assert_eq!(
        u64_value(struct_field(common, "max_staleness_ns")),
        30_000_000_000
    );
    assert_eq!(
        u64_value(struct_field(common, "last_update_ns")),
        1_234_567_890
    );
    assert_eq!(
        array_bytes(struct_field(common, "admin_address")),
        vec![0x11; 32]
    );
    assert_eq!(
        array_bytes(struct_field(common, "reporter_address")),
        vec![0x22; 32]
    );
    let name = array_bytes(struct_field(common, "feed_name"));
    assert_eq!(&name[..7], b"BTC/USD");
    assert!(name[7..].iter().all(|byte| *byte == 0));
}

fn assert_create_feed_fields(args: &ReflectedValue, feed_type: u8, type_size: u64, proof: &[u8]) {
    assert_eq!(
        u64_value(struct_field(args, "max_staleness_ns")),
        30_000_000_000
    );
    assert_eq!(
        u64_value(struct_field(args, "proof_size")),
        proof.len() as u64
    );
    assert_eq!(
        u64_value(struct_field(args, "type_specific_size")),
        type_size
    );
    assert_eq!(u16_value(struct_field(args, "admin_account_idx")), 0);
    assert_eq!(u16_value(struct_field(args, "reporter_account_idx")), 1);
    assert_eq!(u16_value(struct_field(args, "feed_account_idx")), 2);
    assert_eq!(u8_value(struct_field(args, "feed_type")), feed_type);
    assert_eq!(
        array_bytes(struct_field(args, "feed_account_seed")),
        vec![0x5a; 32]
    );
    let name = array_bytes(struct_field(args, "feed_name"));
    assert_eq!(&name[..7], b"BTC/USD");
    assert!(name[7..].iter().all(|byte| *byte == 0));
    assert_eq!(array_bytes(struct_field(args, "proof")), proof);
}

fn push_u16(buffer: &mut Vec<u8>, value: u16) {
    buffer.extend_from_slice(&value.to_le_bytes());
}

fn push_u32(buffer: &mut Vec<u8>, value: u32) {
    buffer.extend_from_slice(&value.to_le_bytes());
}

fn push_u64(buffer: &mut Vec<u8>, value: u64) {
    buffer.extend_from_slice(&value.to_le_bytes());
}

fn post_price_update() -> Vec<u8> {
    let mut buffer = Vec::new();
    push_u32(&mut buffer, 1);
    push_u64(&mut buffer, 42_000);
    push_u64(&mut buffer, 1_234_567_890);
    push_u16(&mut buffer, 2);
    buffer
}

fn post_boolean_update() -> Vec<u8> {
    let mut buffer = Vec::new();
    push_u32(&mut buffer, 1);
    buffer.push(1);
    push_u64(&mut buffer, 1_234_567_890);
    push_u16(&mut buffer, 2);
    buffer
}

fn set_params() -> Vec<u8> {
    let mut buffer = Vec::new();
    push_u32(&mut buffer, 2);
    push_u64(&mut buffer, 45_000_000_000);
    push_u32(&mut buffer, 750);
    push_u16(&mut buffer, 3);
    buffer
}

fn set_admin() -> Vec<u8> {
    let mut buffer = Vec::new();
    push_u32(&mut buffer, 3);
    push_u16(&mut buffer, 4);
    push_u16(&mut buffer, 7);
    buffer
}

fn set_reporter() -> Vec<u8> {
    let mut buffer = Vec::new();
    push_u32(&mut buffer, 4);
    push_u16(&mut buffer, 5);
    push_u16(&mut buffer, 8);
    buffer
}

fn create_feed(feed_type: u8, proof: &[u8]) -> Vec<u8> {
    let mut buffer = Vec::new();
    push_u32(&mut buffer, 0);
    push_u64(&mut buffer, 30_000_000_000);
    push_u64(&mut buffer, proof.len() as u64);
    push_u64(&mut buffer, if feed_type == 1 { 8 } else { 0 });
    push_u16(&mut buffer, 0);
    push_u16(&mut buffer, 1);
    push_u16(&mut buffer, 2);
    buffer.push(feed_type);
    buffer.extend_from_slice(&[0x5a; 32]);

    let mut name = [0u8; 64];
    name[..7].copy_from_slice(b"BTC/USD");
    buffer.extend_from_slice(&name);

    if feed_type == 1 {
        push_u32(&mut buffer, 500);
        buffer.extend_from_slice(&(-8i32).to_le_bytes());
    }
    buffer.extend_from_slice(proof);
    buffer
}

fn feed_account(feed_type: u8) -> Vec<u8> {
    let mut buffer = Vec::new();
    buffer.push(feed_type);
    push_u64(&mut buffer, 30_000_000_000);
    push_u64(&mut buffer, 1_234_567_890);
    buffer.extend_from_slice(&[0x11; 32]);
    buffer.extend_from_slice(&[0x22; 32]);

    let mut name = [0u8; 64];
    name[..7].copy_from_slice(b"BTC/USD");
    buffer.extend_from_slice(&name);

    if feed_type == 1 {
        push_u64(&mut buffer, 42_000);
        push_u32(&mut buffer, 500);
        buffer.extend_from_slice(&(-8i32).to_le_bytes());
    } else {
        buffer.push(1);
    }
    buffer
}

fn oracle_event(event_type: u8) -> Vec<u8> {
    let mut buffer = Vec::new();
    buffer.push(event_type);

    let mut name = [0u8; 64];
    name[..7].copy_from_slice(b"BTC/USD");
    buffer.extend_from_slice(&name);
    buffer.extend_from_slice(&[0x33; 32]);

    if event_type == 1 {
        push_u64(&mut buffer, 41_000);
        push_u64(&mut buffer, 42_000);
    } else {
        buffer.push(0);
        buffer.push(1);
    }
    push_u64(&mut buffer, 1_234_567_890);
    buffer
}

#[test]
fn oracle_post_update_selects_variant_from_payload_size() {
    let resolver = load_oracle_resolver();

    let price = post_price_update();
    assert_eq!(price.len(), 22);
    let reflected = parse(&resolver, "OracleInstruction", &price).expect("reflect price update");
    let post_update = enum_variant(struct_field(&reflected, "payload"), "post_update");
    let price_args = size_variant(struct_field(post_update, "update"), "price");
    assert_eq!(price_args.type_info.name, "PostPriceUpdateArgs");
    assert_eq!(u64_value(struct_field(price_args, "price")), 42_000);
    assert_eq!(
        u64_value(struct_field(price_args, "timestamp_ns")),
        1_234_567_890
    );
    assert_eq!(u16_value(struct_field(price_args, "feed_account_idx")), 2);

    let boolean = post_boolean_update();
    assert_eq!(boolean.len(), 15);
    let reflected =
        parse(&resolver, "OracleInstruction", &boolean).expect("reflect boolean update");
    let post_update = enum_variant(struct_field(&reflected, "payload"), "post_update");
    let boolean_args = size_variant(struct_field(post_update, "update"), "boolean");
    assert_eq!(boolean_args.type_info.name, "PostBooleanUpdateArgs");
    assert_eq!(u8_value(struct_field(boolean_args, "value")), 1);
    assert_eq!(
        u64_value(struct_field(boolean_args, "timestamp_ns")),
        1_234_567_890
    );
    assert_eq!(u16_value(struct_field(boolean_args, "feed_account_idx")), 2);
}

#[test]
fn oracle_administration_instruction_goldens_match_all_fields() {
    let resolver = load_oracle_resolver();

    let reflected = parse(&resolver, "OracleInstruction", &set_params()).expect("set params");
    assert_eq!(u32_value(struct_field(&reflected, "discriminant")), 2);
    let args = enum_variant(struct_field(&reflected, "payload"), "set_params");
    assert_eq!(
        u64_value(struct_field(args, "max_staleness_ns")),
        45_000_000_000
    );
    assert_eq!(u32_value(struct_field(args, "max_variance_bps")), 750);
    assert_eq!(u16_value(struct_field(args, "feed_account_idx")), 3);

    let reflected = parse(&resolver, "OracleInstruction", &set_admin()).expect("set admin");
    assert_eq!(u32_value(struct_field(&reflected, "discriminant")), 3);
    let args = enum_variant(struct_field(&reflected, "payload"), "set_admin");
    assert_eq!(u16_value(struct_field(args, "feed_account_idx")), 4);
    assert_eq!(u16_value(struct_field(args, "new_admin_account_idx")), 7);

    let reflected = parse(&resolver, "OracleInstruction", &set_reporter()).expect("set reporter");
    assert_eq!(u32_value(struct_field(&reflected, "discriminant")), 4);
    let args = enum_variant(struct_field(&reflected, "payload"), "set_reporter");
    assert_eq!(u16_value(struct_field(args, "feed_account_idx")), 5);
    assert_eq!(u16_value(struct_field(args, "new_reporter_account_idx")), 8);
}

#[test]
fn oracle_post_update_rejects_unknown_payload_size() {
    let resolver = load_oracle_resolver();
    let mut malformed = vec![0u8; 21];
    malformed[..4].copy_from_slice(&1u32.to_le_bytes());

    let error = parse(&resolver, "OracleInstruction", &malformed)
        .expect_err("17-byte update payload must be rejected");
    assert!(matches!(
        error,
        ParseError::InvalidSizeDiscriminatedUnionSize {
            size: 17,
            expected
        } if expected == vec![18, 11]
    ));
}

#[test]
fn oracle_create_feed_reflects_type_specific_data_and_proof() {
    let resolver = load_oracle_resolver();
    let proof = [0xaa, 0xbb, 0xcc, 0xdd];

    let price = create_feed(1, &proof);
    assert_eq!(price.len(), 143);
    let reflected = parse(&resolver, "OracleInstruction", &price).expect("reflect price feed");
    let create_args = enum_variant(struct_field(&reflected, "payload"), "create_feed");
    assert_eq!(u32_value(struct_field(&reflected, "discriminant")), 0);
    assert_create_feed_fields(create_args, 1, 8, &proof);
    let price_data = enum_variant(struct_field(create_args, "type_specific"), "price");
    assert_eq!(u32_value(struct_field(price_data, "max_variance_bps")), 500);
    assert_eq!(i32_value(struct_field(price_data, "exponent")), -8);

    let boolean = create_feed(2, &proof);
    assert_eq!(boolean.len(), 135);
    let reflected = parse(&resolver, "OracleInstruction", &boolean).expect("reflect boolean feed");
    let create_args = enum_variant(struct_field(&reflected, "payload"), "create_feed");
    assert_eq!(u32_value(struct_field(&reflected, "discriminant")), 0);
    assert_create_feed_fields(create_args, 2, 0, &proof);
    enum_variant(struct_field(create_args, "type_specific"), "boolean");
}

#[test]
fn oracle_feed_accounts_match_program_layouts() {
    let resolver = load_oracle_resolver();

    let price = feed_account(1);
    assert_eq!(price.len(), 161);
    let reflected = parse(&resolver, "OracleFeedAccount", &price).expect("reflect price account");
    let price_data = enum_variant(struct_field(&reflected, "data"), "price");
    assert_eq!(price_data.type_info.name, "OraclePriceFeedData");
    assert_eq!(u8_value(struct_field(&reflected, "feed_type")), 1);
    assert_common_feed_fields(struct_field(price_data, "common"));
    assert_eq!(u64_value(struct_field(price_data, "price")), 42_000);
    assert_eq!(u32_value(struct_field(price_data, "max_variance_bps")), 500);
    assert_eq!(i32_value(struct_field(price_data, "exponent")), -8);

    let boolean = feed_account(2);
    assert_eq!(boolean.len(), 146);
    let reflected =
        parse(&resolver, "OracleFeedAccount", &boolean).expect("reflect boolean account");
    let boolean_data = enum_variant(struct_field(&reflected, "data"), "boolean");
    assert_eq!(boolean_data.type_info.name, "OracleBooleanFeedData");
    assert_eq!(u8_value(struct_field(&reflected, "feed_type")), 2);
    assert_common_feed_fields(struct_field(boolean_data, "common"));
    assert_eq!(u8_value(struct_field(boolean_data, "value")), 1);
}

#[test]
fn oracle_events_and_errors_match_program_layouts() {
    let resolver = load_oracle_resolver();

    let price = oracle_event(1);
    assert_eq!(price.len(), 121);
    let reflected = parse(&resolver, "OracleEvent", &price).expect("reflect price event");
    assert_eq!(u8_value(struct_field(&reflected, "event_type")), 1);
    let data = enum_variant(struct_field(&reflected, "data"), "price_update");
    let name = array_bytes(struct_field(data, "feed_name"));
    assert_eq!(&name[..7], b"BTC/USD");
    assert!(name[7..].iter().all(|byte| *byte == 0));
    assert_eq!(
        array_bytes(struct_field(data, "feed_address")),
        vec![0x33; 32]
    );
    assert_eq!(u64_value(struct_field(data, "old_price")), 41_000);
    assert_eq!(u64_value(struct_field(data, "new_price")), 42_000);
    assert_eq!(u64_value(struct_field(data, "timestamp_ns")), 1_234_567_890);

    let boolean = oracle_event(2);
    assert_eq!(boolean.len(), 107);
    let reflected = parse(&resolver, "OracleEvent", &boolean).expect("reflect boolean event");
    assert_eq!(u8_value(struct_field(&reflected, "event_type")), 2);
    let data = enum_variant(struct_field(&reflected, "data"), "boolean_update");
    let name = array_bytes(struct_field(data, "feed_name"));
    assert_eq!(&name[..7], b"BTC/USD");
    assert!(name[7..].iter().all(|byte| *byte == 0));
    assert_eq!(
        array_bytes(struct_field(data, "feed_address")),
        vec![0x33; 32]
    );
    assert_eq!(u8_value(struct_field(data, "old_value")), 0);
    assert_eq!(u8_value(struct_field(data, "new_value")), 1);
    assert_eq!(u64_value(struct_field(data, "timestamp_ns")), 1_234_567_890);

    let error_code = 11u64.to_le_bytes();
    let reflected = parse(&resolver, "OracleError", &error_code).expect("reflect oracle error");
    assert_eq!(reflected.type_info.size, Some(8));
    assert_eq!(u64_value(struct_field(&reflected, "code")), 11);
}
