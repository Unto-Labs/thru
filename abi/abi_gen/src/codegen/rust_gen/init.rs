/* Initialization function generation for Rust ABI code */

use crate::abi::resolved::{ResolvedType, ResolvedTypeKind, Size};
use std::fmt::Write;
use super::helpers::{escape_rust_keyword, primitive_to_rust_type, format_type_to_rust, is_nested_complex_type};

pub fn emit_init_fn(resolved_type: &ResolvedType) -> String {
  match &resolved_type.kind {
    ResolvedTypeKind::Struct { .. } => emit_init_fn_struct(resolved_type),
    _ => String::new(),
  }
}

fn emit_init_fn_struct(resolved_type: &ResolvedType) -> String {
  let mut output = String::new();
  let type_name = &resolved_type.name;

  let fields = if let ResolvedTypeKind::Struct { fields, .. } = &resolved_type.kind {
    fields
  } else {
    return output;
  };

  /* Track field parameters and initialization info */
  struct FieldInitInfo {
    raw_name: String,
    param_name: String,
    is_fam: bool,
    is_array: bool,
    needs_length: bool,
  }

  let mut field_params: Vec<String> = Vec::new();
  let mut field_infos: Vec<FieldInitInfo> = Vec::new();

  for field in fields {
    let param_name = escape_rust_keyword(&field.name);
    let is_fam = matches!(&field.field_type.size, Size::Variable(_));

    match &field.field_type.kind {
      ResolvedTypeKind::Primitive { prim_type } => {
        let type_str = primitive_to_rust_type(prim_type);
        field_params.push(format!("{}: {}", param_name, type_str));
        field_infos.push(FieldInitInfo {
          raw_name: field.name.clone(),
          param_name: param_name.clone(),
          is_fam,
          is_array: false,
          needs_length: false,
        });
      }
      ResolvedTypeKind::Array { element_type, .. } => {
        let elem_type = if is_nested_complex_type(element_type) {
          format!("{}_{}_inner_t", type_name, field.name)
        } else {
          format_type_to_rust(element_type)
        };

        if is_fam {
          /* FAM array - needs pointer and length */
          field_params.push(format!("{}: &[{}]", param_name, elem_type));
          field_infos.push(FieldInitInfo {
            raw_name: field.name.clone(),
            param_name: param_name.clone(),
            is_fam: true,
            is_array: true,
            needs_length: true,
          });
        } else {
          /* Fixed-size array - needs reference */
          if let Size::Const(size) = &field.field_type.size {
            let elem_size = match &element_type.size {
              Size::Const(s) => *s,
              _ => 1,
            };
            let count = size / elem_size;
            field_params.push(format!("{}: &[{}; {}]", param_name, elem_type, count));
            field_infos.push(FieldInitInfo {
              raw_name: field.name.clone(),
              param_name: param_name.clone(),
              is_fam: false,
              is_array: true,
              needs_length: false,
            });
          }
        }
      }
      _ => {
        /* Complex types (TypeRef, struct, union, enum) */
        let mut type_str = format_type_to_rust(&field.field_type);
        if is_nested_complex_type(&field.field_type) {
          type_str = format!("{}_{}_inner_t", type_name, field.name);
        }

        if is_fam {
          /* Variable-sized: needs pointer and size */
          field_params.push(format!("{}: &{}", param_name, type_str));
          field_infos.push(FieldInitInfo {
            raw_name: field.name.clone(),
            param_name: param_name.clone(),
            is_fam: true,
            is_array: false,
            needs_length: false,
          });
        } else {
          /* Constant-sized: just needs reference */
          field_params.push(format!("{}: &{}", param_name, type_str));
          field_infos.push(FieldInitInfo {
            raw_name: field.name.clone(),
            param_name: param_name.clone(),
            is_fam: false,
            is_array: false,
            needs_length: false,
          });
        }
      }
    }
  }

  /* Generate function signature */
  write!(output, "pub fn {}_init(buffer: &mut [u8]", type_name).unwrap();
  for param in &field_params {
    write!(output, ", {}", param).unwrap();
  }
  write!(output, ") -> Result<(), &'static str> {{\n").unwrap();

  /* Calculate required size */
  write!(output, "    /* Calculate required buffer size */\n").unwrap();
  write!(output, "    let mut required_size: u64 = std::mem::size_of::<{}_t>() as u64;\n", type_name).unwrap();

  for info in &field_infos {
    if info.is_fam {
      if info.is_array {
        /* FAM array */
        write!(output, "    required_size = required_size.checked_add(({}.len() * std::mem::size_of_val(&{}[0])) as u64)\n",
          info.param_name, info.param_name).unwrap();
        write!(output, "        .ok_or(\"arithmetic overflow calculating array size\")?;\n").unwrap();
      } else {
        /* FAM non-array */
        write!(output, "    required_size = required_size.checked_add(std::mem::size_of_val({}) as u64)\n",
          info.param_name).unwrap();
        write!(output, "        .ok_or(\"arithmetic overflow calculating field size\")?;\n").unwrap();
      }
    }
  }

  /* Validate buffer size */
  write!(output, "\n    /* Validate buffer size */\n").unwrap();
  write!(output, "    if (buffer.len() as u64) < required_size {{\n").unwrap();
  write!(output, "        return Err(\"buffer too small\");\n").unwrap();
  write!(output, "    }}\n\n").unwrap();

  /* Initialize struct at beginning of buffer */
  write!(output, "    /* Initialize structure */\n").unwrap();
  write!(output, "    let ptr = buffer.as_mut_ptr() as *mut {}_t;\n", type_name).unwrap();
  write!(output, "    unsafe {{\n").unwrap();

  /* Write each field */
  for info in &field_infos {
    if !info.is_fam {
      /* Regular field - direct write */
      if info.is_array {
        write!(output, "        std::ptr::write_unaligned(std::ptr::addr_of_mut!((*ptr).{}), *{});\n",
          info.raw_name, info.param_name).unwrap();
      } else {
        write!(output, "        std::ptr::write_unaligned(std::ptr::addr_of_mut!((*ptr).{}), *{});\n",
          info.raw_name, info.param_name).unwrap();
      }
    }
  }

  write!(output, "    }}\n\n").unwrap();

  /* Copy FAM data */
  let has_fams = field_infos.iter().any(|info| info.is_fam);
  if has_fams {
    write!(output, "    /* Copy FAM data */\n").unwrap();
    write!(output, "    let mut offset: usize = std::mem::size_of::<{}_t>();\n", type_name).unwrap();

    for info in &field_infos {
      if info.is_fam {
        if info.is_array {
          write!(output, "    {{\n").unwrap();
          write!(output, "        let slice_size = {}.len() * std::mem::size_of_val(&{}[0]);\n",
            info.param_name, info.param_name).unwrap();
          write!(output, "        let src_ptr = {}.as_ptr() as *const u8;\n", info.param_name).unwrap();
          write!(output, "        unsafe {{\n").unwrap();
          write!(output, "            std::ptr::copy_nonoverlapping(src_ptr, buffer[offset..].as_mut_ptr(), slice_size);\n").unwrap();
          write!(output, "        }}\n").unwrap();
          write!(output, "        offset += slice_size;\n").unwrap();
          write!(output, "    }}\n").unwrap();
        } else {
          write!(output, "    {{\n").unwrap();
          write!(output, "        let field_size = std::mem::size_of_val({});\n", info.param_name).unwrap();
          write!(output, "        let src_ptr = {} as *const _ as *const u8;\n", info.param_name).unwrap();
          write!(output, "        unsafe {{\n").unwrap();
          write!(output, "            std::ptr::copy_nonoverlapping(src_ptr, buffer[offset..].as_mut_ptr(), field_size);\n").unwrap();
          write!(output, "        }}\n").unwrap();
          write!(output, "        offset += field_size;\n").unwrap();
          write!(output, "    }}\n").unwrap();
        }
      }
    }
  }

  write!(output, "\n    Ok(())\n").unwrap();
  write!(output, "}}\n\n").unwrap();

  output
}
