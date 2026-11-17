/* Common utilities shared between analyze and codegen commands */

use crate::abi::resolved::TypeResolver;
use crate::abi::types::TypeDef;
use crate::dependency::DependencyAnalyzer;
use abi_loader::AbiFile;

// Re-export normalize_type_refs from abi_loader
pub use abi_loader::normalize_type_refs;

/* Analyze dependencies and resolve types */
pub fn analyze_and_resolve_types(
    typedefs: &[TypeDef],
    verbose: bool,
) -> anyhow::Result<TypeResolver> {
    if verbose {
        println!("[~] Loaded {} type definitions", typedefs.len());
        for typedef in typedefs {
            println!("  - {}", typedef.name);
        }
        println!();
    }

    /* Perform dependency analysis */
    if verbose {
        println!("[~] Performing dependency analysis...");
    }
    let mut analyzer = DependencyAnalyzer::new();
    let analysis = analyzer.analyze_multiple_typedefs(typedefs);

    /* Check for errors */
    let has_errors = !analysis.cycles.is_empty()
        || !analysis.layout_violations.is_empty()
        || !analysis.validation_errors.is_empty();

    if verbose || has_errors {
        println!("\n[~] Dependency Analysis Results:");
        println!("==============================");

        if analysis.cycles.is_empty() {
            println!("[✓] No circular dependencies detected");
        } else {
            println!(
                "[✗] {} circular dependency cycle(s) detected:",
                analysis.cycles.len()
            );
            for cycle in &analysis.cycles {
                println!("  [~] Cycle: {}", cycle.cycle.join(" -> "));
            }
        }

        if analysis.layout_violations.is_empty() {
            println!("[✓] No layout constraint violations");
        } else {
            println!(
                "[✗] {} layout constraint violation(s):",
                analysis.layout_violations.len()
            );
            for violation in &analysis.layout_violations {
                println!("  [!] {}: {}", violation.violating_type, violation.reason);
                if !violation.dependency_chain.is_empty() {
                    println!("     Chain: {}", violation.dependency_chain.join(" -> "));
                }
            }
        }

        if analysis.validation_errors.is_empty() {
            println!("[✓] No validation errors");
        } else {
            println!(
                "[✗] {} validation error(s):",
                analysis.validation_errors.len()
            );
            for error in &analysis.validation_errors {
                println!(
                    "  [!] {} ({}): {}",
                    error.violating_type, error.error_type, error.reason
                );
            }
        }
    }

    if has_errors {
        anyhow::bail!("Analysis failed. Cannot proceed with type resolution.");
    }

    /* Perform type resolution */
    if verbose {
        println!("\n[!] Performing type resolution...");
    }
    let mut resolver = TypeResolver::new();

    for typedef in typedefs {
        resolver.add_typedef(typedef.clone());
    }

    resolver
        .resolve_all()
        .map_err(|e| anyhow::anyhow!("Type resolution failed: {:?}", e))?;

    if verbose {
        println!("[✓] Type resolution successful");
    }

    /* Validate alignment - for now, all types must have alignment of 1 */
    for typedef in typedefs {
        if let Some(resolved) = resolver.get_type_info(&typedef.name) {
            if resolved.alignment != 1 {
                anyhow::bail!(
                    "Type '{}' must have alignment of 1, but has alignment of {}",
                    resolved.name,
                    resolved.alignment
                );
            }
        }
    }

    Ok(resolver)
}

/// Validate prepared publication bytes using the same semantic machinery as
/// analysis and code generation. Callers retain and publish their original bytes.
pub fn validate_closed_abi(abi: &AbiFile) -> anyhow::Result<()> {
    if !abi.imports().is_empty() {
        anyhow::bail!("Prepared ABI must not contain imports");
    }
    let mut names = std::collections::BTreeSet::new();
    for ty in &abi.types {
        if !names.insert(&ty.name) {
            anyhow::bail!("Duplicate type declaration '{}'", ty.name);
        }
    }
    abi_loader::validate_root_types(abi)?;
    let resolver = analyze_and_resolve_types(&abi.types, false)?;
    crate::codegen::shared::builder::IrBuilder::new(&resolver)
        .build_all()
        .map_err(|error| anyhow::anyhow!("Invalid ABI layout: {:?}", error))?;
    Ok(())
}

/// Shared CLI publication boundary: preparation never fetches remote imports.
/// Closed outputs also pass the complete existing resolver/layout validation;
/// retained remote dependencies defer that validation until semantic resolution.
pub fn prepare_for_publish(
    file_path: &std::path::Path,
    include_dirs: &[std::path::PathBuf],
    target_network: &str,
    verbose: bool,
) -> anyhow::Result<String> {
    let yaml = abi_loader::prepare_for_publish(file_path, include_dirs, target_network, verbose)?;
    let prepared: AbiFile = serde_yml::from_str(&yaml)?;
    if prepared.imports().is_empty() {
        validate_closed_abi(&prepared)?;
    }
    Ok(yaml)
}

#[cfg(test)]
mod publication_tests {
    use super::*;

    fn abi(types: &str, roots: &str) -> AbiFile {
        serde_yml::from_str(&format!(
            "abi:\n  package: test.publication\n  abi-version: 1\n  package-version: 1.0.0\n  description: test\n  imports: []\n  options:\n    program-metadata:\n      root-types: {roots}\ntypes: {types}\n"
        )).unwrap()
    }

    #[test]
    fn publication_validates_all_declared_roots() {
        let types = "[{name: Root, kind: {primitive: u8}}]";
        for role in ["instruction-root", "account-root", "errors", "events"] {
            let missing = abi(types, &format!("{{{role}: Missing}}"));
            let error = validate_closed_abi(&missing).unwrap_err().to_string();
            assert!(error.contains(&format!("Unresolved declared {role} root 'Missing'")));
            validate_closed_abi(&abi(types, &format!("{{{role}: Root}}"))).unwrap();
        }
    }

    #[test]
    fn publication_rejects_duplicate_and_recursive_declarations() {
        let duplicate = abi(
            "[{name: Root, kind: {primitive: u8}}, {name: Root, kind: {primitive: u8}}]",
            "{instruction-root: Root}",
        );
        assert!(
            validate_closed_abi(&duplicate)
                .unwrap_err()
                .to_string()
                .contains("Duplicate type")
        );
        let recursive = abi(
            "[{name: Root, kind: {type-ref: {name: Root}}}]",
            "{instruction-root: Root}",
        );
        assert!(validate_closed_abi(&recursive).is_err());
    }
}
