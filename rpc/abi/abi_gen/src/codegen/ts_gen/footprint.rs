use super::ir_helpers::{
    DerivedParamSpec, DynamicBinding, deduplicated_ts_parameter_bindings, derived_param_specs,
    extractor_emitted, sanitize_param_name, ts_name_dedup_map, ts_parameter_bindings,
};
use super::ir_serialization::ir_constant_name;
use super::measure::{checks_tags, measure_fn, measure_fn_with_context};
use crate::abi::resolved::{ResolvedType, ResolvedTypeKind, Size};
use crate::abi::types::PrimitiveType;
use crate::codegen::shared::ir::TypeIr;
use std::collections::BTreeMap;
use std::fmt::Write;

/* Emit the static footprint() method for a type.
Requires IR metadata - legacy fallback has been removed. */
pub fn emit_footprint_method(
    resolved_type: &ResolvedType,
    type_ir: Option<&TypeIr>,
    type_lookup: &BTreeMap<String, ResolvedType>,
) -> String {
    let ir = type_ir.unwrap_or_else(|| {
        panic!(
            "TypeScript codegen requires IR metadata for type '{}'. IR generation must have failed.",
            resolved_type.name
        )
    });
    let mut out = emit_ir_backed_footprint(resolved_type, ir);
    let mut validate = emit_validate_method(resolved_type, Some(ir));
    /* Sizes alone do not check enum tags inside fixed-size values (a union
    variant, a nested struct): walk the bytes as C and Rust do. */
    if checks_tags(resolved_type, type_lookup) {
        /* Never drop a required check: a type whose tags cannot be walked
        fails generation (the CLI reports it). */
        /* A value reading references from outside its bytes (a top-level
        enum's tag) walks with its params as context (`kind` for the packed
        `T.kind`). */
        let has_params = validate.contains("const __tnParamsRec = ");
        let (walk, call) = match measure_fn(resolved_type, type_lookup) {
            Some(walk) => (walk, "this.__tnWalkTags(buffer)".to_string()),
            None => {
                let walk = has_params
                    .then(|| measure_fn_with_context(resolved_type, type_lookup, "ctx"))
                    .flatten()
                    .unwrap_or_else(|| {
                        panic!(
                            "TypeScript codegen cannot walk '{}' to check its enum tags",
                            resolved_type.name
                        )
                    });
                (
                    walk,
                    format!(
                        "this.__tnWalkTags(buffer, __tnParamsContext(__tnParamsRec, \"{}.\"))",
                        resolved_type.name
                    ),
                )
            }
        };
        validate = validate.replace(
            "    return { ok: true",
            &format!(
                "    if ({call} === null) return {{ ok: false, code: \"tn.invalid_tag\" }};\n    return {{ ok: true"
            ),
        );
        writeln!(
            validate,
            "  /** Walks the value's bytes, checking every enum tag; its size, or null. */\n  private static __tnWalkTags(buffer: Uint8Array, ctx: Record<string, number | bigint> = {{}}): number | null {{\n    void ctx;\n    return {walk}(buffer);\n  }}\n"
        )
        .unwrap();
    }
    out.push_str(&validate);
    out
}

fn emit_ir_backed_footprint(resolved_type: &ResolvedType, type_ir: &TypeIr) -> String {
    let mut output = String::new();
    let param_names = ir_parameter_names(type_ir);
    let derived_specs = derived_param_specs(resolved_type, type_ir);
    output.push_str(&emit_ir_footprint(resolved_type, type_ir, &derived_specs));
    if param_names.is_empty() {
        output.push_str(&emit_ir_wrapper_footprint(resolved_type, &param_names));
    } else {
        output.push_str(&emit_ir_wrapper_from_params(
            resolved_type,
            type_ir,
            &param_names,
            &derived_specs,
        ));
    }
    output
}

fn emit_ir_footprint(
    resolved_type: &ResolvedType,
    type_ir: &TypeIr,
    derived_specs: &[DerivedParamSpec],
) -> String {
    let mut output = String::new();
    /* All bindings are needed for IR packing (all canonical names must be in the record) */
    let bindings: Vec<_> = ts_parameter_bindings(type_ir).into_iter().collect();
    /* Deduplicated bindings are used for public API (function signatures, Params type) */
    let dedup_bindings: Vec<_> = deduplicated_ts_parameter_bindings(type_ir)
        .into_iter()
        .filter(|b| !b.derived)
        .collect();
    /* Map from ts_name to deduplicated ts_name for __tnPackParams */
    let dedup_map = ts_name_dedup_map(type_ir);
    let const_name = ir_constant_name(resolved_type);

    writeln!(
        &mut output,
        "  private static __tnFootprintInternal(__tnParams: Record<string, bigint>): bigint {{"
    )
    .unwrap();
    writeln!(
        &mut output,
        "    return __tnEvalFootprint({}.root, {{ params: __tnParams }});",
        const_name
    )
    .unwrap();
    writeln!(&mut output, "  }}\n").unwrap();

    writeln!(
        &mut output,
        "  private static __tnValidateInternal(buffer: Uint8Array, __tnParams: Record<string, bigint>): {{ ok: boolean; code?: string; consumed?: bigint }} {{"
    )
    .unwrap();
    writeln!(
        &mut output,
        "    return __tnValidateIrTree({}, buffer, __tnParams);",
        const_name
    )
    .unwrap();
    writeln!(&mut output, "  }}\n").unwrap();

    writeln!(
        &mut output,
        "  static __tnInvokeFootprint(__tnParams: Record<string, bigint>): bigint {{"
    )
    .unwrap();
    writeln!(
        &mut output,
        "    return this.__tnFootprintInternal(__tnParams);"
    )
    .unwrap();
    writeln!(&mut output, "  }}\n").unwrap();

    writeln!(
        &mut output,
        "  static __tnInvokeValidate(buffer: Uint8Array, __tnParams: Record<string, bigint>): __TnValidateResult {{"
    )
    .unwrap();
    writeln!(
        &mut output,
        "    return this.__tnValidateInternal(buffer, __tnParams);"
    )
    .unwrap();
    writeln!(&mut output, "  }}\n").unwrap();

    if bindings.is_empty() {
        writeln!(&mut output, "  static footprintIr(): bigint {{").unwrap();
        writeln!(
            &mut output,
            "    return this.__tnFootprintInternal(Object.create(null));"
        )
        .unwrap();
        writeln!(&mut output, "  }}\n").unwrap();
        return output;
    }

    /* Use deduplicated bindings for public API */
    let params_sig = dedup_bindings
        .iter()
        .map(|binding| format!("{}: number | bigint", binding.ts_name))
        .collect::<Vec<_>>()
        .join(", ");
    let params_ns = format!("{}.Params", resolved_type.name);
    writeln!(
        &mut output,
        "  static footprintIr({}): bigint {{",
        params_sig
    )
    .unwrap();
    writeln!(
        &mut output,
        "    const params = {}.Params.fromValues({{",
        resolved_type.name
    )
    .unwrap();
    for binding in &dedup_bindings {
        writeln!(
            &mut output,
            "      {}: {},",
            binding.ts_name, binding.ts_name
        )
        .unwrap();
    }
    writeln!(&mut output, "    }});").unwrap();
    writeln!(
        &mut output,
        "    return this.footprintIrFromParams(params);"
    )
    .unwrap();
    writeln!(&mut output, "  }}\n").unwrap();

    writeln!(
        &mut output,
        "  private static __tnPackParams(params: {}): Record<string, bigint> {{",
        params_ns
    )
    .unwrap();
    writeln!(
        &mut output,
        "    const record: Record<string, bigint> = Object.create(null);"
    )
    .unwrap();
    /* Use all bindings for record keys (IR needs all canonical names),
    but map ts_names to deduplicated equivalents for params access */
    for binding in bindings.iter().filter(|binding| !binding.derived) {
        let params_field = dedup_map
            .get(&binding.ts_name)
            .map(|s| s.as_str())
            .unwrap_or(&binding.ts_name);
        writeln!(
            &mut output,
            "    record[\"{}\"] = params.{};",
            binding.canonical.replace('\"', "\\\""),
            params_field
        )
        .unwrap();
    }
    for spec in derived_specs {
        writeln!(
            &mut output,
            "    record[\"{}\"] = (() => {{ return {}; }})();",
            spec.canonical.replace('\"', "\\\""),
            spec.expr
        )
        .unwrap();
    }
    writeln!(&mut output, "    return record;").unwrap();
    writeln!(&mut output, "  }}\n").unwrap();

    output
}

fn ir_parameter_names(type_ir: &TypeIr) -> Vec<String> {
    type_ir
        .parameters
        .iter()
        .filter(|param| !param.derived)
        .map(|param| sanitize_param_name(&param.name))
        .collect()
}

fn emit_ir_wrapper_footprint(resolved_type: &ResolvedType, params: &[String]) -> String {
    let mut output = String::new();
    let signature_params: Vec<String> = params
        .iter()
        .map(|name| format!("{name}: number | bigint"))
        .collect();
    let ir_args: Vec<String> = params
        .iter()
        .map(|name| format!("__tnToBigInt({name})"))
        .collect();

    if signature_params.is_empty() {
        writeln!(&mut output, "  static footprint(): number {{").unwrap();
    } else {
        writeln!(
            &mut output,
            "  static footprint({}): number {{",
            signature_params.join(", ")
        )
        .unwrap();
    }

    let ir_call = if ir_args.is_empty() {
        "this.footprintIr()".to_string()
    } else {
        format!("this.footprintIr({})", ir_args.join(", "))
    };
    writeln!(&mut output, "    const irResult = {ir_call};").unwrap();
    writeln!(
        &mut output,
        "      const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);"
    )
    .unwrap();
    writeln!(
        &mut output,
        "    if (__tnBigIntGreaterThan(irResult, maxSafe)) {{"
    )
    .unwrap();
    writeln!(
        &mut output,
        "      throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for {}');",
        resolved_type.name
    )
    .unwrap();
    writeln!(&mut output, "    }}").unwrap();
    writeln!(
        &mut output,
        "    return __tnBigIntToNumber(irResult, '{}::footprint');",
        resolved_type.name
    )
    .unwrap();
    writeln!(
        &mut output,
        "  }}
"
    )
    .unwrap();
    output
}

fn emit_validate_method(resolved_type: &ResolvedType, type_ir: Option<&TypeIr>) -> String {
    match type_ir {
        Some(ir) if ir.parameters.iter().any(|param| !param.derived) => {
            /* A top-level enum's tag lives outside its bytes: no extractor. */
            let extractor_available = !matches!(resolved_type.kind, ResolvedTypeKind::Enum { .. })
                && extractor_emitted(resolved_type, ir);
            emit_validate_with_params(resolved_type, ir, extractor_available)
        }
        Some(_) if matches!(resolved_type.size, Size::Variable(_)) => {
            emit_validate_ir_without_params(resolved_type)
        }
        _ => emit_validate_const(resolved_type),
    }
}

fn emit_validate_ir_without_params(resolved_type: &ResolvedType) -> String {
    let mut output = String::new();
    writeln!(
        &mut output,
        "  static validate(buffer: Uint8Array, _opts?: {{ params?: never }}): {{ ok: boolean; code?: string; consumed?: number }} {{"
    )
    .unwrap();
    writeln!(
        &mut output,
        "    if (!buffer || buffer.length === undefined) return {{ ok: false, code: \"tn.invalid_buffer\" }};"
    )
    .unwrap();
    writeln!(
        &mut output,
        "    const irResult = this.__tnValidateInternal(buffer, Object.create(null));"
    )
    .unwrap();
    writeln!(&mut output, "    if (!irResult.ok) {{").unwrap();
    writeln!(
        &mut output,
        "      return {{ ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, '{}::validate') : undefined }};",
        resolved_type.name
    )
    .unwrap();
    writeln!(&mut output, "    }}").unwrap();
    writeln!(
        &mut output,
        "    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, '{}::validate') : undefined;",
        resolved_type.name
    )
    .unwrap();
    writeln!(&mut output, "    return {{ ok: true, consumed }};").unwrap();
    writeln!(
        &mut output,
        "  }}
"
    )
    .unwrap();
    output
}

fn emit_validate_with_params(
    resolved_type: &ResolvedType,
    _type_ir: &TypeIr,
    extractor_available: bool,
) -> String {
    let class_name = &resolved_type.name;
    let params_ns = format!("{}.Params", class_name);
    let mut output = String::new();

    writeln!(
        &mut output,
        "  static validate(buffer: Uint8Array, opts?: {{ params?: {} }}): {{ ok: boolean; code?: string; consumed?: number; params?: {} }} {{",
        params_ns, params_ns
    )
    .unwrap();
    writeln!(
        &mut output,
        "    if (!buffer || buffer.length === undefined) {{"
    )
    .unwrap();
    writeln!(
        &mut output,
        "      return {{ ok: false, code: \"tn.invalid_buffer\" }};"
    )
    .unwrap();
    writeln!(&mut output, "    }}").unwrap();
    writeln!(
        &mut output,
        "    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);"
    )
    .unwrap();
    writeln!(&mut output, "    let params = opts?.params ?? null;").unwrap();
    if extractor_available {
        writeln!(&mut output, "    if (!params) {{").unwrap();
        writeln!(
            &mut output,
            "      const extracted = this.__tnExtractParams(view, buffer);"
        )
        .unwrap();
        writeln!(
            &mut output,
            "      if (!extracted) return {{ ok: false, code: \"tn.param_extraction_failed\" }};"
        )
        .unwrap();
        writeln!(&mut output, "      params = extracted.params;").unwrap();
        if _type_ir
            .parameters
            .iter()
            .any(|param| !param.derived && param.name.ends_with(".payload_size"))
        {
            /* A field sized by `<field>.payload_size` is measured from its
            bytes only by the extractor: with supplied params, still measure
            it, and refuse params that do not describe these bytes. */
            writeln!(&mut output, "    }} else {{").unwrap();
            writeln!(
                &mut output,
                "      const extracted = this.__tnExtractParams(view, buffer);"
            )
            .unwrap();
            writeln!(
                &mut output,
                "      if (!extracted) return {{ ok: false, code: \"tn.param_extraction_failed\" }};"
            )
            .unwrap();
            writeln!(
                &mut output,
                "      const supplied = params as unknown as Record<string, bigint>;"
            )
            .unwrap();
            writeln!(
                &mut output,
                "      for (const [key, value] of Object.entries(extracted.params as unknown as Record<string, bigint>)) {{"
            )
            .unwrap();
            writeln!(
                &mut output,
                "        if (supplied[key] === undefined || __tnToBigInt(supplied[key]) !== __tnToBigInt(value)) return {{ ok: false, code: \"tn.param_mismatch\" }};"
            )
            .unwrap();
            writeln!(&mut output, "      }}").unwrap();
        }
        writeln!(&mut output, "    }}").unwrap();
    } else {
        writeln!(&mut output, "    if (!params) {{").unwrap();
        writeln!(
            &mut output,
            "      return {{ ok: false, code: \"tn.param_extraction_failed\" }};"
        )
        .unwrap();
        writeln!(&mut output, "    }}").unwrap();
    }
    writeln!(
        &mut output,
        "    const __tnParamsRec = this.__tnPackParams(params);"
    )
    .unwrap();
    writeln!(
        &mut output,
        "    const irResult = this.__tnValidateInternal(buffer, __tnParamsRec);"
    )
    .unwrap();
    writeln!(&mut output, "    if (!irResult.ok) {{").unwrap();
    writeln!(
        &mut output,
        "      return {{ ok: false, code: irResult.code, consumed: irResult.consumed ? __tnBigIntToNumber(irResult.consumed, '{}::validate') : undefined, params }};",
        resolved_type.name
    )
    .unwrap();
    writeln!(&mut output, "    }}").unwrap();
    writeln!(
        &mut output,
        "    const consumed = irResult.consumed ? __tnBigIntToNumber(irResult.consumed, '{}::validate') : undefined;",
        resolved_type.name
    )
    .unwrap();
    writeln!(&mut output, "    return {{ ok: true, consumed, params }};").unwrap();
    writeln!(&mut output, "  }}\n").unwrap();

    output
}

fn emit_validate_const(resolved_type: &ResolvedType) -> String {
    let mut output = String::new();
    match &resolved_type.size {
        Size::Const(sz) => {
            writeln!(
                &mut output,
                "  static validate(buffer: Uint8Array, _opts?: {{ params?: never }}): {{ ok: boolean; code?: string; consumed?: number }} {{"
            )
            .unwrap();
            writeln!(
                &mut output,
                "    if (buffer.length < {}) return {{ ok: false, code: \"tn.buffer_too_small\", consumed: {} }};",
                sz, sz
            )
            .unwrap();
            writeln!(&mut output, "    return {{ ok: true, consumed: {} }};", sz).unwrap();
            writeln!(&mut output, "  }}\n").unwrap();
        }
        _ => {
            writeln!(
                &mut output,
                "  static validate(_buffer: Uint8Array, _opts?: {{ params?: never }}): {{ ok: boolean; code?: string; consumed?: number }} {{"
            )
            .unwrap();
            writeln!(
                &mut output,
                "    __tnLogWarn(\"{}::validate falling back to basic length check\");",
                resolved_type.name
            )
            .unwrap();
            writeln!(
                &mut output,
                "    return {{ ok: true, consumed: _buffer.length }};"
            )
            .unwrap();
            writeln!(&mut output, "  }}\n").unwrap();
        }
    }
    output
}
fn emit_ir_wrapper_from_params(
    resolved_type: &ResolvedType,
    type_ir: &TypeIr,
    _legacy_params: &[String],
    _derived_specs: &[DerivedParamSpec],
) -> String {
    /* Use deduplicated bindings for public API */
    let public_bindings: Vec<_> = deduplicated_ts_parameter_bindings(type_ir)
        .into_iter()
        .filter(|binding| !binding.derived)
        .collect();
    if public_bindings.is_empty() {
        return String::new();
    }

    let mut output = String::new();
    let params_ns = format!("{}.Params", resolved_type.name);

    writeln!(
        &mut output,
        "  static footprintIrFromParams(params: {}): bigint {{",
        params_ns
    )
    .unwrap();
    writeln!(
        &mut output,
        "    const __tnParams = this.__tnPackParams(params);"
    )
    .unwrap();
    writeln!(
        &mut output,
        "    return this.__tnFootprintInternal(__tnParams);"
    )
    .unwrap();
    writeln!(&mut output, "  }}\n").unwrap();

    writeln!(
        &mut output,
        "  static footprintFromParams(params: {}): number {{",
        params_ns
    )
    .unwrap();
    writeln!(
        &mut output,
        "    const irResult = this.footprintIrFromParams(params);"
    )
    .unwrap();
    writeln!(
        &mut output,
        "    const maxSafe = __tnToBigInt(Number.MAX_SAFE_INTEGER);"
    )
    .unwrap();
    writeln!(
        &mut output,
        "    if (__tnBigIntGreaterThan(irResult, maxSafe)) throw new Error('footprint exceeds Number.MAX_SAFE_INTEGER for {}');",
        resolved_type.name
    )
    .unwrap();
    writeln!(
        &mut output,
        "    return __tnBigIntToNumber(irResult, '{}::footprintFromParams');",
        resolved_type.name
    )
    .unwrap();
    writeln!(&mut output, "  }}\n").unwrap();

    writeln!(
        &mut output,
        "  static footprintFromValues(input: {{ {} }}): number {{",
        public_bindings
            .iter()
            .map(|b| format!("{}: number | bigint", b.ts_name))
            .collect::<Vec<_>>()
            .join(", ")
    )
    .unwrap();
    writeln!(
        &mut output,
        "    const params = {}.params(input);",
        resolved_type.name
    )
    .unwrap();
    writeln!(&mut output, "    return this.footprintFromParams(params);").unwrap();
    writeln!(&mut output, "  }}\n").unwrap();

    writeln!(
        &mut output,
        "  static footprint(params: {}): number {{",
        params_ns
    )
    .unwrap();
    writeln!(&mut output, "    return this.footprintFromParams(params);").unwrap();
    writeln!(&mut output, "  }}\n").unwrap();

    output
}
