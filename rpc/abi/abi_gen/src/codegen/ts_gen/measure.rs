/* Byte-size measurement of values whose size their own bytes decide.

`measure_fn` emits a TypeScript arrow function `(b: Uint8Array) => number | null`
returning the size of the value at the start of `b`, or `null` when it does
not fit in `b` (or a tag selects no variant). Field references resolve like
the resolver does: the innermost struct first, then enclosing ones, only
earlier fields. A union spans its largest variant and every variant must fit. */

use super::helpers::{
    escape_ts_keyword, expr_to_ts_bigint_with_resolver, needs_endianness_arg, primitive_size,
    primitive_to_dataview_getter,
};
use crate::abi::expr::ExprKind;
use crate::abi::resolved::{ResolvedType, ResolvedTypeKind, Size};
use crate::abi::types::PrimitiveType;
use std::collections::BTreeMap;
use std::fmt::Write;

pub(crate) fn measure_fn(
    ty: &ResolvedType,
    type_lookup: &BTreeMap<String, ResolvedType>,
) -> Option<String> {
    let mut m = Measurer {
        lookup: type_lookup,
        next: 0,
        scopes: vec![BTreeMap::new()],
        depth: 0,
        context: None,
    };
    m.closure(ty)
}

/* `measure_fn` for a value nested in a struct it cannot see (an inline
union's class): references that resolve outside the value read the
TypeScript object `ctx` (field name -> value) the caller passes, as C
passes parent params and Rust the view's context. A missing entry measures
as invalid (null). */
pub(crate) fn measure_fn_with_context(
    ty: &ResolvedType,
    type_lookup: &BTreeMap<String, ResolvedType>,
    ctx: &str,
) -> Option<String> {
    let mut m = Measurer {
        lookup: type_lookup,
        next: 0,
        scopes: vec![BTreeMap::new()],
        depth: 0,
        context: Some(ctx.to_string()),
    };
    m.closure(ty)
}

/* `measure_fn` for a value inside a struct whose earlier values are TS
expressions in `outer` (field name -> bigint expression), so references to
them (an array element's outside enum tag) resolve. */
pub(crate) fn measure_fn_scoped(
    ty: &ResolvedType,
    type_lookup: &BTreeMap<String, ResolvedType>,
    outer: BTreeMap<String, String>,
) -> Option<String> {
    let mut m = Measurer {
        lookup: type_lookup,
        next: 0,
        scopes: vec![outer],
        depth: 0,
        context: None,
    };
    m.closure(ty)
}

/* Like `measure_fn`, returning `{ size, values }` where `values` holds the
primitives at `keys` (paths inside `ty`, e.g. `inner.count`). */
pub(crate) fn measure_values_fn(
    ty: &ResolvedType,
    type_lookup: &BTreeMap<String, ResolvedType>,
    keys: &[String],
    outer: BTreeMap<String, String>,
) -> Option<String> {
    let mut m = Measurer {
        lookup: type_lookup,
        next: 0,
        scopes: vec![outer],
        depth: 0,
        context: None,
    };
    let mut body = String::new();
    m.value(ty, "__root", &mut body)?;
    let mut values = Vec::new();
    for key in keys {
        let var = m.scopes[0].get(&format!("__root.{key}"))?;
        values.push(format!("\"{key}\": {var}"));
    }
    Some(format!(
        "((b: Uint8Array): {{ size: number; values: Record<string, bigint> }} | null => {{ const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; {body}return {{ size: c, values: {{ {} }} }}; }})",
        values.join(", ")
    ))
}

/* Whether reading `ty` checks an enum tag or a size-discriminated union
somewhere, beyond its size. */
pub(crate) fn checks_tags(ty: &ResolvedType, type_lookup: &BTreeMap<String, ResolvedType>) -> bool {
    let m = Measurer {
        lookup: type_lookup,
        next: 0,
        scopes: vec![BTreeMap::new()],
        depth: 0,
        context: None,
    };
    m.checks_tags(ty)
}

/* Scope key suffix recording a fixed array of primitives (its view, offset,
getter, element size, count and endianness argument), for element refs. */
const ARRAY_MARK: &str = "#array";

struct Measurer<'a> {
    lookup: &'a BTreeMap<String, ResolvedType>,
    next: usize,
    /* Values read so far, keyed by their path inside each enclosing struct. */
    scopes: Vec<BTreeMap<String, String>>,
    depth: usize,
    /* The TypeScript object holding values from outside the measured value
    (see `measure_fn_with_context`). */
    context: Option<String>,
}

/* Align the cursor to `alignment` relative to `start`, the enclosing
struct's first byte: a struct's layout does not depend on where it sits
(an unpacked child at byte 1 of a packed parent keeps its fields at
offsets relative to itself). */
fn align_code(out: &mut String, start: &str, alignment: u64) {
    if alignment > 1 {
        writeln!(
            out,
            "if ((c - {start}) % {alignment} !== 0) c += {alignment} - ((c - {start}) % {alignment});"
        )
        .unwrap();
    }
}

impl Measurer<'_> {
    fn fresh(&mut self, stem: &str) -> String {
        self.next += 1;
        format!("{stem}{}", self.next)
    }

    /* `(b) => size | null` for `ty`. */
    fn closure(&mut self, ty: &ResolvedType) -> Option<String> {
        self.depth += 1;
        if self.depth > 32 {
            return None;
        }
        let mut body = String::new();
        self.value(ty, "", &mut body)?;
        self.depth -= 1;
        Some(format!(
            "((b: Uint8Array): number | null => {{ const v = new DataView(b.buffer, b.byteOffset, b.byteLength); let c = 0; void v; {body}return c; }})"
        ))
    }

    /* Each leading `..` steps out one struct scope before the lookup
    (`["..", "count"]` inside `inner` names the parent's `count`, not
    inner's own); the lookup then searches that scope and its enclosing
    ones. */
    fn resolve(&self, path: &[String]) -> Option<String> {
        if let Some(found) = self.resolve_local(path) {
            return Some(found);
        }
        /* Outside the value: the caller's context object. */
        let ctx = self.context.as_ref()?;
        let key = path
            .iter()
            .flat_map(|s| s.split('/'))
            .filter(|s| !s.is_empty() && *s != "." && *s != "..")
            .collect::<Vec<_>>()
            .join(".");
        Some(format!(
            "({ctx}[\"{key}\"] === undefined ? null : __tnU64(__tnToBigInt({ctx}[\"{key}\"])))"
        ))
    }

    fn resolve_local(&self, path: &[String]) -> Option<String> {
        let mut ups = 0usize;
        let mut segments: Vec<&str> = Vec::new();
        for seg in path.iter().flat_map(|s| s.split('/')) {
            match seg {
                "" | "." => {}
                ".." if segments.is_empty() => ups += 1,
                ".." => return None,
                _ => segments.push(seg),
            }
        }
        let key = segments.join(".");
        let visible = self.scopes.len().checked_sub(ups)?;
        let scopes = &self.scopes[..visible];
        if let Some(found) = scopes
            .iter()
            .rev()
            .find_map(|scope| scope.get(&key).cloned())
        {
            return Some(found);
        }
        /* A fixed array's element (`hdr.bits.1`): read from where the walk
        passed the array. */
        let (last, prefix) = segments.split_last()?;
        let index: u64 = last.parse().ok()?;
        let array = scopes.iter().rev().find_map(|scope| {
            scope
                .get(&format!("{}{ARRAY_MARK}", prefix.join(".")))
                .cloned()
        })?;
        let mut parts = array.split('|');
        let (view, offset, getter, size, count, le) = (
            parts.next()?,
            parts.next()?,
            parts.next()?,
            parts.next()?.parse::<u64>().ok()?,
            parts.next()?.parse::<u64>().ok()?,
            parts.next()?,
        );
        if index >= count {
            return None;
        }
        Some(format!(
            "__tnU64(__tnToBigInt({view}.{getter}({offset} + {}{le})))",
            index * size
        ))
    }

    /* `expr` over the values read so far, in checked u64 arithmetic: a
    `bigint | null` expression, null when a step overflows (as C and Rust
    reject it); no step builds a huge value. */
    fn expr(&self, expr: &ExprKind) -> Option<String> {
        let mut resolver = |path: &[String]| self.resolve(path);
        expr_to_ts_bigint_with_resolver(expr, &mut resolver)
    }

    /* Whether reading `ty` checks something beyond its size (an enum tag or
    a size-discriminated union), so a constant-size value is walked too.
    Follows every type reference however deep (the analyzer rejects cycles);
    each named type is explored once. */
    pub(crate) fn checks_tags(&self, ty: &ResolvedType) -> bool {
        self.checks_tags_in(ty, &mut std::collections::BTreeSet::new())
    }

    fn checks_tags_in<'t>(
        &'t self,
        ty: &'t ResolvedType,
        seen: &mut std::collections::BTreeSet<&'t str>,
    ) -> bool {
        match &ty.kind {
            ResolvedTypeKind::Enum { .. } | ResolvedTypeKind::SizeDiscriminatedUnion { .. } => true,
            ResolvedTypeKind::Struct { fields, .. } => fields
                .iter()
                .any(|f| self.checks_tags_in(&f.field_type, seen)),
            ResolvedTypeKind::Union { variants } => variants
                .iter()
                .any(|f| self.checks_tags_in(&f.field_type, seen)),
            ResolvedTypeKind::Array { element_type, .. } => self.checks_tags_in(element_type, seen),
            ResolvedTypeKind::TypeRef { target_name, .. } => {
                /* Explored before means it found no tag (else the walk
                would already have stopped with true). */
                if !seen.insert(target_name.as_str()) {
                    return false;
                }
                self.lookup
                    .get(target_name)
                    .map_or(false, |t| self.checks_tags_in(t, seen))
            }
            ResolvedTypeKind::Primitive { .. } => false,
        }
    }

    fn record(&mut self, key: &str, var: &str) {
        if !key.is_empty() {
            if let Some(scope) = self.scopes.last_mut() {
                scope.insert(key.to_string(), var.to_string());
            }
        }
    }

    fn fixed(out: &mut String, size: u64) {
        writeln!(out, "if (c + {size} > b.length) return null; c += {size};").unwrap();
    }

    /* Statements reading the value at `c` (advancing it). `key` is the value's
    path in the enclosing struct, under which its primitives are recorded. */
    fn value(&mut self, ty: &ResolvedType, key: &str, out: &mut String) -> Option<()> {
        match &ty.kind {
            ResolvedTypeKind::Primitive { prim_type } => {
                let size = primitive_size(prim_type);
                /* Only integers feed size and tag expressions; a float is
                just bytes to the walk (a fractional value has no bigint). */
                if matches!(prim_type, PrimitiveType::FloatingPoint(_)) {
                    Self::fixed(out, size);
                    return Some(());
                }
                let var = self.fresh("x");
                let le = if needs_endianness_arg(prim_type) {
                    ", true"
                } else {
                    ""
                };
                writeln!(
                    out,
                    "if (c + {size} > b.length) return null; const {var} = __tnU64(__tnToBigInt(v.{}(c{le}))); c += {size};",
                    primitive_to_dataview_getter(prim_type)
                )
                .unwrap();
                self.record(key, &var);
            }
            ResolvedTypeKind::Struct { fields, packed, .. } => {
                let start = self.fresh("s");
                writeln!(out, "const {start} = c;").unwrap();
                self.scopes.push(BTreeMap::new());
                /* `__buffer_size` in a struct is the bytes available to it. */
                self.record(
                    "__buffer_size",
                    &format!("__tnToBigInt(b.length - {start})"),
                );
                for field in fields {
                    if !*packed {
                        align_code(out, &start, field.field_type.alignment);
                    }
                    if self.value(&field.field_type, &field.name, out).is_none() {
                        self.scopes.pop();
                        return None;
                    }
                }
                if !*packed && ty.alignment > 1 {
                    let a = ty.alignment;
                    writeln!(
                        out,
                        "if ((c - {start}) % {a} !== 0) c += {a} - ((c - {start}) % {a}); if (c > b.length) return null;"
                    )
                    .unwrap();
                }
                writeln!(out, "void {start};").unwrap();
                let inner = self.scopes.pop().unwrap_or_default();
                if !key.is_empty() {
                    for (k, var) in inner {
                        self.record(&format!("{key}.{k}"), &var);
                    }
                }
            }
            ResolvedTypeKind::Array {
                element_type,
                size_expression,
                ..
            } => {
                if let (Size::Const(total), Size::Const(_)) = (&ty.size, &element_type.size) {
                    if !self.checks_tags(element_type) {
                        if let (ResolvedTypeKind::Primitive { prim_type }, false) =
                            (&element_type.kind, key.is_empty())
                        {
                            if matches!(prim_type, PrimitiveType::Integral(_)) {
                                let view = self.fresh("av");
                                let offset = self.fresh("ao");
                                writeln!(out, "const {view} = v; const {offset} = c;").unwrap();
                                let size = primitive_size(prim_type);
                                let le = if needs_endianness_arg(prim_type) {
                                    ", true"
                                } else {
                                    ""
                                };
                                let count = if size == 0 { 0 } else { total / size };
                                let record = format!(
                                    "{view}|{offset}|{}|{size}|{count}|{le}",
                                    primitive_to_dataview_getter(prim_type)
                                );
                                self.record(&format!("{key}{ARRAY_MARK}"), &record);
                            }
                        }
                        Self::fixed(out, *total);
                        return Some(());
                    }
                }
                /* Counts stay bigint: a count of 2^64-1 zero-byte elements
                is valid and must not be walked one by one. A field read as a
                count can be signed: a negative one sizes nothing. */
                let n = self.fresh("n");
                writeln!(
                    out,
                    "const {n} = {}; if ({n} === null || {n} < 0n) return null;",
                    self.expr(size_expression)?
                )
                .unwrap();
                match element_type.size {
                    Size::Const(es) if !self.checks_tags(element_type) => {
                        writeln!(
                            out,
                            "if (BigInt(c) + {n} * {es}n > BigInt(b.length)) return null; c += Number({n} * {es}n);"
                        )
                        .unwrap();
                    }
                    _ => {
                        /* An element of zero bytes starts where the previous one
                        did, with the same inputs: it stands for all the rest. */
                        let f = self.closure(element_type)?;
                        let mf = self.fresh("m");
                        let s = self.fresh("e");
                        writeln!(
                            out,
                            "const {mf} = {f}; for (let i = 0n; i < {n}; i++) {{ const {s} = {mf}(b.subarray(c)); if ({s} === null) return null; if ({s} === 0) break; c += {s}; }}"
                        )
                        .unwrap();
                    }
                }
            }
            ResolvedTypeKind::Enum {
                tag_expression,
                variants,
                ..
            } => {
                let tag = self.expr(tag_expression)?;
                let s = self.fresh("t");
                writeln!(out, "let {s}: number | null = null;").unwrap();
                /* `as bigint`: a nested closure must not see the tag narrowed
                by an enclosing `case`. */
                writeln!(out, "switch (({tag}) as bigint | null) {{").unwrap();
                for variant in variants {
                    /* A constant-size payload holding tags (an enum payload
                    that is itself an enum) is walked too. */
                    let size = match variant.variant_type.size {
                        Size::Const(n) if !self.checks_tags(&variant.variant_type) => n.to_string(),
                        _ => format!("{}(b.subarray(c))", self.closure(&variant.variant_type)?),
                    };
                    writeln!(out, "  case {}n: {s} = {size}; break;", variant.tag_value).unwrap();
                }
                writeln!(out, "  default: return null;\n}}").unwrap();
                writeln!(
                    out,
                    "if ({s} === null || c + {s} > b.length) return null; c += {s};"
                )
                .unwrap();
            }
            ResolvedTypeKind::Union { variants } => {
                let m = self.fresh("u");
                writeln!(out, "let {m} = 0;").unwrap();
                for variant in variants {
                    let walk = matches!(variant.field_type.size, Size::Variable(_))
                        || self.checks_tags(&variant.field_type);
                    match variant.field_type.size {
                        Size::Const(n) if !walk => {
                            writeln!(out, "{m} = Math.max({m}, {n});").unwrap();
                        }
                        _ => {
                            let f = self.closure(&variant.field_type)?;
                            let s = self.fresh("w");
                            writeln!(
                                out,
                                "{{ const {s} = {f}(b.subarray(c)); if ({s} === null) return null; {m} = Math.max({m}, {s}); }}"
                            )
                            .unwrap();
                        }
                    }
                }
                /* A union spans exactly its largest variant, packed or not,
                as in C, Rust and the resolver (no padding to its alignment;
                an enclosing unpacked struct aligns the field itself). */
                writeln!(out, "if (c + {m} > b.length) return null; c += {m};").unwrap();
            }
            ResolvedTypeKind::SizeDiscriminatedUnion { variants } => {
                let sizes: Vec<String> = variants
                    .iter()
                    .map(|v| v.expected_size.to_string())
                    .collect();
                let a = self.fresh("a");
                writeln!(
                    out,
                    "const {a} = b.length - c; if (![{}].includes({a})) return null;",
                    sizes.join(", ")
                )
                .unwrap();
                /* The selected variant must validate over exactly its size. */
                let mut cases = String::new();
                for variant in variants {
                    if !matches!(variant.variant_type.size, Size::Variable(_))
                        && !self.checks_tags(&variant.variant_type)
                    {
                        continue;
                    }
                    let f = self.closure(&variant.variant_type)?;
                    writeln!(
                        cases,
                        "  case {n}: if ({f}(b.subarray(c, c + {n})) !== {n}) return null; break;",
                        n = variant.expected_size
                    )
                    .unwrap();
                }
                if !cases.is_empty() {
                    writeln!(out, "switch ({a}) {{\n{cases}}}").unwrap();
                }
                writeln!(out, "c += {a};").unwrap();
            }
            ResolvedTypeKind::TypeRef { target_name, .. } => {
                let target = self.lookup.get(target_name);
                match target {
                    /* Structs are read in place (their values stay visible to
                    later fields); an enum's tag names a field of the holder. */
                    Some(target)
                        if matches!(
                            target.kind,
                            ResolvedTypeKind::Struct { .. } | ResolvedTypeKind::Enum { .. }
                        ) =>
                    {
                        self.depth += 1;
                        if self.depth > 32 {
                            return None;
                        }
                        let target = target.clone();
                        let r = self.value(&target, key, out);
                        self.depth -= 1;
                        r?;
                    }
                    _ => match ty.size {
                        Size::Const(n) if !target.map_or(false, |t| self.checks_tags(t)) => {
                            Self::fixed(out, n)
                        }
                        _ => {
                            let r = self.fresh("r");
                            writeln!(
                                out,
                                "const {r} = {}.validate(b.subarray(c)); if (!{r}.ok || {r}.consumed === undefined) return null; c += Number({r}.consumed);",
                                escape_ts_keyword(target_name)
                            )
                            .unwrap();
                        }
                    },
                }
            }
        }
        Some(())
    }
}
