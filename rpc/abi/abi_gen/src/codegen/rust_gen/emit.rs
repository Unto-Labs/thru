/* Rust view/validator/parameter emitter.

For every view (see `model.rs`) this emits:
- `types.rs`: `<V>View<B>` (generic over the byte storage), the `<V>` /
  `<V>Mut` aliases, the `<V>__Ext` context struct, typed enum `...Ref`
  enums and `<V>Params` for named struct roots.
- `functions.rs`: a layout walker (`__tn_layout_of`), an initializer
  (`__tn_init_of`, used by `new()` and by `footprint_from_params` over a
  virtual buffer), a deep validator (`__tn_validate_of`) and accessors.

All size/offset math is checked; enum tags are matched at full width. */

use super::model::*;
use super::names::NameCtx;
use crate::abi::expr::{ExprKind, LiteralExpr};
use crate::abi::resolved::{ConstantStatus, ResolvedType, ResolvedTypeKind};
use crate::abi::types::PrimitiveType;
use std::cell::RefCell;
use std::collections::HashMap;
use std::fmt::Write;

macro_rules! w {
    ($out:expr, $($arg:tt)*) => { writeln!($out, $($arg)*).unwrap() };
}

#[derive(Clone)]
pub struct ViewRef<'a> {
    /* Model key of the view (its resolved type name). */
    pub vname: String,
    pub ty: &'a ResolvedType,
    pub named: bool,
    pub size: Option<u64>,
}

#[derive(Clone)]
pub enum Elem<'a> {
    Prim(PrimitiveType),
    View(ViewRef<'a>),
    Opaque(Option<u64>),
}

impl Elem<'_> {
    pub fn size(&self) -> Option<u64> {
        match self {
            Elem::Prim(p) => Some(prim_size(p) as u64),
            Elem::View(v) => v.size,
            Elem::Opaque(s) => *s,
        }
    }
}

#[derive(Clone)]
pub enum Count<'a> {
    Const(u64),
    Expr(&'a ExprKind),
}

#[derive(Clone)]
pub struct ArrayShape<'a> {
    pub count: Count<'a>,
    pub elem: Elem<'a>,
    pub elem_size: Option<u64>,
    pub walk: bool,
    /* Non-jagged array of variable-size elements that all share one size,
    fixed by the values the array supplies (an inline enum selected by an
    outside tag): the first element's size is the stride. */
    pub stride: bool,
}

#[derive(Clone)]
pub struct Variant<'a> {
    pub name: String,
    /* Enum tag value, or expected size for size-discriminated unions. */
    pub tag: u64,
    pub elem: Elem<'a>,
}

#[derive(Clone)]
pub enum Shape<'a> {
    Prim(PrimitiveType),
    Array(ArrayShape<'a>),
    View(ViewRef<'a>),
    Enum {
        tag: &'a ExprKind,
        variants: Vec<Variant<'a>>,
    },
    Sdu {
        variants: Vec<Variant<'a>>,
    },
}

#[derive(Clone)]
pub struct Slot<'a> {
    pub idx: usize,
    pub name: String,
    pub ty: &'a ResolvedType,
    pub static_off: Option<u64>,
    pub align: u64,
    pub shape: Shape<'a>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Mode {
    Layout,
    Init,
}

pub struct Emitter<'m, 'a> {
    pub m: &'m Model<'a>,
    deep_cache: RefCell<HashMap<String, bool>>,
    /* Module-level name tables (see `names.rs`). */
    pub(crate) names: NameCtx,
}

/* Owned snapshot of a view's metadata (avoids holding RefCell borrows). */
#[derive(Clone)]
pub struct VInfo<'a> {
    pub name: String,
    pub ty: &'a ResolvedType,
    pub ancestors: Vec<Frame<'a>>,
    pub ext: Vec<ExtVarT<'a>>,
    pub named: bool,
    pub params: Vec<FieldTarget<'a>>,
}

#[derive(Clone)]
pub struct ExtVarT<'a> {
    pub key: String,
    pub ident: String,
    pub external_path: Option<String>,
    pub target: Option<FieldTarget<'a>>,
}

impl<'a> VInfo<'a> {
    pub fn is_struct(&self) -> bool {
        matches!(self.ty.kind, ResolvedTypeKind::Struct { .. })
    }
    /* A union with variable-size variants: which variant spans it is not
    encoded, so its size is a parameter. */
    pub fn is_var_union(&self) -> bool {
        matches!(self.ty.kind, ResolvedTypeKind::Union { .. }) && const_size(self.ty).is_none()
    }
    pub fn is_sdu(&self) -> bool {
        matches!(
            self.ty.kind,
            ResolvedTypeKind::SizeDiscriminatedUnion { .. }
        )
    }
    pub fn has_ext(&self) -> bool {
        !self.ext.is_empty()
    }
    pub fn ext_ident(&self, key: &str) -> Option<&str> {
        self.ext
            .iter()
            .find(|e| e.key == key)
            .map(|e| e.ident.as_str())
    }
    /* Public construction API (new/params/builders) needs a self-contained root. */
    pub fn is_root_struct(&self) -> bool {
        self.named && self.is_struct() && !self.has_ext()
    }
    pub fn packed(&self) -> bool {
        matches!(self.ty.kind, ResolvedTypeKind::Struct { packed: true, .. })
    }
}

impl<'m, 'a> Emitter<'m, 'a> {
    pub fn new(m: &'m Model<'a>) -> Self {
        Self {
            m,
            deep_cache: RefCell::new(HashMap::new()),
            names: NameCtx::default(),
        }
    }

    /* Assign declared types to ABI packages (each package has its own name
    table; types absent from `pkg_of` share the unnamed package) and name the
    package being emitted, whose references to other packages' items are
    qualified when a bare name would be shadowed. */
    pub fn with_packages(
        mut self,
        pkg_of: HashMap<String, String>,
        current: Option<String>,
    ) -> Self {
        self.names = NameCtx {
            pkg_of,
            current,
            ..NameCtx::default()
        };
        self
    }

    /* Named views whose layout depends on values outside their bytes (e.g. a
    top-level enum's tag): `<T>Params` is their context struct. */
    pub fn has_ext_params(&self, v: &VInfo<'a>) -> bool {
        v.named && v.has_ext()
    }

    /* Views with any `<T>Params` type. */
    pub fn has_params(&self, v: &VInfo<'a>) -> bool {
        self.has_params_struct(v) || self.has_ext_params(v)
    }

    /* (Rust field, ABI path) of every `<T>Params` field. */
    pub fn param_keys(&self, v: &VInfo<'a>) -> Vec<(String, String)> {
        if self.has_params_struct(v) {
            self.param_fields(v)
                .into_iter()
                .map(|f| (f.ident, f.doc))
                .collect()
        } else {
            v.ext
                .iter()
                .map(|e| {
                    let path = e
                        .external_path
                        .clone()
                        .unwrap_or_else(|| e.key.split('|').nth(1).unwrap_or("").to_string());
                    (e.ident.clone(), path)
                })
                .collect()
        }
    }

    /* Views with a `<T>Params` struct of their own. */
    pub fn has_params_struct(&self, v: &VInfo<'a>) -> bool {
        v.is_root_struct() || (v.named && !v.has_ext() && (v.is_sdu() || v.is_var_union()))
    }

    pub fn info(&self, vname: &str) -> Option<VInfo<'a>> {
        let cell = self.m.view(vname)?;
        let v = cell.borrow();
        Some(VInfo {
            name: v.name.clone(),
            ty: v.ty,
            ancestors: v.ancestors.clone(),
            ext: v
                .ext
                .iter()
                .map(|e| ExtVarT {
                    key: e.key.clone(),
                    ident: e.ident.clone(),
                    external_path: e.external_path.clone(),
                    target: e.target.clone(),
                })
                .collect(),
            named: v.named,
            params: v.params.clone(),
        })
    }

    /* ------------------------------------------------------------------
     * Shapes
     * ---------------------------------------------------------------- */

    pub fn view_ref(&self, ty: &'a ResolvedType) -> Option<ViewRef<'a>> {
        match &ty.kind {
            ResolvedTypeKind::TypeRef { .. } => {
                let d = self.m.deref(ty);
                match &d.kind {
                    ResolvedTypeKind::Primitive { .. } | ResolvedTypeKind::TypeRef { .. } => None,
                    ResolvedTypeKind::SizeDiscriminatedUnion { .. } => None,
                    _ => {
                        self.m.collect_named(&d.name);
                        Some(ViewRef {
                            vname: d.name.clone(),
                            ty: d,
                            named: true,
                            size: const_size(d),
                        })
                    }
                }
            }
            ResolvedTypeKind::Struct { .. }
            | ResolvedTypeKind::Union { .. }
            | ResolvedTypeKind::Array { .. }
            | ResolvedTypeKind::Enum { .. } => Some(ViewRef {
                vname: ty.name.clone(),
                ty,
                named: false,
                size: const_size(ty),
            }),
            _ => None,
        }
    }

    pub fn elem_of(&self, ty: &'a ResolvedType) -> Elem<'a> {
        let d = self.m.deref(ty);
        if let ResolvedTypeKind::Primitive { prim_type } = &d.kind {
            return Elem::Prim(prim_type.clone());
        }
        match self.view_ref(ty) {
            Some(v) => Elem::View(v),
            None => Elem::Opaque(const_size(ty)),
        }
    }

    pub fn shape_of(&self, ty: &'a ResolvedType) -> Shape<'a> {
        let d = self.m.deref(ty);
        if let ResolvedTypeKind::Primitive { prim_type } = &d.kind {
            return Shape::Prim(prim_type.clone());
        }
        match &ty.kind {
            ResolvedTypeKind::Array {
                element_type,
                size_expression,
                size_constant_status,
                jagged,
            } => {
                let count = match size_constant_status {
                    ConstantStatus::Constant => {
                        match self
                            .m
                            .resolver
                            .evaluate_constant_expression(size_expression)
                        {
                            Some(c) => Count::Const(c),
                            None => Count::Expr(size_expression),
                        }
                    }
                    _ => Count::Expr(size_expression),
                };
                let elem = self.elem_of(element_type);
                let elem_size = elem.size();
                let stride = !*jagged
                    && elem_size.is_none()
                    && matches!(&elem, Elem::View(c) if !self.open_view(c));
                Shape::Array(ArrayShape {
                    count,
                    walk: *jagged || elem_size.is_none(),
                    elem,
                    elem_size,
                    stride,
                })
            }
            ResolvedTypeKind::Enum {
                tag_expression,
                variants,
                ..
            } => Shape::Enum {
                tag: tag_expression,
                variants: variants
                    .iter()
                    .map(|v| Variant {
                        name: v.name.clone(),
                        tag: v.tag_value,
                        elem: self.elem_of(&v.variant_type),
                    })
                    .collect(),
            },
            ResolvedTypeKind::SizeDiscriminatedUnion { variants } => Shape::Sdu {
                variants: variants
                    .iter()
                    .map(|v| Variant {
                        name: v.name.clone(),
                        tag: v.expected_size,
                        elem: self.elem_of(&v.variant_type),
                    })
                    .collect(),
            },
            _ => match self.view_ref(ty) {
                Some(v) => Shape::View(v),
                None => Shape::Array(ArrayShape {
                    count: Count::Const(const_size(ty).unwrap_or(0)),
                    elem: Elem::Prim(PrimitiveType::Integral(crate::abi::types::IntegralType::U8)),
                    elem_size: Some(1),
                    walk: false,
                    stride: false,
                }),
            },
        }
    }

    pub fn slots(&self, v: &VInfo<'a>) -> Vec<Slot<'a>> {
        match &v.ty.kind {
            ResolvedTypeKind::Struct { fields, packed, .. } => fields
                .iter()
                .enumerate()
                .map(|(i, f)| Slot {
                    idx: i,
                    name: f.name.clone(),
                    ty: &f.field_type,
                    static_off: f.offset,
                    align: if *packed {
                        1
                    } else {
                        f.field_type.alignment.max(1)
                    },
                    shape: self.shape_of(&f.field_type),
                })
                .collect(),
            ResolvedTypeKind::Union { variants } => variants
                .iter()
                .enumerate()
                .map(|(i, f)| Slot {
                    idx: i,
                    name: f.name.clone(),
                    ty: &f.field_type,
                    static_off: Some(0),
                    align: 1,
                    shape: self.shape_of(&f.field_type),
                })
                .collect(),
            ResolvedTypeKind::Array { .. }
            | ResolvedTypeKind::Enum { .. }
            | ResolvedTypeKind::SizeDiscriminatedUnion { .. } => vec![Slot {
                idx: 0,
                name: String::new(),
                ty: v.ty,
                static_off: Some(0),
                align: 1,
                shape: self.shape_of(v.ty),
            }],
            _ => Vec::new(),
        }
    }

    pub fn nslots(&self, v: &VInfo<'a>) -> usize {
        self.slots(v).len()
    }

    /* Frames visible to an expression attached to slot `k` of `v`. */
    pub fn frames_at(&self, v: &VInfo<'a>, k: usize) -> Vec<Frame<'a>> {
        let mut frames = v.ancestors.clone();
        if v.is_struct() {
            frames.push(Frame { ty: v.ty, upto: k });
        }
        frames
    }

    /* Alignment the encoded size of a variable-size struct rounds up to (the
    final align-up of the shared layout IR); 1 for everything else. */
    pub fn tail_align(&self, v: &VInfo<'a>) -> u64 {
        if v.is_struct() && const_size(v.ty).is_none() {
            v.ty.alignment.max(1)
        } else {
            1
        }
    }

    /* Does validating this type need more than its size walk? */
    pub fn needs_deep(&self, ty: &'a ResolvedType) -> bool {
        let key = ty.name.clone();
        if let Some(v) = self.deep_cache.borrow().get(&key) {
            return *v;
        }
        let r = match &ty.kind {
            ResolvedTypeKind::Enum { .. } | ResolvedTypeKind::SizeDiscriminatedUnion { .. } => true,
            ResolvedTypeKind::Primitive { .. } => false,
            ResolvedTypeKind::TypeRef { .. } => {
                let d = self.m.deref(ty);
                !std::ptr::eq(d, ty) && self.needs_deep(d)
            }
            ResolvedTypeKind::Struct { fields, .. } => {
                fields.iter().any(|f| self.needs_deep(&f.field_type))
            }
            /* A union is valid when every variant is. */
            ResolvedTypeKind::Union { variants } => {
                variants.iter().any(|f| self.needs_deep(&f.field_type))
            }
            ResolvedTypeKind::Array { element_type, .. } => self.needs_deep(element_type),
        };
        self.deep_cache.borrow_mut().insert(key, r);
        r
    }

    /* ------------------------------------------------------------------
     * Expressions
     * ---------------------------------------------------------------- */

    /* Offset (relative to the view's data) of a path owned by `v`. */
    fn path_off(&self, v: &VInfo<'a>, segs: &[Seg]) -> Option<(String, PrimitiveType)> {
        let slots = self.slots(v);
        let first = match segs.first()? {
            Seg::Field(f) => f,
            Seg::Index(_) => return None,
        };
        let slot = slots.iter().find(|s| &s.name == first)?;
        let mut cst: Option<u64> = slot.static_off;
        let mut expr: String = match slot.static_off {
            Some(c) => format!("{}usize", c),
            None => format!("l.off[{}]", slot.idx),
        };
        let mut cur: &'a ResolvedType = slot.ty;
        for (depth, seg) in segs[1..].iter().enumerate() {
            let raw = cur;
            let d = self.m.deref(cur);
            match (seg, &d.kind) {
                (Seg::Field(name), ResolvedTypeKind::Struct { fields, .. }) => {
                    let j = fields.iter().position(|f| &f.name == name)?;
                    match fields[j].offset {
                        Some(c) => {
                            if let Some(b) = cst {
                                cst = Some(b + c);
                                expr = format!("{}usize", b + c);
                            } else {
                                expr = format!("tn_add({}, {})?", expr, c);
                            }
                        }
                        None => {
                            let cv = self.view_ref(raw)?;
                            let cinfo = self.info(&cv.vname)?;
                            let ext = if !cinfo.has_ext() {
                                format!("{}::default()", self.nm(&cv.vname).ext)
                            } else if depth == 0 && !cv.named {
                                format!(
                                    "{}::__tn_ext_{}(&*data, l.tn_ref(), ext)?",
                                    self.nm(&v.name).ty,
                                    slot.idx
                                )
                            } else {
                                return None;
                            };
                            expr = format!(
                                "tn_add({e}, tn_at(&*data, {e}, |s| {c}::__tn_layout_of(s, &{x}, usize::MAX))?.off[{j}])?",
                                e = expr,
                                c = self.nm(&cv.vname).ty,
                                x = ext,
                                j = j
                            );
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
                        expr = format!("{}usize", b + add);
                    } else {
                        expr = format!("tn_add({}, {})?", expr, add);
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
        Some((expr, prim))
    }

    /* Value of a resolved reference inside view `v` (needs `data`, `l`, `ext`). */
    fn ref_value(&self, v: &VInfo<'a>, r: &RefKind<'a>) -> String {
        match r {
            RefKind::BufferSize => "(data.tn_avail()? as u64)".to_string(),
            RefKind::External(raw) => match v.ext_ident(&format!("?|{}", raw)) {
                Some(id) => format!("ext.{}", id),
                None => "(return Err(AbiError::MissingParam))".to_string(),
            },
            RefKind::Field(t) => {
                if v.is_struct() && t.owner == v.ancestors.len() {
                    match self.path_off(v, &t.segs) {
                        Some((off, prim)) => raw_to_value(
                            &prim,
                            &format!("data.tn_get({}, {})?", off, prim_size(&prim)),
                        ),
                        None => "(return Err(AbiError::Unsupported))".to_string(),
                    }
                } else {
                    match v.ext_ident(&t.key()) {
                        Some(id) => format!("ext.{}", id),
                        None => "(return Err(AbiError::MissingParam))".to_string(),
                    }
                }
            }
        }
    }

    fn expr_code(&self, v: &VInfo<'a>, frames: &[Frame<'a>], e: &ExprKind) -> String {
        let b = |l: &ExprKind, r: &ExprKind, f: &str| {
            format!(
                "{}({}, {})?",
                f,
                self.expr_code(v, frames, l),
                self.expr_code(v, frames, r)
            )
        };
        let op = |l: &ExprKind, r: &ExprKind, o: &str| {
            format!(
                "({} {} {})",
                self.expr_code(v, frames, l),
                o,
                self.expr_code(v, frames, r)
            )
        };
        let cmp = |l: &ExprKind, r: &ExprKind, o: &str| {
            format!(
                "(({} {} {}) as u64)",
                self.expr_code(v, frames, l),
                o,
                self.expr_code(v, frames, r)
            )
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
                format!("{}u64", val)
            }
            ExprKind::Sizeof(_) | ExprKind::Alignof(_) => {
                match self.m.resolver.evaluate_constant_expression(e) {
                    Some(c) => format!("{}u64", c),
                    None => "(return Err(AbiError::Unsupported))".to_string(),
                }
            }
            ExprKind::FieldRef(r) => {
                let resolved = self.m.resolve(&r.path, frames);
                self.ref_value(v, &resolved)
            }
            ExprKind::Add(x) => b(&x.left, &x.right, "tn_e_add"),
            ExprKind::Sub(x) => b(&x.left, &x.right, "tn_e_sub"),
            ExprKind::Mul(x) => b(&x.left, &x.right, "tn_e_mul"),
            ExprKind::Div(x) => b(&x.left, &x.right, "tn_e_div"),
            ExprKind::Mod(x) => b(&x.left, &x.right, "tn_e_mod"),
            ExprKind::Pow(x) => b(&x.left, &x.right, "tn_e_pow"),
            ExprKind::LeftShift(x) => b(&x.left, &x.right, "tn_e_shl"),
            ExprKind::RightShift(x) => format!(
                "tn_e_shr({}, {})",
                self.expr_code(v, frames, &x.left),
                self.expr_code(v, frames, &x.right)
            ),
            ExprKind::BitAnd(x) => op(&x.left, &x.right, "&"),
            ExprKind::BitOr(x) => op(&x.left, &x.right, "|"),
            ExprKind::BitXor(x) => op(&x.left, &x.right, "^"),
            ExprKind::Eq(x) => cmp(&x.left, &x.right, "=="),
            ExprKind::Ne(x) => cmp(&x.left, &x.right, "!="),
            ExprKind::Lt(x) => cmp(&x.left, &x.right, "<"),
            ExprKind::Gt(x) => cmp(&x.left, &x.right, ">"),
            ExprKind::Le(x) => cmp(&x.left, &x.right, "<="),
            ExprKind::Ge(x) => cmp(&x.left, &x.right, ">="),
            ExprKind::And(x) => format!(
                "((({}) != 0 && ({}) != 0) as u64)",
                self.expr_code(v, frames, &x.left),
                self.expr_code(v, frames, &x.right)
            ),
            ExprKind::Or(x) => format!(
                "((({}) != 0 || ({}) != 0) as u64)",
                self.expr_code(v, frames, &x.left),
                self.expr_code(v, frames, &x.right)
            ),
            ExprKind::Xor(x) => format!(
                "((({}) != 0) as u64 ^ (({}) != 0) as u64)",
                self.expr_code(v, frames, &x.left),
                self.expr_code(v, frames, &x.right)
            ),
            ExprKind::BitNot(x) => format!("(!{})", self.expr_code(v, frames, &x.operand)),
            ExprKind::Neg(x) => format!("tn_e_neg({})?", self.expr_code(v, frames, &x.operand)),
            ExprKind::Not(x) => format!(
                "((({}) == 0) as u64)",
                self.expr_code(v, frames, &x.operand)
            ),
            ExprKind::Popcount(x) => format!(
                "(({}).count_ones() as u64)",
                self.expr_code(v, frames, &x.operand)
            ),
        }
    }

    /* Code building the ext struct of `child` from inside slot `k` of `v`. */
    fn ext_init_code(&self, v: &VInfo<'a>, k: usize, child: &VInfo<'a>) -> String {
        let frames = self.frames_at(v, k);
        let mut out = format!("{} {{", self.nm(&child.name).ext);
        for var in &child.ext {
            let value = if let Some(raw) = &var.external_path {
                let path: Vec<String> = raw.split('.').map(|s| s.to_string()).collect();
                let r = self.m.resolve(&path, &frames);
                self.ref_value(v, &r)
            } else if let Some(t) = &var.target {
                self.ref_value(v, &RefKind::Field(t.clone()))
            } else {
                "(return Err(AbiError::MissingParam))".to_string()
            };
            write!(out, " {}: {},", var.ident, value).unwrap();
        }
        out.push_str(" }");
        out
    }

    /* Expression yielding the child's ext inside walker code. */
    fn child_ext(&self, v: &VInfo<'a>, fn_suffix: &str, child: &ViewRef<'a>) -> String {
        let _ = v;
        match self.info(&child.vname) {
            Some(ci) if ci.has_ext() => {
                format!("Self::__tn_ext_{}(&*data, &l, ext)?", fn_suffix)
            }
            _ => format!("{}::default()", self.nm(&child.vname).ext),
        }
    }

    /* Children (with ext) of a slot: (fn suffix, child view). */
    pub fn slot_children(&self, slot: &Slot<'a>) -> Vec<(String, ViewRef<'a>)> {
        let mut out = Vec::new();
        match &slot.shape {
            Shape::View(c) => out.push((format!("{}", slot.idx), c.clone())),
            Shape::Array(a) => {
                if let Elem::View(c) = &a.elem {
                    out.push((format!("{}", slot.idx), c.clone()));
                }
            }
            Shape::Enum { variants, .. } | Shape::Sdu { variants } => {
                for (vi, var) in variants.iter().enumerate() {
                    if let Elem::View(c) = &var.elem {
                        out.push((format!("{}_{}", slot.idx, vi), c.clone()));
                    }
                }
            }
            Shape::Prim(_) => {}
        }
        out
    }

    /* ------------------------------------------------------------------
     * types.rs
     * ---------------------------------------------------------------- */

    pub fn emit_view_types(&self, v: &VInfo<'a>, out: &mut String) {
        let nm = self.nm(&v.name);
        let n = &nm.ty;
        w!(out, "/* View: {} */", v.ty.name);
        if let ResolvedTypeKind::Struct { packed, .. } = &v.ty.kind {
            w!(out, "#[allow(dead_code, non_camel_case_types)]");
            w!(
                out,
                "{}",
                if *packed {
                    "#[repr(C, packed)]"
                } else {
                    "#[repr(C)]"
                }
            );
            w!(out, "pub struct {} {{ _private: [u8; 0] }}", nm.layout);
            w!(out, "");
        }
        w!(
            out,
            "/// Context a `{}` view needs from its enclosing type.",
            n
        );
        w!(out, "#[allow(non_camel_case_types)]");
        w!(out, "#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]");
        if v.ext.is_empty() {
            w!(out, "pub struct {} {{}}", nm.ext);
        } else {
            w!(out, "pub struct {} {{", nm.ext);
            for e in &v.ext {
                w!(
                    out,
                    "    /// Referenced as `{}`",
                    e.key.split('|').nth(1).unwrap_or("")
                );
                w!(out, "    pub {}: u64,", e.ident);
            }
            w!(out, "}}");
        }
        w!(out, "");
        if let Some(c) = &v.ty.comment {
            w!(out, "/// {}", c.replace('\n', " "));
        }
        w!(
            out,
            "/// Zero-copy view over `{}` bytes stored in `B`.",
            v.ty.name
        );
        w!(out, "#[allow(non_camel_case_types)]");
        w!(out, "#[derive(Clone, Copy, Debug)]");
        w!(out, "pub struct {}<B> {{", nm.view);
        w!(out, "    pub(crate) data: B,");
        w!(out, "    pub(crate) ext: {},", nm.ext);
        w!(out, "}}");
        w!(out, "#[allow(non_camel_case_types)]");
        w!(out, "pub type {}<'a> = {}<&'a [u8]>;", n, nm.view);
        w!(out, "#[allow(non_camel_case_types)]");
        w!(out, "pub type {}<'a> = {}<&'a mut [u8]>;", nm.mut_, nm.view);
        w!(out, "");

        for slot in self.slots(v) {
            match &slot.shape {
                Shape::Enum { variants, .. } | Shape::Sdu { variants } => {
                    let (rn, rmn) = self.ref_enum_names(v, &slot);
                    let arms = self.variant_arm_names(variants);
                    let needs_lt = variants
                        .iter()
                        .any(|var| !matches!(var.elem, Elem::Prim(_)));
                    w!(
                        out,
                        "/// Active variant of `{}`.",
                        self.slot_label(v, &slot)
                    );
                    w!(
                        out,
                        "#[allow(non_camel_case_types, clippy::large_enum_variant, clippy::enum_variant_names)]"
                    );
                    w!(out, "#[derive(Clone, Copy, Debug)]");
                    w!(out, "pub enum {}<'a> {{", rn);
                    for (var, arm) in variants.iter().zip(&arms) {
                        w!(out, "    {}({}),", arm, self.variant_ref_ty(var, false));
                    }
                    w!(out, "    /// Tag that matches no declared variant.");
                    w!(out, "    {}(u64),", self.unknown_arm(&arms));
                    if !needs_lt {
                        w!(out, "    #[doc(hidden)]");
                        w!(out, "    __Phantom(::core::marker::PhantomData<&'a ()>),");
                    }
                    w!(out, "}}");
                    w!(
                        out,
                        "#[allow(non_camel_case_types, clippy::large_enum_variant, clippy::enum_variant_names)]"
                    );
                    w!(out, "#[derive(Debug)]");
                    w!(out, "pub enum {}<'a> {{", rmn);
                    for (var, arm) in variants.iter().zip(&arms) {
                        w!(out, "    {}({}),", arm, self.variant_ref_ty(var, true));
                    }
                    w!(out, "    {}(u64),", self.unknown_arm(&arms));
                    if variants.is_empty() {
                        w!(out, "    #[doc(hidden)]");
                        w!(out, "    __Phantom(::core::marker::PhantomData<&'a ()>),");
                    }
                    w!(out, "}}");
                    w!(out, "");
                }
                _ => {}
            }
        }

        if self.has_params_struct(v) {
            self.emit_params_type(v, out);
        } else if self.has_ext_params(v) {
            w!(
                out,
                "/// Dynamic parameters of `{}`: the values it references from outside.",
                v.ty.name
            );
            w!(out, "#[allow(non_camel_case_types)]");
            w!(out, "pub type {} = {};", nm.params, nm.ext);
            w!(out, "");
        }
    }

    pub fn slot_label(&self, v: &VInfo<'a>, slot: &Slot<'a>) -> String {
        if slot.name.is_empty() {
            v.ty.name.clone()
        } else {
            format!("{}.{}", v.ty.name, slot.name)
        }
    }

    pub fn ref_enum_names(&self, v: &VInfo<'a>, slot: &Slot<'a>) -> (String, String) {
        let r = self.ref_names(&v.name, slot.idx, &slot.name);
        (r.read.clone(), r.write.clone())
    }

    pub fn variant_arm_names(&self, variants: &[Variant<'a>]) -> Vec<String> {
        let mut names: Vec<String> = Vec::new();
        for var in variants {
            let mut n = to_camel(&var.name);
            if n == "Unknown" || n == "__Phantom" {
                n.push('_');
            }
            while names.contains(&n) {
                n.push('_');
            }
            names.push(n);
        }
        names
    }

    pub fn unknown_arm(&self, _arms: &[String]) -> &'static str {
        "Unknown"
    }

    fn variant_ref_ty(&self, var: &Variant<'a>, mutable: bool) -> String {
        match &var.elem {
            Elem::Prim(p) => {
                if mutable {
                    "&'a mut [u8]".to_string()
                } else {
                    prim_rust(p).to_string()
                }
            }
            Elem::View(c) => {
                if mutable {
                    format!("{}<'a>", self.nm(&c.vname).mut_)
                } else {
                    format!("{}<'a>", self.nm(&c.vname).ty)
                }
            }
            Elem::Opaque(_) => {
                if mutable {
                    "&'a mut [u8]".to_string()
                } else {
                    "&'a [u8]".to_string()
                }
            }
        }
    }

    /* Names of the public dynamic parameters of a root struct. */
    pub fn param_fields(&self, v: &VInfo<'a>) -> Vec<ParamField<'a>> {
        let mut out: Vec<ParamField<'a>> = Vec::new();
        let mut used: Vec<String> = Vec::new();
        let mut uniq = |base: String| {
            let mut n = base.clone();
            let mut i = 1;
            while used.contains(&n) {
                i += 1;
                n = format!("{}_{}", base, i);
            }
            used.push(n.clone());
            escape_ident(&n)
        };
        for t in &v.params {
            out.push(ParamField {
                ident: uniq(segs_to_ident(&t.segs)),
                kind: ParamKind::Target(t.clone()),
                doc: segs_to_string(&t.segs),
            });
        }
        for slot in self.slots(v) {
            if let Shape::Sdu { .. } = slot.shape {
                let (ident, doc) = if slot.name.is_empty() {
                    ("variant".to_string(), "variant".to_string())
                } else {
                    (
                        format!("{}_variant", plain_ident(&slot.name)),
                        format!("{}.variant", slot.name),
                    )
                };
                out.push(ParamField {
                    ident: uniq(ident),
                    kind: ParamKind::SduVariant(slot.idx),
                    doc,
                });
            }
        }
        for slot in self.slots(v) {
            if self.open_slot(v, &slot) {
                out.push(ParamField {
                    ident: uniq(format!("{}_payload_size", plain_ident(&slot.name))),
                    kind: ParamKind::PayloadSize(slot.idx),
                    doc: format!("{}.payload_size", slot.name),
                });
            }
        }
        if v.is_var_union() {
            out.push(ParamField {
                ident: uniq("payload_size".to_string()),
                kind: ParamKind::UnionSize,
                doc: "payload_size".to_string(),
            });
        }
        if self.uses_buffer_size(v) {
            out.push(ParamField {
                ident: uniq("buffer_size".to_string()),
                kind: ParamKind::BufferSize,
                doc: "__buffer_size".to_string(),
            });
        }
        out
    }

    /* A variable-size child whose size its own bytes decide. */
    pub fn open_view(&self, c: &ViewRef<'a>) -> bool {
        c.size.is_none()
            && self
                .m
                .view(&c.vname)
                .map(|i| i.borrow().self_dep)
                .unwrap_or(false)
    }

    /* Slot of a parameterized struct whose size the referenced length/tag
    fields alone do not fix: its byte size becomes a parameter. */
    pub fn open_slot(&self, v: &VInfo<'a>, slot: &Slot<'a>) -> bool {
        if !(v.is_struct() && self.has_params_struct(v)) {
            return false;
        }
        match &slot.shape {
            Shape::View(c) => self.open_view(c),
            Shape::Enum { variants, .. } => variants.iter().any(|x| match &x.elem {
                Elem::View(c) => self.open_view(c),
                _ => false,
            }),
            Shape::Array(a) => a.walk && matches!(&a.elem, Elem::View(c) if self.open_view(c)),
            Shape::Prim(_) | Shape::Sdu { .. } => false,
        }
    }

    /* `<Params>` field holding the byte size of slot `k`, if it has one. */
    pub fn payload_param(&self, v: &VInfo<'a>, k: usize) -> Option<String> {
        self.param_fields(v)
            .into_iter()
            .find(|f| matches!(f.kind, ParamKind::PayloadSize(i) if i == k))
            .map(|f| f.ident)
    }

    pub fn uses_buffer_size(&self, v: &VInfo<'a>) -> bool {
        self.m
            .view(&v.name)
            .map(|c| c.borrow().uses_buffer_size)
            .unwrap_or(false)
    }

    fn emit_params_type(&self, v: &VInfo<'a>, out: &mut String) {
        let fields = self.param_fields(v);
        w!(
            out,
            "/// Dynamic parameters of `{}`: the referenced length/tag fields.",
            v.ty.name
        );
        w!(out, "#[allow(non_camel_case_types)]");
        w!(out, "#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]");
        if fields.is_empty() {
            w!(out, "pub struct {} {{}}", self.nm(&v.name).params);
        } else {
            w!(out, "pub struct {} {{", self.nm(&v.name).params);
            for f in &fields {
                match f.kind {
                    ParamKind::SduVariant(_) => w!(
                        out,
                        "    /// Variant index of the size-discriminated union (ABI path: {}).",
                        f.doc
                    ),
                    ParamKind::PayloadSize(_) => w!(
                        out,
                        "    /// Encoded byte size of `{}` (ABI path: {}).",
                        f.doc.trim_end_matches(".payload_size"),
                        f.doc
                    ),
                    ParamKind::UnionSize => w!(
                        out,
                        "    /// Encoded byte size of the union, i.e. of its largest variant (ABI path: {}).",
                        f.doc
                    ),
                    _ => w!(out, "    /// ABI path: {}", f.doc),
                }
                w!(out, "    pub {}: u64,", f.ident);
            }
            w!(out, "}}");
        }
        w!(out, "");
    }

    /* ------------------------------------------------------------------
     * functions.rs: walkers
     * ---------------------------------------------------------------- */

    pub fn emit_view_functions(&self, v: &VInfo<'a>, out: &mut String) {
        let nm = self.nm(&v.name);
        let n = &nm.ty;
        let slots = self.slots(v);
        let nn = slots.len();
        w!(out, "impl<'a> {}<'a> {{", n);
        self.emit_layout_fn(v, &slots, out);
        self.emit_init_fn(v, &slots, out);
        self.emit_validate_fn(v, &slots, out);
        self.emit_expr_fns(v, &slots, out);
        self.emit_ctor_fns(v, out);
        self.emit_variant_meta(v, &slots, out);
        w!(out, "}}");
        w!(out, "");
        w!(out, "impl<'a> {}<'a> {{", nm.mut_);
        if v.has_ext() {
            w!(
                out,
                "    /// Validate `data` with explicit context and wrap it mutably."
            );
            w!(
                out,
                "    pub fn from_slice_mut_with(data: &'a mut [u8], ext: {}) -> ::core::result::Result<Self, AbiError> {{",
                nm.ext
            );
            w!(out, "        {}::__tn_validate_of(data, &ext)?;", n);
            w!(out, "        Ok(Self {{ data, ext }})");
            w!(out, "    }}");
        } else {
            w!(out, "    /// Validate `data` and wrap it mutably.");
            w!(
                out,
                "    pub fn from_slice_mut(data: &'a mut [u8]) -> ::core::result::Result<Self, AbiError> {{"
            );
            w!(
                out,
                "        {}::__tn_validate_of(data, &{}::default())?;",
                n,
                nm.ext
            );
            w!(
                out,
                "        Ok(Self {{ data, ext: {}::default() }})",
                nm.ext
            );
            w!(out, "    }}");
        }
        w!(out, "}}");
        w!(out, "");

        /* Read accessors */
        w!(
            out,
            "impl<B: ::core::convert::AsRef<[u8]>> {}<B> {{",
            nm.view
        );
        w!(out, "    /// The bytes this view was created over.");
        w!(out, "    #[inline]");
        w!(
            out,
            "    pub fn as_bytes(&self) -> &[u8] {{ self.data.as_ref() }}"
        );
        w!(out, "    /// Context supplied by the enclosing type.");
        w!(out, "    #[inline]");
        w!(
            out,
            "    pub fn context(&self) -> &{} {{ &self.ext }}",
            nm.ext
        );
        w!(out, "    #[inline]");
        w!(out, "    fn __tn_lay(&self) -> TnLayout<{}> {{", nn);
        w!(
            out,
            "        tn_expect({}::__tn_layout_of(self.data.as_ref(), &self.ext, usize::MAX))",
            n
        );
        w!(out, "    }}");
        w!(out, "    /// Size in bytes of the encoded value.");
        if let Some(c) = const_size(v.ty) {
            w!(out, "    #[inline]");
            w!(out, "    pub fn size(&self) -> usize {{ {} }}", c);
        } else {
            w!(
                out,
                "    pub fn size(&self) -> usize {{ self.__tn_lay().end }}"
            );
        }
        w!(
            out,
            "    /// Re-run full validation over the current bytes."
        );
        w!(
            out,
            "    pub fn check(&self) -> ::core::result::Result<usize, AbiError> {{"
        );
        w!(
            out,
            "        {}::__tn_validate_of(self.data.as_ref(), &self.ext)",
            n
        );
        w!(out, "    }}");
        if self.has_params_struct(v) {
            w!(out, "    /// Dynamic parameters read back from the bytes.");
            w!(out, "    pub fn dynamic_params(&self) -> {} {{", nm.params);
            w!(
                out,
                "        tn_expect({}::from_buffer(self.data.as_ref()))",
                nm.params
            );
            w!(out, "    }}");
        } else if self.has_ext_params(v) {
            w!(
                out,
                "    /// Dynamic parameters this view was created with."
            );
            w!(
                out,
                "    pub fn dynamic_params(&self) -> {} {{ self.ext }}",
                nm.params
            );
        }
        for slot in &slots {
            self.emit_getters(v, slot, out);
        }
        w!(out, "}}");
        w!(out, "");

        w!(
            out,
            "impl<B: ::core::convert::AsRef<[u8]> + ::core::convert::AsMut<[u8]>> {}<B> {{",
            nm.view
        );
        w!(out, "    /// Mutable access to the underlying bytes.");
        w!(out, "    #[inline]");
        w!(
            out,
            "    pub fn as_bytes_mut(&mut self) -> &mut [u8] {{ self.data.as_mut() }}"
        );
        for slot in &slots {
            self.emit_setters(v, slot, out);
        }
        w!(out, "}}");
        w!(out, "");

        if self.has_params_struct(v) {
            self.emit_params_impl(v, out);
        } else if self.has_ext_params(v) {
            self.emit_ext_params_impl(v, out);
        }
    }

    fn layout_sig(&self, v: &VInfo<'a>, nn: usize) -> String {
        format!(
            "pub(crate) fn __tn_layout_of<D: TnBuf + ?::core::marker::Sized>(data: &D, ext: &{}, stop: usize) -> ::core::result::Result<TnLayout<{}>, AbiError>",
            self.nm(&v.name).ext,
            nn
        )
    }

    fn emit_layout_fn(&self, v: &VInfo<'a>, slots: &[Slot<'a>], out: &mut String) {
        w!(
            out,
            "    /// Offsets and sizes of every field; stops before field `stop`."
        );
        w!(
            out,
            "    #[allow(unused_variables, unused_mut, unused_assignments, clippy::all)]"
        );
        w!(out, "    {} {{", self.layout_sig(v, slots.len()));
        w!(
            out,
            "        let mut l = TnLayout::<{}>::new();",
            slots.len()
        );
        if let Some(c) = const_size(v.ty).filter(|c| *c > 0) {
            /* Report the full size of a short constant-size value up front. */
            w!(
                out,
                "        if stop == usize::MAX && data.tn_len() < {c} {{ return Err(tn_short({c}, data.tn_len())); }}",
                c = c
            );
        }
        self.emit_walk_body(v, slots, Mode::Layout, out);
        w!(out, "    }}");
    }

    fn emit_init_fn(&self, v: &VInfo<'a>, slots: &[Slot<'a>], out: &mut String) {
        let has_p = self.has_params_struct(v);
        w!(
            out,
            "    /// Zero-initialize a value in place (writing any supplied parameters); returns its size."
        );
        w!(
            out,
            "    #[allow(unused_variables, unused_mut, unused_assignments, clippy::all)]"
        );
        if has_p {
            w!(
                out,
                "    pub(crate) fn __tn_init_of<D: TnBufMut + ?::core::marker::Sized>(data: &mut D, ext: &{}, p: ::core::option::Option<&{}>) -> ::core::result::Result<usize, AbiError> {{",
                self.nm(&v.name).ext,
                self.nm(&v.name).params
            );
        } else {
            w!(
                out,
                "    pub(crate) fn __tn_init_of<D: TnBufMut + ?::core::marker::Sized>(data: &mut D, ext: &{}) -> ::core::result::Result<usize, AbiError> {{",
                self.nm(&v.name).ext
            );
        }
        w!(
            out,
            "        let mut l = TnLayout::<{}>::new();",
            slots.len()
        );
        if has_p && v.is_var_union() {
            /* Zero the size the params name (the variant spanning it is not encoded). */
            w!(
                out,
                "        if let Some(p) = p {{ let n = tn_usize(p.payload_size)?; data.tn_zero(0, n)?; return Ok(n); }}"
            );
        }
        self.emit_walk_body(v, slots, Mode::Init, out);
        w!(out, "    }}");
    }

    /* Initialize child `c` at offset `base` of `data` (errors relative to `data`). */
    fn init_call(&self, c: &ViewRef<'a>, base: &str, ext: &str) -> String {
        let has_p = self
            .info(&c.vname)
            .map(|i| self.has_params_struct(&i))
            .unwrap_or(false);
        let p = if has_p { ", None" } else { "" };
        format!(
            "tn_at_mut(&mut *data, {}, |s| {}::__tn_init_of(s, &{}{}))?",
            base,
            self.nm(&c.vname).ty,
            ext,
            p
        )
    }

    /* Body shared by the layout walker and the initializer. */
    fn emit_walk_body(&self, v: &VInfo<'a>, slots: &[Slot<'a>], mode: Mode, out: &mut String) {
        let is_union = matches!(v.ty.kind, ResolvedTypeKind::Union { .. });
        let csize = const_size(v.ty);
        if let (Mode::Init, Some(c)) = (mode, csize) {
            w!(out, "        data.tn_zero(0, {})?;", c);
        }
        w!(out, "        let mut o: usize = 0;");
        if is_union {
            w!(out, "        let mut end: usize = 0;");
        }
        for slot in slots {
            let k = slot.idx;
            w!(
                out,
                "        /* {} */",
                if slot.name.is_empty() {
                    "value"
                } else {
                    &slot.name
                }
            );
            if is_union {
                w!(out, "        o = 0;");
                if mode == Mode::Init && csize.is_none() && k > 0 {
                    /* Variable-size unions are initialized through their first variant. */
                    continue;
                }
            } else if slot.align > 1 {
                if mode == Mode::Init {
                    w!(out, "        let before = o;");
                    w!(out, "        o = tn_align(o, {})?;", slot.align);
                    w!(out, "        data.tn_zero(before, o - before)?;");
                } else {
                    w!(out, "        o = tn_align(o, {})?;", slot.align);
                }
            }
            if mode == Mode::Layout {
                w!(
                    out,
                    "        if stop == {} {{ l.end = o; return Ok(l); }}",
                    k
                );
            }
            w!(out, "        l.off[{}] = o;", k);
            let has_writes = mode == Mode::Init
                && v.is_root_struct()
                && v.params.iter().any(|t| t.order.first() == Some(&k));
            /* Byte size supplied by the parameters (open slots only). */
            let sized = if mode == Mode::Init && self.open_slot(v, slot) {
                self.payload_param(v, k)
            } else {
                None
            };
            let take_size = |f: &str| format!("let n = tn_usize(p.{})?; data.tn_zero(o, n)?; n", f);
            match &slot.shape {
                Shape::Prim(p) => {
                    let sz = prim_size(p);
                    if mode == Mode::Init {
                        w!(out, "        data.tn_zero(o, {})?;", sz);
                    }
                    w!(out, "        let sz: usize = {};", sz);
                }
                Shape::Array(a) => {
                    match &a.count {
                        Count::Const(c) => w!(out, "        let cnt: usize = {};", c),
                        Count::Expr(_) => w!(
                            out,
                            "        let cnt: usize = tn_usize(Self::__tn_cnt_{}(&*data, &l, ext)?)?;",
                            k
                        ),
                    }
                    w!(out, "        l.aux[{}] = cnt as u64;", k);
                    if !a.walk {
                        let es = a.elem_size.unwrap_or(0);
                        w!(out, "        let sz: usize = tn_mul(cnt, {})?;", es);
                        if mode == Mode::Init {
                            w!(out, "        data.tn_zero(o, sz)?;");
                        }
                    } else {
                        match &a.elem {
                            Elem::View(c) if a.stride => {
                                let ext = self.child_ext(v, &format!("{}", k), c);
                                w!(out, "        let mut sz: usize = 0;");
                                w!(out, "        if cnt > 0 {{");
                                w!(out, "            let e = {};", ext);
                                if mode == Mode::Layout {
                                    w!(
                                        out,
                                        "            let es = tn_at(&*data, o, |s| {}::__tn_layout_of(s, &e, usize::MAX))?.end;",
                                        self.nm(&c.vname).ty
                                    );
                                    w!(out, "            sz = tn_mul(cnt, es)?;");
                                } else {
                                    w!(
                                        out,
                                        "            let es = {};",
                                        self.init_call(c, "o", "e")
                                    );
                                    w!(out, "            sz = tn_mul(cnt, es)?;");
                                    w!(out, "            data.tn_zero(o, sz)?;");
                                }
                                w!(out, "        }}");
                            }
                            Elem::View(c) => {
                                let ext = self.child_ext(v, &format!("{}", k), c);
                                if mode == Mode::Layout {
                                    /* Measuring: more elements than bytes present means
                                    one starts past them (or is empty): size unknown. */
                                    w!(
                                        out,
                                        "        if data.tn_measuring() {{ if cnt > data.tn_present().saturating_sub(o) {{ return Err(AbiError::Unsupported); }} }} else if cnt > data.tn_len().saturating_sub(o) && {m} > 0 {{ return Err(tn_short(o.saturating_add(cnt.saturating_mul({m})), data.tn_len())); }}",
                                        m = self.min_size(c.ty)
                                    );
                                }
                                w!(out, "        let mut sz: usize = 0;");
                                if let Some(f) = &sized {
                                    w!(
                                        out,
                                        "        if let Some(p) = p {{ sz = {{ {} }}; }} else {{",
                                        take_size(f)
                                    );
                                }
                                w!(out, "        for _ in 0..cnt {{");
                                w!(out, "            let at = tn_add(o, sz)?;");
                                if mode == Mode::Layout {
                                    w!(
                                        out,
                                        "            if data.tn_measuring() && at >= data.tn_present() {{ return Err(AbiError::Unsupported); }}"
                                    );
                                }
                                w!(out, "            let e = {};", ext);
                                if mode == Mode::Layout {
                                    w!(
                                        out,
                                        "            let es = tn_at(&*data, at, |s| {}::__tn_layout_of(s, &e, usize::MAX))?.end;",
                                        self.nm(&c.vname).ty
                                    );
                                    w!(
                                        out,
                                        "            if data.tn_measuring() && es == 0 {{ return Err(AbiError::Unsupported); }}"
                                    );
                                } else {
                                    w!(
                                        out,
                                        "            let es = {};",
                                        self.init_call(c, "at", "e")
                                    );
                                }
                                /* Zero-byte elements all start at `at` with the same
                                context: the rest are alike and add nothing. */
                                w!(out, "            if es == 0 {{ break; }}");
                                w!(out, "            sz = tn_add(sz, es)?;");
                                w!(out, "        }}");
                                if sized.is_some() {
                                    w!(out, "        }}");
                                }
                            }
                            _ => {
                                w!(
                                    out,
                                    "        let sz: usize = if cnt == 0 {{ 0 }} else {{ return Err(AbiError::Unsupported) }};"
                                );
                            }
                        }
                    }
                }
                Shape::View(c) => {
                    if let Some(sz) = c.size {
                        if mode == Mode::Init {
                            w!(out, "        data.tn_zero(o, {})?;", sz);
                        }
                        w!(out, "        let mut sz: usize = {};", sz);
                    } else {
                        let ext = self.child_ext(v, &format!("{}", k), c);
                        w!(out, "        let e = {};", ext);
                        if mode == Mode::Layout {
                            w!(
                                out,
                                "        let mut sz: usize = tn_at(&*data, o, |s| {}::__tn_layout_of(s, &e, usize::MAX))?.end;",
                                self.nm(&c.vname).ty
                            );
                        } else if let Some(f) = &sized {
                            w!(
                                out,
                                "        let mut sz: usize = match p {{ Some(p) => {{ {} }} None => {} }};",
                                take_size(f),
                                self.init_call(c, "o", "e")
                            );
                        } else {
                            w!(
                                out,
                                "        let mut sz: usize = {};",
                                self.init_call(c, "o", "e")
                            );
                        }
                    }
                }
                Shape::Enum { variants, .. } => {
                    w!(
                        out,
                        "        let tag = Self::__tn_tag_{}(&*data, &l, ext)?;",
                        k
                    );
                    w!(out, "        l.aux[{}] = tag;", k);
                    w!(out, "        let sz: usize = match tag {{");
                    for (vi, var) in variants.iter().enumerate() {
                        let mut body = self.variant_size_code(v, k, vi, var, mode);
                        if let (Some(f), Elem::View(c)) = (&sized, &var.elem) {
                            if self.open_view(c) {
                                body = format!(
                                    "match p {{ Some(p) => {{ {} }} None => {{ {} }} }}",
                                    take_size(f),
                                    body
                                );
                            }
                        }
                        w!(out, "            {} => {{ {} }}", var.tag, body);
                    }
                    w!(
                        out,
                        "            _ => return Err(AbiError::InvalidVariant),"
                    );
                    w!(out, "        }};");
                }
                Shape::Sdu { variants } => {
                    if mode == Mode::Layout {
                        w!(
                            out,
                            "        let rem = data.tn_avail()?.checked_sub(o).ok_or(tn_short(o, data.tn_len()))?;"
                        );
                        w!(out, "        let (idx, sz): (u64, usize) = match rem {{");
                        for (vi, var) in variants.iter().enumerate() {
                            w!(out, "            {} => ({}, {}),", var.tag, vi, var.tag);
                        }
                        w!(out, "            _ => return Err(AbiError::InvalidSize),");
                        w!(out, "        }};");
                    } else {
                        let pf = self
                            .param_fields(v)
                            .into_iter()
                            .find(|f| matches!(f.kind, ParamKind::SduVariant(i) if i == k));
                        match (self.has_params_struct(v), pf) {
                            (true, Some(f)) => w!(
                                out,
                                "        let idx: u64 = match p {{ Some(p) => p.{}, None => 0 }};",
                                f.ident
                            ),
                            _ => w!(out, "        let idx: u64 = 0;"),
                        }
                        w!(out, "        let sz: usize = match idx {{");
                        for (vi, var) in variants.iter().enumerate() {
                            w!(out, "            {} => {},", vi, var.tag);
                        }
                        w!(
                            out,
                            "            _ => return Err(AbiError::InvalidVariant),"
                        );
                        w!(out, "        }};");
                        w!(out, "        data.tn_zero(o, sz)?;");
                    }
                    w!(out, "        l.aux[{}] = idx;", k);
                }
            }
            if has_writes {
                w!(out, "        if let Some(p) = p {{");
                for (t, f) in v.params.iter().zip(self.param_fields(v)) {
                    if t.order.first() != Some(&k) {
                        continue;
                    }
                    match self.path_off(v, &t.segs) {
                        Some((off, prim)) => w!(
                            out,
                            "            data.tn_put({}, {}, p.{})?;",
                            off,
                            prim_size(&prim),
                            f.ident
                        ),
                        None => w!(out, "            return Err(AbiError::Unsupported);"),
                    }
                }
                w!(out, "        }}");
                if let (None, Shape::View(c @ ViewRef { size: None, .. })) = (&sized, &slot.shape) {
                    w!(
                        out,
                        "        sz = tn_at(&*data, o, |s| {}::__tn_layout_of(s, &e, usize::MAX))?.end;",
                        self.nm(&c.vname).ty
                    );
                }
            }
            w!(out, "        l.len[{}] = sz;", k);
            if is_union {
                w!(out, "        if sz > end {{ end = sz; }}");
            } else {
                w!(out, "        o = tn_add(o, sz)?;");
            }
        }
        let tail_align = self.tail_align(v);
        let end = if is_union {
            match csize {
                Some(c) => format!("{}usize", c),
                None => "end".to_string(),
            }
        } else {
            match csize {
                Some(c) if v.is_struct() => format!("{}usize", c),
                /* Trailing padding up to the struct alignment. */
                _ if tail_align > 1 => format!("tn_align(o, {})?", tail_align),
                _ => "o".to_string(),
            }
        };
        w!(out, "        let end: usize = {};", end);
        w!(
            out,
            "        if end > data.tn_len() {{ return Err(tn_short(end, data.tn_len())); }}"
        );
        if mode == Mode::Layout {
            w!(out, "        l.end = end;");
            w!(out, "        Ok(l)");
        } else {
            if !is_union && csize.is_none() && tail_align > 1 {
                w!(out, "        data.tn_zero(o, end - o)?;");
            }
            w!(out, "        Ok(end)");
        }
    }

    fn variant_size_code(
        &self,
        v: &VInfo<'a>,
        k: usize,
        vi: usize,
        var: &Variant<'a>,
        mode: Mode,
    ) -> String {
        match &var.elem {
            Elem::View(c) if c.size.is_none() => {
                let ext = self.child_ext(v, &format!("{}_{}", k, vi), c);
                if mode == Mode::Layout {
                    format!(
                        "let e = {}; tn_at(&*data, o, |s| {}::__tn_layout_of(s, &e, usize::MAX))?.end",
                        ext,
                        self.nm(&c.vname).ty
                    )
                } else {
                    format!("let e = {}; {}", ext, self.init_call(c, "o", "e"))
                }
            }
            other => match other.size() {
                Some(sz) => {
                    if mode == Mode::Init {
                        format!("data.tn_zero(o, {})?; {}", sz, sz)
                    } else {
                        format!("{}", sz)
                    }
                }
                None => "return Err(AbiError::Unsupported)".to_string(),
            },
        }
    }

    /* Smallest possible encoding (used to bound jagged element counts). */
    pub fn min_size(&self, ty: &'a ResolvedType) -> u64 {
        let d = self.m.deref(ty);
        if let Some(c) = const_size(d) {
            return c;
        }
        match &d.kind {
            ResolvedTypeKind::Struct { fields, .. } => fields
                .iter()
                .take_while(|f| f.offset.is_some())
                .filter_map(|f| const_size(&f.field_type))
                .sum(),
            _ => 0,
        }
    }

    fn emit_expr_fns(&self, v: &VInfo<'a>, slots: &[Slot<'a>], out: &mut String) {
        let nn = slots.len();
        let sig = |name: &str, ret: &str| {
            format!(
                "    #[allow(unused_variables, clippy::all)]\n    fn {}<D: TnBuf + ?::core::marker::Sized>(data: &D, l: &TnLayout<{}>, ext: &{}) -> ::core::result::Result<{}, AbiError> {{",
                name,
                nn,
                self.nm(&v.name).ext,
                ret
            )
        };
        for slot in slots {
            let k = slot.idx;
            let frames = self.frames_at(v, k);
            match &slot.shape {
                Shape::Array(ArrayShape {
                    count: Count::Expr(e),
                    ..
                }) => {
                    w!(out, "{}", sig(&format!("__tn_cnt_{}", k), "u64"));
                    w!(out, "        Ok({})", self.expr_code(v, &frames, e));
                    w!(out, "    }}");
                }
                Shape::Enum { tag, .. } => {
                    w!(out, "{}", sig(&format!("__tn_tag_{}", k), "u64"));
                    w!(out, "        Ok({})", self.expr_code(v, &frames, tag));
                    w!(out, "    }}");
                }
                _ => {}
            }
            for (suffix, c) in self.slot_children(slot) {
                let Some(ci) = self.info(&c.vname) else {
                    continue;
                };
                if !ci.has_ext() {
                    continue;
                }
                w!(
                    out,
                    "{}",
                    sig(&format!("__tn_ext_{}", suffix), &self.nm(&ci.name).ext)
                );
                w!(out, "        Ok({})", self.ext_init_code(v, k, &ci));
                w!(out, "    }}");
            }
        }
    }

    fn emit_validate_fn(&self, v: &VInfo<'a>, slots: &[Slot<'a>], out: &mut String) {
        w!(
            out,
            "    /// Validate the layout, nested types and enum payloads; returns the consumed size."
        );
        w!(out, "    #[allow(unused_variables, clippy::all)]");
        w!(
            out,
            "    pub(crate) fn __tn_validate_of(data: &[u8], ext: &{}) -> ::core::result::Result<usize, AbiError> {{",
            self.nm(&v.name).ext
        );
        w!(
            out,
            "        let l = Self::__tn_layout_of(data, ext, usize::MAX).map_err(|err| tn_measured(err, data, |m| Ok(Self::__tn_layout_of(m, ext, usize::MAX)?.end)))?;"
        );
        /* Union slots all start at 0: a union is valid iff every variant
        validates over its bytes, so each variant is checked like a field. */
        for slot in slots {
            let k = slot.idx;
            match &slot.shape {
                Shape::View(c) if self.needs_deep(c.ty) => {
                    w!(out, "        {{");
                    w!(
                        out,
                        "            let e = {};",
                        self.child_ext(v, &format!("{}", k), c)
                    );
                    w!(
                        out,
                        "            let n = tn_validate_at(data, l.off[{}], |s| {}::__tn_validate_of(s, &e))?;",
                        k,
                        self.nm(&c.vname).ty
                    );
                    w!(
                        out,
                        "            if n != l.len[{}] {{ return Err(AbiError::LengthMismatch); }}",
                        k
                    );
                    w!(out, "        }}");
                }
                Shape::Array(a) => {
                    if let Some(c) = match &a.elem {
                        Elem::View(c) if self.needs_deep(c.ty) || a.walk => Some(c),
                        _ => None,
                    } {
                        w!(out, "        {{");
                        w!(
                            out,
                            "            let e = {};",
                            self.child_ext(v, &format!("{}", k), c)
                        );
                        w!(out, "            let mut at = l.off[{}];", k);
                        w!(out, "            for _ in 0..l.aux[{}] {{", k);
                        w!(
                            out,
                            "                let n = tn_validate_at(data, at, |s| {}::__tn_validate_of(s, &e))?;",
                            self.nm(&c.vname).ty
                        );
                        /* A zero-byte element leaves `at` where it was, so every
                        later one sees the same bytes and context: validating
                        one stands for all of them (a huge count costs nothing). */
                        w!(out, "                if n == 0 {{ break; }}");
                        w!(out, "                at = tn_add(at, n)?;");
                        w!(out, "            }}");
                        w!(
                            out,
                            "            if at != tn_add(l.off[{k}], l.len[{k}])? {{ return Err(AbiError::LengthMismatch); }}",
                            k = k
                        );
                        w!(out, "        }}");
                    }
                }
                Shape::Enum { variants, .. } | Shape::Sdu { variants } => {
                    let deep: Vec<(usize, &Variant<'a>, &ViewRef<'a>)> = variants
                        .iter()
                        .enumerate()
                        .filter_map(|(vi, var)| match &var.elem {
                            Elem::View(c) if self.needs_deep(c.ty) => Some((vi, var, c)),
                            _ => None,
                        })
                        .collect();
                    if deep.is_empty() {
                        continue;
                    }
                    let is_sdu = matches!(slot.shape, Shape::Sdu { .. });
                    w!(out, "        match l.aux[{}] {{", k);
                    for (vi, var, c) in deep {
                        let sel = if is_sdu { vi as u64 } else { var.tag };
                        w!(out, "            {} => {{", sel);
                        w!(
                            out,
                            "                let e = {};",
                            self.child_ext(v, &format!("{}_{}", k, vi), c)
                        );
                        w!(
                            out,
                            "                let n = tn_validate_at(data, l.off[{}], |s| {}::__tn_validate_of(s, &e))?;",
                            k,
                            self.nm(&c.vname).ty
                        );
                        w!(
                            out,
                            "                if n != l.len[{}] {{ return Err(AbiError::LengthMismatch); }}",
                            k
                        );
                        w!(out, "            }}");
                    }
                    w!(
                        out,
                        "            /* Remaining variants have no nested invariants. */"
                    );
                    w!(out, "            _ => {{}}");
                    w!(out, "        }}");
                }
                _ => {}
            }
        }
        w!(out, "        Ok(l.end)");
        w!(out, "    }}");
    }

    /* Variant descriptors of every enum / size-discriminated union slot (and
    of a union view): `VariantInfo` rows with a constant tag value each. */
    pub fn variant_meta(&self, v: &VInfo<'a>, slot: &Slot<'a>) -> Vec<VariantMeta> {
        let type_name = payload_type_name;
        match (&slot.ty.kind, &v.ty.kind) {
            (ResolvedTypeKind::Enum { variants, .. }, _) => variants
                .iter()
                .map(|x| VariantMeta {
                    name: x.name.clone(),
                    tag: x.tag_value,
                    payload_size: const_size(&x.variant_type),
                    payload_type: type_name(&x.variant_type),
                })
                .collect(),
            (ResolvedTypeKind::SizeDiscriminatedUnion { variants }, _) => variants
                .iter()
                .enumerate()
                .map(|(i, x)| VariantMeta {
                    name: x.name.clone(),
                    tag: i as u64,
                    payload_size: Some(x.expected_size),
                    payload_type: type_name(&x.variant_type),
                })
                .collect(),
            _ => Vec::new(),
        }
    }

    /* `TAG_*` const / `VARIANTS` table / lookup names for a slot (field prefix
    upper-cased; empty for the view's own value). */
    pub fn variant_const_prefix(&self, slot: &Slot<'a>) -> String {
        if slot.name.is_empty() {
            String::new()
        } else {
            format!("{}_", const_ident(&slot.name))
        }
    }

    pub fn tag_const_names(&self, slot: &Slot<'a>, metas: &[VariantMeta]) -> Vec<String> {
        let prefix = self.variant_const_prefix(slot);
        let mut used: Vec<String> = Vec::new();
        for m in metas {
            let mut n = format!("{}TAG_{}", prefix, const_ident(&m.name));
            while used.contains(&n) {
                n.push('_');
            }
            used.push(n);
        }
        used
    }

    fn emit_variant_table(
        &self,
        label: &str,
        table: &str,
        lookups: (&str, &str),
        metas: &[VariantMeta],
        out: &mut String,
    ) {
        w!(
            out,
            "    /// Variants of `{}` (name, tag, payload size, payload type).",
            label
        );
        w!(out, "    pub const {}: &'static [VariantInfo] = &[", table);
        for m in metas {
            w!(
                out,
                "        VariantInfo {{ name: {:?}, tag: {}, payload_size: {}, payload_type: {:?} }},",
                m.name,
                m.tag,
                match m.payload_size {
                    Some(n) => format!("Some({})", n),
                    None => "None".to_string(),
                },
                m.payload_type
            );
        }
        w!(out, "    ];");
        w!(
            out,
            "    /// Descriptor of the `{}` variant named `name`.",
            label
        );
        w!(
            out,
            "    pub fn {}(name: &str) -> ::core::option::Option<&'static VariantInfo> {{ tn_variant_by_name(Self::{}, name) }}",
            lookups.0,
            table
        );
        w!(
            out,
            "    /// Descriptor of the `{}` variant with tag `tag`.",
            label
        );
        w!(
            out,
            "    pub fn {}(tag: u64) -> ::core::option::Option<&'static VariantInfo> {{ tn_variant_by_tag(Self::{}, tag) }}",
            lookups.1,
            table
        );
    }

    fn emit_variant_meta(&self, v: &VInfo<'a>, slots: &[Slot<'a>], out: &mut String) {
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
            self.emit_variant_table(
                &v.ty.name,
                "VARIANTS",
                ("variant_by_name", "variant_by_tag"),
                &metas,
                out,
            );
            return;
        }
        for slot in slots {
            let is_sdu = match slot.shape {
                Shape::Enum { .. } => false,
                Shape::Sdu { .. } => true,
                _ => continue,
            };
            let metas = self.variant_meta(v, slot);
            let label = self.slot_label(v, slot);
            for (m, cn) in metas.iter().zip(self.tag_const_names(slot, &metas)) {
                if is_sdu {
                    w!(
                        out,
                        "    /// `{}` variant index of `{}` (selected by a {}-byte payload).",
                        m.name,
                        label,
                        m.payload_size.unwrap_or(0)
                    );
                    w!(out, "    pub const {}: u8 = {};", cn, m.tag);
                } else {
                    w!(
                        out,
                        "    /// Tag value selecting `{}` in `{}`.",
                        m.name,
                        label
                    );
                    w!(out, "    pub const {}: u64 = {};", cn, m.tag);
                }
            }
            let table = format!("{}VARIANTS", self.variant_const_prefix(slot));
            let base = self.method_base(v, slot);
            let by_name = self.hname(v, &base, "variant_by_name");
            let by_tag = self.hname(v, &base, "variant_by_tag");
            self.emit_variant_table(&label, &table, (&by_name, &by_tag), &metas, out);
        }
    }

    fn emit_ctor_fns(&self, v: &VInfo<'a>, out: &mut String) {
        let nm = self.nm(&v.name);
        if v.has_ext() {
            w!(
                out,
                "    /// Validate `data` given the enclosing context and wrap it."
            );
            w!(
                out,
                "    pub fn from_slice_with(data: &'a [u8], ext: {}) -> ::core::result::Result<Self, AbiError> {{",
                nm.ext
            );
            w!(out, "        Self::__tn_validate_of(data, &ext)?;");
            w!(out, "        Ok(Self {{ data, ext }})");
            w!(out, "    }}");
            w!(
                out,
                "    /// Validate `data` given the enclosing context; returns the consumed size."
            );
            w!(
                out,
                "    pub fn validate_with(data: &[u8], ext: &{}) -> ::core::result::Result<usize, AbiError> {{",
                nm.ext
            );
            w!(out, "        Self::__tn_validate_of(data, ext)");
            w!(out, "    }}");
            w!(
                out,
                "    /// Wrap `data` without validating it (accessors panic on malformed bytes)."
            );
            w!(
                out,
                "    pub fn from_slice_unchecked_with(data: &'a [u8], ext: {}) -> Self {{",
                nm.ext
            );
            w!(out, "        Self {{ data, ext }}");
            w!(out, "    }}");
            if self.has_ext_params(v) {
                self.emit_ext_ctor_fns(v, out);
            }
            return;
        }
        w!(
            out,
            "    /// Validate `data` (including nested types and enum payloads) and wrap it."
        );
        w!(
            out,
            "    pub fn from_slice(data: &'a [u8]) -> ::core::result::Result<Self, AbiError> {{"
        );
        w!(
            out,
            "        Self::__tn_validate_of(data, &{}::default())?;",
            nm.ext
        );
        w!(
            out,
            "        Ok(Self {{ data, ext: {}::default() }})",
            nm.ext
        );
        w!(out, "    }}");
        w!(
            out,
            "    /// Wrap `data` without validating it (accessors panic on malformed bytes)."
        );
        w!(
            out,
            "    pub fn from_slice_unchecked(data: &'a [u8]) -> Self {{"
        );
        w!(out, "        Self {{ data, ext: {}::default() }}", nm.ext);
        w!(out, "    }}");
        w!(
            out,
            "    /// Fully validate `data`; returns the number of bytes the value occupies."
        );
        w!(
            out,
            "    pub fn validate(data: &[u8]) -> ::core::result::Result<usize, AbiError> {{"
        );
        w!(
            out,
            "        Self::__tn_validate_of(data, &{}::default())",
            nm.ext
        );
        w!(out, "    }}");
        if let Some(c) = const_size(v.ty) {
            w!(out, "    /// Encoded size of every `{}`.", v.ty.name);
            w!(out, "    pub const FOOTPRINT: usize = {};", c);
        }
        if !self.has_params_struct(v) {
            return;
        }
        let pt = nm.params.clone();
        let fields = self.param_fields(v);
        let args: Vec<&ParamField> = fields
            .iter()
            .filter(|f| !matches!(f.kind, ParamKind::BufferSize))
            .collect();
        let sig_args: Vec<String> = args
            .iter()
            .map(|f| match &f.kind {
                ParamKind::Target(t) => format!("{}: {}", f.ident, prim_rust(&t.prim)),
                ParamKind::PayloadSize(_) | ParamKind::UnionSize => format!("{}: usize", f.ident),
                _ => format!("{}: u8", f.ident),
            })
            .collect();
        w!(
            out,
            "    /// Zero-initialize `buffer`, writing the given length/tag fields; returns the size used."
        );
        w!(out, "    #[allow(clippy::too_many_arguments)]");
        if sig_args.is_empty() {
            w!(
                out,
                "    pub fn new(buffer: &mut [u8]) -> ::core::result::Result<usize, AbiError> {{"
            );
        } else {
            w!(
                out,
                "    pub fn new(buffer: &mut [u8], {}) -> ::core::result::Result<usize, AbiError> {{",
                sig_args.join(", ")
            );
        }
        w!(out, "        let p = {} {{", pt);
        for f in &fields {
            let val = match &f.kind {
                ParamKind::Target(t) => prim_to_raw(&t.prim, &f.ident),
                ParamKind::SduVariant(_) | ParamKind::PayloadSize(_) | ParamKind::UnionSize => {
                    format!("{} as u64", f.ident)
                }
                ParamKind::BufferSize => "buffer.len() as u64".to_string(),
            };
            w!(out, "            {}: {},", f.ident, val);
        }
        w!(out, "        }};");
        w!(
            out,
            "        Self::__tn_init_of(buffer, &{}::default(), Some(&p))",
            nm.ext
        );
        w!(out, "    }}");
        w!(
            out,
            "    /// Zero-initialize `buffer` from a parameter set; returns the size used."
        );
        w!(
            out,
            "    pub fn new_from_params(buffer: &mut [u8], params: &{}) -> ::core::result::Result<usize, AbiError> {{",
            pt
        );
        if let Some(f) = fields
            .iter()
            .find(|f| matches!(f.kind, ParamKind::BufferSize))
        {
            /* Lay the value out over the bytes `__buffer_size` names (as
            `footprint_from_params` does), leaving spare bytes untouched. */
            w!(out, "        let n = tn_usize(params.{})?;", f.ident);
            w!(out, "        let have = buffer.len();");
            w!(
                out,
                "        let buffer = buffer.get_mut(..n).ok_or(tn_short(n, have))?;"
            );
        }
        w!(
            out,
            "        Self::__tn_init_of(buffer, &{}::default(), Some(params))",
            nm.ext
        );
        w!(out, "    }}");
        let k = fields
            .iter()
            .filter(|f| matches!(f.kind, ParamKind::Target(_)))
            .count()
            .max(1);
        w!(
            out,
            "    /// Size of the value `new_from_params` would produce (no allocation)."
        );
        w!(
            out,
            "    pub fn footprint_from_params(params: &{}) -> ::core::result::Result<usize, AbiError> {{",
            pt
        );
        let len = fields
            .iter()
            .find(|f| matches!(f.kind, ParamKind::BufferSize))
            .map(|f| format!("tn_usize(params.{})?", f.ident))
            .unwrap_or_else(|| "usize::MAX".to_string());
        w!(
            out,
            "        let mut virt = TnVirtual::<{}>::new({});",
            k,
            len
        );
        w!(
            out,
            "        Self::__tn_init_of(&mut virt, &{}::default(), Some(params))",
            nm.ext
        );
        w!(out, "    }}");
    }

    /* `new` / `new_from_params` / `footprint_from_params` for named views
    whose parameters are their context. */
    fn emit_ext_ctor_fns(&self, v: &VInfo<'a>, out: &mut String) {
        let nm = self.nm(&v.name);
        let pt = nm.params.clone();
        let keys = self.param_keys(v);
        let sig: Vec<String> = keys.iter().map(|(f, _)| format!("{}: u64", f)).collect();
        let names: Vec<String> = keys.iter().map(|(f, _)| f.clone()).collect();
        w!(
            out,
            "    /// Zero-initialize `buffer` for the given parameters; returns the size used."
        );
        w!(out, "    #[allow(clippy::too_many_arguments)]");
        w!(
            out,
            "    pub fn new(buffer: &mut [u8], {}) -> ::core::result::Result<usize, AbiError> {{",
            sig.join(", ")
        );
        w!(
            out,
            "        Self::new_from_params(buffer, &{} {{ {} }})",
            pt,
            names.join(", ")
        );
        w!(out, "    }}");
        w!(
            out,
            "    /// Zero-initialize `buffer` from a parameter set; returns the size used."
        );
        w!(
            out,
            "    pub fn new_from_params(buffer: &mut [u8], params: &{}) -> ::core::result::Result<usize, AbiError> {{",
            pt
        );
        w!(out, "        Self::__tn_init_of(buffer, params)");
        w!(out, "    }}");
        w!(
            out,
            "    /// Size of the value `new_from_params` would produce (no allocation)."
        );
        w!(
            out,
            "    pub fn footprint_from_params(params: &{}) -> ::core::result::Result<usize, AbiError> {{",
            pt
        );
        if self.uses_buffer_size(v) {
            w!(
                out,
                "        /* The layout depends on the buffer size, which parameters do not fix. */"
            );
            w!(out, "        let _ = params;");
            w!(out, "        Err(AbiError::Unsupported)");
        } else {
            w!(
                out,
                "        let mut virt = TnVirtual::<1>::new(usize::MAX);"
            );
            w!(out, "        Self::__tn_init_of(&mut virt, params)");
        }
        w!(out, "    }}");
    }

    /* `KEYS`, `get` and `set`: generic access to a `<T>Params` value. */
    fn emit_param_access(&self, v: &VInfo<'a>, out: &mut String) {
        let keys = self.param_keys(v);
        w!(
            out,
            "    /// `(field, ABI path)` of every parameter; `get`/`set` accept either."
        );
        w!(
            out,
            "    pub const KEYS: &'static [(&'static str, &'static str)] = &[{}];",
            keys.iter()
                .map(|(f, p)| format!("({:?}, {:?})", f.trim_start_matches("r#"), p))
                .collect::<Vec<_>>()
                .join(", ")
        );
        w!(
            out,
            "    /// Value of the parameter named `key` (field name or ABI path)."
        );
        w!(
            out,
            "    pub fn get(&self, key: &str) -> ::core::option::Option<u64> {{"
        );
        if keys.is_empty() {
            w!(out, "        let _ = key;");
            w!(out, "        None");
        } else {
            w!(out, "        match tn_param_index(Self::KEYS, key)? {{");
            for (i, (f, _)) in keys.iter().enumerate() {
                w!(out, "            {} => Some(self.{}),", i, f);
            }
            w!(out, "            _ => None,");
            w!(out, "        }}");
        }
        w!(out, "    }}");
        w!(
            out,
            "    /// Set the parameter named `key`; returns `false` for an unknown key."
        );
        w!(
            out,
            "    pub fn set(&mut self, key: &str, value: u64) -> bool {{"
        );
        if keys.is_empty() {
            w!(out, "        let _ = (key, value);");
            w!(out, "        false");
        } else {
            w!(out, "        match tn_param_index(Self::KEYS, key) {{");
            for (i, (f, _)) in keys.iter().enumerate() {
                w!(out, "            Some({}) => self.{} = value,", i, f);
            }
            w!(out, "            _ => return false,");
            w!(out, "        }}");
            w!(out, "        true");
        }
        w!(out, "    }}");
    }

    fn emit_ext_params_impl(&self, v: &VInfo<'a>, out: &mut String) {
        let nm = self.nm(&v.name);
        let n = &nm.ty;
        let keys = self.param_keys(v);
        w!(out, "impl {} {{", nm.params.clone());
        let sig: Vec<String> = keys.iter().map(|(f, _)| format!("{}: u64", f)).collect();
        let names: Vec<String> = keys.iter().map(|(f, _)| f.clone()).collect();
        w!(out, "    /// Build parameters from explicit values.");
        w!(out, "    #[allow(clippy::too_many_arguments)]");
        w!(out, "    pub fn from_values({}) -> Self {{", sig.join(", "));
        w!(out, "        Self {{ {} }}", names.join(", "));
        w!(out, "    }}");
        self.emit_param_access(v, out);
        w!(out, "    /// Footprint implied by these parameters.");
        w!(
            out,
            "    pub fn footprint(&self) -> ::core::result::Result<usize, AbiError> {{"
        );
        w!(out, "        {}::footprint_from_params(self)", n);
        w!(out, "    }}");
        w!(out, "}}");
        w!(out, "");
    }

    fn emit_params_impl(&self, v: &VInfo<'a>, out: &mut String) {
        let nm = self.nm(&v.name);
        let n = &nm.ty;
        let pt = nm.params.clone();
        let fields = self.param_fields(v);
        let slots = self.slots(v);
        w!(out, "impl {} {{", pt);
        let sig: Vec<String> = fields.iter().map(|f| format!("{}: u64", f.ident)).collect();
        w!(out, "    /// Build parameters from explicit values.");
        w!(out, "    #[allow(clippy::too_many_arguments)]");
        w!(out, "    pub fn from_values({}) -> Self {{", sig.join(", "));
        let names: Vec<String> = fields.iter().map(|f| f.ident.clone()).collect();
        w!(out, "        Self {{ {} }}", names.join(", "));
        w!(out, "    }}");
        self.emit_param_access(v, out);
        w!(
            out,
            "    /// Validate `data` as `{}` and read its dynamic parameters.",
            v.ty.name
        );
        w!(out, "    #[allow(unused_variables, clippy::all)]");
        w!(
            out,
            "    pub fn from_buffer(data: &[u8]) -> ::core::result::Result<Self, AbiError> {{"
        );
        w!(out, "        let ext = &{}::default();", nm.ext);
        w!(out, "        {}::__tn_validate_of(data, ext)?;", n);
        w!(
            out,
            "        let l = &{}::__tn_layout_of(data, ext, usize::MAX)?;",
            n
        );
        w!(out, "        Ok(Self {{");
        for f in &fields {
            let val = match &f.kind {
                ParamKind::Target(t) => match self.path_off(v, &t.segs) {
                    Some((off, prim)) => format!("data.tn_get({}, {})?", off, prim_size(&prim)),
                    None => "return Err(AbiError::Unsupported)".to_string(),
                },
                ParamKind::SduVariant(k) => format!("l.aux[{}]", k),
                ParamKind::PayloadSize(k) => format!("l.len[{}] as u64", k),
                ParamKind::UnionSize => "l.end as u64".to_string(),
                ParamKind::BufferSize => "data.len() as u64".to_string(),
            };
            w!(out, "            {}: {},", f.ident, val);
        }
        w!(out, "        }})");
        w!(out, "    }}");
        w!(out, "    /// Footprint implied by these parameters.");
        w!(
            out,
            "    pub fn footprint(&self) -> ::core::result::Result<usize, AbiError> {{"
        );
        w!(out, "        {}::footprint_from_params(self)", n);
        w!(out, "    }}");
        w!(out, "}}");
        w!(out, "");
        let _ = slots;
    }

    /* ------------------------------------------------------------------
     * Accessors
     * ---------------------------------------------------------------- */

    /* Static (offset, size) of a context-free child at a fixed position. */
    pub fn static_child(&self, slot: &Slot<'a>, c: &ViewRef<'a>) -> Option<(u64, u64)> {
        let o = slot.static_off?;
        let n = c.size?;
        let has_ext = self.info(&c.vname).map(|i| i.has_ext()).unwrap_or(true);
        (!has_ext).then_some((o, n))
    }

    fn off_code(&self, slot: &Slot<'a>) -> String {
        match slot.static_off {
            Some(c) => format!("{}usize", c),
            None => format!("self.__tn_lay().off[{}]", slot.idx),
        }
    }

    fn len_code(&self, slot: &Slot<'a>) -> String {
        match const_size(slot.ty) {
            Some(c) => format!("{}usize", c),
            None => format!("self.__tn_lay().len[{}]", slot.idx),
        }
    }

    /* `<base>_<suffix>`, avoiding clashes with another field's accessor. */
    pub fn hname(&self, v: &VInfo<'a>, base: &str, suffix: &str) -> String {
        if base.is_empty() {
            return suffix.to_string();
        }
        let cand = format!("{}_{}", base, suffix);
        let taken = self.slots(v).iter().any(|s| plain_ident(&s.name) == cand);
        if taken {
            format!("{}__{}", base, suffix)
        } else {
            cand
        }
    }

    /* Accessor base name for a field. A field whose name is a view method
    (`size`, `check`, ...) gets `_` appended, and more `_` while another
    field of the same view already has that name (`size` next to `size_`
    becomes `size__`), so no two getters or setters share a name. */
    pub fn method_base(&self, v: &VInfo<'a>, slot: &Slot<'a>) -> String {
        if slot.name.is_empty() {
            return String::new();
        }
        let base = plain_ident(&slot.name);
        if !matches!(
            base.as_str(),
            "size" | "as_bytes" | "as_bytes_mut" | "context" | "check" | "dynamic_params"
        ) {
            return base;
        }
        let others: Vec<String> = self
            .slots(v)
            .iter()
            .filter(|s| s.idx != slot.idx)
            .map(|s| plain_ident(&s.name))
            .collect();
        let mut name = format!("{}_", base);
        while others.contains(&name) {
            name.push('_');
        }
        name
    }

    /* `ext` for a child view inside an accessor (`d`, `l` in scope). */
    fn accessor_ext(&self, fn_suffix: &str, c: &ViewRef<'a>) -> String {
        match self.info(&c.vname) {
            Some(ci) if ci.has_ext() => format!(
                "tn_expect(Self::__tn_ext_{}_of(d, &l, &self.ext))",
                fn_suffix
            ),
            _ => format!("{}::default()", self.nm(&c.vname).ext),
        }
    }

    fn emit_getters(&self, v: &VInfo<'a>, slot: &Slot<'a>, out: &mut String) {
        if slot.name.is_empty() {
            self.emit_self_getters(v, slot, out);
            return;
        }
        let k = slot.idx;
        let base = self.method_base(v, slot);
        let getter = escape_ident(&base);
        let label = self.slot_label(v, slot);
        match &slot.shape {
            Shape::Prim(p) => {
                w!(out, "    /// `{}`", label);
                w!(out, "    #[inline]");
                w!(out, "    pub fn {}(&self) -> {} {{", getter, prim_rust(p));
                w!(out, "        let off = {};", self.off_code(slot));
                w!(
                    out,
                    "        {}",
                    raw_to_prim(
                        p,
                        &format!("tn_rd(self.data.as_ref(), off, {})", prim_size(p))
                    )
                );
                w!(out, "    }}");
            }
            Shape::Array(a) => {
                self.emit_array_getters(v, slot, a, &base, out);
            }
            Shape::View(c) if self.static_child(slot, c).is_some() => {
                let (o, n) = self.static_child(slot, c).unwrap();
                w!(out, "    /// `{}`", label);
                w!(out, "    #[inline]");
                let cn = self.nm(&c.vname);
                w!(out, "    pub fn {}(&self) -> {}<'_> {{", getter, cn.ty);
                w!(
                    out,
                    "        {} {{ data: &self.data.as_ref()[{}..{}], ext: {}::default() }}",
                    cn.view,
                    o,
                    o + n,
                    cn.ext
                );
                w!(out, "    }}");
            }
            Shape::View(c) => {
                w!(out, "    /// `{}`", label);
                let cn = self.nm(&c.vname);
                w!(out, "    pub fn {}(&self) -> {}<'_> {{", getter, cn.ty);
                w!(out, "        let d = self.data.as_ref();");
                w!(out, "        let l = self.__tn_lay();");
                w!(
                    out,
                    "        let ext = {};",
                    self.accessor_ext(&format!("{}", k), c)
                );
                w!(
                    out,
                    "        {} {{ data: &d[l.off[{k}]..l.off[{k}] + l.len[{k}]], ext }}",
                    cn.view,
                    k = k
                );
                w!(out, "    }}");
            }
            Shape::Enum { variants, .. } | Shape::Sdu { variants } => {
                let is_sdu = matches!(slot.shape, Shape::Sdu { .. });
                let (rn, _) = self.ref_enum_names(v, slot);
                let arms = self.variant_arm_names(variants);
                if is_sdu {
                    w!(
                        out,
                        "    /// Index of the active `{}` variant (selected by size).",
                        label
                    );
                    w!(
                        out,
                        "    pub fn {}(&self) -> u8 {{ self.__tn_lay().aux[{}] as u8 }}",
                        self.hname(v, &base, "tag"),
                        k
                    );
                } else {
                    w!(out, "    /// Tag of `{}`, at full width.", label);
                    w!(
                        out,
                        "    pub fn {}(&self) -> u64 {{",
                        self.hname(v, &base, "tag")
                    );
                    w!(out, "        let d = self.data.as_ref();");
                    w!(
                        out,
                        "        let l = tn_expect({}::__tn_layout_of(d, &self.ext, {}));",
                        self.nm(&v.name).ty,
                        k
                    );
                    w!(
                        out,
                        "        tn_expect({}::__tn_tag_{}(d, &l, &self.ext))",
                        self.nm(&v.name).ty,
                        k
                    );
                    w!(out, "    }}");
                }
                w!(out, "    /// Typed view of the active `{}` variant.", label);
                w!(out, "    pub fn {}(&self) -> {}<'_> {{", getter, rn);
                if is_sdu {
                    w!(out, "        let tag = self.__tn_lay().aux[{}];", k);
                } else {
                    w!(
                        out,
                        "        let tag = self.{}();",
                        self.hname(v, &base, "tag")
                    );
                }
                w!(out, "        match tag {{");
                for (vi, (var, arm)) in variants.iter().zip(&arms).enumerate() {
                    let sel = if is_sdu { vi as u64 } else { var.tag };
                    w!(out, "            {} => {{", sel);
                    w!(out, "                let d = self.data.as_ref();");
                    w!(out, "                let l = self.__tn_lay();");
                    w!(
                        out,
                        "                let s = &d[l.off[{k}]..l.off[{k}] + l.len[{k}]];",
                        k = k
                    );
                    match &var.elem {
                        Elem::Prim(p) => w!(
                            out,
                            "                {}::{}({})",
                            rn,
                            arm,
                            raw_to_prim(p, &format!("tn_rd(s, 0, {})", prim_size(p)))
                        ),
                        Elem::View(c) => {
                            let ext = self.accessor_ext(&format!("{}_{}", k, vi), c);
                            w!(
                                out,
                                "                {}::{}({} {{ data: s, ext: {} }})",
                                rn,
                                arm,
                                self.nm(&c.vname).view,
                                ext
                            );
                        }
                        Elem::Opaque(_) => w!(out, "                {}::{}(s)", rn, arm),
                    }
                    w!(out, "            }}");
                }
                w!(out, "            t => {}::Unknown(t),", rn);
                w!(out, "        }}");
                w!(out, "    }}");
                self.emit_as_getters(v, slot, variants, &getter, out);
                w!(out, "    /// Raw payload bytes of `{}`.", label);
                w!(
                    out,
                    "    pub fn {}(&self) -> &[u8] {{",
                    self.hname(v, &base, "body")
                );
                w!(out, "        let l = self.__tn_lay();");
                w!(
                    out,
                    "        &self.data.as_ref()[l.off[{k}]..l.off[{k}] + l.len[{k}]]",
                    k = k
                );
                w!(out, "    }}");
            }
        }
        /* ext helpers used by accessors (wrapping the walker helpers) */
        for (suffix, c) in self.slot_children(slot) {
            if let Some(ci) = self.info(&c.vname).filter(|ci| ci.has_ext()) {
                w!(out, "    #[inline]");
                w!(
                    out,
                    "    fn __tn_ext_{}_of(d: &[u8], l: &TnLayout<{}>, ext: &{}) -> ::core::result::Result<{}, AbiError> {{",
                    suffix,
                    self.nslots(v),
                    self.nm(&v.name).ext,
                    self.nm(&ci.name).ext
                );
                w!(
                    out,
                    "        {}::__tn_ext_{}(d, l, ext)",
                    self.nm(&v.name).ty,
                    suffix
                );
                w!(out, "    }}");
            }
        }
    }

    fn emit_array_getters(
        &self,
        v: &VInfo<'a>,
        slot: &Slot<'a>,
        a: &ArrayShape<'a>,
        base: &str,
        out: &mut String,
    ) {
        let k = slot.idx;
        let label = self.slot_label(v, slot);
        let getter = escape_ident(base);
        let len_name = self.hname(v, base, "len");
        let get_name = self.hname(v, base, "get");
        let bytes_name = if base.is_empty() {
            "elements_bytes".to_string()
        } else {
            self.hname(v, base, "bytes")
        };
        w!(out, "    /// Number of elements in `{}`.", label);
        match &a.count {
            Count::Const(c) => w!(out, "    pub fn {}(&self) -> usize {{ {} }}", len_name, c),
            Count::Expr(_) => w!(
                out,
                "    pub fn {}(&self) -> usize {{ self.__tn_lay().aux[{}] as usize }}",
                len_name,
                k
            ),
        }
        if base.is_empty() {
            w!(out, "    /// True when the array has no elements.");
            w!(
                out,
                "    pub fn is_empty(&self) -> bool {{ self.len() == 0 }}"
            );
        }
        w!(out, "    /// Raw bytes of `{}`.", label);
        w!(out, "    pub fn {}(&self) -> &[u8] {{", bytes_name);
        w!(out, "        let l = self.__tn_lay();");
        w!(
            out,
            "        &self.data.as_ref()[l.off[{k}]..l.off[{k}] + l.len[{k}]]",
            k = k
        );
        w!(out, "    }}");
        match &a.elem {
            Elem::Prim(p) => {
                let es = prim_size(p);
                if prim_is_byte(p) && !base.is_empty() {
                    w!(out, "    /// `{}` as bytes.", label);
                    w!(
                        out,
                        "    pub fn {}(&self) -> &[u8] {{ self.{}() }}",
                        getter,
                        bytes_name
                    );
                }
                let try_get = self.hname(v, base, "try_get");
                w!(
                    out,
                    "    /// Element `i` of `{}`, or `None` when `i` is out of range.",
                    label
                );
                w!(
                    out,
                    "    pub fn {}(&self, i: usize) -> ::core::option::Option<{}> {{",
                    try_get,
                    prim_rust(p)
                );
                w!(
                    out,
                    "        if i >= self.{}() {{ return None; }}",
                    len_name
                );
                w!(out, "        let l = self.__tn_lay();");
                w!(
                    out,
                    "        Some({})",
                    raw_to_prim(
                        p,
                        &format!(
                            "tn_rd(self.data.as_ref(), l.off[{}] + i * {}, {})",
                            k, es, es
                        )
                    )
                );
                w!(out, "    }}");
                w!(out, "    /// Element `i` of `{}`.", label);
                w!(out, "    ///");
                w!(out, "    /// # Panics");
                w!(
                    out,
                    "    /// When `i` is out of range (like slice indexing; see `{}`).",
                    try_get
                );
                w!(out, "    #[track_caller]");
                w!(
                    out,
                    "    pub fn {}(&self, i: usize) -> {} {{",
                    get_name,
                    prim_rust(p)
                );
                w!(
                    out,
                    "        match self.{}(i) {{ Some(v) => v, None => tn_out_of_range(i, self.{}()) }}",
                    try_get,
                    len_name
                );
                w!(out, "    }}");
            }
            Elem::View(c) => {
                let try_get = self.hname(v, base, "try_get");
                w!(
                    out,
                    "    /// Element `i` of `{}`, or `None` when `i` is out of range.",
                    label
                );
                w!(
                    out,
                    "    pub fn {}(&self, i: usize) -> ::core::option::Option<{}<'_>> {{",
                    try_get,
                    self.nm(&c.vname).ty
                );
                w!(out, "        let (at, n, ext) = self.__tn_elem_{}(i)?;", k);
                w!(
                    out,
                    "        Some({} {{ data: &self.data.as_ref()[at..at + n], ext }})",
                    self.nm(&c.vname).view
                );
                w!(out, "    }}");
                w!(out, "    /// Element `i` of `{}`.", label);
                w!(out, "    ///");
                w!(out, "    /// # Panics");
                w!(
                    out,
                    "    /// When `i` is out of range (like slice indexing; see `{}`).",
                    try_get
                );
                w!(out, "    #[track_caller]");
                w!(
                    out,
                    "    pub fn {}(&self, i: usize) -> {}<'_> {{",
                    get_name,
                    self.nm(&c.vname).ty
                );
                w!(
                    out,
                    "        match self.{}(i) {{ Some(v) => v, None => tn_out_of_range(i, self.{}()) }}",
                    try_get,
                    len_name
                );
                w!(out, "    }}");
                w!(
                    out,
                    "    fn __tn_elem_{}(&self, i: usize) -> ::core::option::Option<(usize, usize, {})> {{",
                    k,
                    self.nm(&c.vname).ext
                );
                w!(
                    out,
                    "        if i >= self.{}() {{ return None; }}",
                    len_name
                );
                w!(out, "        let d = self.data.as_ref();");
                w!(out, "        let l = self.__tn_lay();");
                w!(
                    out,
                    "        let ext = {};",
                    self.accessor_ext(&format!("{}", k), c)
                );
                if !a.walk {
                    let es = a.elem_size.unwrap_or(0);
                    w!(
                        out,
                        "        Some((l.off[{}] + i * {es}, {es}, ext))",
                        k,
                        es = es
                    );
                } else if a.stride {
                    /* Every element has the first one's size. */
                    w!(
                        out,
                        "        let n = tn_expect({}::__tn_layout_of(&d[l.off[{}]..], &ext, usize::MAX)).end;",
                        self.nm(&c.vname).ty,
                        k
                    );
                    w!(out, "        Some((l.off[{}] + i * n, n, ext))", k);
                } else {
                    w!(out, "        let mut at = l.off[{}];", k);
                    w!(out, "        for _ in 0..i {{");
                    w!(
                        out,
                        "            let n = tn_expect({}::__tn_layout_of(&d[at..], &ext, usize::MAX)).end;",
                        self.nm(&c.vname).ty
                    );
                    /* Zero-byte elements leave `at` in place: the rest are alike. */
                    w!(out, "            if n == 0 {{ break; }}");
                    w!(out, "            at += n;");
                    w!(out, "        }}");
                    w!(
                        out,
                        "        let n = tn_expect({}::__tn_layout_of(&d[at..], &ext, usize::MAX)).end;",
                        self.nm(&c.vname).ty
                    );
                    w!(out, "        Some((at, n, ext))");
                }
                w!(out, "    }}");
            }
            Elem::Opaque(_) => {}
        }
    }

    /* Accessors for array, enum and size-discriminated union views (the view
    is the value itself). */
    fn emit_self_getters(&self, v: &VInfo<'a>, slot: &Slot<'a>, out: &mut String) {
        match &slot.shape {
            Shape::Array(a) => self.emit_array_getters(v, slot, a, "", out),
            Shape::Enum { variants, .. } | Shape::Sdu { variants } => {
                let is_sdu = matches!(slot.shape, Shape::Sdu { .. });
                let (rn, _) = self.ref_enum_names(v, slot);
                let arms = self.variant_arm_names(variants);
                if is_sdu {
                    w!(
                        out,
                        "    /// Index of the active variant (selected by the buffer size)."
                    );
                    w!(
                        out,
                        "    pub fn tag(&self) -> u8 {{ self.__tn_lay().aux[0] as u8 }}"
                    );
                } else {
                    w!(out, "    /// Tag of this enum, at full width.");
                    w!(out, "    pub fn tag(&self) -> u64 {{");
                    w!(out, "        let d = self.data.as_ref();");
                    w!(
                        out,
                        "        tn_expect({}::__tn_tag_0(d, &TnLayout::new(), &self.ext))",
                        self.nm(&v.name).ty
                    );
                    w!(out, "    }}");
                }
                w!(out, "    /// Typed view of the active variant.");
                w!(out, "    pub fn variant(&self) -> {}<'_> {{", rn);
                if is_sdu {
                    w!(out, "        let tag = self.__tn_lay().aux[0];");
                } else {
                    w!(out, "        let tag = self.tag();");
                }
                w!(out, "        match tag {{");
                for (vi, (var, arm)) in variants.iter().zip(&arms).enumerate() {
                    let sel = if is_sdu { vi as u64 } else { var.tag };
                    w!(out, "            {} => {{", sel);
                    w!(out, "                let d = self.data.as_ref();");
                    w!(out, "                let l = self.__tn_lay();");
                    w!(out, "                let s = &d[..l.len[0]];");
                    match &var.elem {
                        Elem::Prim(p) => w!(
                            out,
                            "                {}::{}({})",
                            rn,
                            arm,
                            raw_to_prim(p, &format!("tn_rd(s, 0, {})", prim_size(p)))
                        ),
                        Elem::View(c) => {
                            let ext = self.accessor_ext(&format!("0_{}", vi), c);
                            w!(
                                out,
                                "                {}::{}({} {{ data: s, ext: {} }})",
                                rn,
                                arm,
                                self.nm(&c.vname).view,
                                ext
                            );
                        }
                        Elem::Opaque(_) => w!(out, "                {}::{}(s)", rn, arm),
                    }
                    w!(out, "            }}");
                }
                w!(out, "            t => {}::Unknown(t),", rn);
                w!(out, "        }}");
                w!(out, "    }}");
                self.emit_as_getters(v, slot, variants, "variant", out);
                w!(out, "    /// Raw payload bytes of the active variant.");
                w!(
                    out,
                    "    pub fn body(&self) -> &[u8] {{ let l = self.__tn_lay(); &self.data.as_ref()[..l.len[0]] }}"
                );
            }
            _ => {}
        }
        for (suffix, c) in self.slot_children(slot) {
            if let Some(ci) = self.info(&c.vname).filter(|ci| ci.has_ext()) {
                w!(out, "    #[inline]");
                w!(
                    out,
                    "    fn __tn_ext_{}_of(d: &[u8], l: &TnLayout<1>, ext: &{}) -> ::core::result::Result<{}, AbiError> {{",
                    suffix,
                    self.nm(&v.name).ext,
                    self.nm(&ci.name).ext
                );
                w!(
                    out,
                    "        {}::__tn_ext_{}(d, l, ext)",
                    self.nm(&v.name).ty,
                    suffix
                );
                w!(out, "    }}");
            }
        }
    }

    /* Names of the typed `as_<variant>` accessors of an enum/SDU slot. */
    pub fn as_names(
        &self,
        v: &VInfo<'a>,
        slot: &Slot<'a>,
        variants: &[Variant<'a>],
    ) -> Vec<String> {
        let base = self.method_base(v, slot);
        super::emit_builder::variant_setter_suffixes(variants)
            .into_iter()
            .map(|vn| {
                let mut name = self.hname(v, &base, &format!("as_{}", vn));
                if matches!(name.as_str(), "as_bytes" | "as_bytes_mut") {
                    name.push('_');
                }
                name
            })
            .collect()
    }

    /* `as_<variant>()` / `as_<variant>_mut()`: the payload when that variant is active. */
    fn emit_as_getters(
        &self,
        v: &VInfo<'a>,
        slot: &Slot<'a>,
        variants: &[Variant<'a>],
        getter: &str,
        out: &mut String,
    ) {
        let (rn, _) = self.ref_enum_names(v, slot);
        let arms = self.variant_arm_names(variants);
        for ((var, arm), name) in variants
            .iter()
            .zip(&arms)
            .zip(self.as_names(v, slot, variants))
        {
            w!(
                out,
                "    /// Payload of `{}` when variant `{}` is active.",
                self.slot_label(v, slot),
                var.name
            );
            w!(
                out,
                "    pub fn {}(&self) -> ::core::option::Option<{}> {{",
                name,
                self.variant_ref_ty(var, false).replace("'a", "'_")
            );
            w!(
                out,
                "        match self.{}() {{ {}::{}(x) => Some(x), _ => None }}",
                getter,
                rn,
                arm
            );
            w!(out, "    }}");
        }
    }

    fn emit_as_setters(
        &self,
        v: &VInfo<'a>,
        slot: &Slot<'a>,
        variants: &[Variant<'a>],
        getter: &str,
        out: &mut String,
    ) {
        let (_, rmn) = self.ref_enum_names(v, slot);
        let arms = self.variant_arm_names(variants);
        for ((var, arm), name) in variants
            .iter()
            .zip(&arms)
            .zip(self.as_names(v, slot, variants))
        {
            w!(
                out,
                "    /// Mutable payload of `{}` when variant `{}` is active.",
                self.slot_label(v, slot),
                var.name
            );
            w!(
                out,
                "    pub fn {}_mut(&mut self) -> ::core::option::Option<{}> {{",
                name,
                self.variant_ref_ty(var, true).replace("'a", "'_")
            );
            w!(
                out,
                "        match self.{}() {{ {}::{}(x) => Some(x), _ => None }}",
                getter,
                rmn,
                arm
            );
            w!(out, "    }}");
        }
    }

    fn emit_setters(&self, v: &VInfo<'a>, slot: &Slot<'a>, out: &mut String) {
        let k = slot.idx;
        let base = self.method_base(v, slot);
        let label = self.slot_label(v, slot);
        let pre = |s: &str| self.hname(v, &base, s);
        match &slot.shape {
            Shape::Prim(p) => {
                w!(out, "    /// Set `{}`.", label);
                w!(out, "    #[inline]");
                w!(
                    out,
                    "    pub fn set_{}(&mut self, value: {}) {{",
                    base,
                    prim_rust(p)
                );
                w!(out, "        let off = {};", self.off_code(slot));
                w!(
                    out,
                    "        tn_wr(self.data.as_mut(), off, {}, {});",
                    prim_size(p),
                    prim_to_raw(p, "value")
                );
                w!(out, "    }}");
            }
            Shape::Array(a) => {
                let len_name = pre("len");
                w!(out, "    /// Mutable raw bytes of `{}`.", label);
                w!(
                    out,
                    "    pub fn {}(&mut self) -> &mut [u8] {{",
                    pre("bytes_mut")
                );
                w!(out, "        let l = self.__tn_lay();");
                w!(
                    out,
                    "        &mut self.data.as_mut()[l.off[{k}]..l.off[{k}] + l.len[{k}]]",
                    k = k
                );
                w!(out, "    }}");
                match &a.elem {
                    Elem::Prim(p) => {
                        let es = prim_size(p);
                        let try_set = pre("try_set");
                        w!(
                            out,
                            "    /// Set element `i` of `{}`; `OutOfBounds` when `i` is out of range.",
                            label
                        );
                        w!(
                            out,
                            "    pub fn {}(&mut self, i: usize, value: {}) -> ::core::result::Result<(), AbiError> {{",
                            try_set,
                            prim_rust(p)
                        );
                        w!(
                            out,
                            "        if i >= self.{}() {{ return Err(AbiError::OutOfBounds); }}",
                            len_name
                        );
                        w!(
                            out,
                            "        let off = self.__tn_lay().off[{}] + i * {};",
                            k,
                            es
                        );
                        w!(
                            out,
                            "        tn_wr(self.data.as_mut(), off, {}, {});",
                            es,
                            prim_to_raw(p, "value")
                        );
                        w!(out, "        Ok(())");
                        w!(out, "    }}");
                        w!(out, "    /// Set element `i` of `{}`.", label);
                        w!(out, "    ///");
                        w!(out, "    /// # Panics");
                        w!(
                            out,
                            "    /// When `i` is out of range (like slice indexing; see `{}`).",
                            try_set
                        );
                        w!(out, "    #[track_caller]");
                        w!(
                            out,
                            "    pub fn {}(&mut self, i: usize, value: {}) {{",
                            pre("set"),
                            prim_rust(p)
                        );
                        w!(
                            out,
                            "        if self.{}(i, value).is_err() {{ tn_out_of_range(i, self.{}()) }}",
                            try_set,
                            len_name
                        );
                        w!(out, "    }}");
                        let set_all = if base.is_empty() {
                            "set_all".to_string()
                        } else {
                            format!("set_{}", base)
                        };
                        w!(
                            out,
                            "    /// Overwrite every element of `{}`; `LengthMismatch` unless `values` has one per element.",
                            label
                        );
                        w!(
                            out,
                            "    pub fn try_{}(&mut self, values: &[{}]) -> ::core::result::Result<(), AbiError> {{",
                            set_all,
                            prim_rust(p)
                        );
                        w!(
                            out,
                            "        if values.len() != self.{}() {{ return Err(AbiError::LengthMismatch); }}",
                            len_name
                        );
                        if prim_is_byte(p) {
                            w!(
                                out,
                                "        self.{}().copy_from_slice(values);",
                                pre("bytes_mut")
                            );
                        } else {
                            w!(out, "        let off = self.__tn_lay().off[{}];", k);
                            w!(out, "        let d = self.data.as_mut();");
                            w!(
                                out,
                                "        for (i, value) in values.iter().enumerate() {{ tn_wr(d, off + i * {}, {}, {}); }}",
                                es,
                                es,
                                prim_to_raw(p, "*value")
                            );
                        }
                        w!(out, "        Ok(())");
                        w!(out, "    }}");
                        w!(out, "    /// Overwrite every element of `{}`.", label);
                        w!(out, "    ///");
                        w!(out, "    /// # Panics");
                        w!(
                            out,
                            "    /// When `values` does not have one value per element (see `try_{}`).",
                            set_all
                        );
                        w!(out, "    #[track_caller]");
                        w!(
                            out,
                            "    pub fn {}(&mut self, values: &[{}]) {{",
                            set_all,
                            prim_rust(p)
                        );
                        w!(
                            out,
                            "        if let Err(e) = self.try_{}(values) {{ tn_view_misuse(e) }}",
                            set_all
                        );
                        w!(out, "    }}");
                        if prim_is_byte(p) && !base.is_empty() {
                            w!(out, "    /// `{}` as mutable bytes.", label);
                            w!(
                                out,
                                "    pub fn {}(&mut self) -> &mut [u8] {{ self.{}() }}",
                                pre("mut"),
                                pre("bytes_mut")
                            );
                        }
                    }
                    Elem::View(c) => {
                        let try_get_mut = pre("try_get_mut");
                        w!(
                            out,
                            "    /// Mutable view of element `i` of `{}`, or `None` when `i` is out of range.",
                            label
                        );
                        w!(
                            out,
                            "    pub fn {}(&mut self, i: usize) -> ::core::option::Option<{}<'_>> {{",
                            try_get_mut,
                            self.nm(&c.vname).mut_
                        );
                        w!(out, "        let (at, n, ext) = self.__tn_elem_{}(i)?;", k);
                        w!(
                            out,
                            "        Some({} {{ data: &mut self.data.as_mut()[at..at + n], ext }})",
                            self.nm(&c.vname).view
                        );
                        w!(out, "    }}");
                        w!(out, "    /// Mutable view of element `i` of `{}`.", label);
                        w!(out, "    ///");
                        w!(out, "    /// # Panics");
                        w!(
                            out,
                            "    /// When `i` is out of range (like slice indexing; see `{}`).",
                            try_get_mut
                        );
                        w!(out, "    #[track_caller]");
                        w!(
                            out,
                            "    pub fn {}(&mut self, i: usize) -> {}<'_> {{",
                            pre("get_mut"),
                            self.nm(&c.vname).mut_
                        );
                        w!(out, "        let len = self.{}();", len_name);
                        w!(
                            out,
                            "        match self.{}(i) {{ Some(v) => v, None => tn_out_of_range(i, len) }}",
                            try_get_mut
                        );
                        w!(out, "    }}");
                        w!(
                            out,
                            "    /// Copy `value` into element `i` of `{}` (sizes must match; `OutOfBounds` when `i` is out of range).",
                            label
                        );
                        w!(
                            out,
                            "    pub fn {}<S: ::core::convert::AsRef<[u8]>>(&mut self, i: usize, value: &{}<S>) -> ::core::result::Result<(), AbiError> {{",
                            pre("set"),
                            self.nm(&c.vname).view
                        );
                        w!(
                            out,
                            "        let (at, n, _) = self.__tn_elem_{}(i).ok_or(AbiError::OutOfBounds)?;",
                            k
                        );
                        w!(
                            out,
                            "        let src = value.as_bytes().get(..n).ok_or(AbiError::LengthMismatch)?;"
                        );
                        w!(
                            out,
                            "        if value.size() != n {{ return Err(AbiError::LengthMismatch); }}"
                        );
                        w!(
                            out,
                            "        self.data.as_mut()[at..at + n].copy_from_slice(src);"
                        );
                        w!(out, "        Ok(())");
                        w!(out, "    }}");
                    }
                    Elem::Opaque(_) => {}
                }
            }
            Shape::View(c) => {
                if let Some((o, n)) = self.static_child(slot, c) {
                    w!(out, "    /// Mutable view of `{}`.", label);
                    w!(out, "    #[inline]");
                    w!(
                        out,
                        "    pub fn {}(&mut self) -> {}<'_> {{",
                        pre("mut"),
                        self.nm(&c.vname).mut_
                    );
                    w!(
                        out,
                        "        {} {{ data: &mut self.data.as_mut()[{}..{}], ext: {}::default() }}",
                        self.nm(&c.vname).view,
                        o,
                        o + n,
                        self.nm(&c.vname).ext
                    );
                    w!(out, "    }}");
                    w!(
                        out,
                        "    /// Overwrite `{}` with encoded bytes (length must match).",
                        label
                    );
                    w!(
                        out,
                        "    pub fn set_{}(&mut self, bytes: &[u8]) -> ::core::result::Result<(), AbiError> {{",
                        base
                    );
                    w!(
                        out,
                        "        if bytes.len() != {} {{ return Err(AbiError::LengthMismatch); }}",
                        n
                    );
                    w!(
                        out,
                        "        self.data.as_mut()[{}..{}].copy_from_slice(bytes);",
                        o,
                        o + n
                    );
                    w!(out, "        Ok(())");
                    w!(out, "    }}");
                    return;
                }
                w!(out, "    /// Mutable view of `{}`.", label);
                w!(
                    out,
                    "    pub fn {}(&mut self) -> {}<'_> {{",
                    pre("mut"),
                    self.nm(&c.vname).mut_
                );
                w!(out, "        let l = self.__tn_lay();");
                w!(
                    out,
                    "        let ext = {};",
                    self.accessor_ext(&format!("{}", k), c)
                        .replace("(d, ", "(self.data.as_ref(), ")
                );
                w!(
                    out,
                    "        {} {{ data: &mut self.data.as_mut()[l.off[{k}]..l.off[{k}] + l.len[{k}]], ext }}",
                    self.nm(&c.vname).view,
                    k = k
                );
                w!(out, "    }}");
                w!(
                    out,
                    "    /// Overwrite `{}` with encoded bytes (length must match).",
                    label
                );
                w!(
                    out,
                    "    pub fn set_{}(&mut self, bytes: &[u8]) -> ::core::result::Result<(), AbiError> {{",
                    base
                );
                w!(out, "        let l = self.__tn_lay();");
                w!(
                    out,
                    "        if bytes.len() != l.len[{}] {{ return Err(AbiError::LengthMismatch); }}",
                    k
                );
                w!(
                    out,
                    "        self.data.as_mut()[l.off[{k}]..l.off[{k}] + l.len[{k}]].copy_from_slice(bytes);",
                    k = k
                );
                w!(out, "        Ok(())");
                w!(out, "    }}");
            }
            Shape::Enum { variants, .. } | Shape::Sdu { variants } => {
                let is_sdu = matches!(slot.shape, Shape::Sdu { .. });
                let (_, rmn) = self.ref_enum_names(v, slot);
                let arms = self.variant_arm_names(variants);
                let (mut_name, body_mut, set_body, tag_expr) = if base.is_empty() {
                    (
                        "variant_mut".to_string(),
                        "body_mut".to_string(),
                        "set_body".to_string(),
                        if is_sdu {
                            "self.__tn_lay().aux[0]".to_string()
                        } else {
                            "self.tag()".to_string()
                        },
                    )
                } else if is_sdu {
                    (
                        pre("mut"),
                        pre("body_mut"),
                        format!("set_{}", pre("body")),
                        format!("self.__tn_lay().aux[{}]", k),
                    )
                } else {
                    (
                        pre("mut"),
                        pre("body_mut"),
                        format!("set_{}", pre("body")),
                        format!("self.{}()", pre("tag")),
                    )
                };
                let range = if base.is_empty() {
                    "..l.len[0]".to_string()
                } else {
                    format!("l.off[{k}]..l.off[{k}] + l.len[{k}]", k = k)
                };
                w!(
                    out,
                    "    /// Typed mutable view of the active `{}` variant.",
                    label
                );
                w!(out, "    pub fn {}(&mut self) -> {}<'_> {{", mut_name, rmn);
                w!(out, "        let tag = {};", tag_expr);
                w!(out, "        match tag {{");
                for (vi, (var, arm)) in variants.iter().zip(&arms).enumerate() {
                    let sel = if is_sdu { vi as u64 } else { var.tag };
                    w!(out, "            {} => {{", sel);
                    w!(out, "                let l = self.__tn_lay();");
                    match &var.elem {
                        Elem::View(c) => {
                            let ext = self
                                .accessor_ext(&format!("{}_{}", k, vi), c)
                                .replace("(d, ", "(self.data.as_ref(), ");
                            w!(out, "                let ext = {};", ext);
                            w!(
                                out,
                                "                {}::{}({} {{ data: &mut self.data.as_mut()[{}], ext }})",
                                rmn,
                                arm,
                                self.nm(&c.vname).view,
                                range
                            );
                        }
                        _ => w!(
                            out,
                            "                {}::{}(&mut self.data.as_mut()[{}])",
                            rmn,
                            arm,
                            range
                        ),
                    }
                    w!(out, "            }}");
                }
                w!(out, "            t => {}::Unknown(t),", rmn);
                w!(out, "        }}");
                w!(out, "    }}");
                self.emit_as_setters(v, slot, variants, &mut_name, out);
                w!(out, "    /// Mutable raw payload bytes of `{}`.", label);
                w!(out, "    pub fn {}(&mut self) -> &mut [u8] {{", body_mut);
                w!(out, "        let l = self.__tn_lay();");
                w!(out, "        &mut self.data.as_mut()[{}]", range);
                w!(out, "    }}");
                w!(
                    out,
                    "    /// Overwrite the payload of `{}` (length must match the active variant).",
                    label
                );
                w!(
                    out,
                    "    pub fn {}(&mut self, body: &[u8]) -> ::core::result::Result<(), AbiError> {{",
                    set_body
                );
                w!(out, "        let l = self.__tn_lay();");
                w!(
                    out,
                    "        if body.len() != l.len[{}] {{ return Err(AbiError::LengthMismatch); }}",
                    k
                );
                w!(
                    out,
                    "        self.data.as_mut()[{}].copy_from_slice(body);",
                    range
                );
                w!(out, "        Ok(())");
                w!(out, "    }}");
            }
        }
    }
}

/* One row of a generated `VariantInfo` table. */
#[derive(Clone, Debug)]
pub struct VariantMeta {
    pub name: String,
    pub tag: u64,
    pub payload_size: Option<u64>,
    pub payload_type: String,
}

/* ABI name of a variant payload type (`u8`, a named type, or the inline path). */
fn payload_type_name(ty: &ResolvedType) -> String {
    match &ty.kind {
        ResolvedTypeKind::TypeRef { target_name, .. } => target_name.clone(),
        ResolvedTypeKind::Primitive { prim_type } => match prim_type {
            PrimitiveType::Integral(i) => format!("{:?}", i).to_ascii_lowercase(),
            PrimitiveType::FloatingPoint(f) => format!("{:?}", f).to_ascii_lowercase(),
        },
        _ => ty.name.clone(),
    }
}

/* Upper-case identifier fragment for associated consts. */
pub fn const_ident(name: &str) -> String {
    to_snake(name).to_ascii_uppercase()
}

#[derive(Clone)]
pub enum ParamKind<'a> {
    Target(FieldTarget<'a>),
    SduVariant(usize),
    /* Encoded byte size of slot `k` (enum payload, nested variable-size
    value or jagged array) that the other parameters cannot determine. */
    PayloadSize(usize),
    /* Encoded byte size of a union with variable-size variants. */
    UnionSize,
    BufferSize,
}

#[derive(Clone)]
pub struct ParamField<'a> {
    pub ident: String,
    pub kind: ParamKind<'a>,
    pub doc: String,
}
