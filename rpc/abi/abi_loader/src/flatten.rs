use crate::file::{AbiFile, ImportSource};
use crate::resolver::ImportResolver;
use abi_types::{TypeDef, TypeKind};
use std::path::{Path, PathBuf};

/// Resolve and inline all imports, rejecting ambiguous or unresolved declarations.
pub fn flatten(file_path: &Path, include_dirs: &[PathBuf]) -> anyhow::Result<AbiFile> {
    flatten_with_options(file_path, include_dirs, false)
}

pub fn flatten_with_options(
    file_path: &Path,
    include_dirs: &[PathBuf],
    verbose: bool,
) -> anyhow::Result<AbiFile> {
    let mut resolver = ImportResolver::new(include_dirs.to_vec());
    resolver.load_file_with_imports(file_path, verbose)?;
    inline(&resolver, None)
}

pub fn flatten_to_yaml(file_path: &Path, include_dirs: &[PathBuf]) -> anyhow::Result<String> {
    Ok(serde_yml::to_string(&flatten(file_path, include_dirs)?)?)
}

/// Prepare publication bytes without fetching remote dependencies. Only root
/// same-network on-chain imports survive; local dependencies must be closed.
/// Both command-line entrypoints use this serialization boundary.
pub fn prepare_for_publish(
    file_path: &Path,
    include_dirs: &[PathBuf],
    target_network: &str,
    verbose: bool,
) -> anyhow::Result<String> {
    let mut resolver = ImportResolver::new(include_dirs.to_vec());
    resolver.load_file_with_imports_skip_remote(file_path, verbose)?;
    let files = resolver.get_all_files();
    let root = files
        .last()
        .ok_or_else(|| anyhow::anyhow!("No ABI files loaded"))?;
    for dependency in &files[..files.len() - 1] {
        for import in dependency.imports() {
            if import.is_remote() {
                anyhow::bail!(
                    "Remote import found in local dependency '{}': {:?}",
                    dependency.package(),
                    import
                );
            }
        }
    }
    let mut retained = Vec::new();
    for import in root.imports() {
        match import {
            ImportSource::Path { .. } => {}
            ImportSource::Onchain {
                address, network, ..
            } => {
                if network != target_network {
                    anyhow::bail!("On-chain import '{}' uses network '{}' but prep-for-publish target is '{}'", address, network, target_network);
                }
                retained.push(import.clone());
            }
            ImportSource::Git { url, .. } => {
                anyhow::bail!("Git imports not allowed for publishing: {}", url)
            }
            ImportSource::Http { url } => {
                anyhow::bail!("HTTP imports not allowed for publishing: {}", url)
            }
        }
    }
    let external_root = if retained.is_empty() {
        None
    } else {
        Some(file_path.canonicalize()?)
    };
    let mut output = inline(&resolver, external_root.as_deref())?;
    output.abi.imports = retained;
    Ok(serde_yml::to_string(&output)?)
}

fn inline(resolver: &ImportResolver, external_root: Option<&Path>) -> anyhow::Result<AbiFile> {
    resolver.validate_flattened_names()?;
    let root = resolver
        .get_all_files()
        .last()
        .ok_or_else(|| anyhow::anyhow!("No ABI files loaded"))?;
    let mut declarations: Vec<_> = resolver
        .declarations()
        .iter()
        .zip(resolver.get_all_types())
        .collect();
    // Qualified identity is independent of DFS order and checkout location.
    // Only declarations move: fields and variants retain their authored order.
    declarations.sort_by(|(a, _), (b, _)| (&a.package, &a.name).cmp(&(&b.package, &b.name)));
    let types = declarations
        .into_iter()
        .map(|(declaration, ty)| {
            let mut ty = ty.clone();
            normalize_type_kind(
                &mut ty.kind,
                resolver,
                external_root == Some(declaration.source.as_path()),
            )?;
            Ok(ty)
        })
        .collect::<anyhow::Result<Vec<_>>>()?;
    let mut abi = root.abi.clone();
    let roots = &mut abi.options.program_metadata.root_types;
    for (role, name) in [
        ("instruction-root", &mut roots.instruction_root),
        ("account-root", &mut roots.account_root),
        ("errors", &mut roots.errors),
        ("events", &mut roots.events),
    ] {
        if let Some(name) = name {
            if let Some(local) = resolver.resolve_type_name(name)? {
                *name = local;
            } else {
                let external = name.rsplit_once('.').is_some_and(|(package, _)| {
                    external_root.is_some() && !resolver.has_local_qualifier(package)
                });
                if !external {
                    anyhow::bail!("Unresolved declared {} root '{}'", role, name);
                }
            }
        }
    }
    abi.imports.clear();
    Ok(AbiFile { abi, types })
}

/// Check the declared program roots in an already prepared, closed ABI.
/// Root names may be simple or qualified by this ABI's exact package.
pub fn validate_root_types(abi: &AbiFile) -> anyhow::Result<()> {
    let roots = &abi.abi.options.program_metadata.root_types;
    for (role, root) in [
        ("instruction-root", &roots.instruction_root),
        ("account-root", &roots.account_root),
        ("errors", &roots.errors),
        ("events", &roots.events),
    ] {
        if let Some(root) = root {
            let name = match root.rsplit_once('.') {
                Some((package, name)) if package == abi.package() => name,
                Some(_) => anyhow::bail!("Unresolved declared {} root '{}'", role, root),
                None => root.as_str(),
            };
            if !abi.types.iter().any(|ty| ty.name == name) {
                anyhow::bail!("Unresolved declared {} root '{}'", role, root);
            }
        }
    }
    Ok(())
}

/// Erase only qualifiers proven to identify a unique inlined declaration.
/// This operation is closed: unknown references are always errors.
pub fn normalize_type_refs(
    typedefs: &mut [TypeDef],
    resolver: &ImportResolver,
) -> anyhow::Result<()> {
    resolver.validate_flattened_names()?;
    for typedef in typedefs {
        normalize_type_kind(&mut typedef.kind, resolver, false)?;
    }
    Ok(())
}

fn normalize_type_kind(
    kind: &mut TypeKind,
    resolver: &ImportResolver,
    allow_external: bool,
) -> anyhow::Result<()> {
    match kind {
        TypeKind::TypeRef(reference) => {
            if let Some(simple_name) =
                resolver.resolve_type_reference(&reference.name, reference.package.as_deref())?
            {
                reference.name = simple_name;
                reference.package = None;
            } else {
                let qualifier = reference
                    .package
                    .as_deref()
                    .or_else(|| reference.name.rsplit_once('.').map(|(package, _)| package));
                if !allow_external
                    || qualifier.map_or(true, |package| resolver.has_local_qualifier(package))
                {
                    anyhow::bail!(
                        "Unresolved type reference '{}' (package {:?})",
                        reference.name,
                        reference.package
                    );
                }
                // External qualified references remain verbatim for later semantic resolution.
            }
        }
        TypeKind::Struct(value) => {
            for field in &mut value.fields {
                normalize_type_kind(&mut field.field_type, resolver, allow_external)?;
            }
        }
        TypeKind::Union(value) => {
            for variant in &mut value.variants {
                normalize_type_kind(&mut variant.variant_type, resolver, allow_external)?;
            }
        }
        TypeKind::Enum(value) => {
            for variant in &mut value.variants {
                normalize_type_kind(&mut variant.variant_type, resolver, allow_external)?;
            }
        }
        TypeKind::Array(value) => {
            normalize_type_kind(&mut value.element_type, resolver, allow_external)?
        }
        TypeKind::SizeDiscriminatedUnion(value) => {
            for variant in &mut value.variants {
                normalize_type_kind(&mut variant.variant_type, resolver, allow_external)?;
            }
        }
        TypeKind::Primitive(_) => {}
    }
    Ok(())
}
