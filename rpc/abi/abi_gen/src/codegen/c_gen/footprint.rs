use super::helpers::{
    escape_c_keyword, flatten_size_refs, flatten_variable_refs_map, format_expr_to_c,
    format_type_to_c, is_nested_complex_type, primitive_to_c_type, sanitize_type_name,
    variable_ref_param_names,
};
use super::ir_footprint::{resolve_param_binding, sanitize_symbol};
use crate::abi::resolved::{ResolvedType, ResolvedTypeKind, Size};
use crate::abi::types::PrimitiveType;
use crate::codegen::shared::ir::TypeIr;
use std::collections::{BTreeMap, HashMap};
use std::fmt::Write;

fn emit_footprint_signature(
    type_name: &str,
    field_refs: &BTreeMap<String, PrimitiveType>,
    extra_params: &[String],
    output: &mut String,
) -> Vec<String> {
    write!(output, "uint64_t {}_footprint( ", type_name).unwrap();
    let mut param_names = Vec::new();
    if field_refs.is_empty() && extra_params.is_empty() {
        write!(output, "void ) {{\n").unwrap();
        return param_names;
    }

    let mut params: Vec<String> = variable_ref_param_names(field_refs)
        .into_iter()
        .map(|param| {
            let sanitized = sanitize_symbol(&param);
            param_names.push(sanitized.clone());
            format!("int64_t {}", sanitized)
        })
        .collect();
    for extra in extra_params {
        if let Some(name) = extra.split_whitespace().last() {
            let sanitized = sanitize_symbol(name);
            if param_names.iter().any(|existing| existing == &sanitized) {
                continue;
            }
            param_names.push(sanitized);
            params.push(extra.clone());
        } else {
            params.push(extra.clone());
        }
    }
    write!(output, "{} ) {{\n", params.join(", ")).unwrap();
    param_names
}

/* Recursively collect nested type definitions and emit their footprint functions */
pub fn collect_and_emit_nested_footprints(
    type_def: &ResolvedType,
    type_path: Option<&str>,
    output: &mut String,
) {
    // Phase 1: Recursively process all nested complex types first
    match &type_def.kind {
        ResolvedTypeKind::Struct { fields, .. } => {
            let current_path = type_path.unwrap_or(&type_def.name);
            for field in fields {
                if is_nested_complex_type(&field.field_type) {
                    let nested_path = format!("{}_{}", current_path, escape_c_keyword(&field.name));
                    collect_and_emit_nested_footprints(
                        &field.field_type,
                        Some(&nested_path),
                        output,
                    );
                }
            }
        }
        ResolvedTypeKind::Union { variants } => {
            let current_path = type_path.unwrap_or(&type_def.name);
            for variant in variants {
                if is_nested_complex_type(&variant.field_type) {
                    let nested_path =
                        format!("{}_{}", current_path, escape_c_keyword(&variant.name));
                    collect_and_emit_nested_footprints(
                        &variant.field_type,
                        Some(&nested_path),
                        output,
                    );
                }
            }
        }
        ResolvedTypeKind::Enum { variants, .. } => {
            let current_path = type_path.unwrap_or(&type_def.name);
            for variant in variants {
                if is_nested_complex_type(&variant.variant_type) {
                    let nested_path =
                        format!("{}_{}", current_path, escape_c_keyword(&variant.name));
                    collect_and_emit_nested_footprints(
                        &variant.variant_type,
                        Some(&nested_path),
                        output,
                    );
                }
            }
        }
        ResolvedTypeKind::SizeDiscriminatedUnion { variants } => {
            let current_path = type_path.unwrap_or(&type_def.name);
            for variant in variants {
                if is_nested_complex_type(&variant.variant_type) {
                    let nested_path =
                        format!("{}_{}", current_path, escape_c_keyword(&variant.name));
                    collect_and_emit_nested_footprints(
                        &variant.variant_type,
                        Some(&nested_path),
                        output,
                    );
                }
            }
        }
        _ => {}
    }

    // Phase 2: Emit footprint for current nested type (only if it's a nested path)
    if type_path.is_some() && is_nested_complex_type(type_def) {
        let mut nested_type = type_def.clone();
        nested_type.name = format!("{}_inner", type_path.unwrap());
        output.push_str(&emit_footprint_fn(&nested_type, None));
    }
}

fn emit_footprint_fn_struct(resolved_type: &ResolvedType, type_ir: Option<&TypeIr>) -> String {
    let mut output = String::new();
    let type_name = sanitize_type_name(&resolved_type.name);

    if let Size::Const(_size) = resolved_type.size {
        /* Case 1: Constant size - emit simple sizeof function with no parameters */
        let mut ir_call_data = None;
        if let Some(ir) = type_ir {
            match prepare_ir_footprint_call(ir, &[]) {
                Ok(data) => ir_call_data = Some(data),
                Err(_) => {}
            }
        }

        write!(output, "uint64_t {}_footprint( void ) {{\n", type_name).unwrap();
        if let (Some(ir), Some(ref data)) = (type_ir, ir_call_data.as_ref()) {
            writeln!(output, "  return {};", build_ir_call(ir, &data.args)).unwrap();
            write!(output, "}}\n\n").unwrap();
            return output;
        }
        writeln!(output, "  return sizeof( {}_t );", type_name).unwrap();
        write!(output, "}}\n\n").unwrap();
        return output;
    }

    let mut all_field_refs = flatten_size_refs(&resolved_type.size);
    if let ResolvedTypeKind::Struct { fields, .. } = &resolved_type.kind {
        for field in fields {
            if matches!(
                &field.field_type.kind,
                ResolvedTypeKind::SizeDiscriminatedUnion { .. }
            ) {
                let payload_key = format!("{}_payload_size", field.name);
                all_field_refs.remove(&payload_key);
            }
        }
    }

    // Collect payload size parameters for size-discriminated union fields
    let sdu_payload_params: Vec<String> = Vec::new();
    let sdu_payload_names: Vec<String> = Vec::new();

    // intake all as int64_t for now (so we can do asserts and expr calculations)
    let mut footprint_params = emit_footprint_signature(
        &type_name,
        &all_field_refs,
        &sdu_payload_params,
        &mut output,
    );
    footprint_params.extend_from_slice(&sdu_payload_names);

    let mut ir_call_data = None;
    let mut ir_missing_comment = None;
    if let Some(ir) = type_ir {
        match prepare_ir_footprint_call(ir, &footprint_params) {
            Ok(data) => ir_call_data = Some(data),
            Err(missing) => {
                if !missing.is_empty() {
                    ir_missing_comment = Some(format!(
                        "IR footprint check skipped (missing params: {})",
                        missing.join(", ")
                    ));
                }
            }
        }
    }

    if let (Some(ir), Some(ref data)) = (type_ir, ir_call_data.as_ref()) {
        writeln!(output, "  return {};", build_ir_call(ir, &data.args)).unwrap();
        write!(output, "}}\n\n").unwrap();
        return output;
    }

    if let Some(msg) = ir_missing_comment.as_ref() {
        writeln!(output, "  /* {} */", msg).unwrap();
    }

    let mut after_variable_size_data = false;
    if let ResolvedTypeKind::Struct { fields, .. } = &resolved_type.kind {
        for field in fields {
            let is_fam = matches!(&field.field_type.size, Size::Variable(..));
            if is_fam && !after_variable_size_data {
                /* For enum fields and size-discriminated unions, the body is inline bytes, not an actual struct field */
                if matches!(
                    &field.field_type.kind,
                    ResolvedTypeKind::Enum { .. } | ResolvedTypeKind::SizeDiscriminatedUnion { .. }
                ) {
                    write!(output, "  uint64_t offset = sizeof( {}_t );\n", type_name).unwrap();
                } else {
                    write!(
                        output,
                        "  uint64_t offset = offsetof( {}_t, {} );\n",
                        type_name, field.name
                    )
                    .unwrap();
                }
                after_variable_size_data = true;
            }

            if after_variable_size_data {
                match &field.field_type.kind {
                    ResolvedTypeKind::Array {
                        element_type,
                        size_expression,
                        ..
                    } => {
                        if let Size::Variable(field_map) = &field.field_type.size {
                            if let Some(_field_refs) = field_map.get(&field.name) {
                                let size_expr_str =
                                    format_expr_to_c(&size_expression, footprint_params.as_slice());

                                // Assert that array size is non-negative
                                write!(output, "  assert( ({}) >= 0 );\n", size_expr_str).unwrap();

                                match &element_type.kind {
                                    ResolvedTypeKind::TypeRef { target_name, .. } => {
                                        write!(
                                            output,
                                            "  offset += {}_footprint() * ({});\n",
                                            target_name, size_expr_str
                                        )
                                        .unwrap();
                                    }
                                    _ => {
                                        let mut elem_type_str = format_type_to_c(element_type);
                                        if is_nested_complex_type(element_type) {
                                            elem_type_str =
                                                format!("{}_{}_inner_t", type_name, field.name);
                                        }
                                        write!(
                                            output,
                                            "  offset += sizeof( {} ) * ({});\n",
                                            elem_type_str, size_expr_str
                                        )
                                        .unwrap();
                                    }
                                }
                            }
                        } else {
                            // Array size is constant
                            let mut elem_type_str = format_type_to_c(element_type);
                            if is_nested_complex_type(element_type) {
                                elem_type_str = format!("{}_{}_inner_t", type_name, field.name);
                            }
                            let size_expr_str = format_expr_to_c(&size_expression, &[]);
                            write!(
                                output,
                                "  offset += sizeof( {} ) * ({});\n",
                                elem_type_str, size_expr_str
                            )
                            .unwrap();
                        }
                    }
                    ResolvedTypeKind::Primitive { prim_type } => {
                        let prim_type_str = primitive_to_c_type(prim_type);
                        write!(output, "  offset += sizeof( {} );\n", prim_type_str).unwrap();
                    }
                    ResolvedTypeKind::Enum {
                        tag_expression,
                        variants,
                        ..
                    } => {
                        /* For enum fields, calculate size based on tag value */
                        if let Size::Variable(..) = &field.field_type.size {
                            /* Variable-size enum - switch on tag to get variant size */
                            if let Size::Variable(variable_refs) = &resolved_type.size {
                                if let Some(_field_refs) = variable_refs.get(&field.name) {
                                    let tag_expr_str = format_expr_to_c(
                                        tag_expression,
                                        footprint_params.as_slice(),
                                    );

                                    write!(output, "  switch ( {} ) {{\n", tag_expr_str).unwrap();

                                    /* Generate case for each variant */
                                    for variant in variants {
                                        let variant_ident = escape_c_keyword(&variant.name);
                                        write!(output, "    case {}:\n", variant.tag_value)
                                            .unwrap();
                                        write!(output, "    {{\n").unwrap();

                                        match &variant.variant_type.size {
                                            Size::Const(size) => {
                                                write!(output, "      offset += {};\n", size)
                                                    .unwrap();
                                            }
                                            Size::Variable(_) => {
                                                /* Call variant's footprint function */
                                                let variant_type_name = format!(
                                                    "{}_{}_inner",
                                                    type_name, variant_ident
                                                );
                                                if let Some(variant_refs) = variable_refs
                                                    .get(&format!("{}{}", field.name, variant.name))
                                                {
                                                    let variant_params: Vec<String> = variant_refs
                                                        .keys()
                                                        .map(|r| r.replace(".", "_"))
                                                        .collect();
                                                    write!(
                                                        output,
                                                        "      offset += {}_footprint( {} );\n",
                                                        variant_type_name,
                                                        variant_params.join(", ")
                                                    )
                                                    .unwrap();
                                                } else {
                                                    write!(
                                                        output,
                                                        "      offset += {}_footprint();\n",
                                                        variant_type_name
                                                    )
                                                    .unwrap();
                                                }
                                            }
                                        }

                                        write!(output, "      break;\n").unwrap();
                                        write!(output, "    }}\n").unwrap();
                                    }

                                    write!(output, "    default:\n").unwrap();
                                    write!(output, "      break;\n").unwrap();
                                    write!(output, "  }}\n").unwrap();
                                }
                            }
                        } else {
                            /* Constant-size enum - all variants same size */
                            if let Size::Const(size) = &field.field_type.size {
                                write!(output, "  offset += {};\n", size).unwrap();
                            }
                        }
                    }
                    ResolvedTypeKind::SizeDiscriminatedUnion { variants } => {
                        // Size-discriminated union: size determined from payload size parameter
                        let payload_param =
                            sanitize_symbol(&format!("{}_payload_size", field.name));
                        write!(output, "  switch( {} ) {{\n", payload_param).unwrap();
                        for variant in variants {
                            write!(output, "    case {}:\n", variant.expected_size).unwrap();
                            write!(output, "      offset += {};\n", variant.expected_size).unwrap();
                            write!(output, "      break;\n").unwrap();
                        }
                        write!(output, "    default:\n").unwrap();
                        write!(output, "      break;\n").unwrap();
                        write!(output, "  }}\n").unwrap();
                    }
                    ResolvedTypeKind::Struct { .. } | ResolvedTypeKind::Union { .. } => {
                        if let Size::Variable(..) = &field.field_type.size {
                            // Handle variable size nested structs/unions
                            if let Size::Variable(variable_refs) = &resolved_type.size {
                                if let Some(field_refs) = variable_refs.get(&field.name) {
                                    let mut params: Vec<String> = field_refs
                                        .keys()
                                        .map(|field_ref| field_ref.replace(".", "_"))
                                        .collect();
                                    params.sort();

                                    write!(
                                        output,
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
                                output,
                                "  offset += sizeof( {}_{}_inner_t );\n",
                                type_name, field.name
                            )
                            .unwrap();
                        }
                    }
                    ResolvedTypeKind::TypeRef { target_name, .. } => {
                        if let Size::Variable(..) = &field.field_type.size {
                            // Handle variable size nested structs/unions/enums
                            if let Size::Variable(variable_refs) = &resolved_type.size {
                                if let Some(field_refs) = variable_refs.get(&field.name) {
                                    let mut params: Vec<String> = field_refs
                                        .keys()
                                        .map(|field_ref| field_ref.replace(".", "_"))
                                        .collect();
                                    params.sort();

                                    write!(
                                        output,
                                        "  offset += {}_{}_footprint( {} );\n",
                                        type_name,
                                        field.name,
                                        params.join(", ")
                                    )
                                    .unwrap();
                                }
                            }
                        } else {
                            write!(output, "  offset += sizeof( {}_t );\n", target_name).unwrap();
                        }
                    }
                }
            }
        }
    }

    write!(output, "  return offset;\n").unwrap();
    write!(output, "}}\n\n").unwrap();

    output
}

fn emit_footprint_fn_enum(resolved_type: &ResolvedType, type_ir: Option<&TypeIr>) -> String {
    let mut output = String::new();
    let type_name = sanitize_type_name(&resolved_type.name);

    if let Size::Const(_size) = resolved_type.size {
        write!(output, "uint64_t {}_footprint( void ) {{\n", type_name).unwrap();
        if let Some(ir) = type_ir {
            writeln!(output, "  return {};", build_ir_call(ir, &[])).unwrap();
        } else {
            writeln!(output, "  return sizeof( {}_t );", type_name).unwrap();
        }
        write!(output, "}}\n\n").unwrap();
        return output;
    }

    let (tag_expression, variants, variable_refs) = match (&resolved_type.kind, &resolved_type.size)
    {
        (
            ResolvedTypeKind::Enum {
                tag_expression,
                variants,
                ..
            },
            Size::Variable(variable_refs),
        ) => (tag_expression, variants, variable_refs),
        _ => return output,
    };

    let all_field_refs = flatten_variable_refs_map(variable_refs);

    let mut variant_param_map: HashMap<String, Vec<String>> = HashMap::new();
    for variant in variants {
        if let Some(refs) = variable_refs.get(&variant.name) {
            let mut paths: Vec<String> = refs.keys().cloned().collect();
            paths.sort();
            variant_param_map.insert(variant.name.clone(), paths);
        }
    }

    let footprint_params = emit_footprint_signature(&type_name, &all_field_refs, &[], &mut output);
    let mut ir_call_data = None;
    let mut ir_missing_comment = None;
    if let Some(ir) = type_ir {
        match prepare_ir_footprint_call(ir, &footprint_params) {
            Ok(data) => ir_call_data = Some(data),
            Err(missing) => {
                if !missing.is_empty() {
                    ir_missing_comment = Some(format!(
                        "IR footprint check skipped (missing params: {})",
                        missing.join(", ")
                    ));
                }
            }
        }
    }

    if let (Some(ir), Some(ref data)) = (type_ir, ir_call_data.as_ref()) {
        writeln!(output, "  return {};", build_ir_call(ir, &data.args)).unwrap();
        write!(output, "}}\n\n").unwrap();
        return output;
    }

    if let Some(msg) = ir_missing_comment.as_ref() {
        writeln!(output, "  /* {} */", msg).unwrap();
    }

    let non_constant_refs: Vec<String> = all_field_refs
        .keys()
        .map(|ref_path| ref_path.replace('.', "_"))
        .collect();
    let tag_expr_str = format_expr_to_c(tag_expression, &non_constant_refs);

    write!(output, "  uint64_t size = 0;\n").unwrap();
    write!(output, "  switch ( {} ) {{\n", tag_expr_str).unwrap();

    let type_prefix = type_name
        .strip_suffix("_inner")
        .unwrap_or(type_name.as_str());

    // Generate cases for all variants
    for variant in variants {
        write!(output, "    case {}:\n", variant.tag_value).unwrap();
        write!(output, "    {{\n").unwrap();

        let variant_ident = escape_c_keyword(&variant.name);
        match &variant.variant_type.size {
            Size::Const(size) => {
                write!(output, "      size = {};\n", size).unwrap();
            }
            Size::Variable(_) => {
                let fn_name = format!("{}_{}_inner_footprint", type_prefix, variant_ident);
                let params: Vec<String> = variant_param_map
                    .get(&variant.name)
                    .cloned()
                    .unwrap_or_default()
                    .into_iter()
                    .map(|ref_path| ref_path.replace('.', "_"))
                    .collect();

                if params.is_empty() {
                    write!(output, "      size = {}();\n", fn_name).unwrap();
                } else {
                    write!(
                        output,
                        "      size = {}( {} );\n",
                        fn_name,
                        params.join(", ")
                    )
                    .unwrap();
                }
            }
        }

        write!(output, "      break;\n").unwrap();
        write!(output, "    }}\n").unwrap();
    }

    // Default case - should never be reached if tag is validated
    write!(output, "    default:\n").unwrap();
    write!(output, "      break;\n").unwrap();
    write!(output, "  }}\n").unwrap();
    write!(output, "  return size;\n").unwrap();
    write!(output, "}}\n\n").unwrap();

    output
}

pub fn emit_footprint_fn(resolved_type: &ResolvedType, type_ir: Option<&TypeIr>) -> String {
    match &resolved_type.kind {
        ResolvedTypeKind::Struct { .. } => emit_footprint_fn_struct(&resolved_type, type_ir),
        ResolvedTypeKind::Enum { .. } => emit_footprint_fn_enum(&resolved_type, type_ir),
        ResolvedTypeKind::Union { .. } => {
            let mut output = String::new();
            let type_name = sanitize_type_name(&resolved_type.name);
            write!(output, "uint64_t {}_footprint( void ) {{\n", type_name).unwrap();
            write!(output, "  return sizeof( {}_t );\n", type_name).unwrap();
            write!(output, "}}\n\n").unwrap();
            output
        }
        ResolvedTypeKind::SizeDiscriminatedUnion { variants } => {
            let type_name = sanitize_type_name(&resolved_type.name);
            emit_size_discriminated_union_footprint(&type_name, variants, type_ir)
        }
        _ => {
            /* Unsupported type*/
            String::new()
        }
    }
}

fn emit_size_discriminated_union_footprint(
    type_name: &str,
    variants: &[crate::abi::resolved::ResolvedSizeDiscriminatedVariant],
    type_ir: Option<&TypeIr>,
) -> String {
    let mut output = String::new();
    let payload_param = sanitize_symbol(&format!("{}_payload_size", type_name));
    write!(
        output,
        "uint64_t {}_footprint( uint64_t {}_payload_size ) {{\n",
        type_name, type_name
    )
    .unwrap();
    if let Some(ir) = type_ir {
        writeln!(
            output,
            "  return {};",
            build_ir_call(ir, &[payload_param.clone()])
        )
        .unwrap();
        write!(output, "}}\n\n").unwrap();
        return output;
    }
    write!(output, "  uint64_t result = 0ULL;\n").unwrap();
    write!(output, "  switch( {}_payload_size ) {{\n", type_name).unwrap();
    for variant in variants {
        write!(output, "    case {}:\n", variant.expected_size).unwrap();
        write!(output, "      result = {};\n", variant.expected_size).unwrap();
        write!(output, "      break;\n").unwrap();
    }
    write!(output, "    default:\n").unwrap();
    write!(output, "      result = 0ULL;\n").unwrap();
    write!(output, "      break;\n").unwrap();
    write!(output, "  }}\n").unwrap();
    write!(output, "  return result;\n}}\n\n").unwrap();
    output
}

fn build_ir_call(type_ir: &TypeIr, params: &[String]) -> String {
    let fn_name = sanitize_symbol(&format!("{}_footprint_ir", type_ir.type_name));
    if params.is_empty() {
        format!("{}()", fn_name)
    } else {
        let args = params
            .iter()
            .map(|p| format!("(uint64_t){}", p))
            .collect::<Vec<_>>()
            .join(", ");
        format!("{}( {} )", fn_name, args)
    }
}

struct IrFootprintCallData {
    args: Vec<String>,
}

fn prepare_ir_footprint_call(
    type_ir: &TypeIr,
    available_params: &[String],
) -> Result<IrFootprintCallData, Vec<String>> {
    let mut args = Vec::new();
    let mut missing = Vec::new();
    for param in &type_ir.parameters {
        let sanitized = sanitize_symbol(&param.name.replace('.', "_"));
        if let Some(binding) = resolve_param_binding(&sanitized, available_params) {
            args.push(binding.clone());
        } else {
            missing.push(sanitized);
        }
    }
    if missing.is_empty() {
        Ok(IrFootprintCallData { args })
    } else {
        Err(missing)
    }
}
