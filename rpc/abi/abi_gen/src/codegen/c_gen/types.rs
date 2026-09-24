use super::helpers::{escape_c_keyword, is_nested_complex_type};
use crate::abi::expr::ConstantExpression;
use crate::abi::resolved::{ResolvedType, ResolvedTypeKind, Size, TypeResolver};
use crate::abi::types::{FloatingPointType, IntegralType, PrimitiveType};
use std::fmt::Write;

const INDENT_FIELD: usize = 4;

/* Format a resolved type to C string */
fn format_resolved_type_to_c(resolved_type: &ResolvedType, indent: usize) -> String {
    match &resolved_type.kind {
        ResolvedTypeKind::Primitive { prim_type } => match prim_type {
            PrimitiveType::Integral(int_type) => match int_type {
                IntegralType::U8 => "uint8_t".to_string(),
                IntegralType::U16 => "uint16_t".to_string(),
                IntegralType::U32 => "uint32_t".to_string(),
                IntegralType::U64 => "uint64_t".to_string(),
                IntegralType::I8 => "int8_t".to_string(),
                IntegralType::I16 => "int16_t".to_string(),
                IntegralType::I32 => "int32_t".to_string(),
                IntegralType::I64 => "int64_t".to_string(),
                IntegralType::Char => "uint8_t".to_string(),
            },
            PrimitiveType::FloatingPoint(float_type) => match float_type {
                FloatingPointType::F16 => "_Float16".to_string(),
                FloatingPointType::F32 => "float".to_string(),
                FloatingPointType::F64 => "double".to_string(),
            },
        },
        ResolvedTypeKind::Array { element_type, .. } => {
            // Arrays in nested contexts need special handling
            // This returns the base type only, array dimension is handled separately
            format_resolved_type_to_c(element_type, indent)
        }
        ResolvedTypeKind::TypeRef { target_name, .. } => {
            format!("{}_t", escape_c_keyword(target_name))
        }
        ResolvedTypeKind::Struct { .. } => {
            // For anonymous nested structs, this shouldn't be called directly
            format!("{}_t", escape_c_keyword(&resolved_type.name))
        }
        ResolvedTypeKind::Union { .. } => {
            format!("{}_t", escape_c_keyword(&resolved_type.name))
        }
        ResolvedTypeKind::Enum { .. } => {
            // Enums become structs with tag + union
            format!("{}_t", escape_c_keyword(&resolved_type.name))
        }
        ResolvedTypeKind::SizeDiscriminatedUnion { .. } => {
            format!("{}_t", escape_c_keyword(&resolved_type.name))
        }
    }
}

/* Format a struct field - handles both nested complex types and regular fields */
fn format_struct_field(
    field_name: &str,
    field_type: &ResolvedType,
    parent_type_name: &str,
) -> String {
    /* Check if this is an enum field - enums don't get a typed field in the struct */
    if matches!(&field_type.kind, ResolvedTypeKind::Enum { .. }) {
        let escaped_name = escape_c_keyword(field_name);
        /* Enum body is inline bytes, no explicit field type.
         * Treat like a flexible member - emit as comment or omit entirely */
        format!(
            "/* {} - enum body inline (access via getters) */",
            escaped_name
        )
    } else if is_nested_complex_type(field_type) {
        let nested_type = format!(
            "{}_{}_inner_t",
            parent_type_name,
            escape_c_keyword(field_name)
        );
        let escaped_name = escape_c_keyword(field_name);
        format!("{} {}", nested_type, escaped_name)
    } else {
        format_field_declaration(field_name, field_type, INDENT_FIELD)
    }
}

/* Format a field declaration with proper type and array handling */
fn format_field_declaration(field_name: &str, field_type: &ResolvedType, indent: usize) -> String {
    let escaped_name = escape_c_keyword(field_name);

    match &field_type.kind {
        ResolvedTypeKind::Array {
            element_type,
            size_expression,
            ..
        } => {
            let base_type = format_resolved_type_to_c(element_type, indent);

            // Check if the expression is constant directly
            if size_expression.is_constant() {
                // Constant expression - output it directly in brackets
                let array_dim = format!("[{}]", size_expression.to_c_string());
                format!("{} {}{}", base_type, escaped_name, array_dim)
            } else {
                // Non-constant expression - this is a FAM
                let size_comment = format!(" /* FAM size: {} */", size_expression.to_c_string());
                format!("{} {}[]{}", base_type, escaped_name, size_comment)
            }
        }
        _ => {
            let type_str = format_resolved_type_to_c(field_type, indent);
            format!("{} {}", type_str, escaped_name)
        }
    }
}

/* Emit a C struct or union definition with fields and typedef */
fn emit_c_type_definition(
    type_keyword: &str,
    type_name: &str,
    fields_content: &str,
    packed: bool,
    alignment: Option<u64>,
    output: &mut String,
) {
    // Write the type keyword (struct or union)
    write!(output, "{}", type_keyword).unwrap();

    // Add attributes if needed
    if packed {
        write!(output, " __attribute__((packed))").unwrap();
    }
    if let Some(align) = alignment {
        write!(output, " __attribute__((aligned({})))", align).unwrap();
    }

    // Write the type name and body
    write!(output, " {} {{\n", type_name).unwrap();
    write!(output, "{}", fields_content).unwrap();
    write!(output, "}};\n").unwrap();

    // Write the typedef
    write!(
        output,
        "typedef {} {} {}_t;\n\n",
        type_keyword, type_name, type_name
    )
    .unwrap();
}

/* Helper function to emit struct fields with FAM handling */
fn emit_struct_fields(
    fields: &[crate::abi::resolved::ResolvedField],
    parent_type_name: &str,
    output: &mut String,
) {
    let mut after_variable_size_data = false;
    let mut has_physical_member = false;

    for (_i, field) in fields.iter().enumerate() {
        let field_decl = format_struct_field(&field.name, &field.field_type, parent_type_name);

        /* Check if this is an enum field (comment-only, no actual field) */
        let is_enum = matches!(&field.field_type.kind, ResolvedTypeKind::Enum { .. });
        let is_variable = matches!(field.field_type.size, Size::Variable(_));

        if is_variable && !has_physical_member {
            write!(output, "    uint8_t __tn_fam_pad[0];\n").unwrap();
            has_physical_member = true;
        }

        if after_variable_size_data {
            write!(output, "    /// {};\n", field_decl).unwrap();
        } else if is_enum {
            /* Enum fields are comments only, no semicolon */
            write!(output, "    {}\n", field_decl).unwrap();
        } else {
            write!(output, "    {};\n", field_decl).unwrap();
            has_physical_member = true;
        }

        if is_variable {
            after_variable_size_data = true;
        }
    }
}

/* Only expose native indexing when the emitted C element has the ABI layout.
This is a representation check; sizes and strides come from the resolver. */
fn has_native_array_element_layout(ty: &ResolvedType, resolver: Option<&TypeResolver>) -> bool {
    let Size::Const(size) = ty.size else {
        return false;
    };
    match &ty.kind {
        ResolvedTypeKind::Primitive { .. } => true,
        ResolvedTypeKind::Struct {
            fields,
            packed,
            custom_alignment,
        } => {
            if let Some(alignment) = custom_alignment {
                /* C adds tail padding even to packed structs, and aligned(N)
                cannot lower a non-packed struct's natural field alignment. */
                if size % alignment != 0
                    || (!packed
                        && fields
                            .iter()
                            .any(|field| field.field_type.alignment > *alignment))
                {
                    return false;
                }
            }
            fields
                .iter()
                .all(|field| has_native_array_element_layout(&field.field_type, resolver))
        }
        ResolvedTypeKind::Array { element_type, .. } => {
            /* Inline array fields only emit one dimension and cannot declare
            inline complex element types in the existing struct emitter. */
            matches!(
                element_type.kind,
                ResolvedTypeKind::Primitive { .. } | ResolvedTypeKind::TypeRef { .. }
            ) && has_native_array_element_layout(element_type, resolver)
        }
        ResolvedTypeKind::TypeRef { target_name, .. } => resolver
            .and_then(|r| r.get_type_info(target_name))
            .is_some_and(|target| {
                matches!(
                    target.kind,
                    ResolvedTypeKind::Struct { .. } | ResolvedTypeKind::Array { .. }
                ) && has_native_array_element_layout(target, resolver)
            }),
        ResolvedTypeKind::Union { .. }
        | ResolvedTypeKind::Enum { .. }
        | ResolvedTypeKind::SizeDiscriminatedUnion { .. } => false,
    }
}

/* Recursively emit type definitions, handling nested types first */
fn emit_recursive_types(
    type_def: &ResolvedType,
    type_path: Option<String>,
    resolver: Option<&TypeResolver>,
    output: &mut String,
) {
    let current_name = type_path
        .clone()
        .unwrap_or_else(|| escape_c_keyword(&type_def.name));
    // Phase 1: Recursively process all nested complex types first
    match &type_def.kind {
        ResolvedTypeKind::Struct { fields, .. } => {
            for field in fields {
                if is_nested_complex_type(&field.field_type) {
                    let nested_path = format!("{}_{}", current_name, escape_c_keyword(&field.name));
                    emit_recursive_types(&field.field_type, Some(nested_path), resolver, output);
                }
            }
        }
        ResolvedTypeKind::Union { variants } => {
            for variant in variants {
                if is_nested_complex_type(&variant.field_type) {
                    let nested_path =
                        format!("{}_{}", current_name, escape_c_keyword(&variant.name));
                    emit_recursive_types(&variant.field_type, Some(nested_path), resolver, output);
                }
            }
        }
        ResolvedTypeKind::Enum { variants, .. } => {
            for variant in variants {
                if is_nested_complex_type(&variant.variant_type) {
                    let nested_path =
                        format!("{}_{}", current_name, escape_c_keyword(&variant.name));
                    emit_recursive_types(
                        &variant.variant_type,
                        Some(nested_path),
                        resolver,
                        output,
                    );
                }
            }
        }
        ResolvedTypeKind::SizeDiscriminatedUnion { variants } => {
            for variant in variants {
                if is_nested_complex_type(&variant.variant_type) {
                    let nested_path =
                        format!("{}_{}", current_name, escape_c_keyword(&variant.name));
                    emit_recursive_types(
                        &variant.variant_type,
                        Some(nested_path),
                        resolver,
                        output,
                    );
                }
            }
        }
        _ => {}
    }

    // Phase 2: Emit the current type definition
    // Add comment if present and this is a top-level type
    if type_path.is_none() && type_def.comment.is_some() {
        write!(output, "/* {} */\n", type_def.comment.as_ref().unwrap()).unwrap();
    }

    match &type_def.kind {
        ResolvedTypeKind::Array { .. } => {
            /* Variable layouts have no compile-time C element stride. Keep a
            byte view instead of emitting incomplete inner dimensions. */
            if matches!(type_def.size, Size::Variable(_)) {
                writeln!(
                    output,
                    "/* Runtime-sized byte view: element offsets require runtime layout information. */"
                )
                .unwrap();
                writeln!(output, "typedef uint8_t {}_t[];\n", current_name).unwrap();
                return;
            }
            /* Preserve every dimension of a named array. Emit inline element
            types before the typedef, just as for inline struct fields. */
            let mut element = type_def;
            let mut dimensions = String::new();
            while let ResolvedTypeKind::Array {
                element_type,
                size_expression,
                ..
            } = &element.kind
            {
                if size_expression.is_constant() {
                    write!(dimensions, "[{}]", size_expression.to_c_string()).unwrap();
                } else {
                    dimensions.push_str("[]");
                }
                element = element_type;
            }
            /* C unions can add tail padding absent from the ABI. Enums and
            structs containing them may also lack a native C representation.
            Preserve the canonical stride with one byte row per element. */
            if !has_native_array_element_layout(element, resolver) {
                let Size::Const(size) = element.size else {
                    unreachable!()
                };
                writeln!(
                    output,
                    "/* Byte elements preserve the ABI stride; decode each element separately. */"
                )
                .unwrap();
                writeln!(
                    output,
                    "typedef uint8_t {}_t{}[{}];\n",
                    current_name, dimensions, size
                )
                .unwrap();
                return;
            }
            let base_type = if is_nested_complex_type(element) {
                let element_path = format!("{}_element", current_name);
                emit_recursive_types(element, Some(element_path.clone()), resolver, output);
                format!("{}_inner_t", element_path)
            } else {
                format_resolved_type_to_c(element, INDENT_FIELD)
            };
            write!(
                output,
                "typedef {} {}_t{};\n\n",
                base_type, current_name, dimensions
            )
            .unwrap();
        }
        ResolvedTypeKind::Struct {
            fields,
            packed,
            custom_alignment,
        } => {
            let type_name = type_path
                .as_ref()
                .map(|path| format!("{}_inner", path))
                .unwrap_or_else(|| current_name.clone());

            let mut struct_content = String::new();
            emit_struct_fields(fields, &current_name, &mut struct_content);

            emit_c_type_definition(
                "struct",
                &type_name,
                &struct_content,
                *packed,
                *custom_alignment,
                output,
            );
        }
        ResolvedTypeKind::Union { variants } => {
            let type_name = type_path
                .as_ref()
                .map(|path| format!("{}_inner", path))
                .unwrap_or_else(|| current_name.clone());

            let mut union_content = String::new();
            let field_prefix = current_name.clone();

            for variant in variants {
                let variant_decl =
                    format_struct_field(&variant.name, &variant.field_type, &field_prefix);
                write!(union_content, "    {};\n", variant_decl).unwrap();
            }

            emit_c_type_definition(
                "union",
                &type_name,
                &union_content,
                false, // Unions don't have packed from resolved type
                None,  // Unions don't have custom alignment from resolved type
                output,
            );
        }
        ResolvedTypeKind::Enum { .. } => {
            let type_name = type_path
                .as_ref()
                .map(|path| format!("{}_inner", path))
                .unwrap_or_else(|| current_name.clone());
            write!(output, "struct __attribute__((packed)) {} {{\n", type_name).unwrap();
            write!(output, "    uint8_t tag;\n").unwrap();
            write!(
                output,
                "    uint8_t body[]; /* enum body inline (access via getters) */\n"
            )
            .unwrap();
            write!(output, "}};\n").unwrap();
            write!(output, "typedef struct {} {}_t;\n\n", type_name, type_name).unwrap();
        }
        ResolvedTypeKind::SizeDiscriminatedUnion { variants } => {
            let type_name = type_path
                .as_ref()
                .map(|path| format!("{}_inner", path))
                .unwrap_or_else(|| current_name.clone());

            // Add tag constants/macros for each variant (0-indexed)
            if type_path.is_none() {
                // Only emit tag constants for top-level types, not nested ones
                write!(
                    output,
                    "/* TAG CONSTANTS FOR SIZE-DISCRIMINATED UNION: {} */\n",
                    type_def.name.to_uppercase()
                )
                .unwrap();
                for (idx, variant) in variants.iter().enumerate() {
                    let variant_name_upper = escape_c_keyword(&variant.name).to_uppercase();
                    let type_name_upper = type_def.name.to_uppercase();
                    write!(
                        output,
                        "#define {}_TAG_{} {}\n",
                        type_name_upper, variant_name_upper, idx
                    )
                    .unwrap();
                }
                write!(output, "\n").unwrap();
            }

            let mut union_content = String::new();
            let field_prefix = current_name.clone();

            for variant in variants {
                let variant_ident = escape_c_keyword(&variant.name);
                let variant_decl = if is_nested_complex_type(&variant.variant_type) {
                    let nested_name = format!("{}_{}_inner_t", field_prefix, variant_ident);
                    format!(
                        "{} {} /* expected size: {} */",
                        nested_name, variant_ident, variant.expected_size
                    )
                } else {
                    let type_str = format_resolved_type_to_c(&variant.variant_type, INDENT_FIELD);
                    format!(
                        "{} {} /* expected size: {} */",
                        type_str, variant_ident, variant.expected_size
                    )
                };
                write!(union_content, "    {};\n", variant_decl).unwrap();
            }

            emit_c_type_definition("union", &type_name, &union_content, false, None, output);
        }
        _ => {
            // Other types don't generate their own definitions
        }
    }
}

pub fn emit_type(type_def: &ResolvedType) -> String {
    emit_type_with_resolver(type_def, None)
}

pub(crate) fn emit_type_with_resolver(
    type_def: &ResolvedType,
    resolver: Option<&TypeResolver>,
) -> String {
    let mut output = String::new();
    output.push_str(&format!(
        "/*  ----- TYPE DEFINITION FOR {} ----- */\n\n",
        type_def.name
    ));
    emit_recursive_types(type_def, None, resolver, &mut output);
    output
}
