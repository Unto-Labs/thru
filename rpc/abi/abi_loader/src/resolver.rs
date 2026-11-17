use abi_types::{TypeDef, TypeKind};
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::path::{Path, PathBuf};

use crate::file::{AbiFile, ImportSource};

/// A declaration is identified by its canonical source and position, not its layout.
#[derive(Debug, Clone)]
pub struct Declaration {
    pub package: String,
    pub name: String,
    pub source: PathBuf,
    pub ordinal: usize,
}

/* Import resolver for loading and merging imported ABI files */
pub struct ImportResolver {
    /* Track loaded files to detect circular imports */
    loaded_files: HashSet<PathBuf>,

    /* Include directories for searching imports */
    include_dirs: Vec<PathBuf>,

    /* All collected type definitions */
    all_types: Vec<TypeDef>,

    /* All loaded ABI files */
    all_files: Vec<AbiFile>,

    /* Provenance stays aligned with all_types, including through diamond imports. */
    declarations: Vec<Declaration>,
    package_types: BTreeMap<String, Vec<String>>,
}

impl ImportResolver {
    /* Create a new import resolver with the given include directories */
    pub fn new(include_dirs: Vec<PathBuf>) -> Self {
        Self {
            loaded_files: HashSet::new(),
            include_dirs,
            all_types: Vec::new(),
            all_files: Vec::new(),
            declarations: Vec::new(),
            package_types: BTreeMap::new(),
        }
    }

    /* Resolve an import path relative to a base file or include directories */
    fn resolve_import_path(&self, import_path: &str, base_file: &Path) -> anyhow::Result<PathBuf> {
        /* First try relative to the base file's directory */
        if let Some(parent) = base_file.parent() {
            let relative_path = parent.join(import_path);
            if relative_path.exists() {
                return Ok(relative_path.canonicalize()?);
            }
        }

        /* Then try each include directory */
        for include_dir in &self.include_dirs {
            let include_path = include_dir.join(import_path);
            if include_path.exists() {
                return Ok(include_path.canonicalize()?);
            }
        }

        anyhow::bail!(
            "Import '{}' not found relative to '{}' or in include directories",
            import_path,
            base_file.display()
        )
    }

    /* Load an ABI file and recursively load its imports */
    pub fn load_file_with_imports(
        &mut self,
        file_path: &Path,
        verbose: bool,
    ) -> anyhow::Result<()> {
        self.load_file_with_imports_internal(file_path, verbose, false)
    }

    /* Load an ABI file and recursively load only local (path) imports */
    pub fn load_file_with_imports_skip_remote(
        &mut self,
        file_path: &Path,
        verbose: bool,
    ) -> anyhow::Result<()> {
        self.load_file_with_imports_internal(file_path, verbose, true)
    }

    fn load_file_with_imports_internal(
        &mut self,
        file_path: &Path,
        verbose: bool,
        skip_remote: bool,
    ) -> anyhow::Result<()> {
        /* Canonicalize the path to detect duplicates */
        let canonical_path = file_path.canonicalize()?;

        /* Skip if already loaded */
        if self.loaded_files.contains(&canonical_path) {
            if verbose {
                println!(
                    "    [~] Skipping already loaded file: {}",
                    file_path.display()
                );
            }
            return Ok(());
        }

        /* Mark as loaded before processing imports to detect circular dependencies */
        self.loaded_files.insert(canonical_path.clone());

        if verbose {
            println!("[~] Loading ABI file: {}", file_path.display());
        }

        /* Read and parse the ABI file */
        let file = std::fs::File::open(file_path)?;
        let contents = std::io::read_to_string(file)?;
        let abi_file: AbiFile = serde_yml::from_str(&contents)?;

        if verbose {
            println!("    Package: {}", abi_file.package());
            println!("    Version: {}", abi_file.package_version());
            if !abi_file.imports().is_empty() {
                println!("    Imports: {}", abi_file.imports().len());
            }
        }

        /* Reserve the package name before processing imports so that sibling
        auto-discovery can detect packages already being loaded and skip
        duplicate files (e.g. flat variants of the same ABI). */
        let package_name = abi_file.package().to_string();
        self.package_types
            .entry(package_name.clone())
            .or_insert_with(Vec::new);

        /* Recursively load imports (only path imports supported in this resolver) */
        let imports = abi_file.imports().to_vec();
        for import in &imports {
            match import {
                ImportSource::Path { path } => {
                    if verbose {
                        println!("    [~] Resolving path import: {}", path);
                    }

                    let import_path = self.resolve_import_path(path, file_path)?;

                    /* Recursively load the imported file */
                    self.load_file_with_imports_internal(&import_path, verbose, skip_remote)?;
                }
                _ => {
                    if verbose {
                        println!(
                            "    [~] Remote import encountered, will resolve via sibling discovery: {:?}",
                            import
                        );
                    }
                    /* Remote imports are resolved after all imports are processed
                    by discovering sibling ABI files that provide needed packages. */
                }
            }
        }

        /* Add types from this file and register them with the package */
        let type_names: Vec<String> = abi_file
            .get_types()
            .iter()
            .map(|t| t.name.clone())
            .collect();

        self.all_types.extend(abi_file.get_types().to_vec());
        self.declarations.extend(
            abi_file
                .get_types()
                .iter()
                .enumerate()
                .map(|(ordinal, ty)| Declaration {
                    package: package_name.clone(),
                    name: ty.name.clone(),
                    source: canonical_path.clone(),
                    ordinal,
                }),
        );

        /* Register types with their package */
        self.package_types
            .entry(package_name.clone())
            .or_insert_with(Vec::new)
            .extend(type_names);

        /* If the file had remote imports and we are not in skip_remote mode,
        discover sibling ABI files that provide the packages referenced by
        this file's type-refs. Only run for top-level loads, not for
        auto-discovered siblings (which use skip_remote=true). */
        let has_remote_imports = imports
            .iter()
            .any(|i| !matches!(i, ImportSource::Path { .. }));
        if has_remote_imports && !skip_remote {
            let needed_packages = Self::extract_referenced_packages(&abi_file);
            if !needed_packages.is_empty() {
                let unresolved: Vec<String> = needed_packages
                    .iter()
                    .filter(|p| !self.package_types.contains_key(*p))
                    .cloned()
                    .collect();

                if !unresolved.is_empty() {
                    if verbose {
                        println!(
                            "    [~] Discovering siblings for unresolved packages: {:?}",
                            unresolved
                        );
                    }

                    /* Gather every matching canonical source before loading any.
                    Never choose a package by directory iteration's first winner. */
                    let mut candidates: BTreeMap<String, BTreeSet<PathBuf>> = BTreeMap::new();
                    let mut scan_dirs: Vec<PathBuf> = Vec::new();
                    if let Some(parent) = file_path.parent() {
                        scan_dirs.push(parent.to_path_buf());
                    }
                    scan_dirs.extend(self.include_dirs.iter().cloned());

                    for dir in &scan_dirs {
                        if let Ok(entries) = std::fs::read_dir(dir) {
                            let mut paths: Vec<_> = entries.flatten().map(|e| e.path()).collect();
                            paths.sort();
                            for path in paths {
                                if path.extension().and_then(|e| e.to_str()) != Some("yaml") {
                                    continue;
                                }
                                if path
                                    .file_name()
                                    .and_then(|n| n.to_str())
                                    .map_or(true, |n| !n.ends_with(".abi.yaml"))
                                {
                                    continue;
                                }

                                if let Ok(cp) = path.canonicalize() {
                                    if self.loaded_files.contains(&cp) {
                                        continue;
                                    }
                                }

                                /* Peek at package without full parse */
                                let sibling_contents = match std::fs::read_to_string(&path) {
                                    Ok(c) => c,
                                    Err(_) => continue,
                                };
                                let sibling_package = Self::extract_own_package(&sibling_contents);
                                let sibling_package = match sibling_package {
                                    Some(p) => p,
                                    None => continue,
                                };

                                if unresolved.contains(&sibling_package) {
                                    candidates
                                        .entry(sibling_package)
                                        .or_default()
                                        .insert(path.canonicalize()?);
                                }
                            }
                        }
                    }
                    for (package, paths) in candidates {
                        if paths.len() != 1 {
                            anyhow::bail!("Ambiguous local sources for package '{}'", package);
                        }
                        self.load_file_with_imports_internal(
                            paths.iter().next().unwrap(),
                            verbose,
                            true,
                        )?;
                    }
                }
            }
        }

        /* Push this file last so that the root file (the one the caller
        originally requested) ends up at the tail of all_files. The
        flatten code relies on all_files.last() being the root. */
        self.all_files.push(abi_file);

        Ok(())
    }

    /* Get all collected type definitions */
    pub fn get_all_types(&self) -> &[TypeDef] {
        &self.all_types
    }

    /* Get all loaded ABI files */
    pub fn get_all_files(&self) -> &[AbiFile] {
        &self.all_files
    }

    /* Get the number of loaded files */
    pub fn loaded_file_count(&self) -> usize {
        self.loaded_files.len()
    }

    /// Resolve exact package/type identity. None means no local declaration.
    pub fn resolve_type_reference(
        &self,
        name: &str,
        package: Option<&str>,
    ) -> anyhow::Result<Option<String>> {
        let (dotted_package, simple) = match name.rsplit_once('.') {
            Some((qualifier, simple)) => (Some(qualifier), simple),
            None => (None, name),
        };
        if let (Some(dotted), Some(separate)) = (dotted_package, package) {
            if dotted != separate {
                anyhow::bail!(
                    "Conflicting qualifiers '{}' and '{}' for '{}'",
                    dotted,
                    separate,
                    name
                );
            }
        }
        let qualifier = package.or(dotted_package);
        let mut matches = self
            .declarations
            .iter()
            .filter(|decl| decl.name == simple && qualifier.map_or(true, |q| q == decl.package));
        let first = matches.next();
        if matches.next().is_some() {
            anyhow::bail!("Ambiguous type reference '{}'", name);
        }
        Ok(first.map(|decl| decl.name.clone()))
    }

    pub fn resolve_type_name(&self, name: &str) -> anyhow::Result<Option<String>> {
        self.resolve_type_reference(name, None)
    }

    /// Reject distinct declarations before any qualification is erased.
    pub fn validate_flattened_names(&self) -> anyhow::Result<()> {
        let mut names: BTreeMap<&str, Vec<&Declaration>> = BTreeMap::new();
        for decl in &self.declarations {
            names.entry(&decl.name).or_default().push(decl);
        }
        for (name, declarations) in names {
            if declarations.len() > 1 {
                // Relative canonical provenance distinguishes same-basename files
                // without leaking a checkout-specific absolute prefix.
                let mut common = declarations[0].source.parent().unwrap_or(Path::new("/"));
                for declaration in &declarations {
                    while !declaration.source.starts_with(common) {
                        common = common.parent().unwrap_or(Path::new("/"));
                    }
                }
                let mut identities: Vec<_> = declarations
                    .iter()
                    .map(|decl| {
                        format!(
                            "{}.{} ({} declaration {})",
                            decl.package,
                            decl.name,
                            decl.source.strip_prefix(common).unwrap().display(),
                            decl.ordinal,
                        )
                    })
                    .collect();
                identities.sort();
                anyhow::bail!(
                    "Conflicting declarations for simple name '{}': {}",
                    name,
                    identities.join(", ")
                );
            }
        }
        Ok(())
    }

    pub fn declarations(&self) -> &[Declaration] {
        &self.declarations
    }

    pub fn has_local_qualifier(&self, qualifier: &str) -> bool {
        self.package_types.contains_key(qualifier)
    }

    /* A name without exactly one declaration has no unique package. */
    pub fn get_package_for_type(&self, type_name: &str) -> Option<String> {
        self.package_for_type(type_name).map(str::to_owned)
    }

    pub(crate) fn package_for_type(&self, type_name: &str) -> Option<&str> {
        let mut matches = self
            .declarations
            .iter()
            .filter(|decl| decl.name == type_name);
        let first = matches.next()?;
        if matches.next().is_some() {
            return None;
        }
        Some(&first.package)
    }

    pub fn get_packages(&self) -> Vec<String> {
        self.package_types.keys().cloned().collect()
    }

    fn extract_referenced_packages(file: &AbiFile) -> Vec<String> {
        fn visit(kind: &TypeKind, packages: &mut BTreeSet<String>) {
            match kind {
                TypeKind::TypeRef(reference) => {
                    if let Some(package) = reference
                        .package
                        .as_deref()
                        .or_else(|| reference.name.rsplit_once('.').map(|(package, _)| package))
                    {
                        packages.insert(package.to_owned());
                    }
                }
                TypeKind::Struct(value) => {
                    for field in &value.fields {
                        visit(&field.field_type, packages);
                    }
                }
                TypeKind::Union(value) => {
                    for variant in &value.variants {
                        visit(&variant.variant_type, packages);
                    }
                }
                TypeKind::Enum(value) => {
                    for variant in &value.variants {
                        visit(&variant.variant_type, packages);
                    }
                }
                TypeKind::SizeDiscriminatedUnion(value) => {
                    for variant in &value.variants {
                        visit(&variant.variant_type, packages);
                    }
                }
                TypeKind::Array(value) => visit(&value.element_type, packages),
                TypeKind::Primitive(_) => {}
            }
        }
        let mut packages = BTreeSet::new();
        for ty in file.get_types() {
            visit(&ty.kind, &mut packages);
        }
        packages.remove(file.package());
        packages.into_iter().collect()
    }

    /* Extract the top-level package name from raw YAML content without
    doing a full parse. Looks for the `package:` field in the abi header. */
    fn extract_own_package(contents: &str) -> Option<String> {
        for line in contents.lines() {
            let trimmed = line.trim();
            if let Some(rest) = trimmed.strip_prefix("package:") {
                let value = rest.trim().trim_matches('"').trim_matches('\'');
                if !value.is_empty() {
                    return Some(value.to_string());
                }
            }
        }
        None
    }
}
