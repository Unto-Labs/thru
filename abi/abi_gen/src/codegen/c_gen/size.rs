use crate::abi::resolved::{ResolvedType, ResolvedTypeKind, Size};
use crate::abi::types::PrimitiveType;
use std::collections::{HashMap, BTreeMap, HashSet};
use std::fmt::Write;
use super::helpers::{format_expr_to_c, generate_nested_field_access};

fn emit_size_fn_struct(resolved_type: &ResolvedType) -> String {
  let mut output = String::new();
  let type_name = &resolved_type.name;

  match &resolved_type.size {
    Size::Const(_size) => {
      /* CASE 1: Constant size - return sizeof the type */
      write!(output, "uint64_t {}_size( {}_t const * self ) {{\n", type_name, type_name).unwrap();
      write!(output, "  return sizeof( {}_t );\n", type_name).unwrap();
      write!(output, "}}\n\n").unwrap();
    }

    Size::Variable(variable_refs) => {
      /* CASE 2: Variable size - gather referenced fields and call footprint */
      write!(output, "uint64_t {}_size( {}_t const * self ) {{\n", type_name, type_name).unwrap();

      let mut all_field_refs: BTreeMap<String, PrimitiveType> = BTreeMap::new();
      for refs in variable_refs.values() {
        for (ref_path, prim_type) in refs {
          all_field_refs.entry(ref_path.clone()).or_insert_with(|| prim_type.clone());
        }
      }

      let non_constant_refs: Vec<String> = all_field_refs.keys().cloned().collect();
      let param_names: Vec<String> = non_constant_refs.iter().map(|field_ref| field_ref.replace('.', "_")).collect();
      let mut declared_refs: HashSet<String> = HashSet::new();

      if let ResolvedTypeKind::Struct { fields, .. } = &resolved_type.kind {
        for field in fields {
          if let Some(field_map) = variable_refs.get(&field.name) {
            match &field.field_type.kind {
              ResolvedTypeKind::Enum { tag_expression, variants, .. } => {
                let field_prefix = format!("{}.", field.name);

                // Create variant_param_map following the BTree pattern
                let mut variant_param_map: HashMap<String, Vec<String>> = HashMap::new();
                for variant in variants {
                  let variant_key = format!("{}{}", field.name, variant.name);
                  if let Some(refs) = variable_refs.get(&variant_key) {
                    let mut paths: Vec<String> = refs.keys().cloned().collect();
                    paths.sort();
                    variant_param_map.insert(variant.name.clone(), paths);
                  }
                }

                // Build maps for variant references
                let mut variant_ref_map: HashMap<String, Vec<(String, PrimitiveType)>> = HashMap::new();
                let mut variant_ref_order: Vec<String> = Vec::new();

                for (field_ref, prim_type) in field_map {
                  let field_ref_str = field_ref.as_str();
                  if field_ref_str.starts_with(&field_prefix) {
                    let remainder = &field_ref_str[field_prefix.len()..];
                    let variant_name = remainder.split('.').next().unwrap_or_default();
                    if !variant_name.is_empty() {
                      variant_ref_map.entry(variant_name.to_string()).or_insert_with(Vec::new).push((field_ref.clone(), prim_type.clone()));
                      if !variant_ref_order.contains(field_ref) {
                        variant_ref_order.push(field_ref.clone());
                      }
                      continue;
                    }
                  }

                  if declared_refs.insert(field_ref.clone()) {
                    output.push_str(&generate_nested_field_access(field_ref_str, type_name, prim_type));
                  }
                }

                if !variant_ref_map.is_empty() {
                  for field_ref in &variant_ref_order {
                    if declared_refs.insert(field_ref.clone()) {
                      let var_name = field_ref.replace('.', "_");
                      write!(output, "  int64_t {} = 0;\n", var_name).unwrap();
                    }
                  }

                  let tag_expr_str = format_expr_to_c(tag_expression, &non_constant_refs);
                  write!(output, "  switch ( {} ) {{\n", tag_expr_str).unwrap();

                  for variant in variants {
                    if let Size::Variable(_) = variant.variant_type.size {
                      if let Some(refs) = variant_ref_map.get(&variant.name) {
                        write!(output, "    case {}:\n", variant.tag_value).unwrap();
                        write!(output, "    {{\n").unwrap();
                        for (field_ref, prim_type) in refs.iter() {
                          let var_name = field_ref.replace('.', "_");
                          let mut snippet = generate_nested_field_access(field_ref.as_str(), type_name, prim_type);
                          snippet = snippet.replacen(&format!("  int64_t {} = ", var_name), &format!("      {} = ", var_name), 1);
                          snippet = snippet.replace("\n  ", "\n      ");
                          output.push_str(&snippet);
                        }
                        write!(output, "      break;\n").unwrap();
                        write!(output, "    }}\n").unwrap();
                      }
                    }
                  }

                  write!(output, "    default:\n").unwrap();
                  write!(output, "    {{\n").unwrap();
                  for field_ref in &variant_ref_order {
                    let var_name = field_ref.replace('.', "_");
                    write!(output, "      {} = 0;\n", var_name).unwrap();
                  }
                  write!(output, "      break;\n").unwrap();
                  write!(output, "    }}\n").unwrap();
                  write!(output, "  }}\n").unwrap();
                }
              }
              _ => {
                let mut ordered_refs: Vec<(String, PrimitiveType)> = field_map.iter().map(|(k, v)| (k.clone(), v.clone())).collect();
                ordered_refs.sort_by(|a, b| a.0.cmp(&b.0));
                for (field_ref, prim_type) in ordered_refs {
                  if declared_refs.insert(field_ref.clone()) {
                    output.push_str(&generate_nested_field_access(field_ref.as_str(), type_name, &prim_type));
                  }
                }
              }
            }
          }
        }
      }

      for field_ref in &non_constant_refs {
        if !declared_refs.contains(field_ref) {
          let var_name = field_ref.replace('.', "_");
          write!(output, "  int64_t {} = 0;\n", var_name).unwrap();
        }
      }

      if param_names.is_empty() {
        write!(output, "  return {}_footprint();\n", type_name).unwrap();
      } else {
        write!(output, "  return {}_footprint( {} );\n", type_name, param_names.join(", ")).unwrap();
      }

      write!(output, "}}\n\n").unwrap();
    }
  }

  output
}

pub fn emit_size_fn(resolved_type: &ResolvedType) -> String {
  match &resolved_type.kind {
    ResolvedTypeKind::Struct { .. } => emit_size_fn_struct(&resolved_type),
    ResolvedTypeKind::Union { .. } => {
        let mut output = String::new();
        write!(output, "uint64_t {}_size( void ) {{\n", resolved_type.name).unwrap();
        write!(output, "  return sizeof( {}_t );\n", resolved_type.name).unwrap();
        write!(output, "}}\n\n").unwrap();
        output
    }
    ResolvedTypeKind::SizeDiscriminatedUnion { .. } => {
      format!("/* TODO: EMIT SIZE FN FOR SizeDiscriminatedUnion */\n\n")
    }
    _ => {
      /* Unsupported type*/
      String::new()
    }
  }
}
