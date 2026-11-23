/* Param cache utilities for Rust codegen.
Mirrors the TypeScript sequential extractor: walks a buffer with a mutable
cursor, records offsets for dynamic fields, evaluates tag/size expressions,
and emits derived params (computed tags). */

use crate::abi::expr::{ExprKind, FieldRefExpr, LiteralExpr};
use crate::abi::resolved::{
    ConstantStatus, ResolvedEnumVariant, ResolvedField, ResolvedSizeDiscriminatedVariant,
    ResolvedType, ResolvedTypeKind, Size,
};
use crate::abi::types::PrimitiveType;
use std::collections::{BTreeMap, HashMap, HashSet};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParamEvalError {
    MissingParam(String),
    UnsupportedExpr,
    DivisionByZero,
    Overflow,
    BufferTooSmall,
    UnknownType(String),
    UnknownVariant(String),
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct ParamContext {
    /* Stores fully-qualified field refs like "hdr.bytes.0" -> value */
    values: BTreeMap<String, u64>,
}

impl ParamContext {
    pub fn new() -> Self {
        Self {
            values: BTreeMap::new(),
        }
    }

    pub fn insert(&mut self, path: impl Into<String>, value: u64) {
        self.values.insert(path.into(), value);
    }

    pub fn get(&self, path: &str) -> Option<u64> {
        self.values.get(path).copied()
    }
}

#[derive(Debug, Default, Clone, PartialEq, Eq)]
pub struct ParamCache {
    pub params: ParamContext,
    pub offsets: BTreeMap<String, u64>,
    pub derived: BTreeMap<String, u64>,
}

struct ScanState<'a> {
    buf: &'a [u8],
    cursor: u64,
    ctx: ParamContext,
    offsets: BTreeMap<String, u64>,
    derived: BTreeMap<String, u64>,
    record_offsets: HashSet<String>,
    type_lookup: &'a BTreeMap<String, ResolvedType>,
}

impl<'a> ScanState<'a> {
    fn new(
        buf: &'a [u8],
        type_lookup: &'a BTreeMap<String, ResolvedType>,
        record_offsets: &[String],
    ) -> Self {
        Self {
            buf,
            cursor: 0,
            ctx: ParamContext::new(),
            offsets: BTreeMap::new(),
            derived: BTreeMap::new(),
            record_offsets: record_offsets.iter().cloned().collect(),
            type_lookup,
        }
    }
}

fn ensure_remaining(state: &ScanState<'_>, needed: u64) -> Result<(), ParamEvalError> {
    if state
        .cursor
        .checked_add(needed)
        .filter(|v| *v <= state.buf.len() as u64)
        .is_none()
    {
        return Err(ParamEvalError::BufferTooSmall);
    }
    Ok(())
}

fn parent_path(path: &str) -> &str {
    path.rsplit_once('.').map(|(head, _)| head).unwrap_or("")
}

fn eval_expr_scoped(
    expr: &ExprKind,
    ctx: &ParamContext,
    scope: &str,
) -> Result<u64, ParamEvalError> {
    match eval_expr(expr, ctx) {
        Ok(v) => Ok(v),
        Err(ParamEvalError::MissingParam(missing)) => {
            if scope.is_empty() {
                Err(ParamEvalError::MissingParam(missing))
            } else {
                let scoped = format!("{}.{}", scope, missing);
                ctx.get(&scoped)
                    .ok_or_else(|| ParamEvalError::MissingParam(missing))
            }
        }
        Err(e) => Err(e),
    }
}

fn align_cursor(state: &mut ScanState<'_>, align: u64) -> Result<(), ParamEvalError> {
    if align <= 1 {
        return Ok(());
    }
    let misalignment = state.cursor % align;
    if misalignment != 0 {
        let bump = align - misalignment;
        ensure_remaining(state, bump)?;
        state.cursor += bump;
    }
    Ok(())
}

fn record_offset_if_requested(state: &mut ScanState<'_>, path: &str) {
    if state.record_offsets.contains(path) {
        state
            .offsets
            .entry(path.to_string())
            .or_insert(state.cursor);
    }
}

fn read_primitive_at(
    state: &mut ScanState<'_>,
    prim: &PrimitiveType,
) -> Result<u64, ParamEvalError> {
    match prim {
        PrimitiveType::Integral(i) => match i {
            crate::abi::types::IntegralType::U8 | crate::abi::types::IntegralType::Char => {
                ensure_remaining(state, 1)?;
                let b = *state
                    .buf
                    .get(state.cursor as usize)
                    .ok_or(ParamEvalError::BufferTooSmall)?;
                state.cursor += 1;
                Ok(b as u64)
            }
            crate::abi::types::IntegralType::I8 => {
                ensure_remaining(state, 1)?;
                let b = *state
                    .buf
                    .get(state.cursor as usize)
                    .ok_or(ParamEvalError::BufferTooSmall)?;
                state.cursor += 1;
                Ok(b as i8 as i64 as u64)
            }
            crate::abi::types::IntegralType::U16 => {
                ensure_remaining(state, 2)?;
                let off = state.cursor as usize;
                let bytes = state
                    .buf
                    .get(off..off + 2)
                    .ok_or(ParamEvalError::BufferTooSmall)?;
                state.cursor += 2;
                Ok(u16::from_le_bytes([bytes[0], bytes[1]]) as u64)
            }
            crate::abi::types::IntegralType::I16 => {
                ensure_remaining(state, 2)?;
                let off = state.cursor as usize;
                let bytes = state
                    .buf
                    .get(off..off + 2)
                    .ok_or(ParamEvalError::BufferTooSmall)?;
                state.cursor += 2;
                Ok(i16::from_le_bytes([bytes[0], bytes[1]]) as i64 as u64)
            }
            crate::abi::types::IntegralType::U32 => {
                ensure_remaining(state, 4)?;
                let off = state.cursor as usize;
                let bytes = state
                    .buf
                    .get(off..off + 4)
                    .ok_or(ParamEvalError::BufferTooSmall)?;
                state.cursor += 4;
                Ok(u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as u64)
            }
            crate::abi::types::IntegralType::I32 => {
                ensure_remaining(state, 4)?;
                let off = state.cursor as usize;
                let bytes = state
                    .buf
                    .get(off..off + 4)
                    .ok_or(ParamEvalError::BufferTooSmall)?;
                state.cursor += 4;
                Ok(i32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as i64 as u64)
            }
            crate::abi::types::IntegralType::U64 => {
                ensure_remaining(state, 8)?;
                let off = state.cursor as usize;
                let bytes = state
                    .buf
                    .get(off..off + 8)
                    .ok_or(ParamEvalError::BufferTooSmall)?;
                state.cursor += 8;
                Ok(u64::from_le_bytes([
                    bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
                ]))
            }
            crate::abi::types::IntegralType::I64 => {
                ensure_remaining(state, 8)?;
                let off = state.cursor as usize;
                let bytes = state
                    .buf
                    .get(off..off + 8)
                    .ok_or(ParamEvalError::BufferTooSmall)?;
                state.cursor += 8;
                Ok(i64::from_le_bytes([
                    bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
                ]) as u64)
            }
        },
        PrimitiveType::FloatingPoint(f) => match f {
            crate::abi::types::FloatingPointType::F16 => Err(ParamEvalError::UnsupportedExpr),
            crate::abi::types::FloatingPointType::F32 => {
                ensure_remaining(state, 4)?;
                let off = state.cursor as usize;
                let bytes = state
                    .buf
                    .get(off..off + 4)
                    .ok_or(ParamEvalError::BufferTooSmall)?;
                state.cursor += 4;
                Ok(f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as f64 as u64)
            }
            crate::abi::types::FloatingPointType::F64 => {
                ensure_remaining(state, 8)?;
                let off = state.cursor as usize;
                let bytes = state
                    .buf
                    .get(off..off + 8)
                    .ok_or(ParamEvalError::BufferTooSmall)?;
                state.cursor += 8;
                Ok(f64::from_le_bytes([
                    bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
                ]) as u64)
            }
        },
    }
}

pub fn eval_expr(expr: &ExprKind, ctx: &ParamContext) -> Result<u64, ParamEvalError> {
    match expr {
        ExprKind::Literal(lit) => Ok(match lit {
            LiteralExpr::U8(v) => *v as u64,
            LiteralExpr::U16(v) => *v as u64,
            LiteralExpr::U32(v) => *v as u64,
            LiteralExpr::U64(v) => *v,
            LiteralExpr::I8(v) => *v as i64 as u64,
            LiteralExpr::I16(v) => *v as i64 as u64,
            LiteralExpr::I32(v) => *v as i64 as u64,
            LiteralExpr::I64(v) => *v as u64,
        }),
        ExprKind::FieldRef(FieldRefExpr { path }) => {
            let joined = path.join(".");
            ctx.get(&joined)
                .ok_or_else(|| ParamEvalError::MissingParam(joined))
        }
        ExprKind::Add(e) => {
            let l = eval_expr(&e.left, ctx)?;
            let r = eval_expr(&e.right, ctx)?;
            l.checked_add(r).ok_or(ParamEvalError::Overflow)
        }
        ExprKind::Sub(e) => {
            let l = eval_expr(&e.left, ctx)?;
            let r = eval_expr(&e.right, ctx)?;
            l.checked_sub(r).ok_or(ParamEvalError::Overflow)
        }
        ExprKind::Mul(e) => {
            let l = eval_expr(&e.left, ctx)?;
            let r = eval_expr(&e.right, ctx)?;
            l.checked_mul(r).ok_or(ParamEvalError::Overflow)
        }
        ExprKind::Div(e) => {
            let l = eval_expr(&e.left, ctx)?;
            let r = eval_expr(&e.right, ctx)?;
            if r == 0 {
                Err(ParamEvalError::DivisionByZero)
            } else {
                Ok(l / r)
            }
        }
        ExprKind::BitAnd(e) => {
            let l = eval_expr(&e.left, ctx)?;
            let r = eval_expr(&e.right, ctx)?;
            Ok(l & r)
        }
        ExprKind::BitOr(e) => {
            let l = eval_expr(&e.left, ctx)?;
            let r = eval_expr(&e.right, ctx)?;
            Ok(l | r)
        }
        ExprKind::BitXor(e) => {
            let l = eval_expr(&e.left, ctx)?;
            let r = eval_expr(&e.right, ctx)?;
            Ok(l ^ r)
        }
        ExprKind::Popcount(pop) => {
            let v = eval_expr(&pop.operand, ctx)?;
            Ok(v.count_ones() as u64)
        }
        _ => Err(ParamEvalError::UnsupportedExpr),
    }
}

fn scan_enum_variant(
    state: &mut ScanState<'_>,
    variant: &ResolvedEnumVariant,
    variant_path: &str,
    base_align: u64,
) -> Result<(), ParamEvalError> {
    if let ResolvedTypeKind::Struct { packed, .. } = &variant.variant_type.kind {
        if !*packed {
            align_cursor(state, base_align)?;
        }
    }
    let payload_start = state.cursor;
    scan_type(state, &variant.variant_type, variant_path)?;
    if variant.requires_payload_size {
        let payload_size = state
            .cursor
            .checked_sub(payload_start)
            .ok_or(ParamEvalError::Overflow)?;
        state
            .ctx
            .insert(format!("{}.payload_size", variant_path), payload_size);
    }
    Ok(())
}

fn scan_size_discriminated_union(
    state: &mut ScanState<'_>,
    field_path: &str,
    variants: &[ResolvedSizeDiscriminatedVariant],
) -> Result<(), ParamEvalError> {
    let remaining = (state.buf.len() as u64)
        .checked_sub(state.cursor)
        .ok_or(ParamEvalError::Overflow)?;
    for variant in variants {
        if variant.expected_size != remaining {
            continue;
        }
        let payload_start = state.cursor;
        scan_type(
            state,
            &variant.variant_type,
            &format!("{}.{}", field_path, variant.name),
        )?;
        let target = payload_start
            .checked_add(variant.expected_size)
            .ok_or(ParamEvalError::Overflow)?;
        if target > state.buf.len() as u64 {
            return Err(ParamEvalError::BufferTooSmall);
        }
        state.cursor = target;
        state.ctx.insert(
            format!("{}.payload_size", field_path),
            variant.expected_size,
        );
        return Ok(());
    }
    Err(ParamEvalError::MissingParam(format!(
        "no SDU variant matched remaining size {} for {}",
        remaining, field_path
    )))
}

fn scan_array(
    state: &mut ScanState<'_>,
    element_type: &ResolvedType,
    count_expr: &ExprKind,
    count_status: &ConstantStatus,
    field_path: &str,
) -> Result<(), ParamEvalError> {
    let scope = parent_path(field_path);
    let count = match (count_status, count_expr) {
        (ConstantStatus::Constant, ExprKind::Literal(LiteralExpr::U64(n))) => *n,
        _ => eval_expr_scoped(count_expr, &state.ctx, scope)?,
    };
    for idx in 0..count {
        let elem_path = format!("{}.{}", field_path, idx);
        scan_type(state, element_type, &elem_path)?;
    }
    Ok(())
}

fn scan_struct(
    state: &mut ScanState<'_>,
    fields: &[ResolvedField],
    packed: bool,
    base_path: &str,
) -> Result<(), ParamEvalError> {
    for field in fields {
        let field_path = if base_path.is_empty() {
            field.name.clone()
        } else {
            format!("{}.{}", base_path, field.name)
        };

        if let Some(off) = field.offset {
            if off > state.cursor {
                ensure_remaining(state, off - state.cursor)?;
                state.cursor = off;
            }
        }

        if !packed {
            align_cursor(state, field.field_type.alignment.max(1))?;
        }
        record_offset_if_requested(state, &field_path);

        match &field.field_type.kind {
            ResolvedTypeKind::Primitive { prim_type } => {
                let val = read_primitive_at(state, prim_type)?;
                state.ctx.insert(field_path, val);
            }
            ResolvedTypeKind::Enum {
                tag_expression,
                variants,
                ..
            } => {
                let tag = eval_expr_scoped(tag_expression, &state.ctx, base_path)?;
                state.derived.insert(format!("{}.tag", field_path), tag);
                let mut matched = false;
                for variant in variants {
                    if variant.tag_value == tag {
                        matched = true;
                        scan_enum_variant(
                            state,
                            variant,
                            &format!("{}.{}", field_path, variant.name),
                            field.field_type.alignment,
                        )?;
                        break;
                    }
                }
                if !matched {
                    return Err(ParamEvalError::UnknownVariant(format!(
                        "enum tag {} not found for {}",
                        tag, field_path
                    )));
                }
            }
            ResolvedTypeKind::Union { variants } => {
                let tag_key = format!("{}._union_tag", field_path);
                let tag_val = state
                    .ctx
                    .get(&tag_key)
                    .or_else(|| state.derived.get(&tag_key).copied())
                    .ok_or_else(|| ParamEvalError::MissingParam(tag_key.clone()))?;
                let idx = tag_val as usize;
                let variant = variants
                    .get(idx)
                    .ok_or_else(|| ParamEvalError::UnknownVariant(field_path.clone()))?;
                scan_type(
                    state,
                    &variant.field_type,
                    &format!("{}.{}", field_path, variant.name),
                )?;
            }
            ResolvedTypeKind::Array {
                element_type,
                size_expression,
                size_constant_status,
                ..
            } => {
                scan_array(
                    state,
                    element_type,
                    size_expression,
                    size_constant_status,
                    &field_path,
                )?;
            }
            ResolvedTypeKind::Struct {
                fields: inner,
                packed,
                ..
            } => {
                scan_struct(state, inner, *packed, &field_path)?;
            }
            ResolvedTypeKind::SizeDiscriminatedUnion { variants } => {
                scan_size_discriminated_union(state, &field_path, variants)?;
            }
            ResolvedTypeKind::TypeRef { target_name, .. } => {
                let target = state
                    .type_lookup
                    .get(target_name)
                    .ok_or_else(|| ParamEvalError::UnknownType(target_name.clone()))?;
                scan_type(state, target, &field_path)?;
            }
        }
    }
    Ok(())
}

fn scan_type(
    state: &mut ScanState<'_>,
    ty: &ResolvedType,
    base_path: &str,
) -> Result<(), ParamEvalError> {
    match &ty.kind {
        ResolvedTypeKind::Primitive { prim_type } => {
            let val = read_primitive_at(state, prim_type)?;
            state.ctx.insert(base_path.to_string(), val);
        }
        ResolvedTypeKind::Struct { fields, packed, .. } => {
            scan_struct(state, fields, *packed, base_path)?;
        }
        ResolvedTypeKind::Enum {
            tag_expression,
            variants,
            ..
        } => {
            let tag = eval_expr_scoped(tag_expression, &state.ctx, parent_path(base_path))?;
            state.derived.insert(format!("{}.tag", base_path), tag);
            let mut matched = false;
            for variant in variants {
                if variant.tag_value == tag {
                    matched = true;
                    scan_enum_variant(
                        state,
                        variant,
                        &format!("{}.{}", base_path, variant.name),
                        ty.alignment,
                    )?;
                    break;
                }
            }
            if !matched {
                return Err(ParamEvalError::UnknownVariant(format!(
                    "enum tag {} not found for {}",
                    tag, base_path
                )));
            }
        }
        ResolvedTypeKind::Union { variants } => {
            let tag_key = format!("{}._union_tag", base_path);
            let tag_val = state
                .ctx
                .get(&tag_key)
                .or_else(|| state.derived.get(&tag_key).copied())
                .ok_or_else(|| ParamEvalError::MissingParam(tag_key.clone()))?;
            let idx = tag_val as usize;
            let variant = variants
                .get(idx)
                .ok_or_else(|| ParamEvalError::UnknownVariant(base_path.to_string()))?;
            scan_type(
                state,
                &variant.field_type,
                &format!("{}.{}", base_path, variant.name),
            )?;
        }
        ResolvedTypeKind::Array {
            element_type,
            size_expression,
            size_constant_status,
            ..
        } => {
            scan_array(
                state,
                element_type,
                size_expression,
                size_constant_status,
                base_path,
            )?;
        }
        ResolvedTypeKind::SizeDiscriminatedUnion { variants } => {
            scan_size_discriminated_union(state, base_path, variants)?;
        }
        ResolvedTypeKind::TypeRef { target_name, .. } => {
            let target = state
                .type_lookup
                .get(target_name)
                .ok_or_else(|| ParamEvalError::UnknownType(target_name.clone()))?;
            scan_type(state, target, base_path)?;
        }
    }
    Ok(())
}

pub fn extract_param_cache(
    resolved_type: &ResolvedType,
    buf: &[u8],
    type_lookup: &BTreeMap<String, ResolvedType>,
    dynamic_fields: &[String],
) -> Result<ParamCache, ParamEvalError> {
    let mut state = ScanState::new(buf, type_lookup, dynamic_fields);
    scan_type(&mut state, resolved_type, "")?;
    Ok(ParamCache {
        params: state.ctx,
        offsets: state.offsets,
        derived: state.derived,
    })
}

pub fn extract_params(ty: &ResolvedTypeKind, buf: &[u8]) -> Result<ParamContext, ParamEvalError> {
    let resolved = ResolvedType {
        name: "".into(),
        size: Size::Variable(HashMap::new()),
        alignment: 1,
        comment: None,
        dynamic_params: BTreeMap::new(),
        kind: ty.clone(),
    };
    let cache = extract_param_cache(&resolved, buf, &BTreeMap::new(), &[])?;
    Ok(cache.params)
}

fn static_size_of_primitive(prim: &PrimitiveType) -> Option<u64> {
    match prim {
        PrimitiveType::Integral(i) => Some(match i {
            crate::abi::types::IntegralType::U8
            | crate::abi::types::IntegralType::I8
            | crate::abi::types::IntegralType::Char => 1,
            crate::abi::types::IntegralType::U16 | crate::abi::types::IntegralType::I16 => 2,
            crate::abi::types::IntegralType::U32 | crate::abi::types::IntegralType::I32 => 4,
            crate::abi::types::IntegralType::U64 | crate::abi::types::IntegralType::I64 => 8,
        }),
        PrimitiveType::FloatingPoint(f) => Some(match f {
            crate::abi::types::FloatingPointType::F16 => 2,
            crate::abi::types::FloatingPointType::F32 => 4,
            crate::abi::types::FloatingPointType::F64 => 8,
        }),
    }
}

fn static_size_of_resolved_type(kind: &ResolvedTypeKind) -> Option<u64> {
    match kind {
        ResolvedTypeKind::Primitive { prim_type } => static_size_of_primitive(prim_type),
        ResolvedTypeKind::Array {
            element_type,
            size_expression,
            size_constant_status,
            ..
        } => match (
            static_size_of_resolved_type(&element_type.kind),
            size_constant_status,
            size_expression,
        ) {
            (Some(elem_sz), ConstantStatus::Constant, ExprKind::Literal(LiteralExpr::U64(n))) => {
                elem_sz.checked_mul(*n)
            }
            _ => None,
        },
        _ => None,
    }
}
