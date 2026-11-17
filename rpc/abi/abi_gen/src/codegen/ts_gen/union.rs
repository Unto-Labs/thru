/* Classes for top-level size-discriminated unions (and the variant views
they share with unions). */

use super::helpers::expr_to_ts_bigint_with_resolver;
use super::helpers::{
    escape_ts_keyword, generated_type_ident, needs_endianness_arg, primitive_size,
    primitive_to_dataview_getter, primitive_to_dataview_setter, primitive_to_ts_return_type,
    to_camel_case,
};
use super::ir_helpers::{deduplicated_ts_parameter_bindings, sanitize_param_name};
use super::measure::{checks_tags, measure_fn, measure_fn_with_context};
use crate::abi::expr::ExprKind;
use crate::abi::resolved::{ResolvedType, ResolvedTypeKind, Size};
use crate::codegen::shared::ir::TypeIr;
use std::collections::BTreeMap;
use std::fmt::Write;

/* A typed view of one variant: the TS type and an expression reading it from
`bytes`, a Uint8Array starting at the variant. */
pub(crate) struct VariantView {
    pub ts_type: String,
    pub expr: String,
}

/* The nested class emitted for an inline variant (see `emit_nested_types`). */
pub(crate) fn inline_variant_class(owner: &str, variant: &str, ty: &ResolvedType) -> String {
    if ty.name.contains("::") {
        generated_type_ident(&ty.name)
    } else {
        format!("{owner}_{variant}_Inner")
    }
}

pub(crate) fn variant_view(owner: &str, variant: &str, ty: &ResolvedType) -> VariantView {
    match &ty.kind {
        ResolvedTypeKind::Primitive { prim_type } => {
            let le = if needs_endianness_arg(prim_type) {
                ", true"
            } else {
                ""
            };
            VariantView {
                ts_type: primitive_to_ts_return_type(prim_type).to_string(),
                expr: format!(
                    "new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).{}(0{le})",
                    primitive_to_dataview_getter(prim_type)
                ),
            }
        }
        ResolvedTypeKind::Struct { .. } | ResolvedTypeKind::Union { .. } => {
            let inner = inline_variant_class(owner, variant, ty);
            VariantView {
                expr: format!("{inner}.__tnCreateView(bytes)"),
                ts_type: inner,
            }
        }
        ResolvedTypeKind::TypeRef { target_name, .. } => VariantView {
            ts_type: format!("{target_name} | null"),
            expr: format!("{target_name}.from_array(bytes)"),
        },
        _ => VariantView {
            ts_type: "Uint8Array".to_string(),
            expr: "new Uint8Array(bytes)".to_string(),
        },
    }
}

/* Input type and statements turning `value` into the variant's bytes
(`bytes`), for `new_<variant>` constructors. `size` is the variant's size
when constant. */
pub(crate) fn variant_input(
    owner: &str,
    variant: &str,
    ty: &ResolvedType,
    context: &str,
) -> (String, String) {
    match &ty.kind {
        ResolvedTypeKind::Primitive { prim_type } => {
            let le = if needs_endianness_arg(prim_type) {
                ", true"
            } else {
                ""
            };
            (
                primitive_to_ts_return_type(prim_type).to_string(),
                format!(
                    "    const bytes = new Uint8Array({size});\n    new DataView(bytes.buffer).{setter}(0, value{le});\n",
                    size = primitive_size(prim_type),
                    setter = primitive_to_dataview_setter(prim_type)
                ),
            )
        }
        _ => {
            let typed = match &ty.kind {
                ResolvedTypeKind::Struct { .. } | ResolvedTypeKind::Union { .. } => {
                    format!("{} | ", inline_variant_class(owner, variant, ty))
                }
                ResolvedTypeKind::TypeRef { target_name, .. } => format!("{target_name} | "),
                _ => String::new(),
            };
            (
                format!("{typed}__TnStructFieldInput"),
                format!(
                    "    const bytes = __tnResolveStructFieldInput(value as __TnStructFieldInput, \"{context}\");\n"
                ),
            )
        }
    }
}

pub(crate) fn variant_method_suffix(name: &str) -> String {
    escape_ts_keyword(&format!("as{}", to_camel_case(name)))
}

/* Variant descriptor table shared by SDUs and unions: the tag is the
declaration index. */
fn emit_variant_descriptors(variants: &[(&str, Option<u64>, &ResolvedType)], out: &mut String) {
    writeln!(
        out,
        "  static readonly variantDescriptors = Object.freeze(["
    )
    .unwrap();
    for (idx, (name, size, ty)) in variants.iter().enumerate() {
        let size = size.map_or("null".to_string(), |s| s.to_string());
        writeln!(
            out,
            "    {{ name: \"{}\", tag: {}, payloadSize: {}, payloadType: \"{}\", createPayloadBuilder: () => null }},",
            name,
            idx,
            size,
            ty.name.replace('\"', "\\\"")
        )
        .unwrap();
    }
    writeln!(out, "  ] as const);\n").unwrap();
    writeln!(
        out,
        "  static variantByName(name: string): __TnVariantDescriptor | null {{\n    return this.variantDescriptors.find((d) => d.name === name) ?? null;\n  }}\n"
    )
    .unwrap();
}

/* The Params member holding a top-level SDU's byte size. */
pub(crate) fn sdu_size_param(type_name: &str) -> (String, String) {
    let canonical = format!("{type_name}.payload_size");
    let ts_name = sanitize_param_name(&canonical);
    (canonical, ts_name)
}

/* A top-level size-discriminated union: its size is the buffer's, which must
equal one variant's expected size. */
pub(crate) fn emit_sdu_class(
    resolved_type: &ResolvedType,
    type_lookup: &BTreeMap<String, ResolvedType>,
    out: &mut String,
) {
    let ResolvedTypeKind::SizeDiscriminatedUnion { variants } = &resolved_type.kind else {
        return;
    };
    let c = &resolved_type.name;
    let (canonical, p) = sdu_size_param(c);

    writeln!(out, "export class {c} {{").unwrap();
    writeln!(out, "  private view: DataView;\n").unwrap();
    writeln!(
        out,
        "  private constructor(private buffer: Uint8Array, private descriptor: __TnVariantDescriptor) {{"
    )
    .unwrap();
    writeln!(
        out,
        "    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);"
    )
    .unwrap();
    writeln!(out, "  }}\n").unwrap();

    let table: Vec<(&str, Option<u64>, &ResolvedType)> = variants
        .iter()
        .map(|v| (v.name.as_str(), Some(v.expected_size), &v.variant_type))
        .collect();
    emit_variant_descriptors(&table, out);
    writeln!(
        out,
        "  static variantBySize(size: number): __TnVariantDescriptor | null {{\n    return this.variantDescriptors.find((d) => d.payloadSize === size) ?? null;\n  }}\n"
    )
    .unwrap();

    writeln!(
        out,
        "  bytes(): Uint8Array {{\n    return new Uint8Array(this.buffer);\n  }}\n"
    )
    .unwrap();
    writeln!(
        out,
        "  asUint8Array(): Uint8Array {{\n    return this.bytes();\n  }}\n"
    )
    .unwrap();
    writeln!(
        out,
        "  variant(): __TnVariantDescriptor {{\n    return this.descriptor;\n  }}\n"
    )
    .unwrap();
    writeln!(
        out,
        "  /** Variant index (declaration order). */\n  tag(): number {{\n    return Number(this.descriptor.tag);\n  }}\n"
    )
    .unwrap();
    writeln!(
        out,
        "  dynamicParams(): {c}.Params {{\n    return {c}.Params.fromValues({{ {p}: this.buffer.length }});\n  }}\n"
    )
    .unwrap();

    for (idx, variant) in variants.iter().enumerate() {
        let view = variant_view(c, &variant.name, &variant.variant_type);
        writeln!(
            out,
            "  {}(): {} | null {{",
            variant_method_suffix(&variant.name),
            view.ts_type
        )
        .unwrap();
        writeln!(out, "    if (this.descriptor.tag !== {idx}) return null;").unwrap();
        writeln!(out, "    const bytes = this.buffer;").unwrap();
        writeln!(out, "    return {};", view.expr).unwrap();
        writeln!(out, "  }}\n").unwrap();
    }

    /* Sizing. */
    writeln!(
        out,
        "  static footprintFromParams(params: {c}.Params): number {{"
    )
    .unwrap();
    writeln!(
        out,
        "    const size = __tnBigIntToNumber(__tnToBigInt(params.{p}), '{c}::footprintFromParams');"
    )
    .unwrap();
    writeln!(
        out,
        "    if (this.variantBySize(size) === null) throw new Error(`{c}: no variant is ${{size}} bytes`);"
    )
    .unwrap();
    writeln!(out, "    return size;\n  }}\n").unwrap();
    writeln!(
        out,
        "  static footprintFromValues(input: {{ {p}: number | bigint }}): number {{\n    return this.footprintFromParams({c}.Params.fromValues(input));\n  }}\n"
    )
    .unwrap();
    writeln!(
        out,
        "  static footprint(params: {c}.Params): number {{\n    return this.footprintFromParams(params);\n  }}\n"
    )
    .unwrap();
    writeln!(
        out,
        "  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {{"
    )
    .unwrap();
    writeln!(out, "    const size = __tnParams[\"{canonical}\"];").unwrap();
    writeln!(
        out,
        "    if (size === undefined) throw new Error(\"{c}: missing IR parameter '{canonical}'\");"
    )
    .unwrap();
    writeln!(
        out,
        "    return __tnToBigInt(this.footprintFromParams({c}.Params.fromValues({{ {p}: size }})));\n  }}\n"
    )
    .unwrap();
    writeln!(
        out,
        "  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {{"
    )
    .unwrap();
    writeln!(out, "    const size = __tnParams[\"{canonical}\"];").unwrap();
    writeln!(
        out,
        "    const result = size === undefined ? this.validate(buffer) : this.validate(buffer, {{ params: {c}.Params.fromValues({{ {p}: size }}) }});"
    )
    .unwrap();
    writeln!(
        out,
        "    return {{ ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed) }};\n  }}\n"
    )
    .unwrap();

    /* Validation: without params the whole buffer is the value. */
    writeln!(
        out,
        "  static validate(buffer: Uint8Array, opts?: {{ params?: {c}.Params }}): {{ ok: boolean; code?: string; consumed?: number; params?: {c}.Params }} {{"
    )
    .unwrap();
    writeln!(
        out,
        "    if (!buffer || buffer.length === undefined) return {{ ok: false, code: \"tn.invalid_buffer\" }};"
    )
    .unwrap();
    writeln!(
        out,
        "    const size = opts?.params ? __tnBigIntToNumber(__tnToBigInt(opts.params.{p}), '{c}::validate') : buffer.length;"
    )
    .unwrap();
    writeln!(
        out,
        "    if (size > buffer.length) return {{ ok: false, code: \"tn.buffer_too_small\", consumed: size }};"
    )
    .unwrap();
    writeln!(out, "    const descriptor = this.variantBySize(size);").unwrap();
    writeln!(
        out,
        "    if (descriptor === null) return {{ ok: false, code: \"tn.invalid_size\" }};"
    )
    .unwrap();
    writeln!(
        out,
        "    if (this.__tnMeasureVariant(Number(descriptor.tag), buffer.subarray(0, size)) !== size) return {{ ok: false, code: \"tn.invalid_variant\" }};"
    )
    .unwrap();
    writeln!(
        out,
        "    return {{ ok: true, consumed: size, params: {c}.Params.fromValues({{ {p}: size }}) }};\n  }}\n"
    )
    .unwrap();

    /* The selected variant must validate over exactly its expected size. */
    writeln!(
        out,
        "  private static __tnMeasureVariant(index: number, buffer: Uint8Array): number | null {{"
    )
    .unwrap();
    writeln!(out, "    switch (index) {{").unwrap();
    for (idx, variant) in variants.iter().enumerate() {
        let expr = match measure_fn(&variant.variant_type, type_lookup) {
            Some(f) => format!("{f}(buffer)"),
            /* Never drop a required tag check (the CLI reports this). */
            None if checks_tags(&variant.variant_type, type_lookup) => panic!(
                "TypeScript codegen cannot walk variant '{}' of '{c}' to check its enum tags",
                variant.name
            ),
            None => format!(
                "buffer.length >= {n} ? {n} : null",
                n = variant.expected_size
            ),
        };
        writeln!(out, "      case {idx}: return {expr};").unwrap();
    }
    writeln!(out, "      default: return null;\n    }}\n  }}\n").unwrap();

    writeln!(
        out,
        "  static from_array(buffer: Uint8Array, opts?: {{ params?: {c}.Params }}): {c} | null {{"
    )
    .unwrap();
    writeln!(out, "    const validation = this.validate(buffer, opts);").unwrap();
    writeln!(
        out,
        "    if (!validation.ok || validation.consumed === undefined) return null;"
    )
    .unwrap();
    writeln!(
        out,
        "    const descriptor = this.variantBySize(validation.consumed);"
    )
    .unwrap();
    writeln!(out, "    if (!descriptor) return null;").unwrap();
    writeln!(
        out,
        "    return new {c}(buffer.subarray(0, validation.consumed), descriptor);\n  }}\n"
    )
    .unwrap();

    /* Constructors. */
    writeln!(
        out,
        "  /** Builds a value from a variant's raw bytes (exactly its expected size, a valid payload). */"
    )
    .unwrap();
    writeln!(
        out,
        "  static newVariant(name: string, payload: Uint8Array | __TnBuilderLike): {c} {{"
    )
    .unwrap();
    writeln!(out, "    const descriptor = this.variantByName(name);").unwrap();
    writeln!(
        out,
        "    if (!descriptor) throw new Error(`{c}: unknown variant '${{name}}'`);"
    )
    .unwrap();
    writeln!(
        out,
        "    const bytes = __tnResolveBuilderInput(payload, `{c}::newVariant(${{name}})`);"
    )
    .unwrap();
    writeln!(
        out,
        "    if (bytes.length !== descriptor.payloadSize) throw new Error(`{c}: variant '${{name}}' is ${{descriptor.payloadSize}} bytes, got ${{bytes.length}}`);"
    )
    .unwrap();
    /* The selected payload must validate, as `validate` requires. */
    writeln!(
        out,
        "    if (this.__tnMeasureVariant(Number(descriptor.tag), bytes) !== bytes.length) throw new Error(`{c}: payload is not one valid '${{name}}' variant`);"
    )
    .unwrap();
    writeln!(out, "    return new {c}(bytes, descriptor);\n  }}\n").unwrap();
    for variant in variants {
        let name = escape_ts_keyword(&variant.name);
        let (input_ty, prep) = variant_input(
            c,
            &variant.name,
            &variant.variant_type,
            &format!("{c}::new_{name}"),
        );
        writeln!(out, "  static new_{name}(value: {input_ty}): {c} {{").unwrap();
        out.push_str(&prep);
        writeln!(
            out,
            "    return this.newVariant(\"{}\", bytes);\n  }}\n",
            variant.name
        )
        .unwrap();
    }

    writeln!(out, "}}\n").unwrap();
}

/* A union. Every union gets variant descriptors and per-variant accessors;
one with a variable-size variant also gets `__tnMeasure` (its size over the
bytes given, every variant fitting) and, when top level, validation, params
sizing (`<T>.payload_size`) and `new_<variant>` constructors. Constant-size
top-level unions keep the generic footprint/validate methods. */
pub(crate) fn emit_union_class(
    class_name: &str,
    owner: &str,
    resolved_type: &ResolvedType,
    top_level: bool,
    type_lookup: &BTreeMap<String, ResolvedType>,
    out: &mut String,
) {
    let ResolvedTypeKind::Union { variants } = &resolved_type.kind else {
        return;
    };
    let c = class_name;
    writeln!(out, "export class {c} {{").unwrap();
    writeln!(out, "  private view: DataView;\n").unwrap();
    /* `ctx`: values the variants read from the struct around the union
    (`["..", "n"]`), passed on to the variant views. */
    writeln!(
        out,
        "  private constructor(private buffer: Uint8Array, private __tnCtx: Record<string, number | bigint> = {{}}) {{"
    )
    .unwrap();
    writeln!(
        out,
        "    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);"
    )
    .unwrap();
    writeln!(out, "  }}\n").unwrap();
    writeln!(
        out,
        "  static __tnCreateView(buffer: Uint8Array, ctx: Record<string, number | bigint> = {{}}): {c} {{\n    return new {c}(buffer, ctx);\n  }}\n"
    )
    .unwrap();

    let table: Vec<(&str, Option<u64>, &ResolvedType)> = variants
        .iter()
        .map(|v| {
            let size = match v.field_type.size {
                Size::Const(n) => Some(n),
                Size::Variable(_) => None,
            };
            (v.name.as_str(), size, &v.field_type)
        })
        .collect();
    emit_variant_descriptors(&table, out);
    writeln!(
        out,
        "  bytes(): Uint8Array {{\n    return new Uint8Array(this.buffer);\n  }}\n"
    )
    .unwrap();
    writeln!(
        out,
        "  asUint8Array(): Uint8Array {{\n    return this.bytes();\n  }}\n"
    )
    .unwrap();

    for variant in variants {
        let name = escape_ts_keyword(&variant.name);
        let mut view = variant_view(owner, &variant.name, &variant.field_type);
        /* Inline variant views see the union's context. */
        match &variant.field_type.kind {
            ResolvedTypeKind::Struct { .. } => {
                view.expr = format!(
                    "{}.__tnCreateView(bytes, {{ fieldContext: this.__tnCtx }})",
                    view.ts_type
                );
            }
            ResolvedTypeKind::Union { .. } => {
                view.expr = format!("{}.__tnCreateView(bytes, this.__tnCtx)", view.ts_type);
            }
            _ => {}
        }
        writeln!(out, "  get_{name}(): {} {{", view.ts_type).unwrap();
        writeln!(out, "    const bytes = this.buffer;").unwrap();
        writeln!(out, "    return {};\n  }}\n", view.expr).unwrap();
        if let ResolvedTypeKind::Primitive { prim_type } = &variant.field_type.kind {
            let le = if needs_endianness_arg(prim_type) {
                ", true"
            } else {
                ""
            };
            writeln!(
                out,
                "  set_{name}(value: {}): void {{\n    this.view.{}(0, value{le});\n  }}\n",
                primitive_to_ts_return_type(prim_type),
                primitive_to_dataview_setter(prim_type)
            )
            .unwrap();
        }
    }

    if !matches!(resolved_type.size, Size::Variable(_)) {
        writeln!(out, "}}\n").unwrap();
        return;
    }

    /* `ctx` holds values the union's variants read from the struct around
    it (`["..", "n"]`), which the struct passes. */
    let measure = measure_fn_with_context(resolved_type, type_lookup, "ctx").unwrap_or_else(|| {
        /* Never a walk that always fails: the CLI reports this. */
        panic!("TypeScript codegen cannot measure union '{c}'")
    });
    writeln!(
        out,
        "  /** Size of the union at the start of `buffer` (its largest variant), or null unless every variant fits. */"
    )
    .unwrap();
    writeln!(
        out,
        "  static __tnMeasure(buffer: Uint8Array, ctx: Record<string, number | bigint> = {{}}): number | null {{\n    return {measure}(buffer);\n  }}\n"
    )
    .unwrap();
    writeln!(
        out,
        "  private static __tnMeasureVariant(index: number, buffer: Uint8Array, ctx: Record<string, number | bigint> = {{}}): number | null {{"
    )
    .unwrap();
    writeln!(out, "    switch (index) {{").unwrap();
    for (idx, variant) in variants.iter().enumerate() {
        let expr = match measure_fn_with_context(&variant.field_type, type_lookup, "ctx") {
            Some(f) => format!("{f}(buffer)"),
            /* Never drop a required tag check (the CLI reports this). */
            None if checks_tags(&variant.field_type, type_lookup) => panic!(
                "TypeScript codegen cannot walk variant '{}' of union '{c}' to check its enum tags",
                variant.name
            ),
            None => match variant.field_type.size {
                Size::Const(n) => format!("buffer.length >= {n} ? {n} : null"),
                Size::Variable(_) => panic!(
                    "TypeScript codegen cannot measure variant '{}' of union '{c}'",
                    variant.name
                ),
            },
        };
        writeln!(out, "      case {idx}: return {expr};").unwrap();
    }
    writeln!(out, "      default: return null;\n    }}\n  }}\n").unwrap();

    if !top_level {
        writeln!(out, "}}\n").unwrap();
        return;
    }

    let (canonical, p) = sdu_size_param(c);
    let min_size = variants
        .iter()
        .filter_map(|v| match v.field_type.size {
            Size::Const(n) => Some(n),
            Size::Variable(_) => None,
        })
        .max()
        .unwrap_or(0);

    writeln!(
        out,
        "  dynamicParams(): {c}.Params {{\n    return {c}.Params.fromValues({{ {p}: this.buffer.length }});\n  }}\n"
    )
    .unwrap();
    writeln!(
        out,
        "  /** The union's size is its params' payload size (no smaller than its largest constant-size variant). */"
    )
    .unwrap();
    writeln!(
        out,
        "  static footprintFromParams(params: {c}.Params): number {{"
    )
    .unwrap();
    writeln!(
        out,
        "    const size = __tnBigIntToNumber(__tnToBigInt(params.{p}), '{c}::footprintFromParams');"
    )
    .unwrap();
    writeln!(
        out,
        "    if (size < {min_size}) throw new Error(`{c}: ${{size}} bytes cannot hold every variant`);"
    )
    .unwrap();
    writeln!(out, "    return size;\n  }}\n").unwrap();
    writeln!(
        out,
        "  static footprintFromValues(input: {{ {p}: number | bigint }}): number {{\n    return this.footprintFromParams({c}.Params.fromValues(input));\n  }}\n"
    )
    .unwrap();
    writeln!(
        out,
        "  static footprint(params: {c}.Params): number {{\n    return this.footprintFromParams(params);\n  }}\n"
    )
    .unwrap();
    writeln!(
        out,
        "  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {{"
    )
    .unwrap();
    writeln!(out, "    const size = __tnParams[\"{canonical}\"];").unwrap();
    writeln!(
        out,
        "    if (size === undefined) throw new Error(\"{c}: missing IR parameter '{canonical}'\");"
    )
    .unwrap();
    writeln!(
        out,
        "    return __tnToBigInt(this.footprintFromParams({c}.Params.fromValues({{ {p}: size }})));\n  }}\n"
    )
    .unwrap();
    writeln!(
        out,
        "  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {{"
    )
    .unwrap();
    writeln!(out, "    const size = __tnParams[\"{canonical}\"];").unwrap();
    writeln!(
        out,
        "    const result = size === undefined ? this.validate(buffer) : this.validate(buffer, {{ params: {c}.Params.fromValues({{ {p}: size }}) }});"
    )
    .unwrap();
    writeln!(
        out,
        "    return {{ ok: result.ok, code: result.code, consumed: result.consumed === undefined ? undefined : __tnToBigInt(result.consumed) }};\n  }}\n"
    )
    .unwrap();

    writeln!(
        out,
        "  /** Validates the union at the start of `buffer`: every variant must fit; the value spans the largest. */"
    )
    .unwrap();
    writeln!(
        out,
        "  static validate(buffer: Uint8Array, opts?: {{ params?: {c}.Params }}): {{ ok: boolean; code?: string; consumed?: number; params?: {c}.Params }} {{"
    )
    .unwrap();
    writeln!(
        out,
        "    if (!buffer || buffer.length === undefined) return {{ ok: false, code: \"tn.invalid_buffer\" }};"
    )
    .unwrap();
    writeln!(out, "    const size = this.__tnMeasure(buffer);").unwrap();
    writeln!(
        out,
        "    if (size === null) return {{ ok: false, code: \"tn.invalid_union\" }};"
    )
    .unwrap();
    writeln!(
        out,
        "    if (opts?.params && __tnToBigInt(opts.params.{p}) !== __tnToBigInt(size)) return {{ ok: false, code: \"tn.payload_size_mismatch\", consumed: size }};"
    )
    .unwrap();
    writeln!(
        out,
        "    return {{ ok: true, consumed: size, params: {c}.Params.fromValues({{ {p}: size }}) }};\n  }}\n"
    )
    .unwrap();
    writeln!(
        out,
        "  static from_array(buffer: Uint8Array, opts?: {{ params?: {c}.Params }}): {c} | null {{"
    )
    .unwrap();
    writeln!(out, "    const validation = this.validate(buffer, opts);").unwrap();
    writeln!(
        out,
        "    if (!validation.ok || validation.consumed === undefined) return null;"
    )
    .unwrap();
    writeln!(
        out,
        "    return new {c}(buffer.subarray(0, validation.consumed));\n  }}\n"
    )
    .unwrap();

    writeln!(
        out,
        "  /** Builds a union from one variant's complete bytes, zero-extended to the size every variant needs. */"
    )
    .unwrap();
    writeln!(
        out,
        "  static newVariant(name: string, payload: Uint8Array | __TnBuilderLike): {c} {{"
    )
    .unwrap();
    writeln!(out, "    const descriptor = this.variantByName(name);").unwrap();
    writeln!(
        out,
        "    if (!descriptor) throw new Error(`{c}: unknown variant '${{name}}'`);"
    )
    .unwrap();
    writeln!(
        out,
        "    const bytes = __tnResolveBuilderInput(payload, `{c}::newVariant(${{name}})`);"
    )
    .unwrap();
    writeln!(
        out,
        "    if (this.__tnMeasureVariant(Number(descriptor.tag), bytes) !== bytes.length) throw new Error(`{c}: payload is not one complete '${{name}}' variant`);"
    )
    .unwrap();
    writeln!(out, "    let buffer = bytes;").unwrap();
    writeln!(out, "    for (;;) {{").unwrap();
    writeln!(out, "      const size = this.__tnMeasure(buffer);").unwrap();
    writeln!(
        out,
        "      if (size !== null) return new {c}(buffer.subarray(0, size));"
    )
    .unwrap();
    writeln!(
        out,
        "      if (buffer.length >= 1 << 24) throw new Error(\"{c}: cannot size the union\");"
    )
    .unwrap();
    writeln!(
        out,
        "      const grown = new Uint8Array(Math.max(buffer.length * 2, 1));"
    )
    .unwrap();
    writeln!(out, "      grown.set(buffer);").unwrap();
    writeln!(out, "      buffer = grown;\n    }}\n  }}\n").unwrap();
    for variant in variants {
        let name = escape_ts_keyword(&variant.name);
        let (input_ty, prep) = variant_input(
            owner,
            &variant.name,
            &variant.field_type,
            &format!("{c}::new_{name}"),
        );
        writeln!(out, "  static new_{name}(value: {input_ty}): {c} {{").unwrap();
        out.push_str(&prep);
        writeln!(
            out,
            "    return this.newVariant(\"{}\", bytes);\n  }}\n",
            variant.name
        )
        .unwrap();
    }
    writeln!(out, "}}\n").unwrap();
}

/* The API of a top-level enum, whose tag its container supplies as params
(`T.Params`): descriptors, `tag()`, `dynamicParams()`, `from_array(bytes,
{ params })` and, when the tag is a plain field reference so params can be
built from a variant, `new_<variant>` / `newVariant`. Emitted inside the
class body after the shared enum members. */
pub(crate) fn emit_top_level_enum_methods(
    resolved_type: &ResolvedType,
    type_ir: Option<&TypeIr>,
    out: &mut String,
) {
    let ResolvedTypeKind::Enum {
        tag_expression,
        variants,
        ..
    } = &resolved_type.kind
    else {
        return;
    };
    let Some(type_ir) = type_ir else {
        return;
    };
    let c = &resolved_type.name;
    let bindings: Vec<_> = deduplicated_ts_parameter_bindings(type_ir)
        .into_iter()
        .filter(|b| !b.derived)
        .collect();
    if bindings.is_empty() {
        emit_constant_tag_enum_methods(c, tag_expression, variants, out);
        return;
    }
    /* Params bound to the tag expression's references (`<T>.<path>`). */
    let mut resolver = |path: &[String]| -> Option<String> {
        let canonical = format!("{c}.{}", path.join("."));
        bindings
            .iter()
            .find(|b| b.canonical == canonical)
            .map(|b| format!("__tnU64(__tnToBigInt(params.{}))", b.ts_name))
    };
    let tag_expr = expr_to_ts_bigint_with_resolver(tag_expression, &mut resolver);

    writeln!(out, "  private __tnParams: {c}.Params | null = null;\n").unwrap();
    writeln!(
        out,
        "  static readonly variantDescriptors = Object.freeze(["
    )
    .unwrap();
    for variant in variants {
        let size = match variant.variant_type.size {
            Size::Const(n) => n.to_string(),
            Size::Variable(_) => "null".to_string(),
        };
        writeln!(
            out,
            "    {{ name: \"{}\", tag: {}, payloadSize: {size}, payloadType: \"{}\", createPayloadBuilder: () => null }},",
            variant.name,
            super::helpers::ts_tag_literal(variant.tag_value),
            variant.variant_type.name.replace('\"', "\\\"")
        )
        .unwrap();
    }
    writeln!(out, "  ] as const);\n").unwrap();
    writeln!(
        out,
        "  static variantByName(name: string): __TnVariantDescriptor | null {{\n    return this.variantDescriptors.find((d) => d.name === name) ?? null;\n  }}\n"
    )
    .unwrap();
    writeln!(
        out,
        "  static variantByTag(tag: number | bigint): __TnVariantDescriptor | null {{\n    return this.variantDescriptors.find((d) => __tnToBigInt(d.tag) === __tnToBigInt(tag)) ?? null;\n  }}\n"
    )
    .unwrap();
    writeln!(
        out,
        "  /** The active variant's tag (a bigint past 2^53 - 1). */\n  tag(): number | bigint {{\n    if (!this.descriptor) throw new Error(\"{c}: no active variant\");\n    return this.descriptor.tag;\n  }}\n"
    )
    .unwrap();
    writeln!(
        out,
        "  /** The params (the tag its container stores) this view was read with. */\n  dynamicParams(): {c}.Params {{\n    if (!this.__tnParams) throw new Error(\"{c}: view has no params\");\n    return this.__tnParams;\n  }}\n"
    )
    .unwrap();
    writeln!(
        out,
        "  private static __tnTagFromParams(params: {c}.Params): bigint | null {{"
    )
    .unwrap();
    match &tag_expr {
        Some(expr) => writeln!(out, "    return {expr};").unwrap(),
        None => writeln!(out, "    void params;\n    return null;").unwrap(),
    }
    writeln!(out, "  }}\n").unwrap();

    writeln!(
        out,
        "  /** Reads the enum at the start of `buffer`; its tag comes from `opts.params`. */"
    )
    .unwrap();
    writeln!(
        out,
        "  static from_array(buffer: Uint8Array, opts?: {{ params?: {c}.Params }}): {c} | null {{"
    )
    .unwrap();
    writeln!(out, "    const params = opts?.params;").unwrap();
    writeln!(out, "    if (!params) return null;").unwrap();
    writeln!(
        out,
        "    const validation = this.validate(buffer, {{ params }});"
    )
    .unwrap();
    writeln!(
        out,
        "    if (!validation.ok || validation.consumed === undefined) return null;"
    )
    .unwrap();
    writeln!(out, "    const tag = this.__tnTagFromParams(params);").unwrap();
    writeln!(
        out,
        "    const descriptor = tag === null ? null : this.variantByTag(tag);"
    )
    .unwrap();
    writeln!(out, "    if (!descriptor) return null;").unwrap();
    writeln!(
        out,
        "    const view = new {c}(buffer.subarray(0, validation.consumed), descriptor);"
    )
    .unwrap();
    writeln!(out, "    view.__tnParams = params;").unwrap();
    writeln!(out, "    return view;\n  }}\n").unwrap();

    /* Constructors need params built from the tag alone. */
    let plain_tag = match tag_expression {
        ExprKind::FieldRef(f) => {
            let canonical = format!("{c}.{}", f.path.join("."));
            bindings
                .iter()
                .find(|b| b.canonical == canonical)
                .filter(|_| bindings.len() == 1)
                .map(|b| b.ts_name.clone())
        }
        _ => None,
    };
    let Some(tag_param) = plain_tag else {
        return;
    };
    writeln!(
        out,
        "  /** Builds a value from one variant's complete bytes; its params hold that variant's tag. */"
    )
    .unwrap();
    writeln!(
        out,
        "  static newVariant(name: string, payload: Uint8Array | __TnBuilderLike): {c} {{"
    )
    .unwrap();
    writeln!(out, "    const descriptor = this.variantByName(name);").unwrap();
    writeln!(
        out,
        "    if (!descriptor) throw new Error(`{c}: unknown variant '${{name}}'`);"
    )
    .unwrap();
    writeln!(
        out,
        "    const bytes = __tnResolveBuilderInput(payload, `{c}::newVariant(${{name}})`);"
    )
    .unwrap();
    writeln!(
        out,
        "    const view = this.from_array(bytes, {{ params: {c}.Params.fromValues({{ {tag_param}: descriptor.tag }}) }});"
    )
    .unwrap();
    writeln!(
        out,
        "    if (!view || view.buffer.length !== bytes.length) throw new Error(`{c}: payload is not one complete '${{name}}' variant`);"
    )
    .unwrap();
    writeln!(out, "    return view;\n  }}\n").unwrap();
    for variant in variants {
        let name = escape_ts_keyword(&variant.name);
        let (input_ty, prep) = variant_input(
            c,
            &variant.name,
            &variant.variant_type,
            &format!("{c}::new_{name}"),
        );
        writeln!(out, "  static new_{name}(value: {input_ty}): {c} {{").unwrap();
        out.push_str(&prep);
        writeln!(
            out,
            "    return this.newVariant(\"{}\", bytes);\n  }}\n",
            variant.name
        )
        .unwrap();
    }
}

/* Members of a top-level enum whose tag needs no params (a constant
expression): descriptors, `variantByName` / `variantByTag`, `tag()` and a
params-free `from_array(bytes)` that reads the variant the constant tag
selects. Holders read such an enum field with `T.from_array(slice)`. */
fn emit_constant_tag_enum_methods(
    c: &str,
    tag_expression: &ExprKind,
    variants: &[crate::abi::resolved::ResolvedEnumVariant],
    out: &mut String,
) {
    let tag_expr = expr_to_ts_bigint_with_resolver(tag_expression, &mut |_: &[String]| None);
    writeln!(
        out,
        "  static readonly variantDescriptors = Object.freeze(["
    )
    .unwrap();
    for variant in variants {
        let size = match variant.variant_type.size {
            Size::Const(n) => n.to_string(),
            Size::Variable(_) => "null".to_string(),
        };
        writeln!(
            out,
            "    {{ name: \"{}\", tag: {}, payloadSize: {size}, payloadType: \"{}\", createPayloadBuilder: () => null }},",
            variant.name,
            super::helpers::ts_tag_literal(variant.tag_value),
            variant.variant_type.name.replace('\"', "\\\"")
        )
        .unwrap();
    }
    writeln!(out, "  ] as const);\n").unwrap();
    writeln!(
        out,
        "  static variantByName(name: string): __TnVariantDescriptor | null {{\n    return this.variantDescriptors.find((d) => d.name === name) ?? null;\n  }}\n"
    )
    .unwrap();
    writeln!(
        out,
        "  static variantByTag(tag: number | bigint): __TnVariantDescriptor | null {{\n    return this.variantDescriptors.find((d) => __tnToBigInt(d.tag) === __tnToBigInt(tag)) ?? null;\n  }}\n"
    )
    .unwrap();
    writeln!(
        out,
        "  /** The active variant's tag (a bigint past 2^53 - 1). */\n  tag(): number | bigint {{\n    if (!this.descriptor) throw new Error(\"{c}: no active variant\");\n    return this.descriptor.tag;\n  }}\n"
    )
    .unwrap();
    writeln!(
        out,
        "  /** Reads the enum at the start of `buffer`; its tag is a constant. */"
    )
    .unwrap();
    writeln!(
        out,
        "  static from_array(buffer: Uint8Array, _opts?: {{ params?: never }}): {c} | null {{"
    )
    .unwrap();
    writeln!(out, "    const validation = this.validate(buffer);").unwrap();
    writeln!(
        out,
        "    if (!validation.ok || validation.consumed === undefined) return null;"
    )
    .unwrap();
    match &tag_expr {
        Some(expr) => writeln!(
            out,
            "    const tag: bigint | null = {expr};\n    const descriptor = tag === null ? null : this.variantByTag(tag);"
        )
        .unwrap(),
        None => writeln!(
            out,
            "    const descriptor: __TnVariantDescriptor | null = null;"
        )
        .unwrap(),
    }
    writeln!(out, "    if (!descriptor) return null;").unwrap();
    writeln!(
        out,
        "    return new {c}(buffer.subarray(0, validation.consumed), descriptor);\n  }}\n"
    )
    .unwrap();
}
