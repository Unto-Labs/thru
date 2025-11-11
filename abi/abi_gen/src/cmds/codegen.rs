/* Codegen command - generate code from ABI definitions */

use crate::abi::file::ImportResolver;
use crate::abi::resolved::TypeResolver;
use super::common::{analyze_and_resolve_types, normalize_type_refs};
use std::path::PathBuf;

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub enum Language {
  C,
  Rust,
  TypeScript,
}

/* Execute the codegen command */
pub fn run(
  files: Vec<PathBuf>,
  include_dirs: Vec<PathBuf>,
  language: Language,
  output_dir: PathBuf,
  verbose: bool,
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
    println!("\n[~] Loaded {} file(s) total (including imports)", resolver.loaded_file_count());
    println!("[~] Packages loaded:");
    for package in resolver.get_packages() {
      println!("    - {}", package);
    }
  }

  /* Get all types and normalize FQDN references */
  let mut all_typedefs = resolver.get_all_types().to_vec();
  normalize_type_refs(&mut all_typedefs, &resolver);

  let all_typedefs = all_typedefs;

  /* Analyze and resolve types */
  let type_resolver = analyze_and_resolve_types(&all_typedefs, verbose)?;

  /* Generate code */
  generate_code(&type_resolver, &resolver, language, &output_dir, verbose)?;

  Ok(())
}

fn generate_code(
  type_resolver: &TypeResolver,
  import_resolver: &ImportResolver,
  language: Language,
  output_dir: &PathBuf,
  verbose: bool,
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
  let mut types_by_package: HashMap<String, Vec<&crate::abi::resolved::ResolvedType>> = HashMap::new();
  for resolved_type in &resolved_types {
    if let Some(package) = import_resolver.get_package_for_type(&resolved_type.name) {
      types_by_package.entry(package).or_insert_with(Vec::new).push(resolved_type);
    }
  }

  match language {
    Language::C => {
      /* Generate code for each package in its own directory */
      for (package, package_types) in &types_by_package {
        /* Convert package name to directory path (e.g., "thru.common.primitives" -> "thru/common/primitives") */
        let package_dir = package.replace('.', "/");
        let full_output_dir = output_dir.join(&package_dir);

        std::fs::create_dir_all(&full_output_dir)?;

        if verbose {
          println!("[~] Generating code for package '{}' in {}", package, full_output_dir.display());
        }

        let options = c::CCodeGeneratorOptions {
          output_dir: full_output_dir.to_string_lossy().to_string(),
          emit_type_definitions: true,
          emit_functions: true,
          package: Some(package.clone()),
          all_packages: types_by_package.keys().cloned().collect(),
          import_resolver: Some(import_resolver),
        };
        let generator = c::CCodeGenerator::new(options);
        generator.emit_code(package_types);
      }

      if verbose {
        println!("[✓] Generated C code in package directories:");
        for package in types_by_package.keys() {
          let package_dir = package.replace('.', "/");
          println!("    - {}/{}/{{types.h, functions.c}}", output_dir.display(), package_dir);
        }
      }
    }
    Language::Rust => {
      use crate::codegen::rust;

      /* Generate code for each package in its own directory */
      for (package, package_types) in &types_by_package {
        /* Convert package name to directory path (e.g., "thru.common.primitives" -> "thru/common/primitives") */
        let package_dir = package.replace('.', "/");
        let full_output_dir = output_dir.join(&package_dir);

        std::fs::create_dir_all(&full_output_dir)?;

        if verbose {
          println!("[~] Generating code for package '{}' in {}", package, full_output_dir.display());
        }

        let options = rust::RustCodeGeneratorOptions {
          output_dir: full_output_dir.to_string_lossy().to_string(),
          emit_type_definitions: true,
          emit_accessors: true,
          package: Some(package.clone()),
          all_packages: types_by_package.keys().cloned().collect(),
          import_resolver: Some(import_resolver),
        };
        let generator = rust::RustCodeGenerator::new(options);
        generator.emit_code(package_types);
      }

      /* Generate mod.rs files for each package directory */
      generate_rust_mod_files(output_dir, &types_by_package)?;

      if verbose {
        println!("[✓] Generated Rust code in package directories:");
        for package in types_by_package.keys() {
          let package_dir = package.replace('.', "/");
          println!("    - {}/{}/types.rs", output_dir.display(), package_dir);
        }
      }
    }
    Language::TypeScript => {
      use crate::codegen::ts;

      /* Generate code for each package in its own directory */
      for (package, package_types) in &types_by_package {
        /* Convert package name to directory path (e.g., "thru.common.primitives" -> "thru/common/primitives") */
        let package_dir = package.replace('.', "/");
        let full_output_dir = output_dir.join(&package_dir);

        std::fs::create_dir_all(&full_output_dir)?;

        if verbose {
          println!("[~] Generating code for package '{}' in {}", package, full_output_dir.display());
        }

        let options = ts::TypeScriptCodeGeneratorOptions {
          output_dir: full_output_dir.to_string_lossy().to_string(),
          emit_type_definitions: true,
          emit_methods: true,
        };
        let generator = ts::TypeScriptCodeGenerator::new(options);
        generator.emit_code(package_types);
      }

      if verbose {
        println!("[✓] Generated TypeScript code in package directories:");
        for package in types_by_package.keys() {
          let package_dir = package.replace('.', "/");
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
) -> anyhow::Result<()> {
  use std::collections::{HashMap, HashSet};

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

      package_tree.entry(parent_path).or_insert_with(HashSet::new).insert(child);
    }
  }

  /* Generate mod.rs at the root */
  if !package_tree.is_empty() {
    let empty_set = HashSet::new();
    let root_modules = package_tree.get("").unwrap_or(&empty_set);
    if !root_modules.is_empty() {
      let mut mod_content = String::new();
      for module in root_modules.iter().collect::<Vec<_>>() {
        mod_content.push_str(&format!("pub mod {};\n", module));
      }

      let mod_path = output_dir.join("mod.rs");
      std::fs::write(&mod_path, mod_content)?;
    }
  }

  /* Generate mod.rs files for each intermediate package directory */
  for (parent_pkg, children) in &package_tree {
    if parent_pkg.is_empty() {
      continue; // Skip root, already handled
    }

    let parent_dir = output_dir.join(parent_pkg.replace('.', "/"));
    let mut mod_content = String::new();

    /* Add submodules */
    for child in children.iter().collect::<Vec<_>>() {
      mod_content.push_str(&format!("pub mod {};\n", child));
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

    let mod_content = "pub mod types;\npub mod functions;\npub use types::*;\npub use functions::*;\n";
    std::fs::write(&mod_path, mod_content)?;
  }

  Ok(())
}
