use crate::abi::expr::{ConstantExpression, ExprKind};
use crate::abi::resolved::{ResolvedType, ResolvedTypeKind, Size};
use std::fmt::Write;
use super::helpers::{
  escape_ts_keyword, is_nested_complex_type, needs_endianness_arg, primitive_to_dataview_getter,
  primitive_to_dataview_setter, primitive_to_ts_return_type, primitive_size,
};

/* Convert size expression to TypeScript code that calls getter methods */
fn size_expression_to_ts_getter_code(expr: &ExprKind) -> String {
    match expr {
        ExprKind::Literal(lit) => {
            use crate::abi::expr::LiteralExpr;
            match lit {
                LiteralExpr::U64(v) => v.to_string(),
                LiteralExpr::U32(v) => v.to_string(),
                LiteralExpr::U16(v) => v.to_string(),
                LiteralExpr::U8(v) => v.to_string(),
                LiteralExpr::I64(v) => v.to_string(),
                LiteralExpr::I32(v) => v.to_string(),
                LiteralExpr::I16(v) => v.to_string(),
                LiteralExpr::I8(v) => v.to_string(),
            }
        }
        ExprKind::FieldRef(field_ref) => {
            /* Convert field reference to getter call */
            format!("this.get_{}()", field_ref.path.join("_"))
        }
        ExprKind::Add(e) => {
            format!("({} + {})",
                    size_expression_to_ts_getter_code(&e.left),
                    size_expression_to_ts_getter_code(&e.right))
        }
        ExprKind::Mul(e) => {
            format!("({} * {})",
                    size_expression_to_ts_getter_code(&e.left),
                    size_expression_to_ts_getter_code(&e.right))
        }
        ExprKind::Sub(e) => {
            format!("({} - {})",
                    size_expression_to_ts_getter_code(&e.left),
                    size_expression_to_ts_getter_code(&e.right))
        }
        ExprKind::Div(e) => {
            format!("({} / {})",
                    size_expression_to_ts_getter_code(&e.left),
                    size_expression_to_ts_getter_code(&e.right))
        }
        _ => expr.to_c_string(), /* Fallback for unhandled cases */
    }
}

/* Emit TypeScript class definition for a resolved type */
pub fn emit_type(resolved_type: &ResolvedType) -> String {
  let mut output = String::new();

  write!(output, "/* ----- TYPE DEFINITION FOR {} ----- */\n\n", resolved_type.name).unwrap();

  /* First emit any nested complex types */
  emit_nested_types(resolved_type, None, &mut output);

  /* Then emit the main type */
  emit_main_type(resolved_type, &mut output);

  output
}

/* Recursively emit nested type definitions */
fn emit_nested_types(type_def: &ResolvedType, type_path: Option<&str>, output: &mut String) {
  match &type_def.kind {
    ResolvedTypeKind::Struct { fields, .. } => {
      let current_path = type_path.unwrap_or(&type_def.name);
      for field in fields {
        if is_nested_complex_type(&field.field_type) {
          let nested_path = format!("{}_{}", current_path, field.name);
          emit_nested_types(&field.field_type, Some(&nested_path), output);
        }
      }
    }
    ResolvedTypeKind::Union { variants } => {
      let current_path = type_path.unwrap_or(&type_def.name);
      for variant in variants {
        if is_nested_complex_type(&variant.field_type) {
          let nested_path = format!("{}_{}", current_path, variant.name);
          emit_nested_types(&variant.field_type, Some(&nested_path), output);
        }
      }
    }
    ResolvedTypeKind::Enum { variants, .. } => {
      let current_path = type_path.unwrap_or(&type_def.name);
      for variant in variants {
        if is_nested_complex_type(&variant.variant_type) {
          let nested_path = format!("{}_{}", current_path, variant.name);
          emit_nested_types(&variant.variant_type, Some(&nested_path), output);
        }
      }
    }
    _ => {}
  }

  /* Emit the current nested type if it has a path */
  if type_path.is_some() {
    let mut nested_type = type_def.clone();
    nested_type.name = format!("{}_Inner", type_path.unwrap());
    emit_main_type(&nested_type, output);
  }
}

/* Emit the main TypeScript class for a type */
fn emit_main_type(resolved_type: &ResolvedType, output: &mut String) {
  let class_name = &resolved_type.name;

  /* Add comment if present */
  if let Some(comment) = &resolved_type.comment {
    write!(output, "/* {} */\n", comment).unwrap();
  }

  match &resolved_type.kind {
    ResolvedTypeKind::Struct { fields, .. } => {
      emit_struct_class(class_name, fields, resolved_type, output);
    }
    ResolvedTypeKind::Union { variants } => {
      emit_union_class(class_name, variants, resolved_type, output);
    }
    ResolvedTypeKind::Enum { variants, .. } => {
      emit_enum_class(class_name, variants, resolved_type, output);
    }
    ResolvedTypeKind::Primitive { .. } => {
      /* Primitives don't need class definitions */
    }
    _ => {
      write!(output, "/* TODO: Implement TypeScript generation for {} */\n\n", class_name).unwrap();
    }
  }
}

/* Emit TypeScript class for a struct */
fn emit_struct_class(
  class_name: &str,
  fields: &[crate::abi::resolved::ResolvedField],
  _resolved_type: &ResolvedType,
  output: &mut String,
) {
  write!(output, "export class {} {{\n", class_name).unwrap();
  write!(output, "  private view: DataView;\n\n").unwrap();

  write!(output, "  private constructor(private buffer: Uint8Array) {{\n").unwrap();
  write!(output, "    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);\n").unwrap();
  write!(output, "  }}\n\n").unwrap();

  /* Emit getter methods for each field */
  let mut offset: u64 = 0;
  let mut after_fam = false;

  for field in fields {
    if matches!(field.field_type.size, Size::Variable(..)) {
      after_fam = true;
    }

    if !after_fam {
      emit_struct_field_getter(class_name, &field.name, &field.field_type, offset, output);
      if let Size::Const(size) = field.field_type.size {
        offset += size;
      }
    }
  }

  /* Emit setter methods for each field */
  offset = 0;
  after_fam = false;

  for field in fields {
    if matches!(field.field_type.size, Size::Variable(..)) {
      after_fam = true;
    }

    if !after_fam {
      emit_struct_field_setter(class_name, &field.name, &field.field_type, offset, output);
      if let Size::Const(size) = field.field_type.size {
        offset += size;
      }
    }
  }

  write!(output, "}}\n\n").unwrap();
}

/* Emit getter for a struct field */
fn emit_struct_field_getter(
  _struct_name: &str,
  field_name: &str,
  field_type: &ResolvedType,
  offset: u64,
  output: &mut String,
) {
  let escaped_name = escape_ts_keyword(field_name);

  match &field_type.kind {
    ResolvedTypeKind::Primitive { prim_type } => {
      let ts_type = primitive_to_ts_return_type(prim_type);
      let getter = primitive_to_dataview_getter(prim_type);
      let needs_le = primitive_size(prim_type) > 1;

      write!(output, "  get_{}(): {} {{\n", escaped_name, ts_type).unwrap();
      if needs_le {
        write!(output, "    return this.view.{}({}, true); /* little-endian */\n", getter, offset).unwrap();
      } else {
        write!(output, "    return this.view.{}({});\n", getter, offset).unwrap();
      }
      write!(output, "  }}\n\n").unwrap();
    }
    ResolvedTypeKind::Array { element_type, size_expression, .. } => {
      if size_expression.is_constant() {
        /* Fixed-size array */
        if let ResolvedTypeKind::Primitive { prim_type } = &element_type.kind {
          let size = size_expression.to_c_string();
          let ts_type = primitive_to_ts_return_type(prim_type);
          let elem_size = primitive_size(prim_type);

          write!(output, "  get_{}(): {}[] {{\n", escaped_name, ts_type).unwrap();
          write!(output, "    const result: {}[] = [];\n", ts_type).unwrap();
          write!(output, "    for (let i = 0; i < {}; i++) {{\n", size).unwrap();
          /* Only add endianness argument for multi-byte types */
          if needs_endianness_arg(prim_type) {
            write!(output, "      result.push(this.view.{}({} + i * {}, true));\n",
                   primitive_to_dataview_getter(prim_type), offset, elem_size).unwrap();
          } else {
            write!(output, "      result.push(this.view.{}({} + i * {}));\n",
                   primitive_to_dataview_getter(prim_type), offset, elem_size).unwrap();
          }
          write!(output, "    }}\n").unwrap();
          write!(output, "    return result;\n").unwrap();
          write!(output, "  }}\n\n").unwrap();
        } else if let ResolvedTypeKind::TypeRef { target_name, .. } = &element_type.kind {
          /* Array of structs - element must have constant size */
          if let Size::Const(elem_size) = element_type.size {
            let size = size_expression.to_c_string();

            write!(output, "  get_{}(): {}[] {{\n", escaped_name, target_name).unwrap();
            write!(output, "    const result: {}[] = [];\n", target_name).unwrap();
            write!(output, "    for (let i = 0; i < {}; i++) {{\n", size).unwrap();
            write!(output, "      const slice = this.buffer.subarray({} + i * {}, {} + (i + 1) * {});\n",
                   offset, elem_size, offset, elem_size).unwrap();
            write!(output, "      result.push({}.from_array(slice)!);\n", target_name).unwrap();
            write!(output, "    }}\n").unwrap();
            write!(output, "    return result;\n").unwrap();
            write!(output, "  }}\n\n").unwrap();
          }
        }
      } else {
        /* Variable-size array (FAM) - generate accessors */
        /* For TypeScript, convert field refs to getter calls */
        let size_expr = size_expression_to_ts_getter_code(size_expression);

        if let ResolvedTypeKind::Primitive { prim_type } = &element_type.kind {
          let ts_type = primitive_to_ts_return_type(prim_type);
          let elem_size = primitive_size(prim_type);

          /* Length getter */
          write!(output, "  get_{}_length(): number {{\n", escaped_name).unwrap();
          write!(output, "    return {};\n", size_expr).unwrap();
          write!(output, "  }}\n\n").unwrap();

          /* Index getter */
          write!(output, "  get_{}_at(index: number): {} {{\n", escaped_name, ts_type).unwrap();
          if needs_endianness_arg(prim_type) {
            write!(output, "    return this.view.{}({} + index * {}, true);\n",
                   primitive_to_dataview_getter(prim_type), offset, elem_size).unwrap();
          } else {
            write!(output, "    return this.view.{}({} + index * {});\n",
                   primitive_to_dataview_getter(prim_type), offset, elem_size).unwrap();
          }
          write!(output, "  }}\n\n").unwrap();

          /* Array getter */
          write!(output, "  get_{}(): {}[] {{\n", escaped_name, ts_type).unwrap();
          write!(output, "    const len = this.get_{}_length();\n", escaped_name).unwrap();
          write!(output, "    const result: {}[] = [];\n", ts_type).unwrap();
          write!(output, "    for (let i = 0; i < len; i++) {{\n").unwrap();
          write!(output, "      result.push(this.get_{}_at(i));\n", escaped_name).unwrap();
          write!(output, "    }}\n").unwrap();
          write!(output, "    return result;\n").unwrap();
          write!(output, "  }}\n\n").unwrap();
        } else if let ResolvedTypeKind::TypeRef { target_name, .. } = &element_type.kind {
          /* Variable-size array of structs */
          if let Size::Const(elem_size) = element_type.size {
            /* Length getter */
            write!(output, "  get_{}_length(): number {{\n", escaped_name).unwrap();
            write!(output, "    return {};\n", size_expr).unwrap();
            write!(output, "  }}\n\n").unwrap();

            /* Index getter */
            write!(output, "  get_{}_at(index: number): {} {{\n", escaped_name, target_name).unwrap();
            write!(output, "    const slice = this.buffer.subarray({} + index * {}, {} + (index + 1) * {});\n",
                   offset, elem_size, offset, elem_size).unwrap();
            write!(output, "    return {}.from_array(slice)!;\n", target_name).unwrap();
            write!(output, "  }}\n\n").unwrap();

            /* Array getter */
            write!(output, "  get_{}(): {}[] {{\n", escaped_name, target_name).unwrap();
            write!(output, "    const len = this.get_{}_length();\n", escaped_name).unwrap();
            write!(output, "    const result: {}[] = [];\n", target_name).unwrap();
            write!(output, "    for (let i = 0; i < len; i++) {{\n").unwrap();
            write!(output, "      result.push(this.get_{}_at(i));\n", escaped_name).unwrap();
            write!(output, "    }}\n").unwrap();
            write!(output, "    return result;\n").unwrap();
            write!(output, "  }}\n\n").unwrap();
          }
        }
      }
    }
    ResolvedTypeKind::TypeRef { target_name, .. } => {
      write!(output, "  get_{}(): {} {{\n", escaped_name, target_name).unwrap();
      write!(output, "    const slice = this.buffer.subarray({});\n", offset).unwrap();
      write!(output, "    return {}.from_array(slice)!;\n", target_name).unwrap();
      write!(output, "  }}\n\n").unwrap();
    }
    _ => {}
  }
}

/* Emit setter for a struct field */
fn emit_struct_field_setter(
  _struct_name: &str,
  field_name: &str,
  field_type: &ResolvedType,
  offset: u64,
  output: &mut String,
) {
  let escaped_name = escape_ts_keyword(field_name);

  match &field_type.kind {
    ResolvedTypeKind::Primitive { prim_type } => {
      let ts_type = primitive_to_ts_return_type(prim_type);
      let setter = primitive_to_dataview_setter(prim_type);
      let needs_le = primitive_size(prim_type) > 1;

      write!(output, "  set_{}(value: {}): void {{\n", escaped_name, ts_type).unwrap();
      if needs_le {
        write!(output, "    this.view.{}({}, value, true); /* little-endian */\n", setter, offset).unwrap();
      } else {
        write!(output, "    this.view.{}({}, value);\n", setter, offset).unwrap();
      }
      write!(output, "  }}\n\n").unwrap();
    }
    ResolvedTypeKind::Array { element_type, size_expression, .. } => {
      if size_expression.is_constant() {
        /* Fixed-size array */
        if let ResolvedTypeKind::Primitive { prim_type } = &element_type.kind {
          let size = size_expression.to_c_string();
          let ts_type = primitive_to_ts_return_type(prim_type);
          let elem_size = primitive_size(prim_type);

          write!(output, "  set_{}(value: {}[]): void {{\n", escaped_name, ts_type).unwrap();
          write!(output, "    if (value.length !== {}) {{\n", size).unwrap();
          write!(output, "      throw new Error('Array length must be {}');\n", size).unwrap();
          write!(output, "    }}\n").unwrap();
          write!(output, "    for (let i = 0; i < {}; i++) {{\n", size).unwrap();
          /* Only add endianness argument for multi-byte types */
          if needs_endianness_arg(prim_type) {
            write!(output, "      this.view.{}({} + i * {}, value[i], true);\n",
                   primitive_to_dataview_setter(prim_type), offset, elem_size).unwrap();
          } else {
            write!(output, "      this.view.{}({} + i * {}, value[i]);\n",
                   primitive_to_dataview_setter(prim_type), offset, elem_size).unwrap();
          }
          write!(output, "    }}\n").unwrap();
          write!(output, "  }}\n\n").unwrap();
        } else if let ResolvedTypeKind::TypeRef { target_name, .. } = &element_type.kind {
          /* Array of structs - element must have constant size */
          if let Size::Const(elem_size) = element_type.size {
            let size = size_expression.to_c_string();

            write!(output, "  set_{}(value: {}[]): void {{\n", escaped_name, target_name).unwrap();
            write!(output, "    if (value.length !== {}) {{\n", size).unwrap();
            write!(output, "      throw new Error('Array length must be {}');\n", size).unwrap();
            write!(output, "    }}\n").unwrap();
            write!(output, "    for (let i = 0; i < {}; i++) {{\n", size).unwrap();
            write!(output, "      const slice = this.buffer.subarray({} + i * {}, {} + (i + 1) * {});\n",
                   offset, elem_size, offset, elem_size).unwrap();
            write!(output, "      slice.set(value[i]['buffer']);\n").unwrap();
            write!(output, "    }}\n").unwrap();
            write!(output, "  }}\n\n").unwrap();
          }
        }
      } else {
        /* Variable-size array (FAM) - generate setters */
        if let ResolvedTypeKind::Primitive { prim_type } = &element_type.kind {
          let ts_type = primitive_to_ts_return_type(prim_type);
          let elem_size = primitive_size(prim_type);

          /* Index setter */
          write!(output, "  set_{}_at(index: number, value: {}): void {{\n", escaped_name, ts_type).unwrap();
          if needs_endianness_arg(prim_type) {
            write!(output, "    this.view.{}({} + index * {}, value, true);\n",
                   primitive_to_dataview_setter(prim_type), offset, elem_size).unwrap();
          } else {
            write!(output, "    this.view.{}({} + index * {}, value);\n",
                   primitive_to_dataview_setter(prim_type), offset, elem_size).unwrap();
          }
          write!(output, "  }}\n\n").unwrap();

          /* Array setter */
          write!(output, "  set_{}(value: {}[]): void {{\n", escaped_name, ts_type).unwrap();
          write!(output, "    const len = Math.min(this.get_{}_length(), value.length);\n", escaped_name).unwrap();
          write!(output, "    for (let i = 0; i < len; i++) {{\n").unwrap();
          write!(output, "      this.set_{}_at(i, value[i]);\n", escaped_name).unwrap();
          write!(output, "    }}\n").unwrap();
          write!(output, "  }}\n\n").unwrap();
        } else if let ResolvedTypeKind::TypeRef { target_name, .. } = &element_type.kind {
          /* Variable-size array of structs */
          if let Size::Const(elem_size) = element_type.size {
            /* Index setter */
            write!(output, "  set_{}_at(index: number, value: {}): void {{\n", escaped_name, target_name).unwrap();
            write!(output, "    const slice = this.buffer.subarray({} + index * {}, {} + (index + 1) * {});\n",
                   offset, elem_size, offset, elem_size).unwrap();
            write!(output, "    slice.set(value['buffer']);\n").unwrap();
            write!(output, "  }}\n\n").unwrap();

            /* Array setter */
            write!(output, "  set_{}(value: {}[]): void {{\n", escaped_name, target_name).unwrap();
            write!(output, "    const len = Math.min(this.get_{}_length(), value.length);\n", escaped_name).unwrap();
            write!(output, "    for (let i = 0; i < len; i++) {{\n").unwrap();
            write!(output, "      this.set_{}_at(i, value[i]);\n", escaped_name).unwrap();
            write!(output, "    }}\n").unwrap();
            write!(output, "  }}\n\n").unwrap();
          }
        }
      }
    }
    ResolvedTypeKind::TypeRef { target_name, .. } => {
      /* For TypeRef (nested structs), generate setter that copies from another instance */
      write!(output, "  set_{}(value: {}): void {{\n", escaped_name, target_name).unwrap();
      write!(output, "    /* Copy bytes from source struct to this field */\n").unwrap();
      write!(output, "    const sourceBytes = (value as any).buffer as Uint8Array;\n").unwrap();
      write!(output, "    this.buffer.set(sourceBytes, {});\n", offset).unwrap();
      write!(output, "  }}\n\n").unwrap();
    }
    _ => {
      /* Other complex types - skip setters for now */
    }
  }
}

/* Emit TypeScript class for a union */
fn emit_union_class(
  class_name: &str,
  _variants: &[crate::abi::resolved::ResolvedField],
  _resolved_type: &ResolvedType,
  output: &mut String,
) {
  write!(output, "export class {} {{\n", class_name).unwrap();
  write!(output, "  private view: DataView;\n\n").unwrap();

  write!(output, "  private constructor(private buffer: Uint8Array) {{\n").unwrap();
  write!(output, "    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);\n").unwrap();
  write!(output, "  }}\n\n").unwrap();

  write!(output, "  /* Union field accessors would go here */\n\n").unwrap();

  write!(output, "}}\n\n").unwrap();
}

/* Emit TypeScript class for an enum */
fn emit_enum_class(
  class_name: &str,
  _variants: &[crate::abi::resolved::ResolvedEnumVariant],
  _resolved_type: &ResolvedType,
  output: &mut String,
) {
  write!(output, "export class {} {{\n", class_name).unwrap();
  write!(output, "  private view: DataView;\n\n").unwrap();

  write!(output, "  private constructor(private buffer: Uint8Array) {{\n").unwrap();
  write!(output, "    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);\n").unwrap();
  write!(output, "  }}\n\n").unwrap();

  write!(output, "  /* Enum variant accessors would go here */\n\n").unwrap();

  write!(output, "}}\n\n").unwrap();
}
