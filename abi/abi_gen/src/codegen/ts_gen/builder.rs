use super::enum_utils::{EnumFieldInfo, enum_field_info, enum_field_infos};
use super::helpers::{
    escape_ts_keyword, needs_endianness_arg, primitive_to_dataview_getter,
    primitive_to_dataview_setter, primitive_to_ts_type, struct_field_const_offset,
};
use super::ir_helpers::{
    DynamicBinding, TsParamBinding, collect_dynamic_param_bindings, resolve_param_binding,
    sanitize_param_name, ts_parameter_bindings,
};
use crate::abi::expr::{ConstantExpression, ExprKind};
use crate::abi::resolved::{
    ConstantStatus, ResolvedEnumVariant, ResolvedField, ResolvedType, ResolvedTypeKind, Size,
};
use crate::abi::types::{IntegralType, PrimitiveType};
use crate::codegen::shared::ir::TypeIr;
use std::collections::BTreeMap;
use std::fmt::Write;
use std::ptr;

struct PrefixFieldMeta<'a> {
    field: &'a ResolvedField,
    offset: u64,
    size: u64,
}

pub fn emit_builder(resolved_type: &ResolvedType, type_ir: Option<&TypeIr>) -> Option<String> {
    if supports_const_struct(resolved_type) && type_ir.is_none() {
        return Some(emit_const_struct_builder(resolved_type));
    }
    if let Some(ir) = type_ir {
        let fam_infos = fam_field_infos(resolved_type);
        if supports_fam_struct(Some(ir), &fam_infos) {
            return Some(emit_fam_struct_builder(resolved_type, ir, fam_infos));
        }
        if supports_enum_struct(resolved_type, Some(ir)) {
            let code = emit_dynamic_struct_builder(resolved_type, ir);
            if !code.is_empty() {
                return Some(code);
            }
        }
    }
    if let Some(plan) = tail_typeref_builder_plan(resolved_type) {
        return Some(emit_tail_typeref_struct_builder(resolved_type, plan));
    }
    if supports_const_struct(resolved_type) {
        return Some(emit_const_struct_builder(resolved_type));
    } else if supports_tagged_enum_struct(resolved_type) {
        let code = emit_tagged_enum_struct_builder(resolved_type);
        if !code.is_empty() {
            return Some(code);
        }
    }
    None
}

#[derive(Clone)]
pub struct FamFieldInfo<'a> {
    pub field: &'a ResolvedField,
    pub size_field: &'a ResolvedField,
    pub size_field_index: usize,
    pub size_field_size: u64,
    pub element_size: u64,
    pub param_binding: String,
}

pub fn fam_field_infos<'a>(resolved_type: &'a ResolvedType) -> Vec<FamFieldInfo<'a>> {
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
        if !matches!(field.field_type.size, Size::Variable(_)) {
            continue;
        }
        if !matches!(size_constant_status, ConstantStatus::NonConstant(_)) {
            continue;
        }
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
        if size_index >= index {
            continue;
        }
        let size_field = &fields[size_index];
        if !matches!(
            size_field.field_type.kind,
            ResolvedTypeKind::Primitive { .. }
        ) {
            continue;
        }
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

#[derive(Clone)]
struct TailTypeRefField<'a> {
    field: &'a ResolvedField,
    storage_ident: String,
    target_ident: Option<String>,
}

struct TailTypeRefPlan<'a> {
    prefix_fields: Vec<&'a ResolvedField>,
    tail_fields: Vec<TailTypeRefField<'a>>,
    prefix_size: u64,
}

fn tail_typeref_builder_plan<'a>(resolved_type: &'a ResolvedType) -> Option<TailTypeRefPlan<'a>> {
    let ResolvedTypeKind::Struct { fields, .. } = &resolved_type.kind else {
        return None;
    };

    let mut prefix_fields = Vec::new();
    let mut tail_fields = Vec::new();
    let mut saw_variable = false;

    for field in fields {
        match &field.field_type.size {
            Size::Const(_) if !saw_variable => {
                if !field_has_const_layout(field) {
                    return None;
                }
                prefix_fields.push(field);
            }
            Size::Const(_) => {
                /* Constant field after a variable-size entry would require dynamic layout math. */
                return None;
            }
            Size::Variable(_) => {
                saw_variable = true;
                if !matches!(field.field_type.kind, ResolvedTypeKind::TypeRef { .. }) {
                    return None;
                }
                let storage_ident = format!("__tnTail_{}", escape_ts_keyword(&field.name));
                let target_ident = match &field.field_type.kind {
                    ResolvedTypeKind::TypeRef { target_name, .. } => Some(target_name.clone()),
                    _ => None,
                };
                tail_fields.push(TailTypeRefField {
                    field,
                    storage_ident,
                    target_ident,
                });
            }
        }
    }

    if tail_fields.is_empty() {
        return None;
    }

    let prefix_size = tail_fields
        .first()
        .and_then(|info| info.field.offset)
        .unwrap_or_else(|| {
            prefix_fields
                .iter()
                .map(|field| match field.field_type.size {
                    Size::Const(sz) => sz,
                    _ => 0,
                })
                .sum()
        });

    Some(TailTypeRefPlan {
        prefix_fields,
        tail_fields,
        prefix_size,
    })
}

fn binding_matches_fam(binding: &TsParamBinding, info: &FamFieldInfo<'_>) -> bool {
    if binding.ts_name == info.param_binding {
        return true;
    }
    binding
        .ts_name
        .strip_suffix(&format!("_{}", info.param_binding))
        .is_some()
}

fn supports_const_struct(resolved_type: &ResolvedType) -> bool {
    matches!(resolved_type.kind, ResolvedTypeKind::Struct { .. })
        && matches!(resolved_type.size, Size::Const(_))
        && struct_fields_supported(resolved_type)
}

fn supports_enum_struct(resolved_type: &ResolvedType, type_ir: Option<&TypeIr>) -> bool {
    if type_ir.is_none() {
        return false;
    }
    if let ResolvedTypeKind::Struct { fields, .. } = &resolved_type.kind {
        fields
            .iter()
            .any(|field| matches!(field.field_type.kind, ResolvedTypeKind::Enum { .. }))
    } else {
        false
    }
}

fn supports_fam_struct<'a>(type_ir: Option<&TypeIr>, fam_infos: &[FamFieldInfo<'a>]) -> bool {
    let Some(ir) = type_ir else {
        return false;
    };
    if fam_infos.is_empty() {
        return false;
    }
    let bindings: Vec<_> = ts_parameter_bindings(ir)
        .into_iter()
        .filter(|binding| !binding.derived)
        .collect();
    bindings.iter().all(|binding| {
        fam_infos
            .iter()
            .any(|info| binding_matches_fam(binding, info))
    })
}

fn struct_fields_supported(resolved_type: &ResolvedType) -> bool {
    if let ResolvedTypeKind::Struct { fields, .. } = &resolved_type.kind {
        fields.iter().all(field_has_const_layout)
    } else {
        false
    }
}

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

fn emit_const_struct_builder(resolved_type: &ResolvedType) -> String {
    let size = match resolved_type.size {
        Size::Const(sz) => sz,
        _ => unreachable!(),
    };
    let class_name = &resolved_type.name;
    let mut out = String::new();

    writeln!(out, "export class {}Builder {{", class_name).unwrap();
    writeln!(out, "  private buffer: Uint8Array;").unwrap();
    writeln!(out, "  private view: DataView;\n").unwrap();
    writeln!(out, "  constructor() {{").unwrap();
    writeln!(out, "    this.buffer = new Uint8Array({});", size).unwrap();
    writeln!(
        out,
        "    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);"
    )
    .unwrap();
    writeln!(out, "  }}\n").unwrap();

    let setter_ctx = SetterContext {
        buffer_ident: "this.buffer",
        view_ident: "this.view",
        invalidate: false,
    };
    if let ResolvedTypeKind::Struct { fields, .. } = &resolved_type.kind {
        for field in fields {
            emit_const_field_setter(field, &setter_ctx, &mut out);
        }
    }

    writeln!(
        out,
        "  build(): Uint8Array {{\n    return this.buffer.slice();\n  }}\n"
    )
    .unwrap();

    writeln!(
        out,
        "  buildInto(target: Uint8Array, offset = 0): Uint8Array {{"
    )
    .unwrap();
    writeln!(
        out,
        "    if (target.length - offset < this.buffer.length) throw new Error(\"target buffer too small\");"
    )
    .unwrap();
    writeln!(
        out,
        "    target.set(this.buffer, offset);\n    return target;\n  }}\n"
    )
    .unwrap();

    writeln!(out, "  finish(): {} {{", class_name).unwrap();
    writeln!(
        out,
        "    const view = {}.from_array(this.buffer.slice());",
        class_name
    )
    .unwrap();
    writeln!(
        out,
        "    if (!view) throw new Error(\"failed to build {}\");",
        class_name
    )
    .unwrap();
    writeln!(out, "    return view;").unwrap();
    writeln!(out, "  }}").unwrap();

    writeln!(out, "}}\n").unwrap();
    out
}

struct SetterContext<'a> {
    buffer_ident: &'a str,
    view_ident: &'a str,
    invalidate: bool,
}

fn emit_const_field_setter(field: &ResolvedField, ctx: &SetterContext, out: &mut String) {
    let offset = field
        .offset
        .unwrap_or_else(|| panic!("builder requires known offset for {}", field.name));
    let method_name = escape_ts_keyword(&field.name);

    match &field.field_type.kind {
        ResolvedTypeKind::Primitive { prim_type } => {
            emit_primitive_setter(method_name, prim_type, offset, ctx, out)
        }
        ResolvedTypeKind::TypeRef { .. } => {
            emit_typeref_setter(method_name, offset, &field.field_type.size, ctx, out)
        }
        ResolvedTypeKind::Array {
            size_expression,
            element_type,
            ..
        } if size_expression.is_constant() => emit_fixed_array_setter(
            method_name,
            offset,
            size_expression.to_c_string(),
            element_type,
            ctx,
            out,
        ),
        _ => {}
    }
}

fn emit_primitive_setter(
    method_name: String,
    prim_type: &PrimitiveType,
    offset: u64,
    ctx: &SetterContext,
    out: &mut String,
) {
    let setter = primitive_to_dataview_setter(prim_type);
    let needs_le = needs_endianness_arg(prim_type);
    let ts_type = primitive_to_ts_type(prim_type);
    writeln!(out, "  set_{}(value: {}): this {{", method_name, ts_type).unwrap();
    if matches!(prim_type, PrimitiveType::Integral(_)) && setter.contains("Big") {
        writeln!(out, "    const cast = __tnToBigInt(value);").unwrap();
        if needs_le {
            writeln!(
                out,
                "    {}.{}({}, cast, true);",
                ctx.view_ident, setter, offset
            )
            .unwrap();
        } else {
            writeln!(out, "    {}.{}({}, cast);", ctx.view_ident, setter, offset).unwrap();
        }
    } else if needs_le {
        writeln!(
            out,
            "    {}.{}({}, value, true);",
            ctx.view_ident, setter, offset
        )
        .unwrap();
    } else {
        writeln!(out, "    {}.{}({}, value);", ctx.view_ident, setter, offset).unwrap();
    }
    if ctx.invalidate {
        writeln!(out, "    this.__tnInvalidate();").unwrap();
    }
    writeln!(out, "    return this;\n  }}\n").unwrap();
}

fn emit_typeref_setter(
    method_name: String,
    offset: u64,
    size: &Size,
    ctx: &SetterContext,
    out: &mut String,
) {
    let expected = match size {
        Size::Const(sz) => *sz,
        _ => panic!("builder typeref requires constant size"),
    };
    writeln!(out, "  set_{}(value: Uint8Array): this {{", method_name).unwrap();
    writeln!(
        out,
        "    if (value.length !== {}) throw new Error(\"{} expects {} bytes\");",
        expected, method_name, expected
    )
    .unwrap();
    writeln!(out, "    {}.set(value, {});", ctx.buffer_ident, offset).unwrap();
    if ctx.invalidate {
        writeln!(out, "    this.__tnInvalidate();").unwrap();
    }
    writeln!(out, "    return this;\n  }}\n").unwrap();
}

fn emit_fixed_array_setter(
    method_name: String,
    offset: u64,
    length_expr: String,
    element_type: &ResolvedType,
    ctx: &SetterContext,
    out: &mut String,
) {
    match &element_type.kind {
        ResolvedTypeKind::Primitive { prim_type } => {
            let setter = primitive_to_dataview_setter(prim_type);
            let needs_le = needs_endianness_arg(prim_type);
            let elem_ty = primitive_to_ts_type(prim_type);
            let elem_size = match element_type.size {
                Size::Const(sz) => sz,
                _ => unreachable!(),
            };
            writeln!(out, "  set_{}(values: {}[]): this {{", method_name, elem_ty).unwrap();
            writeln!(
                out,
                "    if (values.length !== {}) throw new Error(\"{} expects {} elements\");",
                length_expr, method_name, length_expr
            )
            .unwrap();
            writeln!(out, "    for (let i = 0; i < values.length; i++) {{").unwrap();
            writeln!(
                out,
                "      const byteOffset = {} + i * {};",
                offset, elem_size
            )
            .unwrap();
            if needs_le {
                writeln!(
                    out,
                    "      {}.{}(byteOffset, values[i], true);",
                    ctx.view_ident, setter
                )
                .unwrap();
            } else {
                writeln!(
                    out,
                    "      {}.{}(byteOffset, values[i]);",
                    ctx.view_ident, setter
                )
                .unwrap();
            }
            writeln!(out, "    }}").unwrap();
            if ctx.invalidate {
                writeln!(out, "    this.__tnInvalidate();").unwrap();
            }
            writeln!(out, "    return this;\n  }}\n").unwrap();
        }
        ResolvedTypeKind::TypeRef { target_name, .. } => {
            let elem_size = match element_type.size {
                Size::Const(sz) => sz,
                _ => unreachable!(),
            };
            writeln!(
                out,
                "  set_{}(values: {}[]): this {{",
                method_name, target_name
            )
            .unwrap();
            writeln!(
                out,
                "    if (values.length !== {}) throw new Error(\"{} expects {} elements\");",
                length_expr, method_name, length_expr
            )
            .unwrap();
            writeln!(out, "    for (let i = 0; i < values.length; i++) {{").unwrap();
            writeln!(
                out,
                "      const slice = {}.subarray({} + i * {}, {} + (i + 1) * {});",
                ctx.buffer_ident, offset, elem_size, offset, elem_size
            )
            .unwrap();
            writeln!(
                out,
                "      const source = values[i] as unknown as {{ buffer?: ArrayBufferLike; byteOffset?: number; byteLength?: number }};"
            )
            .unwrap();
            writeln!(
                out,
                "      const raw = source.buffer ? new Uint8Array(source.buffer, source.byteOffset ?? 0, {}) : (values[i] as unknown as Uint8Array);",
                elem_size
            )
            .unwrap();
            writeln!(out, "      slice.set(raw);").unwrap();
            writeln!(out, "    }}").unwrap();
            if ctx.invalidate {
                writeln!(out, "    this.__tnInvalidate();").unwrap();
            }
            writeln!(out, "    return this;\n  }}\n").unwrap();
        }
        _ => {}
    }
}

fn supports_tagged_enum_struct(resolved_type: &ResolvedType) -> bool {
    if let ResolvedTypeKind::Struct { fields, .. } = &resolved_type.kind {
        if fields.len() != 2 {
            return false;
        }
        let tag_field = &fields[0];
        let payload_field = &fields[1];

        matches!(
            tag_field.field_type.kind,
            ResolvedTypeKind::Primitive {
                prim_type: PrimitiveType::Integral(IntegralType::U8)
            }
        ) && matches!(payload_field.field_type.kind, ResolvedTypeKind::Enum { .. })
            && enum_variants_const(&payload_field.field_type)
    } else {
        false
    }
}

fn enum_variants_const(enum_type: &ResolvedType) -> bool {
    match &enum_type.kind {
        ResolvedTypeKind::Enum { variants, .. } => variants
            .iter()
            .all(|variant| matches!(variant.variant_type.size, Size::Const(_))),
        _ => false,
    }
}

fn emit_tagged_enum_struct_builder(resolved_type: &ResolvedType) -> String {
    let ResolvedTypeKind::Struct { fields, .. } = &resolved_type.kind else {
        return String::new();
    };
    if fields.len() != 2 {
        return String::new();
    }
    let variants = match &fields[1].field_type.kind {
        ResolvedTypeKind::Enum { variants, .. } => variants,
        _ => return String::new(),
    };

    let class_name = &resolved_type.name;
    let mut out = String::new();

    writeln!(out, "export class {}Builder {{", class_name).unwrap();
    writeln!(out, "  private tag: number | null = null;").unwrap();
    writeln!(out, "  private payload: Uint8Array | null = null;\n").unwrap();
    writeln!(out, "  constructor() {{}}\n").unwrap();

    for variant in variants {
        emit_variant_selector(variant, &mut out);
    }

    writeln!(
        out,
        "  build(): Uint8Array {{\n    if (this.tag === null || !this.payload) throw new Error(\"{} builder missing variant\");",
        class_name
    )
    .unwrap();
    writeln!(
        out,
        "    const buffer = new Uint8Array(1 + this.payload.length);"
    )
    .unwrap();
    writeln!(out, "    buffer[0] = this.tag;").unwrap();
    writeln!(
        out,
        "    buffer.set(this.payload, 1);\n    return buffer;\n  }}\n"
    )
    .unwrap();

    writeln!(
        out,
        "  buildInto(target: Uint8Array, offset = 0): Uint8Array {{"
    )
    .unwrap();
    writeln!(out, "    const bytes = this.build();").unwrap();
    writeln!(
        out,
        "    if (target.length - offset < bytes.length) throw new Error(\"target buffer too small\");"
    )
    .unwrap();
    writeln!(
        out,
        "    target.set(bytes, offset);\n    return target;\n  }}\n"
    )
    .unwrap();

    writeln!(out, "  finish(): {} {{", class_name).unwrap();
    writeln!(
        out,
        "    const view = {}.from_array(this.build());",
        class_name
    )
    .unwrap();
    writeln!(
        out,
        "    if (!view) throw new Error(\"failed to build {}\");",
        class_name
    )
    .unwrap();
    writeln!(out, "    return view;").unwrap();
    writeln!(out, "  }}").unwrap();

    writeln!(out, "}}\n").unwrap();

    out
}

fn emit_variant_selector(variant: &ResolvedEnumVariant, out: &mut String) {
    let method_name = escape_ts_keyword(&format!("select_{}", variant.name));
    let expected = match variant.variant_type.size {
        Size::Const(sz) => sz,
        _ => return,
    };
    writeln!(
        out,
        "  {}(payload: Uint8Array | {{ build(): Uint8Array }}): this {{",
        method_name
    )
    .unwrap();
    writeln!(
        out,
        "    const bytes = payload instanceof Uint8Array ? payload : payload.build();"
    )
    .unwrap();
    writeln!(
        out,
        "    if (bytes.length !== {}) throw new Error(\"{} expects {} bytes\");",
        expected, method_name, expected
    )
    .unwrap();
    writeln!(out, "    this.tag = {};", variant.tag_value).unwrap();
    writeln!(
        out,
        "    this.payload = new Uint8Array(bytes);\n    return this;\n  }}\n"
    )
    .unwrap();
}

fn fam_param_expression(
    type_name: &str,
    fam_infos: &[FamFieldInfo<'_>],
    binding: &TsParamBinding,
) -> Option<String> {
    for info in fam_infos {
        if binding_matches_fam(binding, info) {
            let method = escape_ts_keyword(&info.field.name);
            let count_ident = fam_count_ident(&method);
            return Some(format!(
                "(() => {{ if (this.{count} === null) throw new Error(\"{ty}Builder: field '{field}' must be written before computing params\"); return __tnToBigInt(this.{count}); }})()",
                count = count_ident,
                ty = type_name,
                field = info.field.name
            ));
        }
    }
    None
}

fn fam_storage_ident(method: &str) -> String {
    format!("__tnFam_{}", method)
}

fn fam_count_ident(method: &str) -> String {
    format!("{}Count", fam_storage_ident(method))
}

fn fam_writer_ident(method: &str) -> String {
    format!("__tnFamWriter_{}", method)
}

fn emit_fam_struct_builder(
    resolved_type: &ResolvedType,
    type_ir: &TypeIr,
    fam_infos: Vec<FamFieldInfo<'_>>,
) -> String {
    let class_name = &resolved_type.name;
    let builder_name = format!("{}Builder", class_name);
    let fields = match &resolved_type.kind {
        ResolvedTypeKind::Struct { fields, .. } => fields,
        _ => unreachable!(),
    };
    let first_fam_name = fam_infos
        .first()
        .map(|info| &info.field.name)
        .expect("fam builder requires at least one FAM field");
    let first_fam_index = fields
        .iter()
        .position(|field| field.name == *first_fam_name)
        .unwrap_or(fields.len());
    let prefix_fields = &fields[..first_fam_index];
    let trailing_fields = &fields[first_fam_index..];
    let has_trailing_size_fields = fam_infos
        .iter()
        .any(|info| info.size_field_index >= first_fam_index);
    let prefix_size: u64 = prefix_fields
        .iter()
        .map(|field| match field.field_type.size {
            Size::Const(sz) => sz,
            _ => panic!(
                "FAM struct builder requires constant-size prefix field '{}'",
                field.name
            ),
        })
        .sum();
    let bindings: Vec<_> = ts_parameter_bindings(type_ir)
        .into_iter()
        .filter(|binding| !binding.derived)
        .collect();
    let mut param_exprs = Vec::new();
    for binding in &bindings {
        if let Some(expr) = fam_param_expression(class_name, &fam_infos, binding) {
            param_exprs.push((binding.ts_name.clone(), expr));
        }
    }
    let mut out = String::new();
    writeln!(out, "export class {} {{", builder_name).unwrap();
    writeln!(out, "  private buffer: Uint8Array;").unwrap();
    writeln!(out, "  private view: DataView;").unwrap();
    writeln!(
        out,
        "  private __tnCachedParams: {}.Params | null = null;",
        class_name
    )
    .unwrap();
    writeln!(out, "  private __tnLastBuffer: Uint8Array | null = null;").unwrap();
    writeln!(
        out,
        "  private __tnLastParams: {}.Params | null = null;",
        class_name
    )
    .unwrap();
    for info in &fam_infos {
        let method = escape_ts_keyword(&info.field.name);
        let storage_ident = fam_storage_ident(&method);
        let count_ident = fam_count_ident(&method);
        let writer_ident = fam_writer_ident(&method);
        writeln!(
            out,
            "  private {}: Uint8Array | null = null;",
            storage_ident
        )
        .unwrap();
        writeln!(out, "  private {}: number | null = null;", count_ident).unwrap();
        writeln!(
            out,
            "  private {}?: __TnFamWriterResult<{}>;",
            writer_ident, builder_name
        )
        .unwrap();
    }
    writeln!(out, "\n  constructor() {{").unwrap();
    writeln!(out, "    this.buffer = new Uint8Array({});", prefix_size).unwrap();
    writeln!(
        out,
        "    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);"
    )
    .unwrap();
    writeln!(out, "  }}\n").unwrap();
    writeln!(out, "  private __tnInvalidate(): void {{").unwrap();
    writeln!(out, "    this.__tnCachedParams = null;").unwrap();
    writeln!(out, "    this.__tnLastBuffer = null;").unwrap();
    writeln!(out, "    this.__tnLastParams = null;").unwrap();
    writeln!(out, "  }}\n").unwrap();

    let setter_ctx = SetterContext {
        buffer_ident: "this.buffer",
        view_ident: "this.view",
        invalidate: true,
    };
    for field in prefix_fields {
        emit_const_field_setter(field, &setter_ctx, &mut out);
    }

    for info in &fam_infos {
        let method = escape_ts_keyword(&info.field.name);
        let writer_ident = fam_writer_ident(&method);
        let storage_ident = fam_storage_ident(&method);
        let count_ident = fam_count_ident(&method);
        let size_field_name = escape_ts_keyword(&info.size_field.name);
        let count_expr = if info.element_size == 1 {
            "bytes.length".to_string()
        } else {
            format!("bytes.length / {}", info.element_size)
        };
        writeln!(
            out,
            "  {}(): __TnFamWriterResult<{}> {{",
            method, builder_name
        )
        .unwrap();
        writeln!(out, "    if (!this.{}) {{", writer_ident).unwrap();
        writeln!(
            out,
            "      this.{} = __tnCreateFamWriter(this, \"{}\", (payload) => {{",
            writer_ident, method
        )
        .unwrap();
        writeln!(out, "        const bytes = new Uint8Array(payload);").unwrap();
        if info.element_size > 1 {
            writeln!(
                out,
                "        if (bytes.length % {} !== 0) throw new Error(\"{}Builder: {} length must be a multiple of {}\");",
                info.element_size,
                class_name,
                info.field.name,
                info.element_size
            )
            .unwrap();
        }
        writeln!(out, "        const elementCount = {};", count_expr).unwrap();
        writeln!(out, "        this.{} = bytes;", storage_ident).unwrap();
        writeln!(out, "        this.{} = elementCount;", count_ident).unwrap();
        if info.size_field_index < first_fam_index {
            writeln!(out, "        this.set_{}(elementCount);", size_field_name).unwrap();
        }
        writeln!(out, "        this.__tnInvalidate();").unwrap();
        writeln!(out, "      }});").unwrap();
        writeln!(out, "    }}").unwrap();
        writeln!(out, "    return this.{}!;", writer_ident).unwrap();
        writeln!(out, "  }}\n").unwrap();
    }

    writeln!(out, "  build(): Uint8Array {{").unwrap();
    writeln!(out, "    const params = this.__tnComputeParams();").unwrap();
    writeln!(
        out,
        "    const size = {}.footprintFromParams(params);",
        class_name
    )
    .unwrap();
    writeln!(out, "    const buffer = new Uint8Array(size);").unwrap();
    writeln!(out, "    this.__tnWriteInto(buffer);").unwrap();
    writeln!(out, "    this.__tnValidateOrThrow(buffer, params);").unwrap();
    writeln!(out, "    return buffer;").unwrap();
    writeln!(out, "  }}\n").unwrap();

    writeln!(
        out,
        "  buildInto(target: Uint8Array, offset = 0): Uint8Array {{"
    )
    .unwrap();
    writeln!(out, "    const params = this.__tnComputeParams();").unwrap();
    writeln!(
        out,
        "    const size = {}.footprintFromParams(params);",
        class_name
    )
    .unwrap();
    writeln!(
        out,
        "    if (target.length - offset < size) throw new Error(\"{}Builder: target buffer too small\");",
        class_name
    )
    .unwrap();
    writeln!(
        out,
        "    const slice = target.subarray(offset, offset + size);"
    )
    .unwrap();
    writeln!(out, "    this.__tnWriteInto(slice);").unwrap();
    writeln!(out, "    this.__tnValidateOrThrow(slice, params);").unwrap();
    writeln!(out, "    return target;").unwrap();
    writeln!(out, "  }}\n").unwrap();

    writeln!(out, "  finish(): {} {{", class_name).unwrap();
    writeln!(out, "    const buffer = this.build();").unwrap();
    writeln!(
        out,
        "    const params = this.__tnLastParams ?? this.__tnComputeParams();"
    )
    .unwrap();
    writeln!(
        out,
        "    const view = {}.from_array(buffer, {{ params }});",
        class_name
    )
    .unwrap();
    writeln!(
        out,
        "    if (!view) throw new Error(\"{}Builder: failed to finalize view\");",
        class_name
    )
    .unwrap();
    writeln!(out, "    return view;").unwrap();
    writeln!(out, "  }}\n").unwrap();

    writeln!(out, "  finishView(): {} {{", class_name).unwrap();
    writeln!(out, "    return this.finish();").unwrap();
    writeln!(out, "  }}\n").unwrap();

    writeln!(out, "  dynamicParams(): {}.Params {{", class_name).unwrap();
    writeln!(out, "    return this.__tnComputeParams();").unwrap();
    writeln!(out, "  }}\n").unwrap();

    writeln!(
        out,
        "  private __tnComputeParams(): {}.Params {{",
        class_name
    )
    .unwrap();
    writeln!(
        out,
        "    if (this.__tnCachedParams) return this.__tnCachedParams;"
    )
    .unwrap();
    writeln!(
        out,
        "    const params = {}.Params.fromValues({{",
        class_name
    )
    .unwrap();
    for (name, expr) in &param_exprs {
        writeln!(out, "      {}: {},", name, expr).unwrap();
    }
    writeln!(out, "    }});").unwrap();
    writeln!(out, "    this.__tnCachedParams = params;").unwrap();
    writeln!(out, "    return params;").unwrap();
    writeln!(out, "  }}\n").unwrap();

    writeln!(out, "  private __tnWriteInto(target: Uint8Array): void {{").unwrap();
    writeln!(out, "    target.set(this.buffer, 0);").unwrap();
    writeln!(out, "    let cursor = this.buffer.length;").unwrap();
    if has_trailing_size_fields {
        writeln!(
            out,
            "    const view = new DataView(target.buffer, target.byteOffset, target.byteLength);"
        )
        .unwrap();
    }
    for field in trailing_fields {
        if let Some(info) = fam_infos
            .iter()
            .find(|candidate| candidate.field.name == field.name)
        {
            let method = escape_ts_keyword(&info.field.name);
            let storage_ident = fam_storage_ident(&method);
            let local_ident = format!("__tnLocal_{}_bytes", method);
            writeln!(out, "    const {} = this.{};", local_ident, storage_ident).unwrap();
            writeln!(
                out,
                "    if (!{}) throw new Error(\"{}Builder: field '{}' must be written before build\");",
                local_ident, class_name, info.field.name
            )
            .unwrap();
            writeln!(out, "    target.set({}, cursor);", local_ident).unwrap();
            writeln!(out, "    cursor += {}.length;", local_ident).unwrap();
            continue;
        }

        if let Some(info) = fam_infos.iter().find(|candidate| {
            candidate.size_field.name == field.name && candidate.size_field_index >= first_fam_index
        }) {
            let method = escape_ts_keyword(&info.field.name);
            let count_ident = fam_count_ident(&method);
            let local_count = format!("__tnLocal_{}_count", method);
            writeln!(out, "    const {} = this.{};", local_count, count_ident).unwrap();
            writeln!(
                out,
                "    if ({} === null) throw new Error(\"{}Builder: field '{}' must be written before build\");",
                local_count, class_name, info.field.name
            )
            .unwrap();
            if let ResolvedTypeKind::Primitive { prim_type } = &info.size_field.field_type.kind {
                let setter = primitive_to_dataview_setter(prim_type);
                if needs_endianness_arg(prim_type) {
                    writeln!(out, "    view.{}(cursor, {}, true);", setter, local_count).unwrap();
                } else {
                    writeln!(out, "    view.{}(cursor, {});", setter, local_count).unwrap();
                }
                writeln!(out, "    cursor += {};", info.size_field_size).unwrap();
                continue;
            } else {
                panic!(
                    "FAM builder '{}' expects primitive size field '{}'",
                    class_name, info.size_field.name
                );
            }
        }

        panic!(
            "FAM builder '{}' cannot emit trailing field '{}'",
            class_name, field.name
        );
    }
    writeln!(out, "  }}\n").unwrap();

    writeln!(
        out,
        "  private __tnValidateOrThrow(buffer: Uint8Array, params: {}.Params): void {{",
        class_name
    )
    .unwrap();
    writeln!(
        out,
        "    const result = {}.validate(buffer, {{ params }});",
        class_name
    )
    .unwrap();
    writeln!(out, "    if (!result.ok) {{").unwrap();
    writeln!(
        out,
        "      throw new Error(`${{ {} }}Builder: builder produced invalid buffer (code=${{result.code ?? \"unknown\"}})`);",
        class_name
    )
    .unwrap();
    writeln!(out, "    }}").unwrap();
    writeln!(out, "    this.__tnLastParams = result.params ?? params;").unwrap();
    writeln!(out, "    this.__tnLastBuffer = buffer;").unwrap();
    writeln!(out, "  }}").unwrap();

    writeln!(out, "}}\n").unwrap();
    out
}

fn emit_tail_typeref_struct_builder(
    resolved_type: &ResolvedType,
    plan: TailTypeRefPlan<'_>,
) -> String {
    let class_name = &resolved_type.name;
    let builder_name = format!("{}Builder", class_name);
    let mut out = String::new();

    writeln!(out, "export class {} {{", builder_name).unwrap();
    writeln!(out, "  private buffer: Uint8Array;").unwrap();
    writeln!(out, "  private view: DataView;").unwrap();
    for tail in &plan.tail_fields {
        writeln!(
            out,
            "  private {}: Uint8Array | null = null;",
            tail.storage_ident
        )
        .unwrap();
    }
    writeln!(out, "\n  constructor() {{").unwrap();
    writeln!(
        out,
        "    this.buffer = new Uint8Array({});",
        plan.prefix_size
    )
    .unwrap();
    writeln!(
        out,
        "    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);"
    )
    .unwrap();
    writeln!(out, "  }}\n").unwrap();

    writeln!(out, "  private __tnInvalidate(): void {{").unwrap();
    writeln!(out, "    /* Placeholder for future cache invalidation. */").unwrap();
    writeln!(out, "  }}\n").unwrap();

    let setter_ctx = SetterContext {
        buffer_ident: "this.buffer",
        view_ident: "this.view",
        invalidate: true,
    };
    for field in plan.prefix_fields {
        emit_const_field_setter(field, &setter_ctx, &mut out);
    }

    for tail in &plan.tail_fields {
        let method_name = escape_ts_keyword(&tail.field.name);
        let ts_target = tail
            .target_ident
            .clone()
            .unwrap_or_else(|| "Uint8Array".to_string());
        writeln!(
            out,
            "  set_{}(value: {} | __TnStructFieldInput): this {{",
            method_name, ts_target
        )
        .unwrap();
        writeln!(
            out,
            "    const bytes = __tnResolveStructFieldInput(value as __TnStructFieldInput, \"{}Builder::{}\");",
            class_name, tail.field.name
        )
        .unwrap();
        writeln!(out, "    this.{} = bytes;", tail.storage_ident).unwrap();
        writeln!(out, "    this.__tnInvalidate();").unwrap();
        writeln!(out, "    return this;\n  }}\n").unwrap();
    }

    writeln!(out, "  build(): Uint8Array {{").unwrap();
    writeln!(
        out,
        "    const fragments = this.__tnCollectTailFragments();"
    )
    .unwrap();
    writeln!(out, "    const size = this.__tnComputeSize(fragments);").unwrap();
    writeln!(out, "    const buffer = new Uint8Array(size);").unwrap();
    writeln!(out, "    this.__tnWriteInto(buffer, fragments);").unwrap();
    writeln!(out, "    this.__tnValidateOrThrow(buffer);").unwrap();
    writeln!(out, "    return buffer;\n  }}\n").unwrap();

    writeln!(
        out,
        "  buildInto(target: Uint8Array, offset = 0): Uint8Array {{"
    )
    .unwrap();
    writeln!(
        out,
        "    const fragments = this.__tnCollectTailFragments();"
    )
    .unwrap();
    writeln!(out, "    const size = this.__tnComputeSize(fragments);").unwrap();
    writeln!(
        out,
        "    if (target.length - offset < size) throw new Error(\"{}Builder: target buffer too small\");",
        class_name
    )
    .unwrap();
    writeln!(
        out,
        "    const slice = target.subarray(offset, offset + size);"
    )
    .unwrap();
    writeln!(out, "    this.__tnWriteInto(slice, fragments);").unwrap();
    writeln!(out, "    this.__tnValidateOrThrow(slice);").unwrap();
    writeln!(out, "    return target;\n  }}\n").unwrap();

    writeln!(out, "  finish(): {} {{", class_name).unwrap();
    writeln!(out, "    const buffer = this.build();").unwrap();
    writeln!(out, "    const view = {}.from_array(buffer);", class_name).unwrap();
    writeln!(
        out,
        "    if (!view) throw new Error(\"{}Builder: failed to finalize view\");",
        class_name
    )
    .unwrap();
    writeln!(out, "    return view;\n  }}\n").unwrap();

    writeln!(out, "  finishView(): {} {{", class_name).unwrap();
    writeln!(out, "    return this.finish();").unwrap();
    writeln!(out, "  }}\n").unwrap();

    writeln!(out, "  private __tnCollectTailFragments(): Uint8Array[] {{").unwrap();
    writeln!(out, "    return [").unwrap();
    for tail in &plan.tail_fields {
        writeln!(out, "      (() => {{").unwrap();
        writeln!(out, "        const bytes = this.{};", tail.storage_ident).unwrap();
        writeln!(
            out,
            "        if (!bytes) throw new Error(\"{}Builder: field '{}' must be set before build()\");",
            class_name, tail.field.name
        )
        .unwrap();
        writeln!(out, "        return bytes;").unwrap();
        writeln!(out, "      }})(),").unwrap();
    }
    writeln!(out, "    ];").unwrap();
    writeln!(out, "  }}\n").unwrap();

    writeln!(
        out,
        "  private __tnComputeSize(fragments: readonly Uint8Array[]): number {{"
    )
    .unwrap();
    writeln!(out, "    let total = this.buffer.length;").unwrap();
    writeln!(out, "    for (const fragment of fragments) {{").unwrap();
    writeln!(out, "      total += fragment.length;").unwrap();
    writeln!(out, "    }}").unwrap();
    writeln!(out, "    return total;\n  }}\n").unwrap();

    writeln!(
        out,
        "  private __tnWriteInto(target: Uint8Array, fragments: readonly Uint8Array[]): void {{"
    )
    .unwrap();
    writeln!(out, "    target.set(this.buffer, 0);").unwrap();
    writeln!(out, "    let cursor = this.buffer.length;").unwrap();
    writeln!(out, "    for (const fragment of fragments) {{").unwrap();
    writeln!(out, "      target.set(fragment, cursor);").unwrap();
    writeln!(out, "      cursor += fragment.length;").unwrap();
    writeln!(out, "    }}").unwrap();
    writeln!(out, "  }}\n").unwrap();

    writeln!(
        out,
        "  private __tnValidateOrThrow(buffer: Uint8Array): void {{"
    )
    .unwrap();
    writeln!(out, "    const result = {}.validate(buffer);", class_name).unwrap();
    writeln!(out, "    if (!result.ok) {{").unwrap();
    writeln!(
        out,
        "      throw new Error(`{}Builder: builder produced invalid buffer (code=${{result.code ?? \"unknown\"}})`);",
        class_name
    )
    .unwrap();
    writeln!(out, "    }}").unwrap();
    writeln!(out, "  }}").unwrap();

    writeln!(out, "}}\n").unwrap();
    out
}

fn emit_dynamic_struct_builder(resolved_type: &ResolvedType, type_ir: &TypeIr) -> String {
    let enum_infos = enum_field_infos(resolved_type);
    let builder_enum_infos: Vec<_> = enum_infos
        .iter()
        .filter(|info| info.tag_field.is_some() || info.tag_expression.is_some())
        .cloned()
        .collect();
    if !builder_enum_infos.is_empty() {
        if builder_enum_infos.len() == 1 {
            return emit_enum_builder(resolved_type, type_ir, builder_enum_infos[0].clone());
        }
        let physical_infos: Vec<_> = builder_enum_infos
            .iter()
            .filter(|info| info.tag_field.is_some())
            .cloned()
            .collect();
        if physical_infos.len() == builder_enum_infos.len() {
            if let Some(layout) = collect_multi_enum_layout(resolved_type, &physical_infos) {
                return emit_multi_enum_builder(resolved_type, type_ir, layout);
            }
        }
    }
    let fam_infos = fam_field_infos(resolved_type);
    if !fam_infos.is_empty() {
        return emit_fam_struct_builder(resolved_type, type_ir, fam_infos);
    }
    if supports_tagged_enum_struct(resolved_type) {
        return emit_tagged_enum_struct_builder(resolved_type);
    }
    String::new()
}

fn emit_enum_builder(
    resolved_type: &ResolvedType,
    type_ir: &TypeIr,
    info: EnumFieldInfo,
) -> String {
    let has_physical_tag = info.tag_field.is_some();
    let tag_ts_name = info.tag_ts_name.clone();
    let payload_offset = match info.payload_offset {
        Some(offset) => offset,
        None => return emit_tagged_enum_struct_builder(resolved_type),
    };
    let class_name = &resolved_type.name;

    let (prefix_fields, prefix_meta): (Vec<&ResolvedField>, BTreeMap<String, PrefixFieldMeta<'_>>) =
        match &resolved_type.kind {
            ResolvedTypeKind::Struct { fields, .. } => {
                let enum_index = fields
                    .iter()
                    .position(|field| field.name == info.enum_field.name)
                    .expect("enum field not found in struct");
                let prefix_slice = &fields[..enum_index];
                let mut meta = BTreeMap::new();
                for field in prefix_slice {
                    let offset = field
                        .offset
                        .or_else(|| struct_field_const_offset(resolved_type, &field.name))
                        .unwrap_or(0);
                    if let Size::Const(sz) = field.field_type.size {
                        meta.insert(
                            field.name.clone(),
                            PrefixFieldMeta {
                                field,
                                offset,
                                size: sz,
                            },
                        );
                    }
                }
                (prefix_slice.iter().collect(), meta)
            }
            _ => (Vec::new(), BTreeMap::new()),
        };
    let has_prefix = !prefix_fields.is_empty();
    let builder_name = format!("{}Builder", class_name);
    let mut out = String::new();

    let mut param_exprs = Vec::new();
    let binding_table = collect_dynamic_param_bindings(resolved_type);
    let binding_keys: Vec<String> = binding_table.keys().cloned().collect();
    let prefix_meta_ref = if has_prefix { Some(&prefix_meta) } else { None };
    for binding in ts_parameter_bindings(type_ir)
        .into_iter()
        .filter(|binding| !binding.derived)
    {
        let binding_key =
            resolve_param_binding(&binding.ts_name, &binding_keys).unwrap_or_else(|| {
                panic!(
                    "ts_gen: unable to resolve param '{}' while emitting builder for {}",
                    binding.ts_name, class_name
                )
            });
        let dyn_binding = binding_table.get(binding_key).unwrap_or_else(|| {
            panic!(
                "ts_gen: missing dynamic binding '{}' in builder for {}",
                binding_key, class_name
            )
        });
        if let Some(expr) =
            enum_param_expression(class_name, &info, &binding, dyn_binding, prefix_meta_ref)
        {
            param_exprs.push((binding.ts_name, expr));
        }
    }
    if param_exprs.is_empty() {
        return emit_tagged_enum_struct_builder(resolved_type);
    }

    let payload_prop = format!("__tnPayload_{}", info.enum_ts_name);
    let selector_prop = format!("__tnVariantSelector_{}", info.enum_ts_name);
    let tag_field_label = info
        .tag_field
        .as_ref()
        .map(|field| format!("field '{}'", field.name))
        .unwrap_or_else(|| format!("computed tag for '{}'", info.enum_field.name));

    writeln!(out, "export class {} {{", builder_name).unwrap();
    if has_prefix {
        writeln!(out, "  private __tnPrefixBuffer: Uint8Array;").unwrap();
        writeln!(out, "  private __tnPrefixView: DataView;").unwrap();
    }
    if has_physical_tag {
        writeln!(
            out,
            "  private __tnField_{}: number | null = null;",
            tag_ts_name
        )
        .unwrap();
    }
    writeln!(
        out,
        "  private {}: {{ descriptor: typeof {}.{}[number]; bytes: Uint8Array }} | null = null;",
        payload_prop, class_name, info.descriptor_prop
    )
    .unwrap();
    writeln!(
        out,
        "  private __tnCachedParams: {}.Params | null = null;",
        class_name
    )
    .unwrap();
    writeln!(out, "  private __tnLastBuffer: Uint8Array | null = null;").unwrap();
    writeln!(
        out,
        "  private __tnLastParams: {}.Params | null = null;",
        class_name
    )
    .unwrap();
    writeln!(
        out,
        "  private {}?: __TnVariantSelectorResult<{}Builder>;\n",
        selector_prop, class_name
    )
    .unwrap();

    if has_prefix {
        writeln!(out, "  constructor() {{").unwrap();
        writeln!(
            out,
            "    this.__tnPrefixBuffer = new Uint8Array({});",
            payload_offset
        )
        .unwrap();
        writeln!(
            out,
            "    this.__tnPrefixView = new DataView(this.__tnPrefixBuffer.buffer, this.__tnPrefixBuffer.byteOffset, this.__tnPrefixBuffer.byteLength);"
        )
        .unwrap();
        writeln!(out, "  }}\n").unwrap();
    } else {
        writeln!(out, "  constructor() {{}}\n").unwrap();
    }

    if has_prefix {
        let setter_ctx = SetterContext {
            buffer_ident: "this.__tnPrefixBuffer",
            view_ident: "this.__tnPrefixView",
            invalidate: true,
        };
        for field in &prefix_fields {
            if info
                .tag_field
                .as_ref()
                .map(|tag| ptr::eq(*field, *tag))
                .unwrap_or(false)
            {
                continue;
            }
            emit_const_field_setter(field, &setter_ctx, &mut out);
        }
    }

    writeln!(out, "  private __tnInvalidate(): void {{").unwrap();
    writeln!(out, "    this.__tnCachedParams = null;").unwrap();
    writeln!(out, "    this.__tnLastBuffer = null;").unwrap();
    writeln!(out, "    this.__tnLastParams = null;").unwrap();
    writeln!(out, "  }}\n").unwrap();

    if has_physical_tag {
        writeln!(
            out,
            "  private __tnAssign_{}(value: number): void {{",
            info.tag_ts_name
        )
        .unwrap();
        writeln!(
            out,
            "    this.__tnField_{} = value & 0xff;",
            info.tag_ts_name
        )
        .unwrap();
        writeln!(out, "    this.__tnInvalidate();").unwrap();
        writeln!(out, "  }}\n").unwrap();

        writeln!(out, "  set_{}(value: number): this {{", info.tag_ts_name).unwrap();
        writeln!(out, "    this.__tnAssign_{}(value);", info.tag_ts_name).unwrap();
        writeln!(out, "    return this;\n  }}\n").unwrap();
    }

    writeln!(
        out,
        "  {}(): __TnVariantSelectorResult<{}Builder> {{",
        info.enum_ts_name, class_name
    )
    .unwrap();
    writeln!(out, "    if (!this.{}) {{", selector_prop).unwrap();
    writeln!(
        out,
        "      this.{} = __tnCreateVariantSelector(this, {}.{}, (descriptor, payload) => {{",
        selector_prop, class_name, info.descriptor_prop
    )
    .unwrap();
    writeln!(
        out,
        "        this.{} = {{ descriptor, bytes: new Uint8Array(payload) }};",
        payload_prop
    )
    .unwrap();
    if has_physical_tag {
        writeln!(
            out,
            "        this.__tnAssign_{}(descriptor.tag);",
            info.tag_ts_name
        )
        .unwrap();
    } else {
        writeln!(out, "        this.__tnInvalidate();").unwrap();
    }
    writeln!(out, "      }});").unwrap();
    writeln!(out, "    }}").unwrap();
    writeln!(out, "    return this.{}!;", selector_prop).unwrap();
    writeln!(out, "  }}\n").unwrap();

    writeln!(out, "  build(): Uint8Array {{").unwrap();
    writeln!(out, "    const params = this.__tnComputeParams();").unwrap();
    if has_physical_tag {
        writeln!(
            out,
            "    if (this.__tnField_{} === null) throw new Error(\"{}Builder: {} must be set before build\");",
            tag_ts_name, class_name, tag_field_label
        )
        .unwrap();
    }
    writeln!(
        out,
        "    if (!this.{}) throw new Error(\"{}Builder: payload variant not selected\");",
        payload_prop, class_name
    )
    .unwrap();
    writeln!(
        out,
        "    const payloadLength = this.{}.bytes.length;",
        payload_prop
    )
    .unwrap();
    writeln!(
        out,
        "    const requiredSize = {} + payloadLength;",
        payload_offset
    )
    .unwrap();
    writeln!(
        out,
        "    const footprintSize = {}.footprintFromParams(params);",
        class_name
    )
    .unwrap();
    writeln!(
        out,
        "    const size = Math.max(requiredSize, footprintSize);"
    )
    .unwrap();
    writeln!(out, "    const buffer = new Uint8Array(size);").unwrap();
    writeln!(out, "    this.__tnWriteInto(buffer);").unwrap();
    writeln!(out, "    this.__tnValidateOrThrow(buffer, params);").unwrap();
    writeln!(out, "    return buffer;").unwrap();
    writeln!(out, "  }}\n").unwrap();

    writeln!(
        out,
        "  buildInto(target: Uint8Array, offset = 0): Uint8Array {{"
    )
    .unwrap();
    writeln!(out, "    const params = this.__tnComputeParams();").unwrap();
    if has_physical_tag {
        writeln!(
            out,
            "    if (this.__tnField_{} === null) throw new Error(\"{}Builder: {} must be set before build\");",
            tag_ts_name, class_name, tag_field_label
        )
        .unwrap();
    }
    writeln!(
        out,
        "    if (!this.{}) throw new Error(\"{}Builder: payload variant not selected\");",
        payload_prop, class_name
    )
    .unwrap();
    writeln!(
        out,
        "    const payloadLength = this.{}.bytes.length;",
        payload_prop
    )
    .unwrap();
    writeln!(
        out,
        "    const requiredSize = {} + payloadLength;",
        payload_offset
    )
    .unwrap();
    writeln!(
        out,
        "    const footprintSize = {}.footprintFromParams(params);",
        class_name
    )
    .unwrap();
    writeln!(
        out,
        "    const size = Math.max(requiredSize, footprintSize);"
    )
    .unwrap();
    writeln!(
        out,
        "    if (target.length - offset < size) throw new Error(\"{}Builder: target buffer too small\");",
        class_name
    )
    .unwrap();
    writeln!(
        out,
        "    const slice = target.subarray(offset, offset + size);"
    )
    .unwrap();
    writeln!(out, "    this.__tnWriteInto(slice);").unwrap();
    writeln!(out, "    this.__tnValidateOrThrow(slice, params);").unwrap();
    writeln!(out, "    return target;").unwrap();
    writeln!(out, "  }}\n").unwrap();

    writeln!(out, "  finish(): {} {{", class_name).unwrap();
    writeln!(out, "    const buffer = this.build();").unwrap();
    writeln!(
        out,
        "    const params = this.__tnLastParams ?? this.__tnComputeParams();"
    )
    .unwrap();
    writeln!(
        out,
        "    const view = {}.from_array(buffer, {{ params }});",
        class_name
    )
    .unwrap();
    writeln!(
        out,
        "    if (!view) throw new Error(\"{}Builder: failed to finalize view\");",
        class_name
    )
    .unwrap();
    writeln!(out, "    return view;").unwrap();
    writeln!(out, "  }}\n").unwrap();

    writeln!(out, "  finishView(): {} {{", class_name).unwrap();
    writeln!(out, "    return this.finish();").unwrap();
    writeln!(out, "  }}\n").unwrap();

    writeln!(out, "  dynamicParams(): {}.Params {{", class_name).unwrap();
    writeln!(out, "    return this.__tnComputeParams();").unwrap();
    writeln!(out, "  }}\n").unwrap();

    writeln!(
        out,
        "  private __tnComputeParams(): {}.Params {{",
        class_name
    )
    .unwrap();
    writeln!(
        out,
        "    if (this.__tnCachedParams) return this.__tnCachedParams;"
    )
    .unwrap();
    writeln!(
        out,
        "    const params = {}.Params.fromValues({{",
        class_name
    )
    .unwrap();
    for (ts_name, expr) in &param_exprs {
        writeln!(out, "      {}: {},", ts_name, expr).unwrap();
    }
    writeln!(out, "    }});").unwrap();
    writeln!(out, "    this.__tnCachedParams = params;").unwrap();
    writeln!(out, "    return params;").unwrap();
    writeln!(out, "  }}\n").unwrap();

    let tag_write = info.tag_field.as_ref().map(|tag_field| {
        let tag_offset = info
            .tag_offset
            .or_else(|| struct_field_const_offset(resolved_type, &tag_field.name))
            .unwrap_or(0);
        let setter = if let ResolvedTypeKind::Primitive { prim_type } = &tag_field.field_type.kind {
            primitive_to_dataview_setter(prim_type).to_string()
        } else {
            "setUint8".to_string()
        };
        let needs_le = if let ResolvedTypeKind::Primitive { prim_type } = &tag_field.field_type.kind
        {
            needs_endianness_arg(prim_type)
        } else {
            false
        };
        (tag_offset, setter, needs_le)
    });

    writeln!(out, "  private __tnWriteInto(target: Uint8Array): void {{").unwrap();
    if has_physical_tag {
        writeln!(
            out,
            "    if (this.__tnField_{} === null) throw new Error(\"{}Builder: {} must be set before build\");",
            tag_ts_name, class_name, tag_field_label
        )
        .unwrap();
    }
    writeln!(
        out,
        "    if (!this.{}) throw new Error(\"{}Builder: payload variant not selected\");",
        payload_prop, class_name
    )
    .unwrap();
    writeln!(
        out,
        "    const view = new DataView(target.buffer, target.byteOffset, target.byteLength);"
    )
    .unwrap();
    if has_prefix {
        writeln!(out, "    target.set(this.__tnPrefixBuffer, 0);").unwrap();
    }
    if let Some((tag_offset, setter, needs_le)) = tag_write {
        if needs_le {
            writeln!(
                out,
                "    view.{}({}, this.__tnField_{}, true);",
                setter, tag_offset, info.tag_ts_name
            )
            .unwrap();
        } else {
            writeln!(
                out,
                "    view.{}({}, this.__tnField_{});",
                setter, tag_offset, info.tag_ts_name
            )
            .unwrap();
        }
    }
    writeln!(
        out,
        "    target.set(this.{}.bytes, {});",
        payload_prop, payload_offset
    )
    .unwrap();
    if !has_physical_tag {
        if let Some(param_name) = &info.tag_param_ts_name {
            writeln!(
                out,
                "    const __tnLayout = {}.__tnComputeSequentialLayout(view, target);",
                class_name
            )
            .unwrap();
            writeln!(
                out,
                "    if (!__tnLayout || !__tnLayout.derived) throw new Error(\"{}Builder: failed to derive enum tag\");",
                class_name
            )
            .unwrap();
            writeln!(
                out,
                "    const __tnDerivedTagValue = __tnLayout.derived[\"{}\"];",
                param_name
            )
            .unwrap();
            writeln!(
                out,
                "    if (__tnDerivedTagValue === undefined) throw new Error(\"{}Builder: computed enum tag missing\");",
                class_name
            )
            .unwrap();
            writeln!(
                out,
                "    const __tnDerivedTag = __tnBigIntToNumber(__tnDerivedTagValue, \"{}Builder::__tnWriteInto\");",
                class_name
            )
            .unwrap();
            writeln!(
                out,
                "    const __tnExpectedTag = this.{}!.descriptor.tag;",
                payload_prop
            )
            .unwrap();
            writeln!(
                out,
                "    if (__tnDerivedTag !== __tnExpectedTag) throw new Error(\"{}Builder: computed enum tag does not match selected variant\");",
                class_name
            )
            .unwrap();
        }
    }
    writeln!(out, "  }}\n").unwrap();

    writeln!(
        out,
        "  private __tnValidateOrThrow(buffer: Uint8Array, params: {}.Params): void {{",
        class_name
    )
    .unwrap();
    writeln!(
        out,
        "    const result = {}.validate(buffer, {{ params }});",
        class_name
    )
    .unwrap();
    writeln!(out, "    if (!result.ok) {{").unwrap();
    writeln!(
        out,
        "      throw new Error(`${{ {} }}Builder: builder produced invalid buffer (code=${{result.code ?? \"unknown\"}})`);",
        class_name
    )
    .unwrap();
    writeln!(out, "    }}").unwrap();
    writeln!(out, "    this.__tnLastParams = result.params ?? params;").unwrap();
    writeln!(out, "    this.__tnLastBuffer = buffer;").unwrap();
    writeln!(out, "  }}").unwrap();

    writeln!(out, "}}\n").unwrap();
    out
}

fn emit_multi_enum_builder(
    resolved_type: &ResolvedType,
    type_ir: &TypeIr,
    layout: Vec<MultiEnumLayout>,
) -> String {
    let class_name = &resolved_type.name;
    let builder_name = format!("{}Builder", class_name);
    let mut out = String::new();

    let mut param_exprs = Vec::new();
    let binding_table = collect_dynamic_param_bindings(resolved_type);
    let binding_keys: Vec<String> = binding_table.keys().cloned().collect();
    'binding: for binding in ts_parameter_bindings(type_ir)
        .into_iter()
        .filter(|binding| !binding.derived)
    {
        let binding_key =
            resolve_param_binding(&binding.ts_name, &binding_keys).unwrap_or_else(|| {
                panic!(
                    "ts_gen: unable to resolve param '{}' while emitting builder for {}",
                    binding.ts_name, class_name
                )
            });
        let dyn_binding = binding_table.get(binding_key).unwrap_or_else(|| {
            panic!(
                "ts_gen: missing dynamic binding '{}' in builder for {}",
                binding_key, class_name
            )
        });
        for entry in &layout {
            if let Some(expr) =
                enum_param_expression(class_name, &entry.enum_info, &binding, dyn_binding, None)
            {
                param_exprs.push((binding.ts_name.clone(), expr));
                continue 'binding;
            }
        }
    }
    if param_exprs.is_empty() {
        return String::new();
    }

    writeln!(out, "export class {} {{", builder_name).unwrap();
    for entry in &layout {
        writeln!(
            out,
            "  private __tnField_{}: number | null = null;",
            entry.enum_info.tag_ts_name
        )
        .unwrap();
        writeln!(
            out,
            "  private __tnPayload_{}: {{ descriptor: typeof {}.{}[number]; bytes: Uint8Array }} | null = null;",
            entry.enum_info.enum_ts_name, class_name, entry.enum_info.descriptor_prop
        )
        .unwrap();
        writeln!(
            out,
            "  private __tnVariantSelector_{}?: __TnVariantSelectorResult<{}Builder>;",
            entry.enum_info.enum_ts_name, class_name
        )
        .unwrap();
    }
    writeln!(
        out,
        "  private __tnCachedParams: {}.Params | null = null;",
        class_name
    )
    .unwrap();
    writeln!(out, "  private __tnLastBuffer: Uint8Array | null = null;").unwrap();
    writeln!(
        out,
        "  private __tnLastParams: {}.Params | null = null;\n",
        class_name
    )
    .unwrap();

    writeln!(out, "  constructor() {{}}\n").unwrap();

    writeln!(out, "  private __tnInvalidate(): void {{").unwrap();
    writeln!(out, "    this.__tnCachedParams = null;").unwrap();
    writeln!(out, "    this.__tnLastBuffer = null;").unwrap();
    writeln!(out, "    this.__tnLastParams = null;").unwrap();
    writeln!(out, "  }}\n").unwrap();

    writeln!(
        out,
        "  private __tnAlignCursor(position: number, alignment: number): number {{"
    )
    .unwrap();
    writeln!(out, "    if (alignment <= 1) return position;").unwrap();
    writeln!(out, "    const remainder = position % alignment;").unwrap();
    writeln!(
        out,
        "    return remainder === 0 ? position : position + (alignment - remainder);"
    )
    .unwrap();
    writeln!(out, "  }}\n").unwrap();

    for entry in &layout {
        writeln!(
            out,
            "  private __tnAssign_{}(value: number): void {{",
            entry.enum_info.tag_ts_name
        )
        .unwrap();
        writeln!(
            out,
            "    this.__tnField_{} = value & 0xff;",
            entry.enum_info.tag_ts_name
        )
        .unwrap();
        writeln!(out, "    this.__tnInvalidate();").unwrap();
        writeln!(out, "  }}\n").unwrap();

        writeln!(
            out,
            "  set_{}(value: number): this {{",
            entry.enum_info.tag_ts_name
        )
        .unwrap();
        writeln!(
            out,
            "    this.__tnAssign_{}(value);",
            entry.enum_info.tag_ts_name
        )
        .unwrap();
        writeln!(out, "    return this;\n  }}\n").unwrap();

        writeln!(
            out,
            "  {}(): __TnVariantSelectorResult<{}Builder> {{",
            entry.enum_info.enum_ts_name, class_name
        )
        .unwrap();
        writeln!(
            out,
            "    if (!this.__tnVariantSelector_{}) {{",
            entry.enum_info.enum_ts_name
        )
        .unwrap();
        writeln!(
            out,
            "      this.__tnVariantSelector_{} = __tnCreateVariantSelector(this, {}.{}, (descriptor, payload) => {{",
            entry.enum_info.enum_ts_name, class_name, entry.enum_info.descriptor_prop
        )
        .unwrap();
        writeln!(
            out,
            "        this.__tnPayload_{} = {{ descriptor, bytes: new Uint8Array(payload) }};",
            entry.enum_info.enum_ts_name
        )
        .unwrap();
        writeln!(
            out,
            "        this.__tnAssign_{}(descriptor.tag);",
            entry.enum_info.tag_ts_name
        )
        .unwrap();
        writeln!(out, "      }});").unwrap();
        writeln!(out, "    }}").unwrap();
        writeln!(
            out,
            "    return this.__tnVariantSelector_{}!;",
            entry.enum_info.enum_ts_name
        )
        .unwrap();
        writeln!(out, "  }}\n").unwrap();
    }

    writeln!(out, "  build(): Uint8Array {{").unwrap();
    writeln!(out, "    const params = this.__tnComputeParams();").unwrap();
    emit_multi_enum_ready_checks(&mut out, &layout, class_name);
    writeln!(
        out,
        "    const dynamicSize = this.__tnComputeDynamicSize();"
    )
    .unwrap();
    writeln!(
        out,
        "    const footprintSize = {}.footprintFromParams(params);",
        class_name
    )
    .unwrap();
    writeln!(
        out,
        "    const size = Math.max(dynamicSize, footprintSize);"
    )
    .unwrap();
    writeln!(out, "    const buffer = new Uint8Array(size);").unwrap();
    writeln!(out, "    this.__tnWriteInto(buffer);").unwrap();
    writeln!(out, "    this.__tnValidateOrThrow(buffer, params);").unwrap();
    writeln!(out, "    return buffer;").unwrap();
    writeln!(out, "  }}\n").unwrap();

    writeln!(
        out,
        "  buildInto(target: Uint8Array, offset = 0): Uint8Array {{"
    )
    .unwrap();
    writeln!(out, "    const params = this.__tnComputeParams();").unwrap();
    emit_multi_enum_ready_checks(&mut out, &layout, class_name);
    writeln!(
        out,
        "    const dynamicSize = this.__tnComputeDynamicSize();"
    )
    .unwrap();
    writeln!(
        out,
        "    const footprintSize = {}.footprintFromParams(params);",
        class_name
    )
    .unwrap();
    writeln!(
        out,
        "    const size = Math.max(dynamicSize, footprintSize);"
    )
    .unwrap();
    writeln!(
        out,
        "    if (target.length - offset < size) throw new Error(\"{}Builder: target buffer too small\");",
        class_name
    )
    .unwrap();
    writeln!(
        out,
        "    const slice = target.subarray(offset, offset + size);"
    )
    .unwrap();
    writeln!(out, "    this.__tnWriteInto(slice);").unwrap();
    writeln!(out, "    this.__tnValidateOrThrow(slice, params);").unwrap();
    writeln!(out, "    return target;").unwrap();
    writeln!(out, "  }}\n").unwrap();

    writeln!(out, "  finish(): {} {{", class_name).unwrap();
    writeln!(out, "    const buffer = this.build();").unwrap();
    writeln!(
        out,
        "    const params = this.__tnLastParams ?? this.__tnComputeParams();"
    )
    .unwrap();
    writeln!(
        out,
        "    const view = {}.from_array(buffer, {{ params }});",
        class_name
    )
    .unwrap();
    writeln!(
        out,
        "    if (!view) throw new Error(\"{}Builder: failed to finalize view\");",
        class_name
    )
    .unwrap();
    writeln!(out, "    return view;").unwrap();
    writeln!(out, "  }}\n").unwrap();

    writeln!(out, "  finishView(): {} {{", class_name).unwrap();
    writeln!(out, "    return this.finish();").unwrap();
    writeln!(out, "  }}\n").unwrap();

    writeln!(out, "  dynamicParams(): {}.Params {{", class_name).unwrap();
    writeln!(out, "    return this.__tnComputeParams();").unwrap();
    writeln!(out, "  }}\n").unwrap();

    writeln!(
        out,
        "  private __tnComputeParams(): {}.Params {{",
        class_name
    )
    .unwrap();
    writeln!(
        out,
        "    if (this.__tnCachedParams) return this.__tnCachedParams;"
    )
    .unwrap();
    writeln!(
        out,
        "    const params = {}.Params.fromValues({{",
        class_name
    )
    .unwrap();
    for (ts_name, expr) in &param_exprs {
        writeln!(out, "      {}: {},", ts_name, expr).unwrap();
    }
    writeln!(out, "    }});").unwrap();
    writeln!(out, "    this.__tnCachedParams = params;").unwrap();
    writeln!(out, "    return params;").unwrap();
    writeln!(out, "  }}\n").unwrap();

    emit_multi_enum_dynamic_helpers(&mut out, &layout, class_name);

    writeln!(
        out,
        "  private __tnValidateOrThrow(buffer: Uint8Array, params: {}.Params): void {{",
        class_name
    )
    .unwrap();
    writeln!(
        out,
        "    const result = {}.validate(buffer, {{ params }});",
        class_name
    )
    .unwrap();
    writeln!(out, "    if (!result.ok) {{").unwrap();
    writeln!(
        out,
        "      throw new Error(`${{ {} }}Builder: builder produced invalid buffer (code=${{result.code ?? \"unknown\"}})`);",
        class_name
    )
    .unwrap();
    writeln!(out, "    }}").unwrap();
    writeln!(out, "    this.__tnLastParams = result.params ?? params;").unwrap();
    writeln!(out, "    this.__tnLastBuffer = buffer;").unwrap();
    writeln!(out, "  }}").unwrap();

    writeln!(out, "}}\n").unwrap();
    out
}

fn emit_multi_enum_ready_checks(out: &mut String, layout: &[MultiEnumLayout], class_name: &str) {
    for entry in layout {
        writeln!(
            out,
            "    if (this.__tnField_{} === null) throw new Error(\"{}Builder: field '{}' must be set before build\");",
        entry.enum_info.tag_ts_name,
        class_name,
        entry
            .enum_info
            .tag_field
            .as_ref()
            .expect("multi enum builder requires tag field")
            .name
        )
        .unwrap();
        writeln!(
            out,
            "    if (!this.__tnPayload_{}) throw new Error(\"{}Builder: payload '{}' must be selected before build\");",
            entry.enum_info.enum_ts_name, class_name, entry.enum_info.enum_field.name
        )
        .unwrap();
    }
}

fn emit_multi_enum_dynamic_helpers(out: &mut String, layout: &[MultiEnumLayout], class_name: &str) {
    writeln!(out, "  private __tnComputeDynamicSize(): number {{").unwrap();
    writeln!(out, "    let cursor = 0;").unwrap();
    for entry in layout {
        let tag_align = entry.tag_field.field_type.alignment.max(1);
        if tag_align > 1 {
            writeln!(
                out,
                "    cursor = this.__tnAlignCursor(cursor, {});",
                tag_align
            )
            .unwrap();
        }
        let tag_size = match entry.tag_field.field_type.size {
            Size::Const(sz) => sz,
            _ => unreachable!(),
        };
        writeln!(out, "    cursor += {};", tag_size).unwrap();
        let enum_align = entry.enum_info.enum_field.field_type.alignment.max(1);
        if enum_align > 1 {
            writeln!(
                out,
                "    cursor = this.__tnAlignCursor(cursor, {});",
                enum_align
            )
            .unwrap();
        }
        writeln!(
            out,
            "    const __tnPayloadLen_{} = this.__tnPayload_{};",
            entry.enum_info.enum_ts_name, entry.enum_info.enum_ts_name
        )
        .unwrap();
        writeln!(
            out,
            "    if (!__tnPayloadLen_{}) throw new Error(\"{}Builder: payload '{}' must be selected before build\");",
            entry.enum_info.enum_ts_name, class_name, entry.enum_info.enum_field.name
        )
        .unwrap();
        writeln!(
            out,
            "    cursor += __tnPayloadLen_{}.bytes.length;",
            entry.enum_info.enum_ts_name
        )
        .unwrap();
    }
    writeln!(out, "    return cursor;").unwrap();
    writeln!(out, "  }}\n").unwrap();

    writeln!(out, "  private __tnWriteInto(target: Uint8Array): void {{").unwrap();
    writeln!(out, "    let cursor = 0;").unwrap();
    writeln!(
        out,
        "    const view = new DataView(target.buffer, target.byteOffset, target.byteLength);"
    )
    .unwrap();
    for entry in layout {
        let tag_align = entry.tag_field.field_type.alignment.max(1);
        if tag_align > 1 {
            writeln!(
                out,
                "    cursor = this.__tnAlignCursor(cursor, {});",
                tag_align
            )
            .unwrap();
        }
        let tag_size = match entry.tag_field.field_type.size {
            Size::Const(sz) => sz,
            _ => unreachable!(),
        };
        writeln!(
            out,
            "    const __tnTagValue_{} = this.__tnField_{};",
            entry.enum_info.tag_ts_name, entry.enum_info.tag_ts_name
        )
        .unwrap();
        writeln!(
            out,
            "    if (__tnTagValue_{} === null) throw new Error(\"{}Builder: field '{}' must be set before build\");",
        entry.enum_info.tag_ts_name,
        class_name,
        entry
            .enum_info
            .tag_field
            .as_ref()
            .expect("multi enum builder requires tag field")
            .name
        )
        .unwrap();
        let setter =
            if let ResolvedTypeKind::Primitive { prim_type } = &entry.tag_field.field_type.kind {
                primitive_to_dataview_setter(prim_type)
            } else {
                "setUint8"
            };
        let needs_le =
            if let ResolvedTypeKind::Primitive { prim_type } = &entry.tag_field.field_type.kind {
                needs_endianness_arg(prim_type)
            } else {
                false
            };
        if needs_le {
            writeln!(
                out,
                "    view.{}(cursor, __tnTagValue_{}, true);",
                setter, entry.enum_info.tag_ts_name
            )
            .unwrap();
        } else {
            writeln!(
                out,
                "    view.{}(cursor, __tnTagValue_{});",
                setter, entry.enum_info.tag_ts_name
            )
            .unwrap();
        }
        writeln!(out, "    cursor += {};", tag_size).unwrap();
        let enum_align = entry.enum_info.enum_field.field_type.alignment.max(1);
        if enum_align > 1 {
            writeln!(
                out,
                "    cursor = this.__tnAlignCursor(cursor, {});",
                enum_align
            )
            .unwrap();
        }
        writeln!(
            out,
            "    const __tnPayload_{} = this.__tnPayload_{};",
            entry.enum_info.enum_ts_name, entry.enum_info.enum_ts_name
        )
        .unwrap();
        writeln!(
            out,
            "    if (!__tnPayload_{}) throw new Error(\"{}Builder: payload '{}' must be selected before build\");",
            entry.enum_info.enum_ts_name, class_name, entry.enum_info.enum_field.name
        )
        .unwrap();
        writeln!(
            out,
            "    target.set(__tnPayload_{}.bytes, cursor);",
            entry.enum_info.enum_ts_name
        )
        .unwrap();
        writeln!(
            out,
            "    cursor += __tnPayload_{}.bytes.length;",
            entry.enum_info.enum_ts_name
        )
        .unwrap();
    }
    writeln!(out, "  }}\n").unwrap();
}
#[derive(Clone)]
struct MultiEnumLayout<'a> {
    tag_field: &'a ResolvedField,
    enum_info: EnumFieldInfo<'a>,
}

fn collect_multi_enum_layout<'a>(
    resolved_type: &'a ResolvedType,
    infos: &[EnumFieldInfo<'a>],
) -> Option<Vec<MultiEnumLayout<'a>>> {
    let ResolvedTypeKind::Struct { fields, .. } = &resolved_type.kind else {
        return None;
    };
    let mut layout = Vec::new();
    let mut idx = 0usize;
    while idx < fields.len() {
        let tag_field = &fields[idx];
        if !matches!(
            tag_field.field_type.kind,
            ResolvedTypeKind::Primitive { .. }
        ) {
            return None;
        }
        if idx + 1 >= fields.len() {
            return None;
        }
        let enum_field = &fields[idx + 1];
        if !matches!(enum_field.field_type.kind, ResolvedTypeKind::Enum { .. }) {
            return None;
        }
        if !matches!(tag_field.field_type.size, Size::Const(_)) {
            return None;
        }
        let info = infos
            .iter()
            .find(|candidate| candidate.enum_field.name == enum_field.name)?;
        if info.tag_field.as_ref().map(|field| field.name.as_str()) != Some(tag_field.name.as_str())
        {
            return None;
        }
        layout.push(MultiEnumLayout {
            tag_field,
            enum_info: info.clone(),
        });
        idx += 2;
    }
    if layout.is_empty() {
        None
    } else {
        Some(layout)
    }
}

fn enum_param_expression(
    type_name: &str,
    info: &EnumFieldInfo,
    binding: &TsParamBinding,
    dyn_binding: &DynamicBinding,
    prefix_meta: Option<&BTreeMap<String, PrefixFieldMeta<'_>>>,
) -> Option<String> {
    let field_tag_path = format!("{}.tag", info.enum_field.name);
    let qualified_tag_path = format!("{}::{}.tag", type_name, info.enum_field.name);
    if binding.canonical == field_tag_path || binding.canonical == qualified_tag_path {
        return Some(format!(
            "(() => {{ if (this.__tnField_{tag} === null) throw new Error(\"{type_name}Builder: missing enum tag\"); return __tnToBigInt(this.__tnField_{tag}); }})()",
            tag = info.tag_ts_name,
        ));
    }

    let field_payload_path = format!("{}.payload_size", info.enum_field.name);
    let qualified_payload_path = format!("{}::{}.payload_size", type_name, info.enum_field.name);
    if binding.canonical == field_payload_path || binding.canonical == qualified_payload_path {
        let payload_prop = format!("__tnPayload_{}", info.enum_ts_name);
        return Some(format!(
            "(() => {{ if (!this.{payload_prop}) throw new Error(\"{type_name}Builder: payload '{field}' must be selected before build\"); return __tnToBigInt(this.{payload_prop}.bytes.length); }})()",
            payload_prop = payload_prop,
            type_name = type_name,
            field = info.enum_field.name
        ));
    }

    if let Some(meta_map) = prefix_meta {
        if let Some(stripped) = binding
            .canonical
            .strip_prefix(&(info.enum_field.name.clone() + "."))
        {
            let segments: Vec<&str> = stripped.split('.').collect();
            if let Some((first, rest)) = segments.split_first() {
                if let Some(meta) = meta_map.get(*first) {
                    if let Some(expr) =
                        build_prefix_param_expression(type_name, meta, rest, dyn_binding)
                    {
                        return Some(expr);
                    }
                }
            }
        }
    }

    None
}

fn build_prefix_param_expression(
    builder_name: &str,
    meta: &PrefixFieldMeta<'_>,
    remainder: &[&str],
    dyn_binding: &DynamicBinding,
) -> Option<String> {
    match &meta.field.field_type.kind {
        ResolvedTypeKind::Primitive { prim_type } if remainder.is_empty() => {
            let getter = primitive_to_dataview_getter(prim_type);
            let needs_le = needs_endianness_arg(prim_type);
            let read_expr = if needs_le {
                format!("this.__tnPrefixView.{}({}, true)", getter, meta.offset)
            } else {
                format!("this.__tnPrefixView.{}({})", getter, meta.offset)
            };
            let value_expr = match prim_type {
                PrimitiveType::Integral(_) => format!("__tnToBigInt({})", read_expr),
                _ => read_expr,
            };
            Some(format!("(() => {{ return {}; }})()", value_expr))
        }
        ResolvedTypeKind::TypeRef { target_name, .. } if !remainder.is_empty() => {
            let type_ident = escape_ts_keyword(target_name);
            let slice_expr = format!(
                "this.__tnPrefixBuffer.subarray({}, {})",
                meta.offset,
                meta.offset + meta.size
            );
            let mut accessor = "header".to_string();
            for seg in remainder {
                accessor = format!("{}.get_{}()", accessor, escape_ts_keyword(seg));
            }
            let mut value_expr = accessor;
            if matches!(dyn_binding.prim_type, PrimitiveType::Integral(_)) {
                value_expr = format!("__tnToBigInt({})", value_expr);
            }
            Some(format!(
                "(() => {{ const slice = {slice}; const header = {ty}.from_array(slice); if (!header) throw new Error(\"{builder}Builder: field '{field}' must be set before build\"); return {value}; }})()",
                slice = slice_expr,
                ty = type_ident,
                builder = builder_name,
                field = meta.field.name,
                value = value_expr
            ))
        }
        _ => None,
    }
}
