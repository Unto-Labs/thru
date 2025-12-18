use super::helpers::{
    escape_c_keyword, format_expr_to_c, format_type_to_c, generate_nested_field_access,
    get_c_accessor_type, is_nested_complex_type, primitive_to_c_type, sanitize_type_name,
};
use crate::abi::expr::{ConstantExpression, ExprKind};
use crate::abi::resolved::{ConstantStatus, ResolvedType, ResolvedTypeKind, Size};
use crate::abi::types::{IntegralType, PrimitiveType};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fmt::Write;
pub fn emit_accessor_fn_struct(resolved_type: &ResolvedType) -> String {
    let mut output = String::new();
    let type_name = sanitize_type_name(&resolved_type.name);
    let type_name_str = type_name.as_str();

    /* First, get the BTree of all field references inside the type */
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

    let mut after_variable_size_data = false;
    let mut fam_offset_code = String::new();
    fam_offset_code.push_str("  /* Ghost Field - calculating offset */\n");
    let mut declared_refs: HashSet<String> = HashSet::new();

    let fields = if let ResolvedTypeKind::Struct { fields, .. } = &resolved_type.kind {
        fields
    } else {
        return output;
    };

    for field in fields.iter() {
        let escaped_name = escape_c_keyword(&field.name);
        let is_fam = matches!(&field.field_type.size, Size::Variable(_));

        match &field.field_type.kind {
            ResolvedTypeKind::Primitive { .. } => {
                let field_type_str = get_c_accessor_type(&field.field_type);
                write!(
                    output,
                    "{} {}_get_{}( {}_t const * self ) {{\n",
                    field_type_str, type_name, escaped_name, type_name
                )
                .unwrap();

                if after_variable_size_data {
                    output.push_str(&fam_offset_code);
                    write!(output, "  {} value;\n", field_type_str).unwrap();
                    write!(output, "  memcpy( &value, (unsigned char const *)self + offset, sizeof( value ) );\n").unwrap();
                } else {
                    write!(output, "  {} value;\n", field_type_str).unwrap();
                    write!(
                        output,
                        "  memcpy( &value, &self->{}, sizeof( value ) );\n",
                        escaped_name
                    )
                    .unwrap();
                }
                write!(output, "  return value;\n").unwrap();
                write!(output, "}}\n\n").unwrap();
            }
            ResolvedTypeKind::Array {
                element_type,
                size_expression,
                ..
            } => {
                let element_c_type = format_type_to_c(element_type);

                /* Const getter */
                write!(
                    output,
                    "{} const * {}_get_{}_const( {}_t const * self ) {{\n",
                    element_c_type, type_name, escaped_name, type_name
                )
                .unwrap();
                if after_variable_size_data {
                    output.push_str(&fam_offset_code);
                    write!(
                        output,
                        "  return ({} const *)((unsigned char const *)self + offset);\n",
                        element_c_type
                    )
                    .unwrap();
                } else {
                    write!(output, "  return self->{};\n", escaped_name).unwrap();
                }
                write!(output, "}}\n\n").unwrap();

                /* Mutable getter */
                write!(
                    output,
                    "{} * {}_get_{}( {}_t * self ) {{\n",
                    element_c_type, type_name, escaped_name, type_name
                )
                .unwrap();
                if after_variable_size_data {
                    output.push_str(&fam_offset_code);
                    write!(
                        output,
                        "  return ({} *)((unsigned char *)self + offset);\n",
                        element_c_type
                    )
                    .unwrap();
                } else {
                    write!(output, "  return self->{};\n", escaped_name).unwrap();
                }
                write!(output, "}}\n\n").unwrap();

                /* Size function (returns number of elements) */
                write!(
                    output,
                    "uint64_t {}_get_{}_size( {}_t const * self ) {{\n",
                    type_name, escaped_name, type_name
                )
                .unwrap();
                if size_expression.is_constant() {
                    /* Constant size array */
                    let size_expr = format_expr_to_c(&size_expression, &[]);
                    write!(
                        output,
                        "  (void)self; /* unused for constant-size arrays */\n"
                    )
                    .unwrap();
                    write!(output, "  return {};\n", size_expr).unwrap();
                } else {
                    /* Variable size array (FAM) - need to evaluate expression */
                    if let Size::Variable(field_map) = &field.field_type.size {
                        if let Some(field_refs) = field_map.get(&field.name) {
                            /* Generate field accessor code */
                            for (field_ref, field_type) in field_refs.iter() {
                                output.push_str(&generate_nested_field_access(
                                    field_ref,
                                    type_name_str,
                                    field_type,
                                ));
                            }
                            let non_constant_refs: Vec<String> =
                                field_refs.keys().cloned().collect();
                            let size_expr_str =
                                format_expr_to_c(&size_expression, &non_constant_refs);
                            write!(output, "  return {};\n", size_expr_str).unwrap();
                        } else {
                            write!(
                                output,
                                "  return 0; /* ERROR: Could not determine array size */\n"
                            )
                            .unwrap();
                        }
                    } else {
                        write!(
                            output,
                            "  return 0; /* ERROR: Variable size but no field references */\n"
                        )
                        .unwrap();
                    }
                }
                write!(output, "}}\n\n").unwrap();
            }
            ResolvedTypeKind::Struct { .. } | ResolvedTypeKind::Union { .. } => {
                /* Nested structs/unions - generate both const and mutable getters */

                /* Const getter */
                write!(
                    output,
                    "{}_{}_inner_t const * {}_get_{}_const( {}_t const * self ) {{\n",
                    type_name, escaped_name, type_name, escaped_name, type_name
                )
                .unwrap();

                if after_variable_size_data {
                    output.push_str(&fam_offset_code);
                    write!(
                        output,
                        "  return ({}_{}_inner_t const *)((unsigned char const *)self + offset);\n",
                        type_name, escaped_name
                    )
                    .unwrap();
                } else {
                    write!(output, "  return &self->{};\n", escaped_name).unwrap();
                }
                write!(output, "}}\n\n").unwrap();

                /* Mutable getter */
                write!(
                    output,
                    "{}_{}_inner_t * {}_get_{}( {}_t * self ) {{\n",
                    type_name, escaped_name, type_name, escaped_name, type_name
                )
                .unwrap();

                if after_variable_size_data {
                    output.push_str(&fam_offset_code);
                    write!(
                        output,
                        "  return ({}_{}_inner_t *)((unsigned char *)self + offset);\n",
                        type_name, escaped_name
                    )
                    .unwrap();
                } else {
                    write!(output, "  return &self->{};\n", escaped_name).unwrap();
                }
                write!(output, "}}\n\n").unwrap();

                /* Generate parent-scoped accessors for primitive fields within this nested struct */
                /* This allows field ref paths like ["first", "count"] to use ParentType_get_first_count() */
                if let ResolvedTypeKind::Struct {
                    fields: nested_fields,
                    ..
                } = &field.field_type.kind
                {
                    for nested_field in nested_fields {
                        if let ResolvedTypeKind::Primitive { prim_type } =
                            &nested_field.field_type.kind
                        {
                            let nested_escaped = escape_c_keyword(&nested_field.name);
                            let parent_accessor_name =
                                format!("{}_{}", escaped_name, nested_escaped);
                            let field_type_str = get_c_accessor_type(&nested_field.field_type);

                            /* Generate parent-scoped accessor: ParentType_get_nested_field() */
                            write!(
                                output,
                                "{} {}_get_{}( {}_t const * self ) {{\n",
                                field_type_str, type_name, parent_accessor_name, type_name
                            )
                            .unwrap();
                            write!(output, "  {} value;\n", field_type_str).unwrap();
                            write!(
                                output,
                                "  memcpy( &value, &self->{}.{}, sizeof( value ) );\n",
                                escaped_name, nested_escaped
                            )
                            .unwrap();
                            write!(output, "  return value;\n").unwrap();
                            write!(output, "}}\n\n").unwrap();
                        }
                    }
                }
            }
            ResolvedTypeKind::TypeRef { target_name, .. } => {
                /* Referenced types - generate both const and mutable getters */

                /* Const getter */
                write!(
                    output,
                    "{}_t const * {}_get_{}_const( {}_t const * self ) {{\n",
                    target_name, type_name, escaped_name, type_name
                )
                .unwrap();

                if after_variable_size_data {
                    output.push_str(&fam_offset_code);
                    write!(
                        output,
                        "  return ({}_t const *)((unsigned char const *)self + offset);\n",
                        target_name
                    )
                    .unwrap();
                } else {
                    write!(output, "  return &self->{};\n", escaped_name).unwrap();
                }
                write!(output, "}}\n\n").unwrap();

                /* Mutable getter */
                write!(
                    output,
                    "{}_t * {}_get_{}( {}_t * self ) {{\n",
                    target_name, type_name, escaped_name, type_name
                )
                .unwrap();

                if after_variable_size_data {
                    output.push_str(&fam_offset_code);
                    write!(
                        output,
                        "  return ({}_t *)((unsigned char *)self + offset);\n",
                        target_name
                    )
                    .unwrap();
                } else {
                    write!(output, "  return &self->{};\n", escaped_name).unwrap();
                }
                write!(output, "}}\n\n").unwrap();
            }
            ResolvedTypeKind::Enum { variants, .. } => {
                /* For enum fields in structs, generate variant getters */
                /* Each variant gets const and mutable getter functions */
                /* Function names include the enum field name for disambiguation */
                /* No tag validation - caller's responsibility to call the right getter */
                for variant in variants {
                    let variant_escaped = escape_c_keyword(&variant.name);

                    /* Build the variant type name */
                    let variant_type_name =
                        format!("{}_{}_{}_inner_t", type_name, escaped_name, variant_escaped);

                    /* Generate const getter - name includes enum field name */
                    write!(
                        output,
                        "{} const * {}_{}_get_{}_const( {}_t const * self ) {{\n",
                        variant_type_name, type_name, escaped_name, variant_escaped, type_name
                    )
                    .unwrap();

                    /* Use the ghost field getter to calculate offset, then cast to variant type */
                    write!(
                        output,
                        "  return ({} const *){}_get_{}( self );\n",
                        variant_type_name, type_name, escaped_name
                    )
                    .unwrap();
                    write!(output, "}}\n\n").unwrap();

                    /* Generate mutable getter - name includes enum field name */
                    write!(
                        output,
                        "{} * {}_{}_get_{}( {}_t * self ) {{\n",
                        variant_type_name, type_name, escaped_name, variant_escaped, type_name
                    )
                    .unwrap();
                    write!(
                        output,
                        "  return ({} *)(void *){}_get_{}( ({}_t const *)self );\n",
                        variant_type_name, type_name, escaped_name, type_name
                    )
                    .unwrap();
                    write!(output, "}}\n\n").unwrap();
                }
            }
            ResolvedTypeKind::SizeDiscriminatedUnion { variants } => {
                /* For size-discriminated union fields in structs, generate tag and size functions */

                /* Generate tag function - takes size parameter and returns variant tag */
                /* Note: This is a standalone function, not a getter, since we need the size as input */
                write!(
                    output,
                    "/* Tag function for size-discriminated union field '{}' */\n",
                    field.name
                )
                .unwrap();
                write!(
                    output,
                    "uint8_t {}_{}_tag_from_size( uint64_t size ) {{\n",
                    type_name, escaped_name
                )
                .unwrap();
                write!(output, "  switch( size ) {{\n").unwrap();
                for (idx, variant) in variants.iter().enumerate() {
                    write!(
                        output,
                        "    case {}: return {};\n",
                        variant.expected_size, idx
                    )
                    .unwrap();
                }
                write!(
                    output,
                    "    default: return 255; /* Invalid size - no matching variant */\n"
                )
                .unwrap();
                write!(output, "  }}\n").unwrap();
                write!(output, "}}\n\n").unwrap();

                /* Generate size function - takes tag and returns size */
                write!(
                    output,
                    "uint64_t {}_{}_size_from_tag( uint8_t tag ) {{\n",
                    type_name, escaped_name
                )
                .unwrap();
                write!(output, "  switch( tag ) {{\n").unwrap();
                for (idx, variant) in variants.iter().enumerate() {
                    write!(
                        output,
                        "    case {}: return {};\n",
                        idx, variant.expected_size
                    )
                    .unwrap();
                }
                write!(output, "    default: return 0; /* Invalid tag */\n").unwrap();
                write!(output, "  }}\n").unwrap();
                write!(output, "}}\n\n").unwrap();

                /* Generate size getter - takes struct pointer and buffer size, returns size based on available buffer */
                write!(
                    output,
                    "/* Size getter for size-discriminated union field '{}' */\n",
                    field.name
                )
                .unwrap();
                write!(
                    output,
                    "uint64_t {}_{}_size( {}_t const * self, uint64_t buffer_size ) {{\n",
                    type_name, escaped_name, type_name
                )
                .unwrap();

                /* Calculate offset to this field */
                if after_variable_size_data {
                    output.push_str(&fam_offset_code);
                    write!(
                        output,
                        "  uint64_t available_size = buffer_size - offset;\n"
                    )
                    .unwrap();
                    write!(
                        output,
                        "  /* Match available size against variant sizes */\n"
                    )
                    .unwrap();
                    write!(output, "  switch( available_size ) {{\n").unwrap();
                    for variant in variants.iter() {
                        write!(
                            output,
                            "    case {}: return {};\n",
                            variant.expected_size, variant.expected_size
                        )
                        .unwrap();
                    }
                    write!(output, "    default: return 0; /* Invalid size */\n").unwrap();
                    write!(output, "  }}\n").unwrap();
                } else {
                    /* Before variable-size data - calculate offset statically */
                    let mut static_offset = 0u64;
                    for prev_field in fields.iter() {
                        if prev_field.name == field.name {
                            break;
                        }
                        if let Size::Const(size) = prev_field.field_type.size {
                            static_offset += size;
                        } else {
                            /* Can't calculate statically */
                            static_offset = 0;
                            break;
                        }
                    }
                    write!(
                        output,
                        "  uint64_t available_size = buffer_size - {};\n",
                        static_offset
                    )
                    .unwrap();
                    write!(
                        output,
                        "  /* Match available size against variant sizes */\n"
                    )
                    .unwrap();
                    write!(output, "  switch( available_size ) {{\n").unwrap();
                    for variant in variants.iter() {
                        write!(
                            output,
                            "    case {}: return {};\n",
                            variant.expected_size, variant.expected_size
                        )
                        .unwrap();
                    }
                    write!(output, "    default: return 0; /* Invalid size */\n").unwrap();
                    write!(output, "  }}\n").unwrap();
                }
                write!(output, "}}\n\n").unwrap();

                /* Generate variant-specific getters for each variant (like enums) */
                for variant in variants {
                    let variant_escaped = escape_c_keyword(&variant.name);
                    let variant_type_name = if is_nested_complex_type(&variant.variant_type) {
                        format!("{}_{}_{}_inner_t", type_name, escaped_name, variant_escaped)
                    } else {
                        format_type_to_c(&variant.variant_type)
                    };

                    /* Const getter - name includes SDU field name (like enum pattern: {type}_{field}_get_{variant}_const) */
                    write!(
                        output,
                        "{} const * {}_{}_get_{}_const( {}_t const * self ) {{\n",
                        variant_type_name, type_name, escaped_name, variant_escaped, type_name
                    )
                    .unwrap();
                    if after_variable_size_data {
                        output.push_str(&fam_offset_code);
                        write!(
                            output,
                            "  return ({} const *)((unsigned char const *)self + offset);\n",
                            variant_type_name
                        )
                        .unwrap();
                    } else {
                        /* Before variable-size data - calculate offset statically */
                        let mut static_offset = 0u64;
                        for prev_field in fields.iter() {
                            if prev_field.name == field.name {
                                break;
                            }
                            if let Size::Const(size) = prev_field.field_type.size {
                                static_offset += size;
                            } else {
                                /* Can't calculate statically */
                                static_offset = 0;
                                break;
                            }
                        }
                        write!(
                            output,
                            "  return ({} const *)((unsigned char const *)self + {});\n",
                            variant_type_name, static_offset
                        )
                        .unwrap();
                    }
                    write!(output, "}}\n\n").unwrap();

                    /* Mutable getter - name includes SDU field name (like enum pattern: {type}_{field}_get_{variant}) */
                    write!(
                        output,
                        "{} * {}_{}_get_{}( {}_t * self ) {{\n",
                        variant_type_name, type_name, escaped_name, variant_escaped, type_name
                    )
                    .unwrap();
                    write!(
                        output,
                        "  return ({} *)(void *){}_{}_get_{}_const( ({}_t const *)self );\n",
                        variant_type_name, type_name, escaped_name, variant_escaped, type_name
                    )
                    .unwrap();
                    write!(output, "}}\n\n").unwrap();
                }
            }
        }

        if is_fam {
            if !after_variable_size_data {
                /* For enum fields and size-discriminated unions, body is inline bytes, not an actual struct field */
                if matches!(
                    &field.field_type.kind,
                    ResolvedTypeKind::Enum { .. } | ResolvedTypeKind::SizeDiscriminatedUnion { .. }
                ) {
                    write!(
                        fam_offset_code,
                        "  uint64_t offset = sizeof( {}_t );\n",
                        type_name
                    )
                    .unwrap();
                } else {
                    write!(
                        fam_offset_code,
                        "  uint64_t offset = offsetof( {}_t, {} );\n",
                        type_name, field.name
                    )
                    .unwrap();
                }
            }

            after_variable_size_data = true;
        }

        /* Update fam_offset_code after processing the field */
        if after_variable_size_data {
            write!(fam_offset_code, "  /* offset of: {} */\n", field.name).unwrap();
            match &field.field_type.kind {
                ResolvedTypeKind::Array {
                    element_type,
                    size_expression,
                    ..
                } => {
                    if let Size::Variable(field_map) = &field.field_type.size {
                        if let Some(field_refs) = field_map.get(&field.name) {
                            /* Generate field accessor code for this field's references */
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
                            let size_expr_str =
                                format_expr_to_c(&size_expression, &non_constant_refs);

                            write!(fam_offset_code, "  assert( ({}) >= 0 );\n", size_expr_str)
                                .unwrap();

                            match &element_type.kind {
                                ResolvedTypeKind::TypeRef { target_name, .. } => {
                                    write!(
                                        fam_offset_code,
                                        "  offset += {}_footprint() * ({});\n",
                                        target_name, size_expr_str
                                    )
                                    .unwrap();
                                }
                                _ => {
                                    let elem_type_str = format_type_to_c(element_type);
                                    write!(
                                        fam_offset_code,
                                        "  offset += sizeof( {} ) * ({});\n",
                                        elem_type_str, size_expr_str
                                    )
                                    .unwrap();
                                }
                            }
                        }
                    } else {
                        let mut elem_type_str = format_type_to_c(element_type);
                        if is_nested_complex_type(element_type) {
                            elem_type_str = format!("{}_{}_inner_t", type_name, field.name);
                        }
                        let size_expr_str = format_expr_to_c(&size_expression, &[]);
                        write!(
                            fam_offset_code,
                            "  offset += sizeof( {} ) * ({});\n",
                            elem_type_str, size_expr_str
                        )
                        .unwrap();
                    }
                }
                ResolvedTypeKind::Primitive { prim_type } => {
                    let prim_type_str = primitive_to_c_type(prim_type);
                    write!(
                        fam_offset_code,
                        "  offset += sizeof( {} );\n",
                        prim_type_str
                    )
                    .unwrap();
                }
                ResolvedTypeKind::Enum {
                    tag_expression,
                    variants,
                    ..
                } => {
                    /* For FAM enum fields, generate field reference accessors similar to emit_size_fn_struct */
                    if let Size::Variable(..) = &field.field_type.size {
                        if let Size::Variable(variable_refs) = &resolved_type.size {
                            if let Some(field_map) = variable_refs.get(&field.name) {
                                let non_constant_refs: Vec<String> =
                                    all_field_refs.keys().cloned().collect();
                                let field_prefix = format!("{}.", field.name);

                                /* Create variant_param_map following the BTree pattern */
                                let mut variant_param_map: HashMap<String, Vec<String>> =
                                    HashMap::new();
                                for variant in variants {
                                    let variant_key = format!("{}{}", field.name, variant.name);
                                    if let Some(refs) = variable_refs.get(&variant_key) {
                                        let mut paths: Vec<String> = refs.keys().cloned().collect();
                                        paths.sort();
                                        variant_param_map.insert(variant.name.clone(), paths);
                                    }
                                }

                                /* Build maps for variant references */
                                let mut variant_ref_map: HashMap<
                                    String,
                                    Vec<(String, PrimitiveType)>,
                                > = HashMap::new();
                                let mut variant_ref_order: Vec<String> = Vec::new();

                                for (field_ref, prim_type) in field_map {
                                    let field_ref_str = field_ref.as_str();
                                    if field_ref_str.starts_with(&field_prefix) {
                                        let remainder = &field_ref_str[field_prefix.len()..];
                                        let variant_name =
                                            remainder.split('.').next().unwrap_or_default();
                                        if !variant_name.is_empty() {
                                            variant_ref_map
                                                .entry(variant_name.to_string())
                                                .or_insert_with(Vec::new)
                                                .push((field_ref.clone(), prim_type.clone()));
                                            if !variant_ref_order.contains(&field_ref.clone()) {
                                                variant_ref_order.push(field_ref.clone());
                                            }
                                            continue;
                                        }
                                    }

                                    if declared_refs.insert(field_ref.clone()) {
                                        fam_offset_code.push_str(&generate_nested_field_access(
                                            field_ref_str,
                                            type_name_str,
                                            prim_type,
                                        ));
                                    }
                                }

                                if !variant_ref_map.is_empty() {
                                    for field_ref in &variant_ref_order {
                                        if declared_refs.insert(field_ref.clone()) {
                                            let var_name = field_ref.replace('.', "_");
                                            write!(
                                                fam_offset_code,
                                                "  int64_t {} = 0;\n",
                                                var_name
                                            )
                                            .unwrap();
                                        }
                                    }

                                    let tag_expr_str =
                                        format_expr_to_c(tag_expression, &non_constant_refs);
                                    write!(fam_offset_code, "  switch ( {} ) {{\n", tag_expr_str)
                                        .unwrap();

                                    for variant in variants {
                                        if let Size::Variable(_) = variant.variant_type.size {
                                            if let Some(refs) = variant_ref_map.get(&variant.name) {
                                                write!(
                                                    fam_offset_code,
                                                    "    case {}:\n",
                                                    variant.tag_value
                                                )
                                                .unwrap();
                                                write!(fam_offset_code, "    {{\n").unwrap();
                                                for (field_ref, prim_type) in refs.iter() {
                                                    let var_name = field_ref.replace('.', "_");
                                                    let mut snippet = generate_nested_field_access(
                                                        field_ref.as_str(),
                                                        type_name_str,
                                                        prim_type,
                                                    );
                                                    snippet = snippet.replacen(
                                                        &format!("  int64_t {} = ", var_name),
                                                        &format!("      {} = ", var_name),
                                                        1,
                                                    );
                                                    snippet = snippet.replace("\n  ", "\n      ");
                                                    fam_offset_code.push_str(&snippet);
                                                }
                                                write!(fam_offset_code, "      break;\n").unwrap();
                                                write!(fam_offset_code, "    }}\n").unwrap();
                                            }
                                        }
                                    }

                                    write!(fam_offset_code, "    default:\n").unwrap();
                                    write!(fam_offset_code, "    {{\n").unwrap();
                                    for field_ref in &variant_ref_order {
                                        let var_name = field_ref.replace('.', "_");
                                        write!(fam_offset_code, "      {} = 0;\n", var_name)
                                            .unwrap();
                                    }
                                    write!(fam_offset_code, "      break;\n").unwrap();
                                    write!(fam_offset_code, "    }}\n").unwrap();
                                    write!(fam_offset_code, "  }}\n").unwrap();
                                }

                                /* After generating the switch statement and field accessors, call the footprint function */
                                let mut params: Vec<String> = field_map
                                    .keys()
                                    .map(|field_ref| field_ref.replace(".", "_"))
                                    .collect();
                                params.sort();
                                write!(
                                    fam_offset_code,
                                    "  offset += {}_{}_inner_footprint( {} );\n",
                                    type_name,
                                    field.name,
                                    params.join(", ")
                                )
                                .unwrap();
                            }
                        }
                    } else {
                        /* Const-size enum */
                        write!(
                            fam_offset_code,
                            "  offset += sizeof( {}_{}_inner_t );\n",
                            type_name, field.name
                        )
                        .unwrap();
                    }
                }
                ResolvedTypeKind::SizeDiscriminatedUnion { variants } => {
                    /* Size-discriminated unions have variable runtime size */
                    /* Calculate available size and determine variant */
                    write!(
                        fam_offset_code,
                        "  uint64_t available_size_{} = data_len - offset;\n",
                        escaped_name
                    )
                    .unwrap();
                    write!(fam_offset_code, "  uint64_t {}_size;\n", escaped_name).unwrap();
                    write!(
                        fam_offset_code,
                        "  switch( available_size_{} ) {{\n",
                        escaped_name
                    )
                    .unwrap();
                    for variant in variants {
                        write!(
                            fam_offset_code,
                            "    case {}: {}_size = {}; break;\n",
                            variant.expected_size, escaped_name, variant.expected_size
                        )
                        .unwrap();
                    }
                    write!(fam_offset_code, "    default: return -1; /* No matching variant for size-discriminated union '{}' */\n", field.name).unwrap();
                    write!(fam_offset_code, "  }}\n").unwrap();
                    write!(fam_offset_code, "  offset += {}_size;\n", escaped_name).unwrap();
                }
                ResolvedTypeKind::Struct { .. } | ResolvedTypeKind::Union { .. } => {
                    if let Size::Variable(..) = &field.field_type.size {
                        if let Size::Variable(field_map) = &field.field_type.size {
                            if let Some(field_refs) = field_map.get(&field.name) {
                                /* Generate field accessor code for this field's references */
                                for (field_ref, field_type) in field_refs.iter() {
                                    if declared_refs.insert(field_ref.clone()) {
                                        fam_offset_code.push_str(&generate_nested_field_access(
                                            field_ref,
                                            type_name_str,
                                            field_type,
                                        ));
                                    }
                                }

                                let mut params: Vec<String> = field_refs
                                    .keys()
                                    .map(|field_ref| field_ref.replace(".", "_"))
                                    .collect();
                                params.sort();

                                write!(
                                    fam_offset_code,
                                    "  offset += {}_{}_inner_footprint( {} );\n",
                                    type_name,
                                    field.name,
                                    params.join(", ")
                                )
                                .unwrap();
                            }
                        }
                    } else {
                        write!(
                            fam_offset_code,
                            "  offset += sizeof( {}_{}_inner_t );\n",
                            type_name, field.name
                        )
                        .unwrap();
                    }
                }
                ResolvedTypeKind::TypeRef { target_name, .. } => {
                    if let Size::Variable(..) = &field.field_type.size {
                        if let Size::Variable(field_map) = &field.field_type.size {
                            if let Some(field_refs) = field_map.get(&field.name) {
                                /* Generate field accessor code for this field's references */
                                for (field_ref, field_type) in field_refs.iter() {
                                    if declared_refs.insert(field_ref.clone()) {
                                        fam_offset_code.push_str(&generate_nested_field_access(
                                            field_ref,
                                            type_name_str,
                                            field_type,
                                        ));
                                    }
                                }

                                let mut params: Vec<String> = field_refs
                                    .keys()
                                    .map(|field_ref| field_ref.replace(".", "_"))
                                    .collect();
                                params.sort();

                                write!(
                                    fam_offset_code,
                                    "  offset += {}_{}_footprint( {} );\n",
                                    type_name,
                                    field.name,
                                    params.join(", ")
                                )
                                .unwrap();
                            }
                        }
                    } else {
                        write!(
                            fam_offset_code,
                            "  offset += sizeof( {}_t );\n",
                            target_name
                        )
                        .unwrap();
                    }
                }
            }
        }
    }
    output
}

pub fn emit_accessor_fn_union(resolved_type: &ResolvedType) -> String {
    let mut output = String::new();
    let type_name = sanitize_type_name(&resolved_type.name);

    if let ResolvedTypeKind::Union { variants } = &resolved_type.kind {
        for variant in variants {
            let escaped_variant_name = escape_c_keyword(&variant.name);

            match &variant.field_type.kind {
                ResolvedTypeKind::Primitive { .. } => {
                    let c_type = format_type_to_c(&variant.field_type);
                    writeln!(
                        output,
                        "{} {}_get_{}( {}_t const * self ) {{",
                        c_type, type_name, escaped_variant_name, type_name
                    )
                    .unwrap();
                    writeln!(output, "  {} value;", c_type).unwrap();
                    writeln!(
                        output,
                        "  memcpy( &value, &self->{}, sizeof( value ) );",
                        escaped_variant_name
                    )
                    .unwrap();
                    writeln!(output, "  return value;").unwrap();
                    writeln!(output, "}}\n").unwrap();
                }
                ResolvedTypeKind::Array { element_type, .. } => {
                    let mut element_c_type = format_type_to_c(element_type);
                    if is_nested_complex_type(element_type) {
                        element_c_type = format!("{}_{}_inner_t", type_name, escaped_variant_name);
                    }
                    let return_type = format!("{} const *", element_c_type);
                    writeln!(
                        output,
                        "{} {}_get_{}( {}_t const * self ) {{",
                        return_type, type_name, escaped_variant_name, type_name
                    )
                    .unwrap();
                    writeln!(output, "  return self->{};", escaped_variant_name).unwrap();
                    writeln!(output, "}}\n").unwrap();
                }
                ResolvedTypeKind::TypeRef { target_name, .. } => {
                    /* Const getter */
                    let const_return_type = format!("{}_t const *", target_name);
                    writeln!(
                        output,
                        "{} {}_get_{}_const( {}_t const * self ) {{",
                        const_return_type, type_name, escaped_variant_name, type_name
                    )
                    .unwrap();
                    writeln!(output, "  return &self->{};", escaped_variant_name).unwrap();
                    writeln!(output, "}}\n").unwrap();

                    /* Mutable getter */
                    let mut_return_type = format!("{}_t *", target_name);
                    writeln!(
                        output,
                        "{} {}_get_{}( {}_t * self ) {{",
                        mut_return_type, type_name, escaped_variant_name, type_name
                    )
                    .unwrap();
                    writeln!(output, "  return &self->{};", escaped_variant_name).unwrap();
                    writeln!(output, "}}\n").unwrap();
                }
                _ => {
                    /* Const getter */
                    let const_return_type =
                        format!("{}_{}_inner_t const *", type_name, escaped_variant_name);
                    writeln!(
                        output,
                        "{} {}_get_{}_const( {}_t const * self ) {{",
                        const_return_type, type_name, escaped_variant_name, type_name
                    )
                    .unwrap();
                    writeln!(output, "  return &self->{};", escaped_variant_name).unwrap();
                    writeln!(output, "}}\n").unwrap();

                    /* Mutable getter */
                    let mut_return_type =
                        format!("{}_{}_inner_t *", type_name, escaped_variant_name);
                    writeln!(
                        output,
                        "{} {}_get_{}( {}_t * self ) {{",
                        mut_return_type, type_name, escaped_variant_name, type_name
                    )
                    .unwrap();
                    writeln!(output, "  return &self->{};", escaped_variant_name).unwrap();
                    writeln!(output, "}}\n").unwrap();
                }
            }
        }

        writeln!(
            output,
            "void const * {}_get_variant( {}_t const * self ) {{",
            type_name, type_name
        )
        .unwrap();
        writeln!(
            output,
            "  /* WARNING: unchecked accessor; caller must know which variant is active */"
        )
        .unwrap();
        writeln!(output, "  return (void const *)self;").unwrap();
        writeln!(output, "}}\n").unwrap();
    }

    output
}
pub fn emit_accessor_fn(resolved_type: &ResolvedType) -> String {
    match &resolved_type.kind {
        ResolvedTypeKind::Struct { .. } => emit_accessor_fn_struct(resolved_type),
        ResolvedTypeKind::Union { .. } => emit_accessor_fn_union(resolved_type),
        ResolvedTypeKind::SizeDiscriminatedUnion { variants } => {
            let mut output = String::new();
            let type_name = sanitize_type_name(&resolved_type.name);
            let escaped_type_name = escape_c_keyword(&type_name);

            // Generate tag function: takes size and returns variant tag
            write!(
                output,
                "/* Tag function for size-discriminated union '{}' */\n",
                type_name
            )
            .unwrap();
            write!(
                output,
                "uint8_t {}_tag( uint64_t size ) {{\n",
                escaped_type_name
            )
            .unwrap();
            write!(output, "  switch( size ) {{\n").unwrap();
            for (idx, variant) in variants.iter().enumerate() {
                let variant_ident = escape_c_keyword(&variant.name);
                write!(
                    output,
                    "    case {}: return {}_TAG_{};\n",
                    variant.expected_size,
                    escaped_type_name.to_uppercase(),
                    variant_ident.to_uppercase()
                )
                .unwrap();
            }
            write!(
                output,
                "    default: return 255; /* Invalid size - no matching variant */\n"
            )
            .unwrap();
            write!(output, "  }}\n").unwrap();
            write!(output, "}}\n\n").unwrap();

            output
        }
        _ => {
            /* Unsupported type*/
            String::new()
        }
    }
}
