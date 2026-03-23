use crate::abi::resolved::{ResolvedType, ResolvedTypeKind};
use crate::abi::types::PrimitiveType;
use crate::codegen::shared::ir::TypeIr;
use std::collections::BTreeMap;
use std::convert::TryFrom;

#[derive(Clone)]
pub struct DynamicBinding {
    pub path: String,
    pub prim_type: PrimitiveType,
}

pub fn sanitize_param_name(name: &str) -> String {
    // Replace separators with underscores
    let with_underscores = name.replace(['.', ':', '-'], "_");
    // Convert to snake_case (lowercase with underscores)
    let mut result = String::new();
    for (i, ch) in with_underscores.chars().enumerate() {
        if ch.is_uppercase() {
            // Add underscore before uppercase letter if not at start and previous char isn't underscore
            if i > 0 {
                let prev_char = with_underscores.chars().nth(i - 1);
                if prev_char != Some('_') && prev_char.map(|c| c.is_lowercase()).unwrap_or(false) {
                    result.push('_');
                }
            }
            result.push(ch.to_lowercase().next().unwrap());
        } else {
            result.push(ch);
        }
    }
    // Clean up double underscores
    while result.contains("__") {
        result = result.replace("__", "_");
    }
    result
}

pub fn collect_dynamic_param_bindings(
    resolved_type: &ResolvedType,
) -> BTreeMap<String, DynamicBinding> {
    let mut map = BTreeMap::new();
    for refs in resolved_type.dynamic_params.values() {
        for (path, prim_type) in refs {
            if path.starts_with("_typeref_") {
                continue;
            }
            let key = sanitize_param_name(path);
            map.entry(key).or_insert_with(|| DynamicBinding {
                path: path.clone(),
                prim_type: prim_type.clone(),
            });
        }
    }
    map
}

pub fn resolve_param_binding<'a>(ir_param: &str, available: &'a [String]) -> Option<&'a String> {
    if let Some(idx) = available.iter().find(|cand| cand.as_str() == ir_param) {
        return Some(idx);
    }

    available.iter().find(|cand| {
        if ir_param.len() <= cand.len() {
            return false;
        }
        if !ir_param.ends_with(cand.as_str()) {
            return false;
        }
        let prefix_idx = ir_param.len() - cand.len() - 1;
        ir_param.as_bytes().get(prefix_idx) == Some(&b'_')
    })
}

pub fn extract_payload_field_name(param_name: &str) -> Option<String> {
    let base = param_name.strip_suffix(".payload_size")?;
    let normalized = base.replace("::", ".");
    normalized.rsplit('.').next().map(|field| field.to_string())
}

pub fn type_ir_available(type_ir: Option<&TypeIr>) -> bool {
    type_ir.is_some()
}

pub fn referenced_field_prim_type<'a>(
    resolved_type: &'a ResolvedType,
    path: &str,
) -> Option<&'a PrimitiveType> {
    let mut segments: Vec<&str> = path.split('.').collect();
    let mut current = resolved_type;
    while let Some(seg) = segments.first().copied() {
        match &current.kind {
            ResolvedTypeKind::Struct { fields, .. } => {
                if let Some(field) = fields.iter().find(|f| f.name == seg) {
                    segments.remove(0);
                    if segments.is_empty() {
                        if let ResolvedTypeKind::Primitive { prim_type } = &field.field_type.kind {
                            return Some(prim_type);
                        }
                        return None;
                    } else {
                        current = &field.field_type;
                        continue;
                    }
                } else {
                    return None;
                }
            }
            _ => return None,
        }
    }
    None
}

pub fn payload_field_offset(resolved_type: &ResolvedType, field_name: &str) -> Option<usize> {
    match &resolved_type.kind {
        ResolvedTypeKind::Struct { fields, .. } => fields
            .iter()
            .find(|field| field.name == field_name)
            .and_then(|field| field.offset)
            .and_then(|offset| usize::try_from(offset).ok()),
        _ => None,
    }
}

pub fn normalize_accessor_path(resolved_type: &ResolvedType, raw_path: &str) -> Option<String> {
    let sanitized = raw_path.replace("::", ".");
    let segments: Vec<&str> = sanitized
        .split('.')
        .filter(|seg| !seg.is_empty() && *seg != "..")
        .collect();
    for drop_prefix in 0..segments.len() {
        let candidate_segments = &segments[drop_prefix..];
        if candidate_segments.is_empty() {
            continue;
        }
        let candidate = candidate_segments.join(".");
        if referenced_field_prim_type(resolved_type, &candidate).is_some() {
            return Some(candidate);
        }
    }
    None
}
