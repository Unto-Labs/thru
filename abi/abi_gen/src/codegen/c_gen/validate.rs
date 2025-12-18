use super::helpers::{
    escape_c_keyword, format_expr_to_c, format_type_to_c, generate_nested_field_access,
    primitive_to_c_type, sanitize_type_name,
};
use super::ir_footprint::{resolve_param_binding, sanitize_symbol};
use crate::abi::expr::ExprKind;
use crate::abi::resolved::{ConstantStatus, ResolvedType, ResolvedTypeKind, Size};
use crate::abi::types::{IntegralType, PrimitiveType};
use crate::codegen::shared::ir::TypeIr;
use std::collections::{BTreeMap, HashSet};
use std::fmt::Write;
pub fn emit_validate_fn_struct(resolved_type: &ResolvedType, type_ir: Option<&TypeIr>) -> String {
    let mut output = String::new();
    let type_name = sanitize_type_name(&resolved_type.name);
    let type_name_str = type_name.as_str();
    let legacy_fn = format!("{}_validate_legacy", type_name);

    write!(
        output,
        "static int {}( void const * buffer, uint64_t buf_sz, uint64_t * out_bytes_consumed ) {{\n",
        legacy_fn
    )
    .unwrap();

    if let Size::Const(_size) = resolved_type.size {
        /* CASE 1: Constant size struct */
        write!(output, "  uint64_t offset = sizeof( {}_t );\n", type_name).unwrap();

        /* Check buffer size */
        write!(
            output,
            "  if( offset > buf_sz ) return 1; /* Buffer too small */\n"
        )
        .unwrap();

        /* Iterate through fields to validate enums and typerefs */
        let mut init = false;
        if let ResolvedTypeKind::Struct { fields, .. } = &resolved_type.kind {
            for field in fields {
                let escaped_name = escape_c_keyword(&field.name);
                match &field.field_type.kind {
                    ResolvedTypeKind::Enum {
                        tag_expression,
                        tag_constant_status,
                        variants,
                    } => {
                        if !init {
                            write!(
                                output,
                                "  {}_t const * self = ({}_t const *)buffer;\n",
                                type_name, type_name
                            )
                            .unwrap();
                            init = true;
                        }
                        write!(output, "/* Validate enum field '{}' */\n", field.name).unwrap();

                        /* Extract tag value */
                        if let ExprKind::FieldRef(field_ref) = tag_expression {
                            let tag_path = field_ref.path.join(".");

                            let tag_prim_type = if let ConstantStatus::NonConstant(field_refs) =
                                tag_constant_status
                            {
                                field_refs
                                    .get(&tag_path)
                                    .cloned()
                                    .unwrap_or(PrimitiveType::Integral(IntegralType::U64))
                            } else {
                                PrimitiveType::Integral(IntegralType::U64)
                            };

                            output.push_str(&generate_nested_field_access(
                                &tag_path,
                                type_name_str,
                                &tag_prim_type,
                            ));
                        } else if let ConstantStatus::NonConstant(field_refs) = tag_constant_status
                        {
                            for (field_ref, field_type) in field_refs.iter() {
                                output.push_str(&generate_nested_field_access(
                                    field_ref,
                                    type_name_str,
                                    field_type,
                                ));
                            }

                            let non_constant_refs: Vec<String> =
                                field_refs.keys().cloned().collect();
                            let tag_expr_str =
                                format_expr_to_c(&tag_expression, &non_constant_refs);
                            write!(output, "  int64_t computed_tag = {};\n", tag_expr_str).unwrap();
                        }

                        /* Check tag against valid variants */
                        let valid_tag_var = format!("valid_tag_{}", field.name);
                        write!(output, "  int {} = 0;\n", valid_tag_var).unwrap();
                        for variant in variants {
                            if let ExprKind::FieldRef(field_ref) = tag_expression {
                                let tag_var_name = field_ref.path.join(".").replace(".", "_");
                                write!(
                                    output,
                                    "  if( {} == {} ) {} = 1; /* {} */\n",
                                    tag_var_name, variant.tag_value, valid_tag_var, variant.name
                                )
                                .unwrap();
                            } else if let ConstantStatus::NonConstant(_) = tag_constant_status {
                                write!(
                                    output,
                                    "  if( computed_tag == {} ) {} = 1; /* {} */\n",
                                    variant.tag_value, valid_tag_var, variant.name
                                )
                                .unwrap();
                            }
                        }
                        write!(
                            output,
                            "  if( !{} ) return 2; /* Invalid tag value */\n\n",
                            valid_tag_var
                        )
                        .unwrap();
                    }
                    ResolvedTypeKind::TypeRef { target_name, .. } => {
                        if !init {
                            write!(
                                output,
                                "  {}_t const * self = ({}_t const *)buffer;\n",
                                type_name, type_name
                            )
                            .unwrap();
                            init = true;
                        }
                        write!(
                            output,
                            "\n  /* Validate typeref field '{}' */\n",
                            field.name
                        )
                        .unwrap();
                        write!(output, "  {{\n").unwrap();
                        write!(output, "    int err = {}_validate( (uint8_t const *)buffer + offsetof( {}_t, {} ), buf_sz - offsetof( {}_t, {} ), NULL );\n",
                               target_name, type_name, escaped_name, type_name, escaped_name).unwrap();
                        write!(output, "    if( err ) return err;\n").unwrap();
                        write!(output, "  }}\n").unwrap();
                    }
                    _ => {
                        /* Primitive, array, or inline struct/union - no validation needed for constant size */
                    }
                }
            }
        }

        write!(
            output,
            "  if( out_bytes_consumed ) *out_bytes_consumed = offset;\n"
        )
        .unwrap();
        write!(output, "  return 0; /* Success */\n").unwrap();
    } else {
        /* CASE 2: Variable size struct */
        write!(
            output,
            "  {}_t const * self = ({}_t const *)buffer;\n",
            type_name, type_name
        )
        .unwrap();

        /* Gather all field references */
        let mut all_field_refs: BTreeMap<String, PrimitiveType> = BTreeMap::new();
        if let Size::Variable(variable_refs) = &resolved_type.size {
            for refs in variable_refs.values() {
                for (ref_path, prim_type) in refs {
                    all_field_refs
                        .entry(ref_path.clone())
                        .or_insert_with(|| prim_type.clone());
                }
            }
        }

        let mut fam_offset_code = String::new();
        fam_offset_code.push_str("  /* Calculate offset past FAM fields */\n");
        let mut declared_refs: HashSet<String> = HashSet::new();

        if let ResolvedTypeKind::Struct { fields, .. } = &resolved_type.kind {
            let mut after_variable_size_data = false;
            for field in fields {
                let escaped_name = escape_c_keyword(&field.name);
                let is_fam = matches!(&field.field_type.size, Size::Variable(_));
                if is_fam && !after_variable_size_data {
                    /* For enum fields, body is inline bytes, not an actual struct field */
                    if matches!(&field.field_type.kind, ResolvedTypeKind::Enum { .. }) {
                        write!(output, "  uint64_t offset = sizeof( {}_t );\n", type_name).unwrap();
                    } else {
                        write!(
                            output,
                            "  uint64_t offset = offsetof( {}_t, {} );\n",
                            type_name, field.name
                        )
                        .unwrap();
                    }
                    write!(output, "  if( offset > buf_sz ) return 1;\n").unwrap();
                    after_variable_size_data = true;
                }

                if !after_variable_size_data {
                    /* Validate fields before FAM (similar to constant-size case) */
                    match &field.field_type.kind {
                        ResolvedTypeKind::Enum {
                            tag_expression,
                            tag_constant_status,
                            variants,
                        } => {
                            write!(
                                output,
                                "  /* Validate enum field '{}' (before FAM) */\n",
                                field.name
                            )
                            .unwrap();

                            /* Extract and validate tag */
                            if let ExprKind::FieldRef(field_ref) = tag_expression {
                                let tag_path = field_ref.path.join(".");
                                let tag_prim_type = if let ConstantStatus::NonConstant(field_refs) =
                                    tag_constant_status
                                {
                                    field_refs
                                        .get(&tag_path)
                                        .cloned()
                                        .unwrap_or(PrimitiveType::Integral(IntegralType::U64))
                                } else {
                                    PrimitiveType::Integral(IntegralType::U64)
                                };
                                output.push_str(&generate_nested_field_access(
                                    &tag_path,
                                    type_name_str,
                                    &tag_prim_type,
                                ));
                            } else if let ConstantStatus::NonConstant(field_refs) =
                                tag_constant_status
                            {
                                for (field_ref, field_type) in field_refs.iter() {
                                    output.push_str(&generate_nested_field_access(
                                        field_ref,
                                        type_name_str,
                                        field_type,
                                    ));
                                }
                                let non_constant_refs: Vec<String> =
                                    field_refs.keys().cloned().collect();
                                let tag_expr_str =
                                    format_expr_to_c(&tag_expression, &non_constant_refs);
                                write!(output, "  int64_t computed_tag = {};\n", tag_expr_str)
                                    .unwrap();
                            }

                            let valid_tag_var = format!("valid_tag_{}", field.name);
                            write!(output, "  int {} = 0;\n", valid_tag_var).unwrap();
                            for variant in variants {
                                if let ExprKind::FieldRef(field_ref) = tag_expression {
                                    let tag_var_name = field_ref.path.join(".").replace(".", "_");
                                    write!(
                                        output,
                                        "  if( {} == {} ) {} = 1;\n",
                                        tag_var_name, variant.tag_value, valid_tag_var
                                    )
                                    .unwrap();
                                } else if let ConstantStatus::NonConstant(_) = tag_constant_status {
                                    write!(
                                        output,
                                        "  if( computed_tag == {} ) {} = 1;\n",
                                        variant.tag_value, valid_tag_var
                                    )
                                    .unwrap();
                                }
                            }
                            write!(
                                output,
                                "  if( !{} ) return 2; /* Invalid tag */\n\n",
                                valid_tag_var
                            )
                            .unwrap();
                        }
                        ResolvedTypeKind::TypeRef { target_name, .. } => {
                            write!(
                                output,
                                "  /* Validate typeref field '{}' (before FAM) */\n",
                                field.name
                            )
                            .unwrap();
                            write!(output, "  {{\n").unwrap();
                            write!(output, "    int err = {}_validate( (uint8_t const *)buffer + offsetof( {}_t, {} ), buf_sz - offsetof( {}_t, {} ), NULL );\n",
                                   target_name, type_name, escaped_name, type_name, escaped_name).unwrap();
                            write!(output, "    if( err ) return err;\n").unwrap();
                            write!(output, "  }}\n\n").unwrap();
                        }
                        _ => {}
                    }
                }

                /* Track offset calculation for FAM fields */
                if after_variable_size_data {
                    write!(fam_offset_code, "  /* Process field '{}' */\n", field.name).unwrap();
                    match &field.field_type.kind {
                        ResolvedTypeKind::Array {
                            element_type,
                            size_expression,
                            ..
                        } => {
                            if let Size::Variable(field_map) = &field.field_type.size {
                                if let Some(field_refs) = field_map.get(&field.name) {
                                    /* Read field references */
                                    for (field_ref, field_type) in field_refs.iter() {
                                        if declared_refs.insert(field_ref.clone()) {
                                            fam_offset_code.push_str(
                                                &generate_nested_field_access(
                                                    field_ref,
                                                    type_name_str,
                                                    field_type,
                                                ),
                                            );
                                        }
                                    }

                                    let non_constant_refs: Vec<String> =
                                        field_refs.keys().cloned().collect();
                                    let size_expr_str =
                                        format_expr_to_c(&size_expression, &non_constant_refs);

                                    /* Validate array size */
                                    write!(
                                        fam_offset_code,
                                        "  if( ({}) < 0 ) return 3; /* Invalid array size */\n",
                                        size_expr_str
                                    )
                                    .unwrap();

                                    /* Safe multiply and add */
                                    match &element_type.kind {
                                        ResolvedTypeKind::TypeRef { target_name, .. } => {
                                            write!(fam_offset_code, "  {{\n").unwrap();
                                            write!(
                                                fam_offset_code,
                                                "    uint64_t elem_size = {}_footprint();\n",
                                                target_name
                                            )
                                            .unwrap();
                                            write!(fam_offset_code, "    uint64_t array_bytes;\n")
                                                .unwrap();
                                            write!(fam_offset_code, "    if( safe_mul_u64( elem_size, (uint64_t)({}), &array_bytes ) ) return 3;\n", size_expr_str).unwrap();
                                            write!(fam_offset_code, "    if( safe_add_u64( offset, array_bytes, &offset ) ) return 3;\n").unwrap();
                                            write!(fam_offset_code, "    if( offset > buf_sz ) return 1; /* Buffer too small */\n").unwrap();
                                            write!(fam_offset_code, "  }}\n").unwrap();
                                        }
                                        _ => {
                                            let elem_type_str = format_type_to_c(element_type);
                                            write!(fam_offset_code, "  {{\n").unwrap();
                                            write!(fam_offset_code, "    uint64_t array_bytes;\n")
                                                .unwrap();
                                            write!(fam_offset_code, "    if( safe_mul_u64( sizeof( {} ), (uint64_t)({}), &array_bytes ) ) return 3;\n", elem_type_str, size_expr_str).unwrap();
                                            write!(fam_offset_code, "    if( safe_add_u64( offset, array_bytes, &offset ) ) return 3;\n").unwrap();
                                            write!(fam_offset_code, "    if( offset > buf_sz ) return 1; /* Buffer too small */\n").unwrap();
                                            write!(fam_offset_code, "  }}\n").unwrap();
                                        }
                                    }
                                }
                            }
                        }
                        ResolvedTypeKind::TypeRef { target_name, .. } => {
                            write!(
                                fam_offset_code,
                                "  /* Validate typeref '{}' */\n",
                                field.name
                            )
                            .unwrap();
                            write!(fam_offset_code, "  {{\n").unwrap();
                            write!(fam_offset_code, "    uint64_t consumed = 0;\n").unwrap();
                            write!(fam_offset_code, "    int err = {}_validate( (uint8_t const *)buffer + offset, buf_sz - offset, &consumed );\n", target_name).unwrap();
                            write!(fam_offset_code, "    if( err ) return err;\n").unwrap();
                            write!(
                                fam_offset_code,
                                "    if( safe_add_u64( offset, consumed, &offset ) ) return 3;\n"
                            )
                            .unwrap();
                            write!(
                                fam_offset_code,
                                "    if( offset > buf_sz ) return 1; /* Buffer too small */\n"
                            )
                            .unwrap();
                            write!(fam_offset_code, "  }}\n").unwrap();
                        }
                        ResolvedTypeKind::Primitive { prim_type } => {
                            let prim_type_str = primitive_to_c_type(prim_type);
                            write!(
                                fam_offset_code,
                                "  if( safe_add_u64( offset, sizeof( {} ), &offset ) ) return 3;\n",
                                prim_type_str
                            )
                            .unwrap();
                            write!(
                                fam_offset_code,
                                "  if( offset > buf_sz ) return 1; /* Buffer too small */\n"
                            )
                            .unwrap();
                        }
                        ResolvedTypeKind::Enum {
                            tag_expression,
                            tag_constant_status,
                            variants,
                        } => {
                            write!(
                                fam_offset_code,
                                "  /* Validate enum field '{}' (after FAM) */\n",
                                field.name
                            )
                            .unwrap();

                            /* Extract and validate tag */
                            if let ExprKind::FieldRef(field_ref) = tag_expression {
                                let tag_path = field_ref.path.join(".");

                                let tag_prim_type = if let ConstantStatus::NonConstant(field_refs) =
                                    tag_constant_status
                                {
                                    field_refs
                                        .get(&tag_path)
                                        .cloned()
                                        .unwrap_or(PrimitiveType::Integral(IntegralType::U64))
                                } else {
                                    PrimitiveType::Integral(IntegralType::U64)
                                };

                                if declared_refs.insert(tag_path.clone()) {
                                    fam_offset_code.push_str(&generate_nested_field_access(
                                        &tag_path,
                                        type_name_str,
                                        &tag_prim_type,
                                    ));
                                }
                            } else if let ConstantStatus::NonConstant(field_refs) =
                                tag_constant_status
                            {
                                for (field_ref, field_type) in field_refs.iter() {
                                    if declared_refs.insert(field_ref.clone()) {
                                        fam_offset_code.push_str(&generate_nested_field_access(
                                            field_ref,
                                            type_name_str,
                                            field_type,
                                        ));
                                    }
                                }
                                let non_constant_refs: Vec<String> =
                                    field_refs.keys().cloned().collect();
                                let tag_expr_str =
                                    format_expr_to_c(&tag_expression, &non_constant_refs);
                                write!(
                                    fam_offset_code,
                                    "  int64_t computed_tag = {};\n",
                                    tag_expr_str
                                )
                                .unwrap();
                            }

                            /* Check tag against valid variants */
                            let valid_tag_var = format!("valid_tag_{}", field.name);
                            write!(fam_offset_code, "  int {} = 0;\n", valid_tag_var).unwrap();
                            for variant in variants {
                                if let ExprKind::FieldRef(field_ref) = tag_expression {
                                    let tag_var_name = field_ref.path.join(".").replace(".", "_");
                                    write!(
                                        fam_offset_code,
                                        "  if( {} == {} ) {} = 1; /* {} */\n",
                                        tag_var_name,
                                        variant.tag_value,
                                        valid_tag_var,
                                        variant.name
                                    )
                                    .unwrap();
                                } else if let ConstantStatus::NonConstant(_) = tag_constant_status {
                                    write!(
                                        fam_offset_code,
                                        "  if( computed_tag == {} ) {} = 1; /* {} */\n",
                                        variant.tag_value, valid_tag_var, variant.name
                                    )
                                    .unwrap();
                                }
                            }
                            write!(
                                fam_offset_code,
                                "  if( !{} ) return 2; /* Invalid tag value */\n\n",
                                valid_tag_var
                            )
                            .unwrap();

                            /* Calculate size based on whether enum is variable-sized */
                            if let Size::Variable(_variable_refs) = &resolved_type.size {
                                if let Some(_field_map) = _variable_refs.get(&field.name) {
                                    /* Variable-sized enum - calculate size inline by switching on tag */
                                    write!(fam_offset_code, "  /* Variable-sized enum - calculate size based on tag */\n").unwrap();

                                    /* Get tag variable name */
                                    let tag_var_name =
                                        if let ExprKind::FieldRef(tag_field_ref) = tag_expression {
                                            tag_field_ref.path.join(".").replace(".", "_")
                                        } else {
                                            String::from("computed_tag")
                                        };

                                    /* Generate switch on tag to add variant size */
                                    write!(fam_offset_code, "  switch ( {} ) {{\n", tag_var_name)
                                        .unwrap();

                                    for variant in variants {
                                        let variant_ident = escape_c_keyword(&variant.name);
                                        write!(
                                            fam_offset_code,
                                            "    case {}:\n",
                                            variant.tag_value
                                        )
                                        .unwrap();
                                        write!(fam_offset_code, "    {{\n").unwrap();

                                        match &variant.variant_type.size {
                                            Size::Const(size) => {
                                                write!(fam_offset_code, "      if( safe_add_u64( offset, {}, &offset ) ) return 3;\n", size).unwrap();
                                            }
                                            Size::Variable(_) => {
                                                /* For variable-size variants, call variant footprint function */
                                                let variant_type_name = format!(
                                                    "{}_{}_inner",
                                                    type_name, variant_ident
                                                );
                                                write!(fam_offset_code, "      if( safe_add_u64( offset, {}_footprint(), &offset ) ) return 3;\n",
                                                       variant_type_name).unwrap();
                                            }
                                        }

                                        write!(fam_offset_code, "      break;\n").unwrap();
                                        write!(fam_offset_code, "    }}\n").unwrap();
                                    }

                                    write!(fam_offset_code, "    default:\n").unwrap();
                                    write!(fam_offset_code, "      break;\n").unwrap();
                                    write!(fam_offset_code, "  }}\n").unwrap();
                                    write!(
                                        fam_offset_code,
                                        "  if( offset > buf_sz ) return 1; /* Buffer too small */\n"
                                    )
                                    .unwrap();
                                } else {
                                    /* Constant-sized enum - all variants have same size */
                                    if let Size::Const(size) = &field.field_type.size {
                                        write!(fam_offset_code, "  if( safe_add_u64( offset, {}, &offset ) ) return 3;\n", size).unwrap();
                                        write!(fam_offset_code, "  if( offset > buf_sz ) return 1; /* Buffer too small */\n").unwrap();
                                    }
                                }
                            } else {
                                /* Constant-sized enum - all variants have same size */
                                if let Size::Const(size) = &field.field_type.size {
                                    write!(
                                        fam_offset_code,
                                        "  if( safe_add_u64( offset, {}, &offset ) ) return 3;\n",
                                        size
                                    )
                                    .unwrap();
                                    write!(
                                        fam_offset_code,
                                        "  if( offset > buf_sz ) return 1; /* Buffer too small */\n"
                                    )
                                    .unwrap();
                                }
                            }
                        }
                        _ => {
                            write!(
                                fam_offset_code,
                                "  /* TODO: Handle other field types after FAM */\n"
                            )
                            .unwrap();
                        }
                    }
                }
            }
        }

        output.push_str(&fam_offset_code);
        write!(
            output,
            "\n  if( out_bytes_consumed ) *out_bytes_consumed = offset;\n"
        )
        .unwrap();
        write!(output, "  return 0; /* Success */\n").unwrap();
    }

    write!(output, "}}\n\n").unwrap();
    emit_validator_entrypoint(&mut output, &type_name, &legacy_fn, resolved_type, type_ir);
    output
}

pub fn emit_validate_fn_union(resolved_type: &ResolvedType, type_ir: Option<&TypeIr>) -> String {
    let mut output = String::new();
    let type_name = sanitize_type_name(&resolved_type.name);
    let legacy_fn = format!("{}_validate_legacy", type_name);

    write!(
        output,
        "static int {}( void const * buffer, uint64_t buf_sz, uint64_t * out_bytes_consumed ) {{\n",
        legacy_fn
    )
    .unwrap();

    if let Size::Const(_size) = resolved_type.size {
        write!(output, "  if( sizeof( {}_t ) > buf_sz ) {{\n", type_name).unwrap();
        write!(output, "    return 1; /* Buffer too small */\n").unwrap();
        write!(output, "  }}\n").unwrap();

        /* Set bytes consumed */
        write!(output, "  if( out_bytes_consumed != NULL ) {{\n").unwrap();
        write!(
            output,
            "    *out_bytes_consumed = sizeof( {}_t );\n",
            type_name
        )
        .unwrap();
        write!(output, "  }}\n").unwrap();

        write!(output, "  return 0; /* Success */\n").unwrap();
    } else {
        panic!("Unions should have constant size");
    }

    write!(output, "}}\n\n").unwrap();
    emit_validator_entrypoint(&mut output, &type_name, &legacy_fn, resolved_type, type_ir);
    output
}

/* ERROR CODES
      1 = Buffer too small
      2 = Invalid tag value
      3 = Invalid array size
      4 = other
*/
pub fn emit_validate_fn(resolved_type: &ResolvedType, type_ir: Option<&TypeIr>) -> String {
    match &resolved_type.kind {
        ResolvedTypeKind::Struct { .. } => emit_validate_fn_struct(&resolved_type, type_ir),
        ResolvedTypeKind::Union { .. } => emit_validate_fn_union(&resolved_type, type_ir),
        ResolvedTypeKind::SizeDiscriminatedUnion { .. } => {
            format!("/* TODO: EMIT SET FN FOR SizeDiscriminatedUnion */\n\n")
        }
        _ => {
            /* Unsupported type*/
            String::new()
        }
    }
}

fn emit_validator_entrypoint(
    output: &mut String,
    type_name: &str,
    legacy_fn: &str,
    resolved_type: &ResolvedType,
    type_ir: Option<&TypeIr>,
) {
    writeln!(
        output,
        "int {}_validate( void const * buffer, uint64_t buf_sz, uint64_t * out_bytes_consumed ) {{",
        type_name
    )
    .unwrap();
    let mut ir_call_data = None;
    let mut ir_missing_comment = None;
    if let Some(ir) = type_ir {
        match prepare_ir_validate_call(resolved_type, ir) {
            Ok(data) => ir_call_data = Some(data),
            Err(missing) => {
                if !missing.is_empty() {
                    ir_missing_comment = Some(format!(
                        "IR validator check skipped (missing params: {})",
                        missing.join(", ")
                    ));
                }
            }
        }
    }

    if let (Some(ir), Some(ref data)) = (type_ir, ir_call_data.as_ref()) {
        emit_payload_param_setup(output, type_name, &data.payloads);
        emit_ir_validate_primary_path(output, type_name, ir, data);
        writeln!(output, "}}\n").unwrap();
        return;
    }

    emit_legacy_validate_body(
        output,
        type_name,
        legacy_fn,
        resolved_type,
        ir_missing_comment.take(),
    );

    writeln!(output, "}}\n").unwrap();
}

fn emit_legacy_validate_body(
    output: &mut String,
    _type_name: &str,
    legacy_fn: &str,
    _resolved_type: &ResolvedType,
    comment: Option<String>,
) {
    if let Some(msg) = comment {
        writeln!(output, "  /* {} */", msg).unwrap();
    }
    writeln!(output, "  uint64_t tn_bytes_sink = 0ULL;").unwrap();
    writeln!(
        output,
        "  uint64_t * tn_bytes_ptr = out_bytes_consumed ? out_bytes_consumed : &tn_bytes_sink;"
    )
    .unwrap();
    writeln!(
        output,
        "  int tn_legacy_err = {}( buffer, buf_sz, tn_bytes_ptr );",
        legacy_fn
    )
    .unwrap();
    writeln!(output, "  uint64_t tn_legacy_bytes = 0ULL;").unwrap();
    writeln!(
        output,
        "  if( tn_legacy_err == 0 ) tn_legacy_bytes = *tn_bytes_ptr;\n"
    )
    .unwrap();
    writeln!(output, "  (void)tn_legacy_bytes;").unwrap();
    writeln!(output, "  return tn_legacy_err;").unwrap();
}

fn emit_ir_validate_primary_path(
    output: &mut String,
    type_name: &str,
    type_ir: &TypeIr,
    ir_data: &IrValidateCallData,
) {
    emit_ir_param_decls(output, type_name, ir_data);
    writeln!(output, "  uint64_t tn_ir_bytes = 0ULL;").unwrap();
    let call = format_ir_validate_call(type_ir, "tn_ir_bytes", &ir_data.args);
    writeln!(output, "  int tn_ir_err = {};", call).unwrap();
    writeln!(
        output,
        "  if( out_bytes_consumed ) *out_bytes_consumed = tn_ir_bytes;"
    )
    .unwrap();
    writeln!(output, "  return tn_ir_err;").unwrap();
}

fn emit_ir_param_decls(output: &mut String, type_name: &str, ir_data: &IrValidateCallData) {
    let mut emitted_self = false;
    for (var, source) in &ir_data.params {
        match source {
            IrParamSource::Getter { path } => {
                if !emitted_self {
                    writeln!(
                        output,
                        "  {}_t const * tn_ir_self = ({}_t const *)buffer;",
                        type_name, type_name
                    )
                    .unwrap();
                    emitted_self = true;
                }
                let getter = path.replace('.', "_");
                writeln!(
                    output,
                    "  int64_t {} = (int64_t)({}_get_{}( tn_ir_self ));",
                    var, type_name, getter
                )
                .unwrap();
            }
            IrParamSource::Payload => {}
        }
    }
}

fn emit_payload_param_setup(output: &mut String, type_name: &str, payloads: &[SduPayloadBinding]) {
    if payloads.is_empty() {
        return;
    }
    for payload in payloads {
        writeln!(
            output,
            "  size_t {}_offset = offsetof( {}_t, {} );",
            payload.var, type_name, payload.field_name
        )
        .unwrap();
        writeln!(output, "  if( {}_offset > buf_sz ) return 1;", payload.var).unwrap();
        writeln!(
            output,
            "  uint64_t {} = buf_sz - {}_offset;",
            payload.var, payload.var
        )
        .unwrap();
    }
}

fn format_ir_validate_call(type_ir: &TypeIr, bytes_ident: &str, args: &[String]) -> String {
    let fn_name = sanitize_symbol(&format!("{}_validate_ir", type_ir.type_name));
    if args.is_empty() {
        format!("{}( buf_sz, &{} )", fn_name, bytes_ident)
    } else {
        format!(
            "{}( buf_sz, &{}, {} )",
            fn_name,
            bytes_ident,
            args.join(", ")
        )
    }
}

struct IrValidateCallData {
    params: Vec<(String, IrParamSource)>,
    payloads: Vec<SduPayloadBinding>,
    args: Vec<String>,
}

enum IrParamSource {
    Getter { path: String },
    Payload,
}

struct SduPayloadBinding {
    var: String,
    field_name: String,
}

fn prepare_ir_validate_call(
    resolved_type: &ResolvedType,
    type_ir: &TypeIr,
) -> Result<IrValidateCallData, Vec<String>> {
    let bindings = collect_dynamic_param_bindings(resolved_type);
    let available: Vec<String> = bindings.keys().cloned().collect();
    let mut args = Vec::new();
    let mut params: Vec<(String, IrParamSource)> = Vec::new();
    let mut payloads: Vec<SduPayloadBinding> = Vec::new();
    let mut missing = Vec::new();

    for param in &type_ir.parameters {
        let sanitized = sanitize_symbol(&param.name.replace('.', "_"));
        if let Some(binding) = resolve_param_binding(&sanitized, &available) {
            if let Some(path) = bindings.get(binding.as_str()) {
                if !params.iter().any(|(var, _)| var == binding) {
                    params.push((
                        binding.clone(),
                        IrParamSource::Getter { path: path.clone() },
                    ));
                }
                args.push(format!("(uint64_t){}", binding));
            } else {
                missing.push(sanitized);
            }
        } else if let Some(field_name) = extract_payload_field_name(&param.name) {
            let escaped_field = escape_c_keyword(&field_name);
            if !payloads.iter().any(|p| p.var == sanitized) {
                payloads.push(SduPayloadBinding {
                    var: sanitized.clone(),
                    field_name: escaped_field,
                });
                params.push((sanitized.clone(), IrParamSource::Payload));
            }
            args.push(format!("(uint64_t){}", sanitized));
        } else {
            missing.push(sanitized);
        }
    }

    if missing.is_empty() {
        Ok(IrValidateCallData {
            params,
            payloads,
            args,
        })
    } else {
        Err(missing)
    }
}

fn collect_dynamic_param_bindings(resolved_type: &ResolvedType) -> BTreeMap<String, String> {
    let mut map = BTreeMap::new();
    for refs in resolved_type.dynamic_params.values() {
        for (path, _) in refs {
            if path.starts_with("_typeref_") {
                continue;
            }
            let sanitized = sanitize_symbol(&path.replace('.', "_"));
            map.entry(sanitized).or_insert_with(|| path.clone());
        }
    }
    map
}

fn extract_payload_field_name(param_name: &str) -> Option<String> {
    let base = param_name.strip_suffix(".payload_size")?;
    let normalized = base.replace("::", ".");
    normalized.rsplit('.').next().map(|field| field.to_string())
}
