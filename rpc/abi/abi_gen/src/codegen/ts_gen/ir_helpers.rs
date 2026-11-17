use crate::abi::expr::{ExprKind, LiteralExpr};
use crate::abi::resolved::{ResolvedField, ResolvedType, ResolvedTypeKind};
use crate::abi::types::PrimitiveType;
use crate::codegen::shared::ir::{IrNode, SwitchNode, TypeIr};
use std::collections::{BTreeMap, BTreeSet};

pub fn format_ir_parameter_list(type_ir: &TypeIr) -> Vec<String> {
    type_ir
        .parameters
        .iter()
        .map(|param| format!("{}: bigint", sanitize_param_name(&param.name)))
        .collect()
}

pub fn sanitize_param_name(name: &str) -> String {
    name.replace(['.', ':', '-'], "_")
}

#[derive(Clone, Debug)]
pub struct TsParamBinding {
    pub canonical: String,
    pub ts_name: String,
    pub derived: bool,
}

pub fn ts_parameter_bindings(type_ir: &TypeIr) -> Vec<TsParamBinding> {
    type_ir
        .parameters
        .iter()
        .map(|param| TsParamBinding {
            canonical: param.name.clone(),
            /* `__buffer_size` is exposed as `buffer_size` (Rust's name). */
            ts_name: if param.name == "__buffer_size" {
                "buffer_size".to_string()
            } else {
                sanitize_param_name(&param.name)
            },
            derived: param.derived,
        })
        .collect()
}

/* Returns deduplicated parameter bindings for use in Params type generation.
When the IR has both `body.tag` and `StructName::body.tag`, they become
`body_tag` and `StructName__body_tag`. Both resolve to the same byte offset.
This function keeps only the shorter name (the canonical one without the struct prefix).

This is used for the TypeScript Params type and builders, while the full
list from ts_parameter_bindings is used for IR packing which needs all canonical names. */
pub fn deduplicated_ts_parameter_bindings(type_ir: &TypeIr) -> Vec<TsParamBinding> {
    let all_bindings = ts_parameter_bindings(type_ir);

    let mut keep = vec![true; all_bindings.len()];

    for (i, binding_i) in all_bindings.iter().enumerate() {
        if binding_i.derived {
            continue;
        }
        for (j, binding_j) in all_bindings.iter().enumerate() {
            if i == j || binding_j.derived {
                continue;
            }
            /* Check if binding_j's ts_name ends with binding_i's ts_name (with _ separator) */
            let suffix = format!("_{}", binding_i.ts_name);
            if binding_j.ts_name.ends_with(&suffix) {
                /* binding_j is the longer one (has struct prefix), mark it for removal */
                keep[j] = false;
            }
        }
    }

    all_bindings
        .into_iter()
        .enumerate()
        .filter(|(idx, _)| keep[*idx])
        .map(|(_, binding)| binding)
        .collect()
}

/* Returns a mapping from each ts_name to its deduplicated equivalent.
For ts_names that were kept, this maps to itself.
For ts_names that were removed (the longer ones with struct prefix),
this maps to the shorter deduplicated ts_name.

This is used by __tnPackParams to map all canonical names to the correct
params field name in the deduplicated Params type. */
pub fn ts_name_dedup_map(type_ir: &TypeIr) -> BTreeMap<String, String> {
    let all_bindings = ts_parameter_bindings(type_ir);
    let deduplicated = deduplicated_ts_parameter_bindings(type_ir);
    let dedup_ts_names: BTreeSet<String> = deduplicated.iter().map(|b| b.ts_name.clone()).collect();

    let mut map = BTreeMap::new();
    for binding in &all_bindings {
        if binding.derived {
            continue;
        }
        if dedup_ts_names.contains(&binding.ts_name) {
            /* This binding was kept */
            map.insert(binding.ts_name.clone(), binding.ts_name.clone());
        } else {
            /* This binding was removed, find which deduplicated ts_name it maps to */
            for dedup in &deduplicated {
                let suffix = format!("_{}", dedup.ts_name);
                if binding.ts_name.ends_with(&suffix) {
                    map.insert(binding.ts_name.clone(), dedup.ts_name.clone());
                    break;
                }
            }
        }
    }
    map
}

#[derive(Clone, Debug)]
pub struct DerivedParamSpec {
    pub canonical: String,
    pub expr: String,
}

fn literal_to_bigint_string(lit: &LiteralExpr) -> Option<String> {
    match lit {
        LiteralExpr::U64(v) => Some(format!("{v}n")),
        LiteralExpr::U32(v) => Some(format!("{v}n")),
        LiteralExpr::U16(v) => Some(format!("{v}n")),
        LiteralExpr::U8(v) => Some(format!("{v}n")),
        LiteralExpr::I64(v) => Some(format!("{v}n")),
        LiteralExpr::I32(v) => Some(format!("{v}n")),
        LiteralExpr::I16(v) => Some(format!("{v}n")),
        LiteralExpr::I8(v) => Some(format!("{v}n")),
    }
}

fn normalize_field_ref_path(path: &[String]) -> String {
    let joined = path.join(".");
    normalize_binding_path(&joined)
}

/* A derived parameter (a computed enum tag) over params read from the
buffer: checked u64 arithmetic; an overflow becomes 2^64, a tag no variant
has (the IR switch then reports `tn.ir.invalid_tag`). */
fn expr_to_param_expr(expr: &ExprKind, lookup: &BTreeMap<String, String>) -> Option<String> {
    let mut resolver = |path: &[String]| -> Option<String> {
        let normalized = normalize_field_ref_path(path);
        lookup
            .get(&normalized)
            .map(|key| format!("__tnU64(params.{key})"))
    };
    let checked = super::helpers::expr_to_ts_bigint_with_resolver(expr, &mut resolver)?;
    Some(format!("({checked} ?? __tnMeasureLimit)"))
}

fn enum_computed_tag_expr(field: &ResolvedField) -> Option<ExprKind> {
    if let ResolvedTypeKind::Enum { tag_expression, .. } = &field.field_type.kind {
        if matches!(tag_expression, ExprKind::FieldRef(fr) if fr.path.len() == 1) {
            None
        } else {
            Some(tag_expression.clone())
        }
    } else {
        None
    }
}

pub fn derived_param_specs(
    resolved_type: &ResolvedType,
    type_ir: &TypeIr,
) -> Vec<DerivedParamSpec> {
    let derived_names: BTreeSet<String> = type_ir
        .parameters
        .iter()
        .filter(|param| param.derived)
        .map(|param| param.name.clone())
        .collect();
    if derived_names.is_empty() {
        return Vec::new();
    }

    let mut expr_sources = BTreeMap::new();
    if let ResolvedTypeKind::Struct { fields, .. } = &resolved_type.kind {
        for field in fields {
            if let Some(expr) = enum_computed_tag_expr(field) {
                let canonical = format!("{}.computed_tag", field.field_type.name);
                expr_sources.insert(canonical, expr);
            }
            /* An array count the IR cannot express (see
            `IrBuilder::for_typescript`). */
            if let ResolvedTypeKind::Array {
                size_expression, ..
            } = &field.field_type.kind
            {
                expr_sources.insert(
                    format!("{}.computed_size", field.name),
                    size_expression.clone(),
                );
            }
        }
    }

    if expr_sources.is_empty() {
        return Vec::new();
    }

    let mut path_lookup = BTreeMap::new();
    for binding in ts_parameter_bindings(type_ir)
        .into_iter()
        .filter(|binding| !binding.derived)
    {
        insert_param_path_aliases(&mut path_lookup, &binding.canonical, &binding.ts_name);
    }

    derived_names
        .into_iter()
        .filter_map(|name| {
            expr_sources.get(&name).and_then(|expr| {
                expr_to_param_expr(expr, &path_lookup).map(|js| DerivedParamSpec {
                    canonical: name.clone(),
                    expr: js,
                })
            })
        })
        .collect()
}

pub fn normalize_binding_path(path: &str) -> String {
    let mut trimmed = path;
    while let Some(stripped) = trimmed.strip_prefix("../") {
        trimmed = stripped;
    }
    if let Some(stripped) = trimmed.strip_prefix("./") {
        trimmed = stripped;
    }
    let replaced_colons = trimmed.replace("::", ".");
    let replaced_slash = replaced_colons.replace('/', ".");
    replaced_slash.trim_matches('.').to_string()
}

fn insert_param_path_aliases(
    lookup: &mut BTreeMap<String, String>,
    canonical: &str,
    ts_name: &str,
) {
    let normalized = normalize_binding_path(canonical);
    if normalized.is_empty() {
        return;
    }
    let segments: Vec<&str> = normalized
        .split('.')
        .filter(|seg| !seg.is_empty())
        .collect();
    if segments.is_empty() {
        lookup
            .entry(normalized)
            .or_insert_with(|| ts_name.to_string());
        return;
    }
    for idx in 0..segments.len() {
        let suffix = segments[idx..].join(".");
        lookup.entry(suffix).or_insert_with(|| ts_name.to_string());
    }
}

pub fn collect_dynamic_param_bindings(
    resolved_type: &ResolvedType,
) -> BTreeMap<String, DynamicBinding> {
    let mut map = BTreeMap::new();

    /* Helper to check if a field path is within a jagged array */
    let is_jagged_array_element_path = |path: &str| -> bool {
        if !path.contains(".element.") {
            return false;
        }

        /* Extract the array field name (the part before .element.) */
        let segments: Vec<&str> = path.split('.').collect();
        if let Some(element_idx) = segments.iter().position(|&s| s == "element") {
            if element_idx == 0 {
                return false;
            }
            let array_field_name = segments[element_idx - 1];

            /* Check if this field is a jagged array */
            if let ResolvedTypeKind::Struct { fields, .. } = &resolved_type.kind {
                if let Some(field) = fields.iter().find(|f| f.name == array_field_name) {
                    if let ResolvedTypeKind::Array { jagged, .. } = &field.field_type.kind {
                        return *jagged;
                    }
                }
            }
        }
        false
    };

    for refs in resolved_type.dynamic_params.values() {
        for (path, prim_type) in refs {
            let normalized_path = if let Some(stripped) = path.strip_prefix("_typeref_") {
                stripped.to_string()
            } else {
                path.clone()
            };

            /* Skip bindings for fields within jagged array elements - they require sequential access */
            if is_jagged_array_element_path(&normalized_path) {
                continue;
            }

            let key = sanitize_param_name(&normalized_path);
            let binding = DynamicBinding {
                path: normalized_path.clone(),
                prim_type: prim_type.clone(),
            };
            map.entry(key.clone()).or_insert_with(|| binding.clone());

            /* Also expose suffix aliases for inline/nested structs so IR parameters like
            `data.count` resolve to the same binding as `nested.data.count`. */
            let segments: Vec<&str> = normalized_path.split('.').collect();
            if segments.len() > 1 {
                for idx in 1..segments.len() {
                    let suffix = segments[idx..].join(".");
                    let alias_key = sanitize_param_name(&suffix);
                    if alias_key != key {
                        let alias_binding = DynamicBinding {
                            path: suffix.clone(),
                            prim_type: prim_type.clone(),
                        };
                        map.entry(alias_key)
                            .or_insert_with(|| alias_binding.clone());
                    }
                }
            }
        }
    }
    map
}

/* Whether a struct's `__tnExtractParams` reads anything: resolver-level
dynamic bindings or payload sizes measured by the sequential scan. */
pub fn extractor_emitted(resolved_type: &ResolvedType, type_ir: &TypeIr) -> bool {
    !collect_dynamic_param_bindings(resolved_type).is_empty()
        || type_ir.parameters.iter().any(|param| {
            !param.derived
                && (param.name.ends_with(".payload_size")
                    || param.name == "__buffer_size"
                    || names_type_ref_field(resolved_type, &param.name))
        })
}

/* `<field>.<path>` with `field` a type-ref: a named type's outside reference
bound to this struct (see `IrBuilder::bind_context_args`). */
fn names_type_ref_field(resolved_type: &ResolvedType, param: &str) -> bool {
    let ResolvedTypeKind::Struct { fields, .. } = &resolved_type.kind else {
        return false;
    };
    let Some((head, _)) = param.split_once('.') else {
        return false;
    };
    fields
        .iter()
        .any(|f| f.name == head && matches!(f.field_type.kind, ResolvedTypeKind::TypeRef { .. }))
}

pub fn resolve_param_binding<'a>(ir_param: &str, available: &'a [String]) -> Option<&'a String> {
    if let Some(exact) = available
        .iter()
        .find(|candidate| candidate.as_str() == ir_param)
    {
        return Some(exact);
    }
    /* Prefer the longest suffix: `hdr_data_sz` must win over its alias `data_sz`,
    whose binding path has lost the `hdr.` prefix. */
    available
        .iter()
        .filter(|candidate| {
            if ir_param.len() <= candidate.len() {
                return false;
            }
            if !ir_param.ends_with(candidate.as_str()) {
                return false;
            }
            ir_param
                .as_bytes()
                .get(ir_param.len() - candidate.len() - 1)
                .map(|b| *b == b'_')
                .unwrap_or(false)
        })
        .max_by_key(|candidate| candidate.len())
}

#[derive(Clone)]
pub struct DynamicBinding {
    pub path: String,
    pub prim_type: PrimitiveType,
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

pub fn expression_is_const(node: &IrNode) -> bool {
    matches!(node, IrNode::Const(_) | IrNode::ZeroSize { .. })
}

pub fn switch_node_has_default(node: &SwitchNode) -> bool {
    node.default.is_some()
}
