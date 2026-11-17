//! Metadata tables for the C backend: variant descriptors (the TypeScript
//! `<field>VariantDescriptors`), lookup by variant name, and the params key
//! table (the TypeScript `ParamKeys`).

use super::emit::Emitter;
use super::model::{BUFFER_SIZE_REF, MemberKind, NodeId, NodeKind, Slot, prim_abi_name};
use std::fmt::Write;

/// One row of a `tn_abi_variant_t` table.
struct VariantRow {
    name: String,
    tag: u64,
    payload_size: Option<u64>,
    payload_type: String,
}

/// One row of a `tn_abi_param_key_t` table.
pub struct ParamKeyRow {
    /// Member path inside the params struct (`body.tag`).
    pub member: String,
    /// ABI path of the value (`body.tag`).
    pub path: String,
    /// Read by `footprint_from_params` (as opposed to copied from another member).
    pub input: bool,
}

fn c_str(s: &str) -> String {
    format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
}

fn join(prefix: &str, seg: &str) -> String {
    if prefix.is_empty() {
        seg.to_string()
    } else {
        format!("{prefix}.{seg}")
    }
}

impl<'m, 'a> Emitter<'m, 'a> {
    fn slot_meta(&self, slot: &Slot) -> (Option<u64>, String) {
        match slot {
            Slot::Prim(p) => (Some(super::model::prim_size(p)), prim_abi_name(p)),
            Slot::Node(id) => (self.r(*id).const_size, self.n(*id).type_name.clone()),
        }
    }

    /// `<N>_variants`, `<N>_VARIANT_CNT` and `<N>_variant_by_name` for an
    /// enum, size-discriminated union or union node.
    pub(super) fn emit_variant_table(&mut self, id: NodeId) {
        let n = self.n(id);
        let c = n.c_name.clone();
        let rows: Vec<VariantRow> = match &n.kind {
            NodeKind::Enum { variants, .. } => variants
                .iter()
                .map(|v| {
                    let (payload_size, payload_type) = self.slot_meta(&v.slot);
                    VariantRow {
                        name: v.name.clone(),
                        tag: v.value,
                        payload_size,
                        payload_type,
                    }
                })
                .collect(),
            NodeKind::Sdu { variants } => variants
                .iter()
                .enumerate()
                .map(|(i, v)| VariantRow {
                    name: v.name.clone(),
                    tag: i as u64,
                    payload_size: Some(v.value),
                    payload_type: self.slot_meta(&v.slot).1,
                })
                .collect(),
            NodeKind::Union { variants } => variants
                .iter()
                .enumerate()
                .map(|(i, f)| {
                    let (payload_size, payload_type) = self.slot_meta(&f.slot);
                    VariantRow {
                        name: f.name.clone(),
                        tag: i as u64,
                        payload_size,
                        payload_type,
                    }
                })
                .collect(),
            _ => return,
        };
        let table = format!("{c}_variants");
        if !self.reserve(&table) {
            return;
        }
        writeln!(self.types, "#define {c}_VARIANT_CNT ({}UL)\n", rows.len()).unwrap();
        writeln!(
            self.protos,
            "extern tn_abi_variant_t const {table}[ {c}_VARIANT_CNT+1UL ];"
        )
        .unwrap();
        let mut def = format!("tn_abi_variant_t const {table}[ {c}_VARIANT_CNT+1UL ] = {{\n");
        for r in &rows {
            let size = match r.payload_size {
                Some(s) => format!("{s}UL"),
                None => "UINT64_MAX".to_string(),
            };
            writeln!(
                def,
                "  {{ {}, {}UL, {size}, {} }},",
                c_str(&r.name),
                r.tag,
                c_str(&r.payload_type)
            )
            .unwrap();
        }
        def.push_str("  { NULL, 0UL, 0UL, NULL }\n};\n\n");
        self.defs.push_str(&def);
        self.public_fn(
            &format!("tn_abi_variant_t const * {c}_variant_by_name( char const * name )"),
            &format!("  return tn_abi_variant_find( {table}, {c}_VARIANT_CNT, name );\n"),
        );
    }

    /// Flattened leaf members of node `id`'s params struct. `member` and
    /// `path` prefix the member path and the ABI path of the node; `root`
    /// marks the struct the caller fills.
    pub fn param_key_rows(
        &self,
        id: NodeId,
        member: &str,
        path: &str,
        root: bool,
        out: &mut Vec<ParamKeyRow>,
    ) {
        let n = self.r(id);
        for m in &n.members {
            let mpath = join(member, &m.name);
            match &m.kind {
                MemberKind::BufSz => out.push(ParamKeyRow {
                    member: mpath,
                    path: join(path, BUFFER_SIZE_REF),
                    input: root,
                }),
                MemberKind::Ext(key) => {
                    /* An enclosing-scope value named like one of this
                    struct's fields reads `../<key>`. */
                    let first = key.split('.').next().unwrap_or("");
                    let shadowed = matches!(&n.kind, NodeKind::Struct { fields, .. }
                        if fields.iter().any(|f| f.name == first));
                    let key = if shadowed {
                        format!("../{key}")
                    } else {
                        key.clone()
                    };
                    out.push(ParamKeyRow {
                        member: mpath,
                        path: join(path, &key),
                        input: root,
                    })
                }
                MemberKind::Internal(i) => out.push(ParamKeyRow {
                    member: mpath,
                    path: join(path, &n.internal[*i].key),
                    input: true,
                }),
                MemberKind::JaggedBytes => out.push(ParamKeyRow {
                    member: mpath,
                    path: join(path, "__tn_bytes"),
                    input: true,
                }),
                MemberKind::Child { slot, node } => {
                    /* Child slots are named after the field or variant. */
                    let seg = match &n.kind {
                        NodeKind::Struct { fields, .. } | NodeKind::Union { variants: fields } => {
                            fields
                                .iter()
                                .find(|f| &f.ident == slot)
                                .map(|f| f.name.clone())
                        }
                        NodeKind::Enum { variants, .. } | NodeKind::Sdu { variants } => variants
                            .iter()
                            .find(|v| &v.ident == slot)
                            .map(|v| v.name.clone()),
                        _ => None,
                    }
                    .unwrap_or_else(|| slot.clone());
                    self.param_key_rows(*node, &mpath, &join(path, &seg), false, out);
                }
            }
        }
    }

    /// `<T>_param_keys` / `<T>_PARAM_KEY_CNT` for a named type.
    pub(super) fn emit_param_keys(&mut self, id: NodeId) {
        let c = self.n(id).c_name.clone();
        let table = format!("{c}_param_keys");
        if !self.reserve(&table) {
            return;
        }
        let mut rows = Vec::new();
        self.param_key_rows(id, "", "", true, &mut rows);
        writeln!(self.types, "#define {c}_PARAM_KEY_CNT ({}UL)\n", rows.len()).unwrap();
        writeln!(
            self.protos,
            "extern tn_abi_param_key_t const {table}[ {c}_PARAM_KEY_CNT+1UL ];"
        )
        .unwrap();
        let mut def = format!("tn_abi_param_key_t const {table}[ {c}_PARAM_KEY_CNT+1UL ] = {{\n");
        for r in &rows {
            writeln!(
                def,
                "  {{ {}, {}, offsetof( {c}_params_t, {} ), {} }},",
                c_str(&r.member),
                c_str(&r.path),
                r.member,
                u8::from(r.input)
            )
            .unwrap();
        }
        def.push_str("  { NULL, NULL, 0UL, 0 }\n};\n\n");
        self.defs.push_str(&def);
    }
}
