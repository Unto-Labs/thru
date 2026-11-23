use abi_gen::abi::file::ImportResolver;
use abi_gen::abi::resolved::{ResolvedTypeKind, Size};
use abi_gen::cmds::codegen::{self, Language};
use abi_gen::cmds::common::{analyze_and_resolve_types, normalize_type_refs};
use abi_gen::codegen::c_gen::{
    collect_and_emit_nested_footprints, emit_footprint_fn, emit_ir_footprint_fn,
};
use abi_gen::codegen::shared::builder::IrBuilder;
use abi_gen::codegen::shared::ir::IrNode;
use abi_loader::AbiFile;
use anyhow::{Context, anyhow};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

#[test]
fn consensus_certificate_layout() -> anyhow::Result<()> {
    let type_library = Path::new(env!("CARGO_MANIFEST_DIR")).join("../type-library");
    let resolver = resolve_abi(
        &type_library.join("tn_consensus_validator_program.abi.yaml"),
        &type_library,
    )?;

    /* Match tn_certificate.h and the packed post-certificate argument body. */
    for (name, size, offsets) in [
        (
            "CertificatePayload",
            61,
            vec![
                ("round", 0),
                ("vote", 4),
                ("generation", 5),
                ("slot", 45),
                ("block_hash", 13),
                ("bet_time", 53),
            ],
        ),
        (
            "Certificate",
            361,
            vec![
                ("payload", 0),
                ("weight_slot", 61),
                ("aggregate_signature", 69),
                ("aggregate_pubkey", 261),
                ("count", 357),
            ],
        ),
        ("PostCertificateArgs", 531, vec![("certificate", 170)]),
    ] {
        let resolved = resolver.get_type_info(name).unwrap();
        assert_eq!(resolved.size, Size::Const(size), "{name} size");
        let ResolvedTypeKind::Struct { fields, .. } = &resolved.kind else {
            panic!("{name} must be a struct");
        };
        for (field, offset) in offsets {
            assert_eq!(
                fields.iter().find(|f| f.name == field).unwrap().offset,
                Some(offset),
                "{name}.{field} offset"
            );
        }
    }
    Ok(())
}

#[test]
fn type_library_abis_resolve_roots_and_codegen() -> anyhow::Result<()> {
    let abi_root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or_else(|| anyhow!("missing rpc/abi parent directory"))?
        .to_path_buf();
    let type_library = abi_root.join("type-library");
    let abi_files = type_library_abi_files(&type_library)?;
    let output_root = std::env::temp_dir().join(format!(
        "thru-abi-type-library-codegen-gate-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&output_root);
    fs::create_dir_all(&output_root)
        .with_context(|| format!("creating {}", output_root.display()))?;

    let mut failures = Vec::new();

    for abi_path in abi_files {
        let rel_path = rel_abi_path(&abi_root, &abi_path);

        match declared_roots(&abi_path) {
            Ok(roots) => {
                for root in roots {
                    if let Err(err) = verify_root_footprint(&abi_path, &type_library, &root) {
                        failures.push(format!(
                            "{} root {} footprint failed: {:#}",
                            rel_path, root, err
                        ));
                    }
                }
            }
            Err(err) => failures.push(format!("{} root parse failed: {:#}", rel_path, err)),
        }

        for (language, language_name) in [
            (Language::C, "c"),
            (Language::Rust, "rust"),
            (Language::TypeScript, "typescript"),
        ] {
            let output_dir = output_root
                .join(sanitize_path_component(&rel_path))
                .join(language_name);
            if let Err(err) = codegen::run(
                vec![abi_path.clone()],
                vec![type_library.clone()],
                language,
                output_dir,
                false,
            ) {
                failures.push(format!(
                    "{} language {} codegen failed: {:#}",
                    rel_path, language_name, err
                ));
            }
        }
    }

    let _ = fs::remove_dir_all(&output_root);

    if !failures.is_empty() {
        for failure in &failures {
            eprintln!(
                "::error title=ABI type-library codegen gate failed::{}",
                github_action_escape(failure)
            );
        }
        panic!(
            "ABI type-library codegen gate failed:\n{}",
            failures.join("\n")
        );
    }

    Ok(())
}

fn type_library_abi_files(type_library: &Path) -> anyhow::Result<Vec<PathBuf>> {
    let mut abi_files = Vec::new();
    collect_type_library_abi_files(type_library, &mut abi_files)?;
    abi_files.sort();

    if abi_files.is_empty() {
        anyhow::bail!("no ABI YAML files found in {}", type_library.display());
    }

    Ok(abi_files)
}

fn collect_type_library_abi_files(
    directory: &Path,
    abi_files: &mut Vec<PathBuf>,
) -> anyhow::Result<()> {
    for entry in
        fs::read_dir(directory).with_context(|| format!("reading {}", directory.display()))?
    {
        let entry = entry?;
        let path = entry.path();
        let file_type = entry
            .file_type()
            .with_context(|| format!("reading file type for {}", path.display()))?;

        if file_type.is_dir() {
            collect_type_library_abi_files(&path, abi_files)?;
        } else if path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.ends_with(".abi.yaml"))
        {
            abi_files.push(path);
        }
    }
    Ok(())
}

fn declared_roots(abi_path: &Path) -> anyhow::Result<Vec<String>> {
    let contents =
        fs::read_to_string(abi_path).with_context(|| format!("reading {}", abi_path.display()))?;
    let abi_file: AbiFile = serde_yml::from_str(&contents)
        .with_context(|| format!("parsing {}", abi_path.display()))?;
    let root_types = abi_file.root_types();

    let mut roots = Vec::new();
    if let Some(root) = root_types.instruction_root.as_deref() {
        roots.push(root.to_string());
    }
    if let Some(root) = root_types.account_root.as_deref() {
        roots.push(root.to_string());
    }
    roots.sort();
    roots.dedup();

    Ok(roots)
}

fn verify_root_footprint(abi_path: &Path, type_library: &Path, root: &str) -> anyhow::Result<()> {
    let type_resolver = resolve_abi(abi_path, type_library)?;
    let resolved = type_resolver
        .get_type_info(root)
        .ok_or_else(|| anyhow!("root type '{}' was not resolved", root))?;
    let ir_builder = IrBuilder::new(&type_resolver);
    let type_ir = ir_builder
        .build_type(resolved)
        .with_context(|| format!("building layout IR for root '{}'", root))?;

    let mut legacy_output = String::new();
    collect_and_emit_nested_footprints(resolved, None, &mut legacy_output);
    legacy_output.push_str(&emit_footprint_fn(resolved, Some(&type_ir)));
    anyhow::ensure!(
        !legacy_output.trim().is_empty(),
        "legacy footprint helpers for root '{}' were empty",
        root
    );
    if !contains_sum_over_array(&type_ir.root) {
        emit_ir_footprint_fn(&type_ir)
            .with_context(|| format!("emitting IR footprint for root '{}'", root))?;
    }

    Ok(())
}

fn contains_sum_over_array(node: &IrNode) -> bool {
    match node {
        IrNode::ZeroSize { .. } | IrNode::Const(_) | IrNode::FieldRef(_) => false,
        IrNode::AlignUp(node) => contains_sum_over_array(&node.node),
        IrNode::AddChecked(node)
        | IrNode::SubChecked(node)
        | IrNode::MulChecked(node)
        | IrNode::DivChecked(node)
        | IrNode::ModChecked(node)
        | IrNode::BitAnd(node)
        | IrNode::BitOr(node)
        | IrNode::BitXor(node)
        | IrNode::LeftShift(node)
        | IrNode::RightShift(node) => {
            contains_sum_over_array(&node.left) || contains_sum_over_array(&node.right)
        }
        IrNode::Switch(node) => {
            node.cases
                .iter()
                .any(|case| contains_sum_over_array(&case.node))
                || node
                    .default
                    .as_ref()
                    .map(|default| contains_sum_over_array(default))
                    .unwrap_or(false)
        }
        IrNode::CallNested(_) => false,
        IrNode::SumOverArray(_) => true,
    }
}

fn resolve_abi(
    abi_path: &Path,
    type_library: &Path,
) -> anyhow::Result<abi_gen::abi::resolved::TypeResolver> {
    let mut import_resolver = ImportResolver::new(vec![type_library.to_path_buf()]);
    import_resolver
        .load_file_with_imports(abi_path, false)
        .with_context(|| format!("loading {}", abi_path.display()))?;

    let mut typedefs = import_resolver.get_all_types().to_vec();
    normalize_type_refs(&mut typedefs, &import_resolver)?;
    analyze_and_resolve_types(&typedefs, false)
}

fn rel_abi_path(abi_root: &Path, abi_path: &Path) -> String {
    abi_path
        .strip_prefix(abi_root)
        .map(|path| format!("rpc/abi/{}", path.display()))
        .unwrap_or_else(|_| abi_path.display().to_string())
}

fn sanitize_path_component(path: &str) -> String {
    path.chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .collect()
}

fn github_action_escape(message: &str) -> String {
    message
        .replace('%', "%25")
        .replace('\r', "%0D")
        .replace('\n', "%0A")
}

/* ---- Compile gates: generated code for every type-library ABI must build ---- */

fn abi_root() -> anyhow::Result<PathBuf> {
    Ok(Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or_else(|| anyhow!("missing rpc/abi parent directory"))?
        .to_path_buf())
}

/* Generate `language` for every type-library ABI into `<out>/<abi stem>`. */
fn generate_type_library(language: Language, out: &Path) -> anyhow::Result<Vec<(String, PathBuf)>> {
    let type_library = abi_root()?.join("type-library");
    let _ = fs::remove_dir_all(out);
    fs::create_dir_all(out)?;
    let mut generated = Vec::new();
    for abi_path in type_library_abi_files(&type_library)? {
        let stem = abi_path
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.trim_end_matches(".abi.yaml").to_string())
            .ok_or_else(|| anyhow!("bad ABI file name {}", abi_path.display()))?;
        let dir = out.join(&stem);
        codegen::run(
            vec![abi_path.clone()],
            vec![type_library.clone()],
            language.clone(),
            dir.clone(),
            false,
        )
        .with_context(|| format!("codegen for {}", abi_path.display()))?;
        generated.push((stem, dir));
    }
    Ok(generated)
}

fn files_named(dir: &Path, name: &str, out: &mut Vec<PathBuf>) -> anyhow::Result<()> {
    for entry in fs::read_dir(dir)? {
        let path = entry?.path();
        if path.is_dir() {
            files_named(&path, name, out)?;
        } else if path.file_name().and_then(|n| n.to_str()) == Some(name) {
            out.push(path);
        }
    }
    out.sort();
    Ok(())
}

/* Names of the functions a generated C header declares (top-level prototypes). */
fn declared_c_functions(header: &str) -> Vec<String> {
    let mut names = Vec::new();
    for line in header.lines() {
        let line = line.trim_end();
        if line.starts_with(' ')
            || line.starts_with('\t')
            || line.starts_with('#')
            || line.starts_with("typedef")
            || line.starts_with("static")
            || line.starts_with("struct")
            || line.starts_with("union")
            || line.starts_with("/*")
            || !line.ends_with(");")
        {
            continue;
        }
        let Some(paren) = line.find('(') else {
            continue;
        };
        let head = line[..paren].trim_end();
        let name: String = head
            .chars()
            .rev()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        if !name.is_empty() {
            names.push(name);
        }
    }
    names.sort();
    names.dedup();
    names
}

/* Every type-library ABI's generated C compiles warning-clean for the error
classes that hide real bugs, and every declared function links. */
#[test]
fn type_library_c_codegen_compiles_and_links() -> anyhow::Result<()> {
    let out = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("type-library-c");
    let cc = std::env::var("CC").unwrap_or_else(|_| "cc".to_string());
    let mut failures = Vec::new();
    for (stem, dir) in generate_type_library(Language::C, &out)? {
        let mut sources = Vec::new();
        files_named(&dir, "functions.c", &mut sources)?;
        let mut objects = Vec::new();
        let mut referenced = Vec::new();
        let mut compiled = true;
        for (idx, source) in sources.iter().enumerate() {
            let object = dir.join(format!("obj{idx}.o"));
            let output = Command::new(&cc)
                .args([
                    "-std=gnu17",
                    "-c",
                    "-Wall",
                    "-Werror=implicit-function-declaration",
                    "-Werror=int-conversion",
                    "-Werror=incompatible-pointer-types",
                    "-Werror=return-type",
                ])
                .arg(source)
                .arg("-o")
                .arg(&object)
                .output()?;
            if !output.status.success() {
                compiled = false;
                failures.push(format!(
                    "{stem}: {} failed to compile:\n{}",
                    source.strip_prefix(&dir).unwrap_or(source).display(),
                    String::from_utf8_lossy(&output.stderr)
                ));
            }
            objects.push(object);
            let header = source.with_file_name("types.h");
            if let Ok(text) = fs::read_to_string(&header) {
                referenced.extend(declared_c_functions(&text));
            }
        }
        if !compiled {
            continue;
        }
        referenced.sort();
        referenced.dedup();
        /* Reference every declared function so the link fails on any declaration
        without a definition. */
        let mut main = String::new();
        for name in &referenced {
            main.push_str(&format!("extern void {name}( void );\n"));
        }
        main.push_str("void ( * volatile tn_gate_refs[] )( void ) = {\n");
        for name in &referenced {
            main.push_str(&format!("  {name},\n"));
        }
        main.push_str("  0\n};\nint main( void ) { return tn_gate_refs[0] == 0; }\n");
        let main_path = dir.join("gate_main.c");
        fs::write(&main_path, main)?;
        let output = Command::new(&cc)
            .arg("-std=gnu17")
            .arg("-w")
            .arg(&main_path)
            .args(&objects)
            .arg("-o")
            .arg(dir.join("gate_main"))
            .output()?;
        if !output.status.success() {
            failures.push(format!(
                "{stem}: generated C does not link:\n{}",
                String::from_utf8_lossy(&output.stderr)
            ));
        }
    }
    if !failures.is_empty() {
        panic!(
            "{} type-library C failures:\n{}",
            failures.len(),
            failures.join("\n")
        );
    }
    Ok(())
}

/* Every type-library ABI's generated Rust type-checks. */
#[test]
fn type_library_rust_codegen_compiles() -> anyhow::Result<()> {
    let project = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("type-library-rust");
    let generated = generate_type_library(Language::Rust, &project.join("abis"))?;
    let mut lib = String::from("#![allow(warnings)]\n");
    for (stem, dir) in &generated {
        lib.push_str(&format!(
            "#[path = \"{}\"]\npub mod abi_{};\n",
            dir.join("mod.rs").display(),
            sanitize_path_component(stem)
        ));
    }
    fs::write(project.join("lib.rs"), lib)?;
    fs::write(
        project.join("Cargo.toml"),
        "[package]\nname = \"type-library-rust-codegen\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[lib]\npath = \"lib.rs\"\n\n[workspace]\n",
    )?;
    let output = Command::new("cargo")
        .arg("check")
        .arg("--quiet")
        .arg("--manifest-path")
        .arg(project.join("Cargo.toml"))
        .env_remove("RUSTFLAGS")
        .output()?;
    if !output.status.success() {
        panic!(
            "generated type-library Rust does not compile:\n{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    Ok(())
}

/* Every type-library ABI's generated TypeScript type-checks. Needs the vendored
toolchain (`npm install` in tests/ts_toolchain); CI's compliance job has it. */
#[test]
fn type_library_typescript_codegen_compiles() -> anyhow::Result<()> {
    let tsc =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/ts_toolchain/node_modules/.bin/tsc");
    if !tsc.exists() {
        if std::env::var_os("ABI_REQUIRE_TSC").is_some() {
            panic!("ABI_REQUIRE_TSC is set but {} is missing", tsc.display());
        }
        eprintln!("skipping: {} not installed", tsc.display());
        return Ok(());
    }
    let out = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("type-library-ts");
    let mut failures = Vec::new();
    for (stem, dir) in generate_type_library(Language::TypeScript, &out)? {
        let mut sources = Vec::new();
        files_named(&dir, "types.ts", &mut sources)?;
        let output = Command::new(&tsc)
            .args([
                "--noEmit",
                "--strict",
                "--skipLibCheck",
                "--target",
                "es2020",
                "--module",
                "es2020",
                "--moduleResolution",
                "node",
            ])
            .args(&sources)
            .output()?;
        if !output.status.success() {
            failures.push(format!(
                "{stem}:\n{}",
                String::from_utf8_lossy(&output.stdout)
            ));
        }
    }
    if !failures.is_empty() {
        panic!(
            "{} type-library TypeScript failures:\n{}",
            failures.len(),
            failures.join("\n")
        );
    }
    Ok(())
}

/* Every type-library ABI's generated Go module (and every
`tests/go_fixtures` ABI's) passes `go vet` and `go build` (no cgo) and is
gofmt-clean. Skipped when `go` is missing unless
`ABI_REQUIRE_GO` is set. */
#[test]
fn type_library_go_codegen_compiles() -> anyhow::Result<()> {
    let go = std::env::var("GO").unwrap_or_else(|_| "go".to_string());
    let have_go = Command::new(&go)
        .arg("version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false);
    if !have_go {
        if std::env::var_os("ABI_REQUIRE_GO").is_some() {
            panic!("ABI_REQUIRE_GO is set but `{go}` is not available");
        }
        eprintln!("skipping: `{go}` not installed (set ABI_REQUIRE_GO to require it)");
        return Ok(());
    }
    let out = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join("type-library-go");
    let mut failures = Vec::new();
    let mut generated = generate_type_library(Language::Go, &out)?;
    /* Go-specific fixtures (name clashes, a holder of a buffer-sized type). */
    let fixtures = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/go_fixtures");
    let mut fixture_files: Vec<PathBuf> = fs::read_dir(&fixtures)?
        .map(|e| e.map(|e| e.path()))
        .collect::<Result<_, _>>()?;
    fixture_files.retain(|p| p.to_string_lossy().ends_with(".abi.yaml"));
    fixture_files.sort();
    for f in fixture_files {
        let stem = format!(
            "go_fixtures/{}",
            f.file_name()
                .unwrap()
                .to_string_lossy()
                .trim_end_matches(".abi.yaml")
        );
        let dir = out.join(stem.replace('/', "_"));
        codegen::run(
            vec![f.clone()],
            Vec::new(),
            Language::Go,
            dir.clone(),
            false,
        )
        .with_context(|| format!("codegen for {}", f.display()))?;
        generated.push((stem, dir));
    }
    for (stem, dir) in &generated {
        for args in [&["vet", "./..."][..], &["build", "./..."][..]] {
            let output = Command::new(&go)
                .args(args)
                .current_dir(dir)
                .env("CGO_ENABLED", "0")
                .output()?;
            if !output.status.success() {
                failures.push(format!(
                    "{stem}: go {}:\n{}{}",
                    args[0],
                    String::from_utf8_lossy(&output.stdout),
                    String::from_utf8_lossy(&output.stderr)
                ));
            }
        }
        let gofmt = Path::new(&go).with_file_name("gofmt");
        let gofmt = if gofmt.exists() {
            gofmt
        } else {
            PathBuf::from("gofmt")
        };
        if let Ok(output) = Command::new(&gofmt)
            .arg("-l")
            .arg(".")
            .current_dir(dir)
            .output()
        {
            let listed = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if output.status.success() && !listed.is_empty() {
                failures.push(format!("{stem}: not gofmt-clean:\n{listed}"));
            }
        }
    }
    if !failures.is_empty() {
        panic!(
            "{} type-library Go failures:\n{}",
            failures.len(),
            failures.join("\n")
        );
    }
    eprintln!(
        "Go: {} type-library and fixture ABIs vet, build and gofmt clean",
        generated.len()
    );
    Ok(())
}
