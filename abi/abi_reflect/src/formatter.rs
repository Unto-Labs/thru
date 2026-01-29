use crate::types::ReflectedTypeKind;
use crate::value::{PrimitiveValue, ReflectedValue, Value};
use crate::well_known::{WellKnownContext, WellKnownRegistry, WellKnownResult};
use abi_gen::abi::types::{IntegralType, PrimitiveType};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value as JsonValue};

/* Base64-URL alphabet for address/signature encoding (used by tests) */
#[allow(dead_code)]
const BASE64_URL_ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FormatOptions {
    #[serde(default, rename = "includeByteOffsets")]
    pub include_byte_offsets: bool,
    #[serde(skip)]
    pub well_known_registry: Option<WellKnownRegistry>,
}

impl Default for FormatOptions {
    fn default() -> Self {
        Self {
            include_byte_offsets: false,
            well_known_registry: Some(WellKnownRegistry::with_defaults()),
        }
    }
}

impl FormatOptions {
    /* Create format options without any well-known type handling */
    pub fn without_well_known_types() -> Self {
        Self {
            include_byte_offsets: false,
            well_known_registry: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ByteRange {
    pub offset: u64,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FormattedReflection {
    #[serde(rename = "typeName")]
    pub type_name: String,
    pub kind: Option<String>,
    pub value: JsonValue,
    #[serde(rename = "byteRange", skip_serializing_if = "Option::is_none")]
    pub byte_range: Option<ByteRange>,
}

pub fn format_reflection(root: &ReflectedValue) -> FormattedReflection {
    format_reflection_with_options(root, &FormatOptions::default())
}

pub fn format_reflection_with_options(
    root: &ReflectedValue,
    options: &FormatOptions,
) -> FormattedReflection {
    let type_name = resolve_type_name(root).unwrap_or("unknown").to_string();
    let kind = value_kind(root.get_value()).map(|k| k.to_string());
    let value = format_node_with_options(root, None, 0, options);

    let byte_range = if options.include_byte_offsets {
        root.type_info.size.map(|size| ByteRange { offset: 0, size })
    } else {
        None
    };

    FormattedReflection {
        type_name,
        kind,
        value,
        byte_range,
    }
}

fn format_node(node: &ReflectedValue, explicit_type_name: Option<&str>) -> JsonValue {
    format_node_with_options(node, explicit_type_name, 0, &FormatOptions::default())
}

fn format_node_with_options(
    node: &ReflectedValue,
    explicit_type_name: Option<&str>,
    base_offset: u64,
    options: &FormatOptions,
) -> JsonValue {
    match node.get_value() {
        Value::Primitive(value) => {
            if options.include_byte_offsets {
                format_primitive_with_offset(value, base_offset, node.type_info.size)
            } else {
                format_primitive(value)
            }
        }
        Value::Struct { fields } => {
            let type_name = explicit_type_name.or_else(|| resolve_type_name(node));
            let struct_value =
                format_struct_with_options(node, fields, type_name, base_offset, options);
            apply_type_name_with_options(struct_value, type_name, base_offset, node.type_info.size, options)
        }
        Value::Array { elements } => {
            format_array_with_options(elements, base_offset, options)
        }
        Value::Enum {
            variant_name,
            variant_value,
            ..
        } => format_variant_with_options(variant_name, variant_value.as_ref(), base_offset, node.type_info.size, options),
        Value::Union {
            variant_name,
            variant_value,
        } => format_variant_with_options(variant_name, variant_value.as_ref(), base_offset, node.type_info.size, options),
        Value::SizeDiscriminatedUnion {
            variant_name,
            variant_value,
        } => format_variant_with_options(variant_name, variant_value.as_ref(), base_offset, node.type_info.size, options),
        Value::TypeRef { target_name, value } => {
            format_node_with_options(value, Some(target_name.as_str()), base_offset, options)
        }
    }
}

fn format_struct_with_options(
    node: &ReflectedValue,
    fields: &[(String, ReflectedValue)],
    type_name: Option<&str>,
    base_offset: u64,
    options: &FormatOptions,
) -> JsonValue {
    let mut map = Map::new();

    /* Build a map of field name -> offset from the type_info */
    let field_offsets = get_struct_field_offsets(&node.type_info.kind);
    /* Also get field sizes for tracking running offset */
    let field_sizes = get_struct_field_sizes(&node.type_info.kind);

    /* Track running offset for variable-size fields */
    let mut running_offset = 0u64;

    for (name, value) in fields {
        let relative_offset = field_offsets.get(name.as_str()).copied();
        let field_offset = if options.include_byte_offsets {
            if let Some(rel_off) = relative_offset {
                /* Field has known offset - use it and update running offset */
                let abs_offset = base_offset + rel_off;
                /* Update running offset to after this field */
                if let Some(size) = field_sizes.get(name.as_str()).copied().flatten() {
                    running_offset = rel_off + size;
                }
                abs_offset
            } else {
                /* Variable-size field - use running offset */
                let abs_offset = base_offset + running_offset;
                /* Update running offset based on the value's size */
                if let Some(size) = value.type_info.size {
                    running_offset += size;
                }
                abs_offset
            }
        } else {
            0
        };
        map.insert(
            name.clone(),
            format_node_with_options(value, None, field_offset, options),
        );
    }

    /* Apply well-known type enrichment via registry */
    if let Some(registry) = &options.well_known_registry {
        if let Some(name) = type_name {
            let ctx = WellKnownContext {
                value: node,
                type_name: name,
                fields: Some(fields),
            };

            match registry.process(&ctx) {
                WellKnownResult::EnrichFields(enrichment) => {
                    for (key, value) in enrichment {
                        map.insert(key, value);
                    }
                }
                WellKnownResult::Replace(replacement) => {
                    return replacement;
                }
                WellKnownResult::None => {}
            }
        }
    }

    JsonValue::Object(map)
}

fn get_struct_field_offsets(kind: &ReflectedTypeKind) -> std::collections::HashMap<&str, u64> {
    let mut offsets = std::collections::HashMap::new();
    if let ReflectedTypeKind::Struct { fields, .. } = kind {
        for field in fields {
            if let Some(offset) = field.offset {
                offsets.insert(field.name.as_str(), offset);
            }
        }
    }
    offsets
}

fn get_struct_field_sizes(kind: &ReflectedTypeKind) -> std::collections::HashMap<&str, Option<u64>> {
    let mut sizes = std::collections::HashMap::new();
    if let ReflectedTypeKind::Struct { fields, .. } = kind {
        for field in fields {
            sizes.insert(field.name.as_str(), field.field_type.size);
        }
    }
    sizes
}

fn format_array_with_options(
    elements: &[ReflectedValue],
    base_offset: u64,
    options: &FormatOptions,
) -> JsonValue {
    if !elements.is_empty() && elements.iter().all(is_u8_element) {
        let bytes: Vec<u8> = elements.iter().filter_map(extract_u8).collect();
        let hex = bytes.iter().map(|b| format!("{b:02x}")).collect::<String>();

        if options.include_byte_offsets {
            let mut map = Map::new();
            map.insert("hex".to_string(), JsonValue::String(format!("0x{hex}")));
            map.insert("_byteRange".to_string(), json!({
                "offset": base_offset,
                "size": bytes.len() as u64
            }));
            return JsonValue::Object(map);
        }

        return JsonValue::String(format!("0x{hex}"));
    }

    /* Char arrays: extract bytes up to null terminator, then validate UTF-8.
     * If valid UTF-8, display as string. If invalid, display as hex. */
    if !elements.is_empty() && elements.iter().all(is_char_element) {
        let bytes: Vec<u8> = elements
            .iter()
            .filter_map(extract_char_byte)
            .take_while(|&b| b != 0)
            .collect();

        /* Try to parse as UTF-8; show as string if valid, hex if invalid */
        let display_value = match String::from_utf8(bytes.clone()) {
            Ok(s) => JsonValue::String(s),
            Err(_) => {
                let hex = bytes.iter().map(|b| format!("{b:02x}")).collect::<String>();
                JsonValue::String(format!("0x{hex}"))
            }
        };

        if options.include_byte_offsets {
            let mut map = Map::new();
            /* Use "string" key for valid UTF-8, "hex" key for invalid */
            let key = match &display_value {
                JsonValue::String(s) if s.starts_with("0x") => "hex",
                _ => "string",
            };
            map.insert(key.to_string(), display_value);
            map.insert("_byteRange".to_string(), json!({
                "offset": base_offset,
                "size": elements.len() as u64
            }));
            return JsonValue::Object(map);
        }

        return display_value;
    }

    let mut cumulative_offset = base_offset;
    let formatted: Vec<JsonValue> = elements
        .iter()
        .map(|elem| {
            let elem_offset = cumulative_offset;
            let elem_size = elem.type_info.size.unwrap_or(0);
            cumulative_offset += elem_size;
            format_node_with_options(elem, None, elem_offset, options)
        })
        .collect();

    JsonValue::Array(formatted)
}

fn format_variant_with_options(
    variant_name: &str,
    variant_value: &ReflectedValue,
    base_offset: u64,
    size: Option<u64>,
    options: &FormatOptions,
) -> JsonValue {
    let mut map = Map::new();
    map.insert(
        "variant".to_string(),
        JsonValue::String(variant_name.to_string()),
    );
    map.insert(
        "value".to_string(),
        format_node_with_options(variant_value, None, base_offset, options),
    );

    if options.include_byte_offsets {
        if let Some(s) = size {
            map.insert("_byteRange".to_string(), json!({
                "offset": base_offset,
                "size": s
            }));
        }
    }

    JsonValue::Object(map)
}

fn format_primitive_with_offset(value: &PrimitiveValue, offset: u64, size: Option<u64>) -> JsonValue {
    let mut map = Map::new();
    map.insert("value".to_string(), format_primitive(value));
    map.insert("_byteRange".to_string(), json!({
        "offset": offset,
        "size": size.unwrap_or(0)
    }));
    JsonValue::Object(map)
}

fn format_primitive(value: &PrimitiveValue) -> JsonValue {
    match value {
        PrimitiveValue::U8(v) => json!(v.value),
        PrimitiveValue::U16(v) => json!(v.value),
        PrimitiveValue::U32(v) => json!(v.value),
        PrimitiveValue::U64(v) => json!(v.value),
        PrimitiveValue::I8(v) => json!(v.value),
        PrimitiveValue::I16(v) => json!(v.value),
        PrimitiveValue::I32(v) => json!(v.value),
        PrimitiveValue::I64(v) => json!(v.value),
        PrimitiveValue::F16(v) => json!(v.value),
        PrimitiveValue::F32(v) => json!(v.value),
        PrimitiveValue::F64(v) => json!(v.value),
        PrimitiveValue::Char(v) => {
            /* For printable ASCII, display as string; otherwise as hex */
            if v.value.is_ascii_graphic() || v.value == b' ' {
                json!(String::from(v.value as char))
            } else {
                json!(format!("0x{:02x}", v.value))
            }
        }
    }
}

fn value_kind(value: &Value) -> Option<&'static str> {
    match value {
        Value::Primitive(_) => Some("primitive"),
        Value::Struct { .. } => Some("struct"),
        Value::Union { .. } => Some("union"),
        Value::Enum { .. } => Some("enum"),
        Value::Array { .. } => Some("array"),
        Value::SizeDiscriminatedUnion { .. } => Some("size-discriminated-union"),
        Value::TypeRef { .. } => Some("type-ref"),
    }
}

fn resolve_type_name(value: &ReflectedValue) -> Option<&str> {
    match &value.type_info.kind {
        ReflectedTypeKind::TypeRef { target_name, .. } => Some(target_name.as_str()),
        _ => Some(value.type_info.name.as_str()),
    }
}

fn apply_type_name(mut value: JsonValue, type_name: Option<&str>) -> JsonValue {
    let Some(name) = type_name else {
        return value;
    };
    if name.is_empty() {
        return value;
    }

    if let JsonValue::Object(ref mut map) = value {
        map.entry("typeName".to_string())
            .or_insert_with(|| JsonValue::String(name.to_string()));
    }
    value
}

fn apply_type_name_with_options(
    mut value: JsonValue,
    type_name: Option<&str>,
    offset: u64,
    size: Option<u64>,
    options: &FormatOptions,
) -> JsonValue {
    if let Some(name) = type_name {
        if !name.is_empty() {
            if let JsonValue::Object(ref mut map) = value {
                map.entry("typeName".to_string())
                    .or_insert_with(|| JsonValue::String(name.to_string()));
            }
        }
    }

    if options.include_byte_offsets {
        if let JsonValue::Object(ref mut map) = value {
            if let Some(s) = size {
                map.insert("_byteRange".to_string(), json!({
                    "offset": offset,
                    "size": s
                }));
            }
        }
    }

    value
}

fn is_u8_element(value: &ReflectedValue) -> bool {
    matches!(
        value.type_info.kind,
        ReflectedTypeKind::Primitive {
            prim_type: PrimitiveType::Integral(IntegralType::U8)
        }
    ) && matches!(value.get_value(), Value::Primitive(_))
}

fn extract_u8(value: &ReflectedValue) -> Option<u8> {
    match value.get_value() {
        Value::Primitive(PrimitiveValue::U8(v)) => Some(v.value),
        _ => None,
    }
}

fn is_char_element(value: &ReflectedValue) -> bool {
    matches!(
        value.type_info.kind,
        ReflectedTypeKind::Primitive {
            prim_type: PrimitiveType::Integral(IntegralType::Char)
        }
    ) && matches!(value.get_value(), Value::Primitive(_))
}

fn extract_char_byte(value: &ReflectedValue) -> Option<u8> {
    match value.get_value() {
        Value::Primitive(PrimitiveValue::Char(v)) => Some(v.value),
        _ => None,
    }
}


/* Legacy encoding function, retained for tests - use well_known::handlers::PubkeyHandler instead */
#[allow(dead_code)]
fn encode_thru_address(bytes: &[u8]) -> Option<String> {
    if bytes.len() != 32 {
        return None;
    }

    let mut output = String::with_capacity(46);
    output.push('t');
    output.push('a');

    let mut checksum: u32 = 0;
    let mut accumulator: u32 = 0;
    let mut bits_collected: u32 = 0;

    for i in 0..30 {
        let byte = bytes[i] as u32;
        checksum += byte;
        accumulator = (accumulator << 8) | byte;
        bits_collected += 8;
        while bits_collected >= 6 {
            let index = (accumulator >> (bits_collected - 6)) & 0x3f;
            output.push(BASE64_URL_ALPHABET[index as usize] as char);
            bits_collected -= 6;
            accumulator &= mask_for_bits(bits_collected);
        }
    }

    let second_last = bytes[30] as u32;
    checksum += second_last;
    accumulator = (accumulator << 8) | second_last;
    bits_collected += 8;

    let last = bytes[31] as u32;
    checksum += last;
    accumulator = (accumulator << 8) | last;
    bits_collected += 8;

    accumulator = (accumulator << 8) | (checksum & 0xff);
    bits_collected += 8;

    while bits_collected >= 6 {
        let index = (accumulator >> (bits_collected - 6)) & 0x3f;
        output.push(BASE64_URL_ALPHABET[index as usize] as char);
        bits_collected -= 6;
        accumulator &= mask_for_bits(bits_collected);
    }

    Some(output)
}

#[allow(dead_code)]
fn mask_for_bits(bits: u32) -> u32 {
    if bits == 0 {
        0
    } else {
        (1 << bits) - 1
    }
}

#[allow(dead_code)]
fn try_extract_bytes_field(fields: &[(String, ReflectedValue)], expected_len: usize) -> Option<Vec<u8>> {
    if fields.len() != 1 {
        return None;
    }
    let (name, value) = &fields[0];
    if name != "bytes" {
        return None;
    }
    if let Value::Array { elements } = value.get_value() {
        if elements.len() == expected_len && elements.iter().all(is_u8_element) {
            return Some(elements.iter().filter_map(extract_u8).collect());
        }
    }
    None
}

/* Legacy encoding function, retained for tests - use well_known::handlers::SignatureHandler instead */
#[allow(dead_code)]
fn encode_thru_signature(bytes: &[u8]) -> Option<String> {
    if bytes.len() != 64 {
        return None;
    }

    let mut output = String::with_capacity(90);
    output.push('t');
    output.push('s');

    let mut checksum: u32 = 0;
    let mut accumulator: u32 = 0;
    let mut bits_collected: u32 = 0;

    for i in 0..63 {
        let byte = bytes[i] as u32;
        checksum += byte;
        accumulator = (accumulator << 8) | byte;
        bits_collected += 8;
        while bits_collected >= 6 {
            let index = (accumulator >> (bits_collected - 6)) & 0x3f;
            output.push(BASE64_URL_ALPHABET[index as usize] as char);
            bits_collected -= 6;
            accumulator &= mask_for_bits(bits_collected);
        }
    }

    let last_byte = bytes[63] as u32;
    checksum += last_byte;
    accumulator = (accumulator << 8) | last_byte;
    bits_collected += 8;

    accumulator = (accumulator << 16) | (checksum & 0xffff);
    bits_collected += 16;

    while bits_collected >= 6 {
        let index = (accumulator >> (bits_collected - 6)) & 0x3f;
        output.push(BASE64_URL_ALPHABET[index as usize] as char);
        bits_collected -= 6;
        accumulator &= mask_for_bits(bits_collected);
    }

    Some(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::value::PrimitiveValueChar;

    fn hex_to_bytes(hex: &str) -> Vec<u8> {
        let cleaned: String = hex.chars().filter(|c| !c.is_whitespace()).collect();
        (0..cleaned.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&cleaned[i..i + 2], 16).expect("valid hex"))
            .collect()
    }

    #[test]
    fn encode_thru_address_zeros() {
        let bytes = [0u8; 32];
        let address = encode_thru_address(&bytes).expect("should encode");
        assert_eq!(address, "taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
        assert_eq!(address.len(), 46, "thru addresses are always 46 characters");
    }

    #[test]
    fn encode_thru_address_mint_bytes() {
        let bytes = hex_to_bytes(
            "906b582852c5940dfe2664bc77717eb62e05e9c5b5b5c8d59cd4756d5c3dd771",
        );
        let address = encode_thru_address(&bytes).expect("should encode");
        assert_eq!(address, "takGtYKFLFlA3-JmS8d3F-ti4F6cW1tcjVnNR1bVw913Gu");
    }

    #[test]
    fn encode_thru_address_owner_bytes() {
        let bytes = hex_to_bytes(
            "ace7124bd312557a711a15c92d38a2d7e0d2fbf6ede3092df4a543d0a00122ae",
        );
        let address = encode_thru_address(&bytes).expect("should encode");
        assert_eq!(address, "tarOcSS9MSVXpxGhXJLTii1-DS-_bt4wkt9KVD0KABIq6x");
    }

    #[test]
    fn encode_thru_address_wrong_length_returns_none() {
        let short = [0u8; 31];
        assert!(encode_thru_address(&short).is_none());

        let long = [0u8; 33];
        assert!(encode_thru_address(&long).is_none());
    }

    #[test]
    fn encode_thru_signature_zeros() {
        let bytes = [0u8; 64];
        let sig = encode_thru_signature(&bytes).expect("should encode");
        assert_eq!(
            sig,
            "tsAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
        );
        assert_eq!(sig.len(), 90, "thru signatures are always 90 characters");
    }

    #[test]
    fn encode_thru_signature_sequential() {
        let mut bytes = [0u8; 64];
        for i in 0..64 {
            bytes[i] = i as u8;
        }
        let sig = encode_thru_signature(&bytes).expect("should encode");
        assert_eq!(
            sig,
            "tsAAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0-Pwfg"
        );
    }

    #[test]
    fn encode_thru_signature_all_ff() {
        let bytes = [0xffu8; 64];
        let sig = encode_thru_signature(&bytes).expect("should encode");
        assert_eq!(
            sig,
            "ts_____________________________________________________________________________________z_A"
        );
    }

    #[test]
    fn encode_thru_signature_wrong_length_returns_none() {
        let short = [0u8; 63];
        assert!(encode_thru_signature(&short).is_none());

        let long = [0u8; 65];
        assert!(encode_thru_signature(&long).is_none());
    }

    #[test]
    fn format_primitive_char_printable_ascii() {
        let char_value = PrimitiveValueChar {
            type_name: "char".to_string(),
            value: b'A',
        };
        let result = format_primitive(&PrimitiveValue::Char(char_value));
        assert_eq!(result, serde_json::json!("A"));
    }

    #[test]
    fn format_primitive_char_space() {
        let char_value = PrimitiveValueChar {
            type_name: "char".to_string(),
            value: b' ',
        };
        let result = format_primitive(&PrimitiveValue::Char(char_value));
        assert_eq!(result, serde_json::json!(" "));
    }

    #[test]
    fn format_primitive_char_non_printable_shows_hex() {
        /* Null byte should show as hex */
        let char_value = PrimitiveValueChar {
            type_name: "char".to_string(),
            value: 0x00,
        };
        let result = format_primitive(&PrimitiveValue::Char(char_value));
        assert_eq!(result, serde_json::json!("0x00"));

        /* High byte (invalid UTF-8) should show as hex */
        let char_value = PrimitiveValueChar {
            type_name: "char".to_string(),
            value: 0x80,
        };
        let result = format_primitive(&PrimitiveValue::Char(char_value));
        assert_eq!(result, serde_json::json!("0x80"));
    }
}
