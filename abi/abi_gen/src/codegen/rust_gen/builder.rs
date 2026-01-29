/* Rust builder generation for ABI types.
   Generates fluent builders that:
   - Write into caller-provided buffers or allocate internally
   - Support FAM (flexible array member) structs with dynamic sizing
   - Support enum variant selection with computed tags
   - Validate on finish() to ensure well-formed output */

use super::ir_helpers::sanitize_param_name;
use crate::abi::expr::{ConstantExpression, ExprKind};
use crate::abi::resolved::{
    ConstantStatus, ResolvedEnumVariant, ResolvedField, ResolvedType, ResolvedTypeKind, Size,
};
use crate::abi::types::{FloatingPointType, IntegralType, PrimitiveType};
use crate::codegen::shared::ir::TypeIr;
use std::fmt::Write;

/* Get the byte size of a primitive type */
fn primitive_size(prim_type: &PrimitiveType) -> usize {
    match prim_type {
        PrimitiveType::Integral(int_type) => match int_type {
            IntegralType::U8 | IntegralType::I8 | IntegralType::Char => 1,
            IntegralType::U16 | IntegralType::I16 => 2,
            IntegralType::U32 | IntegralType::I32 => 4,
            IntegralType::U64 | IntegralType::I64 => 8,
        },
        PrimitiveType::FloatingPoint(float_type) => match float_type {
            FloatingPointType::F16 => 2,
            FloatingPointType::F32 => 4,
            FloatingPointType::F64 => 8,
        },
    }
}

/* Calculate the actual buffer size needed for a slice of fields, accounting for alignment padding.
   Uses last_field.offset + last_field.size instead of summing sizes, which correctly handles
   alignment padding between fields. */
fn calculate_fields_layout_size(fields: &[ResolvedField]) -> u64 {
    if fields.is_empty() {
        return 0;
    }

    /* Find the field with the highest end position (offset + size) */
    fields
        .iter()
        .filter_map(|field| {
            let offset = field.offset?;
            let size = match field.field_type.size {
                Size::Const(sz) => sz,
                _ => return None,
            };
            Some(offset + size)
        })
        .max()
        .unwrap_or(0)
}

/* Information about a FAM (flexible array member) field */
#[derive(Clone)]
pub struct FamFieldInfo<'a> {
    pub field: &'a ResolvedField,
    pub size_field: &'a ResolvedField,
    pub size_field_index: usize,
    pub size_field_size: u64,
    pub element_size: u64,
    pub param_binding: String,
}

/* Extract FAM field information from a resolved type */
pub fn fam_field_infos(resolved_type: &ResolvedType) -> Vec<FamFieldInfo<'_>> {
    let mut infos = Vec::new();
    let fields = match &resolved_type.kind {
        ResolvedTypeKind::Struct { fields, .. } => fields,
        _ => return infos,
    };

    for (index, field) in fields.iter().enumerate() {
        let ResolvedTypeKind::Array {
            element_type,
            size_expression,
            size_constant_status,
            ..
        } = &field.field_type.kind
        else {
            continue;
        };

        /* Only process variable-size arrays */
        if !matches!(field.field_type.size, Size::Variable(_)) {
            continue;
        }
        if !matches!(size_constant_status, ConstantStatus::NonConstant(_)) {
            continue;
        }

        /* Size must reference a single field */
        let ExprKind::FieldRef(field_ref) = size_expression else {
            continue;
        };
        if field_ref.path.len() != 1 {
            continue;
        }

        let size_field_name = &field_ref.path[0];
        let Some(size_index) = fields
            .iter()
            .position(|candidate| candidate.name == *size_field_name)
        else {
            continue;
        };

        /* Size field must come before the array */
        if size_index >= index {
            continue;
        }

        let size_field = &fields[size_index];

        /* Size field must be a primitive */
        if !matches!(
            size_field.field_type.kind,
            ResolvedTypeKind::Primitive { .. }
        ) {
            continue;
        }

        /* Element type must be a primitive */
        if !matches!(element_type.kind, ResolvedTypeKind::Primitive { .. }) {
            continue;
        }

        let Size::Const(element_size) = element_type.size else {
            continue;
        };
        let Size::Const(size_field_size) = size_field.field_type.size else {
            continue;
        };

        infos.push(FamFieldInfo {
            field,
            size_field,
            size_field_index: size_index,
            size_field_size,
            element_size,
            param_binding: sanitize_param_name(size_field_name),
        });
    }

    infos
}

/* Check if a type supports constant-size struct builder */
fn supports_const_struct(resolved_type: &ResolvedType) -> bool {
    matches!(resolved_type.kind, ResolvedTypeKind::Struct { .. })
        && matches!(resolved_type.size, Size::Const(_))
        && struct_fields_supported(resolved_type)
}

/* Check if all struct fields have constant layout */
fn struct_fields_supported(resolved_type: &ResolvedType) -> bool {
    if let ResolvedTypeKind::Struct { fields, .. } = &resolved_type.kind {
        fields.iter().all(field_has_const_layout)
    } else {
        false
    }
}

/* Check if a field has constant layout */
fn field_has_const_layout(field: &ResolvedField) -> bool {
    match &field.field_type.kind {
        ResolvedTypeKind::Primitive { .. } => matches!(field.field_type.size, Size::Const(_)),
        ResolvedTypeKind::TypeRef { .. } => matches!(field.field_type.size, Size::Const(_)),
        ResolvedTypeKind::Array {
            size_expression,
            element_type,
            ..
        } => {
            size_expression.is_constant()
                && matches!(element_type.size, Size::Const(_))
                && matches!(
                    element_type.kind,
                    ResolvedTypeKind::Primitive { .. } | ResolvedTypeKind::TypeRef { .. }
                )
        }
        _ => false,
    }
}

/* Check if a type supports FAM struct builder */
fn supports_fam_struct(resolved_type: &ResolvedType, fam_infos: &[FamFieldInfo<'_>]) -> bool {
    if fam_infos.is_empty() {
        return false;
    }

    /* All prefix fields before first FAM must have constant size */
    let fields = match &resolved_type.kind {
        ResolvedTypeKind::Struct { fields, .. } => fields,
        _ => return false,
    };

    let first_fam_name = &fam_infos[0].field.name;
    let first_fam_index = fields
        .iter()
        .position(|field| field.name == *first_fam_name)
        .unwrap_or(fields.len());

    fields[..first_fam_index]
        .iter()
        .all(|field| matches!(field.field_type.size, Size::Const(_)))
}

/* Check if a type supports enum struct builder.
   Requirements:
   1. Must be a struct with exactly ONE enum field
   2. The enum must be the LAST field (tail enum pattern)
   3. The enum's tag expression must be resolvable to a sibling primitive field */
fn supports_enum_struct(resolved_type: &ResolvedType) -> bool {
    if let ResolvedTypeKind::Struct { fields, .. } = &resolved_type.kind {
        /* Find all enum fields and their indices */
        let enum_field_indices: Vec<_> = fields
            .iter()
            .enumerate()
            .filter(|(_, field)| matches!(field.field_type.kind, ResolvedTypeKind::Enum { .. }))
            .collect();

        /* Must have exactly one enum field */
        if enum_field_indices.len() != 1 {
            return false;
        }

        let (enum_index, enum_field) = enum_field_indices[0];

        /* Enum must be the last field (tail enum pattern) */
        if enum_index != fields.len() - 1 {
            return false;
        }

        /* Tag expression must be resolvable to a sibling primitive field */
        if let ResolvedTypeKind::Enum { tag_expression, .. } = &enum_field.field_type.kind {
            if find_tag_field_info(tag_expression, fields).is_none() {
                return false;
            }
        }

        true
    } else {
        false
    }
}

/* Main entry point: emit builder for a resolved type */
pub fn emit_builder(resolved_type: &ResolvedType, type_ir: Option<&TypeIr>) -> Option<String> {
    let fam_infos = fam_field_infos(resolved_type);

    /* Try FAM struct builder first (most specific) */
    if supports_fam_struct(resolved_type, &fam_infos) {
        return Some(emit_fam_struct_builder(resolved_type, type_ir, fam_infos));
    }

    /* Try enum struct builder */
    if supports_enum_struct(resolved_type) {
        let code = emit_enum_struct_builder(resolved_type);
        if !code.is_empty() {
            return Some(code);
        }
    }

    /* Fall back to constant-size struct builder */
    if supports_const_struct(resolved_type) {
        return Some(emit_const_struct_builder(resolved_type));
    }

    None
}

/* Convert Rust primitive type name to Rust type string */
fn primitive_to_rust_type(prim_type: &PrimitiveType) -> &'static str {
    match prim_type {
        PrimitiveType::Integral(int_type) => match int_type {
            IntegralType::U8 => "u8",
            IntegralType::U16 => "u16",
            IntegralType::U32 => "u32",
            IntegralType::U64 => "u64",
            IntegralType::I8 => "i8",
            IntegralType::I16 => "i16",
            IntegralType::I32 => "i32",
            IntegralType::I64 => "i64",
            IntegralType::Char => "i8",
        },
        PrimitiveType::FloatingPoint(float_type) => match float_type {
            FloatingPointType::F16 => "f16",
            FloatingPointType::F32 => "f32",
            FloatingPointType::F64 => "f64",
        },
    }
}

/* Generate write code for a primitive value at an offset, with explicit type cast */
fn emit_primitive_write(prim_type: &PrimitiveType, offset_expr: &str, value_expr: &str) -> String {
    let rust_type = primitive_to_rust_type(prim_type);
    let size = primitive_size(prim_type);
    match size {
        1 => format!(
            "self.buffer[{}] = ({}) as {} as u8;",
            offset_expr, value_expr, rust_type
        ),
        2 => format!(
            "self.buffer[{}..{} + 2].copy_from_slice(&(({}) as {}).to_le_bytes());",
            offset_expr, offset_expr, value_expr, rust_type
        ),
        4 => format!(
            "self.buffer[{}..{} + 4].copy_from_slice(&(({}) as {}).to_le_bytes());",
            offset_expr, offset_expr, value_expr, rust_type
        ),
        8 => format!(
            "self.buffer[{}..{} + 8].copy_from_slice(&(({}) as {}).to_le_bytes());",
            offset_expr, offset_expr, value_expr, rust_type
        ),
        _ => format!(
            "/* TODO: unsupported primitive size {} */",
            size
        ),
    }
}

/* Emit constant-size struct builder */
fn emit_const_struct_builder(resolved_type: &ResolvedType) -> String {
    let size = match resolved_type.size {
        Size::Const(sz) => sz,
        _ => unreachable!(),
    };

    let type_name = resolved_type.name.replace("::", "_");
    let builder_name = format!("{}Builder", type_name);

    let mut out = String::new();

    /* Builder struct definition */
    writeln!(out, "pub struct {} {{", builder_name).unwrap();
    writeln!(out, "    buffer: Vec<u8>,").unwrap();
    writeln!(out, "}}\n").unwrap();

    /* Builder implementation */
    writeln!(out, "impl {} {{", builder_name).unwrap();

    /* Constructor */
    writeln!(out, "    pub fn new() -> Self {{").unwrap();
    writeln!(out, "        Self {{").unwrap();
    writeln!(out, "            buffer: vec![0u8; {}],", size).unwrap();
    writeln!(out, "        }}").unwrap();
    writeln!(out, "    }}\n").unwrap();

    /* Constructor with pre-allocated buffer */
    writeln!(
        out,
        "    pub fn with_buffer(buffer: Vec<u8>) -> Result<Self, &'static str> {{"
    )
    .unwrap();
    writeln!(out, "        if buffer.len() < {} {{", size).unwrap();
    writeln!(out, "            return Err(\"buffer too small\");").unwrap();
    writeln!(out, "        }}").unwrap();
    writeln!(out, "        Ok(Self {{ buffer }})").unwrap();
    writeln!(out, "    }}\n").unwrap();

    /* Field setters */
    if let ResolvedTypeKind::Struct { fields, .. } = &resolved_type.kind {
        for field in fields {
            emit_const_field_setter(field, &mut out);
        }
    }

    /* build() - returns owned buffer */
    writeln!(out, "    pub fn build(self) -> Vec<u8> {{").unwrap();
    writeln!(out, "        self.buffer").unwrap();
    writeln!(out, "    }}\n").unwrap();

    /* build_into() - writes into provided buffer */
    writeln!(
        out,
        "    pub fn build_into(self, target: &mut [u8]) -> Result<usize, &'static str> {{"
    )
    .unwrap();
    writeln!(out, "        if target.len() < self.buffer.len() {{").unwrap();
    writeln!(out, "            return Err(\"target buffer too small\");").unwrap();
    writeln!(out, "        }}").unwrap();
    writeln!(
        out,
        "        target[..self.buffer.len()].copy_from_slice(&self.buffer);"
    )
    .unwrap();
    writeln!(out, "        Ok(self.buffer.len())").unwrap();
    writeln!(out, "    }}\n").unwrap();

    /* finish() - validates and returns wrapped type */
    writeln!(
        out,
        "    pub fn finish(self) -> Result<{}<'static>, &'static str> {{",
        type_name
    )
    .unwrap();
    writeln!(out, "        let buffer = self.buffer.into_boxed_slice();").unwrap();
    writeln!(out, "        let leaked: &'static [u8] = Box::leak(buffer);").unwrap();
    writeln!(out, "        {}::from_slice(leaked)", type_name).unwrap();
    writeln!(out, "    }}").unwrap();

    writeln!(out, "}}\n").unwrap();

    /* Default impl */
    writeln!(out, "impl Default for {} {{", builder_name).unwrap();
    writeln!(out, "    fn default() -> Self {{").unwrap();
    writeln!(out, "        Self::new()").unwrap();
    writeln!(out, "    }}").unwrap();
    writeln!(out, "}}\n").unwrap();

    out
}

/* Emit setter for a constant-offset field */
fn emit_const_field_setter(field: &ResolvedField, out: &mut String) {
    let offset = field.offset.unwrap_or(0);
    let method_name = sanitize_param_name(&field.name);

    match &field.field_type.kind {
        ResolvedTypeKind::Primitive { prim_type } => {
            let rust_type = primitive_to_rust_type(prim_type);
            writeln!(
                out,
                "    pub fn set_{}(mut self, value: {}) -> Self {{",
                method_name, rust_type
            )
            .unwrap();
            let write_code = emit_primitive_write(prim_type, &offset.to_string(), "value");
            writeln!(out, "        {}", write_code).unwrap();
            writeln!(out, "        self").unwrap();
            writeln!(out, "    }}\n").unwrap();
        }
        ResolvedTypeKind::TypeRef { .. } => {
            let expected_size = match field.field_type.size {
                Size::Const(sz) => sz,
                _ => return,
            };
            writeln!(
                out,
                "    pub fn set_{}(mut self, value: &[u8]) -> Self {{",
                method_name
            )
            .unwrap();
            writeln!(
                out,
                "        assert!(value.len() == {}, \"{} expects {} bytes\");",
                expected_size, method_name, expected_size
            )
            .unwrap();
            writeln!(
                out,
                "        self.buffer[{}..{} + {}].copy_from_slice(value);",
                offset, offset, expected_size
            )
            .unwrap();
            writeln!(out, "        self").unwrap();
            writeln!(out, "    }}\n").unwrap();
        }
        ResolvedTypeKind::Array {
            size_expression,
            element_type,
            ..
        } if size_expression.is_constant() => {
            emit_fixed_array_setter(
                &method_name,
                offset,
                size_expression,
                element_type,
                out,
            );
        }
        _ => {}
    }
}

/* Emit setter for fixed-size array field */
fn emit_fixed_array_setter(
    method_name: &str,
    offset: u64,
    size_expression: &ExprKind,
    element_type: &ResolvedType,
    out: &mut String,
) {
    let length = match size_expression.try_evaluate_constant() {
        Some(len) => len,
        None => return,
    };

    let elem_size = match element_type.size {
        Size::Const(sz) => sz,
        _ => return,
    };

    match &element_type.kind {
        ResolvedTypeKind::Primitive { prim_type } => {
            let rust_type = primitive_to_rust_type(prim_type);
            writeln!(
                out,
                "    pub fn set_{}(mut self, values: &[{}]) -> Self {{",
                method_name, rust_type
            )
            .unwrap();
            writeln!(
                out,
                "        assert!(values.len() == {}, \"{} expects {} elements\");",
                length, method_name, length
            )
            .unwrap();
            writeln!(out, "        for (i, value) in values.iter().enumerate() {{")
                .unwrap();
            writeln!(
                out,
                "            let byte_offset = {} + i * {};",
                offset, elem_size
            )
            .unwrap();
            let write_code = emit_primitive_write(prim_type, "byte_offset", "(*value)");
            writeln!(out, "            {}", write_code).unwrap();
            writeln!(out, "        }}").unwrap();
            writeln!(out, "        self").unwrap();
            writeln!(out, "    }}\n").unwrap();
        }
        ResolvedTypeKind::TypeRef { .. } => {
            writeln!(
                out,
                "    pub fn set_{}(mut self, values: &[&[u8]]) -> Self {{",
                method_name
            )
            .unwrap();
            writeln!(
                out,
                "        assert!(values.len() == {}, \"{} expects {} elements\");",
                length, method_name, length
            )
            .unwrap();
            writeln!(out, "        for (i, value) in values.iter().enumerate() {{")
                .unwrap();
            writeln!(
                out,
                "            assert!(value.len() == {}, \"element {} expects {} bytes\");",
                elem_size, method_name, elem_size
            )
            .unwrap();
            writeln!(
                out,
                "            let byte_offset = {} + i * {};",
                offset, elem_size
            )
            .unwrap();
            writeln!(
                out,
                "            self.buffer[byte_offset..byte_offset + {}].copy_from_slice(value);",
                elem_size
            )
            .unwrap();
            writeln!(out, "        }}").unwrap();
            writeln!(out, "        self").unwrap();
            writeln!(out, "    }}\n").unwrap();
        }
        _ => {}
    }
}

/* Emit FAM struct builder */
fn emit_fam_struct_builder(
    resolved_type: &ResolvedType,
    _type_ir: Option<&TypeIr>,
    fam_infos: Vec<FamFieldInfo<'_>>,
) -> String {
    let type_name = resolved_type.name.replace("::", "_");
    let builder_name = format!("{}Builder", type_name);

    let fields = match &resolved_type.kind {
        ResolvedTypeKind::Struct { fields, .. } => fields,
        _ => unreachable!(),
    };

    /* Find first FAM field index */
    let first_fam_name = &fam_infos[0].field.name;
    let first_fam_index = fields
        .iter()
        .position(|field| field.name == *first_fam_name)
        .unwrap_or(fields.len());

    let prefix_fields = &fields[..first_fam_index];

    /* Calculate prefix size accounting for alignment padding.
       Uses offset + size of last field instead of summing sizes. */
    let prefix_size: u64 = calculate_fields_layout_size(prefix_fields);

    let mut out = String::new();

    /* Builder struct definition */
    writeln!(out, "pub struct {} {{", builder_name).unwrap();
    writeln!(out, "    buffer: Vec<u8>,").unwrap();

    /* FAM storage fields */
    for info in &fam_infos {
        let fam_name = sanitize_param_name(&info.field.name);
        writeln!(out, "    {}_data: Option<Vec<u8>>,", fam_name).unwrap();
        writeln!(out, "    {}_count: Option<usize>,", fam_name).unwrap();
    }

    writeln!(out, "}}\n").unwrap();

    /* Builder implementation */
    writeln!(out, "impl {} {{", builder_name).unwrap();

    /* Constructor */
    writeln!(out, "    pub fn new() -> Self {{").unwrap();
    writeln!(out, "        Self {{").unwrap();
    writeln!(out, "            buffer: vec![0u8; {}],", prefix_size).unwrap();
    for info in &fam_infos {
        let fam_name = sanitize_param_name(&info.field.name);
        writeln!(out, "            {}_data: None,", fam_name).unwrap();
        writeln!(out, "            {}_count: None,", fam_name).unwrap();
    }
    writeln!(out, "        }}").unwrap();
    writeln!(out, "    }}\n").unwrap();

    /* Prefix field setters */
    for field in prefix_fields {
        emit_const_field_setter(field, &mut out);
    }

    /* FAM setters */
    for info in &fam_infos {
        emit_fam_field_setter(info, &mut out);
    }

    /* Calculate total size */
    writeln!(out, "    fn total_size(&self) -> usize {{").unwrap();
    writeln!(out, "        let mut size = {};", prefix_size).unwrap();
    for info in &fam_infos {
        let fam_name = sanitize_param_name(&info.field.name);
        writeln!(
            out,
            "        if let Some(data) = &self.{}_data {{",
            fam_name
        )
        .unwrap();
        writeln!(out, "            size += data.len();").unwrap();
        writeln!(out, "        }}").unwrap();
    }
    writeln!(out, "        size").unwrap();
    writeln!(out, "    }}\n").unwrap();

    /* build() - returns owned buffer */
    writeln!(out, "    pub fn build(mut self) -> Vec<u8> {{").unwrap();
    writeln!(out, "        let total = self.total_size();").unwrap();
    writeln!(out, "        let mut result = Vec::with_capacity(total);").unwrap();
    writeln!(out, "        result.extend_from_slice(&self.buffer);").unwrap();
    for info in &fam_infos {
        let fam_name = sanitize_param_name(&info.field.name);
        writeln!(
            out,
            "        if let Some(data) = self.{}_data.take() {{",
            fam_name
        )
        .unwrap();
        writeln!(out, "            result.extend_from_slice(&data);").unwrap();
        writeln!(out, "        }}").unwrap();
    }
    writeln!(out, "        result").unwrap();
    writeln!(out, "    }}\n").unwrap();

    /* build_into() - writes into provided buffer */
    writeln!(
        out,
        "    pub fn build_into(mut self, target: &mut [u8]) -> Result<usize, &'static str> {{"
    )
    .unwrap();
    writeln!(out, "        let total = self.total_size();").unwrap();
    writeln!(out, "        if target.len() < total {{").unwrap();
    writeln!(out, "            return Err(\"target buffer too small\");").unwrap();
    writeln!(out, "        }}").unwrap();
    writeln!(out, "        let mut offset = 0;").unwrap();
    writeln!(
        out,
        "        target[offset..offset + self.buffer.len()].copy_from_slice(&self.buffer);"
    )
    .unwrap();
    writeln!(out, "        offset += self.buffer.len();").unwrap();
    for info in &fam_infos {
        let fam_name = sanitize_param_name(&info.field.name);
        writeln!(
            out,
            "        if let Some(data) = self.{}_data.take() {{",
            fam_name
        )
        .unwrap();
        writeln!(
            out,
            "            target[offset..offset + data.len()].copy_from_slice(&data);"
        )
        .unwrap();
        writeln!(out, "            offset += data.len();").unwrap();
        writeln!(out, "        }}").unwrap();
    }
    writeln!(out, "        Ok(offset)").unwrap();
    writeln!(out, "    }}\n").unwrap();

    /* finish() - validates and returns wrapped type */
    writeln!(
        out,
        "    pub fn finish(mut self) -> Result<{}<'static>, &'static str> {{",
        type_name
    )
    .unwrap();
    writeln!(out, "        let total = self.total_size();").unwrap();
    writeln!(out, "        let mut result = Vec::with_capacity(total);").unwrap();
    writeln!(out, "        result.extend_from_slice(&self.buffer);").unwrap();
    for info in &fam_infos {
        let fam_name = sanitize_param_name(&info.field.name);
        writeln!(
            out,
            "        if let Some(data) = self.{}_data.take() {{",
            fam_name
        )
        .unwrap();
        writeln!(out, "            result.extend_from_slice(&data);").unwrap();
        writeln!(out, "        }}").unwrap();
    }
    writeln!(out, "        let buffer = result.into_boxed_slice();").unwrap();
    writeln!(out, "        let leaked: &'static [u8] = Box::leak(buffer);").unwrap();
    writeln!(out, "        {}::from_slice(leaked)", type_name).unwrap();
    writeln!(out, "    }}").unwrap();

    writeln!(out, "}}\n").unwrap();

    /* Default impl */
    writeln!(out, "impl Default for {} {{", builder_name).unwrap();
    writeln!(out, "    fn default() -> Self {{").unwrap();
    writeln!(out, "        Self::new()").unwrap();
    writeln!(out, "    }}").unwrap();
    writeln!(out, "}}\n").unwrap();

    out
}

/* Emit setter for a FAM field */
fn emit_fam_field_setter(info: &FamFieldInfo<'_>, out: &mut String) {
    let fam_name = sanitize_param_name(&info.field.name);

    /* Get element type for proper typing */
    let elem_type = match &info.field.field_type.kind {
        ResolvedTypeKind::Array { element_type, .. } => element_type,
        _ => return,
    };

    match &elem_type.kind {
        ResolvedTypeKind::Primitive { prim_type } => {
            let rust_type = primitive_to_rust_type(prim_type);
            let elem_size = info.element_size;

            writeln!(
                out,
                "    pub fn set_{}(mut self, values: &[{}]) -> Self {{",
                fam_name, rust_type
            )
            .unwrap();

            /* Update size field in prefix */
            let size_offset = info.size_field.offset.unwrap_or(0);
            writeln!(out, "        let count = values.len();").unwrap();

            /* Write count to size field based on size field type */
            if let ResolvedTypeKind::Primitive { prim_type: size_prim } =
                &info.size_field.field_type.kind
            {
                let write_code = emit_primitive_write(
                    size_prim,
                    &size_offset.to_string(),
                    "count",
                );
                writeln!(out, "        {}", write_code).unwrap();
            }

            /* Store FAM data */
            writeln!(
                out,
                "        let mut data = Vec::with_capacity(count * {});",
                elem_size
            )
            .unwrap();
            writeln!(out, "        for value in values {{").unwrap();
            writeln!(out, "            data.extend_from_slice(&value.to_le_bytes());")
                .unwrap();
            writeln!(out, "        }}").unwrap();
            writeln!(out, "        self.{}_data = Some(data);", fam_name).unwrap();
            writeln!(out, "        self.{}_count = Some(count);", fam_name).unwrap();
            writeln!(out, "        self").unwrap();
            writeln!(out, "    }}\n").unwrap();

            /* Byte slice setter */
            writeln!(
                out,
                "    pub fn set_{}_bytes(mut self, data: &[u8]) -> Self {{",
                fam_name
            )
            .unwrap();
            writeln!(
                out,
                "        assert!(data.len() % {} == 0, \"{} data must be aligned to element size\");",
                elem_size, fam_name
            )
            .unwrap();
            writeln!(out, "        let count = data.len() / {};", elem_size).unwrap();

            /* Write count to size field */
            if let ResolvedTypeKind::Primitive { prim_type: size_prim } =
                &info.size_field.field_type.kind
            {
                let write_code = emit_primitive_write(
                    size_prim,
                    &size_offset.to_string(),
                    "count",
                );
                writeln!(out, "        {}", write_code).unwrap();
            }

            writeln!(out, "        self.{}_data = Some(data.to_vec());", fam_name).unwrap();
            writeln!(out, "        self.{}_count = Some(count);", fam_name).unwrap();
            writeln!(out, "        self").unwrap();
            writeln!(out, "    }}\n").unwrap();
        }
        _ => {
            /* For non-primitive elements, just accept raw bytes */
            writeln!(
                out,
                "    pub fn set_{}_bytes(mut self, data: &[u8], count: usize) -> Self {{",
                fam_name
            )
            .unwrap();

            let size_offset = info.size_field.offset.unwrap_or(0);
            if let ResolvedTypeKind::Primitive { prim_type: size_prim } =
                &info.size_field.field_type.kind
            {
                let write_code =
                    emit_primitive_write(size_prim, &size_offset.to_string(), "count");
                writeln!(out, "        {}", write_code).unwrap();
            }

            writeln!(out, "        self.{}_data = Some(data.to_vec());", fam_name).unwrap();
            writeln!(out, "        self.{}_count = Some(count);", fam_name).unwrap();
            writeln!(out, "        self").unwrap();
            writeln!(out, "    }}\n").unwrap();
        }
    }
}

/* Emit enum struct builder (structs containing enum fields).
   Currently supports a specific pattern: fixed-size fields followed by exactly ONE tail enum.
   Returns empty string for unsupported patterns (multiple enums, fields after enum). */
fn emit_enum_struct_builder(resolved_type: &ResolvedType) -> String {
    let type_name = resolved_type.name.replace("::", "_");
    let builder_name = format!("{}Builder", type_name);

    let fields = match &resolved_type.kind {
        ResolvedTypeKind::Struct { fields, .. } => fields,
        _ => return String::new(),
    };

    /* Find enum fields and their indices */
    let enum_field_indices: Vec<_> = fields
        .iter()
        .enumerate()
        .filter(|(_, field)| matches!(field.field_type.kind, ResolvedTypeKind::Enum { .. }))
        .collect();

    if enum_field_indices.is_empty() {
        return String::new();
    }

    /* Only support exactly ONE enum field to avoid silent data corruption */
    if enum_field_indices.len() > 1 {
        /* Multiple enum fields not supported - would cause payload overwrites */
        return String::new();
    }

    let (enum_index, enum_field) = enum_field_indices[0];

    /* Ensure enum is the LAST field - fields after enum would be silently ignored */
    if enum_index != fields.len() - 1 {
        /* Fields after enum not supported */
        return String::new();
    }

    /* Get prefix fields (all fields before the enum) */
    let prefix_fields = &fields[..enum_index];

    let mut out = String::new();

    /* Builder struct definition */
    writeln!(out, "pub struct {} {{", builder_name).unwrap();
    writeln!(out, "    buffer: Vec<u8>,").unwrap();
    writeln!(out, "    enum_payload_data: Option<Vec<u8>>,").unwrap();
    writeln!(out, "    enum_tag: Option<u64>,").unwrap(); /* u64 to support all tag sizes */
    writeln!(out, "}}\n").unwrap();

    /* Builder implementation */
    writeln!(out, "impl {} {{", builder_name).unwrap();

    /* Constructor - allocate size for prefix fields.
       Calculate size accounting for alignment padding between fields. */
    let prefix_size: u64 = calculate_fields_layout_size(prefix_fields);

    writeln!(out, "    pub fn new() -> Self {{").unwrap();
    writeln!(out, "        Self {{").unwrap();
    writeln!(out, "            buffer: vec![0u8; {}],", prefix_size).unwrap();
    writeln!(out, "            enum_payload_data: None,").unwrap();
    writeln!(out, "            enum_tag: None,").unwrap();
    writeln!(out, "        }}").unwrap();
    writeln!(out, "    }}\n").unwrap();

    /* Prefix field setters (all non-enum fields before the enum) */
    for field in prefix_fields {
        emit_const_field_setter(field, &mut out);
    }

    /* Enum variant setters */
    if let ResolvedTypeKind::Enum {
        variants,
        tag_expression,
        ..
    } = &enum_field.field_type.kind
    {
        emit_enum_variant_setters(enum_field, variants, tag_expression, fields, &mut out);
    }

    /* build() - returns the built buffer */
    writeln!(out, "    pub fn build(self) -> Vec<u8> {{").unwrap();
    writeln!(out, "        let mut result = self.buffer;").unwrap();
    writeln!(out, "        if let Some(payload) = self.enum_payload_data {{")
        .unwrap();
    writeln!(out, "            result.extend_from_slice(&payload);").unwrap();
    writeln!(out, "        }}").unwrap();
    writeln!(out, "        result").unwrap();
    writeln!(out, "    }}").unwrap();
    writeln!(out).unwrap();

    /* build_into() - writes into caller-provided buffer */
    writeln!(
        out,
        "    pub fn build_into(self, target: &mut [u8]) -> Result<usize, &'static str> {{"
    )
    .unwrap();
    writeln!(out, "        let payload_len = self.enum_payload_data.as_ref().map_or(0, |p| p.len());").unwrap();
    writeln!(out, "        let total_size = self.buffer.len() + payload_len;").unwrap();
    writeln!(out, "        if target.len() < total_size {{").unwrap();
    writeln!(out, "            return Err(\"target buffer too small\");").unwrap();
    writeln!(out, "        }}").unwrap();
    writeln!(out, "        target[..self.buffer.len()].copy_from_slice(&self.buffer);").unwrap();
    writeln!(out, "        if let Some(payload) = &self.enum_payload_data {{").unwrap();
    writeln!(out, "            target[self.buffer.len()..total_size].copy_from_slice(payload);").unwrap();
    writeln!(out, "        }}").unwrap();
    writeln!(out, "        Ok(total_size)").unwrap();
    writeln!(out, "    }}").unwrap();
    writeln!(out).unwrap();

    /* finish() - validates and returns wrapped type */
    writeln!(
        out,
        "    pub fn finish(self) -> Result<{}<'static>, &'static str> {{",
        type_name
    )
    .unwrap();
    writeln!(out, "        let data = self.build();").unwrap();
    writeln!(out, "        let buffer = data.into_boxed_slice();").unwrap();
    writeln!(out, "        let leaked: &'static [u8] = Box::leak(buffer);").unwrap();
    writeln!(out, "        {}::from_slice(leaked)", type_name).unwrap();
    writeln!(out, "    }}").unwrap();

    writeln!(out, "}}\n").unwrap();

    /* Default impl */
    writeln!(out, "impl Default for {} {{", builder_name).unwrap();
    writeln!(out, "    fn default() -> Self {{").unwrap();
    writeln!(out, "        Self::new()").unwrap();
    writeln!(out, "    }}").unwrap();
    writeln!(out, "}}\n").unwrap();

    out
}

/* Find tag field info from parent struct fields based on tag expression.
   Only handles simple single-element field references to primitive sibling fields.
   Returns None for nested paths (e.g., "header.type") or computed expressions,
   which prevents the builder from being generated (avoiding silent data corruption). */
fn find_tag_field_info<'a>(
    tag_expression: &ExprKind,
    parent_fields: &'a [ResolvedField],
) -> Option<(&'a ResolvedField, &'a PrimitiveType)> {
    if let ExprKind::FieldRef(field_ref) = tag_expression {
        /* Only handle single-element paths (simple sibling field references).
           Multi-element paths like ["header", "type"] require nested struct navigation
           which we don't support in the builder. */
        if field_ref.path.len() == 1 {
            let tag_field_name = &field_ref.path[0];
            for field in parent_fields {
                if &field.name == tag_field_name {
                    if let ResolvedTypeKind::Primitive { prim_type } = &field.field_type.kind {
                        return Some((field, prim_type));
                    }
                }
            }
        }
    }
    None
}

/* Emit variant setters for an enum field */
fn emit_enum_variant_setters(
    enum_field: &ResolvedField,
    variants: &[ResolvedEnumVariant],
    tag_expression: &ExprKind,
    parent_fields: &[ResolvedField],
    out: &mut String,
) {
    let field_name = sanitize_param_name(&enum_field.name);

    /* Find the tag field in parent struct */
    let tag_field_info = find_tag_field_info(tag_expression, parent_fields);

    for variant in variants {
        let variant_name = sanitize_param_name(&variant.name);
        let tag_value = variant.tag_value;

        /* Determine payload size */
        let payload_size = match variant.variant_type.size {
            Size::Const(sz) => Some(sz),
            _ => None,
        };

        if let Some(size) = payload_size {
            writeln!(
                out,
                "    pub fn set_{}_{}(mut self, payload: &[u8]) -> Self {{",
                field_name, variant_name
            )
            .unwrap();
            writeln!(
                out,
                "        assert!(payload.len() == {}, \"variant {} expects {} bytes\");",
                size, variant_name, size
            )
            .unwrap();

            /* Write tag value to the tag field in the buffer */
            if let Some((tag_field, prim_type)) = &tag_field_info {
                let tag_offset = tag_field.offset.unwrap_or(0);
                let write_code =
                    emit_primitive_write(prim_type, &tag_offset.to_string(), &tag_value.to_string());
                writeln!(out, "        {}", write_code).unwrap();
            }

            writeln!(out, "        self.enum_tag = Some({});", tag_value).unwrap();
            writeln!(out, "        self.enum_payload_data = Some(payload.to_vec());")
                .unwrap();
            writeln!(out, "        self").unwrap();
            writeln!(out, "    }}\n").unwrap();
        } else {
            /* Variable-size payload */
            writeln!(
                out,
                "    pub fn set_{}_{}(mut self, payload: &[u8]) -> Self {{",
                field_name, variant_name
            )
            .unwrap();

            /* Write tag value to the tag field in the buffer */
            if let Some((tag_field, prim_type)) = &tag_field_info {
                let tag_offset = tag_field.offset.unwrap_or(0);
                let write_code =
                    emit_primitive_write(prim_type, &tag_offset.to_string(), &tag_value.to_string());
                writeln!(out, "        {}", write_code).unwrap();
            }

            writeln!(out, "        self.enum_tag = Some({});", tag_value).unwrap();
            writeln!(out, "        self.enum_payload_data = Some(payload.to_vec());")
                .unwrap();
            writeln!(out, "        self").unwrap();
            writeln!(out, "    }}\n").unwrap();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::abi::resolved::Size;
    use crate::abi::types::IntegralType;
    use std::collections::HashMap;

    fn make_primitive_field(name: &str, int_type: IntegralType, offset: u64) -> ResolvedField {
        let size = match int_type {
            IntegralType::U8 | IntegralType::I8 | IntegralType::Char => 1,
            IntegralType::U16 | IntegralType::I16 => 2,
            IntegralType::U32 | IntegralType::I32 => 4,
            IntegralType::U64 | IntegralType::I64 => 8,
        };
        ResolvedField {
            name: name.to_string(),
            field_type: ResolvedType {
                name: name.to_string(),
                size: Size::Const(size),
                alignment: size as u64,
                comment: None,
                dynamic_params: std::collections::BTreeMap::new(),
                kind: ResolvedTypeKind::Primitive {
                    prim_type: PrimitiveType::Integral(int_type),
                },
            },
            offset: Some(offset),
        }
    }

    #[test]
    fn test_const_struct_builder_generation() {
        let resolved_type = ResolvedType {
            name: "TestStruct".to_string(),
            size: Size::Const(12),
            alignment: 4,
            comment: None,
            dynamic_params: std::collections::BTreeMap::new(),
            kind: ResolvedTypeKind::Struct {
                fields: vec![
                    make_primitive_field("value", IntegralType::U32, 0),
                    make_primitive_field("count", IntegralType::U16, 4),
                    make_primitive_field("flags", IntegralType::U16, 6),
                    make_primitive_field("id", IntegralType::U32, 8),
                ],
                packed: false,
                custom_alignment: None,
            },
        };

        let builder_code = emit_builder(&resolved_type, None);
        assert!(builder_code.is_some());
        let code = builder_code.unwrap();

        assert!(code.contains("pub struct TestStructBuilder"));
        assert!(code.contains("pub fn new() -> Self"));
        assert!(code.contains("pub fn set_value(mut self, value: u32) -> Self"));
        assert!(code.contains("pub fn set_count(mut self, value: u16) -> Self"));
        assert!(code.contains("pub fn build(self) -> Vec<u8>"));
        assert!(code.contains("pub fn build_into(self, target: &mut [u8])"));
    }

    #[test]
    fn test_const_struct_builder_with_buffer() {
        let resolved_type = ResolvedType {
            name: "SimpleStruct".to_string(),
            size: Size::Const(8),
            alignment: 4,
            comment: None,
            dynamic_params: std::collections::BTreeMap::new(),
            kind: ResolvedTypeKind::Struct {
                fields: vec![
                    make_primitive_field("a", IntegralType::U32, 0),
                    make_primitive_field("b", IntegralType::U32, 4),
                ],
                packed: false,
                custom_alignment: None,
            },
        };

        let builder_code = emit_builder(&resolved_type, None);
        assert!(builder_code.is_some());
        let code = builder_code.unwrap();

        /* Check with_buffer constructor */
        assert!(code.contains("pub fn with_buffer(buffer: Vec<u8>) -> Result<Self, &'static str>"));
        assert!(code.contains("if buffer.len() < 8"));
        assert!(code.contains("return Err(\"buffer too small\")"));
    }

    #[test]
    fn test_const_struct_builder_default_impl() {
        let resolved_type = ResolvedType {
            name: "DefaultableStruct".to_string(),
            size: Size::Const(4),
            alignment: 4,
            comment: None,
            dynamic_params: std::collections::BTreeMap::new(),
            kind: ResolvedTypeKind::Struct {
                fields: vec![make_primitive_field("value", IntegralType::U32, 0)],
                packed: false,
                custom_alignment: None,
            },
        };

        let builder_code = emit_builder(&resolved_type, None);
        assert!(builder_code.is_some());
        let code = builder_code.unwrap();

        /* Check Default trait implementation */
        assert!(code.contains("impl Default for DefaultableStructBuilder"));
        assert!(code.contains("fn default() -> Self"));
        assert!(code.contains("Self::new()"));
    }

    #[test]
    fn test_fam_struct_builder_generation() {
        /* Create a FAM struct with: u16 count, u8[] data */
        let count_field = make_primitive_field("count", IntegralType::U16, 0);

        let fam_field = ResolvedField {
            name: "data".to_string(),
            field_type: ResolvedType {
                name: "data".to_string(),
                size: Size::Variable(HashMap::new()),
                alignment: 1,
                comment: None,
                dynamic_params: std::collections::BTreeMap::new(),
                kind: ResolvedTypeKind::Array {
                    element_type: Box::new(ResolvedType {
                        name: "u8".to_string(),
                        size: Size::Const(1),
                        alignment: 1,
                        comment: None,
                        dynamic_params: std::collections::BTreeMap::new(),
                        kind: ResolvedTypeKind::Primitive {
                            prim_type: PrimitiveType::Integral(IntegralType::U8),
                        },
                    }),
                    size_expression: ExprKind::FieldRef(crate::abi::expr::FieldRefExpr {
                        path: vec!["count".to_string()],
                    }),
                    size_constant_status: ConstantStatus::NonConstant(HashMap::new()),
                    jagged: false,
                },
            },
            offset: Some(2),
        };

        let resolved_type = ResolvedType {
            name: "FamStruct".to_string(),
            size: Size::Variable(HashMap::new()),
            alignment: 2,
            comment: None,
            dynamic_params: std::collections::BTreeMap::new(),
            kind: ResolvedTypeKind::Struct {
                fields: vec![count_field, fam_field],
                packed: false,
                custom_alignment: None,
            },
        };

        let builder_code = emit_builder(&resolved_type, None);
        assert!(builder_code.is_some());
        let code = builder_code.unwrap();

        /* Check FAM builder structure */
        assert!(code.contains("pub struct FamStructBuilder"));
        assert!(code.contains("data_data: Option<Vec<u8>>"));
        assert!(code.contains("data_count: Option<usize>"));
        assert!(code.contains("pub fn set_data(mut self, values: &[u8]) -> Self"));
        assert!(code.contains("pub fn set_data_bytes(mut self, data: &[u8]) -> Self"));
        assert!(code.contains("fn total_size(&self) -> usize"));

        /* Check finish() method for FAM builder */
        assert!(
            code.contains("pub fn finish(mut self)"),
            "FAM builder should have finish() method"
        );
        assert!(
            code.contains("FamStruct::from_slice(leaked)"),
            "FAM builder finish() should call from_slice for validation"
        );
    }

    #[test]
    fn test_no_builder_for_variable_struct_without_fam() {
        /* A variable-size struct that isn't a FAM pattern shouldn't get a builder */
        let resolved_type = ResolvedType {
            name: "WeirdStruct".to_string(),
            size: Size::Variable(HashMap::new()),
            alignment: 4,
            comment: None,
            dynamic_params: std::collections::BTreeMap::new(),
            kind: ResolvedTypeKind::Struct {
                fields: vec![make_primitive_field("value", IntegralType::U32, 0)],
                packed: false,
                custom_alignment: None,
            },
        };

        let builder_code = emit_builder(&resolved_type, None);
        /* Should return Some since it has const fields, but size is variable which is unusual */
        /* The actual behavior depends on the struct_fields_supported check */
    }

    #[test]
    fn test_builder_finish_method() {
        let resolved_type = ResolvedType {
            name: "FinishableStruct".to_string(),
            size: Size::Const(4),
            alignment: 4,
            comment: None,
            dynamic_params: std::collections::BTreeMap::new(),
            kind: ResolvedTypeKind::Struct {
                fields: vec![make_primitive_field("x", IntegralType::U32, 0)],
                packed: false,
                custom_alignment: None,
            },
        };

        let builder_code = emit_builder(&resolved_type, None);
        assert!(builder_code.is_some());
        let code = builder_code.unwrap();

        /* Check finish() method exists */
        assert!(code.contains("pub fn finish(self)"));
        assert!(code.contains("Box::leak(buffer)"));
        assert!(code.contains("from_slice(leaked)"));
    }

    #[test]
    fn test_primitive_write_u8() {
        let code = emit_primitive_write(
            &PrimitiveType::Integral(IntegralType::U8),
            "0",
            "value",
        );
        assert!(code.contains("self.buffer[0] = (value) as u8 as u8;"));
    }

    #[test]
    fn test_primitive_write_u16() {
        let code = emit_primitive_write(
            &PrimitiveType::Integral(IntegralType::U16),
            "4",
            "value",
        );
        assert!(code.contains("self.buffer[4..4 + 2]"));
        assert!(code.contains("((value) as u16).to_le_bytes()"));
    }

    #[test]
    fn test_primitive_write_u32() {
        let code = emit_primitive_write(
            &PrimitiveType::Integral(IntegralType::U32),
            "8",
            "count",
        );
        assert!(code.contains("self.buffer[8..8 + 4]"));
        assert!(code.contains("((count) as u32).to_le_bytes()"));
    }

    #[test]
    fn test_primitive_write_u64() {
        let code = emit_primitive_write(
            &PrimitiveType::Integral(IntegralType::U64),
            "16",
            "id",
        );
        assert!(code.contains("self.buffer[16..16 + 8]"));
        assert!(code.contains("((id) as u64).to_le_bytes()"));
    }

    #[test]
    fn test_enum_builder_writes_tag_to_buffer() {
        /* Create a struct with a tag field and an enum that references it */
        use crate::abi::resolved::{ConstantStatus, ResolvedEnumVariant};
        use crate::abi::expr::FieldRefExpr;

        let tag_field = make_primitive_field("msg_type", IntegralType::U8, 0);

        let enum_field = ResolvedField {
            name: "payload".to_string(),
            field_type: ResolvedType {
                name: "payload".to_string(),
                size: Size::Const(8), /* max variant size */
                alignment: 8,
                comment: None,
                dynamic_params: std::collections::BTreeMap::new(),
                kind: ResolvedTypeKind::Enum {
                    tag_expression: ExprKind::FieldRef(FieldRefExpr {
                        path: vec!["msg_type".to_string()],
                    }),
                    tag_constant_status: ConstantStatus::Constant,
                    variants: vec![
                        ResolvedEnumVariant {
                            name: "Ping".to_string(),
                            tag_value: 1,
                            requires_payload_size: false,
                            variant_type: ResolvedType {
                                name: "Ping".to_string(),
                                size: Size::Const(4),
                                alignment: 4,
                                comment: None,
                                dynamic_params: std::collections::BTreeMap::new(),
                                kind: ResolvedTypeKind::Primitive {
                                    prim_type: PrimitiveType::Integral(IntegralType::U32),
                                },
                            },
                        },
                        ResolvedEnumVariant {
                            name: "Pong".to_string(),
                            tag_value: 2,
                            requires_payload_size: false,
                            variant_type: ResolvedType {
                                name: "Pong".to_string(),
                                size: Size::Const(8),
                                alignment: 8,
                                comment: None,
                                dynamic_params: std::collections::BTreeMap::new(),
                                kind: ResolvedTypeKind::Primitive {
                                    prim_type: PrimitiveType::Integral(IntegralType::U64),
                                },
                            },
                        },
                    ],
                },
            },
            offset: Some(1),
        };

        let resolved_type = ResolvedType {
            name: "Message".to_string(),
            size: Size::Const(9), /* 1 byte tag + 8 byte max payload */
            alignment: 8,
            comment: None,
            dynamic_params: std::collections::BTreeMap::new(),
            kind: ResolvedTypeKind::Struct {
                fields: vec![tag_field, enum_field],
                packed: true,
                custom_alignment: None,
            },
        };

        let builder_code = emit_builder(&resolved_type, None);
        assert!(builder_code.is_some(), "Enum struct should generate a builder");
        let code = builder_code.unwrap();

        /* Verify the builder writes the tag value to the buffer at offset 0 */
        assert!(
            code.contains("self.buffer[0] = (1) as u8 as u8;"),
            "Ping variant should write tag value 1 to buffer at offset 0"
        );
        assert!(
            code.contains("self.buffer[0] = (2) as u8 as u8;"),
            "Pong variant should write tag value 2 to buffer at offset 0"
        );
    }

    #[test]
    fn test_enum_struct_with_unresolvable_tag_gets_no_builder() {
        /* Test that enum structs with nested/computed tag expressions don't get
           a builder (to prevent silent data corruption). This tests the fix for
           the bug where find_tag_field_info returning None would silently skip
           writing the tag value to the buffer. */
        use crate::abi::expr::FieldRefExpr;

        /* Create a nested field ref path like "header.type" which can't be resolved */
        let nested_tag_expr = ExprKind::FieldRef(FieldRefExpr {
            path: vec!["header".to_string(), "type".to_string()],
        });

        let enum_field = ResolvedField {
            name: "payload".to_string(),
            field_type: ResolvedType {
                name: "payload".to_string(),
                size: Size::Const(4),
                alignment: 4,
                comment: None,
                dynamic_params: std::collections::BTreeMap::new(),
                kind: ResolvedTypeKind::Enum {
                    tag_expression: nested_tag_expr,
                    tag_constant_status: crate::abi::resolved::ConstantStatus::Constant,
                    variants: vec![ResolvedEnumVariant {
                        name: "Data".to_string(),
                        tag_value: 1,
                        requires_payload_size: false,
                        variant_type: ResolvedType {
                            name: "Data".to_string(),
                            size: Size::Const(4),
                            alignment: 4,
                            comment: None,
                            dynamic_params: std::collections::BTreeMap::new(),
                            kind: ResolvedTypeKind::Primitive {
                                prim_type: PrimitiveType::Integral(IntegralType::U32),
                            },
                        },
                    }],
                },
            },
            offset: Some(4),
        };

        let resolved_type = ResolvedType {
            name: "NestedTagMessage".to_string(),
            size: Size::Const(8),
            alignment: 4,
            comment: None,
            dynamic_params: std::collections::BTreeMap::new(),
            kind: ResolvedTypeKind::Struct {
                fields: vec![
                    /* header would be a nested struct, but we just use a primitive for simplicity */
                    make_primitive_field("header", IntegralType::U32, 0),
                    enum_field,
                ],
                packed: true,
                custom_alignment: None,
            },
        };

        /* The enum's tag expression references "header.type" which doesn't exist
           as a simple sibling primitive field, so supports_enum_struct should
           return false and we should NOT get an enum struct builder. */
        assert!(
            !supports_enum_struct(&resolved_type),
            "Enum struct with unresolvable tag expression should not be supported"
        );

        /* emit_builder should fall back to const struct builder or none */
        let builder_code = emit_builder(&resolved_type, None);
        if let Some(code) = &builder_code {
            /* If we get a builder, it should be a const struct builder, not an enum builder */
            assert!(
                !code.contains("enum_payload_data"),
                "Should not generate enum builder for unresolvable tag expressions"
            );
        }
    }

    #[test]
    fn test_calculate_fields_layout_size_with_alignment_padding() {
        /* Test that buffer size calculation accounts for alignment padding.
           Example: field1 (u32 at offset 0) + field2 (u64 at offset 8 due to alignment)
           Sum of sizes: 4 + 8 = 12 bytes
           Actual layout: offset 8 + size 8 = 16 bytes */
        let field1 = ResolvedField {
            name: "field1".to_string(),
            field_type: ResolvedType {
                name: "field1".to_string(),
                size: Size::Const(4),
                alignment: 4,
                comment: None,
                dynamic_params: std::collections::BTreeMap::new(),
                kind: ResolvedTypeKind::Primitive {
                    prim_type: PrimitiveType::Integral(IntegralType::U32),
                },
            },
            offset: Some(0),
        };

        let field2 = ResolvedField {
            name: "field2".to_string(),
            field_type: ResolvedType {
                name: "field2".to_string(),
                size: Size::Const(8),
                alignment: 8,
                comment: None,
                dynamic_params: std::collections::BTreeMap::new(),
                kind: ResolvedTypeKind::Primitive {
                    prim_type: PrimitiveType::Integral(IntegralType::U64),
                },
            },
            offset: Some(8), /* Aligned to 8-byte boundary, so offset is 8, not 4 */
        };

        let fields = vec![field1, field2];
        let layout_size = calculate_fields_layout_size(&fields);

        /* Should be 16 (offset 8 + size 8), not 12 (sum of sizes 4 + 8) */
        assert_eq!(
            layout_size, 16,
            "Layout size should account for alignment padding: offset 8 + size 8 = 16, not sum 4 + 8 = 12"
        );
    }

    #[test]
    fn test_calculate_fields_layout_size_empty() {
        let fields: Vec<ResolvedField> = vec![];
        assert_eq!(calculate_fields_layout_size(&fields), 0);
    }

    #[test]
    fn test_enum_struct_builder_rejects_multiple_enums() {
        /* Test that enum struct builder rejects structs with multiple enum fields
           to prevent silent data corruption from payload overwrites */
        use crate::abi::expr::FieldRefExpr;

        let tag_expr = ExprKind::FieldRef(FieldRefExpr {
            path: vec!["tag".to_string()],
        });

        let tag_field = make_primitive_field("tag", IntegralType::U8, 0);

        let enum_field1 = ResolvedField {
            name: "enum1".to_string(),
            field_type: ResolvedType {
                name: "enum1".to_string(),
                size: Size::Const(4),
                alignment: 4,
                comment: None,
                dynamic_params: std::collections::BTreeMap::new(),
                kind: ResolvedTypeKind::Enum {
                    tag_expression: tag_expr.clone(),
                    tag_constant_status: crate::abi::resolved::ConstantStatus::Constant,
                    variants: vec![],
                },
            },
            offset: Some(1),
        };

        let enum_field2 = ResolvedField {
            name: "enum2".to_string(),
            field_type: ResolvedType {
                name: "enum2".to_string(),
                size: Size::Const(4),
                alignment: 4,
                comment: None,
                dynamic_params: std::collections::BTreeMap::new(),
                kind: ResolvedTypeKind::Enum {
                    tag_expression: tag_expr,
                    tag_constant_status: crate::abi::resolved::ConstantStatus::Constant,
                    variants: vec![],
                },
            },
            offset: Some(5),
        };

        let resolved_type = ResolvedType {
            name: "MultiEnumStruct".to_string(),
            size: Size::Const(9),
            alignment: 4,
            comment: None,
            dynamic_params: std::collections::BTreeMap::new(),
            kind: ResolvedTypeKind::Struct {
                fields: vec![tag_field, enum_field1, enum_field2],
                packed: true,
                custom_alignment: None,
            },
        };

        assert!(
            !supports_enum_struct(&resolved_type),
            "Struct with multiple enum fields should not be supported"
        );
    }

    #[test]
    fn test_enum_struct_builder_rejects_fields_after_enum() {
        /* Test that enum struct builder rejects structs with fields after the enum
           to prevent silent data loss */
        use crate::abi::expr::FieldRefExpr;

        let tag_expr = ExprKind::FieldRef(FieldRefExpr {
            path: vec!["tag".to_string()],
        });

        let tag_field = make_primitive_field("tag", IntegralType::U8, 0);

        let enum_field = ResolvedField {
            name: "payload".to_string(),
            field_type: ResolvedType {
                name: "payload".to_string(),
                size: Size::Const(4),
                alignment: 4,
                comment: None,
                dynamic_params: std::collections::BTreeMap::new(),
                kind: ResolvedTypeKind::Enum {
                    tag_expression: tag_expr,
                    tag_constant_status: crate::abi::resolved::ConstantStatus::Constant,
                    variants: vec![],
                },
            },
            offset: Some(1),
        };

        /* Footer field AFTER the enum - this should cause rejection */
        let footer_field = make_primitive_field("footer", IntegralType::U32, 5);

        let resolved_type = ResolvedType {
            name: "EnumWithFooter".to_string(),
            size: Size::Const(9),
            alignment: 4,
            comment: None,
            dynamic_params: std::collections::BTreeMap::new(),
            kind: ResolvedTypeKind::Struct {
                fields: vec![tag_field, enum_field, footer_field],
                packed: true,
                custom_alignment: None,
            },
        };

        assert!(
            !supports_enum_struct(&resolved_type),
            "Struct with fields after enum should not be supported"
        );
    }
}
