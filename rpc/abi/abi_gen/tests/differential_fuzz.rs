/* Differential fuzz: generated Rust vs generated Go (vs generated C).
 *
 * For every named type that validates without outside context in the
 * compliance ABIs, `tests/compliance_data` and the type-library ABIs below,
 * the same buffers (the compliance cases, their truncations and mutations,
 * zero buffers and their mutations, random buffers) go through
 *   - Rust `T::validate` and `TParams::from_buffer(..).footprint()`,
 *   - Go `ValidateT` and `TParamsFromBuffer(..).Footprint()` (plus every
 *     getter of the view, which must not panic on any input),
 *   - C `T_validate` / `T_params_from_buffer` + `T_footprint_from_params`
 *     when a working C toolchain is present.
 * Rust and Go must agree exactly: ok and the consumed size, or the error kind
 * and, for a short buffer, the required size; and the params footprint. C
 * must agree on ok/err and the consumed size, on the footprint, and its
 * short-buffer required size (when it reports one) must be Rust's.
 *
 * Deterministic (fixed seed). `ABI_FUZZ_ITERS` scales the mutation and random
 * counts per seed/type (default 12). Skipped when `go` is missing unless
 * `ABI_REQUIRE_GO` is set; C is skipped when no C toolchain links. */

use abi_gen::abi::file::{AbiFile, ImportResolver};
use abi_gen::abi::resolved::{ResolvedType, ResolvedTypeKind, TypeResolver};
use abi_gen::cmds::codegen::{self, CodegenOptions, Language};
use abi_gen::cmds::common::{analyze_and_resolve_types, normalize_type_refs};
use abi_gen::codegen::go_gen::emit::GoEmitter;
use abi_gen::codegen::go_gen::names::Names;
use abi_gen::codegen::rust_gen::emit::{Elem, Shape, VInfo};
use abi_gen::codegen::rust_gen::model::{Model, escape_ident, view_name};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const TYPE_LIBRARY_ABIS: &[&str] = &[
    "tn_token_program",
    "state_proof",
    "transaction",
    "tn_abi_manager_program",
    "tn_nft_program",
    "tn_clob_program",
    "tn_name_service_program",
    "tn_multicall",
    "multisig",
    "core_manager",
];

/* Types where the generated C is known to decide differently from Rust (and
Go) on some inputs, with the reason. The test fails if a listed type agrees
everywhere (update the list) or an unlisted type disagrees. */
const C_KNOWN_DIVERGENT: &[(&str, &str)] = &[
    /* Kept: the CLI rejects this fixture, so no shipped ABI can reach the case. */
    (
        "test.top_level_array_layouts/VariableRows",
        "`__buffer_size` inside a top-level array's elements: C uses the root's size for every row, Rust and Go each element's remaining bytes (a fixture the analyzer rejects)",
    ),
];

fn manifest() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn go_bin() -> String {
    std::env::var("GO").unwrap_or_else(|_| "go".to_string())
}

fn go_available() -> bool {
    Command::new(go_bin())
        .arg("version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/* A C compiler that compiles, links and runs a trivial program. */
fn c_available(dir: &Path) -> bool {
    let cc = std::env::var("CC").unwrap_or_else(|_| "cc".to_string());
    let _ = fs::create_dir_all(dir);
    let src = dir.join("probe.c");
    if fs::write(&src, "int main( void ) { return 0; }\n").is_err() {
        return false;
    }
    let bin = dir.join("probe");
    let ok = Command::new(&cc)
        .arg(&src)
        .arg("-o")
        .arg(&bin)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    ok && Command::new(&bin)
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/* ------------------------------------------------------------------------
 * Deterministic inputs
 * ---------------------------------------------------------------------- */

struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        /* xorshift64* */
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_f491_4f6c_dd1d)
    }
    fn below(&mut self, n: u64) -> u64 {
        if n == 0 { 0 } else { self.next() % n }
    }
    /* Small values are counts and tags; the rest stress overflow paths. */
    fn byte(&mut self) -> u8 {
        match self.below(8) {
            0..=3 => self.below(5) as u8,
            4 => [0xff, 0x80, 0x7f, 0x40][self.below(4) as usize],
            _ => self.next() as u8,
        }
    }
}

fn mutate(rng: &mut Rng, seed: &[u8]) -> Vec<u8> {
    let mut b = seed.to_vec();
    for _ in 0..1 + rng.below(4) {
        match rng.below(6) {
            0..=2 if !b.is_empty() => {
                let i = rng.below(b.len() as u64) as usize;
                b[i] = rng.byte();
            }
            3 if !b.is_empty() => {
                let n = rng.below(b.len() as u64 + 1) as usize;
                b.truncate(n);
            }
            4 => {
                for _ in 0..1 + rng.below(16) {
                    b.push(rng.byte());
                }
            }
            _ if !b.is_empty() => {
                /* A little-endian u16/u32 field set to a small value. */
                let i = rng.below(b.len() as u64) as usize;
                let v = rng.below(300);
                for (j, x) in v.to_le_bytes().iter().take(4).enumerate() {
                    if i + j < b.len() {
                        b[i + j] = *x;
                    }
                }
            }
            _ => b.push(rng.byte()),
        }
    }
    b
}

fn inputs_for(rng: &mut Rng, cases: &[Vec<u8>], iters: usize) -> Vec<Vec<u8>> {
    let mut seeds: Vec<Vec<u8>> = cases.to_vec();
    for n in [
        0usize, 1, 2, 3, 4, 7, 8, 9, 15, 16, 17, 32, 33, 64, 100, 257,
    ] {
        seeds.push(vec![0u8; n]);
    }
    let mut out = Vec::new();
    for case in cases {
        let n = case.len();
        for t in [0, 1, n / 2, n.saturating_sub(1)] {
            if t < n {
                out.push(case[..t].to_vec());
            }
        }
    }
    for seed in &seeds {
        out.push(seed.clone());
        for _ in 0..iters {
            out.push(mutate(rng, seed));
        }
    }
    for _ in 0..iters * 2 {
        let n = rng.below(300) as usize;
        out.push((0..n).map(|_| rng.byte()).collect());
    }
    out
}

/* ------------------------------------------------------------------------
 * ABI groups and types
 * ---------------------------------------------------------------------- */

struct Group {
    files: Vec<PathBuf>,
    includes: Vec<PathBuf>,
    /* Generated through the type-level generators (skips the analyzer's
    alignment check, like the Rust/C tests of these fixtures). */
    direct: bool,
}

struct FuzzType {
    group: usize,
    /* `package` / `type` (dedupe key). */
    key: String,
    type_name: String,
    rust_path: String,
    go_alias: String,
    go_name: String,
    go: abi_gen::codegen::go_gen::pkgnames::VNames,
    params: bool,
    cases: Vec<Vec<u8>>,
}

fn resolve_group(g: &Group) -> anyhow::Result<(TypeResolver, HashMap<String, String>)> {
    if g.direct {
        let abi: AbiFile = serde_yml::from_str(&fs::read_to_string(&g.files[0])?)?;
        let mut resolver = TypeResolver::new();
        for t in abi.get_types() {
            resolver.add_typedef(t.clone());
        }
        resolver
            .resolve_all()
            .map_err(|e| anyhow::anyhow!("resolve: {:?}", e))?;
        let pkg = abi.package().to_string();
        let map = resolver
            .types
            .keys()
            .map(|k| (k.clone(), pkg.clone()))
            .collect();
        return Ok((resolver, map));
    }
    let mut ir = ImportResolver::new(g.includes.clone());
    for f in &g.files {
        ir.load_file_with_imports(f, false)?;
    }
    let mut typedefs = ir.get_all_types().to_vec();
    normalize_type_refs(&mut typedefs, &ir)?;
    let resolver = analyze_and_resolve_types(&typedefs, false)?;
    let map = resolver
        .types
        .keys()
        .filter_map(|k| ir.get_package_for_type(k).map(|p| (k.clone(), p)))
        .collect();
    Ok((resolver, map))
}

fn ordered_types(resolver: &TypeResolver) -> Vec<&ResolvedType> {
    resolver
        .resolution_order
        .iter()
        .filter_map(|n| resolver.get_type_info(n))
        .collect()
}

/* Generate Rust, Go (and C) for group `i`. */
fn generate_group(
    i: usize,
    g: &Group,
    resolver: &TypeResolver,
    pkg_of: &HashMap<String, String>,
    root: &Path,
    with_c: bool,
) -> anyhow::Result<()> {
    let rust_dir = root.join(format!("rust/src/g{i}"));
    let go_dir = root.join(format!("go/g{i}"));
    let c_dir = root.join(format!("c/g{i}"));
    let module = format!("fz/g{i}");
    if g.direct {
        use abi_gen::codegen::c::{CCodeGenerator, CCodeGeneratorOptions};
        use abi_gen::codegen::rust::{RustCodeGenerator, RustCodeGeneratorOptions};
        let types = ordered_types(resolver);
        let pkg = pkg_of.values().next().cloned().unwrap_or_default();
        fs::create_dir_all(&rust_dir)?;
        RustCodeGenerator::new(
            resolver,
            RustCodeGeneratorOptions {
                output_dir: rust_dir.display().to_string(),
                ..Default::default()
            },
        )
        .emit_code(&types);
        fs::write(
            rust_dir.join("mod.rs"),
            "pub mod types;\npub mod functions;\npub mod runtime;\npub use types::*;\npub use functions::*;\n",
        )?;
        abi_gen::codegen::go::write_root(&go_dir, &module)?;
        let pdir = go_dir.join(abi_gen::codegen::go::package_dir(&pkg));
        fs::create_dir_all(&pdir)?;
        fs::write(
            pdir.join("types.go"),
            abi_gen::codegen::go::emit_package(resolver, &pkg, &types, pkg_of, &module),
        )?;
        if with_c {
            fs::create_dir_all(&c_dir)?;
            CCodeGenerator::new(
                resolver,
                CCodeGeneratorOptions {
                    output_dir: c_dir.display().to_string(),
                    ..Default::default()
                },
            )
            .emit_code(&types);
        }
    } else {
        codegen::run(
            g.files.clone(),
            g.includes.clone(),
            Language::Rust,
            rust_dir,
            false,
        )?;
        codegen::run_with_options(
            g.files.clone(),
            g.includes.clone(),
            Language::Go,
            go_dir.clone(),
            false,
            &CodegenOptions {
                go_module: Some(module),
            },
        )?;
        if with_c {
            codegen::run(
                g.files.clone(),
                g.includes.clone(),
                Language::C,
                c_dir,
                false,
            )?;
        }
    }
    fs::remove_file(go_dir.join("go.mod"))?;
    Ok(())
}

fn compliance_cases() -> Vec<(String, String, Vec<u8>)> {
    let root = manifest().join("tests/compliance_tests/test_cases");
    let mut out = Vec::new();
    let mut stack = vec![root];
    let mut files = Vec::new();
    while let Some(d) = stack.pop() {
        for e in fs::read_dir(&d).unwrap() {
            let p = e.unwrap().path();
            if p.is_dir() {
                stack.push(p);
            } else if p.extension().and_then(|x| x.to_str()) == Some("yaml") {
                files.push(p);
            }
        }
    }
    files.sort();
    for path in files {
        let value: serde_yml::Value =
            serde_yml::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        let case = &value["test-case"];
        let abi = case["abi-file"].as_str().unwrap();
        let abi = Path::new(abi).file_name().unwrap().to_str().unwrap();
        let ty = case["type"].as_str().unwrap();
        let hex: String = case["binary-hex"]
            .as_str()
            .unwrap()
            .chars()
            .filter(|c| c.is_ascii_hexdigit())
            .collect();
        let bytes = (0..hex.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).unwrap())
            .collect();
        out.push((abi.to_string(), ty.to_string(), bytes));
    }
    out
}

/* ------------------------------------------------------------------------
 * Go "touch" functions: read every field of a view (no panics allowed)
 * ---------------------------------------------------------------------- */

struct Toucher<'g, 'm, 'a> {
    g: &'g GoEmitter<'m, 'a>,
    gi: usize,
    alias_of: &'g dyn Fn(&ResolvedType) -> String,
    done: BTreeSet<String>,
    out: String,
}

impl<'a> Toucher<'_, '_, 'a> {
    fn fname(&self, ty: &ResolvedType) -> String {
        format!("touch_g{}_{}", self.gi, self.g.gn(ty))
    }

    fn ensure(&mut self, vname: &str) {
        if !self.done.insert(vname.to_string()) {
            return;
        }
        let Some(v) = self.g.info(vname) else {
            return;
        };
        let body = self.body(&v);
        let _ = writeln!(
            self.out,
            "func {}(v {}.{}, depth int) {{\n\tif depth > 6 {{\n\t\treturn\n\t}}\n\t_, _, _ = v.Size(), v.Bytes(), v.Context()\n\t_, _ = v.Check()\n{body}}}\n",
            self.fname(v.ty),
            (self.alias_of)(v.ty),
            self.g.gn(v.ty)
        );
    }

    fn body(&mut self, v: &VInfo<'a>) -> String {
        let names: Names = self.g.names(v);
        let mut b = String::new();
        if self.g.r.has_params(v) {
            b.push_str("\t_, _ = v.DynamicParams()\n");
        }
        for slot in self.g.r.slots(v) {
            let m = |k: &str| self.g.mname(&names, &slot, k);
            match &slot.shape {
                Shape::Prim(_) => {
                    let _ = writeln!(b, "\t_ = v.{}()", m("get"));
                }
                Shape::Array(a) => {
                    let _ = writeln!(b, "\t_, _ = v.{}(), v.{}()", m("len"), m("bytes"));
                    if let Elem::Opaque(_) = a.elem {
                        continue;
                    }
                    let _ = writeln!(
                        b,
                        "\tfor i := uint64(0); i < v.{}() && i < 8; i++ {{",
                        m("len")
                    );
                    match &a.elem {
                        Elem::View(c) => {
                            self.ensure(&c.vname);
                            let _ = writeln!(
                                b,
                                "\t\tif x, ok := v.{}(i); ok {{\n\t\t\t{}(x, depth+1)\n\t\t}}",
                                m("at"),
                                self.fname(c.ty)
                            );
                        }
                        _ => {
                            let _ = writeln!(b, "\t\t_, _ = v.{}(i)", m("at"));
                        }
                    }
                    let _ = writeln!(b, "\t}}");
                    let _ = writeln!(b, "\t_, _ = v.{}(v.{}() + 3)", m("at"), m("len"));
                }
                Shape::View(c) => {
                    self.ensure(&c.vname);
                    let _ = writeln!(b, "\t{}(v.{}(), depth+1)", self.fname(c.ty), m("get"));
                }
                Shape::Enum { variants, .. } | Shape::Sdu { variants } => {
                    let vc = self.g.variant_camels(variants);
                    let _ = writeln!(b, "\t_, _ = v.{}(), v.{}()", m("tag"), m("body"));
                    let _ = writeln!(b, "\t{{\n\t\tr := v.{}()\n\t\t_ = r", m("get"));
                    for (vi, (var, c)) in variants.iter().zip(&vc).enumerate() {
                        let _ = writeln!(b, "\t\t_, _ = v.{}()", m(&format!("as{vi}")));
                        if let Elem::View(cv) = &var.elem {
                            self.ensure(&cv.vname);
                            let _ = writeln!(
                                b,
                                "\t\tif r.Known {{\n\t\t\t{}(r.{c}, depth+1)\n\t\t}}",
                                self.fname(cv.ty)
                            );
                        }
                    }
                    let _ = writeln!(b, "\t}}");
                }
            }
        }
        b
    }
}

/* ------------------------------------------------------------------------
 * The test
 * ---------------------------------------------------------------------- */

#[test]
fn differential_fuzz_rust_go_c() {
    if !go_available() {
        if std::env::var_os("ABI_REQUIRE_GO").is_some() {
            panic!("ABI_REQUIRE_GO is set but `go` is not available");
        }
        eprintln!("skipping differential fuzz: `go` not found (set ABI_REQUIRE_GO to require it)");
        return;
    }
    let iters: usize = std::env::var("ABI_FUZZ_ITERS")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(12);
    let root = std::env::temp_dir().join(format!("abi_differential_fuzz_{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).unwrap();
    let with_c = c_available(&root.join("probe"));
    if !with_c {
        eprintln!("differential fuzz: no working C toolchain, comparing Rust and Go only");
    }

    /* Groups */
    let mut groups = Vec::new();
    let defs = manifest().join("tests/compliance_tests/abi_definitions");
    let data = manifest().join("tests/compliance_data");
    for dir in [&defs, &data] {
        let mut files: Vec<PathBuf> = fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().path())
            .filter(|p| p.to_string_lossy().ends_with(".abi.yaml"))
            .collect();
        files.sort();
        for f in files {
            groups.push(Group {
                files: vec![f],
                includes: Vec::new(),
                direct: false,
            });
        }
    }
    let tl = manifest().join("../type-library");
    for name in TYPE_LIBRARY_ABIS {
        groups.push(Group {
            files: vec![tl.join(format!("{name}.abi.yaml"))],
            includes: vec![tl.clone()],
            direct: false,
        });
    }

    let cases = compliance_cases();
    let mut types: Vec<FuzzType> = Vec::new();
    let mut seen_keys = BTreeSet::new();
    let mut go_imports: BTreeMap<String, String> = BTreeMap::new(); /* path -> alias */
    let mut touch = String::new();
    let mut c_groups: Vec<(usize, Vec<String>)> = Vec::new(); /* (group, package dirs) */
    for (i, g) in groups.iter_mut().enumerate() {
        let resolved = match resolve_group(g) {
            Ok(r) => r,
            Err(_) => {
                /* Fixtures the analyzer rejects (alignment) go through the
                type-level generators, like their Rust/C tests. */
                g.direct = true;
                resolve_group(g).unwrap_or_else(|e| panic!("{}: {e:#}", g.files[0].display()))
            }
        };
        let (resolver, pkg_of) = resolved;
        generate_group(i, g, &resolver, &pkg_of, &root, with_c)
            .unwrap_or_else(|e| panic!("codegen {}: {e:#}", g.files[0].display()));
        let abi_file = g.files[0]
            .file_name()
            .unwrap()
            .to_string_lossy()
            .to_string();
        let model = Model::new(&resolver);
        let ge = GoEmitter::new(&model, "", pkg_of.clone());
        let mut aliases: BTreeMap<String, String> = BTreeMap::new();
        let go_dirs = abi_gen::codegen::go::package_dirs(pkg_of.values());
        for p in pkg_of.values() {
            let path = format!("fz/g{i}/{}", go_dirs[p]);
            let n = go_imports.len();
            let alias = go_imports
                .entry(path)
                .or_insert_with(|| format!("p{n}"))
                .clone();
            aliases.insert(p.clone(), alias);
        }
        let alias_of = |ty: &ResolvedType| -> String {
            let rootname = ty.name.split("::").next().unwrap_or(&ty.name);
            aliases[&pkg_of[rootname]].clone()
        };
        let mut toucher = Toucher {
            g: &ge,
            gi: i,
            alias_of: &alias_of,
            done: BTreeSet::new(),
            out: String::new(),
        };
        let mut pkgs = BTreeSet::new();
        for ty in ordered_types(&resolver) {
            if matches!(
                ty.kind,
                ResolvedTypeKind::Primitive { .. } | ResolvedTypeKind::TypeRef { .. }
            ) {
                continue;
            }
            let Some(pkg) = pkg_of.get(&ty.name) else {
                continue;
            };
            pkgs.insert(pkg.clone());
            model.collect_named(&ty.name);
            let vname = view_name(&ty.name);
            let Some(info) = ge.info(&ty.name) else {
                continue;
            };
            if info.has_ext() {
                continue;
            }
            let key = format!("{pkg}/{}", ty.name);
            if !seen_keys.insert(key.clone()) {
                continue;
            }
            toucher.ensure(&ty.name);
            let rust_path = if g.direct {
                format!("g{i}::{vname}")
            } else {
                let mods: Vec<String> = pkg.split('.').map(escape_ident).collect();
                format!("g{i}::{}::{vname}", mods.join("::"))
            };
            types.push(FuzzType {
                group: i,
                key,
                type_name: ty.name.clone(),
                rust_path,
                go_alias: alias_of(ty),
                go_name: ge.gn(ty),
                go: ge.vnames_of(&ty.name),
                params: ge.r.has_params_struct(&info),
                cases: cases
                    .iter()
                    .filter(|(a, t, _)| *a == abi_file && *t == ty.name)
                    .map(|(_, _, b)| b.clone())
                    .collect(),
            });
        }
        touch.push_str(&toucher.out);
        if with_c {
            c_groups.push((
                i,
                pkgs.iter()
                    .map(|p| {
                        if g.direct {
                            ".".to_string()
                        } else {
                            p.replace('.', "/")
                        }
                    })
                    .collect(),
            ));
        }
    }

    /* Inputs: [u32 type][u32 len][bytes] records. */
    let mut rng = Rng(0x7468_7275_6162_6921);
    let mut records: Vec<(usize, Vec<u8>)> = Vec::new();
    for (ti, t) in types.iter().enumerate() {
        for b in inputs_for(&mut rng, &t.cases, iters) {
            records.push((ti, b));
        }
    }
    let mut blob = Vec::new();
    for (ti, b) in &records {
        blob.extend_from_slice(&(*ti as u32).to_le_bytes());
        blob.extend_from_slice(&(b.len() as u32).to_le_bytes());
        blob.extend_from_slice(b);
    }
    let input_path = root.join("inputs.bin");
    fs::write(&input_path, &blob).unwrap();

    /* Rust program */
    let rust_root = root.join("rust");
    let mut rs = String::from("#![allow(unused)]\n");
    for i in 0..groups.len() {
        let _ = writeln!(rs, "mod g{i};");
    }
    rs.push_str(RUST_PRELUDE);
    rs.push_str("fn run(t: u32, d: &[u8]) -> String {\n    match t {\n");
    for (ti, t) in types.iter().enumerate() {
        let fp = if t.params {
            format!(
                " + &fp!({}Params::from_buffer(d).and_then(|p| p.footprint()))",
                t.rust_path
            )
        } else {
            String::new()
        };
        let _ = writeln!(
            rs,
            "        {ti} => res!({}::validate(d)){fp},",
            t.rust_path
        );
    }
    rs.push_str("        _ => unreachable!(),\n    }\n}\n");
    fs::write(rust_root.join("src/main.rs"), rs).unwrap();
    fs::write(
        rust_root.join("Cargo.toml"),
        "[package]\nname = \"fuzz_rust\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[workspace]\n\n[profile.dev]\nopt-level = 1\ndebug = false\n",
    )
    .unwrap();
    let out = Command::new("cargo")
        .args(["run", "--quiet", "--manifest-path"])
        .arg(rust_root.join("Cargo.toml"))
        .arg("--")
        .arg(&input_path)
        .env_remove("RUSTFLAGS")
        .output()
        .expect("cargo run");
    assert!(
        out.status.success(),
        "Rust fuzz program failed:\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let rust_lines: Vec<String> = String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(String::from)
        .collect();

    /* Go program */
    let go_root = root.join("go");
    fs::write(go_root.join("go.mod"), "module fz\n\ngo 1.21\n").unwrap();
    let mut go = String::new();
    go.push_str(GO_PRELUDE);
    go.push_str(&touch);
    go.push_str("func run(t uint32, d []byte) string {\n\tswitch t {\n");
    for (ti, t) in types.iter().enumerate() {
        let _ = writeln!(go, "\tcase {ti}:");
        let _ = writeln!(
            go,
            "\t\ts := res(({a}.{n})(d))",
            a = t.go_alias,
            n = t.go.validate
        );
        if t.params {
            let _ = writeln!(
                go,
                "\t\tif p, err := {a}.{n}(d); err != nil {{\n\t\t\ts += fpErr(err)\n\t\t}} else {{\n\t\t\ts += fp(p.Footprint())\n\t\t}}",
                a = t.go_alias,
                n = t.go.params_from_buffer
            );
        }
        let _ = writeln!(
            go,
            "\t\ttouch_g{}_{}({}.{}(d), 0)",
            t.group, t.go_name, t.go_alias, t.go.unchecked
        );
        let _ = writeln!(
            go,
            "\t\tif v, err := {a}.{p}(d); err == nil {{\n\t\t\ttouch_g{g}_{n}(v, 0)\n\t\t}}",
            a = t.go_alias,
            p = t.go.parse,
            n = t.go_name,
            g = t.group
        );
        let _ = writeln!(go, "\t\treturn s");
    }
    go.push_str("\t}\n\tpanic(\"unknown type\")\n}\n");
    let mut head = String::from(
        "package main\n\nimport (\n\t\"bufio\"\n\t\"encoding/binary\"\n\t\"fmt\"\n\t\"os\"\n\n",
    );
    for (path, alias) in &go_imports {
        if go.contains(&format!("{alias}.")) {
            let _ = writeln!(head, "\t{alias} \"{path}\"");
        }
    }
    head.push_str(")\n\n");
    let go = head + &go;
    fs::create_dir_all(go_root.join("cmd/fuzz")).unwrap();
    fs::write(go_root.join("cmd/fuzz/main.go"), go).unwrap();
    for args in [
        &["vet", "./..."][..],
        &["build", "-o", "fuzz_bin", "./cmd/fuzz"][..],
    ] {
        let out = Command::new(go_bin())
            .args(args)
            .current_dir(&go_root)
            .env("CGO_ENABLED", "0")
            .output()
            .expect("go");
        assert!(
            out.status.success(),
            "go {:?} failed:\n{}{}",
            args,
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        );
    }
    let out = Command::new(go_root.join("fuzz_bin"))
        .arg(&input_path)
        .output()
        .expect("run go");
    assert!(
        out.status.success(),
        "Go fuzz program failed (a generated function panicked?):\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let go_lines: Vec<String> = String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(String::from)
        .collect();

    /* C programs (one per group). */
    let mut c_results: HashMap<usize, String> = HashMap::new();
    let mut c_types = 0usize;
    if with_c {
        for (gi, pkgs) in &c_groups {
            let dir = root.join(format!("c/g{gi}"));
            let mut validates = BTreeSet::new();
            let mut footprints = BTreeSet::new();
            for p in pkgs {
                let header = fs::read_to_string(dir.join(p).join("types.h")).unwrap_or_default();
                for line in header.lines() {
                    if let Some(rest) = line.strip_prefix("int ") {
                        if let Some((name, args)) = rest.split_once("( ") {
                            if args.starts_with(
                                "uint8_t const * data, uint64_t len, uint64_t * out_consumed )",
                            ) {
                                validates.insert(name.trim_end_matches("_validate").to_string());
                            } else if args.starts_with("uint8_t const * data, uint64_t len, ")
                                && name.ends_with("_params_from_buffer")
                            {
                                footprints.insert(
                                    name.trim_end_matches("_params_from_buffer").to_string(),
                                );
                            }
                        }
                    }
                }
            }
            let mine: Vec<(usize, &FuzzType)> = types
                .iter()
                .enumerate()
                .filter(|(_, t)| t.group == *gi && validates.contains(&view_name(&t.type_name)))
                .collect();
            if mine.is_empty() {
                continue;
            }
            c_types += mine.len();
            let mut main =
                String::from("#include <stdio.h>\n#include <stdlib.h>\n#include <stdint.h>\n");
            for p in pkgs {
                let _ = writeln!(main, "#include \"{p}/types.h\"");
            }
            main.push_str(C_PRELUDE);
            main.push_str("static void run( uint32_t t, uint8_t const * d, uint64_t n, unsigned long rec ) {\n  uint64_t c = 0; int r;\n  switch( t ) {\n");
            for (ti, t) in &mine {
                let cn = view_name(&t.type_name);
                let _ = writeln!(main, "  case {ti}: {{");
                let _ = writeln!(main, "    r = {cn}_validate( d, n, &c );");
                let _ = writeln!(main, "    printf( \"%lu \", rec ); report( r, c );");
                if footprints.contains(&cn) {
                    let _ = writeln!(main, "    {cn}_params_t p; uint64_t fp = 0;");
                    let _ = writeln!(
                        main,
                        "    if( {cn}_params_from_buffer( d, n, &p )==0 && {cn}_footprint_from_params( &p, &fp )==0 ) printf( \" fp:%llu\", (unsigned long long)fp );"
                    );
                }
                let _ = writeln!(main, "    printf( \"\\n\" );\n    break;\n  }}");
            }
            main.push_str("  default: break;\n  }\n}\n");
            main.push_str(C_MAIN);
            fs::write(dir.join("fuzz_main.c"), main).unwrap();
            let cc = std::env::var("CC").unwrap_or_else(|_| "cc".to_string());
            let mut cmd = Command::new(&cc);
            cmd.current_dir(&dir)
                .args(["-std=c11", "-O1", "-I.", "-o", "fuzz_c", "fuzz_main.c"]);
            for p in pkgs {
                cmd.arg(format!("{p}/functions.c"));
            }
            let out = cmd.output().expect("cc");
            assert!(
                out.status.success(),
                "C fuzz build failed (group {gi}):\n{}",
                String::from_utf8_lossy(&out.stderr)
            );
            let out = Command::new(dir.join("fuzz_c"))
                .arg(&input_path)
                .output()
                .expect("run C");
            assert!(out.status.success(), "C fuzz program failed (group {gi})");
            for line in String::from_utf8_lossy(&out.stdout).lines() {
                if let Some((rec, rest)) = line.split_once(' ') {
                    c_results.insert(rec.parse().unwrap(), rest.to_string());
                }
            }
        }
    }

    /* Compare */
    assert_eq!(rust_lines.len(), records.len(), "Rust result count");
    assert_eq!(go_lines.len(), records.len(), "Go result count");
    let mut failures = Vec::new();
    let mut ok_count = 0usize;
    let mut c_compared = 0usize;
    let mut c_known = BTreeSet::new();
    let mut outcomes: BTreeMap<String, usize> = BTreeMap::new();
    for (rec, (ti, bytes)) in records.iter().enumerate() {
        let (r, g) = (&rust_lines[rec], &go_lines[rec]);
        let t = &types[*ti];
        if r != g {
            failures.push(format!("{} {:02x?}: Rust `{r}`, Go `{g}`", t.key, bytes));
        }
        if r.starts_with("ok:") {
            ok_count += 1;
        }
        *outcomes
            .entry(r.split([':', ' ']).next().unwrap_or("").to_string())
            .or_default() += 1;
        if let Some(c) = c_results.get(&rec) {
            c_compared += 1;
            if let Some(why) = c_disagrees(r, c) {
                if C_KNOWN_DIVERGENT.iter().any(|(k, _)| *k == t.key) {
                    c_known.insert(t.key.clone());
                } else {
                    failures.push(format!(
                        "{} {:02x?}: Rust `{r}`, C `{c}`: {why}",
                        t.key, bytes
                    ));
                }
            }
        }
    }
    println!(
        "differential fuzz: {} types, {} buffers ({} valid); Rust = Go on {}; C compared on {} buffers of {} types",
        types.len(),
        records.len(),
        ok_count,
        records.len() - failures.iter().filter(|f| f.contains(", Go `")).count(),
        c_compared,
        c_types
    );
    println!("  Rust/Go outcomes: {outcomes:?}");
    if with_c {
        for (k, why) in C_KNOWN_DIVERGENT {
            if c_known.contains(*k) {
                println!("  known C divergence: {k}: {why}");
            } else if types.iter().any(|t| t.key == *k) {
                failures.push(format!(
                    "{k} is listed in C_KNOWN_DIVERGENT but C now agrees: update the list"
                ));
            }
        }
    }
    let _ = fs::remove_dir_all(&root);
    let mut by_type: BTreeMap<String, usize> = BTreeMap::new();
    for f in &failures {
        let lang = if f.contains(", Go `") { "Go" } else { "C" };
        *by_type
            .entry(format!("{lang} {}", f.split(' ').next().unwrap_or("")))
            .or_default() += 1;
    }
    for (k, n) in &by_type {
        println!("  {n} disagreements: {k}");
    }
    /* A few examples per type and language. */
    let mut shown: BTreeMap<String, usize> = BTreeMap::new();
    failures.retain(|f| {
        let lang = if f.contains(", Go `") { "Go" } else { "C" };
        let n = shown
            .entry(format!("{lang} {}", f.split(' ').next().unwrap_or("")))
            .or_default();
        *n += 1;
        *n <= 3
    });
    assert!(
        failures.is_empty(),
        "disagreements:\n{}",
        failures.join("\n")
    );
}

/* C agrees with Rust when ok/err match, consumed matches on ok, the
footprints match, and a short-buffer size C reports is Rust's. */
fn c_disagrees(rust: &str, c: &str) -> Option<String> {
    let mut rp = rust.split(' ');
    let rv = rp.next().unwrap_or("");
    let rfp = rp.next();
    let mut cp = c.split(' ');
    let cv = cp.next().unwrap_or("");
    let cfp = cp.next();
    let r_ok = rv.starts_with("ok:");
    let c_ok = cv.starts_with("ok:");
    if r_ok != c_ok {
        return Some("ok/err".into());
    }
    if r_ok && rv != cv {
        return Some("consumed".into());
    }
    if let Some(n) = cv.strip_prefix("short:") {
        if n != "0" && rv != format!("short:{n}") {
            return Some("required size".into());
        }
    }
    if let (Some(c), Some(r)) = (cfp, rfp) {
        if r.starts_with("fp:") && c != r {
            return Some("footprint".into());
        }
    }
    None
}

const RUST_PRELUDE: &str = r#"
macro_rules! res {
    ($r:expr) => {
        match $r {
            Ok(n) => format!("ok:{}", n),
            Err(e) => match e.required_size() {
                Some(n) => format!("short:{}", n),
                None => format!("err:{:?}", e),
            },
        }
    };
}
macro_rules! fp {
    ($r:expr) => {
        match $r {
            Ok(n) => format!(" fp:{}", n),
            Err(e) => match e.required_size() {
                Some(n) => format!(" fp-short:{}", n),
                None => format!(" fp-err:{:?}", e),
            },
        }
    };
}

fn main() {
    let path = std::env::args().nth(1).expect("input file");
    let blob = std::fs::read(path).expect("read inputs");
    let mut at = 0usize;
    let mut out = String::new();
    while at < blob.len() {
        let t = u32::from_le_bytes(blob[at..at + 4].try_into().unwrap());
        let n = u32::from_le_bytes(blob[at + 4..at + 8].try_into().unwrap()) as usize;
        let d = &blob[at + 8..at + 8 + n];
        at += 8 + n;
        out.push_str(&run(t, d));
        out.push('\n');
    }
    print!("{}", out);
}
"#;

const GO_PRELUDE: &str = r#"type kinded interface {
	RequiredSize() (uint64, bool)
	KindName() string
}

func res(n int, err error) string {
	if err == nil {
		return fmt.Sprintf("ok:%d", n)
	}
	k := err.(kinded)
	if need, ok := k.RequiredSize(); ok {
		return fmt.Sprintf("short:%d", need)
	}
	return "err:" + k.KindName()
}

func fp(n uint64, err error) string {
	if err == nil {
		return fmt.Sprintf(" fp:%d", n)
	}
	return fpErr(err)
}

func fpErr(err error) string {
	k := err.(kinded)
	if need, ok := k.RequiredSize(); ok {
		return fmt.Sprintf(" fp-short:%d", need)
	}
	return " fp-err:" + k.KindName()
}

func main() {
	blob, err := os.ReadFile(os.Args[1])
	if err != nil {
		panic(err)
	}
	w := bufio.NewWriter(os.Stdout)
	defer w.Flush()
	for at := 0; at < len(blob); {
		t := binary.LittleEndian.Uint32(blob[at:])
		n := int(binary.LittleEndian.Uint32(blob[at+4:]))
		d := append([]byte(nil), blob[at+8:at+8+n]...)
		at += 8 + n
		fmt.Fprintln(w, run(t, d))
	}
}

"#;

const C_PRELUDE: &str = r#"
static void report( int r, uint64_t c ) {
  if( r==0 ) printf( "ok:%llu", (unsigned long long)c );
  else if( r==TN_ABI_ERR_SHORT_BUFFER ) printf( "short:%llu", (unsigned long long)c );
  else printf( "err:%d", r );
}
"#;

const C_MAIN: &str = r#"
int main( int argc, char ** argv ) {
  if( argc < 2 ) return 1;
  FILE * f = fopen( argv[1], "rb" );
  if( !f ) return 1;
  fseek( f, 0, SEEK_END ); long sz = ftell( f ); fseek( f, 0, SEEK_SET );
  uint8_t * blob = malloc( (size_t)sz + 1 );
  if( fread( blob, 1, (size_t)sz, f )!=(size_t)sz ) return 1;
  fclose( f );
  unsigned long rec = 0;
  for( long at = 0; at < sz; rec++ ) {
    uint32_t t = (uint32_t)blob[at] | (uint32_t)blob[at+1]<<8 | (uint32_t)blob[at+2]<<16 | (uint32_t)blob[at+3]<<24;
    uint32_t n = (uint32_t)blob[at+4] | (uint32_t)blob[at+5]<<8 | (uint32_t)blob[at+6]<<16 | (uint32_t)blob[at+7]<<24;
    uint8_t * d = malloc( n ? n : 1 );
    for( uint32_t i = 0; i < n; i++ ) d[i] = blob[at+8+i];
    run( t, d, n, rec );
    free( d );
    at += 8 + (long)n;
  }
  free( blob );
  return 0;
}
"#;

/* ------------------------------------------------------------------------
 * IR helper functions
 * ---------------------------------------------------------------------- */

/* The IR-derived free functions agree across backends: for every compliance
 * type with IR helpers, Go `TFootprintIRChecked` / `TValidateIR` must match
 * Rust `t_footprint_ir_checked` / `t_validate_ir` exactly (value, or error
 * kind and required size), and C `T_footprint_ir` (UINT64_MAX on error) /
 * `T_validate_ir` (ok/err and the consumed size) must match them too when a C
 * toolchain is present. Parameters and buffer sizes are drawn
 * deterministically from small values, tags and overflow edges. */
#[test]
fn ir_helpers_agree_rust_go_c() {
    use abi_gen::codegen::go_gen::ir::has_buffer_size;
    use abi_gen::codegen::rust_gen::emit_ir_footprint_fn;
    use abi_gen::codegen::rust_gen::ir_helpers::sanitize_param_name;
    use abi_gen::codegen::shared::builder::IrBuilder;

    if !go_available() {
        if std::env::var_os("ABI_REQUIRE_GO").is_some() {
            panic!("ABI_REQUIRE_GO is set but `go` is not available");
        }
        eprintln!("skipping IR helper comparison: `go` not found");
        return;
    }
    let root = std::env::temp_dir().join(format!("abi_ir_helpers_{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).unwrap();
    let with_c = c_available(&root.join("probe"));

    let mut groups = Vec::new();
    for dir in [
        "tests/compliance_tests/abi_definitions",
        "tests/compliance_data",
    ] {
        let mut files: Vec<PathBuf> = fs::read_dir(manifest().join(dir))
            .unwrap()
            .map(|e| e.unwrap().path())
            .filter(|p| p.to_string_lossy().ends_with(".abi.yaml"))
            .collect();
        files.sort();
        for f in files {
            groups.push(Group {
                files: vec![f],
                includes: Vec::new(),
                direct: false,
            });
        }
    }

    struct IrFn {
        group: usize,
        key: String,
        rust: String,
        go_alias: String,
        go: abi_gen::codegen::go_gen::pkgnames::VNames,
        c_name: String,
        /* Rust argument names (`buf_sz` first when used) and the IR params. */
        params: Vec<String>,
        buf: bool,
    }
    let mut fns: Vec<IrFn> = Vec::new();
    let mut seen = BTreeSet::new();
    let mut go_imports: BTreeMap<String, String> = BTreeMap::new();
    let mut c_headers: Vec<(usize, Vec<String>)> = Vec::new();
    for (i, g) in groups.iter_mut().enumerate() {
        let (resolver, pkg_of) = match resolve_group(g) {
            Ok(r) => r,
            Err(_) => {
                g.direct = true;
                resolve_group(g).unwrap()
            }
        };
        generate_group(i, g, &resolver, &pkg_of, &root, with_c).unwrap();
        let builder = IrBuilder::new(&resolver);
        let go_dirs = abi_gen::codegen::go::package_dirs(pkg_of.values());
        let ir_model = Model::new(&resolver);
        let ge = GoEmitter::new(&ir_model, "", pkg_of.clone());
        let mut cache = BTreeMap::new();
        let mut pkgs = BTreeSet::new();
        for ty in ordered_types(&resolver) {
            let Some(pkg) = pkg_of.get(&ty.name) else {
                continue;
            };
            pkgs.insert(pkg.clone());
            let Ok(ir) = builder.build_type(ty) else {
                continue;
            };
            if !abi_gen::codegen::rust::static_ir_helpers_supported(
                &builder,
                &ir.type_name,
                &mut cache,
                &mut BTreeSet::new(),
            ) || emit_ir_footprint_fn(&ir).is_err()
                || abi_gen::codegen::go_gen::ir::calls_buffer_sized(&builder, &ir, 0)
            {
                continue;
            }
            let key = format!("{pkg}/{}", ty.name);
            if !seen.insert(key.clone()) {
                continue;
            }
            let path = format!("fz/g{i}/{}", go_dirs[pkg]);
            let n = go_imports.len();
            let alias = go_imports
                .entry(path)
                .or_insert_with(|| format!("p{n}"))
                .clone();
            let rust_mod = if g.direct {
                format!("g{i}")
            } else {
                let mods: Vec<String> = pkg.split('.').map(escape_ident).collect();
                format!("g{i}::{}", mods.join("::"))
            };
            fns.push(IrFn {
                group: i,
                key,
                rust: format!("{rust_mod}::{}", sanitize_param_name(&ir.type_name)),
                go_alias: alias,
                go: ge.vnames_of(&ir.type_name),
                c_name: view_name(&ir.type_name),
                params: ir.parameters.iter().map(|p| p.name.clone()).collect(),
                buf: has_buffer_size(&ir.root),
            });
        }
        if with_c {
            c_headers.push((
                i,
                pkgs.iter()
                    .map(|p| {
                        if g.direct {
                            ".".into()
                        } else {
                            p.replace('.', "/")
                        }
                    })
                    .collect(),
            ));
        }
    }

    /* Inputs: (fn, buf_sz, params). */
    const POOL: &[u64] = &[
        0,
        1,
        2,
        3,
        4,
        5,
        7,
        8,
        9,
        16,
        63,
        64,
        255,
        256,
        65535,
        1 << 32,
        1 << 62,
        1 << 63,
        u64::MAX,
    ];
    let mut rng = Rng(0x6972_5f68_656c_7065);
    let pick = |rng: &mut Rng| {
        if rng.below(3) == 0 {
            rng.below(12)
        } else {
            POOL[rng.below(POOL.len() as u64) as usize]
        }
    };
    let mut records: Vec<(usize, u64, Vec<u64>)> = Vec::new();
    for (fi, f) in fns.iter().enumerate() {
        for _ in 0..48 {
            let buf = pick(&mut rng);
            let params = f.params.iter().map(|_| pick(&mut rng)).collect();
            records.push((fi, buf, params));
        }
    }

    /* Inputs file: [u32 fn][u64 buf_sz][u64 param]... per record. */
    let mut blob = Vec::new();
    for (fi, buf, params) in &records {
        blob.extend_from_slice(&(*fi as u32).to_le_bytes());
        blob.extend_from_slice(&buf.to_le_bytes());
        for p in params {
            blob.extend_from_slice(&p.to_le_bytes());
        }
    }
    let input_path = root.join("ir_inputs.bin");
    fs::write(&input_path, &blob).unwrap();
    let call_args = |f: &IrFn, footprint: bool| -> String {
        let mut a: Vec<String> = (0..f.params.len()).map(|i| format!("p[{i}]")).collect();
        if !footprint || f.buf {
            a.insert(0, "b".to_string());
        }
        a.join(", ")
    };

    /* Rust */
    let rust_root = root.join("rust");
    let mut rs = String::from("#![allow(unused)]\n");
    for i in 0..groups.len() {
        let _ = writeln!(rs, "mod g{i};");
    }
    rs.push_str(RUST_PRELUDE.split("fn main()").next().unwrap());
    rs.push_str("fn run(f: u32, b: u64, p: &[u64]) -> String {\n    match f {\n");
    for (fi, f) in fns.iter().enumerate() {
        let _ = writeln!(
            rs,
            "        {fi} => format!(\"{{}} {{}}\", res!({r}_footprint_ir_checked({fa}).map(|v| v as usize)), res!({r}_validate_ir({va}).map(|v| v as usize))),",
            r = f.rust,
            fa = call_args(f, true),
            va = call_args(f, false)
        );
    }
    rs.push_str("        _ => unreachable!(),\n    }\n}\n");
    let arity: Vec<String> = fns.iter().map(|f| f.params.len().to_string()).collect();
    let _ = writeln!(
        rs,
        "const ARITY: &[usize] = &[{}];\nfn main() {{\n    let blob = std::fs::read(std::env::args().nth(1).unwrap()).unwrap();\n    let rd = |at: usize| u64::from_le_bytes(blob[at..at + 8].try_into().unwrap());\n    let mut at = 0usize;\n    let mut out = String::new();\n    while at < blob.len() {{\n        let f = u32::from_le_bytes(blob[at..at + 4].try_into().unwrap());\n        let b = rd(at + 4);\n        let n = ARITY[f as usize];\n        let p: Vec<u64> = (0..n).map(|i| rd(at + 12 + 8 * i)).collect();\n        at += 12 + 8 * n;\n        out.push_str(&run(f, b, &p));\n        out.push('\\n');\n    }}\n    print!(\"{{}}\", out);\n}}",
        arity.join(", ")
    );
    fs::write(rust_root.join("src/main.rs"), rs).unwrap();
    fs::write(
        rust_root.join("Cargo.toml"),
        "[package]\nname = \"ir_rust\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[workspace]\n\n[profile.dev]\ndebug = false\n",
    )
    .unwrap();
    let out = Command::new("cargo")
        .args(["run", "--quiet", "--manifest-path"])
        .arg(rust_root.join("Cargo.toml"))
        .arg("--")
        .arg(&input_path)
        .env_remove("RUSTFLAGS")
        .output()
        .expect("cargo run");
    assert!(
        out.status.success(),
        "Rust IR program failed:\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let rust_lines: Vec<String> = String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(String::from)
        .collect();

    /* Go */
    let go_root = root.join("go");
    fs::write(go_root.join("go.mod"), "module fz\n\ngo 1.21\n").unwrap();
    let mut body = String::new();
    body.push_str(GO_PRELUDE.split("func main()").next().unwrap());
    body.push_str("func resU(n uint64, err error) string {\n\tif err == nil {\n\t\treturn fmt.Sprintf(\"ok:%d\", n)\n\t}\n\treturn res(0, err)\n}\n\n");
    body.push_str("func run(f uint32, b uint64, p []uint64) string {\n\tswitch f {\n");
    for (fi, f) in fns.iter().enumerate() {
        let _ = writeln!(
            body,
            "\tcase {fi}:\n\t\tfv, ferr := {a}.{fc}({fa})\n\t\tvv, verr := {a}.{vi}({va})\n\t\treturn resU(fv, ferr) + \" \" + resU(vv, verr)",
            a = f.go_alias,
            fc = f.go.fp_ir_checked,
            vi = f.go.validate_ir,
            fa = call_args(f, true),
            va = call_args(f, false)
        );
    }
    body.push_str("\t}\n\t_, _ = b, p\n\tpanic(\"unknown function\")\n}\n\n");
    let _ = writeln!(
        body,
        "var arity = []int{{{}}}\n\nfunc main() {{\n\tblob, err := os.ReadFile(os.Args[1])\n\tif err != nil {{\n\t\tpanic(err)\n\t}}\n\tw := bufio.NewWriter(os.Stdout)\n\tdefer w.Flush()\n\tfor at := 0; at < len(blob); {{\n\t\tf := binary.LittleEndian.Uint32(blob[at:])\n\t\tb := binary.LittleEndian.Uint64(blob[at+4:])\n\t\tn := arity[f]\n\t\tp := make([]uint64, n)\n\t\tfor i := range p {{\n\t\t\tp[i] = binary.LittleEndian.Uint64(blob[at+12+8*i:])\n\t\t}}\n\t\tat += 12 + 8*n\n\t\tfmt.Fprintln(w, run(f, b, p))\n\t}}\n}}",
        arity.join(", ")
    );
    let mut go = String::from(
        "package main\n\nimport (\n\t\"bufio\"\n\t\"encoding/binary\"\n\t\"fmt\"\n\t\"os\"\n\n",
    );
    for (path, alias) in &go_imports {
        if body.contains(&format!("{alias}.")) {
            let _ = writeln!(go, "\t{alias} \"{path}\"");
        }
    }
    go.push_str(")\n\nvar _ = fpErr\nvar _ = fp\n\n");
    go.push_str(&body);
    fs::create_dir_all(go_root.join("cmd/ir")).unwrap();
    fs::write(go_root.join("cmd/ir/main.go"), go).unwrap();
    for args in [
        &["vet", "./..."][..],
        &["build", "-o", "ir_bin", "./cmd/ir"][..],
    ] {
        let out = Command::new(go_bin())
            .args(args)
            .current_dir(&go_root)
            .env("CGO_ENABLED", "0")
            .output()
            .expect("go");
        assert!(
            out.status.success(),
            "go {:?} failed:\n{}{}",
            args,
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        );
    }
    let out = Command::new(go_root.join("ir_bin"))
        .arg(&input_path)
        .output()
        .expect("run go");
    assert!(
        out.status.success(),
        "Go IR program failed:\n{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let go_lines: Vec<String> = String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(String::from)
        .collect();

    /* C (one program per group, over the same inputs). */
    let mut c_lines: HashMap<usize, String> = HashMap::new();
    let mut c_fns = 0usize;
    for (gi, pkgs) in &c_headers {
        let dir = root.join(format!("c/g{gi}"));
        /* name -> argument names, from the prototypes. */
        let mut protos: HashMap<String, Vec<String>> = HashMap::new();
        for p in pkgs {
            let header = fs::read_to_string(dir.join(p).join("types.h")).unwrap_or_default();
            for line in header.lines() {
                let Some(rest) = line
                    .strip_prefix("uint64_t ")
                    .or_else(|| line.strip_prefix("int "))
                else {
                    continue;
                };
                let Some((name, args)) = rest.split_once("( ") else {
                    continue;
                };
                if !(name.ends_with("_footprint_ir") || name.ends_with("_validate_ir")) {
                    continue;
                }
                let args: Vec<String> = args
                    .trim_end_matches(" );")
                    .split(", ")
                    .filter(|a| *a != "void")
                    .map(|a| a.rsplit(' ').next().unwrap_or("").to_string())
                    .collect();
                protos.insert(name.to_string(), args);
            }
        }
        let mut cases = String::new();
        for (fi, f) in fns.iter().enumerate() {
            if f.group != *gi {
                continue;
            }
            let (Some(fa), Some(va)) = (
                protos.get(&format!("{}_footprint_ir", f.c_name)),
                protos.get(&format!("{}_validate_ir", f.c_name)),
            ) else {
                continue;
            };
            let value = |name: &str| -> Option<String> {
                match name {
                    "buf_sz" => Some("b".into()),
                    "out_bytes_consumed" => Some("&c".into()),
                    _ => f
                        .params
                        .iter()
                        .position(|p| sanitize_param_name(p) == name)
                        .map(|i| format!("p[{i}]")),
                }
            };
            let fargs: Option<Vec<String>> = fa.iter().map(|a| value(a)).collect();
            let vargs: Option<Vec<String>> = va.iter().map(|a| value(a)).collect();
            let (Some(fargs), Some(vargs)) = (fargs, vargs) else {
                continue;
            };
            c_fns += 1;
            let _ = writeln!(
                cases,
                "    case {fi}: r = {cn}_validate_ir( {va} ); printf( \"%lu %llu %d %llu\\n\", rec, (unsigned long long){cn}_footprint_ir( {fa} ), r, (unsigned long long)c ); break;",
                cn = f.c_name,
                fa = fargs.join(", "),
                va = vargs.join(", ")
            );
        }
        if cases.is_empty() {
            continue;
        }
        let mut main =
            String::from("#include <stdio.h>\n#include <stdlib.h>\n#include <stdint.h>\n");
        for p in pkgs {
            let _ = writeln!(main, "#include \"{p}/types.h\"");
        }
        let _ = writeln!(
            main,
            "static unsigned const arity[] = {{ {} }};\nstatic uint64_t rd( uint8_t const * b ) {{ uint64_t v = 0; for( int i=7; i>=0; i-- ) v = v<<8 | b[i]; return v; }}\nint main( int argc, char ** argv ) {{\n  if( argc<2 ) return 1;\n  FILE * fl = fopen( argv[1], \"rb\" ); if( !fl ) return 1;\n  fseek( fl, 0, SEEK_END ); long sz = ftell( fl ); fseek( fl, 0, SEEK_SET );\n  uint8_t * blob = malloc( (size_t)sz + 1 );\n  if( fread( blob, 1, (size_t)sz, fl )!=(size_t)sz ) return 1;\n  fclose( fl );\n  unsigned long rec = 0;\n  for( long at = 0; at < sz; rec++ ) {{\n    uint32_t f = (uint32_t)blob[at] | (uint32_t)blob[at+1]<<8 | (uint32_t)blob[at+2]<<16 | (uint32_t)blob[at+3]<<24;\n    uint64_t b = rd( blob+at+4 );\n    uint64_t p[ 16 ] = {{ 0 }};\n    for( unsigned i = 0; i < arity[f] && i < 16; i++ ) p[i] = rd( blob+at+12+8*i );\n    at += 12 + 8*(long)arity[f];\n    uint64_t c = 0; int r = 0;\n    switch( f ) {{\n{cases}    default: break;\n    }}\n    (void)b; (void)p; (void)c; (void)r;\n  }}\n  free( blob );\n  return 0;\n}}",
            arity.join(", ")
        );
        fs::write(dir.join("ir_main.c"), main).unwrap();
        let cc = std::env::var("CC").unwrap_or_else(|_| "cc".to_string());
        let mut cmd = Command::new(&cc);
        cmd.current_dir(&dir)
            .args(["-std=c11", "-I.", "-o", "ir_c", "ir_main.c"]);
        for p in pkgs {
            cmd.arg(format!("{p}/functions.c"));
        }
        let out = cmd.output().expect("cc");
        assert!(
            out.status.success(),
            "C IR build failed (group {gi}):\n{}",
            String::from_utf8_lossy(&out.stderr)
        );
        let out = Command::new(dir.join("ir_c"))
            .arg(&input_path)
            .output()
            .expect("run C");
        assert!(out.status.success(), "C IR program failed (group {gi})");
        for line in String::from_utf8_lossy(&out.stdout).lines() {
            if let Some((rec, rest)) = line.split_once(' ') {
                c_lines.insert(rec.parse().unwrap(), rest.to_string());
            }
        }
    }

    assert_eq!(rust_lines.len(), records.len());
    assert_eq!(go_lines.len(), records.len());
    let mut failures = Vec::new();
    for (rec, (fi, buf, params)) in records.iter().enumerate() {
        let f = &fns[*fi];
        let (r, g) = (&rust_lines[rec], &go_lines[rec]);
        if r != g {
            failures.push(format!(
                "{} buf_sz={buf} {params:?}: Rust `{r}`, Go `{g}`",
                f.key
            ));
        }
        if let Some(c) = c_lines.get(&rec) {
            let mut it = c.split(' ');
            let (cfp, crc, ccons) = (it.next().unwrap(), it.next().unwrap(), it.next().unwrap());
            let mut rit = r.split(' ');
            let (rfp, rv) = (rit.next().unwrap(), rit.next().unwrap());
            let rfp = rfp
                .strip_prefix("ok:")
                .map(String::from)
                .unwrap_or_else(|| u64::MAX.to_string());
            let c_ok = crc == "0";
            let agree = cfp == rfp
                && c_ok == rv.starts_with("ok:")
                && (!c_ok || rv == format!("ok:{ccons}"));
            if !agree {
                failures.push(format!(
                    "{} buf_sz={buf} {params:?}: Rust `{r}`, C `{c}`",
                    f.key
                ));
            }
        }
    }
    println!(
        "IR helpers: {} functions, {} inputs; Rust = Go on {}; C compared on {} inputs of {} functions",
        fns.len(),
        records.len(),
        records.len() - failures.iter().filter(|f| f.contains(", Go `")).count(),
        c_lines.len(),
        c_fns
    );
    let _ = fs::remove_dir_all(&root);
    failures.truncate(30);
    assert!(
        failures.is_empty(),
        "IR helper disagreements:\n{}",
        failures.join("\n")
    );
}
