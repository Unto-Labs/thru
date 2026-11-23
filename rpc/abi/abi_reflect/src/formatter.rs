use crate::synthetic::{
    evaluate_struct, SyntheticContext, SyntheticFailure, SyntheticOutcome, SyntheticValue,
};
use crate::types::ReflectedTypeKind;
use crate::value::{PrimitiveValue, ReflectedValue, Value};
use crate::well_known::{WellKnownContext, WellKnownRegistry, WellKnownResult};
use abi_gen::abi::types::{IntegralType, PrimitiveType, StructDisplay, ValueFormat};
use base64::engine::general_purpose::{STANDARD as BASE64_STANDARD, URL_SAFE_NO_PAD};
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value as JsonValue};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FormatOptions {
    #[serde(default, rename = "includeByteOffsets")]
    pub include_byte_offsets: bool,
    /* Options parsed from JSON (the WASM / TS path) keep the default
     * registry, so Pubkeys still get their `address`. */
    #[serde(skip, default = "default_well_known_registry")]
    pub well_known_registry: Option<WellKnownRegistry>,
    /* The transaction's account list, in order. Synthetic fields that read
     * account indexes report "unavailable" without it. */
    #[serde(
        default,
        rename = "accountAddresses",
        skip_serializing_if = "Option::is_none"
    )]
    pub account_addresses: Option<Vec<String>>,
}

fn default_well_known_registry() -> Option<WellKnownRegistry> {
    Some(WellKnownRegistry::with_defaults())
}

impl Default for FormatOptions {
    fn default() -> Self {
        Self {
            include_byte_offsets: false,
            well_known_registry: default_well_known_registry(),
            account_addresses: None,
        }
    }
}

impl FormatOptions {
    /* Create format options without any well-known type handling */
    pub fn without_well_known_types() -> Self {
        Self {
            include_byte_offsets: false,
            well_known_registry: None,
            account_addresses: None,
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
    /* Friendly cards: one per struct with a display name, in tree order */
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub display: Vec<DisplayCard>,
}

/* A friendly view of one struct: a heading and its visible fields */
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayCard {
    /* Field and variant names from the root to this struct */
    pub path: Vec<String>,
    pub type_name: String,
    pub title: String,
    pub rows: Vec<DisplayRow>,
    /* True when a visible field has no value */
    pub incomplete: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayRow {
    pub name: String,
    pub label: String,
    /* "wire" (decoded bytes) or "synthetic" (computed) */
    pub source: String,
    /* A well-known type's display kind (address, signature, hash, time, date,
     * duration, decimal, money, color, bool, text), or for plain values
     * integer, text, bool, none, or value (anything else). */
    pub kind: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<JsonValue>,
    /* ok, unavailable, or error */
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub issue: Option<String>,
    /* Synthetic rows only: the ABI expression and its declared return type,
     * as written (`Pubkey`, `u64`, `optional<Text>`) */
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expression: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub return_type: Option<String>,
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
        root.type_info
            .size
            .map(|size| ByteRange { offset: 0, size })
    } else {
        None
    };

    let mut display = Vec::new();
    collect_display_cards(root, None, &mut Vec::new(), options, &mut display);

    FormattedReflection {
        type_name,
        kind,
        value,
        byte_range,
        display,
    }
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
            apply_type_name_with_options(
                struct_value,
                type_name,
                base_offset,
                node.type_info.size,
                options,
            )
        }
        Value::Array { elements } => {
            if let Some(format) = &node.type_info.format {
                if let Some(bytes) = extract_byte_elements(elements) {
                    return format_bytes_with_format(&bytes, format, base_offset, options);
                }
            }
            format_array_with_options(elements, base_offset, options)
        }
        Value::Enum {
            variant_name,
            variant_value,
            ..
        } => format_variant_with_options(
            variant_name,
            variant_value.as_ref(),
            base_offset,
            node.type_info.size,
            options,
        ),
        Value::Union { variants } => {
            format_union_with_options(variants, base_offset, node.type_info.size, options)
        }
        Value::SizeDiscriminatedUnion {
            variant_name,
            variant_value,
        } => format_variant_with_options(
            variant_name,
            variant_value.as_ref(),
            base_offset,
            node.type_info.size,
            options,
        ),
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

    /* Track running offset for variable-size fields. Offsets can come from a
     * caller's JSON (`format_reflection(raw_json)`), so they wrap rather than
     * panic. */
    let mut running_offset = 0u64;

    for (name, value) in fields {
        let relative_offset = field_offsets.get(name.as_str()).copied();
        let field_offset = if options.include_byte_offsets {
            if let Some(rel_off) = relative_offset {
                /* Field has known offset - use it and update running offset */
                let abs_offset = base_offset.wrapping_add(rel_off);
                /* Update running offset to after this field */
                if let Some(size) = field_sizes
                    .get(name.as_str())
                    .copied()
                    .flatten()
                    .or_else(|| reflected_runtime_size(value))
                {
                    running_offset = rel_off.wrapping_add(size);
                }
                abs_offset
            } else {
                /* Variable-size field - use running offset */
                let abs_offset = base_offset.wrapping_add(running_offset);
                /* Update running offset based on the value's size */
                if let Some(size) = reflected_runtime_size(value) {
                    running_offset = running_offset.wrapping_add(size);
                }
                abs_offset
            }
        } else {
            0
        };
        map.insert(
            name.clone(),
            format_field_with_options(name, value, fields, field_offset, options),
        );
    }

    if let Some(display) = node
        .type_info
        .display
        .as_ref()
        .filter(|display| !display.synthetic.is_empty())
    {
        map = insert_synthetic_fields(map, fields, display, options);
    }

    /* Apply well-known type enrichment via registry */
    if let Some(registry) = &options.well_known_registry {
        if let Some(name) = type_name {
            let ctx = WellKnownContext {
                value: node,
                type_name: name,
                fields: Some(fields),
            };

            let well_known_result = registry.process(&ctx);
            match well_known_result {
                WellKnownResult::EnrichFields(enrichment) => {
                    for (key, value) in enrichment {
                        map.insert(key, value);
                    }
                    /* One line for people: what kind of value, and its text. */
                    if let Some((kind, text)) = registry.display_form(name, &map) {
                        map.insert("display".into(), json!({ "kind": kind, "text": text }));
                    }
                    return JsonValue::Object(map);
                }
                WellKnownResult::Replace(replacement) => {
                    return replacement;
                }
                WellKnownResult::None => {}
            }
        }
    }

    if let Some(format) = &node.type_info.format {
        if let Some(bytes) = extract_struct_format_bytes(fields) {
            let formatted = format_bytes_with_format(&bytes, format, base_offset, options);
            if let JsonValue::Object(enrichment) = formatted {
                for (key, value) in enrichment {
                    if key == "bytes" && map.contains_key("bytes") {
                        continue;
                    }
                    map.insert(key, value);
                }
            }
        }
    }

    JsonValue::Object(map)
}

fn synthetic_context(options: &FormatOptions) -> SyntheticContext<'_> {
    SyntheticContext {
        account_addresses: options.account_addresses.as_deref(),
        registry: options.well_known_registry.as_ref(),
    }
}

/* Put each synthetic value into the technical tree at its declared place.
 * It carries no byte range, so byte views highlight nothing for it. */
fn insert_synthetic_fields(
    mut wire: Map<String, JsonValue>,
    fields: &[(String, ReflectedValue)],
    display: &StructDisplay,
    options: &FormatOptions,
) -> Map<String, JsonValue> {
    let ctx = synthetic_context(options);
    let outcomes = evaluate_struct(display, fields, &ctx);
    let mut map = Map::new();
    for position in 0..=fields.len() {
        for (field, (name, outcome)) in display.synthetic.iter().zip(&outcomes) {
            if field.position == position {
                map.insert(name.clone(), synthetic_json(outcome, options));
            }
        }
        if let Some((name, _)) = fields.get(position) {
            if let Some(value) = wire.remove(name) {
                map.insert(name.clone(), value);
            }
        }
    }
    /* Anything else the wire pass produced keeps its place at the end. */
    for (key, value) in wire {
        map.entry(key).or_insert(value);
    }
    map
}

/* A computed value formats like a wire value of its type, with no bytes
 * behind it, so never with byte offsets. */
fn synthetic_json(outcome: &SyntheticOutcome, options: &FormatOptions) -> JsonValue {
    match outcome {
        Ok(SyntheticValue::Value(node)) => format_node_with_options(node, None, 0, &plain(options)),
        Ok(SyntheticValue::None) => JsonValue::Null,
        Err(failure) => json!({ failure.status(): failure.message() }),
    }
}

fn plain(options: &FormatOptions) -> FormatOptions {
    FormatOptions {
        include_byte_offsets: false,
        ..options.clone()
    }
}

/* The display form (kind, text) of a decoded or built value, if its type has
 * one. Synthetic text templates use it to write a value the way people read it. */
/* Asks the value's well-known handler (from the caller's registry, as
 * formatting does) directly instead of formatting the value, so a template
 * costs one handler call, not a subtree. */
pub(crate) fn display_form_of(
    node: &ReflectedValue,
    registry: &WellKnownRegistry,
) -> Option<(String, String)> {
    let mut name = resolve_type_name(node)?;
    let mut current = node;
    while let Value::TypeRef { target_name, value } = current.get_value() {
        name = target_name;
        current = value;
    }
    let Value::Struct { fields } = current.get_value() else {
        return None;
    };
    let ctx = WellKnownContext {
        value: current,
        type_name: name,
        fields: Some(fields),
    };
    match registry.process(&ctx) {
        WellKnownResult::EnrichFields(enrichment) => registry
            .display_form(name, &enrichment)
            .map(|(kind, text)| (kind.to_string(), text)),
        _ => None,
    }
}

fn display_of(map: &Map<String, JsonValue>) -> Option<(String, String)> {
    let display = map.get("display")?.as_object()?;
    Some((
        display.get("kind")?.as_str()?.to_string(),
        display.get("text")?.as_str()?.to_string(),
    ))
}

/* Walk the tree and build one card per struct that has a display name. */
fn collect_display_cards(
    node: &ReflectedValue,
    explicit_type_name: Option<&str>,
    path: &mut Vec<String>,
    options: &FormatOptions,
    out: &mut Vec<DisplayCard>,
) {
    match node.get_value() {
        Value::Struct { fields } => {
            if let Some(display) = &node.type_info.display {
                if let Some(title) = &display.display_name {
                    let type_name = explicit_type_name
                        .or_else(|| resolve_type_name(node))
                        .unwrap_or_default();
                    out.push(build_card(path, type_name, title, fields, display, options));
                }
            }
            for (name, child) in fields {
                path.push(name.clone());
                collect_display_cards(child, None, path, options, out);
                path.pop();
            }
        }
        Value::Union { variants } => {
            for (name, child) in variants {
                path.push(name.clone());
                collect_display_cards(child, None, path, options, out);
                path.pop();
            }
        }
        Value::Enum {
            variant_name,
            variant_value,
            ..
        }
        | Value::SizeDiscriminatedUnion {
            variant_name,
            variant_value,
        } => {
            path.push(variant_name.clone());
            collect_display_cards(variant_value, None, path, options, out);
            path.pop();
        }
        Value::Array { elements } => {
            for (index, child) in elements.iter().enumerate() {
                if matches!(child.get_value(), Value::Primitive(_)) {
                    continue;
                }
                path.push(index.to_string());
                collect_display_cards(child, None, path, options, out);
                path.pop();
            }
        }
        Value::TypeRef { target_name, value } => {
            collect_display_cards(value, Some(target_name), path, options, out);
        }
        Value::Primitive(_) => {}
    }
}

fn build_card(
    path: &[String],
    type_name: &str,
    title: &str,
    fields: &[(String, ReflectedValue)],
    display: &StructDisplay,
    options: &FormatOptions,
) -> DisplayCard {
    let ctx = synthetic_context(options);
    let outcomes = evaluate_struct(display, fields, &ctx);
    let plain = plain(options);
    let mut rows = Vec::new();
    for position in 0..=fields.len() {
        for (field, (_, outcome)) in display.synthetic.iter().zip(&outcomes) {
            if field.position != position || field.user_display != Some(true) {
                continue;
            }
            let label = field
                .display_name
                .clone()
                .unwrap_or_else(|| field.name.clone());
            let mut row = match outcome {
                Ok(value) => {
                    let (kind, value) = classify_value(synthetic_json(&Ok(value.clone()), &plain));
                    DisplayRow {
                        name: field.name.clone(),
                        label,
                        source: "synthetic".into(),
                        kind,
                        value: Some(value),
                        status: "ok".into(),
                        issue: None,
                        expression: None,
                        return_type: None,
                    }
                }
                Err(failure) => failed_row(&field.name, label, failure),
            };
            row.expression = Some(field.expression.clone());
            row.return_type = Some(field.return_type.to_string());
            rows.push(row);
        }
        let Some((name, value)) = fields.get(position) else {
            continue;
        };
        if !display.wire_field_visible(name) {
            continue;
        }
        let label = display
            .field_labels
            .get(name)
            .and_then(|label| label.display_name.clone())
            .unwrap_or_else(|| name.clone());
        let (kind, value) =
            classify_value(format_field_with_options(name, value, fields, 0, &plain));
        rows.push(DisplayRow {
            name: name.clone(),
            label,
            source: "wire".into(),
            kind,
            value: Some(value),
            status: "ok".into(),
            issue: None,
            expression: None,
            return_type: None,
        });
    }
    DisplayCard {
        path: path.to_vec(),
        type_name: type_name.to_string(),
        title: title.to_string(),
        incomplete: rows.iter().any(|row| row.status != "ok"),
        rows,
    }
}

fn failed_row(name: &str, label: String, failure: &SyntheticFailure) -> DisplayRow {
    DisplayRow {
        name: name.to_string(),
        label,
        source: "synthetic".into(),
        kind: "none".into(),
        value: None,
        status: failure.status().into(),
        issue: Some(failure.message().to_string()),
        expression: None,
        return_type: None,
    }
}

/* Reduce a formatted value, wire or computed, to what a card row needs: a
 * display kind and the text people read. Well-known types say both through
 * their display form; plain values are classified by their JSON. */
fn classify_value(value: JsonValue) -> (String, JsonValue) {
    let (kind, value) = match value {
        JsonValue::Number(n) => ("integer", JsonValue::String(n.to_string())),
        JsonValue::String(s) => ("text", JsonValue::String(s)),
        JsonValue::Bool(b) => ("bool", JsonValue::Bool(b)),
        JsonValue::Null => ("none", JsonValue::Null),
        JsonValue::Object(map) => {
            if let Some((kind, text)) = display_of(&map) {
                return (kind, JsonValue::String(text));
            }
            /* A struct with `format: text` carries its text, not a display form. */
            if let Some(JsonValue::String(text)) = map.get("text") {
                return ("text".into(), JsonValue::String(text.clone()));
            }
            ("value", JsonValue::Object(map))
        }
        other => ("value", other),
    };
    (kind.to_string(), value)
}

fn format_field_with_options(
    name: &str,
    value: &ReflectedValue,
    siblings: &[(String, ReflectedValue)],
    field_offset: u64,
    options: &FormatOptions,
) -> JsonValue {
    let Some(format) = &value.type_info.format else {
        return format_node_with_options(value, None, field_offset, options);
    };

    if let Some(bytes) = extract_value_bytes(value) {
        let bytes = limit_bytes_by_sibling_length(name, siblings, bytes);
        return format_bytes_with_format(&bytes, format, field_offset, options);
    }

    format_node_with_options(value, None, field_offset, options)
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

fn get_struct_field_sizes(
    kind: &ReflectedTypeKind,
) -> std::collections::HashMap<&str, Option<u64>> {
    let mut sizes = std::collections::HashMap::new();
    if let ReflectedTypeKind::Struct { fields, .. } = kind {
        for field in fields {
            sizes.insert(field.name.as_str(), field.field_type.size);
        }
    }
    sizes
}

fn reflected_runtime_size(value: &ReflectedValue) -> Option<u64> {
    if let Some(size) = value.type_info.size {
        return Some(size);
    }

    match value.get_value() {
        Value::Array { elements } => elements.iter().try_fold(0u64, |acc, element| {
            reflected_runtime_size(element).and_then(|size| acc.checked_add(size))
        }),
        Value::Struct { fields } => {
            let ReflectedTypeKind::Struct {
                fields: type_fields,
                ..
            } = &value.type_info.kind
            else {
                return None;
            };

            let mut running_offset = 0u64;
            for (idx, (_, field)) in fields.iter().enumerate() {
                let field_offset = type_fields
                    .get(idx)
                    .and_then(|field| field.offset)
                    .unwrap_or(running_offset);
                let field_size = reflected_runtime_size(field)?;
                running_offset = running_offset.max(field_offset.checked_add(field_size)?);
            }
            Some(running_offset)
        }
        Value::Union { variants } => variants.iter().try_fold(0u64, |acc, (_, variant)| {
            reflected_runtime_size(variant).map(|size| acc.max(size))
        }),
        Value::Enum { variant_value, .. } => reflected_runtime_size(variant_value),
        Value::SizeDiscriminatedUnion { variant_value, .. } => {
            reflected_runtime_size(variant_value)
        }
        Value::TypeRef { value, .. } => reflected_runtime_size(value),
        _ => None,
    }
}

fn extract_value_bytes(value: &ReflectedValue) -> Option<Vec<u8>> {
    match value.get_value() {
        Value::Array { elements } => extract_byte_elements(elements),
        Value::TypeRef { value, .. } => extract_value_bytes(value),
        _ => None,
    }
}

fn extract_byte_elements(elements: &[ReflectedValue]) -> Option<Vec<u8>> {
    if elements.iter().all(is_u8_element) {
        return Some(elements.iter().filter_map(extract_u8).collect());
    }
    if elements.iter().all(is_char_element) {
        return Some(elements.iter().filter_map(extract_char).collect());
    }
    None
}

fn extract_struct_format_bytes(fields: &[(String, ReflectedValue)]) -> Option<Vec<u8>> {
    let bytes = get_field(fields, "bytes")
        .or_else(|| get_field(fields, "value"))
        .and_then(extract_value_bytes)?;
    let len = get_field(fields, "length")
        .or_else(|| get_field(fields, "len"))
        .or_else(|| get_field(fields, "value_len"))
        .and_then(extract_integral_usize);
    Some(limit_bytes(bytes, len))
}

fn limit_bytes_by_sibling_length(
    field_name: &str,
    siblings: &[(String, ReflectedValue)],
    bytes: Vec<u8>,
) -> Vec<u8> {
    let candidates = [
        format!("{field_name}_length"),
        format!("{field_name}_len"),
        format!("{}_length", field_name.trim_end_matches("_bytes")),
        format!("{}_len", field_name.trim_end_matches("_bytes")),
    ];
    let len = candidates
        .iter()
        .find_map(|candidate| get_field(siblings, candidate).and_then(extract_integral_usize));
    limit_bytes(bytes, len)
}

fn limit_bytes(bytes: Vec<u8>, len: Option<usize>) -> Vec<u8> {
    let Some(len) = len else {
        return bytes;
    };
    bytes.into_iter().take(len).collect()
}

fn get_field<'a>(fields: &'a [(String, ReflectedValue)], name: &str) -> Option<&'a ReflectedValue> {
    fields.iter().find(|(n, _)| n == name).map(|(_, v)| v)
}

fn extract_integral_usize(value: &ReflectedValue) -> Option<usize> {
    match value.get_value() {
        Value::Primitive(PrimitiveValue::U8(v)) => Some(v.value as usize),
        Value::Primitive(PrimitiveValue::U16(v)) => Some(v.value as usize),
        Value::Primitive(PrimitiveValue::U32(v)) => Some(v.value as usize),
        Value::Primitive(PrimitiveValue::U64(v)) => usize::try_from(v.value).ok(),
        Value::Primitive(PrimitiveValue::I8(v)) => usize::try_from(v.value).ok(),
        Value::Primitive(PrimitiveValue::I16(v)) => usize::try_from(v.value).ok(),
        Value::Primitive(PrimitiveValue::I32(v)) => usize::try_from(v.value).ok(),
        Value::Primitive(PrimitiveValue::I64(v)) => usize::try_from(v.value).ok(),
        Value::TypeRef { value, .. } => extract_integral_usize(value),
        _ => None,
    }
}

fn format_bytes_with_format(
    bytes: &[u8],
    format: &ValueFormat,
    base_offset: u64,
    options: &FormatOptions,
) -> JsonValue {
    match format {
        ValueFormat::Hex => JsonValue::String(format_hex(bytes)),
        ValueFormat::Base64 => JsonValue::String(BASE64_STANDARD.encode(bytes)),
        ValueFormat::Base64url => JsonValue::String(URL_SAFE_NO_PAD.encode(bytes)),
        ValueFormat::Text => format_text_bytes(bytes, base_offset, options),
        ValueFormat::Json => format_json_bytes(bytes, base_offset, options),
    }
}

fn format_text_bytes(bytes: &[u8], base_offset: u64, options: &FormatOptions) -> JsonValue {
    let mut map = formatted_bytes_base(bytes, base_offset, options);
    match std::str::from_utf8(bytes) {
        Ok(text) => {
            let text = text.trim_end_matches('\0').to_string();
            map.insert("text".to_string(), JsonValue::String(text.clone()));
            map.insert("formatted".to_string(), JsonValue::String(text));
        }
        Err(err) => {
            map.insert(
                "formatError".to_string(),
                JsonValue::String(format!("invalid utf-8: {err}")),
            );
        }
    }
    JsonValue::Object(map)
}

fn format_json_bytes(bytes: &[u8], base_offset: u64, options: &FormatOptions) -> JsonValue {
    let mut map = formatted_bytes_base(bytes, base_offset, options);
    match std::str::from_utf8(bytes) {
        Ok(text) => {
            let text = text.trim_end_matches('\0').to_string();
            map.insert("text".to_string(), JsonValue::String(text.clone()));
            match serde_json::from_str::<JsonValue>(&text) {
                Ok(json) => {
                    map.insert("json".to_string(), json);
                }
                Err(err) => {
                    map.insert(
                        "formatError".to_string(),
                        JsonValue::String(format!("invalid json: {err}")),
                    );
                }
            }
        }
        Err(err) => {
            map.insert(
                "formatError".to_string(),
                JsonValue::String(format!("invalid utf-8: {err}")),
            );
        }
    }
    JsonValue::Object(map)
}

fn formatted_bytes_base(
    bytes: &[u8],
    base_offset: u64,
    options: &FormatOptions,
) -> Map<String, JsonValue> {
    let mut map = Map::new();
    map.insert("bytes".to_string(), JsonValue::String(format_hex(bytes)));
    if options.include_byte_offsets {
        map.insert(
            "_byteRange".to_string(),
            json!({
                "offset": base_offset,
                "size": bytes.len() as u64
            }),
        );
    }
    map
}

fn format_hex(bytes: &[u8]) -> String {
    let hex = bytes.iter().map(|b| format!("{b:02x}")).collect::<String>();
    format!("0x{hex}")
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
            map.insert(
                "_byteRange".to_string(),
                json!({
                    "offset": base_offset,
                    "size": bytes.len() as u64
                }),
            );
            return JsonValue::Object(map);
        }

        return JsonValue::String(format!("0x{hex}"));
    }

    /* Char arrays display as strings, stopping at null terminator or array end */
    if !elements.is_empty() && elements.iter().all(is_char_element) {
        let bytes: Vec<u8> = elements
            .iter()
            .filter_map(extract_char)
            .take_while(|&b| b != 0)
            .collect();
        let string = String::from_utf8_lossy(&bytes).to_string();

        if options.include_byte_offsets {
            let mut map = Map::new();
            map.insert("string".to_string(), JsonValue::String(string));
            map.insert(
                "_byteRange".to_string(),
                json!({
                    "offset": base_offset,
                    "size": elements.len() as u64
                }),
            );
            return JsonValue::Object(map);
        }

        return JsonValue::String(string);
    }

    let mut cumulative_offset = base_offset;
    let formatted: Vec<JsonValue> = elements
        .iter()
        .map(|elem| {
            let elem_offset = cumulative_offset;
            let elem_size = reflected_runtime_size(elem).unwrap_or(0);
            cumulative_offset = cumulative_offset.wrapping_add(elem_size);
            format_node_with_options(elem, None, elem_offset, options)
        })
        .collect();

    JsonValue::Array(formatted)
}

/* Every variant of a union, by name, each at the union's offset. */
fn format_union_with_options(
    variants: &[(String, ReflectedValue)],
    base_offset: u64,
    size: Option<u64>,
    options: &FormatOptions,
) -> JsonValue {
    let mut map = Map::new();
    for (name, value) in variants {
        map.insert(
            name.clone(),
            format_node_with_options(value, None, base_offset, options),
        );
    }

    if options.include_byte_offsets {
        if let Some(s) = size {
            map.insert(
                "_byteRange".to_string(),
                json!({
                    "offset": base_offset,
                    "size": s
                }),
            );
        }
    }

    JsonValue::Object(map)
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
            map.insert(
                "_byteRange".to_string(),
                json!({
                    "offset": base_offset,
                    "size": s
                }),
            );
        }
    }

    JsonValue::Object(map)
}

fn format_primitive_with_offset(
    value: &PrimitiveValue,
    offset: u64,
    size: Option<u64>,
) -> JsonValue {
    let mut map = Map::new();
    map.insert("value".to_string(), format_primitive(value));
    map.insert(
        "_byteRange".to_string(),
        json!({
            "offset": offset,
            "size": size.unwrap_or(0)
        }),
    );
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
        PrimitiveValue::Char(v) => json!(v.value.to_string()),
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
                map.insert(
                    "_byteRange".to_string(),
                    json!({
                        "offset": offset,
                        "size": s
                    }),
                );
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

fn extract_char(value: &ReflectedValue) -> Option<u8> {
    match value.get_value() {
        Value::Primitive(PrimitiveValue::Char(v)) => Some(v.value),
        _ => None,
    }
}
