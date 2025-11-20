use crate::abi::resolved::{ResolvedType, ResolvedTypeKind, Size};
use crate::abi::types::PrimitiveType;
use crate::abi::expr::ExprKind;
use std::collections::{BTreeMap, HashSet};
use std::fmt::Write;
use super::helpers::format_expr_to_ts;

/* Helper to extract field references from an expression (for from_array parameter matching) */
fn extract_field_refs_from_expr(expr: &ExprKind, refs: &mut HashSet<String>) {
  match expr {
    ExprKind::FieldRef(field_ref) => {
      /* Join the full path with underscores for parameter names */
      refs.insert(field_ref.path.join("_"));
    }
    ExprKind::Add(e) => {
      extract_field_refs_from_expr(&e.left, refs);
      extract_field_refs_from_expr(&e.right, refs);
    }
    ExprKind::Sub(e) => {
      extract_field_refs_from_expr(&e.left, refs);
      extract_field_refs_from_expr(&e.right, refs);
    }
    ExprKind::Mul(e) => {
      extract_field_refs_from_expr(&e.left, refs);
      extract_field_refs_from_expr(&e.right, refs);
    }
    ExprKind::Div(e) => {
      extract_field_refs_from_expr(&e.left, refs);
      extract_field_refs_from_expr(&e.right, refs);
    }
    ExprKind::Mod(e) => {
      extract_field_refs_from_expr(&e.left, refs);
      extract_field_refs_from_expr(&e.right, refs);
    }
    ExprKind::Pow(e) => {
      extract_field_refs_from_expr(&e.left, refs);
      extract_field_refs_from_expr(&e.right, refs);
    }
    ExprKind::BitAnd(e) => {
      extract_field_refs_from_expr(&e.left, refs);
      extract_field_refs_from_expr(&e.right, refs);
    }
    ExprKind::BitOr(e) => {
      extract_field_refs_from_expr(&e.left, refs);
      extract_field_refs_from_expr(&e.right, refs);
    }
    ExprKind::BitXor(e) => {
      extract_field_refs_from_expr(&e.left, refs);
      extract_field_refs_from_expr(&e.right, refs);
    }
    ExprKind::LeftShift(e) => {
      extract_field_refs_from_expr(&e.left, refs);
      extract_field_refs_from_expr(&e.right, refs);
    }
    ExprKind::RightShift(e) => {
      extract_field_refs_from_expr(&e.left, refs);
      extract_field_refs_from_expr(&e.right, refs);
    }
    ExprKind::BitNot(e) => {
      extract_field_refs_from_expr(&e.operand, refs);
    }
    ExprKind::Neg(e) => {
      extract_field_refs_from_expr(&e.operand, refs);
    }
    ExprKind::Not(e) => {
      extract_field_refs_from_expr(&e.operand, refs);
    }
    ExprKind::Popcount(e) => {
      extract_field_refs_from_expr(&e.operand, refs);
    }
    _ => {}
  }
}

/* Helper to extract field refs with dots (for format_expr_to_ts) */
fn extract_refs_with_dots(expr: &ExprKind, refs: &mut HashSet<String>) {
  match expr {
    ExprKind::FieldRef(field_ref) => {
      refs.insert(field_ref.path.join("."));
    }
    ExprKind::Add(e) => {
      extract_refs_with_dots(&e.left, refs);
      extract_refs_with_dots(&e.right, refs);
    }
    ExprKind::Sub(e) => {
      extract_refs_with_dots(&e.left, refs);
      extract_refs_with_dots(&e.right, refs);
    }
    ExprKind::Mul(e) => {
      extract_refs_with_dots(&e.left, refs);
      extract_refs_with_dots(&e.right, refs);
    }
    ExprKind::Div(e) => {
      extract_refs_with_dots(&e.left, refs);
      extract_refs_with_dots(&e.right, refs);
    }
    ExprKind::Mod(e) => {
      extract_refs_with_dots(&e.left, refs);
      extract_refs_with_dots(&e.right, refs);
    }
    ExprKind::Pow(e) => {
      extract_refs_with_dots(&e.left, refs);
      extract_refs_with_dots(&e.right, refs);
    }
    ExprKind::BitAnd(e) => {
      extract_refs_with_dots(&e.left, refs);
      extract_refs_with_dots(&e.right, refs);
    }
    ExprKind::BitOr(e) => {
      extract_refs_with_dots(&e.left, refs);
      extract_refs_with_dots(&e.right, refs);
    }
    ExprKind::BitXor(e) => {
      extract_refs_with_dots(&e.left, refs);
      extract_refs_with_dots(&e.right, refs);
    }
    ExprKind::LeftShift(e) => {
      extract_refs_with_dots(&e.left, refs);
      extract_refs_with_dots(&e.right, refs);
    }
    ExprKind::RightShift(e) => {
      extract_refs_with_dots(&e.left, refs);
      extract_refs_with_dots(&e.right, refs);
    }
    ExprKind::BitNot(e) => {
      extract_refs_with_dots(&e.operand, refs);
    }
    ExprKind::Neg(e) => {
      extract_refs_with_dots(&e.operand, refs);
    }
    ExprKind::Not(e) => {
      extract_refs_with_dots(&e.operand, refs);
    }
    ExprKind::Popcount(e) => {
      extract_refs_with_dots(&e.operand, refs);
    }
    _ => {}
  }
}

/* Emit the static footprint() method for a type */
pub fn emit_footprint_method(resolved_type: &ResolvedType) -> String {
  match &resolved_type.kind {
    ResolvedTypeKind::Struct { .. } => emit_struct_footprint(resolved_type),
    ResolvedTypeKind::Enum { .. } => emit_enum_footprint(resolved_type),
    ResolvedTypeKind::Union { .. } => emit_union_footprint(resolved_type),
    _ => String::new(),
  }
}

/* Emit footprint method for structs */
fn emit_struct_footprint(resolved_type: &ResolvedType) -> String {
  let mut output = String::new();
  let _class_name = &resolved_type.name;

  match &resolved_type.size {
    Size::Const(size) => {
      /* Constant size - simple static method */
      write!(output, "  static footprint(): number {{\n").unwrap();
      write!(output, "    return {};\n", size).unwrap();
      write!(output, "  }}\n\n").unwrap();
    }
    Size::Variable(_variable_refs) => {
      /* Variable size - method with parameters */
      /* Extract field refs the same way from_array does to ensure consistent parameter names */
      let mut field_refs_set = HashSet::new();

      if let ResolvedTypeKind::Struct { fields, .. } = &resolved_type.kind {
        for field in fields {
          /* For arrays with variable size, extract all field refs from size expression */
          if let ResolvedTypeKind::Array { size_expression, .. } = &field.field_type.kind {
            if !matches!(field.field_type.size, Size::Const(..)) {
              extract_field_refs_from_expr(size_expression, &mut field_refs_set);
            }
          }
          /* For enums with variable size, extract field refs from tag expression */
          if let ResolvedTypeKind::Enum { tag_expression, .. } = &field.field_type.kind {
            if !matches!(field.field_type.size, Size::Const(..)) {
              extract_field_refs_from_expr(tag_expression, &mut field_refs_set);
            }
          }
          /* For size-discriminated unions, tag parameter is passed directly (not extracted from expression) */
          if let ResolvedTypeKind::SizeDiscriminatedUnion { .. } = &field.field_type.kind {
            // Tag parameter will be added separately below
          }
          /* For nested inline structs, extract field refs from their fields */
          if let ResolvedTypeKind::Struct { fields: nested_fields, .. } = &field.field_type.kind {
            for nested_field in nested_fields {
              /* Extract refs from nested struct's arrays */
              if let ResolvedTypeKind::Array { size_expression, .. } = &nested_field.field_type.kind {
                if !matches!(nested_field.field_type.size, Size::Const(..)) {
                  extract_field_refs_from_expr(size_expression, &mut field_refs_set);
                }
              }
              /* Extract refs from nested struct's enums */
              if let ResolvedTypeKind::Enum { tag_expression, .. } = &nested_field.field_type.kind {
                if !matches!(nested_field.field_type.size, Size::Const(..)) {
                  extract_field_refs_from_expr(tag_expression, &mut field_refs_set);
                }
              }
            }
          }
        }
      }

      /* Convert to sorted Vec for consistent parameter ordering */
      let mut param_names: Vec<String> = field_refs_set.into_iter().collect();
      param_names.sort();

      /* Build parameter list - include tag values for enums */
      let mut params: Vec<String> = Vec::new();

      /* First add array size parameters */
      for ref_name in &param_names {
        if !ref_name.starts_with("_enum_tag_") {
          params.push(format!("{}: number", ref_name));
        }
      }

      /* Then add enum tag parameters */
      if let ResolvedTypeKind::Struct { fields, .. } = &resolved_type.kind {
        for field in fields {
          if let ResolvedTypeKind::Enum { tag_expression, .. } = &field.field_type.kind {
            if !matches!(field.field_type.size, Size::Const(..)) {
              if let crate::abi::expr::ExprKind::FieldRef(field_ref) = tag_expression {
                let tag_param = field_ref.path.join("_");
                if !params.iter().any(|p| p.contains(&tag_param)) {
                  params.push(format!("{}: number", tag_param));
                }
              }
            }
          }
          /* Add tag parameters for size-discriminated unions */
          if let ResolvedTypeKind::SizeDiscriminatedUnion { .. } = &field.field_type.kind {
            let tag_param = format!("{}_tag", field.name);
            if !params.iter().any(|p| p.contains(&tag_param)) {
              params.push(format!("{}: number", tag_param));
            }
          }
        }
      }

      if params.is_empty() {
        write!(output, "  static footprint(): number {{\n").unwrap();
      } else {
        write!(output, "  static footprint({}): number {{\n", params.join(", ")).unwrap();
      }

      /* Calculate size based on fields */
      if let ResolvedTypeKind::Struct { fields, .. } = &resolved_type.kind {
        let mut offset_expr = String::new();
        let mut first = true;
        let mut after_fam = false;

        for field in fields {
          let is_fam = matches!(&field.field_type.size, Size::Variable(..));

          if !after_fam {
            /* Before FAM - static offset */
            if let Size::Const(field_size) = field.field_type.size {
              if !first {
                offset_expr.push_str(" + ");
              }
              write!(offset_expr, "{}", field_size).unwrap();
              first = false;
            }
          }

          if is_fam {
            after_fam = true;

            /* Add FAM size calculation */
            if let ResolvedTypeKind::Array { element_type, size_expression, .. } = &field.field_type.kind {
              if let Size::Variable(field_map) = &field.field_type.size {
                if let Some(field_refs) = field_map.get(&field.name) {
                  let non_constant_refs: Vec<String> = field_refs.keys().cloned().collect();
                  let size_expr = format_expr_to_ts(&size_expression, &non_constant_refs);

                  if !first {
                    offset_expr.push_str(" + ");
                  }

                  if let Size::Const(elem_size) = element_type.size {
                    write!(offset_expr, "({} * {})", size_expr, elem_size).unwrap();
                  } else {
                    write!(offset_expr, "({})", size_expr).unwrap();
                  }
                  first = false;
                }
              }
            }

            /* Add enum size calculation */
            if let ResolvedTypeKind::Enum { tag_expression, variants, .. } = &field.field_type.kind {
              if !matches!(field.field_type.size, Size::Const(..)) {
                if let crate::abi::expr::ExprKind::FieldRef(field_ref) = tag_expression {
                  let tag_var = field_ref.path.join("_");

                  if !first {
                    offset_expr.push_str(" + ");
                  }

                  /* Generate inline switch expression for enum size based on tag */
                  write!(offset_expr, "((() => {{\n").unwrap();
                  write!(offset_expr, "      switch ({}) {{\n", tag_var).unwrap();
                  for variant in variants {
                    if let Size::Const(variant_size) = variant.variant_type.size {
                      write!(offset_expr, "        case {}: return {};\n", variant.tag_value, variant_size).unwrap();
                    }
                  }
                  write!(offset_expr, "        default: throw new Error('Invalid enum tag');\n").unwrap();
                  write!(offset_expr, "      }}\n").unwrap();
                  write!(offset_expr, "    }})())").unwrap();
                  first = false;
                }
              }
            }

            /* Add size-discriminated union size calculation */
            if let ResolvedTypeKind::SizeDiscriminatedUnion { variants } = &field.field_type.kind {
              let tag_param = format!("{}_tag", field.name);

              if !first {
                offset_expr.push_str(" + ");
              }

              /* Generate inline switch expression for size-discriminated union size based on tag */
              write!(offset_expr, "((() => {{\n").unwrap();
              write!(offset_expr, "      switch ({}) {{\n", tag_param).unwrap();
              for (idx, variant) in variants.iter().enumerate() {
                write!(offset_expr, "        case {}: return {};\n", idx, variant.expected_size).unwrap();
              }
              write!(offset_expr, "        default: throw new Error('Invalid tag for size-discriminated union');\n").unwrap();
              write!(offset_expr, "      }}\n").unwrap();
              write!(offset_expr, "    }})())").unwrap();
              first = false;
            }

            /* Add nested inline struct size calculation */
            if let ResolvedTypeKind::Struct { fields: nested_fields, .. } = &field.field_type.kind {
              /* Nested inline struct - calculate size of its fields */
              for nested_field in nested_fields {
                /* Handle variable-size arrays in nested struct */
                if let ResolvedTypeKind::Array { element_type, size_expression, .. } = &nested_field.field_type.kind {
                  if !matches!(nested_field.field_type.size, Size::Const(..)) {
                    /* Variable-size array in nested struct */
                    /* Use param_names for consistent variable naming */
                    let size_expr = format_expr_to_ts(&size_expression, &param_names);

                    if !first {
                      offset_expr.push_str(" + ");
                    }

                    if let Size::Const(elem_size) = element_type.size {
                      write!(offset_expr, "({} * {})", size_expr, elem_size).unwrap();
                    } else {
                      write!(offset_expr, "({})", size_expr).unwrap();
                    }
                    first = false;
                  } else {
                    /* Constant-size array in nested struct */
                    if let Size::Const(array_size) = nested_field.field_type.size {
                      if !first {
                        offset_expr.push_str(" + ");
                      }
                      write!(offset_expr, "{}", array_size).unwrap();
                      first = false;
                    }
                  }
                } else if let Size::Const(nested_field_size) = nested_field.field_type.size {
                  /* Other constant-size fields in nested struct */
                  if !first {
                    offset_expr.push_str(" + ");
                  }
                  write!(offset_expr, "{}", nested_field_size).unwrap();
                  first = false;
                }
              }
            }
          } else if after_fam {
            /* After FAM - add constant size */
            if let Size::Const(field_size) = field.field_type.size {
              if !first {
                offset_expr.push_str(" + ");
              }
              write!(offset_expr, "{}", field_size).unwrap();
              first = false;
            }
          }
        }

        if offset_expr.is_empty() {
          offset_expr = "0".to_string();
        }

        write!(output, "    return {};\n", offset_expr).unwrap();
      } else {
        write!(output, "    return 0; /* TODO: Calculate variable size */\n").unwrap();
      }

      write!(output, "  }}\n\n").unwrap();
    }
  }

  output
}

/* Emit footprint method for enums */
fn emit_enum_footprint(resolved_type: &ResolvedType) -> String {
  let mut output = String::new();

  match &resolved_type.size {
    Size::Const(size) => {
      write!(output, "  static footprint(): number {{\n").unwrap();
      write!(output, "    return {};\n", size).unwrap();
      write!(output, "  }}\n\n").unwrap();
    }
    Size::Variable(_) => {
      /* For variable-size enums, we need tag parameter to determine size */
      if let ResolvedTypeKind::Enum { variants, .. } = &resolved_type.kind {
        write!(output, "  static footprint(tag: number): number {{\n").unwrap();
        write!(output, "    switch (tag) {{\n").unwrap();

        for variant in variants {
          if let Size::Const(variant_size) = variant.variant_type.size {
            write!(output, "      case {}: return {};\n", variant.tag_value, variant_size).unwrap();
          } else {
            write!(output, "      case {}: throw new Error('Variable-size enum variant not yet supported');\n", variant.tag_value).unwrap();
          }
        }

        write!(output, "      default: throw new Error('Invalid enum tag value');\n").unwrap();
        write!(output, "    }}\n").unwrap();
        write!(output, "  }}\n\n").unwrap();
      } else {
        write!(output, "  static footprint(tag: number): number {{\n").unwrap();
        write!(output, "    throw new Error('Invalid enum type');\n").unwrap();
        write!(output, "  }}\n\n").unwrap();
      }
    }
  }

  output
}

/* Emit footprint method for unions */
fn emit_union_footprint(resolved_type: &ResolvedType) -> String {
  let mut output = String::new();

  if let Size::Const(size) = resolved_type.size {
    write!(output, "  static footprint(): number {{\n").unwrap();
    write!(output, "    return {};\n", size).unwrap();
    write!(output, "  }}\n\n").unwrap();
  }

  output
}
