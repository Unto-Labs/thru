use anyhow::{Context, Result};
use std::fs;
use std::path::Path;
use std::process::Command;
use std::time::Instant;

use super::LanguageRunner;
use crate::{TestCaseData, TestError, TestResult, TestStages};

use abi_gen::abi::file::AbiFile;
use abi_gen::abi::resolved::{ResolvedTypeKind, TypeResolver};
use abi_gen::codegen::rust_gen::emit::{Elem, Emitter, Shape, Slot, VInfo};
use abi_gen::codegen::rust_gen::emit_builder::variant_setter_suffixes;
use abi_gen::codegen::rust_gen::model::{escape_ident, plain_ident, prim_is_byte, Model};
use std::collections::BTreeSet;
use std::fmt::Write as _;

pub struct RustRunner;

impl LanguageRunner for RustRunner {
    fn language_name(&self) -> &str {
        "rust"
    }

    fn run_test(
        &self,
        test_name: &str,
        test_file: &str,
        test_case: &TestCaseData,
        abi_file_path: &Path,
        binary_data: &[u8],
        verbose: bool,
        no_cleanup: bool,
        base_temp_dir: Option<&Path>,
    ) -> Result<TestResult> {
        let start_time = Instant::now();

        /* Create temporary directory for generated code */
        let temp_base = base_temp_dir
            .map(|p| p.to_path_buf())
            .unwrap_or_else(std::env::temp_dir);
        let temp_dir = temp_base.join(format!("abi_compliance_rust_{}", test_name));
        if temp_dir.exists() {
            fs::remove_dir_all(&temp_dir)?;
        }
        fs::create_dir_all(&temp_dir)?;

        if verbose {
            println!("  Temp dir: {}", temp_dir.display());
        }

        let generated_code_dir = temp_dir.join("generated_code");
        fs::create_dir_all(&generated_code_dir)?;

        let mut stages = TestStages {
            code_generation: "pending".to_string(),
            compilation: "pending".to_string(),
            decode: "pending".to_string(),
            validation: "pending".to_string(),
            reencode: "pending".to_string(),
            binary_match: false,
        };

        /* Stage 1: Generate Rust code */
        if verbose {
            println!("  [1/5] Generating Rust code...");
        }

        match abi_gen::cmds::codegen::run(
            vec![abi_file_path.to_path_buf()],
            Vec::new(),
            abi_gen::cmds::codegen::Language::Rust,
            generated_code_dir.clone(),
            verbose,
        ) {
            Ok(()) => {
                stages.code_generation = "ok".to_string();
            }
            Err(e) => {
                return Ok(TestResult {
                    test_name: test_name.to_string(),
                    test_file: test_file.to_string(),
                    status: "fail".to_string(),
                    duration_ms: start_time.elapsed().as_millis() as u64,
                    stages: Some(stages),
                    error: Some(TestError {
                        stage: "code_generation".to_string(),
                        message: "Code generation failed".to_string(),
                        details: Some(e.to_string()),
                    }),
                });
            }
        }

        /* Stage 2: Create test Cargo project and compile */
        if verbose {
            println!("  [2/5] Creating test project and compiling...");
        }

        let test_project_dir = temp_dir.join("test_project");
        fs::create_dir_all(&test_project_dir)?;

        /* Create Cargo.toml for test project */
        let cargo_toml = r#"[package]
name = "compliance_test"
version = "0.1.0"
edition = "2021"

[[bin]]
name = "test_runner"
path = "src/main.rs"
"#;
        fs::write(test_project_dir.join("Cargo.toml"), cargo_toml)?;

        /* Create src directory and copy generated code */
        let src_dir = test_project_dir.join("src");
        fs::create_dir_all(&src_dir)?;

        /* Copy generated code to src/generated/ */
        let generated_dir = src_dir.join("generated");
        copy_dir_recursive(&generated_code_dir, &generated_dir)?;

        /* Generate a runner that decodes, validates and re-encodes through the public API */
        let test_runner_code =
            match generate_runner(abi_file_path, &test_case.type_name, binary_data) {
                Ok(code) => code,
                Err(e) => {
                    return Ok(TestResult {
                        test_name: test_name.to_string(),
                        test_file: test_file.to_string(),
                        status: "fail".to_string(),
                        duration_ms: start_time.elapsed().as_millis() as u64,
                        stages: Some(stages),
                        error: Some(TestError {
                            stage: "code_generation".to_string(),
                            message: format!("Failed to generate the Rust test runner: {}", e),
                            details: None,
                        }),
                    });
                }
            };
        fs::write(src_dir.join("main.rs"), test_runner_code)?;

        /* Compile the test project */
        let compile_result = Command::new("cargo")
            .args(["build", "--release", "--quiet"])
            .current_dir(&test_project_dir)
            .output();

        match compile_result {
            Ok(output) if output.status.success() => {
                stages.compilation = "ok".to_string();
            }
            Ok(output) => {
                let error_msg = String::from_utf8_lossy(&output.stderr);
                return Ok(TestResult {
                    test_name: test_name.to_string(),
                    test_file: test_file.to_string(),
                    status: "fail".to_string(),
                    duration_ms: start_time.elapsed().as_millis() as u64,
                    stages: Some(stages),
                    error: Some(TestError {
                        stage: "compilation".to_string(),
                        message: "Test project compilation failed".to_string(),
                        details: Some(error_msg.to_string()),
                    }),
                });
            }
            Err(e) => {
                return Ok(TestResult {
                    test_name: test_name.to_string(),
                    test_file: test_file.to_string(),
                    status: "fail".to_string(),
                    duration_ms: start_time.elapsed().as_millis() as u64,
                    stages: Some(stages),
                    error: Some(TestError {
                        stage: "compilation".to_string(),
                        message: format!("Failed to compile test project: {}", e),
                        details: None,
                    }),
                });
            }
        }

        /* Stage 3-5: Run test (decode, validate, reencode) */
        if verbose {
            println!("  [3/5] Running decode-validate-reencode test...");
        }

        let test_binary = test_project_dir.join("target/release/test_runner");
        let test_output = Command::new(&test_binary).output();

        match test_output {
            Ok(output) if output.status.success() => {
                let stdout = String::from_utf8_lossy(&output.stdout);

                /* Parse test output - format is: STAGE:status */
                for line in stdout.lines() {
                    if line.starts_with("DECODE:") {
                        stages.decode = line.strip_prefix("DECODE:").unwrap().to_string();
                    } else if line.starts_with("VALIDATION:") {
                        stages.validation = line.strip_prefix("VALIDATION:").unwrap().to_string();
                    } else if line.starts_with("REENCODE:") {
                        stages.reencode = line.strip_prefix("REENCODE:").unwrap().to_string();
                    } else if line.starts_with("BINARY_MATCH:") {
                        stages.binary_match = line.strip_prefix("BINARY_MATCH:").unwrap() == "true";
                    }
                }
            }
            Ok(output) => {
                let error_msg = String::from_utf8_lossy(&output.stderr);
                let stdout_msg = String::from_utf8_lossy(&output.stdout);
                return Ok(TestResult {
                    test_name: test_name.to_string(),
                    test_file: test_file.to_string(),
                    status: "fail".to_string(),
                    duration_ms: start_time.elapsed().as_millis() as u64,
                    stages: Some(stages),
                    error: Some(TestError {
                        stage: "decode".to_string(),
                        message: "Test execution failed".to_string(),
                        details: Some(format!("stdout:\n{}\nstderr:\n{}", stdout_msg, error_msg)),
                    }),
                });
            }
            Err(e) => {
                return Ok(TestResult {
                    test_name: test_name.to_string(),
                    test_file: test_file.to_string(),
                    status: "fail".to_string(),
                    duration_ms: start_time.elapsed().as_millis() as u64,
                    stages: Some(stages),
                    error: Some(TestError {
                        stage: "decode".to_string(),
                        message: format!("Failed to execute test: {}", e),
                        details: None,
                    }),
                });
            }
        }

        /* Clean up */
        if !no_cleanup && temp_dir.exists() {
            let _ = fs::remove_dir_all(&temp_dir);
        } else if no_cleanup && verbose {
            println!("  Temporary directory preserved at: {}", temp_dir.display());
        }

        let duration_ms = start_time.elapsed().as_millis() as u64;

        /* Mark as pass if all stages succeeded */
        let status = if stages.code_generation == "ok"
            && stages.compilation == "ok"
            && stages.decode == "ok"
            && stages.validation == "ok"
            && stages.reencode == "ok"
            && stages.binary_match
        {
            "pass"
        } else {
            "fail"
        };

        Ok(TestResult {
            test_name: test_name.to_string(),
            test_file: test_file.to_string(),
            status: status.to_string(),
            duration_ms,
            stages: Some(stages),
            error: None,
        })
    }
}

/* Recursively copy directory contents */
fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<()> {
    fs::create_dir_all(dst)
        .with_context(|| format!("Failed to create directory: {}", dst.display()))?;

    for entry in
        fs::read_dir(src).with_context(|| format!("Failed to read directory: {}", src.display()))?
    {
        let entry = entry?;
        let path = entry.path();
        let file_name = entry.file_name();
        let dst_path = dst.join(&file_name);

        if path.is_dir() {
            copy_dir_recursive(&path, &dst_path).with_context(|| {
                format!(
                    "Failed to copy directory: {} -> {}",
                    path.display(),
                    dst_path.display()
                )
            })?;
        } else {
            fs::copy(&path, &dst_path).with_context(|| {
                format!(
                    "Failed to copy file: {} -> {}",
                    path.display(),
                    dst_path.display()
                )
            })?;
        }
    }

    Ok(())
}

/* ---------------------------------------------------------------------------
 * Runner generation
 *
 * The runner decodes the case with `from_slice`, checks `validate`, reads the
 * dynamic parameters back with `<T>Params::from_buffer` / `dynamic_params()`,
 * and re-encodes twice, both purely through the generated public API:
 *   1. `new_from_params` + typed mutable accessors (enum payloads through the
 *      typed `<field>_mut()` variant views) into a 0xa5-filled buffer;
 *   2. the generated builders (`build`, `finish`, `build_into`).
 * The copy/build helpers are generated per view from the ABI, field by field,
 * so a field without an accessor fails to compile and a skipped field leaves
 * zeros behind and fails the byte comparison.
 * ------------------------------------------------------------------------- */

struct RunnerGen<'m, 'a> {
    e: &'m Emitter<'m, 'a>,
    done: BTreeSet<String>,
    fns: String,
}

impl<'m, 'a> RunnerGen<'m, 'a> {
    fn ensure(&mut self, vname: &str) -> Result<()> {
        if !self.done.insert(vname.to_string()) {
            return Ok(());
        }
        let v = self
            .e
            .info(vname)
            .ok_or_else(|| anyhow::anyhow!("no generated view for {}", vname))?;
        let copy = self.copy_fn(&v)?;
        let build = self.build_fn(&v)?;
        self.fns.push_str(&copy);
        self.fns.push_str(&build);
        Ok(())
    }

    fn child(&mut self, elem: &Elem<'a>) -> Result<()> {
        if let Elem::View(c) = elem {
            self.ensure(&c.vname)?;
        }
        Ok(())
    }

    fn names(&self, v: &VInfo<'a>, slot: &Slot<'a>) -> (String, String) {
        let base = self.e.method_base(v, slot);
        (base.clone(), escape_ident(&base))
    }

    /* Union views are copied through one variant spanning the whole union. */
    fn union_slot(&self, v: &VInfo<'a>) -> Result<Slot<'a>> {
        let size = abi_gen::codegen::rust_gen::model::const_size(v.ty)
            .ok_or_else(|| anyhow::anyhow!("variable-size union {}", v.ty.name))?;
        let slots = self.e.slots(v);
        let rank = |s: &Slot<'a>| match &s.shape {
            Shape::Prim(_) => 0,
            Shape::Array(_) => 1,
            _ => 2,
        };
        slots
            .into_iter()
            .filter(|s| abi_gen::codegen::rust_gen::model::const_size(s.ty) == Some(size))
            .min_by_key(|s| rank(s))
            .ok_or_else(|| anyhow::anyhow!("union {} has no full-width variant", v.ty.name))
    }

    /* Generated Rust name of the view `key` (also the suffix of its
     * `copy_` / `build_` helpers). */
    fn id(&self, key: &str) -> String {
        self.e.nm(key).ty.clone()
    }

    fn copy_fn(&mut self, v: &VInfo<'a>) -> Result<String> {
        let nm = self.e.nm(&v.name);
        let (n, m) = (&nm.ty, &nm.mut_);
        let mut out = String::new();
        writeln!(out, "#[allow(unused_variables, unused_mut)]")?;
        writeln!(out, "fn copy_{n}(s: &{n}<'_>, d: &mut {m}<'_>) {{")?;
        let slots = match &v.ty.kind {
            ResolvedTypeKind::Union { .. } => vec![self.union_slot(v)?],
            _ => self.e.slots(v),
        };
        for slot in &slots {
            let (base, getter) = self.names(v, slot);
            let h = |s: &str| self.e.hname(v, &base, s);
            if self.e.open_slot(v, slot) {
                /* `new_from_params` zero-fills a slot whose size is a parameter
                 * (`<field>_payload_size`); its typed sub-views would parse the
                 * zeros, so the encoded bytes go in at the same offset. */
                let src = match &slot.shape {
                    Shape::View(_) => format!("s.{getter}().as_bytes()"),
                    Shape::Enum { .. } => format!("s.{}()", h("body")),
                    _ => format!("s.{}()", h("bytes")),
                };
                writeln!(
                    out,
                    "    {{ let src = {src}; let off = src.as_ptr() as usize - s.as_bytes().as_ptr() as usize; d.as_bytes_mut()[off..off + src.len()].copy_from_slice(src); }}"
                )?;
                continue;
            }
            match &slot.shape {
                Shape::Prim(_) => writeln!(out, "    d.set_{base}(s.{getter}());")?,
                Shape::Array(a) => {
                    let len = h("len");
                    let get = h("get");
                    match &a.elem {
                        Elem::Prim(p) if prim_is_byte(p) && !base.is_empty() => {
                            writeln!(out, "    d.set_{base}(s.{getter}());")?;
                            writeln!(out, "    for i in 0..s.{len}() {{ assert_eq!(s.{get}(i), s.{getter}()[i]); }}")?;
                        }
                        Elem::Prim(_) => writeln!(
                            out,
                            "    for i in 0..s.{len}() {{ d.{set}(i, s.{get}(i)); }}",
                            set = h("set")
                        )?,
                        Elem::View(c) => {
                            self.child(&a.elem)?;
                            writeln!(
                                out,
                                "    for i in 0..s.{len}() {{ copy_{c}(&s.{get}(i), &mut d.{gm}(i)); }}",
                                c = self.id(&c.vname),
                                gm = h("get_mut")
                            )?;
                        }
                        Elem::Opaque(_) => anyhow::bail!("opaque array elements in {}", slot.name),
                    }
                }
                Shape::View(c) => {
                    self.ensure(&c.vname)?;
                    writeln!(
                        out,
                        "    copy_{c}(&s.{getter}(), &mut d.{m}());",
                        c = self.id(&c.vname),
                        m = h("mut")
                    )?;
                }
                Shape::Enum { variants, .. } | Shape::Sdu { variants } => {
                    let (rn, rmn) = self.e.ref_enum_names(v, slot);
                    let arms = self.e.variant_arm_names(variants);
                    let (get, getm) = if base.is_empty() {
                        ("variant".to_string(), "variant_mut".to_string())
                    } else {
                        (getter.clone(), h("mut"))
                    };
                    writeln!(out, "    match s.{get}() {{")?;
                    for (var, arm) in variants.iter().zip(&arms) {
                        self.child(&var.elem)?;
                        let body = match &var.elem {
                            Elem::View(c) => format!("copy_{}(&x, &mut y)", self.id(&c.vname)),
                            Elem::Prim(_) => "y.copy_from_slice(&x.to_le_bytes())".to_string(),
                            Elem::Opaque(_) => "y.copy_from_slice(x)".to_string(),
                        };
                        writeln!(
                            out,
                            "        {rn}::{arm}(x) => match d.{getm}() {{ {rmn}::{arm}(mut y) => {body}, _ => panic!(\"{arm}: destination variant differs\") }},"
                        )?;
                    }
                    writeln!(
                        out,
                        "        _ => panic!(\"unexpected variant in {}\"),",
                        slot.name
                    )?;
                    writeln!(out, "    }}")?;
                }
            }
        }
        writeln!(out, "}}\n")?;
        Ok(out)
    }

    fn build_fn(&mut self, v: &VInfo<'a>) -> Result<String> {
        let nm = self.e.nm(&v.name);
        let (n, nb) = (&nm.ty, &nm.builder);
        let mut out = String::new();
        writeln!(
            out,
            "fn build_{n}(s: &{n}<'_>) -> Vec<u8> {{ builder_{n}(s).build() }}"
        )?;
        writeln!(out, "#[allow(unused_mut)]")?;
        writeln!(out, "fn builder_{n}(s: &{n}<'_>) -> {nb} {{")?;
        writeln!(out, "    let mut b = {nb}::new();")?;
        match &v.ty.kind {
            ResolvedTypeKind::Struct { .. } => {
                for slot in self.e.slots(v) {
                    let (base, getter) = self.names(v, &slot);
                    let pb = plain_ident(&slot.name);
                    let h = |s: &str| self.e.hname(v, &base, s);
                    match &slot.shape {
                        Shape::Prim(_) => writeln!(out, "    b = b.set_{pb}(s.{getter}());")?,
                        Shape::Array(a) => match &a.elem {
                            Elem::Prim(_) => writeln!(
                                out,
                                "    let vals: Vec<_> = (0..s.{len}()).map(|i| s.{get}(i)).collect();\n    b = b.set_{pb}(&vals);",
                                len = h("len"),
                                get = h("get")
                            )?,
                            Elem::View(c) => {
                                self.child(&a.elem)?;
                                writeln!(
                                    out,
                                    "    for i in 0..s.{len}() {{ b = b.push_{pb}(&build_{c}(&s.{get}(i))); }}",
                                    len = h("len"),
                                    get = h("get"),
                                    c = self.id(&c.vname)
                                )?;
                            }
                            Elem::Opaque(_) => anyhow::bail!("opaque array elements in {}", slot.name),
                        },
                        Shape::View(c) => {
                            self.ensure(&c.vname)?;
                            writeln!(out, "    b = b.set_{pb}(&build_{c}(&s.{getter}()));", c = self.id(&c.vname))?;
                        }
                        Shape::Enum { variants, .. } | Shape::Sdu { variants } => {
                            let (rn, _) = self.e.ref_enum_names(v, &slot);
                            let arms = self.e.variant_arm_names(variants);
                            let suffixes = variant_setter_suffixes(variants);
                            writeln!(out, "    match s.{getter}() {{")?;
                            for ((var, arm), sfx) in variants.iter().zip(&arms).zip(&suffixes) {
                                self.child(&var.elem)?;
                                let payload = match &var.elem {
                                    Elem::View(c) => format!("&build_{}(&x)", self.id(&c.vname)),
                                    Elem::Prim(_) => "&x.to_le_bytes()".to_string(),
                                    Elem::Opaque(_) => "x".to_string(),
                                };
                                /* Fixed-size payloads go through the fallible twin. */
                                if var.elem.size().is_some() {
                                    writeln!(out, "        {rn}::{arm}(x) => {{ b = b.try_set_{pb}_{sfx}({payload}).expect(\"try_set_{pb}_{sfx}\"); }}")?;
                                } else {
                                    writeln!(out, "        {rn}::{arm}(x) => {{ b = b.set_{pb}_{sfx}({payload}); }}")?;
                                }
                            }
                            writeln!(out, "        _ => panic!(\"unexpected variant in {}\"),", slot.name)?;
                            writeln!(out, "    }}")?;
                        }
                    }
                }
            }
            ResolvedTypeKind::Union { .. } => {
                let slot = self.union_slot(v)?;
                let (_, getter) = self.names(v, &slot);
                let pb = plain_ident(&slot.name);
                match &slot.shape {
                    Shape::Prim(_) => writeln!(out, "    b = b.set_{pb}(s.{getter}());")?,
                    Shape::Array(a) => match &a.elem {
                        Elem::Prim(p) if prim_is_byte(p) => {
                            writeln!(out, "    b = b.set_{pb}(s.{getter}());")?
                        }
                        _ => writeln!(out, "    b = b.set_encoding(s.as_bytes());")?,
                    },
                    Shape::View(c) => {
                        self.ensure(&c.vname)?;
                        writeln!(
                            out,
                            "    b = b.set_{pb}(&build_{c}(&s.{getter}()));",
                            c = self.id(&c.vname)
                        )?;
                    }
                    _ => anyhow::bail!("unsupported union variant {}", slot.name),
                }
            }
            ResolvedTypeKind::Array { .. } => {
                let slot = &self.e.slots(v)[0];
                if let Shape::Array(a) = &slot.shape {
                    match &a.elem {
                        Elem::Prim(_) => {
                            writeln!(out, "    for i in 0..s.len() {{ b = b.set(i, s.get(i)); }}")?
                        }
                        Elem::View(c) => {
                            self.child(&a.elem)?;
                            writeln!(out, "    for i in 0..s.len() {{ b = b.set(i, &build_{c}(&s.get(i))); }}", c = self.id(&c.vname))?;
                        }
                        Elem::Opaque(_) => anyhow::bail!("opaque array elements in {}", v.ty.name),
                    }
                }
            }
            _ => anyhow::bail!("no builder for {}", v.ty.name),
        }
        writeln!(out, "    b")?;
        writeln!(out, "}}\n")?;
        Ok(out)
    }
}

fn generate_runner(abi_file_path: &Path, type_name: &str, data: &[u8]) -> Result<String> {
    let abi: AbiFile = serde_yaml::from_str(&fs::read_to_string(abi_file_path)?)?;
    let package = abi.package().to_string();
    let mut resolver = TypeResolver::new();
    for typedef in abi.get_types() {
        resolver.add_typedef(typedef.clone());
    }
    resolver
        .resolve_all()
        .map_err(|e| anyhow::anyhow!("resolve: {:?}", e))?;
    let model = Model::new(&resolver);
    let e = Emitter::new(&model);
    let ty = resolver
        .get_type_info(type_name)
        .ok_or_else(|| anyhow::anyhow!("Type '{}' not found", type_name))?;
    model.collect_named(&ty.name);
    let vname = ty.name.clone();
    let root = e
        .info(&vname)
        .ok_or_else(|| anyhow::anyhow!("no view generated for {}", type_name))?;
    let mut g = RunnerGen {
        e: &e,
        done: BTreeSet::new(),
        fns: String::new(),
    };
    g.ensure(&vname)?;
    let is_root_struct = root.is_root_struct();

    let tn = e.nm(&vname);
    let (t, tp, tm) = (&tn.ty, &tn.params, &tn.mut_);
    let mut code = String::new();
    writeln!(code, "#![allow(dead_code, unused_imports, non_snake_case)]")?;
    writeln!(code, "mod generated;")?;
    writeln!(code, "use generated::{}::*;\n", package.replace('.', "::"))?;
    code.push_str(&g.fns);
    writeln!(code, "fn main() {{")?;
    writeln!(code, "    let data: &[u8] = &{:?};", data)?;
    writeln!(
        code,
        "    let orig = {t}::from_slice(data).expect(\"from_slice\");"
    )?;
    writeln!(code, "    println!(\"DECODE:ok\");")?;
    writeln!(code, "    assert_eq!({t}::validate(data).expect(\"validate\"), data.len(), \"validate consumed size\");")?;
    writeln!(
        code,
        "    assert_eq!(orig.size(), data.len(), \"view size\");"
    )?;
    writeln!(code, "    assert_eq!(orig.check(), Ok(data.len()));")?;
    writeln!(code, "    if !data.is_empty() {{")?;
    writeln!(
        code,
        "        match {t}::validate(&data[..data.len() - 1]) {{"
    )?;
    writeln!(
        code,
        "            Ok(n) => assert_ne!(n, data.len(), \"truncated buffer validated\"),"
    )?;
    writeln!(
        code,
        "            /* A short buffer reports a required size within the real one. */"
    )?;
    writeln!(code, "            Err(e) => if let Some(n) = e.required_size() {{ assert!(n > data.len() - 1 && n <= data.len(), \"required size {{}} for {{}} bytes\", n, data.len()); }},")?;
    writeln!(code, "        }}")?;
    writeln!(code, "    }}")?;
    if is_root_struct {
        writeln!(
            code,
            "    let params = {tp}::from_buffer(data).expect(\"from_buffer\");"
        )?;
        writeln!(
            code,
            "    assert_eq!(params, orig.dynamic_params(), \"dynamic_params\");"
        )?;
        writeln!(
            code,
            "    let fp = {t}::footprint_from_params(&params).expect(\"footprint_from_params\");"
        )?;
        writeln!(code, "    assert_eq!(params.footprint(), Ok(fp));")?;
        /* Generic access through the parameter keys. */
        writeln!(code, "    let mut generic = {tp}::default();")?;
        writeln!(code, "    for (field, path) in {tp}::KEYS {{ assert!(generic.set(path, params.get(field).expect(\"key\"))); }}")?;
        writeln!(
            code,
            "    assert_eq!(generic, params, \"params rebuilt from KEYS\");"
        )?;
        writeln!(
            code,
            "    assert_eq!(fp, data.len(), \"footprint_from_params\");"
        )?;
    }
    writeln!(code, "    println!(\"VALIDATION:ok\");")?;
    if is_root_struct {
        /* Every case (jagged and payload-sized ones included) re-encodes from its params. */
        writeln!(code, "    let mut buf = vec![0xa5u8; data.len()];")?;
        writeln!(code, "    assert_eq!({t}::new_from_params(&mut buf, &params).expect(\"new_from_params\"), data.len());")?;
        writeln!(code, "    {{")?;
        writeln!(
            code,
            "        let mut m = {tm}::from_slice_mut(&mut buf).expect(\"from_slice_mut\");"
        )?;
        writeln!(code, "        copy_{t}(&orig, &mut m);")?;
        writeln!(code, "    }}")?;
        writeln!(
            code,
            "    assert_eq!(buf.as_slice(), data, \"new_from_params + setters re-encode\");"
        )?;
    } else {
        writeln!(code, "    let mut buf = vec![0u8; data.len()];")?;
        writeln!(code, "    {{")?;
        writeln!(
            code,
            "        let mut m = {tm}::from_slice_mut(&mut buf).expect(\"from_slice_mut\");"
        )?;
        writeln!(code, "        copy_{t}(&orig, &mut m);")?;
        writeln!(code, "    }}")?;
        writeln!(
            code,
            "    assert_eq!(buf.as_slice(), data, \"setter re-encode\");"
        )?;
    }
    writeln!(code, "    let built = build_{t}(&orig);")?;
    if is_root_struct {
        writeln!(
            code,
            "    assert_eq!(builder_{t}(&orig).dynamic_params(), Ok(params), \"builder dynamic_params\");"
        )?;
        /* Re-select every enum/SDU variant by its ABI name from the variant table. */
        for slot in e.slots(&root) {
            if !matches!(slot.shape, Shape::Enum { .. } | Shape::Sdu { .. }) {
                continue;
            }
            let base = e.method_base(&root, &slot);
            let pb = plain_ident(&slot.name);
            let table = format!("{}VARIANTS", e.variant_const_prefix(&slot));
            writeln!(
                code,
                "    let info = {t}::{by_tag}(orig.{tag}() as u64).expect(\"variant info\");",
                by_tag = e.hname(&root, &base, "variant_by_tag"),
                tag = e.hname(&root, &base, "tag")
            )?;
            writeln!(code, "    assert!({t}::{table}.contains(info));")?;
            writeln!(
                code,
                "    let by_name = builder_{t}(&orig).try_set_{pb}_variant_by_name(info.name, orig.{body}()).expect(\"by name\").build();",
                body = e.hname(&root, &base, "body")
            )?;
            writeln!(
                code,
                "    assert_eq!(by_name.as_slice(), data, \"variant re-selected by name\");"
            )?;
        }
    }
    writeln!(
        code,
        "    assert_eq!(built.as_slice(), data, \"builder re-encode\");"
    )?;
    writeln!(
        code,
        "    let owned = builder_{t}(&orig).finish().expect(\"finish\");"
    )?;
    writeln!(
        code,
        "    assert_eq!(owned.as_bytes(), data, \"finish bytes\");"
    )?;
    writeln!(
        code,
        "    assert_eq!(owned.size(), data.len(), \"finish size\");"
    )?;
    writeln!(code, "    let mut target = vec![0xa5u8; data.len() + 4];")?;
    writeln!(
        code,
        "    let written = builder_{t}(&orig).build_into(&mut target).expect(\"build_into\");"
    )?;
    writeln!(
        code,
        "    assert_eq!(&target[..written], data, \"build_into bytes\");"
    )?;
    writeln!(code, "    assert!(target[written..].iter().all(|b| *b == 0xa5), \"build_into wrote past the value\");")?;
    writeln!(code, "    println!(\"REENCODE:ok\");")?;
    writeln!(code, "    println!(\"BINARY_MATCH:true\");")?;
    writeln!(code, "}}")?;
    Ok(code)
}
