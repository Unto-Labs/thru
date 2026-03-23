use super::helpers::{
    escape_ts_keyword, primitive_size, primitive_to_dataview_setter, primitive_to_ts_return_type,
};
use crate::abi::expr::{ConstantExpression, ExprKind};
use crate::abi::resolved::{ResolvedType, ResolvedTypeKind, Size};
use crate::codegen::shared::ir::TypeIr;
use std::collections::HashSet;
use std::fmt::Write;

/* Helper to extract all field references from an expression recursively */
fn extract_field_refs(expr: &ExprKind, refs: &mut HashSet<String>) {
    match expr {
        ExprKind::FieldRef(field_ref) => {
            refs.insert(field_ref.path.join("_"));
        }
        /* Binary operations - extract from both sides */
        ExprKind::Add(e) => {
            extract_field_refs(&e.left, refs);
            extract_field_refs(&e.right, refs);
        }
        ExprKind::Sub(e) => {
            extract_field_refs(&e.left, refs);
            extract_field_refs(&e.right, refs);
        }
        ExprKind::Mul(e) => {
            extract_field_refs(&e.left, refs);
            extract_field_refs(&e.right, refs);
        }
        ExprKind::Div(e) => {
            extract_field_refs(&e.left, refs);
            extract_field_refs(&e.right, refs);
        }
        ExprKind::Mod(e) => {
            extract_field_refs(&e.left, refs);
            extract_field_refs(&e.right, refs);
        }
        ExprKind::Pow(e) => {
            extract_field_refs(&e.left, refs);
            extract_field_refs(&e.right, refs);
        }
        ExprKind::BitAnd(e) => {
            extract_field_refs(&e.left, refs);
            extract_field_refs(&e.right, refs);
        }
        ExprKind::BitOr(e) => {
            extract_field_refs(&e.left, refs);
            extract_field_refs(&e.right, refs);
        }
        ExprKind::BitXor(e) => {
            extract_field_refs(&e.left, refs);
            extract_field_refs(&e.right, refs);
        }
        ExprKind::LeftShift(e) => {
            extract_field_refs(&e.left, refs);
            extract_field_refs(&e.right, refs);
        }
        ExprKind::RightShift(e) => {
            extract_field_refs(&e.left, refs);
            extract_field_refs(&e.right, refs);
        }
        /* Unary operations - extract from operand */
        ExprKind::BitNot(e) => {
            extract_field_refs(&e.operand, refs);
        }
        ExprKind::Neg(e) => {
            extract_field_refs(&e.operand, refs);
        }
        ExprKind::Not(e) => {
            extract_field_refs(&e.operand, refs);
        }
        ExprKind::Popcount(e) => {
            extract_field_refs(&e.operand, refs);
        }
        _ => {} /* Literals, sizeof, alignof don't reference fields */
    }
}

/* Emit the static new() method for a type */

pub fn emit_new_method(resolved_type: &ResolvedType, type_ir: Option<&TypeIr>) -> String {
    match &resolved_type.kind {
        ResolvedTypeKind::Struct { .. } => {
            let has_dynamic_ir =
                type_ir.map_or(false, |ir| ir.parameters.iter().any(|param| !param.derived));
            if has_dynamic_ir || !matches!(resolved_type.size, Size::Const(_)) {
                return String::new();
            }
            emit_struct_new_method(resolved_type)
        }
        ResolvedTypeKind::Enum { .. } => String::new(),
        ResolvedTypeKind::Union { .. } => emit_union_new_method(resolved_type),
        _ => String::new(),
    }
}

/* Emit new() method for structs */
fn emit_struct_new_method(resolved_type: &ResolvedType) -> String {
    let mut output = String::new();
    let class_name = &resolved_type.name;

    let ResolvedTypeKind::Struct { fields, .. } = &resolved_type.kind else {
        return String::new();
    };
    let Size::Const(struct_size) = resolved_type.size else {
        return String::new();
    };

    if fields
        .iter()
        .any(|field| !matches!(field.field_type.kind, ResolvedTypeKind::Primitive { .. }))
    {
        return String::new();
    }

    /* Build parameter list */
    let mut params: Vec<String> = Vec::new();
    for field in fields {
        let escaped_name = escape_ts_keyword(&field.name);
        if let ResolvedTypeKind::Primitive { prim_type } = &field.field_type.kind {
            let ts_type = primitive_to_ts_return_type(prim_type);
            params.push(format!("{}: {}", escaped_name, ts_type));
        }
    }

    /* Generate method signature */
    write!(
        output,
        "  static new({}): {} {{\n",
        params.join(", "),
        class_name
    )
    .unwrap();

    write!(
        output,
        "    const buffer = new Uint8Array({});\n",
        struct_size
    )
    .unwrap();
    write!(output, "    const view = new DataView(buffer.buffer);\n\n").unwrap();

    write!(output, "    let offset = 0;\n").unwrap();
    let mut offset: u64 = 0;

    for field in fields {
        let escaped_name = escape_ts_keyword(&field.name);
        if let ResolvedTypeKind::Primitive { prim_type } = &field.field_type.kind {
            let setter = primitive_to_dataview_setter(prim_type);
            let needs_le = primitive_size(prim_type) > 1;
            if needs_le {
                write!(
                    output,
                    "    view.{}({}, {}, true); /* {} (little-endian) */\n",
                    setter, offset, escaped_name, field.name
                )
                .unwrap();
            } else {
                write!(
                    output,
                    "    view.{}({}, {}); /* {} */\n",
                    setter, offset, escaped_name, field.name
                )
                .unwrap();
            }
            if let Size::Const(field_size) = field.field_type.size {
                offset += field_size;
            }
        }
    }

    write!(output, "\n    return new {}(buffer);\n", class_name).unwrap();
    write!(output, "  }}\n\n").unwrap();

    output
}

/* Emit new() method for unions */
fn emit_union_new_method(resolved_type: &ResolvedType) -> String {
    let mut output = String::new();
    let class_name = &resolved_type.name;

    if let ResolvedTypeKind::Union { variants } = &resolved_type.kind {
        /* Emit separate new methods for each variant */
        for variant in variants {
            let variant_name = escape_ts_keyword(&variant.name);

            match &variant.field_type.kind {
                ResolvedTypeKind::Primitive { prim_type } => {
                    let ts_type = primitive_to_ts_return_type(prim_type);
                    write!(
                        output,
                        "  static new_{}(value: {}): {} {{\n",
                        variant_name, ts_type, class_name
                    )
                    .unwrap();

                    if let Size::Const(size) = resolved_type.size {
                        write!(output, "    const buffer = new Uint8Array({});\n", size).unwrap();
                        write!(output, "    const view = new DataView(buffer.buffer);\n").unwrap();

                        let setter = primitive_to_dataview_setter(prim_type);
                        let needs_le = primitive_size(prim_type) > 1;

                        if needs_le {
                            write!(output, "    view.{}(0, value, true);\n", setter).unwrap();
                        } else {
                            write!(output, "    view.{}(0, value);\n", setter).unwrap();
                        }

                        write!(output, "    return new {}(buffer);\n", class_name).unwrap();
                    }

                    write!(output, "  }}\n\n").unwrap();
                }
                _ => {}
            }
        }
    }

    output
}
