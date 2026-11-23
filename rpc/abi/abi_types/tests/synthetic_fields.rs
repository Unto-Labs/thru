use abi_types::{SyntheticType, TypeDef, TypeKind, TypeRefType};

const TRANSFER: &str = "
name: TransferInstruction
kind:
  struct:
    packed: true
    display-name: Transfer tokens
    fields:
    - name: summary
      type: synthetic
      return-type: { type-ref: { name: Text } }
      expression: '`to ${dest}`'
      user-display: true
    - name: dest_account_index
      user-display: false
      field-type:
        primitive: u16
    - name: dest
      type: synthetic
      return-type:
        optional:
          type-ref:
            name: Pubkey
      expression: 'accountAddress(dest_account_index)'
      display-name: Destination token account
      user-display: true
    - name: amount
      display-name: Amount (base units)
      field-type:
        primitive: u64
";

fn type_ref(name: &str) -> TypeKind {
    TypeKind::TypeRef(TypeRefType {
        name: name.into(),
        package: None,
        comment: None,
    })
}

fn parse(yaml: &str) -> Result<TypeDef, serde_yml::Error> {
    serde_yml::from_str(yaml)
}

#[test]
fn splits_wire_and_synthetic_fields_in_order() {
    let typedef = parse(TRANSFER).unwrap();
    let TypeKind::Struct(st) = &typedef.kind else {
        panic!("expected struct")
    };

    let wire: Vec<_> = st.fields.iter().map(|f| f.name.as_str()).collect();
    assert_eq!(wire, ["dest_account_index", "amount"]);

    let display = &st.display;
    assert_eq!(display.display_name.as_deref(), Some("Transfer tokens"));
    assert!(!display.wire_field_visible("dest_account_index"));
    assert!(display.wire_field_visible("amount"));
    assert_eq!(
        display.field_labels["amount"].display_name.as_deref(),
        Some("Amount (base units)")
    );

    let synthetic: Vec<_> = display
        .synthetic
        .iter()
        .map(|f| (f.name.as_str(), f.position))
        .collect();
    assert_eq!(synthetic, [("summary", 0), ("dest", 1)]);
    assert_eq!(
        display.synthetic[1].return_type,
        SyntheticType::Optional(Box::new(type_ref("Pubkey")))
    );
    assert_eq!(
        display.synthetic[1].return_type.to_string(),
        "optional<Pubkey>"
    );
    assert_eq!(display.synthetic[0].return_type.to_string(), "Text");
    assert!(display.validate(&wire).is_empty());
    let types: Vec<_> = st
        .fields
        .iter()
        .map(|f| (f.name.as_str(), &f.field_type))
        .collect();
    assert!(display.check_types(&types, &|_| None).is_empty());
}

#[test]
fn round_trips_through_yaml() {
    let typedef = parse(TRANSFER).unwrap();
    let yaml = serde_yml::to_string(&typedef).unwrap();
    assert_eq!(parse(&yaml).unwrap(), typedef);

    /* The written list keeps the declared order. */
    let names: Vec<_> = yaml
        .lines()
        .filter_map(|line| line.trim().strip_prefix("- name: "))
        .collect();
    assert_eq!(names, ["summary", "dest_account_index", "dest", "amount"]);
}

#[test]
fn plain_structs_are_unchanged() {
    let typedef = parse(
        "
name: Plain
kind:
  struct:
    fields:
    - name: a
      field-type:
        primitive: u8
",
    )
    .unwrap();
    let TypeKind::Struct(st) = &typedef.kind else {
        panic!()
    };
    assert!(st.display.is_empty());
    let yaml = serde_yml::to_string(&typedef).unwrap();
    assert!(!yaml.contains("display"));
    assert!(!yaml.contains("synthetic"));
}

#[test]
fn rejects_malformed_entries() {
    let cases = [
        ("type: synthetic\n      return-type: { primitive: u64 }", "needs return-type and expression"),
        ("type: synthetic\n      expression: '1'\n      return-type: { primitive: u64 }\n      field-type:\n        primitive: u8", "no field-type"),
        ("type: computed\n      return-type: { primitive: u64 }\n      expression: '1'", "unknown field type 'computed'"),
        ("type: synthetic\n      return-type: address\n      expression: '1'", "return-type must be an ABI type"),
        ("expression: '1'\n      field-type:\n        primitive: u8", "need type: synthetic"),
        ("display-name: X", "needs field-type"),
    ];
    for (entry, expected) in cases {
        let yaml = format!(
            "
name: Bad
kind:
  struct:
    fields:
    - name: f
      {entry}
"
        );
        let err = parse(&yaml).expect_err(entry).to_string();
        assert!(err.contains(expected), "{entry}: {err}");
    }
}

/* One struct per case: wire fields `idx: u16`, `key: Pubkey`, `raw: u8[32]`,
 * `amt: u64`, plus the synthetic fields given. */
fn type_errors(synthetic: &str) -> Vec<String> {
    let yaml = format!(
        "
name: Checked
kind:
  struct:
    fields:
    - name: idx
      field-type: {{ primitive: u16 }}
    - name: key
      field-type: {{ type-ref: {{ name: Pubkey }} }}
    - name: raw
      field-type:
        array:
          size: {{ literal: {{ u64: 32 }} }}
          element-type: {{ primitive: u8 }}
    - name: amt
      field-type: {{ primitive: u64 }}
    - name: seed
      field-type: {{ type-ref: {{ name: Seed32 }} }}
{synthetic}"
    );
    let typedef = parse(&yaml).unwrap();
    let TypeKind::Struct(st) = &typedef.kind else {
        panic!()
    };
    let pubkey = parse(
        "
name: Pubkey
kind:
  struct:
    fields:
    - name: bytes
      field-type:
        array:
          size: { literal: { u64: 32 } }
          element-type: { primitive: u8 }
",
    )
    .unwrap();
    let wire: Vec<_> = st
        .fields
        .iter()
        .map(|f| (f.name.as_str(), &f.field_type))
        .collect();
    let count = parse("name: Count\nkind:\n  primitive: u64\n").unwrap();
    let seed = parse(
        "name: Seed32\nkind:\n  array:\n    size: { literal: { u64: 32 } }\n    element-type: { primitive: u8 }\n",
    )
    .unwrap();
    let lookup = |name: &str| match name {
        "Pubkey" => Some(&pubkey.kind),
        "Count" => Some(&count.kind),
        "Seed32" => Some(&seed.kind),
        _ => None,
    };
    let names: Vec<_> = wire.iter().map(|(n, _)| *n).collect();
    let mut errors = st.display.validate(&names);
    errors.extend(st.display.check_types(&wire, &lookup));
    errors
}

fn field(name: &str, return_type: &str, expression: &str) -> String {
    format!(
        "    - name: {name}\n      type: synthetic\n      return-type: {return_type}\n      expression: '{expression}'\n"
    )
}

#[test]
fn well_typed_fields_pass() {
    let fields = [
        field(
            "owner",
            "{ type-ref: { name: Pubkey } }",
            "accountAddress(idx)",
        ),
        field("same", "{ type-ref: { name: Pubkey } }", "key"),
        field("from_bytes", "{ type-ref: { name: Pubkey } }", "raw"),
        field(
            "amount",
            "{ type-ref: { name: Decimal } }",
            "toDecimal(amt, 6)",
        ),
        field(
            "fixed",
            "{ type-ref: { name: FixedPoint } }",
            "toFixedPoint(amt, 2)",
        ),
        field(
            "price",
            "{ type-ref: { name: Money } }",
            "toMoney(amt, 2, \"USD\")",
        ),
        field(
            "when",
            "{ type-ref: { name: Timestamp } }",
            "timestamp(amt)",
        ),
        field(
            "label",
            "{ type-ref: { name: Text } }",
            "`${amount} to ${owner}`",
        ),
        field("big", "{ type-ref: { name: Bool } }", "amt > 10"),
        field("next", "{ primitive: u32 }", "idx + 1"),
        field(
            "maybe",
            "{ optional: { type-ref: { name: Pubkey } } }",
            "if idx == 0 { none } else { accountAddress(idx) }",
        ),
    ]
    .concat();
    assert_eq!(type_errors(&fields), Vec::<String>::new());
}

#[test]
fn type_errors_are_reported_at_load() {
    let cases = [
        (
            field("a", "{ type-ref: { name: Pubkey } }", "accountAddress(key)"),
            "'accountAddress' argument 1 needs an integer, got Pubkey",
        ),
        (
            field("a", "{ primitive: u64 }", "key + 1"),
            "arithmetic and ordering needs an integer, got Pubkey",
        ),
        (
            field(
                "a",
                "{ type-ref: { name: Decimal } }",
                "toFixedPoint(amt, 2)",
            ),
            "expression gives FixedPoint, but return-type is Decimal",
        ),
        (
            field("a", "{ type-ref: { name: Nope } }", "1"),
            "unknown type 'Nope'",
        ),
        (
            field("a", "{ primitive: f64 }", "1"),
            "must be an integer type or a named type",
        ),
        (
            field(
                "a",
                "{ type-ref: { name: Bool } }",
                "if amt { 1 } else { 2 }",
            ),
            "'if' needs true/false, got an integer",
        ),
        (
            field("a", "{ type-ref: { name: Text } }", "text(amt, 2)"),
            "'text' needs bytes, got an integer",
        ),
        (
            field("a", "{ type-ref: { name: Pubkey } }", "none"),
            "return-type must be optional",
        ),
        (
            field("a", "{ type-ref: { name: Bool } }", "key == amt"),
            "cannot compare Pubkey with an integer",
        ),
    ];
    for (yaml, expected) in cases {
        let errors = type_errors(&yaml).join("\n");
        assert!(
            errors.contains(expected),
            "{yaml}\nexpected {expected:?}, got: {errors}"
        );
    }
}

#[test]
fn oversized_structs_are_not_type_checked() {
    /* Thousands of fields reading a missing field: `validate` reports the
     * count, and `check_types` does no per-field work at all. */
    let fields: String = (0..5000)
        .map(|i| field(&format!("f{i}"), "{ primitive: u64 }", "missing + missing"))
        .collect();
    let started = std::time::Instant::now();
    let errors = type_errors(&fields).join("\n");
    assert!(errors.contains("at most 64 are allowed"), "{errors}");
    assert!(
        !errors.contains("missing"),
        "type checks ran on an oversized struct"
    );
    assert!(started.elapsed().as_secs() < 5);
}
