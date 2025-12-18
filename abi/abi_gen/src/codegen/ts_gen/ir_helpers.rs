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
            ts_name: sanitize_param_name(&param.name),
            derived: param.derived,
        })
        .collect()
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

fn expr_to_param_expr(expr: &ExprKind, lookup: &BTreeMap<String, String>) -> Option<String> {
    match expr {
        ExprKind::Literal(lit) => literal_to_bigint_string(lit),
        ExprKind::FieldRef(field_ref) => {
            let normalized = normalize_field_ref_path(&field_ref.path);
            let key = lookup.get(&normalized)?;
            Some(format!("params.{}", key))
        }
        ExprKind::Add(e) => Some(format!(
            "({} + {})",
            expr_to_param_expr(&e.left, lookup)?,
            expr_to_param_expr(&e.right, lookup)?
        )),
        ExprKind::Sub(e) => Some(format!(
            "({} - {})",
            expr_to_param_expr(&e.left, lookup)?,
            expr_to_param_expr(&e.right, lookup)?
        )),
        ExprKind::Mul(e) => Some(format!(
            "({} * {})",
            expr_to_param_expr(&e.left, lookup)?,
            expr_to_param_expr(&e.right, lookup)?
        )),
        ExprKind::Div(e) => Some(format!(
            "({} / {})",
            expr_to_param_expr(&e.left, lookup)?,
            expr_to_param_expr(&e.right, lookup)?
        )),
        ExprKind::Mod(e) => Some(format!(
            "({} % {})",
            expr_to_param_expr(&e.left, lookup)?,
            expr_to_param_expr(&e.right, lookup)?
        )),
        ExprKind::BitAnd(e) => Some(format!(
            "({} & {})",
            expr_to_param_expr(&e.left, lookup)?,
            expr_to_param_expr(&e.right, lookup)?
        )),
        ExprKind::BitOr(e) => Some(format!(
            "({} | {})",
            expr_to_param_expr(&e.left, lookup)?,
            expr_to_param_expr(&e.right, lookup)?
        )),
        ExprKind::BitXor(e) => Some(format!(
            "({} ^ {})",
            expr_to_param_expr(&e.left, lookup)?,
            expr_to_param_expr(&e.right, lookup)?
        )),
        ExprKind::LeftShift(e) => Some(format!(
            "({} << {})",
            expr_to_param_expr(&e.left, lookup)?,
            expr_to_param_expr(&e.right, lookup)?
        )),
        ExprKind::RightShift(e) => Some(format!(
            "({} >> {})",
            expr_to_param_expr(&e.left, lookup)?,
            expr_to_param_expr(&e.right, lookup)?
        )),
        ExprKind::BitNot(e) => Some(format!("(~({}))", expr_to_param_expr(&e.operand, lookup)?)),
        ExprKind::Neg(e) => Some(format!("(-({}))", expr_to_param_expr(&e.operand, lookup)?)),
        ExprKind::Popcount(e) => Some(format!(
            "BigInt(__tnPopcount({}))",
            expr_to_param_expr(&e.operand, lookup)?
        )),
        _ => None,
    }
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
    for refs in resolved_type.dynamic_params.values() {
        for (path, prim_type) in refs {
            let normalized_path = if let Some(stripped) = path.strip_prefix("_typeref_") {
                stripped.to_string()
            } else {
                path.clone()
            };
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

pub fn resolve_param_binding<'a>(ir_param: &str, available: &'a [String]) -> Option<&'a String> {
    if let Some(exact) = available
        .iter()
        .find(|candidate| candidate.as_str() == ir_param)
    {
        return Some(exact);
    }
    available.iter().find(|candidate| {
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
