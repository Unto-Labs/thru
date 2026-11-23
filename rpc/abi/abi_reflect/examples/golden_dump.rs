/* Golden output dumper for the Go port of abi_reflect (sdks/go/abi).

Test-only tool. For every ABI in the parity corpus it records what this crate
produces (reflected JSON, formatted JSON, dynamic params, validation, layout IR,
root and manifest reflection) for explicit and seeded generated buffers. The Go
golden test replays the same inputs and must match byte for byte.

Usage (run through sdks/go/abi/scripts/regen-goldens.sh):
  cargo run --release --example golden_dump -- <repo-root> <out-dir> [--full]

Build in release mode: Go mirrors Rust's release (wrapping) integer semantics.
Rust HashMap Debug output (`NonConstant({..})`, `Variable({..})`) is
nondeterministic, so entries of those maps are sorted here; Go emits them sorted. */

use abi_gen::abi::expr::ExprKind;
use abi_gen::abi::file::{AbiFile, ImportResolver, RootTypes};
use abi_gen::abi::resolved::{ResolvedType, ResolvedTypeKind, Size, TypeResolver};
use abi_gen::abi::types::{
    FloatingPointType, IntegralType, PrimitiveType, StructDisplay, TypeDef, TypeKind,
};
use abi_reflect::parser::ParseError;
use abi_reflect::types::{ReflectedType, ReflectedTypeKind};
use abi_reflect::value::{ReflectedValue, Value};
use abi_reflect::{
    format_reflection, format_reflection_with_options, FormatOptions, ParamMap, Parser,
    ReflectError, Reflector, ReflectorConfig,
};
use serde_json::{json, Value as J};
use std::collections::{BTreeMap, HashMap};
use std::io::Write;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};

const FUZZ_STRUCTURED: usize = 8;
const FUZZ_MUTATED: usize = 16;
const FUZZ_RANDOM: usize = 4;

struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e3779b97f4a7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d049bb133111eb);
        z ^ (z >> 31)
    }
    fn below(&mut self, n: u64) -> u64 {
        if n == 0 {
            0
        } else {
            self.next() % n
        }
    }
}

fn fnv64(s: &str) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in s.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

fn fnv128(s: &[u8]) -> String {
    let mut h: u128 = 0x6c62272e07bb014262b821756295c58d;
    for b in s {
        h ^= *b as u128;
        h = h.wrapping_mul(0x0000000001000000000000000000013B);
    }
    format!("{h:032x}")
}

fn to_hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn from_hex(s: &str) -> Vec<u8> {
    let c: String = s.chars().filter(|c| !c.is_whitespace()).collect();
    (0..c.len() / 2)
        .map(|i| u8::from_str_radix(&c[2 * i..2 * i + 2], 16).expect("hex"))
        .collect()
}

/* ---------- HashMap Debug canonicalization ---------- */

fn canon(s: &str) -> String {
    let mut out = String::new();
    let mut i = 0;
    while i < s.len() {
        let rest = &s[i..];
        let mut handled = false;
        for marker in ["NonConstant(", "Variable("] {
            if rest.starts_with(marker) && rest[marker.len()..].starts_with('{') {
                out.push_str(marker);
                let (map, used) = canon_map(&rest[marker.len()..]);
                out.push_str(&map);
                i += marker.len() + used;
                handled = true;
                break;
            }
        }
        if !handled {
            let ch = rest.chars().next().unwrap();
            out.push(ch);
            i += ch.len_utf8();
        }
    }
    out
}

/* Canonicalize a Debug map starting at '{'; returns text and bytes consumed. */
fn canon_map(s: &str) -> (String, usize) {
    let bytes = s.as_bytes();
    let (mut depth, mut in_str, mut esc) = (0i32, false, false);
    let mut entries: Vec<&str> = Vec::new();
    let mut start = 1;
    let mut end = 0;
    for (idx, &c) in bytes.iter().enumerate() {
        if in_str {
            if esc {
                esc = false;
            } else if c == b'\\' {
                esc = true;
            } else if c == b'"' {
                in_str = false;
            }
            continue;
        }
        match c {
            b'"' => in_str = true,
            b'{' | b'(' | b'[' => depth += 1,
            b'}' | b')' | b']' => {
                depth -= 1;
                if depth == 0 {
                    end = idx;
                    break;
                }
            }
            b',' if depth == 1 => {
                entries.push(&s[start..idx]);
                start = idx + 2;
            }
            _ => {}
        }
    }
    if end > start {
        entries.push(&s[start..end]);
    }
    let mut keyed: Vec<(String, String)> = entries
        .iter()
        .map(|e| {
            /* "key": value */
            let mut k = 1;
            let eb = e.as_bytes();
            let mut esc = false;
            while k < eb.len() {
                if esc {
                    esc = false;
                } else if eb[k] == b'\\' {
                    esc = true;
                } else if eb[k] == b'"' {
                    break;
                }
                k += 1;
            }
            let key = e[1..k].to_string();
            let value = &e[k + 3..];
            let value = if value.starts_with('{') {
                canon_map(value).0
            } else {
                canon(value)
            };
            (key.clone(), format!("{}: {}", &e[..k + 1], value))
        })
        .collect();
    keyed.sort_by(|a, b| a.0.cmp(&b.0));
    let joined: Vec<String> = keyed.into_iter().map(|(_, t)| t).collect();
    (format!("{{{}}}", joined.join(", ")), end + 1)
}

fn canon_type(t: &mut ReflectedType) {
    match &mut t.kind {
        ReflectedTypeKind::Struct { fields, .. } => fields
            .iter_mut()
            .for_each(|f| canon_type(&mut f.field_type)),
        ReflectedTypeKind::Union { variants } => variants
            .iter_mut()
            .for_each(|f| canon_type(&mut f.field_type)),
        ReflectedTypeKind::Enum {
            tag_constant_status,
            variants,
            ..
        } => {
            *tag_constant_status = canon(tag_constant_status);
            variants
                .iter_mut()
                .for_each(|v| canon_type(&mut v.variant_type));
        }
        ReflectedTypeKind::Array {
            element_type,
            size_constant_status,
            ..
        } => {
            *size_constant_status = canon(size_constant_status);
            canon_type(element_type);
        }
        ReflectedTypeKind::SizeDiscriminatedUnion { variants } => variants
            .iter_mut()
            .for_each(|v| canon_type(&mut v.variant_type)),
        _ => {}
    }
}

fn canon_value(v: &mut ReflectedValue) {
    canon_type(&mut v.type_info);
    match &mut v.value {
        Value::Struct { fields } | Value::Union { variants: fields } => {
            fields.iter_mut().for_each(|(_, f)| canon_value(f))
        }
        Value::Enum { variant_value, .. } | Value::SizeDiscriminatedUnion { variant_value, .. } => {
            canon_value(variant_value)
        }
        Value::Array { elements } => elements.iter_mut().for_each(canon_value),
        Value::TypeRef { value, .. } => canon_value(value),
        Value::Primitive(_) => {}
    }
}

/* ---------- output helpers ---------- */

struct Out {
    full: bool,
}

impl Out {
    fn text(&self, s: &str) -> J {
        if self.full || s.len() <= 256 {
            json!({ "t": s })
        } else {
            json!({ "h": fnv128(s.as_bytes()), "n": s.len() })
        }
    }
}

fn parse_kind(e: &ParseError) -> &'static str {
    match e {
        ParseError::InsufficientData { .. } => "InsufficientData",
        ParseError::InvalidEnumTag { .. } => "InvalidEnumTag",
        ParseError::InvalidSizeDiscriminatedUnionSize { .. } => "InvalidSizeDiscriminatedUnionSize",
        ParseError::ExpressionEvaluationFailed(_) => "ExpressionEvaluationFailed",
        ParseError::FieldReferenceFailed(_) => "FieldReferenceFailed",
        ParseError::TypeResolutionFailed(_) => "TypeResolutionFailed",
        ParseError::LimitExceeded(_) => "LimitExceeded",
    }
}

fn reflect_kind(e: &ReflectError) -> String {
    match e {
        ReflectError::IrBuild(_) => "IrBuild".into(),
        ReflectError::UnknownType { .. } => "UnknownType".into(),
        ReflectError::MissingIrParameter { .. } => "MissingIrParameter".into(),
        ReflectError::InvalidTagValue { .. } => "InvalidTagValue".into(),
        ReflectError::ArithmeticOverflow { .. } => "ArithmeticOverflow".into(),
        ReflectError::BufferTooSmall { .. } => "BufferTooSmall".into(),
        ReflectError::FieldBufferTooSmall { .. } => "FieldBufferTooSmall".into(),
        ReflectError::UnsupportedDynamicParam { .. } => "UnsupportedDynamicParam".into(),
        ReflectError::NegativeDynamicParam { .. } => "NegativeDynamicParam".into(),
        ReflectError::UnsupportedOperation { .. } => "UnsupportedOperation".into(),
        ReflectError::Parse { source, .. } => format!("Parse.{}", parse_kind(source)),
        ReflectError::MissingRootType { .. } => "MissingRootType".into(),
        ReflectError::LimitExceeded { .. } => "LimitExceeded".into(),
        ReflectError::TrailingBytes { .. } => "TrailingBytes".into(),
    }
}

fn err_json(kind: String, msg: String) -> J {
    json!({ "err": { "kind": kind, "msg": canon(&msg) } })
}

fn guarded<T>(f: impl FnOnce() -> T) -> Option<T> {
    catch_unwind(AssertUnwindSafe(f)).ok()
}

const PANIC: &str = "panic";

/* ---------- buffer generation ---------- */

struct Gen<'a> {
    res: &'a TypeResolver,
    rng: &'a mut Rng,
    vals: HashMap<String, u64>,
    out: Vec<u8>,
}

impl Gen<'_> {
    fn eval(&self, e: &ExprKind) -> Option<u64> {
        use ExprKind::*;
        Some(match e {
            Literal(_) => e.try_evaluate_constant()?,
            FieldRef(f) => {
                let last = f.path.last()?.trim_start_matches("../").to_string();
                *self.vals.get(&last)?
            }
            Add(x) => self.eval(&x.left)?.wrapping_add(self.eval(&x.right)?),
            Sub(x) => self.eval(&x.left)?.wrapping_sub(self.eval(&x.right)?),
            Mul(x) => self.eval(&x.left)?.wrapping_mul(self.eval(&x.right)?),
            Div(x) => self.eval(&x.left)?.checked_div(self.eval(&x.right)?)?,
            BitAnd(x) => self.eval(&x.left)? & self.eval(&x.right)?,
            BitOr(x) => self.eval(&x.left)? | self.eval(&x.right)?,
            Popcount(x) => self.eval(&x.operand)?.count_ones() as u64,
            Sizeof(s) => match self.res.get_type_info(&s.type_name)?.size {
                Size::Const(n) => n,
                _ => return None,
            },
            _ => return None,
        })
    }

    fn prim(&mut self, p: &PrimitiveType, name: &str) {
        let width = match p {
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
        };
        let raw: u64 = match p {
            PrimitiveType::FloatingPoint(FloatingPointType::F32) => {
                let choices = [
                    0.0f32,
                    1.0,
                    -1.5,
                    0.5,
                    f32::NAN,
                    f32::INFINITY,
                    1e20,
                    1e-8,
                    0.1,
                ];
                let pick = self.rng.below(choices.len() as u64 + 2) as usize;
                if pick < choices.len() {
                    choices[pick].to_bits() as u64
                } else {
                    self.rng.next()
                }
            }
            PrimitiveType::FloatingPoint(FloatingPointType::F64) => {
                let choices = [
                    0.0f64,
                    1.0,
                    -1.5,
                    0.5,
                    f64::NAN,
                    f64::NEG_INFINITY,
                    1e300,
                    5e-324,
                    0.1,
                    123456.789,
                ];
                let pick = self.rng.below(choices.len() as u64 + 2) as usize;
                if pick < choices.len() {
                    choices[pick].to_bits()
                } else {
                    self.rng.next()
                }
            }
            _ => match self.rng.below(10) {
                0..=5 => self.rng.below(4),
                6 => 0,
                7 => u64::MAX,
                _ => self.rng.next(),
            },
        };
        let masked = if width == 8 {
            raw
        } else {
            raw & ((1u64 << (8 * width)) - 1)
        };
        self.vals.insert(name.to_string(), masked);
        self.out.extend_from_slice(&masked.to_le_bytes()[..width]);
    }

    fn gen(&mut self, t: &ResolvedType, name: &str, depth: u32) {
        if depth > 24 || self.out.len() > 2048 {
            return;
        }
        match &t.kind {
            ResolvedTypeKind::Primitive { prim_type } => self.prim(prim_type, name),
            ResolvedTypeKind::Struct { fields, packed, .. } => {
                let start = self.out.len();
                for f in fields {
                    if !packed {
                        let a = f.field_type.alignment.max(1) as usize;
                        while (self.out.len() - start) % a != 0 {
                            self.out.push(0);
                        }
                    }
                    self.gen(&f.field_type, &f.name, depth + 1);
                }
            }
            ResolvedTypeKind::Array {
                element_type,
                size_expression,
                ..
            } => {
                let n = match self.eval(size_expression) {
                    Some(n) => n,
                    None => self.rng.below(4),
                }
                .min(48);
                for _ in 0..n {
                    self.gen(element_type, "element", depth + 1);
                }
            }
            ResolvedTypeKind::Enum {
                tag_expression,
                variants,
                ..
            } => {
                let tag = self.eval(tag_expression);
                let v = variants
                    .iter()
                    .find(|v| Some(v.tag_value) == tag)
                    .or_else(|| {
                        if variants.is_empty() {
                            None
                        } else {
                            variants.get(self.rng.below(variants.len() as u64) as usize)
                        }
                    });
                if let Some(v) = v {
                    let v = v.clone();
                    self.gen(&v.variant_type, &v.name, depth + 1);
                }
            }
            ResolvedTypeKind::SizeDiscriminatedUnion { variants } => {
                if !variants.is_empty() {
                    let v = variants[self.rng.below(variants.len() as u64) as usize].clone();
                    self.gen(&v.variant_type, &v.name, depth + 1);
                }
            }
            ResolvedTypeKind::Union { .. } => {
                if let Size::Const(n) = t.size {
                    for _ in 0..n.min(512) {
                        let b = self.rng.next() as u8;
                        self.out.push(b);
                    }
                }
            }
            ResolvedTypeKind::TypeRef { target_name, .. } => {
                if let Some(target) = self.res.get_type_info(target_name) {
                    self.gen(target, name, depth + 1);
                }
            }
        }
    }
}

fn fuzz_buffers(res: &TypeResolver, t: &ResolvedType, seed: u64) -> Vec<Vec<u8>> {
    let mut rng = Rng(seed);
    let mut out = vec![Vec::new()];
    let mut structured = Vec::new();
    for _ in 0..FUZZ_STRUCTURED {
        let mut g = Gen {
            res,
            rng: &mut rng,
            vals: HashMap::new(),
            out: Vec::new(),
        };
        g.gen(t, "", 0);
        structured.push(g.out);
    }
    for i in 0..FUZZ_MUTATED {
        let mut b = structured[i % structured.len()].clone();
        match rng.below(5) {
            3 if !b.is_empty() => {
                /* saturate a window: huge counts and tags */
                let i = rng.below(b.len() as u64) as usize;
                for x in b.iter_mut().skip(i).take(1 + rng.below(8) as usize) {
                    *x = 0xff;
                }
            }
            4 if !b.is_empty() => {
                let i = rng.below(b.len() as u64) as usize;
                b[i] = rng.below(4) as u8;
            }
            0 if !b.is_empty() => {
                let n = rng.below(b.len() as u64) as usize;
                b.truncate(n);
            }
            1 if !b.is_empty() => {
                let i = rng.below(b.len() as u64) as usize;
                b[i] ^= 1 << rng.below(8);
            }
            _ => {
                for _ in 0..1 + rng.below(8) {
                    b.push(rng.next() as u8);
                }
            }
        }
        out.push(b);
    }
    out.extend(structured);
    for i in 0..FUZZ_RANDOM {
        let len = match (i, &t.size) {
            (0, Size::Const(n)) => (*n).min(4096) as usize,
            _ => rng.below(64) as usize,
        };
        out.push((0..len).map(|_| rng.next() as u8).collect());
    }
    out
}

/* ---------- suites ---------- */

struct Case {
    ty: String,
    data: Vec<u8>,
    src: &'static str,
}

struct Suite {
    name: String,
    abi: PathBuf,
    explicit: Vec<Case>,
    raw_parse: bool,
    manifest: bool,
}

fn rel(root: &Path, p: &Path) -> String {
    let c = p.canonicalize().unwrap();
    let r = root.canonicalize().unwrap();
    c.strip_prefix(&r)
        .unwrap()
        .to_string_lossy()
        .replace('\\', "/")
}

fn collect_suites(root: &Path) -> Vec<Suite> {
    let mut suites: BTreeMap<String, Suite> = BTreeMap::new();
    let compliance = root.join("rpc/abi/abi_gen/tests/compliance_tests");
    let mut case_files = Vec::new();
    let mut stack = vec![compliance.join("test_cases")];
    while let Some(dir) = stack.pop() {
        for e in std::fs::read_dir(&dir).unwrap().flatten() {
            let p = e.path();
            if p.is_dir() {
                stack.push(p);
            } else if p.extension().and_then(|x| x.to_str()) == Some("yaml") {
                case_files.push(p);
            }
        }
    }
    case_files.sort();
    for f in case_files {
        let doc: serde_json::Value =
            serde_yml::from_str(&std::fs::read_to_string(&f).unwrap()).unwrap();
        let tc = &doc["test-case"];
        let abi = f
            .parent()
            .unwrap()
            .join(tc["abi-file"].as_str().unwrap())
            .canonicalize()
            .unwrap();
        let stem = abi
            .file_name()
            .unwrap()
            .to_string_lossy()
            .trim_end_matches(".abi.yaml")
            .to_string();
        let s = suites
            .entry(format!("compliance__{stem}"))
            .or_insert_with(|| Suite {
                name: format!("compliance__{stem}"),
                abi: abi.clone(),
                explicit: Vec::new(),
                raw_parse: false,
                manifest: false,
            });
        s.explicit.push(Case {
            ty: tc["type"].as_str().unwrap().to_string(),
            data: from_hex(tc["binary-hex"].as_str().unwrap_or("")),
            src: "compliance",
        });
    }
    /* compliance binary fixtures: every .bin against every type of its ABI */
    let bins = compliance.join("binary_data");
    let mut dirs: Vec<_> = std::fs::read_dir(&bins)
        .unwrap()
        .flatten()
        .map(|e| e.path())
        .collect();
    dirs.sort();
    for dir in dirs {
        let stem = dir.file_name().unwrap().to_string_lossy().to_string();
        let abi = compliance
            .join("abi_definitions")
            .join(format!("{stem}.abi.yaml"));
        let mut files: Vec<_> = std::fs::read_dir(&dir)
            .unwrap()
            .flatten()
            .map(|e| e.path())
            .collect();
        files.sort();
        let file: AbiFile = serde_yml::from_str(&std::fs::read_to_string(&abi).unwrap()).unwrap();
        let s = suites
            .entry(format!("compliance__{stem}"))
            .or_insert_with(|| Suite {
                name: format!("compliance__{stem}"),
                abi: abi.clone(),
                explicit: Vec::new(),
                raw_parse: false,
                manifest: false,
            });
        for f in files {
            let data = std::fs::read(&f).unwrap();
            for t in &file.types {
                s.explicit.push(Case {
                    ty: t.name.clone(),
                    data: data.clone(),
                    src: "binary_data",
                });
            }
        }
    }
    /* abi_reflect test inputs extracted to sdks/go/abi/testdata/abis */
    let abis = root.join("sdks/go/abi/testdata/abis");
    let cases: Vec<BTreeMap<String, String>> =
        serde_yml::from_str(&std::fs::read_to_string(abis.join("cases.yaml")).unwrap()).unwrap();
    let mut files: Vec<_> = std::fs::read_dir(&abis)
        .unwrap()
        .flatten()
        .map(|e| e.path())
        .collect();
    files.sort();
    for f in files {
        let fname = f.file_name().unwrap().to_string_lossy().to_string();
        if !fname.ends_with(".abi.yaml") {
            continue;
        }
        let stem = fname.trim_end_matches(".abi.yaml").to_string();
        let explicit = cases
            .iter()
            .filter(|c| c["abi"] == fname)
            .map(|c| Case {
                ty: c["type"].clone(),
                data: from_hex(&c["hex"]),
                src: "rust_tests",
            })
            .collect();
        suites.insert(
            format!("rusttests__{stem}"),
            Suite {
                name: format!("rusttests__{stem}"),
                abi: f,
                explicit,
                raw_parse: true,
                manifest: false,
            },
        );
    }
    /* type library */
    let lib = root.join("rpc/abi/type-library");
    let mut files: Vec<_> = std::fs::read_dir(&lib)
        .unwrap()
        .flatten()
        .map(|e| e.path())
        .collect();
    files.sort();
    for f in files {
        let fname = f.file_name().unwrap().to_string_lossy().to_string();
        if !fname.ends_with(".abi.yaml") {
            continue;
        }
        let stem = fname.trim_end_matches(".abi.yaml").to_string();
        suites.insert(
            format!("typelib__{stem}"),
            Suite {
                name: format!("typelib__{stem}"),
                abi: f,
                explicit: Vec::new(),
                raw_parse: false,
                manifest: true,
            },
        );
    }
    suites.into_values().collect()
}

/* The goldens pin wire decoding, which the Go SDK mirrors. Go skips display
   info (headings, synthetic fields), so drop it before decoding: an ABI that
   adds display info leaves its goldens unchanged. */
fn strip_display(kind: &mut TypeKind) {
    match kind {
        TypeKind::Struct(s) => {
            s.display = StructDisplay::default();
            for f in &mut s.fields {
                strip_display(&mut f.field_type);
            }
        }
        TypeKind::Union(u) => u.variants.iter_mut().for_each(|v| strip_display(&mut v.variant_type)),
        TypeKind::Enum(e) => e.variants.iter_mut().for_each(|v| strip_display(&mut v.variant_type)),
        TypeKind::Array(a) => strip_display(&mut a.element_type),
        TypeKind::SizeDiscriminatedUnion(u) => {
            u.variants.iter_mut().for_each(|v| strip_display(&mut v.variant_type))
        }
        _ => {}
    }
}

fn wire_only(td: &TypeDef) -> TypeDef {
    let mut td = td.clone();
    strip_display(&mut td.kind);
    td
}

/* Manifest of package -> YAML for a file and its path imports. */
fn manifest_for(path: &Path, out: &mut BTreeMap<String, (String, PathBuf)>) {
    let text = std::fs::read_to_string(path).unwrap();
    let file: AbiFile = serde_yml::from_str(&text).unwrap();
    for imp in file.imports() {
        if let Some(p) = imp.path() {
            manifest_for(&path.parent().unwrap().join(p), out);
        }
    }
    out.insert(file.package().to_string(), (text, path.to_path_buf()));
}

/* Mirror of abi_reflect_wasm::build_reflector_from_manifest. */
fn reflector_from_manifest(
    manifest: &HashMap<String, String>,
    root_package: &str,
) -> Result<Reflector, String> {
    let root: AbiFile = serde_yml::from_str(&manifest[root_package]).map_err(|e| e.to_string())?;
    let mut resolver = TypeResolver::new();
    for yaml in manifest.values() {
        let f: AbiFile = serde_yml::from_str(yaml).map_err(|e| e.to_string())?;
        for td in &f.types {
            resolver.add_typedef(wire_only(td));
        }
    }
    resolver
        .resolve_all()
        .map_err(|e| format!("Failed to resolve types: {e:?}"))?;
    Reflector::with_root_types(
        resolver,
        ReflectorConfig::default(),
        root.root_types().clone(),
    )
    .map_err(|e| format!("Reflection error: {e}"))
}

fn reflect_json(r: Result<ReflectedValue, ReflectError>, out: &Out) -> (J, Option<ReflectedValue>) {
    match r {
        Ok(mut v) => {
            canon_value(&mut v);
            let s = serde_json::to_string(&v).unwrap();
            (out.text(&s), Some(v))
        }
        Err(e) => (err_json(reflect_kind(&e), e.to_string()), None),
    }
}

fn run_suite(root: &Path, suite: &Suite, out: &Out, dir: &Path) -> usize {
    let mut lines: Vec<J> = Vec::new();
    let mut header = json!({ "abi": rel(root, &suite.abi), "raw_parse": suite.raw_parse });
    let mut loader = ImportResolver::new(vec![]);
    if let Err(e) = loader.load_file_with_imports(&suite.abi, false) {
        header["construct"] = json!({ "load_err": e.to_string() });
        write_lines(dir, &suite.name, &[header]);
        return 0;
    }
    let roots: RootTypes = loader.get_all_files().last().unwrap().root_types().clone();
    let own: Vec<String> = loader
        .get_all_files()
        .last()
        .unwrap()
        .types
        .iter()
        .map(|t| t.name.clone())
        .collect();
    let mut resolver = TypeResolver::new();
    for td in loader.get_all_types() {
        resolver.add_typedef(wire_only(td));
    }
    if let Err(e) = resolver.resolve_all() {
        header["construct"] = json!({ "resolve_err": canon(&format!("{e:?}")) });
        write_lines(dir, &suite.name, &[header]);
        return 0;
    }
    let raw_resolver = {
        let mut r = TypeResolver::new();
        for td in loader.get_all_types() {
            r.add_typedef(wire_only(td));
        }
        r.resolve_all().unwrap();
        r
    };
    let reflector =
        match Reflector::with_root_types(resolver, ReflectorConfig::default(), roots.clone()) {
            Ok(r) => r,
            Err(e) => {
                header["construct"] = err_json(reflect_kind(&e), e.to_string());
                write_lines(dir, &suite.name, &[header]);
                return 0;
            }
        };
    header["construct"] = json!("ok");
    header["layout_ir"] = out.text(&serde_json::to_string(reflector.layout_ir()).unwrap());

    /* manifest (type library): skip when two packages declare one type name,
    because the wasm crate's HashMap order then decides the result. */
    let mut manifest_reflector = None;
    if suite.manifest {
        let mut m = BTreeMap::new();
        manifest_for(&suite.abi, &mut m);
        let root_file: AbiFile =
            serde_yml::from_str(&std::fs::read_to_string(&suite.abi).unwrap()).unwrap();
        let mut seen = HashMap::new();
        let mut dup = false;
        for (pkg, (text, _)) in &m {
            let f: AbiFile = serde_yml::from_str(text).unwrap();
            for t in f.types {
                if seen.insert(t.name, pkg.clone()).is_some() {
                    dup = true;
                }
            }
        }
        let packages: BTreeMap<String, String> = m
            .iter()
            .map(|(k, (_, p))| (k.clone(), rel(root, p)))
            .collect();
        header["manifest"] =
            json!({ "root_package": root_file.package(), "packages": packages, "dup": dup });
        if !dup {
            let hm: HashMap<String, String> = m.into_iter().map(|(k, (t, _))| (k, t)).collect();
            match reflector_from_manifest(&hm, root_file.package()) {
                Ok(r) => manifest_reflector = Some(r),
                Err(e) => header["manifest"]["err"] = json!(e),
            }
        }
    }

    let mut cases: Vec<Case> = Vec::new();
    for c in &suite.explicit {
        cases.push(Case {
            ty: c.ty.clone(),
            data: c.data.clone(),
            src: c.src,
        });
    }
    for ty in &own {
        if let Some(t) = reflector.resolver().get_type_info(ty) {
            let seed = fnv64(&format!("{}::{}", suite.name, ty));
            for b in fuzz_buffers(reflector.resolver(), t, seed) {
                cases.push(Case {
                    ty: ty.clone(),
                    data: b,
                    src: "fuzz",
                });
            }
        }
    }

    /* root reflection with the first buffer of the root type, or empty */
    let mut root_ops = serde_json::Map::new();
    for (kind, name) in [
        ("instruction", &roots.instruction_root),
        ("account", &roots.account_root),
        ("events", &roots.events),
    ] {
        let data = name
            .as_ref()
            .and_then(|n| cases.iter().find(|c| &c.ty == n && !c.data.is_empty()))
            .map(|c| c.data.clone())
            .unwrap_or_default();
        let r = guarded(|| match kind {
            "instruction" => reflector.reflect_instruction(&data),
            "account" => reflector.reflect_account(&data),
            _ => reflector.reflect_event(&data),
        });
        let v = match r {
            None => json!(PANIC),
            Some(r) => reflect_json(r, out).0,
        };
        root_ops.insert(kind.into(), json!({ "hex": to_hex(&data), "out": v }));
    }
    header["roots"] = J::Object(root_ops);
    lines.push(header);

    let with_offsets = FormatOptions {
        include_byte_offsets: true,
        ..FormatOptions::default()
    };
    let wasm_opts: FormatOptions = serde_json::from_str(r#"{"includeByteOffsets":true}"#).unwrap();
    for c in &cases {
        let mut ops = serde_json::Map::new();
        let data = &c.data;
        let reflected = guarded(|| reflector.reflect(data, &c.ty));
        let value = match reflected {
            None => {
                ops.insert("reflect".into(), json!(PANIC));
                None
            }
            Some(r) => {
                let (j, v) = reflect_json(r, out);
                ops.insert("reflect".into(), j);
                v
            }
        };
        if let Some(v) = &value {
            let fmt = |o: &FormatOptions| {
                guarded(|| serde_json::to_string(&format_reflection_with_options(v, o)).unwrap())
            };
            let put = |ops: &mut serde_json::Map<String, J>, k: &str, r: Option<String>| {
                ops.insert(k.into(), r.map(|s| out.text(&s)).unwrap_or(json!(PANIC)));
            };
            put(
                &mut ops,
                "fmt",
                guarded(|| serde_json::to_string(&format_reflection(v)).unwrap()),
            );
            put(&mut ops, "fmt_off", fmt(&with_offsets));
            put(
                &mut ops,
                "fmt_plain",
                fmt(&FormatOptions::without_well_known_types()),
            );
            let raw = serde_json::to_string(v).unwrap();
            let wasm = |opts: Option<&FormatOptions>| {
                guarded(|| match serde_json::from_str::<ReflectedValue>(&raw) {
                    Ok(rv) => serde_json::to_string(&match opts {
                        None => format_reflection(&rv),
                        Some(o) => format_reflection_with_options(&rv, o),
                    })
                    .unwrap(),
                    Err(e) => format!("Serialization error: {e}"),
                })
            };
            put(&mut ops, "fmt_wasm", wasm(None));
            put(&mut ops, "fmt_wasm_off", wasm(Some(&wasm_opts)));
        }
        let params = guarded(|| reflector.dynamic_params(&c.ty, data));
        ops.insert(
            "params".into(),
            match params {
                None => json!(PANIC),
                Some(Ok(p)) => out.text(&serde_json::to_string(&p).unwrap()),
                Some(Err(e)) => err_json(reflect_kind(&e), e.to_string()),
            },
        );
        let validate = guarded(|| reflector.validate_buffer(&c.ty, data));
        ops.insert(
            "validate".into(),
            match validate {
                None => json!(PANIC),
                Some(Ok(r)) => out.text(&r.bytes_consumed.to_string()),
                Some(Err(e)) => err_json(reflect_kind(&e), e.to_string()),
            },
        );
        if suite.raw_parse {
            let r = guarded(|| match raw_resolver.get_type_info(&c.ty) {
                Some(t) => Parser::new(&raw_resolver, ParamMap::new())
                    .parse(data, t)
                    .map_err(|e| (parse_kind(&e), e.to_string())),
                None => Err(("Missing", c.ty.clone())),
            });
            ops.insert(
                "parse_raw".into(),
                match r {
                    None => json!(PANIC),
                    Some(Ok(mut v)) => {
                        canon_value(&mut v);
                        out.text(&serde_json::to_string(&v).unwrap())
                    }
                    Some(Err((k, m))) => err_json(k.to_string(), m),
                },
            );
        }
        if let Some(mr) = &manifest_reflector {
            let r = guarded(|| mr.reflect(data, &c.ty));
            ops.insert(
                "manifest".into(),
                match r {
                    None => json!(PANIC),
                    Some(r) => reflect_json(r, out).0,
                },
            );
        }
        lines.push(json!({ "type": c.ty, "hex": to_hex(data), "src": c.src, "ops": ops }));
    }
    let n = lines.len() - 1;
    write_lines(dir, &suite.name, &lines);
    n
}

fn write_lines(dir: &Path, name: &str, lines: &[J]) {
    let mut f = std::fs::File::create(dir.join(format!("{name}.jsonl"))).unwrap();
    for l in lines {
        writeln!(f, "{}", serde_json::to_string(l).unwrap()).unwrap();
    }
}

/* ---------- primitive formatting parity (serde_json, std fmt, UTF-8) ---------- */

fn dump_primitives(dir: &Path) -> usize {
    let mut rng = Rng(fnv64("primitives"));
    let mut lines = Vec::new();
    let mut json_inputs: Vec<String> = [
        "", " ", "{}", "[]", "[1,2,]", "{\"a\":1,}", "{\"a\" 1}", "{1:2}", "[1 2]", "tru", "nul", "-",
        "01", "1.", "1e", "1e+", "-0", "-0.0", "1.5e308", "1e309", "-1e400", "1e-400", "123456789012345678901234",
        "-9223372036854775808", "-9223372036854775809", "18446744073709551615", "18446744073709551616",
        "0.1", "2.5e-8", "\"\\u00e9\\ud83d\\ude00\"", "\"\\ud800\"", "\"\\udc00\"", "\"\\ud800x\"", "\"\\ud800\\x\"",
        "\"\\q\"", "\"\\u12\"", "\"\\u12zz\"", "\"a\u{1}b\"", "\"unterminated", "{\"a\":{\"b\":[true,false,null]}}",
        "{\"k\":1,\"k\":2,\"j\":3}", "  {\"x\" : [ 1 , 2.0 , -3e2 ] }  ", "[1] x", "\n\n  ]", "{\"a\":1\n,\n\"b\"}",
        "[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[]]",
        "{\"ok\":true}", "1e5", "1E-7", "123e-2", "4.9e-324", "2.2250738585072011e-308", "\"/\\/\\b\\f\\n\\r\\t\"",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    let alphabet: Vec<char> = "{}[]\",:0123456789.eE+-truefalsn \\u\n".chars().collect();
    for _ in 0..3000 {
        let len = 1 + rng.below(14) as usize;
        json_inputs.push(
            (0..len)
                .map(|_| alphabet[rng.below(alphabet.len() as u64) as usize])
                .collect(),
        );
    }
    for input in &json_inputs {
        let out = match serde_json::from_str::<J>(input) {
            Ok(v) => {
                json!({ "ok": serde_json::to_string(&v).unwrap(), "pretty": serde_json::to_string_pretty(&v).unwrap() })
            }
            Err(e) => json!({ "err": e.to_string() }),
        };
        lines.push(json!({ "kind": "json", "in": input, "out": out }));
    }
    let special64 = [
        0.0f64,
        -0.0,
        1.0,
        0.1,
        1e15,
        1e16,
        1e-5,
        1e-4,
        123456.789,
        5e-324,
        f64::MAX,
        f64::MIN_POSITIVE,
        0.0078125,
        2.5,
        1e21,
        9007199254740993.0,
    ];
    for i in 0..6000 {
        let f = if i < special64.len() {
            special64[i]
        } else if i % 3 == 0 {
            (rng.next() >> 11) as f64 / (1u64 << (rng.below(60) + 1)) as f64
        } else {
            f64::from_bits(rng.next())
        };
        lines.push(
            json!({ "kind": "f64", "in": format!("{:016x}", f.to_bits()),
            "json": serde_json::to_string(&f).unwrap(), "debug": format!("{f:?}"),
            "fixed6": format!("{f:.6}"), "fixed9": format!("{f:.9}") }),
        );
        let g = f32::from_bits(rng.next() as u32);
        lines.push(json!({ "kind": "f32", "in": format!("{:08x}", g.to_bits()),
            "json": serde_json::to_string(&g).unwrap(), "debug": format!("{g:?}"),
            "widened": serde_json::to_string(&J::from(g)).unwrap() }));
    }
    for _ in 0..3000 {
        let len = rng.below(10) as usize;
        let bytes: Vec<u8> = (0..len)
            .map(|_| match rng.below(4) {
                0 => rng.next() as u8,
                1 => 0x80 | rng.below(0x40) as u8,
                2 => 0xc0 | rng.below(0x40) as u8,
                _ => b'a',
            })
            .collect();
        let err = std::str::from_utf8(&bytes).err().map(|e| e.to_string());
        lines.push(json!({ "kind": "utf8", "in": to_hex(&bytes), "err": err, "lossy": String::from_utf8_lossy(&bytes) }));
    }
    let n = lines.len();
    write_lines(dir, "primitives", &lines);
    n
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 3 {
        eprintln!("usage: golden_dump <repo-root> <out-dir> [--full]");
        std::process::exit(2);
    }
    std::panic::set_hook(Box::new(|_| {}));
    let root = PathBuf::from(&args[1]);
    let dir = PathBuf::from(&args[2]);
    std::fs::create_dir_all(&dir).unwrap();
    let out = Out {
        full: args.iter().any(|a| a == "--full"),
    };
    let mut total = 0;
    for suite in collect_suites(&root) {
        let n = run_suite(&root, &suite, &out, &dir);
        eprintln!("{}: {} cases", suite.name, n);
        total += n;
    }
    eprintln!("total: {total} cases");
    eprintln!("primitives: {} cases", dump_primitives(&dir));
}
