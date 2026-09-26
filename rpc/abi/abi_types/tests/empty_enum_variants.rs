use abi_types::{ContainerAttributes, StructType, TypeDef, TypeKind};

fn parse_variant(payload: &str) -> Result<TypeDef, serde_yml::Error> {
    serde_yml::from_str(&format!(
        "name: OptionalValue
kind:
  enum:
    tag-ref:
      literal:
        u8: 0
    variants:
      - name: None
        tag-value: 0
{payload}"
    ))
}

#[test]
fn omitted_enum_payload_matches_an_explicit_empty_struct() {
    let implicit = parse_variant("").expect("enum payload may be omitted");
    let explicit =
        parse_variant("        variant-type:\n          struct:\n            fields: []\n")
            .unwrap();
    assert_eq!(implicit, explicit);

    let TypeKind::Enum(enum_type) = &implicit.kind else {
        panic!("expected enum");
    };
    assert_eq!(
        enum_type.variants[0].variant_type,
        TypeKind::Struct(StructType {
            container_attributes: ContainerAttributes::default(),
            fields: vec![],
        })
    );

    // Serialized schemas keep the explicit form so older readers can load them.
    let serialized = serde_yml::to_string(&implicit).unwrap();
    assert!(serialized.contains("variant-type:"));
    assert_eq!(
        serde_yml::from_str::<TypeDef>(&serialized).unwrap(),
        implicit
    );
}

#[test]
fn explicit_invalid_enum_payloads_are_not_treated_as_empty() {
    for payload in [
        "        variant-type: null\n",
        "        variant-type: {}\n",
        "        variant-type:\n          primitive: invalid\n",
        "        variant-type:\n          struct: {}\n",
    ] {
        assert!(parse_variant(payload).is_err(), "accepted {payload}");
    }
}

#[test]
fn other_payload_types_remain_required() {
    for kind in [
        "union:\n    variants:\n      - name: Missing",
        "struct:\n    fields:\n      - name: Missing",
        "size-discriminated-union:\n    variants:\n      - name: Missing\n        expected-size: 0",
    ] {
        let yaml = format!("name: Invalid\nkind:\n  {kind}\n");
        assert!(serde_yml::from_str::<TypeDef>(&yaml).is_err());
    }
}
