/* Go view/validator/parameter emitter.

The Go backend reuses the Rust backend's layout model (`rust_gen::model`) and
shape analysis (`rust_gen::emit::Emitter`: slots, shapes, parameters, open
slots, deep validation): both backends decide layouts, parameters and errors
with the same code, and the Go walkers below mirror the Rust walkers line by
line (`emit_walk_body`, `emit_validate_fn`, `path_off`, `expr_code`).

For every view `N` this emits, in one Go file per package:
- `type N struct { b []byte; ext N__Ext }` (a view over bytes; it aliases
  them, so setters write through) and `N__Ext` (context from the enclosing
  type) with the exported walker methods `TnLayout`, `TnInit`, `TnValidate`
  and `TnWrap` other generated packages call;
- `ParseN` / `ValidateN` / `UncheckedN` (or the `...With` forms taking the
  context), `NParams` with `NewN` / `InitN` / `FootprintN`;
- accessors, typed variant access (`NFieldRef`), tag constants and variant
  tables. */

use super::code::Code;
use super::names::*;
use super::pkgnames::VNames;
use crate::abi::expr::{ExprKind, LiteralExpr};
use crate::abi::resolved::{ResolvedType, ResolvedTypeKind};
use crate::abi::types::PrimitiveType;
use crate::codegen::rust_gen::emit::{
    ArrayShape, Count, Elem, Emitter, ParamKind, Shape, Slot, VInfo, Variant, ViewRef,
};
use crate::codegen::rust_gen::model::*;
use std::cell::RefCell;
use std::collections::{BTreeSet, HashMap};
use std::fmt::Write;

macro_rules! w {
    ($out:expr, $($arg:tt)*) => { writeln!($out, $($arg)*).unwrap() };
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Mode {
    Layout,
    Init,
}

/* Placeholder the emitter writes for the import name of ABI package `p`;
`go::emit_package` replaces it once every import of the file is known. */
pub fn qualifier_marker(p: &str) -> String {
    format!("\u{1}{p}\u{2}")
}

pub struct GoEmitter<'m, 'a> {
    pub r: Emitter<'m, 'a>,
    pub m: &'m Model<'a>,
    /* Root type name -> ABI package (types of other packages are qualified). */
    pub(crate) pkg_of: HashMap<String, String>,
    cur_pkg: String,
    imports: RefCell<BTreeSet<String>>,
    /* Package-level name tables (see `pkgnames.rs`), by ABI package. */
    pub(crate) tables: RefCell<HashMap<String, std::rc::Rc<super::pkgnames::PkgTable>>>,
}

/* View-level method names that field accessors must not take. */
const VIEW_RESERVED: &[&str] = &["Bytes", "Context", "Size", "Check", "DynamicParams"];

/* Methods of `N__Ext` / `NParams` (fields must not take these names). */
pub const EXT_RESERVED: &[&str] = &[
    "TnLayout",
    "TnInit",
    "TnValidate",
    "TnWrap",
    "Get",
    "Set",
    "Keys",
    "Footprint",
];

impl<'m, 'a> GoEmitter<'m, 'a> {
    pub fn new(m: &'m Model<'a>, cur_pkg: &str, pkg_of: HashMap<String, String>) -> Self {
        Self {
            r: Emitter::new(m),
            m,
            pkg_of,
            cur_pkg: cur_pkg.to_string(),
            imports: RefCell::new(BTreeSet::new()),
            tables: RefCell::new(HashMap::new()),
        }
    }

    /* ABI packages referenced by the code emitted so far. */
    pub fn take_imports(&self) -> BTreeSet<String> {
        std::mem::take(&mut *self.imports.borrow_mut())
    }

    pub fn info(&self, vname: &str) -> Option<VInfo<'a>> {
        self.r.info(vname)
    }

    /* ------------------------------------------------------------------
     * Names
     * ---------------------------------------------------------------- */

    /* Package prefix (`tnp_x.`) for a type of another package. */
    fn qual(&self, resolved_name: &str) -> String {
        let root = resolved_name.split("::").next().unwrap_or(resolved_name);
        match self.pkg_of.get(root) {
            Some(p) if *p != self.cur_pkg => {
                self.imports.borrow_mut().insert(p.clone());
                format!("{}.", qualifier_marker(p))
            }
            _ => String::new(),
        }
    }

    /* Go name of a view (unqualified). */
    pub fn gn(&self, ty: &ResolvedType) -> String {
        self.vnames_of(&ty.name).ty
    }

    /* Go name of a view, qualified when it lives in another package. */
    pub fn qn(&self, ty: &ResolvedType) -> String {
        format!("{}{}", self.qual(&ty.name), self.gn(ty))
    }

    pub fn qext(&self, ty: &ResolvedType) -> String {
        format!("{}{}", self.qual(&ty.name), self.vnames_of(&ty.name).ext)
    }

    /* A package-level name of `ty`, qualified when it lives in another package. */
    pub fn qname(&self, ty: &ResolvedType, pick: impl Fn(&VNames) -> &String) -> String {
        format!("{}{}", self.qual(&ty.name), pick(&self.vnames_of(&ty.name)))
    }

    /* Go field names of `N__Ext`, in `v.ext` order. */
    pub fn ext_fields(&self, v: &VInfo<'a>) -> Vec<String> {
        let raw: Vec<String> = v.ext.iter().map(|e| e.ident.clone()).collect();
        field_names(&raw, EXT_RESERVED)
    }

    pub fn ext_field(&self, v: &VInfo<'a>, key: &str) -> Option<String> {
        let i = v.ext.iter().position(|e| e.key == key)?;
        Some(self.ext_fields(v)[i].clone())
    }

    /* Go field names of `NParams`, in `param_fields` order. */
    pub fn param_go_fields(&self, v: &VInfo<'a>) -> Vec<String> {
        if self.r.has_params_struct(v) {
            let raw: Vec<String> = self
                .r
                .param_fields(v)
                .into_iter()
                .map(|f| f.ident)
                .collect();
            field_names(&raw, EXT_RESERVED)
        } else {
            self.ext_fields(v)
        }
    }

    /* (Go field, ABI path) of every parameter. */
    pub fn param_keys(&self, v: &VInfo<'a>) -> Vec<(String, String)> {
        self.param_go_fields(v)
            .into_iter()
            .zip(self.r.param_keys(v).into_iter().map(|(_, p)| p))
            .collect()
    }

    pub fn params_ty(&self, v: &VInfo<'a>) -> String {
        self.vnames_of(&v.ty.name).params
    }

    /* Base (Camel) of a slot's accessors; empty for the view's own value. */
    pub fn slot_base(&self, slot: &Slot<'a>) -> String {
        if slot.name.is_empty() {
            String::new()
        } else {
            camel(&slot.name)
        }
    }

    pub fn variant_camels(&self, variants: &[Variant<'a>]) -> Vec<String> {
        variant_names(variants.iter().map(|v| v.name.as_str()), &["Tag", "Known"])
    }

    /* Method names of view `v`, allocated in a fixed order. */
    pub fn names(&self, v: &VInfo<'a>) -> Names {
        let mut n = Names::new(VIEW_RESERVED);
        for slot in self.r.slots(v) {
            let k = slot.idx;
            let b = self.slot_base(&slot);
            let own = slot.name.is_empty();
            let mut a = |key: &str, want: String| {
                n.alloc(&format!("{k}:{key}"), &want);
            };
            match &slot.shape {
                Shape::Prim(_) => {
                    a("get", b.clone());
                    a("set", format!("Set{b}"));
                }
                Shape::Array(arr) => {
                    if own {
                        a("len", "Len".into());
                        a("bytes", "ElementsBytes".into());
                        a("at", "At".into());
                        a("set_at", "SetAt".into());
                        if matches!(arr.elem, Elem::Prim(_)) {
                            a("set_all", "SetAll".into());
                        }
                    } else {
                        if matches!(&arr.elem, Elem::Prim(p) if prim_is_byte(p)) {
                            a("get", b.clone());
                        }
                        a("len", format!("{b}Len"));
                        a("bytes", format!("{b}Bytes"));
                        if !matches!(arr.elem, Elem::Opaque(_)) {
                            a("at", format!("{b}At"));
                            a("set_at", format!("Set{b}At"));
                        }
                        if matches!(arr.elem, Elem::Prim(_)) {
                            a("set_all", format!("Set{b}"));
                        }
                    }
                }
                Shape::View(_) => {
                    a("get", b.clone());
                    a("set", format!("Set{b}"));
                }
                Shape::Enum { variants, .. } | Shape::Sdu { variants } => {
                    let vc = self.variant_camels(variants);
                    if own {
                        a("tag", "Tag".into());
                        a("get", "Variant".into());
                        a("body", "Body".into());
                        a("set_body", "SetBody".into());
                    } else {
                        a("tag", format!("{b}Tag"));
                        a("get", b.clone());
                        a("body", format!("{b}Body"));
                        a("set_body", format!("Set{b}Body"));
                    }
                    for (vi, (var, c)) in variants.iter().zip(&vc).enumerate() {
                        a(&format!("as{vi}"), format!("{b}As{c}"));
                        if matches!(var.elem, Elem::Prim(_)) {
                            a(&format!("setas{vi}"), format!("Set{b}As{c}"));
                        }
                    }
                }
            }
        }
        n
    }

    pub fn mname(&self, names: &Names, slot: &Slot<'a>, key: &str) -> String {
        names.get(&format!("{}:{}", slot.idx, key))
    }

    /* `N<Field>Ref` (typed active variant) of an enum / SDU slot. */
    pub fn ref_ty(&self, v: &VInfo<'a>, slot: &Slot<'a>) -> String {
        self.slot_names(&v.ty.name, slot.idx).ref_ty
    }

    /* Variant table / lookup names of an enum or SDU slot. */
    pub fn variant_names(&self, v: &VInfo<'a>, slot: &Slot<'a>) -> super::pkgnames::SlotNames {
        self.slot_names(&v.ty.name, slot.idx)
    }

    pub fn tag_const_names(&self, v: &VInfo<'a>, slot: &Slot<'a>) -> Vec<String> {
        self.slot_names(&v.ty.name, slot.idx).tags
    }

    /* ------------------------------------------------------------------
     * Expressions
     * ---------------------------------------------------------------- */

    /* Ext value of a child inside walker code (`d`, `l`, `ext` in scope). */
    fn child_ext(&self, c: &mut Code, v: &VInfo<'a>, suffix: &str, child: &ViewRef<'a>) -> String {
        match self.info(&child.vname) {
            Some(ci) if ci.has_ext() => {
                c.val(&format!("tn_ext_{}_{}(d, l, ext)", self.gn(v.ty), suffix))
            }
            _ => format!("({}{{}})", self.qext(child.ty)),
        }
    }

    /* Offset (relative to the view's data) of a path owned by `v`. */
    fn path_off(
        &self,
        c: &mut Code,
        v: &VInfo<'a>,
        segs: &[Seg],
    ) -> Option<(String, PrimitiveType)> {
        let mut sc = c.clone();
        let slots = self.r.slots(v);
        let first = match segs.first()? {
            Seg::Field(f) => f,
            Seg::Index(_) => return None,
        };
        let slot = slots.iter().find(|s| &s.name == first)?;
        let mut cst: Option<u64> = slot.static_off;
        let mut expr: String = match slot.static_off {
            Some(x) => format!("uint64({x})"),
            None => format!("l.Off[{}]", slot.idx),
        };
        let mut cur: &'a ResolvedType = slot.ty;
        for (depth, seg) in segs[1..].iter().enumerate() {
            let raw = cur;
            let d = self.m.deref(cur);
            match (seg, &d.kind) {
                (Seg::Field(name), ResolvedTypeKind::Struct { fields, .. }) => {
                    let j = fields.iter().position(|f| &f.name == name)?;
                    match fields[j].offset {
                        Some(x) => {
                            if let Some(b) = cst {
                                cst = Some(b + x);
                                expr = format!("uint64({})", b + x);
                            } else {
                                expr = sc.val(&format!("tnabi.Add({expr}, {x})"));
                            }
                        }
                        None => {
                            let cv = self.r.view_ref(raw)?;
                            let cinfo = self.info(&cv.vname)?;
                            let ext = if !cinfo.has_ext() {
                                format!("({}{{}})", self.qext(cv.ty))
                            } else if depth == 0 && !cv.named {
                                sc.val(&format!("tn_ext_{}_{}(d, l, ext)", self.gn(v.ty), slot.idx))
                            } else {
                                return None;
                            };
                            let s = sc.val(&format!("tnabi.Sub(d, {expr})"));
                            let cl =
                                sc.val_shift(&format!("{ext}.TnLayout({s}, tnabi.MaxU64)"), &expr);
                            expr = sc.val(&format!("tnabi.Add({expr}, {cl}.Off[{j}])"));
                            cst = None;
                        }
                    }
                    cur = &fields[j].field_type;
                }
                (Seg::Index(i), ResolvedTypeKind::Array { element_type, .. }) => {
                    let es = const_size(self.m.deref(element_type))?;
                    let add = es * (*i as u64);
                    if let Some(b) = cst {
                        cst = Some(b + add);
                        expr = format!("uint64({})", b + add);
                    } else {
                        expr = sc.val(&format!("tnabi.Add({expr}, {add})"));
                    }
                    cur = element_type;
                }
                _ => return None,
            }
        }
        let prim = match &self.m.deref(cur).kind {
            ResolvedTypeKind::Primitive { prim_type } => prim_type.clone(),
            _ => return None,
        };
        *c = sc;
        Some((expr, prim))
    }

    /* Value of a resolved reference inside view `v` (`d`, `l`, `ext` in scope). */
    fn ref_value(&self, c: &mut Code, v: &VInfo<'a>, r: &RefKind<'a>) -> String {
        match r {
            RefKind::BufferSize => c.val("d.Avail()"),
            RefKind::External(raw) => match self.ext_field(v, &format!("?|{}", raw)) {
                Some(f) => format!("ext.{f}"),
                None => c.val("tnabi.Fail(tnabi.ErrMissingParam)"),
            },
            RefKind::Field(t) => {
                if v.is_struct() && t.owner == v.ancestors.len() {
                    match self.path_off(c, v, &t.segs) {
                        Some((off, prim)) => {
                            let raw = c.val(&format!("d.Get({off}, {})", prim_size(&prim)));
                            super::names::raw_to_value(&prim, &raw)
                        }
                        None => c.val("tnabi.Fail(tnabi.ErrUnsupported)"),
                    }
                } else {
                    match self.ext_field(v, &t.key()) {
                        Some(f) => format!("ext.{f}"),
                        None => c.val("tnabi.Fail(tnabi.ErrMissingParam)"),
                    }
                }
            }
        }
    }

    fn expr(&self, c: &mut Code, v: &VInfo<'a>, frames: &[Frame<'a>], e: &ExprKind) -> String {
        let bin = |c: &mut Code, l: &ExprKind, r: &ExprKind, f: &str| {
            let a = self.expr(c, v, frames, l);
            let b = self.expr(c, v, frames, r);
            c.val(&format!("{f}({a}, {b})"))
        };
        let pure = |c: &mut Code, l: &ExprKind, r: &ExprKind, f: &dyn Fn(&str, &str) -> String| {
            let a = self.expr(c, v, frames, l);
            let b = self.expr(c, v, frames, r);
            f(&a, &b)
        };
        match e {
            ExprKind::Literal(lit) => {
                let val: u64 = match lit {
                    LiteralExpr::U64(x) => *x,
                    LiteralExpr::U32(x) => *x as u64,
                    LiteralExpr::U16(x) => *x as u64,
                    LiteralExpr::U8(x) => *x as u64,
                    LiteralExpr::I64(x) => *x as u64,
                    LiteralExpr::I32(x) => *x as i64 as u64,
                    LiteralExpr::I16(x) => *x as i64 as u64,
                    LiteralExpr::I8(x) => *x as i64 as u64,
                };
                format!("uint64({val})")
            }
            ExprKind::Sizeof(_) | ExprKind::Alignof(_) => {
                match self.m.resolver.evaluate_constant_expression(e) {
                    Some(x) => format!("uint64({x})"),
                    None => c.val("tnabi.Fail(tnabi.ErrUnsupported)"),
                }
            }
            ExprKind::FieldRef(r) => {
                let resolved = self.m.resolve(&r.path, frames);
                self.ref_value(c, v, &resolved)
            }
            ExprKind::Add(x) => bin(c, &x.left, &x.right, "tnabi.EAdd"),
            ExprKind::Sub(x) => bin(c, &x.left, &x.right, "tnabi.ESub"),
            ExprKind::Mul(x) => bin(c, &x.left, &x.right, "tnabi.EMul"),
            ExprKind::Div(x) => bin(c, &x.left, &x.right, "tnabi.EDiv"),
            ExprKind::Mod(x) => bin(c, &x.left, &x.right, "tnabi.EMod"),
            ExprKind::Pow(x) => bin(c, &x.left, &x.right, "tnabi.EPow"),
            ExprKind::LeftShift(x) => bin(c, &x.left, &x.right, "tnabi.EShl"),
            ExprKind::RightShift(x) => pure(c, &x.left, &x.right, &|a, b| {
                format!("tnabi.EShr({a}, {b})")
            }),
            ExprKind::BitAnd(x) => pure(c, &x.left, &x.right, &|a, b| format!("({a} & {b})")),
            ExprKind::BitOr(x) => pure(c, &x.left, &x.right, &|a, b| format!("({a} | {b})")),
            ExprKind::BitXor(x) => pure(c, &x.left, &x.right, &|a, b| format!("({a} ^ {b})")),
            ExprKind::Eq(x) => pure(c, &x.left, &x.right, &|a, b| {
                format!("tnabi.B2U({a} == {b})")
            }),
            ExprKind::Ne(x) => pure(c, &x.left, &x.right, &|a, b| {
                format!("tnabi.B2U({a} != {b})")
            }),
            ExprKind::Lt(x) => pure(c, &x.left, &x.right, &|a, b| {
                format!("tnabi.B2U({a} < {b})")
            }),
            ExprKind::Gt(x) => pure(c, &x.left, &x.right, &|a, b| {
                format!("tnabi.B2U({a} > {b})")
            }),
            ExprKind::Le(x) => pure(c, &x.left, &x.right, &|a, b| {
                format!("tnabi.B2U({a} <= {b})")
            }),
            ExprKind::Ge(x) => pure(c, &x.left, &x.right, &|a, b| {
                format!("tnabi.B2U({a} >= {b})")
            }),
            ExprKind::And(x) => {
                /* Short-circuit: the right operand (and its errors) only when needed. */
                let a = self.expr(c, v, frames, &x.left);
                let t = c.t();
                c.l(&format!("var {t} uint64"));
                c.open(&format!("if {a} != 0 {{"));
                let b = self.expr(c, v, frames, &x.right);
                c.l(&format!("{t} = tnabi.B2U({b} != 0)"));
                c.close();
                t
            }
            ExprKind::Or(x) => {
                let a = self.expr(c, v, frames, &x.left);
                let t = c.t();
                c.l(&format!("{t} := uint64(1)"));
                c.open(&format!("if {a} == 0 {{"));
                let b = self.expr(c, v, frames, &x.right);
                c.l(&format!("{t} = tnabi.B2U({b} != 0)"));
                c.close();
                t
            }
            ExprKind::Xor(x) => pure(c, &x.left, &x.right, &|a, b| {
                format!("(tnabi.B2U({a} != 0) ^ tnabi.B2U({b} != 0))")
            }),
            ExprKind::BitNot(x) => {
                let a = self.expr(c, v, frames, &x.operand);
                format!("(^{a})")
            }
            ExprKind::Neg(x) => {
                let a = self.expr(c, v, frames, &x.operand);
                c.val(&format!("tnabi.ENeg({a})"))
            }
            ExprKind::Not(x) => {
                let a = self.expr(c, v, frames, &x.operand);
                format!("tnabi.B2U({a} == 0)")
            }
            ExprKind::Popcount(x) => {
                let a = self.expr(c, v, frames, &x.operand);
                format!("tnabi.Popcount({a})")
            }
        }
    }

    /* Statements building the ext struct of `child` from inside slot `k` of `v`. */
    fn ext_init_code(&self, c: &mut Code, v: &VInfo<'a>, k: usize, child: &VInfo<'a>) -> String {
        let frames = self.r.frames_at(v, k);
        let fields = self.ext_fields(child);
        let mut parts = Vec::new();
        for (var, f) in child.ext.iter().zip(&fields) {
            let value = if let Some(raw) = &var.external_path {
                let path: Vec<String> = raw.split('.').map(|s| s.to_string()).collect();
                let r = self.m.resolve(&path, &frames);
                self.ref_value(c, v, &r)
            } else if let Some(t) = &var.target {
                self.ref_value(c, v, &RefKind::Field(t.clone()))
            } else {
                c.val("tnabi.Fail(tnabi.ErrMissingParam)")
            };
            parts.push(format!("{f}: {value}"));
        }
        format!("{}{{{}}}", self.qext(child.ty), parts.join(", "))
    }

    /* ------------------------------------------------------------------
     * Types
     * ---------------------------------------------------------------- */

    pub fn emit_view(&self, v: &VInfo<'a>, out: &mut String) {
        self.emit_view_types(v, out);
        self.emit_walkers(v, out);
        self.emit_ctors(v, out);
        self.emit_variant_meta(v, out);
        if self.r.has_params_struct(v) {
            self.emit_params_impl(v, out);
        } else if self.r.has_ext_params(v) {
            self.emit_ext_params_impl(v, out);
        }
        self.emit_accessors(v, out);
    }

    fn emit_view_types(&self, v: &VInfo<'a>, out: &mut String) {
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
        w!(out, "/* ---- {} ---- */", one_line(&v.ty.name));
        w!(out, "");
        w!(
            out,
            "// {n_ext} is the context a {n} view needs from its enclosing type."
        );
        if v.ext.is_empty() {
            w!(out, "type {n_ext} struct{{}}");
        } else {
            w!(out, "type {n_ext} struct {{");
            for (e, f) in v.ext.iter().zip(self.ext_fields(v)) {
                w!(
                    out,
                    "\t// {f} is referenced as `{}`.",
                    e.key.split('|').nth(1).unwrap_or("")
                );
                w!(out, "\t{f} uint64");
            }
            w!(out, "}}");
        }
        w!(out, "");
        if let Some(c) = &v.ty.comment {
            w!(out, "// {n}: {}", one_line(c));
            w!(out, "//");
        }
        w!(
            out,
            "// {n} is a zero-copy view over `{}` bytes. It aliases the bytes it",
            one_line(&v.ty.name)
        );
        w!(
            out,
            "// wraps, so setters write through. Accessors never panic: on bytes that"
        );
        w!(
            out,
            "// no longer form a valid layout (after a setter rewrote a length or tag"
        );
        w!(out, "// field) they read zeros; Check re-validates.");
        w!(out, "type {n} struct {{");
        w!(out, "\tb   []byte");
        w!(out, "\text {n_ext}");
        w!(out, "}}");
        w!(out, "");
        for slot in self.r.slots(v) {
            if let Shape::Enum { variants, .. } | Shape::Sdu { variants } = &slot.shape {
                let rn = self.ref_ty(v, &slot);
                let vc = self.variant_camels(variants);
                let is_sdu = matches!(slot.shape, Shape::Sdu { .. });
                w!(
                    out,
                    "// {rn} is the active variant of `{}`: Known is set when Tag",
                    self.r.slot_label(v, &slot)
                );
                if is_sdu {
                    w!(
                        out,
                        "// (the variant index) selects a variant, and only that variant's field is set."
                    );
                } else {
                    w!(
                        out,
                        "// selects a declared variant, and only that variant's field is set."
                    );
                }
                w!(out, "type {rn} struct {{");
                w!(out, "\tTag   uint64");
                w!(out, "\tKnown bool");
                for (var, c) in variants.iter().zip(&vc) {
                    w!(out, "\t{c} {}", self.payload_ty(&var.elem));
                }
                w!(out, "}}");
                w!(out, "");
            }
        }
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
            let fields = self.r.param_fields(v);
            w!(
                out,
                "// {pt} holds the dynamic parameters of `{}`.",
                one_line(&v.ty.name)
            );
            if fields.is_empty() {
                w!(out, "type {pt} struct{{}}");
            } else {
                w!(out, "type {pt} struct {{");
                for (f, g) in fields.iter().zip(self.param_go_fields(v)) {
                    match f.kind {
                        ParamKind::SduVariant(_) => w!(
                            out,
                            "\t// {g}: variant index of the size-discriminated union (ABI path: {}).",
                            f.doc
                        ),
                        ParamKind::PayloadSize(_) => w!(
                            out,
                            "\t// {g}: encoded byte size of `{}` (ABI path: {}).",
                            f.doc.trim_end_matches(".payload_size"),
                            f.doc
                        ),
                        ParamKind::UnionSize => w!(
                            out,
                            "\t// {g}: encoded byte size of the union, i.e. of its largest variant (ABI path: {}).",
                            f.doc
                        ),
                        _ => w!(out, "\t// {g}: ABI path {}.", f.doc),
                    }
                    w!(out, "\t{g} uint64");
                }
                w!(out, "}}");
            }
            w!(out, "");
        } else if self.r.has_ext_params(v) {
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
                "// {pt} holds the dynamic parameters of `{}`: the values it references",
                one_line(&v.ty.name)
            );
            w!(out, "// from outside its bytes.");
            w!(out, "type {pt} = {n_ext}");
            w!(out, "");
        }
    }

    /* Go type of a variant payload. */
    pub fn payload_ty(&self, e: &Elem<'a>) -> String {
        match e {
            Elem::Prim(p) => go_prim(p).to_string(),
            Elem::View(c) => self.qn(c.ty),
            Elem::Opaque(_) => "[]byte".to_string(),
        }
    }

    /* ------------------------------------------------------------------
     * Walkers
     * ---------------------------------------------------------------- */

    fn emit_walkers(&self, v: &VInfo<'a>, out: &mut String) {
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
        let slots = self.r.slots(v);
        let nn = slots.len();

        /* Layout */
        w!(
            out,
            "// TnLayout computes the offset and size of every field of a {n}, stopping"
        );
        w!(out, "// before field `stop` (tnabi.MaxU64: all of them).");
        w!(
            out,
            "func (ext {n_ext}) TnLayout(d tnabi.Buf, stop uint64) (*tnabi.Layout, error) {{"
        );
        let mut c = Code::new(1, "return nil, ");
        c.l(&format!("l := tnabi.NewLayout({nn})"));
        if let Some(x) = const_size(v.ty).filter(|x| *x > 0) {
            c.open(&format!("if stop == tnabi.MaxU64 && d.Len() < {x} {{"));
            c.ret_err(&format!("tnabi.Short({x}, d.Len())"));
            c.close();
        }
        self.walk_body(&mut c, v, &slots, Mode::Layout);
        out.push_str(&c.s);
        w!(out, "}}");
        w!(out, "");

        /* Init */
        let has_p = self.r.has_params_struct(v);
        w!(
            out,
            "// TnInit zero-initializes a {n} in place (writing any supplied parameters)"
        );
        w!(out, "// and returns its size.");
        if has_p {
            w!(
                out,
                "func (ext {n_ext}) TnInit(d tnabi.BufMut, p *{}) (uint64, error) {{",
                self.params_ty(v)
            );
        } else {
            w!(
                out,
                "func (ext {n_ext}) TnInit(d tnabi.BufMut) (uint64, error) {{"
            );
        }
        let mut c = Code::new(1, "return 0, ");
        c.l(&format!("l := tnabi.NewLayout({nn})"));
        if has_p && v.is_var_union() {
            let f = self.param_field_of(v, |k| matches!(k, ParamKind::UnionSize));
            c.open("if p != nil {");
            c.unit(&format!("d.Zero(0, p.{f})"));
            c.l(&format!("return p.{f}, nil"));
            c.close();
        }
        self.walk_body(&mut c, v, &slots, Mode::Init);
        out.push_str(&c.s);
        w!(out, "}}");
        w!(out, "");

        /* Validate */
        w!(
            out,
            "// TnValidate validates the layout, nested types and enum payloads of a {n}"
        );
        w!(out, "// and returns the consumed size.");
        w!(
            out,
            "func (ext {n_ext}) TnValidate(b []byte) (uint64, error) {{"
        );
        let mut c = Code::new(1, "return 0, ");
        c.l("d := tnabi.Bytes(b)");
        c.l("l, err := ext.TnLayout(d, tnabi.MaxU64)");
        c.open("if err != nil {");
        c.open("return 0, tnabi.Measured(err, b, func(m tnabi.Buf) (uint64, error) {");
        c.l("ml, err := ext.TnLayout(m, tnabi.MaxU64)");
        c.open("if err != nil {");
        c.l("return 0, err");
        c.close();
        c.l("return ml.End, nil");
        c.ind_close_paren();
        c.close();
        self.validate_body(&mut c, v, &slots);
        c.l("return l.End, nil");
        out.push_str(&c.s);
        w!(out, "}}");
        w!(out, "");

        w!(
            out,
            "// TnWrap wraps b as a {n} with this context, without validating it."
        );
        w!(
            out,
            "func (ext {n_ext}) TnWrap(b []byte) {n} {{ return {n}{{b: b, ext: ext}} }}"
        );
        w!(out, "");

        self.emit_expr_fns(v, &slots, out);
    }

    fn param_field_of(&self, v: &VInfo<'a>, pred: impl Fn(&ParamKind<'a>) -> bool) -> String {
        let fields = self.r.param_fields(v);
        let go = self.param_go_fields(v);
        fields
            .iter()
            .zip(go)
            .find(|(f, _)| pred(&f.kind))
            .map(|(_, g)| g)
            .unwrap_or_default()
    }

    fn payload_param(&self, v: &VInfo<'a>, k: usize) -> Option<String> {
        let fields = self.r.param_fields(v);
        let go = self.param_go_fields(v);
        fields
            .iter()
            .zip(go)
            .find(|(f, _)| matches!(f.kind, ParamKind::PayloadSize(i) if i == k))
            .map(|(_, g)| g)
    }

    /* Child walker calls (`d`, `ext`, `l` in scope). */
    fn layout_end(&self, c: &mut Code, base: &str, e: &str) -> String {
        let s = c.val(&format!("tnabi.Sub(d, {base})"));
        let cl = c.val_shift(&format!("{e}.TnLayout({s}, tnabi.MaxU64)"), base);
        format!("{cl}.End")
    }

    fn init_call(&self, c: &mut Code, child: &ViewRef<'a>, base: &str, e: &str) -> String {
        let has_p = self
            .info(&child.vname)
            .map(|i| self.r.has_params_struct(&i))
            .unwrap_or(false);
        let s = c.val(&format!("tnabi.SubMut(d, {base})"));
        let arg = if has_p { ", nil" } else { "" };
        c.val_shift(&format!("{e}.TnInit({s}{arg})"), base)
    }

    fn walk_body(&self, c: &mut Code, v: &VInfo<'a>, slots: &[Slot<'a>], mode: Mode) {
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
        let is_union = matches!(v.ty.kind, ResolvedTypeKind::Union { .. });
        let csize = const_size(v.ty);
        if let (Mode::Init, Some(x)) = (mode, csize) {
            c.unit(&format!("d.Zero(0, {x})"));
        }
        c.l("var o uint64");
        if is_union {
            c.l("var uend uint64");
        }
        for slot in slots {
            let k = slot.idx;
            c.l(&format!(
                "/* {} */",
                if slot.name.is_empty() {
                    "value"
                } else {
                    &slot.name
                }
            ));
            if is_union {
                c.l("o = 0");
                if mode == Mode::Init && csize.is_none() && k > 0 {
                    /* Variable-size unions are initialized through their first variant. */
                    continue;
                }
            } else if slot.align > 1 {
                if mode == Mode::Init {
                    c.l(&format!("before{k} := o"));
                    let t = c.val(&format!("tnabi.Align(o, {})", slot.align));
                    c.l(&format!("o = {t}"));
                    c.unit(&format!("d.Zero(before{k}, o-before{k})"));
                } else {
                    let t = c.val(&format!("tnabi.Align(o, {})", slot.align));
                    c.l(&format!("o = {t}"));
                }
            }
            if mode == Mode::Layout {
                c.open(&format!("if stop == {k} {{"));
                c.l("l.End = o");
                c.l("return l, nil");
                c.close();
            }
            c.l(&format!("l.Off[{k}] = o"));
            let has_writes = mode == Mode::Init
                && v.is_root_struct()
                && v.params.iter().any(|t| t.order.first() == Some(&k));
            let sized = if mode == Mode::Init && self.r.open_slot(v, slot) {
                self.payload_param(v, k)
            } else {
                None
            };
            c.open("{");
            c.l("var sz uint64");
            /* `e` of a variable-size view slot, kept for the re-layout below. */
            let mut view_ext: Option<String> = None;
            match &slot.shape {
                Shape::Prim(p) => {
                    let sz = prim_size(p);
                    if mode == Mode::Init {
                        c.unit(&format!("d.Zero(o, {sz})"));
                    }
                    c.l(&format!("sz = {sz}"));
                }
                Shape::Array(a) => self.walk_array(c, v, slot, a, mode, &sized),
                Shape::View(cv) => {
                    if let Some(sz) = cv.size {
                        if mode == Mode::Init {
                            c.unit(&format!("d.Zero(o, {sz})"));
                        }
                        c.l(&format!("sz = {sz}"));
                    } else {
                        let e = self.child_ext(c, v, &format!("{k}"), cv);
                        let ev = c.t();
                        c.l(&format!("{ev} := {e}"));
                        view_ext = Some(ev.clone());
                        if mode == Mode::Layout {
                            let end = self.layout_end(c, "o", &ev);
                            c.l(&format!("sz = {end}"));
                        } else if let Some(f) = &sized {
                            c.open("if p != nil {");
                            c.unit(&format!("d.Zero(o, p.{f})"));
                            c.l(&format!("sz = p.{f}"));
                            c.mid("} else {");
                            let x = self.init_call(c, cv, "o", &ev);
                            c.l(&format!("sz = {x}"));
                            c.close();
                        } else {
                            let x = self.init_call(c, cv, "o", &ev);
                            c.l(&format!("sz = {x}"));
                        }
                    }
                }
                Shape::Enum { variants, .. } => {
                    let tag = c.val(&format!("tn_tag_{n}_{k}(d, l, ext)"));
                    c.l(&format!("l.Aux[{k}] = {tag}"));
                    c.open(&format!("switch {tag} {{"));
                    let mut seen = BTreeSet::new();
                    for (vi, var) in variants.iter().enumerate() {
                        if !seen.insert(var.tag) {
                            continue;
                        }
                        c.case_(&format!("case {}:", var.tag));
                        let wrap = matches!((&sized, &var.elem), (Some(_), Elem::View(cv)) if self.r.open_view(cv));
                        if wrap {
                            let f = sized.clone().unwrap();
                            c.open("if p != nil {");
                            c.unit(&format!("d.Zero(o, p.{f})"));
                            c.l(&format!("sz = p.{f}"));
                            c.mid("} else {");
                            self.variant_size(c, v, k, vi, var, mode);
                            c.close();
                        } else {
                            self.variant_size(c, v, k, vi, var, mode);
                        }
                    }
                    c.case_("default:");
                    c.bail("tnabi.ErrInvalidVariant");
                    c.close();
                }
                Shape::Sdu { variants } => {
                    let idx = c.t();
                    if mode == Mode::Layout {
                        let avail = c.val("d.Avail()");
                        c.open(&format!("if {avail} < o {{"));
                        c.ret_err("tnabi.Short(o, d.Len())");
                        c.close();
                        c.l(&format!("var {idx} uint64"));
                        c.open(&format!("switch {avail} - o {{"));
                        let mut seen = BTreeSet::new();
                        for (vi, var) in variants.iter().enumerate() {
                            if !seen.insert(var.tag) {
                                continue;
                            }
                            c.case_(&format!("case {}:", var.tag));
                            c.l(&format!("{idx}, sz = {vi}, {}", var.tag));
                        }
                        c.case_("default:");
                        c.bail("tnabi.ErrInvalidSize");
                        c.close();
                    } else {
                        let pf = self.param_field_of(
                            v,
                            |kind| matches!(kind, ParamKind::SduVariant(i) if *i == k),
                        );
                        c.l(&format!("var {idx} uint64"));
                        if self.r.has_params_struct(v) && !pf.is_empty() {
                            c.open("if p != nil {");
                            c.l(&format!("{idx} = p.{pf}"));
                            c.close();
                        }
                        c.open(&format!("switch {idx} {{"));
                        for (vi, var) in variants.iter().enumerate() {
                            c.case_(&format!("case {vi}:"));
                            c.l(&format!("sz = {}", var.tag));
                        }
                        c.case_("default:");
                        c.bail("tnabi.ErrInvalidVariant");
                        c.close();
                        c.unit("d.Zero(o, sz)");
                    }
                    c.l(&format!("l.Aux[{k}] = {idx}"));
                }
            }
            if has_writes {
                c.open("if p != nil {");
                for (t, (f, g)) in v.params.iter().zip(
                    self.r
                        .param_fields(v)
                        .into_iter()
                        .zip(self.param_go_fields(v)),
                ) {
                    let _ = f;
                    if t.order.first() != Some(&k) {
                        continue;
                    }
                    match self.path_off(c, v, &t.segs) {
                        Some((off, prim)) => {
                            c.unit(&format!("d.Put({off}, {}, p.{g})", prim_size(&prim)))
                        }
                        None => c.bail("tnabi.ErrUnsupported"),
                    }
                }
                c.close();
                if let (None, Shape::View(ViewRef { size: None, .. })) = (&sized, &slot.shape) {
                    let ev = view_ext.clone().unwrap_or_default();
                    let end = self.layout_end(c, "o", &ev);
                    c.l(&format!("sz = {end}"));
                }
            }
            c.l(&format!("l.Len[{k}] = sz"));
            if is_union {
                c.open("if sz > uend {");
                c.l("uend = sz");
                c.close();
            } else {
                let t = c.val("tnabi.Add(o, sz)");
                c.l(&format!("o = {t}"));
            }
            c.close();
        }
        let tail_align = self.r.tail_align(v);
        let end = if is_union {
            match csize {
                Some(x) => format!("uint64({x})"),
                None => "uend".to_string(),
            }
        } else {
            match csize {
                Some(x) if v.is_struct() => format!("uint64({x})"),
                _ if tail_align > 1 => c.val(&format!("tnabi.Align(o, {tail_align})")),
                _ => "o".to_string(),
            }
        };
        c.l(&format!("end := {end}"));
        c.open("if end > d.Len() {");
        c.ret_err("tnabi.Short(end, d.Len())");
        c.close();
        if mode == Mode::Layout {
            c.l("_ = o");
            c.l("l.End = end");
            c.l("return l, nil");
        } else {
            if !is_union && csize.is_none() && tail_align > 1 {
                c.unit("d.Zero(o, end-o)");
            }
            c.l("_, _ = o, l");
            c.l("return end, nil");
        }
    }

    fn walk_array(
        &self,
        c: &mut Code,
        v: &VInfo<'a>,
        slot: &Slot<'a>,
        a: &ArrayShape<'a>,
        mode: Mode,
        sized: &Option<String>,
    ) {
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
        let k = slot.idx;
        let cnt = match &a.count {
            Count::Const(x) => format!("uint64({x})"),
            Count::Expr(_) => c.val(&format!("tn_cnt_{n}_{k}(d, l, ext)")),
        };
        c.l(&format!("cnt := {cnt}"));
        c.l(&format!("l.Aux[{k}] = cnt"));
        if !a.walk {
            let es = a.elem_size.unwrap_or(0);
            let t = c.val(&format!("tnabi.Mul(cnt, {es})"));
            c.l(&format!("sz = {t}"));
            if mode == Mode::Init {
                c.unit("d.Zero(o, sz)");
            }
            return;
        }
        match &a.elem {
            Elem::View(cv) if a.stride => {
                c.open("if cnt > 0 {");
                let e = self.child_ext(c, v, &format!("{k}"), cv);
                let es = if mode == Mode::Layout {
                    self.layout_end(c, "o", &e)
                } else {
                    self.init_call(c, cv, "o", &e)
                };
                let t = c.val(&format!("tnabi.Mul(cnt, {es})"));
                c.l(&format!("sz = {t}"));
                if mode == Mode::Init {
                    c.unit("d.Zero(o, sz)");
                }
                c.close();
            }
            Elem::View(cv) => {
                if mode == Mode::Layout {
                    /* Measuring: more elements than bytes present means one
                    starts past them (or is empty): size unknown. */
                    let m = self.r.min_size(cv.ty);
                    c.open("if d.Measuring() {");
                    c.open("if cnt > tnabi.SatSub(d.Present(), o) {");
                    c.bail("tnabi.ErrUnsupported");
                    c.close();
                    if m > 0 {
                        c.mid("} else if cnt > tnabi.SatSub(d.Len(), o) {");
                        c.ret_err(&format!(
                            "tnabi.Short(tnabi.SatAdd(o, tnabi.SatMul(cnt, {m})), d.Len())"
                        ));
                    }
                    c.close();
                }
                if let Some(f) = sized {
                    c.open("if p != nil {");
                    c.unit(&format!("d.Zero(o, p.{f})"));
                    c.l(&format!("sz = p.{f}"));
                    c.mid("} else {");
                }
                c.open("for i := uint64(0); i < cnt; i++ {");
                let at = c.val("tnabi.Add(o, sz)");
                if mode == Mode::Layout {
                    c.open(&format!("if d.Measuring() && {at} >= d.Present() {{"));
                    c.bail("tnabi.ErrUnsupported");
                    c.close();
                }
                let e = self.child_ext(c, v, &format!("{k}"), cv);
                let es = if mode == Mode::Layout {
                    let es = self.layout_end(c, &at, &e);
                    c.open(&format!("if d.Measuring() && {es} == 0 {{"));
                    c.bail("tnabi.ErrUnsupported");
                    c.close();
                    es
                } else {
                    self.init_call(c, cv, &at, &e)
                };
                /* Zero-byte elements all start at `at` with the same context:
                the rest are alike and add nothing. */
                c.open(&format!("if {es} == 0 {{"));
                c.l("break");
                c.close();
                let t = c.val(&format!("tnabi.Add(sz, {es})"));
                c.l(&format!("sz = {t}"));
                c.close();
                if sized.is_some() {
                    c.close();
                }
            }
            _ => {
                c.open("if cnt != 0 {");
                c.bail("tnabi.ErrUnsupported");
                c.close();
            }
        }
    }

    fn variant_size(
        &self,
        c: &mut Code,
        v: &VInfo<'a>,
        k: usize,
        vi: usize,
        var: &Variant<'a>,
        mode: Mode,
    ) {
        match &var.elem {
            Elem::View(cv) if cv.size.is_none() => {
                let e = self.child_ext(c, v, &format!("{k}_{vi}"), cv);
                let x = if mode == Mode::Layout {
                    self.layout_end(c, "o", &e)
                } else {
                    self.init_call(c, cv, "o", &e)
                };
                c.l(&format!("sz = {x}"));
            }
            other => match other.size() {
                Some(sz) => {
                    if mode == Mode::Init {
                        c.unit(&format!("d.Zero(o, {sz})"));
                    }
                    c.l(&format!("sz = {sz}"));
                }
                None => c.bail("tnabi.ErrUnsupported"),
            },
        }
    }

    fn validate_body(&self, c: &mut Code, v: &VInfo<'a>, slots: &[Slot<'a>]) {
        for slot in slots {
            let k = slot.idx;
            match &slot.shape {
                Shape::View(cv) if self.r.needs_deep(cv.ty) => {
                    c.open("{");
                    let e = self.child_ext(c, v, &format!("{k}"), cv);
                    let nb = c.val(&format!("tnabi.ValidateAt(b, l.Off[{k}], {e}.TnValidate)"));
                    c.open(&format!("if {nb} != l.Len[{k}] {{"));
                    c.bail("tnabi.ErrLengthMismatch");
                    c.close();
                    c.close();
                }
                Shape::Array(a) => {
                    let cv = match &a.elem {
                        Elem::View(cv) if self.r.needs_deep(cv.ty) || a.walk => cv,
                        _ => continue,
                    };
                    c.open("{");
                    let e = self.child_ext(c, v, &format!("{k}"), cv);
                    c.l(&format!("at := l.Off[{k}]"));
                    c.open(&format!("for i := uint64(0); i < l.Aux[{k}]; i++ {{"));
                    let nb = c.val(&format!("tnabi.ValidateAt(b, at, {e}.TnValidate)"));
                    /* A zero-byte element leaves `at` where it was: validating one
                    stands for all of them (a huge count costs nothing). */
                    c.open(&format!("if {nb} == 0 {{"));
                    c.l("break");
                    c.close();
                    let t = c.val(&format!("tnabi.Add(at, {nb})"));
                    c.l(&format!("at = {t}"));
                    c.close();
                    let end = c.val(&format!("tnabi.Add(l.Off[{k}], l.Len[{k}])"));
                    c.open(&format!("if at != {end} {{"));
                    c.bail("tnabi.ErrLengthMismatch");
                    c.close();
                    c.close();
                }
                Shape::Enum { variants, .. } | Shape::Sdu { variants } => {
                    let is_sdu = matches!(slot.shape, Shape::Sdu { .. });
                    let deep: Vec<(usize, &Variant<'a>, &ViewRef<'a>)> = variants
                        .iter()
                        .enumerate()
                        .filter_map(|(vi, var)| match &var.elem {
                            Elem::View(cv) if self.r.needs_deep(cv.ty) => Some((vi, var, cv)),
                            _ => None,
                        })
                        .collect();
                    if deep.is_empty() {
                        continue;
                    }
                    /* First variant with a tag wins (as in the walker). */
                    let mut first_of: HashMap<u64, usize> = HashMap::new();
                    for (vi, var) in variants.iter().enumerate() {
                        let sel = if is_sdu { vi as u64 } else { var.tag };
                        first_of.entry(sel).or_insert(vi);
                    }
                    c.open(&format!("switch l.Aux[{k}] {{"));
                    for (vi, var, cv) in deep {
                        let sel = if is_sdu { vi as u64 } else { var.tag };
                        if first_of.get(&sel) != Some(&vi) {
                            continue;
                        }
                        c.case_(&format!("case {sel}:"));
                        let e = self.child_ext(c, v, &format!("{k}_{vi}"), cv);
                        let nb = c.val(&format!("tnabi.ValidateAt(b, l.Off[{k}], {e}.TnValidate)"));
                        c.open(&format!("if {nb} != l.Len[{k}] {{"));
                        c.bail("tnabi.ErrLengthMismatch");
                        c.close();
                    }
                    c.close();
                }
                _ => {}
            }
        }
    }

    fn emit_expr_fns(&self, v: &VInfo<'a>, slots: &[Slot<'a>], out: &mut String) {
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
        for slot in slots {
            let k = slot.idx;
            let frames = self.r.frames_at(v, k);
            let mut one =
                |name: String, ret: String, zero: &str, body: &dyn Fn(&mut Code) -> String| {
                    w!(
                        out,
                        "func {name}(d tnabi.Buf, l *tnabi.Layout, ext {n_ext}) ({ret}, error) {{"
                    );
                    let mut c = Code::new(1, &format!("return {zero}, "));
                    let val = body(&mut c);
                    out.push_str(&c.s);
                    w!(out, "\treturn {val}, nil");
                    w!(out, "}}");
                    w!(out, "");
                };
            match &slot.shape {
                Shape::Array(ArrayShape {
                    count: Count::Expr(e),
                    ..
                }) => {
                    one(format!("tn_cnt_{n}_{k}"), "uint64".into(), "0", &|c| {
                        self.expr(c, v, &frames, e)
                    });
                }
                Shape::Enum { tag, .. } => {
                    one(format!("tn_tag_{n}_{k}"), "uint64".into(), "0", &|c| {
                        self.expr(c, v, &frames, tag)
                    });
                }
                _ => {}
            }
            for (suffix, cv) in self.r.slot_children(slot) {
                let Some(ci) = self.info(&cv.vname) else {
                    continue;
                };
                if !ci.has_ext() {
                    continue;
                }
                let ext_ty = self.qext(ci.ty);
                one(
                    format!("tn_ext_{n}_{suffix}"),
                    ext_ty.clone(),
                    &format!("{ext_ty}{{}}"),
                    &|c| self.ext_init_code(c, v, k, &ci),
                );
            }
        }
    }

    /* ------------------------------------------------------------------
     * Construction
     * ---------------------------------------------------------------- */

    fn emit_ctors(&self, v: &VInfo<'a>, out: &mut String) {
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
        if v.has_ext() {
            w!(
                out,
                "// {n_parse_with} validates b given the enclosing context and wraps it."
            );
            w!(
                out,
                "func {n_parse_with}(b []byte, ext {n_ext}) ({n}, error) {{"
            );
            w!(out, "\tif _, err := ext.TnValidate(b); err != nil {{");
            w!(out, "\t\treturn {n}{{}}, err");
            w!(out, "\t}}");
            w!(out, "\treturn {n}{{b: b, ext: ext}}, nil");
            w!(out, "}}");
            w!(out, "");
            w!(
                out,
                "// {n_validate_with} validates b given the enclosing context and returns the"
            );
            w!(out, "// consumed size.");
            w!(
                out,
                "func {n_validate_with}(b []byte, ext {n_ext}) (int, error) {{"
            );
            w!(out, "\tn, err := ext.TnValidate(b)");
            w!(out, "\treturn int(n), err");
            w!(out, "}}");
            w!(out, "");
            w!(out, "// {n_unchecked_with} wraps b without validating it.");
            w!(
                out,
                "func {n_unchecked_with}(b []byte, ext {n_ext}) {n} {{ return {n}{{b: b, ext: ext}} }}"
            );
            w!(out, "");
            if self.r.has_ext_params(v) {
                self.emit_ext_ctor_fns(v, out);
            }
            return;
        }
        w!(
            out,
            "// {n_parse} validates b (including nested types and enum payloads) and wraps it."
        );
        w!(out, "func {n_parse}(b []byte) ({n}, error) {{");
        w!(
            out,
            "\tif _, err := ({n_ext}{{}}).TnValidate(b); err != nil {{"
        );
        w!(out, "\t\treturn {n}{{}}, err");
        w!(out, "\t}}");
        w!(out, "\treturn {n}{{b: b}}, nil");
        w!(out, "}}");
        w!(out, "");
        w!(
            out,
            "// {n_validate} fully validates b and returns the number of bytes the value occupies."
        );
        w!(out, "func {n_validate}(b []byte) (int, error) {{");
        w!(out, "\tn, err := ({n_ext}{{}}).TnValidate(b)");
        w!(out, "\treturn int(n), err");
        w!(out, "}}");
        w!(out, "");
        w!(out, "// {n_unchecked} wraps b without validating it.");
        w!(
            out,
            "func {n_unchecked}(b []byte) {n} {{ return {n}{{b: b}} }}"
        );
        w!(out, "");
        if let Some(x) = const_size(v.ty) {
            w!(
                out,
                "// {n_footprint_const} is the encoded size of every {n}."
            );
            w!(out, "const {n_footprint_const} = {x}");
            w!(out, "");
        }
        if !self.r.has_params_struct(v) {
            return;
        }
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
        let fields = self.r.param_fields(v);
        let go = self.param_go_fields(v);
        let mut sig = Vec::new();
        let mut init = Vec::new();
        let mut buf_field = None;
        let mut used_args: Vec<String> = Vec::new();
        for (f, g) in fields.iter().zip(&go) {
            let mut arg = lower(g);
            while used_args.contains(&arg) {
                arg.push('_');
            }
            used_args.push(arg.clone());
            match &f.kind {
                ParamKind::Target(t) => {
                    sig.push(format!("{arg} {}", go_prim(&t.prim)));
                    init.push(format!("{g}: {}", go_to_raw(&t.prim, &arg)));
                }
                ParamKind::PayloadSize(_) | ParamKind::UnionSize => {
                    sig.push(format!("{arg} uint64"));
                    init.push(format!("{g}: {arg}"));
                }
                ParamKind::SduVariant(_) => {
                    sig.push(format!("{arg} uint8"));
                    init.push(format!("{g}: uint64({arg})"));
                }
                ParamKind::BufferSize => {
                    init.push(format!("{g}: uint64(len(buf))"));
                    buf_field = Some(g.clone());
                }
            }
        }
        let arg_doc: Vec<String> = fields
            .iter()
            .filter(|f| !matches!(f.kind, ParamKind::BufferSize))
            .map(|f| f.doc.clone())
            .collect();
        w!(
            out,
            "// {n_new} zero-initializes buf, writing the given length/tag fields"
        );
        w!(
            out,
            "// ({}), and returns the size used.",
            if arg_doc.is_empty() {
                "none".to_string()
            } else {
                arg_doc.join(", ")
            }
        );
        if sig.is_empty() {
            w!(out, "func {n_new}(buf []byte) (int, error) {{");
        } else {
            w!(
                out,
                "func {n_new}(buf []byte, {}) (int, error) {{",
                sig.join(", ")
            );
        }
        w!(out, "\tp := {pt}{{{}}}", init.join(", "));
        w!(
            out,
            "\tsz, err := ({n_ext}{{}}).TnInit(tnabi.Bytes(buf), &p)"
        );
        w!(out, "\treturn int(sz), err");
        w!(out, "}}");
        w!(out, "");
        w!(
            out,
            "// {n_init} zero-initializes buf from a parameter set and returns the size used."
        );
        if buf_field.is_some() {
            w!(
                out,
                "// The value is laid out over the parameter's buffer size; spare bytes of buf"
            );
            w!(out, "// are left untouched.");
        }
        w!(out, "func {n_init}(buf []byte, p *{pt}) (int, error) {{");
        if let Some(f) = &buf_field {
            w!(out, "\tif p.{f} > uint64(len(buf)) {{");
            w!(out, "\t\treturn 0, tnabi.Short(p.{f}, uint64(len(buf)))");
            w!(out, "\t}}");
            w!(out, "\tbuf = buf[:p.{f}]");
        }
        w!(
            out,
            "\tsz, err := ({n_ext}{{}}).TnInit(tnabi.Bytes(buf), p)"
        );
        w!(out, "\treturn int(sz), err");
        w!(out, "}}");
        w!(out, "");
        let kk = fields
            .iter()
            .filter(|f| matches!(f.kind, ParamKind::Target(_)))
            .count()
            .max(1);
        let len = buf_field
            .as_ref()
            .map(|f| format!("p.{f}"))
            .unwrap_or_else(|| "tnabi.MaxU64".into());
        w!(
            out,
            "// {n_footprint_fn} returns the size of the value {n_init} would produce."
        );
        w!(out, "func {n_footprint_fn}(p *{pt}) (uint64, error) {{");
        w!(
            out,
            "\treturn ({n_ext}{{}}).TnInit(tnabi.NewVirtual({len}, {kk}), p)"
        );
        w!(out, "}}");
        w!(out, "");
    }

    fn emit_ext_ctor_fns(&self, v: &VInfo<'a>, out: &mut String) {
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
        let keys = self.param_keys(v);
        let args = distinct_args(keys.iter().map(|(f, _)| f.as_str()));
        let sig: Vec<String> = args.iter().map(|a| format!("{a} uint64")).collect();
        let init: Vec<String> = keys
            .iter()
            .zip(&args)
            .map(|((f, _), a)| format!("{f}: {a}"))
            .collect();
        w!(
            out,
            "// {n_new} zero-initializes buf for the given parameters and returns the size used."
        );
        w!(
            out,
            "func {n_new}(buf []byte, {}) (int, error) {{",
            sig.join(", ")
        );
        w!(out, "\treturn {n_init}(buf, &{pt}{{{}}})", init.join(", "));
        w!(out, "}}");
        w!(out, "");
        w!(
            out,
            "// {n_init} zero-initializes buf from a parameter set and returns the size used."
        );
        w!(out, "func {n_init}(buf []byte, p *{pt}) (int, error) {{");
        w!(out, "\tsz, err := p.TnInit(tnabi.Bytes(buf))");
        w!(out, "\treturn int(sz), err");
        w!(out, "}}");
        w!(out, "");
        w!(
            out,
            "// {n_footprint_fn} returns the size of the value {n_init} would produce."
        );
        w!(out, "func {n_footprint_fn}(p *{pt}) (uint64, error) {{");
        if self.r.uses_buffer_size(v) {
            w!(
                out,
                "\t/* The layout depends on the buffer size, which parameters do not fix. */"
            );
            w!(out, "\t_ = p");
            w!(out, "\treturn 0, tnabi.ErrUnsupported");
        } else {
            w!(out, "\treturn p.TnInit(tnabi.NewVirtual(tnabi.MaxU64, 1))");
        }
        w!(out, "}}");
        w!(out, "");
    }

    fn emit_param_access(&self, v: &VInfo<'a>, out: &mut String) {
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
        let keys = self.param_keys(v);
        w!(
            out,
            "// {n_params_keys} lists every parameter (Go field, ABI path); Get and Set accept either."
        );
        if keys.is_empty() {
            w!(out, "var {n_params_keys} = []tnabi.ParamKey{{}}");
        } else {
            w!(out, "var {n_params_keys} = []tnabi.ParamKey{{");
            for (f, p) in &keys {
                w!(out, "\t{{Field: {}, Path: {}}},", go_str(f), go_str(p));
            }
            w!(out, "}}");
        }
        w!(out, "");
        w!(out, "// Keys returns {n_params_keys}.");
        w!(
            out,
            "func (p *{pt}) Keys() []tnabi.ParamKey {{ return {n_params_keys} }}"
        );
        w!(out, "");
        w!(
            out,
            "// Get returns the parameter named key (Go field or ABI path)."
        );
        w!(out, "func (p *{pt}) Get(key string) (uint64, bool) {{");
        if keys.is_empty() {
            w!(out, "\t_ = key");
        } else {
            w!(out, "\tswitch tnabi.ParamIndex({n_params_keys}, key) {{");
            for (i, (f, _)) in keys.iter().enumerate() {
                w!(out, "\tcase {i}:");
                w!(out, "\t\treturn p.{f}, true");
            }
            w!(out, "\t}}");
        }
        w!(out, "\treturn 0, false");
        w!(out, "}}");
        w!(out, "");
        w!(
            out,
            "// Set sets the parameter named key; it returns false for an unknown key."
        );
        w!(out, "func (p *{pt}) Set(key string, value uint64) bool {{");
        if keys.is_empty() {
            w!(out, "\t_, _ = key, value");
            w!(out, "\treturn false");
        } else {
            w!(out, "\tswitch tnabi.ParamIndex({n_params_keys}, key) {{");
            for (i, (f, _)) in keys.iter().enumerate() {
                w!(out, "\tcase {i}:");
                w!(out, "\t\tp.{f} = value");
            }
            w!(out, "\tdefault:");
            w!(out, "\t\treturn false");
            w!(out, "\t}}");
            w!(out, "\treturn true");
        }
        w!(out, "}}");
        w!(out, "");
        w!(
            out,
            "// Footprint returns the size of the value these parameters describe."
        );
        w!(
            out,
            "func (p *{pt}) Footprint() (uint64, error) {{ return {n_footprint_fn}(p) }}"
        );
        w!(out, "");
        let args = distinct_args(keys.iter().map(|(f, _)| f.as_str()));
        let sig: Vec<String> = args.iter().map(|a| format!("{a} uint64")).collect();
        let init: Vec<String> = keys
            .iter()
            .zip(&args)
            .map(|((f, _), a)| format!("{f}: {a}"))
            .collect();
        w!(
            out,
            "// {n_params_from_values} builds parameters from explicit values."
        );
        w!(
            out,
            "func {n_params_from_values}({}) {pt} {{",
            sig.join(", ")
        );
        w!(out, "\treturn {pt}{{{}}}", init.join(", "));
        w!(out, "}}");
        w!(out, "");
    }

    fn emit_ext_params_impl(&self, v: &VInfo<'a>, out: &mut String) {
        self.emit_param_access(v, out);
    }

    fn emit_params_impl(&self, v: &VInfo<'a>, out: &mut String) {
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
        self.emit_param_access(v, out);
        w!(
            out,
            "// {n_params_from_buffer} validates b as `{}` and reads its dynamic parameters.",
            one_line(&v.ty.name)
        );
        w!(
            out,
            "func {n_params_from_buffer}(b []byte) ({pt}, error) {{"
        );
        let mut c = Code::new(1, &format!("return {pt}{{}}, "));
        c.l(&format!("ext := {n_ext}{{}}"));
        c.unit_val("ext.TnValidate(b)");
        c.l("d := tnabi.Bytes(b)");
        let l = c.val("ext.TnLayout(d, tnabi.MaxU64)");
        c.l(&format!("l := {l}"));
        let mut parts = Vec::new();
        for (f, g) in self.r.param_fields(v).iter().zip(self.param_go_fields(v)) {
            let val = match &f.kind {
                ParamKind::Target(t) => match self.path_off(&mut c, v, &t.segs) {
                    Some((off, prim)) => c.val(&format!("d.Get({off}, {})", prim_size(&prim))),
                    None => c.val("tnabi.Fail(tnabi.ErrUnsupported)"),
                },
                ParamKind::SduVariant(k) => format!("l.Aux[{k}]"),
                ParamKind::PayloadSize(k) => format!("l.Len[{k}]"),
                ParamKind::UnionSize => "l.End".to_string(),
                ParamKind::BufferSize => "uint64(len(b))".to_string(),
            };
            parts.push(format!("{g}: {val}"));
        }
        c.l("_, _ = d, l");
        c.l(&format!("return {pt}{{{}}}, nil", parts.join(", ")));
        out.push_str(&c.s);
        w!(out, "}}");
        w!(out, "");
    }

    /* ------------------------------------------------------------------
     * Variant metadata
     * ---------------------------------------------------------------- */

    fn emit_table(
        &self,
        label: &str,
        sn: &super::pkgnames::SlotNames,
        metas: &[crate::codegen::rust_gen::emit::VariantMeta],
        out: &mut String,
    ) {
        let (tbl, by_name, by_tag) = (&sn.variants, &sn.by_name, &sn.by_tag);
        w!(
            out,
            "// {tbl} describes the variants of `{}`.",
            one_line(label)
        );
        w!(out, "var {tbl} = []tnabi.VariantInfo{{");
        for m in metas {
            let ps = match m.payload_size {
                Some(x) => x.to_string(),
                None => "tnabi.VariableSize".to_string(),
            };
            w!(
                out,
                "\t{{Name: {}, Tag: {}, PayloadSize: {ps}, PayloadType: {}}},",
                go_str(&m.name),
                m.tag,
                go_str(&m.payload_type)
            );
        }
        w!(out, "}}");
        w!(out, "");
        w!(
            out,
            "// {by_name} returns the `{}` variant named name.",
            one_line(label)
        );
        w!(
            out,
            "func {by_name}(name string) (tnabi.VariantInfo, bool) {{"
        );
        w!(out, "\treturn tnabi.VariantByName({tbl}, name)");
        w!(out, "}}");
        w!(out, "");
        w!(
            out,
            "// {by_tag} returns the `{}` variant with tag tag.",
            one_line(label)
        );
        w!(
            out,
            "func {by_tag}(tag uint64) (tnabi.VariantInfo, bool) {{"
        );
        w!(out, "\treturn tnabi.VariantByTag({tbl}, tag)");
        w!(out, "}}");
        w!(out, "");
    }

    fn emit_variant_meta(&self, v: &VInfo<'a>, out: &mut String) {
        use crate::codegen::rust_gen::emit::VariantMeta;
        if let ResolvedTypeKind::Union { variants } = &v.ty.kind {
            let metas: Vec<VariantMeta> = variants
                .iter()
                .enumerate()
                .map(|(i, x)| VariantMeta {
                    name: x.name.clone(),
                    tag: i as u64,
                    payload_size: const_size(&x.field_type),
                    payload_type: payload_type_name(&x.field_type),
                })
                .collect();
            self.emit_table(
                &v.ty.name,
                &self.slot_names(&v.ty.name, usize::MAX),
                &metas,
                out,
            );
            return;
        }
        for slot in self.r.slots(v) {
            let is_sdu = match slot.shape {
                Shape::Enum { .. } => false,
                Shape::Sdu { .. } => true,
                _ => continue,
            };
            let metas = self.r.variant_meta(v, &slot);
            let label = self.r.slot_label(v, &slot);
            let consts = self.tag_const_names(v, &slot);
            w!(out, "const (");
            for (m, cn) in metas.iter().zip(&consts) {
                if is_sdu {
                    w!(
                        out,
                        "\t// {cn} is the `{}` variant index of `{}` (a {}-byte payload).",
                        m.name,
                        one_line(&label),
                        m.payload_size.unwrap_or(0)
                    );
                    w!(out, "\t{cn} uint8 = {}", m.tag);
                } else {
                    w!(
                        out,
                        "\t// {cn} selects `{}` in `{}`.",
                        m.name,
                        one_line(&label)
                    );
                    w!(out, "\t{cn} uint64 = {}", m.tag);
                }
            }
            w!(out, ")");
            w!(out, "");
            self.emit_table(&label, &self.variant_names(v, &slot), &metas, out);
        }
    }

    /* ------------------------------------------------------------------
     * Accessors
     * ---------------------------------------------------------------- */

    fn emit_accessors(&self, v: &VInfo<'a>, out: &mut String) {
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
        let slots = self.r.slots(v);
        let nn = slots.len();
        let names = self.names(v);
        w!(
            out,
            "// Bytes returns the bytes this view was created over."
        );
        w!(out, "func (v {n}) Bytes() []byte {{ return v.b }}");
        w!(out, "");
        w!(
            out,
            "// Context returns the context supplied by the enclosing type."
        );
        w!(out, "func (v {n}) Context() {n_ext} {{ return v.ext }}");
        w!(out, "");
        w!(out, "func (v {n}) lay() *tnabi.Layout {{");
        w!(
            out,
            "\tl, err := v.ext.TnLayout(tnabi.Bytes(v.b), tnabi.MaxU64)"
        );
        w!(out, "\treturn tnabi.OrZero(l, err, {nn})");
        w!(out, "}}");
        w!(out, "");
        w!(out, "func (v {n}) layErr() (*tnabi.Layout, error) {{");
        w!(
            out,
            "\treturn v.ext.TnLayout(tnabi.Bytes(v.b), tnabi.MaxU64)"
        );
        w!(out, "}}");
        w!(out, "");
        w!(
            out,
            "// Size returns the size in bytes of the encoded value."
        );
        match const_size(v.ty) {
            Some(x) => w!(out, "func (v {n}) Size() int {{ return {x} }}"),
            None => w!(out, "func (v {n}) Size() int {{ return int(v.lay().End) }}"),
        }
        w!(out, "");
        w!(
            out,
            "// Check re-runs full validation over the current bytes."
        );
        w!(out, "func (v {n}) Check() (int, error) {{");
        w!(out, "\tsz, err := v.ext.TnValidate(v.b)");
        w!(out, "\treturn int(sz), err");
        w!(out, "}}");
        w!(out, "");
        if self.r.has_params_struct(v) {
            w!(
                out,
                "// DynamicParams reads the dynamic parameters back from the bytes."
            );
            w!(
                out,
                "func (v {n}) DynamicParams() ({}, error) {{ return {}(v.b) }}",
                self.params_ty(v),
                self.vnames_of(&v.ty.name).params_from_buffer
            );
            w!(out, "");
        } else if self.r.has_ext_params(v) {
            w!(
                out,
                "// DynamicParams returns the parameters this view was created with."
            );
            w!(
                out,
                "func (v {n}) DynamicParams() ({}, error) {{ return v.ext, nil }}",
                self.params_ty(v)
            );
            w!(out, "");
        }
        for slot in &slots {
            self.emit_slot_accessors(v, slot, &names, out);
        }
    }

    /* Expression for a child's ext inside an accessor (`l` in scope). */
    fn accessor_ext(
        &self,
        v: &VInfo<'a>,
        suffix: &str,
        child: &ViewRef<'a>,
        out: &mut String,
    ) -> String {
        match self.info(&child.vname) {
            Some(ci) if ci.has_ext() => {
                w!(
                    out,
                    "\te, _ := tn_ext_{}_{suffix}(tnabi.Bytes(v.b), l, v.ext)",
                    self.gn(v.ty)
                );
                "e".to_string()
            }
            _ => format!("({}{{}})", self.qext(child.ty)),
        }
    }

    fn off_code(&self, slot: &Slot<'a>) -> String {
        match slot.static_off {
            Some(x) => format!("uint64({x})"),
            None => format!("l.Off[{}]", slot.idx),
        }
    }

    fn emit_slot_accessors(&self, v: &VInfo<'a>, slot: &Slot<'a>, names: &Names, out: &mut String) {
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
        let k = slot.idx;
        let label = one_line(&self.r.slot_label(v, slot));
        let nm = |key: &str| self.mname(names, slot, key);
        match &slot.shape {
            Shape::Prim(p) => {
                let gt = go_prim(p);
                let sz = prim_size(p);
                w!(out, "// {} returns `{label}`.", nm("get"));
                w!(out, "func (v {n}) {}() {gt} {{", nm("get"));
                if slot.static_off.is_none() {
                    w!(out, "\tl, err := v.layErr()");
                    w!(out, "\tif err != nil {{");
                    w!(out, "\t\treturn 0");
                    w!(out, "\t}}");
                }
                w!(
                    out,
                    "\treturn {}",
                    raw_to_go(p, &format!("tnabi.Rd(v.b, {}, {sz})", self.off_code(slot)))
                );
                w!(out, "}}");
                w!(out, "");
                w!(out, "// {} sets `{label}`.", nm("set"));
                w!(out, "func (v {n}) {}(value {gt}) error {{", nm("set"));
                if slot.static_off.is_none() {
                    w!(out, "\tl, err := v.layErr()");
                    w!(out, "\tif err != nil {{");
                    w!(out, "\t\treturn err");
                    w!(out, "\t}}");
                }
                w!(
                    out,
                    "\treturn tnabi.Wr(v.b, {}, {sz}, {})",
                    self.off_code(slot),
                    go_to_raw(p, "value")
                );
                w!(out, "}}");
                w!(out, "");
            }
            Shape::Array(a) => self.emit_array_accessors(v, slot, a, names, out),
            Shape::View(cv) => {
                let ct = self.qn(cv.ty);
                if let Some((o, sz)) = self.r.static_child(slot, cv) {
                    w!(out, "// {} returns a view of `{label}`.", nm("get"));
                    w!(out, "func (v {n}) {}() {ct} {{", nm("get"));
                    w!(
                        out,
                        "\treturn ({}{{}}).TnWrap(tnabi.Slice(v.b, {o}, {sz}))",
                        self.qext(cv.ty)
                    );
                    w!(out, "}}");
                    w!(out, "");
                    w!(
                        out,
                        "// {} overwrites `{label}` with encoded bytes (the length must match).",
                        nm("set")
                    );
                    w!(out, "func (v {n}) {}(value []byte) error {{", nm("set"));
                    w!(out, "\tif len(value) != {sz} {{");
                    w!(out, "\t\treturn tnabi.ErrLengthMismatch");
                    w!(out, "\t}}");
                    w!(out, "\treturn tnabi.Copy(v.b, {o}, value)");
                    w!(out, "}}");
                    w!(out, "");
                    return;
                }
                w!(out, "// {} returns a view of `{label}`.", nm("get"));
                w!(out, "func (v {n}) {}() {ct} {{", nm("get"));
                w!(out, "\tl, err := v.layErr()");
                w!(out, "\tif err != nil {{");
                w!(out, "\t\treturn {ct}{{}}");
                w!(out, "\t}}");
                let e = self.accessor_ext(v, &format!("{k}"), cv, out);
                w!(
                    out,
                    "\treturn {e}.TnWrap(tnabi.Slice(v.b, l.Off[{k}], l.Len[{k}]))"
                );
                w!(out, "}}");
                w!(out, "");
                w!(
                    out,
                    "// {} overwrites `{label}` with encoded bytes (the length must match).",
                    nm("set")
                );
                w!(out, "func (v {n}) {}(value []byte) error {{", nm("set"));
                w!(out, "\tl, err := v.layErr()");
                w!(out, "\tif err != nil {{");
                w!(out, "\t\treturn err");
                w!(out, "\t}}");
                w!(out, "\tif uint64(len(value)) != l.Len[{k}] {{");
                w!(out, "\t\treturn tnabi.ErrLengthMismatch");
                w!(out, "\t}}");
                w!(out, "\treturn tnabi.Copy(v.b, l.Off[{k}], value)");
                w!(out, "}}");
                w!(out, "");
            }
            Shape::Enum { variants, .. } | Shape::Sdu { variants } => {
                let is_sdu = matches!(slot.shape, Shape::Sdu { .. });
                let own = slot.name.is_empty();
                let rn = self.ref_ty(v, slot);
                let vc = self.variant_camels(variants);
                let (off, len) = if own {
                    ("0".to_string(), "l.Len[0]".to_string())
                } else {
                    (format!("l.Off[{k}]"), format!("l.Len[{k}]"))
                };
                /* Tag */
                if is_sdu {
                    w!(
                        out,
                        "// {} returns the index of the active `{label}` variant (selected by size).",
                        nm("tag")
                    );
                    w!(
                        out,
                        "func (v {n}) {}() uint8 {{ return uint8(v.lay().Aux[{k}]) }}",
                        nm("tag")
                    );
                } else {
                    w!(
                        out,
                        "// {} returns the tag of `{label}`, at full width.",
                        nm("tag")
                    );
                    w!(out, "func (v {n}) {}() uint64 {{", nm("tag"));
                    w!(out, "\td := tnabi.Bytes(v.b)");
                    if own {
                        w!(out, "\tt, _ := tn_tag_{n}_0(d, tnabi.NewLayout(1), v.ext)");
                    } else {
                        w!(out, "\tl, err := v.ext.TnLayout(d, {k})");
                        w!(out, "\tif err != nil {{");
                        w!(out, "\t\treturn 0");
                        w!(out, "\t}}");
                        w!(out, "\tt, _ := tn_tag_{n}_{k}(d, l, v.ext)");
                    }
                    w!(out, "\treturn t");
                    w!(out, "}}");
                }
                w!(out, "");
                /* Typed variant */
                w!(
                    out,
                    "// {} returns the active `{label}` variant, typed.",
                    nm("get")
                );
                w!(out, "func (v {n}) {}() {rn} {{", nm("get"));
                w!(out, "\tl, err := v.layErr()");
                w!(out, "\tif err != nil {{");
                w!(out, "\t\treturn {rn}{{}}");
                w!(out, "\t}}");
                if is_sdu {
                    w!(out, "\tr := {rn}{{Tag: l.Aux[{k}]}}");
                } else {
                    w!(out, "\tr := {rn}{{Tag: v.{}()}}", nm("tag"));
                }
                w!(out, "\ts := tnabi.Slice(v.b, {off}, {len})");
                w!(out, "\tswitch r.Tag {{");
                let mut seen = BTreeSet::new();
                for (vi, (var, cname)) in variants.iter().zip(&vc).enumerate() {
                    let sel = if is_sdu { vi as u64 } else { var.tag };
                    if !seen.insert(sel) {
                        continue;
                    }
                    w!(out, "\tcase {sel}:");
                    w!(out, "\t\tr.Known = true");
                    match &var.elem {
                        Elem::Prim(p) => w!(
                            out,
                            "\t\tr.{cname} = {}",
                            raw_to_go(p, &format!("tnabi.Rd(s, 0, {})", prim_size(p)))
                        ),
                        Elem::View(cv) => match self.info(&cv.vname) {
                            Some(ci) if ci.has_ext() => {
                                w!(
                                    out,
                                    "\t\te, _ := tn_ext_{n}_{k}_{vi}(tnabi.Bytes(v.b), l, v.ext)"
                                );
                                w!(out, "\t\tr.{cname} = e.TnWrap(s)");
                            }
                            _ => w!(out, "\t\tr.{cname} = ({}{{}}).TnWrap(s)", self.qext(cv.ty)),
                        },
                        Elem::Opaque(_) => w!(out, "\t\tr.{cname} = s"),
                    }
                }
                w!(out, "\t}}");
                w!(out, "\t_ = l");
                w!(out, "\treturn r");
                w!(out, "}}");
                w!(out, "");
                /* As / SetAs */
                for (vi, (var, cname)) in variants.iter().zip(&vc).enumerate() {
                    let sel = if is_sdu { vi as u64 } else { var.tag };
                    let pt = self.payload_ty(&var.elem);
                    let asn = nm(&format!("as{vi}"));
                    w!(
                        out,
                        "// {asn} returns the `{label}` payload when variant `{}` is active.",
                        var.name
                    );
                    w!(out, "func (v {n}) {asn}() ({pt}, bool) {{");
                    w!(out, "\tr := v.{}()", nm("get"));
                    w!(out, "\tif !r.Known || r.Tag != {sel} {{");
                    w!(out, "\t\tvar zero {pt}");
                    w!(out, "\t\treturn zero, false");
                    w!(out, "\t}}");
                    w!(out, "\treturn r.{cname}, true");
                    w!(out, "}}");
                    w!(out, "");
                    if let Elem::Prim(p) = &var.elem {
                        let setn = nm(&format!("setas{vi}"));
                        w!(
                            out,
                            "// {setn} writes the `{label}` payload when variant `{}` is active",
                            var.name
                        );
                        w!(out, "// (tnabi.ErrInvalidVariant otherwise).");
                        w!(out, "func (v {n}) {setn}(value {}) error {{", go_prim(p));
                        w!(out, "\tl, err := v.layErr()");
                        w!(out, "\tif err != nil {{");
                        w!(out, "\t\treturn err");
                        w!(out, "\t}}");
                        w!(out, "\t_ = l");
                        w!(
                            out,
                            "\tif r := v.{}(); !r.Known || r.Tag != {sel} {{",
                            nm("get")
                        );
                        w!(out, "\t\treturn tnabi.ErrInvalidVariant");
                        w!(out, "\t}}");
                        w!(
                            out,
                            "\treturn tnabi.Wr(v.b, {off}, {}, {})",
                            prim_size(p),
                            go_to_raw(p, "value")
                        );
                        w!(out, "}}");
                        w!(out, "");
                    }
                }
                /* Body */
                w!(
                    out,
                    "// {} returns the raw payload bytes of `{label}`.",
                    nm("body")
                );
                w!(out, "func (v {n}) {}() []byte {{", nm("body"));
                w!(out, "\tl, err := v.layErr()");
                w!(out, "\tif err != nil {{");
                w!(out, "\t\treturn nil");
                w!(out, "\t}}");
                w!(out, "\treturn tnabi.Slice(v.b, {off}, {len})");
                w!(out, "}}");
                w!(out, "");
                w!(
                    out,
                    "// {} overwrites the payload of `{label}` (the length must match the",
                    nm("set_body")
                );
                w!(out, "// active variant).");
                w!(out, "func (v {n}) {}(body []byte) error {{", nm("set_body"));
                w!(out, "\tl, err := v.layErr()");
                w!(out, "\tif err != nil {{");
                w!(out, "\t\treturn err");
                w!(out, "\t}}");
                w!(out, "\tif uint64(len(body)) != {len} {{");
                w!(out, "\t\treturn tnabi.ErrLengthMismatch");
                w!(out, "\t}}");
                w!(out, "\treturn tnabi.Copy(v.b, {off}, body)");
                w!(out, "}}");
                w!(out, "");
            }
        }
    }

    fn emit_array_accessors(
        &self,
        v: &VInfo<'a>,
        slot: &Slot<'a>,
        a: &ArrayShape<'a>,
        names: &Names,
        out: &mut String,
    ) {
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
        let k = slot.idx;
        let label = one_line(&self.r.slot_label(v, slot));
        let nm = |key: &str| self.mname(names, slot, key);
        let len_n = nm("len");
        w!(
            out,
            "// {len_n} returns the number of elements of `{label}`."
        );
        match &a.count {
            Count::Const(x) => w!(out, "func (v {n}) {len_n}() uint64 {{ return {x} }}"),
            Count::Expr(_) => w!(
                out,
                "func (v {n}) {len_n}() uint64 {{ return v.lay().Aux[{k}] }}"
            ),
        }
        w!(out, "");
        w!(
            out,
            "// {} returns the raw bytes of `{label}` (they alias the view).",
            nm("bytes")
        );
        w!(out, "func (v {n}) {}() []byte {{", nm("bytes"));
        w!(out, "\tl, err := v.layErr()");
        w!(out, "\tif err != nil {{");
        w!(out, "\t\treturn nil");
        w!(out, "\t}}");
        w!(out, "\treturn tnabi.Slice(v.b, l.Off[{k}], l.Len[{k}])");
        w!(out, "}}");
        w!(out, "");
        match &a.elem {
            Elem::Prim(p) => {
                let gt = go_prim(p);
                let es = prim_size(p);
                if let Some(g) = names.try_get(&format!("{k}:get")) {
                    w!(
                        out,
                        "// {g} returns `{label}` as bytes (they alias the view)."
                    );
                    w!(
                        out,
                        "func (v {n}) {g}() []byte {{ return v.{}() }}",
                        nm("bytes")
                    );
                    w!(out, "");
                }
                w!(
                    out,
                    "// {} returns element i of `{label}` (false when i is out of range).",
                    nm("at")
                );
                w!(out, "func (v {n}) {}(i uint64) ({gt}, bool) {{", nm("at"));
                w!(out, "\tl, err := v.layErr()");
                w!(out, "\tif err != nil {{");
                w!(out, "\t\treturn 0, false");
                w!(out, "\t}}");
                w!(out, "\tif i >= l.Aux[{k}] {{");
                w!(out, "\t\treturn 0, false");
                w!(out, "\t}}");
                w!(
                    out,
                    "\treturn {}, true",
                    raw_to_go(p, &format!("tnabi.Rd(v.b, l.Off[{k}]+i*{es}, {es})"))
                );
                w!(out, "}}");
                w!(out, "");
                w!(
                    out,
                    "// {} sets element i of `{label}` (tnabi.ErrOutOfBounds when i is out of range).",
                    nm("set_at")
                );
                w!(
                    out,
                    "func (v {n}) {}(i uint64, value {gt}) error {{",
                    nm("set_at")
                );
                w!(out, "\tl, err := v.layErr()");
                w!(out, "\tif err != nil {{");
                w!(out, "\t\treturn err");
                w!(out, "\t}}");
                w!(out, "\tif i >= l.Aux[{k}] {{");
                w!(out, "\t\treturn tnabi.ErrOutOfBounds");
                w!(out, "\t}}");
                w!(
                    out,
                    "\treturn tnabi.Wr(v.b, l.Off[{k}]+i*{es}, {es}, {})",
                    go_to_raw(p, "value")
                );
                w!(out, "}}");
                w!(out, "");
                let set_all = nm("set_all");
                w!(
                    out,
                    "// {set_all} overwrites every element of `{label}` (tnabi.ErrLengthMismatch unless"
                );
                w!(out, "// values has one value per element).");
                w!(out, "func (v {n}) {set_all}(values []{gt}) error {{");
                w!(out, "\tl, err := v.layErr()");
                w!(out, "\tif err != nil {{");
                w!(out, "\t\treturn err");
                w!(out, "\t}}");
                w!(out, "\tif uint64(len(values)) != l.Aux[{k}] {{");
                w!(out, "\t\treturn tnabi.ErrLengthMismatch");
                w!(out, "\t}}");
                w!(out, "\tfor i, value := range values {{");
                w!(
                    out,
                    "\t\tif err := tnabi.Wr(v.b, l.Off[{k}]+uint64(i)*{es}, {es}, {}); err != nil {{",
                    go_to_raw(p, "value")
                );
                w!(out, "\t\t\treturn err");
                w!(out, "\t\t}}");
                w!(out, "\t}}");
                w!(out, "\treturn nil");
                w!(out, "}}");
                w!(out, "");
            }
            Elem::View(cv) => {
                let ct = self.qn(cv.ty);
                let ext_ty = self.qext(cv.ty);
                /* Element locator: (offset, size, context); ErrOutOfBounds when i is out
                of range, the layout error when the bytes do not lay out. */
                w!(
                    out,
                    "func (v {n}) tn_elem_{k}(i uint64) (uint64, uint64, {ext_ty}, error) {{"
                );
                w!(out, "\tl, err := v.layErr()");
                w!(out, "\tif err != nil {{");
                w!(out, "\t\treturn 0, 0, {ext_ty}{{}}, err");
                w!(out, "\t}}");
                w!(out, "\tif i >= l.Aux[{k}] {{");
                w!(out, "\t\treturn 0, 0, {ext_ty}{{}}, tnabi.ErrOutOfBounds");
                w!(out, "\t}}");
                let e = self.accessor_ext(v, &format!("{k}"), cv, out);
                w!(out, "\text := {e}");
                if !a.walk {
                    let es = a.elem_size.unwrap_or(0);
                    w!(out, "\treturn l.Off[{k}] + i*{es}, {es}, ext, nil");
                } else if a.stride {
                    /* Every element has the first one's size. */
                    w!(out, "\tt, err := tnabi.Tail(v.b, l.Off[{k}])");
                    w!(out, "\tif err != nil {{");
                    w!(out, "\t\treturn 0, 0, ext, err");
                    w!(out, "\t}}");
                    w!(
                        out,
                        "\tcl, err := ext.TnLayout(tnabi.Bytes(t), tnabi.MaxU64)"
                    );
                    w!(out, "\tif err != nil {{");
                    w!(out, "\t\treturn 0, 0, ext, err");
                    w!(out, "\t}}");
                    w!(out, "\treturn l.Off[{k}] + i*cl.End, cl.End, ext, nil");
                } else {
                    w!(out, "\tat := l.Off[{k}]");
                    w!(out, "\tfor j := uint64(0); j <= i; j++ {{");
                    w!(out, "\t\tt, err := tnabi.Tail(v.b, at)");
                    w!(out, "\t\tif err != nil {{");
                    w!(out, "\t\t\treturn 0, 0, ext, err");
                    w!(out, "\t\t}}");
                    w!(
                        out,
                        "\t\tcl, err := ext.TnLayout(tnabi.Bytes(t), tnabi.MaxU64)"
                    );
                    w!(out, "\t\tif err != nil {{");
                    w!(out, "\t\t\treturn 0, 0, ext, err");
                    w!(out, "\t\t}}");
                    /* Zero-byte elements leave `at` in place: the rest are alike. */
                    w!(out, "\t\tif j == i || cl.End == 0 {{");
                    w!(out, "\t\t\treturn at, cl.End, ext, nil");
                    w!(out, "\t\t}}");
                    w!(out, "\t\tat += cl.End");
                    w!(out, "\t}}");
                    w!(out, "\treturn 0, 0, ext, tnabi.ErrOutOfBounds");
                }
                w!(out, "}}");
                w!(out, "");
                w!(
                    out,
                    "// {} returns a view of element i of `{label}` (false when i is out of range).",
                    nm("at")
                );
                w!(out, "func (v {n}) {}(i uint64) ({ct}, bool) {{", nm("at"));
                w!(out, "\tat, sz, ext, err := v.tn_elem_{k}(i)");
                w!(out, "\tif err != nil {{");
                w!(out, "\t\treturn {ct}{{}}, false");
                w!(out, "\t}}");
                w!(out, "\treturn ext.TnWrap(tnabi.Slice(v.b, at, sz)), true");
                w!(out, "}}");
                w!(out, "");
                w!(
                    out,
                    "// {} copies value into element i of `{label}` (the sizes must match;",
                    nm("set_at")
                );
                w!(
                    out,
                    "// tnabi.ErrOutOfBounds when i is out of range, the layout error when the"
                );
                w!(out, "// bytes do not lay out).");
                w!(
                    out,
                    "func (v {n}) {}(i uint64, value {ct}) error {{",
                    nm("set_at")
                );
                w!(out, "\tat, sz, _, err := v.tn_elem_{k}(i)");
                w!(out, "\tif err != nil {{");
                w!(out, "\t\treturn err");
                w!(out, "\t}}");
                w!(out, "\tsrc := value.Bytes()");
                w!(
                    out,
                    "\tif uint64(len(src)) < sz || uint64(value.Size()) != sz {{"
                );
                w!(out, "\t\treturn tnabi.ErrLengthMismatch");
                w!(out, "\t}}");
                w!(out, "\treturn tnabi.Copy(v.b, at, src[:sz])");
                w!(out, "}}");
                w!(out, "");
            }
            Elem::Opaque(_) => {}
        }
    }
}

/* ABI name of a variant payload type (`u8`, a named type, or the inline path). */
pub fn payload_type_name(ty: &ResolvedType) -> String {
    match &ty.kind {
        ResolvedTypeKind::TypeRef { target_name, .. } => target_name.clone(),
        ResolvedTypeKind::Primitive { prim_type } => match prim_type {
            PrimitiveType::Integral(i) => format!("{:?}", i).to_ascii_lowercase(),
            PrimitiveType::FloatingPoint(f) => format!("{:?}", f).to_ascii_lowercase(),
        },
        _ => ty.name.clone(),
    }
}

/* Argument names for exported fields, allocated together: `lower` maps
`Buf` (a reserved local) and `Buf_` both to `buf_`, so a name already taken
gets `_` appended until it is unique. */
pub fn distinct_args<'s>(fields: impl Iterator<Item = &'s str>) -> Vec<String> {
    let mut used: Vec<String> = Vec::new();
    for f in fields {
        let mut arg = lower(f);
        while used.contains(&arg) {
            arg.push('_');
        }
        used.push(arg);
    }
    used
}

/* Lower-case first letter (a local name for a field). */
pub fn lower(s: &str) -> String {
    let mut c = s.chars();
    let base = match c.next() {
        Some(f) => format!("{}{}", f.to_ascii_lowercase(), c.as_str()),
        None => String::from("x"),
    };
    if GO_KEYWORDS.contains(&base.as_str())
        || matches!(
            base.as_str(),
            "buf"
                | "p"
                | "sz"
                | "err"
                | "tnabi"
                | "len"
                | "int"
                | "uint8"
                | "uint16"
                | "uint32"
                | "uint64"
                | "int8"
                | "int16"
                | "int32"
                | "int64"
                | "float32"
                | "float64"
        )
    {
        format!("{base}_")
    } else {
        base
    }
}
