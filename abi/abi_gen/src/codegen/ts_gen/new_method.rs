use crate::abi::expr::{ConstantExpression, ExprKind};
use crate::abi::resolved::{ResolvedType, ResolvedTypeKind, Size};
use std::collections::HashSet;
use std::fmt::Write;
use super::helpers::{escape_ts_keyword, primitive_to_dataview_setter, primitive_to_ts_return_type, primitive_size};

/* Helper to extract all field references from an expression recursively */
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

/* Emit the static new() method for a type */
pub fn emit_new_method(resolved_type: &ResolvedType) -> String {
  match &resolved_type.kind {
    ResolvedTypeKind::Struct { .. } => emit_struct_new_method(resolved_type),
    ResolvedTypeKind::Enum { .. } => emit_enum_new_method(resolved_type),
    ResolvedTypeKind::Union { .. } => emit_union_new_method(resolved_type),
    _ => String::new(),
  }
}

/* Emit new() method for structs */
fn emit_struct_new_method(resolved_type: &ResolvedType) -> String {
  let mut output = String::new();
  let class_name = &resolved_type.name;

  if let ResolvedTypeKind::Struct { fields, .. } = &resolved_type.kind {
    /* Build parameter list */
    let mut params: Vec<String> = Vec::new();
    let mut has_variable_size = false;

    for field in fields {
      let escaped_name = escape_ts_keyword(&field.name);

      match &field.field_type.kind {
        ResolvedTypeKind::Primitive { prim_type } => {
          let ts_type = primitive_to_ts_return_type(prim_type);
          params.push(format!("{}: {}", escaped_name, ts_type));
        }
        ResolvedTypeKind::Array { element_type, size_expression, .. } => {
          if size_expression.is_constant() {
            /* Fixed-size array */
            if let ResolvedTypeKind::Primitive { prim_type } = &element_type.kind {
              let ts_type = primitive_to_ts_return_type(prim_type);
              params.push(format!("{}: {}[]", escaped_name, ts_type));
            }
          } else {
            /* Variable-size array (FAM) */
            has_variable_size = true;
            if let ResolvedTypeKind::Primitive { prim_type } = &element_type.kind {
              let ts_type = primitive_to_ts_return_type(prim_type);
              params.push(format!("{}: {}[]", escaped_name, ts_type));
            }
          }
        }
        ResolvedTypeKind::TypeRef { target_name, .. } => {
          params.push(format!("{}: {}", escaped_name, target_name));
        }
        ResolvedTypeKind::Enum { .. } => {
          /* Enums are variable-size */
          has_variable_size = true;
        }
        ResolvedTypeKind::SizeDiscriminatedUnion { .. } => {
          /* Size-discriminated unions are variable-size and need tag parameter */
          has_variable_size = true;
          params.push(format!("{}_tag: number", escaped_name));
        }
        _ => {}
      }
    }

    /* Generate method signature */
    write!(output, "  static new({}): {} {{\n", params.join(", "), class_name).unwrap();

    /* Allocate buffer */
    if let Size::Const(size) = resolved_type.size {
      write!(output, "    const buffer = new Uint8Array({});\n", size).unwrap();
    } else if has_variable_size {
      /* Variable size - calculate footprint */
      write!(output, "    const size = {}.footprint(", class_name).unwrap();

      /* Pass size parameters for FAMs and enums - extract field refs from expressions */
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
        /* For size-discriminated unions, add tag parameter to footprint call */
        if let ResolvedTypeKind::SizeDiscriminatedUnion { .. } = &field.field_type.kind {
          // Tag parameter is already in params, will be passed to footprint
        }
      }

      /* Convert HashSet to sorted Vec for consistent parameter ordering (matches footprint signature) */
      let mut size_params: Vec<String> = field_refs.into_iter().collect();
      size_params.sort();

      /* Add tag parameters for size-discriminated unions */
      for field in fields {
        if let ResolvedTypeKind::SizeDiscriminatedUnion { .. } = &field.field_type.kind {
          let tag_param = format!("{}_tag", escape_ts_keyword(&field.name));
          if !size_params.contains(&tag_param) {
            size_params.push(tag_param);
          }
        }
      }
      size_params.sort();

      write!(output, "{});\n", size_params.join(", ")).unwrap();
      write!(output, "    const buffer = new Uint8Array(size);\n").unwrap();
    } else {
      write!(output, "    const buffer = new Uint8Array(0); /* TODO: Calculate size */\n").unwrap();
    }

    write!(output, "    const view = new DataView(buffer.buffer);\n\n").unwrap();

    /* Initialize fields */
    write!(output, "    let offset = 0;\n").unwrap();
    let mut offset: u64 = 0;
    let mut offset_var = false;

    for field in fields {
      let escaped_name = escape_ts_keyword(&field.name);

      match &field.field_type.kind {
        ResolvedTypeKind::Enum { .. } => {
          /* Enum fields are ghost fields - they're inline data, not actual fields
           * We need to skip the enum's data space in the offset calculation */
          if let Size::Const(field_size) = field.field_type.size {
            offset += field_size;
          } else {
            /* Variable-size enum - can't track offset statically anymore */
            offset_var = true;
          }
        }
        ResolvedTypeKind::SizeDiscriminatedUnion { variants } => {
          /* Size-discriminated union fields are ghost fields - they're inline data, not actual fields
           * Size is determined from tag parameter */
          let tag_param = format!("{}_tag", escaped_name);
          write!(output, "    /* Size-discriminated union '{}' size based on tag */\n", field.name).unwrap();
          write!(output, "    const {}_size = (() => {{\n", escaped_name).unwrap();
          write!(output, "      switch ({}) {{\n", tag_param).unwrap();
          for (idx, variant) in variants.iter().enumerate() {
            write!(output, "        case {}: return {};\n", idx, variant.expected_size).unwrap();
          }
          write!(output, "        default: throw new Error(`Invalid tag for size-discriminated union '{}'`);\n", field.name).unwrap();
          write!(output, "      }}\n").unwrap();
          write!(output, "    }})();\n").unwrap();
          if !offset_var {
            write!(output, "    offset += {}_size;\n", escaped_name).unwrap();
          } else {
            write!(output, "    offset = offset + {}_size;\n", escaped_name).unwrap();
          }
          offset_var = true;
        }
        ResolvedTypeKind::Primitive { prim_type } => {
          let setter = primitive_to_dataview_setter(prim_type);
          let needs_le = primitive_size(prim_type) > 1;

          if offset_var {
            write!(output, "    /* Field '{}' at runtime offset */\n", field.name).unwrap();
          } else {
            if needs_le {
              write!(output, "    view.{}({}, {}, true); /* {} (little-endian) */\n",
                     setter, offset, escaped_name, field.name).unwrap();
            } else {
              write!(output, "    view.{}({}, {}); /* {} */\n",
                     setter, offset, escaped_name, field.name).unwrap();
            }
            if let Size::Const(field_size) = field.field_type.size {
              offset += field_size;
            }
          }
        }
        ResolvedTypeKind::Array { element_type, size_expression, .. } => {
          if size_expression.is_constant() {
            /* Fixed-size array */
            if let ResolvedTypeKind::Primitive { prim_type } = &element_type.kind {
              let setter = primitive_to_dataview_setter(prim_type);
              let elem_size = primitive_size(prim_type);
              let needs_le = elem_size > 1;

              write!(output, "    /* Initialize fixed array '{}' */\n", field.name).unwrap();
              write!(output, "    for (let i = 0; i < {}.length; i++) {{\n", escaped_name).unwrap();
              if needs_le {
                write!(output, "      view.{}({} + i * {}, {}[i], true);\n",
                       setter, offset, elem_size, escaped_name).unwrap();
              } else {
                write!(output, "      view.{}({} + i * {}, {}[i]);\n",
                       setter, offset, elem_size, escaped_name).unwrap();
              }
              write!(output, "    }}\n").unwrap();

              if let Size::Const(field_size) = field.field_type.size {
                offset += field_size;
              }
            }
          } else {
            /* Variable-size array (FAM) */
            offset_var = true;
            write!(output, "    /* TODO: Initialize FAM '{}' at runtime offset */\n", field.name).unwrap();
          }
        }
        ResolvedTypeKind::TypeRef { target_name, .. } => {
          /* For TypeRef (nested structs), copy bytes from the parameter */
          if !offset_var {
            write!(output, "    /* Copy nested struct '{}' ({}) */\n", field.name, target_name).unwrap();
            write!(output, "    const {}_bytes = ({} as any).buffer as Uint8Array;\n", escaped_name, escaped_name).unwrap();
            write!(output, "    buffer.set({}_bytes, {});\n", escaped_name, offset).unwrap();

            if let Size::Const(field_size) = field.field_type.size {
              offset += field_size;
            }
          } else {
            write!(output, "    /* TODO: Initialize TypeRef '{}' at runtime offset */\n", field.name).unwrap();
          }
        }
        _ => {}
      }
    }

    write!(output, "\n    return new {}(buffer);\n", class_name).unwrap();
    write!(output, "  }}\n\n").unwrap();
  }

  output
}

/* Emit new() method for enums */
fn emit_enum_new_method(resolved_type: &ResolvedType) -> String {
  let mut output = String::new();
  let class_name = &resolved_type.name;

  write!(output, "  static new(tag: number, data: Uint8Array): {} {{\n", class_name).unwrap();
  write!(output, "    /* TODO: Implement enum new() */\n").unwrap();
  write!(output, "    const buffer = new Uint8Array(0);\n").unwrap();
  write!(output, "    return new {}(buffer);\n", class_name).unwrap();
  write!(output, "  }}\n\n").unwrap();

  output
}

/* Emit new() method for unions */
fn emit_union_new_method(resolved_type: &ResolvedType) -> String {
  let mut output = String::new();
  let class_name = &resolved_type.name;

  if let ResolvedTypeKind::Union { variants } = &resolved_type.kind {
    /* Emit separate new methods for each variant */
    for variant in variants {
      let variant_name = escape_ts_keyword(&variant.name);

      match &variant.field_type.kind {
        ResolvedTypeKind::Primitive { prim_type } => {
          let ts_type = primitive_to_ts_return_type(prim_type);
          write!(output, "  static new_{}(value: {}): {} {{\n", variant_name, ts_type, class_name).unwrap();

          if let Size::Const(size) = resolved_type.size {
            write!(output, "    const buffer = new Uint8Array({});\n", size).unwrap();
            write!(output, "    const view = new DataView(buffer.buffer);\n").unwrap();

            let setter = primitive_to_dataview_setter(prim_type);
            let needs_le = primitive_size(prim_type) > 1;

            if needs_le {
              write!(output, "    view.{}(0, value, true);\n", setter).unwrap();
            } else {
              write!(output, "    view.{}(0, value);\n", setter).unwrap();
            }

            write!(output, "    return new {}(buffer);\n", class_name).unwrap();
          }

          write!(output, "  }}\n\n").unwrap();
        }
        _ => {}
      }
    }
  }

  output
}
