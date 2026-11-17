/* Codegen command - generate code from ABI definitions */

use super::common::{analyze_and_resolve_types, normalize_type_refs};
use crate::abi::file::ImportResolver;
use crate::abi::resolved::TypeResolver;
use std::path::PathBuf;

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum Language {
    C,
    Rust,
    TypeScript,
    Go,
}

/* Language-specific codegen options. */
#[derive(Clone, Debug, Default)]
pub struct CodegenOptions {
    /* Go module path of the output root (`go.mod`); `None` uses the default. */
    pub go_module: Option<String>,
}

/* Execute the codegen command */
pub fn run(
    files: Vec<PathBuf>,
    include_dirs: Vec<PathBuf>,
    language: Language,
    output_dir: PathBuf,
    verbose: bool,
) -> anyhow::Result<()> {
    run_with_options(
        files,
        include_dirs,
        language,
        output_dir,
        verbose,
        &CodegenOptions::default(),
    )
}

/* Execute the codegen command with language-specific options */
pub fn run_with_options(
    files: Vec<PathBuf>,
    include_dirs: Vec<PathBuf>,
    language: Language,
    output_dir: PathBuf,
    verbose: bool,
    options: &CodegenOptions,
) -> anyhow::Result<()> {
    if verbose {
        println!("ABI Generator - Code Generation Tool");
        println!("====================================\n");
        println!("[~] Configuration:");
        println!("  Language: {:?}", language);
        println!("  Output directory: {}", output_dir.display());
        println!("  Input files: {}", files.len());
        for file in &files {
            println!("    - {}", file.display());
        }
        if !include_dirs.is_empty() {
            println!("  Include directories: {}", include_dirs.len());
            for dir in &include_dirs {
                println!("    - {}", dir.display());
            }
        }
        println!();
    }

    /* Use ImportResolver to load files with their imports */
    let mut resolver = ImportResolver::new(include_dirs.clone());

    if verbose {
        println!("[~] Loading ABI files and resolving imports...");
        if !include_dirs.is_empty() {
            println!("    Include directories:");
            for dir in &include_dirs {
                println!("      - {}", dir.display());
            }
        }
        println!();
    }

    for file in &files {
        resolver.load_file_with_imports(file, verbose)?;
    }

    if verbose {
        println!(
            "\n[~] Loaded {} file(s) total (including imports)",
            resolver.loaded_file_count()
        );
        println!("[~] Packages loaded:");
        for package in resolver.get_packages() {
            println!("    - {}", package);
        }
    }

    /* Get all types and normalize FQDN references */
    let mut all_typedefs = resolver.get_all_types().to_vec();
    normalize_type_refs(&mut all_typedefs, &resolver)?;

    let all_typedefs = all_typedefs;

    /* Analyze and resolve types */
    let type_resolver = analyze_and_resolve_types(&all_typedefs, verbose)?;

    /* Generate code */
    generate_code(
        &type_resolver,
        &resolver,
        language,
        &output_dir,
        verbose,
        options,
    )?;

    Ok(())
}

fn generate_code(
    type_resolver: &TypeResolver,
    import_resolver: &ImportResolver,
    language: Language,
    output_dir: &PathBuf,
    verbose: bool,
    options: &CodegenOptions,
) -> anyhow::Result<()> {
    use crate::codegen::c;
    use std::collections::HashMap;

    if verbose {
        println!("\n[*] Starting code generation for {:?}...", language);
    }

    /* Create output directory */
    std::fs::create_dir_all(output_dir)?;

    /* Collect resolved types in resolution order */
    let resolved_types: Vec<_> = type_resolver
        .resolution_order
        .iter()
        .filter_map(|name| type_resolver.get_type_info(name))
        .collect();

    /* Group types by package */
    let mut types_by_package: HashMap<String, Vec<&crate::abi::resolved::ResolvedType>> =
        HashMap::new();
    for resolved_type in &resolved_types {
        if let Some(package) = import_resolver.get_package_for_type(&resolved_type.name) {
            types_by_package
                .entry(package)
                .or_insert_with(Vec::new)
                .push(resolved_type);
        }
    }

    /* Package names are written into generated paths, imports and
    comments in every language; like type names, only plain text is
    accepted so none can end up as generated code. */
    for package in types_by_package.keys() {
        if !is_valid_package_name(package) {
            anyhow::bail!(
                "package name '{}' is not dot-separated [A-Za-z0-9_-] segments",
                package.escape_debug()
            );
        }
    }

    match language {
        Language::C => {
            /* Every package gets its own directory. */
            let paths = c::c_package_paths(types_by_package.keys());

            /* Generate code for each package in its own directory */
            for (package, package_types) in &types_by_package {
                /* e.g. "thru.common.primitives" -> "thru/common/primitives" */
                let package_dir = paths[package].join("/");
                let full_output_dir = output_dir.join(&package_dir);

                std::fs::create_dir_all(&full_output_dir)?;

                if verbose {
                    println!(
                        "[~] Generating code for package '{}' in {}",
                        package,
                        full_output_dir.display()
                    );
                }

                let options = c::CCodeGeneratorOptions {
                    output_dir: full_output_dir.to_string_lossy().to_string(),
                    emit_type_definitions: true,
                    emit_functions: true,
                    package: Some(package.clone()),
                    all_packages: types_by_package.keys().cloned().collect(),
                    import_resolver: Some(import_resolver),
                };
                let generator = c::CCodeGenerator::new(type_resolver, options);
                generator.emit_code(package_types);
            }

            if verbose {
                println!("[✓] Generated C code in package directories:");
                for package in types_by_package.keys() {
                    let package_dir = paths[package].join("/");
                    println!(
                        "    - {}/{}/{{types.h, functions.c}}",
                        output_dir.display(),
                        package_dir
                    );
                }
            }
        }
        Language::Rust => {
            use crate::codegen::rust;

            /* Every package gets its own directory / module path. */
            let paths =
                crate::codegen::rust_gen::names::rust_package_paths(types_by_package.keys());

            /* Generate code for each package in its own directory */
            for (package, package_types) in &types_by_package {
                /* e.g. "thru.common.primitives" -> "thru/common/primitives" */
                let package_dir = paths[package].join("/");
                let full_output_dir = output_dir.join(&package_dir);

                std::fs::create_dir_all(&full_output_dir)?;

                if verbose {
                    println!(
                        "[~] Generating code for package '{}' in {}",
                        package,
                        full_output_dir.display()
                    );
                }

                let options = rust::RustCodeGeneratorOptions {
                    output_dir: full_output_dir.to_string_lossy().to_string(),
                    emit_type_definitions: true,
                    emit_accessors: true,
                    package: Some(package.clone()),
                    all_packages: types_by_package.keys().cloned().collect(),
                    import_resolver: Some(import_resolver),
                };
                let generator = rust::RustCodeGenerator::new(type_resolver, options);
                generator.emit_code(package_types);
            }

            /* Generate mod.rs files for each package directory */
            generate_rust_mod_files(output_dir, &types_by_package, &paths)?;

            if verbose {
                println!("[✓] Generated Rust code in package directories:");
                for package in types_by_package.keys() {
                    let package_dir = paths[package].join("/");
                    println!("    - {}/{}/types.rs", output_dir.display(), package_dir);
                }
            }
        }
        Language::Go => {
            use crate::codegen::go;

            let module = options
                .go_module
                .clone()
                .unwrap_or_else(|| go::DEFAULT_MODULE.to_string());
            let mut pkg_of = HashMap::new();
            for (package, package_types) in &types_by_package {
                for ty in package_types {
                    pkg_of.insert(ty.name.clone(), package.clone());
                }
            }
            go::write_root(output_dir, &module)?;
            let dirs = go::package_dirs(types_by_package.keys());
            let mut packages: Vec<&String> = types_by_package.keys().collect();
            packages.sort();
            for package in packages {
                let full_output_dir = output_dir.join(&dirs[package]);
                std::fs::create_dir_all(&full_output_dir)?;
                if verbose {
                    println!(
                        "[~] Generating code for package '{}' in {}",
                        package,
                        full_output_dir.display()
                    );
                }
                let code = go::emit_package(
                    type_resolver,
                    package,
                    &types_by_package[package],
                    &pkg_of,
                    &module,
                );
                std::fs::write(full_output_dir.join("types.go"), code)?;
            }
            if verbose {
                println!("[✓] Generated Go code (module {}):", module);
                for package in types_by_package.keys() {
                    println!("    - {}/{}/types.go", output_dir.display(), dirs[package]);
                }
            }
        }
        Language::TypeScript => {
            use crate::codegen::shared::{builder::IrBuilder, ir::TypeIr};
            use crate::codegen::ts;
            use std::sync::Arc;

            /* Every package gets its own directory. */
            let paths = ts::ts_package_paths(types_by_package.keys());
            let mut type_package_map = HashMap::new();
            let mut package_path_map = HashMap::new();
            for (package, package_types) in &types_by_package {
                let package_dir = paths[package].join("/");
                package_path_map.insert(package.clone(), package_dir);
                for ty in package_types {
                    type_package_map.insert((*ty).name.clone(), package.clone());
                }
            }
            let type_package_map = Arc::new(type_package_map);
            let package_path_map = Arc::new(package_path_map);

            let ts_ir_builder = IrBuilder::for_typescript(type_resolver);
            let mut ts_ir_cache: HashMap<String, Option<TypeIr>> = HashMap::new();
            for ty in &resolved_types {
                let ty = *ty;
                /* Every TypeScript class sizes and validates through its IR:
                a type without one cannot be generated. */
                let type_ir = ts_ir_builder.build_type(ty).map_err(|err| {
                    anyhow::anyhow!(
                        "TypeScript codegen cannot represent type '{}': {}",
                        ty.name,
                        err
                    )
                })?;
                ts_ir_cache.insert(ty.name.clone(), Some(type_ir));
            }

            /* Generate code for each package in its own directory */
            for (package, package_types) in &types_by_package {
                /* e.g. "thru.common.primitives" -> "thru/common/primitives" */
                let package_dir = paths[package].join("/");
                let full_output_dir = output_dir.join(&package_dir);

                std::fs::create_dir_all(&full_output_dir)?;

                if verbose {
                    println!(
                        "[~] Generating code for package '{}' in {}",
                        package,
                        full_output_dir.display()
                    );
                }

                let mut package_types_with_ir = Vec::with_capacity(package_types.len());
                for resolved_type in package_types {
                    let resolved_type = *resolved_type;
                    let type_ir = match ts_ir_cache.remove(resolved_type.name.as_str()) {
                        Some(ir) => ir,
                        None => Some(ts_ir_builder.build_type(resolved_type).map_err(|err| {
                            anyhow::anyhow!(
                                "TypeScript codegen cannot represent type '{}': {}",
                                resolved_type.name,
                                err
                            )
                        })?),
                    };
                    package_types_with_ir.push((resolved_type, type_ir));
                }

                let package_dir_str = package_dir.clone();
                let options = ts::TypeScriptCodeGeneratorOptions {
                    output_dir: full_output_dir.to_string_lossy().to_string(),
                    emit_type_definitions: true,
                    emit_methods: true,
                    package_name: Some(package.clone()),
                    package_path: Some(package_dir_str),
                    type_package_map: Some(type_package_map.clone()),
                    package_path_map: Some(package_path_map.clone()),
                };
                let generator = ts::TypeScriptCodeGenerator::new(options);
                /* A shape the emitter does not handle is reported as an
                error naming the package, not a panic. */
                let previous_hook = std::panic::take_hook();
                std::panic::set_hook(Box::new(|_| {}));
                let emitted = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    generator.emit_code(&package_types_with_ir, Some(&resolved_types))
                }));
                std::panic::set_hook(previous_hook);
                let generated_code = emitted.map_err(|panic| {
                    let message = panic
                        .downcast_ref::<String>()
                        .cloned()
                        .or_else(|| panic.downcast_ref::<&str>().map(|s| s.to_string()))
                        .unwrap_or_else(|| "unsupported layout".to_string());
                    anyhow::anyhow!(
                        "TypeScript codegen failed for package '{}': {}",
                        package,
                        message
                    )
                })?;

                /* Write the generated TypeScript code to types.ts */
                let types_file = full_output_dir.join("types.ts");
                std::fs::write(&types_file, generated_code)?;
            }

            if verbose {
                println!("[✓] Generated TypeScript code in package directories:");
                for package in types_by_package.keys() {
                    let package_dir = paths[package].join("/");
                    println!("    - {}/{}/types.ts", output_dir.display(), package_dir);
                }
            }
        }
    }

    println!("[✓] Code generation complete!");
    Ok(())
}

/* Generate mod.rs files for Rust package structure */
fn generate_rust_mod_files(
    output_dir: &PathBuf,
    types_by_package: &std::collections::HashMap<String, Vec<&crate::abi::resolved::ResolvedType>>,
    paths: &std::collections::BTreeMap<String, Vec<String>>,
) -> anyhow::Result<()> {
    use std::collections::{HashMap, HashSet};

    /* Packages by their allocated module path (`a.b.c`, segments joined by '.'). */
    let types_by_package: HashMap<String, ()> = types_by_package
        .keys()
        .map(|p| (paths[p].join("."), ()))
        .collect();

    /* Build a tree of package components */
    let mut package_tree: HashMap<String, HashSet<String>> = HashMap::new();

    for package in types_by_package.keys() {
        let parts: Vec<&str> = package.split('.').collect();

        /* For each level, register the child module */
        for i in 0..parts.len() {
            let parent_path = if i == 0 {
                String::new()
            } else {
                parts[0..i].join(".")
            };

            let child = parts[i].to_string();

            package_tree
                .entry(parent_path)
                .or_insert_with(HashSet::new)
                .insert(child);
        }
    }

    /* Generate mod.rs at the root */
    if !package_tree.is_empty() {
        let empty_set = HashSet::new();
        let root_modules = package_tree.get("").unwrap_or(&empty_set);
        if !root_modules.is_empty() {
            let mut mod_content = String::new();
            let mut root_sorted: Vec<_> = root_modules.iter().collect();
            root_sorted.sort();
            for module in root_sorted {
                mod_content.push_str(&format!("pub mod {};\n", rust_mod_ident(module)));
            }
            /* One runtime shared by every package (re-exported as `<pkg>::runtime`). */
            mod_content.push_str(&format!(
                "pub mod {};\n",
                crate::codegen::rust::SHARED_RUNTIME_MODULE
            ));
            std::fs::write(
                output_dir.join(format!(
                    "{}.rs",
                    crate::codegen::rust::SHARED_RUNTIME_MODULE
                )),
                crate::codegen::rust::RUNTIME_MODULE_CONTENT,
            )?;

            let mod_path = output_dir.join("mod.rs");
            std::fs::write(&mod_path, mod_content)?;
        }
    }

    /* Generate mod.rs files for each intermediate package directory */
    for (parent_pkg, children) in &package_tree {
        if parent_pkg.is_empty() {
            continue; // Skip root, already handled
        }
        /* A package that is also a parent gets one mod.rs, written below. */
        if types_by_package.contains_key(parent_pkg) {
            continue;
        }

        let parent_dir = output_dir.join(parent_pkg.replace('.', "/"));
        let mut mod_content = String::new();

        /* Add submodules */
        let mut children_sorted: Vec<_> = children.iter().collect();
        children_sorted.sort();
        for child in children_sorted {
            mod_content.push_str(&format!("pub mod {};\n", rust_mod_ident(child)));
        }

        /* If this is a leaf package with types, re-export them */
        if types_by_package.contains_key(parent_pkg) {
            mod_content.push_str("\npub mod types;\n");
            mod_content.push_str("pub use types::*;\n");
        }

        if !mod_content.is_empty() {
            let mod_path = parent_dir.join("mod.rs");
            std::fs::write(&mod_path, mod_content)?;
        }
    }

    /* Generate mod.rs for leaf packages */
    for package in types_by_package.keys() {
        let package_dir = output_dir.join(package.replace('.', "/"));
        let mod_path = package_dir.join("mod.rs");

        /* Check if runtime.rs was generated (it exists when IR types are used) */
        let runtime_exists = package_dir.join("runtime.rs").exists();

        let mut mod_content = String::new();
        mod_content.push_str("pub mod types;\n");
        mod_content.push_str("pub mod functions;\n");
        if runtime_exists {
            mod_content.push_str("pub mod runtime;\n");
        }
        mod_content.push_str("pub use types::*;\n");
        mod_content.push_str("pub use functions::*;\n");

        /* The package's child packages (`a` and `a.b`). */
        if let Some(children) = package_tree.get(package) {
            let mut children_sorted: Vec<_> = children.iter().collect();
            children_sorted.sort();
            mod_content.push('\n');
            for child in children_sorted {
                mod_content.push_str(&format!("pub mod {};\n", rust_mod_ident(child)));
            }
        }

        std::fs::write(&mod_path, mod_content)?;
    }

    Ok(())
}

/* Package components become module names; escape Rust keywords. */
fn rust_mod_ident(name: &str) -> String {
    crate::codegen::rust_gen::model::escape_ident(name)
}

/* A package name is one or more non-empty [A-Za-z0-9_-] segments joined
by dots (`thru.program.token`). */
pub fn is_valid_package_name(package: &str) -> bool {
    package.split('.').all(|segment| {
        !segment.is_empty()
            && segment
                .chars()
                .all(|c| c == '_' || c == '-' || c.is_ascii_alphanumeric())
    })
}

#[cfg(test)]
mod package_name_tests {
    use super::is_valid_package_name;

    #[test]
    fn package_names_cannot_inject_source() {
        assert!(is_valid_package_name("thru.program.token"));
        assert!(is_valid_package_name("a_b.c-d.E9"));
        assert!(!is_valid_package_name("a\npackage evil\nfunc init(){}"));
        assert!(!is_valid_package_name("a.b /*"));
        assert!(!is_valid_package_name("a..b"));
        assert!(!is_valid_package_name(""));
    }
}
