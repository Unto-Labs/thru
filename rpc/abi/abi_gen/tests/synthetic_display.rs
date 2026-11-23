use abi_gen::abi::resolved::{ResolutionError, TypeResolver};
use abi_gen::abi::types::TypeDef;

fn resolver(yaml: &str) -> TypeResolver {
    let typedefs: Vec<TypeDef> = serde_yml::from_str(yaml).expect("valid yaml");
    let mut resolver = TypeResolver::new();
    for typedef in typedefs {
        resolver.add_typedef(typedef);
    }
    resolver
}

#[test]
fn records_display_for_named_and_inline_structs() {
    let mut resolver = resolver(
        "
- name: Outer
  kind:
    struct:
      packed: true
      display-name: Outer thing
      fields:
      - name: idx
        field-type:
          primitive: u16
      - name: addr
        type: synthetic
        return-type: { type-ref: { name: Pubkey } }
        expression: 'accountAddress(idx)'
        user-display: true
      - name: inner
        field-type:
          struct:
            display-name: Inner thing
            fields:
            - name: n
              display-name: Count
              field-type:
                primitive: u8
",
    );
    resolver.resolve_all().expect("resolves");

    let outer = resolver.display_for_type("Outer").expect("outer display");
    assert_eq!(outer.display_name.as_deref(), Some("Outer thing"));
    assert_eq!(outer.synthetic[0].name, "addr");

    let inner = resolver
        .display_for_type("Outer::inner")
        .expect("inline display");
    assert_eq!(inner.display_name.as_deref(), Some("Inner thing"));

    /* Synthetic fields take no bytes: u16 + u8, packed. */
    let resolved = resolver.types.get("Outer").unwrap();
    assert_eq!(resolved.size, abi_gen::abi::resolved::Size::Const(3));
}

#[test]
fn rejects_invalid_display_when_resolving() {
    let mut resolver = resolver(
        "
- name: Bad
  kind:
    struct:
      fields:
      - name: idx
        field-type:
          primitive: u16
      - name: addr
        type: synthetic
        return-type: { type-ref: { name: Pubkey } }
        expression: 'fetchAccount(idx)'
",
    );
    match resolver.resolve_all() {
        Err(ResolutionError::InvalidDisplay(message)) => {
            assert!(
                message.contains("Bad: synthetic field 'addr': unknown function 'fetchAccount'"),
                "{message}"
            );
        }
        other => panic!("expected InvalidDisplay, got {other:?}"),
    }
}
