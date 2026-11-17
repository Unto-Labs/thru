//! C emitter driven by the layout [`Model`].
//!
//! Every node gets:
//! * a type (`<N>_t`): a native struct when C can describe the ABI layout,
//!   otherwise raw bytes or an incomplete type;
//! * a params struct (`<N>_params_t`) carrying the values its layout depends on;
//! * a layout walker (`<N>_tn_walk`) that runs in TRUST, VALIDATE or PARAMS
//!   mode, so accessors, validation and footprint-from-params share one
//!   sequential layout with checked arithmetic;
//! * accessors on `<N>_t` pointers.
//!
//! Named types additionally get `validate`, `from_slice`, `params_from_buffer`,
//! `footprint_from_params`, `footprint` and `size`.

use super::model::{
    BUFFER_SIZE_REF, Field, MemberKind, Model, Node, NodeId, NodeKind, Slot, ValueSetter, Variant,
    prim_c_type, prim_size, ref_key,
};
use crate::abi::expr::{ExprKind, LiteralExpr};
use crate::abi::resolved::Size;
use crate::abi::types::{FloatingPointType, IntegralType, PrimitiveType};
use std::fmt::Write;

pub struct Emitter<'m, 'a> {
    pub(super) m: &'m Model<'a>,
    /// Header: type definitions, params structs and constants.
    pub types: String,
    /// Header: prototypes of public functions.
    pub protos: String,
    /// Source: prototypes of static helpers.
    pub static_protos: String,
    /// Source: function definitions.
    pub defs: String,
    /// Source: layout static assertions for native types.
    pub asserts: String,
    /// Public function names already emitted (collisions are skipped).
    names: std::collections::BTreeSet<String>,
}

const MODE_TRUST: &str = "TN_ABI_MODE_TRUST";
const MODE_VALIDATE: &str = "TN_ABI_MODE_VALIDATE";
const MODE_PARAMS: &str = "TN_ABI_MODE_PARAMS";
const MODE_MEASURE: &str = "TN_ABI_MODE_MEASURE";
const MODE_INIT: &str = "TN_ABI_MODE_INIT";

fn ld_fn(prim: &PrimitiveType) -> &'static str {
    match prim {
        PrimitiveType::Integral(i) => match i {
            IntegralType::U8 | IntegralType::Char => "tn_abi_ld_u8",
            IntegralType::U16 => "tn_abi_ld_u16",
            IntegralType::U32 => "tn_abi_ld_u32",
            IntegralType::U64 => "tn_abi_ld_u64",
            IntegralType::I8 => "tn_abi_ld_i8",
            IntegralType::I16 => "tn_abi_ld_i16",
            IntegralType::I32 => "tn_abi_ld_i32",
            IntegralType::I64 => "tn_abi_ld_i64",
        },
        /* Floating point values are read as their raw bits. */
        PrimitiveType::FloatingPoint(f) => match f {
            FloatingPointType::F16 => "tn_abi_ld_u16",
            FloatingPointType::F32 => "tn_abi_ld_u32",
            FloatingPointType::F64 => "tn_abi_ld_u64",
        },
    }
}

/// Little-endian store of the low bytes of a `uint64_t` into a primitive slot.
pub(super) fn st_fn(prim: &PrimitiveType) -> &'static str {
    match prim_size(prim) {
        1 => "tn_abi_st_u8",
        2 => "tn_abi_st_u16",
        4 => "tn_abi_st_u32",
        _ => "tn_abi_st_u64",
    }
}

fn literal_u64(lit: &LiteralExpr) -> u64 {
    match lit {
        LiteralExpr::U64(v) => *v,
        LiteralExpr::U32(v) => *v as u64,
        LiteralExpr::U16(v) => *v as u64,
        LiteralExpr::U8(v) => *v as u64,
        LiteralExpr::I64(v) => *v as u64,
        LiteralExpr::I32(v) => *v as i64 as u64,
        LiteralExpr::I16(v) => *v as i64 as u64,
        LiteralExpr::I8(v) => *v as i64 as u64,
    }
}

impl<'m, 'a> Emitter<'m, 'a> {
    pub fn new(m: &'m Model<'a>) -> Self {
        Emitter {
            m,
            types: String::new(),
            protos: String::new(),
            static_protos: String::new(),
            defs: String::new(),
            asserts: String::new(),
            names: std::collections::BTreeSet::new(),
        }
    }

    pub(super) fn n(&self, id: NodeId) -> &'m Node {
        &self.m.nodes[id]
    }

    /// Node whose functions implement `id` (aliases forward to their target).
    pub(super) fn r(&self, id: NodeId) -> &'m Node {
        &self.m.nodes[self.m.resolve_alias(id)]
    }

    /* ---------- signature fragments ---------- */

    /// `, X_params_t const * params` when accessors of `n` need params.
    fn pdecl(n: &Node) -> String {
        if n.needs_params() {
            format!(", {}_params_t const * params", n.c_name)
        } else {
            String::new()
        }
    }

    fn parg(n: &Node) -> &'static str {
        if n.needs_params() { ", params" } else { "" }
    }

    /// `, C_params_t * opt_params` for accessors returning a view of `child`.
    fn outdecl(&self, child: NodeId) -> String {
        let c = self.r(child);
        if c.needs_params() {
            format!(", {}_params_t * opt_params", c.c_name)
        } else {
            String::new()
        }
    }

    fn outarg(&self, child: NodeId, expr: &str) -> String {
        if self.r(child).needs_params() {
            format!(", {expr}")
        } else {
            String::new()
        }
    }

    fn slot_ctype(&self, slot: &Slot) -> String {
        match slot {
            Slot::Prim(p) => prim_c_type(p).to_string(),
            Slot::Node(id) => format!("{}_t", self.r(*id).c_name),
        }
    }

    /* ---------- function plumbing ---------- */

    fn fn_name(sig: &str) -> String {
        let head = &sig[..sig.find('(').unwrap_or(sig.len())];
        head.trim_end()
            /* Name tokens (`names.rs`) are part of the name. */
            .rsplit(|c: char| {
                !(c.is_ascii_alphanumeric() || c == '_' || c == '\u{1}' || c == '\u{2}')
            })
            .next()
            .unwrap_or("")
            .to_string()
    }

    /// Claims a public symbol name; false when it is already taken.
    pub(super) fn reserve(&mut self, name: &str) -> bool {
        self.names.insert(name.to_string())
    }

    pub(super) fn public_fn(&mut self, sig: &str, body: &str) {
        let name = Self::fn_name(sig);
        if !self.names.insert(name.clone()) {
            /* A convenience wrapper would shadow another accessor; keep the first. */
            writeln!(
                self.defs,
                "/* {name}: name already used, wrapper omitted */\n"
            )
            .unwrap();
            return;
        }
        writeln!(self.protos, "{sig};").unwrap();
        writeln!(self.defs, "{sig} {{\n{body}}}\n").unwrap();
    }

    pub(super) fn static_fn(&mut self, sig: &str, body: &str) {
        self.names.insert(Self::fn_name(sig));
        let sig = format!("TN_ABI_STATIC {sig}");
        writeln!(self.static_protos, "{sig};").unwrap();
        writeln!(self.defs, "{sig} {{\n{body}}}\n").unwrap();
    }

    /// Node helper: public for named types (other packages call it), static otherwise.
    fn helper_fn(&mut self, n: &Node, sig: &str, body: &str) {
        if n.named {
            self.public_fn(sig, body);
        } else {
            self.static_fn(sig, body);
        }
    }

    fn walk_fn(&mut self, n: &Node, body: &str) {
        let sig = format!(
            "int {c}_tn_walk( uint8_t const * data, uint64_t len, {c}_params_t * p, int mode, uint64_t * out_sz )",
            c = n.c_name
        );
        if n.named {
            self.public_fn(&sig, body);
        } else {
            self.static_fn(&sig, body);
        }
    }

    /* ---------- entry ---------- */

    /// Emit a named type and every inline node nested in it.
    pub fn emit_named(&mut self, id: NodeId) {
        let mut order = Vec::new();
        self.m.inline_postorder(id, &mut order);
        writeln!(
            self.types,
            "/* ----- TYPE DEFINITIONS FOR {} ----- */\n",
            self.n(id).type_name
        )
        .unwrap();
        writeln!(
            self.defs,
            "/* ----- FUNCTIONS FOR {} ----- */\n",
            self.n(id).type_name
        )
        .unwrap();
        for nid in order {
            self.emit_node(nid);
        }
    }

    fn emit_node(&mut self, id: NodeId) {
        let n = self.n(id);
        if let NodeKind::Alias { target } = &n.kind {
            let t = self.n(*target).c_name.clone();
            writeln!(
                self.types,
                "typedef {t}_t {c}_t;\ntypedef {t}_params_t {c}_params_t;\n",
                c = n.c_name
            )
            .unwrap();
            self.walk_fn(
                n,
                &format!("  return {t}_tn_walk( data, len, p, mode, out_sz );\n"),
            );
            self.emit_entry_points(id);
            return;
        }
        self.emit_type_def(id);
        self.emit_params_struct(id);
        match &n.kind {
            NodeKind::Prim(p) => self.emit_prim(id, p),
            NodeKind::Struct { fields, packed } => self.emit_struct(id, fields, *packed),
            NodeKind::Union { variants } => self.emit_union(id, variants),
            NodeKind::Enum { tag, variants } => self.emit_enum(id, tag, variants),
            NodeKind::Sdu { variants } => self.emit_sdu(id, variants),
            NodeKind::Array {
                count,
                elem,
                elem_size,
                jagged,
            } => self.emit_array(id, count, elem, *elem_size, *jagged),
            NodeKind::Alias { .. } => unreachable!(),
        }
        let size_sig = format!(
            "uint64_t {c}_size( {c}_t const * self{pd} )",
            c = n.c_name,
            pd = Self::pdecl(n)
        );
        let body = format!(
            "{init}  uint64_t sz = 0UL;\n  if( !self || {c}_tn_walk( (uint8_t const *)self, UINT64_MAX, &tn_p, {MODE_TRUST}, &sz ) ) return UINT64_MAX;\n  return sz;\n",
            init = self.params_init(n),
            c = n.c_name
        );
        self.public_fn(&size_sig, &body);
        if n.named {
            self.emit_entry_points(id);
        }
    }

    /// Declares `tn_p` (copy of `params` when the node takes params).
    fn params_init(&self, n: &Node) -> String {
        let mut s = format!(
            "  {c}_params_t tn_p;\n  memset( &tn_p, 0, sizeof tn_p );\n",
            c = n.c_name
        );
        if n.needs_params() {
            s.push_str("  if( params ) tn_p = *params;\n");
        }
        s
    }

    /* ---------- types ---------- */

    fn emit_type_def(&mut self, id: NodeId) {
        let n = self.n(id);
        let c = &n.c_name;
        let mut out = String::new();
        if let Some(comment) = self
            .m
            .resolver
            .get_type_info(&n.type_name)
            .and_then(|t| t.comment.as_ref())
            .filter(|_| n.named)
        {
            writeln!(out, "/* {comment} */").unwrap();
        }
        match &n.kind {
            NodeKind::Struct { fields, packed } if n.native && !fields.is_empty() => {
                let natural = self.m.struct_natural_align(n);
                let mut attrs = Vec::new();
                if *packed {
                    attrs.push("packed".to_string());
                }
                if n.align > natural {
                    attrs.push(format!("aligned({})", n.align));
                }
                let attr = if attrs.is_empty() {
                    String::new()
                } else {
                    format!("__attribute__(({})) ", attrs.join(", "))
                };
                writeln!(out, "struct {attr}{c} {{").unwrap();
                for f in fields {
                    writeln!(out, "  {} {};", self.slot_ctype(&f.slot), f.ident).unwrap();
                }
                writeln!(out, "}};").unwrap();
                writeln!(out, "typedef struct {c} {c}_t;\n").unwrap();
                let size = n.const_size.unwrap();
                writeln!(
                    self.asserts,
                    "_Static_assert( sizeof( {c}_t )=={size}UL, \"{c} size\" );"
                )
                .unwrap();
                for f in fields {
                    writeln!(
                        self.asserts,
                        "_Static_assert( offsetof( {c}_t, {i} )=={o}UL, \"{c}.{i} offset\" );",
                        i = f.ident,
                        o = f.const_offset.unwrap()
                    )
                    .unwrap();
                }
            }
            NodeKind::Array {
                elem, elem_size, ..
            } => match (n.const_size, elem_size) {
                (Some(size), Some(es)) if size > 0 && n.native => {
                    writeln!(
                        out,
                        "typedef {} {c}_t[{}];\n",
                        self.slot_ctype(elem),
                        size / es
                    )
                    .unwrap();
                    writeln!(
                        self.asserts,
                        "_Static_assert( sizeof( {c}_t )=={size}UL, \"{c} size\" );"
                    )
                    .unwrap();
                }
                (Some(size), Some(es)) if size > 0 && *es > 0 => {
                    writeln!(
                            out,
                            "/* Byte rows preserve the ABI element stride; use the accessors to decode elements. */\ntypedef uint8_t {c}_t[{}][{es}];\n",
                            size / es
                        )
                        .unwrap();
                }
                _ => {
                    writeln!(
                            out,
                            "/* Runtime-sized byte view: element offsets need runtime layout information. */\ntypedef uint8_t {c}_t[];\n"
                        )
                        .unwrap();
                }
            },
            _ => match n.const_size {
                Some(size) if size > 0 => {
                    writeln!(
                        out,
                        "/* Opaque {size}-byte value; use the accessors below. */\nstruct {c} {{\n  uint8_t tn_raw[{size}];\n}};\ntypedef struct {c} {c}_t;\n"
                    )
                    .unwrap();
                }
                _ => {
                    writeln!(
                        out,
                        "/* Variable-size (or empty) value; use the accessors below. */\nstruct {c};\ntypedef struct {c} {c}_t;\n"
                    )
                    .unwrap();
                }
            },
        }
        self.types.push_str(&out);
    }

    fn emit_params_struct(&mut self, id: NodeId) {
        let n = self.n(id);
        let c = &n.c_name;
        let mut out = if n.named {
            format!(
                "/* Layout inputs of {c}: values its size depends on (see {c}_params_from_buffer / {c}_footprint_from_params). */\nstruct {c}_params {{\n"
            )
        } else {
            format!(
                "/* Layout inputs of {c}: values its size depends on (returned by the accessor that yields a {c}_t view). */\nstruct {c}_params {{\n"
            )
        };
        for m in &n.members {
            match &m.kind {
                MemberKind::BufSz => writeln!(
                    out,
                    "  uint64_t {}; /* bytes available to the value */",
                    m.name
                )
                .unwrap(),
                MemberKind::Ext(k) => {
                    writeln!(out, "  uint64_t {}; /* from enclosing type: {k} */", m.name).unwrap()
                }
                MemberKind::Internal(i) => writeln!(
                    out,
                    "  uint64_t {}; /* field {} */",
                    m.name, n.internal[*i].key
                )
                .unwrap(),
                MemberKind::Child { node, .. } => {
                    writeln!(out, "  {}_params_t {};", self.r(*node).c_name, m.name).unwrap()
                }
                MemberKind::JaggedBytes => writeln!(
                    out,
                    "  uint64_t {}; /* total bytes of the jagged array */",
                    m.name
                )
                .unwrap(),
            }
        }
        if n.members.is_empty() {
            out.push_str("  uint8_t tn_unused;\n");
        }
        writeln!(out, "}};\ntypedef struct {c}_params {c}_params_t;\n").unwrap();
        self.types.push_str(&out);
    }

    /* ---------- shared walking pieces ---------- */

    /// Emit `<fn_name>( P_params_t const * p, uint64_t off, C_params_t * out )`
    /// copying `child`'s inputs out of `parent`'s params.
    fn emit_prep(&mut self, parent: NodeId, fn_name: &str, child: NodeId) {
        let p = self.n(parent);
        let c = self.r(child);
        let mut body = String::from("  (void)p; (void)off; (void)out;\n");
        for m in &c.members {
            match &m.kind {
                MemberKind::Ext(key) => match p.member_for_key(key).or_else(|| {
                    (key == BUFFER_SIZE_REF)
                        .then(|| p.has_member(&MemberKind::BufSz))
                        .flatten()
                }) {
                    Some(src) => writeln!(body, "  out->{} = p->{};", m.name, src).unwrap(),
                    None => writeln!(
                        body,
                        "  return TN_ABI_ERR_UNSUPPORTED; /* unresolved {key} */"
                    )
                    .unwrap(),
                },
                MemberKind::BufSz => {
                    let src = p.has_member(&MemberKind::BufSz).unwrap_or("buf_sz");
                    writeln!(
                        body,
                        "  if( tn_checked_sub_u64( p->{src}, off, &out->{} ) ) return TN_ABI_ERR_SHORT_BUFFER;",
                        m.name
                    )
                    .unwrap()
                }
                _ => {}
            }
        }
        body.push_str("  return TN_ABI_OK;\n");
        let sig = format!(
            "int {fn_name}( {}_params_t const * p, uint64_t off, {}_params_t * out )",
            p.c_name, c.c_name
        );
        self.static_fn(&sig, &body);
    }

    fn needs_prep(&self, slot: &Slot) -> Option<NodeId> {
        match slot {
            Slot::Node(id) if self.r(*id).needs_params() && !self.n(*id).trivial => Some(*id),
            _ => None,
        }
    }

    /// Code computing `sz` for a slot starting at `cur` inside the walker of
    /// `parent`. `storage` is the embedded params member (if any).
    fn slot_walk(
        &self,
        parent: &Node,
        slot: &Slot,
        slot_ident: &str,
        prep_fn: &str,
        cur: &str,
    ) -> String {
        match slot {
            Slot::Prim(p) => format!("    sz = {}UL;\n", prim_size(p)),
            Slot::Node(id) if self.n(*id).trivial => {
                format!("    sz = {}UL;\n", self.n(*id).const_size.unwrap())
            }
            Slot::Node(id) => {
                let c = self.r(*id);
                let mut s = String::new();
                let storage = match parent.child_member(slot_ident) {
                    Some(mem) => format!("&p->{mem}"),
                    None => {
                        writeln!(
                            s,
                            "    {}_params_t tn_cp;\n    memset( &tn_cp, 0, sizeof tn_cp );",
                            c.c_name
                        )
                        .unwrap();
                        "&tn_cp".to_string()
                    }
                };
                if self.needs_prep(slot).is_some() {
                    writeln!(
                        s,
                        "    rc = {prep_fn}( p, {cur}, {storage} );\n    if( rc ) return rc;"
                    )
                    .unwrap();
                }
                writeln!(
                    s,
                    "    rc = {}_tn_walk( tn_abi_child_data( data, len, {cur}, mode ), tn_abi_child_len( len, {cur}, mode ), {storage}, mode, &sz );\n    if( rc ) return rc;",
                    c.c_name
                )
                .unwrap();
                s
            }
        }
    }

    fn unsupported_guard(n: &Node) -> String {
        if n.unsupported.is_empty() {
            String::new()
        } else {
            format!(
                "  /* unsupported: {} */\n  return TN_ABI_ERR_UNSUPPORTED;\n",
                n.unsupported.join("; ").replace("*/", "* /")
            )
        }
    }

    /* ---------- expressions ---------- */

    /// Emits statements evaluating `e` into a fresh `uint64_t`; returns its name.
    /// Field references read `p-><member>` of node `n`.
    fn expr(&self, n: &Node, e: &ExprKind, out: &mut String, tmp: &mut usize) -> String {
        let fresh = |tmp: &mut usize| {
            let v = format!("tn_e{}", *tmp);
            *tmp += 1;
            v
        };
        use ExprKind::*;
        macro_rules! bin {
            ($x:expr) => {{
                let l = self.expr(n, &$x.left, out, tmp);
                let r = self.expr(n, &$x.right, out, tmp);
                (l, r)
            }};
        }
        let v = fresh(tmp);
        match e {
            Literal(lit) => writeln!(out, "  uint64_t {v} = {}UL;", literal_u64(lit)).unwrap(),
            FieldRef(f) => {
                let key = ref_key(&f.path);
                let src = n.member_for_key(&key).map(|s| s.to_string()).or_else(|| {
                    (key == BUFFER_SIZE_REF)
                        .then(|| n.has_member(&MemberKind::BufSz).map(|s| s.to_string()))
                        .flatten()
                });
                match src {
                    Some(m) => writeln!(out, "  uint64_t {v} = p->{m};").unwrap(),
                    None => writeln!(
                        out,
                        "  uint64_t {v} = 0UL;\n  return TN_ABI_ERR_UNSUPPORTED; /* unresolved {key} */"
                    )
                    .unwrap(),
                }
            }
            Sizeof(s) => match self.m.resolver.get_type_info(&s.type_name).map(|t| &t.size) {
                Some(Size::Const(sz)) => writeln!(out, "  uint64_t {v} = {sz}UL;").unwrap(),
                _ => writeln!(
                    out,
                    "  uint64_t {v} = 0UL;\n  return TN_ABI_ERR_UNSUPPORTED;"
                )
                .unwrap(),
            },
            Alignof(a) => match self.m.resolver.get_type_info(&a.type_name) {
                Some(t) => writeln!(out, "  uint64_t {v} = {}UL;", t.alignment).unwrap(),
                None => writeln!(
                    out,
                    "  uint64_t {v} = 0UL;\n  return TN_ABI_ERR_UNSUPPORTED;"
                )
                .unwrap(),
            },
            Add(x) => {
                let (l, r) = bin!(x);
                writeln!(out, "  uint64_t {v};\n  if( tn_checked_add_u64( {l}, {r}, &{v} ) ) return TN_ABI_ERR_OVERFLOW;").unwrap()
            }
            Sub(x) => {
                let (l, r) = bin!(x);
                writeln!(out, "  uint64_t {v};\n  if( tn_checked_sub_u64( {l}, {r}, &{v} ) ) return TN_ABI_ERR_OVERFLOW;").unwrap()
            }
            Mul(x) => {
                let (l, r) = bin!(x);
                writeln!(out, "  uint64_t {v};\n  if( tn_checked_mul_u64( {l}, {r}, &{v} ) ) return TN_ABI_ERR_OVERFLOW;").unwrap()
            }
            Pow(x) => {
                let (l, r) = bin!(x);
                writeln!(out, "  uint64_t {v};\n  if( tn_checked_pow_u64( {l}, {r}, &{v} ) ) return TN_ABI_ERR_OVERFLOW;").unwrap()
            }
            Div(x) => {
                let (l, r) = bin!(x);
                writeln!(
                    out,
                    "  if( {r}==0UL ) return TN_ABI_ERR_EXPR;\n  uint64_t {v} = {l}/{r};"
                )
                .unwrap()
            }
            Mod(x) => {
                let (l, r) = bin!(x);
                writeln!(
                    out,
                    "  if( {r}==0UL ) return TN_ABI_ERR_EXPR;\n  uint64_t {v} = {l}%{r};"
                )
                .unwrap()
            }
            BitAnd(x) => {
                let (l, r) = bin!(x);
                writeln!(out, "  uint64_t {v} = {l}&{r};").unwrap()
            }
            BitOr(x) => {
                let (l, r) = bin!(x);
                writeln!(out, "  uint64_t {v} = {l}|{r};").unwrap()
            }
            BitXor(x) => {
                let (l, r) = bin!(x);
                writeln!(out, "  uint64_t {v} = {l}^{r};").unwrap()
            }
            LeftShift(x) => {
                let (l, r) = bin!(x);
                writeln!(out, "  uint64_t {v};\n  if( tn_checked_shl_u64( {l}, {r}, &{v} ) ) return TN_ABI_ERR_OVERFLOW;").unwrap()
            }
            RightShift(x) => {
                let (l, r) = bin!(x);
                writeln!(out, "  uint64_t {v} = {r}>=64UL ? 0UL : {l}>>{r};").unwrap()
            }
            Eq(x) => {
                let (l, r) = bin!(x);
                writeln!(out, "  uint64_t {v} = (uint64_t)( {l}=={r} );").unwrap()
            }
            Ne(x) => {
                let (l, r) = bin!(x);
                writeln!(out, "  uint64_t {v} = (uint64_t)( {l}!={r} );").unwrap()
            }
            Lt(x) => {
                let (l, r) = bin!(x);
                writeln!(out, "  uint64_t {v} = (uint64_t)( {l}<{r} );").unwrap()
            }
            Gt(x) => {
                let (l, r) = bin!(x);
                writeln!(out, "  uint64_t {v} = (uint64_t)( {l}>{r} );").unwrap()
            }
            Le(x) => {
                let (l, r) = bin!(x);
                writeln!(out, "  uint64_t {v} = (uint64_t)( {l}<={r} );").unwrap()
            }
            Ge(x) => {
                let (l, r) = bin!(x);
                writeln!(out, "  uint64_t {v} = (uint64_t)( {l}>={r} );").unwrap()
            }
            /* Short-circuit: the right operand (and any error it can raise,
            such as a division by zero it guards against) is evaluated only
            when the left one does not decide the result. */
            And(x) => {
                let l = self.expr(n, &x.left, out, tmp);
                writeln!(out, "  uint64_t {v} = 0UL;\n  if( {l} ) {{").unwrap();
                let r = self.nested_expr(n, &x.right, out, tmp);
                writeln!(out, "    {v} = (uint64_t)( {r}!=0UL );\n  }}").unwrap()
            }
            Or(x) => {
                let l = self.expr(n, &x.left, out, tmp);
                writeln!(out, "  uint64_t {v} = 1UL;\n  if( !{l} ) {{").unwrap();
                let r = self.nested_expr(n, &x.right, out, tmp);
                writeln!(out, "    {v} = (uint64_t)( {r}!=0UL );\n  }}").unwrap()
            }
            Xor(x) => {
                let (l, r) = bin!(x);
                writeln!(out, "  uint64_t {v} = (uint64_t)( !{l} != !{r} );").unwrap()
            }
            BitNot(x) => {
                let o = self.expr(n, &x.operand, out, tmp);
                writeln!(out, "  uint64_t {v} = ~{o};").unwrap()
            }
            Neg(x) => {
                /* Sizes and tags are unsigned: only -0 is representable. */
                let o = self.expr(n, &x.operand, out, tmp);
                writeln!(
                    out,
                    "  if( {o} ) return TN_ABI_ERR_EXPR;\n  uint64_t {v} = 0UL;"
                )
                .unwrap()
            }
            Not(x) => {
                let o = self.expr(n, &x.operand, out, tmp);
                writeln!(out, "  uint64_t {v} = (uint64_t)( !{o} );").unwrap()
            }
            Popcount(x) => {
                let o = self.expr(n, &x.operand, out, tmp);
                writeln!(out, "  uint64_t {v} = tn_popcount_u64( {o} );").unwrap()
            }
        }
        v
    }

    /// `expr` for statements inside a block: indented one level further.
    fn nested_expr(&self, n: &Node, e: &ExprKind, out: &mut String, tmp: &mut usize) -> String {
        let mut inner = String::new();
        let v = self.expr(n, e, &mut inner, tmp);
        for line in inner.lines() {
            writeln!(out, "  {line}").unwrap();
        }
        v
    }

    /// `static int <fn>( X_params_t const * p, uint64_t * out )` evaluating `e`.
    fn emit_expr_fn(&mut self, id: NodeId, fn_name: &str, e: &ExprKind) {
        let n = self.n(id);
        let mut body = String::from("  (void)p;\n");
        let mut tmp = 0;
        let v = self.expr(n, e, &mut body, &mut tmp);
        writeln!(body, "  *out = {v};\n  return TN_ABI_OK;").unwrap();
        let sig = format!(
            "int {fn_name}( {}_params_t const * p, uint64_t * out )",
            n.c_name
        );
        self.helper_fn(n, &sig, &body);
    }

    /* ---------- primitives (enum / SDU payloads, named primitive types) ---------- */

    fn emit_prim(&mut self, id: NodeId, p: &PrimitiveType) {
        let n = self.n(id);
        let c = &n.c_name;
        let size = prim_size(p);
        self.walk_fn(
            n,
            &format!(
                "  (void)data; (void)p;\n  if( mode=={MODE_VALIDATE} && len<{size}UL ) return TN_ABI_ERR_SHORT_BUFFER;\n  *out_sz = {size}UL;\n  return TN_ABI_OK;\n"
            ),
        );
        let t = prim_c_type(p);
        self.public_fn(
            &format!("{t} {c}_get( {c}_t const * self )"),
            &format!("  {t} v;\n  if( !self ) return ({t})0;\n  memcpy( &v, self, sizeof v );\n  return v;\n"),
        );
        self.public_fn(
            &format!("int {c}_set( {c}_t * self, {t} value )"),
            "  if( !self ) return TN_ABI_ERR_INVALID_ARG;\n  memcpy( self, &value, sizeof value );\n  return TN_ABI_OK;\n",
        );
    }

    /* ---------- structs and unions ---------- */

    fn emit_layout(&mut self, id: NodeId, fields: &[Field], packed: bool, union: bool) {
        let n = self.n(id);
        let c = &n.c_name;
        let nf = fields.len();
        let mut b = String::from(
            "  uint64_t cur = 0UL;\n  uint64_t sz  = 0UL;\n  int      rc  = 0;\n  (void)data; (void)len; (void)p; (void)mode; (void)sz; (void)rc; (void)cur; (void)upto; (void)offs;\n",
        );
        b.push_str(&Self::unsupported_guard(n));
        for (k, f) in fields.iter().enumerate() {
            writeln!(b, "  /* {} */", f.name.replace("*/", "* /")).unwrap();
            if union {
                writeln!(
                    b,
                    "  offs[{k}] = 0UL;\n  if( upto=={k}UL ) return TN_ABI_OK;"
                )
                .unwrap();
                /* Every variant overlays offset 0; the union spans the largest
                one. Variants are walked over the same bytes and each must
                validate. A constant-size variant (and every variant of a
                constant-size union) is only walked to validate: sizing and
                building cannot depend on which variant is meant (a variant's
                tag params would otherwise default to 0). A variable-size
                variant is walked in every mode with its params embedded in
                the union's, so PARAMS and INIT size it from those. */
                let fixed = n.const_size.or(self.m.slot_size(&f.slot));
                if fixed.is_some() {
                    writeln!(b, "  if( mode=={MODE_VALIDATE} ) {{").unwrap();
                }
                b.push_str("  {\n");
                b.push_str(&self.slot_walk(
                    n,
                    &f.slot,
                    &f.ident,
                    &format!("{c}_tn_prep_{}", f.ident),
                    "0UL",
                ));
                b.push_str("  }\n");
                writeln!(
                    b,
                    "  if( mode=={MODE_VALIDATE} && sz>len ) return TN_ABI_ERR_SHORT_BUFFER;"
                )
                .unwrap();
                match (n.const_size, self.m.slot_size(&f.slot)) {
                    (Some(_), _) => b.push_str("  if( sz>cur ) cur = sz;\n  }\n"),
                    (None, Some(vs)) => {
                        writeln!(b, "  }} else sz = {vs}UL;\n  if( sz>cur ) cur = sz;").unwrap()
                    }
                    (None, None) => b.push_str("  if( sz>cur ) cur = sz;\n"),
                }
                continue;
            }
            if !packed && f.align > 1 {
                writeln!(
                    b,
                    "  if( tn_checked_align_up_u64( cur, {}UL, &cur ) ) return TN_ABI_ERR_OVERFLOW;",
                    f.align
                )
                .unwrap();
            }
            writeln!(
                b,
                "  offs[{k}] = cur;\n  if( upto=={k}UL ) return TN_ABI_OK;\n  if( mode=={MODE_VALIDATE} && cur>len ) return TN_ABI_ERR_SHORT_BUFFER;\n  {{"
            )
            .unwrap();
            b.push_str(&self.slot_walk(
                n,
                &f.slot,
                &f.ident,
                &format!("{c}_tn_prep_{}", f.ident),
                "cur",
            ));
            b.push_str("  }\n");
            writeln!(
                b,
                "  if( mode=={MODE_VALIDATE} && sz>len-cur ) return TN_ABI_ERR_SHORT_BUFFER;"
            )
            .unwrap();
            let reads: Vec<(String, &super::model::InternalRef)> = n
                .members
                .iter()
                .filter_map(|m| match &m.kind {
                    MemberKind::Internal(i) if n.internal[*i].field == k => {
                        Some((m.name.clone(), &n.internal[*i]))
                    }
                    _ => None,
                })
                .collect();
            if !reads.is_empty() {
                /* MEASURE reads only the bytes present. */
                let end = reads
                    .iter()
                    .map(|(_, r)| r.sub_offset + prim_size(&r.prim))
                    .max()
                    .unwrap_or(0);
                writeln!(
                    b,
                    "  if( mode=={MODE_MEASURE} && ( cur>len || len-cur<{end}UL ) ) return TN_ABI_ERR_SHORT_BUFFER;"
                )
                .unwrap();
                let ld: String = reads
                    .iter()
                    .map(|(name, r)| {
                        format!(
                            "    p->{name} = {}( data+cur+{}UL );\n",
                            ld_fn(&r.prim),
                            r.sub_offset
                        )
                    })
                    .collect();
                /* INIT writes the values params imply (checking they fit the field). */
                let st: String = reads
                    .iter()
                    .map(|(name, r)| {
                        format!(
                            "    {}( (uint8_t *)data+cur+{o}UL, p->{name} );\n    if( {}( data+cur+{o}UL )!=p->{name} ) return TN_ABI_ERR_OVERFLOW;\n",
                            st_fn(&r.prim),
                            ld_fn(&r.prim),
                            o = r.sub_offset
                        )
                    })
                    .collect();
                writeln!(
                    b,
                    "  if( mode=={MODE_INIT} ) {{\n{st}  }} else if( mode!={MODE_PARAMS} ) {{\n{ld}  }}"
                )
                .unwrap();
            }
            writeln!(
                b,
                "  if( tn_checked_add_u64( cur, sz, &cur ) ) return TN_ABI_ERR_OVERFLOW;"
            )
            .unwrap();
        }
        if union {
            match n.const_size {
                Some(size) => writeln!(b, "  offs[{nf}] = {size}UL;").unwrap(),
                /* `cur` holds the largest variant size seen above. */
                None => writeln!(b, "  offs[{nf}] = cur;").unwrap(),
            }
        } else {
            if !packed && n.align > 1 {
                /* Trailing padding is part of the value: the bytes must be
                present (MEASURE reports the padded size as required). */
                writeln!(
                    b,
                    "  if( tn_checked_align_up_u64( cur, {}UL, &cur ) ) return TN_ABI_ERR_OVERFLOW;\n  if( mode=={MODE_VALIDATE} && cur>len ) return TN_ABI_ERR_SHORT_BUFFER;",
                    n.align
                )
                .unwrap();
            }
            writeln!(b, "  offs[{nf}] = cur;").unwrap();
        }
        b.push_str("  return TN_ABI_OK;\n");
        let sig = format!(
            "int {c}_tn_layout( uint8_t const * data, uint64_t len, {c}_params_t * p, int mode, uint64_t upto, uint64_t * offs )"
        );
        self.static_fn(&sig, &b);

        for f in fields {
            if let Some(child) = self.needs_prep(&f.slot) {
                self.emit_prep(id, &format!("{c}_tn_prep_{}", f.ident), child);
            }
        }

        let size_check = match n.const_size {
            /* A zero-size layout always fits (and len<0 trips -Wtype-limits). */
            Some(s) if s > 0 => format!(
                "  if( mode=={MODE_VALIDATE} && len<{s}UL ) return TN_ABI_ERR_SHORT_BUFFER;\n"
            ),
            _ => String::new(),
        };
        self.walk_fn(
            n,
            &format!(
                "  uint64_t offs[{n1}];\n{size_check}  int rc = {c}_tn_layout( data, len, p, mode, {nf}UL, offs );\n  if( rc ) return rc;\n  *out_sz = offs[{nf}];\n  return TN_ABI_OK;\n",
                n1 = nf + 1
            ),
        );
    }

    fn emit_struct(&mut self, id: NodeId, fields: &[Field], packed: bool) {
        self.emit_layout(id, fields, packed, false);
        for (k, f) in fields.iter().enumerate() {
            self.emit_field_accessors(id, k, f);
        }
        self.emit_all_wrappers(id, fields);
    }

    /// Wrappers come after every field accessor so a wrapper never takes a
    /// name a later field's getter needs.
    fn emit_all_wrappers(&mut self, id: NodeId, fields: &[Field]) {
        for f in fields {
            if let Slot::Node(child) = &f.slot {
                self.emit_field_wrappers(id, f, *child);
            }
        }
        /* Whole-value setters last: they never take a wrapper's name. */
        for f in fields {
            self.emit_value_setter(id, f);
        }
    }

    /// Whole-value setter for a nested struct or type-ref field `f` (or a
    /// union variant): `S_set_f( self, value )` copies a constant-size child;
    /// `S_set_f_bytes( self, src, n )` replaces a variable-size child in place
    /// when `n` is its current size and `src` validates as the child.
    fn emit_value_setter(&mut self, id: NodeId, f: &Field) {
        let (Some(kind), Slot::Node(child)) = (self.m.value_setter(&f.slot), &f.slot) else {
            return;
        };
        let n = self.n(id);
        let c = n.c_name.clone();
        let fi = &f.ident;
        let pd = Self::pdecl(n);
        let pa = Self::parg(n);
        let ch = self.r(*child);
        let cc = ch.c_name.clone();
        let cp_out = self.outarg(*child, "&tn_cp");
        match kind {
            ValueSetter::Copy(size) => {
                let decl = if ch.needs_params() {
                    format!("  {cc}_params_t tn_cp;\n  memset( &tn_cp, 0, sizeof tn_cp );\n")
                } else {
                    String::new()
                };
                self.public_fn(
                    &format!("int {c}_set_{fi}( {c}_t * self{pd}, {cc}_t const * value )"),
                    &format!(
                        "{decl}  if( !self || !value ) return TN_ABI_ERR_INVALID_ARG;\n  {cc}_t * tn_c = {c}_get_{fi}_mut( self{pa}{cp_out} );\n  if( !tn_c ) return TN_ABI_ERR_INVALID_ARG;\n  if( (void const *)tn_c!=(void const *)value ) memcpy( tn_c, value, {size}UL );\n  return TN_ABI_OK;\n"
                    ),
                );
            }
            ValueSetter::Bytes => {
                self.public_fn(
                    &format!(
                        "int {c}_set_{fi}_bytes( {c}_t * self{pd}, uint8_t const * src, uint64_t n )"
                    ),
                    &format!(
                        "  {cc}_params_t tn_cp;\n  {cc}_params_t tn_vp;\n  uint64_t tn_cur = 0UL;\n  uint64_t tn_sz  = 0UL;\n  memset( &tn_cp, 0, sizeof tn_cp );\n  if( !self || !src ) return TN_ABI_ERR_INVALID_ARG;\n  {cc}_t * tn_c = {c}_get_{fi}_mut( self{pa}{cp_out} );\n  if( !tn_c ) return TN_ABI_ERR_INVALID_ARG;\n  /* Same size as the value in place: nothing after it moves. */\n  tn_vp = tn_cp;\n  int rc = {cc}_tn_walk( (uint8_t const *)tn_c, UINT64_MAX, &tn_vp, {MODE_TRUST}, &tn_cur );\n  if( rc ) return rc;\n  if( n!=tn_cur ) return TN_ABI_ERR_BAD_SIZE;\n  tn_vp = tn_cp;\n  rc = {cc}_tn_walk( src, n, &tn_vp, {MODE_VALIDATE}, &tn_sz );\n  if( rc ) return rc;\n  if( tn_sz!=n ) return TN_ABI_ERR_BAD_SIZE;\n  if( (void const *)tn_c!=(void const *)src ) memcpy( tn_c, src, n );\n  return TN_ABI_OK;\n"
                    ),
                );
            }
        }
    }

    fn emit_union(&mut self, id: NodeId, variants: &[Field]) {
        self.emit_layout(id, variants, true, true);
        self.emit_variant_table(id);
        for (k, f) in variants.iter().enumerate() {
            self.emit_field_accessors(id, k, f);
        }
        self.emit_all_wrappers(id, variants);
    }

    /// Prologue resolving the offset of field `k` into `tn_off` (`tn_base`
    /// is the struct start). `fail` is the statement run on failure.
    fn field_prologue(&self, id: NodeId, k: usize, f: &Field, fail: &str) -> String {
        let n = self.n(id);
        let c = &n.c_name;
        let mut s = format!(
            "  uint8_t const * tn_base = (uint8_t const *)self;\n  if( !tn_base ) {fail}\n"
        );
        if let (Some(off), None, true) = (
            f.const_offset,
            self.needs_prep(&f.slot),
            n.unsupported.is_empty(),
        ) {
            if n.needs_params() {
                s.push_str("  (void)params;\n");
            }
            writeln!(s, "  uint64_t tn_off = {off}UL;").unwrap();
            return s;
        }
        s.push_str(&self.params_init(n));
        writeln!(
            s,
            "  uint64_t tn_offs[{k1}];\n  if( {c}_tn_layout( tn_base, UINT64_MAX, &tn_p, {MODE_TRUST}, {k}UL, tn_offs ) ) {fail}\n  uint64_t tn_off = tn_offs[{k}];",
            k1 = k + 1
        )
        .unwrap();
        s
    }

    /// Static `int <name>( S_t * self[, params], uint64_t v )` writing `v`
    /// into the primitive field `internal[ri]` of struct `id`.
    pub(super) fn emit_tag_store(&mut self, id: NodeId, ri: usize, name: &str) {
        let n = self.n(id);
        let NodeKind::Struct { fields, .. } = &n.kind else {
            return;
        };
        let r = &n.internal[ri];
        let pro = self.field_prologue(
            id,
            r.field,
            &fields[r.field],
            "return TN_ABI_ERR_INVALID_ARG;",
        );
        let st = st_fn(&r.prim);
        self.static_fn(
            &format!(
                "int {name}( {c}_t * self{pd}, uint64_t v )",
                c = n.c_name,
                pd = Self::pdecl(n)
            ),
            &format!(
                "{pro}  {st}( (uint8_t *)self+tn_off+{}UL, v );\n  return TN_ABI_OK;\n",
                r.sub_offset
            ),
        );
    }

    /// Static `int <name>( S_t const * self[, params], uint64_t * out )`
    /// reading the primitive field `internal[ri]` of struct `id`.
    fn emit_tag_load(&mut self, id: NodeId, ri: usize, name: &str) {
        let n = self.n(id);
        let NodeKind::Struct { fields, .. } = &n.kind else {
            return;
        };
        let r = &n.internal[ri];
        let pro = self.field_prologue(
            id,
            r.field,
            &fields[r.field],
            "return TN_ABI_ERR_INVALID_ARG;",
        );
        let ld = ld_fn(&r.prim);
        self.static_fn(
            &format!(
                "int {name}( {c}_t const * self{pd}, uint64_t * out )",
                c = n.c_name,
                pd = Self::pdecl(n)
            ),
            &format!(
                "{pro}  *out = {ld}( tn_base+tn_off+{}UL );\n  return TN_ABI_OK;\n",
                r.sub_offset
            ),
        );
    }

    fn emit_field_accessors(&mut self, id: NodeId, k: usize, f: &Field) {
        let n = self.n(id);
        let c = n.c_name.clone();
        let fi = &f.ident;
        let pd = Self::pdecl(n);
        let pa = Self::parg(n);
        match &f.slot {
            Slot::Prim(p) => {
                let t = prim_c_type(p);
                let pro = self.field_prologue(id, k, f, &format!("return ({t})0;"));
                self.public_fn(
                    &format!("{t} {c}_get_{fi}( {c}_t const * self{pd} )"),
                    &format!(
                        "{pro}  {t} v;\n  memcpy( &v, tn_base+tn_off, sizeof v );\n  return v;\n"
                    ),
                );
                let pro = self.field_prologue(id, k, f, "return TN_ABI_ERR_INVALID_ARG;");
                self.public_fn(
                    &format!("int {c}_set_{fi}( {c}_t * self{pd}, {t} value )"),
                    &format!("{pro}  memcpy( (uint8_t *)self+tn_off, &value, sizeof value );\n  return TN_ABI_OK;\n"),
                );
            }
            Slot::Node(child) => {
                let child = *child;
                let ch = self.r(child);
                let cc = ch.c_name.clone();
                let od = self.outdecl(child);
                let oa = self.outarg(child, "opt_params");
                let mut pro = self.field_prologue(id, k, f, "return NULL;");
                if self.needs_prep(&f.slot).is_some() {
                    writeln!(
                        pro,
                        "  if( opt_params ) {{\n    memset( opt_params, 0, sizeof *opt_params );\n    if( {c}_tn_prep_{fi}( &tn_p, tn_off, opt_params ) ) return NULL;\n  }}"
                    )
                    .unwrap();
                } else if !od.is_empty() {
                    /* Child inputs exist but the child is trivial: nothing to copy. */
                    pro.push_str(
                        "  if( opt_params ) memset( opt_params, 0, sizeof *opt_params );\n",
                    );
                }
                self.public_fn(
                    &format!("{cc}_t const * {c}_get_{fi}( {c}_t const * self{pd}{od} )"),
                    &format!("{pro}  return ({cc}_t const *)( tn_base+tn_off );\n"),
                );
                self.public_fn(
                    &format!("{cc}_t * {c}_get_{fi}_mut( {c}_t * self{pd}{od} )"),
                    &format!("  return ({cc}_t *){c}_get_{fi}( ({c}_t const *)self{pa}{oa} );\n"),
                );
            }
        }
    }

    /// Convenience wrappers over a child node, by child kind.
    fn emit_field_wrappers(&mut self, id: NodeId, f: &Field, child: NodeId) {
        let n = self.n(id);
        let c = n.c_name.clone();
        let fi = f.ident.clone();
        let pd = Self::pdecl(n);
        let pa = Self::parg(n);
        let ch = self.r(child);
        let cc = ch.c_name.clone();
        let cp_decl = format!("  {cc}_params_t tn_cp;\n  memset( &tn_cp, 0, sizeof tn_cp );\n");
        let cp_out = self.outarg(child, "&tn_cp");
        let cpa = if ch.needs_params() { ", &tn_cp" } else { "" };
        match &ch.kind {
            NodeKind::Array { elem, .. } => {
                self.public_fn(
                    &format!("uint64_t {c}_get_{fi}_len( {c}_t const * self{pd} )"),
                    &format!("{cp_decl}  {cc}_t const * tn_a = {c}_get_{fi}( self{pa}{cp_out} );\n  if( !tn_a ) return 0UL;\n  return {cc}_len( tn_a{cpa} );\n"),
                );
                self.emit_fam_setter(id, f, child);
                match elem {
                    Slot::Prim(p) => {
                        let t = prim_c_type(p);
                        self.public_fn(
                            &format!("{t} {c}_get_{fi}_at( {c}_t const * self{pd}, uint64_t idx )"),
                            &format!("{cp_decl}  {cc}_t const * tn_a = {c}_get_{fi}( self{pa}{cp_out} );\n  if( !tn_a ) return ({t})0;\n  return {cc}_get_at( tn_a{cpa}, idx );\n"),
                        );
                        self.public_fn(
                            &format!("int {c}_set_{fi}_at( {c}_t * self{pd}, uint64_t idx, {t} value )"),
                            &format!("{cp_decl}  {cc}_t * tn_a = {c}_get_{fi}_mut( self{pa}{cp_out} );\n  if( !tn_a ) return TN_ABI_ERR_INVALID_ARG;\n  return {cc}_set_at( tn_a{cpa}, idx, value );\n"),
                        );
                    }
                    Slot::Node(e) => {
                        let e = *e;
                        let ec = self.r(e).c_name.clone();
                        let eod = self.outdecl(e);
                        let eoa = self.outarg(e, "opt_params");
                        self.public_fn(
                            &format!("{ec}_t const * {c}_get_{fi}_at( {c}_t const * self{pd}, uint64_t idx{eod} )"),
                            &format!("{cp_decl}  {cc}_t const * tn_a = {c}_get_{fi}( self{pa}{cp_out} );\n  if( !tn_a ) return NULL;\n  return {cc}_at( tn_a{cpa}, idx{eoa} );\n"),
                        );
                        self.public_fn(
                            &format!("{ec}_t * {c}_get_{fi}_at_mut( {c}_t * self{pd}, uint64_t idx{eod} )"),
                            &format!("  return ({ec}_t *){c}_get_{fi}_at( ({c}_t const *)self{pa}, idx{eoa} );\n"),
                        );
                    }
                }
            }
            NodeKind::Enum { tag, variants } => {
                self.public_fn(
                    &format!("uint64_t {c}_get_{fi}_tag( {c}_t const * self{pd} )"),
                    &format!("{cp_decl}  uint64_t tag = 0UL;\n  {cc}_t const * tn_e = {c}_get_{fi}( self{pa}{cp_out} );\n  if( !tn_e || {cc}_tn_tag( &tn_cp, &tag ) ) return UINT64_MAX;\n  return tag;\n"),
                );
                for v in variants {
                    self.emit_variant_wrapper(id, f, child, v);
                }
                /* Selecting a variant writes the tag field when the tag is a
                plain primitive field of this struct (possibly nested). */
                if let Some(ri) = n.plain_ref(tag) {
                    self.emit_tag_store(id, ri, &format!("{c}_{fi}_tn_set_tag"));
                    for v in variants {
                        self.public_fn(
                            &format!("int {c}_{fi}_select_{}( {c}_t * self{pd} )", v.ident),
                            &format!("  return {c}_{fi}_tn_set_tag( self{pa}, {}UL );\n", v.value),
                        );
                    }
                    self.public_fn(
                        &format!("int {c}_{fi}_select_by_name( {c}_t * self{pd}, char const * name )"),
                        &format!("  tn_abi_variant_t const * v = tn_abi_variant_find( {cc}_variants, {cc}_VARIANT_CNT, name );\n  if( !v ) return TN_ABI_ERR_BAD_TAG;\n  return {c}_{fi}_tn_set_tag( self{pa}, v->tag );\n"),
                    );
                }
            }
            NodeKind::Sdu { variants } => {
                self.public_fn(
                    &format!("int {c}_get_{fi}_variant( {c}_t const * self{pd} )"),
                    &format!("{cp_decl}  {cc}_t const * tn_d = {c}_get_{fi}( self{pa}{cp_out} );\n  if( !tn_d ) return -1;\n  return {cc}_tn_variant( &tn_cp );\n"),
                );
                for v in variants {
                    self.emit_variant_wrapper(id, f, child, v);
                }
            }
            _ => {}
        }
    }

    /// `S_set_f( self, src, n )` for an array field whose count is a plain
    /// integer field of `S`: copies `n` elements over the array in place.
    /// The view carries no buffer length, so `n` must be the current count:
    /// another count would move or overrun what follows (the next jagged
    /// element, a later field, the end of the buffer).
    fn emit_fam_setter(&mut self, id: NodeId, f: &Field, child: NodeId) {
        let n = self.n(id);
        let ch = self.r(child);
        let Some(ri) = self.m.fam_count(n, &Slot::Node(child)) else {
            return;
        };
        let NodeKind::Array {
            elem_size: Some(es),
            ..
        } = &ch.kind
        else {
            return;
        };
        let r = &n.internal[ri];
        let c = n.c_name.clone();
        let fi = f.ident.clone();
        let cc = ch.c_name.clone();
        let pd = Self::pdecl(n);
        let pa = Self::parg(n);
        let (st, ld) = (st_fn(&r.prim), ld_fn(&r.prim));
        let cp_out = self.outarg(child, "&tn_cp");
        let load = format!("{c}_{fi}_tn_get_count");
        self.emit_tag_load(id, ri, &load);
        self.public_fn(
            &format!("int {c}_set_{fi}( {c}_t * self{pd}, void const * src, uint64_t n )"),
            &format!(
                "  {cc}_params_t tn_cp;\n  uint8_t  tn_cnt[ 8 ];\n  uint64_t tn_bytes = 0UL;\n  uint64_t tn_have  = 0UL;\n  int      rc       = 0;\n  memset( &tn_cp, 0, sizeof tn_cp );\n  if( !self || ( n && !src ) ) return TN_ABI_ERR_INVALID_ARG;\n  if( tn_checked_mul_u64( n, {es}UL, &tn_bytes ) ) return TN_ABI_ERR_OVERFLOW;\n  {st}( tn_cnt, n );\n  if( {ld}( tn_cnt )!=n ) return TN_ABI_ERR_OVERFLOW;\n  /* Same count as in place: nothing after the array moves. */\n  rc = {load}( self{pa}, &tn_have );\n  if( rc ) return rc;\n  if( tn_have!=n ) return TN_ABI_ERR_BAD_SIZE;\n  {cc}_t * tn_a = {c}_get_{fi}_mut( self{pa}{cp_out} );\n  if( !tn_a ) return TN_ABI_ERR_INVALID_ARG;\n  if( tn_bytes ) memcpy( tn_a, src, tn_bytes );\n  return TN_ABI_OK;\n"
            ),
        );
    }

    fn emit_variant_wrapper(&mut self, id: NodeId, f: &Field, child: NodeId, v: &Variant) {
        let n = self.n(id);
        let c = n.c_name.clone();
        let fi = &f.ident;
        let pd = Self::pdecl(n);
        let pa = Self::parg(n);
        let ch = self.r(child);
        let cc = ch.c_name.clone();
        let cp_out = self.outarg(child, "&tn_cp");
        let Slot::Node(vid) = v.slot else { return };
        let vc = self.r(vid).c_name.clone();
        let vod = self.outdecl(vid);
        let voa = self.outarg(vid, "opt_params");
        let vi = &v.ident;
        self.public_fn(
            &format!("{vc}_t const * {c}_{fi}_as_{vi}( {c}_t const * self{pd}{vod} )"),
            &format!("  {cc}_params_t tn_cp;\n  memset( &tn_cp, 0, sizeof tn_cp );\n  {cc}_t const * tn_e = {c}_get_{fi}( self{pa}{cp_out} );\n  if( !tn_e ) return NULL;\n  return {cc}_tn_as_{vi}( tn_e, &tn_cp{voa} );\n"),
        );
        self.public_fn(
            &format!("{vc}_t * {c}_{fi}_as_{vi}_mut( {c}_t * self{pd}{vod} )"),
            &format!("  return ({vc}_t *){c}_{fi}_as_{vi}( ({c}_t const *)self{pa}{voa} );\n"),
        );
    }

    /* ---------- enums and size-discriminated unions ---------- */

    fn emit_variant_walk(&mut self, id: NodeId, variants: &[Variant], sdu: bool) -> String {
        let n = self.n(id);
        let c = &n.c_name;
        let mut b = String::new();
        for (i, v) in variants.iter().enumerate() {
            let cond = if sdu {
                format!(
                    "p->{}=={}UL",
                    n.has_member(&MemberKind::BufSz).unwrap(),
                    v.value
                )
            } else {
                format!("tag=={}UL", v.value)
            };
            let kw = if i == 0 { "if" } else { "} else if" };
            writeln!(
                b,
                "  {kw}( {cond} ) {{ /* {} */",
                v.name.replace("*/", "* /")
            )
            .unwrap();
            b.push_str(&self.slot_walk(
                n,
                &v.slot,
                &v.ident,
                &format!("{c}_tn_prep_{}", v.ident),
                "0UL",
            ));
            if sdu {
                writeln!(
                    b,
                    "    if( mode=={MODE_VALIDATE} && sz!={e}UL ) return TN_ABI_ERR_BAD_SIZE;\n    sz = {e}UL;",
                    e = v.value
                )
                .unwrap();
            }
        }
        let err = if sdu {
            "TN_ABI_ERR_BAD_SIZE"
        } else {
            "TN_ABI_ERR_BAD_TAG"
        };
        if variants.is_empty() {
            writeln!(b, "  return {err};").unwrap();
        } else {
            writeln!(b, "  }} else {{\n    return {err};\n  }}").unwrap();
        }
        b
    }

    fn emit_variant_views(&mut self, id: NodeId, variants: &[Variant], sdu: bool) {
        let n = self.n(id);
        let c = n.c_name.clone();
        let public = !n.is_field_slot;
        let pd = Self::pdecl(n);
        for (i, v) in variants.iter().enumerate() {
            let Slot::Node(vid) = v.slot else { continue };
            let vn = self.r(vid);
            let vc = vn.c_name.clone();
            let vi = &v.ident;
            let vod = self.outdecl(vid);
            let voa = self.outarg(vid, "opt_params");
            let active = if sdu {
                format!("{c}_tn_variant( p )!={i}")
            } else {
                format!("{c}_tn_tag( p, &tag ) || tag!={}UL", v.value)
            };
            let mut body = format!(
                "  uint64_t tag = 0UL;\n  (void)tag;\n  if( !self || {active} ) return NULL;\n"
            );
            if self.needs_prep(&v.slot).is_some() {
                writeln!(
                    body,
                    "  if( opt_params ) {{\n    memset( opt_params, 0, sizeof *opt_params );\n    if( {c}_tn_prep_{vi}( p, 0UL, opt_params ) ) return NULL;\n  }}"
                )
                .unwrap();
            } else if !vod.is_empty() {
                body.push_str("  if( opt_params ) memset( opt_params, 0, sizeof *opt_params );\n");
            }
            writeln!(body, "  return ({vc}_t const *)self;").unwrap();
            self.helper_fn(
                n,
                &format!(
                    "{vc}_t const * {c}_tn_as_{vi}( {c}_t const * self, {c}_params_t const * p{vod} )"
                ),
                &body,
            );
            if public {
                self.public_fn(
                    &format!("{vc}_t const * {c}_as_{vi}( {c}_t const * self{pd}{vod} )"),
                    &format!(
                        "{}  return {c}_tn_as_{vi}( self, &tn_p{voa} );\n",
                        self.params_init(n)
                    ),
                );
                self.public_fn(
                    &format!("{vc}_t * {c}_as_{vi}_mut( {c}_t * self{pd}{vod} )"),
                    &format!(
                        "  return ({vc}_t *){c}_as_{vi}( ({c}_t const *)self{}{voa} );\n",
                        Self::parg(n)
                    ),
                );
            }
        }
        for v in variants {
            if let Some(child) = self.needs_prep(&v.slot) {
                self.emit_prep(id, &format!("{c}_tn_prep_{}", v.ident), child);
            }
        }
    }

    fn emit_enum(&mut self, id: NodeId, tag: &ExprKind, variants: &[Variant]) {
        let n = self.n(id);
        let c = n.c_name.clone();
        for v in variants {
            writeln!(
                self.types,
                "#define {c}_TAG_{} ((uint64_t){}UL)",
                v.ident, v.value
            )
            .unwrap();
        }
        self.types.push('\n');
        self.emit_expr_fn(id, &format!("{c}_tn_tag"), tag);
        let mut b = String::from(
            "  uint64_t tag = 0UL;\n  uint64_t sz  = 0UL;\n  int      rc  = 0;\n  (void)data; (void)len;\n",
        );
        b.push_str(&Self::unsupported_guard(n));
        b.push_str("  rc = ");
        writeln!(b, "{c}_tn_tag( p, &tag );\n  if( rc ) return rc;").unwrap();
        b.push_str(&self.emit_variant_walk(id, variants, false));
        writeln!(
            b,
            "  if( mode=={MODE_VALIDATE} && sz>len ) return TN_ABI_ERR_SHORT_BUFFER;\n  *out_sz = sz;\n  return TN_ABI_OK;"
        )
        .unwrap();
        self.walk_fn(n, &b);
        self.emit_variant_views(id, variants, false);
        self.emit_variant_table(id);
        if !n.is_field_slot {
            let pd = Self::pdecl(n);
            self.public_fn(
                &format!("uint64_t {c}_get_tag( {c}_t const * self{pd} )"),
                &format!(
                    "{}  uint64_t tag = 0UL;\n  (void)self;\n  if( {c}_tn_tag( &tn_p, &tag ) ) return UINT64_MAX;\n  return tag;\n",
                    self.params_init(n)
                ),
            );
        }
    }

    fn emit_sdu(&mut self, id: NodeId, variants: &[Variant]) {
        let n = self.n(id);
        let c = n.c_name.clone();
        let buf = n.has_member(&MemberKind::BufSz).unwrap().to_string();
        for (i, v) in variants.iter().enumerate() {
            writeln!(
                self.types,
                "#define {c}_TAG_{} ({i}) /* {} bytes */",
                v.ident, v.value
            )
            .unwrap();
        }
        self.types.push('\n');
        let mut vb = String::new();
        for (i, v) in variants.iter().enumerate() {
            writeln!(vb, "  if( p->{buf}=={}UL ) return {i};", v.value).unwrap();
        }
        vb.push_str("  return -1;\n");
        self.helper_fn(
            n,
            &format!("int {c}_tn_variant( {c}_params_t const * p )"),
            &vb,
        );

        let mut b = String::from(
            "  uint64_t sz  = 0UL;\n  int      rc  = 0;\n  (void)data; (void)len; (void)rc;\n",
        );
        b.push_str(&Self::unsupported_guard(n));
        b.push_str(&self.emit_variant_walk(id, variants, true));
        writeln!(
            b,
            "  if( mode=={MODE_VALIDATE} && sz>len ) return TN_ABI_ERR_SHORT_BUFFER;\n  *out_sz = sz;\n  return TN_ABI_OK;"
        )
        .unwrap();
        self.walk_fn(n, &b);
        self.emit_variant_views(id, variants, true);
        self.emit_variant_table(id);
        if !n.is_field_slot {
            let pd = Self::pdecl(n);
            self.public_fn(
                &format!("int {c}_get_variant( {c}_t const * self{pd} )"),
                &format!(
                    "{}  (void)self;\n  return {c}_tn_variant( &tn_p );\n",
                    self.params_init(n)
                ),
            );
        }
    }

    /* ---------- arrays ---------- */

    /* Smallest encoding of a node (the Rust backend's `min_size`): its
    constant size, or for a struct the constant-size fields of its constant
    prefix; 0 otherwise. */
    fn min_size(&self, id: NodeId) -> u64 {
        let n = self.r(id);
        if let Some(c) = n.const_size {
            return c;
        }
        match &n.kind {
            NodeKind::Struct { fields, .. } => fields
                .iter()
                .take_while(|f| f.const_offset.is_some())
                .filter_map(|f| self.m.slot_size(&f.slot))
                .sum(),
            _ => 0,
        }
    }

    fn emit_array(
        &mut self,
        id: NodeId,
        count: &ExprKind,
        elem: &Slot,
        elem_size: Option<u64>,
        jagged: bool,
    ) {
        let n = self.n(id);
        let c = n.c_name.clone();
        self.emit_expr_fn(id, &format!("{c}_tn_count"), count);
        let elem_node = match elem {
            Slot::Node(e) => Some(*e),
            Slot::Prim(_) => None,
        };
        let prep = self.needs_prep(elem);
        if let Some(child) = prep {
            self.emit_prep(id, &format!("{c}_tn_prep_elem"), child);
        }
        let bytes = n
            .has_member(&MemberKind::JaggedBytes)
            .map(|s| s.to_string());
        let ep_decl = |e: NodeId, me: &Self| {
            format!(
                "      {ec}_params_t tn_ep;\n      memset( &tn_ep, 0, sizeof tn_ep );\n",
                ec = me.r(e).c_name
            )
        };

        let mut b =
            String::from("  uint64_t cnt = 0UL;\n  int      rc  = 0;\n  (void)data; (void)len;\n");
        b.push_str(&Self::unsupported_guard(n));
        writeln!(b, "  rc = {c}_tn_count( p, &cnt );\n  if( rc ) return rc;").unwrap();
        match elem_size {
            Some(es) => {
                writeln!(
                    b,
                    "  uint64_t total = 0UL;\n  if( tn_checked_mul_u64( cnt, {es}UL, &total ) ) return TN_ABI_ERR_OVERFLOW;\n  if( mode=={MODE_VALIDATE} && total>len ) return TN_ABI_ERR_SHORT_BUFFER;"
                )
                .unwrap();
                if let Some(e) = elem_node.filter(|e| !self.n(*e).trivial) {
                    let ec = self.r(e).c_name.clone();
                    /* Zero-size elements are all alike (the same zero bytes,
                    the same inputs): validate one, however many there are. */
                    let vcnt = if es == 0 { "cnt ? 1UL : 0UL" } else { "cnt" };
                    writeln!(
                        b,
                        "  if( mode=={MODE_VALIDATE} ) {{\n    uint64_t vcnt = {vcnt};\n    for( uint64_t i=0UL; i<vcnt; i++ ) {{\n{}      uint64_t esz = 0UL;",
                        ep_decl(e, self)
                    )
                    .unwrap();
                    if prep.is_some() {
                        writeln!(b, "      rc = {c}_tn_prep_elem( p, i*{es}UL, &tn_ep );\n      if( rc ) return rc;").unwrap();
                    }
                    writeln!(
                        b,
                        "      rc = {ec}_tn_walk( data+i*{es}UL, {es}UL, &tn_ep, mode, &esz );\n      if( rc ) return rc;\n    }}\n  }}"
                    )
                    .unwrap();
                }
                if let Some(bm) = &bytes {
                    writeln!(b, "  if( mode!={MODE_PARAMS} ) p->{bm} = total;").unwrap();
                }
                b.push_str("  *out_sz = total;\n  return TN_ABI_OK;\n");
            }
            None if !jagged => {
                /* Every element has the size params give one (see
                `Model::size_from_ext`): a stride, as for fixed-size elements. */
                let e = elem_node.expect("variable-size element is a node");
                let ec = self.r(e).c_name.clone();
                let ep = ep_decl(e, self);
                let prep_at = |off: &str| {
                    if prep.is_some() {
                        format!(
                            "      rc = {c}_tn_prep_elem( p, {off}, &tn_ep );\n      if( rc ) return rc;\n"
                        )
                    } else {
                        String::new()
                    }
                };
                writeln!(
                    b,
                    "  uint64_t es = 0UL;\n  if( cnt ) {{\n    {{\n{ep}{}      rc = {ec}_tn_walk( NULL, 0UL, &tn_ep, {MODE_PARAMS}, &es );\n      if( rc ) return rc;\n    }}\n  }}\n  uint64_t total = 0UL;\n  if( tn_checked_mul_u64( cnt, es, &total ) ) return TN_ABI_ERR_OVERFLOW;\n  if( mode=={MODE_VALIDATE} && total>len ) return TN_ABI_ERR_SHORT_BUFFER;",
                    prep_at("0UL")
                )
                .unwrap();
                /* Zero-size elements are all alike: validate one. */
                writeln!(
                    b,
                    "  if( mode=={MODE_VALIDATE} ) {{\n    uint64_t vcnt = es ? cnt : ( cnt ? 1UL : 0UL );\n    for( uint64_t i=0UL; i<vcnt; i++ ) {{\n{ep}      uint64_t esz = 0UL;\n{}      rc = {ec}_tn_walk( data+i*es, es, &tn_ep, mode, &esz );\n      if( rc ) return rc;\n    }}\n  }}\n  *out_sz = total;\n  return TN_ABI_OK;",
                    prep_at("i*es")
                )
                .unwrap();
            }
            None => {
                let bm = bytes.clone().unwrap_or_else(|| "tn_bytes".into());
                let e = elem_node.expect("variable-size element is a node");
                let ec = self.r(e).c_name.clone();
                /* More elements than bytes left is short only when every
                element takes a byte (as in the Rust walker). */
                let short_count = if self.min_size(e) > 0 {
                    format!(
                        "  if( mode=={MODE_VALIDATE} && cnt>len ) return TN_ABI_ERR_SHORT_BUFFER;\n"
                    )
                } else {
                    String::new()
                };
                writeln!(
                    b,
                    "  if( mode=={MODE_PARAMS} || mode=={MODE_INIT} ) {{ *out_sz = p->{bm}; return TN_ABI_OK; }}\n{short_count}  uint64_t cur = 0UL;\n  for( uint64_t i=0UL; i<cnt; i++ ) {{\n    {{\n{}      uint64_t esz = 0UL;\n      if( mode=={MODE_VALIDATE} && cur>len ) return TN_ABI_ERR_SHORT_BUFFER;\n      if( mode=={MODE_MEASURE} && cur>=len ) return TN_ABI_ERR_SHORT_BUFFER; /* element past the bytes present */",
                    ep_decl(e, self)
                )
                .unwrap();
                if prep.is_some() {
                    writeln!(
                        b,
                        "      rc = {c}_tn_prep_elem( p, cur, &tn_ep );\n      if( rc ) return rc;"
                    )
                    .unwrap();
                }
                writeln!(
                    b,
                    "      rc = {ec}_tn_walk( tn_abi_child_data( data, len, cur, mode ), tn_abi_child_len( len, cur, mode ), &tn_ep, mode, &esz );\n      if( rc ) return rc;\n      /* Zero-byte elements all start at `cur` with the same inputs: the rest\n         are alike and add nothing (measuring cannot size them). */\n      if( esz==0UL ) {{ if( mode=={MODE_MEASURE} ) return TN_ABI_ERR_ZERO_ELEMENT; break; }}\n      if( tn_checked_add_u64( cur, esz, &cur ) ) return TN_ABI_ERR_OVERFLOW;\n    }}\n  }}\n  if( mode=={MODE_VALIDATE} && cur>len ) return TN_ABI_ERR_SHORT_BUFFER;\n  p->{bm} = cur;\n  *out_sz = cur;\n  return TN_ABI_OK;"
                )
                .unwrap();
            }
        }
        self.walk_fn(n, &b);

        /* Element locator. */
        let eod = elem_node.map(|e| self.outdecl(e)).unwrap_or_default();
        let mut lb = String::from(
            "  uint64_t cnt = 0UL;\n  uint64_t off = 0UL;\n  if( !data || !p || {c}_tn_count( p, &cnt ) || idx>=cnt ) return NULL;\n",
        )
        .replace("{c}", &c);
        match elem_size {
            Some(es) => {
                writeln!(
                    lb,
                    "  if( tn_checked_mul_u64( idx, {es}UL, &off ) ) return NULL;"
                )
                .unwrap();
            }
            None if !jagged => {
                let e = elem_node.unwrap();
                let ec = self.r(e).c_name.clone();
                writeln!(
                    lb,
                    "  {{\n    {ec}_params_t tn_tp;\n    uint64_t es = 0UL;\n    memset( &tn_tp, 0, sizeof tn_tp );"
                )
                .unwrap();
                if prep.is_some() {
                    writeln!(
                        lb,
                        "    if( {c}_tn_prep_elem( p, 0UL, &tn_tp ) ) return NULL;"
                    )
                    .unwrap();
                }
                writeln!(
                    lb,
                    "    if( {ec}_tn_walk( NULL, 0UL, &tn_tp, {MODE_PARAMS}, &es ) ) return NULL;\n    if( tn_checked_mul_u64( idx, es, &off ) ) return NULL;\n  }}"
                )
                .unwrap();
            }
            None => {
                let e = elem_node.unwrap();
                let ec = self.r(e).c_name.clone();
                writeln!(
                    lb,
                    "  for( uint64_t i=0UL; i<idx; i++ ) {{\n    {ec}_params_t tn_tp;\n    uint64_t esz = 0UL;\n    memset( &tn_tp, 0, sizeof tn_tp );"
                )
                .unwrap();
                if prep.is_some() {
                    writeln!(
                        lb,
                        "    if( {c}_tn_prep_elem( p, off, &tn_tp ) ) return NULL;"
                    )
                    .unwrap();
                }
                writeln!(
                    lb,
                    "    if( {ec}_tn_walk( data+off, UINT64_MAX, &tn_tp, {MODE_TRUST}, &esz ) ) return NULL;\n    if( !esz ) break; /* zero-byte elements: the rest are alike */\n    if( tn_checked_add_u64( off, esz, &off ) ) return NULL;\n  }}"
                )
                .unwrap();
            }
        }
        if !eod.is_empty() {
            if prep.is_some() {
                writeln!(
                    lb,
                    "  if( opt_params ) {{\n    memset( opt_params, 0, sizeof *opt_params );\n    if( {c}_tn_prep_elem( p, off, opt_params ) ) return NULL;\n  }}"
                )
                .unwrap();
            } else {
                lb.push_str("  if( opt_params ) memset( opt_params, 0, sizeof *opt_params );\n");
            }
        }
        lb.push_str("  return data+off;\n");
        self.static_fn(
            &format!(
                "uint8_t const * {c}_tn_elem( uint8_t const * data, {c}_params_t const * p, uint64_t idx{eod} )"
            ),
            &lb,
        );

        /* Node-level API. */
        let n = self.n(id);
        let pd = Self::pdecl(n);
        let pa = Self::parg(n);
        let init = self.params_init(n);
        self.public_fn(
            &format!("uint64_t {c}_len( {c}_t const * self{pd} )"),
            &format!("{init}  uint64_t cnt = 0UL;\n  (void)self;\n  if( {c}_tn_count( &tn_p, &cnt ) ) return 0UL;\n  return cnt;\n"),
        );
        match elem {
            Slot::Prim(p) => {
                let t = prim_c_type(p);
                self.public_fn(
                    &format!("{t} {c}_get_at( {c}_t const * self{pd}, uint64_t idx )"),
                    &format!("{init}  uint8_t const * tn_e = {c}_tn_elem( (uint8_t const *)self, &tn_p, idx );\n  {t} v;\n  if( !tn_e ) return ({t})0;\n  memcpy( &v, tn_e, sizeof v );\n  return v;\n"),
                );
                self.public_fn(
                    &format!("int {c}_set_at( {c}_t * self{pd}, uint64_t idx, {t} value )"),
                    &format!("{init}  uint8_t const * tn_e = {c}_tn_elem( (uint8_t const *)self, &tn_p, idx );\n  if( !tn_e ) return TN_ABI_ERR_INDEX;\n  memcpy( (uint8_t *)tn_e, &value, sizeof value );\n  return TN_ABI_OK;\n"),
                );
            }
            Slot::Node(e) => {
                let ec = self.r(*e).c_name.clone();
                let eoa = self.outarg(*e, "opt_params");
                self.public_fn(
                    &format!("{ec}_t const * {c}_at( {c}_t const * self{pd}, uint64_t idx{eod} )"),
                    &format!("{init}  return ({ec}_t const *){c}_tn_elem( (uint8_t const *)self, &tn_p, idx{eoa} );\n"),
                );
                self.public_fn(
                    &format!("{ec}_t * {c}_at_mut( {c}_t * self{pd}, uint64_t idx{eod} )"),
                    &format!("  return ({ec}_t *){c}_at( ({c}_t const *)self{pa}, idx{eoa} );\n"),
                );
            }
        }
    }

    /* ---------- named-type entry points ---------- */

    fn emit_entry_points(&mut self, id: NodeId) {
        let n = self.n(id);
        let c = n.c_name.clone();
        let ext = !n.ext.is_empty();
        let edecl = if ext {
            format!(", {c}_params_t const * ext")
        } else {
            String::new()
        };
        let earg = if ext { ", ext" } else { "" };
        let buf = n.has_member(&MemberKind::BufSz).map(|s| s.to_string());
        let buf = if buf.is_none() && n.len_dep {
            Some("buf_sz".to_string())
        } else {
            buf
        };
        let set_len = buf
            .as_ref()
            .map(|b| format!("  p.{b} = len;\n"))
            .unwrap_or_default();
        let ext_copy = if ext { "  if( ext ) p = *ext;\n" } else { "" };
        /* On a short buffer, report the required size when the bytes present
        determine it (never for length-dependent layouts). */
        let measure = if n.len_dep {
            String::new()
        } else {
            format!(
                "  if( rc==TN_ABI_ERR_SHORT_BUFFER && out_consumed ) {{\n    memset( &p, 0, sizeof p );\n  {ext_copy}    if( !{c}_tn_walk( data, len, &p, {MODE_MEASURE}, &sz ) && sz>len ) *out_consumed = sz;\n  }}\n"
            )
        };
        self.public_fn(
            &format!("int {c}_validate( uint8_t const * data, uint64_t len{edecl}, uint64_t * out_consumed )"),
            &format!("  {c}_params_t p;\n  uint64_t sz = 0UL;\n  memset( &p, 0, sizeof p );\n{ext_copy}{set_len}  if( out_consumed ) *out_consumed = 0UL;\n  if( !data ) return TN_ABI_ERR_INVALID_ARG;\n  int rc = {c}_tn_walk( data, len, &p, {MODE_VALIDATE}, &sz );\n{measure}  if( rc ) return rc;\n  if( out_consumed ) *out_consumed = sz;\n  return TN_ABI_OK;\n"),
        );
        self.public_fn(
            &format!("{c}_t const * {c}_from_slice( uint8_t const * data, uint64_t len{edecl} )"),
            &format!("  if( {c}_validate( data, len{earg}, NULL ) ) return NULL;\n  return ({c}_t const *)data;\n"),
        );
        self.public_fn(
            &format!("{c}_t * {c}_from_slice_mut( uint8_t * data, uint64_t len{edecl} )"),
            &format!("  if( {c}_validate( data, len{earg}, NULL ) ) return NULL;\n  return ({c}_t *)data;\n"),
        );
        let pin = if ext { "  p = *params;\n" } else { "" };
        self.public_fn(
            &format!("int {c}_params_from_buffer( uint8_t const * data, uint64_t len, {c}_params_t * params )"),
            &format!("  {c}_params_t p;\n  uint64_t sz = 0UL;\n  if( !data || !params ) return TN_ABI_ERR_INVALID_ARG;\n  memset( &p, 0, sizeof p );\n{pin}{set_len}  int rc = {c}_tn_walk( data, len, &p, {MODE_VALIDATE}, &sz );\n  if( rc ) return rc;\n  *params = p;\n  return TN_ABI_OK;\n"),
        );
        self.public_fn(
            &format!("int {c}_footprint_from_params( {c}_params_t const * params, uint64_t * out_footprint )"),
            &format!("  {c}_params_t p;\n  uint64_t sz = 0UL;\n  if( !params || !out_footprint ) return TN_ABI_ERR_INVALID_ARG;\n  p = *params;\n  int rc = {c}_tn_walk( NULL, 0UL, &p, {MODE_PARAMS}, &sz );\n  if( rc ) return rc;\n  *out_footprint = sz;\n  return TN_ABI_OK;\n"),
        );
        match n.const_size {
            Some(size) if !n.len_dep && n.ext.is_empty() => self.public_fn(
                &format!("uint64_t {c}_footprint( void )"),
                &format!("  return {size}UL;\n"),
            ),
            _ => self.public_fn(
                &format!("uint64_t {c}_footprint( {c}_params_t const * params )"),
                &format!("  uint64_t sz = 0UL;\n  if( {c}_footprint_from_params( params, &sz ) ) return UINT64_MAX;\n  return sz;\n"),
            ),
        }
        self.public_fn(
            &format!("int {c}_init( uint8_t * buf, uint64_t buf_sz, {c}_params_t const * params, uint64_t * out_sz )"),
            &format!("  {c}_params_t p;\n  uint64_t fp = 0UL;\n  uint64_t sz = 0UL;\n  if( out_sz ) *out_sz = 0UL;\n  if( !buf || !params ) return TN_ABI_ERR_INVALID_ARG;\n  p = *params;\n  int rc = {c}_tn_walk( NULL, 0UL, &p, {MODE_PARAMS}, &fp );\n  if( rc ) return rc;\n  if( out_sz ) *out_sz = fp;\n  if( buf_sz<fp ) return TN_ABI_ERR_SHORT_BUFFER;\n  memset( buf, 0, fp );\n  p = *params;\n  rc = {c}_tn_walk( buf, fp, &p, {MODE_INIT}, &sz );\n  if( rc ) return rc;\n  if( sz!=fp ) return TN_ABI_ERR_UNSUPPORTED;\n  return TN_ABI_OK;\n"),
        );
        self.emit_param_keys(id);
        if let NodeKind::Alias { target } = &n.kind {
            let t = self.n(*target).c_name.clone();
            let pd = Self::pdecl(n);
            let pa = Self::parg(n);
            self.public_fn(
                &format!("uint64_t {c}_size( {c}_t const * self{pd} )"),
                &format!("  return {t}_size( self{pa} );\n"),
            );
        }
    }
}
