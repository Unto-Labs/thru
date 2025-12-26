use crate::abi::expr::{ExprKind, LiteralExpr};
use crate::abi::resolved::ResolvedType;
use crate::abi::types::{FloatingPointType, IntegralType, PrimitiveType, TypeDef, TypeKind};
use crate::codegen::rust_gen::ir_helpers::sanitize_param_name;
use crate::codegen::shared::ir::TypeIr;
use std::fmt::Write;

/* Indentation constants */
const INDENT_BASE: usize = 2;
const INDENT_FIELD: usize = 4;

/* Rust reserved keywords that need to be escaped with r# */
const RUST_KEYWORDS: &[&str] = &[
    "as", "break", "const", "continue", "crate", "else", "enum", "extern", "false", "fn", "for",
    "if", "impl", "in", "let", "loop", "match", "mod", "move", "mut", "pub", "ref", "return",
    "self", "Self", "static", "struct", "super", "trait", "true", "type", "unsafe", "use", "where",
    "while", "async", "await", "dyn", "abstract", "become", "box", "do", "final", "macro",
    "override", "priv", "typeof", "unsized", "virtual", "yield", "try",
];

/* Escape Rust keywords by prefixing with r# */
fn escape_rust_keyword(name: &str) -> String {
    if RUST_KEYWORDS.contains(&name) {
        format!("r#{}", name)
    } else {
        name.to_string()
    }
}

pub fn format_expr_to_rust(expr: &ExprKind) -> String {
    // First try to evaluate the expression to a constant
    if let Some(constant_value) = expr.try_evaluate_constant() {
        return constant_value.to_string();
    }

    // If not a constant, handle specific simple cases
    match expr {
        ExprKind::Literal(literal) => match literal {
            LiteralExpr::U64(val) => val.to_string(),
            LiteralExpr::U32(val) => val.to_string(),
            LiteralExpr::U16(val) => val.to_string(),
            LiteralExpr::U8(val) => val.to_string(),
            LiteralExpr::I64(val) => val.to_string(),
            LiteralExpr::I32(val) => val.to_string(),
            LiteralExpr::I16(val) => val.to_string(),
            LiteralExpr::I8(val) => val.to_string(),
        },
        ExprKind::Sizeof(sizeof_expr) => {
            format!("std::mem::size_of::<{}>()", sizeof_expr.type_name)
        }
        ExprKind::Alignof(alignof_expr) => {
            format!("std::mem::align_of::<{}>()", alignof_expr.type_name)
        }
        // For complex expressions that couldn't be evaluated, output detailed debug information
        _ => {
            format!("/* COMPLEX_EXPR: {} */", expr.to_debug_string())
        }
    }
}

pub fn format_type_to_rust(type_kind: &TypeKind, indent: usize) -> String {
    match type_kind {
        TypeKind::Primitive(prim) => match prim {
            PrimitiveType::Integral(int_type) => match int_type {
                IntegralType::U8 => "u8".to_string(),
                IntegralType::U16 => "u16".to_string(),
                IntegralType::U32 => "u32".to_string(),
                IntegralType::U64 => "u64".to_string(),
                IntegralType::I8 => "i8".to_string(),
                IntegralType::I16 => "i16".to_string(),
                IntegralType::I32 => "i32".to_string(),
                IntegralType::I64 => "i64".to_string(),
            },
            PrimitiveType::FloatingPoint(float_type) => match float_type {
                FloatingPointType::F16 => "f16".to_string(),
                FloatingPointType::F32 => "f32".to_string(),
                FloatingPointType::F64 => "f64".to_string(),
            },
        },
        TypeKind::Array(array_type) => format_type_to_rust(&array_type.element_type, indent),
        TypeKind::TypeRef(type_ref) => {
            format!("{}_t", type_ref.name)
        }
        TypeKind::Struct(struct_type) => emit_anonymous_struct(struct_type, indent),
        TypeKind::Union(union_type) => emit_anonymous_union(union_type, indent),
        TypeKind::Enum(enum_type) => emit_anonymous_enum(enum_type, indent),
        TypeKind::SizeDiscriminatedUnion(sdu_type) => {
            emit_anonymous_size_discriminated_union(sdu_type, indent)
        }
    }
}

/* Check if a type is a nested complex type that needs extraction */
fn is_nested_complex_type(type_kind: &TypeKind) -> bool {
    matches!(
        type_kind,
        TypeKind::Struct(_)
            | TypeKind::Union(_)
            | TypeKind::Enum(_)
            | TypeKind::SizeDiscriminatedUnion(_)
    )
}

/* Recursively collect all nested type definitions from a type */
fn collect_nested_type_definitions(
    parent_name: &str,
    field_name: &str,
    field_type: &TypeKind,
    parent_attributes: &crate::abi::types::ContainerAttributes,
    output: &mut String,
) {
    match field_type {
        TypeKind::Struct(struct_type) => {
            // First, recursively handle nested types in this struct
            for field in &struct_type.fields {
                if is_nested_complex_type(&field.field_type) {
                    let nested_parent_name = format!("{}_{}_inner", parent_name, field_name);
                    collect_nested_type_definitions(
                        &nested_parent_name,
                        &field.name,
                        &field.field_type,
                        parent_attributes,
                        output,
                    );
                }
            }

            // Then emit this struct definition
            let inner_type_name = format!("{}_{}_inner", parent_name, field_name);
            let mut struct_content = String::new();
            for field in &struct_type.fields {
                let escaped_name = escape_rust_keyword(&field.name);
                let field_decl = if is_nested_complex_type(&field.field_type) {
                    let nested_name = format!("{}_{}_inner", inner_type_name, field.name);
                    format!("{}: {}", escaped_name, nested_name)
                } else {
                    format_field_declaration(&field.name, &field.field_type, INDENT_FIELD)
                };
                write!(struct_content, "    pub {},\n", field_decl).unwrap();
            }

            write!(output, "{}\n", emit_repr_attributes(parent_attributes)).unwrap();
            write!(output, "pub struct {} {{\n", inner_type_name).unwrap();
            write!(output, "{}", struct_content).unwrap();
            write!(output, "}}\n\n").unwrap();
        }
        TypeKind::Union(union_type) => {
            // First, recursively handle nested types in union variants
            for variant in &union_type.variants {
                if is_nested_complex_type(&variant.variant_type) {
                    let nested_parent_name = format!("{}_{}_inner", parent_name, field_name);
                    collect_nested_type_definitions(
                        &nested_parent_name,
                        &variant.name,
                        &variant.variant_type,
                        parent_attributes,
                        output,
                    );
                }
            }

            // Then emit this union definition
            let inner_type_name = format!("{}_{}_inner", parent_name, field_name);
            let mut union_content = String::new();
            for variant in &union_type.variants {
                let escaped_name = escape_rust_keyword(&variant.name);
                let variant_type_str = if is_nested_complex_type(&variant.variant_type) {
                    format!("{}_{}_inner", inner_type_name, variant.name)
                } else {
                    format_type_to_rust(&variant.variant_type, INDENT_FIELD)
                };
                write!(
                    union_content,
                    "    pub {}: {},\n",
                    escaped_name, variant_type_str
                )
                .unwrap();
            }

            write!(output, "{}\n", emit_repr_attributes(parent_attributes)).unwrap();
            write!(output, "pub union {} {{\n", inner_type_name).unwrap();
            write!(output, "{}", union_content).unwrap();
            write!(output, "}}\n\n").unwrap();
        }
        TypeKind::Enum(enum_type) => {
            // First, recursively handle nested types in enum variants
            for variant in &enum_type.variants {
                if is_nested_complex_type(&variant.variant_type) {
                    let nested_parent_name = format!("{}_{}_inner", parent_name, field_name);
                    collect_nested_type_definitions(
                        &nested_parent_name,
                        &variant.name,
                        &variant.variant_type,
                        parent_attributes,
                        output,
                    );
                }
            }

            // Then emit this enum as a union definition
            let inner_type_name = format!("{}_{}_inner", parent_name, field_name);
            let mut union_content = String::new();
            for variant in &enum_type.variants {
                let escaped_name = escape_rust_keyword(&variant.name);
                let variant_type_str = if is_nested_complex_type(&variant.variant_type) {
                    format!("{}_{}_inner", inner_type_name, variant.name)
                } else {
                    format_type_to_rust(&variant.variant_type, INDENT_FIELD)
                };
                write!(
                    union_content,
                    "    pub {}: {},  // tag: {}\n",
                    escaped_name, variant_type_str, variant.tag_value
                )
                .unwrap();
            }

            write!(output, "{}\n", emit_repr_attributes(parent_attributes)).unwrap();
            write!(output, "pub union {} {{\n", inner_type_name).unwrap();
            write!(output, "{}", union_content).unwrap();
            write!(output, "}}\n\n").unwrap();
        }
        TypeKind::SizeDiscriminatedUnion(sdu_type) => {
            // Generate opaque wrappers for variant structs (if they are structs)
            // SDUs themselves are ghost fields - no union type needed
            for variant in &sdu_type.variants {
                if is_nested_complex_type(&variant.variant_type) {
                    let nested_parent_name = format!("{}_{}_inner", parent_name, field_name);
                    collect_nested_type_definitions(
                        &nested_parent_name,
                        &variant.name,
                        &variant.variant_type,
                        parent_attributes,
                        output,
                    );
                }
            }
            // No union type generation - SDU is a ghost field handled via accessor methods
        }
        _ => {}
    }
}

/* Helper function to format a field declaration, handling arrays and nested types */
fn format_field_declaration(field_name: &str, field_type: &TypeKind, indent: usize) -> String {
    let escaped_name = escape_rust_keyword(field_name);
    match field_type {
        TypeKind::Array(array_type) => {
            let size_expr = format_expr_to_rust(&array_type.size);
            format!(
                "{}: [{}; {}]",
                escaped_name,
                format_type_to_rust(&array_type.element_type, indent),
                size_expr
            )
        }
        _ => {
            format!(
                "{}: {}",
                escaped_name,
                format_type_to_rust(field_type, indent)
            )
        }
    }
}

/* Format field declaration with nested type handling for top-level structs */
fn format_field_declaration_with_nested(
    parent_name: &str,
    field_name: &str,
    field_type: &TypeKind,
    indent: usize,
) -> String {
    let escaped_name = escape_rust_keyword(field_name);
    match field_type {
        TypeKind::Array(array_type) => {
            let size_expr = format_expr_to_rust(&array_type.size);
            format!(
                "{}: [{}; {}]",
                escaped_name,
                format_type_to_rust(&array_type.element_type, indent),
                size_expr
            )
        }
        _ if is_nested_complex_type(field_type) => {
            // Reference the inner type that will be emitted separately
            format!("{}: {}_{}_inner", escaped_name, parent_name, field_name)
        }
        _ => {
            format!(
                "{}: {}",
                escaped_name,
                format_type_to_rust(field_type, indent)
            )
        }
    }
}

fn emit_anonymous_struct(struct_type: &crate::abi::types::StructType, indent: usize) -> String {
    let mut output = String::new();
    write!(output, "struct {{\n").unwrap();

    let base_indent = " ".repeat(indent);
    let field_indent = " ".repeat(indent + INDENT_BASE);

    for field in &struct_type.fields {
        let field_decl =
            format_field_declaration(&field.name, &field.field_type, indent + INDENT_BASE);
        write!(output, "{}{},\n", field_indent, field_decl).unwrap();
    }

    write!(output, "{}}}", base_indent).unwrap();
    output
}

fn emit_anonymous_union(union_type: &crate::abi::types::UnionType, indent: usize) -> String {
    let mut output = String::new();
    write!(output, "union {{\n").unwrap();

    let base_indent = " ".repeat(indent);
    let field_indent = " ".repeat(indent + INDENT_BASE);

    for variant in &union_type.variants {
        let variant_type_str = format_type_to_rust(&variant.variant_type, indent + INDENT_BASE);
        let escaped_name = escape_rust_keyword(&variant.name);
        write!(
            output,
            "{}{}: {},\n",
            field_indent, escaped_name, variant_type_str
        )
        .unwrap();
    }

    write!(output, "{}}}", base_indent).unwrap();
    output
}

fn emit_anonymous_enum(enum_type: &crate::abi::types::EnumType, indent: usize) -> String {
    // Generate a union with each enum variant as a member
    let mut output = String::new();
    write!(output, "union {{\n").unwrap();

    let base_indent = " ".repeat(indent);
    let field_indent = " ".repeat(indent + INDENT_BASE);

    for variant in &enum_type.variants {
        let variant_type_str = format_type_to_rust(&variant.variant_type, indent + INDENT_BASE);
        let escaped_name = escape_rust_keyword(&variant.name);
        write!(
            output,
            "{}{}: {}, /* tag: {} */\n",
            field_indent, escaped_name, variant_type_str, variant.tag_value
        )
        .unwrap();
    }

    write!(output, "{}}}", base_indent).unwrap();
    output
}

fn emit_anonymous_size_discriminated_union(
    sdu_type: &crate::abi::types::SizeDiscriminatedUnionType,
    indent: usize,
) -> String {
    let mut output = String::new();
    write!(output, "union {{\n").unwrap();

    let base_indent = " ".repeat(indent);
    let field_indent = " ".repeat(indent + INDENT_BASE);

    for variant in &sdu_type.variants {
        let variant_type_str = format_type_to_rust(&variant.variant_type, indent + INDENT_BASE);
        let escaped_name = escape_rust_keyword(&variant.name);
        write!(
            output,
            "{}{}: {}, /* expected size: {} */\n",
            field_indent, escaped_name, variant_type_str, variant.expected_size
        )
        .unwrap();
    }

    write!(output, "{}}}", base_indent).unwrap();
    output
}

/* Emit repr attributes based on container attributes */
fn emit_repr_attributes(container_attributes: &crate::abi::types::ContainerAttributes) -> String {
    let mut output = String::new();
    write!(output, "#[repr(C").unwrap();
    if container_attributes.packed {
        write!(output, ", packed").unwrap();
    }
    if container_attributes.aligned > 0 {
        write!(output, ", align({})", container_attributes.aligned).unwrap();
    }
    write!(output, ")]").unwrap();
    output
}

fn emit_container_definition(
    container_attributes: &crate::abi::types::ContainerAttributes,
    type_kind: &TypeKind,
    type_name: &str,
    content: &str,
) -> String {
    let mut output = String::new();

    // Add comment if present
    if let Some(comment) = &container_attributes.comment {
        write!(output, "/* COMMENT: {} */\n", comment).unwrap();
    }

    // Determine the type keyword
    let type_keyword = match type_kind {
        TypeKind::Struct(_) => "struct",
        TypeKind::Union(_) => "union",
        TypeKind::SizeDiscriminatedUnion(_) => "union",
        _ => "struct", // fallback
    };

    // Add repr attributes
    write!(output, "{}\n", emit_repr_attributes(container_attributes)).unwrap();

    write!(output, "pub {} {}_t", type_keyword, type_name).unwrap();

    write!(output, " {{\n").unwrap();
    write!(output, "{}", content).unwrap();
    write!(output, "}}\n\n").unwrap();

    output
}

pub fn emit_type_params(resolved_type: &ResolvedType, type_ir: &TypeIr) -> Option<String> {
    let bindings: Vec<_> = type_ir
        .parameters
        .iter()
        .filter(|param| !param.derived)
        .map(|param| {
            (
                param.name.clone(),
                escape_rust_keyword(&sanitize_param_name(&param.name)),
                param.description.clone(),
            )
        })
        .collect();
    if bindings.is_empty() {
        return None;
    }

    let mut output = String::new();
    writeln!(output, "#[allow(non_camel_case_types, non_snake_case)]").unwrap();
    writeln!(output, "#[derive(Clone, Debug, Default, PartialEq, Eq)]").unwrap();
    writeln!(output, "pub struct {}Params {{", resolved_type.name).unwrap();
    for (canonical, rust_name, doc) in &bindings {
        if let Some(desc) = doc {
            writeln!(output, "    /// {} (ABI path: {})", desc, canonical).unwrap();
        } else {
            writeln!(output, "    /// ABI path: {}", canonical).unwrap();
        }
        writeln!(output, "    pub {}: u64,", rust_name).unwrap();
    }
    writeln!(output, "}}\n").unwrap();

    let params_signature = bindings
        .iter()
        .map(|(_, rust_name, _)| format!("{}: u64", rust_name))
        .collect::<Vec<_>>()
        .join(", ");

    writeln!(output, "impl {}Params {{", resolved_type.name).unwrap();
    writeln!(output, "    pub fn from_values({}) -> Self {{", params_signature).unwrap();
    writeln!(output, "        Self {{").unwrap();
    for (_, rust_name, _) in &bindings {
        writeln!(output, "            {},", rust_name).unwrap();
    }
    writeln!(output, "        }}").unwrap();
    writeln!(output, "    }}\n").unwrap();

    // Generate from_map method that takes a generic parameter map
    writeln!(output, "    /// Create params from a map of parameter names to values.").unwrap();
    writeln!(output, "    /// Returns None if any required parameter is missing.").unwrap();
    writeln!(output, "    pub fn from_map<S: ::std::borrow::Borrow<str>>(map: &::std::collections::BTreeMap<S, u64>) -> Option<Self> {{").unwrap();
    writeln!(output, "        Some(Self {{").unwrap();
    for (canonical, rust_name, _) in &bindings {
        writeln!(
            output,
            "            {}: *map.iter().find(|(k, _)| k.borrow() == \"{}\").map(|(_, v)| v)?,",
            rust_name, canonical
        )
        .unwrap();
    }
    writeln!(output, "        }})").unwrap();
    writeln!(output, "    }}").unwrap();
    writeln!(output, "}}\n").unwrap();

    Some(output)
}

pub fn emit_type(type_def: &TypeDef) -> String {
    let mut output = String::new();

    match &type_def.kind {
        TypeKind::Struct(struct_type) => {
            // First, recursively emit all nested type definitions
            for field in &struct_type.fields {
                /* Skip enum fields - they don't need nested type definitions */
                if matches!(&field.field_type, TypeKind::Enum(_)) {
                    continue;
                }
                if is_nested_complex_type(&field.field_type) {
                    collect_nested_type_definitions(
                        &type_def.name,
                        &field.name,
                        &field.field_type,
                        &struct_type.container_attributes,
                        &mut output,
                    );
                }
            }

            // Emit opaque byte slice wrapper instead of packed struct
            write!(output, "/* Type: {} */\n", type_def.name).unwrap();

            if let Some(comment) = &struct_type.container_attributes.comment {
                write!(output, "/* {} */\n", comment).unwrap();
            }

            // Immutable wrapper
            write!(output, "#[allow(non_camel_case_types, non_snake_case)]\n").unwrap();
            write!(output, "#[derive(Copy, Clone)]\n").unwrap();
            write!(output, "pub struct {}<'a> {{\n", type_def.name).unwrap();
            write!(output, "    data: &'a [u8],\n").unwrap();
            write!(output, "}}\n\n").unwrap();

            // Mutable wrapper
            write!(output, "#[allow(non_camel_case_types, non_snake_case)]\n").unwrap();
            write!(output, "pub struct {}Mut<'a> {{\n", type_def.name).unwrap();
            write!(output, "    data: &'a mut [u8],\n").unwrap();
            write!(output, "}}\n\n").unwrap();
        }
        TypeKind::Union(union_type) => {
            let mut union_content = String::new();

            // Add union variants
            for variant in &union_type.variants {
                let escaped_name = escape_rust_keyword(&variant.name);
                write!(
                    union_content,
                    "    pub {}: {},\n",
                    escaped_name,
                    format_type_to_rust(&variant.variant_type, INDENT_FIELD)
                )
                .unwrap();
            }

            output.push_str(&emit_container_definition(
                &union_type.container_attributes,
                &type_def.kind,
                &type_def.name,
                &union_content,
            ));
        }
        TypeKind::Enum(enum_type) => {
            // Add enum header comment
            write!(
                output,
                "/* VARIANTS FOR: {} */\n",
                type_def.name.to_uppercase()
            )
            .unwrap();

            // Add comment if present
            if let Some(comment) = &enum_type.container_attributes.comment {
                write!(output, "/* COMMENT: {} */\n", comment).unwrap();
            }

            // Add const statements for enum variants
            for variant in &enum_type.variants {
                write!(
                    output,
                    "pub const ENUM_{}_{}: u64 = {};\n",
                    type_def.name.to_uppercase(),
                    variant.name.to_uppercase(),
                    variant.tag_value
                )
                .unwrap();
            }
            write!(output, "\n").unwrap();
        }
        TypeKind::Array(array_type) => {
            let mut array_content = String::new();
            let size_expr = format_expr_to_rust(&array_type.size);
            write!(
                array_content,
                "    pub data: [{}; {}],\n",
                format_type_to_rust(&array_type.element_type, INDENT_FIELD),
                size_expr
            )
            .unwrap();

            output.push_str(&emit_container_definition(
                &array_type.container_attributes,
                &type_def.kind,
                &type_def.name,
                &array_content,
            ));
        }
        TypeKind::SizeDiscriminatedUnion(sdu_type) => {
            let mut sdu_content = String::new();

            // Add compile-time guards
            write!(output, "// Compile-time guards\n").unwrap();
            for variant in &sdu_type.variants {
                let type_name = match &variant.variant_type {
                    TypeKind::TypeRef(type_ref) => format!("{}_t", type_ref.name),
                    _ => format!("{}", variant.name), // fallback for non-TypeRef variants
                };
                write!(
                    output,
                    "const _: () = assert!(std::mem::size_of::<{}>() == {});\n",
                    type_name, variant.expected_size
                )
                .unwrap();
            }
            write!(output, "\n").unwrap();

            // Add tag constants for each variant (0-indexed)
            write!(
                output,
                "/* TAG CONSTANTS FOR SIZE-DISCRIMINATED UNION: {} */\n",
                type_def.name.to_uppercase()
            )
            .unwrap();
            for (idx, variant) in sdu_type.variants.iter().enumerate() {
                write!(
                    output,
                    "pub const {}_TAG_{}: u8 = {};\n",
                    type_def.name.to_uppercase(),
                    variant.name.to_uppercase(),
                    idx
                )
                .unwrap();
            }
            write!(output, "\n").unwrap();

            // Add union variants
            for variant in &sdu_type.variants {
                let escaped_name = escape_rust_keyword(&variant.name);
                write!(
                    sdu_content,
                    "    pub {}: {}, /* expected size: {} */\n",
                    escaped_name,
                    format_type_to_rust(&variant.variant_type, INDENT_FIELD),
                    variant.expected_size
                )
                .unwrap();
            }

            output.push_str(&emit_container_definition(
                &sdu_type.container_attributes,
                &type_def.kind,
                &type_def.name,
                &sdu_content,
            ));
        }
        _ => {
            write!(output, "Invalid TypeKind").unwrap();
        }
    }

    output
}
