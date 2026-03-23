/* Common utilities shared between analyze and codegen commands */

use crate::abi::file::ImportResolver;
use crate::abi::resolved::TypeResolver;
use crate::abi::types::TypeDef;
use crate::dependency::DependencyAnalyzer;

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
