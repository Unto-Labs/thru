use super::builder::fam_field_infos;
use super::enum_utils::{EnumFieldInfo, enum_field_info_by_name, enum_field_infos};
use super::helpers::{
    collect_enum_variant_fam_refs, collect_field_value_refs, escape_ts_keyword, generated_type_ident,
    is_nested_complex_type, literal_to_string, needs_endianness_arg, primitive_size,
    primitive_to_dataview_getter, primitive_to_dataview_setter, primitive_to_ts_return_type,
    sequential_size_expression, struct_field_const_offset, to_camel_case, to_lower_camel_case,
};
use super::ir_helpers::{collect_dynamic_param_bindings, ts_parameter_bindings};
use super::ir_serialization::{emit_ir_constant, ir_constant_name};
use super::param_cache::extractor::{
    ParamExtractorPlan, build_param_extractor_plan, emit_param_extractor,
    emit_sequential_layout_helper, resolve_field_read,
};
use crate::abi::expr::{ConstantExpression, ExprKind};
use crate::abi::resolved::{ResolvedField, ResolvedType, ResolvedTypeKind, Size};
use crate::codegen::shared::ir::TypeIr;
use std::collections::BTreeMap;
use std::fmt::Write;

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
            let dotted = field_ref.path.join(".");
            format!("this.__tnResolveFieldRef(\"{}\")", dotted)
        }
        ExprKind::Add(e) => {
            format!(
                "({} + {})",
                size_expression_to_ts_getter_code(&e.left),
                size_expression_to_ts_getter_code(&e.right)
            )
        }
        ExprKind::Mul(e) => {
            format!(
                "({} * {})",
                size_expression_to_ts_getter_code(&e.left),
                size_expression_to_ts_getter_code(&e.right)
            )
        }
        ExprKind::Sub(e) => {
            format!(
                "({} - {})",
                size_expression_to_ts_getter_code(&e.left),
                size_expression_to_ts_getter_code(&e.right)
            )
        }
        ExprKind::Div(e) => {
            format!(
                "({} / {})",
                size_expression_to_ts_getter_code(&e.left),
                size_expression_to_ts_getter_code(&e.right)
            )
        }
        ExprKind::Mod(e) => {
            format!(
                "({} % {})",
                size_expression_to_ts_getter_code(&e.left),
                size_expression_to_ts_getter_code(&e.right)
            )
        }
        ExprKind::BitAnd(e) => {
            format!(
                "({} & {})",
                size_expression_to_ts_getter_code(&e.left),
                size_expression_to_ts_getter_code(&e.right)
            )
        }
        ExprKind::BitOr(e) => {
            format!(
                "({} | {})",
                size_expression_to_ts_getter_code(&e.left),
                size_expression_to_ts_getter_code(&e.right)
            )
        }
        ExprKind::BitXor(e) => {
            format!(
                "({} ^ {})",
                size_expression_to_ts_getter_code(&e.left),
                size_expression_to_ts_getter_code(&e.right)
            )
        }
        ExprKind::LeftShift(e) => {
            format!(
                "({} << {})",
                size_expression_to_ts_getter_code(&e.left),
                size_expression_to_ts_getter_code(&e.right)
            )
        }
        ExprKind::RightShift(e) => {
            format!(
                "({} >> {})",
                size_expression_to_ts_getter_code(&e.left),
                size_expression_to_ts_getter_code(&e.right)
            )
        }
        ExprKind::Popcount(e) => {
            format!(
                "__tnPopcount({})",
                size_expression_to_ts_getter_code(&e.operand)
            )
        }
        _ => expr.to_c_string(), /* Fallback for unhandled cases */
    }
}

/* Emit TypeScript class definition for a resolved type */
pub fn emit_type(
    resolved_type: &ResolvedType,
    type_ir: Option<&TypeIr>,
    has_builder: bool,
    builder_registry: &BTreeMap<String, bool>,
    type_lookup: &BTreeMap<String, ResolvedType>,
) -> String {
    let mut output = String::new();

    write!(
        output,
        "/* ----- TYPE DEFINITION FOR {} ----- */\n\n",
        resolved_type.name
    )
    .unwrap();

    let mut params_namespace = None;
    if let Some(type_ir) = type_ir {
        output.push_str(&emit_ir_constant(resolved_type, type_ir));
        if let Some(namespace) = emit_params_namespace(resolved_type, type_ir) {
            params_namespace = Some(namespace);
        }
    }

    /* First emit any nested complex types */
    emit_nested_types(
        resolved_type,
        None,
        builder_registry,
        type_lookup,
        &mut output,
    );

    /* Then emit the main type */
    emit_main_type(
        resolved_type,
        type_ir,
        true,
        has_builder,
        builder_registry,
        type_lookup,
        &mut output,
    );

    if let Some(namespace) = params_namespace {
        output.push_str(&namespace);
    }

    if type_ir.is_some() {
        writeln!(
            output,
            "__tnRegisterFootprint(\"{}\", (params) => {}.__tnInvokeFootprint(params));",
            resolved_type.name, resolved_type.name
        )
        .unwrap();
        writeln!(
            output,
            "__tnRegisterValidate(\"{}\", (buffer, params) => {}.__tnInvokeValidate(buffer, params));\n",
            resolved_type.name, resolved_type.name
        )
        .unwrap();
    }

    output
}

/* Recursively emit nested type definitions */
fn emit_nested_types(
    type_def: &ResolvedType,
    type_path: Option<&str>,
    builder_registry: &BTreeMap<String, bool>,
    type_lookup: &BTreeMap<String, ResolvedType>,
    output: &mut String,
) {
    match &type_def.kind {
        ResolvedTypeKind::Struct { fields, .. } => {
            let current_path = type_path.unwrap_or(&type_def.name);
            for field in fields {
                if is_nested_complex_type(&field.field_type) {
                    let nested_path = format!("{}_{}", current_path, field.name);
                    emit_nested_types(
                        &field.field_type,
                        Some(&nested_path),
                        builder_registry,
                        type_lookup,
                        output,
                    );
                }
            }
        }
        ResolvedTypeKind::Union { variants } => {
            let current_path = type_path.unwrap_or(&type_def.name);
            for variant in variants {
                if is_nested_complex_type(&variant.field_type) {
                    let nested_path = format!("{}_{}", current_path, variant.name);
                    emit_nested_types(
                        &variant.field_type,
                        Some(&nested_path),
                        builder_registry,
                        type_lookup,
                        output,
                    );
                }
            }
        }
        ResolvedTypeKind::Enum { variants, .. } => {
            let current_path = type_path.unwrap_or(&type_def.name);
            for variant in variants {
                if is_nested_complex_type(&variant.variant_type) {
                    let nested_path = format!("{}_{}", current_path, variant.name);
                    emit_nested_types(
                        &variant.variant_type,
                        Some(&nested_path),
                        builder_registry,
                        type_lookup,
                        output,
                    );
                }
            }
        }
        _ => {}
    }

    /* Emit the current nested type if it has a path */
    if type_path.is_some() {
        let mut nested_type = type_def.clone();
        nested_type.name = format!("{}_Inner", type_path.unwrap());
        emit_main_type(
            &nested_type,
            None,
            false,
            false,
            builder_registry,
            type_lookup,
            output,
        );
    }
}

fn emit_params_namespace(resolved_type: &ResolvedType, type_ir: &TypeIr) -> Option<String> {
    if type_ir.parameters.iter().all(|param| param.derived) {
        return None;
    }
    let bindings: Vec<_> = ts_parameter_bindings(type_ir)
        .into_iter()
        .filter(|binding| !binding.derived)
        .collect();
    let mut out = String::new();
    writeln!(out, "export namespace {} {{", resolved_type.name).unwrap();
    writeln!(out, "  export type Params = {{").unwrap();
    for binding in &bindings {
        let doc = type_ir
            .parameters
            .iter()
            .find(|param| param.name == binding.canonical)
            .and_then(|param| param.description.as_ref())
            .map(|desc| desc.as_str())
            .unwrap_or("");
        if !doc.is_empty() {
            writeln!(out, "    /** {} (ABI path: {}) */", doc, binding.canonical).unwrap();
        } else {
            writeln!(out, "    /** ABI path: {} */", binding.canonical).unwrap();
        }
        writeln!(out, "    readonly {}: bigint;", binding.ts_name).unwrap();
    }
    writeln!(out, "  }};\n").unwrap();

    writeln!(out, "  export const ParamKeys = Object.freeze({{").unwrap();
    for binding in &bindings {
        writeln!(out, "    {}: \"{}\",", binding.ts_name, binding.canonical).unwrap();
    }
    writeln!(out, "  }} as const);\n").unwrap();

    let params_signature = bindings
        .iter()
        .map(|binding| format!("{}: number | bigint", binding.ts_name))
        .collect::<Vec<_>>()
        .join(", ");

    writeln!(out, "  export const Params = {{").unwrap();
    writeln!(
        out,
        "    fromValues(input: {{ {} }}): Params {{",
        params_signature
    )
    .unwrap();
    writeln!(out, "      return {{").unwrap();
    for binding in &bindings {
        writeln!(
            out,
            "        {}: __tnToBigInt(input.{}),",
            binding.ts_name, binding.ts_name
        )
        .unwrap();
    }
    writeln!(out, "      }};").unwrap();
    writeln!(out, "    }},").unwrap();
    writeln!(
        out,
        "    fromBuilder(source: {{ dynamicParams(): Params }} | {{ params: Params }} | Params): Params {{"
    )
    .unwrap();
    writeln!(
        out,
        "      if ((source as {{ dynamicParams?: () => Params }}).dynamicParams) {{"
    )
    .unwrap();
    writeln!(
        out,
        "        return (source as {{ dynamicParams(): Params }}).dynamicParams();"
    )
    .unwrap();
    writeln!(out, "      }}").unwrap();
    writeln!(
        out,
        "      if ((source as {{ params?: Params }}).params) {{"
    )
    .unwrap();
    writeln!(
        out,
        "        return (source as {{ params: Params }}).params;"
    )
    .unwrap();
    writeln!(out, "      }}").unwrap();
    writeln!(out, "      return source as Params;").unwrap();
    writeln!(out, "    }}").unwrap();
    writeln!(out, "  }};\n").unwrap();

    writeln!(
        out,
        "  export function params(input: {{ {} }}): Params {{",
        params_signature
    )
    .unwrap();
    writeln!(out, "    return Params.fromValues(input);").unwrap();
    writeln!(out, "  }}").unwrap();
    writeln!(out, "}}\n").unwrap();
    Some(out)
}

/* Emit the main TypeScript class for a type */
fn emit_main_type(
    resolved_type: &ResolvedType,
    type_ir: Option<&TypeIr>,
    allow_builder: bool,
    has_builder: bool,
    builder_registry: &BTreeMap<String, bool>,
    type_lookup: &BTreeMap<String, ResolvedType>,
    output: &mut String,
) {
    let class_name = &resolved_type.name;

    /* Add comment if present */
    if let Some(comment) = &resolved_type.comment {
        write!(output, "/* {} */\n", comment).unwrap();
    }

    match &resolved_type.kind {
        ResolvedTypeKind::Struct { fields, .. } => {
            emit_struct_class(
                class_name,
                fields,
                resolved_type,
                type_ir,
                allow_builder && has_builder,
                builder_registry,
                type_lookup,
                output,
            );
        }
        ResolvedTypeKind::Array { element_type, .. } => {
            emit_array_class(class_name, resolved_type, element_type.as_ref(), output);
        }
        ResolvedTypeKind::Union { variants } => {
            emit_union_class(class_name, variants, resolved_type, output);
        }
        ResolvedTypeKind::Enum { variants, .. } => {
            emit_enum_class(class_name, variants, resolved_type, output);
        }
        ResolvedTypeKind::Primitive { .. } => { /* Primitives don't need class definitions */ }
        _ => {}
    }
}

fn emit_array_class(
    class_name: &str,
    resolved_type: &ResolvedType,
    element_type: &ResolvedType,
    output: &mut String,
) {
    let element_size = match element_type.size {
        Size::Const(sz) => Some(sz),
        _ => None,
    };
    let element_count = match (element_size, &resolved_type.size) {
        (Some(elem), Size::Const(total)) if elem > 0 => Some(total / elem),
        _ => None,
    };

    write!(output, "export class {} {{\n", class_name).unwrap();
    write!(output, "  private view: DataView;\n").unwrap();
    write!(
        output,
        "  private constructor(private buffer: Uint8Array) {{\n"
    )
    .unwrap();
    write!(
        output,
        "    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);\n"
    )
    .unwrap();
    write!(output, "  }}\n\n").unwrap();

    let stride_literal = element_size.unwrap_or(0);
    write!(
        output,
        "  private static readonly __tnElementSize = {};\n",
        stride_literal
    )
    .unwrap();
    let count_literal = element_count
        .map(|cnt| cnt.to_string())
        .unwrap_or_else(|| "null".to_string());
    write!(
        output,
        "  private static readonly __tnElementCount: number | null = {};\n\n",
        count_literal
    )
    .unwrap();

    write!(output, "  get length(): number {{\n").unwrap();
    write!(
        output,
        "    const explicit = {}.__tnElementCount;\n",
        class_name
    )
    .unwrap();
    write!(output, "    if (explicit !== null) {{\n").unwrap();
    write!(output, "      return explicit;\n").unwrap();
    write!(output, "    }}\n").unwrap();
    write!(
        output,
        "    const stride = {}.__tnElementSize;\n",
        class_name
    )
    .unwrap();
    write!(output, "    if (stride > 0) {{\n").unwrap();
    write!(
        output,
        "      return Math.floor(this.buffer.length / stride);\n"
    )
    .unwrap();
    write!(output, "    }}\n").unwrap();
    write!(output, "    return this.buffer.length;\n").unwrap();
    write!(output, "  }}\n\n").unwrap();

    write!(output, "  getElementBytes(index: number): Uint8Array {{\n").unwrap();
    write!(
        output,
        "    if (!Number.isInteger(index) || index < 0) {{\n"
    )
    .unwrap();
    write!(
        output,
        "      throw new RangeError('{}::getElementBytes index must be a non-negative integer');\n",
        class_name
    )
    .unwrap();
    write!(output, "    }}\n").unwrap();
    write!(
        output,
        "    const stride = {}.__tnElementSize;\n",
        class_name
    )
    .unwrap();
    write!(output, "    if (stride <= 0) {{\n").unwrap();
    write!(
        output,
        "      throw new Error('{}::getElementBytes requires constant element size');\n",
        class_name
    )
    .unwrap();
    write!(output, "    }}\n").unwrap();
    write!(output, "    const start = index * stride;\n").unwrap();
    write!(output, "    const end = start + stride;\n").unwrap();
    write!(output, "    if (end > this.buffer.length) {{\n").unwrap();
    write!(
        output,
        "      throw new RangeError('{}::getElementBytes out of bounds');\n",
        class_name
    )
    .unwrap();
    write!(output, "    }}\n").unwrap();
    write!(output, "    return this.buffer.subarray(start, end);\n").unwrap();
    write!(output, "  }}\n\n").unwrap();

    write!(
        output,
        "  static from_array(buffer: Uint8Array): {} | null {{\n",
        class_name
    )
    .unwrap();
    write!(
        output,
        "    if (!buffer || buffer.length === undefined) {{\n"
    )
    .unwrap();
    write!(output, "      return null;\n").unwrap();
    write!(output, "    }}\n").unwrap();
    write!(
        output,
        "    const validation = {}.validate(buffer);\n",
        class_name
    )
    .unwrap();
    write!(output, "    if (!validation.ok) {{\n").unwrap();
    write!(output, "      return null;\n").unwrap();
    write!(output, "    }}\n").unwrap();
    write!(output, "    return new {}(buffer);\n", class_name).unwrap();
    write!(output, "  }}\n\n").unwrap();

    write!(
        output,
        "  asUint8Array(): Uint8Array {{\n    return new Uint8Array(this.buffer);\n  }}\n\n"
    )
    .unwrap();

    write!(output, "}}\n\n").unwrap();
}

/* Emit TypeScript class for a struct */
fn emit_struct_class(
    class_name: &str,
    fields: &[crate::abi::resolved::ResolvedField],
    resolved_type: &ResolvedType,
    type_ir: Option<&TypeIr>,
    emit_builder_method: bool,
    builder_registry: &BTreeMap<String, bool>,
    type_lookup: &BTreeMap<String, ResolvedType>,
    output: &mut String,
) {
    let enum_infos = enum_field_infos(resolved_type);
    let has_computed_enum = enum_infos.iter().any(|info| info.tag_expression.is_some());
    let has_param_cache =
        type_ir.map_or(false, |ir| ir.parameters.iter().any(|param| !param.derived));
    let param_plan = if has_param_cache {
        type_ir.and_then(|ir| build_param_extractor_plan(resolved_type, ir, type_lookup))
    } else {
        None
    };
    let extractor_available = if has_param_cache {
        type_ir
            .map(|_| !collect_dynamic_param_bindings(resolved_type).is_empty())
            .unwrap_or(false)
    } else {
        false
    };
    write!(output, "export class {} {{\n", class_name).unwrap();
    let mut uses_field_ref_resolver = fields.iter().any(|field| {
        matches!(
            &field.field_type.kind,
            ResolvedTypeKind::Array { size_expression, .. }
                if !size_expression.is_constant()
        )
    });
    if has_computed_enum {
        uses_field_ref_resolver = true;
    }
    write!(output, "  private view: DataView;\n").unwrap();
    if uses_field_ref_resolver {
        write!(
            output,
            "  private __tnFieldContext: Record<string, number | bigint> | null = null;\n"
        )
        .unwrap();
    }
    let field_offsets: Vec<Option<u64>> = fields
        .iter()
        .map(|field| {
            field
                .offset
                .or_else(|| struct_field_const_offset(resolved_type, &field.name))
        })
        .collect();
    let dynamic_field_names: Vec<String> = fields
        .iter()
        .zip(field_offsets.iter())
        .filter_map(|(field, offset)| {
            if offset.is_none() {
                Some(field.name.clone())
            } else {
                None
            }
        })
        .collect();
    let has_dynamic_fields = !dynamic_field_names.is_empty();
    let mut enum_offset_consts = String::new();
    let mut enum_method_blocks = Vec::new();
    let has_computed_tags = enum_infos.iter().any(|info| info.tag_parameter.is_some());
    for info in &enum_infos {
        let Some(payload_offset) = info.payload_offset else {
            continue;
        };
        let helper = emit_enum_reader_helper(class_name, resolved_type, info, payload_offset, type_lookup, uses_field_ref_resolver);
        enum_offset_consts.push_str(&helper.offset_const);
        enum_method_blocks.push(helper.method_block);
    }
    if !enum_offset_consts.is_empty() {
        output.push_str(&enum_offset_consts);
    }
    if has_param_cache {
        write!(output, "  private __tnParams: {}.Params;\n", class_name).unwrap();
    }
    if has_computed_tags {
        write!(
            output,
            "  private __tnDerivedParams: Record<string, bigint> | null = null;\n"
        )
        .unwrap();
    }
    write!(output, "\n").unwrap();

    let field_context_param = if uses_field_ref_resolver {
        ", fieldContext?: Record<string, number | bigint>"
    } else {
        ""
    };
    if has_param_cache {
        write!(
            output,
            "  private constructor(private buffer: Uint8Array, params?: {}.Params{}) {{\n",
            class_name, field_context_param
        )
        .unwrap();
    } else {
        write!(
            output,
            "  private constructor(private buffer: Uint8Array{}) {{\n",
            field_context_param
        )
        .unwrap();
    }
    write!(
        output,
        "    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);\n"
    )
    .unwrap();
    if uses_field_ref_resolver {
        write!(
            output,
            "    this.__tnFieldContext = fieldContext ?? null;\n"
        )
        .unwrap();
    }
    if has_param_cache {
        if extractor_available {
            write!(output, "    if (params) {{\n").unwrap();
            write!(output, "      this.__tnParams = params;\n").unwrap();
            write!(output, "    }} else {{\n").unwrap();
            write!(
                output,
                "      const derived = {}.__tnExtractParams(this.view, buffer);\n",
                class_name
            )
            .unwrap();
            write!(output, "      if (!derived) {{\n").unwrap();
            write!(
                output,
                "        throw new Error(\"{}: failed to derive dynamic parameters\");\n",
                class_name
            )
            .unwrap();
            write!(output, "      }}\n").unwrap();
            write!(output, "      this.__tnParams = derived.params;\n").unwrap();
            if has_computed_tags {
                write!(output, "      this.__tnDerivedParams = derived.derived;\n").unwrap();
            }
            write!(output, "    }}\n").unwrap();
        } else {
            write!(output, "    if (!params) {{\n").unwrap();
            write!(
                output,
                "      throw new Error(\"{}: params are required when dynamic extraction is unavailable\");\n",
                class_name
            )
            .unwrap();
            write!(output, "    }}\n").unwrap();
            write!(output, "    this.__tnParams = params;\n").unwrap();
        }
    }
    write!(output, "  }}\n\n").unwrap();

    if has_param_cache {
        if extractor_available {
            writeln!(
                output,
                "  static __tnCreateView(buffer: Uint8Array, opts?: {{ params?: {}.Params{} }}): {} {{",
                class_name,
                if uses_field_ref_resolver {
                    ", fieldContext?: Record<string, number | bigint>"
                } else {
                    ""
                },
                class_name
            )
            .unwrap();
            writeln!(
                output,
                "    if (!buffer || buffer.length === undefined) throw new Error(\"{}.__tnCreateView requires a Uint8Array\");",
                class_name
            )
            .unwrap();
            writeln!(output, "    let params = opts?.params ?? null;").unwrap();
            if has_computed_tags {
                writeln!(
                    output,
                    "    let derivedRecord: Record<string, bigint> | null = null;"
                )
                .unwrap();
            }
            writeln!(output, "    if (!params) {{").unwrap();
            writeln!(
                output,
                "      const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);"
            )
            .unwrap();
            writeln!(
                output,
                "      const derived = {}.__tnExtractParams(view, buffer);",
                class_name
            )
            .unwrap();
            writeln!(
                output,
                "      if (!derived) throw new Error(\"{}.__tnCreateView: failed to derive params\");",
                class_name
            )
            .unwrap();
            writeln!(output, "      params = derived.params;").unwrap();
            if has_computed_tags {
                writeln!(output, "      derivedRecord = derived.derived;\n    }}").unwrap();
            } else {
                writeln!(output, "    }}").unwrap();
            }
            if uses_field_ref_resolver {
                writeln!(
                    output,
                    "    const instance = new {}(new Uint8Array(buffer), params, opts?.fieldContext);",
                    class_name
                )
                .unwrap();
            } else {
                writeln!(
                    output,
                    "    const instance = new {}(new Uint8Array(buffer), params);",
                    class_name
                )
                .unwrap();
            }
            if has_computed_tags {
                writeln!(
                    output,
                    "    if (derivedRecord) instance.__tnDerivedParams = derivedRecord;"
                )
                .unwrap();
            }
            writeln!(output, "    return instance;\n  }}\n").unwrap();
        } else {
            writeln!(
                output,
                "  static __tnCreateView(buffer: Uint8Array, opts?: {{ params?: {}.Params{} }}): {} {{",
                class_name,
                if uses_field_ref_resolver {
                    ", fieldContext?: Record<string, number | bigint>"
                } else {
                    ""
                },
                class_name
            )
            .unwrap();
            writeln!(
                output,
                "    if (!buffer || buffer.length === undefined) throw new Error(\"{}.__tnCreateView requires a Uint8Array\");",
                class_name
            )
            .unwrap();
            writeln!(output, "    const params = opts?.params ?? null;").unwrap();
            writeln!(output, "    if (!params) {{").unwrap();
            writeln!(
                output,
                "      throw new Error(\"{}.__tnCreateView requires params when extraction is unavailable\");",
                class_name
            )
            .unwrap();
            writeln!(output, "    }}").unwrap();
            if uses_field_ref_resolver {
                writeln!(
                    output,
                    "    return new {}(new Uint8Array(buffer), params, opts?.fieldContext);",
                    class_name
                )
                .unwrap();
            } else {
                writeln!(
                    output,
                    "    return new {}(new Uint8Array(buffer), params);",
                    class_name
                )
                .unwrap();
            }
            writeln!(output, "  }}\n").unwrap();
        }
    } else {
        // Always accept opts parameter for compatibility with wrapper as*() methods
        writeln!(
            output,
            "  static __tnCreateView(buffer: Uint8Array, opts?: {{ fieldContext?: Record<string, number | bigint> }}): {} {{",
            class_name
        )
        .unwrap();
        writeln!(
            output,
            "    if (!buffer || buffer.length === undefined) throw new Error(\"{}.__tnCreateView requires a Uint8Array\");",
            class_name
        )
        .unwrap();
        if uses_field_ref_resolver {
            writeln!(
                output,
                "    return new {}(new Uint8Array(buffer), opts?.fieldContext);",
                class_name
            )
            .unwrap();
        } else {
            // Even if we don't use fieldContext, accept it for API consistency
            writeln!(
                output,
                "    return new {}(new Uint8Array(buffer));",
                class_name
            )
            .unwrap();
        }
        writeln!(output, "  }}\n").unwrap();
    }

    if has_param_cache {
        write!(
            output,
            "  dynamicParams(): {}.Params {{\n    return this.__tnParams;\n  }}\n\n",
            class_name
        )
        .unwrap();
    }

    if uses_field_ref_resolver {
        writeln!(
            output,
            "  withFieldContext(context: Record<string, number | bigint>): this {{"
        )
        .unwrap();
        writeln!(output, "    this.__tnFieldContext = context;").unwrap();
        writeln!(output, "    return this;\n  }}\n").unwrap();
        writeln!(
            output,
            "  private __tnResolveFieldRef(path: string): number {{"
        )
        .unwrap();
        writeln!(
            output,
            "    const getterName = `get_${{path.replace(/[.]/g, '_')}}`;"
        )
        .unwrap();
        writeln!(output, "    const getter = (this as any)[getterName];").unwrap();
        writeln!(output, "    if (typeof getter === \"function\") {{").unwrap();
        writeln!(output, "      const value = getter.call(this);").unwrap();
        writeln!(
            output,
            "      return typeof value === \"bigint\" ? __tnBigIntToNumber(value, \"{}::__tnResolveFieldRef\") : value;",
            class_name
        )
        .unwrap();
        writeln!(output, "    }}").unwrap();
        writeln!(
            output,
            "    if (this.__tnFieldContext && Object.prototype.hasOwnProperty.call(this.__tnFieldContext, path)) {{"
        )
        .unwrap();
        writeln!(
            output,
            "      const contextValue = this.__tnFieldContext[path];"
        )
        .unwrap();
        writeln!(
            output,
            "      return typeof contextValue === \"bigint\" ? __tnBigIntToNumber(contextValue, \"{}::__tnResolveFieldRef\") : contextValue;",
            class_name
        )
        .unwrap();
        writeln!(output, "    }}").unwrap();
        writeln!(
            output,
            "    throw new Error(\"{}: field reference '\" + path + \"' is not available; provide fieldContext when creating this view\");",
            class_name
        )
        .unwrap();
        writeln!(output, "  }}\n").unwrap();
    }

    if emit_builder_method {
        writeln!(
            output,
            "  static builder(): {}Builder {{\n    return new {}Builder();\n  }}\n",
            class_name, class_name
        )
        .unwrap();
        emit_struct_from_builder_method(class_name, has_param_cache, output);
    }

    emit_struct_variant_descriptors(resolved_type, builder_registry, output);
    emit_flexible_array_descriptors(resolved_type, output);

    if let Some(helper) = emit_sequential_layout_helper(
        class_name,
        resolved_type,
        param_plan.as_ref(),
        &dynamic_field_names,
        type_lookup,
    ) {
        output.push_str(&helper);
    }

    if let (Some(ir), Some(plan)) = (type_ir, param_plan.as_ref()) {
        output.push_str(&emit_param_extractor(resolved_type, ir, plan));
    }

    if has_dynamic_fields || has_computed_tags {
        emit_dynamic_offset_helpers(class_name, output, has_dynamic_fields);
    }
    if has_computed_tags {
        emit_derived_param_helpers(class_name, output);
    }

    /* Emit getter/setter methods for each field */
    for (field, offset) in fields.iter().zip(field_offsets.iter()) {
        if matches!(field.field_type.kind, ResolvedTypeKind::Enum { .. }) {
            continue;
        }
        emit_struct_field_getter(class_name, &field.name, &field.field_type, *offset, output);
        emit_struct_field_setter(class_name, &field.name, &field.field_type, *offset, output);
        emit_struct_field_property_accessors(class_name, &field.name, &field.field_type, output);
    }

    for block in &enum_method_blocks {
        output.push_str(block);
    }

    write!(output, "}}\n\n").unwrap();
}

fn emit_dynamic_offset_helpers(class_name: &str, output: &mut String, has_dynamic_fields: bool) {
    if has_dynamic_fields {
        writeln!(
            output,
            "  /* Dynamic offsets are derived once per view; mutating length fields later does not invalidate this cache. */"
        )
        .unwrap();
        writeln!(
            output,
            "  private __tnDynamicOffsetCache: Record<string, number> | null = null;"
        )
        .unwrap();
        writeln!(
            output,
            "  private __tnGetDynamicOffset(field: string): number {{"
        )
        .unwrap();
        writeln!(output, "    if (!this.__tnDynamicOffsetCache) {{").unwrap();
        writeln!(
            output,
            "      this.__tnDynamicOffsetCache = this.__tnComputeDynamicOffsets();"
        )
        .unwrap();
        writeln!(output, "    }}").unwrap();
        writeln!(
            output,
            "    const offset = this.__tnDynamicOffsetCache[field];"
        )
        .unwrap();
        writeln!(output, "    if (offset === undefined) {{").unwrap();
        writeln!(
            output,
            "      throw new Error(\"{}: field '\" + field + \"' does not have a dynamic offset\");",
            class_name
        )
        .unwrap();
        writeln!(output, "    }}").unwrap();
        writeln!(output, "    return offset;").unwrap();
        writeln!(output, "  }}\n").unwrap();

        writeln!(
            output,
            "  private __tnComputeDynamicOffsets(): Record<string, number> {{"
        )
        .unwrap();
        writeln!(
            output,
            "    const layout = {}.__tnComputeSequentialLayout(this.view, this.buffer);",
            class_name
        )
        .unwrap();
        writeln!(output, "    if (!layout || !layout.offsets) {{").unwrap();
        writeln!(
            output,
            "      throw new Error(\"{}: failed to compute dynamic offsets\");",
            class_name
        )
        .unwrap();
        writeln!(output, "    }}").unwrap();
        writeln!(output, "    return layout.offsets;").unwrap();
        writeln!(output, "  }}\n").unwrap();
    }
}

fn emit_derived_param_helpers(class_name: &str, output: &mut String) {
    writeln!(
        output,
        "  private __tnEnsureDerivedParams(): Record<string, bigint> | null {{"
    )
    .unwrap();
    writeln!(
        output,
        "    if (this.__tnDerivedParams) return this.__tnDerivedParams;"
    )
    .unwrap();
    writeln!(
        output,
        "    const layout = {}.__tnComputeSequentialLayout(this.view, this.buffer);",
        class_name
    )
    .unwrap();
    writeln!(output, "    if (!layout || !layout.derived) return null;").unwrap();
    writeln!(output, "    this.__tnDerivedParams = layout.derived;").unwrap();
    writeln!(output, "    return this.__tnDerivedParams;\n  }}\n").unwrap();

    writeln!(
        output,
        "  private __tnReadDerivedParam(key: string): number | null {{"
    )
    .unwrap();
    writeln!(output, "    const params = this.__tnEnsureDerivedParams();").unwrap();
    writeln!(output, "    if (!params) return null;").unwrap();
    writeln!(output, "    const value = params[key];").unwrap();
    writeln!(output, "    if (value === undefined) return null;").unwrap();
    writeln!(
        output,
        "    return __tnBigIntToNumber(value, \"{}::__tnReadDerivedParam\");",
        class_name
    )
    .unwrap();
    writeln!(output, "  }}\n").unwrap();
}

fn emit_cursor_alignment(output: &mut String, align: u64) {
    if align > 1 {
        writeln!(
            output,
            "    if ((__tnCursorMutable % {}) !== 0) {{ __tnCursorMutable += {} - (__tnCursorMutable % {}); }}",
            align, align, align
        )
        .unwrap();
    }
}

/* Emit getter for a struct field */
fn emit_struct_field_getter(
    struct_name: &str,
    field_name: &str,
    field_type: &ResolvedType,
    offset: Option<u64>,
    output: &mut String,
) {
    let escaped_name = escape_ts_keyword(field_name);
    let offset_expr = match offset {
        Some(value) => value.to_string(),
        None => format!("this.__tnGetDynamicOffset(\"{}\")", field_name),
    };

    match &field_type.kind {
        ResolvedTypeKind::Primitive { prim_type } => {
            let ts_type = primitive_to_ts_return_type(prim_type);
            let getter = primitive_to_dataview_getter(prim_type);
            let needs_le = primitive_size(prim_type) > 1;

            write!(output, "  get_{}(): {} {{\n", escaped_name, ts_type).unwrap();
            write_ts_offset_binding(output, &offset_expr);
            if needs_le {
                write!(
                    output,
                    "    return this.view.{}(offset, true); /* little-endian */\n",
                    getter
                )
                .unwrap();
            } else {
                write!(output, "    return this.view.{}(offset);\n", getter).unwrap();
            }
            write!(output, "  }}\n\n").unwrap();
        }
        ResolvedTypeKind::Array {
            element_type,
            size_expression,
            ..
        } => {
            if size_expression.is_constant() {
                /* Fixed-size array */
                if let ResolvedTypeKind::Primitive { prim_type } = &element_type.kind {
                    let size = size_expression.to_c_string();
                    let ts_type = primitive_to_ts_return_type(prim_type);
                    let elem_size = primitive_size(prim_type);

                    write!(output, "  get_{}(): {}[] {{\n", escaped_name, ts_type).unwrap();
                    write_ts_offset_binding(output, &offset_expr);
                    write!(output, "    const result: {}[] = [];\n", ts_type).unwrap();
                    write!(output, "    for (let i = 0; i < {}; i++) {{\n", size).unwrap();
                    /* Only add endianness argument for multi-byte types */
                    if needs_endianness_arg(prim_type) {
                        write!(
                            output,
                            "      result.push(this.view.{}((offset + i * {}), true));\n",
                            primitive_to_dataview_getter(prim_type),
                            elem_size
                        )
                        .unwrap();
                    } else {
                        write!(
                            output,
                            "      result.push(this.view.{}((offset + i * {})));\n",
                            primitive_to_dataview_getter(prim_type),
                            elem_size
                        )
                        .unwrap();
                    }
                    write!(output, "    }}\n").unwrap();
                    write!(output, "    return result;\n").unwrap();
                    write!(output, "  }}\n\n").unwrap();
                } else if let ResolvedTypeKind::TypeRef { target_name, .. } = &element_type.kind {
                    /* Array of structs - element must have constant size */
                    if let Size::Const(elem_size) = element_type.size {
                        let size = size_expression.to_c_string();

                        write!(output, "  get_{}(): {}[] {{\n", escaped_name, target_name).unwrap();
                        write_ts_offset_binding(output, &offset_expr);
                        write!(output, "    const result: {}[] = [];\n", target_name).unwrap();
                        write!(output, "    for (let i = 0; i < {}; i++) {{\n", size).unwrap();
                        write!(output, "      const slice = this.buffer.subarray((offset + i * {}), (offset + (i + 1) * {}));\n",
                   elem_size, elem_size).unwrap();
                        write!(
                            output,
                            "      result.push({}.from_array(slice)!);\n",
                            target_name
                        )
                        .unwrap();
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
                    write!(
                        output,
                        "  get_{}_at(index: number): {} {{\n",
                        escaped_name, ts_type
                    )
                    .unwrap();
                    write_ts_offset_binding(output, &offset_expr);
                    if needs_endianness_arg(prim_type) {
                        write!(
                            output,
                            "    return this.view.{}(offset + index * {}, true);\n",
                            primitive_to_dataview_getter(prim_type),
                            elem_size
                        )
                        .unwrap();
                    } else {
                        write!(
                            output,
                            "    return this.view.{}(offset + index * {});\n",
                            primitive_to_dataview_getter(prim_type),
                            elem_size
                        )
                        .unwrap();
                    }
                    write!(output, "  }}\n\n").unwrap();

                    /* Array getter */
                    write!(output, "  get_{}(): {}[] {{\n", escaped_name, ts_type).unwrap();
                    write!(
                        output,
                        "    const len = this.get_{}_length();\n",
                        escaped_name
                    )
                    .unwrap();
                    write!(output, "    const result: {}[] = [];\n", ts_type).unwrap();
                    write!(output, "    for (let i = 0; i < len; i++) {{\n").unwrap();
                    write!(
                        output,
                        "      result.push(this.get_{}_at(i));\n",
                        escaped_name
                    )
                    .unwrap();
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
                        write!(
                            output,
                            "  get_{}_at(index: number): {} {{\n",
                            escaped_name, target_name
                        )
                        .unwrap();
                        write_ts_offset_binding(output, &offset_expr);
                        write!(output, "    const slice = this.buffer.subarray((offset + index * {}), (offset + (index + 1) * {}));\n",
                   elem_size, elem_size).unwrap();
                        write!(output, "    return {}.from_array(slice)!;\n", target_name).unwrap();
                        write!(output, "  }}\n\n").unwrap();

                        /* Array getter */
                        write!(output, "  get_{}(): {}[] {{\n", escaped_name, target_name).unwrap();
                        write!(
                            output,
                            "    const len = this.get_{}_length();\n",
                            escaped_name
                        )
                        .unwrap();
                        write!(output, "    const result: {}[] = [];\n", target_name).unwrap();
                        write!(output, "    for (let i = 0; i < len; i++) {{\n").unwrap();
                        write!(
                            output,
                            "      result.push(this.get_{}_at(i));\n",
                            escaped_name
                        )
                        .unwrap();
                        write!(output, "    }}\n").unwrap();
                        write!(output, "    return result;\n").unwrap();
                        write!(output, "  }}\n\n").unwrap();
                    } else {
                        /* Check if this is a jagged array */
                        if let ResolvedTypeKind::Array { jagged: true, .. } = &field_type.kind {
                            emit_jagged_array_ts_accessors(
                                output,
                                struct_name,
                                &escaped_name,
                                target_name,
                                &size_expr,
                                &offset_expr,
                            );
                        }
                    }
                }
            }
        }
        ResolvedTypeKind::TypeRef { target_name, .. } => match field_type.size {
            Size::Const(size) => {
                write!(output, "  get_{}(): {} {{\n", escaped_name, target_name).unwrap();
                write_ts_offset_binding(output, &offset_expr);
                write!(
                    output,
                    "    const slice = this.buffer.subarray(offset, offset + {});\n",
                    size
                )
                .unwrap();
                write!(output, "    return {}.from_array(slice)!;\n", target_name).unwrap();
                write!(output, "  }}\n\n").unwrap();
            }
            Size::Variable(_) => {
                write!(output, "  get_{}(): {} {{\n", escaped_name, target_name).unwrap();
                write_ts_offset_binding(output, &offset_expr);
                writeln!(output, "    const tail = this.buffer.subarray(offset);").unwrap();
                writeln!(
                    output,
                    "    const validation = {}.validate(tail);",
                    target_name
                )
                .unwrap();
                writeln!(
                    output,
                    "    if (!validation.ok || validation.consumed === undefined) {{"
                )
                .unwrap();
                writeln!(
                        output,
                        "      throw new Error(\"{}: failed to read field '{}' (invalid nested payload)\");",
                        struct_name, field_name
                    )
                    .unwrap();
                writeln!(output, "    }}").unwrap();
                writeln!(output, "    const length = validation.consumed;").unwrap();
                writeln!(output, "    const slice = tail.subarray(0, length);").unwrap();
                writeln!(
                        output,
                        "    const opts = validation.params ? {{ params: validation.params }} : undefined;"
                    )
                    .unwrap();
                writeln!(
                    output,
                    "    return {}.from_array(slice, opts)!;",
                    target_name
                )
                .unwrap();
                writeln!(output, "  }}\n").unwrap();
            }
        },
        _ => {}
    }
}

/* Emit setter for a struct field */
fn emit_struct_field_setter(
    _struct_name: &str,
    field_name: &str,
    field_type: &ResolvedType,
    offset: Option<u64>,
    output: &mut String,
) {
    let escaped_name = escape_ts_keyword(field_name);
    let offset_expr = match offset {
        Some(value) => value.to_string(),
        None => format!("this.__tnGetDynamicOffset(\"{}\")", field_name),
    };

    match &field_type.kind {
        ResolvedTypeKind::Primitive { prim_type } => {
            let ts_type = primitive_to_ts_return_type(prim_type);
            let setter = primitive_to_dataview_setter(prim_type);
            let needs_le = primitive_size(prim_type) > 1;

            write!(
                output,
                "  set_{}(value: {}): void {{\n",
                escaped_name, ts_type
            )
            .unwrap();
            write_ts_offset_binding(output, &offset_expr);
            if needs_le {
                write!(
                    output,
                    "    this.view.{}(offset, value, true); /* little-endian */\n",
                    setter
                )
                .unwrap();
            } else {
                write!(output, "    this.view.{}(offset, value);\n", setter).unwrap();
            }
            write!(output, "  }}\n\n").unwrap();
        }
        ResolvedTypeKind::Array {
            element_type,
            size_expression,
            ..
        } => {
            if size_expression.is_constant() {
                /* Fixed-size array */
                if let ResolvedTypeKind::Primitive { prim_type } = &element_type.kind {
                    let size = size_expression.to_c_string();
                    let ts_type = primitive_to_ts_return_type(prim_type);
                    let elem_size = primitive_size(prim_type);

                    write!(
                        output,
                        "  set_{}(value: {}[]): void {{\n",
                        escaped_name, ts_type
                    )
                    .unwrap();
                    write_ts_offset_binding(output, &offset_expr);
                    write!(output, "    if (value.length !== {}) {{\n", size).unwrap();
                    write!(
                        output,
                        "      throw new Error('Array length must be {}');\n",
                        size
                    )
                    .unwrap();
                    write!(output, "    }}\n").unwrap();
                    write!(output, "    for (let i = 0; i < {}; i++) {{\n", size).unwrap();
                    /* Only add endianness argument for multi-byte types */
                    if needs_endianness_arg(prim_type) {
                        write!(
                            output,
                            "      this.view.{}((offset + i * {}), value[i], true);\n",
                            primitive_to_dataview_setter(prim_type),
                            elem_size
                        )
                        .unwrap();
                    } else {
                        write!(
                            output,
                            "      this.view.{}((offset + i * {}), value[i]);\n",
                            primitive_to_dataview_setter(prim_type),
                            elem_size
                        )
                        .unwrap();
                    }
                    write!(output, "    }}\n").unwrap();
                    write!(output, "  }}\n\n").unwrap();
                } else if let ResolvedTypeKind::TypeRef { target_name, .. } = &element_type.kind {
                    /* Array of structs - element must have constant size */
                    if let Size::Const(elem_size) = element_type.size {
                        let size = size_expression.to_c_string();

                        write!(
                            output,
                            "  set_{}(value: {}[]): void {{\n",
                            escaped_name, target_name
                        )
                        .unwrap();
                        write_ts_offset_binding(output, &offset_expr);
                        write!(output, "    if (value.length !== {}) {{\n", size).unwrap();
                        write!(
                            output,
                            "      throw new Error('Array length must be {}');\n",
                            size
                        )
                        .unwrap();
                        write!(output, "    }}\n").unwrap();
                        write!(output, "    for (let i = 0; i < {}; i++) {{\n", size).unwrap();
                        write!(output, "      const slice = this.buffer.subarray(offset + i * {}, offset + (i + 1) * {});\n",
                   elem_size, elem_size).unwrap();
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
                    write!(
                        output,
                        "  set_{}_at(index: number, value: {}): void {{\n",
                        escaped_name, ts_type
                    )
                    .unwrap();
                    write_ts_offset_binding(output, &offset_expr);
                    if needs_endianness_arg(prim_type) {
                        write!(
                            output,
                            "    this.view.{}((offset + index * {}), value, true);\n",
                            primitive_to_dataview_setter(prim_type),
                            elem_size
                        )
                        .unwrap();
                    } else {
                        write!(
                            output,
                            "    this.view.{}((offset + index * {}), value);\n",
                            primitive_to_dataview_setter(prim_type),
                            elem_size
                        )
                        .unwrap();
                    }
                    write!(output, "  }}\n\n").unwrap();

                    /* Array setter */
                    write!(
                        output,
                        "  set_{}(value: {}[]): void {{\n",
                        escaped_name, ts_type
                    )
                    .unwrap();
                    write!(
                        output,
                        "    const len = Math.min(this.get_{}_length(), value.length);\n",
                        escaped_name
                    )
                    .unwrap();
                    write!(output, "    for (let i = 0; i < len; i++) {{\n").unwrap();
                    write!(output, "      this.set_{}_at(i, value[i]);\n", escaped_name).unwrap();
                    write!(output, "    }}\n").unwrap();
                    write!(output, "  }}\n\n").unwrap();
                } else if let ResolvedTypeKind::TypeRef { target_name, .. } = &element_type.kind {
                    /* Variable-size array of structs */
                    if let Size::Const(elem_size) = element_type.size {
                        /* Index setter */
                        write!(
                            output,
                            "  set_{}_at(index: number, value: {}): void {{\n",
                            escaped_name, target_name
                        )
                        .unwrap();
                        write_ts_offset_binding(output, &offset_expr);
                        write!(output, "    const slice = this.buffer.subarray(offset + index * {}, offset + (index + 1) * {});\n",
                   elem_size, elem_size).unwrap();
                        write!(output, "    slice.set(value['buffer']);\n").unwrap();
                        write!(output, "  }}\n\n").unwrap();

                        /* Array setter */
                        write!(
                            output,
                            "  set_{}(value: {}[]): void {{\n",
                            escaped_name, target_name
                        )
                        .unwrap();
                        write!(
                            output,
                            "    const len = Math.min(this.get_{}_length(), value.length);\n",
                            escaped_name
                        )
                        .unwrap();
                        write!(output, "    for (let i = 0; i < len; i++) {{\n").unwrap();
                        write!(output, "      this.set_{}_at(i, value[i]);\n", escaped_name)
                            .unwrap();
                        write!(output, "    }}\n").unwrap();
                        write!(output, "  }}\n\n").unwrap();
                    }
                }
            }
        }
        ResolvedTypeKind::TypeRef { target_name, .. } => {
            /* For TypeRef (nested structs), generate setter that copies from another instance */
            write!(
                output,
                "  set_{}(value: {}): void {{\n",
                escaped_name, target_name
            )
            .unwrap();
            write!(
                output,
                "    /* Copy bytes from source struct to this field */\n"
            )
            .unwrap();
            write!(
                output,
                "    const sourceBytes = (value as any).buffer as Uint8Array;\n"
            )
            .unwrap();
            write_ts_offset_binding(output, &offset_expr);
            write!(output, "    this.buffer.set(sourceBytes, offset);\n").unwrap();
            write!(output, "  }}\n\n").unwrap();
        }
        _ => { /* Other complex types - skip setters for now */ }
    }
}

fn write_ts_offset_binding(output: &mut String, offset_expr: &str) {
    writeln!(output, "    const offset = {};", offset_expr).unwrap();
}

/* Emit property-style getters and setters for a struct field */
fn emit_struct_field_property_accessors(
    _struct_name: &str,
    field_name: &str,
    field_type: &ResolvedType,
    output: &mut String,
) {
    let escaped_name = escape_ts_keyword(field_name);

    match &field_type.kind {
        ResolvedTypeKind::Primitive { prim_type } => {
            let ts_type = primitive_to_ts_return_type(prim_type);

            /* Emit property getter */
            write!(output, "  get {}(): {} {{\n", escaped_name, ts_type).unwrap();
            write!(output, "    return this.get_{}();\n", escaped_name).unwrap();
            write!(output, "  }}\n\n").unwrap();

            /* Emit property setter */
            write!(output, "  set {}(value: {}) {{\n", escaped_name, ts_type).unwrap();
            write!(output, "    this.set_{}(value);\n", escaped_name).unwrap();
            write!(output, "  }}\n\n").unwrap();
        }
        ResolvedTypeKind::Array {
            element_type,
            size_expression,
            ..
        } => {
            if size_expression.is_constant() {
                /* Fixed-size array */
                if let ResolvedTypeKind::Primitive { prim_type } = &element_type.kind {
                    let ts_type = primitive_to_ts_return_type(prim_type);

                    /* Emit property getter */
                    write!(output, "  get {}(): {}[] {{\n", escaped_name, ts_type).unwrap();
                    write!(output, "    return this.get_{}();\n", escaped_name).unwrap();
                    write!(output, "  }}\n\n").unwrap();

                    /* Emit property setter */
                    write!(output, "  set {}(value: {}[]) {{\n", escaped_name, ts_type).unwrap();
                    write!(output, "    this.set_{}(value);\n", escaped_name).unwrap();
                    write!(output, "  }}\n\n").unwrap();
                } else if let ResolvedTypeKind::TypeRef { target_name, .. } = &element_type.kind {
                    /* Array of structs */
                    /* Emit property getter */
                    write!(output, "  get {}(): {}[] {{\n", escaped_name, target_name).unwrap();
                    write!(output, "    return this.get_{}();\n", escaped_name).unwrap();
                    write!(output, "  }}\n\n").unwrap();

                    /* Emit property setter */
                    write!(
                        output,
                        "  set {}(value: {}[]) {{\n",
                        escaped_name, target_name
                    )
                    .unwrap();
                    write!(output, "    this.set_{}(value);\n", escaped_name).unwrap();
                    write!(output, "  }}\n\n").unwrap();
                }
            } else {
                /* Variable-size array (FAM) - emit property accessors */
                if let ResolvedTypeKind::Primitive { prim_type } = &element_type.kind {
                    let ts_type = primitive_to_ts_return_type(prim_type);

                    /* Emit property getter */
                    write!(output, "  get {}(): {}[] {{\n", escaped_name, ts_type).unwrap();
                    write!(output, "    return this.get_{}();\n", escaped_name).unwrap();
                    write!(output, "  }}\n\n").unwrap();

                    /* Emit property setter */
                    write!(output, "  set {}(value: {}[]) {{\n", escaped_name, ts_type).unwrap();
                    write!(output, "    this.set_{}(value);\n", escaped_name).unwrap();
                    write!(output, "  }}\n\n").unwrap();
                } else if let ResolvedTypeKind::TypeRef { target_name, .. } = &element_type.kind {
                    /* Variable-size array of structs */
                    /* Emit property getter */
                    write!(output, "  get {}(): {}[] {{\n", escaped_name, target_name).unwrap();
                    write!(output, "    return this.get_{}();\n", escaped_name).unwrap();
                    write!(output, "  }}\n\n").unwrap();

                    /* Emit property setter */
                    write!(
                        output,
                        "  set {}(value: {}[]) {{\n",
                        escaped_name, target_name
                    )
                    .unwrap();
                    write!(output, "    this.set_{}(value);\n", escaped_name).unwrap();
                    write!(output, "  }}\n\n").unwrap();
                }
            }
        }
        ResolvedTypeKind::TypeRef { target_name, .. } => {
            /* Nested struct */
            /* Emit property getter */
            write!(output, "  get {}(): {} {{\n", escaped_name, target_name).unwrap();
            write!(output, "    return this.get_{}();\n", escaped_name).unwrap();
            write!(output, "  }}\n\n").unwrap();

            /* Emit property setter */
            write!(
                output,
                "  set {}(value: {}) {{\n",
                escaped_name, target_name
            )
            .unwrap();
            write!(output, "    this.set_{}(value);\n", escaped_name).unwrap();
            write!(output, "  }}\n\n").unwrap();
        }
        _ => { /* Other complex types - skip property accessors for now */ }
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

    write!(
        output,
        "  private constructor(private buffer: Uint8Array) {{\n"
    )
    .unwrap();
    write!(
        output,
        "    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);\n"
    )
    .unwrap();
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
    write!(output, "  private view: DataView;\n").unwrap();
    // Store field context for passing to variant inner classes
    write!(
        output,
        "  private __tnFieldContext: Record<string, number | bigint> | null = null;\n"
    )
    .unwrap();
    write!(
        output,
        "  private constructor(private buffer: Uint8Array, private descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>) {{\n"
    )
    .unwrap();
    write!(
        output,
        "    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);\n"
    )
    .unwrap();
    write!(output, "    this.__tnFieldContext = fieldContext ?? null;\n").unwrap();
    write!(output, "  }}\n\n").unwrap();

    write!(
        output,
        "  static __tnCreate(payload: Uint8Array, descriptor: __TnVariantDescriptor | null, fieldContext?: Record<string, number | bigint>): {} {{\n",
        class_name
    )
    .unwrap();
    write!(
        output,
        "    return new {}(new Uint8Array(payload), descriptor, fieldContext);\n",
        class_name
    )
    .unwrap();
    write!(output, "  }}\n\n").unwrap();

    write!(
        output,
        "  bytes(): Uint8Array {{\n    return new Uint8Array(this.buffer);\n  }}\n\n"
    )
    .unwrap();
    write!(
        output,
        "  variant(): __TnVariantDescriptor | null {{\n    return this.descriptor;\n  }}\n\n"
    )
    .unwrap();

    for variant in _variants {
        let method_name = escape_ts_keyword(&format!("as{}", to_camel_case(&variant.name)));
        let variant_type = enum_variant_type_ident(&variant.variant_type);
        write!(output, "  {}(): {} | null {{\n", method_name, variant_type).unwrap();
        writeln!(
            output,
            "    if (!this.descriptor || this.descriptor.tag !== {}) return null;",
            variant.tag_value
        )
        .unwrap();
        // Pass field context to variant inner class for FAM field resolution
        writeln!(
            output,
            "    return {}.__tnCreateView(new Uint8Array(this.buffer), {{ fieldContext: this.__tnFieldContext ?? undefined }});",
            variant_type
        )
        .unwrap();
        write!(output, "  }}\n\n").unwrap();
    }

    write!(output, "}}\n\n").unwrap();
}

fn emit_struct_variant_descriptors(
    resolved_type: &ResolvedType,
    builder_registry: &BTreeMap<String, bool>,
    output: &mut String,
) {
    if let ResolvedTypeKind::Struct { fields, .. } = &resolved_type.kind {
        for field in fields {
            if let ResolvedTypeKind::Enum { variants, .. } = &field.field_type.kind {
                let prop_name = format!("{}VariantDescriptors", escape_ts_keyword(&field.name));
                writeln!(output, "  static readonly {} = Object.freeze([", prop_name).unwrap();
                for variant in variants {
                    let payload_size = match variant.variant_type.size {
                        Size::Const(sz) => sz.to_string(),
                        _ => "null".to_string(),
                    };
                    let payload_ident = enum_variant_type_ident(&variant.variant_type);
                    let payload_label = variant.variant_type.name.replace('\"', "\\\"");
                    writeln!(output, "    {{").unwrap();
                    writeln!(output, "      name: \"{}\",", variant.name).unwrap();
                    writeln!(output, "      tag: {},", variant.tag_value).unwrap();
                    writeln!(output, "      payloadSize: {},", payload_size).unwrap();
                    writeln!(output, "      payloadType: \"{}\",", payload_label).unwrap();
                    if type_has_builder_entry(&variant.variant_type, builder_registry) {
                        writeln!(
                            output,
                            "      createPayloadBuilder: () => __tnMaybeCallBuilder({}),",
                            payload_ident
                        )
                        .unwrap();
                    } else {
                        writeln!(output, "      createPayloadBuilder: () => null,").unwrap();
                    }
                    writeln!(output, "    }},").unwrap();
                }
                writeln!(output, "  ] as const);\n").unwrap();
            }
        }
    }
}

fn type_has_builder_entry(
    resolved_type: &ResolvedType,
    builder_registry: &BTreeMap<String, bool>,
) -> bool {
    if let Some(flag) = builder_registry.get(&resolved_type.name) {
        return *flag;
    }
    match &resolved_type.kind {
        ResolvedTypeKind::TypeRef { target_name, .. } => {
            builder_registry.get(target_name).copied().unwrap_or(false)
        }
        _ => false,
    }
}

fn emit_struct_from_builder_method(class_name: &str, has_param_cache: bool, output: &mut String) {
    if has_param_cache {
        writeln!(
            output,
            "  static fromBuilder(builder: {}Builder): {} | null {{",
            class_name, class_name
        )
        .unwrap();
        writeln!(output, "    const buffer = builder.build();").unwrap();
        writeln!(output, "    const params = builder.dynamicParams();").unwrap();
        writeln!(
            output,
            "    return {}.from_array(buffer, {{ params }});",
            class_name
        )
        .unwrap();
        writeln!(output, "  }}\n").unwrap();
    } else {
        writeln!(
            output,
            "  static fromBuilder(builder: {}Builder): {} | null {{",
            class_name, class_name
        )
        .unwrap();
        writeln!(output, "    const buffer = builder.build();").unwrap();
        writeln!(output, "    return {}.from_array(buffer);", class_name).unwrap();
        writeln!(output, "  }}\n").unwrap();
    }
}

fn emit_flexible_array_descriptors(resolved_type: &ResolvedType, output: &mut String) {
    let infos = fam_field_infos(resolved_type);
    if infos.is_empty() {
        return;
    }
    writeln!(
        output,
        "  static readonly flexibleArrayWriters = Object.freeze(["
    )
    .unwrap();
    for info in &infos {
        let method = escape_ts_keyword(&info.field.name);
        writeln!(
            output,
            "    {{ field: \"{}\", method: \"{}\", sizeField: \"{}\", paramKey: \"{}\", elementSize: {} }},",
            info.field.name,
            method,
            info.size_field.name,
            info.param_binding,
            info.element_size
        )
        .unwrap();
    }
    writeln!(output, "  ] as const);\n").unwrap();
}

struct EnumReaderHelper {
    offset_const: String,
    method_block: String,
}

fn emit_enum_reader_helper(
    parent_name: &str,
    parent_type: &ResolvedType,
    info: &EnumFieldInfo,
    payload_offset: u64,
    type_lookup: &BTreeMap<String, ResolvedType>,
    parent_has_field_context: bool,
) -> EnumReaderHelper {
    let field = info.enum_field;
    let field_ident = escape_ts_keyword(&field.name);
    let helper_class = generated_type_ident(&format!("{}::{}", parent_name, field.name));
    let descriptor_type = format!("typeof {}.{}[number]", parent_name, info.descriptor_prop);
    let offset_const_name = format!(
        "  private static readonly __tnFieldOffset_{} = {};\n",
        field_ident, payload_offset
    );
    let variant_method = escape_ts_keyword(&format!("{}Variant", to_lower_camel_case(&field.name)));
    let accessor_method = field_ident.clone();

    let mut methods = String::new();
    let has_tag_field = info.tag_field.is_some();

    if !has_tag_field {
        writeln!(methods, "  get_{}(): number {{", info.tag_ts_name).unwrap();
        if let (Some(ts_name), Some(expr)) = (&info.tag_param_ts_name, &info.tag_expression) {
            let expr_ts = render_tag_expression(expr).unwrap_or_else(|| {
                "(() => { throw new Error(\"unhandled tag expression\") })()".into()
            });
            writeln!(
                methods,
                "    let tag = this.__tnReadDerivedParam(\"{}\");",
                ts_name
            )
            .unwrap();
            writeln!(methods, "    if (tag === null) {{").unwrap();
            writeln!(methods, "      tag = ({});", expr_ts).unwrap();
            writeln!(methods, "    }}").unwrap();
            writeln!(methods, "    return tag;").unwrap();
        } else if let Some(expr) = &info.tag_expression {
            let expr_ts = render_tag_expression(expr).unwrap_or_else(|| {
                "(() => { throw new Error(\"unhandled tag expression\") })()".into()
            });
            writeln!(methods, "    return ({});", expr_ts).unwrap();
        } else {
            writeln!(methods, "    return 0;").unwrap();
        }
        writeln!(methods, "  }}\n").unwrap();
    }

    writeln!(
        methods,
        "  {}(): {} | null {{",
        variant_method, descriptor_type
    )
    .unwrap();
    if has_tag_field {
        let tag_offset = info
            .tag_offset
            .expect("tag offset should exist when tag field present");
        writeln!(
            methods,
            "    const tag = this.view.getUint8({});",
            tag_offset
        )
        .unwrap();
    } else {
        writeln!(methods, "    const tag = this.get_{}();", info.tag_ts_name).unwrap();
    }
    writeln!(
        methods,
        "    return {}.{}.find((variant) => variant.tag === tag) ?? null;",
        parent_name, info.descriptor_prop
    )
    .unwrap();
    writeln!(methods, "  }}\n").unwrap();

    // Collect field refs from variant FAMs that need to be passed to inner classes
    let variant_fam_refs = collect_enum_variant_fam_refs(info.variants);

    // Resolve each field ref to an offset and primitive type, generating read code
    struct FieldRefRead {
        path_key: String,  // e.g., "hdr.path_bitset.bytes.0"
        offset: u64,
        getter: String,    // e.g., "getUint8"
        needs_le: bool,
    }
    let mut field_ref_reads: Vec<FieldRefRead> = Vec::new();
    for path_segments in &variant_fam_refs {
        let segments_str: Vec<&str> = path_segments.iter().map(String::as_str).collect();
        if let Some((offset, prim_type)) = resolve_field_read(parent_type, 0, &segments_str, type_lookup) {
            let getter = super::helpers::primitive_to_dataview_getter(&prim_type);
            let needs_le = super::helpers::primitive_size(&prim_type) > 1;
            let path_key = path_segments.join(".");
            field_ref_reads.push(FieldRefRead {
                path_key,
                offset,
                getter: getter.to_string(),
                needs_le,
            });
        }
    }

    writeln!(methods, "  {}(): {} {{", accessor_method, helper_class).unwrap();
    writeln!(methods, "    const descriptor = this.{}();", variant_method).unwrap();
    writeln!(
        methods,
        "    if (!descriptor) throw new Error(\"{}: unknown {} variant\");",
        parent_name, field.name
    )
    .unwrap();
    writeln!(
        methods,
        "    const offset = {}.__tnFieldOffset_{};",
        parent_name, field_ident
    )
    .unwrap();
    writeln!(
        methods,
        "    const remaining = this.buffer.length - offset;"
    )
    .unwrap();
    writeln!(
        methods,
        "    const payloadLength = descriptor.payloadSize ?? remaining;"
    )
    .unwrap();
    writeln!(
        methods,
        "    if (payloadLength < 0 || offset + payloadLength > this.buffer.length) throw new Error(\"{}: payload exceeds buffer bounds\");",
        parent_name
    )
    .unwrap();
    writeln!(
        methods,
        "    const slice = this.buffer.subarray(offset, offset + payloadLength);"
    )
    .unwrap();

    // Generate fieldContext with auto-populated values from parent buffer
    if field_ref_reads.is_empty() {
        // No field refs to populate
        if parent_has_field_context {
            // Pass parent's fieldContext as-is
            writeln!(
                methods,
                "    return {}.__tnCreate(slice, descriptor, this.__tnFieldContext ?? undefined);",
                helper_class
            )
            .unwrap();
        } else {
            // Parent doesn't have fieldContext, pass undefined
            writeln!(
                methods,
                "    return {}.__tnCreate(slice, descriptor, undefined);",
                helper_class
            )
            .unwrap();
        }
    } else {
        // Build fieldContext with auto-populated values
        writeln!(methods, "    const __tnAutoContext: Record<string, number | bigint> = {{").unwrap();
        for read in &field_ref_reads {
            if read.needs_le {
                writeln!(
                    methods,
                    "      \"{}\": this.view.{}({}, true),",
                    read.path_key, read.getter, read.offset
                )
                .unwrap();
            } else {
                writeln!(
                    methods,
                    "      \"{}\": this.view.{}({}),",
                    read.path_key, read.getter, read.offset
                )
                .unwrap();
            }
        }
        writeln!(methods, "    }};").unwrap();
        // Merge with any existing fieldContext (user-provided values take precedence)
        if parent_has_field_context {
            writeln!(
                methods,
                "    const __tnMergedContext = this.__tnFieldContext ? {{ ...__tnAutoContext, ...this.__tnFieldContext }} : __tnAutoContext;"
            )
            .unwrap();
        } else {
            writeln!(
                methods,
                "    const __tnMergedContext = __tnAutoContext;"
            )
            .unwrap();
        }
        writeln!(
            methods,
            "    return {}.__tnCreate(slice, descriptor, __tnMergedContext);",
            helper_class
        )
        .unwrap();
    }
    writeln!(methods, "  }}\n").unwrap();

    EnumReaderHelper {
        offset_const: offset_const_name,
        method_block: methods,
    }
}

fn enum_variant_type_ident(variant_type: &ResolvedType) -> String {
    match &variant_type.kind {
        ResolvedTypeKind::TypeRef { target_name, .. } => escape_ts_keyword(target_name),
        _ => generated_type_ident(&variant_type.name),
    }
}

fn render_tag_expression(expr: &ExprKind) -> Option<String> {
    match expr {
        ExprKind::Literal(lit) => Some(literal_to_string(lit)),
        ExprKind::FieldRef(field_ref) => Some(format!(
            "this.__tnResolveFieldRef(\"{}\")",
            field_ref.path.join(".")
        )),
        ExprKind::Add(e) => Some(format!(
            "({} + {})",
            render_tag_expression(&e.left)?,
            render_tag_expression(&e.right)?
        )),
        ExprKind::Sub(e) => Some(format!(
            "({} - {})",
            render_tag_expression(&e.left)?,
            render_tag_expression(&e.right)?
        )),
        ExprKind::Mul(e) => Some(format!(
            "({} * {})",
            render_tag_expression(&e.left)?,
            render_tag_expression(&e.right)?
        )),
        ExprKind::Div(e) => Some(format!(
            "({} / {})",
            render_tag_expression(&e.left)?,
            render_tag_expression(&e.right)?
        )),
        ExprKind::Mod(e) => Some(format!(
            "({} % {})",
            render_tag_expression(&e.left)?,
            render_tag_expression(&e.right)?
        )),
        ExprKind::BitAnd(e) => Some(format!(
            "({} & {})",
            render_tag_expression(&e.left)?,
            render_tag_expression(&e.right)?
        )),
        ExprKind::BitOr(e) => Some(format!(
            "({} | {})",
            render_tag_expression(&e.left)?,
            render_tag_expression(&e.right)?
        )),
        ExprKind::BitXor(e) => Some(format!(
            "({} ^ {})",
            render_tag_expression(&e.left)?,
            render_tag_expression(&e.right)?
        )),
        ExprKind::LeftShift(e) => Some(format!(
            "({} << {})",
            render_tag_expression(&e.left)?,
            render_tag_expression(&e.right)?
        )),
        ExprKind::RightShift(e) => Some(format!(
            "({} >> {})",
            render_tag_expression(&e.left)?,
            render_tag_expression(&e.right)?
        )),
        ExprKind::BitNot(e) => Some(format!("(~({}))", render_tag_expression(&e.operand)?)),
        ExprKind::Neg(e) => Some(format!("(-({}))", render_tag_expression(&e.operand)?)),
        ExprKind::Popcount(e) => Some(format!(
            "__tnPopcount({})",
            render_tag_expression(&e.operand)?
        )),
        _ => None,
    }
}

/// Emit TypeScript jagged array accessor methods for a field.
/// Jagged arrays have variable-size elements that must be traversed sequentially.
/// Generates:
/// - `get_{field}_length()` - returns the count of elements
/// - `get_{field}_at(index)` - returns ElementType | null for indexed access (O(n))
/// - `{field}Iter()` - generator for efficient sequential access
/// - `get_{field}_size()` - returns the total byte size of all elements
fn emit_jagged_array_ts_accessors(
    output: &mut String,
    struct_name: &str,
    field_name: &str,
    element_type_name: &str,
    count_expr: &str,
    offset_expr: &str,
) {
    // Length getter
    writeln!(
        output,
        "  /** Returns the number of elements in the jagged array. */"
    )
    .unwrap();
    writeln!(output, "  get_{}_length(): number {{", field_name).unwrap();
    writeln!(output, "    return {};", count_expr).unwrap();
    writeln!(output, "  }}\n").unwrap();

    // Index getter - O(n) indexed access
    writeln!(
        output,
        "  /** Returns the element at the given index, or null if out of bounds."
    )
    .unwrap();
    writeln!(
        output,
        "   * Note: This is O(n) as jagged arrays require sequential traversal. */"
    )
    .unwrap();
    writeln!(
        output,
        "  get_{}_at(index: number): {} | null {{",
        field_name, element_type_name
    )
    .unwrap();
    writeln!(output, "    const count = this.get_{}_length();", field_name).unwrap();
    writeln!(output, "    if (index < 0 || index >= count) {{").unwrap();
    writeln!(output, "      return null;").unwrap();
    writeln!(output, "    }}").unwrap();
    write_ts_offset_binding(output, offset_expr);
    writeln!(output, "    let cursor = offset;").unwrap();
    writeln!(output, "    for (let i = 0; i < index; i++) {{").unwrap();
    writeln!(
        output,
        "      const elem = {}.from_array(this.buffer.subarray(cursor));",
        element_type_name
    )
    .unwrap();
    writeln!(output, "      if (!elem) {{").unwrap();
    writeln!(
        output,
        "        throw new Error(\"{}: invalid element at index \" + i + \" in jagged array '{}'\");",
        struct_name, field_name
    )
    .unwrap();
    writeln!(output, "      }}").unwrap();
    writeln!(output, "      const fp = elem.footprint();").unwrap();
    writeln!(output, "      if (!fp.ok || fp.consumed === undefined) {{").unwrap();
    writeln!(
        output,
        "        throw new Error(\"{}: failed to get footprint for element at index \" + i);",
        struct_name
    )
    .unwrap();
    writeln!(output, "      }}").unwrap();
    writeln!(output, "      cursor += fp.consumed;").unwrap();
    writeln!(output, "    }}").unwrap();
    writeln!(
        output,
        "    return {}.from_array(this.buffer.subarray(cursor));",
        element_type_name
    )
    .unwrap();
    writeln!(output, "  }}\n").unwrap();

    // Generator for efficient sequential access
    writeln!(
        output,
        "  /** Returns a generator over the jagged array elements."
    )
    .unwrap();
    writeln!(
        output,
        "   * This is more efficient than repeated calls to `get_{}_at()` for sequential access. */",
        field_name
    )
    .unwrap();
    writeln!(
        output,
        "  *{}Iter(): Generator<{}, void, unknown> {{",
        field_name, element_type_name
    )
    .unwrap();
    writeln!(output, "    const count = this.get_{}_length();", field_name).unwrap();
    write_ts_offset_binding(output, offset_expr);
    writeln!(output, "    let cursor = offset;").unwrap();
    writeln!(output, "    for (let i = 0; i < count; i++) {{").unwrap();
    writeln!(
        output,
        "      const elem = {}.from_array(this.buffer.subarray(cursor));",
        element_type_name
    )
    .unwrap();
    writeln!(output, "      if (!elem) {{").unwrap();
    writeln!(
        output,
        "        throw new Error(\"{}: invalid element at index \" + i + \" in jagged array '{}'\");",
        struct_name, field_name
    )
    .unwrap();
    writeln!(output, "      }}").unwrap();
    writeln!(output, "      yield elem;").unwrap();
    writeln!(output, "      const fp = elem.footprint();").unwrap();
    writeln!(output, "      if (fp.ok && fp.consumed !== undefined) {{").unwrap();
    writeln!(output, "        cursor += fp.consumed;").unwrap();
    writeln!(output, "      }}").unwrap();
    writeln!(output, "    }}").unwrap();
    writeln!(output, "  }}\n").unwrap();

    // Size getter - total byte size
    writeln!(
        output,
        "  /** Returns the total byte size of all elements in the jagged array. */"
    )
    .unwrap();
    writeln!(output, "  get_{}_size(): number {{", field_name).unwrap();
    writeln!(output, "    const count = this.get_{}_length();", field_name).unwrap();
    write_ts_offset_binding(output, offset_expr);
    writeln!(output, "    let cursor = offset;").unwrap();
    writeln!(output, "    for (let i = 0; i < count; i++) {{").unwrap();
    writeln!(
        output,
        "      const elem = {}.from_array(this.buffer.subarray(cursor));",
        element_type_name
    )
    .unwrap();
    writeln!(output, "      if (!elem) {{").unwrap();
    writeln!(
        output,
        "        throw new Error(\"{}: invalid element at index \" + i + \" in jagged array '{}'\");",
        struct_name, field_name
    )
    .unwrap();
    writeln!(output, "      }}").unwrap();
    writeln!(output, "      const fp = elem.footprint();").unwrap();
    writeln!(output, "      if (!fp.ok || fp.consumed === undefined) {{").unwrap();
    writeln!(
        output,
        "        throw new Error(\"{}: failed to get footprint for element at index \" + i);",
        struct_name
    )
    .unwrap();
    writeln!(output, "      }}").unwrap();
    writeln!(output, "      cursor += fp.consumed;").unwrap();
    writeln!(output, "    }}").unwrap();
    writeln!(output, "    return cursor - offset;").unwrap();
    writeln!(output, "  }}\n").unwrap();
}
