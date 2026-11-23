/* A computed value is built without bytes, but it must format exactly like
 * the same value decoded from the wire. One struct holds each type the
 * built-ins produce twice: as a wire field and as a computed field. */

use abi_gen::abi::file::ImportResolver;
use abi_gen::abi::resolved::TypeResolver;
use abi_reflect::well_known::handlers::encode_thru_address;
use abi_reflect::{format_reflection_with_options, FormatOptions, Reflector, ReflectorConfig};
use serde_json::Value as JsonValue;
use std::path::PathBuf;

const ABI: &str = r#"
abi:
  package: test.built_values
  abi-version: 1
  package-version: 0.1.0
  description: Wire and computed values side by side
  imports:
    - type: path
      path: thru_primitives.abi.yaml
    - type: path
      path: google_types.abi.yaml
types:
- name: Both
  kind:
    struct:
      packed: true
      display-name: Both
      fields:
      - name: index
        field-type: { primitive: u16 }
      - name: amount
        field-type: { primitive: u64 }
      - name: wire_pubkey
        field-type: { type-ref: { name: Pubkey } }
      - name: built_pubkey
        type: synthetic
        user-display: true
        return-type: { type-ref: { name: Pubkey } }
        expression: 'accountAddress(index)'
      - name: wire_fixed
        field-type: { type-ref: { name: FixedPoint } }
      - name: built_fixed
        type: synthetic
        user-display: true
        return-type: { type-ref: { name: FixedPoint } }
        expression: 'toFixedPoint(amount, 6)'
      - name: wire_money
        field-type: { type-ref: { name: Money } }
      - name: built_money
        type: synthetic
        user-display: true
        return-type: { type-ref: { name: Money } }
        expression: 'toMoney(amount, 6, "USD")'
      - name: wire_time
        field-type: { type-ref: { name: Timestamp } }
      - name: built_time
        type: synthetic
        user-display: true
        return-type: { type-ref: { name: Timestamp } }
        expression: 'timestamp(amount)'
      - name: wire_bool
        field-type: { type-ref: { name: Bool } }
      - name: built_bool
        type: synthetic
        user-display: true
        return-type: { type-ref: { name: Bool } }
        expression: 'amount > 0'
      - name: wire_u64
        field-type: { primitive: u64 }
      - name: built_u64
        type: synthetic
        user-display: true
        return-type: { primitive: u64 }
        expression: 'amount'
- name: DecimalCase
  kind:
    struct:
      packed: true
      display-name: Decimal case
      fields:
      - name: amount
        field-type: { primitive: u64 }
      - name: built_decimal
        type: synthetic
        user-display: true
        return-type: { type-ref: { name: Decimal } }
        expression: 'toDecimal(amount, 6)'
- name: TextCase
  kind:
    struct:
      packed: true
      display-name: Text case
      fields:
      - name: unused
        field-type: { primitive: u8 }
      - name: built_text
        type: synthetic
        user-display: true
        return-type: { type-ref: { name: Text } }
        expression: '"hello"'
"#;

const AMOUNT: u64 = 2_500_000;

fn fixed_bytes() -> Vec<u8> {
    let mut data = Vec::new();
    data.extend(1u16.to_le_bytes()); /* index */
    data.extend(AMOUNT.to_le_bytes()); /* amount */
    data.extend(key()); /* wire_pubkey */
    data.extend((AMOUNT as i64).to_le_bytes()); /* wire_fixed mantissa */
    data.push(6); /* scale */
    data.extend(b"USD"); /* wire_money */
    data.extend(2i64.to_le_bytes());
    data.extend(500_000_000i32.to_le_bytes());
    data.extend((AMOUNT as i64).to_le_bytes()); /* wire_time */
    data.push(1); /* wire_bool */
    data.extend(AMOUNT.to_le_bytes()); /* wire_u64 */
    data
}

/* Variable-size types are decoded as roots of their own, then compared with
 * the computed field of a struct that holds no variable-size wire field. */
fn wire_decimal() -> Vec<u8> {
    let mut data = 3u16.to_le_bytes().to_vec();
    data.extend(b"2.5");
    data
}

fn wire_text() -> Vec<u8> {
    let mut data = 5u16.to_le_bytes().to_vec();
    data.extend(b"hello");
    data
}

fn compare_root(
    type_name: &str,
    wire: &[u8],
    case: &str,
    case_bytes: &[u8],
    name: &str,
) -> (String, JsonValue) {
    let r = reflector();
    let options = FormatOptions::default();
    let wire = format_reflection_with_options(&r.reflect(wire, type_name).unwrap(), &options).value;
    let formatted = format_reflection_with_options(&r.reflect(case_bytes, case).unwrap(), &options);
    let built = &formatted.value[&format!("built_{name}")];
    assert_eq!(built, &wire, "{name}: computed value formats differently");
    let row = formatted.display[0]
        .rows
        .iter()
        .find(|r| r.name == format!("built_{name}"))
        .unwrap();
    (row.kind.clone(), row.value.clone().unwrap())
}

fn key() -> [u8; 32] {
    std::array::from_fn(|i| 7u8.wrapping_mul(i as u8 + 1))
}

fn reflector() -> Reflector {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let type_library = manifest_dir.join("../type-library");
    let path = std::env::temp_dir().join("built_values_test.abi.yaml");
    std::fs::write(&path, ABI).unwrap();
    let mut imports = ImportResolver::new(vec![type_library]);
    imports
        .load_file_with_imports(&path, false)
        .expect("load ABI");
    let mut resolver = TypeResolver::new();
    for typedef in imports.get_all_types() {
        resolver.add_typedef(typedef.clone());
    }
    resolver.resolve_all().expect("resolve ABI");
    Reflector::with_config(resolver, ReflectorConfig::default()).expect("reflector")
}

/* Format one struct and check each wire_/built_ pair matches, in the
 * technical tree and on the card. Returns the built rows' (kind, value). */
fn compare(type_name: &str, data: &[u8], names: &[&str]) -> Vec<(String, JsonValue)> {
    let reflected = reflector().reflect(data, type_name).expect("reflect");
    let options = FormatOptions {
        account_addresses: Some(vec![
            encode_thru_address(&[0u8; 32]).unwrap(),
            encode_thru_address(&key()).unwrap(),
        ]),
        ..FormatOptions::default()
    };
    let formatted = format_reflection_with_options(&reflected, &options);
    let value = formatted.value.as_object().unwrap();
    let card = &formatted.display[0];
    let row = |field: String| card.rows.iter().find(|r| r.name == field).unwrap();
    names
        .iter()
        .map(|name| {
            let wire = &value[&format!("wire_{name}")];
            let built = &value[&format!("built_{name}")];
            assert_eq!(built, wire, "{name}: computed value formats differently");
            let (w, b) = (row(format!("wire_{name}")), row(format!("built_{name}")));
            assert_eq!(
                (&b.kind, &b.value),
                (&w.kind, &w.value),
                "{name}: card rows differ"
            );
            (b.kind.clone(), b.value.clone().unwrap())
        })
        .collect()
}

#[test]
fn computed_values_format_like_wire_values() {
    let fixed = compare(
        "Both",
        &fixed_bytes(),
        &["pubkey", "fixed", "money", "time", "bool", "u64"],
    );
    let decimal = compare_root(
        "Decimal",
        &wire_decimal(),
        "DecimalCase",
        &AMOUNT.to_le_bytes(),
        "decimal",
    );
    let text = compare_root("Text", &wire_text(), "TextCase", &[0], "text");
    let kinds: Vec<_> = fixed.into_iter().chain([decimal, text]).collect();
    let expected: Vec<(String, JsonValue)> = [
        (
            "address",
            JsonValue::from(encode_thru_address(&key()).unwrap()),
        ),
        ("decimal", "2.5".into()),
        ("money", "USD 2.5".into()),
        ("time", "1970-01-29T22:26:40+00:00".into()),
        ("bool", "true".into()),
        ("integer", "2500000".into()),
        ("decimal", "2.5".into()),
        ("text", "hello".into()),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_string(), v))
    .collect();
    assert_eq!(kinds, expected);
}

/* Each wrapper holds one wire child and seven computed copies of it. If a
 * copy kept its type's synthetic fields, formatting would evaluate them
 * again at every level: 8 levels of 7 copies is over 16 million objects. */
#[test]
fn computed_copies_do_not_expand_nested_synthetic_fields() {
    let mut yaml = String::from(
        "abi:\n  package: test.expansion\n  abi-version: 1\n  package-version: 0.1.0\n  description: Nested copies\ntypes:\n- name: T0\n  kind:\n    struct:\n      packed: true\n      fields:\n      - name: x\n        field-type: { primitive: u8 }\n",
    );
    for level in 1..=8 {
        yaml += &format!(
            "- name: T{level}\n  kind:\n    struct:\n      packed: true\n      fields:\n      - name: c\n        field-type: {{ type-ref: {{ name: T{} }} }}\n",
            level - 1
        );
        for copy in 1..=7 {
            yaml += &format!(
                "      - name: s{copy}\n        type: synthetic\n        return-type: {{ type-ref: {{ name: T{} }} }}\n        expression: 'c'\n",
                level - 1
            );
        }
    }
    let path = std::env::temp_dir().join("expansion_test.abi.yaml");
    std::fs::write(&path, yaml).unwrap();
    let mut imports = ImportResolver::new(vec![]);
    imports
        .load_file_with_imports(&path, false)
        .expect("load ABI");
    let mut resolver = TypeResolver::new();
    for typedef in imports.get_all_types() {
        resolver.add_typedef(typedef.clone());
    }
    resolver.resolve_all().expect("resolve ABI");
    let reflector = Reflector::with_config(resolver, ReflectorConfig::default()).unwrap();
    let reflected = reflector.reflect(&[7], "T8").expect("reflect");
    let formatted = format_reflection_with_options(&reflected, &FormatOptions::default());
    let size = formatted.value.to_string().len();
    assert!(size < 200_000, "formatted size {size} grew with nesting");
    /* The copies still carry the value. */
    assert_eq!(
        formatted.value["s1"]["c"]["c"]["c"]["c"]["c"]["c"]["c"]["x"],
        7
    );
}
