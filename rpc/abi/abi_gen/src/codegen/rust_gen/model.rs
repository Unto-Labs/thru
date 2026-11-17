/* Layout model for the Rust backend.

Every non-primitive node that gets its own zero-copy view (named types,
inline structs/unions, enum and union variants, array elements) is a "view".
Expressions (array sizes, enum tags) are resolved lexically exactly like the
resolver does: innermost struct scope first, walking outwards, only seeing
fields declared before the one being resolved. A reference that resolves
outside a view becomes part of that view's external context ("ext"), which
the enclosing view fills in when it hands out the child view.

Views are keyed by the resolved type name (`A` for a declared type, `A::b`
for the inline type of its field `b`), which cannot collide: a declared `A_b`
and the inline `A::b` are different views. Emitted identifiers come from the
backends' name tables, never from the key. */

use crate::abi::expr::ExprKind;
use crate::abi::resolved::{ConstantStatus, ResolvedType, ResolvedTypeKind, Size, TypeResolver};
use crate::abi::types::{FloatingPointType, IntegralType, PrimitiveType};
use std::cell::RefCell;
use std::collections::{BTreeMap, HashMap};

/* A struct scope visible to expressions: fields `[..upto]` are visible. */
#[derive(Clone, Copy)]
pub struct Frame<'a> {
    pub ty: &'a ResolvedType,
    pub upto: usize,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Seg {
    Field(String),
    Index(usize),
}

/* A field reference resolved to a primitive inside some scope. */
#[derive(Clone)]
pub struct FieldTarget<'a> {
    /* Index of the owning scope in the frame list used for resolution. */
    pub owner: usize,
    pub owner_ty: &'a ResolvedType,
    pub segs: Vec<Seg>,
    pub prim: PrimitiveType,
    /* Field/element indices along the path; orders targets by layout position. */
    pub order: Vec<usize>,
}

impl FieldTarget<'_> {
    pub fn key(&self) -> String {
        format!("{}|{}", self.owner_ty.name, segs_to_string(&self.segs))
    }
}

#[derive(Clone)]
pub enum RefKind<'a> {
    Field(FieldTarget<'a>),
    BufferSize,
    /* Unresolvable inside a named non-struct type: supplied by whoever embeds it. */
    External(String),
}

pub fn segs_to_string(segs: &[Seg]) -> String {
    segs.iter()
        .map(|s| match s {
            Seg::Field(f) => f.clone(),
            Seg::Index(i) => i.to_string(),
        })
        .collect::<Vec<_>>()
        .join(".")
}

pub fn segs_to_ident(segs: &[Seg]) -> String {
    sanitize_ident_part(
        &segs
            .iter()
            .map(|s| match s {
                Seg::Field(f) => f.clone(),
                Seg::Index(i) => i.to_string(),
            })
            .collect::<Vec<_>>()
            .join("_"),
    )
}

#[derive(Clone)]
pub struct ExtVar<'a> {
    pub key: String,
    pub ident: String,
    /* Raw path for external (unresolvable) references. */
    pub external_path: Option<String>,
    /* Resolved target for references to enclosing scopes. */
    pub target: Option<FieldTarget<'a>>,
}

pub struct ViewInfo<'a> {
    /* Model key: the resolved type name (see the module comment). */
    pub name: String,
    pub ty: &'a ResolvedType,
    pub ancestors: Vec<Frame<'a>>,
    pub ext: Vec<ExtVar<'a>>,
    pub named: bool,
    /* Root-owned referenced primitives (named struct roots only), layout order. */
    pub params: Vec<FieldTarget<'a>>,
    pub uses_buffer_size: bool,
    /* The size depends on bytes inside the view itself (its own length/tag
    fields, size-discriminated unions, variable-size unions, the available
    byte count), not only on its context. An enclosing type cannot derive it
    from its own dynamic parameters. */
    pub self_dep: bool,
}

impl ViewInfo<'_> {
    pub fn ext_ident(&self, key: &str) -> Option<&str> {
        self.ext
            .iter()
            .find(|e| e.key == key)
            .map(|e| e.ident.as_str())
    }
    pub fn has_ext(&self) -> bool {
        !self.ext.is_empty()
    }
    /* Frame index of this view's own scope (if it is a struct). */
    pub fn self_scope(&self) -> usize {
        self.ancestors.len()
    }
}

pub struct Model<'a> {
    pub resolver: &'a TypeResolver,
    views: RefCell<BTreeMap<String, ViewInfoCell<'a>>>,
    order: RefCell<Vec<String>>,
}

type ViewInfoCell<'a> = std::rc::Rc<RefCell<ViewInfo<'a>>>;

struct VisitState<'a> {
    frames: Vec<Frame<'a>>,
    /* (view name, number of frames enclosing the view) */
    views: Vec<(String, usize)>,
    root: String,
}

impl<'a> Model<'a> {
    pub fn new(resolver: &'a TypeResolver) -> Self {
        Self {
            resolver,
            views: RefCell::new(BTreeMap::new()),
            order: RefCell::new(Vec::new()),
        }
    }

    pub fn deref(&self, ty: &'a ResolvedType) -> &'a ResolvedType {
        let mut cur = ty;
        let mut guard = 0;
        while let ResolvedTypeKind::TypeRef { target_name, .. } = &cur.kind {
            match self.resolver.types.get(target_name) {
                Some(t) => cur = t,
                None => break,
            }
            guard += 1;
            if guard > 64 {
                break;
            }
        }
        cur
    }

    pub fn named(&self, name: &str) -> Option<&'a ResolvedType> {
        self.resolver.types.get(name)
    }

    pub fn view(&self, name: &str) -> Option<ViewInfoCell<'a>> {
        self.views.borrow().get(name).cloned()
    }

    /* Views (named root first, then inline views) collected for the declared
    type `root`. */
    pub fn views_of_root(&self, root: &str) -> Vec<ViewInfoCell<'a>> {
        let order = self.order.borrow();
        let views = self.views.borrow();
        order
            .iter()
            .filter(|n| {
                views
                    .get(*n)
                    .map(|v| root_of(&v.borrow().ty.name) == root)
                    .unwrap_or(false)
            })
            .filter_map(|n| views.get(n).cloned())
            .collect()
    }

    /* Collect views for a named type (idempotent). */
    pub fn collect_named(&self, name: &str) {
        let key = name.to_string();
        if self.views.borrow().contains_key(&key) {
            return;
        }
        let Some(ty) = self.named(name) else { return };
        if matches!(
            ty.kind,
            ResolvedTypeKind::Primitive { .. } | ResolvedTypeKind::TypeRef { .. }
        ) {
            return;
        }
        let mut st = VisitState {
            frames: Vec::new(),
            views: Vec::new(),
            root: key.clone(),
        };
        self.visit_view(ty, true, &mut st);
    }

    fn visit_view(&self, node: &'a ResolvedType, named: bool, st: &mut VisitState<'a>) {
        let name = node.name.clone();
        if !self.views.borrow().contains_key(&name) {
            let info = ViewInfo {
                name: name.clone(),
                ty: node,
                ancestors: st.frames.clone(),
                ext: Vec::new(),
                named,
                params: Vec::new(),
                uses_buffer_size: false,
                self_dep: false,
            };
            self.views
                .borrow_mut()
                .insert(name.clone(), std::rc::Rc::new(RefCell::new(info)));
            self.order.borrow_mut().push(name.clone());
        }
        st.views.push((name, st.frames.len()));
        match &node.kind {
            ResolvedTypeKind::Struct { fields, .. } => {
                st.frames.push(Frame { ty: node, upto: 0 });
                for (i, field) in fields.iter().enumerate() {
                    st.frames.last_mut().unwrap().upto = i;
                    self.visit_field(&field.field_type, st);
                }
                st.frames.pop();
            }
            ResolvedTypeKind::Union { variants } => {
                /* Which variant spans a variable-size union is not encoded. */
                if const_size(node).is_none() {
                    self.mark_self_dep(st);
                }
                for v in variants {
                    self.visit_child(&v.field_type, st);
                }
            }
            ResolvedTypeKind::Array {
                element_type,
                size_expression,
                ..
            } => {
                self.record_expr(size_expression, st, true);
                self.visit_child(element_type, st);
            }
            ResolvedTypeKind::Enum {
                tag_expression,
                variants,
                ..
            } => {
                self.record_expr(tag_expression, st, const_size(node).is_none());
                for v in variants {
                    self.visit_child(&v.variant_type, st);
                }
            }
            ResolvedTypeKind::SizeDiscriminatedUnion { variants } => {
                self.mark_self_dep(st);
                for v in variants {
                    self.visit_child(&v.variant_type, st);
                }
            }
            ResolvedTypeKind::Primitive { .. } | ResolvedTypeKind::TypeRef { .. } => {}
        }
        st.views.pop();
    }

    fn visit_field(&self, ty: &'a ResolvedType, st: &mut VisitState<'a>) {
        match &ty.kind {
            ResolvedTypeKind::Array {
                element_type,
                size_expression,
                ..
            } => {
                self.record_expr(size_expression, st, true);
                self.visit_child(element_type, st);
            }
            ResolvedTypeKind::Enum {
                tag_expression,
                variants,
                ..
            } => {
                self.record_expr(tag_expression, st, const_size(ty).is_none());
                for v in variants {
                    self.visit_child(&v.variant_type, st);
                }
            }
            ResolvedTypeKind::SizeDiscriminatedUnion { variants } => {
                self.mark_self_dep(st);
                for v in variants {
                    self.visit_child(&v.variant_type, st);
                }
            }
            ResolvedTypeKind::Struct { .. } | ResolvedTypeKind::Union { .. } => {
                self.visit_view(ty, false, st);
            }
            ResolvedTypeKind::TypeRef { target_name, .. } => self.visit_typeref(target_name, st),
            ResolvedTypeKind::Primitive { .. } => {}
        }
    }

    fn visit_child(&self, ty: &'a ResolvedType, st: &mut VisitState<'a>) {
        match &ty.kind {
            /* An inline enum element / payload is a view of its own (like a
            top-level enum), so walkers size it by its tag. */
            ResolvedTypeKind::Struct { .. }
            | ResolvedTypeKind::Union { .. }
            | ResolvedTypeKind::Array { .. }
            | ResolvedTypeKind::Enum { .. } => self.visit_view(ty, false, st),
            ResolvedTypeKind::SizeDiscriminatedUnion { .. } => self.visit_field(ty, st),
            ResolvedTypeKind::TypeRef { target_name, .. } => self.visit_typeref(target_name, st),
            ResolvedTypeKind::Primitive { .. } => {}
        }
    }

    /* A typeref to a named type with external references binds them here. */
    fn visit_typeref(&self, target: &str, st: &mut VisitState<'a>) {
        let target_ty = match self.named(target) {
            Some(t) => self.deref(t),
            None => return,
        };
        self.collect_named(&target_ty.name);
        let Some(info) = self.view(&target_ty.name) else {
            return;
        };
        let externals: Vec<String> = info
            .borrow()
            .ext
            .iter()
            .filter_map(|e| e.external_path.clone())
            .collect();
        let variable = const_size(target_ty).is_none();
        if variable && info.borrow().self_dep {
            self.mark_self_dep(st);
        }
        for raw in externals {
            let path: Vec<String> = raw.split('.').map(|s| s.to_string()).collect();
            let resolved = self.resolve(&path, &st.frames);
            self.record_ref(resolved, st, variable);
        }
    }

    /* `sizing`: the expression decides the size of something variable-size. */
    fn record_expr(&self, expr: &ExprKind, st: &mut VisitState<'a>, sizing: bool) {
        let mut paths = Vec::new();
        collect_field_refs(expr, &mut paths);
        for path in paths {
            let resolved = self.resolve(&path, &st.frames);
            self.record_ref(resolved, st, sizing);
        }
    }

    /* Every view being visited depends on its own bytes for its size. */
    fn mark_self_dep(&self, st: &VisitState<'a>) {
        for (v, _) in &st.views {
            if let Some(info) = self.view(v) {
                info.borrow_mut().self_dep = true;
            }
        }
    }

    fn record_ref(&self, resolved: RefKind<'a>, st: &mut VisitState<'a>, sizing: bool) {
        match resolved {
            RefKind::BufferSize => {
                if let Some(info) = st.views.last().and_then(|(v, _)| self.view(v)) {
                    info.borrow_mut().uses_buffer_size = true;
                }
                if sizing {
                    self.mark_self_dep(st);
                }
            }
            RefKind::External(raw) => {
                let key = format!("?|{}", raw);
                for (v, _) in &st.views {
                    if let Some(info) = self.view(v) {
                        add_ext(&mut info.borrow_mut(), &key, &raw, Some(raw.clone()), None);
                    }
                }
            }
            RefKind::Field(target) => {
                let key = target.key();
                let path_ident = segs_to_string(&target.segs);
                for (v, base) in &st.views {
                    if *base <= target.owner {
                        /* The field lives inside this view. */
                        if sizing {
                            if let Some(info) = self.view(v) {
                                info.borrow_mut().self_dep = true;
                            }
                        }
                        continue;
                    }
                    if let Some(info) = self.view(v) {
                        add_ext(
                            &mut info.borrow_mut(),
                            &key,
                            &path_ident,
                            None,
                            Some(target.clone()),
                        );
                    }
                }
                /* Root-owned references are the type's dynamic parameters. */
                if target.owner == 0 {
                    if let Some(root) = self.view(&st.root) {
                        let mut root = root.borrow_mut();
                        if root.ancestors.is_empty()
                            && matches!(root.ty.kind, ResolvedTypeKind::Struct { .. })
                            && !root.params.iter().any(|p| p.segs == target.segs)
                        {
                            root.params.push(target);
                            root.params.sort_by(|a, b| a.order.cmp(&b.order));
                        }
                    }
                }
            }
        }
    }

    /* Resolve a field-ref path the way `TypeResolver` does. */
    pub fn resolve(&self, path: &[String], frames: &[Frame<'a>]) -> RefKind<'a> {
        if path.len() == 1 && path[0] == "__buffer_size" {
            return RefKind::BufferSize;
        }
        let mut idx = frames.len();
        while idx > 0 {
            idx -= 1;
            if let Some(t) = self.resolve_from(path, frames, idx) {
                return RefKind::Field(t);
            }
        }
        RefKind::External(path.join("."))
    }

    fn resolve_from(
        &self,
        path: &[String],
        frames: &[Frame<'a>],
        start: usize,
    ) -> Option<FieldTarget<'a>> {
        let mut scope = start;
        let mut cur: &'a ResolvedType = frames[scope].ty;
        let mut visible = Some(frames[scope].upto);
        let mut owner: Option<usize> = None;
        let mut segs = Vec::new();
        let mut order = Vec::new();
        let mut i = 0;
        while i < path.len() {
            let seg = &path[i];
            if seg == ".." {
                if owner.is_some() || scope == 0 {
                    return None;
                }
                scope -= 1;
                cur = frames[scope].ty;
                visible = Some(frames[scope].upto);
                i += 1;
                continue;
            }
            match &cur.kind {
                ResolvedTypeKind::Struct { fields, .. } => {
                    let name = seg.trim_start_matches("../");
                    let limit = visible.unwrap_or(fields.len()).min(fields.len());
                    let pos = fields[..limit].iter().position(|f| f.name == name)?;
                    if owner.is_none() {
                        owner = Some(scope);
                    }
                    segs.push(Seg::Field(name.to_string()));
                    order.push(pos);
                    cur = &fields[pos].field_type;
                    visible = None;
                    i += 1;
                }
                ResolvedTypeKind::Array {
                    element_type,
                    size_expression,
                    size_constant_status,
                    ..
                } => {
                    let index: usize = seg.parse().ok()?;
                    if !matches!(size_constant_status, ConstantStatus::Constant) {
                        return None;
                    }
                    let count = self
                        .resolver
                        .evaluate_constant_expression(size_expression)?;
                    if index as u64 >= count {
                        return None;
                    }
                    segs.push(Seg::Index(index));
                    order.push(index);
                    cur = element_type;
                    i += 1;
                }
                ResolvedTypeKind::TypeRef { target_name, .. } => {
                    cur = self.resolver.types.get(target_name)?;
                    visible = None;
                }
                _ => return None,
            }
        }
        let owner = owner?;
        let prim = match &self.deref(cur).kind {
            ResolvedTypeKind::Primitive { prim_type } => prim_type.clone(),
            _ => return None,
        };
        Some(FieldTarget {
            owner,
            owner_ty: frames[owner].ty,
            segs,
            prim,
            order,
        })
    }
}

fn add_ext<'a>(
    info: &mut ViewInfo<'a>,
    key: &str,
    path: &str,
    external: Option<String>,
    target: Option<FieldTarget<'a>>,
) {
    if info.ext.iter().any(|e| e.key == key) {
        return;
    }
    let base = sanitize_ident_part(&path.replace('.', "_"));
    let mut ident = base.clone();
    let mut n = 1;
    while info.ext.iter().any(|e| e.ident == ident) {
        n += 1;
        ident = format!("{}_{}", base, n);
    }
    info.ext.push(ExtVar {
        key: key.to_string(),
        ident: escape_ident(&ident),
        external_path: external,
        target,
    });
}

/* Declared type owning the (possibly inline) type `name`. */
fn root_of(name: &str) -> &str {
    name.split("::").next().unwrap_or(name)
}

pub fn collect_field_refs(expr: &ExprKind, out: &mut Vec<Vec<String>>) {
    match expr {
        ExprKind::FieldRef(r) => out.push(r.path.clone()),
        ExprKind::Literal(_) | ExprKind::Sizeof(_) | ExprKind::Alignof(_) => {}
        ExprKind::Add(e) => bin(&e.left, &e.right, out),
        ExprKind::Sub(e) => bin(&e.left, &e.right, out),
        ExprKind::Mul(e) => bin(&e.left, &e.right, out),
        ExprKind::Div(e) => bin(&e.left, &e.right, out),
        ExprKind::Mod(e) => bin(&e.left, &e.right, out),
        ExprKind::Pow(e) => bin(&e.left, &e.right, out),
        ExprKind::BitAnd(e) => bin(&e.left, &e.right, out),
        ExprKind::BitOr(e) => bin(&e.left, &e.right, out),
        ExprKind::BitXor(e) => bin(&e.left, &e.right, out),
        ExprKind::LeftShift(e) => bin(&e.left, &e.right, out),
        ExprKind::RightShift(e) => bin(&e.left, &e.right, out),
        ExprKind::Eq(e) => bin(&e.left, &e.right, out),
        ExprKind::Ne(e) => bin(&e.left, &e.right, out),
        ExprKind::Lt(e) => bin(&e.left, &e.right, out),
        ExprKind::Gt(e) => bin(&e.left, &e.right, out),
        ExprKind::Le(e) => bin(&e.left, &e.right, out),
        ExprKind::Ge(e) => bin(&e.left, &e.right, out),
        ExprKind::And(e) => bin(&e.left, &e.right, out),
        ExprKind::Or(e) => bin(&e.left, &e.right, out),
        ExprKind::Xor(e) => bin(&e.left, &e.right, out),
        ExprKind::BitNot(e) => collect_field_refs(&e.operand, out),
        ExprKind::Neg(e) => collect_field_refs(&e.operand, out),
        ExprKind::Not(e) => collect_field_refs(&e.operand, out),
        ExprKind::Popcount(e) => collect_field_refs(&e.operand, out),
    }
}

fn bin(l: &ExprKind, r: &ExprKind, out: &mut Vec<Vec<String>>) {
    collect_field_refs(l, out);
    collect_field_refs(r, out);
}

/* ---------------------------------------------------------------------------
 * Naming
 * ------------------------------------------------------------------------- */

const RUST_KEYWORDS: &[&str] = &[
    "as", "break", "const", "continue", "crate", "else", "enum", "extern", "false", "fn", "for",
    "if", "impl", "in", "let", "loop", "match", "mod", "move", "mut", "pub", "ref", "return",
    "self", "Self", "static", "struct", "super", "trait", "true", "type", "unsafe", "use", "where",
    "while", "async", "await", "dyn", "abstract", "become", "box", "do", "final", "macro",
    "override", "priv", "typeof", "unsized", "virtual", "yield", "try", "gen",
];

/* Replace characters that cannot appear in identifiers. */
pub fn sanitize_ident_part(name: &str) -> String {
    let mut out: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    if out.is_empty() || out.chars().next().unwrap().is_ascii_digit() {
        out.insert(0, '_');
    }
    out
}

/* A usable identifier for a field-derived name (method or binding). */
pub fn escape_ident(name: &str) -> String {
    let name = sanitize_ident_part(name);
    match name.as_str() {
        "self" | "Self" | "super" | "crate" | "_" => format!("{}_", name),
        n if RUST_KEYWORDS.contains(&n) => format!("r#{}", n),
        _ => name,
    }
}

/* Identifier text without any raw prefix (for building composite names). */
pub fn plain_ident(name: &str) -> String {
    sanitize_ident_part(name)
}

/* View type base name for a resolved type name (`A::b::c` -> `A_b_c`). */
pub fn view_name(name: &str) -> String {
    let n = sanitize_ident_part(&name.replace("::", "_"));
    match n.as_str() {
        "Self" | "self" | "super" | "crate" => format!("{}_", n),
        k if RUST_KEYWORDS.contains(&k) => format!("r#{}", k),
        _ => n,
    }
}

pub fn to_camel(name: &str) -> String {
    let mut out = String::new();
    let mut upper = true;
    for c in name.chars() {
        if c == '_' || c == '-' || c == ' ' || c == '.' {
            upper = true;
            continue;
        }
        if !c.is_ascii_alphanumeric() {
            continue;
        }
        if upper {
            out.push(c.to_ascii_uppercase());
            upper = false;
        } else {
            out.push(c);
        }
    }
    if out.is_empty() || out.chars().next().unwrap().is_ascii_digit() {
        out.insert(0, 'V');
    }
    if out == "Self" {
        out.push('_');
    }
    out
}

pub fn to_snake(name: &str) -> String {
    let mut out = String::new();
    let chars: Vec<char> = name.chars().collect();
    for (i, c) in chars.iter().enumerate() {
        if c.is_ascii_uppercase() {
            if i > 0 && (chars[i - 1].is_ascii_lowercase() || chars[i - 1].is_ascii_digit()) {
                out.push('_');
            }
            out.push(c.to_ascii_lowercase());
        } else if c.is_ascii_alphanumeric() || *c == '_' {
            out.push(*c);
        } else {
            out.push('_');
        }
    }
    sanitize_ident_part(&out)
}

/* ---------------------------------------------------------------------------
 * Primitive helpers
 * ------------------------------------------------------------------------- */

pub fn prim_size(p: &PrimitiveType) -> usize {
    match p {
        PrimitiveType::Integral(i) => match i {
            IntegralType::U8 | IntegralType::I8 | IntegralType::Char => 1,
            IntegralType::U16 | IntegralType::I16 => 2,
            IntegralType::U32 | IntegralType::I32 => 4,
            IntegralType::U64 | IntegralType::I64 => 8,
        },
        PrimitiveType::FloatingPoint(f) => match f {
            FloatingPointType::F16 => 2,
            FloatingPointType::F32 => 4,
            FloatingPointType::F64 => 8,
        },
    }
}

/* Rust type used in accessors (f16 is exposed as its raw bits). */
pub fn prim_rust(p: &PrimitiveType) -> &'static str {
    match p {
        PrimitiveType::Integral(i) => match i {
            IntegralType::U8 | IntegralType::Char => "u8",
            IntegralType::U16 => "u16",
            IntegralType::U32 => "u32",
            IntegralType::U64 => "u64",
            IntegralType::I8 => "i8",
            IntegralType::I16 => "i16",
            IntegralType::I32 => "i32",
            IntegralType::I64 => "i64",
        },
        PrimitiveType::FloatingPoint(f) => match f {
            FloatingPointType::F16 => "u16",
            FloatingPointType::F32 => "f32",
            FloatingPointType::F64 => "f64",
        },
    }
}

pub fn prim_signed(p: &PrimitiveType) -> bool {
    matches!(
        p,
        PrimitiveType::Integral(
            IntegralType::I8 | IntegralType::I16 | IntegralType::I32 | IntegralType::I64
        )
    )
}

pub fn prim_is_byte(p: &PrimitiveType) -> bool {
    matches!(
        p,
        PrimitiveType::Integral(IntegralType::U8 | IntegralType::Char)
    )
}

/* Convert raw little-endian bits (u64) to the accessor type. */
pub fn raw_to_prim(p: &PrimitiveType, raw: &str) -> String {
    match p {
        PrimitiveType::FloatingPoint(FloatingPointType::F32) => {
            format!("f32::from_bits(({}) as u32)", raw)
        }
        PrimitiveType::FloatingPoint(FloatingPointType::F64) => format!("f64::from_bits({})", raw),
        _ => format!("(({}) as {})", raw, prim_rust(p)),
    }
}

/* Convert an accessor value to raw little-endian bits (u64). */
pub fn prim_to_raw(p: &PrimitiveType, value: &str) -> String {
    match p {
        PrimitiveType::FloatingPoint(FloatingPointType::F32) => {
            format!("(({}).to_bits() as u64)", value)
        }
        PrimitiveType::FloatingPoint(FloatingPointType::F64) => format!("({}).to_bits()", value),
        _ if prim_signed(p) => format!("(({}) as i64 as u64)", value),
        _ => format!("(({}) as u64)", value),
    }
}

/* A raw read (u64) widened to an expression value (sign-extended if signed). */
pub fn raw_to_value(p: &PrimitiveType, raw: &str) -> String {
    if prim_signed(p) {
        format!("tn_sext({}, {})", raw, prim_size(p))
    } else {
        raw.to_string()
    }
}

pub fn const_size(ty: &ResolvedType) -> Option<u64> {
    match ty.size {
        Size::Const(c) => Some(c),
        Size::Variable(_) => None,
    }
}

/* Struct fields' static offsets keyed by name (only for constant prefixes). */
pub fn static_field_offsets(ty: &ResolvedType) -> HashMap<String, u64> {
    let mut map = HashMap::new();
    if let ResolvedTypeKind::Struct { fields, .. } = &ty.kind {
        for f in fields {
            if let Some(o) = f.offset {
                map.insert(f.name.clone(), o);
            }
        }
    }
    map
}
