/* Regression tests for instruction smuggling (UNTO-2336 / VERIA-11).

The CLOB program runs every instruction packed into its buffer. A wallet
preview that decodes only the first one would hide the rest, so
`reflect_instruction` must reject bytes the decoded root does not cover. */

use abi_gen::abi::file::{ImportResolver, RootTypes};
use abi_gen::abi::resolved::TypeResolver;
use abi_reflect::value::{ReflectedValue, Value};
use abi_reflect::{ReflectError, Reflector, ReflectorConfig};
use std::path::PathBuf;

const CLOB_TOKEN_DEPOSIT: u8 = 2;
const CLOB_TOKEN_WITHDRAW: u8 = 3;

fn load_clob_reflector() -> Reflector {
    let type_library_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../type-library");
    let clob_path = type_library_dir.join("tn_clob_program.abi.yaml");

    let mut import_resolver = ImportResolver::new(vec![type_library_dir]);
    import_resolver
        .load_file_with_imports(&clob_path, false)
        .expect("load CLOB ABI");

    let mut resolver = TypeResolver::new();
    for typedef in import_resolver.get_all_types() {
        resolver.add_typedef(typedef.clone());
    }
    resolver.resolve_all().expect("resolve CLOB ABI types");

    let root_types = RootTypes {
        instruction_root: Some("ClobInstruction".to_string()),
        account_root: None,
        errors: None,
        events: None,
    };
    Reflector::with_root_types(resolver, ReflectorConfig::default(), root_types)
        .expect("CLOB reflector initializes")
}

/* Encodes a ClobInstruction carrying a TokenTransferInstruction:
discriminant u8, market_record_idx u8, token_program_idx u16,
reserved0 [u8; 4], amount u64, from_account_idx u16, to_account_idx u16,
reserved1 [u8; 4]. */
fn token_transfer(discriminant: u8, amount: u64, from_idx: u16, to_idx: u16) -> Vec<u8> {
    let mut out = vec![discriminant, 0];
    out.extend_from_slice(&3u16.to_le_bytes());
    out.extend_from_slice(&[0u8; 4]);
    out.extend_from_slice(&amount.to_le_bytes());
    out.extend_from_slice(&from_idx.to_le_bytes());
    out.extend_from_slice(&to_idx.to_le_bytes());
    out.extend_from_slice(&[0u8; 4]);
    out
}

fn variant_name(value: &ReflectedValue) -> String {
    let Value::Struct { fields } = &value.value else {
        panic!("expected struct, got {:?}", value.value);
    };
    let (_, payload) = fields
        .iter()
        .find(|(name, _)| name == "payload")
        .expect("payload field");
    let Value::Enum { variant_name, .. } = &payload.value else {
        panic!("expected enum payload, got {:?}", payload.value);
    };
    variant_name.clone()
}

#[test]
fn single_clob_instruction_still_reflects() {
    let reflector = load_clob_reflector();
    let deposit = token_transfer(CLOB_TOKEN_DEPOSIT, 1_000, 4, 5);

    let reflected = reflector
        .reflect_instruction(&deposit)
        .expect("single deposit reflects");
    assert_eq!(variant_name(&reflected), "token_deposit");
}

#[test]
fn smuggled_clob_withdraw_is_rejected() {
    let reflector = load_clob_reflector();
    let deposit = token_transfer(CLOB_TOKEN_DEPOSIT, 1, 4, 5);
    let withdraw = token_transfer(CLOB_TOKEN_WITHDRAW, u64::MAX, 5, 9);

    let mut payload = deposit.clone();
    payload.extend_from_slice(&withdraw);

    match reflector.reflect_instruction(&payload).unwrap_err() {
        ReflectError::TrailingBytes {
            type_name,
            consumed,
            available,
        } => {
            assert_eq!(type_name, "ClobInstruction");
            assert_eq!(consumed, Some(deposit.len() as u64));
            assert_eq!(available, payload.len() as u64);
        }
        other => panic!("unexpected error: {:?}", other),
    }
}

#[test]
fn single_trailing_byte_after_clob_instruction_is_rejected() {
    let reflector = load_clob_reflector();
    let mut payload = token_transfer(CLOB_TOKEN_DEPOSIT, 1, 4, 5);
    payload.push(CLOB_TOKEN_WITHDRAW);

    assert!(matches!(
        reflector.reflect_instruction(&payload),
        Err(ReflectError::TrailingBytes { .. })
    ));
}
