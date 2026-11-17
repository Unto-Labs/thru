use crate::abi::expr::ExprKind;
use crate::abi::resolved::{ResolvedField, ResolvedType, ResolvedTypeKind, Size};
use crate::abi::types::{IntegralType, PrimitiveType};
use crate::codegen::shared::builder::is_self_sized;
use crate::codegen::shared::ir::TypeIr;
use crate::codegen::ts_gen::enum_utils::{enum_field_info_by_name, enum_field_infos};
use crate::codegen::ts_gen::helpers::{
    collect_field_ref_paths, collect_field_value_refs, escape_ts_keyword,
    expr_to_ts_bigint_with_resolver, expr_to_ts_with_resolver, generated_type_ident,
    needs_endianness_arg, primitive_size, primitive_to_dataview_getter,
    primitive_to_ts_return_type, sequential_size_expression, struct_field_const_offset,
};
use crate::codegen::ts_gen::ir_helpers::{
    TsParamBinding, collect_dynamic_param_bindings, deduplicated_ts_parameter_bindings,
    normalize_binding_path, referenced_field_prim_type, resolve_param_binding, sanitize_param_name,
};
use crate::codegen::ts_gen::measure::{measure_fn, measure_fn_scoped, measure_values_fn};
use std::collections::{BTreeMap, HashSet};
use std::fmt::Write;

#[derive(Clone)]
pub(crate) struct DirectBinding {
    pub value_ident: String,
    pub getter: String,
    pub offset: u64,
    pub needs_le: bool,
    pub range_check: u64,
}

#[derive(Clone)]
pub(crate) enum SequentialBindingKind {
    Primitive {
        field_index: usize,
    },
    TypeRefDynamicParam {
        field_index: usize,
        target_name: String,
        nested_ts_name: String,
    },
    SizeDiscriminatedUnion {
        field_index: usize,
        expected_sizes: Vec<u64>,
    },
    EnumTail {
        field_index: usize,
    },
    /* `<field>.payload_size`: the byte size of a field whose own bytes decide it. */
    PayloadSize {
        field_index: usize,
    },
    /* A primitive at `key` inside struct field `field_index`, after
    variable-size data there. */
    NestedValue {
        field_index: usize,
        key: String,
    },
}

#[derive(Clone)]
pub(crate) struct SequentialBinding {
    pub ts_name: String,
    pub value_ident: String,
    pub kind: SequentialBindingKind,
}

#[derive(Clone)]
pub(crate) struct DerivedBinding {
    pub ts_name: String,
    pub field_index: usize,
    pub expr: ExprKind,
}

#[derive(Clone)]
struct FieldRefPlan {
    var_ident: String,
    path: String,
    offset: u64,
    size: u64,
    getter: String,
    needs_le: bool,
    returns_bigint: bool,
}

#[derive(Clone)]
enum ParamValueSource {
    Direct,
    Sequential,
}

#[derive(Clone)]
pub(crate) struct ParamValue {
    pub ts_name: String,
    pub value_ident: String,
    source: ParamValueSource,
    pub path: Option<String>,
}

#[derive(Clone)]
pub(crate) struct ParamExtractorPlan {
    pub direct_bindings: Vec<DirectBinding>,
    pub sequential_bindings: Vec<SequentialBinding>,
    pub derived_bindings: Vec<DerivedBinding>,
    pub value_vars: Vec<ParamValue>,
}

pub(crate) fn emit_sequential_layout_helper(
    class_name: &str,
    resolved_type: &ResolvedType,
    param_plan: Option<&ParamExtractorPlan>,
    dynamic_fields: &[String],
    type_lookup: &BTreeMap<String, ResolvedType>,
) -> Option<String> {
    let needs_offsets = !dynamic_fields.is_empty();
    let sequential_bindings = param_plan
        .map(|plan| plan.sequential_bindings.as_slice())
        .unwrap_or(&[]);
    let derived_bindings = param_plan
        .map(|plan| plan.derived_bindings.as_slice())
        .unwrap_or(&[]);
    let needs_params = !sequential_bindings.is_empty();
    let needs_derived = !derived_bindings.is_empty();
    if !needs_offsets && !needs_params && !needs_derived {
        return None;
    }

    let mut out = String::new();
    writeln!(
        out,
        "  static __tnComputeSequentialLayout(view: DataView, buffer: Uint8Array): {{ params: Record<string, bigint> | null; offsets: Record<string, number> | null; derived: Record<string, bigint> | null }} | null {{"
    )
    .unwrap();
    if needs_offsets {
        writeln!(
            out,
            "    const offsets: Record<string, number> = Object.create(null);"
        )
        .unwrap();
    }
    if needs_derived {
        writeln!(
            out,
            "    const derived: Record<string, bigint> = Object.create(null);"
        )
        .unwrap();
    }
    let offset_set = if needs_offsets {
        let mut set = HashSet::new();
        for name in dynamic_fields {
            set.insert(name.clone());
        }
        Some(set)
    } else {
        None
    };
    let mut scan_body = String::new();
    let mut field_ref_plans = BTreeMap::new();
    emit_sequential_scan(
        &mut scan_body,
        resolved_type,
        sequential_bindings,
        derived_bindings,
        offset_set.as_ref(),
        needs_offsets,
        class_name,
        type_lookup,
        &mut field_ref_plans,
    );
    out.push_str(&scan_body);
    if needs_params {
        writeln!(
            out,
            "    const params: Record<string, bigint> = Object.create(null);"
        )
        .unwrap();
        for binding in sequential_bindings {
            writeln!(
                out,
                "    if ({} === null) return null;",
                binding.value_ident
            )
            .unwrap();
            writeln!(
                out,
                "    params[\"{}\"] = {} as bigint;",
                binding.ts_name, binding.value_ident
            )
            .unwrap();
        }
        writeln!(
            out,
            "    return {{ params, offsets: {}, derived: {} }};",
            if needs_offsets { "offsets" } else { "null" },
            if needs_derived { "derived" } else { "null" }
        )
        .unwrap();
    } else {
        writeln!(
            out,
            "    return {{ params: null, offsets: {}, derived: {} }};",
            if needs_offsets { "offsets" } else { "null" },
            if needs_derived { "derived" } else { "null" }
        )
        .unwrap();
    }
    writeln!(out, "  }}\n").unwrap();
    Some(out)
}

pub(crate) fn build_param_extractor_plan(
    resolved_type: &ResolvedType,
    type_ir: &TypeIr,
    type_lookup: &BTreeMap<String, ResolvedType>,
) -> Option<ParamExtractorPlan> {
    /* Use deduplicated bindings - the extractor outputs values for Params.fromValues()
    which expects deduplicated field names */
    let bindings = deduplicated_ts_parameter_bindings(type_ir);
    let has_public_bindings = bindings.iter().any(|binding| !binding.derived);
    let derived_bindings = collect_derived_bindings(resolved_type, &bindings);

    if !has_public_bindings && derived_bindings.is_empty() {
        return None;
    }
    if !matches!(resolved_type.kind, ResolvedTypeKind::Struct { .. }) {
        return None;
    }

    let binding_table = collect_dynamic_param_bindings(resolved_type);
    let available: Vec<String> = binding_table.keys().cloned().collect();

    let mut value_vars = Vec::new();
    let mut direct_bindings = Vec::new();
    let mut sequential_bindings = Vec::new();

    for binding in bindings.iter().filter(|binding| !binding.derived) {
        /* Skip bindings for jagged array element fields - they're not in the binding table
        because they require sequential access and can't have direct offsets */
        if binding.canonical.contains(".element.") {
            continue;
        }

        /* The buffer the value spans: its whole length. */
        if binding.canonical == "__buffer_size" {
            let value_ident = format!("__tnParam_{}", binding.ts_name);
            direct_bindings.push(DirectBinding {
                value_ident: value_ident.clone(),
                getter: String::new(),
                offset: 0,
                needs_le: false,
                range_check: 0,
            });
            value_vars.push(ParamValue {
                ts_name: binding.ts_name.clone(),
                value_ident,
                source: ParamValueSource::Direct,
                path: None,
            });
            continue;
        }

        /* `<field>.payload_size` of a field sized by its own bytes (see
        `IrBuilder::for_typescript`): measured while scanning. */
        if let Some(field_index) = payload_size_field(resolved_type, type_lookup, binding) {
            let seq_ident = format!("__tnParamSeq_{}", binding.ts_name);
            sequential_bindings.push(SequentialBinding {
                ts_name: binding.ts_name.clone(),
                value_ident: seq_ident.clone(),
                kind: SequentialBindingKind::PayloadSize { field_index },
            });
            value_vars.push(ParamValue {
                ts_name: binding.ts_name.clone(),
                value_ident: seq_ident,
                source: ParamValueSource::Sequential,
                path: None,
            });
            continue;
        }

        /* `<field>.<path>`: a named type's outside reference (a top-level
        enum's tag) bound to a field `<path>` of this struct. */
        if let Some(path) = context_arg_path(resolved_type, binding) {
            if let Some(offset) = resolve_primitive_offset(resolved_type, &path, type_lookup) {
                if let Some(prim) = referenced_field_prim_type(resolved_type, &path) {
                    let value_ident = format!("__tnParam_{}", binding.ts_name);
                    direct_bindings.push(DirectBinding {
                        value_ident: value_ident.clone(),
                        getter: primitive_to_dataview_getter(prim).to_string(),
                        offset,
                        needs_le: needs_endianness_arg(prim),
                        range_check: offset + primitive_size(prim),
                    });
                    value_vars.push(ParamValue {
                        ts_name: binding.ts_name.clone(),
                        value_ident,
                        source: ParamValueSource::Direct,
                        path: Some(path),
                    });
                    continue;
                }
            }
            if let Some(SequentialFieldTarget::Primitive { field_index }) =
                resolve_sequential_field(resolved_type, &path)
            {
                let seq_ident = format!("__tnParamSeq_{}", binding.ts_name);
                sequential_bindings.push(SequentialBinding {
                    ts_name: binding.ts_name.clone(),
                    value_ident: seq_ident.clone(),
                    kind: SequentialBindingKind::Primitive { field_index },
                });
                value_vars.push(ParamValue {
                    ts_name: binding.ts_name.clone(),
                    value_ident: seq_ident,
                    source: ParamValueSource::Sequential,
                    path: None,
                });
                continue;
            }
        }

        /* Try to resolve the binding. If it is not available in the root table, it may
        belong to a nested type-ref payload that must be extracted while scanning. */
        let matched_key = match resolve_param_binding(&binding.ts_name, &available) {
            Some(key) => key,
            None => {
                if let Some((field_index, target_name, nested_ts_name)) =
                    resolve_typeref_dynamic_param(resolved_type, type_lookup, binding)
                {
                    let seq_ident = format!("__tnParamSeq_{}", binding.ts_name);
                    sequential_bindings.push(SequentialBinding {
                        ts_name: binding.ts_name.clone(),
                        value_ident: seq_ident.clone(),
                        kind: SequentialBindingKind::TypeRefDynamicParam {
                            field_index,
                            target_name,
                            nested_ts_name,
                        },
                    });
                    value_vars.push(ParamValue {
                        ts_name: binding.ts_name.clone(),
                        value_ident: seq_ident,
                        source: ParamValueSource::Sequential,
                        path: None,
                    });
                    continue;
                }

                /* Parameters inside jagged array elements are derived by runtime element
                validation and are intentionally not part of the parent Params surface. */
                continue;
            }
        };
        let dyn_binding = binding_table.get(matched_key).unwrap_or_else(|| {
            panic!(
                "ts_gen: missing dynamic binding '{}' while emitting params for '{}'",
                matched_key, resolved_type.name
            )
        });
        let normalized_path = normalize_binding_path(&dyn_binding.path);
        if let Some(field_offset) =
            resolve_primitive_offset(resolved_type, &normalized_path, type_lookup)
        {
            let value_ident = format!("__tnParam_{}", binding.ts_name);
            let getter = primitive_to_dataview_getter(&dyn_binding.prim_type);
            let field_size = primitive_size(&dyn_binding.prim_type);
            let range_check = field_offset + field_size;
            direct_bindings.push(DirectBinding {
                value_ident: value_ident.clone(),
                getter: getter.to_string(),
                offset: field_offset,
                needs_le: needs_endianness_arg(&dyn_binding.prim_type),
                range_check,
            });
            value_vars.push(ParamValue {
                ts_name: binding.ts_name.clone(),
                value_ident,
                source: ParamValueSource::Direct,
                path: Some(dyn_binding.path.clone()),
            });
            continue;
        }

        if let Some(target) = resolve_sequential_field(resolved_type, &normalized_path) {
            let seq_ident = format!("__tnParamSeq_{}", binding.ts_name);
            let kind = match target {
                SequentialFieldTarget::Primitive { field_index } => {
                    SequentialBindingKind::Primitive { field_index }
                }
                SequentialFieldTarget::SizeDiscriminatedUnion {
                    field_index,
                    expected_sizes,
                } => SequentialBindingKind::SizeDiscriminatedUnion {
                    field_index,
                    expected_sizes,
                },
                SequentialFieldTarget::EnumTail { field_index } => {
                    SequentialBindingKind::EnumTail { field_index }
                }
            };
            sequential_bindings.push(SequentialBinding {
                ts_name: binding.ts_name.clone(),
                value_ident: seq_ident.clone(),
                kind,
            });
            value_vars.push(ParamValue {
                ts_name: binding.ts_name.clone(),
                value_ident: seq_ident.clone(),
                source: ParamValueSource::Sequential,
                path: None,
            });
            continue;
        }

        if let Some((field_index, key)) =
            resolve_nested_value(resolved_type, &normalized_path, type_lookup)
        {
            let seq_ident = format!("__tnParamSeq_{}", binding.ts_name);
            sequential_bindings.push(SequentialBinding {
                ts_name: binding.ts_name.clone(),
                value_ident: seq_ident.clone(),
                kind: SequentialBindingKind::NestedValue { field_index, key },
            });
            value_vars.push(ParamValue {
                ts_name: binding.ts_name.clone(),
                value_ident: seq_ident,
                source: ParamValueSource::Sequential,
                path: None,
            });
            continue;
        }

        panic!(
            "ts_gen: unable to derive offset for '{}' ({}) in type '{}'",
            normalized_path, binding.canonical, resolved_type.name
        );
    }

    Some(ParamExtractorPlan {
        direct_bindings,
        sequential_bindings,
        derived_bindings,
        value_vars,
    })
}

pub(crate) fn emit_param_extractor(
    resolved_type: &ResolvedType,
    _type_ir: &TypeIr,
    plan: &ParamExtractorPlan,
) -> String {
    if plan.direct_bindings.is_empty() && plan.sequential_bindings.is_empty() {
        return String::new();
    }

    let class_name = &resolved_type.name;
    let mut out = String::new();
    writeln!(
        out,
        "  private static __tnExtractParams(view: DataView, buffer: Uint8Array): {{ params: {}.Params; derived: Record<string, bigint> | null }} | null {{",
        class_name
    )
    .unwrap();

    for direct in &plan.direct_bindings {
        if direct.getter.is_empty() {
            writeln!(
                out,
                "    const {} = __tnToBigInt(buffer.length);",
                direct.value_ident
            )
            .unwrap();
            continue;
        }
        writeln!(out, "    if (buffer.length < {}) {{", direct.range_check).unwrap();
        writeln!(out, "      return null;").unwrap();
        writeln!(out, "    }}").unwrap();
        if direct.needs_le {
            writeln!(
                out,
                "    const {} = __tnToBigInt(view.{}({}, true));",
                direct.value_ident, direct.getter, direct.offset
            )
            .unwrap();
        } else {
            writeln!(
                out,
                "    const {} = __tnToBigInt(view.{}({}));",
                direct.value_ident, direct.getter, direct.offset
            )
            .unwrap();
        }
    }

    let needs_layout = !plan.sequential_bindings.is_empty() || !plan.derived_bindings.is_empty();
    let needs_sequential = !plan.sequential_bindings.is_empty();

    if needs_layout {
        writeln!(
            out,
            "    const __tnLayout = {}.__tnComputeSequentialLayout(view, buffer);",
            class_name
        )
        .unwrap();
        if needs_sequential {
            writeln!(
                out,
                "    if (!__tnLayout || !__tnLayout.params) return null;"
            )
            .unwrap();
            writeln!(out, "    const __tnSeqParams = __tnLayout.params;").unwrap();
            for binding in &plan.sequential_bindings {
                writeln!(
                    out,
                    "    const {ident} = __tnSeqParams[\"{name}\"];",
                    ident = binding.value_ident,
                    name = binding.ts_name
                )
                .unwrap();
                writeln!(
                    out,
                    "    if ({ident} === undefined) return null;",
                    ident = binding.value_ident
                )
                .unwrap();
            }
        } else {
            writeln!(out, "    if (!__tnLayout) return null;").unwrap();
        }
    }

    writeln!(
        out,
        "    const __tnExtractedParams = {}.Params.fromValues({{",
        class_name
    )
    .unwrap();
    for param in &plan.value_vars {
        let value_ident = match param.source {
            ParamValueSource::Direct => param.value_ident.clone(),
            ParamValueSource::Sequential => format!("{} as bigint", param.value_ident),
        };
        writeln!(out, "      {}: {},", param.ts_name, value_ident).unwrap();
    }
    writeln!(out, "    }});").unwrap();

    let derived_expr = if plan.derived_bindings.is_empty() {
        "null".to_string()
    } else {
        "(__tnLayout && __tnLayout.derived ? __tnLayout.derived : null)".to_string()
    };
    writeln!(
        out,
        "    return {{ params: __tnExtractedParams, derived: {} }};",
        derived_expr
    )
    .unwrap();
    writeln!(out, "  }}\n").unwrap();
    out
}

/* For `<field>.<path>` where `field` is a type-ref and `path` names another
field of the struct (see `IrBuilder::bind_context_args`), the path. */
fn context_arg_path(resolved_type: &ResolvedType, binding: &TsParamBinding) -> Option<String> {
    let ResolvedTypeKind::Struct { fields, .. } = &resolved_type.kind else {
        return None;
    };
    let (head, path) = binding.canonical.split_once('.')?;
    let field = fields.iter().find(|f| f.name == head)?;
    /* Also an array whose elements are enums tagged by this struct's field. */
    if !matches!(
        field.field_type.kind,
        ResolvedTypeKind::TypeRef { .. } | ResolvedTypeKind::Array { .. }
    ) {
        return None;
    }
    let first = path.split('.').next()?;
    fields
        .iter()
        .any(|f| f.name == first && f.name != head)
        .then(|| path.to_string())
}

/* The struct field whose `payload_size` parameter `binding` is, when the
scan measures that field (see `payload_field_kind`). */
fn payload_size_field(
    resolved_type: &ResolvedType,
    type_lookup: &BTreeMap<String, ResolvedType>,
    binding: &TsParamBinding,
) -> Option<usize> {
    let ResolvedTypeKind::Struct { fields, .. } = &resolved_type.kind else {
        return None;
    };
    let field_name = binding.canonical.strip_suffix(".payload_size")?;
    let (idx, field) = fields
        .iter()
        .enumerate()
        .find(|(_, f)| f.name == field_name)?;
    is_measured_payload_field(resolved_type, field, type_lookup).then_some(idx)
}

/* Fields whose `<field>.payload_size` the TypeScript IR carries
(`IrBuilder::for_typescript`) and the scan measures: unions with a
variable-size variant (inline or by type-ref), non-tail enums with a variant
sized by its own bytes, and jagged arrays. */
pub(crate) fn is_measured_payload_field(
    parent: &ResolvedType,
    field: &ResolvedField,
    type_lookup: &BTreeMap<String, ResolvedType>,
) -> bool {
    let ty = &field.field_type;
    let variable_union = |t: &ResolvedType| {
        matches!(t.kind, ResolvedTypeKind::Union { .. }) && matches!(t.size, Size::Variable(_))
    };
    match &ty.kind {
        ResolvedTypeKind::Union { .. } => variable_union(ty),
        ResolvedTypeKind::TypeRef { target_name, .. } => {
            type_lookup.get(target_name).map_or(false, variable_union)
        }
        ResolvedTypeKind::Enum { .. } => {
            let has_resolver_payload = parent
                .dynamic_params
                .get(&field.name)
                .map_or(false, |refs| {
                    refs.keys().any(|p| p.ends_with(".payload_size"))
                });
            !has_resolver_payload && is_self_sized(ty)
        }
        ResolvedTypeKind::Array {
            element_type,
            jagged,
            ..
        } => *jagged && matches!(element_type.size, Size::Variable(_)),
        ResolvedTypeKind::Struct { .. } => matches!(ty.size, Size::Variable(_)),
        _ => false,
    }
}

/* A primitive read through struct field `field` (inline or a named struct)
whose offset inside it is only known at run time: (field index, its path
inside the field). The scan reads it while measuring the field. */
fn resolve_nested_value(
    resolved_type: &ResolvedType,
    path: &str,
    type_lookup: &BTreeMap<String, ResolvedType>,
) -> Option<(usize, String)> {
    let ResolvedTypeKind::Struct { fields, .. } = &resolved_type.kind else {
        return None;
    };
    let (head, rest) = path.split_once('.')?;
    let (idx, field) = fields.iter().enumerate().find(|(_, f)| f.name == head)?;
    let is_struct = match &field.field_type.kind {
        ResolvedTypeKind::Struct { .. } => true,
        ResolvedTypeKind::TypeRef { target_name, .. } => type_lookup
            .get(target_name)
            .map_or(false, |t| matches!(t.kind, ResolvedTypeKind::Struct { .. })),
        _ => false,
    };
    (is_struct && !rest.is_empty()).then(|| (idx, rest.to_string()))
}

fn collect_derived_bindings(
    resolved_type: &ResolvedType,
    bindings: &[TsParamBinding],
) -> Vec<DerivedBinding> {
    let mut lookup = BTreeMap::new();
    for binding in bindings.iter().filter(|binding| binding.derived) {
        lookup.insert(binding.canonical.clone(), binding.ts_name.clone());
    }

    let ResolvedTypeKind::Struct { fields, .. } = &resolved_type.kind else {
        return Vec::new();
    };

    let mut derived = Vec::new();
    for (idx, field) in fields.iter().enumerate() {
        if let Some(info) = enum_field_info_by_name(resolved_type, &field.name) {
            if let (Some(param), Some(expr)) = (&info.tag_parameter, &info.tag_expression) {
                let ts_name = lookup
                    .get(param)
                    .cloned()
                    .unwrap_or_else(|| sanitize_param_name(param));
                derived.push(DerivedBinding {
                    ts_name,
                    field_index: idx,
                    expr: expr.clone(),
                });
            }
        }
    }

    derived
}

pub fn resolve_primitive_offset(
    resolved_type: &ResolvedType,
    path: &str,
    type_lookup: &BTreeMap<String, ResolvedType>,
) -> Option<u64> {
    let segments: Vec<&str> = path.split('.').filter(|seg| !seg.is_empty()).collect();
    if segments.is_empty() {
        return None;
    }
    for start in 0..segments.len() {
        if let Some(offset) = resolve_segments(resolved_type, 0, &segments[start..], type_lookup) {
            return Some(offset);
        }
    }
    None
}

fn resolve_segments<'a>(
    ty: &'a ResolvedType,
    base: u64,
    segments: &[&'a str],
    type_lookup: &BTreeMap<String, ResolvedType>,
) -> Option<u64> {
    if segments.is_empty() {
        return None;
    }

    match &ty.kind {
        ResolvedTypeKind::Struct { fields, .. } => {
            let current = segments[0];
            let field = fields.iter().find(|f| f.name == current)?;
            let rel = field
                .offset
                .or_else(|| struct_field_const_offset(ty, current))?;
            if segments.len() == 1 {
                matches!(field.field_type.kind, ResolvedTypeKind::Primitive { .. })
                    .then_some(base + rel)
            } else {
                resolve_segments(&field.field_type, base + rel, &segments[1..], type_lookup)
            }
        }
        ResolvedTypeKind::Enum { variants, .. } => {
            let current = segments[0];
            if current == "tag" {
                return Some(base);
            }
            let variant = variants.iter().find(|v| v.name == current)?;
            if segments.len() == 1 {
                None
            } else {
                resolve_segments(&variant.variant_type, base, &segments[1..], type_lookup)
            }
        }
        ResolvedTypeKind::Union { variants } => {
            let current = segments[0];
            let variant = variants.iter().find(|v| v.name == current)?;
            if segments.len() == 1 {
                None
            } else {
                resolve_segments(&variant.field_type, base, &segments[1..], type_lookup)
            }
        }
        ResolvedTypeKind::TypeRef { target_name, .. } => {
            let target = type_lookup.get(target_name)?;
            resolve_segments(target, base, segments, type_lookup)
        }
        _ => None,
    }
}

pub fn resolve_field_read(
    ty: &ResolvedType,
    base: u64,
    segments: &[&str],
    type_lookup: &BTreeMap<String, ResolvedType>,
) -> Option<(u64, PrimitiveType)> {
    if segments.is_empty() {
        return None;
    }
    match &ty.kind {
        ResolvedTypeKind::Struct { fields, .. } => {
            let field = fields.iter().find(|f| f.name == segments[0])?;
            let rel = field
                .offset
                .or_else(|| struct_field_const_offset(ty, &field.name))?;
            if segments.len() == 1 {
                if let ResolvedTypeKind::Primitive { prim_type } = &field.field_type.kind {
                    return Some((base + rel, prim_type.clone()));
                }
                return None;
            }
            resolve_field_read(&field.field_type, base + rel, &segments[1..], type_lookup)
        }
        ResolvedTypeKind::Array { element_type, .. } => {
            // Handle array element indexing: path segment should be a numeric index
            let index: u64 = segments[0].parse().ok()?;
            let Size::Const(elem_size) = element_type.size else {
                // Can only resolve constant-size elements
                return None;
            };
            let elem_offset = base + index * elem_size;
            if segments.len() == 1 {
                // Final segment - the element itself must be primitive
                if let ResolvedTypeKind::Primitive { prim_type } = &element_type.kind {
                    return Some((elem_offset, prim_type.clone()));
                }
                return None;
            }
            // Continue resolving into the element type
            resolve_field_read(element_type, elem_offset, &segments[1..], type_lookup)
        }
        ResolvedTypeKind::TypeRef { target_name, .. } => {
            let target = type_lookup.get(target_name)?;
            resolve_field_read(target, base, segments, type_lookup)
        }
        _ => None,
    }
}

fn getter_returns_bigint(prim_type: &PrimitiveType) -> bool {
    matches!(
        prim_type,
        PrimitiveType::Integral(IntegralType::U64 | IntegralType::I64)
    )
}

fn sanitize_field_ref_ident(path: &str) -> String {
    path.chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .collect()
}

fn ensure_field_ref_plan(
    plans: &mut BTreeMap<String, FieldRefPlan>,
    resolved_type: &ResolvedType,
    path: &[String],
    type_lookup: &BTreeMap<String, ResolvedType>,
) -> Option<String> {
    let key = path.join(".");
    if let Some(plan) = plans.get(&key) {
        return Some(plan.var_ident.clone());
    }
    let segments: Vec<&str> = path.iter().map(|s| s.as_str()).collect();
    let (offset, prim_type) = resolve_field_read(resolved_type, 0, &segments, type_lookup)?;
    let getter = primitive_to_dataview_getter(&prim_type).to_string();
    let needs_le = needs_endianness_arg(&prim_type);
    let size = primitive_size(&prim_type) as u64;
    let var_ident = format!("__tnRef_{}", sanitize_field_ref_ident(&key));
    plans.insert(
        key.clone(),
        FieldRefPlan {
            var_ident: var_ident.clone(),
            path: key,
            offset,
            size,
            getter,
            needs_le,
            returns_bigint: getter_returns_bigint(&prim_type),
        },
    );
    Some(var_ident)
}

fn emit_field_ref_prelude(
    _class_name: &str,
    plans: &BTreeMap<String, FieldRefPlan>,
    out: &mut String,
) {
    for plan in plans.values() {
        let limit = plan.offset + plan.size;
        writeln!(out, "    if (__tnLength < {}) return null;", limit).unwrap();
        // For bigint-returning getters (u64/i64), keep the value as bigint to preserve
        // precision for bitwise operations. JavaScript numbers lose precision beyond
        // 53 bits and bitwise ops on numbers are limited to 32 bits.
        let read_expr = if plan.needs_le {
            format!("view.{}({}, true)", plan.getter, plan.offset)
        } else {
            format!("view.{}({})", plan.getter, plan.offset)
        };
        writeln!(out, "    const {} = {};", plan.var_ident, read_expr).unwrap();
    }
}

fn struct_has_primitive_field(resolved_type: &ResolvedType, name: &str) -> bool {
    match &resolved_type.kind {
        ResolvedTypeKind::Struct { fields, .. } => fields.iter().any(|field| {
            field.name == name
                && matches!(field.field_type.kind, ResolvedTypeKind::Primitive { .. })
        }),
        _ => false,
    }
}

enum SequentialFieldTarget {
    Primitive {
        field_index: usize,
    },
    SizeDiscriminatedUnion {
        field_index: usize,
        expected_sizes: Vec<u64>,
    },
    EnumTail {
        field_index: usize,
    },
}

fn resolve_sequential_field(
    resolved_type: &ResolvedType,
    path: &str,
) -> Option<SequentialFieldTarget> {
    let segments: Vec<&str> = path.split('.').collect();
    if segments.is_empty() {
        return None;
    }
    let ResolvedTypeKind::Struct { fields, .. } = &resolved_type.kind else {
        return None;
    };
    let mut candidate = segments.last().copied()?;
    if candidate.is_empty() {
        return None;
    }
    if candidate == "payload_size" && segments.len() >= 2 {
        let field_name = segments[segments.len() - 2];
        if let Some((idx, field)) = fields
            .iter()
            .enumerate()
            .find(|(_, f)| f.name == field_name)
        {
            match &field.field_type.kind {
                ResolvedTypeKind::SizeDiscriminatedUnion { variants } => {
                    let expected_sizes = variants.iter().map(|v| v.expected_size).collect();
                    return Some(SequentialFieldTarget::SizeDiscriminatedUnion {
                        field_index: idx,
                        expected_sizes,
                    });
                }
                ResolvedTypeKind::Enum { .. } => {
                    if let Some(enum_info) = enum_field_info_by_name(resolved_type, field_name) {
                        if enum_info.is_tail {
                            return Some(SequentialFieldTarget::EnumTail { field_index: idx });
                        }
                    }
                }
                _ => {}
            }
        }
        return None;
    }
    if let Some((idx, _field)) = fields.iter().enumerate().find(|(_, f)| {
        f.name == candidate && matches!(f.field_type.kind, ResolvedTypeKind::Primitive { .. })
    }) {
        return Some(SequentialFieldTarget::Primitive { field_index: idx });
    }
    if segments.len() >= 2 {
        candidate = segments[segments.len() - 1];
        if let Some((idx, _field)) = fields.iter().enumerate().find(|(_, f)| {
            f.name == candidate && matches!(f.field_type.kind, ResolvedTypeKind::Primitive { .. })
        }) {
            return Some(SequentialFieldTarget::Primitive { field_index: idx });
        }
    }
    None
}

fn canonical_dynamic_param_name(owner: &str, path: &str) -> String {
    if path.is_empty() {
        owner.to_string()
    } else if path == owner {
        owner.to_string()
    } else if let Some(stripped) = path.strip_prefix(&(owner.to_owned() + ".")) {
        format!("{owner}.{stripped}")
    } else {
        format!("{owner}.{path}")
    }
}

fn resolve_typeref_dynamic_param(
    resolved_type: &ResolvedType,
    type_lookup: &BTreeMap<String, ResolvedType>,
    binding: &TsParamBinding,
) -> Option<(usize, String, String)> {
    let ResolvedTypeKind::Struct { fields, .. } = &resolved_type.kind else {
        return None;
    };

    for (field_index, field) in fields.iter().enumerate() {
        let ResolvedTypeKind::TypeRef { target_name, .. } = &field.field_type.kind else {
            continue;
        };
        let target = type_lookup.get(target_name).unwrap_or(&field.field_type);
        for (owner, refs) in &target.dynamic_params {
            for path in refs.keys() {
                let canonical = canonical_dynamic_param_name(owner, path);
                if canonical == binding.canonical {
                    return Some((
                        field_index,
                        target_name.clone(),
                        sanitize_param_name(&canonical),
                    ));
                }
            }
        }
    }

    None
}

fn emit_sequential_scan(
    out: &mut String,
    resolved_type: &ResolvedType,
    bindings: &[SequentialBinding],
    derived_bindings: &[DerivedBinding],
    record_offsets: Option<&HashSet<String>>,
    scan_full_struct: bool,
    class_name: &str,
    type_lookup: &BTreeMap<String, ResolvedType>,
    field_ref_plans: &mut BTreeMap<String, FieldRefPlan>,
) {
    if bindings.is_empty()
        && derived_bindings.is_empty()
        && record_offsets.map_or(true, |set| set.is_empty())
    {
        return;
    }
    let ResolvedTypeKind::Struct { fields, packed, .. } = &resolved_type.kind else {
        return;
    };
    let mut header = String::new();
    let mut body = String::new();
    writeln!(header, "    const __tnLength = buffer.length;").unwrap();
    for binding in bindings {
        writeln!(
            header,
            "    let {}: bigint | null = null;",
            binding.value_ident
        )
        .unwrap();
    }
    let mut cached_fields = Vec::new();
    for field in fields {
        if let ResolvedTypeKind::Primitive { prim_type } = &field.field_type.kind {
            cached_fields.push((
                field.name.clone(),
                escape_ts_keyword(&field.name),
                primitive_to_ts_return_type(prim_type),
            ));
        }
    }
    for (_, ident, ts_type) in &cached_fields {
        writeln!(
            header,
            "    let __tnFieldValue_{}: {} | null = null;",
            ident, ts_type
        )
        .unwrap();
    }
    writeln!(header, "    let __tnCursorMutable = 0;").unwrap();
    let max_field_index = bindings
        .iter()
        .filter_map(|binding| match &binding.kind {
            SequentialBindingKind::Primitive { field_index } => Some(*field_index),
            SequentialBindingKind::TypeRefDynamicParam { field_index, .. } => Some(*field_index),
            SequentialBindingKind::SizeDiscriminatedUnion { field_index, .. } => Some(*field_index),
            SequentialBindingKind::EnumTail { field_index } => Some(*field_index),
            SequentialBindingKind::PayloadSize { field_index } => Some(*field_index),
            SequentialBindingKind::NestedValue { field_index, .. } => Some(*field_index),
        })
        .max();
    let max_derived_index = derived_bindings
        .iter()
        .map(|binding| binding.field_index)
        .max();
    let limit = if scan_full_struct {
        fields.len()
    } else {
        max_field_index
            .into_iter()
            .chain(max_derived_index)
            .max()
            .map_or(0, |idx| idx + 1)
    };
    for (idx, field) in fields.iter().enumerate() {
        if idx >= limit {
            break;
        }
        emit_sequential_field(
            &mut body,
            field,
            *packed,
            idx,
            resolved_type,
            bindings,
            derived_bindings,
            record_offsets,
            type_lookup,
            field_ref_plans,
        );
    }
    emit_field_ref_prelude(class_name, field_ref_plans, &mut header);
    header.push_str(&body);
    out.push_str(&header);
}

/* Measure struct field `index` (inline or named) at the cursor, assigning its
`NestedValue` and `PayloadSize` bindings, and advance past it. Returns false
when the field cannot be measured. */
fn emit_measured_struct_field(
    out: &mut String,
    field: &ResolvedField,
    bindings: &[SequentialBinding],
    index: usize,
    type_lookup: &BTreeMap<String, ResolvedType>,
    outer: BTreeMap<String, String>,
) -> bool {
    let nested: Vec<(&SequentialBinding, &String)> = bindings
        .iter()
        .filter_map(|binding| match &binding.kind {
            SequentialBindingKind::NestedValue { field_index, key } if *field_index == index => {
                Some((binding, key))
            }
            _ => None,
        })
        .collect();
    let keys: Vec<String> = nested.iter().map(|(_, key)| (*key).clone()).collect();
    let Some(f) = measure_values_fn(&field.field_type, type_lookup, &keys, outer) else {
        return false;
    };
    let ident = format!("__tnNested_{}", escape_ts_keyword(&field.name));
    writeln!(
        out,
        "    const {ident} = {f}(buffer.subarray(__tnCursorMutable));"
    )
    .unwrap();
    writeln!(out, "    if ({ident} === null) return null;").unwrap();
    for (binding, key) in nested {
        writeln!(
            out,
            "    {} = {ident}.values[\"{}\"] ?? null;",
            binding.value_ident, key
        )
        .unwrap();
    }
    emit_payload_bindings(out, bindings, index, &format!("{ident}.size"));
    writeln!(out, "    __tnCursorMutable += {ident}.size;").unwrap();
    true
}

/* The struct's primitive fields as the scan caches them, for measuring
functions that reference them. */
fn root_value_scope(resolved_type: &ResolvedType) -> BTreeMap<String, String> {
    let ResolvedTypeKind::Struct { fields, .. } = &resolved_type.kind else {
        return BTreeMap::new();
    };
    let mut scope = BTreeMap::new();
    for field in fields {
        match &field.field_type.kind {
            /* Integers only: they are what size and tag expressions read. */
            ResolvedTypeKind::Primitive {
                prim_type: PrimitiveType::Integral(_),
            } => {
                scope.insert(
                    field.name.clone(),
                    format!(
                        "__tnU64(__tnToBigInt(__tnFieldValue_{} ?? 0))",
                        escape_ts_keyword(&field.name)
                    ),
                );
            }
            /* Integers of inline structs at constant offsets (`first.count`). */
            ResolvedTypeKind::Struct { .. } => {
                if let Some(base) = field.offset {
                    nested_value_scope(&field.field_type, &field.name, base, &mut scope);
                }
            }
            _ => {}
        }
    }
    scope
}

fn nested_value_scope(
    ty: &ResolvedType,
    prefix: &str,
    base: u64,
    scope: &mut BTreeMap<String, String>,
) {
    let ResolvedTypeKind::Struct { fields, .. } = &ty.kind else {
        return;
    };
    for field in fields {
        let Some(offset) = field.offset else {
            return;
        };
        let key = format!("{prefix}.{}", field.name);
        match &field.field_type.kind {
            ResolvedTypeKind::Primitive {
                prim_type: prim @ PrimitiveType::Integral(_),
            } => {
                let le = if needs_endianness_arg(prim) {
                    ", true"
                } else {
                    ""
                };
                scope.insert(
                    key,
                    format!(
                        "__tnU64(__tnToBigInt(view.{}({}{le})))",
                        primitive_to_dataview_getter(prim),
                        base + offset
                    ),
                );
            }
            ResolvedTypeKind::Struct { .. } => {
                nested_value_scope(&field.field_type, &key, base + offset, scope)
            }
            _ => {}
        }
    }
}

/* Tags are switched on as exact u64 bigints (`case 9007199254740993n`): a
JavaScript number rounds tags past 2^53. */

/* Assign every `PayloadSize` binding of field `index` from `size_expr`. */
fn emit_payload_bindings(
    out: &mut String,
    bindings: &[SequentialBinding],
    index: usize,
    size_expr: &str,
) {
    for binding in bindings.iter().filter(|binding| {
        matches!(
            &binding.kind,
            SequentialBindingKind::PayloadSize { field_index } if *field_index == index
        )
    }) {
        writeln!(
            out,
            "    {} = __tnToBigInt({});",
            binding.value_ident, size_expr
        )
        .unwrap();
    }
}

fn emit_sequential_field(
    out: &mut String,
    field: &ResolvedField,
    packed: bool,
    index: usize,
    resolved_type: &ResolvedType,
    bindings: &[SequentialBinding],
    derived_bindings: &[DerivedBinding],
    record_offsets: Option<&HashSet<String>>,
    type_lookup: &BTreeMap<String, ResolvedType>,
    field_ref_plans: &mut BTreeMap<String, FieldRefPlan>,
) {
    let field_ident = escape_ts_keyword(&field.name);
    let needs_offset = record_offsets
        .map(|set| set.contains(&field.name))
        .unwrap_or(false);
    match &field.field_type.kind {
        ResolvedTypeKind::Primitive { prim_type } => {
            let size = match field.field_type.size {
                Size::Const(sz) => sz,
                _ => return,
            };
            if !packed {
                let align = field.field_type.alignment.max(1);
                if align > 1 {
                    writeln!(
                        out,
                        "    if ((__tnCursorMutable % {}) !== 0) {{ __tnCursorMutable += {} - (__tnCursorMutable % {}); }}",
                        align, align, align
                    )
                    .unwrap();
                }
            }
            if needs_offset {
                writeln!(out, "    offsets[\"{}\"] = __tnCursorMutable;", field.name).unwrap();
            }
            writeln!(
                out,
                "    if (__tnCursorMutable + {} > __tnLength) return null;",
                size
            )
            .unwrap();
            let getter = primitive_to_dataview_getter(prim_type);
            if needs_endianness_arg(prim_type) {
                writeln!(
                    out,
                    "    const __tnRead_{} = view.{}(__tnCursorMutable, true);",
                    field_ident, getter
                )
                .unwrap();
            } else {
                writeln!(
                    out,
                    "    const __tnRead_{} = view.{}(__tnCursorMutable);",
                    field_ident, getter
                )
                .unwrap();
            }
            writeln!(
                out,
                "    __tnFieldValue_{} = __tnRead_{};",
                field_ident, field_ident
            )
            .unwrap();
            for binding in bindings.iter().filter(|binding| matches!(&binding.kind, SequentialBindingKind::Primitive { field_index } if *field_index == index)) {
                writeln!(
                    out,
                    "    {} = __tnToBigInt(__tnRead_{});",
                    binding.value_ident, field_ident
                )
                .unwrap();
            }
            writeln!(out, "    __tnCursorMutable += {};", size).unwrap();
        }
        ResolvedTypeKind::Enum { .. } => {
            let Some(enum_info) = enum_field_info_by_name(resolved_type, &field.name) else {
                return;
            };
            let derived_binding = derived_bindings
                .iter()
                .find(|binding| binding.field_index == index);
            if let Some(tag_field) = enum_info.tag_field {
                let tag_ident = escape_ts_keyword(&tag_field.name);
                writeln!(
                    out,
                    "    const __tnEnumTagValue_{} = __tnFieldValue_{};",
                    field_ident, tag_ident
                )
                .unwrap();
                writeln!(
                    out,
                    "    if (__tnEnumTagValue_{} === null) return null;",
                    field_ident
                )
                .unwrap();
            } else if let Some(binding) = derived_binding {
                let mut top_level_refs = collect_field_value_refs(&binding.expr);
                top_level_refs.sort();
                top_level_refs.dedup();
                for reference in &top_level_refs {
                    if !struct_has_primitive_field(resolved_type, reference) {
                        continue;
                    }
                    let ident = escape_ts_keyword(reference);
                    writeln!(
                        out,
                        "    if (__tnFieldValue_{} === null) return null;",
                        ident
                    )
                    .unwrap();
                }
                let mut derived_ref_vars = BTreeMap::new();
                for path in collect_field_ref_paths(&binding.expr) {
                    if path.len() <= 1 {
                        continue;
                    }
                    if let Some(var) =
                        ensure_field_ref_plan(field_ref_plans, resolved_type, &path, type_lookup)
                    {
                        derived_ref_vars.insert(path.join("."), var);
                    } else {
                        writeln!(out, "    return null;").unwrap();
                        return;
                    }
                }
                /* Checked u64 arithmetic over bigints: an overflow (null) is
                rejected, as C and Rust reject it, and never allocates. */
                let mut resolver = |segments: &[String]| -> Option<String> {
                    if segments.is_empty() {
                        return None;
                    }
                    if segments.len() == 1 {
                        if !struct_has_primitive_field(resolved_type, &segments[0]) {
                            return None;
                        }
                        let ident = escape_ts_keyword(&segments[0]);
                        return Some(format!(
                            "__tnU64(__tnToBigInt(__tnFieldValue_{} as number | bigint))",
                            ident
                        ));
                    }
                    let key = segments.join(".");
                    derived_ref_vars
                        .get(&key)
                        .map(|var| format!("__tnU64(__tnToBigInt({var}))"))
                };
                let Some(expr_ts) = expr_to_ts_bigint_with_resolver(&binding.expr, &mut resolver)
                else {
                    writeln!(out, "    return null;").unwrap();
                    return;
                };
                writeln!(
                    out,
                    "    const __tnEnumTagChecked_{} = {};",
                    field_ident, expr_ts
                )
                .unwrap();
                writeln!(
                    out,
                    "    if (__tnEnumTagChecked_{} === null) return null;",
                    field_ident
                )
                .unwrap();
                writeln!(
                    out,
                    "    const __tnEnumTagValue_{} = __tnEnumTagChecked_{};",
                    field_ident, field_ident
                )
                .unwrap();
            } else {
                writeln!(out, "    return null;").unwrap();
                return;
            }
            let all_const = enum_info
                .variants
                .iter()
                .all(|variant| matches!(variant.variant_type.size, Size::Const(_)));
            writeln!(out, "    let __tnEnumSize_{} = 0;", field_ident).unwrap();
            if all_const {
                writeln!(
                    out,
                    "    switch (__tnToBigInt(__tnEnumTagValue_{})) {{",
                    field_ident
                )
                .unwrap();
                for variant in enum_info.variants {
                    let Size::Const(sz) = variant.variant_type.size else {
                        continue;
                    };
                    writeln!(
                        out,
                        "      case {}n: __tnEnumSize_{} = {}; break;",
                        variant.tag_value, field_ident, sz
                    )
                    .unwrap();
                }
                writeln!(out, "      default: return null;").unwrap();
                writeln!(out, "    }}").unwrap();
            } else if !enum_info.is_tail {
                /* Measure the active variant at the payload offset. */
                let mut cases = String::new();
                for variant in enum_info.variants {
                    let size = match variant.variant_type.size {
                        Size::Const(sz) => sz.to_string(),
                        Size::Variable(_) => {
                            let Some(f) = measure_fn_scoped(
                                &variant.variant_type,
                                type_lookup,
                                root_value_scope(resolved_type),
                            ) else {
                                panic!(
                                    "TypeScript codegen cannot measure field '{}' of '{}'",
                                    field.name, resolved_type.name
                                );
                            };
                            format!("{f}(buffer.subarray(__tnCursorMutable))")
                        }
                    };
                    writeln!(
                        cases,
                        "      case {}n: {{ const size = {size}; if (size === null) return null; __tnEnumSize_{} = size; break; }}",
                        variant.tag_value, field_ident
                    )
                    .unwrap();
                }
                writeln!(
                    out,
                    "    switch (__tnToBigInt(__tnEnumTagValue_{})) {{",
                    field_ident
                )
                .unwrap();
                out.push_str(&cases);
                writeln!(out, "      default: return null;").unwrap();
                writeln!(out, "    }}").unwrap();
            } else {
                writeln!(
                    out,
                    "    switch (__tnToBigInt(__tnEnumTagValue_{})) {{",
                    field_ident
                )
                .unwrap();
                for variant in enum_info.variants {
                    writeln!(out, "      case {}n: break;", variant.tag_value).unwrap();
                }
                writeln!(out, "      default: return null;").unwrap();
                writeln!(out, "    }}").unwrap();
            }
            if !packed {
                let align = field.field_type.alignment.max(1);
                if align > 1 {
                    writeln!(
                        out,
                        "    if ((__tnCursorMutable % {}) !== 0) {{ __tnCursorMutable += {} - (__tnCursorMutable % {}); }}",
                        align, align, align
                    )
                    .unwrap();
                }
            }
            if needs_offset {
                writeln!(out, "    offsets[\"{}\"] = __tnCursorMutable;", field.name).unwrap();
            }
            if all_const || !enum_info.is_tail {
                writeln!(
                    out,
                    "    if (__tnCursorMutable + __tnEnumSize_{} > __tnLength) return null;",
                    field_ident
                )
                .unwrap();
                writeln!(
                    out,
                    "    __tnCursorMutable += __tnEnumSize_{};",
                    field_ident
                )
                .unwrap();
            } else {
                writeln!(out, "    if (__tnCursorMutable > __tnLength) return null;").unwrap();
                writeln!(
                    out,
                    "    __tnEnumSize_{} = __tnLength - __tnCursorMutable;",
                    field_ident
                )
                .unwrap();
                writeln!(out, "    __tnCursorMutable = __tnLength;").unwrap();
            }
            if let Some(binding) = derived_binding {
                writeln!(
                    out,
                    "    derived[\"{}\"] = __tnToBigInt(__tnEnumTagValue_{});",
                    binding.ts_name, field_ident
                )
                .unwrap();
            }
            for binding in bindings.iter().filter(|binding| {
                matches!(
                    &binding.kind,
                    SequentialBindingKind::EnumTail { field_index } if *field_index == index
                )
            }) {
                writeln!(
                    out,
                    "    {} = __tnToBigInt(__tnEnumSize_{});",
                    binding.value_ident, field_ident
                )
                .unwrap();
            }
            emit_payload_bindings(
                out,
                bindings,
                index,
                &format!("__tnEnumSize_{}", field_ident),
            );
        }
        ResolvedTypeKind::Array {
            element_type,
            size_expression,
            ..
        } => match field.field_type.size {
            Size::Const(sz) => {
                if !packed {
                    let align = field.field_type.alignment.max(1);
                    if align > 1 {
                        writeln!(
                                out,
                                "    if ((__tnCursorMutable % {}) !== 0) {{ __tnCursorMutable += {} - (__tnCursorMutable % {}); }}",
                                align, align, align
                            )
                            .unwrap();
                    }
                }
                if needs_offset {
                    writeln!(out, "    offsets[\"{}\"] = __tnCursorMutable;", field.name).unwrap();
                }
                writeln!(
                    out,
                    "    if (__tnCursorMutable + {} > __tnLength) return null;",
                    sz
                )
                .unwrap();
                writeln!(out, "    __tnCursorMutable += {};", sz).unwrap();
            }
            Size::Variable(_) => {
                /* Variable-size elements (jagged arrays) are measured one by one. */
                let element_measure = match element_type.size {
                    Size::Const(_) => None,
                    Size::Variable(_) => match measure_fn_scoped(
                        element_type,
                        type_lookup,
                        root_value_scope(resolved_type),
                    ) {
                        Some(f) => Some(f),
                        None => {
                            panic!(
                                "TypeScript codegen cannot measure field '{}' of '{}'",
                                field.name, resolved_type.name
                            );
                        }
                    },
                };
                let element_size = match element_type.size {
                    Size::Const(val) => val,
                    Size::Variable(_) => 0,
                };
                if !packed {
                    let align = field.field_type.alignment.max(1);
                    if align > 1 {
                        writeln!(
                                out,
                                "    if ((__tnCursorMutable % {}) !== 0) {{ __tnCursorMutable += {} - (__tnCursorMutable % {}); }}",
                                align, align, align
                            )
                            .unwrap();
                    }
                }
                let references = collect_field_value_refs(size_expression);
                for reference in &references {
                    /* Nested paths (e.g. hdr.count) are read through field-ref
                    plans below; only direct primitive fields are cached. */
                    if !struct_has_primitive_field(resolved_type, reference) {
                        continue;
                    }
                    let ident = escape_ts_keyword(reference);
                    writeln!(
                        out,
                        "    if (__tnFieldValue_{} === null) return null;",
                        ident
                    )
                    .unwrap();
                }
                let mut nested_ref_vars = BTreeMap::new();
                for path in collect_field_ref_paths(size_expression) {
                    if path.len() <= 1 {
                        continue;
                    }
                    let var =
                        ensure_field_ref_plan(field_ref_plans, resolved_type, &path, type_lookup)
                            .or_else(|| {
                                /* A value after variable-size data in an earlier struct
                                field, read when the scan measured that field. */
                                let (field_index, key) = resolve_nested_value(
                                    resolved_type,
                                    &path.join("."),
                                    type_lookup,
                                )?;
                                let ResolvedTypeKind::Struct { fields, .. } = &resolved_type.kind
                                else {
                                    return None;
                                };
                                let measured = bindings.iter().any(|binding| {
                                matches!(
                                    &binding.kind,
                                    SequentialBindingKind::NestedValue { field_index: i, key: k }
                                        if *i == field_index && *k == key
                                )
                            });
                                (measured && field_index < index).then(|| {
                                    format!(
                                        "__tnNested_{}.values[\"{}\"]",
                                        escape_ts_keyword(&fields[field_index].name),
                                        key
                                    )
                                })
                            });
                    let Some(var) = var else {
                        writeln!(out, "    return null;").unwrap();
                        return;
                    };
                    nested_ref_vars.insert(path.join("."), var);
                }
                /* The count in checked u64 (as C and Rust: signed fields read
                as their two's complement, `&&` / `||` short-circuit, distinct
                values past 2^53 stay distinct); only byte totals that fit
                the buffer become numbers. */
                let mut resolver = |segments: &[String]| -> Option<String> {
                    match segments {
                        [] => None,
                        [head] if head == "__buffer_size" => {
                            Some("__tnToBigInt(__tnLength)".to_string())
                        }
                        [head] => Some(format!(
                            "__tnU64(__tnToBigInt(__tnFieldValue_{} as number | bigint))",
                            escape_ts_keyword(head)
                        )),
                        _ => nested_ref_vars
                            .get(&segments.join("."))
                            .map(|var| format!("__tnU64(__tnToBigInt({var}))")),
                    }
                };
                let Some(count_expr) =
                    expr_to_ts_bigint_with_resolver(size_expression, &mut resolver)
                else {
                    writeln!(out, "    return null;").unwrap();
                    return;
                };
                let array_ident = format!("__tnArrayCount_{}", field_ident);
                writeln!(out, "    const {array_ident} = {count_expr};").unwrap();
                writeln!(out, "    if ({array_ident} === null) return null;").unwrap();
                if let Some(f) = &element_measure {
                    writeln!(
                        out,
                        "    let __tnArrayBytes_{field_ident} = 0;\n    {{\n      const measure = {f};\n      for (let i = BigInt(0); i < {array_ident}; i++) {{\n        const size = measure(buffer.subarray(__tnCursorMutable + __tnArrayBytes_{field_ident}));\n        if (size === null) return null;\n        if (size === 0) break; /* zero-byte elements: one stands for all */\n        __tnArrayBytes_{field_ident} += size;\n      }}\n    }}"
                    )
                    .unwrap();
                } else {
                    writeln!(
                        out,
                        "    const __tnArrayBytesBig_{field_ident} = {array_ident} * BigInt({element_size});"
                    )
                    .unwrap();
                    writeln!(
                        out,
                        "    if (BigInt(__tnCursorMutable) + __tnArrayBytesBig_{field_ident} > BigInt(__tnLength)) return null;"
                    )
                    .unwrap();
                    writeln!(
                        out,
                        "    const __tnArrayBytes_{field_ident} = Number(__tnArrayBytesBig_{field_ident});"
                    )
                    .unwrap();
                }
                emit_payload_bindings(
                    out,
                    bindings,
                    index,
                    &format!("__tnArrayBytes_{}", field_ident),
                );
                if needs_offset {
                    writeln!(out, "    offsets[\"{}\"] = __tnCursorMutable;", field.name).unwrap();
                }
                writeln!(
                    out,
                    "    if (__tnCursorMutable + __tnArrayBytes_{} > __tnLength) return null;",
                    field_ident
                )
                .unwrap();
                writeln!(
                    out,
                    "    __tnCursorMutable += __tnArrayBytes_{};",
                    field_ident
                )
                .unwrap();
            }
        },
        ResolvedTypeKind::TypeRef { target_name, .. } => match field.field_type.size {
            Size::Const(sz) => {
                if !packed {
                    let align = field.field_type.alignment.max(1);
                    if align > 1 {
                        writeln!(
                            out,
                            "    if ((__tnCursorMutable % {}) !== 0) {{ __tnCursorMutable += {} - (__tnCursorMutable % {}); }}",
                            align, align, align
                        )
                        .unwrap();
                    }
                }
                if needs_offset {
                    writeln!(out, "    offsets[\"{}\"] = __tnCursorMutable;", field.name).unwrap();
                }
                writeln!(
                    out,
                    "    if (__tnCursorMutable + {} > __tnLength) return null;",
                    sz
                )
                .unwrap();
                writeln!(out, "    __tnCursorMutable += {};", sz).unwrap();
            }
            Size::Variable(_) => {
                if !packed {
                    let align = field.field_type.alignment.max(1);
                    if align > 1 {
                        writeln!(
                            out,
                            "    if ((__tnCursorMutable % {}) !== 0) {{ __tnCursorMutable += {} - (__tnCursorMutable % {}); }}",
                            align, align, align
                        )
                        .unwrap();
                    }
                }
                if needs_offset {
                    writeln!(out, "    offsets[\"{}\"] = __tnCursorMutable;", field.name).unwrap();
                }
                writeln!(
                    out,
                    "    const __tnTyperefResult_{} = __tnInvokeDynamicValidate(\"{}\", buffer.subarray(__tnCursorMutable));",
                    field_ident,
                    target_name.replace('\"', "\\\"")
                )
                .unwrap();
                writeln!(
                    out,
                    "    if (!__tnTyperefResult_{}.ok || __tnTyperefResult_{}.consumed === undefined) return null;",
                    field_ident, field_ident
                )
                .unwrap();
                let nested_bindings: Vec<&SequentialBinding> = bindings
                    .iter()
                    .filter(|binding| {
                        matches!(
                            &binding.kind,
                            SequentialBindingKind::TypeRefDynamicParam { field_index, .. } if *field_index == index
                        )
                    })
                    .collect();
                if !nested_bindings.is_empty() {
                    writeln!(
                        out,
                        "    const __tnTyperefParams_{} = __tnTyperefResult_{}.params ?? null;",
                        field_ident, field_ident
                    )
                    .unwrap();
                    for binding in nested_bindings {
                        let SequentialBindingKind::TypeRefDynamicParam { nested_ts_name, .. } =
                            &binding.kind
                        else {
                            unreachable!();
                        };
                        writeln!(
                            out,
                            "    if (!__tnTyperefParams_{} || __tnTyperefParams_{}[\"{}\"] === undefined) return null;",
                            field_ident,
                            field_ident,
                            nested_ts_name.replace('\"', "\\\"")
                        )
                        .unwrap();
                        writeln!(
                            out,
                            "    {} = __tnTyperefParams_{}[\"{}\"];",
                            binding.value_ident,
                            field_ident,
                            nested_ts_name.replace('\"', "\\\"")
                        )
                        .unwrap();
                    }
                }
                emit_payload_bindings(
                    out,
                    bindings,
                    index,
                    &format!("__tnTyperefResult_{}.consumed", field_ident),
                );
                if bindings.iter().any(|binding| {
                    matches!(
                        &binding.kind,
                        SequentialBindingKind::NestedValue { field_index, .. } if *field_index == index
                    )
                }) {
                    /* Values after variable-size data inside the named type. */
                    let start = format!("__tnTyperefStart_{}", field_ident);
                    writeln!(out, "    const {start} = __tnCursorMutable;").unwrap();
                    if !emit_measured_struct_field(
                out,
                field,
                bindings,
                index,
                type_lookup,
                root_value_scope(resolved_type),
            ) {
                        panic!("TypeScript codegen cannot measure field '{}' of '{}'", field.name, resolved_type.name);
                    }
                    writeln!(out, "    __tnCursorMutable = {start};").unwrap();
                }
                writeln!(
                    out,
                    "    __tnCursorMutable += __tnBigIntToNumber(__tnTyperefResult_{}.consumed, \"{}::{}\");",
                    field_ident,
                    resolved_type.name,
                    field.name
                )
                .unwrap();
            }
        },
        ResolvedTypeKind::SizeDiscriminatedUnion { variants } => {
            if !packed {
                let align = field.field_type.alignment.max(1);
                if align > 1 {
                    writeln!(
                        out,
                        "    if ((__tnCursorMutable % {}) !== 0) {{ __tnCursorMutable += {} - (__tnCursorMutable % {}); }}",
                        align, align, align
                    )
                    .unwrap();
                }
            }
            if needs_offset {
                writeln!(out, "    offsets[\"{}\"] = __tnCursorMutable;", field.name).unwrap();
            }
            writeln!(
                out,
                "    const __tnSduAvailable_{} = __tnLength - __tnCursorMutable;",
                field_ident
            )
            .unwrap();
            let variant_sizes: Vec<u64> = variants.iter().map(|v| v.expected_size).collect();
            let sdu_bindings: Vec<(&SequentialBinding, &Vec<u64>)> = bindings
                .iter()
                .filter_map(|binding| {
                    if let SequentialBindingKind::SizeDiscriminatedUnion {
                        field_index,
                        expected_sizes,
                        ..
                    } = &binding.kind
                    {
                        if *field_index == index {
                            return Some((binding, expected_sizes));
                        }
                    }
                    None
                })
                .collect();
            let size_list: &Vec<u64> = sdu_bindings
                .first()
                .map(|(_, sizes)| *sizes)
                .unwrap_or(&variant_sizes);
            writeln!(out, "    let __tnSduSize_{} = -1;", field_ident).unwrap();
            writeln!(out, "    switch (__tnSduAvailable_{}) {{", field_ident).unwrap();
            for size in size_list {
                writeln!(
                    out,
                    "      case {}: __tnSduSize_{} = {}; break;",
                    size, field_ident, size
                )
                .unwrap();
            }
            writeln!(out, "      default: return null;").unwrap();
            writeln!(out, "    }}").unwrap();
            for (binding, _) in &sdu_bindings {
                writeln!(
                    out,
                    "    {} = __tnToBigInt(__tnSduSize_{});",
                    binding.value_ident, field_ident
                )
                .unwrap();
            }
            writeln!(out, "    __tnCursorMutable += __tnSduSize_{};", field_ident).unwrap();
        }
        ResolvedTypeKind::Struct { .. } if matches!(field.field_type.size, Size::Variable(_)) => {
            if !packed {
                let align = field.field_type.alignment.max(1);
                if align > 1 {
                    writeln!(
                        out,
                        "    if ((__tnCursorMutable % {}) !== 0) {{ __tnCursorMutable += {} - (__tnCursorMutable % {}); }}",
                        align, align, align
                    )
                    .unwrap();
                }
            }
            if needs_offset {
                writeln!(out, "    offsets[\"{}\"] = __tnCursorMutable;", field.name).unwrap();
            }
            if !emit_measured_struct_field(
                out,
                field,
                bindings,
                index,
                type_lookup,
                root_value_scope(resolved_type),
            ) {
                panic!(
                    "TypeScript codegen cannot measure field '{}' of '{}'",
                    field.name, resolved_type.name
                );
            }
        }
        ResolvedTypeKind::Union { .. } if matches!(field.field_type.size, Size::Variable(_)) => {
            if !packed {
                let align = field.field_type.alignment.max(1);
                if align > 1 {
                    writeln!(
                        out,
                        "    if ((__tnCursorMutable % {}) !== 0) {{ __tnCursorMutable += {} - (__tnCursorMutable % {}); }}",
                        align, align, align
                    )
                    .unwrap();
                }
            }
            if needs_offset {
                writeln!(out, "    offsets[\"{}\"] = __tnCursorMutable;", field.name).unwrap();
            }
            /* The struct's integers the union's variants may read (`..`). */
            let ctx = root_value_scope(resolved_type)
                .iter()
                .map(|(key, value)| format!("\"{key}\": {value}"))
                .collect::<Vec<_>>()
                .join(", ");
            writeln!(
                out,
                "    const __tnUnionSize_{} = {}.__tnMeasure(buffer.subarray(__tnCursorMutable), {{ {} }});",
                field_ident,
                generated_type_ident(&field.field_type.name),
                ctx
            )
            .unwrap();
            writeln!(
                out,
                "    if (__tnUnionSize_{} === null) return null;",
                field_ident
            )
            .unwrap();
            emit_payload_bindings(
                out,
                bindings,
                index,
                &format!("__tnUnionSize_{}", field_ident),
            );
            writeln!(
                out,
                "    __tnCursorMutable += __tnUnionSize_{};",
                field_ident
            )
            .unwrap();
        }
        _ => {
            if let Size::Const(sz) = field.field_type.size {
                if !packed {
                    let align = field.field_type.alignment.max(1);
                    if align > 1 {
                        writeln!(
                            out,
                            "    if ((__tnCursorMutable % {}) !== 0) {{ __tnCursorMutable += {} - (__tnCursorMutable % {}); }}",
                            align, align, align
                        )
                        .unwrap();
                    }
                }
                if needs_offset {
                    writeln!(out, "    offsets[\"{}\"] = __tnCursorMutable;", field.name).unwrap();
                }
                writeln!(
                    out,
                    "    if (__tnCursorMutable + {} > __tnLength) return null;",
                    sz
                )
                .unwrap();
                writeln!(out, "    __tnCursorMutable += {};", sz).unwrap();
            } else {
                panic!(
                    "TypeScript codegen cannot measure field '{}' of '{}'",
                    field.name, resolved_type.name
                );
            }
        }
    }
}
