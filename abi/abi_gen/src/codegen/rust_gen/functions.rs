use crate::abi::types::{ContainerAttributes, FloatingPointType, IntegralType, PrimitiveType, StructType, TypeKind};
use crate::abi::resolved::{ResolvedType, ResolvedTypeKind};
use core::fmt::Write;

fn capitalize_first(s: &str) -> String {
  let mut chars = s.chars();
  match chars.next() {
    None => String::new(),
    Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
  }
}

/* Format a type to Rust string - simplified version for function generation */
fn format_type_to_rust(type_kind: &TypeKind) -> String {
  match type_kind {
    TypeKind::Primitive(prim) => match prim {
      PrimitiveType::Integral(int_type) => match int_type {
        IntegralType::U8 => "u8".to_string(),
        IntegralType::U16 => "u16".to_string(),
        IntegralType::U32 => "u32".to_string(),
        IntegralType::U64 => "u64".to_string(),
        IntegralType::I8 => "i8".to_string(),
        IntegralType::I16 => "i16".to_string(),
        IntegralType::I32 => "i32".to_string(),
        IntegralType::I64 => "i64".to_string(),
      },
      PrimitiveType::FloatingPoint(float_type) => match float_type {
        FloatingPointType::F16 => "f16".to_string(),
        FloatingPointType::F32 => "f32".to_string(),
        FloatingPointType::F64 => "f64".to_string(),
      },
    },
    TypeKind::Array(array_type) => format_type_to_rust(&array_type.element_type),
    TypeKind::TypeRef(type_ref) => {
      format!("{}_t", type_ref.name)
    }
    _ => "()".to_string(),
  }
}

fn escape_rust_keyword(name: &str) -> String {
  const RUST_KEYWORDS: &[&str] = &[
    "as", "break", "const", "continue", "crate", "else", "enum", "extern", "false", "fn", "for", "if", "impl", "in", "let", "loop", "match", "mod",
    "move", "mut", "pub", "ref", "return", "self", "Self", "static", "struct", "super", "trait", "true", "type", "unsafe", "use", "where", "while",
    "async", "await", "dyn", "abstract", "become", "box", "do", "final", "macro", "override", "priv", "typeof", "unsized", "virtual", "yield", "try",
  ];

  if RUST_KEYWORDS.contains(&name) { format!("r#{}", name) } else { name.to_string() }
}

fn check_all_variants_same_type(enum_type: &crate::abi::types::EnumType) -> bool {
  enum_type.variants.is_empty() || enum_type.variants.iter().skip(1).all(|v| v.variant_type == enum_type.variants[0].variant_type)
}

fn emit_byte_array_accessors(output: &mut String, field_name: &str, escaped_name: &str, size: &str, is_packed: bool) {
  if is_packed {
    // Packed: must use unsafe unaligned access
    write!(output, "    pub fn {}_copy_to(&self, out: &mut [u8; {}]) {{\n", field_name, size).unwrap();
    write!(output, "        unsafe {{\n").unwrap();
    write!(output, "            core::ptr::copy_nonoverlapping(\n").unwrap();
    write!(output, "                core::ptr::addr_of!(self.{}) as *const u8,\n", escaped_name).unwrap();
    write!(output, "                out.as_mut_ptr(),\n").unwrap();
    write!(output, "                {}\n", size).unwrap();
    write!(output, "            );\n").unwrap();
    write!(output, "        }}\n").unwrap();
    write!(output, "    }}\n\n").unwrap();

    write!(output, "    pub fn {}_unaligned(&self) -> [u8; {}] {{\n", field_name, size).unwrap();
    write!(output, "        unsafe {{\n").unwrap();
    write!(output, "            core::ptr::read_unaligned(core::ptr::addr_of!(self.{}))\n", escaped_name).unwrap();
    write!(output, "        }}\n").unwrap();
    write!(output, "    }}\n\n").unwrap();
  } else {
    // Unpacked: safe direct access
    write!(output, "    pub fn {}_copy_to(&self, out: &mut [u8; {}]) {{\n", field_name, size).unwrap();
    write!(output, "        out.copy_from_slice(&self.{});\n", escaped_name).unwrap();
    write!(output, "    }}\n\n").unwrap();

    write!(output, "    pub fn {}(&self) -> [u8; {}] {{\n", field_name, size).unwrap();
    write!(output, "        self.{}\n", escaped_name).unwrap();
    write!(output, "    }}\n\n").unwrap();
  }
}

fn emit_size_fn_for_struct(_type_name: &str, _struct_type: &StructType) -> String {
  let mut _output = String::new();

  // Check if struct contains variable-sized fields that require runtime size calculation
  // Only arrays
  todo!();

  #[allow(unreachable_code)]
  {
    let _needs_runtime_size = false;

    if _needs_runtime_size {
      // For types with variable size, emit runtime size() method
      write!(_output, "    pub fn size(&self) -> usize {{\n").unwrap();
      write!(_output, "        let mut size: usize = 0;\n").unwrap();

      // Process each field one by one
      for _field in &_struct_type.fields {
        let _escaped_name = escape_rust_keyword(&_field.name);
        match &_field.field_type {
          TypeKind::Array(_array_type) => {
            // array size is calculated as: element_size * count (from size_ref field)
            let _elem_size = match &*_array_type.element_type {
              TypeKind::Primitive(_prim) => match _prim {
                PrimitiveType::Integral(_int_type) => match _int_type {
                  IntegralType::U8 | IntegralType::I8 => "1",
                  IntegralType::U16 | IntegralType::I16 => "2",
                  IntegralType::U32 | IntegralType::I32 => "4",
                  IntegralType::U64 | IntegralType::I64 => "8",
                },
                PrimitiveType::FloatingPoint(_float_type) => match _float_type {
                FloatingPointType::F16 => "2",
                FloatingPointType::F32 => "4",
                FloatingPointType::F64 => "8",
              },
            },
            TypeKind::TypeRef(_type_ref) => {
              // For TypeRef, we need to use size_of for the type
              write!(_output, "        size += core::mem::size_of::<{}_t>() * ", _type_ref.name).unwrap();
              // Now emit the size_ref field access
              if let crate::abi::expr::ExprKind::FieldRef(_field_ref) = &_array_type.size {
                let _size_path = _field_ref.to_c_field_access();
                write!(_output, "self.{} as usize;\n", _size_path).unwrap();
              } else {
                write!(_output, "0; // ERROR: Complex size_ref expression not supported\n").unwrap();
              }
              continue;
            }
            _ => {
              // For other types, use a generic approach
              write!(_output, "        // array with complex element type - size calculation may be incorrect\n").unwrap();
              write!(_output, "        size += 0; // TODO: Implement size calculation for FAM field '{}'\n", _field.name).unwrap();
              continue;
            }
          };

          // Emit the size calculation: element_size * count
          write!(_output, "        size += {} * ", _elem_size).unwrap();

          // Access the size_ref field to get the count
          if let crate::abi::expr::ExprKind::FieldRef(_field_ref) = &_array_type.size {
            let _size_path = _field_ref.to_c_field_access();
            write!(_output, "self.{} as usize;\n", _size_path).unwrap();
          } else {
            write!(_output, "0; // ERROR: Complex size_ref expression not supported\n").unwrap();
          }
        }
        TypeKind::TypeRef(__type_ref) => {
          // Call the size function of the referenced type
          write!(_output, "        size += self.{}.size();\n", _escaped_name).unwrap();
        }
        _ => {
          // For all other fields, use size_of_val
          write!(_output, "        size += core::mem::size_of_val(&self.{});\n", _escaped_name).unwrap();
        }
      }
    }

    write!(_output, "        size\n").unwrap();
    write!(_output, "    }}\n\n").unwrap();
  } else {
    // For types with fixed size, emit SIZE constant
    write!(_output, "    pub const SIZE: usize = core::mem::size_of::<Self>();\n\n").unwrap();
  }

  _output
  }
}

fn emit_accessor_fn_for_struct(type_name: &str, struct_type: &StructType, container_attrs: &ContainerAttributes) -> String {
  let mut output = String::new();
  let is_packed = container_attrs.packed;

  // First pass: generate enum types for union/enum fields with different variant types
  for field in struct_type.fields.iter() {
    if let TypeKind::Enum(enum_type) = &field.field_type {
      let all_same_type = check_all_variants_same_type(enum_type);

      if !all_same_type {
        // Generate enum for return type - use clean capitalized name
        let enum_return_name = format!("{}", capitalize_first(&field.name));
        write!(output, "pub enum {} {{\n", enum_return_name).unwrap();

        for variant in &enum_type.variants {
          let variant_type_str = match &variant.variant_type {
            TypeKind::Struct(_) => {
              format!("{}_{}_inner_{}_inner", type_name, field.name, variant.name)
            }
            _ => format_type_to_rust(&variant.variant_type),
          };
          write!(output, "    {}({}),\n", capitalize_first(&variant.name), variant_type_str).unwrap();
        }

        write!(output, "}}\n\n").unwrap();
      }
    }
  }

  for field in struct_type.fields.iter() {
    let escaped_name = escape_rust_keyword(&field.name);

    // Determine return type and accessor implementation based on field type
    match &field.field_type {
      TypeKind::Primitive(_prim) => {
        let type_str = format_type_to_rust(&field.field_type);

        if is_packed {
          // For packed structs, use explicit unaligned read
          write!(output, "    pub fn {}_unaligned(&self) -> {} {{\n", escaped_name, type_str).unwrap();
          write!(output, "        unsafe {{\n").unwrap();
          write!(output, "            core::ptr::read_unaligned(core::ptr::addr_of!(self.{}))\n", escaped_name).unwrap();
          write!(output, "        }}\n").unwrap();
          write!(output, "    }}\n\n").unwrap();
        } else {
          // For regular structs, direct field access
          write!(output, "    pub fn {}(&self) -> {} {{\n", escaped_name, type_str).unwrap();
          write!(output, "        self.{}\n", escaped_name).unwrap();
        }
      }
      TypeKind::Array(array_type) => {
        let elem_type = format_type_to_rust(&array_type.element_type);

        // Determine array size - try to evaluate constant expressions
        let array_size = array_type.size.try_evaluate_constant().map(|v| v.to_string());

        if let Some(size) = array_size {
          // Check if element is a byte type (u8)
          let is_byte_array = matches!(array_type.element_type.as_ref(), TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U8)));

          if is_byte_array {
            // For byte arrays, provide copy-out APIs only (no borrowed refs from packed storage)
            emit_byte_array_accessors(&mut output, &escaped_name, &escaped_name, &size, is_packed);
          } else {
            // For all arrays in packed structs, must return by value
            // For unpacked structs with non-byte arrays, references are safe
            if is_packed {
              write!(output, "    pub fn {}_unaligned(&self) -> [{}; {}] {{\n", escaped_name, elem_type, size).unwrap();
              write!(output, "        unsafe {{\n").unwrap();
              write!(output, "            core::ptr::read_unaligned(core::ptr::addr_of!(self.{}))\n", escaped_name).unwrap();
              write!(output, "        }}\n").unwrap();
              write!(output, "    }}\n\n").unwrap();

              // Also provide a copy-out API for packed arrays
              write!(output, "    pub fn {}_copy_to(&self, out: &mut [{}; {}]) {{\n", escaped_name, elem_type, size).unwrap();
              write!(output, "        unsafe {{\n").unwrap();
              write!(output, "            *out = core::ptr::read_unaligned(core::ptr::addr_of!(self.{}));\n", escaped_name).unwrap();
              write!(output, "        }}\n").unwrap();
              write!(output, "    }}\n\n").unwrap();
            } else {
              // For unpacked structs, references are safe
              write!(output, "    pub fn {}(&self) -> &[{}; {}] {{\n", escaped_name, elem_type, size).unwrap();
              write!(output, "        &self.{}\n", escaped_name).unwrap();
              write!(output, "    }}\n\n").unwrap();
            }
          }
        } else {
          // Dynamic size arrays not yet supported
          write!(output, "    // Dynamic-size array '{}' accessor not generated\n", escaped_name).unwrap();
        }
      }
      TypeKind::TypeRef(_) | TypeKind::Struct(_) | TypeKind::Union(_) | TypeKind::SizeDiscriminatedUnion(_) => {
        // Generate proper type names for all variants
        let type_str = match &field.field_type {
          TypeKind::TypeRef(type_ref) => format!("{}_t", type_ref.name),
          TypeKind::Struct(_) => format!("{}_{}_inner", type_name, field.name),
          TypeKind::Union(_) => format!("{}_{}_inner", type_name, field.name),
          TypeKind::SizeDiscriminatedUnion(_) => {
            format!("{}_{}_inner", type_name, field.name)
          }
          _ => unreachable!("This match arm should only handle TypeRef, Struct, Union, and SizeDiscriminatedUnion"),
        };

        if is_packed {
          // For packed structs, return by value with unaligned read
          write!(output, "    pub fn {}_unaligned(&self) -> {} {{\n", escaped_name, type_str).unwrap();
          write!(output, "        unsafe {{\n").unwrap();
          write!(output, "            core::ptr::read_unaligned(core::ptr::addr_of!(self.{}))\n", escaped_name).unwrap();
          write!(output, "        }}\n").unwrap();
          write!(output, "    }}\n\n").unwrap();
        } else {
          // For regular structs, references are safe
          write!(output, "    pub fn {}(&self) -> &{} {{\n", escaped_name, type_str).unwrap();
          write!(output, "        &self.{}\n", escaped_name).unwrap();
          write!(output, "    }}\n\n").unwrap();
        }
      }
      TypeKind::Enum(enum_type) => {
        // Generate a single safe accessor for enum/union fields that dispatches based on tag
        // Always use read_unaligned for robust pattern that works for both packed and non-packed
        if let crate::abi::expr::ExprKind::FieldRef(field_ref) = &enum_type.tag_ref {
          let tag_path = field_ref.to_c_field_access();

          let all_same_type = check_all_variants_same_type(enum_type);

          if all_same_type && !enum_type.variants.is_empty() {
            // All variants have the same type - generate simple accessor
            let variant_type_str = format_type_to_rust(&enum_type.variants[0].variant_type);

            write!(output, "    pub fn {}(&self) -> Result<{}, ()> {{\n", escaped_name, variant_type_str).unwrap();
            // For packed structs or non-u8 tags, must use read_unaligned to avoid UB
            if is_packed {
              write!(output, "        let tag = unsafe {{ core::ptr::read_unaligned(core::ptr::addr_of!(self.{})) }};\n", tag_path).unwrap();
            } else {
              write!(output, "        let tag = self.{};\n", tag_path).unwrap();
            }
            write!(output, "        unsafe {{\n").unwrap();
            write!(output, "            match tag {{\n").unwrap();

            for variant in &enum_type.variants {
              // Always use read_unaligned for safety - works for both packed and non-packed
              write!(
                output,
                "                {} => Ok(core::ptr::addr_of!(self.{}.{}).read_unaligned()),\n",
                variant.tag_value, escaped_name, variant.name
              )
              .unwrap();
            }

            write!(output, "                _ => Err(()),\n").unwrap();
            write!(output, "            }}\n").unwrap();
            write!(output, "        }}\n").unwrap();
          } else {
            // Different types - use the enum return type we generated earlier
            let enum_return_name = capitalize_first(&field.name);

            // Generate the single accessor function
            write!(output, "    pub fn {}(&self) -> Result<{}, ()> {{\n", escaped_name, enum_return_name).unwrap();
            // For packed structs or non-u8 tags, must use read_unaligned to avoid UB
            if is_packed {
              write!(output, "        let tag = unsafe {{ core::ptr::read_unaligned(core::ptr::addr_of!(self.{})) }};\n", tag_path).unwrap();
            } else {
              write!(output, "        let tag = self.{};\n", tag_path).unwrap();
            }
            write!(output, "        unsafe {{\n").unwrap();
            write!(output, "            match tag {{\n").unwrap();

            for variant in &enum_type.variants {
              // Always use read_unaligned for safety - works for both packed and non-packed
              write!(
                output,
                "                {} => Ok({}::{}(core::ptr::addr_of!(self.{}.{}).read_unaligned())),\n",
                variant.tag_value,
                enum_return_name,
                capitalize_first(&variant.name),
                escaped_name,
                variant.name
              )
              .unwrap();
            }

            write!(output, "                _ => Err(()),\n").unwrap();
            write!(output, "            }}\n").unwrap();
            write!(output, "        }}\n").unwrap();
          }
        }
      }
    }
  }

  output
}

fn emit_enum_types_for_struct(type_name: &str, struct_type: &StructType) -> String {
  let mut output = String::new();

  // Generate enum types for union/enum fields with different variant types
  for field in struct_type.fields.iter() {
    if let TypeKind::Enum(enum_type) = &field.field_type {
      let all_same_type = check_all_variants_same_type(enum_type);

      if !all_same_type {
        // Generate enum for return type - use clean capitalized name
        let enum_return_name = format!("{}", capitalize_first(&field.name));
        write!(output, "pub enum {} {{\n", enum_return_name).unwrap();

        for variant in &enum_type.variants {
          let variant_type_str = match &variant.variant_type {
            TypeKind::Struct(_) => {
              format!("{}_{}_inner_{}_inner", type_name, field.name, variant.name)
            }
            _ => format_type_to_rust(&variant.variant_type),
          };
          write!(output, "    {}({}),\n", capitalize_first(&variant.name), variant_type_str).unwrap();
        }

        write!(output, "}}\n\n").unwrap();
      }
    }
  }

  output
}

fn emit_accessor_methods_for_struct(type_name: &str, struct_type: &StructType, container_attrs: &ContainerAttributes) -> String {
  let mut output = String::new();
  let is_packed = container_attrs.packed;

  for field in struct_type.fields.iter() {
    let escaped_name = escape_rust_keyword(&field.name);

    // Determine return type and accessor implementation based on field type
    match &field.field_type {
      TypeKind::Primitive(_prim) => {
        let type_str = format_type_to_rust(&field.field_type);

        if is_packed {
          // For packed structs, use explicit unaligned read
          write!(output, "    pub fn {}_unaligned(&self) -> {} {{\n", escaped_name, type_str).unwrap();
          write!(output, "        unsafe {{\n").unwrap();
          write!(output, "            core::ptr::read_unaligned(core::ptr::addr_of!(self.{}))\n", escaped_name).unwrap();
          write!(output, "        }}\n").unwrap();
          write!(output, "    }}\n\n").unwrap();
        } else {
          // For regular structs, direct field access
          write!(output, "    pub fn {}(&self) -> {} {{\n", escaped_name, type_str).unwrap();
          write!(output, "        self.{}\n", escaped_name).unwrap();
          write!(output, "    }}\n\n").unwrap();
        }
      }
      TypeKind::Array(array_type) => {
        let elem_type = format_type_to_rust(&array_type.element_type);

        // Determine array size - try to evaluate constant expressions
        let array_size = array_type.size.try_evaluate_constant().map(|v| v.to_string());

        if let Some(size) = array_size {
          // Check if element is a byte type (u8)
          let is_byte_array = matches!(array_type.element_type.as_ref(), TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U8)));

          if is_byte_array {
            // For byte arrays, provide copy-out APIs only (no borrowed refs from packed storage)
            emit_byte_array_accessors(&mut output, &escaped_name, &escaped_name, &size, is_packed);
          } else {
            // For all arrays in packed structs, must return by value
            // For unpacked structs with non-byte arrays, references are safe
            if is_packed {
              write!(output, "    pub fn {}_unaligned(&self) -> [{}; {}] {{\n", escaped_name, elem_type, size).unwrap();
              write!(output, "        unsafe {{\n").unwrap();
              write!(output, "            core::ptr::read_unaligned(core::ptr::addr_of!(self.{}))\n", escaped_name).unwrap();
              write!(output, "        }}\n").unwrap();
              write!(output, "    }}\n\n").unwrap();

              // Also provide a copy-out API for packed arrays
              write!(output, "    pub fn {}_copy_to(&self, out: &mut [{}; {}]) {{\n", escaped_name, elem_type, size).unwrap();
              write!(output, "        unsafe {{\n").unwrap();
              write!(output, "            *out = core::ptr::read_unaligned(core::ptr::addr_of!(self.{}));\n", escaped_name).unwrap();
              write!(output, "        }}\n").unwrap();
              write!(output, "    }}\n\n").unwrap();
            } else {
              // For unpacked structs, references are safe
              write!(output, "    pub fn {}(&self) -> &[{}; {}] {{\n", escaped_name, elem_type, size).unwrap();
              write!(output, "        &self.{}\n", escaped_name).unwrap();
              write!(output, "    }}\n\n").unwrap();
            }
          }
        } else {
          // Dynamic size arrays not yet supported
          write!(output, "    // Dynamic-size array '{}' accessor not generated\n", escaped_name).unwrap();
        }
      }
      TypeKind::TypeRef(_) | TypeKind::Struct(_) | TypeKind::Union(_) | TypeKind::SizeDiscriminatedUnion(_) => {
        // Generate proper type names for all variants
        let type_str = match &field.field_type {
          TypeKind::TypeRef(type_ref) => format!("{}_t", type_ref.name),
          TypeKind::Struct(_) => format!("{}_{}_inner", type_name, field.name),
          TypeKind::Union(_) => format!("{}_{}_inner", type_name, field.name),
          TypeKind::SizeDiscriminatedUnion(_) => {
            format!("{}_{}_inner", type_name, field.name)
          }
          _ => unreachable!("This match arm should only handle TypeRef, Struct, Union, and SizeDiscriminatedUnion"),
        };

        if is_packed {
          // For packed structs, return by value with unaligned read
          write!(output, "    pub fn {}_unaligned(&self) -> {} {{\n", escaped_name, type_str).unwrap();
          write!(output, "        unsafe {{\n").unwrap();
          write!(output, "            core::ptr::read_unaligned(core::ptr::addr_of!(self.{}))\n", escaped_name).unwrap();
          write!(output, "        }}\n").unwrap();
          write!(output, "    }}\n\n").unwrap();
        } else {
          // For regular structs, references are safe
          write!(output, "    pub fn {}(&self) -> &{} {{\n", escaped_name, type_str).unwrap();
          write!(output, "        &self.{}\n", escaped_name).unwrap();
          write!(output, "    }}\n\n").unwrap();
        }
      }
      TypeKind::Enum(enum_type) => {
        // Generate a single safe accessor for enum/union fields that dispatches based on tag
        // Always use read_unaligned for robust pattern that works for both packed and non-packed
        if let crate::abi::expr::ExprKind::FieldRef(field_ref) = &enum_type.tag_ref {
          let tag_path = field_ref.to_c_field_access();

          let all_same_type = check_all_variants_same_type(enum_type);

          if all_same_type && !enum_type.variants.is_empty() {
            // All variants have the same type - generate simple accessor
            let variant_type_str = format_type_to_rust(&enum_type.variants[0].variant_type);

            write!(output, "    pub fn {}(&self) -> Result<{}, ()> {{\n", escaped_name, variant_type_str).unwrap();
            // For packed structs or non-u8 tags, must use read_unaligned to avoid UB
            if is_packed {
              write!(output, "        let tag = unsafe {{ core::ptr::read_unaligned(core::ptr::addr_of!(self.{})) }};\n", tag_path).unwrap();
            } else {
              write!(output, "        let tag = self.{};\n", tag_path).unwrap();
            }
            write!(output, "        unsafe {{\n").unwrap();
            write!(output, "            match tag {{\n").unwrap();

            for variant in &enum_type.variants {
              // Always use read_unaligned for safety - works for both packed and non-packed
              write!(
                output,
                "                {} => Ok(core::ptr::addr_of!(self.{}.{}).read_unaligned()),\n",
                variant.tag_value, escaped_name, variant.name
              )
              .unwrap();
            }

            write!(output, "                _ => Err(()),\n").unwrap();
            write!(output, "            }}\n").unwrap();
            write!(output, "        }}\n").unwrap();
            write!(output, "    }}\n\n").unwrap();
          } else {
            // Different types - use the enum return type we generated earlier
            let enum_return_name = capitalize_first(&field.name);

            // Generate the single accessor function
            write!(output, "    pub fn {}(&self) -> Result<{}, ()> {{\n", escaped_name, enum_return_name).unwrap();
            // For packed structs or non-u8 tags, must use read_unaligned to avoid UB
            if is_packed {
              write!(output, "        let tag = unsafe {{ core::ptr::read_unaligned(core::ptr::addr_of!(self.{})) }};\n", tag_path).unwrap();
            } else {
              write!(output, "        let tag = self.{};\n", tag_path).unwrap();
            }
            write!(output, "        unsafe {{\n").unwrap();
            write!(output, "            match tag {{\n").unwrap();

            for variant in &enum_type.variants {
              // Always use read_unaligned for safety - works for both packed and non-packed
              write!(
                output,
                "                {} => Ok({}::{}(core::ptr::addr_of!(self.{}.{}).read_unaligned())),\n",
                variant.tag_value,
                enum_return_name,
                capitalize_first(&variant.name),
                escaped_name,
                variant.name
              )
              .unwrap();
            }

            write!(output, "                _ => Err(()),\n").unwrap();
            write!(output, "            }}\n").unwrap();
            write!(output, "        }}\n").unwrap();
            write!(output, "    }}\n\n").unwrap();
          }
        }
      }
    }
  }

  output
}

pub fn emit_functions(type_name: &str, type_kind: &TypeKind) -> String {
  let mut output = String::new();

  match type_kind {
    TypeKind::Struct(struct_type) => {
      output.push_str(&emit_enum_types_for_struct(type_name, struct_type));
      write!(output, "impl {}_t {{\n", type_name).unwrap();
      output.push_str(&emit_size_fn_for_struct(type_name, struct_type));
      output.push_str(&emit_accessor_methods_for_struct(type_name, struct_type, &struct_type.container_attributes));
      write!(output, "}}\n\n").unwrap();
    }
    TypeKind::Union(_) => {
      write!(output, "// TODO: EMIT FUNCTIONS FOR Union\n\n").unwrap();
    }
    TypeKind::SizeDiscriminatedUnion(_) => {
      write!(output, "// TODO: EMIT FUNCTIONS FOR SizeDiscriminatedUnion\n\n").unwrap();
    }
    _ => {
      write!(output, "// NOT SUPPORTED: ATTEMPTING TO EMIT FUNCTIONS FOR TypeRef, Primitive, Enum, or Array\n\n").unwrap();
    }
  }

  output
}

/* Generate Rust impl blocks for a ResolvedType */
pub fn emit_functions_for_resolved_type(resolved_type: &ResolvedType) -> String {
  let mut output = String::new();

  output.push_str(&format!("/* Functions for {} */\n", resolved_type.name));

  match &resolved_type.kind {
    ResolvedTypeKind::Struct { fields, .. } => {
      output.push_str(&format!("impl {} {{\n", resolved_type.name));

      /* Generate new() constructor */
      output.push_str("    pub fn new(");
      let mut first_param = true;
      for field in fields.iter() {
        /* Skip enum fields in constructor - they're not actual struct fields */
        if matches!(&field.field_type.kind, ResolvedTypeKind::Enum { .. }) {
          continue;
        }
        if !first_param {
          output.push_str(", ");
        }
        first_param = false;
        let rust_type = format_resolved_type(&field.field_type);
        output.push_str(&format!("{}: {}", field.name, rust_type));
      }
      output.push_str(") -> Self {\n");
      output.push_str("        Self {\n");
      for field in fields {
        /* For enum fields, initialize the zero-sized array */
        if matches!(&field.field_type.kind, ResolvedTypeKind::Enum { .. }) {
          output.push_str(&format!("            {}: [],\n", field.name));
          continue;
        }
        output.push_str(&format!("            {},\n", field.name));
      }
      output.push_str("        }\n");
      output.push_str("    }\n\n");

      /* Generate getter methods for each field */
      for field in fields {
        /* Skip enum fields - they need variant-specific getters */
        if matches!(&field.field_type.kind, ResolvedTypeKind::Enum { .. }) {
          continue;
        }

        let rust_type = format_resolved_type(&field.field_type);

        /* Determine return type (reference for complex types, value for primitives) */
        let (return_type, return_expr) = if is_copy_type(&field.field_type) {
          (rust_type.clone(), format!("self.{}", field.name))
        } else {
          (format!("&{}", rust_type), format!("&self.{}", field.name))
        };

        output.push_str(&format!("    pub fn {}(&self) -> {} {{\n", field.name, return_type));
        output.push_str(&format!("        {}\n", return_expr));
        output.push_str("    }\n\n");
      }

      /* Collect all field references used in size expressions */
      let mut referenced_fields = std::collections::HashSet::new();
      if let crate::abi::resolved::Size::Variable(variable_refs) = &resolved_type.size {
        for refs_map in variable_refs.values() {
          for field_ref_path in refs_map.keys() {
            /* Extract the first component of the path (the field name) */
            if let Some(field_name) = field_ref_path.split('.').next() {
              referenced_fields.insert(field_name.to_string());
            }
          }
        }
      }

      /* Generate setter methods for each field */
      for field in fields {
        /* Skip enum fields - they need variant-specific setters */
        if matches!(&field.field_type.kind, ResolvedTypeKind::Enum { .. }) {
          continue;
        }

        /* Skip fields that are referenced in size expressions (tags, array sizes, etc.) */
        if referenced_fields.contains(&field.name) {
          continue;
        }

        let rust_type = format_resolved_type(&field.field_type);

        /* For non-Copy types (TypeRef, nested structs), setters accept references */
        let (param_type, assign_expr) = if is_copy_type(&field.field_type) {
          /* Copy types: accept by value */
          (rust_type.clone(), "value".to_string())
        } else {
          /* Non-Copy types: accept by reference and dereference */
          (format!("&{}", rust_type), "*value".to_string())
        };

        output.push_str(&format!("    pub fn set_{}(&mut self, value: {}) {{\n", field.name, param_type));
        output.push_str(&format!("        self.{} = {};\n", field.name, assign_expr));
        output.push_str("    }\n\n");
      }

      /* Generate size() method for structs */
      output.push_str(&crate::codegen::rust_gen::emit_size_fn(resolved_type));

      /* Generate validate() function to check if slice has enough data */
      output.push_str("    pub fn validate(data: &[u8]) -> Result<usize, &'static str> {\n");
      output.push_str("        if data.len() < std::mem::size_of::<Self>() {\n");
      output.push_str("            return Err(\"Buffer too small for struct\");\n");
      output.push_str("        }\n");

      /* Check if any field is an enum (variable size) */
      let has_enum_field = fields.iter().any(|f| matches!(&f.field_type.kind, ResolvedTypeKind::Enum { .. }));

      if has_enum_field {
        output.push_str("        /* Calculate actual size including variable-size enum fields */\n");
        output.push_str("        let mut total_size = std::mem::size_of::<Self>();\n");

        let mut has_variable_size_data = false;
        output.push_str("        let mut offset: usize = 0;\n");

        for field in fields {
          if let ResolvedTypeKind::Enum { variants, tag_expression, .. } = &field.field_type.kind {
            /* Get the tag field name from tag_expression */
            let tag_field = if let crate::abi::expr::ExprKind::FieldRef(field_ref) = tag_expression {
              field_ref.path.last().unwrap_or(&field.name)
            } else {
              &field.name
            };

            output.push_str(&format!("        /* Read tag for enum field '{}' */\n", field.name));

            /* Read tag from appropriate location */
            if has_variable_size_data {
              /* Tag comes after variable-size data - read from offset */
              output.push_str(&format!("        let tag = data[offset];\n"));
              output.push_str(&format!("        offset += 1; /* Skip tag */\n"));
            } else {
              /* Tag is in the struct at fixed offset */
              output.push_str(&format!("        let tag = unsafe {{ *(data.as_ptr() as *const Self) }}.{};\n", tag_field));
            }

            output.push_str(&format!("        let variant_size = match tag {{\n"));

            for variant in variants {
              if let crate::abi::resolved::Size::Const(size) = variant.variant_type.size {
                output.push_str(&format!("            {} => {},\n", variant.tag_value, size));
              } else {
                output.push_str(&format!("            {} => return Err(\"Variable-size enum variant not yet supported\"),\n", variant.tag_value));
              }
            }

            output.push_str("            _ => return Err(\"Invalid enum tag value\"),\n");
            output.push_str("        };\n");
            output.push_str("        total_size += variant_size;\n");

            /* Mark that we've encountered variable-size data AFTER processing this enum */
            if matches!(&field.field_type.size, crate::abi::resolved::Size::Variable(_)) {
              if !has_variable_size_data {
                /* First variable-size enum - initialize offset based on tag field position */
                output.push_str(&format!("        offset = std::mem::offset_of!(Self, {}) + std::mem::size_of::<u8>() + variant_size;\n", tag_field));
                has_variable_size_data = true;
              } else {
                /* Subsequent variable-size enum - update offset */
                output.push_str("        offset += variant_size; /* Skip enum body */\n");
              }
            }
          }
        }

        output.push_str("        if data.len() < total_size {\n");
        output.push_str("            return Err(\"Buffer too small for full structure including variable fields\");\n");
        output.push_str("        }\n");
        output.push_str("        Ok(total_size)\n");
      } else {
        /* No variable-size fields, just return sizeof */
        output.push_str("        Ok(std::mem::size_of::<Self>())\n");
      }

      output.push_str("    }\n\n");

      /* Generate from_slice() and mut_from_slice() for FFI */
      output.push_str("    pub fn from_slice(data: &[u8]) -> Option<&Self> {\n");
      output.push_str("        Self::validate(data).ok()?;\n");
      output.push_str("        unsafe {\n");
      output.push_str("            Some(&*(data.as_ptr() as *const Self))\n");
      output.push_str("        }\n");
      output.push_str("    }\n\n");

      output.push_str("    pub fn mut_from_slice(data: &mut [u8]) -> Option<&mut Self> {\n");
      output.push_str("        if data.len() < std::mem::size_of::<Self>() {\n");
      output.push_str("            return None;\n");
      output.push_str("        }\n");
      output.push_str("        unsafe {\n");
      output.push_str("            Some(&mut *(data.as_mut_ptr() as *mut Self))\n");
      output.push_str("        }\n");
      output.push_str("    }\n\n");

      output.push_str("}\n");
    }
    ResolvedTypeKind::Enum { variants, .. } => {
      output.push_str(&format!("impl {} {{\n", resolved_type.name));

      /* Generate constructor methods for each variant */
      for variant in variants {
        let rust_type = format_resolved_type(&variant.variant_type);
        let variant_name_lower = variant.name.to_lowercase();
        output.push_str(&format!("    pub fn {}(value: {}) -> Self {{\n", variant_name_lower, rust_type));
        output.push_str(&format!("        Self::{}(value)\n", variant.name));
        output.push_str("    }\n\n");
      }

      output.push_str("}\n");
    }
    ResolvedTypeKind::Union { .. } => {
      /* Unions need unsafe accessors in Rust */
      output.push_str(&format!("impl {} {{\n", resolved_type.name));
      output.push_str("    /* Union accessors require unsafe code */\n");
      output.push_str("}\n");
    }
    _ => {
      /* Primitives, arrays, and type refs don't need impl blocks */
    }
  }

  output
}

/* Format a ResolvedType to Rust type string */
fn format_resolved_type(resolved_type: &ResolvedType) -> String {
  match &resolved_type.kind {
    ResolvedTypeKind::Primitive { prim_type } => match prim_type {
      crate::abi::types::PrimitiveType::Integral(int_type) => match int_type {
        IntegralType::U8 => "u8".to_string(),
        IntegralType::U16 => "u16".to_string(),
        IntegralType::U32 => "u32".to_string(),
        IntegralType::U64 => "u64".to_string(),
        IntegralType::I8 => "i8".to_string(),
        IntegralType::I16 => "i16".to_string(),
        IntegralType::I32 => "i32".to_string(),
        IntegralType::I64 => "i64".to_string(),
      },
      crate::abi::types::PrimitiveType::FloatingPoint(float_type) => match float_type {
        FloatingPointType::F16 => "f16".to_string(),
        FloatingPointType::F32 => "f32".to_string(),
        FloatingPointType::F64 => "f64".to_string(),
      },
    },
    ResolvedTypeKind::Array { element_type, size_constant_status, .. } => {
      use crate::abi::resolved::ConstantStatus;
      let elem_type = format_resolved_type(element_type);
      match size_constant_status {
        ConstantStatus::Constant => {
          if let crate::abi::resolved::Size::Const(size) = &resolved_type.size {
            let elem_size = match &element_type.size {
              crate::abi::resolved::Size::Const(s) => *s,
              _ => 1,
            };
            format!("[{}; {}]", elem_type, size / elem_size)
          } else {
            format!("Vec<{}>", elem_type)
          }
        }
        _ => format!("Vec<{}>", elem_type),
      }
    }
    ResolvedTypeKind::TypeRef { target_name, .. } => {
      /* For TypeRef, use the target_name (just the simple type name, not FQDN) */
      target_name.clone()
    }
    _ => resolved_type.name.clone(),
  }
}

/* Helper to determine if a type is Copy */
fn is_copy_type(resolved_type: &ResolvedType) -> bool {
  matches!(&resolved_type.kind,
    ResolvedTypeKind::Primitive { .. } |
    ResolvedTypeKind::Array { size_constant_status: crate::abi::resolved::ConstantStatus::Constant, .. }
  )
}
