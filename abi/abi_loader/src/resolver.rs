use abi_types::TypeDef;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::file::{AbiFile, ImportSource};

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

    /* Map from package name to list of types in that package */
    package_types: std::collections::HashMap<String, Vec<String>>,
}

impl ImportResolver {
    /* Create a new import resolver with the given include directories */
    pub fn new(include_dirs: Vec<PathBuf>) -> Self {
        Self {
            loaded_files: HashSet::new(),
            include_dirs,
            all_types: Vec::new(),
            all_files: Vec::new(),
            package_types: std::collections::HashMap::new(),
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

        /* Register types with their package */
        self.package_types
            .entry(package_name.clone())
            .or_insert_with(Vec::new)
            .extend(type_names);

        /* If the file had remote imports and we are not in skip_remote mode,
           discover sibling ABI files that provide the packages referenced by
           this file's type-refs. Only run for top-level loads, not for
           auto-discovered siblings (which use skip_remote=true). */
        let has_remote_imports = imports.iter().any(|i| !matches!(i, ImportSource::Path { .. }));
        if has_remote_imports && !skip_remote {
            let needed_packages = Self::extract_referenced_packages(&contents, &package_name);
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

                    /* Build a map of package → file path from sibling directories */
                    let mut scan_dirs: Vec<PathBuf> = Vec::new();
                    if let Some(parent) = file_path.parent() {
                        scan_dirs.push(parent.to_path_buf());
                    }
                    scan_dirs.extend(self.include_dirs.iter().cloned());

                    for dir in &scan_dirs {
                        if let Ok(entries) = std::fs::read_dir(dir) {
                            let mut paths: Vec<_> = entries
                                .flatten()
                                .map(|e| e.path())
                                .collect();
                            paths.sort();
                            for path in paths {
                                if path.extension().and_then(|e| e.to_str()) != Some("yaml") {
                                    continue;
                                }
                                if path.file_name().and_then(|n| n.to_str())
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
                                let sibling_package =
                                    Self::extract_own_package(&sibling_contents);
                                let sibling_package = match sibling_package {
                                    Some(p) => p,
                                    None => continue,
                                };

                                /* Check against both the original unresolved set and the
                                   live package_types (a sibling loaded earlier in this scan
                                   may have already provided this package). */
                                if !unresolved.contains(&sibling_package)
                                    || self.package_types.contains_key(&sibling_package)
                                {
                                    continue;
                                }

                                if verbose {
                                    println!(
                                        "    [~] Auto-loading sibling {} for package '{}'",
                                        path.display(),
                                        sibling_package
                                    );
                                }

                                if let Err(e) = self.load_file_with_imports_internal(
                                    &path,
                                    verbose,
                                    true, /* skip_remote to prevent cascading */
                                ) {
                                    if verbose {
                                        println!(
                                            "    [~] Skipping sibling {}: {}",
                                            path.display(),
                                            e
                                        );
                                    }
                                }
                            }
                        }
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

    /* Resolve a type name which may be FQDN or simple name */
    pub fn resolve_type_name(&self, type_name: &str) -> Option<String> {
        /* If it contains a dot, it's potentially an FQDN */
        if type_name.contains('.') {
            /* Try to find the type by FQDN */
            /* Format: package.name.TypeName or just TypeName */
            let parts: Vec<&str> = type_name.split('.').collect();
            if parts.len() < 2 {
                /* Not a valid FQDN, return as-is */
                return Some(type_name.to_string());
            }

            /* The last part is the type name */
            let simple_name = parts[parts.len() - 1];

            /* Try to match package prefixes */
            for (package, types) in &self.package_types {
                if type_name.starts_with(package) && types.contains(&simple_name.to_string()) {
                    return Some(simple_name.to_string());
                }
            }

            /* Not found by FQDN, maybe it's just a simple name with dots */
            Some(type_name.to_string())
        } else {
            /* Simple name, return as-is */
            Some(type_name.to_string())
        }
    }

    /* Get the package name for a given type */
    pub fn get_package_for_type(&self, type_name: &str) -> Option<String> {
        for (package, types) in &self.package_types {
            if types.contains(&type_name.to_string()) {
                return Some(package.clone());
            }
        }
        None
    }

    /* Get all packages */
    pub fn get_packages(&self) -> Vec<String> {
        self.package_types.keys().cloned().collect()
    }

    /* Extract packages referenced by type-refs in the raw YAML content.
       Scans for `package:` lines (used in type-ref definitions) and returns
       unique package names excluding the file's own package. */
    fn extract_referenced_packages(contents: &str, own_package: &str) -> Vec<String> {
        let mut packages = HashSet::new();
        for line in contents.lines() {
            let trimmed = line.trim();
            if let Some(rest) = trimmed.strip_prefix("package:") {
                let value = rest.trim().trim_matches('"').trim_matches('\'');
                if !value.is_empty() && value != own_package {
                    packages.insert(value.to_string());
                }
            }
        }
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
