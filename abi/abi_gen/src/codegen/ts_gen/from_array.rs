use crate::abi::resolved::{ResolvedType, ResolvedTypeKind, Size, ConstantStatus};
use crate::abi::expr::ExprKind;
use std::fmt::Write;
use std::collections::HashSet;
use super::helpers::{format_expr_to_ts, primitive_to_dataview_getter, primitive_size};

/* Helper to extract all field references from an expression recursively */
/* Stores refs joined with underscores (for from_array parameter naming) */
fn extract_field_refs(expr: &ExprKind, refs: &mut HashSet<String>) {
  match expr {
    ExprKind::FieldRef(field_ref) => {
      refs.insert(field_ref.path.join("_"));
    }
    /* Binary operations - extract from both sides */
    ExprKind::Add(e) => {
      extract_field_refs(&e.left, refs);
      extract_field_refs(&e.right, refs);
    }
    ExprKind::Sub(e) => {
      extract_field_refs(&e.left, refs);
      extract_field_refs(&e.right, refs);
    }
    ExprKind::Mul(e) => {
      extract_field_refs(&e.left, refs);
      extract_field_refs(&e.right, refs);
    }
    ExprKind::Div(e) => {
      extract_field_refs(&e.left, refs);
      extract_field_refs(&e.right, refs);
    }
    ExprKind::Mod(e) => {
      extract_field_refs(&e.left, refs);
      extract_field_refs(&e.right, refs);
    }
    ExprKind::Pow(e) => {
      extract_field_refs(&e.left, refs);
      extract_field_refs(&e.right, refs);
    }
    ExprKind::BitAnd(e) => {
      extract_field_refs(&e.left, refs);
      extract_field_refs(&e.right, refs);
    }
    ExprKind::BitOr(e) => {
      extract_field_refs(&e.left, refs);
      extract_field_refs(&e.right, refs);
    }
    ExprKind::BitXor(e) => {
      extract_field_refs(&e.left, refs);
      extract_field_refs(&e.right, refs);
    }
    ExprKind::LeftShift(e) => {
      extract_field_refs(&e.left, refs);
      extract_field_refs(&e.right, refs);
    }
    ExprKind::RightShift(e) => {
      extract_field_refs(&e.left, refs);
      extract_field_refs(&e.right, refs);
    }
    /* Unary operations - extract from operand */
    ExprKind::BitNot(e) => {
      extract_field_refs(&e.operand, refs);
    }
    ExprKind::Neg(e) => {
      extract_field_refs(&e.operand, refs);
    }
    ExprKind::Not(e) => {
      extract_field_refs(&e.operand, refs);
    }
    ExprKind::Popcount(e) => {
      extract_field_refs(&e.operand, refs);
    }
    _ => {} /* Literals, sizeof, alignof don't reference fields */
  }
}

/* Helper to extract field references with dots (for format_expr_to_ts) */
fn extract_field_refs_with_dots(expr: &ExprKind, refs: &mut HashSet<String>) {
  match expr {
    ExprKind::FieldRef(field_ref) => {
      refs.insert(field_ref.path.join("."));
    }
    /* Binary operations - extract from both sides */
    ExprKind::Add(e) => {
      extract_field_refs_with_dots(&e.left, refs);
      extract_field_refs_with_dots(&e.right, refs);
    }
    ExprKind::Sub(e) => {
      extract_field_refs_with_dots(&e.left, refs);
      extract_field_refs_with_dots(&e.right, refs);
    }
    ExprKind::Mul(e) => {
      extract_field_refs_with_dots(&e.left, refs);
      extract_field_refs_with_dots(&e.right, refs);
    }
    ExprKind::Div(e) => {
      extract_field_refs_with_dots(&e.left, refs);
      extract_field_refs_with_dots(&e.right, refs);
    }
    ExprKind::Mod(e) => {
      extract_field_refs_with_dots(&e.left, refs);
      extract_field_refs_with_dots(&e.right, refs);
    }
    ExprKind::Pow(e) => {
      extract_field_refs_with_dots(&e.left, refs);
      extract_field_refs_with_dots(&e.right, refs);
    }
    ExprKind::BitAnd(e) => {
      extract_field_refs_with_dots(&e.left, refs);
      extract_field_refs_with_dots(&e.right, refs);
    }
    ExprKind::BitOr(e) => {
      extract_field_refs_with_dots(&e.left, refs);
      extract_field_refs_with_dots(&e.right, refs);
    }
    ExprKind::BitXor(e) => {
      extract_field_refs_with_dots(&e.left, refs);
      extract_field_refs_with_dots(&e.right, refs);
    }
    ExprKind::LeftShift(e) => {
      extract_field_refs_with_dots(&e.left, refs);
      extract_field_refs_with_dots(&e.right, refs);
    }
    ExprKind::RightShift(e) => {
      extract_field_refs_with_dots(&e.left, refs);
      extract_field_refs_with_dots(&e.right, refs);
    }
    /* Unary operations - extract from operand */
    ExprKind::BitNot(e) => {
      extract_field_refs_with_dots(&e.operand, refs);
    }
    ExprKind::Neg(e) => {
      extract_field_refs_with_dots(&e.operand, refs);
    }
    ExprKind::Not(e) => {
      extract_field_refs_with_dots(&e.operand, refs);
    }
    ExprKind::Popcount(e) => {
      extract_field_refs_with_dots(&e.operand, refs);
    }
    _ => {} /* Literals, sizeof, alignof don't reference fields */
  }
}

/* Emit the static from_array() method for a type */
pub fn emit_from_array_method(resolved_type: &ResolvedType) -> String {
  match &resolved_type.kind {
    ResolvedTypeKind::Struct { .. } => emit_struct_from_array(resolved_type),
    ResolvedTypeKind::Enum { .. } => emit_enum_from_array(resolved_type),
    ResolvedTypeKind::Union { .. } => emit_union_from_array(resolved_type),
    _ => String::new(),
  }
}

/* Emit from_array() method for structs */
fn emit_struct_from_array(resolved_type: &ResolvedType) -> String {
  let mut output = String::new();
  let class_name = &resolved_type.name;

  write!(output, "  static from_array(buffer: Uint8Array): {} | null {{\n", class_name).unwrap();

  /* Determine if we need to create a view early for variable-size validation */
  let needs_early_view = matches!(&resolved_type.size, Size::Variable(_));

  /* Validate minimum buffer size */
  match &resolved_type.size {
    Size::Const(size) => {
      write!(output, "    /* Validate buffer size for constant-size struct */\n").unwrap();
      write!(output, "    if (buffer.length < {}) {{\n", size).unwrap();
      write!(output, "      return null; /* Buffer too small */\n").unwrap();
      write!(output, "    }}\n\n").unwrap();
    }
    Size::Variable(_) => {
      write!(output, "    /* Variable-size struct - validate based on field values */\n").unwrap();
      if needs_early_view {
        write!(output, "    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);\n\n").unwrap();
      }

      /* Read field references and calculate expected size */
      if let ResolvedTypeKind::Struct { fields, .. } = &resolved_type.kind {
        let mut offset: u64 = 0;
        let mut offset_is_runtime = false;
        let mut offset_expr = String::from("0");

        for field in fields {
          if matches!(field.field_type.kind, ResolvedTypeKind::Enum { .. }) {
            /* Enum fields are ghost fields - skip their data in offset calculation */
            if let Size::Const(field_size) = field.field_type.size {
              offset += field_size;
              if offset_is_runtime {
                offset_expr = format!("{} + {}", offset_expr, field_size);
              }
            } else {
              /* Variable-size enum - offset becomes runtime-dependent */
              if !offset_is_runtime {
                /* First variable-size enum */
                offset_expr = offset.to_string();
              }
              offset_is_runtime = true;

              /* Add enum size calculation to offset expression */
              if let ResolvedTypeKind::Enum { tag_expression, .. } = &field.field_type.kind {
                if let ExprKind::FieldRef(field_ref) = tag_expression {
                  let tag_var = field_ref.path.join("_");
                  write!(output, "    const {}_size = (() => {{\n", field.name).unwrap();
                  write!(output, "      switch ({}) {{\n", tag_var).unwrap();

                  /* Generate size calculation for each variant */
                  if let ResolvedTypeKind::Enum { variants, .. } = &field.field_type.kind {
                    for variant in variants {
                      if let Size::Const(variant_size) = variant.variant_type.size {
                        write!(output, "        case {}: return {};\n", variant.tag_value, variant_size).unwrap();
                      }
                    }
                  }

                  write!(output, "        default: throw new Error('Invalid enum tag');\n").unwrap();
                  write!(output, "      }}\n").unwrap();
                  write!(output, "    }})();\n").unwrap();

                  offset_expr = format!("{} + {}_size", offset_expr, field.name);
                }
              }
            }
          } else if let ResolvedTypeKind::Struct { fields: nested_fields, .. } = &field.field_type.kind {
            /* Nested inline struct - read its primitive fields */
            for nested_field in nested_fields {
              if let ResolvedTypeKind::Primitive { prim_type } = &nested_field.field_type.kind {
                let getter = primitive_to_dataview_getter(prim_type);
                let needs_le = primitive_size(prim_type) > 1;
                let nested_var_name = format!("{}_{}", field.name, nested_field.name);

                if offset_is_runtime {
                  /* Read nested field at dynamic offset */
                  if needs_le {
                    write!(output, "    const {} = view.{}({}, true);\n",
                           nested_var_name, getter, offset_expr).unwrap();
                  } else {
                    write!(output, "    const {} = view.{}({});\n",
                           nested_var_name, getter, offset_expr).unwrap();
                  }

                  if let Size::Const(field_size) = nested_field.field_type.size {
                    offset_expr = format!("{} + {}", offset_expr, field_size);
                  }
                } else {
                  /* Read nested field at static offset */
                  if needs_le {
                    write!(output, "    const {} = view.{}({}, true);\n",
                           nested_var_name, getter, offset).unwrap();
                  } else {
                    write!(output, "    const {} = view.{}({});\n",
                           nested_var_name, getter, offset).unwrap();
                  }

                  if let Size::Const(field_size) = nested_field.field_type.size {
                    offset += field_size;
                  }
                }
              } else if let Size::Const(field_size) = nested_field.field_type.size {
                /* Other constant-size nested fields - just update offset */
                if offset_is_runtime {
                  offset_expr = format!("{} + {}", offset_expr, field_size);
                } else {
                  offset += field_size;
                }
              }
            }
          } else if matches!(field.field_type.size, Size::Const(..)) {
            /* Read constant-size field for size calculation */
            if let ResolvedTypeKind::Primitive { prim_type } = &field.field_type.kind {
              let getter = primitive_to_dataview_getter(prim_type);
              let needs_le = primitive_size(prim_type) > 1;

              if offset_is_runtime {
                /* Read field at dynamic offset */
                if needs_le {
                  write!(output, "    const {} = view.{}({}, true);\n",
                         field.name.replace(".", "_"), getter, offset_expr).unwrap();
                } else {
                  write!(output, "    const {} = view.{}({});\n",
                         field.name.replace(".", "_"), getter, offset_expr).unwrap();
                }

                if let Size::Const(field_size) = field.field_type.size {
                  offset_expr = format!("{} + {}", offset_expr, field_size);
                }
              } else {
                /* Read field at static offset */
                if needs_le {
                  write!(output, "    const {} = view.{}({}, true);\n",
                         field.name.replace(".", "_"), getter, offset).unwrap();
                } else {
                  write!(output, "    const {} = view.{}({});\n",
                         field.name.replace(".", "_"), getter, offset).unwrap();
                }

                if let Size::Const(field_size) = field.field_type.size {
                  offset += field_size;
                }
              }
            }
          } else if let ResolvedTypeKind::Array { element_type, size_expression, .. } = &field.field_type.kind {
            /* Variable-size array - update offset tracking */
            if let Size::Const(elem_size) = element_type.size {
              /* Extract field references from the size expression */
              let mut array_field_refs = HashSet::new();
              extract_field_refs(size_expression, &mut array_field_refs);
              let field_refs_vec: Vec<String> = array_field_refs.into_iter().collect();
              let size_expr_ts = format_expr_to_ts(size_expression, &field_refs_vec);

              if !offset_is_runtime {
                /* First variable field - switch to runtime offset tracking */
                offset_expr = offset.to_string();
                offset_is_runtime = true;
              }

              /* Add array size to offset expression */
              offset_expr = format!("{} + ({}) * {}", offset_expr, size_expr_ts, elem_size);
            }
          }
        }

        /* Check if we have size-discriminated union fields that need tag parameters */
        let mut has_sdu_fields = false;
        let mut sdu_field_info: Option<(String, Vec<(u64, usize)>)> = None;
        for field in fields {
          if let ResolvedTypeKind::SizeDiscriminatedUnion { variants } = &field.field_type.kind {
            has_sdu_fields = true;
            let variants_info: Vec<(u64, usize)> = variants.iter().enumerate().map(|(idx, v)| (v.expected_size, idx)).collect();
            sdu_field_info = Some((field.name.clone(), variants_info));
            break; /* Only one SDU per struct */
          }
        }

        let tag_param_name = if has_sdu_fields {
          /* For size-discriminated unions, calculate tag from buffer size before calling footprint */
          if let Some((ref field_name, ref variants_info)) = sdu_field_info {
            let tag_param = format!("{}_tag", field_name);
            write!(output, "\n    const {} = (() => {{\n", tag_param).unwrap();
            write!(output, "      const available_size = buffer.length - 1; /* offset to SDU field */\n").unwrap();
            write!(output, "      switch (available_size) {{\n").unwrap();
            for (expected_size, idx) in variants_info {
              write!(output, "        case {}: return {};\n", expected_size, idx).unwrap();
            }
            write!(output, "        default: return 255; /* Invalid size */\n").unwrap();
            write!(output, "      }}\n").unwrap();
            write!(output, "    }})();\n").unwrap();
            Some(tag_param)
          } else {
            None
          }
        } else {
          None
        };

        /* Calculate total required size including enum bodies */
        write!(output, "\n    let required_size = {}.footprint(", class_name).unwrap();

        /* Pass field values for size calculation */
        let mut field_refs = HashSet::new();
        for field in fields {
          /* For arrays with variable size, extract all field refs from size expression */
          if let ResolvedTypeKind::Array { size_expression, .. } = &field.field_type.kind {
            if !matches!(field.field_type.size, Size::Const(..)) {
              extract_field_refs(size_expression, &mut field_refs);
            }
          }
          /* For enums with variable size, extract field refs from tag expression */
          if let ResolvedTypeKind::Enum { tag_expression, .. } = &field.field_type.kind {
            if !matches!(field.field_type.size, Size::Const(..)) {
              extract_field_refs(tag_expression, &mut field_refs);
            }
          }
          /* For nested inline structs, extract field refs from their fields */
          if let ResolvedTypeKind::Struct { fields: nested_fields, .. } = &field.field_type.kind {
            for nested_field in nested_fields {
              /* Extract refs from nested struct's arrays */
              if let ResolvedTypeKind::Array { size_expression, .. } = &nested_field.field_type.kind {
                if !matches!(nested_field.field_type.size, Size::Const(..)) {
                  extract_field_refs(size_expression, &mut field_refs);
                }
              }
              /* Extract refs from nested struct's enums */
              if let ResolvedTypeKind::Enum { tag_expression, .. } = &nested_field.field_type.kind {
                if !matches!(nested_field.field_type.size, Size::Const(..)) {
                  extract_field_refs(tag_expression, &mut field_refs);
                }
              }
            }
          }
        }

        /* Convert HashSet to sorted Vec for consistent parameter ordering */
        let mut size_params: Vec<String> = field_refs.into_iter().collect();
        size_params.sort();

        /* Add tag parameter for size-discriminated union if present */
        if let Some(ref tag_param) = tag_param_name {
          size_params.push(tag_param.clone());
          size_params.sort();
        }

        if size_params.is_empty() {
          write!(output, ");\n").unwrap();
        } else {
          write!(output, "{});\n", size_params.join(", ")).unwrap();
        }

        write!(output, "    if (buffer.length < required_size) {{\n").unwrap();
        write!(output, "      return null; /* Buffer too small for variable fields */\n").unwrap();
        write!(output, "    }}\n\n").unwrap();
      }
    }
  }

  /* Validate enum fields if present */
  if let ResolvedTypeKind::Struct { fields, .. } = &resolved_type.kind {
    for field in fields {
      if let ResolvedTypeKind::Enum { tag_expression, tag_constant_status, variants } = &field.field_type.kind {
        write!(output, "    /* Validate enum field '{}' */\n", field.name).unwrap();

        /* Extract tag value */
        if let ExprKind::FieldRef(field_ref) = tag_expression {
          let tag_path = field_ref.path.join("_");
          write!(output, "    const tag_{} = {};\n", field.name, tag_path).unwrap();
        } else if let ConstantStatus::NonConstant(field_refs) = tag_constant_status {
          let non_constant_refs: Vec<String> = field_refs.keys().cloned().collect();
          let tag_expr = format_expr_to_ts(tag_expression, &non_constant_refs);
          write!(output, "    const tag_{} = {};\n", field.name, tag_expr).unwrap();
        }

        /* Check tag against valid variants */
        write!(output, "    const valid_tags_{} = [", field.name).unwrap();
        let valid_tags: Vec<String> = variants.iter().map(|v| v.tag_value.to_string()).collect();
        write!(output, "{}];\n", valid_tags.join(", ")).unwrap();
        write!(output, "    if (!valid_tags_{}.includes(tag_{})) {{\n", field.name, field.name).unwrap();
        write!(output, "      return null; /* Invalid tag value */\n").unwrap();
        write!(output, "    }}\n\n").unwrap();
      }
      if let ResolvedTypeKind::SizeDiscriminatedUnion { variants } = &field.field_type.kind {
        write!(output, "    /* Validate size-discriminated union field '{}' */\n", field.name).unwrap();
        // Calculate offset to this field by summing previous constant-size fields
        let mut offset_calc = String::new();
        let mut first = true;
        for prev_field in fields {
          if prev_field.name == field.name {
            break; // Stop before this field
          }
          match &prev_field.field_type.kind {
            ResolvedTypeKind::Primitive { .. } => {
              if let Size::Const(size) = prev_field.field_type.size {
                if !first {
                  offset_calc.push_str(" + ");
                }
                write!(offset_calc, "{}", size).unwrap();
                first = false;
              }
            }
            ResolvedTypeKind::Enum { .. } | ResolvedTypeKind::SizeDiscriminatedUnion { .. } => {
              // Variable-size fields - can't calculate offset statically
              offset_calc = "0".to_string(); // Fallback - will need runtime calculation
              break;
            }
            _ => {}
          }
        }
        if offset_calc.is_empty() {
          offset_calc = "0".to_string();
        }
        write!(output, "    let offset_{} = {};\n", field.name, offset_calc).unwrap();
        write!(output, "    const available_size_{} = buffer.length - offset_{};\n", field.name, field.name).unwrap();
        write!(output, "    const valid_sizes_{} = [", field.name).unwrap();
        let valid_sizes: Vec<String> = variants.iter().map(|v| v.expected_size.to_string()).collect();
        write!(output, "{}];\n", valid_sizes.join(", ")).unwrap();
        write!(output, "    if (!valid_sizes_{}.includes(available_size_{})) {{\n", field.name, field.name).unwrap();
        write!(output, "      return null; /* No matching variant for size-discriminated union '{}' */\n", field.name).unwrap();
        write!(output, "    }}\n").unwrap();
        write!(output, "    const {}_size = available_size_{};\n", field.name, field.name).unwrap();
      }
    }
  }

  write!(output, "    return new {}(buffer);\n", class_name).unwrap();
  write!(output, "  }}\n\n").unwrap();

  output
}

/* Emit from_array() method for enums */
fn emit_enum_from_array(resolved_type: &ResolvedType) -> String {
  let mut output = String::new();
  let class_name = &resolved_type.name;

  write!(output, "  static from_array(buffer: Uint8Array): {} | null {{\n", class_name).unwrap();

  if let Size::Const(size) = resolved_type.size {
    write!(output, "    if (buffer.length < {}) {{\n", size).unwrap();
    write!(output, "      return null; /* Buffer too small */\n").unwrap();
    write!(output, "    }}\n\n").unwrap();
  }

  /* Validate tag value */
  if let ResolvedTypeKind::Enum { tag_expression, variants, .. } = &resolved_type.kind {
    write!(output, "    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);\n").unwrap();

    /* Get tag value */
    if let ExprKind::FieldRef(_) = tag_expression {
      write!(output, "    const tag = view.getUint8(0); /* Assuming tag at offset 0 */\n").unwrap();
    }

    /* Validate tag */
    write!(output, "    const valid_tags = [").unwrap();
    let valid_tags: Vec<String> = variants.iter().map(|v| v.tag_value.to_string()).collect();
    write!(output, "{}];\n", valid_tags.join(", ")).unwrap();
    write!(output, "    if (!valid_tags.includes(tag)) {{\n").unwrap();
    write!(output, "      return null; /* Invalid tag value */\n").unwrap();
    write!(output, "    }}\n\n").unwrap();
  }

  write!(output, "    return new {}(buffer);\n", class_name).unwrap();
  write!(output, "  }}\n\n").unwrap();

  output
}

/* Emit from_array() method for unions */
fn emit_union_from_array(resolved_type: &ResolvedType) -> String {
  let mut output = String::new();
  let class_name = &resolved_type.name;

  write!(output, "  static from_array(buffer: Uint8Array): {} | null {{\n", class_name).unwrap();

  if let Size::Const(size) = resolved_type.size {
    write!(output, "    if (buffer.length < {}) {{\n", size).unwrap();
    write!(output, "      return null; /* Buffer too small */\n").unwrap();
    write!(output, "    }}\n\n").unwrap();
  }

  write!(output, "    return new {}(buffer);\n", class_name).unwrap();
  write!(output, "  }}\n\n").unwrap();

  output
}
