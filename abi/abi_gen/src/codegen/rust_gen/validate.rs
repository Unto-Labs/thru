/* Validation function generation for Rust ABI code */

use super::helpers::{format_type_to_rust, generate_nested_field_access};
use crate::abi::resolved::{ResolvedType, ResolvedTypeKind, Size};
use std::fmt::Write;

pub fn emit_validate_fn(resolved_type: &ResolvedType) -> String {
    match &resolved_type.kind {
        ResolvedTypeKind::Struct { .. } => emit_validate_fn_struct(resolved_type),
        ResolvedTypeKind::Enum { .. } => emit_validate_fn_enum(resolved_type),
        _ => String::new(),
    }
}

fn emit_validate_fn_struct(resolved_type: &ResolvedType) -> String {
    let mut output = String::new();
    let type_name = &resolved_type.name;

    write!(
        output,
        "pub fn {}_validate(buffer: &[u8]) -> Result<(), &'static str> {{\n",
        type_name
    )
    .unwrap();

    /* Check minimum size */
    write!(output, "    /* Check minimum buffer size */\n").unwrap();
    write!(
        output,
        "    if buffer.len() < std::mem::size_of::<{}_t>() {{\n",
        type_name
    )
    .unwrap();
    write!(
        output,
        "        return Err(\"buffer too small for struct header\");\n"
    )
    .unwrap();
    write!(output, "    }}\n\n").unwrap();

    if let ResolvedTypeKind::Struct { fields, .. } = &resolved_type.kind {
        let has_fams = fields
            .iter()
            .any(|f| matches!(f.field_type.size, Size::Variable(_)));

        if has_fams {
            write!(output, "    /* Validate FAM sizes */\n").unwrap();
            write!(
                output,
                "    let ptr = buffer.as_ptr() as *const {}_t;\n",
                type_name
            )
            .unwrap();
            write!(
                output,
                "    let mut offset: u64 = std::mem::size_of::<{}_t>() as u64;\n",
                type_name
            )
            .unwrap();

            for field in fields {
                if let Size::Variable(var_refs) = &field.field_type.size {
                    /* Read field references */
                    for (field_ref_path, prim_type) in var_refs.values().flat_map(|m| m.iter()) {
                        output.push_str(&generate_nested_field_access(
                            field_ref_path,
                            type_name,
                            prim_type,
                        ));
                    }

                    /* Calculate expected size for this FAM */
                    match &field.field_type.kind {
                        ResolvedTypeKind::Array { element_type, .. } => {
                            if let Some(var_map) = var_refs.values().next() {
                                if let Some((first_ref, _)) = var_map.iter().next() {
                                    let size_var = first_ref.replace('.', "_");

                                    /* Check for overflow */
                                    write!(output, "    if {} < 0 {{\n", size_var).unwrap();
                                    write!(
                                        output,
                                        "        return Err(\"FAM size cannot be negative\");\n"
                                    )
                                    .unwrap();
                                    write!(output, "    }}\n").unwrap();

                                    match &element_type.size {
                                        Size::Const(elem_size) => {
                                            write!(
                                                output,
                                                "    let fam_size = ({} as u64).checked_mul({})\n",
                                                size_var, elem_size
                                            )
                                            .unwrap();
                                            write!(
                                                output,
                                                "        .ok_or(\"FAM size overflow\")?;\n"
                                            )
                                            .unwrap();
                                            write!(
                                                output,
                                                "    offset = offset.checked_add(fam_size)\n"
                                            )
                                            .unwrap();
                                            write!(
                                                output,
                                                "        .ok_or(\"offset overflow\")?;\n"
                                            )
                                            .unwrap();
                                        }
                                        Size::Variable(_) => {
                                            /* Multi-dimensional FAM */
                                            write!(
                                                output,
                                                "    let elem_size = {}_footprint({});\n",
                                                format_type_to_rust(element_type),
                                                size_var
                                            )
                                            .unwrap();
                                            write!(output, "    let fam_size = ({} as u64).checked_mul(elem_size)\n", size_var).unwrap();
                                            write!(
                                                output,
                                                "        .ok_or(\"FAM size overflow\")?;\n"
                                            )
                                            .unwrap();
                                            write!(
                                                output,
                                                "    offset = offset.checked_add(fam_size)\n"
                                            )
                                            .unwrap();
                                            write!(
                                                output,
                                                "        .ok_or(\"offset overflow\")?;\n"
                                            )
                                            .unwrap();
                                        }
                                    }
                                }
                            }
                        }
                        _ => {
                            /* Non-array FAM (variable-sized nested type) */
                            let field_refs: Vec<String> = var_refs
                                .values()
                                .flat_map(|refs| refs.keys().map(|r| r.replace('.', "_")))
                                .collect();

                            if field_refs.is_empty() {
                                write!(
                                    output,
                                    "    let field_size = {}_footprint();\n",
                                    format_type_to_rust(&field.field_type)
                                )
                                .unwrap();
                            } else {
                                write!(
                                    output,
                                    "    let field_size = {}_footprint({});\n",
                                    format_type_to_rust(&field.field_type),
                                    field_refs.join(", ")
                                )
                                .unwrap();
                            }

                            write!(output, "    offset = offset.checked_add(field_size)\n")
                                .unwrap();
                            write!(output, "        .ok_or(\"offset overflow\")?;\n").unwrap();
                        }
                    }
                }
            }

            /* Final buffer size check */
            write!(
                output,
                "\n    /* Verify buffer is large enough for all FAMs */\n"
            )
            .unwrap();
            write!(output, "    if (buffer.len() as u64) < offset {{\n").unwrap();
            write!(
                output,
                "        return Err(\"buffer too small for FAM data\");\n"
            )
            .unwrap();
            write!(output, "    }}\n\n").unwrap();
        }

        /* Validate nested fields */
        write!(output, "    /* Validate nested fields */\n").unwrap();
        for field in fields {
            match &field.field_type.kind {
                ResolvedTypeKind::Struct { .. } | ResolvedTypeKind::TypeRef { .. } => {
                    if matches!(field.field_type.size, Size::Const(_)) {
                        /* Constant-sized nested type - validate it */
                        write!(output, "    {{\n").unwrap();
                        write!(
                            output,
                            "        let field_offset = std::mem::offset_of!({}_t, {});\n",
                            type_name, field.name
                        )
                        .unwrap();
                        write!(
                            output,
                            "        let field_slice = &buffer[field_offset..];\n"
                        )
                        .unwrap();
                        write!(
                            output,
                            "        {}_validate(field_slice)?;\n",
                            format_type_to_rust(&field.field_type)
                        )
                        .unwrap();
                        write!(output, "    }}\n").unwrap();
                    }
                }
                _ => {}
            }
        }
    }

    write!(output, "\n    Ok(())\n").unwrap();
    write!(output, "}}\n\n").unwrap();

    output
}

fn emit_validate_fn_enum(resolved_type: &ResolvedType) -> String {
    let mut output = String::new();
    let type_name = &resolved_type.name;

    if let ResolvedTypeKind::Enum {
        variants,
        tag_expression,
        ..
    } = &resolved_type.kind
    {
        write!(
            output,
            "pub fn {}_validate(buffer: &[u8]) -> Result<(), &'static str> {{\n",
            type_name
        )
        .unwrap();

        /* Check minimum size */
        write!(output, "    /* Check minimum buffer size */\n").unwrap();
        write!(
            output,
            "    if buffer.len() < std::mem::size_of::<{}_t>() {{\n",
            type_name
        )
        .unwrap();
        write!(
            output,
            "        return Err(\"buffer too small for enum\");\n"
        )
        .unwrap();
        write!(output, "    }}\n\n").unwrap();

        /* Read and validate tag */
        write!(output, "    /* Validate tag value */\n").unwrap();

        /* Extract tag field path */
        if let crate::abi::expr::ExprKind::FieldRef(field_ref) = tag_expression {
            let tag_path = field_ref.path.join(".");
            write!(output, "    let ptr = buffer.as_ptr();\n").unwrap();
            write!(output, "    let tag = unsafe {{\n").unwrap();
            write!(output, "        /* Read tag from parent structure */\n").unwrap();
            write!(
                output,
                "        /* TODO: Proper tag reading based on path: {} */\n",
                tag_path
            )
            .unwrap();
            write!(output, "        0u64  /* Placeholder */\n").unwrap();
            write!(output, "    }};\n\n").unwrap();
        }

        write!(output, "    /* Check tag is valid */\n").unwrap();
        write!(output, "    match tag {{\n").unwrap();

        for variant in variants {
            write!(output, "        {} => Ok(()),\n", variant.tag_value).unwrap();
        }

        write!(output, "        _ => Err(\"invalid enum tag value\"),\n").unwrap();
        write!(output, "    }}\n").unwrap();
        write!(output, "}}\n\n").unwrap();
    }

    output
}
