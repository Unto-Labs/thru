use abi_gen::abi::file::AbiFile;
use abi_gen::abi::resolved::TypeResolver;
use abi_reflect::value::{PrimitiveValue, Value};
use abi_reflect::{format_reflection, format_reflection_with_options, FormatOptions, Reflector};
use serde_json::Value as JsonValue;
use std::{fs, path::Path};

#[test]
fn char_compliance_fixtures_match_explorer_display() {
    let compliance =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../abi_gen/tests/compliance_tests");
    let abi: AbiFile = serde_yml::from_str(
        &fs::read_to_string(compliance.join("abi_definitions/chars.abi.yaml")).unwrap(),
    )
    .unwrap();
    let mut resolver = TypeResolver::new();
    for typedef in abi.types {
        resolver.add_typedef(typedef);
    }
    resolver.resolve_all().unwrap();
    let reflector = Reflector::new(resolver).unwrap();
    /* These same expected reflections are rendered by Explorer's component tests. */
    let fixtures: Vec<JsonValue> =
        serde_json::from_str(include_str!("fixtures/chars.json")).unwrap();
    for fixture in fixtures {
        let name = fixture["name"].as_str().unwrap();
        let case: JsonValue = serde_yml::from_str(
            &fs::read_to_string(compliance.join(format!("test_cases/chars/{name}.yaml"))).unwrap(),
        )
        .unwrap();
        let bytes: Vec<u8> = case["test-case"]["binary-hex"]
            .as_str()
            .unwrap()
            .split_whitespace()
            .map(|byte| u8::from_str_radix(byte, 16).unwrap())
            .collect();
        let reflected = reflector.reflect(&bytes, "CharRecord").unwrap();
        assert_eq!(reflected.type_info.size, Some(13), "{name}");
        let Value::Struct { fields } = reflected.get_value() else {
            panic!("expected CharRecord struct");
        };
        let Value::Primitive(PrimitiveValue::Char(code)) = fields[0].1.get_value() else {
            panic!("expected scalar char");
        };
        assert_eq!(code.value, bytes[0], "{name}");
        let Value::Array { elements } = fields[1].1.get_value() else {
            panic!("expected char array");
        };
        let raw_chars: Vec<u8> = elements
            .iter()
            .map(|element| match element.get_value() {
                Value::Primitive(PrimitiveValue::Char(value)) => value.value,
                _ => panic!("expected char element"),
            })
            .collect();
        /* Formatting may stop at NUL, but parsing must retain every byte. */
        assert_eq!(raw_chars, bytes[1..9], "{name}");
        assert_eq!(
            serde_json::to_value(format_reflection(&reflected)).unwrap(),
            fixture["reflection"],
            "{name}"
        );
        assert_eq!(
            serde_json::to_value(format_reflection_with_options(
                &reflected,
                &FormatOptions {
                    include_byte_offsets: true,
                    ..Default::default()
                },
            ))
            .unwrap(),
            fixture["withOffsets"],
            "{name}"
        );
        assert!(
            reflector.reflect(&bytes[..8], "CharRecord").is_err(),
            "{name}: truncated char array must fail"
        );
    }
}
