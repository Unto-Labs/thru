/* Binary parser for ABI types */

use crate::ir::ParamMap;
use crate::types::ReflectedType;
use crate::value::{
    PrimitiveValue, PrimitiveValueF16, PrimitiveValueF32, PrimitiveValueF64, PrimitiveValueI16,
    PrimitiveValueI32, PrimitiveValueI64, PrimitiveValueI8, PrimitiveValueU16, PrimitiveValueU32,
    PrimitiveValueU64, PrimitiveValueU8, ReflectedValue, Value,
};
use abi_gen::abi::expr::ExprKind;
use abi_gen::abi::resolved::{ResolvedType, ResolvedTypeKind, Size, TypeResolver};
use abi_gen::abi::types::{FloatingPointType, IntegralType, PrimitiveType};
use std::collections::HashMap;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ParseError {
    #[error("Not enough data: need {needed} bytes, have {available}")]
    InsufficientData { needed: usize, available: usize },

    #[error("Invalid enum tag value: {value}")]
    InvalidEnumTag { value: u64 },

    #[error("Invalid size-discriminated union size: {size}, expected one of {expected:?}")]
    InvalidSizeDiscriminatedUnionSize { size: usize, expected: Vec<u64> },

    #[error("Expression evaluation failed: {0}")]
    ExpressionEvaluationFailed(String),

    #[error("Field reference resolution failed: {0}")]
    FieldReferenceFailed(String),

    #[error("Type resolution failed: {0}")]
    TypeResolutionFailed(String),
}

/* Parser for binary data according to ABI types */
pub struct Parser<'a> {
    /* Type resolver for looking up types */
    resolver: &'a TypeResolver,

    /* Context for field references (for dynamic sizes) - reserved for future use */
    #[allow(dead_code)]
    field_context: Vec<ReflectedValue>,

    /* IR-derived dynamic parameters */
    params: ParamMap,
    /* Alias map for resolving parameter suffixes */
    param_aliases: HashMap<String, String>,

    /* Root buffer for resolving field references that need absolute offsets */
    root_buffer: Vec<u8>,

    /* Root type name for resolving field references in nested contexts */
    root_type_name: String,
}

impl<'a> Parser<'a> {
    /* Create a new parser */
    pub fn new(resolver: &'a TypeResolver, params: ParamMap) -> Self {
        let param_aliases = build_param_alias_map(&params);
        Self {
            resolver,
            field_context: Vec::new(),
            params,
            param_aliases,
            root_buffer: Vec::new(),
            root_type_name: String::new(),
        }
    }

    /* Parse binary data according to a resolved type */
    pub fn parse(
        &mut self,
        data: &[u8],
        resolved_type: &ResolvedType,
    ) -> Result<ReflectedValue, ParseError> {
        /* Store root buffer and type name for nested field reference resolution */
        self.root_buffer = data.to_vec();
        self.root_type_name = resolved_type.name.clone();

        let type_info = ReflectedType::from_resolved(resolved_type);
        let value = self.parse_value(data, resolved_type, &resolved_type.name)?;
        Ok(ReflectedValue::new(type_info, value))
    }

    /* Parse a value from binary data */
    fn parse_value(
        &mut self,
        data: &[u8],
        resolved_type: &ResolvedType,
        owner_name: &str,
    ) -> Result<Value, ParseError> {
        match &resolved_type.kind {
            ResolvedTypeKind::Primitive { prim_type } => {
                self.parse_primitive(data, prim_type).map(Value::Primitive)
            }
            ResolvedTypeKind::Struct { fields, packed, .. } => self.parse_struct(
                data,
                fields,
                *packed,
                resolved_type.alignment,
                &resolved_type.name,
            ),
            ResolvedTypeKind::Union { variants } => self.parse_union(data, variants),
            ResolvedTypeKind::Enum {
                tag_expression,
                variants,
                ..
            } => self.parse_enum(data, tag_expression, variants, resolved_type, owner_name),
            ResolvedTypeKind::Array {
                element_type,
                size_expression,
                ..
            } => self.parse_array(
                data,
                element_type,
                size_expression,
                resolved_type,
                owner_name,
            ),
            ResolvedTypeKind::SizeDiscriminatedUnion { variants } => {
                self.parse_size_discriminated_union(data, variants)
            }
            ResolvedTypeKind::TypeRef { target_name, .. } => {
                let target_type = self
                    .resolver
                    .get_type_info(target_name)
                    .ok_or_else(|| ParseError::TypeResolutionFailed(target_name.clone()))?;

                /* When entering a TypeRef to a named type with variable size (like StateProof),
                 * update the root context so field references within that type resolve correctly.
                 * Save and restore the previous context after parsing. */
                let has_variable_size =
                    matches!(target_type.size, abi_gen::abi::resolved::Size::Variable(_));
                let prev_root_buffer;
                let prev_root_type_name;

                if has_variable_size {
                    prev_root_buffer = std::mem::replace(&mut self.root_buffer, data.to_vec());
                    prev_root_type_name =
                        std::mem::replace(&mut self.root_type_name, target_name.clone());
                } else {
                    prev_root_buffer = Vec::new();
                    prev_root_type_name = String::new();
                }

                let result = self.parse_value(data, target_type, &target_type.name);

                if has_variable_size {
                    self.root_buffer = prev_root_buffer;
                    self.root_type_name = prev_root_type_name;
                }

                let value = result?;
                Ok(Value::TypeRef {
                    target_name: target_name.clone(),
                    value: Box::new(ReflectedValue::new(
                        ReflectedType::from_resolved(target_type),
                        value,
                    )),
                })
            }
        }
    }

    /* Parse a primitive value */
    fn parse_primitive(
        &self,
        data: &[u8],
        prim_type: &PrimitiveType,
    ) -> Result<PrimitiveValue, ParseError> {
        match prim_type {
            PrimitiveType::Integral(int_type) => match int_type {
                IntegralType::U8 => {
                    check_size(data, 1)?;
                    Ok(PrimitiveValue::U8(PrimitiveValueU8 {
                        type_name: "u8".to_string(),
                        value: data[0],
                    }))
                }
                IntegralType::U16 => {
                    check_size(data, 2)?;
                    Ok(PrimitiveValue::U16(PrimitiveValueU16 {
                        type_name: "u16".to_string(),
                        value: u16::from_le_bytes([data[0], data[1]]),
                    }))
                }
                IntegralType::U32 => {
                    check_size(data, 4)?;
                    Ok(PrimitiveValue::U32(PrimitiveValueU32 {
                        type_name: "u32".to_string(),
                        value: u32::from_le_bytes([data[0], data[1], data[2], data[3]]),
                    }))
                }
                IntegralType::U64 => {
                    check_size(data, 8)?;
                    Ok(PrimitiveValue::U64(PrimitiveValueU64 {
                        type_name: "u64".to_string(),
                        value: u64::from_le_bytes([
                            data[0], data[1], data[2], data[3], data[4], data[5], data[6], data[7],
                        ]),
                    }))
                }
                IntegralType::I8 => {
                    check_size(data, 1)?;
                    Ok(PrimitiveValue::I8(PrimitiveValueI8 {
                        type_name: "i8".to_string(),
                        value: data[0] as i8,
                    }))
                }
                IntegralType::I16 => {
                    check_size(data, 2)?;
                    Ok(PrimitiveValue::I16(PrimitiveValueI16 {
                        type_name: "i16".to_string(),
                        value: i16::from_le_bytes([data[0], data[1]]),
                    }))
                }
                IntegralType::I32 => {
                    check_size(data, 4)?;
                    Ok(PrimitiveValue::I32(PrimitiveValueI32 {
                        type_name: "i32".to_string(),
                        value: i32::from_le_bytes([data[0], data[1], data[2], data[3]]),
                    }))
                }
                IntegralType::I64 => {
                    check_size(data, 8)?;
                    Ok(PrimitiveValue::I64(PrimitiveValueI64 {
                        type_name: "i64".to_string(),
                        value: i64::from_le_bytes([
                            data[0], data[1], data[2], data[3], data[4], data[5], data[6], data[7],
                        ]),
                    }))
                }
            },
            PrimitiveType::FloatingPoint(float_type) => match float_type {
                FloatingPointType::F16 => {
                    check_size(data, 2)?;
                    /* F16 is stored as u16, we don't decode it here */
                    Ok(PrimitiveValue::F16(PrimitiveValueF16 {
                        type_name: "f16".to_string(),
                        value: u16::from_le_bytes([data[0], data[1]]),
                    }))
                }
                FloatingPointType::F32 => {
                    check_size(data, 4)?;
                    Ok(PrimitiveValue::F32(PrimitiveValueF32 {
                        type_name: "f32".to_string(),
                        value: f32::from_le_bytes([data[0], data[1], data[2], data[3]]),
                    }))
                }
                FloatingPointType::F64 => {
                    check_size(data, 8)?;
                    Ok(PrimitiveValue::F64(PrimitiveValueF64 {
                        type_name: "f64".to_string(),
                        value: f64::from_le_bytes([
                            data[0], data[1], data[2], data[3], data[4], data[5], data[6], data[7],
                        ]),
                    }))
                }
            },
        }
    }

    /* Parse a struct */
    fn parse_struct(
        &mut self,
        data: &[u8],
        fields: &[abi_gen::abi::resolved::ResolvedField],
        packed: bool,
        _struct_alignment: u64,
        owner_name: &str,
    ) -> Result<Value, ParseError> {
        let mut parsed_fields = Vec::new();
        let mut offset = 0usize;
        let mut parsed_field_map = std::collections::HashMap::new();

        for (field_index, field) in fields.iter().enumerate() {
            let is_last_field = field_index + 1 == fields.len();
            let field_offset = if packed {
                offset
            } else {
                /* Align offset to field alignment */
                let field_alignment = field.field_type.alignment as usize;
                align_up(offset, field_alignment)
            };

            /* Handle variable-size fields (enums, arrays, size-discriminated unions) */
            let (field_data, field_size) = match &field.field_type.size {
                abi_gen::abi::resolved::Size::Const(size) => {
                    let size = *size as usize;
                    if field_offset + size > data.len() {
                        return Err(ParseError::InsufficientData {
                            needed: field_offset + size,
                            available: data.len(),
                        });
                    }
                    (&data[field_offset..field_offset + size], size)
                }
                abi_gen::abi::resolved::Size::Variable(_) => {
                    if let ResolvedTypeKind::Enum {
                        tag_expression,
                        variants,
                        ..
                    } = &field.field_type.kind
                    {
                        /* Evaluate tag expression to get tag value - use parsed fields for context */
                        let tag_value = self.evaluate_tag_expression_with_context(
                            tag_expression,
                            data,
                            fields,
                            &parsed_field_map,
                            owner_name,
                        )?;

                        /* Find matching variant */
                        let variant = variants
                            .iter()
                            .find(|v| v.tag_value == tag_value)
                            .ok_or_else(|| ParseError::InvalidEnumTag { value: tag_value })?;

                        /* Get variant size */
                        let variant_size = match &variant.variant_type.size {
                            abi_gen::abi::resolved::Size::Const(size) => *size as usize,
                            abi_gen::abi::resolved::Size::Variable(_) => {
                                if !is_last_field {
                                    return Err(ParseError::ExpressionEvaluationFailed(
                                        "Nested variable-size types not supported".to_string(),
                                    ));
                                }
                                data.len().checked_sub(field_offset).ok_or_else(|| {
                                    ParseError::ExpressionEvaluationFailed(
                                        "Invalid variant size calculation".to_string(),
                                    )
                                })?
                            }
                        };

                        if field_offset + variant_size > data.len() {
                            return Err(ParseError::InsufficientData {
                                needed: field_offset + variant_size,
                                available: data.len(),
                            });
                        }

                        /* Parse the enum value directly here since we already know the variant */
                        /* This avoids calling parse_value which would try to evaluate the tag again */
                        let variant_data = &data[field_offset..field_offset + variant_size];
                        let variant_value =
                            self.parse_value(variant_data, &variant.variant_type, owner_name)?;
                        let variant_type_info = ReflectedType::from_resolved(&variant.variant_type);
                        let enum_value = Value::Enum {
                            variant_name: variant.name.clone(),
                            tag_value,
                            variant_value: Box::new(ReflectedValue::new(
                                variant_type_info,
                                variant_value,
                            )),
                        };
                        let enum_type_info = ReflectedType::from_resolved(&field.field_type);
                        let enum_reflected = ReflectedValue::new(enum_type_info, enum_value);
                        parsed_fields.push((field.name.clone(), enum_reflected.clone()));
                        parsed_field_map.insert(field.name.clone(), enum_reflected);
                        offset = field_offset + variant_size;
                        continue; /* Skip the normal field parsing below since we already handled it */
                    }

                    if let ResolvedTypeKind::SizeDiscriminatedUnion { variants } =
                        &field.field_type.kind
                    {
                        let remaining_size = data.len() - field_offset;
                        let variant = variants
                            .iter()
                            .find(|v| v.expected_size == remaining_size as u64)
                            .ok_or_else(|| ParseError::InvalidSizeDiscriminatedUnionSize {
                                size: remaining_size,
                                expected: variants.iter().map(|v| v.expected_size).collect(),
                            })?;

                        let variant_size = variant.expected_size as usize;
                        if field_offset + variant_size > data.len() {
                            return Err(ParseError::InsufficientData {
                                needed: field_offset + variant_size,
                                available: data.len(),
                            });
                        }

                        (
                            &data[field_offset..field_offset + variant_size],
                            variant_size,
                        )
                    } else if let ResolvedTypeKind::Array {
                        element_type,
                        size_expression,
                        ..
                    } = &field.field_type.kind
                    {
                        let element_size = match element_type.size {
                            abi_gen::abi::resolved::Size::Const(sz) => sz as usize,
                            _ => {
                                return Err(ParseError::ExpressionEvaluationFailed(
                                    "Variable-size array elements not supported".to_string(),
                                ))
                            }
                        };
                        let count = self.evaluate_tag_expression_with_context(
                            size_expression,
                            data,
                            fields,
                            &parsed_field_map,
                            owner_name,
                        )? as usize;
                        let total_size = element_size.checked_mul(count).ok_or_else(|| {
                            ParseError::ExpressionEvaluationFailed(
                                "Array size overflow".to_string(),
                            )
                        })?;
                        if field_offset + total_size > data.len() {
                            return Err(ParseError::InsufficientData {
                                needed: field_offset + total_size,
                                available: data.len(),
                            });
                        }

                        (&data[field_offset..field_offset + total_size], total_size)
                    } else if let ResolvedTypeKind::Struct { .. } = &field.field_type.kind {
                        if !is_last_field {
                            return Err(ParseError::ExpressionEvaluationFailed(
                                "Variable-size struct fields must be the final member".to_string(),
                            ));
                        }
                        let remaining = data.len().checked_sub(field_offset).ok_or(
                            ParseError::InsufficientData {
                                needed: field_offset,
                                available: data.len(),
                            },
                        )?;
                        (&data[field_offset..], remaining)
                    } else if let ResolvedTypeKind::TypeRef { .. } = &field.field_type.kind {
                        if !is_last_field {
                            return Err(ParseError::ExpressionEvaluationFailed(
                                "Variable-size type references must be the final member"
                                    .to_string(),
                            ));
                        }
                        let remaining = data.len().checked_sub(field_offset).ok_or(
                            ParseError::InsufficientData {
                                needed: field_offset,
                                available: data.len(),
                            },
                        )?;
                        (&data[field_offset..], remaining)
                    } else {
                        return Err(ParseError::ExpressionEvaluationFailed(format!(
                            "Unsupported variable-size field type: {:?}",
                            field.field_type.kind
                        )));
                    }
                }
            };

            let field_type_info = ReflectedType::from_resolved(&field.field_type);
            let child_owner = match &field.field_type.kind {
                ResolvedTypeKind::Struct { .. } => field.field_type.name.as_str(),
                _ => owner_name,
            };
            let field_value = self.parse_value(field_data, &field.field_type, child_owner)?;
            let reflected_field = ReflectedValue::new(field_type_info, field_value);

            /* Add to parsed_field_map BEFORE adding to parsed_fields so it's available
             * for subsequent field evaluations (e.g., enum tag expressions) */
            parsed_field_map.insert(field.name.clone(), reflected_field.clone());
            parsed_fields.push((field.name.clone(), reflected_field));

            offset = field_offset + field_size;
        }

        Ok(Value::Struct {
            fields: parsed_fields,
        })
    }

    /* Parse a union */
    fn parse_union(
        &mut self,
        data: &[u8],
        variants: &[abi_gen::abi::resolved::ResolvedField],
    ) -> Result<Value, ParseError> {
        /* For unions, we parse the first variant by default */
        /* In practice, you'd need external information about which variant is active */
        if variants.is_empty() {
            return Err(ParseError::TypeResolutionFailed(
                "Union has no variants".to_string(),
            ));
        }

        let variant = &variants[0];
        let variant_size = match &variant.field_type.size {
            abi_gen::abi::resolved::Size::Const(size) => *size as usize,
            abi_gen::abi::resolved::Size::Variable(_) => {
                return Err(ParseError::ExpressionEvaluationFailed(
                    "Variable-size union variants not supported".to_string(),
                ));
            }
        };

        if variant_size > data.len() {
            return Err(ParseError::InsufficientData {
                needed: variant_size,
                available: data.len(),
            });
        }

        let variant_data = &data[..variant_size];
        let variant_value =
            self.parse_value(variant_data, &variant.field_type, &variant.field_type.name)?;
        let variant_type_info = ReflectedType::from_resolved(&variant.field_type);

        Ok(Value::Union {
            variant_name: variant.name.clone(),
            variant_value: Box::new(ReflectedValue::new(variant_type_info, variant_value)),
        })
    }

    /* Parse an enum */
    fn parse_enum(
        &mut self,
        data: &[u8],
        tag_expression: &ExprKind,
        variants: &[abi_gen::abi::resolved::ResolvedEnumVariant],
        resolved_type: &ResolvedType,
        owner_name: &str,
    ) -> Result<Value, ParseError> {
        /* Evaluate tag expression to get tag value */
        /* Note: This is called from parse_value, so we don't have struct context here.
         * For enums in structs, the tag evaluation should happen in parse_struct before
         * calling parse_value. This function is for standalone enum parsing. */
        let tag_value =
            self.evaluate_tag_expression(tag_expression, data, resolved_type, owner_name)?;

        /* Find variant with matching tag */
        let variant = variants
            .iter()
            .find(|v| v.tag_value == tag_value)
            .ok_or_else(|| ParseError::InvalidEnumTag { value: tag_value })?;

        let variant_size = match &variant.variant_type.size {
            abi_gen::abi::resolved::Size::Const(size) => *size as usize,
            abi_gen::abi::resolved::Size::Variable(_) => {
                return Err(ParseError::ExpressionEvaluationFailed(
                    "Variable-size enum variants not supported".to_string(),
                ));
            }
        };

        if variant_size > data.len() {
            return Err(ParseError::InsufficientData {
                needed: variant_size,
                available: data.len(),
            });
        }

        let variant_data = &data[..variant_size];
        let variant_value = self.parse_value(
            variant_data,
            &variant.variant_type,
            &variant.variant_type.name,
        )?;
        let variant_type_info = ReflectedType::from_resolved(&variant.variant_type);

        Ok(Value::Enum {
            variant_name: variant.name.clone(),
            tag_value,
            variant_value: Box::new(ReflectedValue::new(variant_type_info, variant_value)),
        })
    }

    /* Parse an array */
    fn parse_array(
        &mut self,
        data: &[u8],
        element_type: &ResolvedType,
        size_expression: &ExprKind,
        resolved_type: &ResolvedType,
        owner_name: &str,
    ) -> Result<Value, ParseError> {
        /* Evaluate size expression.
         * For FAM arrays where the size expression references parent struct fields,
         * the current data slice may not contain those fields. Try evaluating with
         * the current context first, then fall back to root type if available. */
        let array_size = self
            .evaluate_size_expression(size_expression, data, resolved_type, owner_name)
            .or_else(|_| {
                /* Fall back to root type/buffer for size expressions that reference parent fields */
                if !self.root_type_name.is_empty() {
                    if let Some(root_type) = self.resolver.get_type_info(&self.root_type_name) {
                        return self.evaluate_size_expression(
                            size_expression,
                            &self.root_buffer,
                            root_type,
                            &self.root_type_name,
                        );
                    }
                }
                Err(ParseError::ExpressionEvaluationFailed(format!(
                    "Cannot evaluate array size expression for {}",
                    resolved_type.name
                )))
            })?;

        let element_size = match &element_type.size {
            abi_gen::abi::resolved::Size::Const(size) => *size as usize,
            abi_gen::abi::resolved::Size::Variable(_) => {
                return Err(ParseError::ExpressionEvaluationFailed(
                    "Variable-size array elements not supported".to_string(),
                ));
            }
        };

        let total_size = array_size * element_size;
        if total_size > data.len() {
            return Err(ParseError::InsufficientData {
                needed: total_size,
                available: data.len(),
            });
        }

        let mut elements = Vec::new();
        let element_type_info = ReflectedType::from_resolved(element_type);

        for i in 0..array_size {
            let element_offset = i * element_size;
            let element_data = &data[element_offset..element_offset + element_size];
            let element_value = self.parse_value(element_data, element_type, &element_type.name)?;
            elements.push(ReflectedValue::new(
                element_type_info.clone(),
                element_value,
            ));
        }

        Ok(Value::Array { elements })
    }

    /* Parse a size-discriminated union */
    fn parse_size_discriminated_union(
        &mut self,
        data: &[u8],
        variants: &[abi_gen::abi::resolved::ResolvedSizeDiscriminatedVariant],
    ) -> Result<Value, ParseError> {
        let actual_size = data.len();

        /* Find variant with matching expected size */
        let variant = variants
            .iter()
            .find(|v| v.expected_size == actual_size as u64)
            .ok_or_else(|| ParseError::InvalidSizeDiscriminatedUnionSize {
                size: actual_size,
                expected: variants.iter().map(|v| v.expected_size).collect(),
            })?;

        let variant_value =
            self.parse_value(data, &variant.variant_type, &variant.variant_type.name)?;
        let variant_type_info = ReflectedType::from_resolved(&variant.variant_type);

        Ok(Value::SizeDiscriminatedUnion {
            variant_name: variant.name.clone(),
            variant_value: Box::new(ReflectedValue::new(variant_type_info, variant_value)),
        })
    }

    /* Evaluate tag expression for enums */
    fn evaluate_tag_expression(
        &self,
        expr: &ExprKind,
        data: &[u8],
        resolved_type: &ResolvedType,
        owner_name: &str,
    ) -> Result<u64, ParseError> {
        /* Try constant evaluation first */
        if let Some(value) = expr.try_evaluate_constant() {
            return Ok(value);
        }

        /* Handle Sizeof expressions */
        if let ExprKind::Sizeof(sizeof_expr) = expr {
            let target_type = self
                .resolver
                .get_type_info(&sizeof_expr.type_name)
                .ok_or_else(|| ParseError::TypeResolutionFailed(sizeof_expr.type_name.clone()))?;
            match &target_type.size {
                abi_gen::abi::resolved::Size::Const(size) => return Ok(*size),
                abi_gen::abi::resolved::Size::Variable(_) => {
                    return Err(ParseError::ExpressionEvaluationFailed(format!(
                        "Type {} has variable size",
                        sizeof_expr.type_name
                    )));
                }
            }
        }

        /* Handle Alignof expressions */
        if let ExprKind::Alignof(alignof_expr) = expr {
            let target_type = self
                .resolver
                .get_type_info(&alignof_expr.type_name)
                .ok_or_else(|| ParseError::TypeResolutionFailed(alignof_expr.type_name.clone()))?;
            return Ok(target_type.alignment);
        }

        /* Try to evaluate field references */
        if let ExprKind::FieldRef(field_ref) = expr {
            if let Some(value) = self.resolve_param_value(owner_name, field_ref.path.as_slice()) {
                return Ok(value);
            }
            return self.resolve_field_reference(field_ref.path.as_slice(), data, resolved_type);
        }

        /* For complex expressions, try to evaluate recursively */
        match expr {
            ExprKind::Add(e) => {
                let left =
                    self.evaluate_tag_expression(&e.left, data, resolved_type, owner_name)?;
                let right =
                    self.evaluate_tag_expression(&e.right, data, resolved_type, owner_name)?;
                Ok(left + right)
            }
            ExprKind::Sub(e) => {
                let left =
                    self.evaluate_tag_expression(&e.left, data, resolved_type, owner_name)?;
                let right =
                    self.evaluate_tag_expression(&e.right, data, resolved_type, owner_name)?;
                Ok(left - right)
            }
            ExprKind::Mul(e) => {
                let left =
                    self.evaluate_tag_expression(&e.left, data, resolved_type, owner_name)?;
                let right =
                    self.evaluate_tag_expression(&e.right, data, resolved_type, owner_name)?;
                Ok(left * right)
            }
            ExprKind::Div(e) => {
                let left =
                    self.evaluate_tag_expression(&e.left, data, resolved_type, owner_name)?;
                let right =
                    self.evaluate_tag_expression(&e.right, data, resolved_type, owner_name)?;
                if right == 0 {
                    return Err(ParseError::ExpressionEvaluationFailed(
                        "Division by zero".to_string(),
                    ));
                }
                Ok(left / right)
            }
            ExprKind::Mod(e) => {
                let left =
                    self.evaluate_tag_expression(&e.left, data, resolved_type, owner_name)?;
                let right =
                    self.evaluate_tag_expression(&e.right, data, resolved_type, owner_name)?;
                if right == 0 {
                    return Err(ParseError::ExpressionEvaluationFailed(
                        "Modulo by zero".to_string(),
                    ));
                }
                Ok(left % right)
            }
            ExprKind::BitAnd(e) => {
                let left =
                    self.evaluate_tag_expression(&e.left, data, resolved_type, owner_name)?;
                let right =
                    self.evaluate_tag_expression(&e.right, data, resolved_type, owner_name)?;
                Ok(left & right)
            }
            ExprKind::BitOr(e) => {
                let left =
                    self.evaluate_tag_expression(&e.left, data, resolved_type, owner_name)?;
                let right =
                    self.evaluate_tag_expression(&e.right, data, resolved_type, owner_name)?;
                Ok(left | right)
            }
            ExprKind::BitXor(e) => {
                let left =
                    self.evaluate_tag_expression(&e.left, data, resolved_type, owner_name)?;
                let right =
                    self.evaluate_tag_expression(&e.right, data, resolved_type, owner_name)?;
                Ok(left ^ right)
            }
            ExprKind::LeftShift(e) => {
                let left =
                    self.evaluate_tag_expression(&e.left, data, resolved_type, owner_name)?;
                let right =
                    self.evaluate_tag_expression(&e.right, data, resolved_type, owner_name)?;
                Ok(left << right)
            }
            ExprKind::RightShift(e) => {
                let left =
                    self.evaluate_tag_expression(&e.left, data, resolved_type, owner_name)?;
                let right =
                    self.evaluate_tag_expression(&e.right, data, resolved_type, owner_name)?;
                Ok(left >> right)
            }
            ExprKind::BitNot(e) => {
                let operand =
                    self.evaluate_tag_expression(&e.operand, data, resolved_type, owner_name)?;
                Ok(!operand)
            }
            ExprKind::Popcount(e) => {
                let operand =
                    self.evaluate_tag_expression(&e.operand, data, resolved_type, owner_name)?;
                Ok(operand.count_ones() as u64)
            }
            _ => Err(ParseError::ExpressionEvaluationFailed(format!(
                "Unsupported expression type: {:?}",
                expr
            ))),
        }
    }

    /* Evaluate size expression for arrays */
    fn evaluate_size_expression(
        &self,
        expr: &ExprKind,
        data: &[u8],
        resolved_type: &ResolvedType,
        owner_name: &str,
    ) -> Result<usize, ParseError> {
        let value = self.evaluate_tag_expression(expr, data, resolved_type, owner_name)?;
        Ok(value as usize)
    }

    /* Evaluate tag expression with struct field context */
    fn evaluate_tag_expression_with_context(
        &self,
        expr: &ExprKind,
        data: &[u8],
        struct_fields: &[abi_gen::abi::resolved::ResolvedField],
        parsed_fields: &std::collections::HashMap<String, ReflectedValue>,
        owner_name: &str,
    ) -> Result<u64, ParseError> {
        /* Try constant evaluation first */
        if let Some(value) = expr.try_evaluate_constant() {
            return Ok(value);
        }

        /* Handle Sizeof expressions */
        if let ExprKind::Sizeof(sizeof_expr) = expr {
            let target_type = self
                .resolver
                .get_type_info(&sizeof_expr.type_name)
                .ok_or_else(|| ParseError::TypeResolutionFailed(sizeof_expr.type_name.clone()))?;
            match &target_type.size {
                abi_gen::abi::resolved::Size::Const(size) => return Ok(*size),
                abi_gen::abi::resolved::Size::Variable(_) => {
                    return Err(ParseError::ExpressionEvaluationFailed(format!(
                        "Type {} has variable size",
                        sizeof_expr.type_name
                    )));
                }
            }
        }

        /* Handle Alignof expressions */
        if let ExprKind::Alignof(alignof_expr) = expr {
            let target_type = self
                .resolver
                .get_type_info(&alignof_expr.type_name)
                .ok_or_else(|| ParseError::TypeResolutionFailed(alignof_expr.type_name.clone()))?;
            return Ok(target_type.alignment);
        }

        /* Try to evaluate field references using parsed fields */
        if let ExprKind::FieldRef(field_ref) = expr {
            if let Some(value) = self.resolve_param_value(owner_name, field_ref.path.as_slice()) {
                return Ok(value);
            }
            return self.resolve_field_reference_with_context(
                field_ref.path.as_slice(),
                data,
                struct_fields,
                parsed_fields,
                owner_name,
            );
        }

        /* For complex expressions, try to evaluate recursively */
        match expr {
            ExprKind::Add(e) => {
                let left = self.evaluate_tag_expression_with_context(
                    &e.left,
                    data,
                    struct_fields,
                    parsed_fields,
                    owner_name,
                )?;
                let right = self.evaluate_tag_expression_with_context(
                    &e.right,
                    data,
                    struct_fields,
                    parsed_fields,
                    owner_name,
                )?;
                Ok(left + right)
            }
            ExprKind::Sub(e) => {
                let left = self.evaluate_tag_expression_with_context(
                    &e.left,
                    data,
                    struct_fields,
                    parsed_fields,
                    owner_name,
                )?;
                let right = self.evaluate_tag_expression_with_context(
                    &e.right,
                    data,
                    struct_fields,
                    parsed_fields,
                    owner_name,
                )?;
                Ok(left - right)
            }
            ExprKind::Mul(e) => {
                let left = self.evaluate_tag_expression_with_context(
                    &e.left,
                    data,
                    struct_fields,
                    parsed_fields,
                    owner_name,
                )?;
                let right = self.evaluate_tag_expression_with_context(
                    &e.right,
                    data,
                    struct_fields,
                    parsed_fields,
                    owner_name,
                )?;
                Ok(left * right)
            }
            ExprKind::Div(e) => {
                let left = self.evaluate_tag_expression_with_context(
                    &e.left,
                    data,
                    struct_fields,
                    parsed_fields,
                    owner_name,
                )?;
                let right = self.evaluate_tag_expression_with_context(
                    &e.right,
                    data,
                    struct_fields,
                    parsed_fields,
                    owner_name,
                )?;
                if right == 0 {
                    return Err(ParseError::ExpressionEvaluationFailed(
                        "Division by zero".to_string(),
                    ));
                }
                Ok(left / right)
            }
            ExprKind::Mod(e) => {
                let left = self.evaluate_tag_expression_with_context(
                    &e.left,
                    data,
                    struct_fields,
                    parsed_fields,
                    owner_name,
                )?;
                let right = self.evaluate_tag_expression_with_context(
                    &e.right,
                    data,
                    struct_fields,
                    parsed_fields,
                    owner_name,
                )?;
                if right == 0 {
                    return Err(ParseError::ExpressionEvaluationFailed(
                        "Modulo by zero".to_string(),
                    ));
                }
                Ok(left % right)
            }
            ExprKind::BitAnd(e) => {
                let left = self.evaluate_tag_expression_with_context(
                    &e.left,
                    data,
                    struct_fields,
                    parsed_fields,
                    owner_name,
                )?;
                let right = self.evaluate_tag_expression_with_context(
                    &e.right,
                    data,
                    struct_fields,
                    parsed_fields,
                    owner_name,
                )?;
                Ok(left & right)
            }
            ExprKind::BitOr(e) => {
                let left = self.evaluate_tag_expression_with_context(
                    &e.left,
                    data,
                    struct_fields,
                    parsed_fields,
                    owner_name,
                )?;
                let right = self.evaluate_tag_expression_with_context(
                    &e.right,
                    data,
                    struct_fields,
                    parsed_fields,
                    owner_name,
                )?;
                Ok(left | right)
            }
            ExprKind::BitXor(e) => {
                let left = self.evaluate_tag_expression_with_context(
                    &e.left,
                    data,
                    struct_fields,
                    parsed_fields,
                    owner_name,
                )?;
                let right = self.evaluate_tag_expression_with_context(
                    &e.right,
                    data,
                    struct_fields,
                    parsed_fields,
                    owner_name,
                )?;
                Ok(left ^ right)
            }
            ExprKind::LeftShift(e) => {
                let left = self.evaluate_tag_expression_with_context(
                    &e.left,
                    data,
                    struct_fields,
                    parsed_fields,
                    owner_name,
                )?;
                let right = self.evaluate_tag_expression_with_context(
                    &e.right,
                    data,
                    struct_fields,
                    parsed_fields,
                    owner_name,
                )?;
                Ok(left << right)
            }
            ExprKind::RightShift(e) => {
                let left = self.evaluate_tag_expression_with_context(
                    &e.left,
                    data,
                    struct_fields,
                    parsed_fields,
                    owner_name,
                )?;
                let right = self.evaluate_tag_expression_with_context(
                    &e.right,
                    data,
                    struct_fields,
                    parsed_fields,
                    owner_name,
                )?;
                Ok(left >> right)
            }
            ExprKind::BitNot(e) => {
                let operand = self.evaluate_tag_expression_with_context(
                    &e.operand,
                    data,
                    struct_fields,
                    parsed_fields,
                    owner_name,
                )?;
                Ok(!operand)
            }
            ExprKind::Popcount(e) => {
                let operand = self.evaluate_tag_expression_with_context(
                    &e.operand,
                    data,
                    struct_fields,
                    parsed_fields,
                    owner_name,
                )?;
                Ok(operand.count_ones() as u64)
            }
            _ => Err(ParseError::ExpressionEvaluationFailed(format!(
                "Unsupported expression type: {:?}",
                expr
            ))),
        }
    }

    /* Resolve field reference with parsed field context */
    fn resolve_field_reference_with_context(
        &self,
        path: &[String],
        data: &[u8],
        _struct_fields: &[abi_gen::abi::resolved::ResolvedField],
        parsed_fields: &std::collections::HashMap<String, ReflectedValue>,
        owner_name: &str,
    ) -> Result<u64, ParseError> {
        if path.is_empty() {
            return Err(ParseError::FieldReferenceFailed(
                "Empty field path".to_string(),
            ));
        }

        /* Try to find the field in parsed fields first */
        if let Some(field_value) = parsed_fields.get(&path[0]) {
            return self.extract_u64_from_reflected_value(field_value, &path[1..]);
        }

        /* Fall back to resolving via the owning type.
         * If owner_name matches root_type_name, use root_buffer since
         * the data slice may not start at the root offset. */
        if let Some(owner_type) = self.resolver.get_type_info(owner_name) {
            if owner_name == self.root_type_name {
                return self.resolve_field_reference_in_type(&self.root_buffer, owner_type, path);
            }
            return self.resolve_field_reference_in_type(data, owner_type, path);
        }

        /* If the owner type is not found (inline struct), try root type with root buffer */
        if !self.root_type_name.is_empty() {
            if let Some(root_type) = self.resolver.get_type_info(&self.root_type_name) {
                return self.resolve_field_reference_in_type(&self.root_buffer, root_type, path);
            }
        }

        /* Last resort: try root type name extracted from owner name */
        let root_name = owner_name.split("::").next().unwrap_or(owner_name);
        if let Some(root_type) = self.resolver.get_type_info(root_name) {
            return self.resolve_field_reference_in_type(&self.root_buffer, root_type, path);
        }

        Err(ParseError::FieldReferenceFailed(format!(
            "Unknown owner type '{}'",
            owner_name
        )))
    }

    /* Resolve field reference */
    fn resolve_field_reference(
        &self,
        path: &[String],
        data: &[u8],
        resolved_type: &ResolvedType,
    ) -> Result<u64, ParseError> {
        if path.is_empty() {
            return Err(ParseError::FieldReferenceFailed(
                "Empty field path".to_string(),
            ));
        }
        self.resolve_field_reference_in_type(data, resolved_type, path)
    }

    fn resolve_field_reference_in_type(
        &self,
        data: &[u8],
        resolved_type: &ResolvedType,
        path: &[String],
    ) -> Result<u64, ParseError> {
        if path.is_empty() {
            return Err(ParseError::FieldReferenceFailed(
                "Empty field path".to_string(),
            ));
        }

        match &resolved_type.kind {
            ResolvedTypeKind::Struct { fields, .. } => {
                let field = fields.iter().find(|f| f.name == path[0]).ok_or_else(|| {
                    ParseError::FieldReferenceFailed(format!(
                        "Field '{}' not found in {}",
                        path[0], resolved_type.name
                    ))
                })?;
                let field_data = self.slice_field_data(data, field)?;
                if path.len() == 1 {
                    return self.extract_primitive_field_value(field, field_data);
                }
                self.resolve_field_reference_in_type(field_data, &field.field_type, &path[1..])
            }
            ResolvedTypeKind::TypeRef { target_name, .. } => {
                let target = self.resolver.get_type_info(target_name).ok_or_else(|| {
                    ParseError::FieldReferenceFailed(format!(
                        "Unknown type reference '{}'",
                        target_name
                    ))
                })?;
                self.resolve_field_reference_in_type(data, target, path)
            }
            ResolvedTypeKind::Array { element_type, .. } => {
                let index_segment = &path[0];
                let index = index_segment.parse::<usize>().map_err(|_| {
                    ParseError::FieldReferenceFailed(format!(
                        "Invalid array index '{}'",
                        index_segment
                    ))
                })?;
                let element_size = match &element_type.size {
                    Size::Const(size) => *size as usize,
                    Size::Variable(_) => {
                        return Err(ParseError::FieldReferenceFailed(
                            "Array element has variable size".to_string(),
                        ));
                    }
                };
                let total_size = match &resolved_type.size {
                    Size::Const(size) => *size as usize,
                    Size::Variable(_) => {
                        return Err(ParseError::FieldReferenceFailed(
                            "Array has variable size".to_string(),
                        ));
                    }
                };
                let element_count = total_size.checked_div(element_size).ok_or_else(|| {
                    ParseError::FieldReferenceFailed(format!(
                        "Invalid array layout for type {}",
                        resolved_type.name
                    ))
                })?;
                if index >= element_count {
                    return Err(ParseError::FieldReferenceFailed(format!(
                        "Array index {} out of bounds (len = {})",
                        index, element_count
                    )));
                }
                let start = index * element_size;
                if start + element_size > data.len() {
                    return Err(ParseError::InsufficientData {
                        needed: start + element_size,
                        available: data.len(),
                    });
                }
                let element_data = &data[start..start + element_size];
                if path.len() == 1 {
                    return self.extract_primitive_from_type(element_type, element_data);
                }
                self.resolve_field_reference_in_type(element_data, element_type, &path[1..])
            }
            ResolvedTypeKind::Primitive { prim_type } => {
                if path.len() > 1 {
                    return Err(ParseError::FieldReferenceFailed(format!(
                        "Cannot descend into primitive type {:?}",
                        prim_type
                    )));
                }
                let prim_value = self.parse_primitive(data, prim_type)?;
                prim_value.to_u64().ok_or_else(|| {
                    ParseError::FieldReferenceFailed(
                        "Primitive value cannot be converted to u64".to_string(),
                    )
                })
            }
            _ => Err(ParseError::FieldReferenceFailed(format!(
                "Field reference {:?} not supported for type {:?}",
                path, resolved_type.kind
            ))),
        }
    }

    fn extract_u64_from_reflected_value(
        &self,
        value: &ReflectedValue,
        path: &[String],
    ) -> Result<u64, ParseError> {
        if path.is_empty() {
            return self.reflected_value_to_u64(value);
        }
        match &value.value {
            Value::Struct { fields } => {
                let field = fields
                    .iter()
                    .find(|(name, _)| name == &path[0])
                    .ok_or_else(|| {
                        ParseError::FieldReferenceFailed(format!(
                            "Field '{}' not found in struct {}",
                            path[0], value.type_info.name
                        ))
                    })?;
                self.extract_u64_from_reflected_value(&field.1, &path[1..])
            }
            Value::TypeRef { value: inner, .. } => {
                self.extract_u64_from_reflected_value(inner, path)
            }
            Value::Array { elements } => {
                let segment = &path[0];
                let index = segment.parse::<usize>().map_err(|_| {
                    ParseError::FieldReferenceFailed(format!(
                        "Invalid array index '{}' while resolving {:?}",
                        segment, path
                    ))
                })?;
                let element = elements.get(index).ok_or_else(|| {
                    ParseError::FieldReferenceFailed(format!(
                        "Array index {} out of bounds (len = {})",
                        index,
                        elements.len()
                    ))
                })?;
                self.extract_u64_from_reflected_value(element, &path[1..])
            }
            Value::Primitive(_) => Err(ParseError::FieldReferenceFailed(format!(
                "Cannot descend into primitive value {} using {:?}",
                value.type_info.name, path
            ))),
            _ => Err(ParseError::FieldReferenceFailed(format!(
                "Field reference {:?} not supported for value kind {:?}",
                path, value.value
            ))),
        }
    }

    fn reflected_value_to_u64(&self, value: &ReflectedValue) -> Result<u64, ParseError> {
        match &value.value {
            Value::Primitive(prim) => prim.to_u64().ok_or_else(|| {
                ParseError::FieldReferenceFailed(format!(
                    "Value {} cannot be converted to u64",
                    value.type_info.name
                ))
            }),
            Value::TypeRef { value: inner, .. } => self.reflected_value_to_u64(inner),
            _ => Err(ParseError::FieldReferenceFailed(format!(
                "Value of kind {:?} cannot be converted to u64",
                value.value
            ))),
        }
    }

    fn slice_field_data<'b>(
        &self,
        data: &'b [u8],
        field: &abi_gen::abi::resolved::ResolvedField,
    ) -> Result<&'b [u8], ParseError> {
        let field_offset = field.offset.ok_or_else(|| {
            ParseError::FieldReferenceFailed(format!("Field {} has no offset", field.name))
        })? as usize;
        let field_size = match &field.field_type.size {
            Size::Const(size) => *size as usize,
            Size::Variable(_) => {
                return Err(ParseError::FieldReferenceFailed(format!(
                    "Field {} has variable size and cannot be used in field references",
                    field.name
                )))
            }
        };
        if field_offset + field_size > data.len() {
            return Err(ParseError::InsufficientData {
                needed: field_offset + field_size,
                available: data.len(),
            });
        }
        Ok(&data[field_offset..field_offset + field_size])
    }

    fn extract_primitive_field_value(
        &self,
        field: &abi_gen::abi::resolved::ResolvedField,
        field_data: &[u8],
    ) -> Result<u64, ParseError> {
        if let ResolvedTypeKind::Primitive { prim_type } = &field.field_type.kind {
            let prim_value = self.parse_primitive(field_data, prim_type)?;
            prim_value.to_u64().ok_or_else(|| {
                ParseError::FieldReferenceFailed(format!(
                    "Field {} value cannot be converted to u64",
                    field.name
                ))
            })
        } else {
            Err(ParseError::FieldReferenceFailed(format!(
                "Field {} is not a primitive type",
                field.name
            )))
        }
    }

    fn extract_primitive_from_type(
        &self,
        resolved_type: &ResolvedType,
        data: &[u8],
    ) -> Result<u64, ParseError> {
        if let ResolvedTypeKind::Primitive { prim_type } = &resolved_type.kind {
            let prim_value = self.parse_primitive(data, prim_type)?;
            prim_value.to_u64().ok_or_else(|| {
                ParseError::FieldReferenceFailed("Value cannot be converted to u64".to_string())
            })
        } else {
            Err(ParseError::FieldReferenceFailed(format!(
                "Type {} is not primitive",
                resolved_type.name
            )))
        }
    }

    fn resolve_param_value(&self, owner: &str, path: &[String]) -> Option<u64> {
        if path.is_empty() {
            return None;
        }
        let joined = path.join(".");
        let owner_norm = normalize_param_alias(owner);
        let normalized = normalize_param_alias(&joined);
        let mut candidates = Vec::new();
        if !normalized.is_empty() && !owner_norm.is_empty() {
            candidates.push(format!("{owner}.{normalized}"));
            candidates.push(format!("{owner_norm}.{normalized}"));
        }
        if !normalized.is_empty() {
            candidates.push(normalized.clone());
        }
        if let Some(last) = path.last() {
            candidates.push(last.clone());
        }
        for candidate in candidates {
            if let Some(value) = self.params.get(&candidate) {
                if *value <= u64::MAX as u128 {
                    return Some(*value as u64);
                }
            }
            let alias_key = normalize_param_alias(&candidate);
            if let Some(canonical) = self.param_aliases.get(&alias_key) {
                if let Some(value) = self.params.get(canonical) {
                    if *value <= u64::MAX as u128 {
                        return Some(*value as u64);
                    }
                }
            }
        }
        None
    }
}

fn build_param_alias_map(params: &ParamMap) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for key in params.keys() {
        insert_param_aliases(&mut map, key);
    }
    map
}

fn insert_param_aliases(map: &mut HashMap<String, String>, canonical: &str) {
    let normalized = normalize_param_alias(canonical);
    if normalized.is_empty() {
        return;
    }
    let segments: Vec<&str> = normalized
        .split('.')
        .filter(|seg| !seg.is_empty())
        .collect();
    if segments.is_empty() {
        map.entry(normalized)
            .or_insert_with(|| canonical.to_string());
        return;
    }
    for idx in 0..segments.len() {
        let suffix = segments[idx..].join(".");
        map.entry(suffix).or_insert_with(|| canonical.to_string());
    }
}

fn normalize_param_alias(value: &str) -> String {
    let mut trimmed = value;
    while let Some(stripped) = trimmed.strip_prefix("../") {
        trimmed = stripped;
    }
    if let Some(stripped) = trimmed.strip_prefix("./") {
        trimmed = stripped;
    }
    trimmed
        .replace("::", ".")
        .replace('/', ".")
        .replace('[', ".")
        .replace(']', "")
        .split('.')
        .filter(|seg| !seg.is_empty())
        .collect::<Vec<_>>()
        .join(".")
}

#[cfg(test)]
mod tests {
    use super::*;
    use abi_gen::abi::resolved::TypeResolver;

    #[test]
    fn resolve_param_value_finds_suffix_aliases() {
        let mut params = ParamMap::new();
        params.insert("payload.payload_size".into(), 4u128);
        let resolver = TypeResolver::new();
        let parser = Parser::new(&resolver, params);
        let value =
            parser.resolve_param_value("Container", &["payload".into(), "payload_size".into()]);
        assert_eq!(value, Some(4));
    }
}

/* Helper function to check data size */
fn check_size(data: &[u8], needed: usize) -> Result<(), ParseError> {
    if data.len() < needed {
        Err(ParseError::InsufficientData {
            needed,
            available: data.len(),
        })
    } else {
        Ok(())
    }
}

/* Helper function to align offset */
fn align_up(offset: usize, alignment: usize) -> usize {
    (offset + alignment - 1) & !(alignment - 1)
}
