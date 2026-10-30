use abi_gen::abi::file::AbiFile;
use abi_gen::abi::resolved::TypeResolver;
use abi_reflect::Reflector;

#[test]
fn alignment_overrun_reports_pending_field() {
    let yaml = r#"
abi:
  package: "thru.test.alignment"
  abi-version: 1
  package-version: "0.1.0"
  description: "Alignment buffer error test"
  imports: []

types:
  - name: "AlignedTail"
    kind:
      struct:
        packed: false
        fields:
          - name: "a"
            field-type:
              primitive: u8
          - name: "b"
            field-type:
              primitive: u32
          - name: "c"
            field-type:
              array:
                size:
                  field-ref:
                    path: ["b"]
                element-type:
                  primitive: u8
"#;
    let abi: AbiFile = serde_yml::from_str(yaml).expect("parse ABI");
    let roots = abi.root_types().clone();
    let mut resolver = TypeResolver::new();
    for typedef in abi.types {
        resolver.add_typedef(typedef);
    }
    resolver.resolve_all().expect("resolve ABI");
    let reflector =
        Reflector::with_root_types(resolver, Default::default(), roots).expect("build reflector");
    let err = reflector
        .reflect(&[1, 0, 0], "AlignedTail")
        .expect_err("alignment beyond the buffer must fail");
    assert_eq!(
        err.to_string(),
        "type 'AlignedTail' field 'b' requires 4 bytes but only 3 available"
    );
}

#[test]
fn truncated_counter_instructions_report_field_and_root_buffer_errors() {
    let yaml = r#"
abi:
  package: "thru.program.counter"
  abi-version: 1
  package-version: "0.1.0"
  description: "ABI definitions for the Thru counter example program"
  imports: []

types:
  - name: "CounterCreateInstruction"
    kind:
      struct:
        packed: true
        fields:
          - name: "instruction_type"
            field-type:
              primitive: u32
          - name: "account_index"
            field-type:
              primitive: u16
          - name: "seed"
            field-type:
              array:
                size:
                  literal:
                    u64: 32
                element-type:
                  primitive: u8
          - name: "proof_size"
            field-type:
              primitive: u32
          - name: "proof"
            field-type:
              array:
                size:
                  field-ref:
                    path: ["proof_size"]
                element-type:
                  primitive: u8

  - name: "CounterIncrementInstruction"
    kind:
      struct:
        packed: true
        fields:
          - name: "instruction_type"
            field-type:
              primitive: u32
          - name: "account_index"
            field-type:
              primitive: u16
"#;
    let abi: AbiFile = serde_yml::from_str(yaml).expect("parse ABI");
    let roots = abi.root_types().clone();
    let mut resolver = TypeResolver::new();
    for typedef in abi.types {
        resolver.add_typedef(typedef);
    }
    resolver.resolve_all().expect("resolve ABI");
    let reflector =
        Reflector::with_root_types(resolver, Default::default(), roots).expect("build reflector");
    let err = reflector
        .reflect(&[1, 0, 0, 0, 0], "CounterCreateInstruction")
        .expect_err("truncated account_index must fail");
    assert_eq!(
        err.to_string(),
        "type 'CounterCreateInstruction' field 'account_index' requires 2 bytes but only 1 available"
    );
    let err = reflector
        .reflect(&[1, 0, 0, 0, 0], "CounterIncrementInstruction")
        .expect_err("truncated instruction must fail");
    assert_eq!(
        err.to_string(),
        "type 'CounterIncrementInstruction' requires 6 bytes but only 5 available"
    );
}
