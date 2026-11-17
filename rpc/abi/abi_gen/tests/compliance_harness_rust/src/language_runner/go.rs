use anyhow::Result;
use std::fs;
use std::path::Path;
use std::process::Command;
use std::time::Instant;

use super::LanguageRunner;
use crate::{TestCaseData, TestError, TestResult, TestStages};

use abi_gen::abi::file::AbiFile;
use abi_gen::abi::resolved::{ResolvedTypeKind, TypeResolver};
use abi_gen::codegen::go_gen::emit::GoEmitter;
use abi_gen::codegen::go_gen::names::{go_to_raw, package_name};
use abi_gen::codegen::rust_gen::emit::{Elem, Shape, Slot, VInfo};
use abi_gen::codegen::rust_gen::model::{const_size, prim_is_byte, prim_size, Model};
use std::collections::{BTreeSet, HashMap};
use std::fmt::Write as _;

pub struct GoRunner;

/* Go binary: `GO` if set, else `go` on PATH. */
pub fn go_bin() -> String {
    std::env::var("GO").unwrap_or_else(|_| "go".to_string())
}

impl LanguageRunner for GoRunner {
    fn language_name(&self) -> &str {
        "go"
    }

    fn codegen_language_param(&self) -> &str {
        "go"
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
        let temp_base = base_temp_dir
            .map(|p| p.to_path_buf())
            .unwrap_or_else(std::env::temp_dir);
        let temp_dir = temp_base.join(format!("abi_compliance_go_{}", test_name));
        if temp_dir.exists() {
            fs::remove_dir_all(&temp_dir)?;
        }
        fs::create_dir_all(&temp_dir)?;
        if verbose {
            println!("  Temp dir: {}", temp_dir.display());
        }

        let mut stages = TestStages {
            code_generation: "pending".to_string(),
            compilation: "pending".to_string(),
            decode: "pending".to_string(),
            validation: "pending".to_string(),
            reencode: "pending".to_string(),
            binary_match: false,
        };
        let fail = |stages: TestStages, stage: &str, message: String, details: Option<String>| {
            Ok(TestResult {
                test_name: test_name.to_string(),
                test_file: test_file.to_string(),
                status: "fail".to_string(),
                duration_ms: start_time.elapsed().as_millis() as u64,
                stages: Some(stages),
                error: Some(TestError {
                    stage: stage.to_string(),
                    message,
                    details,
                }),
            })
        };

        /* Stage 1: generate the Go module (go.mod, tnabi, the package). */
        if let Err(e) = abi_gen::cmds::codegen::run(
            vec![abi_file_path.to_path_buf()],
            Vec::new(),
            abi_gen::cmds::codegen::Language::Go,
            temp_dir.clone(),
            verbose,
        ) {
            return fail(
                stages,
                "code_generation",
                "Code generation failed".into(),
                Some(e.to_string()),
            );
        }
        stages.code_generation = "ok".to_string();

        /* A runner that decodes, validates and re-encodes through the public API. */
        let runner = match generate_runner(abi_file_path, &test_case.type_name, binary_data) {
            Ok(code) => code,
            Err(e) => {
                return fail(
                    stages,
                    "code_generation",
                    format!("Failed to generate the Go test runner: {}", e),
                    None,
                )
            }
        };
        let cmd_dir = temp_dir.join("cmd/runner");
        fs::create_dir_all(&cmd_dir)?;
        fs::write(cmd_dir.join("main.go"), runner)?;

        /* Stage 2: vet and build (no cgo). */
        for args in [
            &["vet", "./..."][..],
            &["build", "-o", "runner_bin", "./cmd/runner"][..],
        ] {
            let out = Command::new(go_bin())
                .args(args)
                .current_dir(&temp_dir)
                .env("CGO_ENABLED", "0")
                .output();
            match out {
                Ok(o) if o.status.success() => {}
                Ok(o) => {
                    return fail(
                        stages,
                        "compilation",
                        format!("go {} failed", args[0]),
                        Some(format!(
                            "{}{}",
                            String::from_utf8_lossy(&o.stdout),
                            String::from_utf8_lossy(&o.stderr)
                        )),
                    )
                }
                Err(e) => {
                    return fail(
                        stages,
                        "compilation",
                        format!("failed to run go: {}", e),
                        None,
                    )
                }
            }
        }
        stages.compilation = "ok".to_string();

        /* Stages 3-5 */
        match Command::new(temp_dir.join("runner_bin")).output() {
            Ok(o) if o.status.success() => {
                for line in String::from_utf8_lossy(&o.stdout).lines() {
                    if let Some(s) = line.strip_prefix("DECODE:") {
                        stages.decode = s.to_string();
                    } else if let Some(s) = line.strip_prefix("VALIDATION:") {
                        stages.validation = s.to_string();
                    } else if let Some(s) = line.strip_prefix("REENCODE:") {
                        stages.reencode = s.to_string();
                    } else if let Some(s) = line.strip_prefix("BINARY_MATCH:") {
                        stages.binary_match = s == "true";
                    }
                }
            }
            Ok(o) => {
                return fail(
                    stages,
                    "decode",
                    "Test execution failed".into(),
                    Some(format!(
                        "stdout:\n{}\nstderr:\n{}",
                        String::from_utf8_lossy(&o.stdout),
                        String::from_utf8_lossy(&o.stderr)
                    )),
                )
            }
            Err(e) => {
                return fail(
                    stages,
                    "decode",
                    format!("Failed to execute test: {}", e),
                    None,
                )
            }
        }

        if !no_cleanup && temp_dir.exists() {
            let _ = fs::remove_dir_all(&temp_dir);
        }
        let ok = stages.code_generation == "ok"
            && stages.compilation == "ok"
            && stages.decode == "ok"
            && stages.validation == "ok"
            && stages.reencode == "ok"
            && stages.binary_match;
        Ok(TestResult {
            test_name: test_name.to_string(),
            test_file: test_file.to_string(),
            status: if ok { "pass" } else { "fail" }.to_string(),
            duration_ms: start_time.elapsed().as_millis() as u64,
            stages: Some(stages),
            error: None,
        })
    }
}

/* ---------------------------------------------------------------------------
 * Runner generation
 *
 * The runner decodes the case with `Parse<T>`, checks `Validate<T>`, the
 * short-buffer report, `<T>ParamsFromBuffer` / `DynamicParams` / `Footprint<T>`
 * and the `Keys`/`Get`/`Set` round trip, then re-encodes twice through the
 * public API only:
 *   1. `Init<T>` from the params (into a 0xa5-filled buffer), then every field
 *      through the typed setters (enum payloads through the typed variant
 *      views);
 *   2. the generated builders (`Build`, `Finish`, `BuildInto`).
 * The copy/build helpers are generated per view, field by field, so a field
 * without an accessor fails to compile and a skipped one leaves zeros behind.
 * ------------------------------------------------------------------------- */

struct RunnerGen<'m, 'a> {
    g: &'m GoEmitter<'m, 'a>,
    done: BTreeSet<String>,
    fns: String,
}

impl<'m, 'a> RunnerGen<'m, 'a> {
    fn ensure(&mut self, vname: &str) -> Result<()> {
        if !self.done.insert(vname.to_string()) {
            return Ok(());
        }
        let v = self
            .g
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

    fn union_slot(&self, v: &VInfo<'a>) -> Result<Slot<'a>> {
        let size =
            const_size(v.ty).ok_or_else(|| anyhow::anyhow!("variable-size union {}", v.ty.name))?;
        let rank = |s: &Slot<'a>| match &s.shape {
            Shape::Prim(_) => 0,
            Shape::Array(_) => 1,
            _ => 2,
        };
        self.g
            .r
            .slots(v)
            .into_iter()
            .filter(|s| const_size(s.ty) == Some(size))
            .min_by_key(|s| rank(s))
            .ok_or_else(|| anyhow::anyhow!("union {} has no full-width variant", v.ty.name))
    }

    fn copy_fn(&mut self, v: &VInfo<'a>) -> Result<String> {
        let n = self.g.gn(v.ty);
        let names = self.g.names(v);
        let mut out = String::new();
        writeln!(out, "func copy_{n}(s, d P.{n}) {{")?;
        let slots = match &v.ty.kind {
            ResolvedTypeKind::Union { .. } => vec![self.union_slot(v)?],
            _ => self.g.r.slots(v),
        };
        for slot in &slots {
            let m = |k: &str| self.g.mname(&names, slot, k);
            if self.g.r.open_slot(v, slot) {
                /* `Init<T>` zero-fills a slot sized by a `<field>.payload_size`
                parameter; its typed sub-views would parse the zeros, so the
                encoded bytes go in at the same offset. */
                let src = match &slot.shape {
                    Shape::View(_) => format!("s.{}().Bytes()", m("get")),
                    Shape::Enum { .. } => format!("s.{}()", m("body")),
                    _ => format!("s.{}()", m("bytes")),
                };
                writeln!(out, "\trawCopy(s.Bytes(), d.Bytes(), {src})")?;
                continue;
            }
            match &slot.shape {
                Shape::Prim(_) => writeln!(out, "\tmust(d.{}(s.{}()))", m("set"), m("get"))?,
                Shape::Array(a) => match &a.elem {
                    Elem::Prim(p) => {
                        if prim_is_byte(p) && !slot.name.is_empty() {
                            writeln!(out, "\tmust(d.{}(s.{}()))", m("set_all"), m("get"))?;
                            writeln!(out, "\tfor i := uint64(0); i < s.{}(); i++ {{", m("len"))?;
                            writeln!(out, "\t\tx, ok := s.{}(i)", m("at"))?;
                            writeln!(
                                out,
                                "\t\tcheck(ok && x == s.{}()[i], \"byte array element\")",
                                m("get")
                            )?;
                            writeln!(out, "\t}}")?;
                        } else {
                            writeln!(out, "\tfor i := uint64(0); i < s.{}(); i++ {{", m("len"))?;
                            writeln!(out, "\t\tx, ok := s.{}(i)", m("at"))?;
                            writeln!(out, "\t\tcheck(ok, \"element in range\")")?;
                            writeln!(out, "\t\tmust(d.{}(i, x))", m("set_at"))?;
                            writeln!(out, "\t}}")?;
                        }
                    }
                    Elem::View(c) => {
                        self.child(&a.elem)?;
                        let cn = self.g.gn(c.ty);
                        writeln!(out, "\tfor i := uint64(0); i < s.{}(); i++ {{", m("len"))?;
                        writeln!(out, "\t\tx, ok := s.{}(i)", m("at"))?;
                        writeln!(out, "\t\ty, ok2 := d.{}(i)", m("at"))?;
                        writeln!(out, "\t\tcheck(ok && ok2, \"element in range\")")?;
                        writeln!(out, "\t\tcopy_{cn}(x, y)")?;
                        writeln!(out, "\t}}")?;
                    }
                    Elem::Opaque(_) => anyhow::bail!("opaque array elements in {}", slot.name),
                },
                Shape::View(c) => {
                    self.ensure(&c.vname)?;
                    let cn = self.g.gn(c.ty);
                    writeln!(out, "\tcopy_{cn}(s.{g}(), d.{g}())", g = m("get"))?;
                }
                Shape::Enum { variants, .. } | Shape::Sdu { variants } => {
                    let vc = self.g.variant_camels(variants);
                    let is_sdu = matches!(slot.shape, Shape::Sdu { .. });
                    writeln!(out, "\t{{")?;
                    writeln!(out, "\tr := s.{}()", m("get"))?;
                    writeln!(out, "\tdr := d.{}()", m("get"))?;
                    writeln!(
                        out,
                        "\tcheck(r.Known && dr.Known && r.Tag == dr.Tag, \"{} variant\")",
                        slot.name
                    )?;
                    writeln!(out, "\tswitch r.Tag {{")?;
                    let mut seen = BTreeSet::new();
                    for (vi, (var, c)) in variants.iter().zip(&vc).enumerate() {
                        let sel = if is_sdu { vi as u64 } else { var.tag };
                        if !seen.insert(sel) {
                            continue;
                        }
                        self.child(&var.elem)?;
                        writeln!(out, "\tcase {sel}:")?;
                        match &var.elem {
                            Elem::View(cv) => {
                                writeln!(out, "\t\tcopy_{}(r.{c}, dr.{c})", self.g.gn(cv.ty))?
                            }
                            Elem::Prim(_) => {
                                writeln!(out, "\t\tmust(d.{}(r.{c}))", m(&format!("setas{vi}")))?;
                                writeln!(out, "\t\tx, ok := s.{}()", m(&format!("as{vi}")))?;
                                writeln!(out, "\t\tcheck(ok && x == r.{c}, \"as variant\")")?;
                            }
                            Elem::Opaque(_) => writeln!(out, "\t\tcopy(dr.{c}, r.{c})")?,
                        }
                    }
                    writeln!(out, "\tdefault:")?;
                    writeln!(out, "\t\tpanic(\"unexpected variant in {}\")", slot.name)?;
                    writeln!(out, "\t}}")?;
                    writeln!(out, "\t}}")?;
                }
            }
        }
        writeln!(out, "}}\n")?;
        Ok(out)
    }

    fn build_fn(&mut self, v: &VInfo<'a>) -> Result<String> {
        let n = self.g.gn(v.ty);
        let names = self.g.names(v);
        let bn = self.g.builder_names(v);
        let mut out = String::new();
        writeln!(out, "func build_{n}(s P.{n}) []byte {{")?;
        writeln!(out, "\tb, err := builder_{n}(s).Build()")?;
        writeln!(out, "\tmust(err)")?;
        writeln!(out, "\treturn b")?;
        writeln!(out, "}}\n")?;
        let vn = self.g.vnames_of(&v.ty.name);
        writeln!(out, "func builder_{n}(s P.{n}) *P.{} {{", vn.builder)?;
        writeln!(out, "\tb := P.{}()", vn.new_builder)?;
        let bnm = |slot: &Slot<'a>, k: &str| bn.get(&format!("{}:{k}", slot.idx));
        match &v.ty.kind {
            ResolvedTypeKind::Struct { .. } => {
                for slot in self.g.r.slots(v) {
                    let m = |k: &str| self.g.mname(&names, &slot, k);
                    match &slot.shape {
                        Shape::Prim(_) => {
                            writeln!(out, "\tb.{}(s.{}())", bnm(&slot, "set"), m("get"))?
                        }
                        Shape::Array(a) => match &a.elem {
                            Elem::Prim(p) => {
                                writeln!(out, "\t{{")?;
                                writeln!(
                                    out,
                                    "\t\tvals := make([]{}, s.{}())",
                                    abi_gen::codegen::go_gen::names::go_prim(p),
                                    m("len")
                                )?;
                                writeln!(out, "\t\tfor i := range vals {{")?;
                                writeln!(out, "\t\t\tvals[i], _ = s.{}(uint64(i))", m("at"))?;
                                writeln!(out, "\t\t}}")?;
                                writeln!(out, "\t\tb.{}(vals)", bnm(&slot, "set"))?;
                                writeln!(out, "\t}}")?;
                            }
                            Elem::View(c) => {
                                self.child(&a.elem)?;
                                writeln!(
                                    out,
                                    "\tfor i := uint64(0); i < s.{}(); i++ {{",
                                    m("len")
                                )?;
                                writeln!(out, "\t\tx, _ := s.{}(i)", m("at"))?;
                                writeln!(
                                    out,
                                    "\t\tb.{}(build_{}(x))",
                                    bnm(&slot, "push"),
                                    self.g.gn(c.ty)
                                )?;
                                writeln!(out, "\t}}")?;
                            }
                            Elem::Opaque(_) => {
                                anyhow::bail!("opaque array elements in {}", slot.name)
                            }
                        },
                        Shape::View(c) => {
                            self.ensure(&c.vname)?;
                            writeln!(
                                out,
                                "\tb.{}(build_{}(s.{}()))",
                                bnm(&slot, "set"),
                                self.g.gn(c.ty),
                                m("get")
                            )?;
                        }
                        Shape::Enum { variants, .. } | Shape::Sdu { variants } => {
                            let vc = self.g.variant_camels(variants);
                            let is_sdu = matches!(slot.shape, Shape::Sdu { .. });
                            writeln!(out, "\tswitch r := s.{}(); r.Tag {{", m("get"))?;
                            let mut seen = BTreeSet::new();
                            for (vi, (var, c)) in variants.iter().zip(&vc).enumerate() {
                                let sel = if is_sdu { vi as u64 } else { var.tag };
                                if !seen.insert(sel) {
                                    continue;
                                }
                                self.child(&var.elem)?;
                                let payload = match &var.elem {
                                    Elem::View(cv) => format!("build_{}(r.{c})", self.g.gn(cv.ty)),
                                    Elem::Prim(p) => format!(
                                        "le({}, {})",
                                        go_to_raw(p, &format!("r.{c}")),
                                        prim_size(p)
                                    ),
                                    Elem::Opaque(_) => format!("r.{c}"),
                                };
                                writeln!(out, "\tcase {sel}:")?;
                                writeln!(
                                    out,
                                    "\t\tb.{}({payload})",
                                    bn.get(&format!("{}:var{vi}", slot.idx))
                                )?;
                            }
                            writeln!(out, "\tdefault:")?;
                            writeln!(out, "\t\tpanic(\"unexpected variant in {}\")", slot.name)?;
                            writeln!(out, "\t}}")?;
                        }
                    }
                }
            }
            ResolvedTypeKind::Union { .. } => {
                let slot = self.union_slot(v)?;
                let m = |k: &str| self.g.mname(&names, &slot, k);
                let set = bnm(&slot, "set");
                match &slot.shape {
                    Shape::Prim(_) => writeln!(out, "\tb.{set}(s.{}())", m("get"))?,
                    Shape::Array(a) => match &a.elem {
                        Elem::Prim(p) if prim_is_byte(p) => {
                            writeln!(out, "\tb.{set}(s.{}())", m("get"))?
                        }
                        _ => writeln!(out, "\tb.{}(s.Bytes())", bn.get("encoding"))?,
                    },
                    Shape::View(c) => {
                        self.ensure(&c.vname)?;
                        writeln!(
                            out,
                            "\tb.{set}(build_{}(s.{}()))",
                            self.g.gn(c.ty),
                            m("get")
                        )?;
                    }
                    _ => anyhow::bail!("unsupported union variant {}", slot.name),
                }
            }
            ResolvedTypeKind::Array { .. } => {
                let slot = &self.g.r.slots(v)[0];
                if let Shape::Array(a) = &slot.shape {
                    match &a.elem {
                        Elem::Prim(_) => {
                            writeln!(out, "\tfor i := uint64(0); i < s.Len(); i++ {{")?;
                            writeln!(out, "\t\tx, _ := s.At(i)")?;
                            writeln!(out, "\t\tb.{}(i, x)", bn.get("set_at"))?;
                            writeln!(out, "\t}}")?;
                        }
                        Elem::View(c) => {
                            self.child(&a.elem)?;
                            writeln!(out, "\tfor i := uint64(0); i < s.Len(); i++ {{")?;
                            writeln!(out, "\t\tx, _ := s.At(i)")?;
                            writeln!(
                                out,
                                "\t\tb.{}(i, build_{}(x))",
                                bn.get("set_at"),
                                self.g.gn(c.ty)
                            )?;
                            writeln!(out, "\t}}")?;
                        }
                        Elem::Opaque(_) => anyhow::bail!("opaque array elements in {}", v.ty.name),
                    }
                }
            }
            _ => anyhow::bail!("no builder for {}", v.ty.name),
        }
        writeln!(out, "\treturn b")?;
        writeln!(out, "}}\n")?;
        Ok(out)
    }
}

const PRELUDE: &str = r#"func must(err error) {
	if err != nil {
		panic(err)
	}
}

func check(ok bool, what string) {
	if !ok {
		panic("check failed: " + what)
	}
}

func le(v uint64, n int) []byte {
	b := make([]byte, n)
	for i := range b {
		b[i] = byte(v >> (8 * uint(i)))
	}
	return b
}

/* Copy src (a sub-slice of sBase) to the same offset in dBase. */
func rawCopy(sBase, dBase, src []byte) {
	if len(src) == 0 {
		return
	}
	off := uintptr(unsafe.Pointer(unsafe.SliceData(src))) - uintptr(unsafe.Pointer(unsafe.SliceData(sBase)))
	copy(dBase[off:off+uintptr(len(src))], src)
}

"#;

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
    let g = GoEmitter::new(&model, &package, HashMap::new());
    let ty = resolver
        .get_type_info(type_name)
        .ok_or_else(|| anyhow::anyhow!("Type '{}' not found", type_name))?;
    model.collect_named(&ty.name);
    let vname = ty.name.clone();
    let root = g
        .info(&vname)
        .ok_or_else(|| anyhow::anyhow!("no view generated for {}", type_name))?;
    let mut rg = RunnerGen {
        g: &g,
        done: BTreeSet::new(),
        fns: String::new(),
    };
    rg.ensure(&vname)?;
    let is_root_struct = root.is_root_struct();
    let t = g.gn(root.ty);
    let vn = g.vnames_of(&root.ty.name);
    let (parse, validate, init, footprint) = (&vn.parse, &vn.validate, &vn.init, &vn.footprint_fn);
    let (params_ty, params_from_buffer) = (&vn.params, &vn.params_from_buffer);

    let mut c = String::new();
    writeln!(c, "package main\n")?;
    writeln!(c, "import (")?;
    writeln!(c, "\t\"bytes\"")?;
    writeln!(c, "\t\"fmt\"")?;
    writeln!(c, "\t\"unsafe\"\n")?;
    writeln!(
        c,
        "\tP \"{}/{}\"",
        abi_gen::codegen::go::DEFAULT_MODULE,
        abi_gen::codegen::go::package_dir(&package)
    )?;
    writeln!(c, "\t\"{}/tnabi\"", abi_gen::codegen::go::DEFAULT_MODULE)?;
    writeln!(c, ")\n")?;
    writeln!(
        c,
        "var _ = tnabi.MaxU64 // package {}\n",
        package_name(&package)
    )?;
    c.push_str(PRELUDE);
    c.push_str(&rg.fns);
    let bytes: Vec<String> = data.iter().map(|b| b.to_string()).collect();
    writeln!(c, "func main() {{")?;
    writeln!(c, "\tdata := []byte{{{}}}", bytes.join(", "))?;
    writeln!(c, "\tn := uint64(len(data))")?;
    writeln!(c, "\torig, err := P.{parse}(data)")?;
    writeln!(c, "\tmust(err)")?;
    writeln!(c, "\tfmt.Println(\"DECODE:ok\")")?;
    writeln!(c, "\tsz, err := P.{validate}(data)")?;
    writeln!(c, "\tmust(err)")?;
    writeln!(c, "\tcheck(uint64(sz) == n, \"validate consumed size\")")?;
    writeln!(c, "\tcheck(uint64(orig.Size()) == n, \"view size\")")?;
    writeln!(c, "\tsz, err = orig.Check()")?;
    writeln!(c, "\tcheck(err == nil && uint64(sz) == n, \"check\")")?;
    writeln!(c, "\tif n > 0 {{")?;
    writeln!(c, "\t\tsz, err := P.{validate}(data[:n-1])")?;
    writeln!(c, "\t\tif err == nil {{")?;
    writeln!(
        c,
        "\t\t\tcheck(uint64(sz) != n, \"truncated buffer validated\")"
    )?;
    writeln!(
        c,
        "\t\t}} else if need, ok := tnabi.RequiredSize(err); ok {{"
    )?;
    writeln!(
        c,
        "\t\t\t/* A short buffer reports a required size within the real one. */"
    )?;
    writeln!(c, "\t\t\tcheck(need > n-1 && need <= n, fmt.Sprintf(\"required size %d for %d bytes\", need, n))")?;
    writeln!(c, "\t\t}}")?;
    writeln!(c, "\t}}")?;
    if is_root_struct {
        writeln!(c, "\tparams, err := P.{params_from_buffer}(data)")?;
        writeln!(c, "\tmust(err)")?;
        writeln!(c, "\tdp, err := orig.DynamicParams()")?;
        writeln!(c, "\tcheck(err == nil && dp == params, \"dynamic params\")")?;
        writeln!(c, "\tfp, err := P.{footprint}(&params)")?;
        writeln!(c, "\tmust(err)")?;
        writeln!(c, "\tfp2, err := params.Footprint()")?;
        writeln!(c, "\tcheck(err == nil && fp2 == fp, \"params footprint\")")?;
        writeln!(c, "\tvar generic P.{params_ty}")?;
        writeln!(c, "\tfor _, k := range params.Keys() {{")?;
        writeln!(c, "\t\tval, ok := params.Get(k.Field)")?;
        writeln!(c, "\t\tcheck(ok, \"key\")")?;
        writeln!(c, "\t\tcheck(generic.Set(k.Path, val), \"set by path\")")?;
        writeln!(c, "\t}}")?;
        writeln!(
            c,
            "\tcheck(generic == params, \"params rebuilt from keys\")"
        )?;
        writeln!(
            c,
            "\tcheck(fp == n, fmt.Sprintf(\"footprint %d != %d\", fp, n))"
        )?;
    }
    writeln!(c, "\tfmt.Println(\"VALIDATION:ok\")")?;
    if is_root_struct {
        writeln!(c, "\tbuf := bytes.Repeat([]byte{{0xa5}}, len(data))")?;
        writeln!(c, "\tsz, err = P.{init}(buf, &params)")?;
        writeln!(
            c,
            "\tcheck(err == nil && uint64(sz) == n, \"init from params\")"
        )?;
    } else {
        writeln!(c, "\tbuf := make([]byte, len(data))")?;
    }
    writeln!(c, "\tm, err := P.{parse}(buf)")?;
    writeln!(c, "\tmust(err)")?;
    writeln!(c, "\tcopy_{t}(orig, m)")?;
    writeln!(
        c,
        "\tcheck(bytes.Equal(buf, data), \"init + setters re-encode\")"
    )?;
    writeln!(c, "\tbuilt := build_{t}(orig)")?;
    if is_root_struct {
        writeln!(c, "\tbp, err := builder_{t}(orig).DynamicParams()")?;
        writeln!(
            c,
            "\tcheck(err == nil && bp == params, \"builder dynamic params\")"
        )?;
        let names = g.names(&root);
        let bn = g.builder_names(&root);
        for slot in g.r.slots(&root) {
            if !matches!(slot.shape, Shape::Enum { .. } | Shape::Sdu { .. }) {
                continue;
            }
            let sn = g.variant_names(&root, &slot);
            let (by_tag, table) = (&sn.by_tag, &sn.variants);
            writeln!(c, "\t{{")?;
            writeln!(
                c,
                "\t\tinfo, ok := P.{by_tag}(uint64(orig.{}()))",
                g.mname(&names, &slot, "tag")
            )?;
            writeln!(c, "\t\tcheck(ok, \"variant info\")")?;
            writeln!(c, "\t\tfound := false")?;
            writeln!(c, "\t\tfor _, x := range P.{table} {{")?;
            writeln!(c, "\t\t\tfound = found || x == info")?;
            writeln!(c, "\t\t}}")?;
            writeln!(c, "\t\tcheck(found, \"variant table\")")?;
            writeln!(
                c,
                "\t\tby, err := builder_{t}(orig).{}(info.Name, orig.{}()).Build()",
                bn.get(&format!("{}:by_name", slot.idx)),
                g.mname(&names, &slot, "body")
            )?;
            writeln!(
                c,
                "\t\tcheck(err == nil && bytes.Equal(by, data), \"variant re-selected by name\")"
            )?;
            writeln!(c, "\t}}")?;
        }
    }
    writeln!(
        c,
        "\tcheck(bytes.Equal(built, data), \"builder re-encode\")"
    )?;
    writeln!(c, "\tfin, err := builder_{t}(orig).Finish()")?;
    writeln!(c, "\tcheck(err == nil && bytes.Equal(fin.Bytes(), data) && uint64(fin.Size()) == n, \"finish\")")?;
    writeln!(c, "\ttarget := bytes.Repeat([]byte{{0xa5}}, len(data)+4)")?;
    writeln!(c, "\twritten, err := builder_{t}(orig).BuildInto(target)")?;
    writeln!(c, "\tmust(err)")?;
    writeln!(
        c,
        "\tcheck(bytes.Equal(target[:written], data), \"build into bytes\")"
    )?;
    writeln!(c, "\tcheck(bytes.Equal(target[written:], []byte{{0xa5, 0xa5, 0xa5, 0xa5}}), \"build into wrote past the value\")")?;
    writeln!(c, "\tfmt.Println(\"REENCODE:ok\")")?;
    writeln!(c, "\tfmt.Println(\"BINARY_MATCH:true\")")?;
    writeln!(c, "}}")?;
    Ok(c)
}
