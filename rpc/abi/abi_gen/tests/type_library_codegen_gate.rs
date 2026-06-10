use abi_gen::abi::file::ImportResolver;
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
        IrNode::AddChecked(node) | IrNode::MulChecked(node) => {
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
    normalize_type_refs(&mut typedefs, &import_resolver);
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
