use crate::abi::resolved::{ResolvedType, ResolvedTypeKind, Size, ConstantStatus};
use crate::abi::expr::ExprKind;
use crate::abi::types::{PrimitiveType, IntegralType};
use std::collections::{BTreeMap, HashSet};
use std::fmt::Write;
use super::helpers::{escape_c_keyword, primitive_to_c_type, format_type_to_c, format_expr_to_c, generate_nested_field_access};
pub fn emit_validate_fn_struct(resolved_type: &ResolvedType) -> String {
    let mut output = String::new();
    let type_name = &resolved_type.name;

    write!(output, "int {}_validate( void const * buffer, uint64_t buf_sz, uint64_t * out_bytes_consumed ) {{\n", type_name).unwrap();

    if let Size::Const(_size) = resolved_type.size {
        /* CASE 1: Constant size struct */
        write!(output, "  uint64_t offset = sizeof( {}_t );\n", type_name).unwrap();

        /* Check buffer size */
        write!(output, "  if( offset > buf_sz ) return 1; /* Buffer too small */\n").unwrap();

        /* Iterate through fields to validate enums and typerefs */
        let mut init = false;
        if let ResolvedTypeKind::Struct { fields, .. } = &resolved_type.kind {
            for field in fields {
                let escaped_name = escape_c_keyword(&field.name);
                match &field.field_type.kind {
                    ResolvedTypeKind::Enum { tag_expression, tag_constant_status, variants } => {
                        if !init {
                          write!(output, "  {}_t const * self = ({}_t const *)buffer;\n", type_name, type_name).unwrap();
                          init = true;
                        }
                        write!(output, "/* Validate enum field '{}' */\n", field.name).unwrap();

                        /* Extract tag value */
                        if let ExprKind::FieldRef(field_ref) = tag_expression {
                            let tag_path = field_ref.path.join(".");

                            let tag_prim_type = if let ConstantStatus::NonConstant(field_refs) = tag_constant_status {
                                field_refs.get(&tag_path).cloned().unwrap_or(PrimitiveType::Integral(IntegralType::U64))
                            } else {
                                PrimitiveType::Integral(IntegralType::U64)
                            };

                            output.push_str(&generate_nested_field_access(&tag_path, type_name, &tag_prim_type));
                        } else if let ConstantStatus::NonConstant(field_refs) = tag_constant_status {
                            for (field_ref, field_type) in field_refs.iter() {
                                output.push_str(&generate_nested_field_access(field_ref, type_name, field_type));
                            }

                            let non_constant_refs: Vec<String> = field_refs.keys().cloned().collect();
                            let tag_expr_str = format_expr_to_c(&tag_expression, &non_constant_refs);
                            write!(output, "  int64_t computed_tag = {};\n", tag_expr_str).unwrap();
                        }

                        /* Check tag against valid variants */
                        let valid_tag_var = format!("valid_tag_{}", field.name);
                        write!(output, "  int {} = 0;\n", valid_tag_var).unwrap();
                        for variant in variants {
                            if let ExprKind::FieldRef(field_ref) = tag_expression {
                                let tag_var_name = field_ref.path.join(".").replace(".", "_");
                                write!(output, "  if( {} == {} ) {} = 1; /* {} */\n", tag_var_name, variant.tag_value, valid_tag_var, variant.name).unwrap();
                            } else if let ConstantStatus::NonConstant(_) = tag_constant_status {
                                write!(output, "  if( computed_tag == {} ) {} = 1; /* {} */\n", variant.tag_value, valid_tag_var, variant.name).unwrap();
                            }
                        }
                        write!(output, "  if( !{} ) return 2; /* Invalid tag value */\n\n", valid_tag_var).unwrap();
                    }
                    ResolvedTypeKind::TypeRef { target_name, .. } => {
                        if !init {
                          write!(output, "  {}_t const * self = ({}_t const *)buffer;\n", type_name, type_name).unwrap();
                          init = true;
                        }
                        write!(output, "\n  /* Validate typeref field '{}' */\n", field.name).unwrap();
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

        write!(output, "  if( out_bytes_consumed ) *out_bytes_consumed = offset;\n").unwrap();
        write!(output, "  return 0; /* Success */\n").unwrap();
    } else {
        /* CASE 2: Variable size struct */
        write!(output, "  {}_t const * self = ({}_t const *)buffer;\n", type_name, type_name).unwrap();

        /* Gather all field references */
        let mut all_field_refs: BTreeMap<String, PrimitiveType> = BTreeMap::new();
        if let Size::Variable(variable_refs) = &resolved_type.size {
            for refs in variable_refs.values() {
                for (ref_path, prim_type) in refs {
                    all_field_refs.entry(ref_path.clone()).or_insert_with(|| prim_type.clone());
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
                        write!(output, "  uint64_t offset = offsetof( {}_t, {} );\n", type_name, field.name).unwrap();
                    }
                    write!(output, "  if( offset > buf_sz ) return 1;\n").unwrap();
                    after_variable_size_data = true;
                }

                if !after_variable_size_data {
                    /* Validate fields before FAM (similar to constant-size case) */
                    match &field.field_type.kind {
                        ResolvedTypeKind::Enum { tag_expression, tag_constant_status, variants } => {
                            write!(output, "  /* Validate enum field '{}' (before FAM) */\n", field.name).unwrap();

                            /* Extract and validate tag */
                            if let ExprKind::FieldRef(field_ref) = tag_expression {
                                let tag_path = field_ref.path.join(".");
                                let tag_prim_type = if let ConstantStatus::NonConstant(field_refs) = tag_constant_status {
                                    field_refs.get(&tag_path).cloned().unwrap_or(PrimitiveType::Integral(IntegralType::U64))
                                } else {
                                    PrimitiveType::Integral(IntegralType::U64)
                                };
                                output.push_str(&generate_nested_field_access(&tag_path, type_name, &tag_prim_type));
                            } else if let ConstantStatus::NonConstant(field_refs) = tag_constant_status {
                                for (field_ref, field_type) in field_refs.iter() {
                                    output.push_str(&generate_nested_field_access(field_ref, type_name, field_type));
                                }
                                let non_constant_refs: Vec<String> = field_refs.keys().cloned().collect();
                                let tag_expr_str = format_expr_to_c(&tag_expression, &non_constant_refs);
                                write!(output, "  int64_t computed_tag = {};\n", tag_expr_str).unwrap();
                            }

                            let valid_tag_var = format!("valid_tag_{}", field.name);
                            write!(output, "  int {} = 0;\n", valid_tag_var).unwrap();
                            for variant in variants {
                                if let ExprKind::FieldRef(field_ref) = tag_expression {
                                    let tag_var_name = field_ref.path.join(".").replace(".", "_");
                                    write!(output, "  if( {} == {} ) {} = 1;\n", tag_var_name, variant.tag_value, valid_tag_var).unwrap();
                                } else if let ConstantStatus::NonConstant(_) = tag_constant_status {
                                    write!(output, "  if( computed_tag == {} ) {} = 1;\n", variant.tag_value, valid_tag_var).unwrap();
                                }
                            }
                            write!(output, "  if( !{} ) return 2; /* Invalid tag */\n\n", valid_tag_var).unwrap();
                        }
                        ResolvedTypeKind::TypeRef { target_name, .. } => {
                            write!(output, "  /* Validate typeref field '{}' (before FAM) */\n", field.name).unwrap();
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
                        ResolvedTypeKind::Array { element_type, size_expression, .. } => {
                            if let Size::Variable(field_map) = &field.field_type.size {
                                if let Some(field_refs) = field_map.get(&field.name) {
                                    /* Read field references */
                                    for (field_ref, field_type) in field_refs.iter() {
                                        if declared_refs.insert(field_ref.clone()) {
                                            fam_offset_code.push_str(&generate_nested_field_access(field_ref, type_name, field_type));
                                        }
                                    }

                                    let non_constant_refs: Vec<String> = field_refs.keys().cloned().collect();
                                    let size_expr_str = format_expr_to_c(&size_expression, &non_constant_refs);

                                    /* Validate array size */
                                    write!(fam_offset_code, "  if( ({}) < 0 ) return 3; /* Invalid array size */\n", size_expr_str).unwrap();

                                    /* Safe multiply and add */
                                    match &element_type.kind {
                                        ResolvedTypeKind::TypeRef { target_name, .. } => {
                                            write!(fam_offset_code, "  {{\n").unwrap();
                                            write!(fam_offset_code, "    uint64_t elem_size = {}_footprint();\n", target_name).unwrap();
                                            write!(fam_offset_code, "    uint64_t array_bytes;\n").unwrap();
                                            write!(fam_offset_code, "    if( safe_mul_u64( elem_size, (uint64_t)({}), &array_bytes ) ) return 3;\n", size_expr_str).unwrap();
                                            write!(fam_offset_code, "    if( safe_add_u64( offset, array_bytes, &offset ) ) return 3;\n").unwrap();
                                            write!(fam_offset_code, "    if( offset > buf_sz ) return 1; /* Buffer too small */\n").unwrap();
                                            write!(fam_offset_code, "  }}\n").unwrap();
                                        }
                                        _ => {
                                            let elem_type_str = format_type_to_c(element_type);
                                            write!(fam_offset_code, "  {{\n").unwrap();
                                            write!(fam_offset_code, "    uint64_t array_bytes;\n").unwrap();
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
                            write!(fam_offset_code, "  /* Validate typeref '{}' */\n", field.name).unwrap();
                            write!(fam_offset_code, "  {{\n").unwrap();
                            write!(fam_offset_code, "    uint64_t consumed = 0;\n").unwrap();
                            write!(fam_offset_code, "    int err = {}_validate( (uint8_t const *)buffer + offset, buf_sz - offset, &consumed );\n", target_name).unwrap();
                            write!(fam_offset_code, "    if( err ) return err;\n").unwrap();
                            write!(fam_offset_code, "    if( safe_add_u64( offset, consumed, &offset ) ) return 3;\n").unwrap();
                            write!(fam_offset_code, "    if( offset > buf_sz ) return 1; /* Buffer too small */\n").unwrap();
                            write!(fam_offset_code, "  }}\n").unwrap();
                        }
                        ResolvedTypeKind::Primitive { prim_type } => {
                            let prim_type_str = primitive_to_c_type(prim_type);
                            write!(fam_offset_code, "  if( safe_add_u64( offset, sizeof( {} ), &offset ) ) return 3;\n", prim_type_str).unwrap();
                            write!(fam_offset_code, "  if( offset > buf_sz ) return 1; /* Buffer too small */\n").unwrap();
                        }
                        ResolvedTypeKind::Enum { tag_expression, tag_constant_status, variants } => {
                            write!(fam_offset_code, "  /* Validate enum field '{}' (after FAM) */\n", field.name).unwrap();

                            /* Extract and validate tag */
                            if let ExprKind::FieldRef(field_ref) = tag_expression {
                                let tag_path = field_ref.path.join(".");

                                let tag_prim_type = if let ConstantStatus::NonConstant(field_refs) = tag_constant_status {
                                    field_refs.get(&tag_path).cloned().unwrap_or(PrimitiveType::Integral(IntegralType::U64))
                                } else {
                                    PrimitiveType::Integral(IntegralType::U64)
                                };

                                if declared_refs.insert(tag_path.clone()) {
                                    fam_offset_code.push_str(&generate_nested_field_access(&tag_path, type_name, &tag_prim_type));
                                }
                            } else if let ConstantStatus::NonConstant(field_refs) = tag_constant_status {
                                for (field_ref, field_type) in field_refs.iter() {
                                    if declared_refs.insert(field_ref.clone()) {
                                        fam_offset_code.push_str(&generate_nested_field_access(field_ref, type_name, field_type));
                                    }
                                }
                                let non_constant_refs: Vec<String> = field_refs.keys().cloned().collect();
                                let tag_expr_str = format_expr_to_c(&tag_expression, &non_constant_refs);
                                write!(fam_offset_code, "  int64_t computed_tag = {};\n", tag_expr_str).unwrap();
                            }

                            /* Check tag against valid variants */
                            let valid_tag_var = format!("valid_tag_{}", field.name);
                            write!(fam_offset_code, "  int {} = 0;\n", valid_tag_var).unwrap();
                            for variant in variants {
                                if let ExprKind::FieldRef(field_ref) = tag_expression {
                                    let tag_var_name = field_ref.path.join(".").replace(".", "_");
                                    write!(fam_offset_code, "  if( {} == {} ) {} = 1; /* {} */\n", tag_var_name, variant.tag_value, valid_tag_var, variant.name).unwrap();
                                } else if let ConstantStatus::NonConstant(_) = tag_constant_status {
                                    write!(fam_offset_code, "  if( computed_tag == {} ) {} = 1; /* {} */\n", variant.tag_value, valid_tag_var, variant.name).unwrap();
                                }
                            }
                            write!(fam_offset_code, "  if( !{} ) return 2; /* Invalid tag value */\n\n", valid_tag_var).unwrap();

                            /* Calculate size based on whether enum is variable-sized */
                            if let Size::Variable(_variable_refs) = &resolved_type.size {
                                if let Some(_field_map) = _variable_refs.get(&field.name) {
                                    /* Variable-sized enum - calculate size inline by switching on tag */
                                    write!(fam_offset_code, "  /* Variable-sized enum - calculate size based on tag */\n").unwrap();

                                    /* Get tag variable name */
                                    let tag_var_name = if let ExprKind::FieldRef(tag_field_ref) = tag_expression {
                                        tag_field_ref.path.join(".").replace(".", "_")
                                    } else {
                                        String::from("computed_tag")
                                    };

                                    /* Generate switch on tag to add variant size */
                                    write!(fam_offset_code, "  switch ( {} ) {{\n", tag_var_name).unwrap();

                                    for variant in variants {
                                        write!(fam_offset_code, "    case {}:\n", variant.tag_value).unwrap();
                                        write!(fam_offset_code, "    {{\n").unwrap();

                                        match &variant.variant_type.size {
                                            Size::Const(size) => {
                                                write!(fam_offset_code, "      if( safe_add_u64( offset, {}, &offset ) ) return 3;\n", size).unwrap();
                                            }
                                            Size::Variable(_) => {
                                                /* For variable-size variants, call variant footprint function */
                                                let variant_type_name = format!("{}_{}_inner", type_name, variant.name);
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
                                    write!(fam_offset_code, "  if( offset > buf_sz ) return 1; /* Buffer too small */\n").unwrap();
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
                                    write!(fam_offset_code, "  if( safe_add_u64( offset, {}, &offset ) ) return 3;\n", size).unwrap();
                                    write!(fam_offset_code, "  if( offset > buf_sz ) return 1; /* Buffer too small */\n").unwrap();
                                }
                            }
                        }
                        _ => {
                            write!(fam_offset_code, "  /* TODO: Handle other field types after FAM */\n").unwrap();
                        }
                    }
                }
            }
        }

      
        output.push_str(&fam_offset_code);
        write!(output, "\n  if( out_bytes_consumed ) *out_bytes_consumed = offset;\n").unwrap();
        write!(output, "  return 0; /* Success */\n").unwrap();
    }

    write!(output, "}}\n\n").unwrap();
    output
}

pub fn emit_validate_fn_union(resolved_type: &ResolvedType) -> String {
    let mut output = String::new();
    let type_name = &resolved_type.name;

    write!(output, "int {}_validate( void const * buffer, uint64_t buf_sz, uint64_t * out_bytes_consumed ) {{\n", type_name).unwrap();

    if let Size::Const(_size) = resolved_type.size {
        write!(output, "  if( sizeof( {}_t ) > buf_sz ) {{\n", type_name).unwrap();
        write!(output, "    return 1; /* Buffer too small */\n").unwrap();
        write!(output, "  }}\n").unwrap();

        /* Set bytes consumed */
        write!(output, "  if( out_bytes_consumed != NULL ) {{\n").unwrap();
        write!(output, "    *out_bytes_consumed = sizeof( {}_t );\n", type_name).unwrap();
        write!(output, "  }}\n").unwrap();

        write!(output, "  return 0; /* Success */\n").unwrap();
    } else {
        panic!("Unions should have constant size");
    }

    write!(output, "}}\n\n").unwrap();
    output
}

/* ERROR CODES
      1 = Buffer too small
      2 = Invalid tag value
      3 = Invalid array size
      4 = other
*/
pub fn emit_validate_fn(resolved_type: &ResolvedType) -> String {
  match &resolved_type.kind {
    ResolvedTypeKind::Struct { .. } => emit_validate_fn_struct(&resolved_type),
    ResolvedTypeKind::Union { .. } => emit_validate_fn_union(&resolved_type),
    ResolvedTypeKind::SizeDiscriminatedUnion { .. } => {
      format!("/* TODO: EMIT SET FN FOR SizeDiscriminatedUnion */\n\n")
    }
    _ => {
      /* Unsupported type*/
      String::new()
    }
  }
}
