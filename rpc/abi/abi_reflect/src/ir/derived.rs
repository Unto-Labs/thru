/* Derived IR parameters the layout IR reads but nothing in the buffer holds
 * directly: the tag of an enum whose `tag-ref` is a computed expression
 * (`<enum>.computed_tag`). The interpreter evaluates them from the type's
 * other parameters, as the TypeScript backend's derived parameters do, with
 * the parser's u64 tag arithmetic so both pick the same variant. */

use super::ParamMap;
use crate::errors::{ReflectError, ReflectResult};
use crate::parser::normalize_param_alias;
use abi_gen::abi::expr::{ExprKind, LiteralExpr};
use abi_gen::abi::resolved::{ResolvedType, ResolvedTypeKind, Size, TypeResolver};
use abi_gen::codegen::shared::ir::{LayoutIr, TypeIr};
use std::collections::BTreeMap;

/// Derived parameters per type name: (parameter name, expression computing it).
pub type DerivedParams = BTreeMap<String, Vec<(String, DerivedExpr)>>;

/// A computed tag expression over a type's parameters. It covers every
/// operator the parser evaluates in a tag (`ParseError` otherwise), so a tag
/// the parser can decode is never left missing.
#[derive(Debug, Clone)]
pub enum DerivedExpr {
    Const(u64),
    Param(String),
    Binary(DerivedOp, Box<DerivedExpr>, Box<DerivedExpr>),
    BitNot(Box<DerivedExpr>),
    Popcount(Box<DerivedExpr>),
}

#[derive(Debug, Clone, Copy)]
pub enum DerivedOp {
    Add,
    Sub,
    Mul,
    Div,
    Mod,
    BitAnd,
    BitOr,
    BitXor,
    LeftShift,
    RightShift,
}

impl DerivedExpr {
    /// Evaluate in u64 with the parser's checks (overflow, division by zero
    /// and shifts of 64 or more are errors).
    pub fn eval(&self, params: &ParamMap, type_name: &str) -> ReflectResult<u64> {
        let overflow = |op: &'static str| ReflectError::ArithmeticOverflow {
            type_name: type_name.to_string(),
            op,
        };
        Ok(match self {
            DerivedExpr::Const(value) => *value,
            DerivedExpr::Param(name) => {
                let value =
                    params
                        .get(name)
                        .copied()
                        .ok_or_else(|| ReflectError::MissingIrParameter {
                            type_name: type_name.to_string(),
                            parameter: name.clone(),
                        })?;
                u64::try_from(value).map_err(|_| overflow("tag conversion"))?
            }
            DerivedExpr::BitNot(operand) => !operand.eval(params, type_name)?,
            DerivedExpr::Popcount(operand) => operand.eval(params, type_name)?.count_ones() as u64,
            DerivedExpr::Binary(op, left, right) => {
                let l = left.eval(params, type_name)?;
                let r = right.eval(params, type_name)?;
                let shift = |r: u64| u32::try_from(r).ok().filter(|r| *r < 64);
                match op {
                    DerivedOp::Add => l.checked_add(r).ok_or_else(|| overflow("addition"))?,
                    DerivedOp::Sub => l.checked_sub(r).ok_or_else(|| overflow("subtraction"))?,
                    DerivedOp::Mul => l.checked_mul(r).ok_or_else(|| overflow("multiplication"))?,
                    DerivedOp::Div => l.checked_div(r).ok_or_else(|| overflow("division"))?,
                    DerivedOp::Mod => l.checked_rem(r).ok_or_else(|| overflow("modulo"))?,
                    DerivedOp::BitAnd => l & r,
                    DerivedOp::BitOr => l | r,
                    DerivedOp::BitXor => l ^ r,
                    DerivedOp::LeftShift => l << shift(r).ok_or_else(|| overflow("left shift"))?,
                    DerivedOp::RightShift => {
                        l >> shift(r).ok_or_else(|| overflow("right shift"))?
                    }
                }
            }
        })
    }
}

const COMPUTED_TAG_SUFFIX: &str = ".computed_tag";

/// Build the derived-parameter expressions for every type in the layout IR.
pub fn build_derived_params(resolver: &TypeResolver, layout_ir: &LayoutIr) -> DerivedParams {
    let mut out = DerivedParams::new();
    for type_ir in &layout_ir.types {
        let wanted: Vec<&str> = type_ir
            .parameters
            .iter()
            .filter(|param| param.derived && param.name.ends_with(COMPUTED_TAG_SUFFIX))
            .map(|param| param.name.as_str())
            .collect();
        if wanted.is_empty() {
            continue;
        }
        let Some(resolved) = resolver.get_type_info(&type_ir.type_name) else {
            continue;
        };
        let mut tags = BTreeMap::new();
        collect_computed_tags(resolved, &mut tags);
        let aliases = param_aliases(type_ir);
        let mut specs = Vec::new();
        for name in wanted {
            let enum_name = &name[..name.len() - COMPUTED_TAG_SUFFIX.len()];
            let Some(expr) = tags.get(enum_name) else {
                continue;
            };
            if let Some(derived) = to_derived(expr, &aliases, resolver) {
                specs.push((name.to_string(), derived));
            }
        }
        if !specs.is_empty() {
            out.insert(type_ir.type_name.clone(), specs);
        }
    }
    out
}

/* Inline enums (not behind a type reference) whose tag is computed. */
fn collect_computed_tags<'a>(ty: &'a ResolvedType, out: &mut BTreeMap<String, &'a ExprKind>) {
    match &ty.kind {
        ResolvedTypeKind::Struct { fields, .. } | ResolvedTypeKind::Union { variants: fields } => {
            for field in fields {
                collect_computed_tags(&field.field_type, out);
            }
        }
        ResolvedTypeKind::Enum {
            tag_expression,
            variants,
            ..
        } => {
            if !matches!(tag_expression, ExprKind::FieldRef(_)) {
                out.insert(ty.name.clone(), tag_expression);
            }
            for variant in variants {
                collect_computed_tags(&variant.variant_type, out);
            }
        }
        ResolvedTypeKind::Array { element_type, .. } => collect_computed_tags(element_type, out),
        ResolvedTypeKind::SizeDiscriminatedUnion { variants } => {
            for variant in variants {
                collect_computed_tags(&variant.variant_type, out);
            }
        }
        ResolvedTypeKind::Primitive { .. } | ResolvedTypeKind::TypeRef { .. } => {}
    }
}

/* Every dotted suffix of each non-derived parameter, mapped to the parameter
 * (the first parameter wins), so `["a"]` finds `body.a`. */
fn param_aliases(type_ir: &TypeIr) -> BTreeMap<String, String> {
    let mut map = BTreeMap::new();
    for param in type_ir.parameters.iter().filter(|param| !param.derived) {
        let normalized = normalize_param_alias(&param.name);
        let segments: Vec<&str> = normalized.split('.').collect();
        for idx in 0..segments.len() {
            map.entry(segments[idx..].join("."))
                .or_insert_with(|| param.name.clone());
        }
    }
    map
}

/* The expression over the type's parameters, or None if it uses an operator
 * the parser cannot evaluate in a tag either (the parameter then stays
 * missing, and the parser reports the operator). */
fn to_derived(
    expr: &ExprKind,
    aliases: &BTreeMap<String, String>,
    resolver: &TypeResolver,
) -> Option<DerivedExpr> {
    let binary = |op: DerivedOp, left: &ExprKind, right: &ExprKind| -> Option<DerivedExpr> {
        Some(DerivedExpr::Binary(
            op,
            Box::new(to_derived(left, aliases, resolver)?),
            Box::new(to_derived(right, aliases, resolver)?),
        ))
    };
    if let Some(value) = expr.try_evaluate_constant() {
        return Some(DerivedExpr::Const(value));
    }
    match expr {
        ExprKind::Literal(literal) => Some(DerivedExpr::Const(match literal {
            LiteralExpr::U64(v) => *v,
            LiteralExpr::U32(v) => *v as u64,
            LiteralExpr::U16(v) => *v as u64,
            LiteralExpr::U8(v) => *v as u64,
            LiteralExpr::I64(v) => u64::try_from(*v).ok()?,
            LiteralExpr::I32(v) => u64::try_from(*v).ok()?,
            LiteralExpr::I16(v) => u64::try_from(*v).ok()?,
            LiteralExpr::I8(v) => u64::try_from(*v).ok()?,
        })),
        ExprKind::FieldRef(field_ref) => Some(DerivedExpr::Param(
            aliases
                .get(&normalize_param_alias(&field_ref.path.join(".")))?
                .clone(),
        )),
        ExprKind::Sizeof(sizeof) => match resolver.get_type_info(&sizeof.type_name)?.size {
            Size::Const(size) => Some(DerivedExpr::Const(size)),
            Size::Variable(_) => None,
        },
        ExprKind::Alignof(alignof) => Some(DerivedExpr::Const(
            resolver.get_type_info(&alignof.type_name)?.alignment,
        )),
        ExprKind::Add(e) => binary(DerivedOp::Add, &e.left, &e.right),
        ExprKind::Sub(e) => binary(DerivedOp::Sub, &e.left, &e.right),
        ExprKind::Mul(e) => binary(DerivedOp::Mul, &e.left, &e.right),
        ExprKind::Div(e) => binary(DerivedOp::Div, &e.left, &e.right),
        ExprKind::Mod(e) => binary(DerivedOp::Mod, &e.left, &e.right),
        ExprKind::BitAnd(e) => binary(DerivedOp::BitAnd, &e.left, &e.right),
        ExprKind::BitOr(e) => binary(DerivedOp::BitOr, &e.left, &e.right),
        ExprKind::BitXor(e) => binary(DerivedOp::BitXor, &e.left, &e.right),
        ExprKind::LeftShift(e) => binary(DerivedOp::LeftShift, &e.left, &e.right),
        ExprKind::RightShift(e) => binary(DerivedOp::RightShift, &e.left, &e.right),
        ExprKind::BitNot(e) => Some(DerivedExpr::BitNot(Box::new(to_derived(
            &e.operand, aliases, resolver,
        )?))),
        ExprKind::Popcount(e) => Some(DerivedExpr::Popcount(Box::new(to_derived(
            &e.operand, aliases, resolver,
        )?))),
        _ => None,
    }
}
