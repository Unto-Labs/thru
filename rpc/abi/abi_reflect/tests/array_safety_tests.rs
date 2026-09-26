use abi_gen::abi::file::AbiFile;
use abi_gen::abi::resolved::{ResolvedTypeKind, TypeResolver};
use abi_reflect::ir::ParamMap;
use abi_reflect::parser::Parser;
use abi_reflect::value::Value;
use abi_reflect::{ReflectError, Reflector};

fn reflector_from_yaml(yaml: &str) -> Reflector {
    let abi: AbiFile = serde_yml::from_str(yaml).expect("parse ABI");
    let roots = abi.root_types().clone();
    let mut resolver = TypeResolver::new();
    for typedef in abi.types {
        resolver.add_typedef(typedef);
    }
    resolver.resolve_all().expect("resolve ABI");
    Reflector::with_root_types(resolver, Default::default(), roots).expect("build reflector")
}

fn zero_sized_array_abi(jagged: bool, element: &str) -> String {
    format!(
        r#"
abi:
  package: test.array_safety
  description: Array reflection safety regression
  abi-version: 1
  package-version: "1.0.0"
  options:
    program-metadata:
      root-types:
        instruction-root: Message
        account-root: Message
        events: Message
types:
  - name: Empty
    kind:
      struct:
        fields: []
  - name: Message
    kind:
      struct:
        packed: true
        fields:
          - name: count
            field-type:
              primitive: u32
          - name: items
            field-type:
              array:
                jagged: {jagged}
                size:
                  field-ref:
                    path: [count]
                element-type: {element}
"#
    )
}

#[test]
fn nonempty_array_of_zero_sized_elements_is_rejected() {
    let reflector = reflector_from_yaml(&zero_sized_array_abi(
        false,
        "{ array: { size: { literal: { u32: 0 } }, element-type: { primitive: u8 } } }",
    ));
    /* A single element reproduces the missing guard without exhausting memory. */
    let error = reflector
        .reflect_instruction(&1u32.to_le_bytes())
        .expect_err("nonempty zero-sized arrays must be rejected");
    assert!(error.to_string().contains("zero-sized"), "{error}");
}

#[test]
fn zero_sized_arrays_are_rejected_during_parameter_extraction_and_parsing() {
    for jagged in [false, true] {
        for element in [
            "{ array: { size: { literal: { u32: 0 } }, element-type: { primitive: u8 } } }",
            "{ struct: { fields: [] } }",
            "{ type-ref: { name: Empty } }",
        ] {
            let reflector = reflector_from_yaml(&zero_sized_array_abi(jagged, element));
            for count in [1u32, u32::MAX] {
                let data = count.to_le_bytes();
                assert!(reflector.dynamic_params("Message", &data).is_err());
                let root = reflector.resolver().get_type_info("Message").unwrap();
                assert!(Parser::new(reflector.resolver(), ParamMap::new())
                    .parse(&data, root)
                    .is_err());
                assert!(reflector.reflect_instruction(&data).is_err());
                assert!(reflector.reflect_account(&data).is_err());
                assert!(reflector.reflect_event(&data).is_err());
            }

            let empty = reflector
                .reflect_instruction(&0u32.to_le_bytes())
                .expect("zero-count arrays remain valid");
            assert!(matches!(
                empty.get_struct_field("items").unwrap().get_value(),
                Value::Array { elements } if elements.is_empty()
            ));
        }
    }
}

#[test]
fn fixed_array_root_of_empty_structs_is_rejected() {
    let reflector = reflector_from_yaml(
        r#"
abi:
  package: test.fixed_array
  description: Fixed array reflection safety regression
  abi-version: 1
  package-version: "1.0.0"
types:
  - name: EmptyArray
    kind:
      array:
        size: { literal: { u32: 4294967295 } }
        element-type:
          struct:
            fields: []
"#,
    );
    assert!(reflector.reflect(&[], "EmptyArray").is_err());
}

#[test]
fn ordinary_arrays_still_decode() {
    for jagged in [false, true] {
        let reflector = reflector_from_yaml(&zero_sized_array_abi(jagged, "{ primitive: u8 }"));
        let data = [2, 0, 0, 0, 17, 42];
        let value = reflector.reflect_instruction(&data).expect("valid array");
        let Value::Array { elements } = value.get_struct_field("items").unwrap().get_value() else {
            panic!("expected array");
        };
        let values: Vec<_> = elements
            .iter()
            .map(|element| match element.get_value() {
                Value::Primitive(value) => value.to_u64().unwrap(),
                _ => panic!("expected primitive"),
            })
            .collect();
        assert_eq!(values, [17, 42]);
    }
}

#[test]
fn jagged_array_count_is_checked_before_allocation() {
    let reflector = reflector_from_yaml(&zero_sized_array_abi(true, "{ primitive: u8 }"));
    let root = reflector.resolver().get_type_info("Message").unwrap();
    let error = Parser::new(reflector.resolver(), ParamMap::new())
        .parse(&u32::MAX.to_le_bytes(), root)
        .expect_err("untrusted count must not allocate billions of elements");
    assert!(
        matches!(
            error,
            abi_reflect::parser::ParseError::InsufficientData { .. }
        ),
        "{error}"
    );
}

#[test]
fn array_byte_size_overflow_returns_an_error() {
    let reflector = reflector_from_yaml(&zero_sized_array_abi(false, "{ primitive: u64 }"));
    let root = reflector.resolver().get_type_info("Message").unwrap();
    let ResolvedTypeKind::Struct { fields, .. } = &root.kind else {
        panic!("expected struct");
    };
    let mut params = ParamMap::new();
    params.insert("count".into(), usize::MAX as u128);
    let error = Parser::new(reflector.resolver(), params)
        .parse(&[], &fields[1].field_type)
        .expect_err("array byte size must not wrap or panic");
    assert!(error.to_string().contains("Array size overflow"), "{error}");
}

#[test]
fn jagged_elements_must_make_progress_during_parameter_extraction() {
    let reflector = reflector_from_yaml(
        r#"
abi:
  package: test.jagged_array
  description: Jagged array progress regression
  abi-version: 1
  package-version: "1.0.0"
types:
  - name: VariableEmpty
    kind:
      enum:
        tag-ref: { literal: { u8: 0 } }
        variants:
          - name: empty
            tag-value: 0
            variant-type: { struct: { fields: [] } }
          - name: byte
            tag-value: 1
            variant-type: { primitive: u8 }
  - name: Message
    kind:
      struct:
        packed: true
        fields:
          - name: count
            field-type: { primitive: u32 }
          - name: items
            field-type:
              array:
                jagged: true
                size: { field-ref: { path: [count] } }
                element-type: { type-ref: { name: VariableEmpty } }
"#,
    );
    for (count, remaining) in [(3u32, 2usize), (u32::MAX, 0)] {
        let mut data = count.to_le_bytes().to_vec();
        data.resize(4 + remaining, 0);
        let error = reflector
            .dynamic_params("Message", &data)
            .expect_err("jagged count must fit remaining bytes");
        assert!(matches!(
            error,
            ReflectError::BufferTooSmall { required, available, .. }
                if required == count as u128 && available == remaining as u64
        ));
    }
    /* Extra bytes pass the count lower bound, but each dynamic element is empty. */
    let data = [2, 0, 0, 0, 17, 42];
    let error = reflector
        .dynamic_params("Message", &data)
        .expect_err("zero-byte iterations must fail before parsing");
    assert!(error.to_string().contains("consumed zero bytes"), "{error}");
    assert!(reflector.reflect(&data, "Message").is_err());

    let root = reflector.resolver().get_type_info("Message").unwrap();
    let error = Parser::new(reflector.resolver(), ParamMap::new())
        .parse(&data, root)
        .expect_err("parser must also reject zero-byte iterations");
    assert!(error.to_string().contains("consumed zero bytes"), "{error}");
}
