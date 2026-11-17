//! File-scope C names.
//!
//! Every identifier the C backend emits at file scope (type and struct
//! names, params structs, functions, static helpers, macros, tables and the
//! IR helpers) is `<prefix><suffix>`, where the prefix is a node's `c_name`.
//! A declared type can therefore spell another type's generated name (a
//! declared `Message_params` and the `Message_params_t` of `Message`, a
//! declared `Foo_bar` and the inline type of field `bar` of `Foo`), and the
//! package no longer compiles.
//!
//! The emitter writes each prefix as a token naming its node (see
//! [`Model::tokenized`]), so every name in the text is a key (node, suffix).
//! One table allocates a C name to every key of the codegen run's whole type
//! set (every package builds that set, so every package computes the same
//! names, and names from included package headers cannot clash either). In
//! this order, appending `_` to a name already taken:
//!
//! 0. the runtime's `tn_*` / `TN_*` names and the standard C names the
//!    generated code uses;
//! 1. the declared types, sorted by ABI name: the prefix `T` (struct tag)
//!    and `T_t` (both get the same `_` suffix);
//! 2. their inline types (`T_field...`), the same way, in declaration order;
//! 3. every other name of each type (same type order), in emission order:
//!    `<prefix><suffix>` with the prefix allocated above.
//!
//! Struct tags, ordinary identifiers and macros are separate: a tag clashes
//! with tags and macros, an ordinary name with ordinary names and macros, a
//! macro with everything. Names inside comments and string literals follow
//! their key but claim nothing. Without a clash every name is the plain
//! `<c_name><suffix>`.

use super::model::{Model, NodeId};
use std::collections::{BTreeMap, BTreeSet, HashMap};

const TOKEN_START: char = '\u{1}';
const TOKEN_END: char = '\u{2}';

/// The prefix the emitter writes for node `id`.
pub fn token(id: NodeId) -> String {
    format!("{TOKEN_START}{id}{TOKEN_END}")
}

/// Standard names the generated code uses at file scope.
const STD_NAMES: &[&str] = &[
    "int8_t",
    "int16_t",
    "int32_t",
    "int64_t",
    "uint8_t",
    "uint16_t",
    "uint32_t",
    "uint64_t",
    "intptr_t",
    "uintptr_t",
    "size_t",
    "ptrdiff_t",
    "NULL",
    "UINT64_MAX",
    "offsetof",
    "memcpy",
    "memset",
    "strcmp",
];

const NS_TAG: u8 = 1;
const NS_ORD: u8 = 2;
const NS_MACRO: u8 = 4;

#[derive(Clone, Copy, PartialEq)]
enum Ctx {
    /// Inside a comment or a string / character literal.
    Text,
    Code(u8),
}

/// A name in the text: a token-prefixed key or a plain identifier.
enum Word<'t> {
    Key(NodeId, &'t str),
    Plain(&'t str),
}

fn ident_char(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_'
}

/// Calls `f` for every name in `text` with its context, in order.
fn scan<'t>(text: &'t str, mut f: impl FnMut(Word<'t>, Ctx, std::ops::Range<usize>)) {
    let b = text.as_bytes();
    let mut i = 0;
    /* The next name declares a struct tag (after `struct` / `union` /
    `enum`) or a macro (after `#define`). */
    let mut pending: u8 = 0;
    let mut directive = false;
    let mut in_text: Option<&[u8]> = None;
    while i < b.len() {
        if let Some(end) = in_text {
            if b[i..].starts_with(end) {
                i += end.len();
                in_text = None;
                continue;
            }
            if end != b"*/" && end != b"\n" && b[i] == b'\\' {
                i += 2;
                continue;
            }
        } else if b[i..].starts_with(b"/*") {
            in_text = Some(b"*/");
            i += 2;
            continue;
        } else if b[i..].starts_with(b"//") {
            in_text = Some(b"\n");
            i += 2;
            continue;
        } else if b[i] == b'"' {
            in_text = Some(b"\"");
            i += 1;
            continue;
        } else if b[i] == b'\'' {
            in_text = Some(b"'");
            i += 1;
            continue;
        }
        let ctx = if in_text.is_some() {
            Ctx::Text
        } else {
            Ctx::Code(if pending != 0 { pending } else { NS_ORD })
        };
        let c = b[i];
        if c == TOKEN_START as u8 {
            let start = i;
            let mut j = i + 1;
            while j < b.len() && b[j].is_ascii_digit() {
                j += 1;
            }
            let id: NodeId = text[i + 1..j].parse().expect("C name token");
            debug_assert_eq!(b[j], TOKEN_END as u8);
            j += 1;
            let s = j;
            while j < b.len() && ident_char(b[j]) {
                j += 1;
            }
            f(Word::Key(id, &text[s..j]), ctx, start..j);
            if in_text.is_none() {
                pending = 0;
            }
            i = j;
            continue;
        }
        if c.is_ascii_alphabetic() || c == b'_' {
            let start = i;
            while i < b.len() && ident_char(b[i]) {
                i += 1;
            }
            let w = &text[start..i];
            if in_text.is_some() {
                f(Word::Plain(w), ctx, start..i);
                continue;
            }
            if directive {
                directive = false;
                if w == "define" {
                    pending = NS_MACRO;
                }
                continue;
            }
            match w {
                "struct" | "union" | "enum" => pending = NS_TAG,
                "__attribute__" if pending == NS_TAG => {
                    /* `struct __attribute__((packed)) T {`: skip the parens. */
                    let mut depth = 0usize;
                    while i < b.len() {
                        match b[i] {
                            b'(' => depth += 1,
                            b')' => {
                                depth -= 1;
                                if depth == 0 {
                                    i += 1;
                                    break;
                                }
                            }
                            _ => {}
                        }
                        i += 1;
                    }
                }
                _ => {
                    f(Word::Plain(w), ctx, start..i);
                    pending = 0;
                }
            }
            continue;
        }
        if in_text.is_none() {
            if c == b'#' {
                directive = true;
            } else if !c.is_ascii_whitespace() {
                pending = 0;
                directive = false;
            }
        }
        i += 1;
    }
}

/// The C name of every (node, suffix) key of a codegen run.
pub struct NameTable {
    names: HashMap<(NodeId, String), String>,
}

#[derive(Default)]
struct Taken {
    tags: BTreeSet<String>,
    ords: BTreeSet<String>,
    macros: BTreeSet<String>,
}

impl Taken {
    fn clashes(&self, name: &str, ns: u8) -> bool {
        let tag = ns & NS_TAG != 0;
        let ord = ns & NS_ORD != 0;
        let mac = ns & NS_MACRO != 0;
        self.macros.contains(name)
            || ((tag || mac) && self.tags.contains(name))
            || ((ord || mac) && self.ords.contains(name))
    }

    fn claim(&mut self, name: &str, ns: u8) {
        if ns & NS_TAG != 0 {
            self.tags.insert(name.to_string());
        }
        if ns & NS_ORD != 0 {
            self.ords.insert(name.to_string());
        }
        if ns & NS_MACRO != 0 {
            self.macros.insert(name.to_string());
        }
    }
}

impl NameTable {
    /// Allocates the names of every key in `text` (the tokenized emission of
    /// the whole type set); `runtime` is the fixed C text.
    pub fn build(model: &Model<'_>, text: &str, runtime: &str) -> Self {
        let mut taken = Taken::default();
        /* 0. runtime and standard names */
        scan(runtime, |w, ctx, _| {
            if let (Word::Plain(w), Ctx::Code(ns)) = (w, ctx) {
                let runtime_name = w.starts_with("tn_") || w.starts_with("TN_");
                if runtime_name {
                    taken.claim(w, ns);
                }
            }
        });
        for n in STD_NAMES {
            taken.claim(n, NS_TAG | NS_ORD | NS_MACRO);
        }

        /* Keys per node in order of first appearance, with their namespaces. */
        let mut keys: BTreeMap<NodeId, Vec<(String, u8)>> = BTreeMap::new();
        let mut seen: HashMap<(NodeId, String), usize> = HashMap::new();
        scan(text, |w, ctx, _| {
            let Word::Key(id, suffix) = w else { return };
            let ns = match ctx {
                Ctx::Text => 0,
                Ctx::Code(ns) => ns,
            };
            let list = keys.entry(id).or_default();
            match seen.get(&(id, suffix.to_string())) {
                Some(&k) => list[k].1 |= ns,
                None => {
                    seen.insert((id, suffix.to_string()), list.len());
                    list.push((suffix.to_string(), ns));
                }
            }
        });

        /* Type order: declared types by ABI name, each followed by its
        inline types. */
        let mut declared: Vec<(String, NodeId)> = model
            .named_ids()
            .map(|(name, id)| (name.to_string(), id))
            .collect();
        declared.sort();
        let mut order: Vec<NodeId> = Vec::new();
        let mut placed = BTreeSet::new();
        for (_, id) in &declared {
            if placed.insert(*id) {
                order.push(*id);
            }
        }
        let mut inline = Vec::new();
        for (_, id) in &declared {
            let mut nodes = Vec::new();
            model.inline_preorder(*id, &mut nodes);
            for n in nodes {
                if placed.insert(n) {
                    inline.push(n);
                }
            }
        }
        /* Every type with keys gets a place (none should be left). */
        let rest: Vec<NodeId> = keys
            .keys()
            .copied()
            .filter(|id| !placed.contains(id))
            .collect();
        order.extend(inline);
        order.extend(rest);

        /* 1. and 2. type names */
        let mut prefix: HashMap<NodeId, String> = HashMap::new();
        for id in &order {
            let base = model.node(*id).c_name.clone();
            let types: Vec<(String, u8)> = keys
                .get(id)
                .map(|l| {
                    l.iter()
                        .filter(|(s, ns)| *ns != 0 && (s.is_empty() || s == "_t"))
                        .cloned()
                        .collect()
                })
                .unwrap_or_default();
            let mut p = base;
            while types
                .iter()
                .any(|(s, ns)| taken.clashes(&format!("{p}{s}"), *ns))
            {
                p.push('_');
            }
            for (s, ns) in &types {
                taken.claim(&format!("{p}{s}"), *ns);
            }
            prefix.insert(*id, p);
        }

        /* 3. every other name */
        let mut names = HashMap::new();
        for id in &order {
            let p = &prefix[id];
            let Some(list) = keys.get(id) else { continue };
            for (s, ns) in list {
                let mut name = format!("{p}{s}");
                let is_type = *ns != 0 && (s.is_empty() || s == "_t");
                if !is_type {
                    while *ns != 0 && taken.clashes(&name, *ns) {
                        name.push('_');
                    }
                    taken.claim(&name, *ns);
                }
                names.insert((*id, s.clone()), name);
            }
        }
        NameTable { names }
    }

    /// `text` with every token-prefixed name replaced by its C name. Keys the
    /// table lacks keep their plain `<c_name><suffix>`.
    pub fn apply(&self, model: &Model<'_>, text: &str) -> String {
        let mut out = String::with_capacity(text.len());
        let mut last = 0;
        scan(text, |w, _, range| {
            let Word::Key(id, suffix) = w else { return };
            out.push_str(&text[last..range.start]);
            match self.names.get(&(id, suffix.to_string())) {
                Some(name) => out.push_str(name),
                None => {
                    out.push_str(&model.node(id).c_name);
                    out.push_str(suffix);
                }
            }
            last = range.end;
        });
        out.push_str(&text[last..]);
        out
    }
}
