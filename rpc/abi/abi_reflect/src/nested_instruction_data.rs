use crate::formatter::FormattedReflection;
use serde_json::{Map, Value as JsonValue};

pub const MAX_NESTED_INSTRUCTION_DEPTH: usize = 15;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct NestedInstructionDecodeOptions {
    pub max_depth: usize,
}

impl Default for NestedInstructionDecodeOptions {
    fn default() -> Self {
        Self {
            max_depth: MAX_NESTED_INSTRUCTION_DEPTH,
        }
    }
}

pub fn resolve_nested_instruction_data<A, F>(
    reflection: FormattedReflection,
    account_addresses: &[A],
    decoder: F,
) -> FormattedReflection
where
    A: AsRef<str>,
    F: FnMut(&str, &[u8]) -> Result<Option<FormattedReflection>, String>,
{
    resolve_nested_instruction_data_with_options(
        reflection,
        account_addresses,
        decoder,
        NestedInstructionDecodeOptions::default(),
    )
}

pub fn resolve_nested_instruction_data_with_options<A, F>(
    mut reflection: FormattedReflection,
    account_addresses: &[A],
    mut decoder: F,
    options: NestedInstructionDecodeOptions,
) -> FormattedReflection
where
    A: AsRef<str>,
    F: FnMut(&str, &[u8]) -> Result<Option<FormattedReflection>, String>,
{
    resolve_value(
        &mut reflection.value,
        0,
        account_addresses,
        &mut decoder,
        options.max_depth,
    );
    reflection
}

fn resolve_value<A, F>(
    value: &mut JsonValue,
    instruction_depth: usize,
    account_addresses: &[A],
    decoder: &mut F,
    max_depth: usize,
) where
    A: AsRef<str>,
    F: FnMut(&str, &[u8]) -> Result<Option<FormattedReflection>, String>,
{
    match value {
        JsonValue::Object(map) => {
            if is_instruction_data_value(map) {
                resolve_instruction_data_value(
                    map,
                    instruction_depth,
                    account_addresses,
                    decoder,
                    max_depth,
                );
                return;
            }

            for (key, child) in map.iter_mut() {
                if key == "decodedInstruction" {
                    continue;
                }
                resolve_value(
                    child,
                    instruction_depth,
                    account_addresses,
                    decoder,
                    max_depth,
                );
            }
        }
        JsonValue::Array(items) => {
            for item in items {
                resolve_value(
                    item,
                    instruction_depth,
                    account_addresses,
                    decoder,
                    max_depth,
                );
            }
        }
        JsonValue::Null | JsonValue::Bool(_) | JsonValue::Number(_) | JsonValue::String(_) => {}
    }
}

fn resolve_instruction_data_value<A, F>(
    map: &mut Map<String, JsonValue>,
    instruction_depth: usize,
    account_addresses: &[A],
    decoder: &mut F,
    max_depth: usize,
) where
    A: AsRef<str>,
    F: FnMut(&str, &[u8]) -> Result<Option<FormattedReflection>, String>,
{
    map.remove("decodeError");
    map.remove("decodedInstruction");
    map.remove("programAddress");

    let Some(program_index) = map
        .get("programIndex")
        .and_then(JsonValue::as_u64)
        .and_then(|idx| usize::try_from(idx).ok())
    else {
        return;
    };

    let Some(data_hex) = map
        .get("dataHex")
        .and_then(JsonValue::as_str)
        .map(str::to_string)
    else {
        return;
    };

    if instruction_depth >= max_depth {
        insert_error(map, "Nested instruction depth limit reached");
        return;
    }

    let Some(program_address) = account_addresses.get(program_index).map(AsRef::as_ref) else {
        insert_error(map, format!("Invalid program index {program_index}"));
        return;
    };
    let program_address = program_address.to_string();
    map.insert(
        "programAddress".to_string(),
        JsonValue::String(program_address.clone()),
    );

    let data = match parse_hex_bytes(&data_hex) {
        Ok(data) => data,
        Err(err) => {
            insert_error(map, format!("Nested instruction decode failed: {err}"));
            return;
        }
    };

    match decoder(&program_address, &data) {
        Ok(Some(mut decoded)) => {
            resolve_value(
                &mut decoded.value,
                instruction_depth + 1,
                account_addresses,
                decoder,
                max_depth,
            );
            match serde_json::to_value(decoded) {
                Ok(value) => {
                    map.insert("decodedInstruction".to_string(), value);
                }
                Err(err) => {
                    insert_error(map, format!("Nested instruction decode failed: {err}"));
                }
            }
        }
        Ok(None) => {
            insert_error(
                map,
                format!("ABI unavailable for program {program_address}"),
            );
        }
        Err(err) => {
            insert_error(map, format!("Nested instruction decode failed: {err}"));
        }
    }
}

fn is_instruction_data_value(map: &Map<String, JsonValue>) -> bool {
    map.get("_pendingReflection").and_then(JsonValue::as_bool) == Some(true)
        && map
            .get("programIndex")
            .and_then(JsonValue::as_u64)
            .is_some()
        && map.get("dataHex").and_then(JsonValue::as_str).is_some()
}

fn insert_error(map: &mut Map<String, JsonValue>, message: impl Into<String>) {
    map.insert("decodeError".to_string(), JsonValue::String(message.into()));
}

fn parse_hex_bytes(value: &str) -> Result<Vec<u8>, String> {
    let hex = value
        .strip_prefix("0x")
        .or_else(|| value.strip_prefix("0X"))
        .unwrap_or(value);

    if hex.len() % 2 != 0 {
        return Err("hex payload has an odd number of digits".to_string());
    }

    let mut bytes = Vec::with_capacity(hex.len() / 2);
    for (idx, pair) in hex.as_bytes().chunks_exact(2).enumerate() {
        let high = decode_hex_nibble(pair[0])
            .ok_or_else(|| format!("invalid hex payload at byte {idx}"))?;
        let low = decode_hex_nibble(pair[1])
            .ok_or_else(|| format!("invalid hex payload at byte {idx}"))?;
        bytes.push((high << 4) | low);
    }
    Ok(bytes)
}

fn decode_hex_nibble(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::HashMap;

    fn reflection(value: JsonValue, type_name: &str) -> FormattedReflection {
        FormattedReflection {
            type_name: type_name.to_string(),
            kind: Some("struct".to_string()),
            value,
            byte_range: None,
        }
    }

    fn instruction_data(program_index: u64, data_hex: &str) -> JsonValue {
        let data_size = data_hex
            .trim_start_matches("0x")
            .trim_start_matches("0X")
            .len()
            / 2;
        json!({
            "programIndex": program_index,
            "dataHex": data_hex,
            "dataSize": data_size,
            "_pendingReflection": true
        })
    }

    fn addresses(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| value.to_string()).collect()
    }

    #[test]
    fn decodes_single_nested_instruction_data_node() {
        let nested = reflection(json!({ "amount": 42 }), "TransferInstruction");
        let result = resolve_nested_instruction_data(
            reflection(
                json!({ "invoke": instruction_data(2, "0x0102") }),
                "RootInstruction",
            ),
            &addresses(&["fee", "root", "token"]),
            |program_address, data| {
                assert_eq!(program_address, "token");
                assert_eq!(data, &[0x01, 0x02]);
                Ok(Some(nested.clone()))
            },
        );

        let invoke = result.value["invoke"].as_object().expect("invoke object");
        assert_eq!(
            invoke.get("programAddress").and_then(JsonValue::as_str),
            Some("token")
        );
        assert!(invoke.get("decodeError").is_none());
        assert_eq!(
            invoke
                .get("decodedInstruction")
                .and_then(|value| value.get("typeName"))
                .and_then(JsonValue::as_str),
            Some("TransferInstruction")
        );
    }

    #[test]
    fn decodes_nesting_deeper_than_three_levels() {
        let decoded_by_hex = HashMap::from([
            (
                vec![0x01],
                reflection(json!({ "next": instruction_data(3, "0x02") }), "Level1"),
            ),
            (
                vec![0x02],
                reflection(json!({ "next": instruction_data(4, "0x03") }), "Level2"),
            ),
            (
                vec![0x03],
                reflection(json!({ "next": instruction_data(5, "0x04") }), "Level3"),
            ),
            (vec![0x04], reflection(json!({ "done": true }), "Level4")),
        ]);

        let result = resolve_nested_instruction_data(
            reflection(
                json!({ "first": instruction_data(2, "0x01") }),
                "RootInstruction",
            ),
            &addresses(&["fee", "root", "p1", "p2", "p3", "p4"]),
            |_, data| Ok(decoded_by_hex.get(data).cloned()),
        );

        let level4_type = result.value["first"]["decodedInstruction"]["value"]["next"]
            ["decodedInstruction"]["value"]["next"]["decodedInstruction"]["value"]["next"]
            ["decodedInstruction"]["typeName"]
            .as_str();
        assert_eq!(level4_type, Some("Level4"));
    }

    #[test]
    fn stops_at_nested_instruction_depth_cap() {
        let result = resolve_nested_instruction_data_with_options(
            reflection(
                json!({ "first": instruction_data(2, "0x01") }),
                "RootInstruction",
            ),
            &addresses(&["fee", "root", "p1", "p2"]),
            |_, _| {
                Ok(Some(reflection(
                    json!({ "child": instruction_data(3, "0x02") }),
                    "Level1",
                )))
            },
            NestedInstructionDecodeOptions { max_depth: 1 },
        );

        let child = &result.value["first"]["decodedInstruction"]["value"]["child"];
        assert!(child.get("decodedInstruction").is_none());
        assert_eq!(
            child.get("decodeError").and_then(JsonValue::as_str),
            Some("Nested instruction depth limit reached")
        );
    }

    #[test]
    fn records_invalid_program_index_error() {
        let result = resolve_nested_instruction_data(
            reflection(
                json!({ "invoke": instruction_data(9, "0x0102") }),
                "RootInstruction",
            ),
            &addresses(&["fee", "root"]),
            |_, _| panic!("decoder should not run"),
        );

        let invoke = result.value["invoke"].as_object().expect("invoke object");
        assert!(invoke.get("decodedInstruction").is_none());
        assert_eq!(
            invoke.get("decodeError").and_then(JsonValue::as_str),
            Some("Invalid program index 9")
        );
    }

    #[test]
    fn records_missing_abi_error() {
        let result = resolve_nested_instruction_data(
            reflection(
                json!({ "invoke": instruction_data(2, "0x0102") }),
                "RootInstruction",
            ),
            &addresses(&["fee", "root", "token"]),
            |_, _| Ok(None),
        );

        let invoke = result.value["invoke"].as_object().expect("invoke object");
        assert_eq!(
            invoke.get("programAddress").and_then(JsonValue::as_str),
            Some("token")
        );
        assert!(invoke.get("decodedInstruction").is_none());
        assert_eq!(
            invoke.get("decodeError").and_then(JsonValue::as_str),
            Some("ABI unavailable for program token")
        );
    }

    #[test]
    fn records_nested_decode_error() {
        let result = resolve_nested_instruction_data(
            reflection(
                json!({ "invoke": instruction_data(2, "0x0102") }),
                "RootInstruction",
            ),
            &addresses(&["fee", "root", "token"]),
            |_, _| Err("bad payload".to_string()),
        );

        let invoke = result.value["invoke"].as_object().expect("invoke object");
        assert!(invoke.get("decodedInstruction").is_none());
        assert_eq!(
            invoke.get("decodeError").and_then(JsonValue::as_str),
            Some("Nested instruction decode failed: bad payload")
        );
    }

    #[test]
    fn walks_arrays_objects_and_variant_payloads() {
        let mut decode_count = 0usize;
        let result = resolve_nested_instruction_data(
            reflection(
                json!({
                    "calls": [instruction_data(2, "0x01")],
                    "wrapper": {
                        "variant": "invoke",
                        "value": instruction_data(2, "0x02")
                    }
                }),
                "RootInstruction",
            ),
            &addresses(&["fee", "root", "token"]),
            |_, data| {
                decode_count += 1;
                Ok(Some(reflection(
                    json!({ "dataHex": format!("0x{}", hex_string(data)) }),
                    "Nested",
                )))
            },
        );

        assert!(result.value["calls"][0].get("decodedInstruction").is_some());
        assert!(result.value["wrapper"]["value"]
            .get("decodedInstruction")
            .is_some());
        assert_eq!(decode_count, 2);
    }

    #[test]
    fn ignores_lookalike_objects_without_pending_reflection_marker() {
        let result = resolve_nested_instruction_data(
            reflection(
                json!({
                    "not_instruction_data": {
                        "programIndex": 2,
                        "dataHex": "0x0102"
                    }
                }),
                "RootInstruction",
            ),
            &addresses(&["fee", "root", "token"]),
            |_, _| panic!("decoder should not run"),
        );

        let value = &result.value["not_instruction_data"];
        assert!(value.get("decodedInstruction").is_none());
        assert!(value.get("decodeError").is_none());
        assert!(value.get("programAddress").is_none());
    }

    fn hex_string(data: &[u8]) -> String {
        data.iter().map(|byte| format!("{byte:02x}")).collect()
    }
}
