/* Builders for generated Rust views.

A struct builder stores every field (primitives as raw little-endian bits,
everything else as encoded bytes), serializes them in declaration order with
the struct's alignment rules, fills in length/tag fields that are simple
references to a sibling field, and validates the result before returning
it. Top-level size-discriminated unions (and top-level enums whose tag is a
plain outside reference) get a variant builder that stores the selected
variant and its payload. Builders need `alloc` (they return `Vec<u8>`).

Setters that can reject their input come in pairs: `try_set_*` returns
`Result<Self, AbiError>` and `set_*` panics with the same error (via
`tn_builder_misuse`). Setters that cannot fail have no `try_` twin. */

use super::emit::{Count, Elem, Emitter, Shape, Slot, VInfo, Variant, ViewRef};
use super::model::*;
use crate::abi::expr::ExprKind;
use crate::abi::resolved::ResolvedTypeKind;
use std::fmt::Write;

macro_rules! w {
    ($out:expr, $($arg:tt)*) => { writeln!($out, $($arg)*).unwrap() };
}

pub fn emit_builders<'a>(e: &Emitter<'_, 'a>, v: &VInfo<'a>) -> String {
    let mut out = String::new();
    let enum_tag = enum_builder_tag(e, v);
    match &v.ty.kind {
        ResolvedTypeKind::Struct { .. } => emit_struct_builder(e, v, &mut out),
        ResolvedTypeKind::Union { .. } | ResolvedTypeKind::Array { .. } => {
            if const_size(v.ty).is_some() {
                emit_blob_builder(e, v, &mut out);
            }
        }
        ResolvedTypeKind::SizeDiscriminatedUnion { .. } if v.named && !v.has_ext() => {
            emit_variant_builder(e, v, None, &mut out)
        }
        ResolvedTypeKind::Enum { .. } if enum_tag.is_some() => {
            emit_variant_builder(e, v, enum_tag.as_deref(), &mut out)
        }
        _ => {}
    }
    let plain = !v.has_ext() && !matches!(v.ty.kind, ResolvedTypeKind::Enum { .. });
    if plain || enum_tag.is_some() {
        w!(
            out,
            "/// `{}` that owns its bytes (returned by builders).",
            v.ty.name
        );
        w!(out, "#[allow(non_camel_case_types)]");
        w!(
            out,
            "pub type {} = {}<__tn_alloc::vec::Vec<u8>>;",
            e.nm(&v.name).owned,
            e.nm(&v.name).view
        );
        w!(out, "");
    }
    out
}

/* A named top-level enum whose only outside input is a plain tag reference:
the builder can derive its parameters from the selected variant. Returns the
`<T>Params` field holding the tag. */
pub fn enum_builder_tag<'a>(e: &Emitter<'_, 'a>, v: &VInfo<'a>) -> Option<String> {
    let ResolvedTypeKind::Enum { tag_expression, .. } = &v.ty.kind else {
        return None;
    };
    let ExprKind::FieldRef(r) = tag_expression else {
        return None;
    };
    if !e.has_ext_params(v) || v.ext.len() != 1 {
        return None;
    }
    let ext = &v.ext[0];
    (ext.external_path.as_deref() == Some(r.path.join(".").as_str())).then(|| ext.ident.clone())
}

/* The sibling primitive slot a simple `[field]` reference points at. */
pub fn sibling_slot<'a>(
    e: &Emitter<'_, 'a>,
    v: &VInfo<'a>,
    k: usize,
    expr: &ExprKind,
) -> Option<usize> {
    let ExprKind::FieldRef(r) = expr else {
        return None;
    };
    let mut frames = v.ancestors.clone();
    frames.push(Frame { ty: v.ty, upto: k });
    match e.m.resolve(&r.path, &frames) {
        RefKind::Field(t) if t.owner == v.ancestors.len() && t.segs.len() == 1 => {
            let Seg::Field(name) = &t.segs[0] else {
                return None;
            };
            let slots = e.slots(v);
            let s = slots.iter().find(|s| &s.name == name)?;
            matches!(s.shape, Shape::Prim(_)).then_some(s.idx)
        }
        _ => None,
    }
}

fn slot_base(slot: &Slot<'_>) -> String {
    plain_ident(&slot.name)
}

/* Emit `try_<name>` (returning `Result<Self, AbiError>`; `body` checks the
input, assigns and ends with `Ok(self)`) and the panicking `<name>`. */
fn emit_fallible(out: &mut String, doc: &str, name: &str, args: &str, call: &str, body: &[String]) {
    w!(out, "    /// {}", doc);
    w!(
        out,
        "    /// Returns an error (and drops the builder) when the input is rejected."
    );
    w!(
        out,
        "    pub fn try_{}(mut self, {}) -> ::core::result::Result<Self, AbiError> {{",
        name,
        args
    );
    for line in body {
        w!(out, "        {}", line);
    }
    w!(out, "    }}");
    w!(out, "    /// {}", doc);
    w!(out, "    ///");
    w!(out, "    /// # Panics");
    w!(out, "    /// When `try_{}` would return an error.", name);
    w!(out, "    #[track_caller]");
    w!(out, "    pub fn {}(self, {}) -> Self {{", name, args);
    w!(
        out,
        "        match self.try_{}({}) {{ Ok(b) => b, Err(e) => tn_builder_misuse(e) }}",
        name,
        call
    );
    w!(out, "    }}");
}

/* Element view of a walked (jagged or stride) array slot: each element's
size comes from its own bytes, so the builder records where every supplied
element ends (`<base>_ends`) and checks each one at build time. */
pub fn walked_elem<'s, 'a>(slot: &'s Slot<'a>) -> Option<&'s ViewRef<'a>> {
    match &slot.shape {
        Shape::Array(a) if a.walk => match &a.elem {
            Elem::View(c) => Some(c),
            _ => None,
        },
        _ => None,
    }
}

const CHECKED_AT_BUILD: &str = " At build, each element must validate on its own and decode, in place, to exactly the bytes supplied for it.";

fn len_check(len: &str, expected: impl std::fmt::Display) -> String {
    format!(
        "if {} != {} {{ return Err(AbiError::LengthMismatch); }}",
        len, expected
    )
}

fn emit_struct_builder<'a>(e: &Emitter<'_, 'a>, v: &VInfo<'a>, out: &mut String) {
    let b = e.nm(&v.name).builder.clone();
    let slots = e.slots(v);
    let packed = v.packed();

    /* Simple length/tag fields derived from what was set. */
    let mut derived: Vec<(usize, usize, &'static str)> = Vec::new(); /* (prim slot, source slot, kind) */
    for slot in &slots {
        match &slot.shape {
            Shape::Array(a) => {
                if let Count::Expr(expr) = &a.count {
                    if let Some(j) = sibling_slot(e, v, slot.idx, expr) {
                        derived.push((j, slot.idx, "count"));
                    }
                }
            }
            Shape::Enum { tag, .. } => {
                if let Some(j) = sibling_slot(e, v, slot.idx, tag) {
                    derived.push((j, slot.idx, "tag"));
                }
            }
            _ => {}
        }
    }

    w!(out, "/// Builder for `{}`.", v.ty.name);
    w!(out, "#[allow(non_camel_case_types)]");
    w!(out, "#[derive(Clone, Debug, Default)]");
    w!(out, "pub struct {} {{", b);
    for slot in &slots {
        let base = slot_base(slot);
        match &slot.shape {
            Shape::Prim(_) => w!(out, "    f_{}: u64,", base),
            Shape::Array(_) => {
                w!(
                    out,
                    "    {}_data: ::core::option::Option<__tn_alloc::vec::Vec<u8>>,",
                    base
                );
                w!(out, "    {}_count: u64,", base);
                if walked_elem(slot).is_some() {
                    w!(out, "    {}_ends: __tn_alloc::vec::Vec<usize>,", base);
                }
            }
            Shape::View(_) => w!(
                out,
                "    {}_data: ::core::option::Option<__tn_alloc::vec::Vec<u8>>,",
                base
            ),
            Shape::Enum { .. } | Shape::Sdu { .. } => {
                w!(
                    out,
                    "    {}_data: ::core::option::Option<__tn_alloc::vec::Vec<u8>>,",
                    base
                );
                w!(out, "    {}_tag: ::core::option::Option<u64>,", base);
            }
        }
    }
    w!(out, "}}");
    w!(out, "");
    w!(out, "impl {} {{", b);
    w!(out, "    pub fn new() -> Self {{ Self::default() }}");
    for slot in &slots {
        emit_struct_setters(e, v, slot, &derived, out);
    }

    /* total_size / write */
    w!(out, "    /// Encoded size of the value built so far.");
    w!(
        out,
        "    #[allow(unused_mut, unused_assignments, clippy::all)]"
    );
    w!(out, "    fn total_size(&self) -> usize {{");
    w!(out, "        let mut o: usize = 0;");
    for slot in &slots {
        if !packed && slot.align > 1 {
            w!(out, "        o = o.div_ceil({a}) * {a};", a = slot.align);
        }
        w!(out, "        o += {};", slot_len_code(slot));
    }
    match (const_size(v.ty), e.tail_align(v)) {
        (Some(c), _) => w!(out, "        let _ = o;\n        {}", c),
        /* Trailing padding up to the struct alignment (zeroed by `__tn_write`). */
        (None, a) if a > 1 => w!(out, "        o.div_ceil({a}) * {a}", a = a),
        (None, _) => w!(out, "        o"),
    }
    w!(out, "    }}");

    w!(
        out,
        "    #[allow(unused_mut, unused_variables, unused_assignments, clippy::all)]"
    );
    w!(
        out,
        "    fn __tn_write(&self, out: &mut [u8]) -> ::core::result::Result<usize, AbiError> {{"
    );
    w!(out, "        let size = self.total_size();");
    w!(out, "        let have = out.len();");
    w!(
        out,
        "        let out = out.get_mut(..size).ok_or(tn_short(size, have))?;"
    );
    w!(out, "        out.fill(0);");
    /* The value written to primitive slot `j`: the last array/variant it
    sizes or tags that was set, else the field's own value. */
    let derived_value = |j: usize| {
        let mut value = format!("self.f_{}", slot_base(&slots[j]));
        for (dj, src, kind) in &derived {
            if *dj == j {
                let sb = slot_base(&slots[*src]);
                value = match *kind {
                    "count" => format!(
                        "if self.{sb}_data.is_some() {{ self.{sb}_count }} else {{ {value} }}",
                        sb = sb,
                        value = value
                    ),
                    _ => format!(
                        "match self.{sb}_tag {{ Some(t) => t, None => {value} }}",
                        sb = sb,
                        value = value
                    ),
                };
            }
        }
        value
    };
    /* One count field sizes every array referencing it: each array that was
    set must have the count written (padding could otherwise absorb the
    difference, and zero-byte elements leave no trace in the bytes). */
    for (j, src, kind) in &derived {
        if *kind == "count"
            && derived
                .iter()
                .filter(|d| d.0 == *j && d.2 == "count")
                .count()
                > 1
        {
            let sb = slot_base(&slots[*src]);
            w!(
                out,
                "        if self.{sb}_data.is_some() && self.{sb}_count != ({v}) {{ return Err(AbiError::LengthMismatch); }}",
                sb = sb,
                v = derived_value(*j)
            );
        }
    }
    w!(out, "        let mut o: usize = 0;");
    for slot in &slots {
        let base = slot_base(slot);
        if !packed && slot.align > 1 {
            w!(out, "        o = o.div_ceil({a}) * {a};", a = slot.align);
        }
        match &slot.shape {
            Shape::Prim(p) => {
                let value = derived_value(slot.idx);
                w!(out, "        out.tn_put(o, {}, {})?;", prim_size(p), value);
            }
            _ => {
                /* `total_size` reserved exactly these bytes, so the copies are in bounds. */
                if let Some(c) = const_size(slot.ty) {
                    w!(out, "        if let Some(bytes) = &self.{}_data {{", base);
                    w!(
                        out,
                        "            if bytes.len() != {} {{ return Err(AbiError::LengthMismatch); }}",
                        c
                    );
                    w!(out, "            out[o..o + {}].copy_from_slice(bytes);", c);
                    w!(out, "        }}");
                } else {
                    w!(out, "        if let Some(bytes) = &self.{}_data {{", base);
                    w!(
                        out,
                        "            out[o..o + bytes.len()].copy_from_slice(bytes);"
                    );
                    w!(out, "        }}");
                }
            }
        }
        w!(out, "        o += {};", slot_len_code(slot));
    }
    w!(out, "        Ok(size)");
    w!(out, "    }}");

    let validate = (!v.has_ext()).then_some(Validate::Plain);
    emit_finish_fns(e, v, &b, validate, out);
    if e.has_params_struct(v) {
        emit_builder_params(e, v, out);
    }
    w!(out, "}}");
    w!(out, "");
}

/* Byte length a slot contributes in the builder. */
fn slot_len_code(slot: &Slot<'_>) -> String {
    let base = slot_base(slot);
    match (&slot.shape, const_size(slot.ty)) {
        (Shape::Prim(p), _) => format!("{}", prim_size(p)),
        (_, Some(c)) => format!("{}", c),
        _ => format!("self.{}_data.as_ref().map(|d| d.len()).unwrap_or(0)", base),
    }
}

/* `dynamic_params()` for builders of types with a `<T>Params` struct. */
fn emit_builder_params(e: &Emitter<'_, '_>, v: &VInfo<'_>, out: &mut String) {
    let pt = e.nm(&v.name).params.clone();
    w!(
        out,
        "    /// Dynamic parameters of the value built so far (fails if it would not validate)."
    );
    w!(
        out,
        "    pub fn dynamic_params(&self) -> ::core::result::Result<{}, AbiError> {{",
        pt
    );
    w!(out, "        {}::from_buffer(&self.__tn_bytes()?)", pt);
    w!(out, "    }}");
}

fn emit_struct_setters<'a>(
    e: &Emitter<'_, 'a>,
    v: &VInfo<'a>,
    slot: &Slot<'a>,
    derived: &[(usize, usize, &'static str)],
    out: &mut String,
) {
    let base = slot_base(slot);
    let label = format!("{}.{}", v.ty.name, slot.name);
    match &slot.shape {
        Shape::Prim(p) => {
            let auto = derived.iter().any(|(j, _, _)| *j == slot.idx);
            w!(
                out,
                "    /// Set `{}`{}.",
                label,
                if auto {
                    " (derived automatically when its array/variant is set)"
                } else {
                    ""
                }
            );
            w!(
                out,
                "    pub fn set_{}(mut self, value: {}) -> Self {{",
                base,
                prim_rust(p)
            );
            w!(
                out,
                "        self.f_{} = {};",
                base,
                prim_to_raw(p, "value")
            );
            w!(out, "        self");
            w!(out, "    }}");
        }
        Shape::Array(a) => {
            let fixed = match a.count {
                Count::Const(c) => Some(c),
                Count::Expr(_) => None,
            };
            match &a.elem {
                Elem::Prim(p) => {
                    let es = prim_size(p);
                    let ty = prim_rust(p);
                    let mut body = Vec::new();
                    if let Some(c) = fixed {
                        body.push(len_check("values.len()", c));
                    }
                    body.push(format!(
                        "let mut bytes = __tn_alloc::vec::Vec::with_capacity(values.len() * {});",
                        es
                    ));
                    body.push(format!(
                        "for value in values {{ bytes.extend_from_slice(&{}.to_le_bytes()[..{}]); }}",
                        prim_to_raw(p, "*value"),
                        es
                    ));
                    body.push(format!("self.{}_count = values.len() as u64;", base));
                    body.push(format!("self.{}_data = Some(bytes);", base));
                    if fixed.is_some() {
                        body.push("Ok(self)".to_string());
                        emit_fallible(
                            out,
                            &format!("Set the elements of `{}`.", label),
                            &format!("set_{}", base),
                            &format!("values: &[{}]", ty),
                            "values",
                            &body,
                        );
                    } else {
                        w!(out, "    /// Set the elements of `{}`.", label);
                        w!(
                            out,
                            "    pub fn set_{}(mut self, values: &[{}]) -> Self {{",
                            base,
                            ty
                        );
                        for line in &body {
                            w!(out, "        {}", line);
                        }
                        w!(out, "        self");
                        w!(out, "    }}");
                    }
                    emit_bytes_setter(out, &label, &base, es as u64, fixed);
                }
                Elem::View(_) | Elem::Opaque(_) => {
                    /* Zero-byte elements: an encoding cannot say how many
                    there are, so they are only pushed (or counted). */
                    match a.elem_size {
                        Some(es) if !a.walk && es > 0 => {
                            emit_bytes_setter(out, &label, &base, es, fixed)
                        }
                        _ => {}
                    }
                    let mut body = Vec::new();
                    if let Some(es) = a.elem_size {
                        body.push(len_check("element.len()", es));
                    }
                    body.push(format!(
                        "self.{}_data.get_or_insert_with(__tn_alloc::vec::Vec::new).extend_from_slice(element);",
                        base
                    ));
                    let walked = walked_elem(slot).is_some();
                    if walked {
                        body.push(format!(
                            "self.{b}_ends.push(self.{b}_data.as_ref().map_or(0, |d| d.len()));",
                            b = base
                        ));
                    }
                    body.push(format!("self.{}_count += 1;", base));
                    let mut doc = format!("Append one encoded element to `{}`.", label);
                    if walked {
                        doc.push_str(CHECKED_AT_BUILD);
                    }
                    if a.elem_size.is_some() {
                        body.push("Ok(self)".to_string());
                        emit_fallible(
                            out,
                            &doc,
                            &format!("push_{}", base),
                            "element: &[u8]",
                            "element",
                            &body,
                        );
                    } else {
                        w!(out, "    /// {}", doc);
                        w!(
                            out,
                            "    pub fn push_{}(mut self, element: &[u8]) -> Self {{",
                            base
                        );
                        for line in &body {
                            w!(out, "        {}", line);
                        }
                        w!(out, "        self");
                        w!(out, "    }}");
                    }
                    if a.walk {
                        w!(
                            out,
                            "    /// Set every element of `{}` from their encodings.{}",
                            label,
                            if walked { CHECKED_AT_BUILD } else { "" }
                        );
                        w!(
                            out,
                            "    pub fn set_{}(mut self, elements: &[&[u8]]) -> Self {{",
                            base
                        );
                        w!(out, "        let mut bytes = __tn_alloc::vec::Vec::new();");
                        if walked {
                            w!(out, "        self.{}_ends.clear();", base);
                            w!(
                                out,
                                "        for element in elements {{ bytes.extend_from_slice(element); self.{}_ends.push(bytes.len()); }}",
                                base
                            );
                        } else {
                            w!(
                                out,
                                "        for element in elements {{ bytes.extend_from_slice(element); }}"
                            );
                        }
                        w!(out, "        self.{}_count = elements.len() as u64;", base);
                        w!(out, "        self.{}_data = Some(bytes);", base);
                        w!(out, "        self");
                        w!(out, "    }}");
                    }
                }
            }
        }
        Shape::View(c) => {
            let doc = format!(
                "Set `{}` from its encoding (e.g. `{}::build()` output).",
                label,
                e.nm(&c.vname).builder
            );
            if let Some(sz) = c.size {
                emit_fallible(
                    out,
                    &doc,
                    &format!("set_{}", base),
                    "bytes: &[u8]",
                    "bytes",
                    &[
                        len_check("bytes.len()", sz),
                        format!("self.{}_data = Some(bytes.to_vec());", base),
                        "Ok(self)".to_string(),
                    ],
                );
            } else {
                w!(out, "    /// {}", doc);
                w!(
                    out,
                    "    pub fn set_{}(mut self, bytes: &[u8]) -> Self {{",
                    base
                );
                w!(out, "        self.{}_data = Some(bytes.to_vec());", base);
                w!(out, "        self");
                w!(out, "    }}");
            }
        }
        Shape::Enum { variants, .. } | Shape::Sdu { variants } => {
            let is_sdu = matches!(slot.shape, Shape::Sdu { .. });
            let tag_field = format!("self.{}_tag", base);
            let data_field = format!("self.{}_data", base);
            emit_variant_setters(
                e,
                v,
                slot,
                variants,
                &VariantSetters {
                    prefix: format!("set_{}_", base),
                    label,
                    tag_field,
                    data_field,
                    is_sdu,
                },
                out,
            );
        }
    }
}

/* `set_<f>_bytes`: set an array from its little-endian encoding. */
fn emit_bytes_setter(out: &mut String, label: &str, base: &str, es: u64, fixed: Option<u64>) {
    let mut body = vec![format!(
        "if bytes.len() % {} != 0 {{ return Err(AbiError::LengthMismatch); }}",
        es
    )];
    if let Some(c) = fixed {
        body.push(len_check(&format!("bytes.len() / {}", es), c));
    }
    body.push(format!(
        "self.{}_count = (bytes.len() / {}) as u64;",
        base, es
    ));
    body.push(format!("self.{}_data = Some(bytes.to_vec());", base));
    body.push("Ok(self)".to_string());
    emit_fallible(
        out,
        &format!(
            "Set `{}` from its encoding ({} bytes per element).",
            label, es
        ),
        &format!("set_{}_bytes", base),
        "bytes: &[u8]",
        "bytes",
        &body,
    );
}

/* Where variant setters store the selection and how they are named. */
struct VariantSetters {
    /* `set_<field>_` for struct fields, `set_` for variant builders. */
    prefix: String,
    label: String,
    tag_field: String,
    data_field: String,
    /* SDU selections store the variant index. */
    is_sdu: bool,
}

/* Variant selection setters shared by struct fields and variant builders:
one per variant (`<prefix><variant>`), by tag (enums, `<prefix>variant`) and
by name (`<prefix>variant_by_name`). */
fn emit_variant_setters<'a>(
    e: &Emitter<'_, 'a>,
    v: &VInfo<'a>,
    slot: &Slot<'a>,
    variants: &[Variant<'a>],
    s: &VariantSetters,
    out: &mut String,
) {
    let assign = |tag: &str| {
        vec![
            format!("{} = Some({});", s.tag_field, tag),
            format!("{} = Some(payload.to_vec());", s.data_field),
        ]
    };
    let names = variant_setter_suffixes(variants);
    for (vi, (var, vn)) in variants.iter().zip(names).enumerate() {
        let tag = if s.is_sdu { vi as u64 } else { var.tag };
        let doc = format!(
            "Select variant `{}` of `{}` with its encoded payload.",
            var.name, s.label
        );
        let name = format!("{}{}", s.prefix, vn);
        let mut body = assign(&tag.to_string());
        match var.elem.size() {
            Some(sz) => {
                body.insert(0, len_check("payload.len()", sz));
                body.push("Ok(self)".to_string());
                emit_fallible(out, &doc, &name, "payload: &[u8]", "payload", &body);
            }
            None => {
                w!(out, "    /// {}", doc);
                w!(
                    out,
                    "    pub fn {}(mut self, payload: &[u8]) -> Self {{",
                    name
                );
                for line in &body {
                    w!(out, "        {}", line);
                }
                w!(out, "        self");
                w!(out, "    }}");
            }
        }
    }
    let base = e.method_base(v, slot);
    let by_name = e.hname(v, &base, "variant_by_name");
    let by_tag = e.hname(v, &base, "variant_by_tag");
    if !s.is_sdu {
        let mut body = vec![
            format!(
                "let info = {}::{}(tag).ok_or(AbiError::InvalidVariant)?;",
                e.nm(&v.name).ty,
                by_tag
            ),
            "tn_check_payload(info, payload)?;".to_string(),
        ];
        body.extend(assign("tag"));
        body.push("Ok(self)".to_string());
        emit_fallible(
            out,
            &format!(
                "Select the `{}` variant with tag value `tag` and its encoded payload.",
                s.label
            ),
            &format!("{}variant", s.prefix),
            "tag: u64, payload: &[u8]",
            "tag, payload",
            &body,
        );
    }
    let mut body = vec![
        format!(
            "let info = {}::{}(name).ok_or(AbiError::InvalidVariant)?;",
            e.nm(&v.name).ty,
            by_name
        ),
        "tn_check_payload(info, payload)?;".to_string(),
    ];
    body.extend(assign("info.tag"));
    body.push("Ok(self)".to_string());
    emit_fallible(
        out,
        &format!(
            "Select the `{}` variant named `name` (as in the ABI) with its encoded payload.",
            s.label
        ),
        &format!("{}variant_by_name", s.prefix),
        "name: &str, payload: &[u8]",
        "name, payload",
        &body,
    );
}

/* `__tn_check_elements`: every element supplied to a walked (jagged) array
must validate on its own and span exactly its bytes. The array's size and
count alone cannot catch an element that ends early or late: the next one
absorbs the difference (`[0, 1]` + `[42]` re-splits as `[0]` + `[1, 42]`).
When the struct validates by itself, each element is also measured in place
(with the context its view would use); a struct that needs outside context
only checks elements that need none. Runs on the written bytes, before the
whole value is validated, so a misplaced boundary reports `LengthMismatch`.
Emitted only when there is an element to check; returns whether it was. */
fn emit_check_elements<'a>(
    e: &Emitter<'_, 'a>,
    v: &VInfo<'a>,
    validate: Option<Validate>,
    out: &mut String,
) -> bool {
    let nm = e.nm(&v.name);
    let n = &nm.ty;
    let x = &nm.ext;
    let mut body = String::new();
    if matches!(v.ty.kind, ResolvedTypeKind::Struct { .. }) {
        let out = &mut body;
        let in_place = matches!(validate, Some(Validate::Plain));
        for slot in e.slots(v) {
            let Some(c) = walked_elem(&slot) else {
                continue;
            };
            let child_ext = e.info(&c.vname).is_some_and(|ci| ci.has_ext());
            if child_ext && !in_place {
                continue;
            }
            let sb = slot_base(&slot);
            let k = slot.idx;
            w!(out, "        if let Some(data) = &self.{}_data {{", sb);
            if in_place {
                w!(
                    out,
                    "            let l = {n}::__tn_layout_of(bytes, &{x}::default(), {k})?;",
                    n = n,
                    x = x,
                    k = k
                );
            }
            if child_ext {
                w!(
                    out,
                    "            let ext = {n}::__tn_ext_{k}(bytes, &l, &{x}::default())?;",
                    n = n,
                    x = x,
                    k = k
                );
            } else {
                w!(
                    out,
                    "            let ext = {}::default();",
                    e.nm(&c.vname).ext
                );
            }
            w!(out, "            let mut start = 0usize;");
            w!(out, "            for &end in &self.{}_ends {{", sb);
            w!(out, "                let len = end - start;");
            w!(
                out,
                "                if {}::__tn_validate_of(&data[start..end], &ext)? != len {{ return Err(AbiError::LengthMismatch); }}",
                e.nm(&c.vname).ty
            );
            if in_place {
                w!(
                    out,
                    "                let here = bytes.get(l.end + start..).ok_or(AbiError::LengthMismatch)?;"
                );
                w!(
                    out,
                    "                if {}::__tn_layout_of(here, &ext, usize::MAX)?.end != len {{ return Err(AbiError::LengthMismatch); }}",
                    e.nm(&c.vname).ty
                );
            }
            w!(out, "                start = end;");
            w!(out, "            }}");
            w!(out, "        }}");
        }
    }
    if body.is_empty() {
        return false;
    }
    w!(out, "    #[allow(unused_variables)]");
    w!(
        out,
        "    fn __tn_check_elements(&self, bytes: &[u8]) -> ::core::result::Result<(), AbiError> {{"
    );
    out.push_str(&body);
    w!(out, "        Ok(())");
    w!(out, "    }}");
    true
}

/* How a builder validates its output. */
#[derive(Clone, Copy)]
enum Validate {
    /* `T::validate(bytes)`: the type needs no outside context. */
    Plain,
    /* `T::validate_with(bytes, &self.__tn_params()?)`: a top-level enum. */
    WithParams,
}

/* build / build_into / finish shared by all builders (needs `__tn_write`). */
fn emit_finish_fns<'a>(
    e: &Emitter<'_, 'a>,
    v: &VInfo<'a>,
    b: &str,
    validate: Option<Validate>,
    out: &mut String,
) {
    let nm = e.nm(&v.name);
    let n = &nm.ty;
    let validate_call = |bytes: &str| match validate {
        Some(Validate::Plain) => Some(format!("{}::validate({})?", n, bytes)),
        Some(Validate::WithParams) => Some(format!(
            "{}::validate_with({}, &self.__tn_params()?)?",
            n, bytes
        )),
        None => None,
    };
    /* The selected variant must be the one the tag fields select, and (for
    structs) every variable-size field must span exactly the bytes it was
    given: a count or tag that disagrees with the data can still validate
    when trailing padding absorbs the difference. */
    w!(out, "    #[allow(unused_variables)]");
    w!(
        out,
        "    fn __tn_check_variants(&self, bytes: &[u8]) -> ::core::result::Result<(), AbiError> {{"
    );
    match (&v.ty.kind, validate) {
        (ResolvedTypeKind::Struct { .. }, Some(_)) => {
            let sized: Vec<Slot<'a>> = e
                .slots(v)
                .into_iter()
                .filter(|s| !matches!(s.shape, Shape::Prim(_)) && const_size(s.ty).is_none())
                .collect();
            if !sized.is_empty() {
                w!(
                    out,
                    "        let l = {n}::__tn_layout_of(bytes, &{x}::default(), usize::MAX)?;",
                    n = n,
                    x = nm.ext
                );
            }
            for s in &sized {
                let sb = slot_base(s);
                w!(
                    out,
                    "        if l.len[{k}] != self.{sb}_data.as_ref().map_or(0, |d| d.len()) {{ return Err(AbiError::LengthMismatch); }}",
                    k = s.idx,
                    sb = sb
                );
                if matches!(s.shape, Shape::Array(_)) {
                    w!(
                        out,
                        "        if self.{sb}_data.is_some() && l.aux[{k}] != self.{sb}_count {{ return Err(AbiError::LengthMismatch); }}",
                        k = s.idx,
                        sb = sb
                    );
                }
            }
            let checks: Vec<String> = e
                .slots(v)
                .iter()
                .filter(|s| matches!(s.shape, Shape::Enum { .. } | Shape::Sdu { .. }))
                .map(|s| {
                    let base = e.method_base(v, s);
                    format!(
                        "        if let Some(t) = self.{}_tag {{ if view.{}() as u64 != t {{ return Err(AbiError::InvalidVariant); }} }}",
                        slot_base(s),
                        e.hname(v, &base, "tag")
                    )
                })
                .collect();
            if !checks.is_empty() {
                w!(
                    out,
                    "        let view = {}::from_slice_unchecked(bytes);",
                    n
                );
                for c in checks {
                    w!(out, "{}", c);
                }
            }
        }
        (_, Some(Validate::Plain)) if v.is_sdu() => {
            w!(
                out,
                "        let view = {}::from_slice_unchecked(bytes);",
                n
            );
            w!(
                out,
                "        if let Some(t) = self.tag {{ if view.tag() as u64 != t {{ return Err(AbiError::InvalidVariant); }} }}"
            );
        }
        (_, Some(Validate::WithParams)) => {
            w!(
                out,
                "        let view = {}::from_slice_unchecked_with(bytes, self.__tn_params()?);",
                n
            );
            w!(
                out,
                "        if let Some(t) = self.tag {{ if view.tag() != t {{ return Err(AbiError::InvalidVariant); }} }}"
            );
        }
        _ => {}
    }
    w!(out, "        Ok(())");
    w!(out, "    }}");
    let check_elements = emit_check_elements(e, v, validate, out);
    w!(
        out,
        "    /// Encode (and validate) the value without consuming the builder."
    );
    w!(
        out,
        "    fn __tn_bytes(&self) -> ::core::result::Result<__tn_alloc::vec::Vec<u8>, AbiError> {{"
    );
    w!(
        out,
        "        let mut bytes = __tn_alloc::vec![0u8; self.total_size()];"
    );
    w!(out, "        self.__tn_write(&mut bytes)?;");
    if check_elements {
        w!(out, "        self.__tn_check_elements(&bytes)?;");
    }
    if let Some(call) = validate_call("&bytes") {
        w!(
            out,
            "        if {} != bytes.len() {{ return Err(AbiError::LengthMismatch); }}",
            call
        );
        w!(out, "        self.__tn_check_variants(&bytes)?;");
    }
    w!(out, "        Ok(bytes)");
    w!(out, "    }}");
    w!(
        out,
        "    /// Build the encoded bytes, returning an error if they would not validate."
    );
    w!(
        out,
        "    pub fn try_build(self) -> ::core::result::Result<__tn_alloc::vec::Vec<u8>, AbiError> {{"
    );
    w!(out, "        self.__tn_bytes()");
    w!(out, "    }}");
    w!(out, "    /// Build the encoded bytes.");
    w!(out, "    ///");
    w!(out, "    /// # Panics");
    w!(
        out,
        "    /// When the fields set do not form a valid `{}` (`try_build` returns the error).",
        v.ty.name
    );
    w!(out, "    #[track_caller]");
    w!(out, "    pub fn build(self) -> __tn_alloc::vec::Vec<u8> {{");
    w!(out, "        match self.try_build() {{");
    w!(out, "            Ok(bytes) => bytes,");
    w!(
        out,
        "            Err(err) => panic!(\"{} produced an invalid buffer: {{}}\", err),",
        b
    );
    w!(out, "        }}");
    w!(out, "    }}");
    w!(
        out,
        "    /// Write the encoded bytes to the start of `target`; returns the size written."
    );
    w!(
        out,
        "    pub fn build_into(self, target: &mut [u8]) -> ::core::result::Result<usize, AbiError> {{"
    );
    w!(out, "        let size = self.total_size();");
    w!(
        out,
        "        if target.len() < size {{ return Err(tn_short(size, target.len())); }}"
    );
    w!(out, "        self.__tn_write(target)?;");
    if check_elements {
        w!(out, "        self.__tn_check_elements(&target[..size])?;");
    }
    if let Some(call) = validate_call("&target[..size]") {
        w!(
            out,
            "        if {} != size {{ return Err(AbiError::LengthMismatch); }}",
            call
        );
        w!(out, "        self.__tn_check_variants(&target[..size])?;");
    }
    w!(out, "        Ok(size)");
    w!(out, "    }}");
    match validate {
        Some(Validate::Plain) => {
            w!(
                out,
                "    /// Build and wrap the bytes in an owned, validated view."
            );
            w!(
                out,
                "    pub fn finish(self) -> ::core::result::Result<{}, AbiError> {{",
                nm.owned
            );
            w!(out, "        let data = self.try_build()?;");
            w!(
                out,
                "        Ok({} {{ data, ext: {}::default() }})",
                nm.view,
                nm.ext
            );
            w!(out, "    }}");
        }
        Some(Validate::WithParams) => {
            w!(
                out,
                "    /// Build and wrap the bytes in an owned, validated view."
            );
            w!(
                out,
                "    pub fn finish(self) -> ::core::result::Result<{}, AbiError> {{",
                nm.owned
            );
            w!(out, "        let ext = self.__tn_params()?;");
            w!(out, "        let data = self.try_build()?;");
            w!(out, "        Ok({} {{ data, ext }})", nm.view);
            w!(out, "    }}");
        }
        None => {}
    }
}

/* Builders for fixed-size unions and arrays: a zeroed buffer plus setters. */
fn emit_blob_builder<'a>(e: &Emitter<'_, 'a>, v: &VInfo<'a>, out: &mut String) {
    let b = e.nm(&v.name).builder.clone();
    let size = const_size(v.ty).unwrap_or(0);
    w!(out, "/// Builder for `{}`.", v.ty.name);
    w!(out, "#[allow(non_camel_case_types)]");
    w!(out, "#[derive(Clone, Debug)]");
    w!(out, "pub struct {} {{", b);
    w!(out, "    bytes: __tn_alloc::vec::Vec<u8>,");
    w!(out, "}}");
    w!(out, "impl ::core::default::Default for {} {{", b);
    w!(
        out,
        "    fn default() -> Self {{ Self {{ bytes: __tn_alloc::vec![0u8; {}] }} }}",
        size
    );
    w!(out, "}}");
    w!(out, "impl {} {{", b);
    w!(out, "    pub fn new() -> Self {{ Self::default() }}");
    emit_fallible(
        out,
        &format!("Overwrite the whole encoding ({} bytes).", size),
        "set_encoding",
        "bytes: &[u8]",
        "bytes",
        &[
            len_check("bytes.len()", size),
            "self.bytes.copy_from_slice(bytes);".to_string(),
            "Ok(self)".to_string(),
        ],
    );
    for slot in e.slots(v) {
        let base = slot_base(&slot);
        match (&v.ty.kind, &slot.shape) {
            (ResolvedTypeKind::Union { .. }, Shape::Prim(p)) => {
                w!(out, "    /// Write variant `{}`.", slot.name);
                w!(
                    out,
                    "    pub fn set_{}(mut self, value: {}) -> Self {{",
                    base,
                    prim_rust(p)
                );
                w!(out, "        self.bytes.fill(0);");
                w!(
                    out,
                    "        self.bytes[..{n}].copy_from_slice(&{}.to_le_bytes()[..{n}]);",
                    prim_to_raw(p, "value"),
                    n = prim_size(p)
                );
                w!(out, "        self");
                w!(out, "    }}");
            }
            (ResolvedTypeKind::Union { .. }, _) => {
                emit_fallible(
                    out,
                    &format!(
                        "Write variant `{}` from its encoding (at most {} bytes).",
                        slot.name, size
                    ),
                    &format!("set_{}", base),
                    "bytes: &[u8]",
                    "bytes",
                    &[
                        format!(
                            "if bytes.len() > {} {{ return Err(AbiError::LengthMismatch); }}",
                            size
                        ),
                        "self.bytes.fill(0);".to_string(),
                        "self.bytes[..bytes.len()].copy_from_slice(bytes);".to_string(),
                        "Ok(self)".to_string(),
                    ],
                );
            }
            (ResolvedTypeKind::Array { .. }, Shape::Array(a)) => {
                let es = a.elem_size.unwrap_or(0) as usize;
                let range = format!(
                    "let at = i.checked_mul({es}).filter(|at| at + {es} <= {size}).ok_or(AbiError::OutOfBounds)?;",
                    es = es,
                    size = size
                );
                match &a.elem {
                    Elem::Prim(p) => emit_fallible(
                        out,
                        "Set element `i`.",
                        "set",
                        &format!("i: usize, value: {}", prim_rust(p)),
                        "i, value",
                        &[
                            range,
                            format!(
                                "self.bytes[at..at + {es}].copy_from_slice(&{}.to_le_bytes()[..{es}]);",
                                prim_to_raw(p, "value"),
                                es = es
                            ),
                            "Ok(self)".to_string(),
                        ],
                    ),
                    _ => emit_fallible(
                        out,
                        &format!("Set element `i` from its encoding ({} bytes).", es),
                        "set",
                        "i: usize, element: &[u8]",
                        "i, element",
                        &[
                            range,
                            len_check("element.len()", es),
                            format!("self.bytes[at..at + {}].copy_from_slice(element);", es),
                            "Ok(self)".to_string(),
                        ],
                    ),
                }
            }
            _ => {}
        }
    }
    w!(out, "    fn total_size(&self) -> usize {{ {} }}", size);
    w!(
        out,
        "    fn __tn_write(&self, out: &mut [u8]) -> ::core::result::Result<usize, AbiError> {{"
    );
    w!(out, "        let have = out.len();");
    w!(
        out,
        "        out.get_mut(..{s}).ok_or(tn_short({s}, have))?.copy_from_slice(&self.bytes);",
        s = size
    );
    w!(out, "        Ok({})", size);
    w!(out, "    }}");
    let validate = (!v.has_ext()).then_some(Validate::Plain);
    emit_finish_fns(e, v, &b, validate, out);
    w!(out, "}}");
    w!(out, "");
}

/* Builder for a top-level size-discriminated union or enum: the encoding is
the selected variant's payload. For an enum, `enum_tag` is the `<T>Params`
field the tag goes to (the tag itself is not part of the bytes). */
fn emit_variant_builder<'a>(
    e: &Emitter<'_, 'a>,
    v: &VInfo<'a>,
    enum_tag: Option<&str>,
    out: &mut String,
) {
    let nm = e.nm(&v.name);
    let b = nm.builder.clone();
    let slots = e.slots(v);
    let Some(slot) = slots.first() else { return };
    let (variants, is_sdu) = match &slot.shape {
        Shape::Sdu { variants } => (variants, true),
        Shape::Enum { variants, .. } => (variants, false),
        _ => return,
    };
    w!(
        out,
        "/// Builder for `{}`: select a variant and its payload.",
        v.ty.name
    );
    w!(out, "#[allow(non_camel_case_types)]");
    w!(out, "#[derive(Clone, Debug, Default)]");
    w!(out, "pub struct {} {{", b);
    w!(out, "    tag: ::core::option::Option<u64>,");
    w!(
        out,
        "    data: ::core::option::Option<__tn_alloc::vec::Vec<u8>>,"
    );
    w!(out, "}}");
    w!(out, "");
    w!(out, "impl {} {{", b);
    w!(out, "    pub fn new() -> Self {{ Self::default() }}");
    emit_variant_setters(
        e,
        v,
        slot,
        variants,
        &VariantSetters {
            prefix: "set_".to_string(),
            label: v.ty.name.clone(),
            tag_field: "self.tag".to_string(),
            data_field: "self.data".to_string(),
            is_sdu,
        },
        out,
    );
    w!(
        out,
        "    fn total_size(&self) -> usize {{ self.data.as_ref().map(|d| d.len()).unwrap_or(0) }}"
    );
    w!(
        out,
        "    fn __tn_write(&self, out: &mut [u8]) -> ::core::result::Result<usize, AbiError> {{"
    );
    w!(out, "        let size = self.total_size();");
    w!(out, "        let have = out.len();");
    w!(
        out,
        "        let out = out.get_mut(..size).ok_or(tn_short(size, have))?;"
    );
    w!(
        out,
        "        if let Some(bytes) = &self.data {{ out.copy_from_slice(bytes); }}"
    );
    w!(out, "        Ok(size)");
    w!(out, "    }}");
    let pt = nm.params.clone();
    match enum_tag {
        Some(field) => {
            w!(out, "    /// Parameters selecting the chosen variant.");
            w!(
                out,
                "    fn __tn_params(&self) -> ::core::result::Result<{}, AbiError> {{",
                pt
            );
            w!(
                out,
                "        let tag = self.tag.ok_or(AbiError::InvalidVariant)?;"
            );
            w!(out, "        Ok({} {{ {}: tag }})", pt, field);
            w!(out, "    }}");
            emit_finish_fns(e, v, &b, Some(Validate::WithParams), out);
            w!(
                out,
                "    /// Dynamic parameters of the value built so far: the tag the enclosing type"
            );
            w!(
                out,
                "    /// must store (fails if no valid variant is selected)."
            );
            w!(
                out,
                "    pub fn dynamic_params(&self) -> ::core::result::Result<{}, AbiError> {{",
                pt
            );
            w!(out, "        self.__tn_bytes()?;");
            w!(out, "        self.__tn_params()");
            w!(out, "    }}");
        }
        None => {
            emit_finish_fns(e, v, &b, Some(Validate::Plain), out);
            emit_builder_params(e, v, out);
        }
    }
    w!(out, "}}");
    w!(out, "");
}

/* Suffixes of the per-variant builder setters (`set_<field>_<suffix>`). */
pub fn variant_setter_suffixes(variants: &[Variant<'_>]) -> Vec<String> {
    let mut used: Vec<String> = Vec::new();
    for var in variants {
        let mut vn = to_snake(&var.name);
        while used.contains(&vn) {
            vn.push('_');
        }
        used.push(vn);
    }
    used
}
