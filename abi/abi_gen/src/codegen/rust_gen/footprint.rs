/* Footprint function generation for Rust ABI code */

use crate::abi::resolved::{ResolvedType, ResolvedTypeKind, Size};
use crate::abi::types::PrimitiveType;
use std::collections::BTreeMap;
use std::fmt::Write;
use super::helpers::{format_expr_to_rust, primitive_to_rust_type, format_type_to_rust, is_nested_complex_type};

/* Recursively collect nested type definitions and emit their footprint functions */
pub fn collect_and_emit_nested_footprints(
  type_def: &ResolvedType,
  type_path: Option<&str>,
  output: &mut String,
) {
  /* Phase 1: Recursively process all nested complex types first */
  match &type_def.kind {
    ResolvedTypeKind::Struct { fields, .. } => {
      let current_path = type_path.unwrap_or(&type_def.name);
      for field in fields {
        if is_nested_complex_type(&field.field_type) {
          let nested_path = format!("{}_{}", current_path, field.name);
          collect_and_emit_nested_footprints(&field.field_type, Some(&nested_path), output);
        }
      }
    }
    ResolvedTypeKind::Union { variants } => {
      let current_path = type_path.unwrap_or(&type_def.name);
      for variant in variants {
        if is_nested_complex_type(&variant.field_type) {
          let nested_path = format!("{}_{}", current_path, variant.name);
          collect_and_emit_nested_footprints(&variant.field_type, Some(&nested_path), output);
        }
      }
    }
    ResolvedTypeKind::Enum { variants, .. } => {
      let current_path = type_path.unwrap_or(&type_def.name);
      for variant in variants {
        if is_nested_complex_type(&variant.variant_type) {
          let nested_path = format!("{}_{}", current_path, variant.name);
          collect_and_emit_nested_footprints(&variant.variant_type, Some(&nested_path), output);
        }
      }
    }
    ResolvedTypeKind::SizeDiscriminatedUnion { variants } => {
      let current_path = type_path.unwrap_or(&type_def.name);
      for variant in variants {
        if is_nested_complex_type(&variant.variant_type) {
          let nested_path = format!("{}_{}", current_path, variant.name);
          collect_and_emit_nested_footprints(&variant.variant_type, Some(&nested_path), output);
        }
      }
    }
    _ => {}
  }

  /* Phase 2: Emit footprint for current nested type (only if it's a nested path) */
  if type_path.is_some() && is_nested_complex_type(type_def) {
    let mut nested_type = type_def.clone();
    nested_type.name = format!("{}_inner", type_path.unwrap());
    output.push_str(&emit_footprint_fn(&nested_type));
  }
}

fn emit_footprint_fn_struct(resolved_type: &ResolvedType) -> String {
  let mut output = String::new();
  let type_name = &resolved_type.name;

  if let Size::Const(_size) = resolved_type.size {
    /* Case 1: Constant size - emit simple sizeof function with no parameters */
    write!(output, "pub fn {}_footprint() -> u64 {{\n", type_name).unwrap();
    write!(output, "    std::mem::size_of::<{}_t>() as u64\n", type_name).unwrap();
    write!(output, "}}\n\n").unwrap();
    return output;
  }

  let mut all_field_refs: BTreeMap<String, PrimitiveType> = BTreeMap::new();
  if let Size::Variable(variable_refs) = &resolved_type.size {
    for inner_refs in variable_refs.values() {
      for (ref_path, prim_type) in inner_refs {
        all_field_refs.entry(ref_path.clone()).or_insert_with(|| prim_type.clone());
      }
    }
  }

  /* Generate function signature with field reference parameters */
  write!(output, "pub fn {}_footprint(", type_name).unwrap();
  if all_field_refs.is_empty() {
    write!(output, ") -> u64 {{\n").unwrap();
  } else {
    let params: Vec<String> = all_field_refs
      .iter()
      .map(|(ref_path, prim_type)| {
        format!("{}: {}", ref_path.replace('.', "_"), primitive_to_rust_type(prim_type))
      })
      .collect();
    write!(output, "{}) -> u64 {{\n", params.join(", ")).unwrap();
  }

  let mut after_fam = false;
  if let ResolvedTypeKind::Struct { fields, .. } = &resolved_type.kind {
    for field in fields {
      let is_fam = matches!(&field.field_type.size, Size::Variable(..));
      if is_fam && !after_fam {
        write!(output, "    let mut offset: u64 = std::mem::offset_of!({}_t, {}) as u64;\n", type_name, field.name).unwrap();
        after_fam = true;
      }

      if after_fam {
        match &field.field_type.kind {
          ResolvedTypeKind::Primitive { prim_type } => {
            write!(output, "    offset += std::mem::size_of::<{}>() as u64;\n", primitive_to_rust_type(prim_type)).unwrap();
          }
          ResolvedTypeKind::Array { element_type, .. } => {
            if let Size::Variable(var_refs) = &field.field_type.size {
              /* Get all field references for this FAM */
              let field_refs: Vec<String> = var_refs
                .values()
                .flat_map(|refs| refs.keys().cloned())
                .collect();

              /* Build size expression */
              let params: Vec<String> = all_field_refs.keys().cloned().collect();
              let size_expr = if let Some(var_map) = var_refs.values().next() {
                if let Some((first_ref, _)) = var_map.iter().next() {
                  format_expr_to_rust(&crate::abi::expr::ExprKind::FieldRef(
                    crate::abi::expr::FieldRefExpr { path: first_ref.split('.').map(|s| s.to_string()).collect() }
                  ), &params)
                } else {
                  "0".to_string()
                }
              } else {
                "0".to_string()
              };

              let elem_size = match &element_type.size {
                Size::Const(s) => format!("{}", s),
                Size::Variable(_) => {
                  /* Nested FAM - recursive footprint call */
                  let nested_params: Vec<String> = field_refs.iter().map(|r| r.replace('.', "_")).collect();
                  if nested_params.is_empty() {
                    format!("{}_footprint()", format_type_to_rust(element_type))
                  } else {
                    format!("{}_footprint({})", format_type_to_rust(element_type), nested_params.join(", "))
                  }
                }
              };

              write!(output, "    offset += ({} * {}) as u64;\n", size_expr, elem_size).unwrap();
            }
          }
          ResolvedTypeKind::TypeRef { .. } | ResolvedTypeKind::Struct { .. } | ResolvedTypeKind::Union { .. } => {
            if let Size::Variable(var_refs) = &field.field_type.size {
              /* Variable-sized nested type */
              let field_refs: Vec<String> = var_refs
                .values()
                .flat_map(|refs| refs.keys().map(|r| r.replace('.', "_")))
                .collect();

              if field_refs.is_empty() {
                write!(output, "    offset += {}_footprint() as u64;\n", format_type_to_rust(&field.field_type)).unwrap();
              } else {
                write!(output, "    offset += {}_footprint({}) as u64;\n", format_type_to_rust(&field.field_type), field_refs.join(", ")).unwrap();
              }
            } else {
              /* Constant-sized nested type */
              write!(output, "    offset += std::mem::size_of::<{}>() as u64;\n", format_type_to_rust(&field.field_type)).unwrap();
            }
          }
          _ => {}
        }
      }
    }
  }

  if after_fam {
    write!(output, "    offset\n").unwrap();
  } else {
    write!(output, "    std::mem::size_of::<{}_t>() as u64\n", type_name).unwrap();
  }

  write!(output, "}}\n\n").unwrap();
  output
}

fn emit_footprint_fn_enum(resolved_type: &ResolvedType) -> String {
  let mut output = String::new();
  let type_name = &resolved_type.name;

  if let Size::Const(_size) = resolved_type.size {
    /* Constant size enum */
    write!(output, "pub fn {}_footprint() -> u64 {{\n", type_name).unwrap();
    write!(output, "    std::mem::size_of::<{}_t>() as u64\n", type_name).unwrap();
    write!(output, "}}\n\n").unwrap();
    return output;
  }

  /* Variable size enum - needs variant parameter */
  if let ResolvedTypeKind::Enum { variants, .. } = &resolved_type.kind {
    /* Collect all field references from all variants */
    let mut all_field_refs: BTreeMap<String, PrimitiveType> = BTreeMap::new();
    for variant in variants {
      if let Size::Variable(var_refs) = &variant.variant_type.size {
        for inner_refs in var_refs.values() {
          for (ref_path, prim_type) in inner_refs {
            all_field_refs.entry(ref_path.clone()).or_insert_with(|| prim_type.clone());
          }
        }
      }
    }

    write!(output, "pub fn {}_footprint(tag: u64", type_name).unwrap();
    for (ref_path, prim_type) in &all_field_refs {
      write!(output, ", {}: {}", ref_path.replace('.', "_"), primitive_to_rust_type(prim_type)).unwrap();
    }
    write!(output, ") -> u64 {{\n").unwrap();

    write!(output, "    match tag {{\n").unwrap();
    for variant in variants {
      write!(output, "        {} => ", variant.tag_value).unwrap();
      if let Size::Const(s) = variant.variant_type.size {
        write!(output, "{},\n", s).unwrap();
      } else {
        /* Variable-sized variant */
        if let Size::Variable(var_refs) = &variant.variant_type.size {
          let field_refs: Vec<String> = var_refs
            .values()
            .flat_map(|refs| refs.keys().map(|r| r.replace('.', "_")))
            .collect();

          if field_refs.is_empty() {
            write!(output, "{}_footprint(),\n", format_type_to_rust(&variant.variant_type)).unwrap();
          } else {
            write!(output, "{}_footprint({}),\n", format_type_to_rust(&variant.variant_type), field_refs.join(", ")).unwrap();
          }
        } else {
          write!(output, "std::mem::size_of::<{}>() as u64,\n", format_type_to_rust(&variant.variant_type)).unwrap();
        }
      }
    }
    write!(output, "        _ => 0,  /* Invalid tag */\n").unwrap();
    write!(output, "    }}\n").unwrap();
    write!(output, "}}\n\n").unwrap();
  }

  output
}

fn emit_footprint_fn_union(resolved_type: &ResolvedType) -> String {
  let mut output = String::new();
  let type_name = &resolved_type.name;

  /* Unions always have constant size (size of largest variant) */
  write!(output, "pub fn {}_footprint() -> u64 {{\n", type_name).unwrap();
  write!(output, "    std::mem::size_of::<{}_t>() as u64\n", type_name).unwrap();
  write!(output, "}}\n\n").unwrap();

  output
}

pub fn emit_footprint_fn(resolved_type: &ResolvedType) -> String {
  match &resolved_type.kind {
    ResolvedTypeKind::Struct { .. } => emit_footprint_fn_struct(resolved_type),
    ResolvedTypeKind::Enum { .. } => emit_footprint_fn_enum(resolved_type),
    ResolvedTypeKind::Union { .. } => emit_footprint_fn_union(resolved_type),
    ResolvedTypeKind::SizeDiscriminatedUnion { .. } => emit_footprint_fn_union(resolved_type),
    _ => String::new(),
  }
}
