/* Opaque wrapper implementation for Rust codegen */

use super::helpers::{escape_rust_keyword, format_expr_to_rust};
use super::ir_helpers::{
    DynamicBinding, collect_dynamic_param_bindings, extract_payload_field_name,
    normalize_accessor_path, payload_field_offset, resolve_param_binding, sanitize_param_name,
};
use crate::abi::expr::ExprKind;
use crate::abi::resolved::{ResolvedField, ResolvedType, ResolvedTypeKind};
use crate::abi::types::{FloatingPointType, IntegralType, PrimitiveType};
use crate::codegen::shared::ir::TypeIr;
use std::collections::HashSet;
use std::fmt::Write;

/* Convert size expression to Rust code that calls getter methods */
fn size_expression_to_rust_getter_code(expr: &ExprKind, self_name: &str) -> String {
    match expr {
        ExprKind::Literal(lit) => {
            use crate::abi::expr::LiteralExpr;
            match lit {
                LiteralExpr::U64(v) => v.to_string(),
                LiteralExpr::U32(v) => v.to_string(),
                LiteralExpr::U16(v) => v.to_string(),
                LiteralExpr::U8(v) => v.to_string(),
                LiteralExpr::I64(v) => v.to_string(),
                LiteralExpr::I32(v) => v.to_string(),
                LiteralExpr::I16(v) => v.to_string(),
                LiteralExpr::I8(v) => v.to_string(),
            }
        }
        ExprKind::FieldRef(field_ref) => {
            /* Convert field reference to getter call */
            format!("{}.{}()", self_name, field_ref.path.join("_"))
        }
        ExprKind::Add(e) => {
            format!(
                "({} + {})",
                size_expression_to_rust_getter_code(&e.left, self_name),
                size_expression_to_rust_getter_code(&e.right, self_name)
            )
        }
        ExprKind::Mul(e) => {
            format!(
                "({} * {})",
                size_expression_to_rust_getter_code(&e.left, self_name),
                size_expression_to_rust_getter_code(&e.right, self_name)
            )
        }
        ExprKind::Sub(e) => {
            format!(
                "({} - {})",
                size_expression_to_rust_getter_code(&e.left, self_name),
                size_expression_to_rust_getter_code(&e.right, self_name)
            )
        }
        ExprKind::Div(e) => {
            format!(
                "({} / {})",
                size_expression_to_rust_getter_code(&e.left, self_name),
                size_expression_to_rust_getter_code(&e.right, self_name)
            )
        }
        ExprKind::BitAnd(e) => {
            format!(
                "({} & {})",
                size_expression_to_rust_getter_code(&e.left, self_name),
                size_expression_to_rust_getter_code(&e.right, self_name)
            )
        }
        ExprKind::BitOr(e) => {
            format!(
                "({} | {})",
                size_expression_to_rust_getter_code(&e.left, self_name),
                size_expression_to_rust_getter_code(&e.right, self_name)
            )
        }
        ExprKind::BitXor(e) => {
            format!(
                "({} ^ {})",
                size_expression_to_rust_getter_code(&e.left, self_name),
                size_expression_to_rust_getter_code(&e.right, self_name)
            )
        }
        _ => expr.to_c_string(), /* Fallback for unhandled cases */
    }
}

/* Check if size expression is a simple field-ref matching {field_name}_len pattern.
   This is used to avoid generating duplicate _len() methods when the array's size
   expression field-ref has the same name as the generated array length method. */
fn size_expr_matches_len_field(expr: &ExprKind, field_name: &str) -> bool {
    if let ExprKind::FieldRef(field_ref) = expr {
        // Check if path is a single element matching "{field_name}_len"
        if field_ref.path.len() == 1 {
            let expected_name = format!("{}_len", field_name);
            return field_ref.path[0] == expected_name;
        }
    }
    false
}

/* Convert expression to Rust code that reads from data array using field_offsets map */
fn expression_to_rust_data_read(
    expr: &ExprKind,
    field_offsets: &std::collections::HashMap<String, String>,
) -> String {
    use crate::abi::expr::LiteralExpr;

    match expr {
        ExprKind::Literal(lit) => match lit {
            LiteralExpr::U64(v) => v.to_string(),
            LiteralExpr::U32(v) => v.to_string(),
            LiteralExpr::U16(v) => v.to_string(),
            LiteralExpr::U8(v) => v.to_string(),
            LiteralExpr::I64(v) => v.to_string(),
            LiteralExpr::I32(v) => v.to_string(),
            LiteralExpr::I16(v) => v.to_string(),
            LiteralExpr::I8(v) => v.to_string(),
        },
        ExprKind::FieldRef(field_ref) => {
            /* Look up field offset and generate data read */
            /* Try full path first (for nested fields like "first.count"), then just the last component */
            let full_path = field_ref.path.join(".");
            let last_component = field_ref.path.last().map(|s| s.as_str()).unwrap_or("");

            if let Some(offset_expr) = field_offsets.get(&full_path) {
                format!("data[{}]", offset_expr)
            } else if let Some(offset_expr) = field_offsets.get(last_component) {
                format!("data[{}]", offset_expr)
            } else {
                "0".to_string()
            }
        }
        ExprKind::Add(e) => {
            format!(
                "({} + {})",
                expression_to_rust_data_read(&e.left, field_offsets),
                expression_to_rust_data_read(&e.right, field_offsets)
            )
        }
        ExprKind::Mul(e) => {
            format!(
                "({} * {})",
                expression_to_rust_data_read(&e.left, field_offsets),
                expression_to_rust_data_read(&e.right, field_offsets)
            )
        }
        ExprKind::Sub(e) => {
            format!(
                "({} - {})",
                expression_to_rust_data_read(&e.left, field_offsets),
                expression_to_rust_data_read(&e.right, field_offsets)
            )
        }
        ExprKind::Div(e) => {
            format!(
                "({} / {})",
                expression_to_rust_data_read(&e.left, field_offsets),
                expression_to_rust_data_read(&e.right, field_offsets)
            )
        }
        ExprKind::BitAnd(e) => {
            format!(
                "({} & {})",
                expression_to_rust_data_read(&e.left, field_offsets),
                expression_to_rust_data_read(&e.right, field_offsets)
            )
        }
        ExprKind::BitOr(e) => {
            format!(
                "({} | {})",
                expression_to_rust_data_read(&e.left, field_offsets),
                expression_to_rust_data_read(&e.right, field_offsets)
            )
        }
        ExprKind::BitXor(e) => {
            format!(
                "({} ^ {})",
                expression_to_rust_data_read(&e.left, field_offsets),
                expression_to_rust_data_read(&e.right, field_offsets)
            )
        }
        _ => "0".to_string(), /* Fallback */
    }
}

/* Helper to emit byte reading code for primitives */
fn emit_read_primitive(prim_type: &crate::abi::types::PrimitiveType, offset_expr: &str) -> String {
    use crate::abi::types::PrimitiveType;

    match prim_type {
        PrimitiveType::Integral(int_type) => match int_type {
            IntegralType::U8 | IntegralType::Char => format!("self.data[{}]", offset_expr),
            IntegralType::U16 => format!(
                "u16::from_le_bytes([self.data[{}], self.data[{} + 1]])",
                offset_expr, offset_expr
            ),
            IntegralType::U32 => format!(
                "u32::from_le_bytes([self.data[{}], self.data[{} + 1], self.data[{} + 2], self.data[{} + 3]])",
                offset_expr, offset_expr, offset_expr, offset_expr
            ),
            IntegralType::U64 => format!(
                "u64::from_le_bytes([self.data[{}], self.data[{} + 1], self.data[{} + 2], self.data[{} + 3], self.data[{} + 4], self.data[{} + 5], self.data[{} + 6], self.data[{} + 7]])",
                offset_expr,
                offset_expr,
                offset_expr,
                offset_expr,
                offset_expr,
                offset_expr,
                offset_expr,
                offset_expr
            ),
            IntegralType::I8 => format!("i8::from_le_bytes([self.data[{}]])", offset_expr),
            IntegralType::I16 => format!(
                "i16::from_le_bytes([self.data[{}], self.data[{} + 1]])",
                offset_expr, offset_expr
            ),
            IntegralType::I32 => format!(
                "i32::from_le_bytes([self.data[{}], self.data[{} + 1], self.data[{} + 2], self.data[{} + 3]])",
                offset_expr, offset_expr, offset_expr, offset_expr
            ),
            IntegralType::I64 => format!(
                "i64::from_le_bytes([self.data[{}], self.data[{} + 1], self.data[{} + 2], self.data[{} + 3], self.data[{} + 4], self.data[{} + 5], self.data[{} + 6], self.data[{} + 7]])",
                offset_expr,
                offset_expr,
                offset_expr,
                offset_expr,
                offset_expr,
                offset_expr,
                offset_expr,
                offset_expr
            ),
        },
        PrimitiveType::FloatingPoint(float_type) => match float_type {
            FloatingPointType::F16 => format!(
                "f16::from_le_bytes([self.data[{}], self.data[{} + 1]])",
                offset_expr, offset_expr
            ),
            FloatingPointType::F32 => format!(
                "f32::from_le_bytes([self.data[{}], self.data[{} + 1], self.data[{} + 2], self.data[{} + 3]])",
                offset_expr, offset_expr, offset_expr, offset_expr
            ),
            FloatingPointType::F64 => format!(
                "f64::from_le_bytes([self.data[{}], self.data[{} + 1], self.data[{} + 2], self.data[{} + 3], self.data[{} + 4], self.data[{} + 5], self.data[{} + 6], self.data[{} + 7]])",
                offset_expr,
                offset_expr,
                offset_expr,
                offset_expr,
                offset_expr,
                offset_expr,
                offset_expr,
                offset_expr
            ),
        },
    }
}

/* Helper to emit byte writing code for primitives */
fn emit_write_primitive(
    prim_type: &crate::abi::types::PrimitiveType,
    offset_expr: &str,
    value_expr: &str,
) -> String {
    use crate::abi::types::PrimitiveType;

    match prim_type {
        PrimitiveType::Integral(int_type) => match int_type {
            IntegralType::U8 | IntegralType::Char => format!("self.data[{}] = {};", offset_expr, value_expr),
            IntegralType::U16 | IntegralType::I16 => format!(
                "self.data[{}..{} + 2].copy_from_slice(&{}.to_le_bytes());",
                offset_expr, offset_expr, value_expr
            ),
            IntegralType::U32 | IntegralType::I32 => format!(
                "self.data[{}..{} + 4].copy_from_slice(&{}.to_le_bytes());",
                offset_expr, offset_expr, value_expr
            ),
            IntegralType::U64 | IntegralType::I64 => format!(
                "self.data[{}..{} + 8].copy_from_slice(&{}.to_le_bytes());",
                offset_expr, offset_expr, value_expr
            ),
            IntegralType::I8 => format!("self.data[{}] = {} as u8;", offset_expr, value_expr),
        },
        PrimitiveType::FloatingPoint(float_type) => match float_type {
            FloatingPointType::F16 => format!(
                "self.data[{}..{} + 2].copy_from_slice(&{}.to_le_bytes());",
                offset_expr, offset_expr, value_expr
            ),
            FloatingPointType::F32 => format!(
                "self.data[{}..{} + 4].copy_from_slice(&{}.to_le_bytes());",
                offset_expr, offset_expr, value_expr
            ),
            FloatingPointType::F64 => format!(
                "self.data[{}..{} + 8].copy_from_slice(&{}.to_le_bytes());",
                offset_expr, offset_expr, value_expr
            ),
        },
    }
}

/* Helper to get size of primitive type */
fn primitive_size(prim_type: &crate::abi::types::PrimitiveType) -> usize {
    use crate::abi::types::PrimitiveType;

    match prim_type {
        PrimitiveType::Integral(int_type) => match int_type {
            IntegralType::U8 | IntegralType::I8 | IntegralType::Char => 1,
            IntegralType::U16 | IntegralType::I16 => 2,
            IntegralType::U32 | IntegralType::I32 => 4,
            IntegralType::U64 | IntegralType::I64 => 8,
        },
        PrimitiveType::FloatingPoint(float_type) => match float_type {
            FloatingPointType::F16 => 2,
            FloatingPointType::F32 => 4,
            FloatingPointType::F64 => 8,
        },
    }
}

/* Extract field names that are referenced in struct field expressions (like enum tag-refs and FAM sizes) */
fn extract_referenced_fields(fields: &[ResolvedField]) -> HashSet<String> {
    let mut referenced = HashSet::new();

    for field in fields {
        match &field.field_type.kind {
            ResolvedTypeKind::Enum { tag_expression, .. } => {
                // Extract field refs from tag expression
                extract_field_refs_from_expr(tag_expression, &mut referenced);
            }
            ResolvedTypeKind::Array {
                size_expression, ..
            } => {
                // Extract field refs from FAM size expression
                if !matches!(field.field_type.size, crate::abi::resolved::Size::Const(..)) {
                    extract_field_refs_from_expr(size_expression, &mut referenced);
                }
            }
            ResolvedTypeKind::Struct {
                fields: nested_fields,
                ..
            } => {
                /* Recurse into nested struct fields */
                for nested_field in nested_fields {
                    match &nested_field.field_type.kind {
                        ResolvedTypeKind::Array {
                            size_expression, ..
                        } => {
                            if !matches!(
                                nested_field.field_type.size,
                                crate::abi::resolved::Size::Const(..)
                            ) {
                                extract_field_refs_from_expr(size_expression, &mut referenced);
                            }
                        }
                        ResolvedTypeKind::Enum { tag_expression, .. } => {
                            extract_field_refs_from_expr(tag_expression, &mut referenced);
                        }
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }

    referenced
}

/* Recursively extract field references from an expression */
fn extract_field_refs_from_expr(expr: &ExprKind, refs: &mut HashSet<String>) {
    match expr {
        ExprKind::FieldRef(field_ref) => {
            // Join the full path with underscores for nested field refs
            // e.g., ["first", "count"] becomes "first_count"
            let full_path = field_ref.path.join("_");
            refs.insert(full_path);
        }
        // Binary operations - recursively check both sides
        ExprKind::Add(e) => {
            extract_field_refs_from_expr(&e.left, refs);
            extract_field_refs_from_expr(&e.right, refs);
        }
        ExprKind::Sub(e) => {
            extract_field_refs_from_expr(&e.left, refs);
            extract_field_refs_from_expr(&e.right, refs);
        }
        ExprKind::Mul(e) => {
            extract_field_refs_from_expr(&e.left, refs);
            extract_field_refs_from_expr(&e.right, refs);
        }
        ExprKind::Div(e) => {
            extract_field_refs_from_expr(&e.left, refs);
            extract_field_refs_from_expr(&e.right, refs);
        }
        ExprKind::Mod(e) => {
            extract_field_refs_from_expr(&e.left, refs);
            extract_field_refs_from_expr(&e.right, refs);
        }
        ExprKind::Pow(e) => {
            extract_field_refs_from_expr(&e.left, refs);
            extract_field_refs_from_expr(&e.right, refs);
        }
        ExprKind::BitAnd(e) => {
            extract_field_refs_from_expr(&e.left, refs);
            extract_field_refs_from_expr(&e.right, refs);
        }
        ExprKind::BitOr(e) => {
            extract_field_refs_from_expr(&e.left, refs);
            extract_field_refs_from_expr(&e.right, refs);
        }
        ExprKind::BitXor(e) => {
            extract_field_refs_from_expr(&e.left, refs);
            extract_field_refs_from_expr(&e.right, refs);
        }
        ExprKind::LeftShift(e) => {
            extract_field_refs_from_expr(&e.left, refs);
            extract_field_refs_from_expr(&e.right, refs);
        }
        ExprKind::RightShift(e) => {
            extract_field_refs_from_expr(&e.left, refs);
            extract_field_refs_from_expr(&e.right, refs);
        }
        // Unary operations
        ExprKind::BitNot(e) => {
            extract_field_refs_from_expr(&e.operand, refs);
        }
        ExprKind::Neg(e) => {
            extract_field_refs_from_expr(&e.operand, refs);
        }
        ExprKind::Not(e) => {
            extract_field_refs_from_expr(&e.operand, refs);
        }
        ExprKind::Popcount(e) => {
            extract_field_refs_from_expr(&e.operand, refs);
        }
        // Literals, sizeof, alignof don't reference fields
        _ => {}
    }
}

/* Generate impl block for opaque wrapper structs */
pub fn emit_opaque_functions(
    resolved_type: &ResolvedType,
    type_ir: Option<&TypeIr>,
    ir_error: Option<&str>,
) -> String {
    let mut output = String::new();

    match &resolved_type.kind {
        ResolvedTypeKind::Struct { fields, .. } => {
            /* Convert type name from "Parent::nested" to "Parent_nested" for Rust syntax */
            let type_name = resolved_type.name.replace("::", "_");
            let mut ir_call: Option<(&TypeIr, IrValidateCallData)> = None;
            let mut ir_comment: Option<String> = None;

            if let Some(ir) = type_ir {
                match prepare_ir_validate_call(resolved_type, ir) {
                    Ok(data) => ir_call = Some((ir, data)),
                    Err(missing) => {
                        if !missing.is_empty() {
                            ir_comment = Some(format!(
                                "IR validator check skipped (missing params: {})",
                                missing.join(", ")
                            ));
                        }
                    }
                }
            } else if let Some(msg) = ir_error {
                ir_comment = Some(format!("IR validator unavailable: {}", msg));
            }

            // Generate impl for immutable version
            write!(output, "impl<'a> {}<'a> {{\n", type_name).unwrap();

            // from_slice() constructor
            write!(
                output,
                "    pub fn from_slice(data: &'a [u8]) -> Result<Self, &'static str> {{\n"
            )
            .unwrap();
            write!(output, "        Self::validate(data)?;\n").unwrap();
            write!(output, "        Ok(Self {{ data }})\n").unwrap();
            write!(output, "    }}\n\n").unwrap();

            /* Check if this is a nested inline struct (name contains "::") */
            let is_nested = resolved_type.name.contains("::");

            /* Only generate new() constructor for top-level types, not nested inline structs */
            let ir_call_string = ir_call
                .as_ref()
                .map(|(ir, data)| format_ir_validate_call(ir, &data.args));

            if !is_nested {
                // new() constructor - initializes provided buffer (no allocation)
                // Only include primitive fields that are referenced in expressions (like enum tags)
                let referenced_fields = extract_referenced_fields(fields);

                write!(output, "    pub fn new(buffer: &mut [u8]").unwrap();

                // Generate parameters in field order by iterating through fields and checking if referenced
                // First collect top-level referenced primitives
                for field in fields {
                    if let ResolvedTypeKind::Primitive { prim_type } = &field.field_type.kind {
                        if referenced_fields.contains(&field.name) {
                            write!(output, ", ").unwrap();
                            let rust_type = match prim_type {
                                crate::abi::types::PrimitiveType::Integral(int_type) => {
                                    match int_type {
                                        IntegralType::U8 => "u8",
                                        IntegralType::U16 => "u16",
                                        IntegralType::U32 => "u32",
                                        IntegralType::U64 => "u64",
                                        IntegralType::I8 => "i8",
                                        IntegralType::I16 => "i16",
                                        IntegralType::I32 => "i32",
                                        IntegralType::I64 => "i64",
                                        IntegralType::Char => "u8",
                                    }
                                }
                                crate::abi::types::PrimitiveType::FloatingPoint(float_type) => {
                                    match float_type {
                                        FloatingPointType::F16 => "f16",
                                        FloatingPointType::F32 => "f32",
                                        FloatingPointType::F64 => "f64",
                                    }
                                }
                            };
                            write!(output, "{}: {}", field.name, rust_type).unwrap();
                        }
                    }
                }

                // Then collect nested referenced primitives in field order
                for field in fields {
                    if let ResolvedTypeKind::Struct {
                        fields: nested_fields,
                        ..
                    } = &field.field_type.kind
                    {
                        for nested_field in nested_fields {
                            if let ResolvedTypeKind::Primitive { prim_type } =
                                &nested_field.field_type.kind
                            {
                                let nested_path = format!("{}_{}", field.name, nested_field.name);
                                if referenced_fields.contains(&nested_path) {
                                    write!(output, ", ").unwrap();
                                    let rust_type = match prim_type {
                                        crate::abi::types::PrimitiveType::Integral(int_type) => {
                                            match int_type {
                                                IntegralType::U8 => "u8",
                                                IntegralType::U16 => "u16",
                                                IntegralType::U32 => "u32",
                                                IntegralType::U64 => "u64",
                                                IntegralType::I8 => "i8",
                                                IntegralType::I16 => "i16",
                                                IntegralType::I32 => "i32",
                                                IntegralType::I64 => "i64",
                                                IntegralType::Char => "u8",
                                            }
                                        }
                                        crate::abi::types::PrimitiveType::FloatingPoint(
                                            float_type,
                                        ) => match float_type {
                                            FloatingPointType::F16 => "f16",
                                            FloatingPointType::F32 => "f32",
                                            FloatingPointType::F64 => "f64",
                                        },
                                    };
                                    write!(output, "{}: {}", nested_path, rust_type).unwrap();
                                }
                            }
                        }
                    }
                }

                // Add tag parameters for size-discriminated union fields
                for field in fields {
                    if matches!(
                        &field.field_type.kind,
                        ResolvedTypeKind::SizeDiscriminatedUnion { .. }
                    ) {
                        write!(output, ", {}_tag: u8", field.name).unwrap();
                    }
                }

                write!(output, ") -> Result<usize, &'static str> {{\n").unwrap();

                // Calculate required size by summing all field sizes
                write!(output, "        let mut required_size: usize = 0;\n").unwrap();
                for field in fields.iter() {
                    match &field.field_type.kind {
                        ResolvedTypeKind::Primitive { prim_type } => {
                            let field_size = primitive_size(prim_type);
                            write!(
                                output,
                                "        required_size += {}; // {}\n",
                                field_size, field.name
                            )
                            .unwrap();
                        }
                        ResolvedTypeKind::Enum {
                            variants,
                            tag_expression,
                            ..
                        } => {
                            // Calculate enum size based on tag value (passed as parameter)
                            write!(
                                output,
                                "        /* Calculate enum '{}' size based on tag */\n",
                                field.name
                            )
                            .unwrap();

                            // Extract field references from tag expression
                            let mut tag_field_refs = HashSet::new();
                            extract_field_refs_from_expr(tag_expression, &mut tag_field_refs);
                            let tag_params: Vec<String> = tag_field_refs.into_iter().collect();

                            // Generate tag expression code
                            let tag_expr = format_expr_to_rust(tag_expression, &tag_params);

                            write!(
                                output,
                                "        let {}_size = match ({}) as u8 {{\n",
                                field.name, tag_expr
                            )
                            .unwrap();
                            for variant in variants {
                                if let crate::abi::resolved::Size::Const(size) =
                                    variant.variant_type.size
                                {
                                    write!(
                                        output,
                                        "            {} => {},\n",
                                        variant.tag_value, size
                                    )
                                    .unwrap();
                                }
                            }
                            write!(
                                output,
                                "            _ => return Err(\"Invalid enum tag\"),\n"
                            )
                            .unwrap();
                            write!(output, "        }};\n").unwrap();
                            write!(output, "        required_size += {}_size;\n\n", field.name)
                                .unwrap();
                        }
                        ResolvedTypeKind::SizeDiscriminatedUnion { variants } => {
                            // Size-discriminated union: size is determined from tag parameter
                            let tag_param = format!("{}_tag", field.name);
                            write!(
                                output,
                                "        let {}_size = match {} {{\n",
                                field.name, tag_param
                            )
                            .unwrap();
                            for (idx, variant) in variants.iter().enumerate() {
                                write!(
                                    output,
                                    "            {} => {},\n",
                                    idx, variant.expected_size
                                )
                                .unwrap();
                            }
                            write!(output, "            _ => return Err(\"Invalid tag for size-discriminated union '{}'\"),\n", field.name).unwrap();
                            write!(output, "        }};\n").unwrap();
                            write!(output, "        required_size += {}_size; // {} (size-discriminated union)\n", field.name, field.name).unwrap();
                        }
                        ResolvedTypeKind::Array {
                            element_type,
                            size_expression,
                            ..
                        } => {
                            // Add array size
                            if let crate::abi::resolved::Size::Const(size) = field.field_type.size {
                                write!(
                                    output,
                                    "        required_size += {}; // {} (array)\n",
                                    size, field.name
                                )
                                .unwrap();
                            } else {
                                // Variable-size array - calculate from size expression
                                if let crate::abi::resolved::Size::Const(elem_size) =
                                    element_type.size
                                {
                                    // For new(), extract field refs and convert to parameter names
                                    let mut field_refs = HashSet::new();
                                    extract_field_refs_from_expr(size_expression, &mut field_refs);
                                    let params: Vec<String> = field_refs.into_iter().collect();
                                    let size_calc = format_expr_to_rust(size_expression, &params);
                                    write!(output, "        required_size += (({}) * {}) as usize; // {} (variable array)\n",
                                       size_calc, elem_size, field.name).unwrap();
                                }
                            }
                        }
                        ResolvedTypeKind::TypeRef { .. } => {
                            // Add nested struct size
                            if let crate::abi::resolved::Size::Const(size) = field.field_type.size {
                                write!(
                                    output,
                                    "        required_size += {}; // {} (nested struct)\n",
                                    size, field.name
                                )
                                .unwrap();
                            }
                        }
                        ResolvedTypeKind::Struct {
                            fields: nested_fields,
                            ..
                        } => {
                            /* Inline nested struct - calculate size */
                            if let crate::abi::resolved::Size::Const(size) = field.field_type.size {
                                write!(
                                    output,
                                    "        required_size += {}; // {} (inline nested struct)\n",
                                    size, field.name
                                )
                                .unwrap();
                            } else {
                                /* Variable-size inline nested struct */
                                write!(output, "        /* Calculate variable-size inline nested struct '{}' */\n", field.name).unwrap();
                                for nested_field in nested_fields {
                                    match &nested_field.field_type.kind {
                                        ResolvedTypeKind::Primitive { prim_type } => {
                                            let nested_size = primitive_size(prim_type);
                                            write!(
                                                output,
                                                "        required_size += {}; // {}.{}\n",
                                                nested_size, field.name, nested_field.name
                                            )
                                            .unwrap();
                                        }
                                        ResolvedTypeKind::Array {
                                            element_type,
                                            size_expression,
                                            ..
                                        } => {
                                            if let crate::abi::resolved::Size::Const(array_size) =
                                                nested_field.field_type.size
                                            {
                                                write!(output, "        required_size += {}; // {}.{} (array)\n", array_size, field.name, nested_field.name).unwrap();
                                            } else {
                                                /* Variable-size array - use parameter names from size expression */
                                                if let crate::abi::resolved::Size::Const(
                                                    elem_size,
                                                ) = element_type.size
                                                {
                                                    /* Extract field refs and convert to parameter names */
                                                    let mut field_refs = HashSet::new();
                                                    extract_field_refs_from_expr(
                                                        size_expression,
                                                        &mut field_refs,
                                                    );
                                                    let params: Vec<String> =
                                                        field_refs.into_iter().collect();
                                                    let size_calc = format_expr_to_rust(
                                                        size_expression,
                                                        &params,
                                                    );
                                                    write!(output, "        required_size += (({}) * {}) as usize; // {}.{} (variable array)\n",
                                                       size_calc, elem_size, field.name, nested_field.name).unwrap();
                                                }
                                            }
                                        }
                                        _ => {}
                                    }
                                }
                            }
                        }
                        _ => {}
                    }
                }

                // Validate buffer size
                write!(output, "\n        if buffer.len() < required_size {{\n").unwrap();
                write!(output, "            return Err(\"Buffer too small\");\n").unwrap();
                write!(output, "        }}\n\n").unwrap();

                // Zero-initialize buffer
                write!(output, "        buffer[..required_size].fill(0);\n\n").unwrap();
                write!(output, "        let mut offset = 0;\n\n").unwrap();

                // Write each field
                for field in fields.iter() {
                    match &field.field_type.kind {
                        ResolvedTypeKind::Primitive { prim_type } => {
                            let size = primitive_size(prim_type);

                            // If this field is referenced (passed as parameter), write its value
                            if referenced_fields.contains(&field.name) {
                                let write_expr =
                                    emit_write_primitive(prim_type, "offset", &field.name);
                                write!(
                                    output,
                                    "        {}\n",
                                    write_expr.replace("self.data", "buffer")
                                )
                                .unwrap();
                            }
                            write!(output, "        offset += {};\n\n", size).unwrap();
                        }
                        ResolvedTypeKind::Enum { .. } => {
                            // Enums are set via setters after new() - skip the variable-sized space
                            write!(output, "        offset += {}_size; // skip enum '{}' (set via setters)\n\n", field.name, field.name).unwrap();
                        }
                        ResolvedTypeKind::SizeDiscriminatedUnion { variants } => {
                            // Size-discriminated unions have variable size - calculate size from tag
                            let tag_param = format!("{}_tag", field.name);
                            write!(
                                output,
                                "        let {}_size = match {} {{\n",
                                field.name, tag_param
                            )
                            .unwrap();
                            for (idx, variant) in variants.iter().enumerate() {
                                write!(
                                    output,
                                    "            {} => {},\n",
                                    idx, variant.expected_size
                                )
                                .unwrap();
                            }
                            write!(output, "            _ => return Err(\"Invalid tag for size-discriminated union '{}'\"),\n", field.name).unwrap();
                            write!(output, "        }};\n").unwrap();
                            write!(output, "        offset += {}_size; // skip size-discriminated union '{}' (set via setters)\n\n", field.name, field.name).unwrap();
                        }
                        ResolvedTypeKind::Array {
                            element_type,
                            size_expression,
                            ..
                        } => {
                            // Skip array (set via setters after new())
                            if let crate::abi::resolved::Size::Const(size) = field.field_type.size {
                                write!(output, "        offset += {}; // skip array '{}' (set via setters)\n\n", size, field.name).unwrap();
                            } else {
                                // Variable-size array - calculate offset skip from size expression
                                if let crate::abi::resolved::Size::Const(elem_size) =
                                    element_type.size
                                {
                                    let mut field_refs = HashSet::new();
                                    extract_field_refs_from_expr(size_expression, &mut field_refs);
                                    let params: Vec<String> = field_refs.into_iter().collect();
                                    let size_calc = format_expr_to_rust(size_expression, &params);
                                    write!(output, "        offset += (({}) * {}) as usize; // skip variable array '{}' (set via setters)\n\n",
                                       size_calc, elem_size, field.name).unwrap();
                                }
                            }
                        }
                        ResolvedTypeKind::TypeRef { .. } => {
                            // Skip nested struct (set via setters after new())
                            if let crate::abi::resolved::Size::Const(size) = field.field_type.size {
                                write!(output, "        offset += {}; // skip nested struct '{}' (set via setters)\n\n", size, field.name).unwrap();
                            }
                        }
                        ResolvedTypeKind::Struct {
                            fields: nested_fields,
                            ..
                        } => {
                            /* For inline nested structs, write referenced primitives, skip others */
                            if let crate::abi::resolved::Size::Const(_size) = field.field_type.size
                            {
                                /* Const-size nested struct - write referenced fields, skip the rest */
                                for nested_field in nested_fields {
                                    if let ResolvedTypeKind::Primitive { prim_type } =
                                        &nested_field.field_type.kind
                                    {
                                        let nested_path =
                                            format!("{}_{}", field.name, nested_field.name);
                                        let nested_size = primitive_size(prim_type);

                                        if referenced_fields.contains(&nested_path) {
                                            /* This nested primitive is referenced - write its value */
                                            write!(output, "        buffer[offset..offset + {}].copy_from_slice(&{}.to_le_bytes());\n",
                                               nested_size, nested_path).unwrap();
                                        }
                                        write!(
                                            output,
                                            "        offset += {}; // {}.{}\n",
                                            nested_size, field.name, nested_field.name
                                        )
                                        .unwrap();
                                    }
                                }
                                write!(output, "\n").unwrap();
                            } else {
                                /* Variable-size inline nested struct - skip fields */
                                for nested_field in nested_fields {
                                    match &nested_field.field_type.kind {
                                        ResolvedTypeKind::Primitive { prim_type } => {
                                            let nested_size = primitive_size(prim_type);
                                            write!(
                                                output,
                                                "        offset += {}; // skip {}.{}\n",
                                                nested_size, field.name, nested_field.name
                                            )
                                            .unwrap();
                                        }
                                        ResolvedTypeKind::Array {
                                            element_type,
                                            size_expression,
                                            ..
                                        } => {
                                            if let crate::abi::resolved::Size::Const(array_size) =
                                                nested_field.field_type.size
                                            {
                                                write!(
                                                    output,
                                                    "        offset += {}; // skip {}.{} (array)\n",
                                                    array_size, field.name, nested_field.name
                                                )
                                                .unwrap();
                                            } else {
                                                /* Variable-size array - use parameter names from size expression */
                                                if let crate::abi::resolved::Size::Const(
                                                    elem_size,
                                                ) = element_type.size
                                                {
                                                    let mut field_refs = HashSet::new();
                                                    extract_field_refs_from_expr(
                                                        size_expression,
                                                        &mut field_refs,
                                                    );
                                                    let params: Vec<String> =
                                                        field_refs.into_iter().collect();
                                                    let size_calc = format_expr_to_rust(
                                                        size_expression,
                                                        &params,
                                                    );
                                                    write!(output, "        offset += (({}) * {}) as usize; // skip {}.{} (variable array)\n",
                                                       size_calc, elem_size, field.name, nested_field.name).unwrap();
                                                }
                                            }
                                        }
                                        _ => {}
                                    }
                                }
                                write!(output, "\n").unwrap();
                            }
                        }
                        _ => {}
                    }
                }

                write!(output, "        Ok(required_size)\n").unwrap();
                write!(output, "    }}\n\n").unwrap();
            } /* end if !is_nested */

            // Generate getters for each field
            for (field_idx, field) in fields.iter().enumerate() {
                match &field.field_type.kind {
                    ResolvedTypeKind::Primitive { prim_type } => {
                        let rust_type = match prim_type {
                            crate::abi::types::PrimitiveType::Integral(int_type) => {
                                match int_type {
                                    IntegralType::U8 => "u8",
                                    IntegralType::U16 => "u16",
                                    IntegralType::U32 => "u32",
                                    IntegralType::U64 => "u64",
                                    IntegralType::I8 => "i8",
                                    IntegralType::I16 => "i16",
                                    IntegralType::I32 => "i32",
                                    IntegralType::I64 => "i64",
                                    IntegralType::Char => "u8",
                                }
                            }
                            crate::abi::types::PrimitiveType::FloatingPoint(float_type) => {
                                match float_type {
                                    FloatingPointType::F16 => "f16",
                                    FloatingPointType::F32 => "f32",
                                    FloatingPointType::F64 => "f64",
                                }
                            }
                        };

                        write!(
                            output,
                            "    pub fn {}(&self) -> {} {{\n",
                            field.name, rust_type
                        )
                        .unwrap();

                        // Calculate offset based on previous fields
                        if field_idx == 0 {
                            // First field at offset 0
                            let read_expr = emit_read_primitive(prim_type, "0");
                            write!(output, "        {}\n", read_expr).unwrap();
                        } else {
                            // Need to calculate offset based on previous fields
                            write!(output, "        let mut offset = 0;\n").unwrap();
                            for prev_field in &fields[0..field_idx] {
                                match &prev_field.field_type.kind {
                                    ResolvedTypeKind::Primitive {
                                        prim_type: prev_prim,
                                    } => {
                                        let size = primitive_size(prev_prim);
                                        write!(
                                            output,
                                            "        offset += {}; // {}\n",
                                            size, prev_field.name
                                        )
                                        .unwrap();
                                    }
                                    ResolvedTypeKind::Enum { .. } => {
                                        write!(output, "        offset += self.{}_size(); // {} (variable size)\n", prev_field.name, prev_field.name).unwrap();
                                    }
                                    ResolvedTypeKind::Array {
                                        element_type,
                                        size_expression,
                                        ..
                                    } => {
                                        if let crate::abi::resolved::Size::Const(size) =
                                            prev_field.field_type.size
                                        {
                                            write!(
                                                output,
                                                "        offset += {}; // {} (array)\n",
                                                size, prev_field.name
                                            )
                                            .unwrap();
                                        } else {
                                            // Variable-size array - calculate size using inline field access
                                            if let crate::abi::resolved::Size::Const(elem_size) =
                                                element_type.size
                                            {
                                                let size_expr = size_expression_to_rust_getter_code(
                                                    size_expression,
                                                    "self",
                                                );
                                                write!(output, "        offset += (({}) as usize) * {}; // {} (variable array)\n",
                                                       size_expr, elem_size, prev_field.name).unwrap();
                                            }
                                        }
                                    }
                                    ResolvedTypeKind::TypeRef { .. } => {
                                        if let crate::abi::resolved::Size::Const(size) =
                                            prev_field.field_type.size
                                        {
                                            write!(
                                                output,
                                                "        offset += {}; // {} (nested struct)\n",
                                                size, prev_field.name
                                            )
                                            .unwrap();
                                        }
                                    }
                                    _ => {
                                        write!(
                                            output,
                                            "        // TODO: handle {} of type {:?}\n",
                                            prev_field.name, prev_field.field_type.kind
                                        )
                                        .unwrap();
                                    }
                                }
                            }
                            let read_expr = emit_read_primitive(prim_type, "offset");
                            write!(output, "        {}\n", read_expr).unwrap();
                        }

                        write!(output, "    }}\n\n").unwrap();
                    }
                    ResolvedTypeKind::Enum {
                        variants,
                        tag_expression,
                        ..
                    } => {
                        // Generate size helper for this enum
                        write!(output, "    fn {}_size(&self) -> usize {{\n", field.name).unwrap();

                        // Generate tag expression code using getter methods
                        let tag_expr = size_expression_to_rust_getter_code(tag_expression, "self");
                        write!(output, "        let tag = ({}) as u8;\n", tag_expr).unwrap();

                        write!(output, "        match tag {{\n").unwrap();
                        for variant in variants {
                            if let crate::abi::resolved::Size::Const(size) =
                                variant.variant_type.size
                            {
                                write!(output, "            {} => {},\n", variant.tag_value, size)
                                    .unwrap();
                            }
                        }
                        write!(output, "            _ => 0,\n").unwrap();
                        write!(output, "        }}\n").unwrap();
                        write!(output, "    }}\n\n").unwrap();

                        // Generate getter for enum body bytes
                        write!(
                            output,
                            "    pub fn {}_body(&self) -> &[u8] {{\n",
                            field.name
                        )
                        .unwrap();

                        // Calculate offset to enum body
                        if field_idx == 0 {
                            write!(output, "        let offset = 0;\n").unwrap();
                        } else {
                            write!(output, "        let mut offset = 0;\n").unwrap();
                            for prev_field in &fields[0..field_idx] {
                                match &prev_field.field_type.kind {
                                    ResolvedTypeKind::Primitive {
                                        prim_type: prev_prim,
                                    } => {
                                        let size = primitive_size(prev_prim);
                                        write!(
                                            output,
                                            "        offset += {}; // {}\n",
                                            size, prev_field.name
                                        )
                                        .unwrap();
                                    }
                                    ResolvedTypeKind::Enum { .. } => {
                                        write!(output, "        offset += self.{}_size(); // {} (variable size)\n", prev_field.name, prev_field.name).unwrap();
                                    }
                                    ResolvedTypeKind::Array {
                                        element_type,
                                        size_expression,
                                        ..
                                    } => {
                                        if let crate::abi::resolved::Size::Const(size) =
                                            prev_field.field_type.size
                                        {
                                            write!(
                                                output,
                                                "        offset += {}; // {} (array)\n",
                                                size, prev_field.name
                                            )
                                            .unwrap();
                                        } else {
                                            // Variable-size array - calculate size using inline field access
                                            if let crate::abi::resolved::Size::Const(elem_size) =
                                                element_type.size
                                            {
                                                let size_expr = size_expression_to_rust_getter_code(
                                                    size_expression,
                                                    "self",
                                                );
                                                write!(output, "        offset += (({}) as usize) * {}; // {} (variable array)\n",
                                                       size_expr, elem_size, prev_field.name).unwrap();
                                            }
                                        }
                                    }
                                    ResolvedTypeKind::TypeRef { .. } => {
                                        if let crate::abi::resolved::Size::Const(size) =
                                            prev_field.field_type.size
                                        {
                                            write!(
                                                output,
                                                "        offset += {}; // {} (nested struct)\n",
                                                size, prev_field.name
                                            )
                                            .unwrap();
                                        }
                                    }
                                    _ => {}
                                }
                            }
                        }

                        write!(output, "        let size = self.{}_size();\n", field.name).unwrap();
                        write!(output, "        &self.data[offset..offset + size]\n").unwrap();
                        write!(output, "    }}\n\n").unwrap();
                    }
                    ResolvedTypeKind::SizeDiscriminatedUnion { variants } => {
                        // Generate tag function for size-discriminated union
                        let type_name_snake = field.name.replace("-", "_");
                        write!(
                            output,
                            "    pub fn {}_tag(&self) -> u8 {{\n",
                            type_name_snake
                        )
                        .unwrap();

                        // Calculate offset to size-discriminated union
                        if field_idx == 0 {
                            write!(output, "        let offset = 0;\n").unwrap();
                        } else {
                            write!(output, "        let mut offset = 0;\n").unwrap();
                            for prev_field in &fields[0..field_idx] {
                                match &prev_field.field_type.kind {
                                    ResolvedTypeKind::Primitive {
                                        prim_type: prev_prim,
                                    } => {
                                        let size = primitive_size(prev_prim);
                                        write!(
                                            output,
                                            "        offset += {}; // {}\n",
                                            size, prev_field.name
                                        )
                                        .unwrap();
                                    }
                                    ResolvedTypeKind::Enum { .. } => {
                                        write!(output, "        offset += self.{}_size(); // {} (variable size)\n", prev_field.name, prev_field.name).unwrap();
                                    }
                                    ResolvedTypeKind::SizeDiscriminatedUnion { .. } => {
                                        write!(output, "        offset += self.{}_size(); // {} (variable size)\n", prev_field.name, prev_field.name).unwrap();
                                    }
                                    ResolvedTypeKind::Array { .. } => {
                                        if let crate::abi::resolved::Size::Const(size) =
                                            prev_field.field_type.size
                                        {
                                            write!(
                                                output,
                                                "        offset += {}; // {} (array)\n",
                                                size, prev_field.name
                                            )
                                            .unwrap();
                                        }
                                    }
                                    ResolvedTypeKind::TypeRef { .. } => {
                                        if let crate::abi::resolved::Size::Const(size) =
                                            prev_field.field_type.size
                                        {
                                            write!(
                                                output,
                                                "        offset += {}; // {} (nested struct)\n",
                                                size, prev_field.name
                                            )
                                            .unwrap();
                                        }
                                    }
                                    _ => {}
                                }
                            }
                        }

                        // Calculate available size and match against variants
                        write!(
                            output,
                            "        let available_size = self.data.len() - offset;\n"
                        )
                        .unwrap();
                        write!(output, "        match available_size {{\n").unwrap();
                        for (idx, variant) in variants.iter().enumerate() {
                            write!(
                                output,
                                "            {} => {},\n",
                                variant.expected_size, idx
                            )
                            .unwrap();
                        }
                        write!(
                            output,
                            "            _ => 255, // Invalid size - no matching variant\n"
                        )
                        .unwrap();
                        write!(output, "        }}\n").unwrap();
                        write!(output, "    }}\n\n").unwrap();

                        // Generate size helper function
                        write!(
                            output,
                            "    pub fn {}_size(&self) -> usize {{\n",
                            type_name_snake
                        )
                        .unwrap();
                        write!(
                            output,
                            "        let tag = self.{}_tag();\n",
                            type_name_snake
                        )
                        .unwrap();
                        write!(output, "        match tag {{\n").unwrap();
                        for (idx, variant) in variants.iter().enumerate() {
                            write!(
                                output,
                                "            {} => {},\n",
                                idx, variant.expected_size
                            )
                            .unwrap();
                        }
                        write!(output, "            _ => 0, // Invalid tag\n").unwrap();
                        write!(output, "        }}\n").unwrap();
                        write!(output, "    }}\n\n").unwrap();

                        // Generate variant-specific getters for each variant (like enums)
                        for variant in variants {
                            let variant_name_snake = variant.name.to_lowercase().replace("-", "_");
                            // Type name format matches collect_nested_type_definitions: {parent}_{field}_inner_{variant}_inner
                            // But for opaque wrappers, it's just {parent}_{field}_{variant}
                            let variant_type_name =
                                format!("{}_{}_{}", type_name, field.name, variant.name);

                            write!(
                                output,
                                "    pub fn {}_{}(&self) -> {}<'_> {{\n",
                                field.name, variant_name_snake, variant_type_name
                            )
                            .unwrap();

                            // Calculate offset to size-discriminated union
                            if field_idx == 0 {
                                write!(output, "        let offset = 0;\n").unwrap();
                            } else {
                                write!(output, "        let mut offset = 0;\n").unwrap();
                                for prev_field in &fields[0..field_idx] {
                                    match &prev_field.field_type.kind {
                                        ResolvedTypeKind::Primitive {
                                            prim_type: prev_prim,
                                        } => {
                                            let size = primitive_size(prev_prim);
                                            write!(
                                                output,
                                                "        offset += {}; // {}\n",
                                                size, prev_field.name
                                            )
                                            .unwrap();
                                        }
                                        ResolvedTypeKind::Enum { .. } => {
                                            write!(output, "        offset += self.{}_size(); // {} (variable size)\n", prev_field.name, prev_field.name).unwrap();
                                        }
                                        ResolvedTypeKind::SizeDiscriminatedUnion { .. } => {
                                            write!(output, "        offset += self.{}_size(); // {} (variable size)\n", prev_field.name, prev_field.name).unwrap();
                                        }
                                        ResolvedTypeKind::Array { .. } => {
                                            if let crate::abi::resolved::Size::Const(size) =
                                                prev_field.field_type.size
                                            {
                                                write!(
                                                    output,
                                                    "        offset += {}; // {} (array)\n",
                                                    size, prev_field.name
                                                )
                                                .unwrap();
                                            }
                                        }
                                        ResolvedTypeKind::TypeRef { .. } => {
                                            if let crate::abi::resolved::Size::Const(size) =
                                                prev_field.field_type.size
                                            {
                                                write!(
                                                    output,
                                                    "        offset += {}; // {} (nested struct)\n",
                                                    size, prev_field.name
                                                )
                                                .unwrap();
                                            }
                                        }
                                        _ => {}
                                    }
                                }
                            }

                            write!(
                                output,
                                "        {} {{ data: &self.data[offset..offset + {}] }}\n",
                                variant_type_name, variant.expected_size
                            )
                            .unwrap();
                            write!(output, "    }}\n\n").unwrap();
                        }
                    }
                    ResolvedTypeKind::Array {
                        element_type,
                        size_constant_status,
                        size_expression,
                        ..
                    } => {
                        // For arrays, return a slice
                        use crate::abi::resolved::ConstantStatus;

                        if matches!(size_constant_status, ConstantStatus::Constant) {
                            // Calculate array size
                            let array_size = if let crate::abi::resolved::Size::Const(total_size) =
                                field.field_type.size
                            {
                                let elem_size = match &element_type.size {
                                    crate::abi::resolved::Size::Const(s) => *s,
                                    _ => 1,
                                };
                                total_size / elem_size
                            } else {
                                0
                            };

                            // Check if this is a byte array
                            if matches!(&element_type.kind, ResolvedTypeKind::Primitive { prim_type } if matches!(prim_type, crate::abi::types::PrimitiveType::Integral(IntegralType::U8)))
                            {
                                // Byte array - return slice
                                write!(output, "    pub fn {}(&self) -> &[u8] {{\n", field.name)
                                    .unwrap();

                                if field_idx == 0 {
                                    write!(output, "        &self.data[0..{}]\n", array_size)
                                        .unwrap();
                                } else {
                                    write!(output, "        let mut offset = 0;\n").unwrap();
                                    for prev_field in &fields[0..field_idx] {
                                        match &prev_field.field_type.kind {
                                            ResolvedTypeKind::Primitive {
                                                prim_type: prev_prim,
                                            } => {
                                                let size = primitive_size(prev_prim);
                                                write!(
                                                    output,
                                                    "        offset += {}; // {}\n",
                                                    size, prev_field.name
                                                )
                                                .unwrap();
                                            }
                                            ResolvedTypeKind::Enum { .. } => {
                                                write!(output, "        offset += self.{}_size(); // {} (variable size)\n", prev_field.name, prev_field.name).unwrap();
                                            }
                                            ResolvedTypeKind::SizeDiscriminatedUnion { .. } => {
                                                write!(output, "        offset += self.{}_size(); // {} (variable size)\n", prev_field.name, prev_field.name).unwrap();
                                            }
                                            ResolvedTypeKind::Array { .. } => {
                                                if let crate::abi::resolved::Size::Const(size) =
                                                    prev_field.field_type.size
                                                {
                                                    write!(
                                                        output,
                                                        "        offset += {}; // {} (array)\n",
                                                        size, prev_field.name
                                                    )
                                                    .unwrap();
                                                }
                                            }
                                            ResolvedTypeKind::TypeRef { .. } => {
                                                if let crate::abi::resolved::Size::Const(size) =
                                                    prev_field.field_type.size
                                                {
                                                    write!(output, "        offset += {}; // {} (nested struct)\n", size, prev_field.name).unwrap();
                                                }
                                            }
                                            _ => {}
                                        }
                                    }
                                    write!(
                                        output,
                                        "        &self.data[offset..offset + {}]\n",
                                        array_size
                                    )
                                    .unwrap();
                                }
                                write!(output, "    }}\n\n").unwrap();
                            } else {
                                // Non-byte array - generate element-wise access
                                // Get element type info
                                if let ResolvedTypeKind::Primitive { prim_type } =
                                    &element_type.kind
                                {
                                    let rust_type = match prim_type {
                                        crate::abi::types::PrimitiveType::Integral(int_type) => {
                                            match int_type {
                                                IntegralType::U8 => "u8",
                                                IntegralType::U16 => "u16",
                                                IntegralType::U32 => "u32",
                                                IntegralType::U64 => "u64",
                                                IntegralType::I8 => "i8",
                                                IntegralType::I16 => "i16",
                                                IntegralType::I32 => "i32",
                                                IntegralType::I64 => "i64",
                                                IntegralType::Char => "u8",
                                            }
                                        }
                                        crate::abi::types::PrimitiveType::FloatingPoint(
                                            float_type,
                                        ) => match float_type {
                                            FloatingPointType::F16 => "f16",
                                            FloatingPointType::F32 => "f32",
                                            FloatingPointType::F64 => "f64",
                                        },
                                    };

                                    let elem_size = primitive_size(prim_type);

                                    // Generate length method
                                    write!(
                                        output,
                                        "    pub fn {}_len(&self) -> usize {{\n",
                                        field.name
                                    )
                                    .unwrap();
                                    write!(output, "        {}\n", array_size).unwrap();
                                    write!(output, "    }}\n\n").unwrap();

                                    // Generate element getter
                                    write!(
                                        output,
                                        "    pub fn {}_get(&self, index: usize) -> {} {{\n",
                                        field.name, rust_type
                                    )
                                    .unwrap();
                                    write!(output, "        if index >= {} {{\n", array_size)
                                        .unwrap();
                                    write!(output, "            panic!(\"Index {{}} out of bounds for array '{}' of length {}\", index);\n", field.name, array_size).unwrap();
                                    write!(output, "        }}\n").unwrap();

                                    // Calculate base offset
                                    if field_idx == 0 {
                                        write!(output, "        let base_offset = 0;\n").unwrap();
                                    } else {
                                        write!(output, "        let mut base_offset = 0;\n")
                                            .unwrap();
                                        for prev_field in &fields[0..field_idx] {
                                            match &prev_field.field_type.kind {
                                                ResolvedTypeKind::Primitive {
                                                    prim_type: prev_prim,
                                                } => {
                                                    let size = primitive_size(prev_prim);
                                                    write!(
                                                        output,
                                                        "        base_offset += {}; // {}\n",
                                                        size, prev_field.name
                                                    )
                                                    .unwrap();
                                                }
                                                ResolvedTypeKind::Enum { .. } => {
                                                    write!(output, "        base_offset += self.{}_size(); // {} (variable size)\n", prev_field.name, prev_field.name).unwrap();
                                                }
                                                ResolvedTypeKind::Array { .. } => {
                                                    if let crate::abi::resolved::Size::Const(size) =
                                                        prev_field.field_type.size
                                                    {
                                                        write!(output, "        base_offset += {}; // {} (array)\n", size, prev_field.name).unwrap();
                                                    }
                                                }
                                                ResolvedTypeKind::TypeRef { .. } => {
                                                    if let crate::abi::resolved::Size::Const(size) =
                                                        prev_field.field_type.size
                                                    {
                                                        write!(output, "        base_offset += {}; // {} (nested struct)\n", size, prev_field.name).unwrap();
                                                    }
                                                }
                                                _ => {}
                                            }
                                        }
                                    }

                                    // Calculate element offset and read
                                    write!(
                                        output,
                                        "        let offset = base_offset + index * {};\n",
                                        elem_size
                                    )
                                    .unwrap();
                                    let read_expr = emit_read_primitive(prim_type, "offset");
                                    write!(output, "        {}\n", read_expr).unwrap();
                                    write!(output, "    }}\n\n").unwrap();
                                } else if let ResolvedTypeKind::TypeRef { target_name, .. } =
                                    &element_type.kind
                                {
                                    // Array of structs - element type must have constant size
                                    if let crate::abi::resolved::Size::Const(elem_size) =
                                        element_type.size
                                    {
                                        // Generate length method
                                        write!(
                                            output,
                                            "    pub fn {}_len(&self) -> usize {{\n",
                                            field.name
                                        )
                                        .unwrap();
                                        write!(output, "        {}\n", array_size).unwrap();
                                        write!(output, "    }}\n\n").unwrap();

                                        // Generate element getter - returns opaque wrapper
                                        write!(
                                            output,
                                            "    pub fn {}_get(&self, index: usize) -> {}<'_> {{\n",
                                            field.name, target_name
                                        )
                                        .unwrap();
                                        write!(output, "        if index >= {} {{\n", array_size)
                                            .unwrap();
                                        write!(output, "            panic!(\"Index {{}} out of bounds for array '{}' of length {}\", index);\n", field.name, array_size).unwrap();
                                        write!(output, "        }}\n").unwrap();

                                        // Calculate base offset
                                        if field_idx == 0 {
                                            write!(output, "        let base_offset = 0;\n")
                                                .unwrap();
                                        } else {
                                            write!(output, "        let mut base_offset = 0;\n")
                                                .unwrap();
                                            for prev_field in &fields[0..field_idx] {
                                                match &prev_field.field_type.kind {
                                                    ResolvedTypeKind::Primitive {
                                                        prim_type: prev_prim,
                                                    } => {
                                                        let size = primitive_size(prev_prim);
                                                        write!(
                                                            output,
                                                            "        base_offset += {}; // {}\n",
                                                            size, prev_field.name
                                                        )
                                                        .unwrap();
                                                    }
                                                    ResolvedTypeKind::Enum { .. } => {
                                                        write!(output, "        base_offset += self.{}_size(); // {} (variable size)\n", prev_field.name, prev_field.name).unwrap();
                                                    }
                                                    ResolvedTypeKind::Array { .. } => {
                                                        if let crate::abi::resolved::Size::Const(
                                                            size,
                                                        ) = prev_field.field_type.size
                                                        {
                                                            write!(output, "        base_offset += {}; // {} (array)\n", size, prev_field.name).unwrap();
                                                        }
                                                    }
                                                    ResolvedTypeKind::TypeRef { .. } => {
                                                        if let crate::abi::resolved::Size::Const(
                                                            size,
                                                        ) = prev_field.field_type.size
                                                        {
                                                            write!(output, "        base_offset += {}; // {} (nested struct)\n", size, prev_field.name).unwrap();
                                                        }
                                                    }
                                                    _ => {}
                                                }
                                            }
                                        }

                                        // Calculate element offset and return wrapper
                                        write!(
                                            output,
                                            "        let offset = base_offset + index * {};\n",
                                            elem_size
                                        )
                                        .unwrap();
                                        write!(output, "        {} {{ data: &self.data[offset..offset + {}] }}\n", target_name, elem_size).unwrap();
                                        write!(output, "    }}\n\n").unwrap();
                                    }
                                }
                            }
                        } else {
                            // Variable-size array (FAM) - generate accessors
                            // We need the size expression to calculate array length
                            if let ResolvedTypeKind::Array {
                                element_type,
                                size_expression: _,
                                jagged,
                                ..
                            } = &field.field_type.kind
                            {
                                // Handle jagged arrays with variable-size elements
                                if *jagged {
                                    if let ResolvedTypeKind::TypeRef { target_name, .. } = &element_type.kind {
                                        // Generate count expression
                                        let count_expr =
                                            size_expression_to_rust_getter_code(size_expression, "self");

                                        // Generate offset setup code
                                        let mut offset_setup = String::new();
                                        if field_idx == 0 {
                                            writeln!(offset_setup, "        let mut offset = 0;")
                                                .unwrap();
                                        } else {
                                            writeln!(offset_setup, "        let mut offset = 0;")
                                                .unwrap();
                                            for prev_field in &fields[0..field_idx] {
                                                match &prev_field.field_type.kind {
                                                    ResolvedTypeKind::Primitive {
                                                        prim_type: prev_prim,
                                                    } => {
                                                        let size = primitive_size(prev_prim);
                                                        writeln!(
                                                            offset_setup,
                                                            "        offset += {}; // {}",
                                                            size, prev_field.name
                                                        )
                                                        .unwrap();
                                                    }
                                                    ResolvedTypeKind::Enum { .. } => {
                                                        writeln!(offset_setup, "        offset += self.{}_size(); // {} (variable size)", prev_field.name, prev_field.name).unwrap();
                                                    }
                                                    ResolvedTypeKind::Array { jagged: prev_jagged, .. } => {
                                                        if let crate::abi::resolved::Size::Const(size) =
                                                            prev_field.field_type.size
                                                        {
                                                            writeln!(offset_setup, "        offset += {}; // {} (array)", size, prev_field.name).unwrap();
                                                        } else if *prev_jagged {
                                                            writeln!(offset_setup, "        offset += self.{}_size(); // {} (jagged array)", prev_field.name, prev_field.name).unwrap();
                                                        }
                                                    }
                                                    ResolvedTypeKind::TypeRef { .. } => {
                                                        if let crate::abi::resolved::Size::Const(size) =
                                                            prev_field.field_type.size
                                                        {
                                                            writeln!(offset_setup, "        offset += {}; // {} (nested struct)", size, prev_field.name).unwrap();
                                                        }
                                                    }
                                                    _ => {}
                                                }
                                            }
                                        }

                                        // Use the actual target type name, not the synthetic element name
                                        emit_jagged_array_accessors(
                                            &mut output,
                                            &field.name,
                                            target_name,
                                            &count_expr,
                                            &offset_setup,
                                        );
                                        continue;
                                    }
                                }
                                // Helper function to emit offset calculation for this field
                                let emit_base_offset = |output: &mut String| {
                                    if field_idx == 0 {
                                        write!(output, "        let base_offset = 0;\n").unwrap();
                                    } else {
                                        write!(output, "        let mut base_offset = 0;\n")
                                            .unwrap();
                                        for prev_field in &fields[0..field_idx] {
                                            match &prev_field.field_type.kind {
                                                ResolvedTypeKind::Primitive {
                                                    prim_type: prev_prim,
                                                } => {
                                                    let size = primitive_size(prev_prim);
                                                    write!(
                                                        output,
                                                        "        base_offset += {}; // {}\n",
                                                        size, prev_field.name
                                                    )
                                                    .unwrap();
                                                }
                                                ResolvedTypeKind::Enum { .. } => {
                                                    write!(output, "        base_offset += self.{}_size(); // {} (variable size)\n", prev_field.name, prev_field.name).unwrap();
                                                }
                                                ResolvedTypeKind::Array { size_expression: prev_size_expr, .. } => {
                                                    if let crate::abi::resolved::Size::Const(size) =
                                                        prev_field.field_type.size
                                                    {
                                                        write!(output, "        base_offset += {}; // {} (array)\n", size, prev_field.name).unwrap();
                                                    } else {
                                                        // Variable-size array
                                                        // Check if _len method was skipped for this array
                                                        let prev_skip_len = size_expr_matches_len_field(prev_size_expr, &prev_field.name);
                                                        let len_expr = if prev_skip_len {
                                                            // Use size expression directly with cast
                                                            format!("({}) as usize", size_expression_to_rust_getter_code(prev_size_expr, "self"))
                                                        } else {
                                                            format!("self.{}_len()", prev_field.name)
                                                        };
                                                        write!(output, "        base_offset += {} * {}; // {} (variable-size array)\n",
                                                               len_expr,
                                                               if let ResolvedTypeKind::Array { element_type, .. } = &prev_field.field_type.kind {
                                                                   if let crate::abi::resolved::Size::Const(elem_size) = element_type.size {
                                                                       elem_size.to_string()
                                                                   } else {
                                                                       "0 /* TODO */".to_string()
                                                                   }
                                                               } else {
                                                                   "0".to_string()
                                                               },
                                                               prev_field.name).unwrap();
                                                    }
                                                }
                                                ResolvedTypeKind::TypeRef { .. } => {
                                                    if let crate::abi::resolved::Size::Const(size) =
                                                        prev_field.field_type.size
                                                    {
                                                        write!(output, "        base_offset += {}; // {} (nested struct)\n", size, prev_field.name).unwrap();
                                                    }
                                                }
                                                _ => {}
                                            }
                                        }
                                    }
                                };

                                // Convert expression to Rust code that calls getters
                                let size_expr_str =
                                    size_expression_to_rust_getter_code(size_expression, "self");

                                // Check element type
                                if let ResolvedTypeKind::Primitive { prim_type } =
                                    &element_type.kind
                                {
                                    let rust_type = match prim_type {
                                        crate::abi::types::PrimitiveType::Integral(int_type) => {
                                            match int_type {
                                                IntegralType::U8 => "u8",
                                                IntegralType::U16 => "u16",
                                                IntegralType::U32 => "u32",
                                                IntegralType::U64 => "u64",
                                                IntegralType::I8 => "i8",
                                                IntegralType::I16 => "i16",
                                                IntegralType::I32 => "i32",
                                                IntegralType::I64 => "i64",
                                                IntegralType::Char => "u8",
                                            }
                                        }
                                        crate::abi::types::PrimitiveType::FloatingPoint(
                                            float_type,
                                        ) => match float_type {
                                            FloatingPointType::F16 => "f16",
                                            FloatingPointType::F32 => "f32",
                                            FloatingPointType::F64 => "f64",
                                        },
                                    };

                                    let elem_size = primitive_size(prim_type);

                                    // Check if size expression would collide with array _len() method name
                                    let skip_len_method = size_expr_matches_len_field(size_expression, &field.name);

                                    // Generate length method only if it wouldn't collide
                                    if !skip_len_method {
                                        write!(
                                            output,
                                            "    pub fn {}_len(&self) -> usize {{\n",
                                            field.name
                                        )
                                        .unwrap();
                                        /* For nested structs, use data.len() instead of calling parent field getters */
                                        if is_nested {
                                            write!(output, "        self.data.len() / {}\n", elem_size)
                                                .unwrap();
                                        } else {
                                            write!(output, "        ({}) as usize\n", size_expr_str)
                                                .unwrap();
                                        }
                                        write!(output, "    }}\n\n").unwrap();
                                    }

                                    // Generate element getter
                                    write!(
                                        output,
                                        "    pub fn {}_get(&self, index: usize) -> {} {{\n",
                                        field.name, rust_type
                                    )
                                    .unwrap();
                                    // Use size expression directly with cast when _len method was skipped
                                    if skip_len_method {
                                        write!(
                                            output,
                                            "        let len = ({}) as usize;\n",
                                            size_expr_str
                                        )
                                        .unwrap();
                                    } else {
                                        write!(
                                            output,
                                            "        let len = self.{}_len();\n",
                                            field.name
                                        )
                                        .unwrap();
                                    }
                                    write!(output, "        if index >= len {{\n").unwrap();
                                    write!(output, "            panic!(\"Index {{}} out of bounds for array '{}' of length {{}}\", index, len);\n", field.name).unwrap();
                                    write!(output, "        }}\n").unwrap();
                                    emit_base_offset(&mut output);
                                    write!(
                                        output,
                                        "        let offset = base_offset + index * {};\n",
                                        elem_size
                                    )
                                    .unwrap();
                                    let read_expr = emit_read_primitive(prim_type, "offset");
                                    write!(output, "        {}\n", read_expr).unwrap();
                                    write!(output, "    }}\n\n").unwrap();

                                    // For u8 arrays, also provide slice accessor
                                    if matches!(
                                        prim_type,
                                        crate::abi::types::PrimitiveType::Integral(
                                            IntegralType::U8
                                        )
                                    ) {
                                        write!(
                                            output,
                                            "    pub fn {}(&self) -> &[u8] {{\n",
                                            field.name
                                        )
                                        .unwrap();
                                        // Use size expression directly with cast when _len method was skipped
                                        if skip_len_method {
                                            write!(
                                                output,
                                                "        let len = ({}) as usize;\n",
                                                size_expr_str
                                            )
                                            .unwrap();
                                        } else {
                                            write!(
                                                output,
                                                "        let len = self.{}_len();\n",
                                                field.name
                                            )
                                            .unwrap();
                                        }
                                        emit_base_offset(&mut output);
                                        write!(
                                            output,
                                            "        &self.data[base_offset..base_offset + len]\n"
                                        )
                                        .unwrap();
                                        write!(output, "    }}\n\n").unwrap();
                                    }
                                } else if let ResolvedTypeKind::TypeRef { target_name, .. } =
                                    &element_type.kind
                                {
                                    // Variable-size array of structs
                                    if let crate::abi::resolved::Size::Const(elem_size) =
                                        element_type.size
                                    {
                                        // Check if size expression would collide with array _len() method name
                                        let skip_len_method = size_expr_matches_len_field(size_expression, &field.name);

                                        // Generate length method only if it wouldn't collide
                                        if !skip_len_method {
                                            write!(
                                                output,
                                                "    pub fn {}_len(&self) -> usize {{\n",
                                                field.name
                                            )
                                            .unwrap();
                                            /* For nested structs, use data.len() instead of calling parent field getters */
                                            if is_nested {
                                                write!(
                                                    output,
                                                    "        self.data.len() / {}\n",
                                                    elem_size
                                                )
                                                .unwrap();
                                            } else {
                                                write!(
                                                    output,
                                                    "        ({}) as usize\n",
                                                    size_expr_str
                                                )
                                                .unwrap();
                                            }
                                            write!(output, "    }}\n\n").unwrap();
                                        }

                                        // Generate element getter
                                        write!(
                                            output,
                                            "    pub fn {}_get(&self, index: usize) -> {}<'_> {{\n",
                                            field.name, target_name
                                        )
                                        .unwrap();
                                        // Use size expression directly with cast when _len method was skipped
                                        if skip_len_method {
                                            write!(
                                                output,
                                                "        let len = ({}) as usize;\n",
                                                size_expr_str
                                            )
                                            .unwrap();
                                        } else {
                                            write!(
                                                output,
                                                "        let len = self.{}_len();\n",
                                                field.name
                                            )
                                            .unwrap();
                                        }
                                        write!(output, "        if index >= len {{\n").unwrap();
                                        write!(output, "            panic!(\"Index {{}} out of bounds for array '{}' of length {{}}\", index, len);\n", field.name).unwrap();
                                        write!(output, "        }}\n").unwrap();
                                        emit_base_offset(&mut output);
                                        write!(
                                            output,
                                            "        let offset = base_offset + index * {};\n",
                                            elem_size
                                        )
                                        .unwrap();
                                        write!(output, "        {} {{ data: &self.data[offset..offset + {}] }}\n", target_name, elem_size).unwrap();
                                        write!(output, "    }}\n\n").unwrap();
                                    }
                                }
                            }
                        }
                    }
                    ResolvedTypeKind::TypeRef { target_name, .. } => {
                        // Nested struct - return wrapper around sub-slice
                        write!(
                            output,
                            "    pub fn {}(&self) -> {}<'_> {{\n",
                            field.name, target_name
                        )
                        .unwrap();

                        if field_idx == 0 {
                            if let crate::abi::resolved::Size::Const(size) = field.field_type.size {
                                write!(
                                    output,
                                    "        {} {{ data: &self.data[0..{}] }}\n",
                                    target_name, size
                                )
                                .unwrap();
                            }
                        } else {
                            write!(output, "        let mut offset = 0;\n").unwrap();
                            for prev_field in &fields[0..field_idx] {
                                match &prev_field.field_type.kind {
                                    ResolvedTypeKind::Primitive {
                                        prim_type: prev_prim,
                                    } => {
                                        let size = primitive_size(prev_prim);
                                        write!(
                                            output,
                                            "        offset += {}; // {}\n",
                                            size, prev_field.name
                                        )
                                        .unwrap();
                                    }
                                    ResolvedTypeKind::Enum { .. } => {
                                        write!(output, "        offset += self.{}_size(); // {} (variable size)\n", prev_field.name, prev_field.name).unwrap();
                                    }
                                    ResolvedTypeKind::Array {
                                        element_type,
                                        size_expression,
                                        ..
                                    } => {
                                        if let crate::abi::resolved::Size::Const(size) =
                                            prev_field.field_type.size
                                        {
                                            write!(
                                                output,
                                                "        offset += {}; // {} (array)\n",
                                                size, prev_field.name
                                            )
                                            .unwrap();
                                        } else {
                                            // Variable-size array - calculate size using inline field access
                                            if let crate::abi::resolved::Size::Const(elem_size) =
                                                element_type.size
                                            {
                                                let size_expr = size_expression_to_rust_getter_code(
                                                    size_expression,
                                                    "self",
                                                );
                                                write!(output, "        offset += (({}) as usize) * {}; // {} (variable array)\n",
                                                       size_expr, elem_size, prev_field.name).unwrap();
                                            }
                                        }
                                    }
                                    ResolvedTypeKind::TypeRef { .. } => {
                                        if let crate::abi::resolved::Size::Const(size) =
                                            prev_field.field_type.size
                                        {
                                            write!(
                                                output,
                                                "        offset += {}; // {} (nested struct)\n",
                                                size, prev_field.name
                                            )
                                            .unwrap();
                                        }
                                    }
                                    _ => {}
                                }
                            }
                            if let crate::abi::resolved::Size::Const(size) = field.field_type.size {
                                write!(
                                    output,
                                    "        {} {{ data: &self.data[offset..offset + {}] }}\n",
                                    target_name, size
                                )
                                .unwrap();
                            }
                        }
                        write!(output, "    }}\n\n").unwrap();
                    }
                    ResolvedTypeKind::Struct {
                        fields: nested_fields,
                        ..
                    } => {
                        /* Anonymous inline nested struct - use synthesized wrapper type name */
                        /* Convert "ParentWithNestedArray::nested" to "ParentWithNestedArray_nested" */
                        let nested_type_name = field.field_type.name.replace("::", "_");

                        /* Generate size function if struct has variable size */
                        if let crate::abi::resolved::Size::Variable(_) = field.field_type.size {
                            write!(output, "    fn {}_size(&self) -> usize {{\n", field.name)
                                .unwrap();
                            write!(output, "        let mut size = 0;\n").unwrap();

                            for nested_field in nested_fields {
                                match &nested_field.field_type.kind {
                                    ResolvedTypeKind::Primitive { prim_type } => {
                                        let field_size = primitive_size(prim_type);
                                        write!(
                                            output,
                                            "        size += {}; /* {} */\n",
                                            field_size, nested_field.name
                                        )
                                        .unwrap();
                                    }
                                    ResolvedTypeKind::Array {
                                        element_type,
                                        size_expression,
                                        ..
                                    } => {
                                        if let crate::abi::resolved::Size::Const(array_size) =
                                            nested_field.field_type.size
                                        {
                                            write!(
                                                output,
                                                "        size += {}; /* {} (array) */\n",
                                                array_size, nested_field.name
                                            )
                                            .unwrap();
                                        } else {
                                            /* Variable-size array */
                                            if let crate::abi::resolved::Size::Const(elem_size) =
                                                element_type.size
                                            {
                                                let size_expr = size_expression_to_rust_getter_code(
                                                    size_expression,
                                                    "self",
                                                );
                                                write!(output, "        size += (({}) as usize) * {}; /* {} (variable array) */\n",
                                                       size_expr, elem_size, nested_field.name).unwrap();
                                            }
                                        }
                                    }
                                    _ => {
                                        write!(
                                            output,
                                            "        /* TODO: size for nested field {} */\n",
                                            nested_field.name
                                        )
                                        .unwrap();
                                    }
                                }
                            }

                            write!(output, "        size\n").unwrap();
                            write!(output, "    }}\n\n").unwrap();
                        }

                        write!(
                            output,
                            "    pub fn {}(&self) -> {}<'_> {{\n",
                            field.name, nested_type_name
                        )
                        .unwrap();

                        if field_idx == 0 {
                            if let crate::abi::resolved::Size::Const(size) = field.field_type.size {
                                write!(
                                    output,
                                    "        {} {{ data: &self.data[0..{}] }}\n",
                                    nested_type_name, size
                                )
                                .unwrap();
                            } else {
                                /* Variable size nested struct at offset 0 */
                                write!(output, "        let size = self.{}_size();\n", field.name)
                                    .unwrap();
                                write!(
                                    output,
                                    "        {} {{ data: &self.data[0..size] }}\n",
                                    nested_type_name
                                )
                                .unwrap();
                            }
                        } else {
                            write!(output, "        let mut offset = 0;\n").unwrap();
                            for prev_field in &fields[0..field_idx] {
                                match &prev_field.field_type.kind {
                                    ResolvedTypeKind::Primitive {
                                        prim_type: prev_prim,
                                    } => {
                                        let size = primitive_size(prev_prim);
                                        write!(
                                            output,
                                            "        offset += {}; /* {} */\n",
                                            size, prev_field.name
                                        )
                                        .unwrap();
                                    }
                                    ResolvedTypeKind::Enum { .. } => {
                                        write!(output, "        offset += self.{}_size(); /* {} (variable size) */\n", prev_field.name, prev_field.name).unwrap();
                                    }
                                    ResolvedTypeKind::Array {
                                        element_type,
                                        size_expression,
                                        ..
                                    } => {
                                        if let crate::abi::resolved::Size::Const(size) =
                                            prev_field.field_type.size
                                        {
                                            write!(
                                                output,
                                                "        offset += {}; /* {} (array) */\n",
                                                size, prev_field.name
                                            )
                                            .unwrap();
                                        } else {
                                            /* Variable-size array - calculate size using inline field access */
                                            if let crate::abi::resolved::Size::Const(elem_size) =
                                                element_type.size
                                            {
                                                let size_expr = size_expression_to_rust_getter_code(
                                                    size_expression,
                                                    "self",
                                                );
                                                write!(output, "        offset += (({}) as usize) * {}; /* {} (variable array) */\n",
                                                       size_expr, elem_size, prev_field.name).unwrap();
                                            }
                                        }
                                    }
                                    ResolvedTypeKind::TypeRef { .. }
                                    | ResolvedTypeKind::Struct { .. } => {
                                        if let crate::abi::resolved::Size::Const(size) =
                                            prev_field.field_type.size
                                        {
                                            write!(
                                                output,
                                                "        offset += {}; /* {} (nested struct) */\n",
                                                size, prev_field.name
                                            )
                                            .unwrap();
                                        } else {
                                            write!(output, "        offset += self.{}_size(); /* {} (variable size nested struct) */\n", prev_field.name, prev_field.name).unwrap();
                                        }
                                    }
                                    _ => {}
                                }
                            }
                            if let crate::abi::resolved::Size::Const(size) = field.field_type.size {
                                write!(
                                    output,
                                    "        {} {{ data: &self.data[offset..offset + {}] }}\n",
                                    nested_type_name, size
                                )
                                .unwrap();
                            } else {
                                /* Variable size nested struct */
                                write!(output, "        let size = self.{}_size();\n", field.name)
                                    .unwrap();
                                write!(
                                    output,
                                    "        {} {{ data: &self.data[offset..offset + size] }}\n",
                                    nested_type_name
                                )
                                .unwrap();
                            }
                        }
                        write!(output, "    }}\n\n").unwrap();
                    }
                    _ => {
                        write!(
                            output,
                            "    // TODO: getter for {} of type {:?}\n\n",
                            field.name, field.field_type.kind
                        )
                        .unwrap();
                    }
                }
            }

            // validate() function
            write!(
                output,
                "    pub fn validate(data: &[u8]) -> Result<usize, &'static str> {{\n"
            )
            .unwrap();
            if let Some(msg) = ir_comment.as_ref() {
                write!(output, "        /* {} */\n", msg).unwrap();
            }
            if let Some(call) = ir_call_string.as_ref() {
                if let Some((_, data)) = ir_call.as_ref() {
                    emit_ir_param_setup(&mut output, &type_name, data);
                }
                emit_ir_primary_path(&mut output, call);
            } else {
                write!(output, "        let mut offset = 0;\n\n").unwrap();

                // Track field offsets for enum tag resolution
                let mut field_offsets: std::collections::HashMap<String, String> =
                    std::collections::HashMap::new();

                for (field_idx, field) in fields.iter().enumerate() {
                    match &field.field_type.kind {
                        ResolvedTypeKind::Primitive { prim_type } => {
                            let size = primitive_size(prim_type);
                            write!(output, "        if offset + {} > data.len() {{\n", size)
                                .unwrap();
                            write!(
                                output,
                                "            return Err(\"Buffer too small for field '{}'\");\n",
                                field.name
                            )
                            .unwrap();
                            write!(output, "        }}\n").unwrap();

                            // Check if any later field (enum/array) references this field in its expression
                            let needs_saving = fields.iter().skip(field_idx + 1).any(|f| {
                                let mut refs = HashSet::new();
                                match &f.field_type.kind {
                                    ResolvedTypeKind::Enum { tag_expression, .. } => {
                                        extract_field_refs_from_expr(tag_expression, &mut refs);
                                        refs.contains(&field.name)
                                    }
                                    ResolvedTypeKind::Array {
                                        size_expression, ..
                                    } => {
                                        extract_field_refs_from_expr(size_expression, &mut refs);
                                        refs.contains(&field.name)
                                    }
                                    _ => false,
                                }
                            });

                            // Store offset for later use by enums
                            if field_idx == 0 {
                                field_offsets.insert(field.name.clone(), "0".to_string());
                            } else if needs_saving {
                                write!(output, "        let offset_{} = offset;\n", field.name)
                                    .unwrap();
                                field_offsets
                                    .insert(field.name.clone(), format!("offset_{}", field.name));
                            } else {
                                field_offsets.insert(field.name.clone(), "offset".to_string());
                            }

                            write!(output, "        offset += {}; // {}\n\n", size, field.name)
                                .unwrap();
                        }
                        ResolvedTypeKind::Enum {
                            variants,
                            tag_expression,
                            ..
                        } => {
                            let tag_expr =
                                expression_to_rust_data_read(tag_expression, &field_offsets);
                            write!(output, "        let tag = ({}) as u8;\n", tag_expr).unwrap();

                            write!(output, "        let variant_size = match tag {{\n").unwrap();
                            for variant in variants {
                                if let crate::abi::resolved::Size::Const(size) =
                                    variant.variant_type.size
                                {
                                    write!(
                                        output,
                                        "            {} => {},\n",
                                        variant.tag_value, size
                                    )
                                    .unwrap();
                                }
                            }
                            write!(
                                output,
                                "            _ => return Err(\"Invalid enum tag\"),\n"
                            )
                            .unwrap();
                            write!(output, "        }};\n\n").unwrap();

                            write!(output, "        if offset + variant_size > data.len() {{\n")
                                .unwrap();
                            write!(
                                output,
                                "            return Err(\"Buffer too small for enum body '{}'\");\n",
                                field.name
                            )
                            .unwrap();
                            write!(output, "        }}\n").unwrap();
                            write!(output, "        offset += variant_size; // enum body\n\n")
                                .unwrap();
                        }
                        ResolvedTypeKind::SizeDiscriminatedUnion { variants } => {
                            write!(
                                output,
                                "        let available_size = data.len() - offset;\n"
                            )
                            .unwrap();
                            write!(
                                output,
                                "        let variant_size = match available_size {{\n"
                            )
                            .unwrap();
                            for variant in variants {
                                write!(
                                    output,
                                    "            {} => {},\n",
                                    variant.expected_size, variant.expected_size
                                )
                                .unwrap();
                            }
                            write!(output, "            _ => return Err(\"No matching variant for size-discriminated union '{}'\"),\n", field.name).unwrap();
                            write!(output, "        }};\n\n").unwrap();

                            write!(output, "        if offset + variant_size > data.len() {{\n")
                                .unwrap();
                            write!(output, "            return Err(\"Buffer too small for size-discriminated union '{}'\");\n", field.name).unwrap();
                            write!(output, "        }}\n").unwrap();
                            write!(
                                output,
                                "        offset += variant_size; // size-discriminated union\n\n"
                            )
                            .unwrap();
                        }
                        ResolvedTypeKind::Array { .. } => {
                            if let crate::abi::resolved::Size::Const(size) = field.field_type.size {
                                write!(output, "        if offset + {} > data.len() {{\n", size)
                                    .unwrap();
                                write!(
                                    output,
                                    "            return Err(\"Buffer too small for array '{}'\");\n",
                                    field.name
                                )
                                .unwrap();
                                write!(output, "        }}\n").unwrap();
                                write!(
                                    output,
                                    "        offset += {}; // {} (array)\n\n",
                                    size, field.name
                                )
                                .unwrap();
                            } else {
                                write!(
                                    output,
                                    "        // TODO: validate variable-size array {}\n\n",
                                    field.name
                                )
                                .unwrap();
                            }
                        }
                        ResolvedTypeKind::TypeRef { .. } => {
                            if let crate::abi::resolved::Size::Const(size) = field.field_type.size {
                                write!(output, "        if offset + {} > data.len() {{\n", size)
                                    .unwrap();
                                write!(output, "            return Err(\"Buffer too small for nested struct '{}'\");\n", field.name).unwrap();
                                write!(output, "        }}\n").unwrap();
                                write!(
                                    output,
                                    "        offset += {}; // {} (nested struct)\n\n",
                                    size, field.name
                                )
                                .unwrap();
                            } else {
                                write!(
                                    output,
                                    "        // TODO: validate variable-size nested struct {}\n\n",
                                    field.name
                                )
                                .unwrap();
                            }
                        }
                        ResolvedTypeKind::Struct {
                            fields: nested_fields,
                            ..
                        } => {
                            if let crate::abi::resolved::Size::Const(size) = field.field_type.size {
                                let nested_struct_offset_var = format!("offset_{}", field.name);
                                write!(
                                    output,
                                    "        let {} = offset; /* Save offset for '{}' */\n",
                                    nested_struct_offset_var, field.name
                                )
                                .unwrap();

                                let mut nested_offset_within_struct: u64 = 0;
                                for nested_field in nested_fields {
                                    if let ResolvedTypeKind::Primitive { prim_type } =
                                        &nested_field.field_type.kind
                                    {
                                        let nested_field_path =
                                            format!("{}.{}", field.name, nested_field.name);
                                        let absolute_offset = if nested_offset_within_struct == 0 {
                                            nested_struct_offset_var.clone()
                                        } else {
                                            format!(
                                                "{} + {}",
                                                nested_struct_offset_var,
                                                nested_offset_within_struct
                                            )
                                        };
                                        field_offsets.insert(nested_field_path, absolute_offset);
                                        nested_offset_within_struct +=
                                            primitive_size(prim_type) as u64;
                                    }
                                }

                                write!(output, "        if offset + {} > data.len() {{\n", size)
                                    .unwrap();
                                write!(output, "            return Err(\"Buffer too small for nested struct '{}'\");\n", field.name).unwrap();
                                write!(output, "        }}\n").unwrap();
                                write!(
                                    output,
                                    "        offset += {}; /* {} (inline nested struct) */\n\n",
                                    size, field.name
                                )
                                .unwrap();
                            } else {
                                write!(
                                    output,
                                    "        /* Validate inline nested struct '{}' fields */\n",
                                    field.name
                                )
                                .unwrap();
                                for nested_field in nested_fields {
                                    match &nested_field.field_type.kind {
                                        ResolvedTypeKind::Primitive { prim_type } => {
                                            let size = primitive_size(prim_type);
                                            let nested_field_path =
                                                format!("{}.{}", field.name, nested_field.name);
                                            field_offsets
                                                .insert(nested_field_path, "offset".to_string());

                                            write!(
                                                output,
                                                "        if offset + {} > data.len() {{\n",
                                                size
                                            )
                                            .unwrap();
                                            write!(output, "            return Err(\"Buffer too small for field '{}.{}'\");\n", field.name, nested_field.name).unwrap();
                                            write!(output, "        }}\n").unwrap();
                                            write!(
                                                output,
                                                "        offset += {}; /* {}.{} */\n",
                                                size, field.name, nested_field.name
                                            )
                                            .unwrap();
                                        }
                                        ResolvedTypeKind::Array {
                                            element_type,
                                            size_expression,
                                            ..
                                        } => {
                                            if let crate::abi::resolved::Size::Const(array_size) =
                                                nested_field.field_type.size
                                            {
                                                write!(
                                                    output,
                                                    "        if offset + {} > data.len() {{\n",
                                                    array_size
                                                )
                                                .unwrap();
                                                write!(output, "            return Err(\"Buffer too small for array '{}.{}'\");\n", field.name, nested_field.name).unwrap();
                                                write!(output, "        }}\n").unwrap();
                                                write!(
                                                    output,
                                                    "        offset += {}; /* {}.{} (array) */\n",
                                                    array_size, field.name, nested_field.name
                                                )
                                                .unwrap();
                                            } else {
                                                if let crate::abi::resolved::Size::Const(
                                                    elem_size,
                                                ) = element_type.size
                                                {
                                                    let size_expr = expression_to_rust_data_read(
                                                        size_expression,
                                                        &field_offsets,
                                                    );
                                                    write!(
                                                        output,
                                                        "        let array_count_{} = ({}) as usize;\n",
                                                        nested_field.name, size_expr
                                                    )
                                                    .unwrap();
                                                    write!(output, "        let array_size_{} = array_count_{} * {};\n", nested_field.name, nested_field.name, elem_size).unwrap();
                                                    write!(output, "        if offset + array_size_{} > data.len() {{\n", nested_field.name).unwrap();
                                                    write!(output, "            return Err(\"Buffer too small for array '{}.{}'\");\n", field.name, nested_field.name).unwrap();
                                                    write!(output, "        }}\n").unwrap();
                                                    write!(output, "        offset += array_size_{}; /* {}.{} (variable array) */\n", nested_field.name, field.name, nested_field.name).unwrap();
                                                }
                                            }
                                        }
                                        _ => {
                                            write!(
                                                output,
                                                "        /* TODO: validate {}.{} of type {:?} */\n",
                                                field.name,
                                                nested_field.name,
                                                nested_field.field_type.kind
                                            )
                                            .unwrap();
                                        }
                                    }
                                }
                                write!(output, "\n").unwrap();
                            }
                        }
                        _ => {
                            write!(
                                output,
                                "        // TODO: validate {} of type {:?}\n\n",
                                field.name, field.field_type.kind
                            )
                            .unwrap();
                        }
                    }
                }

                write!(output, "        Ok(offset)\n").unwrap();
            }
            write!(output, "    }}\n\n").unwrap();

            /* For nested inline struct fields, generate accessor functions on the parent type */
            /* This allows the accessors to access parent fields that the nested struct's size expressions reference */
            for (field_idx, field) in fields.iter().enumerate() {
                if let ResolvedTypeKind::Struct {
                    fields: nested_fields,
                    ..
                } = &field.field_type.kind
                {
                    /* Generate accessors for this nested struct's fields as parent methods */
                    for nested_field in nested_fields {
                        match &nested_field.field_type.kind {
                            ResolvedTypeKind::Primitive { prim_type } => {
                                /* Generate primitive accessor on parent type */
                                /* This allows field ref paths like ["first", "count"] to call parent_type.first_count() */
                                let rust_type = match prim_type {
                                    crate::abi::types::PrimitiveType::Integral(int_type) => {
                                        match int_type {
                                            IntegralType::U8 => "u8",
                                            IntegralType::U16 => "u16",
                                            IntegralType::U32 => "u32",
                                            IntegralType::U64 => "u64",
                                            IntegralType::I8 => "i8",
                                            IntegralType::I16 => "i16",
                                            IntegralType::I32 => "i32",
                                            IntegralType::I64 => "i64",
                                            IntegralType::Char => "u8",
                                        }
                                    }
                                    crate::abi::types::PrimitiveType::FloatingPoint(float_type) => {
                                        match float_type {
                                            FloatingPointType::F16 => "f16",
                                            FloatingPointType::F32 => "f32",
                                            FloatingPointType::F64 => "f64",
                                        }
                                    }
                                };

                                write!(
                                    output,
                                    "    /* Nested struct {}.{} primitive accessor */\n",
                                    field.name, nested_field.name
                                )
                                .unwrap();
                                write!(
                                    output,
                                    "    pub fn {}_{}(&self) -> {} {{\n",
                                    field.name, nested_field.name, rust_type
                                )
                                .unwrap();

                                /* Calculate offset to this primitive field */
                                write!(output, "        let mut offset = 0;\n").unwrap();
                                /* Add size of all fields before the nested struct */
                                for prev_field in &fields[0..field_idx] {
                                    match &prev_field.field_type.kind {
                                        ResolvedTypeKind::Primitive {
                                            prim_type: prev_prim,
                                        } => {
                                            let size = primitive_size(prev_prim);
                                            write!(
                                                output,
                                                "        offset += {}; /* {} */\n",
                                                size, prev_field.name
                                            )
                                            .unwrap();
                                        }
                                        ResolvedTypeKind::Struct {
                                            fields: prev_nested_fields,
                                            ..
                                        } => {
                                            /* Add size of all fields in the previous nested struct */
                                            for prev_nested_field in prev_nested_fields {
                                                if let ResolvedTypeKind::Primitive {
                                                    prim_type: prev_nested_prim,
                                                } = &prev_nested_field.field_type.kind
                                                {
                                                    let size = primitive_size(prev_nested_prim);
                                                    write!(
                                                        output,
                                                        "        offset += {}; /* {}.{} */\n",
                                                        size,
                                                        prev_field.name,
                                                        prev_nested_field.name
                                                    )
                                                    .unwrap();
                                                }
                                            }
                                        }
                                        _ => {}
                                    }
                                }
                                /* Now add offsets within the current nested struct to reach this field */
                                if let ResolvedTypeKind::Struct {
                                    fields: current_nested_fields,
                                    ..
                                } = &field.field_type.kind
                                {
                                    for current_nested_field in current_nested_fields {
                                        if current_nested_field.name == nested_field.name {
                                            break; /* Found our field */
                                        }
                                        if let ResolvedTypeKind::Primitive {
                                            prim_type: current_nested_prim,
                                        } = &current_nested_field.field_type.kind
                                        {
                                            let size = primitive_size(current_nested_prim);
                                            write!(
                                                output,
                                                "        offset += {}; /* {}.{} */\n",
                                                size, field.name, current_nested_field.name
                                            )
                                            .unwrap();
                                        }
                                    }
                                }
                                let read_expr = emit_read_primitive(prim_type, "offset");
                                write!(output, "        {}\n", read_expr).unwrap();
                                write!(output, "    }}\n\n").unwrap();
                            }
                            ResolvedTypeKind::Array {
                                element_type,
                                size_expression,
                                ..
                            } => {
                                /* Generate array accessors on parent type */
                                if let ResolvedTypeKind::Primitive { prim_type } =
                                    &element_type.kind
                                {
                                    if !matches!(
                                        nested_field.field_type.size,
                                        crate::abi::resolved::Size::Const(..)
                                    ) {
                                        let rust_type = match prim_type {
                                            crate::abi::types::PrimitiveType::Integral(
                                                int_type,
                                            ) => match int_type {
                                                IntegralType::U8 => "u8",
                                                IntegralType::U16 => "u16",
                                                IntegralType::U32 => "u32",
                                                IntegralType::U64 => "u64",
                                                IntegralType::I8 => "i8",
                                                IntegralType::I16 => "i16",
                                                IntegralType::I32 => "i32",
                                                IntegralType::I64 => "i64",
                                                IntegralType::Char => "u8",
                                            },
                                            crate::abi::types::PrimitiveType::FloatingPoint(
                                                float_type,
                                            ) => match float_type {
                                                FloatingPointType::F16 => "f16",
                                                FloatingPointType::F32 => "f32",
                                                FloatingPointType::F64 => "f64",
                                            },
                                        };

                                        let elem_size = primitive_size(prim_type);

                                        /* Variable-size array - generate accessors on parent */
                                        let size_expr = size_expression_to_rust_getter_code(
                                            size_expression,
                                            "self",
                                        );

                                        write!(
                                            output,
                                            "    /* Nested struct {}.{} array accessors */\n",
                                            field.name, nested_field.name
                                        )
                                        .unwrap();

                                        /* Length getter */
                                        write!(
                                            output,
                                            "    pub fn {}_{}_len(&self) -> usize {{\n",
                                            field.name, nested_field.name
                                        )
                                        .unwrap();
                                        write!(output, "        ({}) as usize\n", size_expr)
                                            .unwrap();
                                        write!(output, "    }}\n\n").unwrap();

                                        /* Element getter */
                                        write!(
                                            output,
                                            "    pub fn {}_{}_get(&self, index: usize) -> {} {{\n",
                                            field.name, nested_field.name, rust_type
                                        )
                                        .unwrap();
                                        /* Calculate offset to nested struct start, then add array offset */
                                        write!(output, "        let mut offset = 0;\n").unwrap();
                                        /* Add size of all fields before the nested struct */
                                        for prev_field in &fields[0..field_idx] {
                                            match &prev_field.field_type.kind {
                                                ResolvedTypeKind::Primitive {
                                                    prim_type: prev_prim,
                                                } => {
                                                    let size = primitive_size(prev_prim);
                                                    write!(
                                                        output,
                                                        "        offset += {}; /* {} */\n",
                                                        size, prev_field.name
                                                    )
                                                    .unwrap();
                                                }
                                                ResolvedTypeKind::Struct {
                                                    fields: prev_nested_fields,
                                                    ..
                                                } => {
                                                    /* Add size of all fields in the previous nested struct */
                                                    for prev_nested_field in prev_nested_fields {
                                                        if let ResolvedTypeKind::Primitive {
                                                            prim_type: prev_nested_prim,
                                                        } = &prev_nested_field.field_type.kind
                                                        {
                                                            let size =
                                                                primitive_size(prev_nested_prim);
                                                            write!(output, "        offset += {}; /* {}.{} */\n", size, prev_field.name, prev_nested_field.name).unwrap();
                                                        }
                                                    }
                                                }
                                                _ => {}
                                            }
                                        }
                                        /* Now we're at the nested struct start - add index * element_size for array */
                                        write!(
                                            output,
                                            "        offset += index * {}; /* {}[index] */\n",
                                            elem_size, nested_field.name
                                        )
                                        .unwrap();
                                        let read_expr = emit_read_primitive(prim_type, "offset");
                                        write!(output, "        {}\n", read_expr).unwrap();
                                        write!(output, "    }}\n\n").unwrap();
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                }
            }

            // Generate size() method for types that can be jagged array elements
            // Only for types with params like "array_field.size_field" (exactly one dot)
            // where size_field is an actual primitive field on this struct
            if let Some(ir) = type_ir {
                // Collect primitive field names from this struct
                let primitive_field_names: std::collections::HashSet<&str> = fields
                    .iter()
                    .filter_map(|f| {
                        if matches!(f.field_type.kind, ResolvedTypeKind::Primitive { .. }) {
                            Some(f.name.as_str())
                        } else {
                            None
                        }
                    })
                    .collect();

                let is_jagged_element_candidate = !ir.parameters.is_empty()
                    && ir.parameters.iter().all(|p| {
                        let parts: Vec<&str> = p.name.split('.').collect();
                        // Must have exactly "field.getter" pattern
                        // AND the getter must be an actual primitive field on this struct
                        parts.len() == 2 && primitive_field_names.contains(parts[1])
                    });

                if is_jagged_element_candidate {
                    use super::ir_helpers::sanitize_param_name;

                    writeln!(output, "    /// Returns the byte size of this instance.").unwrap();
                    writeln!(output, "    pub fn size(&self) -> usize {{").unwrap();

                    // Build parameter extraction - map IR params to getter calls
                    // Param "array_field.size_field" -> getter "self.size_field()"
                    let mut param_args = Vec::new();
                    for param in &ir.parameters {
                        let getter_name = param.name.split('.').last().unwrap_or(&param.name);
                        param_args.push(format!("self.{}() as u64", getter_name));
                    }

                    let fn_name = sanitize_param_name(&type_name);
                    writeln!(
                        output,
                        "        {}_footprint_ir({}) as usize",
                        fn_name,
                        param_args.join(", ")
                    ).unwrap();
                    writeln!(output, "    }}\n").unwrap();
                }
            }

            write!(output, "}}\n\n").unwrap();

            // Generate impl for mutable version
            write!(output, "impl<'a> {}Mut<'a> {{\n", type_name).unwrap();

            // from_slice_mut() constructor
            write!(
                output,
                "    pub fn from_slice_mut(data: &'a mut [u8]) -> Result<Self, &'static str> {{\n"
            )
            .unwrap();
            write!(output, "        {}::<'a>::validate(data)?;\n", type_name).unwrap();
            write!(output, "        Ok(Self {{ data }})\n").unwrap();
            write!(output, "    }}\n\n").unwrap();

            // Generate getters for primitive fields (needed for offset calculation in setters)
            for (field_idx, field) in fields.iter().enumerate() {
                if let ResolvedTypeKind::Primitive { prim_type } = &field.field_type.kind {
                    let rust_type = match prim_type {
                        crate::abi::types::PrimitiveType::Integral(int_type) => match int_type {
                            IntegralType::U8 => "u8",
                            IntegralType::U16 => "u16",
                            IntegralType::U32 => "u32",
                            IntegralType::U64 => "u64",
                            IntegralType::I8 => "i8",
                            IntegralType::I16 => "i16",
                            IntegralType::I32 => "i32",
                            IntegralType::I64 => "i64",
                            IntegralType::Char => "u8",
                        },
                        crate::abi::types::PrimitiveType::FloatingPoint(float_type) => {
                            match float_type {
                                FloatingPointType::F16 => "f16",
                                FloatingPointType::F32 => "f32",
                                FloatingPointType::F64 => "f64",
                            }
                        }
                    };

                    write!(
                        output,
                        "    pub fn {}(&self) -> {} {{\n",
                        field.name, rust_type
                    )
                    .unwrap();

                    // Calculate offset based on previous fields
                    if field_idx == 0 {
                        // First field at offset 0
                        let read_expr = emit_read_primitive(prim_type, "0");
                        write!(output, "        {}\n", read_expr).unwrap();
                    } else {
                        // Need to calculate offset based on previous fields
                        write!(output, "        let mut offset = 0;\n").unwrap();
                        for prev_field in &fields[0..field_idx] {
                            match &prev_field.field_type.kind {
                                ResolvedTypeKind::Primitive {
                                    prim_type: prev_prim,
                                } => {
                                    let size = primitive_size(prev_prim);
                                    write!(
                                        output,
                                        "        offset += {}; // {}\n",
                                        size, prev_field.name
                                    )
                                    .unwrap();
                                }
                                ResolvedTypeKind::Enum { .. } => {
                                    write!(
                                        output,
                                        "        offset += self.{}_size(); // {} (variable size)\n",
                                        prev_field.name, prev_field.name
                                    )
                                    .unwrap();
                                }
                                ResolvedTypeKind::Array {
                                    element_type,
                                    size_expression,
                                    ..
                                } => {
                                    if let crate::abi::resolved::Size::Const(size) =
                                        prev_field.field_type.size
                                    {
                                        write!(
                                            output,
                                            "        offset += {}; // {} (array)\n",
                                            size, prev_field.name
                                        )
                                        .unwrap();
                                    } else {
                                        // Variable-size array - calculate size using inline field access
                                        if let crate::abi::resolved::Size::Const(elem_size) =
                                            element_type.size
                                        {
                                            let size_expr = size_expression_to_rust_getter_code(
                                                size_expression,
                                                "self",
                                            );
                                            write!(output, "        offset += (({}) as usize) * {}; // {} (variable array)\n",
                                                   size_expr, elem_size, prev_field.name).unwrap();
                                        }
                                    }
                                }
                                ResolvedTypeKind::TypeRef { .. } => {
                                    if let crate::abi::resolved::Size::Const(size) =
                                        prev_field.field_type.size
                                    {
                                        write!(
                                            output,
                                            "        offset += {}; // {} (nested struct)\n",
                                            size, prev_field.name
                                        )
                                        .unwrap();
                                    }
                                }
                                _ => {
                                    write!(
                                        output,
                                        "        // TODO: handle {} of type {:?}\n",
                                        prev_field.name, prev_field.field_type.kind
                                    )
                                    .unwrap();
                                }
                            }
                        }
                        let read_expr = emit_read_primitive(prim_type, "offset");
                        write!(output, "        {}\n", read_expr).unwrap();
                    }

                    write!(output, "    }}\n\n").unwrap();
                }
            }

            // Generate array length helpers for variable-size arrays (needed for offset calculation)
            // Also generate jagged array Mut accessors
            for (field_idx, field) in fields.iter().enumerate() {
                if let ResolvedTypeKind::Array {
                    element_type,
                    size_expression,
                    size_constant_status,
                    jagged,
                    ..
                } = &field.field_type.kind
                {
                    use crate::abi::resolved::ConstantStatus;

                    // Handle jagged arrays specially
                    if *jagged {
                        if let ResolvedTypeKind::TypeRef { target_name, .. } = &element_type.kind {
                            // Build count expression and offset setup for jagged array
                            let count_expr = size_expression_to_rust_getter_code(size_expression, "self");

                            let mut offset_setup = String::new();
                            writeln!(offset_setup, "        let mut offset = 0;").unwrap();
                            for prev_field in &fields[0..field_idx] {
                                match &prev_field.field_type.kind {
                                    ResolvedTypeKind::Primitive { prim_type: prev_prim } => {
                                        let size = primitive_size(prev_prim);
                                        writeln!(offset_setup, "        offset += {}; // {}", size, prev_field.name).unwrap();
                                    }
                                    ResolvedTypeKind::Array { jagged: prev_jagged, .. } => {
                                        if let crate::abi::resolved::Size::Const(size) = prev_field.field_type.size {
                                            writeln!(offset_setup, "        offset += {}; // {} (array)", size, prev_field.name).unwrap();
                                        } else if *prev_jagged {
                                            writeln!(offset_setup, "        offset += {{ let temp = {} {{ data: &self.data }}; temp.{}_size() }}; // {} (jagged array)", type_name, prev_field.name, prev_field.name).unwrap();
                                        }
                                    }
                                    _ => {}
                                }
                            }

                            emit_jagged_array_mut_accessors(
                                &mut output,
                                &type_name,
                                &field.name,
                                target_name,
                                &count_expr,
                                &offset_setup,
                            );
                        }
                        continue;
                    }

                    if !matches!(size_constant_status, ConstantStatus::Constant) {
                        // Check if size expression would collide with array _len() method name
                        let skip_len_method = size_expr_matches_len_field(size_expression, &field.name);

                        // Generate length method only if it wouldn't collide
                        if !skip_len_method {
                            // Variable-size array - generate length method
                            let size_expr_str =
                                size_expression_to_rust_getter_code(size_expression, "self");
                            write!(output, "    pub fn {}_len(&self) -> usize {{\n", field.name)
                                .unwrap();
                            /* For nested structs, use data.len() instead of calling parent field getters */
                            if is_nested {
                                /* Get element size */
                                let elem_size: usize = match &element_type.kind {
                                    ResolvedTypeKind::Primitive { prim_type } => {
                                        primitive_size(prim_type)
                                    }
                                    _ => {
                                        if let crate::abi::resolved::Size::Const(size) =
                                            element_type.size
                                        {
                                            size as usize
                                        } else {
                                            1_usize /* fallback */
                                        }
                                    }
                                };
                                write!(output, "        self.data.len() / {}\n", elem_size).unwrap();
                            } else {
                                write!(output, "        ({}) as usize\n", size_expr_str).unwrap();
                            }
                            write!(output, "    }}\n\n").unwrap();
                        }
                    }
                }
            }

            // Generate enum size helpers (needed for offset calculation)
            for field in fields.iter() {
                if let ResolvedTypeKind::Enum {
                    variants,
                    tag_expression,
                    ..
                } = &field.field_type.kind
                {
                    // Generate size helper for this enum
                    write!(output, "    fn {}_size(&self) -> usize {{\n", field.name).unwrap();

                    // Generate tag expression code using getter methods
                    let tag_expr = size_expression_to_rust_getter_code(tag_expression, "self");
                    write!(output, "        let tag = ({}) as u8;\n", tag_expr).unwrap();

                    write!(output, "        match tag {{\n").unwrap();
                    for variant in variants {
                        if let crate::abi::resolved::Size::Const(size) = variant.variant_type.size {
                            write!(output, "            {} => {},\n", variant.tag_value, size)
                                .unwrap();
                        }
                    }
                    write!(output, "            _ => 0,\n").unwrap();
                    write!(output, "        }}\n").unwrap();
                    write!(output, "    }}\n\n").unwrap();
                }
            }

            // Generate setters for each field
            for (field_idx, field) in fields.iter().enumerate() {
                match &field.field_type.kind {
                    ResolvedTypeKind::Primitive { prim_type } => {
                        let rust_type = match prim_type {
                            crate::abi::types::PrimitiveType::Integral(int_type) => {
                                match int_type {
                                    IntegralType::U8 => "u8",
                                    IntegralType::U16 => "u16",
                                    IntegralType::U32 => "u32",
                                    IntegralType::U64 => "u64",
                                    IntegralType::I8 => "i8",
                                    IntegralType::I16 => "i16",
                                    IntegralType::I32 => "i32",
                                    IntegralType::I64 => "i64",
                                    IntegralType::Char => "u8",
                                }
                            }
                            crate::abi::types::PrimitiveType::FloatingPoint(float_type) => {
                                match float_type {
                                    FloatingPointType::F16 => "f16",
                                    FloatingPointType::F32 => "f32",
                                    FloatingPointType::F64 => "f64",
                                }
                            }
                        };

                        write!(
                            output,
                            "    pub fn set_{}(&mut self, value: {}) {{\n",
                            field.name, rust_type
                        )
                        .unwrap();

                        // Calculate offset
                        if field_idx == 0 {
                            let write_expr = emit_write_primitive(prim_type, "0", "value");
                            write!(output, "        {}\n", write_expr).unwrap();
                        } else {
                            write!(output, "        let mut offset = 0;\n").unwrap();
                            for prev_field in &fields[0..field_idx] {
                                match &prev_field.field_type.kind {
                                    ResolvedTypeKind::Primitive {
                                        prim_type: prev_prim,
                                    } => {
                                        let size = primitive_size(prev_prim);
                                        write!(
                                            output,
                                            "        offset += {}; // {}\n",
                                            size, prev_field.name
                                        )
                                        .unwrap();
                                    }
                                    ResolvedTypeKind::Enum { .. } => {
                                        // For enum fields, we need to calculate size dynamically
                                        // This requires creating an immutable reference to read the tag
                                        write!(output, "        offset += ({{ let temp = {} {{ data: &self.data }}; temp.{}_size() }}); // {} (variable size)\n", type_name, prev_field.name, prev_field.name).unwrap();
                                    }
                                    ResolvedTypeKind::Array {
                                        element_type,
                                        size_expression,
                                        ..
                                    } => {
                                        if let crate::abi::resolved::Size::Const(size) =
                                            prev_field.field_type.size
                                        {
                                            write!(
                                                output,
                                                "        offset += {}; // {} (array)\n",
                                                size, prev_field.name
                                            )
                                            .unwrap();
                                        } else {
                                            // Variable-size array - calculate size using inline field access
                                            if let crate::abi::resolved::Size::Const(elem_size) =
                                                element_type.size
                                            {
                                                let size_expr = size_expression_to_rust_getter_code(
                                                    size_expression,
                                                    "self",
                                                );
                                                write!(output, "        offset += (({}) as usize) * {}; // {} (variable array)\n",
                                                       size_expr, elem_size, prev_field.name).unwrap();
                                            }
                                        }
                                    }
                                    ResolvedTypeKind::TypeRef { .. } => {
                                        if let crate::abi::resolved::Size::Const(size) =
                                            prev_field.field_type.size
                                        {
                                            write!(
                                                output,
                                                "        offset += {}; // {} (nested struct)\n",
                                                size, prev_field.name
                                            )
                                            .unwrap();
                                        }
                                    }
                                    _ => {
                                        write!(
                                            output,
                                            "        // TODO: handle {} of type {:?}\n",
                                            prev_field.name, prev_field.field_type.kind
                                        )
                                        .unwrap();
                                    }
                                }
                            }
                            let write_expr = emit_write_primitive(prim_type, "offset", "value");
                            write!(output, "        {}\n", write_expr).unwrap();
                        }

                        write!(output, "    }}\n\n").unwrap();
                    }
                    ResolvedTypeKind::Enum { .. } => {
                        // Generate enum body setter
                        write!(output, "    pub fn set_{}_body(&mut self, body: &[u8]) -> Result<(), &'static str> {{\n", field.name).unwrap();

                        // Calculate expected size from immutable reference
                        write!(output, "        let expected_size = {{\n").unwrap();
                        write!(
                            output,
                            "            let temp = {} {{ data: &self.data }};\n",
                            type_name
                        )
                        .unwrap();
                        write!(output, "            temp.{}_size()\n", field.name).unwrap();
                        write!(output, "        }};\n\n").unwrap();

                        write!(output, "        if body.len() != expected_size {{\n").unwrap();
                        write!(output, "            return Err(\"Body size mismatch\");\n")
                            .unwrap();
                        write!(output, "        }}\n\n").unwrap();

                        // Calculate offset to enum body
                        if field_idx == 0 {
                            write!(output, "        let offset = 0;\n").unwrap();
                        } else {
                            write!(output, "        let mut offset = 0;\n").unwrap();
                            for prev_field in &fields[0..field_idx] {
                                match &prev_field.field_type.kind {
                                    ResolvedTypeKind::Primitive {
                                        prim_type: prev_prim,
                                    } => {
                                        let size = primitive_size(prev_prim);
                                        write!(
                                            output,
                                            "        offset += {}; // {}\n",
                                            size, prev_field.name
                                        )
                                        .unwrap();
                                    }
                                    ResolvedTypeKind::Enum { .. } => {
                                        write!(output, "        offset += ({{ let temp = {} {{ data: &self.data }}; temp.{}_size() }}); // {} (variable size)\n", type_name, prev_field.name, prev_field.name).unwrap();
                                    }
                                    ResolvedTypeKind::SizeDiscriminatedUnion { .. } => {
                                        write!(output, "        offset += ({{ let temp = {} {{ data: &self.data }}; temp.{}_size() }}); // {} (variable size)\n", type_name, prev_field.name, prev_field.name).unwrap();
                                    }
                                    ResolvedTypeKind::Array {
                                        element_type,
                                        size_expression,
                                        ..
                                    } => {
                                        if let crate::abi::resolved::Size::Const(size) =
                                            prev_field.field_type.size
                                        {
                                            write!(
                                                output,
                                                "        offset += {}; // {} (array)\n",
                                                size, prev_field.name
                                            )
                                            .unwrap();
                                        } else {
                                            // Variable-size array - calculate size using inline field access
                                            if let crate::abi::resolved::Size::Const(elem_size) =
                                                element_type.size
                                            {
                                                let size_expr = size_expression_to_rust_getter_code(
                                                    size_expression,
                                                    "self",
                                                );
                                                write!(output, "        offset += (({}) as usize) * {}; // {} (variable array)\n",
                                                       size_expr, elem_size, prev_field.name).unwrap();
                                            }
                                        }
                                    }
                                    ResolvedTypeKind::TypeRef { .. } => {
                                        if let crate::abi::resolved::Size::Const(size) =
                                            prev_field.field_type.size
                                        {
                                            write!(
                                                output,
                                                "        offset += {}; // {} (nested struct)\n",
                                                size, prev_field.name
                                            )
                                            .unwrap();
                                        }
                                    }
                                    _ => {}
                                }
                            }
                        }

                        write!(output, "        self.data[offset..offset + expected_size].copy_from_slice(body);\n").unwrap();
                        write!(output, "        Ok(())\n").unwrap();
                        write!(output, "    }}\n\n").unwrap();
                    }
                    ResolvedTypeKind::SizeDiscriminatedUnion { variants } => {
                        // Generate variant-specific setters for each variant (like enums)
                        for variant in variants {
                            let variant_name_snake = variant.name.to_lowercase().replace("-", "_");
                            // Type name format matches collect_nested_type_definitions: {parent}_{field}_inner_{variant}_inner
                            // But for opaque wrappers, it's just {parent}_{field}_{variant}
                            let variant_type_name =
                                format!("{}_{}_{}", type_name, field.name, variant.name);

                            write!(output, "    pub fn {}_set_{}(&mut self, value: &{}<'_>) -> Result<(), &'static str> {{\n", 
                                   field.name, variant_name_snake, variant_type_name).unwrap();

                            // Calculate offset to size-discriminated union body
                            if field_idx == 0 {
                                write!(output, "        let offset = 0;\n").unwrap();
                            } else {
                                write!(output, "        let mut offset = 0;\n").unwrap();
                                for prev_field in &fields[0..field_idx] {
                                    match &prev_field.field_type.kind {
                                        ResolvedTypeKind::Primitive {
                                            prim_type: prev_prim,
                                        } => {
                                            let size = primitive_size(prev_prim);
                                            write!(
                                                output,
                                                "        offset += {}; // {}\n",
                                                size, prev_field.name
                                            )
                                            .unwrap();
                                        }
                                        ResolvedTypeKind::Enum { .. } => {
                                            write!(output, "        offset += ({{ let temp = {} {{ data: &self.data }}; temp.{}_size() }}); // {} (variable size)\n", type_name, prev_field.name, prev_field.name).unwrap();
                                        }
                                        ResolvedTypeKind::SizeDiscriminatedUnion { .. } => {
                                            write!(output, "        offset += ({{ let temp = {} {{ data: &self.data }}; temp.{}_size() }}); // {} (variable size)\n", type_name, prev_field.name, prev_field.name).unwrap();
                                        }
                                        ResolvedTypeKind::Array {
                                            element_type,
                                            size_expression,
                                            ..
                                        } => {
                                            if let crate::abi::resolved::Size::Const(size) =
                                                prev_field.field_type.size
                                            {
                                                write!(
                                                    output,
                                                    "        offset += {}; // {} (array)\n",
                                                    size, prev_field.name
                                                )
                                                .unwrap();
                                            } else {
                                                // Variable-size array - calculate size using inline field access
                                                if let crate::abi::resolved::Size::Const(
                                                    elem_size,
                                                ) = element_type.size
                                                {
                                                    let size_expr =
                                                        size_expression_to_rust_getter_code(
                                                            size_expression,
                                                            "self",
                                                        );
                                                    write!(output, "        offset += (({}) as usize) * {}; // {} (variable array)\n",
                                                           size_expr, elem_size, prev_field.name).unwrap();
                                                }
                                            }
                                        }
                                        ResolvedTypeKind::TypeRef { .. } => {
                                            if let crate::abi::resolved::Size::Const(size) =
                                                prev_field.field_type.size
                                            {
                                                write!(
                                                    output,
                                                    "        offset += {}; // {} (nested struct)\n",
                                                    size, prev_field.name
                                                )
                                                .unwrap();
                                            }
                                        }
                                        _ => {}
                                    }
                                }
                            }

                            write!(output, "        self.data[offset..offset + {}].copy_from_slice(&value.data);\n", variant.expected_size).unwrap();
                            write!(output, "        Ok(())\n").unwrap();
                            write!(output, "    }}\n\n").unwrap();
                        }
                    }
                    ResolvedTypeKind::Array {
                        element_type,
                        size_constant_status,
                        ..
                    } => {
                        // Generate array element setter
                        use crate::abi::resolved::ConstantStatus;

                        if matches!(size_constant_status, ConstantStatus::Constant) {
                            // Calculate array size
                            let array_size = if let crate::abi::resolved::Size::Const(total_size) =
                                field.field_type.size
                            {
                                let elem_size = match &element_type.size {
                                    crate::abi::resolved::Size::Const(s) => *s,
                                    _ => 1,
                                };
                                total_size / elem_size
                            } else {
                                0
                            };

                            // Get element type info for primitives
                            if let ResolvedTypeKind::Primitive { prim_type } = &element_type.kind {
                                let rust_type = match prim_type {
                                    crate::abi::types::PrimitiveType::Integral(int_type) => {
                                        match int_type {
                                            IntegralType::U8 => "u8",
                                            IntegralType::U16 => "u16",
                                            IntegralType::U32 => "u32",
                                            IntegralType::U64 => "u64",
                                            IntegralType::I8 => "i8",
                                            IntegralType::I16 => "i16",
                                            IntegralType::I32 => "i32",
                                            IntegralType::I64 => "i64",
                                            IntegralType::Char => "u8",
                                        }
                                    }
                                    crate::abi::types::PrimitiveType::FloatingPoint(float_type) => {
                                        match float_type {
                                            FloatingPointType::F16 => "f16",
                                            FloatingPointType::F32 => "f32",
                                            FloatingPointType::F64 => "f64",
                                        }
                                    }
                                };

                                let elem_size = primitive_size(prim_type);

                                // Check if this is a byte array
                                if matches!(
                                    prim_type,
                                    crate::abi::types::PrimitiveType::Integral(IntegralType::U8)
                                ) {
                                    // Byte array - provide slice setter
                                    write!(
                                        output,
                                        "    pub fn set_{}(&mut self, value: &[u8]) {{\n",
                                        field.name
                                    )
                                    .unwrap();
                                    write!(
                                        output,
                                        "        let len = value.len().min({});\n",
                                        array_size
                                    )
                                    .unwrap();

                                    // Calculate base offset
                                    if field_idx == 0 {
                                        write!(output, "        self.data[0..len].copy_from_slice(&value[0..len]);\n").unwrap();
                                    } else {
                                        write!(output, "        let mut offset = 0;\n").unwrap();
                                        for prev_field in &fields[0..field_idx] {
                                            match &prev_field.field_type.kind {
                                                ResolvedTypeKind::Primitive {
                                                    prim_type: prev_prim,
                                                } => {
                                                    let size = primitive_size(prev_prim);
                                                    write!(
                                                        output,
                                                        "        offset += {}; // {}\n",
                                                        size, prev_field.name
                                                    )
                                                    .unwrap();
                                                }
                                                ResolvedTypeKind::Enum { .. } => {
                                                    write!(output, "        offset += ({{ let temp = {} {{ data: &self.data }}; temp.{}_size() }}); // {} (variable size)\n", type_name, prev_field.name, prev_field.name).unwrap();
                                                }
                                                ResolvedTypeKind::Array { .. } => {
                                                    if let crate::abi::resolved::Size::Const(size) =
                                                        prev_field.field_type.size
                                                    {
                                                        write!(
                                                            output,
                                                            "        offset += {}; // {} (array)\n",
                                                            size, prev_field.name
                                                        )
                                                        .unwrap();
                                                    }
                                                }
                                                ResolvedTypeKind::TypeRef { .. } => {
                                                    if let crate::abi::resolved::Size::Const(size) =
                                                        prev_field.field_type.size
                                                    {
                                                        write!(output, "        offset += {}; // {} (nested struct)\n", size, prev_field.name).unwrap();
                                                    }
                                                }
                                                _ => {}
                                            }
                                        }
                                        write!(output, "        self.data[offset..offset + len].copy_from_slice(&value[0..len]);\n").unwrap();
                                    }
                                    write!(output, "    }}\n\n").unwrap();
                                } else {
                                    // Non-byte array - generate element-wise setter
                                    write!(output, "    pub fn {}_set(&mut self, index: usize, value: {}) {{\n", field.name, rust_type).unwrap();
                                    write!(output, "        if index >= {} {{\n", array_size)
                                        .unwrap();
                                    write!(output, "            panic!(\"Index {{}} out of bounds for array '{}' of length {}\", index);\n", field.name, array_size).unwrap();
                                    write!(output, "        }}\n").unwrap();

                                    // Calculate base offset
                                    if field_idx == 0 {
                                        write!(output, "        let base_offset = 0;\n").unwrap();
                                    } else {
                                        write!(output, "        let mut base_offset = 0;\n")
                                            .unwrap();
                                        for prev_field in &fields[0..field_idx] {
                                            match &prev_field.field_type.kind {
                                                ResolvedTypeKind::Primitive {
                                                    prim_type: prev_prim,
                                                } => {
                                                    let size = primitive_size(prev_prim);
                                                    write!(
                                                        output,
                                                        "        base_offset += {}; // {}\n",
                                                        size, prev_field.name
                                                    )
                                                    .unwrap();
                                                }
                                                ResolvedTypeKind::Enum { .. } => {
                                                    write!(output, "        base_offset += ({{ let temp = {} {{ data: &self.data }}; temp.{}_size() }}); // {} (variable size)\n", type_name, prev_field.name, prev_field.name).unwrap();
                                                }
                                                ResolvedTypeKind::Array { .. } => {
                                                    if let crate::abi::resolved::Size::Const(size) =
                                                        prev_field.field_type.size
                                                    {
                                                        write!(output, "        base_offset += {}; // {} (array)\n", size, prev_field.name).unwrap();
                                                    }
                                                }
                                                ResolvedTypeKind::TypeRef { .. } => {
                                                    if let crate::abi::resolved::Size::Const(size) =
                                                        prev_field.field_type.size
                                                    {
                                                        write!(output, "        base_offset += {}; // {} (nested struct)\n", size, prev_field.name).unwrap();
                                                    }
                                                }
                                                _ => {}
                                            }
                                        }
                                    }

                                    // Calculate element offset and write
                                    write!(
                                        output,
                                        "        let offset = base_offset + index * {};\n",
                                        elem_size
                                    )
                                    .unwrap();
                                    let write_expr =
                                        emit_write_primitive(prim_type, "offset", "value");
                                    write!(output, "        {}\n", write_expr).unwrap();
                                    write!(output, "    }}\n\n").unwrap();
                                }
                            } else if let ResolvedTypeKind::TypeRef { target_name, .. } =
                                &element_type.kind
                            {
                                // Array of structs - element type must have constant size
                                if let crate::abi::resolved::Size::Const(elem_size) =
                                    element_type.size
                                {
                                    // Generate element setter - accepts opaque wrapper by reference
                                    write!(output, "    pub fn {}_set(&mut self, index: usize, value: &{}<'_>) {{\n", field.name, target_name).unwrap();
                                    write!(output, "        if index >= {} {{\n", array_size)
                                        .unwrap();
                                    write!(output, "            panic!(\"Index {{}} out of bounds for array '{}' of length {}\", index);\n", field.name, array_size).unwrap();
                                    write!(output, "        }}\n").unwrap();

                                    // Calculate base offset
                                    if field_idx == 0 {
                                        write!(output, "        let base_offset = 0;\n").unwrap();
                                    } else {
                                        write!(output, "        let mut base_offset = 0;\n")
                                            .unwrap();
                                        for prev_field in &fields[0..field_idx] {
                                            match &prev_field.field_type.kind {
                                                ResolvedTypeKind::Primitive {
                                                    prim_type: prev_prim,
                                                } => {
                                                    let size = primitive_size(prev_prim);
                                                    write!(
                                                        output,
                                                        "        base_offset += {}; // {}\n",
                                                        size, prev_field.name
                                                    )
                                                    .unwrap();
                                                }
                                                ResolvedTypeKind::Enum { .. } => {
                                                    write!(output, "        base_offset += ({{ let temp = {} {{ data: &self.data }}; temp.{}_size() }}); // {} (variable size)\n", type_name, prev_field.name, prev_field.name).unwrap();
                                                }
                                                ResolvedTypeKind::Array { .. } => {
                                                    if let crate::abi::resolved::Size::Const(size) =
                                                        prev_field.field_type.size
                                                    {
                                                        write!(output, "        base_offset += {}; // {} (array)\n", size, prev_field.name).unwrap();
                                                    }
                                                }
                                                ResolvedTypeKind::TypeRef { .. } => {
                                                    if let crate::abi::resolved::Size::Const(size) =
                                                        prev_field.field_type.size
                                                    {
                                                        write!(output, "        base_offset += {}; // {} (nested struct)\n", size, prev_field.name).unwrap();
                                                    }
                                                }
                                                _ => {}
                                            }
                                        }
                                    }

                                    // Calculate element offset and copy struct data
                                    write!(
                                        output,
                                        "        let offset = base_offset + index * {};\n",
                                        elem_size
                                    )
                                    .unwrap();
                                    write!(output, "        self.data[offset..offset + {}].copy_from_slice(value.data);\n", elem_size).unwrap();
                                    write!(output, "    }}\n\n").unwrap();
                                }
                            }
                        } else {
                            // Variable-size array (FAM) - generate setters
                            if let ResolvedTypeKind::Array {
                                element_type,
                                size_expression,
                                ..
                            } = &field.field_type.kind
                            {
                                // Check if _len method was skipped due to name collision
                                let skip_len_method = size_expr_matches_len_field(size_expression, &field.name);
                                // Helper to emit offset calculation
                                let emit_base_offset = |output: &mut String| {
                                    if field_idx == 0 {
                                        write!(output, "        let base_offset = 0;\n").unwrap();
                                    } else {
                                        write!(output, "        let mut base_offset = 0;\n")
                                            .unwrap();
                                        for prev_field in &fields[0..field_idx] {
                                            match &prev_field.field_type.kind {
                                                ResolvedTypeKind::Primitive {
                                                    prim_type: prev_prim,
                                                } => {
                                                    let size = primitive_size(prev_prim);
                                                    write!(
                                                        output,
                                                        "        base_offset += {}; // {}\n",
                                                        size, prev_field.name
                                                    )
                                                    .unwrap();
                                                }
                                                ResolvedTypeKind::Enum { .. } => {
                                                    write!(output, "        base_offset += ({{ let temp = {} {{ data: &self.data }}; temp.{}_size() }}); // {} (variable size)\n", type_name, prev_field.name, prev_field.name).unwrap();
                                                }
                                                ResolvedTypeKind::Array { .. } => {
                                                    if let crate::abi::resolved::Size::Const(size) =
                                                        prev_field.field_type.size
                                                    {
                                                        write!(output, "        base_offset += {}; // {} (array)\n", size, prev_field.name).unwrap();
                                                    } else {
                                                        // Variable-size array
                                                        write!(output, "        base_offset += ({{ let temp = {} {{ data: &self.data }}; temp.{}_len() }}) * {}; // {} (variable-size array)\n",
                                                               type_name,
                                                               prev_field.name,
                                                               if let ResolvedTypeKind::Array { element_type, .. } = &prev_field.field_type.kind {
                                                                   if let crate::abi::resolved::Size::Const(elem_size) = element_type.size {
                                                                       elem_size.to_string()
                                                                   } else {
                                                                       "0 /* TODO */".to_string()
                                                                   }
                                                               } else {
                                                                   "0".to_string()
                                                               },
                                                               prev_field.name).unwrap();
                                                    }
                                                }
                                                ResolvedTypeKind::TypeRef { .. } => {
                                                    if let crate::abi::resolved::Size::Const(size) =
                                                        prev_field.field_type.size
                                                    {
                                                        write!(output, "        base_offset += {}; // {} (nested struct)\n", size, prev_field.name).unwrap();
                                                    }
                                                }
                                                _ => {}
                                            }
                                        }
                                    }
                                };

                                if let ResolvedTypeKind::Primitive { prim_type } =
                                    &element_type.kind
                                {
                                    let rust_type = match prim_type {
                                        crate::abi::types::PrimitiveType::Integral(int_type) => {
                                            match int_type {
                                                IntegralType::U8 => "u8",
                                                IntegralType::U16 => "u16",
                                                IntegralType::U32 => "u32",
                                                IntegralType::U64 => "u64",
                                                IntegralType::I8 => "i8",
                                                IntegralType::I16 => "i16",
                                                IntegralType::I32 => "i32",
                                                IntegralType::I64 => "i64",
                                                IntegralType::Char => "u8",
                                            }
                                        }
                                        crate::abi::types::PrimitiveType::FloatingPoint(
                                            float_type,
                                        ) => match float_type {
                                            FloatingPointType::F16 => "f16",
                                            FloatingPointType::F32 => "f32",
                                            FloatingPointType::F64 => "f64",
                                        },
                                    };

                                    let elem_size = primitive_size(prim_type);

                                    // Convert expression to Rust code that calls getters
                                    let size_expr_str =
                                        size_expression_to_rust_getter_code(size_expression, "self");

                                    // Generate element setter
                                    write!(output, "    pub fn {}_set(&mut self, index: usize, value: {}) {{\n", field.name, rust_type).unwrap();
                                    // Use size expression directly with cast when _len method was skipped
                                    if skip_len_method {
                                        write!(
                                            output,
                                            "        let len = ({}) as usize;\n",
                                            size_expr_str
                                        )
                                        .unwrap();
                                    } else {
                                        write!(
                                            output,
                                            "        let len = self.{}_len();\n",
                                            field.name
                                        )
                                        .unwrap();
                                    }
                                    write!(output, "        if index >= len {{\n").unwrap();
                                    write!(output, "            panic!(\"Index {{}} out of bounds for array '{}' of length {{}}\", index, len);\n", field.name).unwrap();
                                    write!(output, "        }}\n").unwrap();
                                    emit_base_offset(&mut output);
                                    write!(
                                        output,
                                        "        let offset = base_offset + index * {};\n",
                                        elem_size
                                    )
                                    .unwrap();
                                    let write_expr =
                                        emit_write_primitive(prim_type, "offset", "value");
                                    write!(output, "        {}\n", write_expr).unwrap();
                                    write!(output, "    }}\n\n").unwrap();

                                    // For u8 arrays, also provide slice setter
                                    if matches!(
                                        prim_type,
                                        crate::abi::types::PrimitiveType::Integral(
                                            IntegralType::U8
                                        )
                                    ) {
                                        write!(
                                            output,
                                            "    pub fn set_{}(&mut self, value: &[u8]) {{\n",
                                            field.name
                                        )
                                        .unwrap();
                                        // Use size expression directly with cast when _len method was skipped
                                        if skip_len_method {
                                            write!(
                                                output,
                                                "        let len = (({}) as usize).min(value.len());\n",
                                                size_expr_str
                                            )
                                            .unwrap();
                                        } else {
                                            write!(
                                                output,
                                                "        let len = self.{}_len().min(value.len());\n",
                                                field.name
                                            )
                                            .unwrap();
                                        }
                                        emit_base_offset(&mut output);
                                        write!(output, "        self.data[base_offset..base_offset + len].copy_from_slice(&value[0..len]);\n").unwrap();
                                        write!(output, "    }}\n\n").unwrap();

                                        // Also add mutable slice getter
                                        write!(
                                            output,
                                            "    pub fn {}_mut(&mut self) -> &mut [u8] {{\n",
                                            field.name
                                        )
                                        .unwrap();
                                        // Use size expression directly with cast when _len method was skipped
                                        if skip_len_method {
                                            write!(
                                                output,
                                                "        let len = ({}) as usize;\n",
                                                size_expr_str
                                            )
                                            .unwrap();
                                        } else {
                                            write!(
                                                output,
                                                "        let len = self.{}_len();\n",
                                                field.name
                                            )
                                            .unwrap();
                                        }
                                        emit_base_offset(&mut output);
                                        write!(output, "        &mut self.data[base_offset..base_offset + len]\n").unwrap();
                                        write!(output, "    }}\n\n").unwrap();
                                    }
                                } else if let ResolvedTypeKind::TypeRef { target_name, .. } =
                                    &element_type.kind
                                {
                                    // Variable-size array of structs
                                    if let crate::abi::resolved::Size::Const(elem_size) =
                                        element_type.size
                                    {
                                        // Convert expression to Rust code that calls getters
                                        let size_expr_str =
                                            size_expression_to_rust_getter_code(size_expression, "self");

                                        // Generate element setter
                                        write!(output, "    pub fn {}_set(&mut self, index: usize, value: &{}<'_>) {{\n", field.name, target_name).unwrap();
                                        // Use size expression directly with cast when _len method was skipped
                                        if skip_len_method {
                                            write!(
                                                output,
                                                "        let len = ({}) as usize;\n",
                                                size_expr_str
                                            )
                                            .unwrap();
                                        } else {
                                            write!(
                                                output,
                                                "        let len = self.{}_len();\n",
                                                field.name
                                            )
                                            .unwrap();
                                        }
                                        write!(output, "        if index >= len {{\n").unwrap();
                                        write!(output, "            panic!(\"Index {{}} out of bounds for array '{}' of length {{}}\", index, len);\n", field.name).unwrap();
                                        write!(output, "        }}\n").unwrap();
                                        emit_base_offset(&mut output);
                                        write!(
                                            output,
                                            "        let offset = base_offset + index * {};\n",
                                            elem_size
                                        )
                                        .unwrap();
                                        write!(output, "        self.data[offset..offset + {}].copy_from_slice(value.data);\n", elem_size).unwrap();
                                        write!(output, "    }}\n\n").unwrap();
                                    }
                                }
                            }
                        }
                    }
                    ResolvedTypeKind::TypeRef { target_name, .. } => {
                        // Generate nested struct getter returning mutable wrapper
                        if let crate::abi::resolved::Size::Const(nested_size) =
                            field.field_type.size
                        {
                            write!(
                                output,
                                "    pub fn {}(&mut self) -> {}Mut<'_> {{\n",
                                field.name, target_name
                            )
                            .unwrap();

                            // Calculate offset
                            if field_idx == 0 {
                                write!(output, "        let offset = 0;\n").unwrap();
                            } else {
                                write!(output, "        let mut offset = 0;\n").unwrap();
                                for prev_field in &fields[0..field_idx] {
                                    match &prev_field.field_type.kind {
                                        ResolvedTypeKind::Primitive {
                                            prim_type: prev_prim,
                                        } => {
                                            let size = primitive_size(prev_prim);
                                            write!(
                                                output,
                                                "        offset += {}; // {}\n",
                                                size, prev_field.name
                                            )
                                            .unwrap();
                                        }
                                        ResolvedTypeKind::Enum { .. } => {
                                            write!(output, "        offset += ({{ let temp = {} {{ data: &self.data }}; temp.{}_size() }}); // {} (variable size)\n", type_name, prev_field.name, prev_field.name).unwrap();
                                        }
                                        ResolvedTypeKind::Array { .. } => {
                                            if let crate::abi::resolved::Size::Const(size) =
                                                prev_field.field_type.size
                                            {
                                                write!(
                                                    output,
                                                    "        offset += {}; // {} (array)\n",
                                                    size, prev_field.name
                                                )
                                                .unwrap();
                                            }
                                        }
                                        ResolvedTypeKind::TypeRef { .. }
                                        | ResolvedTypeKind::Struct { .. } => {
                                            if let crate::abi::resolved::Size::Const(size) =
                                                prev_field.field_type.size
                                            {
                                                write!(
                                                    output,
                                                    "        offset += {}; // {} (nested struct)\n",
                                                    size, prev_field.name
                                                )
                                                .unwrap();
                                            }
                                        }
                                        _ => {}
                                    }
                                }
                            }

                            write!(output, "        {}Mut::from_slice_mut(&mut self.data[offset..offset + {}]).unwrap()\n", target_name, nested_size).unwrap();
                            write!(output, "    }}\n\n").unwrap();
                        }
                    }
                    ResolvedTypeKind::Struct { .. } => {
                        /* Generate getter for inline nested struct returning mutable wrapper */
                        let nested_type_name = field.field_type.name.replace("::", "_");

                        if let crate::abi::resolved::Size::Const(nested_size) =
                            field.field_type.size
                        {
                            write!(
                                output,
                                "    pub fn {}(&mut self) -> {}Mut<'_> {{\n",
                                field.name, nested_type_name
                            )
                            .unwrap();

                            /* Calculate offset */
                            if field_idx == 0 {
                                write!(output, "        let offset = 0;\n").unwrap();
                            } else {
                                write!(output, "        let mut offset = 0;\n").unwrap();
                                for prev_field in &fields[0..field_idx] {
                                    match &prev_field.field_type.kind {
                                        ResolvedTypeKind::Primitive {
                                            prim_type: prev_prim,
                                        } => {
                                            let size = primitive_size(prev_prim);
                                            write!(
                                                output,
                                                "        offset += {}; /* {} */\n",
                                                size, prev_field.name
                                            )
                                            .unwrap();
                                        }
                                        ResolvedTypeKind::Enum { .. } => {
                                            write!(output, "        offset += ({{ let temp = {} {{ data: &self.data }}; temp.{}_size() }}); /* {} (variable size) */\n", type_name, prev_field.name, prev_field.name).unwrap();
                                        }
                                        ResolvedTypeKind::Array { .. } => {
                                            if let crate::abi::resolved::Size::Const(size) =
                                                prev_field.field_type.size
                                            {
                                                write!(
                                                    output,
                                                    "        offset += {}; /* {} (array) */\n",
                                                    size, prev_field.name
                                                )
                                                .unwrap();
                                            }
                                        }
                                        ResolvedTypeKind::TypeRef { .. }
                                        | ResolvedTypeKind::Struct { .. } => {
                                            if let crate::abi::resolved::Size::Const(size) =
                                                prev_field.field_type.size
                                            {
                                                write!(output, "        offset += {}; /* {} (nested struct) */\n", size, prev_field.name).unwrap();
                                            }
                                        }
                                        _ => {}
                                    }
                                }
                            }

                            write!(output, "        {}Mut::from_slice_mut(&mut self.data[offset..offset + {}]).unwrap()\n", nested_type_name, nested_size).unwrap();
                            write!(output, "    }}\n\n").unwrap();
                        } else {
                            /* Variable-size nested struct */
                            write!(
                                output,
                                "    pub fn {}(&mut self) -> {}Mut<'_> {{\n",
                                field.name, nested_type_name
                            )
                            .unwrap();

                            if field_idx == 0 {
                                write!(output, "        let offset = 0;\n").unwrap();
                            } else {
                                write!(output, "        let mut offset = 0;\n").unwrap();
                                for prev_field in &fields[0..field_idx] {
                                    match &prev_field.field_type.kind {
                                        ResolvedTypeKind::Primitive {
                                            prim_type: prev_prim,
                                        } => {
                                            let size = primitive_size(prev_prim);
                                            write!(
                                                output,
                                                "        offset += {}; /* {} */\n",
                                                size, prev_field.name
                                            )
                                            .unwrap();
                                        }
                                        ResolvedTypeKind::Enum { .. } => {
                                            write!(output, "        offset += ({{ let temp = {} {{ data: &self.data }}; temp.{}_size() }}); /* {} (variable size) */\n", type_name, prev_field.name, prev_field.name).unwrap();
                                        }
                                        ResolvedTypeKind::Array { .. } => {
                                            if let crate::abi::resolved::Size::Const(size) =
                                                prev_field.field_type.size
                                            {
                                                write!(
                                                    output,
                                                    "        offset += {}; /* {} (array) */\n",
                                                    size, prev_field.name
                                                )
                                                .unwrap();
                                            }
                                        }
                                        ResolvedTypeKind::TypeRef { .. }
                                        | ResolvedTypeKind::Struct { .. } => {
                                            if let crate::abi::resolved::Size::Const(size) =
                                                prev_field.field_type.size
                                            {
                                                write!(output, "        offset += {}; /* {} (nested struct) */\n", size, prev_field.name).unwrap();
                                            } else {
                                                write!(output, "        offset += ({{ let temp = {} {{ data: &self.data }}; temp.{}_size() }}); /* {} (variable size nested struct) */\n", type_name, prev_field.name, prev_field.name).unwrap();
                                            }
                                        }
                                        _ => {}
                                    }
                                }
                            }

                            write!(output, "        let size = {{ let temp = {} {{ data: &self.data }}; temp.{}_size() }};\n", type_name, field.name).unwrap();
                            write!(output, "        {}Mut::from_slice_mut(&mut self.data[offset..offset + size]).unwrap()\n", nested_type_name).unwrap();
                            write!(output, "    }}\n\n").unwrap();
                        }
                    }
                    _ => {}
                }
            }

            /* For nested inline struct fields, generate accessor/setter functions on the mutable parent type */
            for (field_idx, field) in fields.iter().enumerate() {
                if let ResolvedTypeKind::Struct {
                    fields: nested_fields,
                    ..
                } = &field.field_type.kind
                {
                    /* Generate accessors/setters for this nested struct's fields as parent methods */
                    for nested_field in nested_fields {
                        match &nested_field.field_type.kind {
                            ResolvedTypeKind::Array {
                                element_type,
                                size_expression,
                                ..
                            } => {
                                /* Generate array accessors/setters on parent type */
                                if let ResolvedTypeKind::Primitive { prim_type } =
                                    &element_type.kind
                                {
                                    if !matches!(
                                        nested_field.field_type.size,
                                        crate::abi::resolved::Size::Const(..)
                                    ) {
                                        let rust_type = match prim_type {
                                            crate::abi::types::PrimitiveType::Integral(
                                                int_type,
                                            ) => match int_type {
                                                IntegralType::U8 => "u8",
                                                IntegralType::U16 => "u16",
                                                IntegralType::U32 => "u32",
                                                IntegralType::U64 => "u64",
                                                IntegralType::I8 => "i8",
                                                IntegralType::I16 => "i16",
                                                IntegralType::I32 => "i32",
                                                IntegralType::I64 => "i64",
                                                IntegralType::Char => "u8",
                                            },
                                            crate::abi::types::PrimitiveType::FloatingPoint(
                                                float_type,
                                            ) => match float_type {
                                                FloatingPointType::F16 => "f16",
                                                FloatingPointType::F32 => "f32",
                                                FloatingPointType::F64 => "f64",
                                            },
                                        };

                                        let elem_size = primitive_size(prim_type);

                                        write!(
                                            output,
                                            "    /* Nested struct {}.{} array setter */\n",
                                            field.name, nested_field.name
                                        )
                                        .unwrap();

                                        /* Element setter */
                                        write!(output, "    pub fn {}_{}_set(&mut self, index: usize, value: {}) {{\n", field.name, nested_field.name, rust_type).unwrap();
                                        write!(output, "        let mut offset = 0;\n").unwrap();
                                        /* Add size of all fields before the nested struct */
                                        for prev_field in &fields[0..field_idx] {
                                            match &prev_field.field_type.kind {
                                                ResolvedTypeKind::Primitive {
                                                    prim_type: prev_prim,
                                                } => {
                                                    let size = primitive_size(prev_prim);
                                                    write!(
                                                        output,
                                                        "        offset += {}; /* {} */\n",
                                                        size, prev_field.name
                                                    )
                                                    .unwrap();
                                                }
                                                ResolvedTypeKind::Struct {
                                                    fields: prev_nested_fields,
                                                    ..
                                                } => {
                                                    /* Add size of all fields in the previous nested struct */
                                                    for prev_nested_field in prev_nested_fields {
                                                        if let ResolvedTypeKind::Primitive {
                                                            prim_type: prev_nested_prim,
                                                        } = &prev_nested_field.field_type.kind
                                                        {
                                                            let size =
                                                                primitive_size(prev_nested_prim);
                                                            write!(output, "        offset += {}; /* {}.{} */\n", size, prev_field.name, prev_nested_field.name).unwrap();
                                                        }
                                                    }
                                                }
                                                _ => {}
                                            }
                                        }
                                        write!(
                                            output,
                                            "        offset += index * {}; /* {}[index] */\n",
                                            elem_size, nested_field.name
                                        )
                                        .unwrap();
                                        let write_expr =
                                            emit_write_primitive(prim_type, "offset", "value");
                                        write!(output, "        {}\n", write_expr).unwrap();
                                        write!(output, "    }}\n\n").unwrap();
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                }
            }

            // Generate setters for nested inline struct primitive fields
            for (field_idx, field) in fields.iter().enumerate() {
                if let ResolvedTypeKind::Struct {
                    fields: nested_fields,
                    ..
                } = &field.field_type.kind
                {
                    /* Generate setters for this nested struct's primitive fields */
                    for nested_field in nested_fields {
                        if let ResolvedTypeKind::Primitive { prim_type } =
                            &nested_field.field_type.kind
                        {
                            let rust_type = match prim_type {
                                crate::abi::types::PrimitiveType::Integral(int_type) => {
                                    match int_type {
                                        IntegralType::U8 => "u8",
                                        IntegralType::U16 => "u16",
                                        IntegralType::U32 => "u32",
                                        IntegralType::U64 => "u64",
                                        IntegralType::I8 => "i8",
                                        IntegralType::I16 => "i16",
                                        IntegralType::I32 => "i32",
                                        IntegralType::I64 => "i64",
                                        IntegralType::Char => "u8",
                                    }
                                }
                                crate::abi::types::PrimitiveType::FloatingPoint(float_type) => {
                                    match float_type {
                                        FloatingPointType::F16 => "f16",
                                        FloatingPointType::F32 => "f32",
                                        FloatingPointType::F64 => "f64",
                                    }
                                }
                            };

                            /* Check if this nested field is referenced */
                            let field_path = format!("{}_{}", field.name, nested_field.name);
                            let referenced_fields = extract_referenced_fields(fields);

                            if !referenced_fields.contains(&field_path) {
                                write!(
                                    output,
                                    "    /* Nested struct {}.{} primitive setter */\n",
                                    field.name, nested_field.name
                                )
                                .unwrap();
                                write!(
                                    output,
                                    "    pub fn set_{}_{}(&mut self, value: {}) {{\n",
                                    field.name, nested_field.name, rust_type
                                )
                                .unwrap();

                                /* Calculate offset to this primitive field */
                                write!(output, "        let mut offset = 0;\n").unwrap();
                                /* Add size of all fields before the nested struct */
                                for prev_field in &fields[0..field_idx] {
                                    match &prev_field.field_type.kind {
                                        ResolvedTypeKind::Primitive {
                                            prim_type: prev_prim,
                                        } => {
                                            let size = primitive_size(prev_prim);
                                            write!(
                                                output,
                                                "        offset += {}; /* {} */\n",
                                                size, prev_field.name
                                            )
                                            .unwrap();
                                        }
                                        ResolvedTypeKind::Struct {
                                            fields: prev_nested_fields,
                                            ..
                                        } => {
                                            /* Add size of all fields in the previous nested struct */
                                            for prev_nested_field in prev_nested_fields {
                                                if let ResolvedTypeKind::Primitive {
                                                    prim_type: prev_nested_prim,
                                                } = &prev_nested_field.field_type.kind
                                                {
                                                    let size = primitive_size(prev_nested_prim);
                                                    write!(
                                                        output,
                                                        "        offset += {}; /* {}.{} */\n",
                                                        size,
                                                        prev_field.name,
                                                        prev_nested_field.name
                                                    )
                                                    .unwrap();
                                                }
                                            }
                                        }
                                        _ => {}
                                    }
                                }
                                /* Now add offsets within the current nested struct to reach this field */
                                if let ResolvedTypeKind::Struct {
                                    fields: current_nested_fields,
                                    ..
                                } = &field.field_type.kind
                                {
                                    for current_nested_field in current_nested_fields {
                                        if current_nested_field.name == nested_field.name {
                                            break; /* Found our field */
                                        }
                                        if let ResolvedTypeKind::Primitive {
                                            prim_type: current_nested_prim,
                                        } = &current_nested_field.field_type.kind
                                        {
                                            let size = primitive_size(current_nested_prim);
                                            write!(
                                                output,
                                                "        offset += {}; /* {}.{} */\n",
                                                size, field.name, current_nested_field.name
                                            )
                                            .unwrap();
                                        }
                                    }
                                }
                                let write_expr = emit_write_primitive(prim_type, "offset", "value");
                                write!(output, "        {}\n", write_expr).unwrap();
                                write!(output, "    }}\n\n").unwrap();
                            }
                        }
                    }
                }
            }

            write!(output, "}}\n\n").unwrap();

            /* Recursively emit impl blocks for nested inline structs */
            for field in fields {
                if let ResolvedTypeKind::Struct { .. } = &field.field_type.kind {
                    /* This is an inline nested struct - emit its impl blocks too */
                    output.push_str(&emit_opaque_functions(&field.field_type, None, None));
                }
            }
        }
        _ => {}
    }

    output
}

struct IrValidateCallData {
    params: Vec<IrParamBinding>,
    args: Vec<String>,
}

struct IrParamBinding {
    var: String,
    source: IrParamSource,
}

enum IrParamSource {
    Getter { path: String },
    Payload { field_name: String, offset: usize },
}

fn prepare_ir_validate_call(
    resolved_type: &ResolvedType,
    type_ir: &TypeIr,
) -> Result<IrValidateCallData, Vec<String>> {
    let bindings = collect_dynamic_param_bindings(resolved_type);
    let available: Vec<String> = bindings.keys().cloned().collect();
    let mut params = Vec::new();
    let mut args = Vec::new();
    let mut missing = Vec::new();

    for param in &type_ir.parameters {
        let sanitized = sanitize_param_name(&param.name.replace('.', "_"));
        if let Some(binding_name) = resolve_param_binding(&sanitized, &available) {
            if let Some(binding) = bindings.get(binding_name) {
                let accessor_path =
                    if let Some(path) = normalize_accessor_path(resolved_type, &binding.path) {
                        path
                    } else {
                        missing.push(param.name.clone());
                        continue;
                    };
                if !params
                    .iter()
                    .any(|entry: &IrParamBinding| entry.var == *binding_name)
                {
                    params.push(IrParamBinding {
                        var: binding_name.clone(),
                        source: IrParamSource::Getter {
                            path: accessor_path,
                        },
                    });
                }
                args.push(binding_name.clone());
            }
        } else if let Some(field_name) = extract_payload_field_name(&param.name) {
            if let Some(offset) = payload_field_offset(resolved_type, &field_name) {
                let sanitized_field = sanitize_param_name(&field_name);
                let var = format!("{}_payload_size", sanitized_field);
                if !params.iter().any(|entry: &IrParamBinding| entry.var == var) {
                    params.push(IrParamBinding {
                        var: var.clone(),
                        source: IrParamSource::Payload {
                            field_name: field_name.replace("::", "_"),
                            offset,
                        },
                    });
                }
                args.push(var);
            } else {
                missing.push(param.name.clone());
            }
        } else {
            missing.push(param.name.clone());
        }
    }

    if missing.is_empty() {
        Ok(IrValidateCallData { params, args })
    } else {
        Err(missing)
    }
}

fn emit_ir_param_setup(output: &mut String, type_name: &str, data: &IrValidateCallData) {
    if data.params.is_empty() {
        return;
    }

    let needs_view = data
        .params
        .iter()
        .any(|binding| matches!(binding.source, IrParamSource::Getter { .. }));
    if needs_view {
        writeln!(output, "        #[allow(unused_variables)]").unwrap();
        writeln!(output, "        let view = {} {{ data }};", type_name).unwrap();
    }

    for binding in &data.params {
        match &binding.source {
            IrParamSource::Getter { path, .. } => {
                writeln!(output, "        #[allow(unused_variables)]").unwrap();
                writeln!(
                    output,
                    "        let {} = {} as u64;",
                    binding.var,
                    format_accessor_chain(path, "view")
                )
                .unwrap();
            }
            IrParamSource::Payload { field_name, offset } => {
                writeln!(output, "        if data.len() < {} {{", offset).unwrap();
                writeln!(
                    output,
                    "            return Err(\"buffer too small for field '{}'\");",
                    field_name
                )
                .unwrap();
                writeln!(output, "        }}").unwrap();
                writeln!(output, "        #[allow(unused_variables)]").unwrap();
                writeln!(
                    output,
                    "        let {} = (data.len() - {}) as u64;",
                    binding.var, offset
                )
                .unwrap();
            }
        }
    }
}

fn emit_ir_primary_path(output: &mut String, call: &str) {
    writeln!(output, "        let ir_bytes = match {} {{", call).unwrap();
    writeln!(output, "            Ok(bytes) => bytes,").unwrap();
    writeln!(
        output,
        "            Err(err) => return Err(abi_ir_error_str(err)),"
    )
    .unwrap();
    writeln!(output, "        }};").unwrap();
    writeln!(output, "        return Ok(ir_bytes as usize);\n").unwrap();
}

fn format_ir_validate_call(type_ir: &TypeIr, args: &[String]) -> String {
    let fn_name = format!("{}_validate_ir", sanitize_param_name(&type_ir.type_name));
    if args.is_empty() {
        format!("{}(data.len() as u64)", fn_name)
    } else {
        let formatted_args: Vec<String> =
            args.iter().map(|arg| format!("({}) as u64", arg)).collect();
        format!(
            "{}(data.len() as u64, {})",
            fn_name,
            formatted_args.join(", ")
        )
    }
}

fn format_accessor_chain(path: &str, base: &str) -> String {
    let mut expr = base.to_string();
    for segment in path.split('.') {
        let ident = escape_rust_keyword(&segment.replace('-', "_"));
        expr = format!("{}.{}()", expr, ident);
    }
    expr
}

/// Emit jagged array accessor methods for a field.
/// Jagged arrays have variable-size elements that must be traversed sequentially.
/// Generates:
/// - `{field}_len()` - returns the count of elements
/// - `{field}_get(idx)` - returns ElementType for indexed access (O(n)), panics if out of bounds
/// - `{field}_iter()` - returns an iterator for efficient sequential access
/// - `{field}_size()` - returns the total byte size of all elements
fn emit_jagged_array_accessors(
    output: &mut String,
    field_name: &str,
    element_type_name: &str,
    count_expr: &str,
    offset_setup: &str,
) {
    let elem_type_name = element_type_name.replace("::", "_");

    // Generate _len() method
    writeln!(output, "    /// Returns the number of elements in the jagged array.").unwrap();
    writeln!(output, "    pub fn {}_len(&self) -> usize {{", field_name).unwrap();
    writeln!(output, "        {} as usize", count_expr).unwrap();
    writeln!(output, "    }}\n").unwrap();

    // Generate _get(idx) method - O(n) indexed access
    writeln!(output, "    /// Returns the element at the given index.").unwrap();
    writeln!(output, "    /// Note: This is O(n) as jagged arrays require sequential traversal.").unwrap();
    writeln!(output, "    /// Panics if index is out of bounds.").unwrap();
    writeln!(
        output,
        "    pub fn {}_get(&self, idx: usize) -> {}<'_> {{",
        field_name, elem_type_name
    )
    .unwrap();
    writeln!(output, "        let count = {} as usize;", count_expr).unwrap();
    writeln!(output, "        if idx >= count {{").unwrap();
    writeln!(output, "            panic!(\"Index {{}} out of bounds for jagged array '{}' of length {{}}\", idx, count);", field_name).unwrap();
    writeln!(output, "        }}").unwrap();
    writeln!(output, "{}", offset_setup).unwrap();
    writeln!(output, "        for _ in 0..idx {{").unwrap();
    writeln!(
        output,
        "            let elem = {} {{ data: &self.data[offset..] }};",
        elem_type_name
    )
    .unwrap();
    writeln!(output, "            offset += elem.size();").unwrap();
    writeln!(output, "        }}").unwrap();
    writeln!(
        output,
        "        {} {{ data: &self.data[offset..] }}",
        elem_type_name
    )
    .unwrap();
    writeln!(output, "    }}\n").unwrap();

    // Generate _iter() method - efficient sequential access
    writeln!(output, "    /// Returns an iterator over the jagged array elements.").unwrap();
    writeln!(output, "    /// This is more efficient than repeated calls to `{}_get()` for sequential access.", field_name).unwrap();
    writeln!(
        output,
        "    pub fn {}_iter(&self) -> impl Iterator<Item = {}<'_>> {{",
        field_name, elem_type_name
    )
    .unwrap();
    writeln!(output, "        let count = {} as usize;", count_expr).unwrap();
    writeln!(output, "{}", offset_setup).unwrap();
    writeln!(output, "        let data = self.data;").unwrap();
    writeln!(output, "        (0..count).scan(offset, move |off, _| {{").unwrap();
    writeln!(
        output,
        "            let elem = {} {{ data: &data[*off..] }};",
        elem_type_name
    )
    .unwrap();
    writeln!(output, "            *off += elem.size();").unwrap();
    writeln!(output, "            Some(elem)").unwrap();
    writeln!(output, "        }})").unwrap();
    writeln!(output, "    }}\n").unwrap();

    // Generate _size() method - total byte size
    writeln!(output, "    /// Returns the total byte size of all elements in the jagged array.").unwrap();
    writeln!(output, "    pub fn {}_size(&self) -> usize {{", field_name).unwrap();
    writeln!(output, "        let count = {} as usize;", count_expr).unwrap();
    writeln!(output, "{}", offset_setup).unwrap();
    writeln!(output, "        let mut total_size = 0usize;").unwrap();
    writeln!(output, "        for _ in 0..count {{").unwrap();
    writeln!(
        output,
        "            let elem = {} {{ data: &self.data[offset..] }};",
        elem_type_name
    )
    .unwrap();
    writeln!(output, "            let elem_size = elem.size();").unwrap();
    writeln!(output, "            total_size += elem_size;").unwrap();
    writeln!(output, "            offset += elem_size;").unwrap();
    writeln!(output, "        }}").unwrap();
    writeln!(output, "        total_size").unwrap();
    writeln!(output, "    }}\n").unwrap();
}

/// Emit jagged array mutable accessor methods for the Mut impl.
/// Generates:
/// - `{field}_len()` - returns the count of elements (same as immutable)
/// - `{field}_set(idx, value)` - copies element data at the given index
fn emit_jagged_array_mut_accessors(
    output: &mut String,
    _type_name: &str,
    field_name: &str,
    element_type_name: &str,
    count_expr: &str,
    offset_setup: &str,
) {
    let elem_type_name = element_type_name.replace("::", "_");

    // Generate _len() method for Mut (delegates to immutable)
    writeln!(output, "    pub fn {}_len(&self) -> usize {{", field_name).unwrap();
    writeln!(output, "        ({}) as usize", count_expr).unwrap();
    writeln!(output, "    }}\n").unwrap();

    // Generate _set(idx, value) method - copies element data
    // Note: This method assumes elements are set in order (0, 1, 2, ...) because
    // it uses the VALUE's size to calculate offsets, not the target buffer's sizes.
    // This is necessary because the target buffer may not have valid element data yet.
    writeln!(output, "    /// Sets the element at the given index by copying from the provided value.").unwrap();
    writeln!(output, "    /// IMPORTANT: Elements must be set in order (0, 1, 2, ...) because offset").unwrap();
    writeln!(output, "    /// calculation uses the provided value's size.").unwrap();
    writeln!(output, "    /// Panics if index is out of bounds.").unwrap();
    writeln!(
        output,
        "    pub fn {}_set(&mut self, idx: usize, value: &{}<'_>) {{",
        field_name, elem_type_name
    )
    .unwrap();
    writeln!(output, "        let count = ({}) as usize;", count_expr).unwrap();
    writeln!(output, "        if idx >= count {{").unwrap();
    writeln!(output, "            panic!(\"Index {{}} out of bounds for jagged array '{}' of length {{}}\", idx, count);", field_name).unwrap();
    writeln!(output, "        }}").unwrap();

    // Calculate offset by iterating through previously set elements
    // This works because elements must be set in order (0, 1, 2, ...)
    // and we read the actual sizes of elements already written to the buffer
    writeln!(output, "        // Calculate base offset from header fields").unwrap();
    for line in offset_setup.lines() {
        if !line.trim().is_empty() {
            writeln!(output, "    {}", line.trim()).unwrap();
        }
    }
    writeln!(output, "        // Calculate offset by walking through previously set elements").unwrap();
    writeln!(output, "        // Elements MUST be set in sequential order (0, 1, 2, ...)").unwrap();
    writeln!(output, "        let mut off = offset;").unwrap();
    writeln!(output, "        for _ in 0..idx {{").unwrap();
    writeln!(output, "            // Read element size from what was already written").unwrap();
    writeln!(output, "            let elem = {} {{ data: &self.data[off..] }};", elem_type_name).unwrap();
    writeln!(output, "            off += elem.size();").unwrap();
    writeln!(output, "        }}").unwrap();
    writeln!(output, "        let value_size = value.size();").unwrap();
    writeln!(output, "        self.data[off..off + value_size].copy_from_slice(&value.data[..value_size]);").unwrap();
    writeln!(output, "    }}\n").unwrap();
}
