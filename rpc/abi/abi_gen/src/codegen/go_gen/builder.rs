/* Go builders (port of `rust_gen::emit_builder`).

A struct builder stores every field (primitives as raw little-endian bits,
everything else as encoded bytes), serializes them in declaration order with
the struct's alignment rules, fills in length/tag fields that are plain
references to a sibling field, and validates the result before returning it.
Every check the Rust builders make is made here: shared counts, the bytes
each variable-size field spans, the variant the tag selects, and the boundary
of every element given to a jagged array.

Setters return the builder for chaining and record the first error (a
rejected input leaves the builder's state unchanged); `Build`, `BuildInto`,
`Finish` and `DynamicParams` return it. Nothing panics. */

use super::code::Code;
use super::emit::GoEmitter;
use super::names::*;
use super::pkgnames::VNames;
use crate::abi::resolved::ResolvedTypeKind;
use crate::codegen::rust_gen::emit::{Count, Elem, Shape, Slot, VInfo, Variant};
use crate::codegen::rust_gen::emit_builder::{enum_builder_tag, sibling_slot, walked_elem};
use crate::codegen::rust_gen::model::*;
use std::fmt::Write;

macro_rules! w {
    ($out:expr, $($arg:tt)*) => { writeln!($out, $($arg)*).unwrap() };
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Validate {
    Plain,
    WithParams,
}

const BUILDER_RESERVED: &[&str] = &["Build", "BuildInto", "Finish", "DynamicParams", "Err"];

const CHECKED_AT_BUILD: &str = "At build, each element must validate on its own and decode, in place, to exactly the bytes supplied for it.";

#[derive(PartialEq, Eq)]
pub enum BuilderKind {
    Struct,
    Blob,
    Variant,
}

impl<'m, 'a> GoEmitter<'m, 'a> {
    /* Which builder (if any) view `v` gets. */
    pub fn builder_kind(&self, v: &VInfo<'a>) -> Option<BuilderKind> {
        match &v.ty.kind {
            ResolvedTypeKind::Struct { .. } => Some(BuilderKind::Struct),
            ResolvedTypeKind::Union { .. } | ResolvedTypeKind::Array { .. } => {
                const_size(v.ty).map(|_| BuilderKind::Blob)
            }
            ResolvedTypeKind::SizeDiscriminatedUnion { .. } if v.named && !v.has_ext() => {
                Some(BuilderKind::Variant)
            }
            ResolvedTypeKind::Enum { .. } if enum_builder_tag(&self.r, v).is_some() => {
                Some(BuilderKind::Variant)
            }
            _ => None,
        }
    }

    /* Method names of `<N>Builder`, allocated in a fixed order. */
    pub fn builder_names(&self, v: &VInfo<'a>) -> Names {
        let mut n = Names::new(BUILDER_RESERVED);
        match self.builder_kind(v) {
            Some(BuilderKind::Struct) => {
                for slot in self.r.slots(v) {
                    let k = slot.idx;
                    let b = camel(&slot.name);
                    match &slot.shape {
                        Shape::Prim(_) | Shape::View(_) => {
                            n.alloc(&format!("{k}:set"), &format!("Set{b}"));
                        }
                        Shape::Array(a) => match &a.elem {
                            Elem::Prim(_) => {
                                n.alloc(&format!("{k}:set"), &format!("Set{b}"));
                                n.alloc(&format!("{k}:bytes"), &format!("Set{b}Bytes"));
                            }
                            _ => {
                                if matches!(a.elem_size, Some(es) if !a.walk && es > 0) {
                                    n.alloc(&format!("{k}:bytes"), &format!("Set{b}Bytes"));
                                }
                                n.alloc(&format!("{k}:push"), &format!("Push{b}"));
                                if a.walk {
                                    n.alloc(&format!("{k}:set"), &format!("Set{b}"));
                                }
                            }
                        },
                        Shape::Enum { variants, .. } | Shape::Sdu { variants } => {
                            self.alloc_variant_setters(
                                &mut n,
                                &format!("{k}:"),
                                &format!("Set{b}"),
                                variants,
                                matches!(slot.shape, Shape::Sdu { .. }),
                            );
                        }
                    }
                }
            }
            Some(BuilderKind::Blob) => {
                n.alloc("encoding", "SetEncoding");
                for slot in self.r.slots(v) {
                    match &v.ty.kind {
                        ResolvedTypeKind::Union { .. } => {
                            n.alloc(
                                &format!("{}:set", slot.idx),
                                &format!("Set{}", camel(&slot.name)),
                            );
                        }
                        _ => {
                            n.alloc("set_at", "SetAt");
                        }
                    }
                }
            }
            Some(BuilderKind::Variant) => {
                if let Some(slot) = self.r.slots(v).first() {
                    if let Shape::Sdu { variants } | Shape::Enum { variants, .. } = &slot.shape {
                        self.alloc_variant_setters(
                            &mut n,
                            "",
                            "Set",
                            variants,
                            matches!(slot.shape, Shape::Sdu { .. }),
                        );
                    }
                }
            }
            None => {}
        }
        n
    }

    fn alloc_variant_setters(
        &self,
        n: &mut Names,
        key: &str,
        prefix: &str,
        variants: &[Variant<'a>],
        is_sdu: bool,
    ) {
        for (vi, c) in self.variant_camels(variants).iter().enumerate() {
            n.alloc(&format!("{key}var{vi}"), &format!("{prefix}{c}"));
        }
        if !is_sdu {
            n.alloc(&format!("{key}variant"), &format!("{prefix}Variant"));
        }
        n.alloc(&format!("{key}by_name"), &format!("{prefix}VariantByName"));
    }

    pub fn emit_builder(&self, v: &VInfo<'a>, out: &mut String) {
        match self.builder_kind(v) {
            Some(BuilderKind::Struct) => self.emit_struct_builder(v, out),
            Some(BuilderKind::Blob) => self.emit_blob_builder(v, out),
            Some(BuilderKind::Variant) => self.emit_variant_builder(v, out),
            None => {}
        }
    }

    fn builder_header(&self, v: &VInfo<'a>, out: &mut String, fields: &[String]) {
        let n = self.gn(v.ty);
        #[allow(unused_variables)]
        let VNames {
            ext: n_ext,
            params: n_params,
            builder: n_builder,
            new_builder: n_new_builder,
            parse: n_parse,
            validate: n_validate,
            unchecked: n_unchecked,
            parse_with: n_parse_with,
            validate_with: n_validate_with,
            unchecked_with: n_unchecked_with,
            new: n_new,
            init: n_init,
            footprint_fn: n_footprint_fn,
            footprint_const: n_footprint_const,
            params_keys: n_params_keys,
            params_from_buffer: n_params_from_buffer,
            params_from_values: n_params_from_values,
            ..
        } = self.vnames_of(&v.ty.name);
        let b = format!("{n_builder}");
        w!(
            out,
            "// {b} builds a {n}. Setters record the first error (a rejected input"
        );
        w!(
            out,
            "// leaves the builder unchanged); Build, BuildInto and Finish return it."
        );
        w!(out, "type {b} struct {{");
        w!(out, "\terr error");
        for f in fields {
            w!(out, "\t{f}");
        }
        w!(out, "}}");
        w!(out, "");
        w!(out, "// Err returns the first error a setter recorded.");
        w!(out, "func (b *{b}) Err() error {{ return b.err }}");
        w!(out, "");
        w!(out, "func (b *{b}) fail(err error) *{b} {{");
        w!(out, "\tif b.err == nil {{");
        w!(out, "\t\tb.err = err");
        w!(out, "\t}}");
        w!(out, "\treturn b");
        w!(out, "}}");
        w!(out, "");
    }

    fn emit_struct_builder(&self, v: &VInfo<'a>, out: &mut String) {
        #[allow(unused_variables)]
        let VNames {
            ext: n_ext,
            params: n_params,
            builder: n_builder,
            new_builder: n_new_builder,
            parse: n_parse,
            validate: n_validate,
            unchecked: n_unchecked,
            parse_with: n_parse_with,
            validate_with: n_validate_with,
            unchecked_with: n_unchecked_with,
            new: n_new,
            init: n_init,
            footprint_fn: n_footprint_fn,
            footprint_const: n_footprint_const,
            params_keys: n_params_keys,
            params_from_buffer: n_params_from_buffer,
            params_from_values: n_params_from_values,
            ..
        } = self.vnames_of(&v.ty.name);
        let b = format!("{n_builder}");
        let slots = self.r.slots(v);
        let packed = v.packed();
        let names = self.builder_names(v);

        /* (prim slot, source slot, kind) */
        let mut derived: Vec<(usize, usize, &'static str)> = Vec::new();
        for slot in &slots {
            match &slot.shape {
                Shape::Array(a) => {
                    if let Count::Expr(expr) = &a.count {
                        if let Some(j) = sibling_slot(&self.r, v, slot.idx, expr) {
                            derived.push((j, slot.idx, "count"));
                        }
                    }
                }
                Shape::Enum { tag, .. } => {
                    if let Some(j) = sibling_slot(&self.r, v, slot.idx, tag) {
                        derived.push((j, slot.idx, "tag"));
                    }
                }
                _ => {}
            }
        }

        let mut fields = Vec::new();
        for slot in &slots {
            let k = slot.idx;
            match &slot.shape {
                Shape::Prim(_) => fields.push(format!("f{k} uint64")),
                Shape::Array(_) => {
                    fields.push(format!("d{k} []byte"));
                    fields.push(format!("s{k} bool"));
                    fields.push(format!("c{k} uint64"));
                    if walked_elem(slot).is_some() {
                        fields.push(format!("e{k} []uint64"));
                    }
                }
                Shape::View(_) => {
                    fields.push(format!("d{k} []byte"));
                    fields.push(format!("s{k} bool"));
                }
                Shape::Enum { .. } | Shape::Sdu { .. } => {
                    fields.push(format!("d{k} []byte"));
                    fields.push(format!("s{k} bool"));
                    fields.push(format!("t{k} uint64"));
                    fields.push(format!("h{k} bool"));
                }
            }
        }
        self.builder_header(v, out, &fields);
        w!(out, "// {n_new_builder} returns an empty {b}.");
        w!(out, "func {n_new_builder}() *{b} {{ return &{b}{{}} }}");
        w!(out, "");

        for slot in &slots {
            self.emit_struct_setters(v, slot, &derived, &names, out);
        }

        /* Derived count/tag values. */
        for slot in &slots {
            let j = slot.idx;
            if !derived.iter().any(|d| d.0 == j) {
                continue;
            }
            w!(out, "func (b *{b}) derived{j}() uint64 {{");
            w!(out, "\tv := b.f{j}");
            for (dj, src, kind) in &derived {
                if *dj != j {
                    continue;
                }
                if *kind == "count" {
                    w!(out, "\tif b.s{src} {{");
                    w!(out, "\t\tv = b.c{src}");
                    w!(out, "\t}}");
                } else {
                    w!(out, "\tif b.h{src} {{");
                    w!(out, "\t\tv = b.t{src}");
                    w!(out, "\t}}");
                }
            }
            w!(out, "\treturn v");
            w!(out, "}}");
            w!(out, "");
        }
        let value_of = |j: usize| {
            if derived.iter().any(|d| d.0 == j) {
                format!("b.derived{j}()")
            } else {
                format!("b.f{j}")
            }
        };

        /* size */
        w!(out, "func (b *{b}) size() uint64 {{");
        match const_size(v.ty) {
            Some(x) => w!(out, "\treturn {x}"),
            None => {
                w!(out, "\tvar o uint64");
                for slot in &slots {
                    if !packed && slot.align > 1 {
                        w!(out, "\to = (o + {a} - 1) / {a} * {a}", a = slot.align);
                    }
                    w!(out, "\to += {}", slot_len(slot));
                }
                let ta = self.r.tail_align(v);
                if ta > 1 {
                    w!(out, "\treturn (o + {ta} - 1) / {ta} * {ta}");
                } else {
                    w!(out, "\treturn o");
                }
            }
        }
        w!(out, "}}");
        w!(out, "");

        /* write */
        w!(out, "func (b *{b}) write(out []byte) (uint64, error) {{");
        w!(out, "\tsize := b.size()");
        w!(out, "\tif size > uint64(len(out)) {{");
        w!(out, "\t\treturn 0, tnabi.Short(size, uint64(len(out)))");
        w!(out, "\t}}");
        w!(out, "\tout = out[:size]");
        w!(out, "\tclear(out)");
        /* One count field sizes every array referencing it: each array that
        was set must have the count written. */
        for (j, src, kind) in &derived {
            if *kind == "count"
                && derived
                    .iter()
                    .filter(|d| d.0 == *j && d.2 == "count")
                    .count()
                    > 1
            {
                w!(out, "\tif b.s{src} && b.c{src} != {} {{", value_of(*j));
                w!(out, "\t\treturn 0, tnabi.ErrLengthMismatch");
                w!(out, "\t}}");
            }
        }
        w!(out, "\tvar o uint64");
        for slot in &slots {
            let k = slot.idx;
            if !packed && slot.align > 1 {
                w!(out, "\to = (o + {a} - 1) / {a} * {a}", a = slot.align);
            }
            match &slot.shape {
                Shape::Prim(p) => {
                    w!(
                        out,
                        "\tif err := tnabi.Wr(out, o, {}, {}); err != nil {{",
                        prim_size(p),
                        value_of(k)
                    );
                    w!(out, "\t\treturn 0, err");
                    w!(out, "\t}}");
                }
                _ => {
                    w!(out, "\tif b.s{k} {{");
                    if let Some(x) = const_size(slot.ty) {
                        w!(out, "\t\tif len(b.d{k}) != {x} {{");
                        w!(out, "\t\t\treturn 0, tnabi.ErrLengthMismatch");
                        w!(out, "\t\t}}");
                    }
                    w!(
                        out,
                        "\t\tif err := tnabi.Copy(out, o, b.d{k}); err != nil {{"
                    );
                    w!(out, "\t\t\treturn 0, err");
                    w!(out, "\t\t}}");
                    w!(out, "\t}}");
                }
            }
            w!(out, "\to += {}", slot_len(slot));
        }
        w!(out, "\t_ = o");
        w!(out, "\treturn size, nil");
        w!(out, "}}");
        w!(out, "");

        let validate = (!v.has_ext()).then_some(Validate::Plain);
        self.emit_finish_fns(v, validate, out);
        if self.r.has_params_struct(v) {
            let pt = self.params_ty(v);
            #[allow(unused_variables)]
            let VNames {
                ext: n_ext,
                params: n_params,
                builder: n_builder,
                new_builder: n_new_builder,
                parse: n_parse,
                validate: n_validate,
                unchecked: n_unchecked,
                parse_with: n_parse_with,
                validate_with: n_validate_with,
                unchecked_with: n_unchecked_with,
                new: n_new,
                init: n_init,
                footprint_fn: n_footprint_fn,
                footprint_const: n_footprint_const,
                params_keys: n_params_keys,
                params_from_buffer: n_params_from_buffer,
                params_from_values: n_params_from_values,
                ..
            } = self.vnames_of(&v.ty.name);
            w!(
                out,
                "// DynamicParams returns the dynamic parameters of the value built so far"
            );
            w!(out, "// (an error if it would not validate).");
            w!(out, "func (b *{b}) DynamicParams() ({pt}, error) {{");
            w!(out, "\tbytes, err := b.encode()");
            w!(out, "\tif err != nil {{");
            w!(out, "\t\treturn {pt}{{}}, err");
            w!(out, "\t}}");
            w!(out, "\treturn {n_params_from_buffer}(bytes)");
            w!(out, "}}");
            w!(out, "");
        }
    }

    fn emit_struct_setters(
        &self,
        v: &VInfo<'a>,
        slot: &Slot<'a>,
        derived: &[(usize, usize, &'static str)],
        names: &Names,
        out: &mut String,
    ) {
        #[allow(unused_variables)]
        let VNames {
            ext: n_ext,
            params: n_params,
            builder: n_builder,
            new_builder: n_new_builder,
            parse: n_parse,
            validate: n_validate,
            unchecked: n_unchecked,
            parse_with: n_parse_with,
            validate_with: n_validate_with,
            unchecked_with: n_unchecked_with,
            new: n_new,
            init: n_init,
            footprint_fn: n_footprint_fn,
            footprint_const: n_footprint_const,
            params_keys: n_params_keys,
            params_from_buffer: n_params_from_buffer,
            params_from_values: n_params_from_values,
            ..
        } = self.vnames_of(&v.ty.name);
        let b = format!("{n_builder}");
        let k = slot.idx;
        let label = one_line(&format!("{}.{}", v.ty.name, slot.name));
        let nm = |key: &str| names.get(&format!("{k}:{key}"));
        match &slot.shape {
            Shape::Prim(p) => {
                let auto = derived.iter().any(|(j, _, _)| *j == k);
                w!(
                    out,
                    "// {} sets `{label}`{}.",
                    nm("set"),
                    if auto {
                        " (derived automatically when its array/variant is set)"
                    } else {
                        ""
                    }
                );
                w!(
                    out,
                    "func (b *{b}) {}(value {}) *{b} {{",
                    nm("set"),
                    go_prim(p)
                );
                w!(out, "\tb.f{k} = {}", go_to_raw(p, "value"));
                w!(out, "\treturn b");
                w!(out, "}}");
                w!(out, "");
            }
            Shape::Array(a) => {
                let fixed = match a.count {
                    Count::Const(x) => Some(x),
                    Count::Expr(_) => None,
                };
                match &a.elem {
                    Elem::Prim(p) => {
                        let es = prim_size(p);
                        w!(out, "// {} sets the elements of `{label}`.", nm("set"));
                        w!(
                            out,
                            "func (b *{b}) {}(values []{}) *{b} {{",
                            nm("set"),
                            go_prim(p)
                        );
                        if let Some(x) = fixed {
                            w!(out, "\tif len(values) != {x} {{");
                            w!(out, "\t\treturn b.fail(tnabi.ErrLengthMismatch)");
                            w!(out, "\t}}");
                        }
                        w!(out, "\tbytes := make([]byte, len(values)*{es})");
                        w!(out, "\tfor i, value := range values {{");
                        w!(
                            out,
                            "\t\t_ = tnabi.Wr(bytes, uint64(i)*{es}, {es}, {})",
                            go_to_raw(p, "value")
                        );
                        w!(out, "\t}}");
                        w!(
                            out,
                            "\tb.c{k}, b.d{k}, b.s{k} = uint64(len(values)), bytes, true"
                        );
                        w!(out, "\treturn b");
                        w!(out, "}}");
                        w!(out, "");
                        self.emit_bytes_setter(&b, &label, &nm("bytes"), k, es as u64, fixed, out);
                    }
                    _ => {
                        if let Some(es) = a.elem_size.filter(|es| !a.walk && *es > 0) {
                            self.emit_bytes_setter(&b, &label, &nm("bytes"), k, es, fixed, out);
                        }
                        let walked = walked_elem(slot).is_some();
                        w!(
                            out,
                            "// {} appends one encoded element to `{label}`.{}",
                            nm("push"),
                            if walked {
                                format!(" {CHECKED_AT_BUILD}")
                            } else {
                                String::new()
                            }
                        );
                        w!(out, "func (b *{b}) {}(element []byte) *{b} {{", nm("push"));
                        if let Some(es) = a.elem_size {
                            w!(out, "\tif len(element) != {es} {{");
                            w!(out, "\t\treturn b.fail(tnabi.ErrLengthMismatch)");
                            w!(out, "\t}}");
                        }
                        w!(out, "\tb.d{k} = append(b.d{k}, element...)");
                        if walked {
                            w!(out, "\tb.e{k} = append(b.e{k}, uint64(len(b.d{k})))");
                        }
                        w!(out, "\tb.c{k}++");
                        w!(out, "\tb.s{k} = true");
                        w!(out, "\treturn b");
                        w!(out, "}}");
                        w!(out, "");
                        if a.walk {
                            w!(
                                out,
                                "// {} sets every element of `{label}` from their encodings.{}",
                                nm("set"),
                                if walked {
                                    format!(" {CHECKED_AT_BUILD}")
                                } else {
                                    String::new()
                                }
                            );
                            w!(
                                out,
                                "func (b *{b}) {}(elements [][]byte) *{b} {{",
                                nm("set")
                            );
                            w!(out, "\tvar bytes []byte");
                            if walked {
                                w!(out, "\tvar ends []uint64");
                            }
                            w!(out, "\tfor _, element := range elements {{");
                            w!(out, "\t\tbytes = append(bytes, element...)");
                            if walked {
                                w!(out, "\t\tends = append(ends, uint64(len(bytes)))");
                            }
                            w!(out, "\t}}");
                            if walked {
                                w!(out, "\tb.e{k} = ends");
                            }
                            w!(
                                out,
                                "\tb.c{k}, b.d{k}, b.s{k} = uint64(len(elements)), bytes, true"
                            );
                            w!(out, "\treturn b");
                            w!(out, "}}");
                            w!(out, "");
                        }
                    }
                }
            }
            Shape::View(cv) => {
                w!(
                    out,
                    "// {} sets `{label}` from its encoding (e.g. {}.Build output).",
                    nm("set"),
                    self.vnames_of(&cv.ty.name).builder
                );
                w!(out, "func (b *{b}) {}(value []byte) *{b} {{", nm("set"));
                if let Some(sz) = cv.size {
                    w!(out, "\tif len(value) != {sz} {{");
                    w!(out, "\t\treturn b.fail(tnabi.ErrLengthMismatch)");
                    w!(out, "\t}}");
                }
                w!(
                    out,
                    "\tb.d{k}, b.s{k} = append([]byte(nil), value...), true"
                );
                w!(out, "\treturn b");
                w!(out, "}}");
                w!(out, "");
            }
            Shape::Enum { variants, .. } | Shape::Sdu { variants } => {
                let is_sdu = matches!(slot.shape, Shape::Sdu { .. });
                let prefix = self.variant_names(v, slot);
                self.emit_variant_setters(
                    &b,
                    &format!("{k}:"),
                    &label,
                    &prefix,
                    variants,
                    is_sdu,
                    &format!("t{k}"),
                    &format!("h{k}"),
                    &format!("d{k}"),
                    &format!("s{k}"),
                    names,
                    out,
                );
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    fn emit_bytes_setter(
        &self,
        b: &str,
        label: &str,
        name: &str,
        k: usize,
        es: u64,
        fixed: Option<u64>,
        out: &mut String,
    ) {
        w!(
            out,
            "// {name} sets `{label}` from its encoding ({es} bytes per element)."
        );
        w!(out, "func (b *{b}) {name}(value []byte) *{b} {{");
        w!(out, "\tif len(value)%{es} != 0 {{");
        w!(out, "\t\treturn b.fail(tnabi.ErrLengthMismatch)");
        w!(out, "\t}}");
        if let Some(x) = fixed {
            w!(out, "\tif len(value)/{es} != {x} {{");
            w!(out, "\t\treturn b.fail(tnabi.ErrLengthMismatch)");
            w!(out, "\t}}");
        }
        w!(
            out,
            "\tb.c{k}, b.d{k}, b.s{k} = uint64(len(value)/{es}), append([]byte(nil), value...), true"
        );
        w!(out, "\treturn b");
        w!(out, "}}");
        w!(out, "");
    }

    /* Variant selection setters: one per variant, by tag (enums) and by name. */
    #[allow(clippy::too_many_arguments)]
    fn emit_variant_setters(
        &self,
        b: &str,
        key: &str,
        label: &str,
        table: &super::pkgnames::SlotNames,
        variants: &[Variant<'a>],
        is_sdu: bool,
        tag_f: &str,
        has_f: &str,
        data_f: &str,
        set_f: &str,
        names: &Names,
        out: &mut String,
    ) {
        let assign = |out: &mut String, tag: &str| {
            w!(out, "\tb.{tag_f}, b.{has_f} = {tag}, true");
            w!(
                out,
                "\tb.{data_f}, b.{set_f} = append([]byte(nil), payload...), true"
            );
            w!(out, "\treturn b");
        };
        for (vi, var) in variants.iter().enumerate() {
            let tag = if is_sdu { vi as u64 } else { var.tag };
            let name = names.get(&format!("{key}var{vi}"));
            w!(
                out,
                "// {name} selects variant `{}` of `{label}` with its encoded payload.",
                var.name
            );
            w!(out, "func (b *{b}) {name}(payload []byte) *{b} {{");
            if let Some(sz) = var.elem.size() {
                w!(out, "\tif len(payload) != {sz} {{");
                w!(out, "\t\treturn b.fail(tnabi.ErrLengthMismatch)");
                w!(out, "\t}}");
            }
            assign(out, &tag.to_string());
            w!(out, "}}");
            w!(out, "");
        }
        if !is_sdu {
            let name = names.get(&format!("{key}variant"));
            w!(
                out,
                "// {name} selects the `{label}` variant with tag value tag and its encoded payload."
            );
            w!(
                out,
                "func (b *{b}) {name}(tag uint64, payload []byte) *{b} {{"
            );
            w!(out, "\tinfo, ok := {}(tag)", table.by_tag);
            w!(out, "\tif !ok {{");
            w!(out, "\t\treturn b.fail(tnabi.ErrInvalidVariant)");
            w!(out, "\t}}");
            w!(
                out,
                "\tif err := tnabi.CheckPayload(info, payload); err != nil {{"
            );
            w!(out, "\t\treturn b.fail(err)");
            w!(out, "\t}}");
            assign(out, "tag");
            w!(out, "}}");
            w!(out, "");
        }
        let name = names.get(&format!("{key}by_name"));
        w!(
            out,
            "// {name} selects the `{label}` variant named name (as in the ABI) with its encoded payload."
        );
        w!(
            out,
            "func (b *{b}) {name}(name string, payload []byte) *{b} {{"
        );
        w!(out, "\tinfo, ok := {}(name)", table.by_name);
        w!(out, "\tif !ok {{");
        w!(out, "\t\treturn b.fail(tnabi.ErrInvalidVariant)");
        w!(out, "\t}}");
        w!(
            out,
            "\tif err := tnabi.CheckPayload(info, payload); err != nil {{"
        );
        w!(out, "\t\treturn b.fail(err)");
        w!(out, "\t}}");
        assign(out, "info.Tag");
        w!(out, "}}");
        w!(out, "");
    }

    /* checkElements: every element supplied to a walked (jagged) array must
    validate on its own and span exactly its bytes (in place, too, when the
    struct validates by itself). Returns whether it was emitted. */
    fn emit_check_elements(
        &self,
        v: &VInfo<'a>,
        validate: Option<Validate>,
        out: &mut String,
    ) -> bool {
        let n = self.gn(v.ty);
        #[allow(unused_variables)]
        let VNames {
            ext: n_ext,
            params: n_params,
            builder: n_builder,
            new_builder: n_new_builder,
            parse: n_parse,
            validate: n_validate,
            unchecked: n_unchecked,
            parse_with: n_parse_with,
            validate_with: n_validate_with,
            unchecked_with: n_unchecked_with,
            new: n_new,
            init: n_init,
            footprint_fn: n_footprint_fn,
            footprint_const: n_footprint_const,
            params_keys: n_params_keys,
            params_from_buffer: n_params_from_buffer,
            params_from_values: n_params_from_values,
            ..
        } = self.vnames_of(&v.ty.name);
        let mut c = Code::new(1, "return ");
        if matches!(v.ty.kind, ResolvedTypeKind::Struct { .. }) {
            let in_place = matches!(validate, Some(Validate::Plain));
            for slot in self.r.slots(v) {
                let Some(cv) = walked_elem(&slot) else {
                    continue;
                };
                let child_ext = self.info(&cv.vname).is_some_and(|ci| ci.has_ext());
                if child_ext && !in_place {
                    continue;
                }
                let k = slot.idx;
                c.open(&format!("if b.s{k} {{"));
                if in_place {
                    c.l(&format!(
                        "l, err := ({n_ext}{{}}).TnLayout(tnabi.Bytes(bytes), {k})"
                    ));
                    c.check("err");
                }
                if child_ext {
                    c.l(&format!(
                        "e, err := tn_ext_{n}_{k}(tnabi.Bytes(bytes), l, {n_ext}{{}})"
                    ));
                    c.check("err");
                } else {
                    c.l(&format!("e := {}{{}}", self.qext(cv.ty)));
                }
                c.l("var start uint64");
                c.open(&format!("for _, end := range b.e{k} {{"));
                c.l(&format!("got, err := e.TnValidate(b.d{k}[start:end])"));
                c.check("err");
                c.open("if got != end-start {");
                c.l("return tnabi.ErrLengthMismatch");
                c.close();
                if in_place {
                    c.l("here, err := tnabi.Tail(bytes, l.End+start)");
                    c.open("if err != nil {");
                    c.l("return tnabi.ErrLengthMismatch");
                    c.close();
                    c.l("hl, err := e.TnLayout(tnabi.Bytes(here), tnabi.MaxU64)");
                    c.check("err");
                    c.open("if hl.End != end-start {");
                    c.l("return tnabi.ErrLengthMismatch");
                    c.close();
                }
                c.l("start = end");
                c.close();
                c.close();
            }
        }
        if c.s.is_empty() {
            return false;
        }
        w!(
            out,
            "func (b *{n_builder}) checkElements(bytes []byte) error {{"
        );
        out.push_str(&c.s);
        w!(out, "\treturn nil");
        w!(out, "}}");
        w!(out, "");
        true
    }

    /* checkVariants / encode / Build / BuildInto / Finish (needs `size` and `write`). */
    fn emit_finish_fns(&self, v: &VInfo<'a>, validate: Option<Validate>, out: &mut String) {
        let n = self.gn(v.ty);
        #[allow(unused_variables)]
        let VNames {
            ext: n_ext,
            params: n_params,
            builder: n_builder,
            new_builder: n_new_builder,
            parse: n_parse,
            validate: n_validate,
            unchecked: n_unchecked,
            parse_with: n_parse_with,
            validate_with: n_validate_with,
            unchecked_with: n_unchecked_with,
            new: n_new,
            init: n_init,
            footprint_fn: n_footprint_fn,
            footprint_const: n_footprint_const,
            params_keys: n_params_keys,
            params_from_buffer: n_params_from_buffer,
            params_from_values: n_params_from_values,
            ..
        } = self.vnames_of(&v.ty.name);
        let b = format!("{n_builder}");
        /* The selected variant must be the one the tag fields select, and
        every variable-size field must span exactly the bytes it was given. */
        let mut cv = String::new();
        match (&v.ty.kind, validate) {
            (ResolvedTypeKind::Struct { .. }, Some(_)) => {
                let names = self.names(v);
                let sized: Vec<Slot<'a>> = self
                    .r
                    .slots(v)
                    .into_iter()
                    .filter(|s| !matches!(s.shape, Shape::Prim(_)) && const_size(s.ty).is_none())
                    .collect();
                if !sized.is_empty() {
                    w!(
                        cv,
                        "\tl, err := ({n_ext}{{}}).TnLayout(tnabi.Bytes(bytes), tnabi.MaxU64)"
                    );
                    w!(cv, "\tif err != nil {{");
                    w!(cv, "\t\treturn err");
                    w!(cv, "\t}}");
                }
                for s in &sized {
                    let k = s.idx;
                    w!(cv, "\tif l.Len[{k}] != uint64(len(b.d{k})) {{");
                    w!(cv, "\t\treturn tnabi.ErrLengthMismatch");
                    w!(cv, "\t}}");
                    if matches!(s.shape, Shape::Array(_)) {
                        w!(cv, "\tif b.s{k} && l.Aux[{k}] != b.c{k} {{");
                        w!(cv, "\t\treturn tnabi.ErrLengthMismatch");
                        w!(cv, "\t}}");
                    }
                }
                let enums: Vec<Slot<'a>> = self
                    .r
                    .slots(v)
                    .into_iter()
                    .filter(|s| matches!(s.shape, Shape::Enum { .. } | Shape::Sdu { .. }))
                    .collect();
                if !enums.is_empty() {
                    w!(cv, "\tview := {n_unchecked}(bytes)");
                    for s in &enums {
                        let k = s.idx;
                        w!(
                            cv,
                            "\tif b.h{k} && uint64(view.{}()) != b.t{k} {{",
                            self.mname(&names, s, "tag")
                        );
                        w!(cv, "\t\treturn tnabi.ErrInvalidVariant");
                        w!(cv, "\t}}");
                    }
                }
            }
            (_, Some(Validate::Plain)) if v.is_sdu() => {
                w!(
                    cv,
                    "\tif b.h && uint64({n_unchecked}(bytes).Tag()) != b.t {{"
                );
                w!(cv, "\t\treturn tnabi.ErrInvalidVariant");
                w!(cv, "\t}}");
            }
            (_, Some(Validate::WithParams)) => {
                w!(cv, "\tp, err := b.params()");
                w!(cv, "\tif err != nil {{");
                w!(cv, "\t\treturn err");
                w!(cv, "\t}}");
                w!(
                    cv,
                    "\tif b.h && {n_unchecked_with}(bytes, p).Tag() != b.t {{"
                );
                w!(cv, "\t\treturn tnabi.ErrInvalidVariant");
                w!(cv, "\t}}");
            }
            _ => {}
        }
        let has_cv = !cv.is_empty();
        if has_cv {
            w!(out, "func (b *{b}) checkVariants(bytes []byte) error {{");
            out.push_str(&cv);
            w!(out, "\treturn nil");
            w!(out, "}}");
            w!(out, "");
        }
        let check_elements = self.emit_check_elements(v, validate, out);
        let validate_call = |bytes: &str| match validate {
            Some(Validate::Plain) => Some(format!("{n_validate}({bytes})")),
            Some(Validate::WithParams) => Some(format!("b.validateWithParams({bytes})")),
            None => None,
        };
        if validate == Some(Validate::WithParams) {
            w!(
                out,
                "func (b *{b}) validateWithParams(bytes []byte) (int, error) {{"
            );
            w!(out, "\tp, err := b.params()");
            w!(out, "\tif err != nil {{");
            w!(out, "\t\treturn 0, err");
            w!(out, "\t}}");
            w!(out, "\treturn {n_validate_with}(bytes, p)");
            w!(out, "}}");
            w!(out, "");
        }
        /* Post-write checks shared by encode and BuildInto. */
        w!(out, "func (b *{b}) check(bytes []byte) error {{");
        if check_elements {
            w!(out, "\tif err := b.checkElements(bytes); err != nil {{");
            w!(out, "\t\treturn err");
            w!(out, "\t}}");
        }
        if let Some(call) = validate_call("bytes") {
            w!(out, "\tsz, err := {call}");
            w!(out, "\tif err != nil {{");
            w!(out, "\t\treturn err");
            w!(out, "\t}}");
            w!(out, "\tif sz != len(bytes) {{");
            w!(out, "\t\treturn tnabi.ErrLengthMismatch");
            w!(out, "\t}}");
            if has_cv {
                w!(out, "\treturn b.checkVariants(bytes)");
            } else {
                w!(out, "\treturn nil");
            }
        } else {
            w!(out, "\t_ = bytes");
            w!(out, "\treturn nil");
        }
        w!(out, "}}");
        w!(out, "");
        w!(out, "func (b *{b}) encode() ([]byte, error) {{");
        w!(out, "\tif b.err != nil {{");
        w!(out, "\t\treturn nil, b.err");
        w!(out, "\t}}");
        w!(out, "\tbytes := make([]byte, b.size())");
        w!(out, "\tif _, err := b.write(bytes); err != nil {{");
        w!(out, "\t\treturn nil, err");
        w!(out, "\t}}");
        w!(out, "\tif err := b.check(bytes); err != nil {{");
        w!(out, "\t\treturn nil, err");
        w!(out, "\t}}");
        w!(out, "\treturn bytes, nil");
        w!(out, "}}");
        w!(out, "");
        w!(
            out,
            "// Build returns the encoded bytes, or an error if they would not validate."
        );
        w!(
            out,
            "func (b *{b}) Build() ([]byte, error) {{ return b.encode() }}"
        );
        w!(out, "");
        w!(
            out,
            "// BuildInto writes the encoded bytes to the start of target and returns the"
        );
        w!(out, "// size written (only the value's bytes are written).");
        w!(
            out,
            "func (b *{b}) BuildInto(target []byte) (int, error) {{"
        );
        w!(out, "\tif b.err != nil {{");
        w!(out, "\t\treturn 0, b.err");
        w!(out, "\t}}");
        w!(out, "\tsize, err := b.write(target)");
        w!(out, "\tif err != nil {{");
        w!(out, "\t\treturn 0, err");
        w!(out, "\t}}");
        w!(out, "\tif err := b.check(target[:size]); err != nil {{");
        w!(out, "\t\treturn 0, err");
        w!(out, "\t}}");
        w!(out, "\treturn int(size), nil");
        w!(out, "}}");
        w!(out, "");
        match validate {
            Some(Validate::Plain) => {
                w!(
                    out,
                    "// Finish builds the value and wraps it in a validated view."
                );
                w!(out, "func (b *{b}) Finish() ({n}, error) {{");
                w!(out, "\tbytes, err := b.encode()");
                w!(out, "\tif err != nil {{");
                w!(out, "\t\treturn {n}{{}}, err");
                w!(out, "\t}}");
                w!(out, "\treturn {n}{{b: bytes}}, nil");
                w!(out, "}}");
                w!(out, "");
            }
            Some(Validate::WithParams) => {
                w!(
                    out,
                    "// Finish builds the value and wraps it in a validated view."
                );
                w!(out, "func (b *{b}) Finish() ({n}, error) {{");
                w!(out, "\tbytes, err := b.encode()");
                w!(out, "\tif err != nil {{");
                w!(out, "\t\treturn {n}{{}}, err");
                w!(out, "\t}}");
                w!(out, "\tp, _ := b.params()");
                w!(out, "\treturn {n}{{b: bytes, ext: p}}, nil");
                w!(out, "}}");
                w!(out, "");
            }
            None => {}
        }
    }

    /* Builders for fixed-size unions and arrays: a zeroed buffer plus setters. */
    fn emit_blob_builder(&self, v: &VInfo<'a>, out: &mut String) {
        #[allow(unused_variables)]
        let VNames {
            ext: n_ext,
            params: n_params,
            builder: n_builder,
            new_builder: n_new_builder,
            parse: n_parse,
            validate: n_validate,
            unchecked: n_unchecked,
            parse_with: n_parse_with,
            validate_with: n_validate_with,
            unchecked_with: n_unchecked_with,
            new: n_new,
            init: n_init,
            footprint_fn: n_footprint_fn,
            footprint_const: n_footprint_const,
            params_keys: n_params_keys,
            params_from_buffer: n_params_from_buffer,
            params_from_values: n_params_from_values,
            ..
        } = self.vnames_of(&v.ty.name);
        let b = format!("{n_builder}");
        let size = const_size(v.ty).unwrap_or(0);
        let names = self.builder_names(v);
        self.builder_header(v, out, &["bytes []byte".to_string()]);
        w!(
            out,
            "// {n_new_builder} returns a {b} over {size} zero bytes."
        );
        w!(
            out,
            "func {n_new_builder}() *{b} {{ return &{b}{{bytes: make([]byte, {size})}} }}"
        );
        w!(out, "");
        w!(out, "func (b *{b}) buf() []byte {{");
        w!(out, "\tif len(b.bytes) != {size} {{");
        w!(out, "\t\tb.bytes = make([]byte, {size})");
        w!(out, "\t}}");
        w!(out, "\treturn b.bytes");
        w!(out, "}}");
        w!(out, "");
        let enc = names.get("encoding");
        w!(
            out,
            "// {enc} overwrites the whole encoding ({size} bytes)."
        );
        w!(out, "func (b *{b}) {enc}(value []byte) *{b} {{");
        w!(out, "\tif len(value) != {size} {{");
        w!(out, "\t\treturn b.fail(tnabi.ErrLengthMismatch)");
        w!(out, "\t}}");
        w!(out, "\tcopy(b.buf(), value)");
        w!(out, "\treturn b");
        w!(out, "}}");
        w!(out, "");
        for slot in self.r.slots(v) {
            match (&v.ty.kind, &slot.shape) {
                (ResolvedTypeKind::Union { .. }, Shape::Prim(p)) => {
                    let name = names.get(&format!("{}:set", slot.idx));
                    w!(out, "// {name} writes variant `{}`.", slot.name);
                    w!(out, "func (b *{b}) {name}(value {}) *{b} {{", go_prim(p));
                    w!(out, "\tclear(b.buf())");
                    w!(
                        out,
                        "\tif err := tnabi.Wr(b.buf(), 0, {}, {}); err != nil {{",
                        prim_size(p),
                        go_to_raw(p, "value")
                    );
                    w!(out, "\t\treturn b.fail(err)");
                    w!(out, "\t}}");
                    w!(out, "\treturn b");
                    w!(out, "}}");
                    w!(out, "");
                }
                (ResolvedTypeKind::Union { .. }, _) => {
                    let name = names.get(&format!("{}:set", slot.idx));
                    w!(
                        out,
                        "// {name} writes variant `{}` from its encoding (at most {size} bytes).",
                        slot.name
                    );
                    w!(out, "func (b *{b}) {name}(value []byte) *{b} {{");
                    w!(out, "\tif len(value) > {size} {{");
                    w!(out, "\t\treturn b.fail(tnabi.ErrLengthMismatch)");
                    w!(out, "\t}}");
                    w!(out, "\tclear(b.buf())");
                    w!(out, "\tcopy(b.buf(), value)");
                    w!(out, "\treturn b");
                    w!(out, "}}");
                    w!(out, "");
                }
                (ResolvedTypeKind::Array { .. }, Shape::Array(a)) => {
                    let es = a.elem_size.unwrap_or(0);
                    let name = names.get("set_at");
                    /* Bound the index by the element count before forming the
                    byte offset, so no index can overflow `i*es` or `at+es`. */
                    let count = if es > 0 { size / es } else { 0 };
                    let range = |out: &mut String| {
                        w!(out, "\tif i >= {count} {{");
                        w!(out, "\t\treturn b.fail(tnabi.ErrOutOfBounds)");
                        w!(out, "\t}}");
                        w!(out, "\tat := i * {es}");
                    };
                    match &a.elem {
                        Elem::Prim(p) => {
                            w!(out, "// {name} sets element i.");
                            w!(
                                out,
                                "func (b *{b}) {name}(i uint64, value {}) *{b} {{",
                                go_prim(p)
                            );
                            range(out);
                            w!(
                                out,
                                "\tif err := tnabi.Wr(b.buf(), at, {es}, {}); err != nil {{",
                                go_to_raw(p, "value")
                            );
                            w!(out, "\t\treturn b.fail(err)");
                            w!(out, "\t}}");
                            w!(out, "\treturn b");
                            w!(out, "}}");
                        }
                        _ => {
                            w!(
                                out,
                                "// {name} sets element i from its encoding ({es} bytes)."
                            );
                            w!(
                                out,
                                "func (b *{b}) {name}(i uint64, element []byte) *{b} {{"
                            );
                            range(out);
                            w!(out, "\tif len(element) != {es} {{");
                            w!(out, "\t\treturn b.fail(tnabi.ErrLengthMismatch)");
                            w!(out, "\t}}");
                            w!(out, "\tcopy(b.buf()[at:], element)");
                            w!(out, "\treturn b");
                            w!(out, "}}");
                        }
                    }
                    w!(out, "");
                }
                _ => {}
            }
        }
        w!(out, "func (b *{b}) size() uint64 {{ return {size} }}");
        w!(out, "");
        w!(out, "func (b *{b}) write(out []byte) (uint64, error) {{");
        w!(out, "\tif uint64(len(out)) < {size} {{");
        w!(out, "\t\treturn 0, tnabi.Short({size}, uint64(len(out)))");
        w!(out, "\t}}");
        w!(out, "\tcopy(out[:{size}], b.buf())");
        w!(out, "\treturn {size}, nil");
        w!(out, "}}");
        w!(out, "");
        let validate = (!v.has_ext()).then_some(Validate::Plain);
        self.emit_finish_fns(v, validate, out);
    }

    /* Builder for a top-level size-discriminated union or enum: the encoding is
    the selected variant's payload. */
    fn emit_variant_builder(&self, v: &VInfo<'a>, out: &mut String) {
        #[allow(unused_variables)]
        let VNames {
            ext: n_ext,
            params: n_params,
            builder: n_builder,
            new_builder: n_new_builder,
            parse: n_parse,
            validate: n_validate,
            unchecked: n_unchecked,
            parse_with: n_parse_with,
            validate_with: n_validate_with,
            unchecked_with: n_unchecked_with,
            new: n_new,
            init: n_init,
            footprint_fn: n_footprint_fn,
            footprint_const: n_footprint_const,
            params_keys: n_params_keys,
            params_from_buffer: n_params_from_buffer,
            params_from_values: n_params_from_values,
            ..
        } = self.vnames_of(&v.ty.name);
        let b = format!("{n_builder}");
        let slots = self.r.slots(v);
        let Some(slot) = slots.first() else { return };
        let (variants, is_sdu) = match &slot.shape {
            Shape::Sdu { variants } => (variants, true),
            Shape::Enum { variants, .. } => (variants, false),
            _ => return,
        };
        let names = self.builder_names(v);
        self.builder_header(
            v,
            out,
            &[
                "t uint64".into(),
                "h bool".into(),
                "d []byte".into(),
                "s bool".into(),
            ],
        );
        w!(out, "// {n_new_builder} returns an empty {b}.");
        w!(out, "func {n_new_builder}() *{b} {{ return &{b}{{}} }}");
        w!(out, "");
        let prefix = self.slot_names(&v.ty.name, 0);
        self.emit_variant_setters(
            &b, "", &v.ty.name, &prefix, variants, is_sdu, "t", "h", "d", "s", &names, out,
        );
        w!(
            out,
            "func (b *{b}) size() uint64 {{ return uint64(len(b.d)) }}"
        );
        w!(out, "");
        w!(out, "func (b *{b}) write(out []byte) (uint64, error) {{");
        w!(out, "\tsize := b.size()");
        w!(out, "\tif size > uint64(len(out)) {{");
        w!(out, "\t\treturn 0, tnabi.Short(size, uint64(len(out)))");
        w!(out, "\t}}");
        w!(out, "\tcopy(out, b.d)");
        w!(out, "\treturn size, nil");
        w!(out, "}}");
        w!(out, "");
        let pt = self.params_ty(v);
        #[allow(unused_variables)]
        let VNames {
            ext: n_ext,
            params: n_params,
            builder: n_builder,
            new_builder: n_new_builder,
            parse: n_parse,
            validate: n_validate,
            unchecked: n_unchecked,
            parse_with: n_parse_with,
            validate_with: n_validate_with,
            unchecked_with: n_unchecked_with,
            new: n_new,
            init: n_init,
            footprint_fn: n_footprint_fn,
            footprint_const: n_footprint_const,
            params_keys: n_params_keys,
            params_from_buffer: n_params_from_buffer,
            params_from_values: n_params_from_values,
            ..
        } = self.vnames_of(&v.ty.name);
        match enum_builder_tag(&self.r, v) {
            Some(_) => {
                let field = self.ext_fields(v)[0].clone();
                w!(out, "func (b *{b}) params() ({pt}, error) {{");
                w!(out, "\tif !b.h {{");
                w!(out, "\t\treturn {pt}{{}}, tnabi.ErrInvalidVariant");
                w!(out, "\t}}");
                w!(out, "\treturn {pt}{{{field}: b.t}}, nil");
                w!(out, "}}");
                w!(out, "");
                self.emit_finish_fns(v, Some(Validate::WithParams), out);
                w!(
                    out,
                    "// DynamicParams returns the parameters of the value built so far: the tag"
                );
                w!(
                    out,
                    "// the enclosing type must store (an error if no valid variant is selected)."
                );
                w!(out, "func (b *{b}) DynamicParams() ({pt}, error) {{");
                w!(out, "\tif _, err := b.encode(); err != nil {{");
                w!(out, "\t\treturn {pt}{{}}, err");
                w!(out, "\t}}");
                w!(out, "\treturn b.params()");
                w!(out, "}}");
                w!(out, "");
            }
            None => {
                self.emit_finish_fns(v, Some(Validate::Plain), out);
                w!(
                    out,
                    "// DynamicParams returns the dynamic parameters of the value built so far."
                );
                w!(out, "func (b *{b}) DynamicParams() ({pt}, error) {{");
                w!(out, "\tbytes, err := b.encode()");
                w!(out, "\tif err != nil {{");
                w!(out, "\t\treturn {pt}{{}}, err");
                w!(out, "\t}}");
                w!(out, "\treturn {n_params_from_buffer}(bytes)");
                w!(out, "}}");
                w!(out, "");
            }
        }
    }
}

/* Byte length a slot contributes in the builder. */
fn slot_len(slot: &Slot<'_>) -> String {
    let k = slot.idx;
    match (&slot.shape, const_size(slot.ty)) {
        (Shape::Prim(p), _) => format!("{}", prim_size(p)),
        (_, Some(x)) => format!("{x}"),
        _ => format!("uint64(len(b.d{k}))"),
    }
}
