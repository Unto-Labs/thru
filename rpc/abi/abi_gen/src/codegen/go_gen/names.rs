/* Go identifiers for generated items.

Everything a user (or another generated package) calls is exported, so names
start with an upper-case letter. Names are pure functions of the ABI names,
so every package of a run (and the compliance runner) derives the same ones.
Per-view method names and per-builder method names go through an allocator
that appends `_` on a clash, in a fixed order. */

use crate::abi::types::{FloatingPointType, IntegralType, PrimitiveType};
use crate::codegen::rust_gen::model::{prim_signed, prim_size, sanitize_ident_part, to_camel};
use std::collections::{HashMap, HashSet};

pub const GO_KEYWORDS: &[&str] = &[
    "break",
    "case",
    "chan",
    "const",
    "continue",
    "default",
    "defer",
    "else",
    "fallthrough",
    "for",
    "func",
    "go",
    "goto",
    "if",
    "import",
    "interface",
    "map",
    "package",
    "range",
    "return",
    "select",
    "struct",
    "switch",
    "type",
    "var",
];

/* Method names `go vet` (stdmethods) expects a fixed signature for. */
pub const VET_METHODS: &[&str] = &[
    "Format",
    "GobDecode",
    "GobEncode",
    "MarshalJSON",
    "MarshalXML",
    "Peek",
    "ReadByte",
    "ReadFrom",
    "ReadRune",
    "Scan",
    "Seek",
    "UnmarshalJSON",
    "UnmarshalXML",
    "UnreadByte",
    "UnreadRune",
    "WriteByte",
    "WriteTo",
    "Is",
    "As",
    "Unwrap",
];

/* Make an identifier exported: upper-case first letter, `X` prefix otherwise. */
pub fn export(name: &str) -> String {
    let s = sanitize_ident_part(name);
    let mut chars = s.chars();
    match chars.next() {
        Some(c) if c.is_ascii_lowercase() => {
            let mut out = c.to_ascii_uppercase().to_string();
            out.push_str(chars.as_str());
            out
        }
        Some(c) if c.is_ascii_uppercase() => s,
        _ => format!("X{}", s),
    }
}

/* Go type name of a resolved type (`A::b::c` -> `A_b_c`). */
pub fn type_name(resolved_name: &str) -> String {
    export(&resolved_name.replace("::", "_"))
}

/* CamelCase exported name for a field / variant / parameter. */
pub fn camel(name: &str) -> String {
    let c = to_camel(name.trim_start_matches("r#"));
    export(&c)
}

/* Go package name for an ABI package (`a.b.c` -> `c`). */
pub fn package_name(package: &str) -> String {
    let last = package.rsplit('.').next().unwrap_or(package);
    let mut n = sanitize_ident_part(last);
    if n == "_" {
        n = "pkg".to_string();
    }
    if GO_KEYWORDS.contains(&n.as_str()) || n == "tnabi" || n == "main" {
        n.push('_');
    }
    n
}

/* Import alias of a generated package. */
pub fn package_alias(package: &str) -> String {
    format!("tnp_{}", sanitize_ident_part(&package.replace('.', "_")))
}

/* Distinct exported names for a list of raw names (struct fields). */
pub fn field_names(raw: &[String], reserved: &[&str]) -> Vec<String> {
    let mut used: HashSet<String> = reserved.iter().map(|s| s.to_string()).collect();
    raw.iter()
        .map(|r| {
            let mut n = camel(r);
            while used.contains(&n) {
                n.push('_');
            }
            used.insert(n.clone());
            n
        })
        .collect()
}

/* Allocator for the methods of one Go type. */
#[derive(Default, Clone)]
pub struct Names {
    used: HashSet<String>,
    map: HashMap<String, String>,
}

impl Names {
    pub fn new(reserved: &[&str]) -> Self {
        let mut used: HashSet<String> = reserved.iter().map(|s| s.to_string()).collect();
        for m in VET_METHODS {
            used.insert(m.to_string());
        }
        Self {
            used,
            map: HashMap::new(),
        }
    }

    /* Allocate `want` under `key` (idempotent per key). */
    pub fn alloc(&mut self, key: &str, want: &str) -> String {
        if let Some(n) = self.map.get(key) {
            return n.clone();
        }
        let mut n = want.to_string();
        while self.used.contains(&n) {
            n.push('_');
        }
        self.used.insert(n.clone());
        self.map.insert(key.to_string(), n.clone());
        n
    }

    pub fn get(&self, key: &str) -> String {
        self.map
            .get(key)
            .cloned()
            .unwrap_or_else(|| panic!("no Go name allocated for {key}"))
    }

    pub fn try_get(&self, key: &str) -> Option<String> {
        self.map.get(key).cloned()
    }
}

/* Distinct variant names (Camel) within one enum, avoiding `avoid`. */
pub fn variant_names<'s>(names: impl Iterator<Item = &'s str>, avoid: &[&str]) -> Vec<String> {
    let mut used: HashSet<String> = avoid.iter().map(|s| s.to_string()).collect();
    names
        .map(|n| {
            let mut c = camel(n);
            while used.contains(&c) {
                c.push('_');
            }
            used.insert(c.clone());
            c
        })
        .collect()
}

pub fn go_prim(p: &PrimitiveType) -> &'static str {
    match p {
        PrimitiveType::Integral(i) => match i {
            IntegralType::U8 | IntegralType::Char => "uint8",
            IntegralType::U16 => "uint16",
            IntegralType::U32 => "uint32",
            IntegralType::U64 => "uint64",
            IntegralType::I8 => "int8",
            IntegralType::I16 => "int16",
            IntegralType::I32 => "int32",
            IntegralType::I64 => "int64",
        },
        PrimitiveType::FloatingPoint(f) => match f {
            FloatingPointType::F16 => "uint16",
            FloatingPointType::F32 => "float32",
            FloatingPointType::F64 => "float64",
        },
    }
}

/* Raw little-endian bits (uint64 expression) -> accessor value. */
pub fn raw_to_go(p: &PrimitiveType, raw: &str) -> String {
    match p {
        PrimitiveType::FloatingPoint(FloatingPointType::F32) => format!("tnabi.F32({raw})"),
        PrimitiveType::FloatingPoint(FloatingPointType::F64) => format!("tnabi.F64({raw})"),
        _ => format!("{}({raw})", go_prim(p)),
    }
}

/* Accessor value -> raw little-endian bits (uint64). */
pub fn go_to_raw(p: &PrimitiveType, value: &str) -> String {
    match p {
        PrimitiveType::FloatingPoint(FloatingPointType::F32) => format!("tnabi.F32Bits({value})"),
        PrimitiveType::FloatingPoint(FloatingPointType::F64) => format!("tnabi.F64Bits({value})"),
        _ if prim_signed(p) => format!("uint64(int64({value}))"),
        _ => format!("uint64({value})"),
    }
}

/* A raw read widened to an expression value (sign-extended if signed). */
pub fn raw_to_value(p: &PrimitiveType, raw: &str) -> String {
    if prim_signed(p) {
        format!("tnabi.Sext({}, {})", raw, prim_size(p))
    } else {
        raw.to_string()
    }
}

/* Go string literal. */
pub fn go_str(s: &str) -> String {
    let mut out = String::from("\"");
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\t' => out.push_str("\\t"),
            '\r' => out.push_str("\\r"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\x{:02x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/* Comment text on one line, with any star-slash split so it cannot end the
block comment it is written into. The analyzer already rejects such
comments; this keeps generated Go safe if it is ever called on other text. */
pub fn one_line(s: &str) -> String {
    s.replace(['\n', '\r'], " ").replace("*/", "* /")
}
