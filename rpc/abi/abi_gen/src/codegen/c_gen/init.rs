use super::helpers::{
    escape_c_keyword, format_expr_to_c, format_type_to_c, is_nested_complex_type,
    primitive_to_c_type, sanitize_type_name,
};
use crate::abi::resolved::{ResolvedType, ResolvedTypeKind, Size};
use std::fmt::Write;

fn emit_init_fn_struct(resolved_type: &ResolvedType) -> String {
    let mut output = String::new();
    let type_name = sanitize_type_name(&resolved_type.name);

    let fields = if let ResolvedTypeKind::Struct { fields, .. } = &resolved_type.kind {
        fields
    } else {
        return output;
    };

    #[derive(Clone)]
    enum FieldInitKind {
        Primitive {
            size_expr: String,
        },
        Array {
            len_name: String,
            elem_size_expr: String,
        },
        ConstPointer {
            size_expr: String,
        },
        VarPointer {
            size_param_name: String,
        },
    }

    struct FieldInitInfo {
        raw_name: String,
        param_name: String,
        init_kind: FieldInitKind,
        is_fam: bool,
    }

    let mut field_param_lines: Vec<String> = Vec::new();
    let mut field_infos: Vec<FieldInitInfo> = Vec::new();

    for (_idx, field) in fields.iter().enumerate() {
        let param_name = escape_c_keyword(&field.name);
        let is_fam = matches!(&field.field_type.size, Size::Variable(_));

        /* Skip enum fields in init - they don't have actual struct fields and are initialized separately */
        if matches!(&field.field_type.kind, ResolvedTypeKind::Enum { .. }) {
            continue;
        }

        match &field.field_type.kind {
            ResolvedTypeKind::Primitive { prim_type } => {
                let type_str = primitive_to_c_type(prim_type).to_string();
                field_param_lines.push(format!("{} {}", type_str, param_name.clone()));
                field_infos.push(FieldInitInfo {
                    raw_name: field.name.clone(),
                    param_name: param_name.clone(),
                    init_kind: FieldInitKind::Primitive {
                        size_expr: format!("sizeof( {} )", type_str),
                    },
                    is_fam,
                });
            }
            ResolvedTypeKind::Array { element_type, .. } => {
                let len_name = format!("{}_len", param_name);
                let mut element_param_type = format_type_to_c(element_type);
                if is_nested_complex_type(element_type) {
                    element_param_type = format!("{}_{}_inner_t", type_name, field.name);
                }

                field_param_lines.push(format!(
                    "{} const * {}, uint64_t {}",
                    element_param_type,
                    param_name.clone(),
                    len_name.clone()
                ));

                field_infos.push(FieldInitInfo {
                    raw_name: field.name.clone(),
                    param_name: param_name.clone(),
                    init_kind: FieldInitKind::Array {
                        len_name,
                        elem_size_expr: format!("sizeof( {} )", element_param_type),
                    },
                    is_fam,
                });
            }
            _ => {
                /* Handles TypeRef, inline structs, unions, enums, etc. */

                /* Special handling for enums: they're just raw variant bytes */
                if matches!(&field.field_type.kind, ResolvedTypeKind::Enum { .. }) {
                    /* Enum fields are always variable-sized (accept void const * + size) */
                    let size_param_name = format!("{}_sz", param_name);
                    field_param_lines.push(format!(
                        "void const * {}, uint64_t {}",
                        param_name.clone(),
                        size_param_name.clone()
                    ));
                    field_infos.push(FieldInitInfo {
                        raw_name: field.name.clone(),
                        param_name: param_name.clone(),
                        init_kind: FieldInitKind::VarPointer { size_param_name },
                        is_fam: true, /* Enums are treated like FAMs */
                    });
                } else {
                    /* Regular complex types (TypeRef, Union, etc.) */
                    let mut pointer_type = format_type_to_c(&field.field_type);
                    if is_nested_complex_type(&field.field_type) {
                        pointer_type = format!("{}_{}_inner_t", type_name, field.name);
                    }

                    /* Check if this field is variable-sized (FAM) */
                    if is_fam {
                        /* Variable-sized: need explicit size parameter */
                        let size_param_name = format!("{}_sz", param_name);
                        field_param_lines.push(format!(
                            "{} const * {}, uint64_t {}",
                            pointer_type,
                            param_name.clone(),
                            size_param_name.clone()
                        ));
                        field_infos.push(FieldInitInfo {
                            raw_name: field.name.clone(),
                            param_name: param_name.clone(),
                            init_kind: FieldInitKind::VarPointer { size_param_name },
                            is_fam,
                        });
                    } else {
                        /* Constant-sized: use sizeof */
                        field_param_lines.push(format!(
                            "{} const * {}",
                            pointer_type,
                            param_name.clone()
                        ));
                        field_infos.push(FieldInitInfo {
                            raw_name: field.name.clone(),
                            param_name: param_name.clone(),
                            init_kind: FieldInitKind::ConstPointer {
                                size_expr: format!("sizeof( {} )", pointer_type),
                            },
                            is_fam,
                        });
                    }
                }
            }
        }
    }

    if field_param_lines.is_empty() {
        write!(
            output,
            "int {}_init( void * buffer, uint64_t buf_sz ) {{\n",
            type_name
        )
        .unwrap();
    } else {
        write!(
            output,
            "int {}_init( void * buffer, uint64_t buf_sz,\n",
            type_name
        )
        .unwrap();
        for (idx, line) in field_param_lines.iter().enumerate() {
            let suffix = if idx + 1 == field_param_lines.len() {
                "\n"
            } else {
                ",\n"
            };
            write!(output, "  {}{}", line, suffix).unwrap();
        }
        write!(output, ") {{\n").unwrap();
    }

    write!(output, "  if( sizeof( {}_t ) > buf_sz ) {{\n", type_name).unwrap();
    write!(output, "    return -1; /* Buffer too small */\n").unwrap();
    write!(output, "  }}\n").unwrap();

    let mut after_variable_size_data = false;
    for info in &field_infos {
        if info.is_fam && !after_variable_size_data {
            after_variable_size_data = true;
            write!(output, "  /* VERIFYING SIZE */\n").unwrap();
            write!(
                output,
                "  uint64_t offset = offsetof( {}_t, {} );\n",
                type_name, info.raw_name
            )
            .unwrap();
        }
        if !after_variable_size_data {
            continue;
        }
        match &info.init_kind {
            FieldInitKind::Primitive { size_expr } => {
                let field_size = format!("(uint64_t)({})", size_expr);
                write!(output, "  {{  /* field: {} */\n", info.raw_name).unwrap();
                write!(output, "    uint64_t field_bytes = {};\n", field_size).unwrap();
                write!(
                    output,
                    "    if( safe_add_u64( offset, field_bytes, &offset ) ) return -1;\n"
                )
                .unwrap();
                write!(output, "  }}\n").unwrap();
            }
            FieldInitKind::Array {
                len_name,
                elem_size_expr,
            } => {
                let elem_size = format!("(uint64_t)({})", elem_size_expr);
                write!(output, "  {{  /* field: {} */\n", info.raw_name).unwrap();
                write!(output, "    uint64_t elem_size = {};\n", elem_size).unwrap();
                write!(output, "    uint64_t field_bytes = 0;\n").unwrap();
                write!(
                    output,
                    "    if( safe_mul_u64( elem_size, {}, &field_bytes ) ) return -1;\n",
                    len_name
                )
                .unwrap();
                write!(
                    output,
                    "    if( safe_add_u64( offset, field_bytes, &offset ) ) return -1;\n"
                )
                .unwrap();
                write!(output, "  }}\n").unwrap();
            }
            FieldInitKind::ConstPointer { size_expr } => {
                let field_size = format!("(uint64_t)({})", size_expr);
                write!(output, "  {{  /* field: {} */\n", info.raw_name).unwrap();
                write!(output, "    uint64_t field_bytes = {};\n", field_size).unwrap();
                write!(
                    output,
                    "    if( safe_add_u64( offset, field_bytes, &offset ) ) return -1;\n"
                )
                .unwrap();
                write!(output, "  }}\n").unwrap();
            }
            FieldInitKind::VarPointer { size_param_name } => {
                write!(
                    output,
                    "  {{  /* field: {} (variable-sized) */\n",
                    info.raw_name
                )
                .unwrap();
                write!(output, "    uint64_t field_bytes = {};\n", size_param_name).unwrap();
                write!(
                    output,
                    "    if( safe_add_u64( offset, field_bytes, &offset ) ) return -1;\n"
                )
                .unwrap();
                write!(output, "  }}\n").unwrap();
            }
        }
        write!(output, "  if( offset > buf_sz ) return -1;\n").unwrap();
    }

    /* Pre-compute which fields come after variable-size data by scanning original fields list */
    let mut has_variable_size_data = false;
    let mut first_variable_size_is_enum = false;
    for field in fields {
        if matches!(&field.field_type.size, Size::Variable(_)) {
            if !has_variable_size_data {
                has_variable_size_data = true;
                first_variable_size_is_enum =
                    matches!(&field.field_type.kind, ResolvedTypeKind::Enum { .. });
            }
            break;
        }
    }

    after_variable_size_data = false;
    write!(output, "  /* SETTING FIELD VALUES */\n").unwrap();
    write!(
        output,
        "  {}_t * self = ({}_t *)buffer;\n",
        type_name, type_name
    )
    .unwrap();

    for info in field_infos.iter() {
        if info.is_fam && !after_variable_size_data {
            after_variable_size_data = true;
            /* For enum fields, calculate offset as sizeof(struct) since enum body is not in the struct */
            if first_variable_size_is_enum {
                write!(output, "  uint64_t offset = sizeof( {}_t );\n", type_name).unwrap();
            } else {
                write!(
                    output,
                    "  uint64_t offset = offsetof( {}_t, {} );\n",
                    type_name, info.raw_name
                )
                .unwrap();
            }
        } else if has_variable_size_data && !after_variable_size_data {
            /* We haven't hit a FAM in field_infos yet, but we know there's variable-size data in the original fields (probably an enum) */
            after_variable_size_data = true;
            /* For enum fields, calculate offset as sizeof(struct) since enum body is not in the struct */
            if first_variable_size_is_enum {
                write!(output, "  uint64_t offset = sizeof( {}_t );\n", type_name).unwrap();
            }
        }
        match &info.init_kind {
            FieldInitKind::Primitive { size_expr } => {
                let field_size = format!("(uint64_t)({})", size_expr);
                if after_variable_size_data {
                    write!(output, "  {{  /* field: {} */\n", info.raw_name).unwrap();
                    write!(output, "    uint64_t field_bytes = {};\n", field_size).unwrap();
                    write!(
                        output,
                        "    memcpy( (unsigned char *)self + offset, &{}, field_bytes );\n",
                        info.param_name
                    )
                    .unwrap();
                    write!(output, "    offset += field_bytes;\n").unwrap();
                    write!(output, "  }}\n").unwrap();
                } else {
                    write!(
                        output,
                        "  memcpy( &self->{}, &{}, {} ); // field: {}\n",
                        info.raw_name, info.param_name, field_size, info.raw_name
                    )
                    .unwrap();
                }
            }
            FieldInitKind::Array {
                len_name,
                elem_size_expr,
            } => {
                let elem_size = format!("(uint64_t)({})", elem_size_expr);
                if after_variable_size_data {
                    write!(output, "  {{  /* field: {} */\n", info.raw_name).unwrap();
                    write!(output, "    uint64_t elem_size = {};\n", elem_size).unwrap();
                    write!(output, "    uint64_t field_bytes = 0;\n").unwrap();
                    write!(
                        output,
                        "    if( safe_mul_u64( elem_size, {}, &field_bytes ) ) return -1;\n",
                        len_name
                    )
                    .unwrap();
                    write!(
                        output,
                        "    memcpy( (unsigned char *)self + offset, {}, field_bytes );\n",
                        info.param_name
                    )
                    .unwrap();
                    write!(output, "    offset += field_bytes;\n").unwrap();
                    write!(output, "  }}\n").unwrap();
                } else {
                    write!(output, "  {{  /* field: {} */\n", info.raw_name).unwrap();
                    write!(output, "    uint64_t elem_size = {};\n", elem_size).unwrap();
                    write!(output, "    uint64_t field_bytes = 0;\n").unwrap();
                    write!(
                        output,
                        "    if( safe_mul_u64( elem_size, {}, &field_bytes ) ) return -1;\n",
                        len_name
                    )
                    .unwrap();
                    write!(
                        output,
                        "    memcpy( self->{}, {}, field_bytes );\n",
                        info.raw_name, info.param_name
                    )
                    .unwrap();
                    write!(output, "  }}\n").unwrap();
                }
            }
            FieldInitKind::ConstPointer { size_expr } => {
                let field_size = format!("(uint64_t)({})", size_expr);
                if after_variable_size_data {
                    write!(output, "  {{  /* field: {} */\n", info.raw_name).unwrap();
                    write!(output, "    uint64_t field_bytes = {};\n", field_size).unwrap();
                    write!(
                        output,
                        "    memcpy( (unsigned char *)self + offset, {}, field_bytes );\n",
                        info.param_name
                    )
                    .unwrap();
                    write!(output, "    offset += field_bytes;\n").unwrap();
                    write!(output, "  }}\n").unwrap();
                } else {
                    write!(
                        output,
                        "  memcpy( &self->{}, {}, {} ); // field: {}\n",
                        info.raw_name, info.param_name, field_size, info.raw_name
                    )
                    .unwrap();
                }
            }
            FieldInitKind::VarPointer { size_param_name } => {
                if after_variable_size_data {
                    write!(
                        output,
                        "  {{  /* field: {} (variable-sized) */\n",
                        info.raw_name
                    )
                    .unwrap();
                    write!(output, "    uint64_t field_bytes = {};\n", size_param_name).unwrap();
                    write!(
                        output,
                        "    memcpy( (unsigned char *)self + offset, {}, field_bytes );\n",
                        info.param_name
                    )
                    .unwrap();
                    write!(output, "    offset += field_bytes;\n").unwrap();
                    write!(output, "  }}\n").unwrap();
                } else {
                    write!(
                        output,
                        "  memcpy( &self->{}, {}, {} ); // field: {} (variable-sized)\n",
                        info.raw_name, info.param_name, size_param_name, info.raw_name
                    )
                    .unwrap();
                }
            }
        }
    }

    write!(
        output,
        "  int err = {}_validate( buffer, buf_sz, NULL );\n",
        type_name
    )
    .unwrap();
    write!(output, "  if( err ) return err;\n").unwrap();
    write!(output, "  return 0;\n").unwrap();
    write!(output, "}}\n\n").unwrap();

    output
}

fn emit_init_fn_union(resolved_type: &ResolvedType) -> String {
    let mut output = String::new();
    let type_name = sanitize_type_name(&resolved_type.name);

    let variants = match &resolved_type.kind {
        ResolvedTypeKind::Union { variants } => variants,
        _ => return output,
    };

    for variant in variants {
        let escaped_variant = escape_c_keyword(&variant.name);

        let mut array_size_expr: Option<String> = None;
        let param_decl = match &variant.field_type.kind {
            ResolvedTypeKind::Primitive { .. } => {
                let type_str = format_type_to_c(&variant.field_type);
                format!("{} value", type_str)
            }
            ResolvedTypeKind::Array {
                element_type,
                size_expression,
                ..
            } => {
                let mut element_c_type = format_type_to_c(element_type);
                if is_nested_complex_type(element_type) {
                    element_c_type = format!("{}_{}_inner_t", type_name, escaped_variant);
                }
                array_size_expr = Some(format_expr_to_c(&size_expression, &[]));
                format!("{} const * value, uint64_t len", element_c_type)
            }
            ResolvedTypeKind::TypeRef { target_name, .. } => {
                format!("{}_t const * value", target_name)
            }
            _ => {
                let target_name = if is_nested_complex_type(&variant.field_type) {
                    format!("{}_{}_inner_t", type_name, escaped_variant)
                } else {
                    format_type_to_c(&variant.field_type)
                };
                format!("{} const * value", target_name)
            }
        };

        write!(
            output,
            "int {}_init_{}( void * buffer, uint64_t buf_sz, {} ) {{\n",
            type_name, escaped_variant, param_decl
        )
        .unwrap();
        write!(output, "  if( sizeof( {}_t ) > buf_sz ) {{\n", type_name).unwrap();
        write!(output, "    return -1; /* Buffer too small */\n").unwrap();
        write!(output, "  }}\n").unwrap();
        write!(
            output,
            "  {}_t * self = ({}_t *)buffer;\n",
            type_name, type_name
        )
        .unwrap();
        match &variant.field_type.kind {
            ResolvedTypeKind::Primitive { .. } => {
                write!(
                    output,
                    "  memcpy( &self->{}, &value, sizeof( self->{} ) );\n",
                    escaped_variant, escaped_variant
                )
                .unwrap();
            }
            ResolvedTypeKind::Array { .. } => {
                if let Some(size_expr_str) = array_size_expr {
                    write!(output, "  assert( len == ({}) );\n", size_expr_str).unwrap();
                }
                write!(
                    output,
                    "  memcpy( self->{}, value, len * sizeof self->{}[0] );\n",
                    escaped_variant, escaped_variant
                )
                .unwrap();
            }
            _ => {
                write!(
                    output,
                    "  memcpy( &self->{}, value, sizeof( self->{} ) );\n",
                    escaped_variant, escaped_variant
                )
                .unwrap();
            }
        }
        write!(
            output,
            "  int err = {}_validate( buffer, buf_sz, NULL );\n",
            type_name
        )
        .unwrap();
        write!(output, "  if( err ) return err;\n").unwrap();
        write!(output, "  return 0;\n").unwrap();
        write!(output, "}}\n\n").unwrap();
    }

    output
}

pub fn emit_init_fn(resolved_type: &ResolvedType) -> String {
    match &resolved_type.kind {
        ResolvedTypeKind::Struct { .. } => emit_init_fn_struct(&resolved_type),
        ResolvedTypeKind::Union { .. } => emit_init_fn_union(&resolved_type),
        ResolvedTypeKind::SizeDiscriminatedUnion { .. } => {
            format!("/* TODO: EMIT SIZE FN FOR SizeDiscriminatedUnion */\n\n")
        }
        _ => {
            /* Unsupported type*/
            String::new()
        }
    }
}
