//! Layout model for the C backend.
//!
//! Every ABI type that the generated C code can point at becomes a [`Node`]:
//! named types, and every inline (anonymous) struct, union, enum, size-
//! discriminated union, array and enum payload nested inside them. Nodes carry
//! the facts the emitter needs to generate a sequential layout walker:
//!
//! * `ext`: field references a node cannot resolve inside itself. The parent
//!   supplies those values through the node's params struct (the C analogue of
//!   the TypeScript `fieldContext`), e.g. an enum's tag field or a payload FAM
//!   sized by a header field of the enclosing struct.
//! * `len_dep`: the layout depends on the bytes available to the node
//!   (`__buffer_size` expressions or size-discriminated unions).
//! * `internal`: values a struct reads from its own fields so that children
//!   can be sized (the TypeScript `dynamicParams`).
//! * `members`: the C params struct (`<Node>_params_t`) layout.

use super::helpers::escape_c_keyword;
use crate::abi::expr::ExprKind;
use crate::abi::resolved::{ResolvedType, ResolvedTypeKind, Size, TypeResolver};
use crate::abi::types::{FloatingPointType, IntegralType, PrimitiveType};
use std::collections::{BTreeSet, HashMap};

pub type NodeId = usize;

/// The special field reference that evaluates to the available byte count.
pub const BUFFER_SIZE_REF: &str = "__buffer_size";

#[derive(Debug, Clone)]
pub enum Slot {
    Prim(PrimitiveType),
    Node(NodeId),
}

#[derive(Debug, Clone)]
pub struct Field {
    /// ABI field (or union variant) name.
    pub name: String,
    /// C identifier for the field.
    pub ident: String,
    pub slot: Slot,
    /// Offset known at generation time (constant prefix of the struct).
    pub const_offset: Option<u64>,
    pub align: u64,
}

#[derive(Debug, Clone)]
pub struct Variant {
    pub name: String,
    pub ident: String,
    /// Enum tag value, or the expected byte size for size-discriminated unions.
    pub value: u64,
    pub slot: Slot,
}

#[derive(Debug, Clone)]
pub enum NodeKind {
    Prim(PrimitiveType),
    Struct {
        fields: Vec<Field>,
        packed: bool,
    },
    Union {
        variants: Vec<Field>,
    },
    Enum {
        tag: ExprKind,
        variants: Vec<Variant>,
    },
    Sdu {
        variants: Vec<Variant>,
    },
    Array {
        count: ExprKind,
        elem: Slot,
        elem_size: Option<u64>,
        jagged: bool,
    },
    /// Named type that is a type-ref to another named type.
    Alias {
        target: NodeId,
    },
}

/// Whole-value setter of a nested struct or type-ref field `f` of `S`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ValueSetter {
    /// `S_set_<f>( self[, params], value )` copies this many bytes.
    Copy(u64),
    /// `S_set_<f>_bytes( self[, params], src, n )` replaces a variable-size
    /// value in place when `n` is its current size and `src` validates.
    Bytes,
}

/// A value a struct reads out of one of its own fields.
#[derive(Debug, Clone)]
pub struct InternalRef {
    pub key: String,
    pub field: usize,
    pub sub_offset: u64,
    pub prim: PrimitiveType,
    /// Read only for an enclosing struct (see [`ViaRef`]); the struct's own
    /// layout does not depend on it.
    pub exported: bool,
}

/// A value a struct reads through a nested struct field whose offset inside
/// that field is only known at run time (`child.count` after `child.bytes`):
/// the child's walker reads it into the child's params, at `member`.
#[derive(Debug, Clone)]
pub struct ViaRef {
    pub key: String,
    pub field: usize,
    /// C member path inside this node's params (`child.count`).
    pub member: String,
}

/// Why a field reference cannot be resolved to a constant offset.
enum NavErr {
    /// A struct field on the path (named here) has a run-time offset.
    Dynamic(String),
    Other(String),
}

impl NavErr {
    fn message(self, key: &str) -> String {
        match self {
            NavErr::Dynamic(seg) => {
                format!("field reference '{key}': '{seg}' has a dynamic offset")
            }
            NavErr::Other(e) => e,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MemberKind {
    /// Bytes available to the node (`__buffer_size`).
    BufSz,
    /// Value supplied by the enclosing node.
    Ext(String),
    /// Value read from the node's own fields (index into `internal`).
    Internal(usize),
    /// Embedded params of a child (struct field / enum or SDU variant slot).
    Child { slot: String, node: NodeId },
    /// Total byte size of a jagged array (needed to footprint from params).
    JaggedBytes,
}

#[derive(Debug, Clone)]
pub struct Member {
    pub name: String,
    pub kind: MemberKind,
}

#[derive(Debug, Clone)]
pub struct Node {
    /// C prefix: `<prefix>_t`, `<prefix>_params_t`, `<prefix>_get_x`, ...
    pub c_name: String,
    /// ABI type name (named types) or a `Parent::field` style path.
    pub type_name: String,
    pub named: bool,
    pub kind: NodeKind,
    pub const_size: Option<u64>,
    pub align: u64,
    pub ext: Vec<String>,
    pub len_dep: bool,
    /// Constant size, no runtime inputs and nothing to check beyond bounds.
    pub trivial: bool,
    pub internal: Vec<InternalRef>,
    /// Values read through nested structs' params.
    pub via: Vec<ViaRef>,
    pub members: Vec<Member>,
    /// Set when the node is a struct/union field slot (struct-level wrappers
    /// own the public enum/SDU accessor names).
    pub is_field_slot: bool,
    /// Generation-time problems; the walker reports TN_ABI_ERR_UNSUPPORTED.
    pub unsupported: Vec<String>,
    /// Native C struct/union definition can describe the layout.
    pub native: bool,
}

impl Node {
    /// Public accessors need a `<Node>_params_t const *` argument.
    pub fn needs_params(&self) -> bool {
        !self.ext.is_empty() || self.len_dep
    }

    /// Member holding the value of reference `key`, as written inside this
    /// node. A struct answers its own fields from `internal` and anything
    /// else from its enclosing scope (one `..` fewer).
    pub fn member_for_key(&self, key: &str) -> Option<&str> {
        let ext_key = if matches!(self.kind, NodeKind::Struct { .. }) {
            outer_key(key)
        } else {
            key
        };
        /* A field of this struct shadows a same-named outer value. */
        let own = self
            .members
            .iter()
            .find_map(|m| match &m.kind {
                MemberKind::Internal(idx) if self.internal[*idx].key == key => {
                    Some(m.name.as_str())
                }
                _ => None,
            })
            .or_else(|| {
                self.via
                    .iter()
                    .find(|v| v.key == key)
                    .map(|v| v.member.as_str())
            });
        own.or_else(|| {
            self.members.iter().find_map(|m| match &m.kind {
                MemberKind::Ext(k) if k == ext_key => Some(m.name.as_str()),
                _ => None,
            })
        })
    }

    pub fn child_member(&self, slot: &str) -> Option<&str> {
        self.members.iter().find_map(|m| match &m.kind {
            MemberKind::Child { slot: s, .. } if s == slot => Some(m.name.as_str()),
            _ => None,
        })
    }

    /// Index into `internal` of the field an enum tag (or array count)
    /// expression reads, when the expression is a plain reference to a
    /// primitive field of this struct (possibly nested, e.g. `hdr.kind`).
    pub fn plain_ref(&self, expr: &ExprKind) -> Option<usize> {
        let ExprKind::FieldRef(r) = expr else {
            return None;
        };
        let key = ref_key(&r.path);
        if !matches!(self.kind, NodeKind::Struct { .. }) {
            return None;
        }
        self.internal.iter().position(|i| i.key == key)
    }

    pub fn has_member(&self, kind: &MemberKind) -> Option<&str> {
        self.members
            .iter()
            .find(|m| &m.kind == kind)
            .map(|m| m.name.as_str())
    }
}

pub struct Model<'a> {
    pub resolver: &'a TypeResolver,
    pub nodes: Vec<Node>,
    named: HashMap<String, NodeId>,
    building: BTreeSet<String>,
}

pub fn c_ident(name: &str) -> String {
    escape_c_keyword(&name.replace("::", "_"))
}

pub fn prim_size(prim: &PrimitiveType) -> u64 {
    match prim {
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

/// ABI spelling of a primitive (`u8`, `i64`, `f32`, `char`).
pub fn prim_abi_name(prim: &PrimitiveType) -> String {
    match prim {
        PrimitiveType::Integral(i) => format!("{i:?}").to_lowercase(),
        PrimitiveType::FloatingPoint(f) => format!("{f:?}").to_lowercase(),
    }
}

/// C type used for a primitive in generated accessors. f16 is exposed as its
/// raw IEEE-754 bits because `_Float16` is not portable.
pub fn prim_c_type(prim: &PrimitiveType) -> &'static str {
    match prim {
        PrimitiveType::Integral(i) => match i {
            IntegralType::U8 | IntegralType::Char => "uint8_t",
            IntegralType::U16 => "uint16_t",
            IntegralType::U32 => "uint32_t",
            IntegralType::U64 => "uint64_t",
            IntegralType::I8 => "int8_t",
            IntegralType::I16 => "int16_t",
            IntegralType::I32 => "int32_t",
            IntegralType::I64 => "int64_t",
        },
        PrimitiveType::FloatingPoint(f) => match f {
            FloatingPointType::F16 => "uint16_t",
            FloatingPointType::F32 => "float",
            FloatingPointType::F64 => "double",
        },
    }
}

/// Prefix of a reference key per leading `..` path segment.
const SCOPE_UP: &str = "../";

/// Normalized key for a field reference path (`[a, b, 0]` is `a.b.0`).
///
/// Leading `..` segments step out one struct scope each, as in
/// `TypeResolver`; they are kept as `../` prefixes so every enclosing struct
/// can tell whether the reference is its own (see [`scope_split`]). Inside a
/// segment, `../` prefixes are dropped (`TypeResolver` resolves `../a` as `a`).
pub fn ref_key(path: &[String]) -> String {
    let mut up = 0usize;
    let mut segs: Vec<&str> = Vec::new();
    for s in path {
        if s.trim() == ".." && segs.is_empty() {
            up += 1;
            continue;
        }
        segs.extend(
            s.split(['/', '.'])
                .map(|s| s.trim())
                .filter(|s| !s.is_empty()),
        );
    }
    format!("{}{}", SCOPE_UP.repeat(up), segs.join("."))
}

/// Number of struct scopes a key skips before it can resolve, and the path
/// left to resolve.
pub fn scope_split(key: &str) -> (usize, &str) {
    let mut up = 0;
    let mut rest = key;
    while let Some(r) = rest.strip_prefix(SCOPE_UP) {
        up += 1;
        rest = r;
    }
    (up, rest)
}

/// Key as seen from outside a struct: one skipped scope fewer.
pub fn outer_key(key: &str) -> &str {
    key.strip_prefix(SCOPE_UP).unwrap_or(key)
}

/// Field-reference keys used by an expression, plus whether it reads
/// `__buffer_size`.
pub fn expr_refs(expr: &ExprKind, keys: &mut BTreeSet<String>, buf: &mut bool) {
    use ExprKind::*;
    match expr {
        Literal(_) | Sizeof(_) | Alignof(_) => {}
        FieldRef(f) => {
            let key = ref_key(&f.path);
            /* `__buffer_size` is resolved like a field reference: by the
            nearest enclosing struct (or the named root), which supplies its
            own available byte count. */
            let _ = &buf;
            keys.insert(key);
        }
        Add(e) => bin(&e.left, &e.right, keys, buf),
        Sub(e) => bin(&e.left, &e.right, keys, buf),
        Mul(e) => bin(&e.left, &e.right, keys, buf),
        Div(e) => bin(&e.left, &e.right, keys, buf),
        Mod(e) => bin(&e.left, &e.right, keys, buf),
        Pow(e) => bin(&e.left, &e.right, keys, buf),
        BitAnd(e) => bin(&e.left, &e.right, keys, buf),
        BitOr(e) => bin(&e.left, &e.right, keys, buf),
        BitXor(e) => bin(&e.left, &e.right, keys, buf),
        LeftShift(e) => bin(&e.left, &e.right, keys, buf),
        RightShift(e) => bin(&e.left, &e.right, keys, buf),
        Eq(e) => bin(&e.left, &e.right, keys, buf),
        Ne(e) => bin(&e.left, &e.right, keys, buf),
        Lt(e) => bin(&e.left, &e.right, keys, buf),
        Gt(e) => bin(&e.left, &e.right, keys, buf),
        Le(e) => bin(&e.left, &e.right, keys, buf),
        Ge(e) => bin(&e.left, &e.right, keys, buf),
        And(e) => bin(&e.left, &e.right, keys, buf),
        Or(e) => bin(&e.left, &e.right, keys, buf),
        Xor(e) => bin(&e.left, &e.right, keys, buf),
        BitNot(e) => expr_refs(&e.operand, keys, buf),
        Neg(e) => expr_refs(&e.operand, keys, buf),
        Not(e) => expr_refs(&e.operand, keys, buf),
        Popcount(e) => expr_refs(&e.operand, keys, buf),
    }
}

fn bin(l: &ExprKind, r: &ExprKind, keys: &mut BTreeSet<String>, buf: &mut bool) {
    expr_refs(l, keys, buf);
    expr_refs(r, keys, buf);
}

fn is_literal_only(expr: &ExprKind) -> bool {
    let mut keys = BTreeSet::new();
    let mut buf = false;
    expr_refs(expr, &mut keys, &mut buf);
    keys.is_empty() && !buf
}

/// Allocates unique C member names inside one params struct.
struct NameAlloc(BTreeSet<String>);

impl NameAlloc {
    fn new() -> Self {
        let mut set = BTreeSet::new();
        set.insert("tn_unused".to_string());
        NameAlloc(set)
    }
    /// Allocator that avoids the names of existing `members`.
    fn with(members: &[Member]) -> Self {
        let mut a = Self::new();
        a.0.extend(members.iter().map(|m| m.name.clone()));
        a
    }
    fn take(&mut self, wanted: &str) -> String {
        let wanted = if wanted == BUFFER_SIZE_REF {
            "buffer_size"
        } else {
            wanted
        };
        let base = escape_c_keyword(&wanted.replace('.', "_"));
        let mut name = base.clone();
        let mut idx = 1;
        while !self.0.insert(name.clone()) {
            name = format!("{base}_{idx}");
            idx += 1;
        }
        name
    }
}

impl<'a> Model<'a> {
    pub fn new(resolver: &'a TypeResolver) -> Self {
        Model {
            resolver,
            nodes: Vec::new(),
            named: HashMap::new(),
            building: BTreeSet::new(),
        }
    }

    /// Builds every type the resolver knows, in its resolution order. A named
    /// struct's params gain the values any type of that set reads through it
    /// after variable-size data (see [`ViaRef`]), whatever package emits
    /// either type; building the whole set in one fixed order gives every
    /// package of a codegen run the same params layout for every type.
    pub fn build_all(&mut self) {
        for name in &self.resolver.resolution_order {
            self.named(name);
        }
    }

    pub fn node(&self, id: NodeId) -> &Node {
        &self.nodes[id]
    }

    pub fn named_id(&self, name: &str) -> Option<NodeId> {
        self.named.get(name).copied()
    }

    /// Every named type built so far: (ABI name, node).
    pub fn named_ids(&self) -> impl Iterator<Item = (&str, NodeId)> {
        self.named.iter().map(|(k, v)| (k.as_str(), *v))
    }

    /// A copy whose nodes' C prefixes are name tokens (see `names.rs`): the
    /// emitter then writes every file-scope name as a (node, suffix) key.
    pub fn tokenized(&self) -> Model<'a> {
        let mut nodes = self.nodes.clone();
        for (id, node) in nodes.iter_mut().enumerate() {
            node.c_name = super::names::token(id);
        }
        Model {
            resolver: self.resolver,
            nodes,
            named: self.named.clone(),
            building: BTreeSet::new(),
        }
    }

    /// Node for a named ABI type, building it on first use.
    pub fn named(&mut self, name: &str) -> NodeId {
        if let Some(id) = self.named.get(name) {
            return *id;
        }
        let ty = self
            .resolver
            .get_type_info(name)
            .unwrap_or_else(|| panic!("C codegen: unknown type '{name}'"))
            .clone();
        if !self.building.insert(name.to_string()) {
            panic!("C codegen: recursive type '{name}'");
        }
        let id = match &ty.kind {
            ResolvedTypeKind::TypeRef { target_name, .. } => {
                let target = self.named(target_name);
                let t = &self.nodes[target];
                let node = Node {
                    c_name: c_ident(name),
                    type_name: name.to_string(),
                    named: true,
                    kind: NodeKind::Alias { target },
                    const_size: t.const_size,
                    align: t.align,
                    ext: t.ext.clone(),
                    len_dep: t.len_dep,
                    trivial: t.trivial,
                    internal: Vec::new(),
                    via: Vec::new(),
                    members: Vec::new(),
                    is_field_slot: false,
                    unsupported: Vec::new(),
                    native: t.native,
                };
                self.push(node)
            }
            _ => self.build(&ty, c_ident(name), true, false),
        };
        self.building.remove(name);
        self.named.insert(name.to_string(), id);
        id
    }

    /// Index into `s.internal` of the count field when struct `s` gets a
    /// `<S>_set_<f>( self, src, n )` setter for the array in `slot`: fixed-size
    /// elements and a count that is a plain integer field of `s`.
    pub fn fam_count(&self, s: &Node, slot: &Slot) -> Option<usize> {
        let Slot::Node(id) = slot else {
            return None;
        };
        let NodeKind::Array {
            count,
            elem_size: Some(_),
            jagged: false,
            ..
        } = &self.nodes[self.resolve_alias(*id)].kind
        else {
            return None;
        };
        let ri = s.plain_ref(count)?;
        matches!(s.internal[ri].prim, PrimitiveType::Integral(_)).then_some(ri)
    }

    /// Whole-value setter a struct/union gets for the field in `slot`: nested
    /// structs (inline) and type-ref fields of any named type.
    pub fn value_setter(&self, slot: &Slot) -> Option<ValueSetter> {
        let Slot::Node(id) = slot else {
            return None;
        };
        let node = &self.nodes[*id];
        let real = &self.nodes[self.resolve_alias(*id)];
        if matches!(real.kind, NodeKind::Prim(_))
            || !(node.named || matches!(node.kind, NodeKind::Struct { .. }))
        {
            return None;
        }
        Some(match real.const_size {
            Some(size) => ValueSetter::Copy(size),
            None => ValueSetter::Bytes,
        })
    }

    /// Follows aliases to the node that owns the layout.
    pub fn resolve_alias(&self, mut id: NodeId) -> NodeId {
        while let NodeKind::Alias { target } = &self.nodes[id].kind {
            id = *target;
        }
        id
    }

    fn push(&mut self, node: Node) -> NodeId {
        self.nodes.push(node);
        self.nodes.len() - 1
    }

    fn slot(&mut self, ty: &ResolvedType, c_name: String, wrap_prim: bool, field: bool) -> Slot {
        match &ty.kind {
            ResolvedTypeKind::Primitive { prim_type } if !wrap_prim => {
                Slot::Prim(prim_type.clone())
            }
            ResolvedTypeKind::TypeRef { target_name, .. } => {
                let id = self.named(target_name);
                /* A type-ref to a primitive alias still reads as a primitive. */
                let real = self.resolve_alias(id);
                if let NodeKind::Prim(p) = &self.nodes[real].kind {
                    if !wrap_prim {
                        return Slot::Prim(p.clone());
                    }
                }
                Slot::Node(id)
            }
            _ => Slot::Node(self.build(ty, c_name, false, field)),
        }
    }

    fn build(&mut self, ty: &ResolvedType, c_name: String, named: bool, field: bool) -> NodeId {
        let const_size = match ty.size {
            Size::Const(s) => Some(s),
            Size::Variable(_) => None,
        };
        let mut unsupported = Vec::new();
        let kind = match &ty.kind {
            ResolvedTypeKind::Primitive { prim_type } => NodeKind::Prim(prim_type.clone()),
            ResolvedTypeKind::TypeRef { .. } => unreachable!("type-ref nodes are aliases"),
            ResolvedTypeKind::Struct { fields, packed, .. } => {
                let mut out = Vec::new();
                for f in fields {
                    let ident = c_ident(&f.name);
                    let slot = self.slot(&f.field_type, format!("{c_name}_{ident}"), false, true);
                    out.push(Field {
                        name: f.name.clone(),
                        ident,
                        slot,
                        const_offset: f.offset,
                        align: f.field_type.alignment.max(1),
                    });
                }
                NodeKind::Struct {
                    fields: out,
                    packed: *packed,
                }
            }
            ResolvedTypeKind::Union { variants } => {
                let mut out = Vec::new();
                for v in variants {
                    let ident = c_ident(&v.name);
                    let slot = self.slot(&v.field_type, format!("{c_name}_{ident}"), false, true);
                    out.push(Field {
                        name: v.name.clone(),
                        ident,
                        slot,
                        const_offset: Some(0),
                        align: v.field_type.alignment.max(1),
                    });
                }
                NodeKind::Union { variants: out }
            }
            ResolvedTypeKind::Enum {
                tag_expression,
                variants,
                ..
            } => {
                let mut out = Vec::new();
                for v in variants {
                    let ident = c_ident(&v.name);
                    let slot = self.slot(&v.variant_type, format!("{c_name}_{ident}"), true, false);
                    out.push(Variant {
                        name: v.name.clone(),
                        ident,
                        value: v.tag_value,
                        slot,
                    });
                }
                NodeKind::Enum {
                    tag: tag_expression.clone(),
                    variants: out,
                }
            }
            ResolvedTypeKind::SizeDiscriminatedUnion { variants } => {
                let mut out = Vec::new();
                for v in variants {
                    let ident = c_ident(&v.name);
                    let slot = self.slot(&v.variant_type, format!("{c_name}_{ident}"), true, false);
                    out.push(Variant {
                        name: v.name.clone(),
                        ident,
                        value: v.expected_size,
                        slot,
                    });
                }
                NodeKind::Sdu { variants: out }
            }
            ResolvedTypeKind::Array {
                element_type,
                size_expression,
                jagged,
                ..
            } => {
                let elem = self.slot(element_type, format!("{c_name}_elem"), false, false);
                let elem_size = match element_type.size {
                    Size::Const(s) => Some(s),
                    Size::Variable(_) => None,
                };
                /* Variable-size elements of a non-jagged array share one size
                when it follows from the values the array supplies (an inline
                enum selected by an outside tag): the stride is computed from
                params. Otherwise they are walked one by one. */
                let uniform = elem_size.is_none()
                    && !*jagged
                    && matches!(&elem, Slot::Node(e) if self.size_from_ext(*e));
                if elem_size.is_none() && !*jagged && !uniform {
                    unsupported.push("variable-size elements require a jagged array".into());
                }
                NodeKind::Array {
                    count: size_expression.clone(),
                    elem,
                    elem_size,
                    jagged: *jagged || (elem_size.is_none() && !uniform),
                }
            }
        };

        /* References to a nested struct's field that follows variable-size
        data are read by that struct's walker into its params. */
        if let NodeKind::Struct { fields, .. } = &kind {
            for (key, idx) in self.own_field_refs(fields) {
                if let Err(NavErr::Dynamic(_)) = self.navigate(fields, idx, &key) {
                    if let (Some((_, rest)), Slot::Node(child)) =
                        (key.split_once('.'), &fields[idx].slot)
                    {
                        /* Failures are reported by `derive`. */
                        let _ = self.ensure_export(*child, rest);
                    }
                }
            }
        }

        let mut node = Node {
            c_name,
            type_name: ty.name.clone(),
            named,
            kind,
            const_size,
            align: ty.alignment.max(1),
            ext: Vec::new(),
            len_dep: false,
            trivial: false,
            internal: Vec::new(),
            via: Vec::new(),
            members: Vec::new(),
            is_field_slot: field,
            unsupported,
            native: false,
        };
        self.derive(&mut node);
        self.push(node)
    }

    /// `(key, field index)` of every reference in the fields of a struct that
    /// names one of its earlier fields (the struct's own reads).
    fn own_field_refs(&self, fields: &[Field]) -> Vec<(String, usize)> {
        let mut out = Vec::new();
        for (k, f) in fields.iter().enumerate() {
            for key in self.slot_ext(&f.slot).0 {
                if key == BUFFER_SIZE_REF {
                    continue;
                }
                let (up, rest) = scope_split(&key);
                let first = rest.split('.').next().unwrap_or("");
                if up != 0 {
                    continue;
                }
                if let Some(idx) = fields[..k].iter().position(|g| g.name == first) {
                    if !out.iter().any(|(o, _)| *o == key) {
                        out.push((key, idx));
                    }
                }
            }
        }
        out
    }

    /// Member path inside `<id>_params_t` holding the value of `key` (a
    /// path from one of struct `id`'s fields), if the walker reads it.
    fn export_member(&self, id: NodeId, key: &str) -> Option<String> {
        let n = &self.nodes[self.resolve_alias(id)];
        n.members
            .iter()
            .find_map(|m| match &m.kind {
                MemberKind::Internal(i) if n.internal[*i].key == key => Some(m.name.clone()),
                _ => None,
            })
            .or_else(|| {
                n.via
                    .iter()
                    .find(|v| v.key == key)
                    .map(|v| v.member.clone())
            })
    }

    /// Makes the walker of struct `id` read the primitive at `key` (a path
    /// from one of its fields) into its params, for an enclosing struct that
    /// cannot locate it at a constant offset. Recurses through nested structs
    /// whose offset is itself only known at run time. A named type from
    /// another package is changed the same way: its package's model builds
    /// the same type set (see [`Model::build_all`]), so it emits the member.
    fn ensure_export(&mut self, id: NodeId, key: &str) -> Result<(), String> {
        let id = self.resolve_alias(id);
        if self.export_member(id, key).is_some() {
            return Ok(());
        }
        let node = &self.nodes[id];
        let NodeKind::Struct { fields, .. } = &node.kind else {
            return Err(format!("field reference '{key}': not a struct field"));
        };
        let first = key.split('.').next().unwrap_or("");
        let idx = fields
            .iter()
            .position(|f| f.name == first)
            .ok_or_else(|| format!("field reference '{key}': no field '{first}'"))?;
        let mut alloc = NameAlloc::with(&node.members);
        match self.navigate(fields, idx, key) {
            Ok((sub_offset, prim)) => {
                let node = &mut self.nodes[id];
                node.internal.push(InternalRef {
                    key: key.to_string(),
                    field: idx,
                    sub_offset,
                    prim,
                    exported: true,
                });
                node.members.push(Member {
                    name: alloc.take(key),
                    kind: MemberKind::Internal(node.internal.len() - 1),
                });
                Ok(())
            }
            Err(NavErr::Dynamic(seg)) => {
                let (Slot::Node(child), Some((_, rest))) =
                    (fields[idx].slot.clone(), key.split_once('.'))
                else {
                    return Err(NavErr::Dynamic(seg).message(key));
                };
                let ident = fields[idx].ident.clone();
                self.ensure_export(child, rest)?;
                let path = self
                    .export_member(child, rest)
                    .ok_or_else(|| NavErr::Dynamic(seg).message(key))?;
                let node = &mut self.nodes[id];
                let cm = match node.child_member(&ident) {
                    Some(m) => m.to_string(),
                    None => {
                        let name = alloc.take(&ident);
                        node.members.push(Member {
                            name: name.clone(),
                            kind: MemberKind::Child {
                                slot: ident,
                                node: child,
                            },
                        });
                        name
                    }
                };
                node.via.push(ViaRef {
                    key: key.to_string(),
                    field: idx,
                    member: format!("{cm}.{path}"),
                });
                Ok(())
            }
            Err(e) => Err(e.message(key)),
        }
    }

    fn slot_ext(&self, slot: &Slot) -> (Vec<String>, bool) {
        match slot {
            Slot::Prim(_) => (Vec::new(), false),
            Slot::Node(id) => {
                let n = &self.nodes[*id];
                (n.ext.clone(), n.len_dep)
            }
        }
    }

    pub fn slot_trivial(&self, slot: &Slot) -> bool {
        match slot {
            Slot::Prim(_) => true,
            Slot::Node(id) => self.nodes[*id].trivial,
        }
    }

    pub fn slot_size(&self, slot: &Slot) -> Option<u64> {
        match slot {
            Slot::Prim(p) => Some(prim_size(p)),
            Slot::Node(id) => self.nodes[*id].const_size,
        }
    }

    fn derive(&self, node: &mut Node) {
        let mut needed: BTreeSet<String> = BTreeSet::new();
        let mut len_dep = false;
        let mut alloc = NameAlloc::new();
        let mut members = Vec::new();

        match &node.kind {
            NodeKind::Prim(_) => {
                node.trivial = true;
                node.native = true;
            }
            NodeKind::Alias { .. } => {}
            NodeKind::Struct { fields, .. } => {
                /* Resolve references the way `TypeResolver` does: this struct
                is the innermost scope of its fields' references. A key with
                leading `..` skips it; otherwise it names one of the fields
                before the referencing one, or falls through to the enclosing
                scopes. Either way the parent sees it with one `..` fewer. */
                let mut ext: BTreeSet<String> = BTreeSet::new();
                let mut vias: Vec<(String, usize, String)> = Vec::new();
                for (k, f) in fields.iter().enumerate() {
                    let (keys, ld) = self.slot_ext(&f.slot);
                    len_dep |= ld;
                    for key in keys {
                        if key == BUFFER_SIZE_REF {
                            len_dep = true;
                            continue;
                        }
                        let (up, rest) = scope_split(&key);
                        let first = rest.split('.').next().unwrap_or("");
                        let pos = (up == 0)
                            .then(|| fields[..k].iter().position(|g| g.name == first))
                            .flatten();
                        let Some(idx) = pos else {
                            ext.insert(outer_key(&key).to_string());
                            continue;
                        };
                        if node.internal.iter().any(|r| r.key == key)
                            || vias.iter().any(|(v, _, _)| *v == key)
                        {
                            continue;
                        }
                        match self.navigate(fields, idx, &key) {
                            Ok((sub_offset, prim)) => node.internal.push(InternalRef {
                                key,
                                field: idx,
                                sub_offset,
                                prim,
                                exported: false,
                            }),
                            /* Read by the nested struct (see `ensure_export`). */
                            Err(NavErr::Dynamic(seg)) => {
                                let path = match (&fields[idx].slot, key.split_once('.')) {
                                    (Slot::Node(c), Some((_, rest))) => {
                                        self.export_member(*c, rest)
                                    }
                                    _ => None,
                                };
                                match path {
                                    Some(p) => vias.push((key, idx, p)),
                                    None => {
                                        node.unsupported.push(NavErr::Dynamic(seg).message(&key))
                                    }
                                }
                            }
                            Err(e) => node.unsupported.push(e.message(&key)),
                        }
                    }
                }
                node.internal.sort_by(|a, b| a.key.cmp(&b.key));
                node.via = vias
                    .into_iter()
                    .map(|(key, field, member)| ViaRef { key, field, member })
                    .collect();
                node.ext = ext.into_iter().collect();
                node.trivial = node.const_size.is_some()
                    && !len_dep
                    && node.ext.is_empty()
                    && fields.iter().all(|f| self.slot_trivial(&f.slot));
            }
            NodeKind::Union { variants } => {
                for f in variants {
                    let (ext, ld) = self.slot_ext(&f.slot);
                    needed.extend(ext);
                    len_dep |= ld;
                }
                node.ext = needed.iter().cloned().collect();
                /* Constant-size variants can still hold values to check (enum
                tags): the union is trivial only when every variant is. */
                node.trivial = node.const_size.is_some()
                    && !len_dep
                    && node.ext.is_empty()
                    && variants.iter().all(|f| self.slot_trivial(&f.slot));
            }
            NodeKind::Enum { tag, variants } => {
                expr_refs(tag, &mut needed, &mut len_dep);
                for v in variants {
                    let (ext, ld) = self.slot_ext(&v.slot);
                    needed.extend(ext);
                    len_dep |= ld;
                }
                node.ext = needed.iter().cloned().collect();
            }
            NodeKind::Sdu { variants } => {
                len_dep = true;
                for v in variants {
                    let (ext, _) = self.slot_ext(&v.slot);
                    needed.extend(ext);
                }
                node.ext = needed.iter().cloned().collect();
            }
            NodeKind::Array {
                count,
                elem,
                jagged,
                ..
            } => {
                expr_refs(count, &mut needed, &mut len_dep);
                let (ext, ld) = self.slot_ext(elem);
                needed.extend(ext);
                len_dep |= ld;
                node.ext = needed.iter().cloned().collect();
                node.trivial = node.const_size.is_some()
                    && !len_dep
                    && node.ext.is_empty()
                    && !*jagged
                    && is_literal_only(count)
                    && self.slot_trivial(elem);
            }
        }
        /* A named root answers `__buffer_size` with its own byte count. */
        if node.named {
            if let Some(pos) = node.ext.iter().position(|k| k == BUFFER_SIZE_REF) {
                node.ext.remove(pos);
                len_dep = true;
            }
        }
        node.len_dep = len_dep;

        if len_dep {
            members.push(Member {
                name: alloc.take("buf_sz"),
                kind: MemberKind::BufSz,
            });
        }
        for key in &node.ext {
            /* Values from enclosing scopes are `parent_<path>`, so they never
            read as a same-named field of this node. */
            let (mut up, rest) = scope_split(key);
            if let NodeKind::Struct { fields, .. } = &node.kind {
                let first = rest.split('.').next().unwrap_or("");
                if up > 0 || fields.iter().any(|f| f.name == first) {
                    up += 1;
                }
            }
            members.push(Member {
                name: alloc.take(&format!("{}{rest}", "parent_".repeat(up))),
                kind: MemberKind::Ext(key.clone()),
            });
        }
        for (idx, r) in node.internal.iter().enumerate() {
            members.push(Member {
                name: alloc.take(&r.key),
                kind: MemberKind::Internal(idx),
            });
        }
        let embed = |slot: &Slot, name: &str, alloc: &mut NameAlloc, members: &mut Vec<Member>| {
            if let Slot::Node(id) = slot {
                let child = &self.nodes[*id];
                if !child.trivial && !self.params_members(*id).is_empty() {
                    members.push(Member {
                        name: alloc.take(name),
                        kind: MemberKind::Child {
                            slot: name.to_string(),
                            node: *id,
                        },
                    });
                }
            }
        };
        match &node.kind {
            NodeKind::Struct { fields, .. } => {
                for f in fields {
                    embed(&f.slot, &f.ident, &mut alloc, &mut members);
                }
            }
            NodeKind::Enum { variants, .. } | NodeKind::Sdu { variants } => {
                for v in variants {
                    embed(&v.slot, &v.ident, &mut alloc, &mut members);
                }
            }
            /* A union spans its largest variant, so sizing it from params
            needs the inputs of every variable-size variant (`sized.len`).
            Constant-size variants contribute their size alone. */
            NodeKind::Union { variants } => {
                for f in variants {
                    if self.slot_size(&f.slot).is_none() {
                        embed(&f.slot, &f.ident, &mut alloc, &mut members);
                    }
                }
            }
            NodeKind::Array { jagged: true, .. } => members.push(Member {
                name: alloc.take("tn_bytes"),
                kind: MemberKind::JaggedBytes,
            }),
            _ => {}
        }
        node.members = members;
        /* Values read through a nested struct live in its embedded params. */
        let mut vias = std::mem::take(&mut node.via);
        let mut missing = Vec::new();
        if let NodeKind::Struct { fields, .. } = &node.kind {
            vias.retain_mut(|v| match node.child_member(&fields[v.field].ident) {
                Some(cm) => {
                    v.member = format!("{cm}.{}", v.member);
                    true
                }
                None => {
                    missing.push(format!(
                        "field reference '{}': no params for '{}'",
                        v.key, fields[v.field].name
                    ));
                    false
                }
            });
        }
        node.unsupported.extend(missing);
        node.via = vias;
        node.native = self.compute_native(node);
    }

    /// Whether the size of node `id` follows from the values its parent
    /// supplies alone: no field of its own, buffer length or jagged byte
    /// total sizes it, at any depth.
    pub fn size_from_ext(&self, id: NodeId) -> bool {
        let n = &self.nodes[self.resolve_alias(id)];
        n.unsupported.is_empty()
            && !n.len_dep
            && n.members.iter().all(|m| match &m.kind {
                MemberKind::Ext(_) => true,
                /* Read for an enclosing struct only: never sizes `n`. */
                MemberKind::Internal(i) => n.internal[*i].exported,
                MemberKind::Child { node, .. } => self.size_from_ext(*node),
                _ => false,
            })
    }

    /// Params members of a node, following aliases.
    pub fn params_members(&self, id: NodeId) -> &[Member] {
        &self.nodes[self.resolve_alias(id)].members
    }

    /// Byte offset and primitive type of `key` inside field `idx` of a struct
    /// with `fields`.
    fn navigate(
        &self,
        fields: &[Field],
        idx: usize,
        key: &str,
    ) -> Result<(u64, PrimitiveType), NavErr> {
        let mut slot = fields[idx].slot.clone();
        let mut off = 0u64;
        for seg in key.split('.').skip(1) {
            let descend = || {
                NavErr::Other(format!(
                    "field reference '{key}': cannot descend into '{seg}'"
                ))
            };
            let Slot::Node(id) = slot else {
                return Err(descend());
            };
            let step = match &self.nodes[self.resolve_alias(id)].kind {
                NodeKind::Struct { fields, .. } => {
                    let f = fields.iter().find(|f| f.name == seg).ok_or_else(|| {
                        NavErr::Other(format!("field reference '{key}': no field '{seg}'"))
                    })?;
                    let o = f
                        .const_offset
                        .ok_or_else(|| NavErr::Dynamic(seg.to_string()))?;
                    slot = f.slot.clone();
                    Some(o)
                }
                NodeKind::Array {
                    elem, elem_size, ..
                } => {
                    let i: u64 = seg.parse().map_err(|_| {
                        NavErr::Other(format!("field reference '{key}': '{seg}' is not an index"))
                    })?;
                    let Some(es) = elem_size else {
                        return Err(NavErr::Other(format!(
                            "field reference '{key}': variable-size elements"
                        )));
                    };
                    let o = i.checked_mul(*es);
                    slot = elem.clone();
                    o
                }
                _ => return Err(descend()),
            };
            off = step.and_then(|o| off.checked_add(o)).ok_or_else(|| {
                NavErr::Other(format!("field reference '{key}': offset overflows"))
            })?;
        }
        match slot {
            Slot::Prim(p) => Ok((off, p)),
            Slot::Node(id) => match &self.nodes[self.resolve_alias(id)].kind {
                NodeKind::Prim(p) => Ok((off, p.clone())),
                _ => Err(NavErr::Other(format!(
                    "field reference '{key}' does not name a primitive"
                ))),
            },
        }
    }

    /// Whether a native C struct/union with the ABI layout can be emitted.
    fn compute_native(&self, node: &Node) -> bool {
        let Some(size) = node.const_size else {
            return false;
        };
        let slot_native = |slot: &Slot| match slot {
            Slot::Prim(_) => true,
            Slot::Node(id) => {
                let n = &self.nodes[self.resolve_alias(*id)];
                n.native && matches!(n.kind, NodeKind::Struct { .. } | NodeKind::Array { .. })
            }
        };
        match &node.kind {
            NodeKind::Struct { fields, packed } => {
                if !fields.iter().all(|f| slot_native(&f.slot)) {
                    return false;
                }
                /* Recompute the C layout and compare it with the ABI layout. */
                let mut cur = 0u64;
                let mut natural = 1u64;
                for f in fields {
                    let fsize = self.slot_size(&f.slot).unwrap_or(0);
                    let falign = if *packed { 1 } else { self.c_align(&f.slot) };
                    cur = cur.div_ceil(falign) * falign;
                    if f.const_offset != Some(cur) {
                        return false;
                    }
                    cur += fsize;
                    natural = natural.max(falign);
                }
                /* An aligned(N) attribute can raise but never lower C alignment. */
                if node.align < natural {
                    return false;
                }
                cur.div_ceil(node.align) * node.align == size
            }
            NodeKind::Array {
                elem, elem_size, ..
            } => {
                slot_native(elem)
                    && elem_size.is_some_and(|es| es > 0 && size % es == 0)
                    && self
                        .slot_size(elem)
                        .is_some_and(|es| es % self.c_align(elem) == 0)
            }
            _ => false,
        }
    }

    /// Natural C alignment of a native slot.
    pub fn c_align(&self, slot: &Slot) -> u64 {
        match slot {
            Slot::Prim(p) => prim_size(p),
            Slot::Node(id) => {
                let n = &self.nodes[self.resolve_alias(*id)];
                match &n.kind {
                    NodeKind::Struct { .. } => self.struct_natural_align(n).max(n.align),
                    NodeKind::Array { elem, .. } => self.c_align(elem),
                    _ => 1,
                }
            }
        }
    }

    /// C alignment of a struct's members without any aligned(N) attribute.
    pub fn struct_natural_align(&self, n: &Node) -> u64 {
        match &n.kind {
            NodeKind::Struct { fields, packed } if !*packed => fields
                .iter()
                .map(|f| self.c_align(&f.slot))
                .max()
                .unwrap_or(1),
            _ => 1,
        }
    }

    /// All nodes reachable from `id` without crossing into other named types,
    /// parents before children, in declaration order.
    pub fn inline_preorder(&self, id: NodeId, out: &mut Vec<NodeId>) {
        out.push(id);
        let visit = |slot: &Slot, out: &mut Vec<NodeId>| {
            if let Slot::Node(c) = slot {
                if !self.nodes[*c].named {
                    self.inline_preorder(*c, out);
                }
            }
        };
        match &self.nodes[id].kind {
            NodeKind::Struct { fields, .. } => fields.iter().for_each(|f| visit(&f.slot, out)),
            NodeKind::Union { variants } => variants.iter().for_each(|f| visit(&f.slot, out)),
            NodeKind::Enum { variants, .. } | NodeKind::Sdu { variants } => {
                variants.iter().for_each(|v| visit(&v.slot, out))
            }
            NodeKind::Array { elem, .. } => visit(elem, out),
            NodeKind::Prim(_) | NodeKind::Alias { .. } => {}
        }
    }

    /// All nodes reachable from `id` without crossing into other named types,
    /// children before parents.
    pub fn inline_postorder(&self, id: NodeId, out: &mut Vec<NodeId>) {
        let visit = |slot: &Slot, out: &mut Vec<NodeId>| {
            if let Slot::Node(c) = slot {
                if !self.nodes[*c].named {
                    self.inline_postorder(*c, out);
                }
            }
        };
        match &self.nodes[id].kind {
            NodeKind::Struct { fields, .. } => fields.iter().for_each(|f| visit(&f.slot, out)),
            NodeKind::Union { variants } => variants.iter().for_each(|f| visit(&f.slot, out)),
            NodeKind::Enum { variants, .. } | NodeKind::Sdu { variants } => {
                variants.iter().for_each(|v| visit(&v.slot, out))
            }
            NodeKind::Array { elem, .. } => visit(elem, out),
            NodeKind::Prim(_) | NodeKind::Alias { .. } => {}
        }
        out.push(id);
    }
}
