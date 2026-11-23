/* End-to-end: the token program's friendly-field draft through reflection
 * and formatting. The draft lives in specs/ because the real token ABI is
 * not switched over yet. */

use abi_gen::abi::file::{AbiFile, ImportResolver};
use abi_gen::abi::resolved::TypeResolver;
use abi_reflect::well_known::handlers::encode_thru_address;
use abi_reflect::{
    format_reflection_with_options, DisplayCard, FormatOptions, Reflector, ReflectorConfig,
};
use serde_json::{json, Value as JsonValue};
use std::path::PathBuf;

fn token_reflector() -> Reflector {
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let type_library = manifest_dir.join("../type-library");
    let draft = manifest_dir
        .join("../../../specs/synthetic-fields/tn_token_program.friendly-draft.abi.yaml");

    let mut imports = ImportResolver::new(vec![type_library]);
    imports
        .load_file_with_imports(&draft, false)
        .expect("load token draft ABI");
    let mut resolver = TypeResolver::new();
    for typedef in imports.get_all_types() {
        resolver.add_typedef(typedef.clone());
    }
    resolver.resolve_all().expect("resolve token draft ABI");

    let abi: AbiFile =
        serde_yml::from_str(&std::fs::read_to_string(&draft).unwrap()).expect("parse draft");
    Reflector::with_root_types(
        resolver,
        ReflectorConfig::default(),
        abi.root_types().clone(),
    )
    .expect("reflector")
}

fn key(seed: u8) -> [u8; 32] {
    std::array::from_fn(|i| seed.wrapping_add(i as u8))
}

fn address(seed: u8) -> String {
    encode_thru_address(&key(seed)).unwrap()
}

fn options(accounts: Option<&[&str]>) -> FormatOptions {
    FormatOptions {
        account_addresses: accounts.map(|a| a.iter().map(|s| s.to_string()).collect()),
        ..FormatOptions::default()
    }
}

/* (label, value) pairs of a card's rows that have a value. */
fn rows(card: &DisplayCard) -> Vec<(String, JsonValue)> {
    card.rows
        .iter()
        .filter_map(|row| row.value.clone().map(|value| (row.label.clone(), value)))
        .collect()
}

fn transfer_checked(dest_index: u16) -> Vec<u8> {
    let mut data = vec![8u8]; /* tag: transfer_checked */
    data.extend(1u16.to_le_bytes()); /* source */
    data.extend(dest_index.to_le_bytes()); /* dest */
    data.extend(3u16.to_le_bytes()); /* mint */
    data.extend(2_500_000u64.to_le_bytes()); /* amount */
    data.push(6); /* decimals */
    data.push(6); /* ticker length */
    data.extend(b"THRUSD\0\0");
    data
}

/* Fee payer, source, destination, mint: real addresses, since computed
 * Pubkeys are decoded back to their 32 bytes. */
fn accounts() -> Vec<String> {
    (100..104).map(address).collect()
}

fn with_accounts() -> FormatOptions {
    FormatOptions {
        account_addresses: Some(accounts()),
        ..FormatOptions::default()
    }
}

#[test]
fn account_created_event_card() {
    let reflector = token_reflector();
    let mut data = vec![1u8]; /* event_type: initialize_account */
    data.extend(key(10)); /* account */
    data.extend(key(20)); /* owner */
    data.extend(key(30)); /* mint */

    let reflected = reflector.reflect_event(&data).expect("reflect event");
    let formatted = format_reflection_with_options(&reflected, &options(None));

    assert_eq!(formatted.display.len(), 1);
    let card = &formatted.display[0];
    assert_eq!(card.title, "Token account created");
    assert_eq!(card.path, ["payload", "initialize_account"]);
    assert!(!card.incomplete);
    assert_eq!(
        rows(card),
        [
            ("Account".to_string(), json!(address(10))),
            ("Owner".to_string(), json!(address(20))),
            ("Mint".to_string(), json!(address(30))),
        ]
    );
    assert_eq!(card.rows[0].kind, "address");
    assert_eq!(card.rows[0].source, "wire");
}

#[test]
fn mint_to_event_heading_states_what_happened() {
    let reflector = token_reflector();
    let mut data = vec![3u8]; /* event_type: mint_to */
    data.extend(key(1)); /* mint */
    data.extend(key(2)); /* dest */
    data.extend(key(3)); /* authority */
    data.extend(713u64.to_le_bytes()); /* amount */
    data.extend(83_167u64.to_le_bytes()); /* dest_post_balance */
    data.extend(103_462u64.to_le_bytes()); /* mint_supply */

    let reflected = reflector.reflect_event(&data).expect("reflect event");
    let formatted = format_reflection_with_options(&reflected, &options(None));
    let card = &formatted.display[0];
    assert_eq!(card.title, "Tokens minted");
    assert_eq!(
        rows(card),
        [
            ("Mint".to_string(), json!(address(1))),
            ("Destination token account".to_string(), json!(address(2))),
            ("Authority".to_string(), json!(address(3))),
            ("Amount (base units)".to_string(), json!("713")),
            (
                "Destination balance after (base units)".to_string(),
                json!("83167")
            ),
            ("Supply after (base units)".to_string(), json!("103462")),
        ]
    );
}

#[test]
fn transfer_checked_shows_amount_with_ticker() {
    let reflector = token_reflector();
    let reflected = reflector
        .reflect_instruction(&transfer_checked(2))
        .expect("reflect instruction");
    let formatted = format_reflection_with_options(&reflected, &with_accounts());

    let card = &formatted.display[0];
    assert_eq!(card.title, "Transfer tokens");
    assert_eq!(
        rows(card),
        [
            ("Amount".to_string(), json!("2.5 THRUSD")),
            ("Source token account".to_string(), json!(address(101))),
            ("Destination token account".to_string(), json!(address(102))),
            ("Mint".to_string(), json!(address(103))),
        ]
    );

    /* The technical tree keeps hidden wire fields and adds computed ones in
     * declared order. */
    let payload = &formatted.value["payload"]["value"];
    let keys: Vec<_> = payload.as_object().unwrap().keys().cloned().collect();
    assert_eq!(
        &keys[..8],
        [
            "amount_display",
            "source_account_index",
            "source_account",
            "dest_account_index",
            "dest_account",
            "mint_account_index",
            "mint",
            "amount"
        ]
    );
    assert_eq!(payload["amount"], json!(2_500_000));
}

#[test]
fn computed_values_get_no_byte_range() {
    let reflector = token_reflector();
    let reflected = reflector.reflect_instruction(&transfer_checked(2)).unwrap();
    let formatted = format_reflection_with_options(
        &reflected,
        &FormatOptions {
            include_byte_offsets: true,
            ..with_accounts()
        },
    );
    let payload = &formatted.value["payload"]["value"];
    /* A computed Pubkey formats like a wire one, but has no bytes behind it. */
    assert_eq!(payload["dest_account"]["address"], json!(address(102)));
    assert_eq!(
        payload["dest_account"]["display"],
        json!({ "kind": "address", "text": address(102) })
    );
    assert!(!payload["dest_account"].to_string().contains("_byteRange"));
    assert!(payload["dest_account_index"]["_byteRange"].is_object());
}

#[test]
fn missing_context_degrades_only_the_fields_that_need_it() {
    let reflector = token_reflector();
    let reflected = reflector.reflect_instruction(&transfer_checked(2)).unwrap();
    let formatted = format_reflection_with_options(&reflected, &options(None));

    let card = &formatted.display[0];
    assert!(card.incomplete);
    assert_eq!(rows(card), [("Amount".to_string(), json!("2.5 THRUSD"))]);
    let dest = card
        .rows
        .iter()
        .find(|row| row.name == "dest_account")
        .unwrap();
    assert_eq!(dest.status, "unavailable");
    assert!(dest.value.is_none());

    assert_eq!(
        formatted.value["payload"]["value"]["dest_account"],
        json!({ "unavailable": "transaction account list not provided" })
    );
}

#[test]
fn bad_account_index_is_an_error_not_a_guess() {
    let reflector = token_reflector();
    let reflected = reflector.reflect_instruction(&transfer_checked(9)).unwrap();
    let formatted = format_reflection_with_options(&reflected, &with_accounts());

    let dest = formatted.display[0]
        .rows
        .iter()
        .find(|row| row.name == "dest_account")
        .unwrap();
    assert_eq!(dest.status, "error");
    assert_eq!(
        dest.issue.as_deref(),
        Some("account index 9 out of range (4 accounts)")
    );
}

#[test]
fn mint_without_freeze_authority_says_none() {
    let reflector = token_reflector();
    let mut data = vec![0u8]; /* event_type: initialize_mint */
    data.extend(key(1)); /* mint */
    data.extend(key(2)); /* mint_authority */
    data.extend([0u8; 32]); /* freeze_authority (unset) */
    data.extend(0u64.to_le_bytes()); /* supply */
    data.push(9); /* decimals */
    data.push(0); /* has_freeze_authority */
    data.push(4); /* ticker length */
    data.extend(b"ABCD\0\0\0\0");

    let reflected = reflector.reflect_event(&data).expect("reflect event");
    let formatted = format_reflection_with_options(&reflected, &options(None));
    let card = &formatted.display[0];
    let freeze = card
        .rows
        .iter()
        .find(|row| row.label == "Freeze authority")
        .unwrap();
    assert_eq!(
        (freeze.kind.as_str(), freeze.value.clone()),
        ("none", Some(JsonValue::Null))
    );
    let ticker = card.rows.iter().find(|row| row.label == "Ticker").unwrap();
    assert_eq!(ticker.value, Some(json!("ABCD")));
    assert!(!card.incomplete);
}

#[test]
fn raw_json_round_trip_keeps_display_info() {
    /* The TS SDK reflects to raw JSON, then formats that JSON separately. */
    let reflector = token_reflector();
    let reflected = reflector.reflect_instruction(&transfer_checked(2)).unwrap();
    let raw = serde_json::to_string(&reflected).unwrap();
    let reparsed: abi_reflect::ReflectedValue = serde_json::from_str(&raw).unwrap();
    let options: FormatOptions =
        serde_json::from_str(&json!({ "accountAddresses": accounts() }).to_string()).unwrap();
    let formatted = format_reflection_with_options(&reparsed, &options);
    assert_eq!(rows(&formatted.display[0])[2].1, json!(address(102)));
    assert_eq!(formatted.display[0].rows[2].kind, "address");
}

#[test]
fn json_options_keep_pubkey_addresses() {
    /* Options parsed from JSON must not drop the well-known types, or wire
     * Pubkey rows lose their address once accountAddresses is passed. */
    let reflector = token_reflector();
    let mut data = vec![1u8]; /* event_type: initialize_account */
    data.extend(key(10));
    data.extend(key(20));
    data.extend(key(30));
    let reflected = reflector.reflect_event(&data).unwrap();
    let options: FormatOptions =
        serde_json::from_str(r#"{"accountAddresses":["a"],"includeByteOffsets":true}"#).unwrap();
    let formatted = format_reflection_with_options(&reflected, &options);
    let owner = formatted.display[0]
        .rows
        .iter()
        .find(|row| row.label == "Owner")
        .unwrap();
    assert_eq!(
        (owner.kind.as_str(), owner.value.clone()),
        ("address", Some(json!(address(20))))
    );
}
