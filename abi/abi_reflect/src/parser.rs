/* Binary parser for ABI types */

use abi_gen::abi::expr::ExprKind;
use abi_gen::abi::resolved::{ResolvedType, ResolvedTypeKind, TypeResolver};
use abi_gen::abi::types::{FloatingPointType, IntegralType, PrimitiveType};
use crate::types::ReflectedType;
use crate::value::{
  PrimitiveValue, PrimitiveValueF16, PrimitiveValueF32, PrimitiveValueF64, PrimitiveValueI16, PrimitiveValueI32,
  PrimitiveValueI64, PrimitiveValueI8, PrimitiveValueU16, PrimitiveValueU32, PrimitiveValueU64, PrimitiveValueU8,
  ReflectedValue, Value,
};
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
}

impl<'a> Parser<'a> {
  /* Create a new parser */
  pub fn new(resolver: &'a TypeResolver) -> Self {
    Self { resolver, field_context: Vec::new() }
  }

  /* Parse binary data according to a resolved type */
  pub fn parse(&mut self, data: &[u8], resolved_type: &ResolvedType) -> Result<ReflectedValue, ParseError> {
    let type_info = ReflectedType::from_resolved(resolved_type);
    let value = self.parse_value(data, resolved_type)?;
    Ok(ReflectedValue::new(type_info, value))
  }

  /* Parse a value from binary data */
  fn parse_value(&mut self, data: &[u8], resolved_type: &ResolvedType) -> Result<Value, ParseError> {
    match &resolved_type.kind {
      ResolvedTypeKind::Primitive { prim_type } => {
        self.parse_primitive(data, prim_type).map(Value::Primitive)
      }
      ResolvedTypeKind::Struct { fields, packed, .. } => {
        self.parse_struct(data, fields, *packed, resolved_type.alignment)
      }
      ResolvedTypeKind::Union { variants } => self.parse_union(data, variants),
      ResolvedTypeKind::Enum { tag_expression, variants, .. } => {
        self.parse_enum(data, tag_expression, variants, resolved_type)
      }
      ResolvedTypeKind::Array { element_type, size_expression, .. } => {
        self.parse_array(data, element_type, size_expression, resolved_type)
      }
      ResolvedTypeKind::SizeDiscriminatedUnion { variants } => {
        self.parse_size_discriminated_union(data, variants)
      }
      ResolvedTypeKind::TypeRef { target_name, .. } => {
        let target_type = self
          .resolver
          .get_type_info(target_name)
          .ok_or_else(|| ParseError::TypeResolutionFailed(target_name.clone()))?;
        let value = self.parse_value(data, target_type)?;
        Ok(Value::TypeRef {
          target_name: target_name.clone(),
          value: Box::new(ReflectedValue::new(ReflectedType::from_resolved(target_type), value)),
        })
      }
    }
  }

  /* Parse a primitive value */
  fn parse_primitive(&self, data: &[u8], prim_type: &PrimitiveType) -> Result<PrimitiveValue, ParseError> {
    match prim_type {
      PrimitiveType::Integral(int_type) => match int_type {
        IntegralType::U8 => {
          check_size(data, 1)?;
          Ok(PrimitiveValue::U8(PrimitiveValueU8 { type_name: "u8".to_string(), value: data[0] }))
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
  ) -> Result<Value, ParseError> {
    let mut parsed_fields = Vec::new();
    let mut offset = 0usize;
    let mut parsed_field_map = std::collections::HashMap::new();

    for field in fields {
      let field_offset = if packed {
        offset
      } else {
        /* Align offset to field alignment */
        let field_alignment = field.field_type.alignment as usize;
        align_up(offset, field_alignment)
      };

      /* Handle variable-size fields (enums, size-discriminated unions) */
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
          /* For variable-size fields, we need to determine the size dynamically */
          /* This happens for enums and size-discriminated unions */
          if let ResolvedTypeKind::Enum { tag_expression, variants, .. } = &field.field_type.kind {
            /* Evaluate tag expression to get tag value - use parsed fields for context */
            let tag_value = self.evaluate_tag_expression_with_context(tag_expression, data, fields, &parsed_field_map)?;

            /* Find matching variant */
            let variant = variants
              .iter()
              .find(|v| v.tag_value == tag_value)
              .ok_or_else(|| ParseError::InvalidEnumTag { value: tag_value })?;

            /* Get variant size */
            let variant_size = match &variant.variant_type.size {
              abi_gen::abi::resolved::Size::Const(size) => *size as usize,
              abi_gen::abi::resolved::Size::Variable(_) => {
                return Err(ParseError::ExpressionEvaluationFailed(
                  "Nested variable-size types not supported".to_string(),
                ));
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
            let variant_value = self.parse_value(variant_data, &variant.variant_type)?;
            let variant_type_info = ReflectedType::from_resolved(&variant.variant_type);
            let enum_value = Value::Enum {
              variant_name: variant.name.clone(),
              tag_value,
              variant_value: Box::new(ReflectedValue::new(variant_type_info, variant_value)),
            };
            let enum_type_info = ReflectedType::from_resolved(&field.field_type);
            let enum_reflected = ReflectedValue::new(enum_type_info, enum_value);
            parsed_fields.push((field.name.clone(), enum_reflected.clone()));
            parsed_field_map.insert(field.name.clone(), enum_reflected);
            offset = field_offset + variant_size;
            continue; /* Skip the normal field parsing below since we already handled it */
          }
          
          /* Handle size-discriminated unions */
          if let ResolvedTypeKind::SizeDiscriminatedUnion { variants } = &field.field_type.kind {
            /* For size-discriminated unions, determine size from available data */
            let remaining_size = data.len() - field_offset;
            let variant = variants
              .iter()
              .find(|v| v.expected_size == remaining_size as u64)
              .ok_or_else(|| {
                ParseError::InvalidSizeDiscriminatedUnionSize {
                  size: remaining_size,
                  expected: variants.iter().map(|v| v.expected_size).collect(),
                }
              })?;

            let variant_size = variant.expected_size as usize;
            if field_offset + variant_size > data.len() {
              return Err(ParseError::InsufficientData {
                needed: field_offset + variant_size,
                available: data.len(),
              });
            }

            (&data[field_offset..field_offset + variant_size], variant_size)
          } else {
            return Err(ParseError::ExpressionEvaluationFailed(
              format!("Unsupported variable-size field type: {:?}", field.field_type.kind),
            ));
          }
        }
      };

      let field_type_info = ReflectedType::from_resolved(&field.field_type);
      let field_value = self.parse_value(field_data, &field.field_type)?;
      let reflected_field = ReflectedValue::new(field_type_info, field_value);
      
      /* Add to parsed_field_map BEFORE adding to parsed_fields so it's available
       * for subsequent field evaluations (e.g., enum tag expressions) */
      parsed_field_map.insert(field.name.clone(), reflected_field.clone());
      parsed_fields.push((field.name.clone(), reflected_field));

      offset = field_offset + field_size;
    }

    Ok(Value::Struct { fields: parsed_fields })
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
      return Err(ParseError::TypeResolutionFailed("Union has no variants".to_string()));
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
    let variant_value = self.parse_value(variant_data, &variant.field_type)?;
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
  ) -> Result<Value, ParseError> {
    /* Evaluate tag expression to get tag value */
    /* Note: This is called from parse_value, so we don't have struct context here.
     * For enums in structs, the tag evaluation should happen in parse_struct before
     * calling parse_value. This function is for standalone enum parsing. */
    let tag_value = self.evaluate_tag_expression(tag_expression, data, resolved_type)?;

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
    let variant_value = self.parse_value(variant_data, &variant.variant_type)?;
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
  ) -> Result<Value, ParseError> {
    /* Evaluate size expression */
    let array_size = self.evaluate_size_expression(size_expression, data, resolved_type)?;

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
      let element_value = self.parse_value(element_data, element_type)?;
      elements.push(ReflectedValue::new(element_type_info.clone(), element_value));
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
      .ok_or_else(|| {
        ParseError::InvalidSizeDiscriminatedUnionSize {
          size: actual_size,
          expected: variants.iter().map(|v| v.expected_size).collect(),
        }
      })?;

    let variant_value = self.parse_value(data, &variant.variant_type)?;
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
          return Err(ParseError::ExpressionEvaluationFailed(
            format!("Type {} has variable size", sizeof_expr.type_name),
          ));
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
      return self.resolve_field_reference(field_ref.path.as_slice(), data, resolved_type);
    }

    /* For complex expressions, try to evaluate recursively */
    match expr {
      ExprKind::Add(e) => {
        let left = self.evaluate_tag_expression(&e.left, data, resolved_type)?;
        let right = self.evaluate_tag_expression(&e.right, data, resolved_type)?;
        Ok(left + right)
      }
      ExprKind::Sub(e) => {
        let left = self.evaluate_tag_expression(&e.left, data, resolved_type)?;
        let right = self.evaluate_tag_expression(&e.right, data, resolved_type)?;
        Ok(left - right)
      }
      ExprKind::Mul(e) => {
        let left = self.evaluate_tag_expression(&e.left, data, resolved_type)?;
        let right = self.evaluate_tag_expression(&e.right, data, resolved_type)?;
        Ok(left * right)
      }
      ExprKind::Div(e) => {
        let left = self.evaluate_tag_expression(&e.left, data, resolved_type)?;
        let right = self.evaluate_tag_expression(&e.right, data, resolved_type)?;
        if right == 0 {
          return Err(ParseError::ExpressionEvaluationFailed("Division by zero".to_string()));
        }
        Ok(left / right)
      }
      ExprKind::Mod(e) => {
        let left = self.evaluate_tag_expression(&e.left, data, resolved_type)?;
        let right = self.evaluate_tag_expression(&e.right, data, resolved_type)?;
        if right == 0 {
          return Err(ParseError::ExpressionEvaluationFailed("Modulo by zero".to_string()));
        }
        Ok(left % right)
      }
      ExprKind::BitAnd(e) => {
        let left = self.evaluate_tag_expression(&e.left, data, resolved_type)?;
        let right = self.evaluate_tag_expression(&e.right, data, resolved_type)?;
        Ok(left & right)
      }
      ExprKind::BitOr(e) => {
        let left = self.evaluate_tag_expression(&e.left, data, resolved_type)?;
        let right = self.evaluate_tag_expression(&e.right, data, resolved_type)?;
        Ok(left | right)
      }
      ExprKind::BitXor(e) => {
        let left = self.evaluate_tag_expression(&e.left, data, resolved_type)?;
        let right = self.evaluate_tag_expression(&e.right, data, resolved_type)?;
        Ok(left ^ right)
      }
      ExprKind::LeftShift(e) => {
        let left = self.evaluate_tag_expression(&e.left, data, resolved_type)?;
        let right = self.evaluate_tag_expression(&e.right, data, resolved_type)?;
        Ok(left << right)
      }
      ExprKind::RightShift(e) => {
        let left = self.evaluate_tag_expression(&e.left, data, resolved_type)?;
        let right = self.evaluate_tag_expression(&e.right, data, resolved_type)?;
        Ok(left >> right)
      }
      ExprKind::BitNot(e) => {
        let operand = self.evaluate_tag_expression(&e.operand, data, resolved_type)?;
        Ok(!operand)
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
  ) -> Result<usize, ParseError> {
    let value = self.evaluate_tag_expression(expr, data, resolved_type)?;
    Ok(value as usize)
  }

  /* Evaluate tag expression with struct field context */
  fn evaluate_tag_expression_with_context(
    &self,
    expr: &ExprKind,
    data: &[u8],
    struct_fields: &[abi_gen::abi::resolved::ResolvedField],
    parsed_fields: &std::collections::HashMap<String, ReflectedValue>,
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
          return Err(ParseError::ExpressionEvaluationFailed(
            format!("Type {} has variable size", sizeof_expr.type_name),
          ));
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
      return self.resolve_field_reference_with_context(field_ref.path.as_slice(), data, struct_fields, parsed_fields);
    }

    /* For complex expressions, try to evaluate recursively */
    match expr {
      ExprKind::Add(e) => {
        let left = self.evaluate_tag_expression_with_context(&e.left, data, struct_fields, parsed_fields)?;
        let right = self.evaluate_tag_expression_with_context(&e.right, data, struct_fields, parsed_fields)?;
        Ok(left + right)
      }
      ExprKind::Sub(e) => {
        let left = self.evaluate_tag_expression_with_context(&e.left, data, struct_fields, parsed_fields)?;
        let right = self.evaluate_tag_expression_with_context(&e.right, data, struct_fields, parsed_fields)?;
        Ok(left - right)
      }
      ExprKind::Mul(e) => {
        let left = self.evaluate_tag_expression_with_context(&e.left, data, struct_fields, parsed_fields)?;
        let right = self.evaluate_tag_expression_with_context(&e.right, data, struct_fields, parsed_fields)?;
        Ok(left * right)
      }
      ExprKind::Div(e) => {
        let left = self.evaluate_tag_expression_with_context(&e.left, data, struct_fields, parsed_fields)?;
        let right = self.evaluate_tag_expression_with_context(&e.right, data, struct_fields, parsed_fields)?;
        if right == 0 {
          return Err(ParseError::ExpressionEvaluationFailed("Division by zero".to_string()));
        }
        Ok(left / right)
      }
      ExprKind::Mod(e) => {
        let left = self.evaluate_tag_expression_with_context(&e.left, data, struct_fields, parsed_fields)?;
        let right = self.evaluate_tag_expression_with_context(&e.right, data, struct_fields, parsed_fields)?;
        if right == 0 {
          return Err(ParseError::ExpressionEvaluationFailed("Modulo by zero".to_string()));
        }
        Ok(left % right)
      }
      ExprKind::BitAnd(e) => {
        let left = self.evaluate_tag_expression_with_context(&e.left, data, struct_fields, parsed_fields)?;
        let right = self.evaluate_tag_expression_with_context(&e.right, data, struct_fields, parsed_fields)?;
        Ok(left & right)
      }
      ExprKind::BitOr(e) => {
        let left = self.evaluate_tag_expression_with_context(&e.left, data, struct_fields, parsed_fields)?;
        let right = self.evaluate_tag_expression_with_context(&e.right, data, struct_fields, parsed_fields)?;
        Ok(left | right)
      }
      ExprKind::BitXor(e) => {
        let left = self.evaluate_tag_expression_with_context(&e.left, data, struct_fields, parsed_fields)?;
        let right = self.evaluate_tag_expression_with_context(&e.right, data, struct_fields, parsed_fields)?;
        Ok(left ^ right)
      }
      ExprKind::LeftShift(e) => {
        let left = self.evaluate_tag_expression_with_context(&e.left, data, struct_fields, parsed_fields)?;
        let right = self.evaluate_tag_expression_with_context(&e.right, data, struct_fields, parsed_fields)?;
        Ok(left << right)
      }
      ExprKind::RightShift(e) => {
        let left = self.evaluate_tag_expression_with_context(&e.left, data, struct_fields, parsed_fields)?;
        let right = self.evaluate_tag_expression_with_context(&e.right, data, struct_fields, parsed_fields)?;
        Ok(left >> right)
      }
      ExprKind::BitNot(e) => {
        let operand = self.evaluate_tag_expression_with_context(&e.operand, data, struct_fields, parsed_fields)?;
        Ok(!operand)
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
    struct_fields: &[abi_gen::abi::resolved::ResolvedField],
    parsed_fields: &std::collections::HashMap<String, ReflectedValue>,
  ) -> Result<u64, ParseError> {
    if path.is_empty() {
      return Err(ParseError::FieldReferenceFailed("Empty field path".to_string()));
    }

    /* Try to find the field in parsed fields first */
    if let Some(field_value) = parsed_fields.get(&path[0]) {
      /* Extract primitive value from reflected field */
      if let Value::Primitive(prim_value) = &field_value.value {
        return prim_value.to_u64().ok_or_else(|| {
          ParseError::FieldReferenceFailed(format!("Field {} value cannot be converted to u64", path[0]))
        });
      } else {
        /* Field exists but is not a primitive - this shouldn't happen for tag fields */
        return Err(ParseError::FieldReferenceFailed(format!(
          "Field {} is not a primitive type (found in parsed_fields but value kind is {:?})",
          path[0], field_value.value
        )));
      }
    }
    
    /* Fall back to parsing from data - look for the field in struct_fields */
    for field in struct_fields {
      if field.name == path[0] {
        /* Get field offset */
        let field_offset = field.offset.ok_or_else(|| {
          ParseError::FieldReferenceFailed(format!("Field {} has no offset", field.name))
        })? as usize;

        /* Parse the field value */
        let field_size = match &field.field_type.size {
          abi_gen::abi::resolved::Size::Const(size) => *size as usize,
          abi_gen::abi::resolved::Size::Variable(_) => {
            return Err(ParseError::FieldReferenceFailed(
              "Variable-size fields not supported".to_string(),
            ));
          }
        };

        if field_offset + field_size > data.len() {
          return Err(ParseError::InsufficientData {
            needed: field_offset + field_size,
            available: data.len(),
          });
        }

        let field_data = &data[field_offset..field_offset + field_size];

        /* If this is a primitive, extract its value */
        if let ResolvedTypeKind::Primitive { prim_type } = &field.field_type.kind {
          let prim_value = self.parse_primitive(field_data, prim_type)?;
          return prim_value.to_u64().ok_or_else(|| {
            ParseError::FieldReferenceFailed("Field value cannot be converted to u64".to_string())
          });
        } else {
          return Err(ParseError::FieldReferenceFailed(format!(
            "Field {} is not a primitive type (found in struct_fields but type is {:?})",
            path[0], field.field_type.kind
          )));
        }
      }
    }

    /* If we get here, the field wasn't found - provide helpful error */
    let available_fields: Vec<String> = struct_fields.iter().map(|f| f.name.clone()).collect();
    let parsed_field_names: Vec<String> = parsed_fields.keys().cloned().collect();
    Err(ParseError::FieldReferenceFailed(format!(
      "Field not found: {} (available in struct_fields: {:?}, available in parsed_fields: {:?})",
      path.join("."),
      available_fields,
      parsed_field_names
    )))
  }

  /* Resolve field reference */
  fn resolve_field_reference(
    &self,
    path: &[String],
    data: &[u8],
    resolved_type: &ResolvedType,
  ) -> Result<u64, ParseError> {
    /* For now, we'll try to resolve from the current struct context */
    /* This is a simplified implementation - full implementation would need */
    /* to handle nested field references properly */
    if path.is_empty() {
      return Err(ParseError::FieldReferenceFailed("Empty field path".to_string()));
    }

    /* Try to find the field in the current type */
    if let ResolvedTypeKind::Struct { fields, .. } = &resolved_type.kind {
      for field in fields {
        if field.name == path[0] {
          /* Get field offset */
          let field_offset = field.offset.ok_or_else(|| {
            ParseError::FieldReferenceFailed(format!("Field {} has no offset", field.name))
          })? as usize;

          /* Parse the field value */
          let field_size = match &field.field_type.size {
            abi_gen::abi::resolved::Size::Const(size) => *size as usize,
            abi_gen::abi::resolved::Size::Variable(_) => {
              return Err(ParseError::FieldReferenceFailed(
                "Variable-size fields not supported".to_string(),
              ));
            }
          };

          if field_offset + field_size > data.len() {
            return Err(ParseError::InsufficientData {
              needed: field_offset + field_size,
              available: data.len(),
            });
          }

          let field_data = &data[field_offset..field_offset + field_size];

          /* If this is a primitive, extract its value */
          if let ResolvedTypeKind::Primitive { prim_type } = &field.field_type.kind {
            let prim_value = self.parse_primitive(field_data, prim_type)?;
            return prim_value.to_u64().ok_or_else(|| {
              ParseError::FieldReferenceFailed("Field value cannot be converted to u64".to_string())
            });
          }
        }
      }
    }

    Err(ParseError::FieldReferenceFailed(format!("Field not found: {}", path.join("."))))
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

