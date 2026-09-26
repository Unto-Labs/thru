use abi_gen::abi::{file::ImportResolver, resolved::TypeResolver};
use abi_reflect::{ParamMap, Parser, Value};
use std::path::PathBuf;

#[test]
fn omitted_enum_payload_has_zero_size_and_preserves_tag_validation() {
    let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../abi_gen/tests/compliance_tests/abi_definitions/multi_enums.abi.yaml");
    let mut loader = ImportResolver::new(vec![]);
    loader.load_file_with_imports(&fixture, false).unwrap();
    let mut resolver = TypeResolver::new();
    for typedef in loader.get_all_types() {
        resolver.add_typedef(typedef.clone());
    }
    resolver.resolve_all().unwrap();
    let ty = resolver.get_type_info("DualEnum").unwrap();

    // Two tags and the Small variant's byte; Empty consumes no payload bytes.
    let reflected = Parser::new(&resolver, ParamMap::new())
        .parse(&[0, 0, 42], ty)
        .unwrap();
    let Value::Struct { fields } = reflected.value else {
        panic!("expected struct");
    };
    let Value::Enum {
        variant_name,
        tag_value,
        variant_value,
    } = &fields[3].1.value
    else {
        panic!("expected enum");
    };
    assert_eq!(variant_name, "Empty");
    assert_eq!(*tag_value, 0);
    assert_eq!(variant_value.type_info.size, Some(0));
    assert!(matches!(&variant_value.value, Value::Struct { fields } if fields.is_empty()));

    for invalid in [
        &[0, 2, 42][..], // Unknown second tag.
        &[0, 0][..],     // Missing Small payload.
        &[0, 1, 42][..], // Missing Pair payload.
    ] {
        assert!(Parser::new(&resolver, ParamMap::new())
            .parse(invalid, ty)
            .is_err());
    }
}
