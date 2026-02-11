use crate::file::{AbiFile, AbiMetadata};
use crate::resolver::ImportResolver;
use abi_types::{TypeDef, TypeKind};
use std::path::{Path, PathBuf};

/// Flatten an ABI file by resolving all imports and inlining types.
/// Returns the flattened AbiFile.
pub fn flatten(file_path: &Path, include_dirs: &[PathBuf]) -> anyhow::Result<AbiFile> {
    flatten_with_options(file_path, include_dirs, false)
}

/// Flatten an ABI file with verbose output option.
pub fn flatten_with_options(
    file_path: &Path,
    include_dirs: &[PathBuf],
    verbose: bool,
) -> anyhow::Result<AbiFile> {
    /* Load root file and all imports */
    let mut resolver = ImportResolver::new(include_dirs.to_vec());
    resolver.load_file_with_imports(file_path, verbose)?;

    let all_files = resolver.get_all_files();
    if all_files.is_empty() {
        anyhow::bail!("No ABI files loaded");
    }

    /* The last file is the root file (it's added after its imports) */
    let root_file = all_files.last().unwrap();

    /* Collect all types from all files */
    let mut all_types: Vec<TypeDef> = resolver.get_all_types().to_vec();

    /* Normalize FQDN type references to simple names */
    normalize_type_refs(&mut all_types, &resolver);

    /* Create the flattened ABI file */
    let flattened = AbiFile {
        abi: AbiMetadata {
            package: root_file.abi.package.clone(),
            name: root_file.abi.name.clone(),
            abi_version: root_file.abi.abi_version,
            package_version: root_file.abi.package_version.clone(),
            description: root_file.abi.description.clone(),
            imports: Vec::new(), /* No imports in flattened output */
            options: root_file.abi.options.clone(),
        },
        types: all_types,
    };

    if verbose {
        println!(
            "[~] Flattened {} files into {} types",
            resolver.loaded_file_count(),
            flattened.types.len()
        );
    }

    Ok(flattened)
}

/// Flatten an ABI file and return the result as a YAML string.
pub fn flatten_to_yaml(file_path: &Path, include_dirs: &[PathBuf]) -> anyhow::Result<String> {
    let flattened = flatten(file_path, include_dirs)?;
    let yaml = serde_yml::to_string(&flattened)?;
    Ok(yaml)
}

/// Normalize FQDN type references to simple names using the import resolver.
pub fn normalize_type_refs(typedefs: &mut [TypeDef], resolver: &ImportResolver) {
    for typedef in typedefs.iter_mut() {
        normalize_type_kind(&mut typedef.kind, resolver);
    }
}

fn normalize_type_kind(kind: &mut TypeKind, resolver: &ImportResolver) {
    match kind {
        TypeKind::TypeRef(type_ref) => {
            /* Resolve FQDN to simple name */
            if let Some(simple_name) = resolver.resolve_type_name(&type_ref.name) {
                type_ref.name = simple_name;
            }
        }
        TypeKind::Struct(struct_type) => {
            for field in &mut struct_type.fields {
                normalize_type_kind(&mut field.field_type, resolver);
            }
        }
        TypeKind::Union(union_type) => {
            for variant in &mut union_type.variants {
                normalize_type_kind(&mut variant.variant_type, resolver);
            }
        }
        TypeKind::Enum(enum_type) => {
            for variant in &mut enum_type.variants {
                normalize_type_kind(&mut variant.variant_type, resolver);
            }
        }
        TypeKind::Array(array_type) => {
            normalize_type_kind(&mut array_type.element_type, resolver);
        }
        TypeKind::SizeDiscriminatedUnion(sdu_type) => {
            for variant in &mut sdu_type.variants {
                normalize_type_kind(&mut variant.variant_type, resolver);
            }
        }
        TypeKind::Primitive(_) => { /* No normalization needed */ }
    }
}
