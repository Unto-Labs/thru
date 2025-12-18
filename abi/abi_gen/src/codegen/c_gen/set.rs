use super::helpers::{
    escape_c_keyword, format_expr_to_c, format_type_to_c, generate_nested_field_access,
    is_nested_complex_type, primitive_to_c_type, sanitize_type_name,
};
use crate::abi::resolved::{ResolvedType, ResolvedTypeKind, Size};
use crate::abi::types::PrimitiveType;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fmt::Write;
pub fn emit_set_fn_union(resolved_type: &ResolvedType) -> String {
    let mut output = String::new();
    let type_name = sanitize_type_name(&resolved_type.name);

    if let ResolvedTypeKind::Union { variants } = &resolved_type.kind {
        /* Emit a setter function for each variant in the union */
        for variant in variants {
            let variant_name = &variant.name;
            let variant_type = &variant.field_type;
            let escaped_variant_name = escape_c_keyword(variant_name);

            match &variant_type.kind {
                ResolvedTypeKind::Primitive { .. } => {
                    let c_type = format_type_to_c(variant_type);

                    writeln!(
                        output,
                        "void {}_set_{}( {}_t * self, {} const * value ) {{",
                        type_name, escaped_variant_name, type_name, c_type
                    )
                    .unwrap();
                    writeln!(
                        output,
                        "  memcpy( &self->{}, value, sizeof( {} ) );",
                        escaped_variant_name, c_type
                    )
                    .unwrap();
                }
                ResolvedTypeKind::Array {
                    element_type,
                    size_expression,
                    ..
                } => {
                    let mut element_c_type = format_type_to_c(element_type);
                    if is_nested_complex_type(element_type) {
                        element_c_type = format!("{}_{}_inner", type_name, escaped_variant_name);
                    }

                    writeln!(
                        output,
                        "void {}_set_{}( {}_t * self, {} const * value, uint64_t len ) {{",
                        type_name, escaped_variant_name, type_name, element_c_type
                    )
                    .unwrap();
                    let expected_len_expr = format_expr_to_c(&size_expression, &[]);
                    writeln!(output, "  assert( len == ({}) );", expected_len_expr).unwrap();
                    writeln!(
                        output,
                        "  memcpy( self->{0}, value, len * sizeof self->{0}[0] );",
                        escaped_variant_name
                    )
                    .unwrap();
                }
                ResolvedTypeKind::TypeRef { target_name, .. } => {
                    let c_type = format!("{}_t", target_name);

                    writeln!(
                        output,
                        "void {}_set_{}( {}_t * self, {} const * value ) {{",
                        type_name, escaped_variant_name, type_name, c_type
                    )
                    .unwrap();
                    writeln!(
                        output,
                        "  memcpy( &self->{}, value, sizeof( {} ) );",
                        escaped_variant_name, c_type
                    )
                    .unwrap();
                }
                _ => {
                    let target_name = format!("{}_{}_inner_t", type_name, escaped_variant_name);
                    writeln!(
                        output,
                        "void {}_set_{}( {}_t * self, {} const * value ) {{",
                        type_name, escaped_variant_name, type_name, target_name
                    )
                    .unwrap();
                    writeln!(
                        output,
                        "  memcpy( &self->{}, value, sizeof( {} ) );",
                        escaped_variant_name, target_name
                    )
                    .unwrap();
                }
            }
            writeln!(output, "}}\n").unwrap();
        }
    }

    output
}

pub fn emit_set_fn_struct(resolved_type: &ResolvedType) -> String {
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

    /* Collect fields that are referenced in size expressions - these should not have setters */
    let mut referenced_fields: HashSet<String> = HashSet::new();
    for field_ref_path in all_field_refs.keys() {
        /* Extract the first component of the path (the field name) */
        if let Some(field_name) = field_ref_path.split('.').next() {
            referenced_fields.insert(field_name.to_string());
        }
    }

    /* Use similar logic as emit_footprint_fn_struct to keep track of: is_fam, after_variable_size_data, fam_offset_code */
    let mut after_variable_size_data = false;
    let mut fam_offset_code = String::new();
    fam_offset_code.push_str("  /* Ghost Field - calculating offset */\n");
    let mut declared_refs: HashSet<String> = HashSet::new();

    if let ResolvedTypeKind::Struct { fields, .. } = &resolved_type.kind {
        /* Then, iterate through each field */
        for field in fields.iter() {
            let escaped_name = escape_c_keyword(&field.name);
            let is_fam = matches!(&field.field_type.size, Size::Variable(_));

            /* Update is_fam, after_variable_size_data, fam_offset_code with the same logic as emit_footprint_fn_struct */
            if is_fam && !after_variable_size_data {
                /* For enum fields, body is inline bytes, not an actual struct field */
                if matches!(&field.field_type.kind, ResolvedTypeKind::Enum { .. }) {
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
                after_variable_size_data = true;
            }

            /* Generate set functions for primitive and TypeRef fields */
            match &field.field_type.kind {
                ResolvedTypeKind::Primitive { prim_type } => {
                    /* Skip fields that are referenced in size expressions (tags, array sizes, etc.) */
                    /* Only init/new can set these fields */
                    if referenced_fields.contains(&field.name) {
                        continue;
                    }

                    let field_type_str = primitive_to_c_type(prim_type);

                    /* The set function itself should take in a self pointer, and the value to set */
                    write!(
                        output,
                        "void {}_set_{}( {}_t * self, {} value ) {{\n",
                        type_name, escaped_name, type_name, field_type_str
                    )
                    .unwrap();

                    /* Perform a memcpy to set the value in the struct at the correct offset (using fam_offset_code if after_variable_size_data is true) */
                    if after_variable_size_data {
                        output.push_str(&fam_offset_code);
                        write!(
                            output,
                            "  memcpy( (unsigned char *)self + offset, &value, sizeof( value ) );\n"
                        )
                        .unwrap();
                    } else {
                        write!(
                            output,
                            "  memcpy( &self->{}, &value, sizeof( value ) );\n",
                            escaped_name
                        )
                        .unwrap();
                    }

                    write!(output, "}}\n\n").unwrap();
                }
                ResolvedTypeKind::TypeRef { target_name, .. } => {
                    /* Skip fields that are referenced in size expressions */
                    if referenced_fields.contains(&field.name) {
                        continue;
                    }

                    /* For TypeRef fields (nested structs), generate setter that accepts const pointer */
                    write!(
                        output,
                        "void {}_set_{}( {}_t * self, {}_t const * value ) {{\n",
                        type_name, escaped_name, type_name, target_name
                    )
                    .unwrap();

                    /* Perform a memcpy to copy the nested struct */
                    if after_variable_size_data {
                        output.push_str(&fam_offset_code);
                        write!(
                            output,
                            "  memcpy( (unsigned char *)self + offset, value, sizeof( {}_t ) );\n",
                            target_name
                        )
                        .unwrap();
                    } else {
                        write!(
                            output,
                            "  memcpy( &self->{}, value, sizeof( {}_t ) );\n",
                            escaped_name, target_name
                        )
                        .unwrap();
                    }

                    write!(output, "}}\n\n").unwrap();
                }
                ResolvedTypeKind::Enum { variants, .. } => {
                    /* For enum fields, generate variant-specific setters AND generic body getter/setter */

                    /* Generic get_body function - returns void pointer to variant data */
                    write!(
                        output,
                        "void const * {}_get_{}( {}_t const * self ) {{\n",
                        type_name, escaped_name, type_name
                    )
                    .unwrap();
                    if after_variable_size_data {
                        output.push_str(&fam_offset_code);
                        write!(
                            output,
                            "  return (void const *)((unsigned char const *)self + offset);\n"
                        )
                        .unwrap();
                    } else {
                        write!(output, "  return (void const *)((unsigned char const *)self + sizeof( {}_t ));\n",
                               type_name).unwrap();
                    }
                    write!(output, "}}\n\n").unwrap();

                    /* Generic set_body function - copies variant data from void pointer */
                    write!(
                        output,
                        "void {}_set_{}( {}_t * self, void const * value ) {{\n",
                        type_name, escaped_name, type_name
                    )
                    .unwrap();
                    write!(
                        output,
                        "  /* Copy variant data - size determined by tag value */\n"
                    )
                    .unwrap();
                    write!(
                        output,
                        "  uint64_t variant_size = {}_size( self ) - sizeof( {}_t );\n",
                        type_name, type_name
                    )
                    .unwrap();
                    if after_variable_size_data {
                        output.push_str(&fam_offset_code);
                        write!(
                            output,
                            "  memcpy( (unsigned char *)self + offset, value, variant_size );\n"
                        )
                        .unwrap();
                    } else {
                        write!(output, "  memcpy( (unsigned char *)self + sizeof( {}_t ), value, variant_size );\n",
                               type_name).unwrap();
                    }
                    write!(output, "}}\n\n").unwrap();

                    /* Variant-specific setters */
                    for variant in variants {
                        let variant_escaped = escape_c_keyword(&variant.name);
                        let variant_type_name =
                            format!("{}_{}_{}_inner_t", type_name, escaped_name, variant_escaped);

                        /* Generate setter for this variant - include field name for disambiguation */
                        write!(
                            output,
                            "void {}_{}_set_{}( {}_t * self, {} const * value ) {{\n",
                            type_name, escaped_name, variant_escaped, type_name, variant_type_name
                        )
                        .unwrap();

                        /* Variant data comes immediately after tag field (enum body is inline) */
                        if after_variable_size_data {
                            output.push_str(&fam_offset_code);
                            write!(output, "  memcpy( (unsigned char *)self + offset, value, sizeof( {} ) );\n",
                                   variant_type_name).unwrap();
                        } else {
                            /* Enum body starts right after the struct (tag is last field before enum) */
                            write!(output, "  memcpy( (unsigned char *)self + sizeof( {}_t ), value, sizeof( {} ) );\n",
                                   type_name, variant_type_name).unwrap();
                        }

                        write!(output, "}}\n\n").unwrap();
                    }
                }
                _ => { /* Skip other field types - no setters for arrays, nested structs/unions */ }
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
                            let elem_type_str = format_type_to_c(element_type);
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
                                            let mut paths: Vec<String> =
                                                refs.keys().cloned().collect();
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
                                            fam_offset_code.push_str(
                                                &generate_nested_field_access(
                                                    field_ref_str,
                                                    type_name_str,
                                                    prim_type,
                                                ),
                                            );
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
                                        write!(
                                            fam_offset_code,
                                            "  switch ( {} ) {{\n",
                                            tag_expr_str
                                        )
                                        .unwrap();

                                        for variant in variants {
                                            if let Size::Variable(_) = variant.variant_type.size {
                                                if let Some(refs) =
                                                    variant_ref_map.get(&variant.name)
                                                {
                                                    write!(
                                                        fam_offset_code,
                                                        "    case {}:\n",
                                                        variant.tag_value
                                                    )
                                                    .unwrap();
                                                    write!(fam_offset_code, "    {{\n").unwrap();
                                                    for (field_ref, prim_type) in refs.iter() {
                                                        let var_name = field_ref.replace('.', "_");
                                                        let mut snippet =
                                                            generate_nested_field_access(
                                                                field_ref.as_str(),
                                                                type_name_str,
                                                                prim_type,
                                                            );
                                                        snippet = snippet.replacen(
                                                            &format!("  int64_t {} = ", var_name),
                                                            &format!("      {} = ", var_name),
                                                            1,
                                                        );
                                                        snippet =
                                                            snippet.replace("\n  ", "\n      ");
                                                        fam_offset_code.push_str(&snippet);
                                                    }
                                                    write!(fam_offset_code, "      break;\n")
                                                        .unwrap();
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
                            write!(
                                fam_offset_code,
                                "  offset += sizeof( {}_{}_inner_t );\n",
                                type_name, field.name
                            )
                            .unwrap();
                        }
                    }
                    ResolvedTypeKind::Struct { .. }
                    | ResolvedTypeKind::Union { .. }
                    | ResolvedTypeKind::SizeDiscriminatedUnion { .. } => {
                        if let Size::Variable(..) = &field.field_type.size {
                            if let Size::Variable(variable_refs) = &resolved_type.size {
                                if let Some(field_refs) = variable_refs.get(&field.name) {
                                    /* Generate field accessor code for this field's references */
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
                            if let Size::Variable(variable_refs) = &resolved_type.size {
                                if let Some(field_refs) = variable_refs.get(&field.name) {
                                    /* Generate field accessor code for this field's references */
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
    }

    output
}
pub fn emit_set_fn_enum(resolved_type: &ResolvedType) -> String {
    let mut output = String::new();
    let type_name = sanitize_type_name(&resolved_type.name);

    if let ResolvedTypeKind::Enum { variants, .. } = &resolved_type.kind {
        /* For enums in structs, generate variant-specific setters */
        /* Note: We do NOT generate a setter for the tag - it's immutable after init */
        for variant in variants {
            let variant_escaped = escape_c_keyword(&variant.name);
            let variant_type_name = format!("{}_{}_{}_inner_t", type_name, "body", variant_escaped);

            /* Generate setter for this variant */
            write!(
                output,
                "void {}_set_{}( {}_t * self, {} const * value ) {{\n",
                type_name, variant_escaped, type_name, variant_type_name
            )
            .unwrap();

            /* Variant data comes immediately after tag field */
            write!(
                output,
                "  memcpy( (unsigned char *)self + sizeof(uint8_t), value, sizeof( {} ) );\n",
                variant_type_name
            )
            .unwrap();
            write!(output, "}}\n\n").unwrap();
        }
    }

    output
}

pub fn emit_set_fn(resolved_type: &ResolvedType) -> String {
    match &resolved_type.kind {
        ResolvedTypeKind::Struct { .. } => emit_set_fn_struct(&resolved_type),
        ResolvedTypeKind::Union { .. } => emit_set_fn_union(&resolved_type),
        ResolvedTypeKind::Enum { .. } => emit_set_fn_enum(&resolved_type),
        ResolvedTypeKind::SizeDiscriminatedUnion { .. } => {
            format!("/* TODO: EMIT SET FN FOR SizeDiscriminatedUnion */\n\n")
        }
        _ => {
            /* Unsupported type*/
            String::new()
        }
    }
}
