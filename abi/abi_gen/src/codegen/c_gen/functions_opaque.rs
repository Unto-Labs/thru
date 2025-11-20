/* Opaque wrapper implementation for C codegen */

use crate::abi::resolved::{ResolvedType, ResolvedTypeKind, ResolvedField};
use crate::abi::types::{IntegralType, FloatingPointType, PrimitiveType};
use crate::abi::expr::ExprKind;
use std::fmt::Write;
use std::collections::HashSet;
use super::helpers::{format_expr_to_c, escape_c_keyword, is_nested_complex_type, format_type_to_c};

/* Convert size expression to C code that calls getter functions */
fn size_expression_to_c_getter_code(expr: &ExprKind, type_name: &str, self_name: &str) -> String {
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
            format!("{}_get_{}( {} )", type_name, field_ref.path.join("_"), self_name)
        }
        ExprKind::Add(e) => {
            format!("({} + {})",
                    size_expression_to_c_getter_code(&e.left, type_name, self_name),
                    size_expression_to_c_getter_code(&e.right, type_name, self_name))
        }
        ExprKind::Mul(e) => {
            format!("({} * {})",
                    size_expression_to_c_getter_code(&e.left, type_name, self_name),
                    size_expression_to_c_getter_code(&e.right, type_name, self_name))
        }
        ExprKind::Sub(e) => {
            format!("({} - {})",
                    size_expression_to_c_getter_code(&e.left, type_name, self_name),
                    size_expression_to_c_getter_code(&e.right, type_name, self_name))
        }
        ExprKind::Div(e) => {
            format!("({} / {})",
                    size_expression_to_c_getter_code(&e.left, type_name, self_name),
                    size_expression_to_c_getter_code(&e.right, type_name, self_name))
        }
        ExprKind::BitAnd(e) => {
            format!("({} & {})",
                    size_expression_to_c_getter_code(&e.left, type_name, self_name),
                    size_expression_to_c_getter_code(&e.right, type_name, self_name))
        }
        ExprKind::BitOr(e) => {
            format!("({} | {})",
                    size_expression_to_c_getter_code(&e.left, type_name, self_name),
                    size_expression_to_c_getter_code(&e.right, type_name, self_name))
        }
        ExprKind::BitXor(e) => {
            format!("({} ^ {})",
                    size_expression_to_c_getter_code(&e.left, type_name, self_name),
                    size_expression_to_c_getter_code(&e.right, type_name, self_name))
        }
        _ => expr.to_c_string(), /* Fallback for unhandled cases */
    }
}

/* Convert expression to C code that reads from data array using field_offsets map */
fn expression_to_c_data_read(expr: &ExprKind, field_offsets: &std::collections::HashMap<String, String>) -> String {
    use crate::abi::expr::LiteralExpr;

    match expr {
        ExprKind::Literal(lit) => {
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
            format!("({} + {})",
                    expression_to_c_data_read(&e.left, field_offsets),
                    expression_to_c_data_read(&e.right, field_offsets))
        }
        ExprKind::Mul(e) => {
            format!("({} * {})",
                    expression_to_c_data_read(&e.left, field_offsets),
                    expression_to_c_data_read(&e.right, field_offsets))
        }
        ExprKind::Sub(e) => {
            format!("({} - {})",
                    expression_to_c_data_read(&e.left, field_offsets),
                    expression_to_c_data_read(&e.right, field_offsets))
        }
        ExprKind::Div(e) => {
            format!("({} / {})",
                    expression_to_c_data_read(&e.left, field_offsets),
                    expression_to_c_data_read(&e.right, field_offsets))
        }
        ExprKind::BitAnd(e) => {
            format!("({} & {})",
                    expression_to_c_data_read(&e.left, field_offsets),
                    expression_to_c_data_read(&e.right, field_offsets))
        }
        ExprKind::BitOr(e) => {
            format!("({} | {})",
                    expression_to_c_data_read(&e.left, field_offsets),
                    expression_to_c_data_read(&e.right, field_offsets))
        }
        ExprKind::BitXor(e) => {
            format!("({} ^ {})",
                    expression_to_c_data_read(&e.left, field_offsets),
                    expression_to_c_data_read(&e.right, field_offsets))
        }
        _ => "0".to_string(), /* Fallback */
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
            ResolvedTypeKind::Array { size_expression, .. } => {
                // Extract field refs from FAM size expression
                if !matches!(field.field_type.size, crate::abi::resolved::Size::Const(..)) {
                    extract_field_refs_from_expr(size_expression, &mut referenced);
                }
            }
            ResolvedTypeKind::Struct { fields: nested_fields, .. } => {
                /* Recurse into nested struct fields */
                for nested_field in nested_fields {
                    match &nested_field.field_type.kind {
                        ResolvedTypeKind::Array { size_expression, .. } => {
                            if !matches!(nested_field.field_type.size, crate::abi::resolved::Size::Const(..)) {
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
        // For binary operations, recursively check both sides
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
        // For unary operations
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

/* Helper to get size of primitive type */
fn primitive_size(prim_type: &PrimitiveType) -> usize {
    match prim_type {
        PrimitiveType::Integral(int_type) => match int_type {
            IntegralType::U8 | IntegralType::I8 => 1,
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

/* Helper to get C type name for primitive */
fn primitive_to_c_type(prim_type: &PrimitiveType) -> &'static str {
    match prim_type {
        PrimitiveType::Integral(int_type) => match int_type {
            IntegralType::U8 => "uint8_t",
            IntegralType::U16 => "uint16_t",
            IntegralType::U32 => "uint32_t",
            IntegralType::U64 => "uint64_t",
            IntegralType::I8 => "int8_t",
            IntegralType::I16 => "int16_t",
            IntegralType::I32 => "int32_t",
            IntegralType::I64 => "int64_t",
        },
        PrimitiveType::FloatingPoint(float_type) => match float_type {
            FloatingPointType::F16 => "_Float16",
            FloatingPointType::F32 => "float",
            FloatingPointType::F64 => "double",
        },
    }
}

/* Helper to emit byte reading code for primitives */
/* Helper to emit byte reading code for primitives - direct data pointer version */
fn emit_read_primitive_direct(prim_type: &PrimitiveType, offset_expr: &str, data_ptr: &str, output: &mut String) {
    let c_type = primitive_to_c_type(prim_type);

    match prim_type {
        PrimitiveType::Integral(IntegralType::U8) => {
            write!(output, "{}[{}]", data_ptr, offset_expr).unwrap();
        }
        PrimitiveType::Integral(IntegralType::I8) => {
            write!(output, "(int8_t){}[{}]", data_ptr, offset_expr).unwrap();
        }
        _ => {
            /* Multi-byte values need memcpy for alignment safety - use GNU C statement expression */
            write!(output, "({{ {} val; memcpy( &val, &{}[{}], sizeof( val ) ); val; }})", c_type, data_ptr, offset_expr).unwrap();
        }
    }
}

/* Helper to emit byte reading code for primitives - legacy version (deprecated) */
fn emit_read_primitive(prim_type: &PrimitiveType, offset_expr: &str, output: &mut String) {
    emit_read_primitive_direct(prim_type, offset_expr, "self->data", output);
}

/* Helper to emit byte writing code for primitives */
fn emit_write_primitive(prim_type: &PrimitiveType, offset_expr: &str, value_expr: &str, data_ptr: &str, output: &mut String) {
    match prim_type {
        PrimitiveType::Integral(IntegralType::U8) | PrimitiveType::Integral(IntegralType::I8) => {
            write!(output, "    {}[{}] = {};\n", data_ptr, offset_expr, value_expr).unwrap();
        }
        _ => {
            /* Multi-byte values need memcpy for alignment safety */
            write!(output, "    memcpy( &{}[{}], &{}, sizeof( {} ) );\n",
                   data_ptr, offset_expr, value_expr, value_expr).unwrap();
        }
    }
}

/* Helper to identify fields that affect struct size (array sizes, enum tags) */
fn identify_size_affecting_fields(fields: &[crate::abi::resolved::ResolvedField]) -> std::collections::HashSet<String> {
    use crate::abi::expr::ExprKind;
    let mut size_affecting = std::collections::HashSet::new();

    for field in fields {
        match &field.field_type.kind {
            /* Check if this is an enum with a tag reference */
            ResolvedTypeKind::Enum { tag_expression, .. } => {
                if let ExprKind::FieldRef(field_ref) = tag_expression {
                    /* The tag field affects size - mark it */
                    if let Some(tag_name) = field_ref.path.last() {
                        size_affecting.insert(tag_name.clone());
                    }
                }
            }
            /* TODO: Check if this is an array with a length reference */
            ResolvedTypeKind::Array { .. } => {
                /* For now, skip - arrays with dynamic sizes not fully implemented */
            }
            _ => {}
        }
    }

    size_affecting
}

/* Generate functions for opaque wrapper structs */
pub fn emit_opaque_functions(resolved_type: &ResolvedType) -> String {
    let mut output = String::new();

    match &resolved_type.kind {
        ResolvedTypeKind::Struct { fields, .. } => {
            /* Convert type name from "Parent::nested" to "Parent_nested" for C syntax */
            let type_name = resolved_type.name.replace("::", "_");

            /* from_slice() function - returns const pointer to opaque type */
            write!(output, "{}_t const * {}_from_slice( uint8_t const * data, uint64_t data_len ) {{\n", type_name, type_name).unwrap();
            write!(output, "    uint64_t required_size;\n").unwrap();
            write!(output, "    if( {}_validate( data, data_len, &required_size ) != 0 ) {{\n", type_name).unwrap();
            write!(output, "        return NULL;\n").unwrap();
            write!(output, "    }}\n").unwrap();
            write!(output, "    return ({}_t const *)data;\n", type_name).unwrap();
            write!(output, "}}\n\n").unwrap();

            /* from_slice_mut() function - returns mutable pointer to opaque type */
            write!(output, "{}_t * {}_from_slice_mut( uint8_t * data, uint64_t data_len ) {{\n", type_name, type_name).unwrap();
            write!(output, "    uint64_t required_size;\n").unwrap();
            write!(output, "    if( {}_validate( data, data_len, &required_size ) != 0 ) {{\n", type_name).unwrap();
            write!(output, "        return NULL;\n").unwrap();
            write!(output, "    }}\n").unwrap();
            write!(output, "    return ({}_t *)data;\n", type_name).unwrap();
            write!(output, "}}\n\n").unwrap();

            /* Check if this is a nested inline struct (name contains "::") */
            let is_nested = resolved_type.name.contains("::");

            /* Only generate new() function for top-level types, not nested inline structs */
            if !is_nested {
            /* new() function - initializes provided buffer (no allocation) */
            write!(output, "int {}_new( uint8_t * buffer, uint64_t buffer_size", type_name).unwrap();

            /* Collect parameters: only fields referenced in struct expressions (like enum tags and FAM sizes) */
            let referenced_fields = extract_referenced_fields(fields);

            /* Generate parameters in field order by iterating through fields and checking if referenced */
            /* First collect top-level referenced primitives */
            for field in fields {
                if let ResolvedTypeKind::Primitive { prim_type } = &field.field_type.kind {
                    if referenced_fields.contains(&field.name) {
                        write!(output, ", ").unwrap();
                        let c_type = primitive_to_c_type(prim_type);
                        write!(output, "{} {}", c_type, field.name).unwrap();
                    }
                }
            }

            /* Then collect nested referenced primitives in field order */
            for field in fields {
                if let ResolvedTypeKind::Struct { fields: nested_fields, .. } = &field.field_type.kind {
                    for nested_field in nested_fields {
                        if let ResolvedTypeKind::Primitive { prim_type } = &nested_field.field_type.kind {
                            let nested_path = format!("{}_{}", field.name, nested_field.name);
                            if referenced_fields.contains(&nested_path) {
                                write!(output, ", ").unwrap();
                                let c_type = primitive_to_c_type(prim_type);
                                write!(output, "{} {}", c_type, nested_path).unwrap();
                            }
                        }
                    }
                }
            }

            /* Add tag parameters for size-discriminated union fields */
            for field in fields {
                if matches!(&field.field_type.kind, ResolvedTypeKind::SizeDiscriminatedUnion { .. }) {
                    write!(output, ", uint8_t {}_tag", field.name).unwrap();
                }
            }

            write!(output, ", uint64_t * out_size ) {{\n").unwrap();

            /* Calculate required size */
            write!(output, "    uint64_t required_size = 0;\n").unwrap();
            for field in fields.iter() {
                match &field.field_type.kind {
                    ResolvedTypeKind::Primitive { prim_type } => {
                        let field_size = primitive_size(prim_type);
                        write!(output, "    required_size += {}; /* {} */\n", field_size, field.name).unwrap();
                    }
                    ResolvedTypeKind::Enum { variants, tag_expression, .. } => {
                        /* For enums, calculate size based on tag value */
                        write!(output, "    /* Calculate enum '{}' size based on tag */\n", field.name).unwrap();

                        /* Extract field references from tag expression */
                        let mut tag_field_refs = HashSet::new();
                        extract_field_refs_from_expr(tag_expression, &mut tag_field_refs);
                        let tag_params: Vec<String> = tag_field_refs.into_iter().collect();

                        /* Generate tag expression code */
                        let tag_expr = format_expr_to_c(tag_expression, &tag_params);

                        write!(output, "    uint64_t {}_size;\n", field.name).unwrap();
                        write!(output, "    switch( (uint8_t)({}) ) {{\n", tag_expr).unwrap();
                        for variant in variants {
                            if let crate::abi::resolved::Size::Const(size) = variant.variant_type.size {
                                write!(output, "        case {}: {}_size = {}; break;\n",
                                       variant.tag_value, field.name, size).unwrap();
                            }
                        }
                        write!(output, "        default: return -1; /* Invalid enum tag */\n").unwrap();
                        write!(output, "    }}\n").unwrap();
                        write!(output, "    required_size += {}_size;\n\n", field.name).unwrap();
                    }
                    ResolvedTypeKind::SizeDiscriminatedUnion { variants } => {
                        /* Size-discriminated union: size is determined from tag parameter */
                        let tag_param = format!("{}_tag", field.name);
                        write!(output, "    /* Size-discriminated union '{}' size based on tag */\n", field.name).unwrap();
                        write!(output, "    uint64_t {}_size;\n", field.name).unwrap();
                        write!(output, "    switch( {} ) {{\n", tag_param).unwrap();
                        for (idx, variant) in variants.iter().enumerate() {
                            write!(output, "        case {}: {}_size = {}; break;\n", idx, field.name, variant.expected_size).unwrap();
                        }
                        write!(output, "        default: return -1; /* Invalid tag for size-discriminated union '{}' */\n", field.name).unwrap();
                        write!(output, "    }}\n").unwrap();
                        write!(output, "    required_size += {}_size; /* {} (size-discriminated union) */\n\n", field.name, field.name).unwrap();
                    }
                    ResolvedTypeKind::Array { element_type, size_expression, .. } => {
                        if let crate::abi::resolved::Size::Const(array_size) = field.field_type.size {
                            write!(output, "    required_size += {}; /* {} (array) */\n", array_size, field.name).unwrap();
                        } else {
                            /* Variable-size array - calculate from size expression and element size */
                            if let crate::abi::resolved::Size::Const(elem_size) = element_type.size {
                                /* For new(), the size expression uses parameter names directly */
                                let size_calc = size_expression.to_c_string();
                                write!(output, "    required_size += ({}) * {}; /* {} (variable array) */\n",
                                       size_calc, elem_size, field.name).unwrap();
                            }
                        }
                    }
                    ResolvedTypeKind::TypeRef { .. } => {
                        if let crate::abi::resolved::Size::Const(nested_size) = field.field_type.size {
                            write!(output, "    required_size += {}; /* {} (nested struct) */\n",
                                   nested_size, field.name).unwrap();
                        }
                    }
                    ResolvedTypeKind::Struct { fields: nested_fields, .. } => {
                        /* Inline nested struct - calculate size */
                        if let crate::abi::resolved::Size::Const(size) = field.field_type.size {
                            write!(output, "    required_size += {}; /* {} (inline nested struct) */\n", size, field.name).unwrap();
                        } else {
                            /* Variable-size inline nested struct */
                            write!(output, "    /* Calculate variable-size inline nested struct '{}' */\n", field.name).unwrap();
                            for nested_field in nested_fields {
                                match &nested_field.field_type.kind {
                                    ResolvedTypeKind::Primitive { prim_type } => {
                                        let nested_size = primitive_size(prim_type);
                                        write!(output, "    required_size += {}; /* {}.{} */\n", nested_size, field.name, nested_field.name).unwrap();
                                    }
                                    ResolvedTypeKind::Array { element_type, size_expression, .. } => {
                                        if let crate::abi::resolved::Size::Const(array_size) = nested_field.field_type.size {
                                            write!(output, "    required_size += {}; /* {}.{} (array) */\n", array_size, field.name, nested_field.name).unwrap();
                                        } else {
                                            /* Variable-size array - use parameter names from size expression */
                                            if let crate::abi::resolved::Size::Const(elem_size) = element_type.size {
                                                /* Extract field refs and convert to parameter names */
                                                let mut field_refs = HashSet::new();
                                                extract_field_refs_from_expr(size_expression, &mut field_refs);
                                                let params: Vec<String> = field_refs.into_iter().collect();
                                                let size_calc = format_expr_to_c(size_expression, &params);
                                                write!(output, "    required_size += ({}) * {}; /* {}.{} (variable array) */\n",
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

            /* Validate buffer size */
            write!(output, "\n    if( buffer_size < required_size ) {{\n").unwrap();
            write!(output, "        return -1; /* Buffer too small */\n").unwrap();
            write!(output, "    }}\n\n").unwrap();

            /* Zero-initialize buffer */
            write!(output, "    memset( buffer, 0, required_size );\n\n").unwrap();
            write!(output, "    uint64_t offset = 0;\n\n").unwrap();

            /* Write each field */
            for field in fields.iter() {
                match &field.field_type.kind {
                    ResolvedTypeKind::Primitive { prim_type } => {
                        let size = primitive_size(prim_type);

                        // If this field is referenced (passed as parameter), write its value
                        if referenced_fields.contains(&field.name) {
                            match prim_type {
                                PrimitiveType::Integral(IntegralType::U8) |
                                PrimitiveType::Integral(IntegralType::I8) => {
                                    write!(output, "    buffer[offset] = {};\n", field.name).unwrap();
                                }
                                _ => {
                                    write!(output, "    memcpy( &buffer[offset], &{}, sizeof( {} ) );\n",
                                           field.name, field.name).unwrap();
                                }
                            }
                        }
                        write!(output, "    offset += {};\n\n", size).unwrap();
                    }
                    ResolvedTypeKind::Enum { .. } => {
                        // Enums have variable size - skip the dynamic size we calculated earlier
                        write!(output, "    offset += {}_size; /* skip enum '{}' (set via setters) */\n\n",
                               field.name, field.name).unwrap();
                    }
                    ResolvedTypeKind::SizeDiscriminatedUnion { .. } => {
                        // Size-discriminated unions have variable size - skip the size passed as parameter
                        write!(output, "    offset += {}_size; /* skip size-discriminated union '{}' (set via setters) */\n\n",
                               field.name, field.name).unwrap();
                    }
                    ResolvedTypeKind::Array { element_type, size_expression, .. } => {
                        if let crate::abi::resolved::Size::Const(size) = field.field_type.size {
                            write!(output, "    offset += {}; /* skip array '{}' (set via setters) */\n\n",
                                   size, field.name).unwrap();
                        } else {
                            // Variable-size array - calculate offset skip from size expression
                            if let crate::abi::resolved::Size::Const(elem_size) = element_type.size {
                                let size_calc = size_expression.to_c_string();
                                write!(output, "    offset += ({}) * {}; /* skip variable array '{}' (set via setters) */\n\n",
                                       size_calc, elem_size, field.name).unwrap();
                            }
                        }
                    }
                    ResolvedTypeKind::TypeRef { .. } => {
                        if let crate::abi::resolved::Size::Const(size) = field.field_type.size {
                            write!(output, "    offset += {}; /* skip nested '{}' (set via setters) */\n\n",
                                   size, field.name).unwrap();
                        }
                    }
                    ResolvedTypeKind::Struct { fields: nested_fields, .. } => {
                        /* For inline nested structs, write referenced primitives, skip others */
                        if let crate::abi::resolved::Size::Const(_size) = field.field_type.size {
                            /* Const-size nested struct - write referenced fields, skip the rest */
                            for nested_field in nested_fields {
                                if let ResolvedTypeKind::Primitive { prim_type } = &nested_field.field_type.kind {
                                    let nested_path = format!("{}_{}", field.name, nested_field.name);
                                    let nested_size = primitive_size(prim_type);

                                    if referenced_fields.contains(&nested_path) {
                                        /* This nested primitive is referenced - write its value */
                                        match prim_type {
                                            PrimitiveType::Integral(IntegralType::U8) |
                                            PrimitiveType::Integral(IntegralType::I8) => {
                                                write!(output, "    buffer[offset] = {};\n", nested_path).unwrap();
                                            }
                                            _ => {
                                                write!(output, "    memcpy( &buffer[offset], &{}, sizeof( {} ) );\n",
                                                       nested_path, nested_path).unwrap();
                                            }
                                        }
                                    }
                                    write!(output, "    offset += {}; /* {}.{} */\n", nested_size, field.name, nested_field.name).unwrap();
                                }
                            }
                            write!(output, "\n").unwrap();
                        } else {
                            /* Variable-size inline nested struct - skip fields */
                            for nested_field in nested_fields {
                                match &nested_field.field_type.kind {
                                    ResolvedTypeKind::Primitive { prim_type } => {
                                        let nested_size = primitive_size(prim_type);
                                        write!(output, "    offset += {}; /* skip {}.{} */\n", nested_size, field.name, nested_field.name).unwrap();
                                    }
                                    ResolvedTypeKind::Array { element_type, size_expression, .. } => {
                                        if let crate::abi::resolved::Size::Const(array_size) = nested_field.field_type.size {
                                            write!(output, "    offset += {}; /* skip {}.{} (array) */\n", array_size, field.name, nested_field.name).unwrap();
                                        } else {
                                            /* Variable-size array - use parameter names from size expression */
                                            if let crate::abi::resolved::Size::Const(elem_size) = element_type.size {
                                                /* Extract field refs and convert to parameter names */
                                                let mut field_refs = HashSet::new();
                                                extract_field_refs_from_expr(size_expression, &mut field_refs);
                                                let params: Vec<String> = field_refs.into_iter().collect();
                                                let size_calc = format_expr_to_c(size_expression, &params);
                                                write!(output, "    offset += ({}) * {}; /* skip {}.{} (variable array) */\n",
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

            write!(output, "    *out_size = required_size;\n").unwrap();
            write!(output, "    return 0; /* Success */\n").unwrap();
            write!(output, "}}\n\n").unwrap();
            } /* end if !is_nested */

            /* Generate getters for each field */
            for (field_idx, field) in fields.iter().enumerate() {
                match &field.field_type.kind {
                    ResolvedTypeKind::Primitive { prim_type } => {
                        let c_type = primitive_to_c_type(prim_type);
                        write!(output, "{} {}_get_{}( {}_t const * self ) {{\n",
                               c_type, type_name, field.name, type_name).unwrap();
                        write!(output, "    uint8_t const * data = (uint8_t const *)self;\n").unwrap();

                        /* Calculate offset */
                        if field_idx == 0 {
                            write!(output, "    return ").unwrap();
                            emit_read_primitive_direct(prim_type, "0", "data", &mut output);
                            write!(output, ";\n").unwrap();
                        } else {
                            write!(output, "    uint64_t offset = 0;\n").unwrap();
                            for prev_field in &fields[0..field_idx] {
                                match &prev_field.field_type.kind {
                                    ResolvedTypeKind::Primitive { prim_type: prev_prim } => {
                                        let size = primitive_size(prev_prim);
                                        write!(output, "    offset += {}; /* {} */\n", size, prev_field.name).unwrap();
                                    }
                                    ResolvedTypeKind::Enum { .. } => {
                                        write!(output, "    offset += {}_get_{}_size( self ); /* {} (enum) */\n",
                                               type_name, prev_field.name, prev_field.name).unwrap();
                                    }
                                    ResolvedTypeKind::Array { element_type, size_expression, .. } => {
                                        if let crate::abi::resolved::Size::Const(size) = prev_field.field_type.size {
                                            write!(output, "    offset += {}; /* {} (array) */\n",
                                                   size, prev_field.name).unwrap();
                                        } else {
                                            /* Variable-size array - calculate size */
                                            if let crate::abi::resolved::Size::Const(elem_size) = element_type.size {
                                                let size_calc = size_expression_to_c_getter_code(size_expression, &type_name, "self");
                                                write!(output, "    offset += ({}) * {}; /* {} (variable array) */\n",
                                                       size_calc, elem_size, prev_field.name).unwrap();
                                            }
                                        }
                                    }
                                    ResolvedTypeKind::TypeRef { .. } => {
                                        if let crate::abi::resolved::Size::Const(size) = prev_field.field_type.size {
                                            write!(output, "    offset += {}; /* {} (nested) */\n",
                                                   size, prev_field.name).unwrap();
                                        }
                                    }
                                    _ => {}
                                }
                            }
                            write!(output, "    return ").unwrap();
                            emit_read_primitive_direct(prim_type, "offset", "data", &mut output);
                            write!(output, ";\n").unwrap();
                        }
                        write!(output, "}}\n\n").unwrap();
                    }
                    ResolvedTypeKind::Array { element_type, .. } => {
                        /* Generate array accessors */
                        if let crate::abi::resolved::Size::Const(array_size) = field.field_type.size {
                            /* Extract element type info */
                            let (elem_c_type, elem_size, is_primitive) = match &element_type.kind {
                                ResolvedTypeKind::Primitive { prim_type } => {
                                    (primitive_to_c_type(prim_type).to_string(), primitive_size(prim_type) as u64, true)
                                }
                                ResolvedTypeKind::TypeRef { target_name, .. } => {
                                    /* Array of structs - element must have constant size */
                                    if let crate::abi::resolved::Size::Const(elem_size) = element_type.size {
                                        (format!("{}_t const *", target_name), elem_size, false)
                                    } else {
                                        /* Variable-size struct elements not supported */
                                        continue;
                                    }
                                }
                                _ => {
                                    /* Other types not yet supported */
                                    continue;
                                }
                            };

                            let array_length = array_size / elem_size;

                            /* Calculate offset to array start */
                            write!(output, "/* Array accessor helpers for {} */\n", field.name).unwrap();

                            /* Length getter */
                            write!(output, "uint64_t {}_get_{}_length( {}_t const * self ) {{\n",
                                   type_name, field.name, type_name).unwrap();
                            write!(output, "    return {};\n", array_length).unwrap();
                            write!(output, "}}\n\n").unwrap();

                            /* Index getter */
                            write!(output, "{} {}_get_{}_at( {}_t const * self, uint64_t index ) {{\n",
                                   elem_c_type, type_name, field.name, type_name).unwrap();
                            write!(output, "    uint8_t const * data = (uint8_t const *)self;\n").unwrap();

                            /* Calculate offset */
                            if field_idx == 0 {
                                write!(output, "    uint64_t offset = index * {};\n", elem_size).unwrap();
                            } else {
                                write!(output, "    uint64_t offset = 0;\n").unwrap();
                                for prev_field in &fields[0..field_idx] {
                                    match &prev_field.field_type.kind {
                                        ResolvedTypeKind::Primitive { prim_type: prev_prim } => {
                                            let size = primitive_size(prev_prim);
                                            write!(output, "    offset += {}; /* {} */\n", size, prev_field.name).unwrap();
                                        }
                                        ResolvedTypeKind::Enum { .. } => {
                                            write!(output, "    offset += {}_get_{}_size( self ); /* {} (enum) */\n",
                                                   type_name, prev_field.name, prev_field.name).unwrap();
                                        }
                                        ResolvedTypeKind::Array { .. } => {
                                            if let crate::abi::resolved::Size::Const(size) = prev_field.field_type.size {
                                                write!(output, "    offset += {}; /* {} (array) */\n",
                                                       size, prev_field.name).unwrap();
                                            }
                                        }
                                        ResolvedTypeKind::TypeRef { .. } => {
                                            if let crate::abi::resolved::Size::Const(size) = prev_field.field_type.size {
                                                write!(output, "    offset += {}; /* {} (nested) */\n",
                                                       size, prev_field.name).unwrap();
                                            }
                                        }
                                        _ => {}
                                    }
                                }
                                write!(output, "    offset += index * {}; /* element index */\n", elem_size).unwrap();
                            }

                            /* Read element based on type */
                            if is_primitive {
                                if let ResolvedTypeKind::Primitive { prim_type } = &element_type.kind {
                                    write!(output, "    return ").unwrap();
                                    emit_read_primitive_direct(prim_type, "offset", "data", &mut output);
                                    write!(output, ";\n").unwrap();
                                }
                            } else {
                                /* Struct array - return opaque pointer (cast from offset into data) */
                                if let ResolvedTypeKind::TypeRef { target_name, .. } = &element_type.kind {
                                    write!(output, "    {}_t const * result = ({}_t const *)&data[offset];\n", target_name, target_name).unwrap();
                                    write!(output, "    return result;\n").unwrap();
                                }
                            }

                            write!(output, "}}\n\n").unwrap();
                        } else {
                            /* Variable-size array (FAM) - generate accessors */
                            if let ResolvedTypeKind::Array { element_type, size_expression, .. } = &field.field_type.kind {
                                /* Extract element type info */
                                let (elem_c_type, elem_size, is_primitive) = match &element_type.kind {
                                    ResolvedTypeKind::Primitive { prim_type } => {
                                        (primitive_to_c_type(prim_type).to_string(), primitive_size(prim_type) as u64, true)
                                    }
                                    ResolvedTypeKind::TypeRef { target_name, .. } => {
                                        /* Array of structs - element must have constant size */
                                        if let crate::abi::resolved::Size::Const(elem_size) = element_type.size {
                                            (format!("{}_t const *", target_name), elem_size, false)
                                        } else {
                                            /* Variable-size struct elements not supported */
                                            continue;
                                        }
                                    }
                                    _ => {
                                        /* Other types not yet supported */
                                        continue;
                                    }
                                };

                                /* For C FAM accessors, we need to call getter functions for field refs */
                                let size_expr = size_expression_to_c_getter_code(size_expression, &type_name, "self");

                                write!(output, "/* Variable-size array accessor helpers for {} */\n", field.name).unwrap();

                                /* Length getter */
                                write!(output, "uint64_t {}_get_{}_length( {}_t const * self ) {{\n",
                                       type_name, field.name, type_name).unwrap();
                                write!(output, "    return ({});\n", size_expr).unwrap();
                                write!(output, "}}\n\n").unwrap();

                                /* Index getter */
                                write!(output, "{} {}_get_{}_at( {}_t const * self, uint64_t index ) {{\n",
                                       elem_c_type, type_name, field.name, type_name).unwrap();

                                /* Calculate base offset to array start */
                                write!(output, "    uint8_t const * data = (uint8_t const *)self;\n").unwrap();
                                if field_idx == 0 {
                                    write!(output, "    uint64_t base_offset = 0;\n").unwrap();
                                } else {
                                    write!(output, "    uint64_t base_offset = 0;\n").unwrap();
                                    for prev_field in &fields[0..field_idx] {
                                        match &prev_field.field_type.kind {
                                            ResolvedTypeKind::Primitive { prim_type: prev_prim } => {
                                                let size = primitive_size(prev_prim);
                                                write!(output, "    base_offset += {}; /* {} */\n", size, prev_field.name).unwrap();
                                            }
                                            ResolvedTypeKind::Enum { .. } => {
                                                write!(output, "    base_offset += {}_get_{}_size( self ); /* {} (enum) */\n",
                                                       type_name, prev_field.name, prev_field.name).unwrap();
                                            }
                                            ResolvedTypeKind::Array { .. } => {
                                                if let crate::abi::resolved::Size::Const(size) = prev_field.field_type.size {
                                                    write!(output, "    base_offset += {}; /* {} (array) */\n",
                                                           size, prev_field.name).unwrap();
                                                } else {
                                                    /* Variable-size previous array */
                                                    write!(output, "    base_offset += {}_get_{}_length( self ) * {}; /* {} (variable array) */\n",
                                                           type_name, prev_field.name,
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
                                                if let crate::abi::resolved::Size::Const(size) = prev_field.field_type.size {
                                                    write!(output, "    base_offset += {}; /* {} (nested) */\n",
                                                           size, prev_field.name).unwrap();
                                                }
                                            }
                                            _ => {}
                                        }
                                    }
                                }
                                write!(output, "    uint64_t offset = base_offset + index * {}; /* element index */\n", elem_size).unwrap();

                                /* Read element based on type */
                                if is_primitive {
                                    if let ResolvedTypeKind::Primitive { prim_type } = &element_type.kind {
                                        write!(output, "    return ").unwrap();
                                        emit_read_primitive_direct(prim_type, "offset", "data", &mut output);
                                        write!(output, ";\n").unwrap();
                                    }
                                } else {
                                    /* Struct array - return opaque pointer (cast from offset into data) */
                                    if let ResolvedTypeKind::TypeRef { target_name, .. } = &element_type.kind {
                                        write!(output, "    {}_t const * result = ({}_t const *)&data[offset];\n", target_name, target_name).unwrap();
                                        write!(output, "    return result;\n").unwrap();
                                    }
                                }

                                write!(output, "}}\n\n").unwrap();

                                /* For u8 arrays, also provide const pointer accessor */
                                if is_primitive {
                                    if let ResolvedTypeKind::Primitive { prim_type } = &element_type.kind {
                                        if matches!(prim_type, crate::abi::types::PrimitiveType::Integral(IntegralType::U8)) {
                                            write!(output, "uint8_t const * {}_get_{}_const( {}_t const * self ) {{\n",
                                                   type_name, field.name, type_name).unwrap();

                                            /* Calculate offset */
                                            if field_idx == 0 {
                                                write!(output, "    uint8_t const * data = (uint8_t const *)self;\n").unwrap();
                                                write!(output, "    return data;\n").unwrap();
                                            } else {
                                                write!(output, "    uint8_t const * data = (uint8_t const *)self;\n").unwrap();
                                                write!(output, "    uint64_t offset = 0;\n").unwrap();
                                                for prev_field in &fields[0..field_idx] {
                                                    match &prev_field.field_type.kind {
                                                        ResolvedTypeKind::Primitive { prim_type: prev_prim } => {
                                                            let size = primitive_size(prev_prim);
                                                            write!(output, "    offset += {}; /* {} */\n", size, prev_field.name).unwrap();
                                                        }
                                                        ResolvedTypeKind::Enum { .. } => {
                                                            write!(output, "    offset += {}_get_{}_size( self ); /* {} (enum) */\n",
                                                                   type_name, prev_field.name, prev_field.name).unwrap();
                                                        }
                                                        ResolvedTypeKind::Array { .. } => {
                                                            if let crate::abi::resolved::Size::Const(size) = prev_field.field_type.size {
                                                                write!(output, "    offset += {}; /* {} (array) */\n",
                                                                       size, prev_field.name).unwrap();
                                                            } else {
                                                                write!(output, "    offset += {}_get_{}_length( self ) * {}; /* {} (variable array) */\n",
                                                                       type_name, prev_field.name,
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
                                                            if let crate::abi::resolved::Size::Const(size) = prev_field.field_type.size {
                                                                write!(output, "    offset += {}; /* {} (nested) */\n",
                                                                       size, prev_field.name).unwrap();
                                                            }
                                                        }
                                                        _ => {}
                                                    }
                                                }
                                                write!(output, "    return &data[offset];\n").unwrap();
                                            }
                                            write!(output, "}}\n\n").unwrap();
                                        }
                                    }
                                }
                            }
                        }
                    }
                    ResolvedTypeKind::TypeRef { target_name, .. } => {
                        /* Generate nested struct getters - return opaque wrapper by value */
                        if let crate::abi::resolved::Size::Const(nested_size) = field.field_type.size {
                            /* Const getter - returns const pointer */
                            write!(output, "/* Nested struct const getter for {} */\n", field.name).unwrap();
                            write!(output, "{}_t const * {}_get_{}_const( {}_t const * self ) {{\n",
                                   target_name, type_name, field.name, type_name).unwrap();

                            /* Calculate offset to nested struct */
                            if field_idx == 0 {
                                write!(output, "    {}_t const * result = ({}_t const *)self;\n", target_name, target_name).unwrap();
                                write!(output, "    return result;\n").unwrap();
                            } else {
                                write!(output, "    uint8_t const * data = (uint8_t const *)self;\n").unwrap();
                                write!(output, "    uint64_t offset = 0;\n").unwrap();
                                for prev_field in &fields[0..field_idx] {
                                    match &prev_field.field_type.kind {
                                        ResolvedTypeKind::Primitive { prim_type: prev_prim } => {
                                            let size = primitive_size(prev_prim);
                                            write!(output, "    offset += {}; /* {} */\n", size, prev_field.name).unwrap();
                                        }
                                        ResolvedTypeKind::Enum { .. } => {
                                            write!(output, "    offset += {}_get_{}_size( self ); /* {} (enum) */\n",
                                                   type_name, prev_field.name, prev_field.name).unwrap();
                                        }
                                        ResolvedTypeKind::Array { .. } => {
                                            if let crate::abi::resolved::Size::Const(size) = prev_field.field_type.size {
                                                write!(output, "    offset += {}; /* {} (array) */\n",
                                                       size, prev_field.name).unwrap();
                                            }
                                        }
                                        ResolvedTypeKind::TypeRef { .. } => {
                                            if let crate::abi::resolved::Size::Const(size) = prev_field.field_type.size {
                                                write!(output, "    offset += {}; /* {} (nested) */\n",
                                                       size, prev_field.name).unwrap();
                                            }
                                        }
                                        _ => {}
                                    }
                                }
                                write!(output, "    {}_t const * result = ({}_t const *)&data[offset];\n", target_name, target_name).unwrap();
                                write!(output, "    return result;\n").unwrap();
                            }
                            write!(output, "}}\n\n").unwrap();

                            /* Mutable getter - takes mutable data pointer, returns mutable pointer */
                            write!(output, "/* Nested struct mutable getter for {} */\n", field.name).unwrap();
                            write!(output, "{}_t * {}_get_{}( uint8_t * data ) {{\n",
                                   target_name, type_name, field.name).unwrap();

                            /* Calculate offset to nested struct */
                            if field_idx == 0 {
                                write!(output, "    {}_t * result = ({}_t *)data;\n", target_name, target_name).unwrap();
                                write!(output, "    return result;\n").unwrap();
                            } else {
                                write!(output, "    uint64_t offset = 0;\n").unwrap();
                                for prev_field in &fields[0..field_idx] {
                                    match &prev_field.field_type.kind {
                                        ResolvedTypeKind::Primitive { prim_type: prev_prim } => {
                                            let size = primitive_size(prev_prim);
                                            write!(output, "    offset += {}; /* {} */\n", size, prev_field.name).unwrap();
                                        }
                                        ResolvedTypeKind::Enum { .. } => {
                                            write!(output, "    offset += {}_get_{}_size( ({}_t const *)data ); /* {} (enum) */\n",
                                                   type_name, prev_field.name, type_name, prev_field.name).unwrap();
                                        }
                                        ResolvedTypeKind::Array { .. } => {
                                            if let crate::abi::resolved::Size::Const(size) = prev_field.field_type.size {
                                                write!(output, "    offset += {}; /* {} (array) */\n",
                                                       size, prev_field.name).unwrap();
                                            }
                                        }
                                        ResolvedTypeKind::TypeRef { .. } => {
                                            if let crate::abi::resolved::Size::Const(size) = prev_field.field_type.size {
                                                write!(output, "    offset += {}; /* {} (nested) */\n",
                                                       size, prev_field.name).unwrap();
                                            }
                                        }
                                        _ => {}
                                    }
                                }
                                write!(output, "    {}_t * result = ({}_t *)&data[offset];\n", target_name, target_name).unwrap();
                                write!(output, "    return result;\n").unwrap();
                            }
                            write!(output, "}}\n\n").unwrap();

                            /* Generate nested struct setter - accepts wrapper by const pointer */
                            write!(output, "/* Nested struct setter for {} */\n", field.name).unwrap();
                            write!(output, "int {}_set_{}( {}_t * self, {}_t const * nested ) {{\n",
                                   type_name, field.name, type_name, target_name).unwrap();

                            /* Calculate offset to nested struct */
                            write!(output, "    uint8_t * data = (uint8_t *)self;\n").unwrap();
                            write!(output, "    uint64_t offset = 0;\n").unwrap();
                            if field_idx > 0 {
                                for prev_field in &fields[0..field_idx] {
                                    match &prev_field.field_type.kind {
                                        ResolvedTypeKind::Primitive { prim_type: prev_prim } => {
                                            let size = primitive_size(prev_prim);
                                            write!(output, "    offset += {}; /* {} */\n", size, prev_field.name).unwrap();
                                        }
                                        ResolvedTypeKind::Enum { .. } => {
                                            write!(output, "    offset += {}_get_{}_size( ({}_t const *)self ); /* {} (enum) */\n",
                                                   type_name, prev_field.name, type_name, prev_field.name).unwrap();
                                        }
                                        ResolvedTypeKind::Array { .. } => {
                                            if let crate::abi::resolved::Size::Const(size) = prev_field.field_type.size {
                                                write!(output, "    offset += {}; /* {} (array) */\n",
                                                       size, prev_field.name).unwrap();
                                            }
                                        }
                                        ResolvedTypeKind::TypeRef { .. } => {
                                            if let crate::abi::resolved::Size::Const(size) = prev_field.field_type.size {
                                                write!(output, "    offset += {}; /* {} (nested) */\n",
                                                       size, prev_field.name).unwrap();
                                            }
                                        }
                                        _ => {}
                                    }
                                }
                            }

                            /* Copy nested struct bytes - nested is opaque pointer, cast to uint8_t const * */
                            write!(output, "    memcpy( &data[offset], (uint8_t const *)nested, {} );\n", nested_size).unwrap();
                            write!(output, "    return 0; /* Success */\n").unwrap();
                            write!(output, "}}\n\n").unwrap();
                        }
                    }
                    _ => {}
                }
            }

            /* Generate size helper functions for enum fields */
            for (field_idx, field) in fields.iter().enumerate() {
                if let ResolvedTypeKind::Enum { variants, tag_expression, .. } = &field.field_type.kind {
                    write!(output, "/* Size helper for enum field '{}' */\n", field.name).unwrap();
                    write!(output, "uint64_t {}_get_{}_size( {}_t const * self ) {{\n",
                           type_name, field.name, type_name).unwrap();

                    /* Generate tag expression code using getter methods */
                    let tag_expr = size_expression_to_c_getter_code(tag_expression, &type_name, "self");
                    write!(output, "    uint8_t tag = ({});\n", tag_expr).unwrap();

                    /* Generate switch based on tag value */
                    write!(output, "    switch( tag ) {{\n").unwrap();
                    for variant in variants {
                        if let crate::abi::resolved::Size::Const(size) = variant.variant_type.size {
                            write!(output, "        case {}: return {};\n", variant.tag_value, size).unwrap();
                        }
                    }
                    write!(output, "        default: return 0;\n").unwrap();
                    write!(output, "    }}\n").unwrap();
                    write!(output, "}}\n\n").unwrap();
                }
            }

            /* Generate body getter and setter for enum fields (Layer 1: Generic Body Access) */
            for (field_idx, field) in fields.iter().enumerate() {
                if let ResolvedTypeKind::Enum { .. } = &field.field_type.kind {
                    /* Body getter - returns pointer to enum body bytes */
                    write!(output, "/* Generic body getter for enum field '{}' */\n", field.name).unwrap();
                    write!(output, "uint8_t const * {}_get_{}_body( {}_t const * self ) {{\n",
                           type_name, field.name, type_name).unwrap();

                    /* Calculate offset to enum body (skip all fields before this enum) */
                    write!(output, "    uint8_t const * data = (uint8_t const *)self;\n").unwrap();
                    if field_idx == 0 {
                        write!(output, "    return data;\n").unwrap();
                    } else {
                        write!(output, "    uint64_t offset = 0;\n").unwrap();
                        for prev_field in &fields[0..field_idx] {
                            match &prev_field.field_type.kind {
                                ResolvedTypeKind::Primitive { prim_type: prev_prim } => {
                                    let size = primitive_size(prev_prim);
                                    write!(output, "    offset += {}; /* {} */\n", size, prev_field.name).unwrap();
                                }
                                ResolvedTypeKind::Enum { .. } => {
                                    write!(output, "    offset += {}_get_{}_size( self ); /* {} (enum) */\n",
                                           type_name, prev_field.name, prev_field.name).unwrap();
                                }
                                ResolvedTypeKind::Array { .. } => {
                                    if let crate::abi::resolved::Size::Const(size) = prev_field.field_type.size {
                                        write!(output, "    offset += {}; /* {} (array) */\n",
                                               size, prev_field.name).unwrap();
                                    }
                                }
                                ResolvedTypeKind::TypeRef { .. } => {
                                    if let crate::abi::resolved::Size::Const(size) = prev_field.field_type.size {
                                        write!(output, "    offset += {}; /* {} (nested) */\n",
                                               size, prev_field.name).unwrap();
                                    }
                                }
                                _ => {}
                            }
                        }
                        write!(output, "    return &data[offset];\n").unwrap();
                    }
                    write!(output, "}}\n\n").unwrap();

                    /* Body setter - validates size and copies bytes */
                    write!(output, "/* Generic body setter for enum field '{}' */\n", field.name).unwrap();
                    write!(output, "int {}_set_{}_body( {}_t * self, uint8_t const * body, uint64_t body_len ) {{\n",
                           type_name, field.name, type_name).unwrap();

                    /* Cast to get const version for calling size helper */
                    write!(output, "    uint64_t expected_size = {}_get_{}_size( ({}_t const *)self );\n",
                           type_name, field.name, type_name).unwrap();
                    write!(output, "    if( body_len != expected_size ) {{\n").unwrap();
                    write!(output, "        return -1; /* Size mismatch */\n").unwrap();
                    write!(output, "    }}\n\n").unwrap();

                    write!(output, "    uint8_t * data = (uint8_t *)self;\n").unwrap();
                    /* Calculate offset to enum body */
                    write!(output, "    uint64_t offset = 0;\n").unwrap();
                    if field_idx > 0 {
                        for prev_field in &fields[0..field_idx] {
                            match &prev_field.field_type.kind {
                                ResolvedTypeKind::Primitive { prim_type: prev_prim } => {
                                    let size = primitive_size(prev_prim);
                                    write!(output, "    offset += {}; /* {} */\n", size, prev_field.name).unwrap();
                                }
                                ResolvedTypeKind::Enum { .. } => {
                                    write!(output, "    offset += {}_get_{}_size( ({}_t const *)self ); /* {} (enum) */\n",
                                           type_name, prev_field.name, type_name, prev_field.name).unwrap();
                                }
                                ResolvedTypeKind::Array { .. } => {
                                    if let crate::abi::resolved::Size::Const(size) = prev_field.field_type.size {
                                        write!(output, "    offset += {}; /* {} (array) */\n",
                                               size, prev_field.name).unwrap();
                                    }
                                }
                                ResolvedTypeKind::TypeRef { .. } => {
                                    if let crate::abi::resolved::Size::Const(size) = prev_field.field_type.size {
                                        write!(output, "    offset += {}; /* {} (nested) */\n",
                                               size, prev_field.name).unwrap();
                                    }
                                }
                                _ => {}
                            }
                        }
                    }

                    /* Copy body bytes */
                    write!(output, "    memcpy( &data[offset], body, body_len );\n").unwrap();
                    write!(output, "    return 0; /* Success */\n").unwrap();
                    write!(output, "}}\n\n").unwrap();
                }
            }

            /* Generate variant-specific setters for size-discriminated union fields (like enums) */
            for (field_idx, field) in fields.iter().enumerate() {
                if let ResolvedTypeKind::SizeDiscriminatedUnion { variants } = &field.field_type.kind {
                    let escaped_name = escape_c_keyword(&field.name);
                    
                    /* Generate variant-specific setters for each variant */
                    for variant in variants {
                        let variant_escaped = escape_c_keyword(&variant.name);
                        let variant_type_name = format!("{}_{}_{}_inner_t", type_name, escaped_name, variant_escaped);

                        /* Generate setter for this variant - name includes SDU field name (like enum pattern) */
                        write!(output, "void {}_{}_set_{}( {}_t * self, {} const * value ) {{\n",
                               type_name, escaped_name, variant_escaped, type_name, variant_type_name).unwrap();

                        /* Calculate offset to SDU body */
                        write!(output, "    uint8_t * data = (uint8_t *)self;\n").unwrap();
                        write!(output, "    uint64_t offset = 0;\n").unwrap();
                        if field_idx > 0 {
                            for prev_field in &fields[0..field_idx] {
                                match &prev_field.field_type.kind {
                                    ResolvedTypeKind::Primitive { prim_type: prev_prim } => {
                                        let size = primitive_size(prev_prim);
                                        write!(output, "    offset += {}; /* {} */\n", size, prev_field.name).unwrap();
                                    }
                                    ResolvedTypeKind::Enum { .. } => {
                                        write!(output, "    offset += {}_get_{}_size( ({}_t const *)self ); /* {} (enum) */\n",
                                               type_name, prev_field.name, type_name, prev_field.name).unwrap();
                                    }
                                    ResolvedTypeKind::SizeDiscriminatedUnion { .. } => {
                                        /* Can't calculate SDU size statically - but there can only be one SDU per struct */
                                        write!(output, "    /* SDU '{}' size is variable - offset calculation stops here */\n", prev_field.name).unwrap();
                                    }
                                    ResolvedTypeKind::Array { .. } => {
                                        if let crate::abi::resolved::Size::Const(size) = prev_field.field_type.size {
                                            write!(output, "    offset += {}; /* {} (array) */\n",
                                                   size, prev_field.name).unwrap();
                                        }
                                    }
                                    ResolvedTypeKind::TypeRef { .. } => {
                                        if let crate::abi::resolved::Size::Const(size) = prev_field.field_type.size {
                                            write!(output, "    offset += {}; /* {} (nested) */\n",
                                                   size, prev_field.name).unwrap();
                                        }
                                    }
                                    _ => {}
                                }
                            }
                        }

                        /* Copy variant data */
                        write!(output, "    memcpy( &data[offset], value, sizeof( {} ) );\n", variant_type_name).unwrap();
                        write!(output, "}}\n\n").unwrap();
                    }
                }
            }

            /* Identify fields that affect size (no setters for these) */
            let size_affecting_fields = identify_size_affecting_fields(fields);

            /* Generate setters for each primitive field - operate on mutable buffer */
            for (field_idx, field) in fields.iter().enumerate() {
                match &field.field_type.kind {
                    ResolvedTypeKind::Primitive { prim_type } => {
                        /* Skip setters for size-affecting fields (array sizes, enum tags) */
                        if size_affecting_fields.contains(&field.name) {
                            continue;
                        }

                        let c_type = primitive_to_c_type(prim_type);
                        write!(output, "void {}_set_{}( {}_t * self, {} value ) {{\n",
                               type_name, field.name, type_name, c_type).unwrap();
                        write!(output, "    uint8_t * data = (uint8_t *)self;\n").unwrap();

                        /* Calculate offset */
                        if field_idx == 0 {
                            emit_write_primitive(prim_type, "0", "value", "data", &mut output);
                        } else {
                            write!(output, "    uint64_t offset = 0;\n").unwrap();
                            for prev_field in &fields[0..field_idx] {
                                match &prev_field.field_type.kind {
                                    ResolvedTypeKind::Primitive { prim_type: prev_prim } => {
                                        let size = primitive_size(prev_prim);
                                        write!(output, "    offset += {}; /* {} */\n", size, prev_field.name).unwrap();
                                    }
                                    ResolvedTypeKind::Enum { .. } => {
                                        /* For setters, we can't easily get enum size without wrapper - skip for now */
                                        write!(output, "    /* TODO: offset += enum size for {} */\n", prev_field.name).unwrap();
                                    }
                                    ResolvedTypeKind::Array { element_type, size_expression, .. } => {
                                        if let crate::abi::resolved::Size::Const(size) = prev_field.field_type.size {
                                            write!(output, "    offset += {}; /* {} (array) */\n",
                                                   size, prev_field.name).unwrap();
                                        } else {
                                            /* Variable-size array - calculate size using cast to const wrapper */
                                            if let crate::abi::resolved::Size::Const(elem_size) = element_type.size {
                                                /* Cast data to const wrapper type to call getter */
                                                write!(output, "    offset += {}_get_{}_length( ({}_t const *)data ) * {}; /* {} (variable array) */\n",
                                                       type_name, prev_field.name, type_name, elem_size, prev_field.name).unwrap();
                                            }
                                        }
                                    }
                                    ResolvedTypeKind::TypeRef { .. } => {
                                        if let crate::abi::resolved::Size::Const(size) = prev_field.field_type.size {
                                            write!(output, "    offset += {}; /* {} (nested) */\n",
                                                   size, prev_field.name).unwrap();
                                        }
                                    }
                                    _ => {}
                                }
                            }
                            emit_write_primitive(prim_type, "offset", "value", "data", &mut output);
                        }
                        write!(output, "}}\n\n").unwrap();
                    }
                    ResolvedTypeKind::Array { element_type, .. } => {
                        /* Generate array setter */
                        if let crate::abi::resolved::Size::Const(array_size) = field.field_type.size {
                            /* Extract element type info */
                            let (elem_c_type, elem_size, is_primitive) = match &element_type.kind {
                                ResolvedTypeKind::Primitive { prim_type } => {
                                    (primitive_to_c_type(prim_type).to_string(), primitive_size(prim_type) as u64, true)
                                }
                                ResolvedTypeKind::TypeRef { target_name, .. } => {
                                    /* Array of structs - element must have constant size */
                                    if let crate::abi::resolved::Size::Const(elem_size) = element_type.size {
                                        (format!("{}_t const *", target_name), elem_size, false)
                                    } else {
                                        /* Variable-size struct elements not supported */
                                        continue;
                                    }
                                }
                                _ => {
                                    /* Other types not yet supported */
                                    continue;
                                }
                            };

                            /* Index setter */
                            write!(output, "void {}_set_{}_at( {}_t * self, uint64_t index, {} value ) {{\n",
                                   type_name, field.name, type_name, elem_c_type).unwrap();
                            write!(output, "    uint8_t * data = (uint8_t *)self;\n").unwrap();

                            /* Calculate offset */
                            if field_idx == 0 {
                                write!(output, "    uint64_t offset = index * {};\n", elem_size).unwrap();
                            } else {
                                write!(output, "    uint64_t offset = 0;\n").unwrap();
                                for prev_field in &fields[0..field_idx] {
                                    match &prev_field.field_type.kind {
                                        ResolvedTypeKind::Primitive { prim_type: prev_prim } => {
                                            let size = primitive_size(prev_prim);
                                            write!(output, "    offset += {}; /* {} */\n", size, prev_field.name).unwrap();
                                        }
                                        ResolvedTypeKind::Enum { .. } => {
                                            /* For setters, we can't easily get enum size without wrapper - skip for now */
                                            write!(output, "    /* TODO: offset += enum size for {} */\n", prev_field.name).unwrap();
                                        }
                                        ResolvedTypeKind::Array { element_type, .. } => {
                                            if let crate::abi::resolved::Size::Const(size) = prev_field.field_type.size {
                                                write!(output, "    offset += {}; /* {} (array) */\n",
                                                       size, prev_field.name).unwrap();
                                            } else {
                                                /* Variable-size array - use wrapper to get length */
                                                if let crate::abi::resolved::Size::Const(elem_size) = element_type.size {
                                                    write!(output, "    offset += {}_get_{}_length( ({}_t const *)data ) * {}; /* {} (variable array) */\n",
                                                           type_name, prev_field.name, type_name, elem_size, prev_field.name).unwrap();
                                                }
                                            }
                                        }
                                        ResolvedTypeKind::TypeRef { .. } => {
                                            if let crate::abi::resolved::Size::Const(size) = prev_field.field_type.size {
                                                write!(output, "    offset += {}; /* {} (nested) */\n",
                                                       size, prev_field.name).unwrap();
                                            }
                                        }
                                        _ => {}
                                    }
                                }
                                write!(output, "    offset += index * {}; /* element index */\n", elem_size).unwrap();
                            }

                            /* Write element based on type */
                            if is_primitive {
                                if let ResolvedTypeKind::Primitive { prim_type } = &element_type.kind {
                                    emit_write_primitive(prim_type, "offset", "value", "data", &mut output);
                                }
                            } else {
                                /* Struct array - copy struct data (value is already opaque pointer to data) */
                                write!(output, "    memcpy( &data[offset], (uint8_t const *)value, {} );\n", elem_size).unwrap();
                            }

                            write!(output, "}}\n\n").unwrap();
                        } else {
                            /* Variable-size array (FAM) - generate setters */
                            if let ResolvedTypeKind::Array { element_type, .. } = &field.field_type.kind {
                                /* Extract element type info */
                                let (elem_c_type, elem_size, is_primitive) = match &element_type.kind {
                                    ResolvedTypeKind::Primitive { prim_type } => {
                                        (primitive_to_c_type(prim_type).to_string(), primitive_size(prim_type) as u64, true)
                                    }
                                    ResolvedTypeKind::TypeRef { target_name, .. } => {
                                        /* Array of structs - element must have constant size */
                                        if let crate::abi::resolved::Size::Const(elem_size) = element_type.size {
                                            (format!("{}_t const *", target_name), elem_size, false)
                                        } else {
                                            /* Variable-size struct elements not supported */
                                            continue;
                                        }
                                    }
                                    _ => {
                                        /* Other types not yet supported */
                                        continue;
                                    }
                                };

                                /* Index setter */
                                write!(output, "void {}_set_{}_at( {}_t * self, uint64_t index, {} value ) {{\n",
                                       type_name, field.name, type_name, elem_c_type).unwrap();
                                write!(output, "    uint8_t * data = (uint8_t *)self;\n").unwrap();

                                /* Calculate base offset */
                                if field_idx == 0 {
                                    write!(output, "    uint64_t base_offset = 0;\n").unwrap();
                                } else {
                                    write!(output, "    uint64_t base_offset = 0;\n").unwrap();
                                    for prev_field in &fields[0..field_idx] {
                                        match &prev_field.field_type.kind {
                                            ResolvedTypeKind::Primitive { prim_type: prev_prim } => {
                                                let size = primitive_size(prev_prim);
                                                write!(output, "    base_offset += {}; /* {} */\n", size, prev_field.name).unwrap();
                                            }
                                            ResolvedTypeKind::Enum { .. } => {
                                                /* For setters, we can't easily get enum size without wrapper - skip for now */
                                                write!(output, "    /* TODO: base_offset += enum size for {} */\n", prev_field.name).unwrap();
                                            }
                                            ResolvedTypeKind::Array { .. } => {
                                                if let crate::abi::resolved::Size::Const(size) = prev_field.field_type.size {
                                                    write!(output, "    base_offset += {}; /* {} (array) */\n",
                                                           size, prev_field.name).unwrap();
                                                } else {
                                                    /* Variable-size previous array - need wrapper to get length */
                                                    write!(output, "    base_offset += {}_get_{}_length( ({}_t const *)data ) * {}; /* {} (variable array) */\n",
                                                           type_name, prev_field.name, type_name,
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
                                                if let crate::abi::resolved::Size::Const(size) = prev_field.field_type.size {
                                                    write!(output, "    base_offset += {}; /* {} (nested) */\n",
                                                           size, prev_field.name).unwrap();
                                                }
                                            }
                                            _ => {}
                                        }
                                    }
                                }
                                write!(output, "    uint64_t offset = base_offset + index * {};\n", elem_size).unwrap();

                                /* Write element based on type */
                                if is_primitive {
                                    if let ResolvedTypeKind::Primitive { prim_type } = &element_type.kind {
                                        emit_write_primitive(prim_type, "offset", "value", "data", &mut output);
                                    }
                                } else {
                                    /* Struct array - copy struct data (value is already opaque pointer to data) */
                                    write!(output, "    memcpy( &data[offset], (uint8_t const *)value, {} );\n", elem_size).unwrap();
                                }

                                write!(output, "}}\n\n").unwrap();

                                /* For u8 arrays, also provide slice setter and mutable pointer accessor */
                                if is_primitive {
                                    if let ResolvedTypeKind::Primitive { prim_type } = &element_type.kind {
                                        if matches!(prim_type, crate::abi::types::PrimitiveType::Integral(IntegralType::U8)) {
                                            /* Slice setter */
                                            write!(output, "void {}_set_{}( uint8_t * data, uint8_t const * slice, uint64_t slice_len ) {{\n",
                                                   type_name, field.name).unwrap();

                                            /* Calculate offset */
                                            if field_idx == 0 {
                                                write!(output, "    uint64_t offset = 0;\n").unwrap();
                                            } else {
                                                write!(output, "    uint64_t offset = 0;\n").unwrap();
                                                for prev_field in &fields[0..field_idx] {
                                                    match &prev_field.field_type.kind {
                                                        ResolvedTypeKind::Primitive { prim_type: prev_prim } => {
                                                            let size = primitive_size(prev_prim);
                                                            write!(output, "    offset += {}; /* {} */\n", size, prev_field.name).unwrap();
                                                        }
                                                        ResolvedTypeKind::Enum { .. } => {
                                                            write!(output, "    /* TODO: offset += enum size for {} */\n", prev_field.name).unwrap();
                                                        }
                                                        ResolvedTypeKind::Array { .. } => {
                                                            if let crate::abi::resolved::Size::Const(size) = prev_field.field_type.size {
                                                                write!(output, "    offset += {}; /* {} (array) */\n",
                                                                       size, prev_field.name).unwrap();
                                                            } else {
                                                                write!(output, "    offset += {}_get_{}_length( ({}_t const *)data ) * {}; /* {} (variable array) */\n",
                                                                       type_name, prev_field.name, type_name,
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
                                                            if let crate::abi::resolved::Size::Const(size) = prev_field.field_type.size {
                                                                write!(output, "    offset += {}; /* {} (nested) */\n",
                                                                       size, prev_field.name).unwrap();
                                                            }
                                                        }
                                                        _ => {}
                                                    }
                                                }
                                            }
                                            write!(output, "    uint64_t len = {}_get_{}_length( ({}_t const *)data );\n",
                                                   type_name, field.name, type_name).unwrap();
                                            write!(output, "    if( slice_len < len ) len = slice_len;\n").unwrap();
                                            write!(output, "    memcpy( &data[offset], slice, len );\n").unwrap();
                                            write!(output, "}}\n\n").unwrap();

                                            /* Mutable pointer accessor */
                                            write!(output, "uint8_t * {}_get_{}( uint8_t * data ) {{\n",
                                                   type_name, field.name).unwrap();

                                            /* Calculate offset */
                                            if field_idx == 0 {
                                                write!(output, "    return data;\n").unwrap();
                                            } else {
                                                write!(output, "    uint64_t offset = 0;\n").unwrap();
                                                for prev_field in &fields[0..field_idx] {
                                                    match &prev_field.field_type.kind {
                                                        ResolvedTypeKind::Primitive { prim_type: prev_prim } => {
                                                            let size = primitive_size(prev_prim);
                                                            write!(output, "    offset += {}; /* {} */\n", size, prev_field.name).unwrap();
                                                        }
                                                        ResolvedTypeKind::Enum { .. } => {
                                                            write!(output, "    /* TODO: offset += enum size for {} */\n", prev_field.name).unwrap();
                                                        }
                                                        ResolvedTypeKind::Array { .. } => {
                                                            if let crate::abi::resolved::Size::Const(size) = prev_field.field_type.size {
                                                                write!(output, "    offset += {}; /* {} (array) */\n",
                                                                       size, prev_field.name).unwrap();
                                                            } else {
                                                                write!(output, "    offset += {}_get_{}_length( ({}_t const *)data ) * {}; /* {} (variable array) */\n",
                                                                       type_name, prev_field.name, type_name,
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
                                                            if let crate::abi::resolved::Size::Const(size) = prev_field.field_type.size {
                                                                write!(output, "    offset += {}; /* {} (nested) */\n",
                                                                       size, prev_field.name).unwrap();
                                                            }
                                                        }
                                                        _ => {}
                                                    }
                                                }
                                                write!(output, "    return &data[offset];\n").unwrap();
                                            }
                                            write!(output, "}}\n\n").unwrap();
                                        }
                                    }
                                }
                            }
                        }
                    }
                    _ => {}
                }
            }

            /* validation function */
            write!(output, "int {}_validate( uint8_t const * data, uint64_t data_len, uint64_t * out_size ) {{\n", type_name).unwrap();
            write!(output, "    uint64_t offset = 0;\n\n").unwrap();

            /* Track field offsets for enum tag resolution */
            let mut field_offsets: std::collections::HashMap<String, String> = std::collections::HashMap::new();

            for (field_idx, field) in fields.iter().enumerate() {
                match &field.field_type.kind {
                    ResolvedTypeKind::Primitive { prim_type } => {
                        let size = primitive_size(prim_type);
                        write!(output, "    if( offset + {} > data_len ) {{\n", size).unwrap();
                        write!(output, "        return -1; /* Buffer too small for '{}' */\n", field.name).unwrap();
                        write!(output, "    }}\n").unwrap();

                        /* Check if any later field (enum/array) references this field in its expression */
                        let needs_saving = fields.iter().skip(field_idx + 1).any(|f| {
                            let mut refs = HashSet::new();
                            match &f.field_type.kind {
                                ResolvedTypeKind::Enum { tag_expression, .. } => {
                                    extract_field_refs_from_expr(tag_expression, &mut refs);
                                    refs.contains(&field.name)
                                }
                                ResolvedTypeKind::Array { size_expression, .. } => {
                                    extract_field_refs_from_expr(size_expression, &mut refs);
                                    refs.contains(&field.name)
                                }
                                _ => false,
                            }
                        });

                        if field_idx == 0 {
                            field_offsets.insert(field.name.clone(), "0".to_string());
                        } else if needs_saving {
                            write!(output, "    uint64_t offset_{} = offset;\n", field.name).unwrap();
                            field_offsets.insert(field.name.clone(), format!("offset_{}", field.name));
                        } else {
                            field_offsets.insert(field.name.clone(), "offset".to_string());
                        }

                        write!(output, "    offset += {}; /* {} */\n\n", size, field.name).unwrap();
                    }
                    ResolvedTypeKind::Enum { variants, tag_expression, .. } => {
                        /* Use field-specific variable names to avoid collisions */
                        let tag_var = format!("tag_{}", field.name);
                        let size_var = format!("variant_size_{}", field.name);

                        /* Generate tag expression code reading from data array */
                        let tag_expr = expression_to_c_data_read(tag_expression, &field_offsets);
                        write!(output, "    uint8_t {} = ({});\n", tag_var, tag_expr).unwrap();

                        write!(output, "    uint64_t {};\n", size_var).unwrap();
                        write!(output, "    switch( {} ) {{\n", tag_var).unwrap();
                        for variant in variants {
                            if let crate::abi::resolved::Size::Const(size) = variant.variant_type.size {
                                write!(output, "        case {}: {} = {}; break;\n",
                                       variant.tag_value, size_var, size).unwrap();
                            }
                        }
                        write!(output, "        default: return -1; /* Invalid enum tag */\n").unwrap();
                        write!(output, "    }}\n\n").unwrap();

                        write!(output, "    if( offset + {} > data_len ) {{\n", size_var).unwrap();
                        write!(output, "        return -1; /* Buffer too small for enum '{}' */\n", field.name).unwrap();
                        write!(output, "    }}\n").unwrap();
                        write!(output, "    offset += {};\n\n", size_var).unwrap();
                    }
                    ResolvedTypeKind::SizeDiscriminatedUnion { variants } => {
                        /* Size-discriminated union: determine variant based on available size */
                        let available_size_var = format!("available_size_{}", field.name);
                        let tag_var = format!("tag_{}", field.name);
                        let size_var = format!("variant_size_{}", field.name);

                        /* Calculate available size (remaining buffer) */
                        write!(output, "    uint64_t {} = data_len - offset;\n", available_size_var).unwrap();

                        /* Match available size against variant expected sizes */
                        write!(output, "    uint8_t {};\n", tag_var).unwrap();
                        write!(output, "    uint64_t {};\n", size_var).unwrap();
                        write!(output, "    switch( {} ) {{\n", available_size_var).unwrap();
                        for (idx, variant) in variants.iter().enumerate() {
                            write!(output, "        case {}: {} = {}; {} = {}; break;\n",
                                   variant.expected_size,
                                   tag_var,
                                   idx,
                                   size_var,
                                   variant.expected_size).unwrap();
                        }
                        write!(output, "        default: return -1; /* No matching variant for size {} */\n", available_size_var).unwrap();
                        write!(output, "    }}\n\n").unwrap();

                        write!(output, "    if( offset + {} > data_len ) {{\n", size_var).unwrap();
                        write!(output, "        return -1; /* Buffer too small for size-discriminated union '{}' */\n", field.name).unwrap();
                        write!(output, "    }}\n").unwrap();
                        write!(output, "    offset += {};\n\n", size_var).unwrap();
                    }
                    ResolvedTypeKind::Array { .. } => {
                        if let crate::abi::resolved::Size::Const(size) = field.field_type.size {
                            write!(output, "    if( offset + {} > data_len ) {{\n", size).unwrap();
                            write!(output, "        return -1; /* Buffer too small for array '{}' */\n", field.name).unwrap();
                            write!(output, "    }}\n").unwrap();
                            write!(output, "    offset += {}; /* {} (array) */\n\n", size, field.name).unwrap();
                        }
                    }
                    ResolvedTypeKind::TypeRef { .. } => {
                        if let crate::abi::resolved::Size::Const(size) = field.field_type.size {
                            write!(output, "    if( offset + {} > data_len ) {{\n", size).unwrap();
                            write!(output, "        return -1; /* Buffer too small for nested '{}' */\n", field.name).unwrap();
                            write!(output, "    }}\n").unwrap();
                            write!(output, "    offset += {}; /* {} (nested) */\n\n", size, field.name).unwrap();
                        }
                    }
                    ResolvedTypeKind::Struct { fields: nested_fields, .. } => {
                        /* Validate anonymous inline nested struct */
                        if let crate::abi::resolved::Size::Const(size) = field.field_type.size {
                            /* Constant size nested struct - validate as a whole */
                            /* But still need to add nested field offsets for expression evaluation */
                            /* Save the current offset for this nested struct */
                            let nested_struct_offset_var = format!("offset_{}", field.name);
                            write!(output, "    uint64_t {} = offset; /* Save offset for '{}' */\n", nested_struct_offset_var, field.name).unwrap();

                            let mut nested_offset_within_struct: u64 = 0;
                            for nested_field in nested_fields {
                                if let ResolvedTypeKind::Primitive { prim_type } = &nested_field.field_type.kind {
                                    let nested_field_path = format!("{}.{}", field.name, nested_field.name);
                                    /* Use the saved offset variable plus the within-struct offset */
                                    let absolute_offset = if nested_offset_within_struct == 0 {
                                        nested_struct_offset_var.clone()
                                    } else {
                                        format!("{} + {}", nested_struct_offset_var, nested_offset_within_struct)
                                    };
                                    field_offsets.insert(nested_field_path, absolute_offset);
                                    nested_offset_within_struct += primitive_size(prim_type) as u64;
                                }
                            }

                            write!(output, "    if( offset + {} > data_len ) {{\n", size).unwrap();
                            write!(output, "        return -1; /* Buffer too small for nested struct '{}' */\n", field.name).unwrap();
                            write!(output, "    }}\n").unwrap();
                            write!(output, "    offset += {}; /* {} (inline nested struct) */\n\n", size, field.name).unwrap();
                        } else {
                            /* Variable size nested struct - validate each field */
                            write!(output, "    /* Validate inline nested struct '{}' fields */\n", field.name).unwrap();
                            for nested_field in nested_fields {
                                match &nested_field.field_type.kind {
                                    ResolvedTypeKind::Primitive { prim_type } => {
                                        let size = primitive_size(prim_type);
                                        /* Add nested field to offset map before validating - use full path as key */
                                        let nested_field_path = format!("{}.{}", field.name, nested_field.name);
                                        field_offsets.insert(nested_field_path, "offset".to_string());

                                        write!(output, "    if( offset + {} > data_len ) {{\n", size).unwrap();
                                        write!(output, "        return -1; /* Buffer too small for field '{}.{}' */\n", field.name, nested_field.name).unwrap();
                                        write!(output, "    }}\n").unwrap();
                                        write!(output, "    offset += {}; /* {}.{} */\n", size, field.name, nested_field.name).unwrap();
                                    }
                                    ResolvedTypeKind::Array { element_type, size_expression, .. } => {
                                        if let crate::abi::resolved::Size::Const(array_size) = nested_field.field_type.size {
                                            /* Constant size array */
                                            write!(output, "    if( offset + {} > data_len ) {{\n", array_size).unwrap();
                                            write!(output, "        return -1; /* Buffer too small for array '{}.{}' */\n", field.name, nested_field.name).unwrap();
                                            write!(output, "    }}\n").unwrap();
                                            write!(output, "    offset += {}; /* {}.{} (array) */\n", array_size, field.name, nested_field.name).unwrap();
                                        } else {
                                            /* Variable-size array - validate using field reference */
                                            if let crate::abi::resolved::Size::Const(elem_size) = element_type.size {
                                                let size_expr = expression_to_c_data_read(size_expression, &field_offsets);
                                                write!(output, "    uint64_t array_count_{} = ({});\n", nested_field.name, size_expr).unwrap();
                                                write!(output, "    uint64_t array_size_{} = array_count_{} * {};\n", nested_field.name, nested_field.name, elem_size).unwrap();
                                                write!(output, "    if( offset + array_size_{} > data_len ) {{\n", nested_field.name).unwrap();
                                                write!(output, "        return -1; /* Buffer too small for array '{}.{}' */\n", field.name, nested_field.name).unwrap();
                                                write!(output, "    }}\n").unwrap();
                                                write!(output, "    offset += array_size_{}; /* {}.{} (variable array) */\n", nested_field.name, field.name, nested_field.name).unwrap();
                                            }
                                        }
                                    }
                                    _ => {
                                        write!(output, "    /* TODO: validate {}.{} of type {:?} */\n", field.name, nested_field.name, nested_field.field_type.kind).unwrap();
                                    }
                                }
                            }
                            write!(output, "\n").unwrap();
                        }
                    }
                    _ => {}
                }
            }

            write!(output, "    *out_size = offset;\n").unwrap();
            write!(output, "    return 0;\n").unwrap();
            write!(output, "}}\n\n").unwrap();

            /* For nested inline struct fields, generate accessor functions on the parent type */
            /* This allows the accessors to access parent fields that the nested struct's size expressions reference */
            for (field_idx, field) in fields.iter().enumerate() {
                if let ResolvedTypeKind::Struct { fields: nested_fields, .. } = &field.field_type.kind {
                    /* Generate accessors for this nested struct's fields as parent methods */
                    for nested_field in nested_fields {
                        match &nested_field.field_type.kind {
                            ResolvedTypeKind::Primitive { prim_type } => {
                                /* Generate primitive accessor on parent type */
                                /* This allows field ref paths like ["first", "count"] to call ParentType_get_first_count() */
                                let prim_c_type = primitive_to_c_type(prim_type);
                                let prim_size = primitive_size(prim_type) as u64;

                                write!(output, "/* Nested struct {}.{} primitive accessor */\n", field.name, nested_field.name).unwrap();

                                /* Getter */
                                write!(output, "{} {}_get_{}_{}( {}_t const * self ) {{\n",
                                       prim_c_type, type_name, field.name, nested_field.name, type_name).unwrap();
                                /* Calculate offset to this primitive field */
                                write!(output, "    uint8_t const * data = (uint8_t const *)self;\n").unwrap();
                                write!(output, "    uint64_t offset = 0;\n").unwrap();
                                /* Add size of all fields before the nested struct */
                                for prev_field in &fields[0..field_idx] {
                                    match &prev_field.field_type.kind {
                                        ResolvedTypeKind::Primitive { prim_type: prev_prim } => {
                                            let size = primitive_size(prev_prim);
                                            write!(output, "    offset += {}; /* {} */\n", size, prev_field.name).unwrap();
                                        }
                                        ResolvedTypeKind::Struct { fields: prev_nested_fields, .. } => {
                                            /* Add size of all fields in the previous nested struct */
                                            for prev_nested_field in prev_nested_fields {
                                                if let ResolvedTypeKind::Primitive { prim_type: prev_nested_prim } = &prev_nested_field.field_type.kind {
                                                    let size = primitive_size(prev_nested_prim);
                                                    write!(output, "    offset += {}; /* {}.{} */\n", size, prev_field.name, prev_nested_field.name).unwrap();
                                                }
                                            }
                                        }
                                        _ => {}
                                    }
                                }
                                /* Now add offsets within the current nested struct to reach this field */
                                if let ResolvedTypeKind::Struct { fields: current_nested_fields, .. } = &field.field_type.kind {
                                    for current_nested_field in current_nested_fields {
                                        if current_nested_field.name == nested_field.name {
                                            break; /* Found our field */
                                        }
                                        if let ResolvedTypeKind::Primitive { prim_type: current_nested_prim } = &current_nested_field.field_type.kind {
                                            let size = primitive_size(current_nested_prim);
                                            write!(output, "    offset += {}; /* {}.{} */\n", size, field.name, current_nested_field.name).unwrap();
                                        }
                                    }
                                }
                                write!(output, "    return ").unwrap();
                                emit_read_primitive_direct(prim_type, "offset", "data", &mut output);
                                write!(output, ";\n").unwrap();
                                write!(output, "}}\n\n").unwrap();

                                /* Setter - generate for non-referenced fields */
                                let field_path = format!("{}_{}", field.name, nested_field.name);
                                let referenced_fields = extract_referenced_fields(fields);
                                if !referenced_fields.contains(&field_path) {
                                    write!(output, "/* Nested struct {}.{} primitive setter */\n", field.name, nested_field.name).unwrap();
                                    write!(output, "void {}_set_{}_{}( uint8_t * data, {} value ) {{\n",
                                           type_name, field.name, nested_field.name, prim_c_type).unwrap();
                                    /* Calculate offset to this primitive field */
                                    write!(output, "    uint64_t offset = 0;\n").unwrap();
                                    /* Add size of all fields before the nested struct */
                                    for prev_field in &fields[0..field_idx] {
                                        match &prev_field.field_type.kind {
                                            ResolvedTypeKind::Primitive { prim_type: prev_prim } => {
                                                let size = primitive_size(prev_prim);
                                                write!(output, "    offset += {}; /* {} */\n", size, prev_field.name).unwrap();
                                            }
                                            ResolvedTypeKind::Struct { fields: prev_nested_fields, .. } => {
                                                /* Add size of all fields in the previous nested struct */
                                                for prev_nested_field in prev_nested_fields {
                                                    if let ResolvedTypeKind::Primitive { prim_type: prev_nested_prim } = &prev_nested_field.field_type.kind {
                                                        let size = primitive_size(prev_nested_prim);
                                                        write!(output, "    offset += {}; /* {}.{} */\n", size, prev_field.name, prev_nested_field.name).unwrap();
                                                    }
                                                }
                                            }
                                            _ => {}
                                        }
                                    }
                                    /* Now add offsets within the current nested struct to reach this field */
                                    if let ResolvedTypeKind::Struct { fields: current_nested_fields, .. } = &field.field_type.kind {
                                        for current_nested_field in current_nested_fields {
                                            if current_nested_field.name == nested_field.name {
                                                break; /* Found our field */
                                            }
                                            if let ResolvedTypeKind::Primitive { prim_type: current_nested_prim } = &current_nested_field.field_type.kind {
                                                let size = primitive_size(current_nested_prim);
                                                write!(output, "    offset += {}; /* {}.{} */\n", size, field.name, current_nested_field.name).unwrap();
                                            }
                                        }
                                    }
                                    emit_write_primitive(prim_type, "offset", "value", "data", &mut output);
                                    write!(output, "}}\n\n").unwrap();
                                }
                            }
                            ResolvedTypeKind::Array { element_type, size_expression, .. } => {
                                /* Generate array accessors on parent type */
                                if let ResolvedTypeKind::Primitive { prim_type } = &element_type.kind {
                                    if !matches!(nested_field.field_type.size, crate::abi::resolved::Size::Const(..)) {
                                        let elem_c_type = primitive_to_c_type(prim_type);
                                        let elem_size = primitive_size(prim_type) as u64;

                                        /* Variable-size array - generate accessors on parent */
                                        let size_expr = size_expression_to_c_getter_code(size_expression, &type_name, "self");

                                        write!(output, "/* Nested struct {}.{} array accessors */\n", field.name, nested_field.name).unwrap();

                                        /* Length getter */
                                        write!(output, "uint64_t {}_get_{}_{}_length( {}_t const * self ) {{\n",
                                               type_name, field.name, nested_field.name, type_name).unwrap();
                                        write!(output, "    return ({});\n", size_expr).unwrap();
                                        write!(output, "}}\n\n").unwrap();

                                        /* Element getter */
                                        write!(output, "{} {}_get_{}_{}_at( {}_t const * self, uint64_t index ) {{\n",
                                               elem_c_type, type_name, field.name, nested_field.name, type_name).unwrap();
                                        /* Calculate offset to nested struct start, then add array offset */
                                        write!(output, "    uint8_t const * data = (uint8_t const *)self;\n").unwrap();
                                        write!(output, "    uint64_t offset = 0;\n").unwrap();
                                        /* Add size of all fields before the nested struct */
                                        for prev_field in &fields[0..field_idx] {
                                            match &prev_field.field_type.kind {
                                                ResolvedTypeKind::Primitive { prim_type: prev_prim } => {
                                                    let size = primitive_size(prev_prim);
                                                    write!(output, "    offset += {}; /* {} */\n", size, prev_field.name).unwrap();
                                                }
                                                ResolvedTypeKind::Struct { fields: prev_nested_fields, .. } => {
                                                    /* Add size of all fields in the previous nested struct */
                                                    for prev_nested_field in prev_nested_fields {
                                                        if let ResolvedTypeKind::Primitive { prim_type: prev_nested_prim } = &prev_nested_field.field_type.kind {
                                                            let size = primitive_size(prev_nested_prim);
                                                            write!(output, "    offset += {}; /* {}.{} */\n", size, prev_field.name, prev_nested_field.name).unwrap();
                                                        }
                                                    }
                                                }
                                                _ => {}
                                            }
                                        }
                                        /* Now we're at the nested struct start - add index * element_size for array */
                                        write!(output, "    offset += index * {}; /* {}[index] */\n", elem_size, nested_field.name).unwrap();
                                        write!(output, "    return ").unwrap();
                                        emit_read_primitive_direct(prim_type, "offset", "data", &mut output);
                                        write!(output, ";\n").unwrap();
                                        write!(output, "}}\n\n").unwrap();

                                        /* Element setter */
                                        write!(output, "void {}_set_{}_{}_at( {}_t * self, uint64_t index, {} value ) {{\n",
                                               type_name, field.name, nested_field.name, type_name, elem_c_type).unwrap();
                                        write!(output, "    uint8_t * data = (uint8_t *)self;\n").unwrap();
                                        write!(output, "    uint64_t offset = 0;\n").unwrap();
                                        /* Add size of all fields before the nested struct */
                                        for prev_field in &fields[0..field_idx] {
                                            match &prev_field.field_type.kind {
                                                ResolvedTypeKind::Primitive { prim_type: prev_prim } => {
                                                    let size = primitive_size(prev_prim);
                                                    write!(output, "    offset += {}; /* {} */\n", size, prev_field.name).unwrap();
                                                }
                                                ResolvedTypeKind::Struct { fields: prev_nested_fields, .. } => {
                                                    /* Add size of all fields in the previous nested struct */
                                                    for prev_nested_field in prev_nested_fields {
                                                        if let ResolvedTypeKind::Primitive { prim_type: prev_nested_prim } = &prev_nested_field.field_type.kind {
                                                            let size = primitive_size(prev_nested_prim);
                                                            write!(output, "    offset += {}; /* {}.{} */\n", size, prev_field.name, prev_nested_field.name).unwrap();
                                                        }
                                                    }
                                                }
                                                _ => {}
                                            }
                                        }
                                        write!(output, "    offset += index * {}; /* {}[index] */\n", elem_size, nested_field.name).unwrap();
                                        emit_write_primitive(prim_type, "offset", "value", "data", &mut output);
                                        write!(output, "}}\n\n").unwrap();
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                }
            }
        }
        _ => {}
    }

    /* Generate SDU tag/size helper functions and variant getters */
    if let ResolvedTypeKind::Struct { fields, .. } = &resolved_type.kind {
        let type_name = resolved_type.name.replace("::", "_");
        for (field_idx, field) in fields.iter().enumerate() {
            if let ResolvedTypeKind::SizeDiscriminatedUnion { variants } = &field.field_type.kind {
                let escaped_name = escape_c_keyword(&field.name);
                
                /* Generate tag function - takes size parameter and returns variant tag */
                write!(output, "/* Tag function for size-discriminated union field '{}' */\n", field.name).unwrap();
                write!(output, "uint8_t {}_{}_tag_from_size( uint64_t size ) {{\n", type_name, escaped_name).unwrap();
                write!(output, "  switch( size ) {{\n").unwrap();
                for (idx, variant) in variants.iter().enumerate() {
                    write!(output, "    case {}: return {};\n", variant.expected_size, idx).unwrap();
                }
                write!(output, "    default: return 255; /* Invalid size - no matching variant */\n").unwrap();
                write!(output, "  }}\n").unwrap();
                write!(output, "}}\n\n").unwrap();

                /* Generate size function - takes tag and returns size */
                write!(output, "uint64_t {}_{}_size_from_tag( uint8_t tag ) {{\n", type_name, escaped_name).unwrap();
                write!(output, "  switch( tag ) {{\n").unwrap();
                for (idx, variant) in variants.iter().enumerate() {
                    write!(output, "    case {}: return {};\n", idx, variant.expected_size).unwrap();
                }
                write!(output, "    default: return 0; /* Invalid tag */\n").unwrap();
                write!(output, "  }}\n").unwrap();
                write!(output, "}}\n\n").unwrap();

                /* Generate size getter - takes struct pointer and buffer size, returns size based on available buffer */
                write!(output, "/* Size getter for size-discriminated union field '{}' */\n", field.name).unwrap();
                write!(output, "uint64_t {}_{}_size( {}_t const * self, uint64_t buffer_size ) {{\n", type_name, escaped_name, type_name).unwrap();
                
                /* Calculate offset to this field - sum all constant-size fields before it */
                let mut static_offset = 0u64;
                for prev_field in fields.iter() {
                    if prev_field.name == field.name {
                        break;
                    }
                    if let crate::abi::resolved::Size::Const(size) = prev_field.field_type.size {
                        static_offset += size;
                    } else {
                        /* Variable-size field before SDU - can't calculate statically */
                        static_offset = 0;
                        break;
                    }
                }
                write!(output, "  uint64_t available_size = buffer_size - {};\n", static_offset).unwrap();
                write!(output, "  /* Match available size against variant sizes */\n").unwrap();
                write!(output, "  switch( available_size ) {{\n").unwrap();
                for variant in variants.iter() {
                    write!(output, "    case {}: return {};\n", variant.expected_size, variant.expected_size).unwrap();
                }
                write!(output, "    default: return 0; /* Invalid size */\n").unwrap();
                write!(output, "  }}\n").unwrap();
                write!(output, "}}\n\n").unwrap();
                
                /* Generate variant-specific getters for each variant */
                for variant in variants {
                    let variant_escaped = escape_c_keyword(&variant.name);
                    let variant_type_name = if is_nested_complex_type(&variant.variant_type) {
                        format!("{}_{}_{}_inner_t", type_name, escaped_name, variant_escaped)
                    } else {
                        format_type_to_c(&variant.variant_type)
                    };

                    /* Const getter */
                    write!(output, "{} const * {}_{}_get_{}_const( {}_t const * self ) {{\n",
                           variant_type_name, type_name, escaped_name, variant_escaped, type_name).unwrap();
                    /* Calculate offset - same logic as setters */
                    write!(output, "    uint8_t const * data = (uint8_t const *)self;\n").unwrap();
                    write!(output, "    uint64_t offset = 0;\n").unwrap();
                    if field_idx > 0 {
                        for prev_field in &fields[0..field_idx] {
                            match &prev_field.field_type.kind {
                                ResolvedTypeKind::Primitive { prim_type: prev_prim } => {
                                    let size = primitive_size(prev_prim);
                                    write!(output, "    offset += {}; /* {} */\n", size, prev_field.name).unwrap();
                                }
                                ResolvedTypeKind::Enum { .. } => {
                                    write!(output, "    offset += {}_get_{}_size( self ); /* {} (enum) */\n",
                                           type_name, prev_field.name, prev_field.name).unwrap();
                                }
                                ResolvedTypeKind::SizeDiscriminatedUnion { .. } => {
                                    write!(output, "    /* SDU '{}' size is variable - offset calculation stops here */\n", prev_field.name).unwrap();
                                }
                                ResolvedTypeKind::Array { .. } => {
                                    if let crate::abi::resolved::Size::Const(size) = prev_field.field_type.size {
                                        write!(output, "    offset += {}; /* {} (array) */\n",
                                               size, prev_field.name).unwrap();
                                    }
                                }
                                ResolvedTypeKind::TypeRef { .. } => {
                                    if let crate::abi::resolved::Size::Const(size) = prev_field.field_type.size {
                                        write!(output, "    offset += {}; /* {} (nested) */\n",
                                               size, prev_field.name).unwrap();
                                    }
                                }
                                _ => {}
                            }
                        }
                    }
                    write!(output, "    return ({} const *)(data + offset);\n", variant_type_name).unwrap();
                    write!(output, "}}\n\n").unwrap();

                    /* Mutable getter */
                    write!(output, "{} * {}_{}_get_{}( {}_t * self ) {{\n",
                           variant_type_name, type_name, escaped_name, variant_escaped, type_name).unwrap();
                    write!(output, "    return ({} *)(void *){}_{}_get_{}_const( ({}_t const *)self );\n",
                           variant_type_name, type_name, escaped_name, variant_escaped, type_name).unwrap();
                    write!(output, "}}\n\n").unwrap();
                }
            }
        }
    }

    output
}
