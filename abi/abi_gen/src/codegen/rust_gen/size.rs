/* Size calculation function generation for Rust ABI code */

use crate::abi::resolved::{ResolvedType, ResolvedTypeKind, Size};
use std::fmt::Write;
use super::helpers::{format_type_to_rust, primitive_to_rust_type, generate_nested_field_access};

pub fn emit_size_fn(resolved_type: &ResolvedType) -> String {
  match &resolved_type.kind {
    ResolvedTypeKind::Struct { .. } => emit_size_fn_struct(resolved_type),
    ResolvedTypeKind::Enum { .. } => emit_size_fn_enum(resolved_type),
    ResolvedTypeKind::Union { .. } => emit_size_fn_union(resolved_type),
    ResolvedTypeKind::SizeDiscriminatedUnion { .. } => emit_size_fn_union(resolved_type),
    _ => String::new(),
  }
}

fn emit_size_fn_struct(resolved_type: &ResolvedType) -> String {
  let mut output = String::new();
  let type_name = &resolved_type.name;

  if let Size::Const(_size) = resolved_type.size {
    /* Constant size - emit simple size() method */
    write!(output, "    pub fn size(&self) -> usize {{\n").unwrap();
    write!(output, "        std::mem::size_of::<Self>()\n").unwrap();
    write!(output, "    }}\n\n").unwrap();
    return output;
  }

  /* Variable size - generate runtime size() method */
  write!(output, "    pub fn size(&self) -> usize {{\n").unwrap();

  if let ResolvedTypeKind::Struct { fields, .. } = &resolved_type.kind {
    /* Find the first FAM */
    let first_fam_idx = fields.iter().position(|f| matches!(f.field_type.size, Size::Variable(_)));

    if let Some(fam_idx) = first_fam_idx {
      /* Start with offset of first FAM */
      write!(output, "        let mut offset: usize = std::mem::offset_of!({}, {});\n",
        type_name, fields[fam_idx].name).unwrap();

      /* Process all fields from first FAM onward */
      for field in &fields[fam_idx..] {
        match &field.field_type.kind {
          ResolvedTypeKind::Primitive { prim_type } => {
            write!(output, "        offset += std::mem::size_of::<{}>();\n",
              primitive_to_rust_type(prim_type)).unwrap();
          }
          ResolvedTypeKind::Array { element_type, .. } => {
            if let Size::Variable(var_refs) = &field.field_type.size {
              /* Read field references for size calculation */
              for (field_ref_path, prim_type) in var_refs.values().flat_map(|m| m.iter()) {
                output.push_str(&generate_nested_field_access(field_ref_path, type_name, prim_type));
              }

              /* Calculate array size */
              if let Some(var_map) = var_refs.values().next() {
                if let Some((first_ref, _)) = var_map.iter().next() {
                  let size_var = first_ref.replace('.', "_");

                  match &element_type.size {
                    Size::Const(elem_size) => {
                      write!(output, "        offset += {} * {};\n", size_var, elem_size).unwrap();
                    }
                    Size::Variable(_) => {
                      /* Multi-dimensional FAM */
                      write!(output, "        offset += {} * {}_footprint({});\n",
                        size_var, format_type_to_rust(element_type), size_var).unwrap();
                    }
                  }
                }
              }
            }
          }
          ResolvedTypeKind::Enum { tag_expression, variants, .. } => {
            /* Enum field - read tag and calculate variant size */
            if let Size::Variable(_) = &field.field_type.size {
              /* Read the tag value - tag_expression is typically just "tag" */
              use crate::abi::expr::ExprKind;
              let tag_accessor = match tag_expression {
                ExprKind::FieldRef(field_ref) => {
                  /* For simple field refs like "tag", generate self.tag() */
                  format!("self.{}()", field_ref.path.join("_"))
                },
                _ => {
                  use super::helpers::format_expr_to_rust;
                  format_expr_to_rust(tag_expression, &[])
                }
              };
              write!(output, "        let tag = {};\n", tag_accessor).unwrap();
              write!(output, "        let variant_size = match tag {{\n").unwrap();

              for variant in variants {
                if let Size::Const(s) = variant.variant_type.size {
                  write!(output, "            {} => {},\n", variant.tag_value, s).unwrap();
                } else {
                  /* Variable-sized variant */
                  write!(output, "            {} => unsafe {{\n", variant.tag_value).unwrap();
                  write!(output, "                self.{}().size()\n", variant.name).unwrap();
                  write!(output, "            }},\n").unwrap();
                }
              }

              write!(output, "            _ => 0,\n").unwrap();
              write!(output, "        }};\n").unwrap();
              write!(output, "        offset += variant_size;\n").unwrap();
            }
          }
          ResolvedTypeKind::TypeRef { .. } | ResolvedTypeKind::Struct { .. } => {
            if let Size::Variable(var_refs) = &field.field_type.size {
              /* Variable-sized nested type - read its size */
              for (field_ref_path, prim_type) in var_refs.values().flat_map(|m| m.iter()) {
                output.push_str(&generate_nested_field_access(field_ref_path, type_name, prim_type));
              }

              /* Call nested size function */
              let _field_refs: Vec<String> = var_refs
                .values()
                .flat_map(|refs| refs.keys().map(|r| r.replace('.', "_")))
                .collect();

              write!(output, "        offset += unsafe {{\n").unwrap();
              write!(output, "            let field_ptr = std::ptr::addr_of!(self.{});\n", field.name).unwrap();
              write!(output, "            (*field_ptr).size()\n").unwrap();
              write!(output, "        }};\n").unwrap();
            } else {
              /* Constant-sized nested type */
              write!(output, "        offset += std::mem::size_of::<{}>();\n",
                format_type_to_rust(&field.field_type)).unwrap();
            }
          }
          _ => {}
        }
      }

      write!(output, "        offset\n").unwrap();
    } else {
      /* No FAM - should not happen if we're generating size() */
      write!(output, "        std::mem::size_of::<Self>()\n").unwrap();
    }
  }

  write!(output, "    }}\n\n").unwrap();
  output
}

fn emit_size_fn_enum(resolved_type: &ResolvedType) -> String {
  let mut output = String::new();
  let _type_name = &resolved_type.name;

  if let Size::Const(_size) = resolved_type.size {
    return output; /* Constant size - no size() method needed */
  }

  /* Variable size enum - read tag and calculate size */
  write!(output, "    pub fn size(&self) -> usize {{\n").unwrap();
  write!(output, "        let mut total_size = std::mem::size_of::<Self>();\n").unwrap();
  write!(output, "        let tag = self.tag();\n").unwrap();

  if let ResolvedTypeKind::Enum { variants, .. } = &resolved_type.kind {
    write!(output, "        let variant_size = match tag {{\n").unwrap();

    for variant in variants {
      if let Size::Const(s) = variant.variant_type.size {
        write!(output, "            {} => {},\n", variant.tag_value, s).unwrap();
      } else {
        /* Variable-sized variant - call its size() method */
        write!(output, "            {} => unsafe {{\n", variant.tag_value).unwrap();
        write!(output, "                self.{}().size()\n", variant.name).unwrap();
        write!(output, "            }},\n").unwrap();
      }
    }

    write!(output, "            _ => 0,  /* Invalid tag */\n").unwrap();
    write!(output, "        }};\n").unwrap();
    write!(output, "        total_size + variant_size\n").unwrap();
  }

  write!(output, "    }}\n\n").unwrap();
  output
}

fn emit_size_fn_union(_resolved_type: &ResolvedType) -> String {
  /* Unions have constant size */
  String::new()
}
