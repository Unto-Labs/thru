/* Analyze command - detailed type analysis and reporting */

use crate::abi::file::ImportResolver;
use crate::abi::resolved::{ResolvedTypeKind, TypeResolver};
use crate::abi::types::{PrimitiveType, TypeDef};
use super::common::{analyze_and_resolve_types, normalize_type_refs};
use std::collections::HashMap;
use std::path::PathBuf;

/* Execute the analyze command */
pub fn run(files: Vec<PathBuf>, include_dirs: Vec<PathBuf>) -> anyhow::Result<()> {
  println!("ABI Generator - Type Analysis Tool");
  println!("=================================\n");

  /* Use ImportResolver to load files with their imports */
  let mut resolver = ImportResolver::new(include_dirs.clone());

  println!("[~] Loading ABI files and resolving imports...");
  if !include_dirs.is_empty() {
    println!("    Include directories:");
    for dir in &include_dirs {
      println!("      - {}", dir.display());
    }
  }
  println!();

  for file in &files {
    resolver.load_file_with_imports(file, true)?;
  }

  println!("\n[~] Loaded {} file(s) total (including imports)", resolver.loaded_file_count());
  println!("[~] Packages loaded:");
  for package in resolver.get_packages() {
    println!("    - {}", package);
  }

  /* Get all types and normalize FQDN references */
  let mut all_typedefs = resolver.get_all_types().to_vec();
  normalize_type_refs(&mut all_typedefs, &resolver);

  let all_typedefs = all_typedefs;

  println!("[~] Loaded {} type definitions from {} file(s)", all_typedefs.len(), files.len());
  for typedef in &all_typedefs {
    println!("  - {}", typedef.name);
  }
  println!();

  /* Analyze and resolve types with verbose output */
  let type_resolver = analyze_and_resolve_types(&all_typedefs, true)?;

  /* Print detailed type analysis */
  print_detailed_type_analysis(&all_typedefs, &type_resolver);

  Ok(())
}

/* Recursively print variable size references with proper indentation */
fn print_variable_references(
  references: &HashMap<String, HashMap<String, PrimitiveType>>,
  indent_level: usize,
  resolver: &TypeResolver,
  current_type: &crate::abi::resolved::ResolvedType,
) {
  let indent = "   ".repeat(indent_level);

  for (field_or_variant, field_refs) in references {
    println!("{}[{}]:", indent, field_or_variant);

    /* Print the direct references for this field/variant */
    for (ref_path, prim_type) in field_refs {
      println!("{}  {} -> {:?}", indent, ref_path, prim_type);
    }

    /* Now look for nested variable references by examining the actual field/variant type */
    match &current_type.kind {
      ResolvedTypeKind::Struct { fields, .. } => {
        /* Find the field with matching name */
        for field in fields {
          if field.name == *field_or_variant {
            /* Check if this field's type has variable references */
            if let crate::abi::resolved::Size::Variable(nested_refs) = &field.field_type.size {
              println!("{}  Nested in field '{}':", indent, field.name);
              print_variable_references(nested_refs, indent_level + 2, resolver, &field.field_type);
            }
            /* Also check if it's a TypeRef and resolve it */
            if let ResolvedTypeKind::TypeRef { target_name, .. } = &field.field_type.kind {
              if let Some(resolved_target) = resolver.get_type_info(target_name) {
                if let crate::abi::resolved::Size::Variable(nested_refs) = &resolved_target.size {
                  println!("{}  Nested in type-ref '{}':", indent, target_name);
                  print_variable_references(nested_refs, indent_level + 2, resolver, resolved_target);
                }
              }
            }
          }
        }
      }
      ResolvedTypeKind::Enum { variants, .. } => {
        /* Find the variant with matching name */
        for variant in variants {
          if variant.name == *field_or_variant {
            /* Check if this variant's type has variable references */
            if let crate::abi::resolved::Size::Variable(nested_refs) = &variant.variant_type.size {
              println!("{}  Nested in variant '{}':", indent, variant.name);
              print_variable_references(nested_refs, indent_level + 2, resolver, &variant.variant_type);
            }
            /* Also check if it's a TypeRef and resolve it */
            if let ResolvedTypeKind::TypeRef { target_name, .. } = &variant.variant_type.kind {
              if let Some(resolved_target) = resolver.get_type_info(target_name) {
                if let crate::abi::resolved::Size::Variable(nested_refs) = &resolved_target.size {
                  println!("{}  Nested in type-ref '{}':", indent, target_name);
                  print_variable_references(nested_refs, indent_level + 2, resolver, resolved_target);
                }
              }
            }
          }
        }
      }
      ResolvedTypeKind::Union { variants } => {
        /* Find the variant with matching name */
        for variant in variants {
          if variant.name == *field_or_variant {
            /* Check if this variant's type has variable references */
            if let crate::abi::resolved::Size::Variable(nested_refs) = &variant.field_type.size {
              println!("{}  Nested in union variant '{}':", indent, variant.name);
              print_variable_references(nested_refs, indent_level + 2, resolver, &variant.field_type);
            }
          }
        }
      }
      ResolvedTypeKind::SizeDiscriminatedUnion { variants } => {
        /* Find the variant with matching name */
        for variant in variants {
          if variant.name == *field_or_variant {
            /* Check if this variant's type has variable references */
            if let crate::abi::resolved::Size::Variable(nested_refs) = &variant.variant_type.size {
              println!("{}  Nested in size-discriminated variant '{}':", indent, variant.name);
              print_variable_references(nested_refs, indent_level + 2, resolver, &variant.variant_type);
            }
          }
        }
      }
      _ => {
        /* For other types, just continue */
      }
    }
  }
}

fn print_detailed_type_analysis(typedefs: &[TypeDef], resolver: &TypeResolver) {
  println!("\n[~] Resolved Type Information:");
  println!("============================");

  for typedef in typedefs {
    if let Some(resolved) = resolver.get_type_info(&typedef.name) {
      println!("\n[*] Type: {}", resolved.name);
      let size_str = match &resolved.size {
        crate::abi::resolved::Size::Const(size) => {
          format!("{} bytes", size)
        }
        crate::abi::resolved::Size::Variable(_) => "Variable".to_string(),
      };
      println!("   Size: {}", size_str);
      println!("   Alignment: {} bytes", resolved.alignment);

      match &resolved.kind {
        ResolvedTypeKind::Primitive { prim_type } => {
          println!("   Kind: Primitive({:?})", prim_type);
        }
        ResolvedTypeKind::Struct { fields, packed, custom_alignment } => {
          println!("   Kind: Struct");
          println!("   Packed: {}", packed);
          if let Some(align) = custom_alignment {
            println!("   Custom Alignment: {}", align);
          }
          println!("   Fields:");
          for field in fields {
            let offset_str = field.offset.map(|o| format!("@{}", o)).unwrap_or("Variable".to_string());
            println!(
              "     - {} ({}): size={:?}, align={}",
              field.name,
              offset_str,
              match &field.field_type.size {
                crate::abi::resolved::Size::Const(s) => s.to_string(),
                crate::abi::resolved::Size::Variable(_) => "Variable".to_string(),
              },
              field.field_type.alignment
            );
          }
        }
        ResolvedTypeKind::Union { variants } => {
          println!("   Kind: Union");
          println!("   Variants:");
          for variant in variants {
            println!(
              "     - {}: size={:?}, align={}",
              variant.name,
              match &variant.field_type.size {
                crate::abi::resolved::Size::Const(s) => s.to_string(),
                crate::abi::resolved::Size::Variable(_) => "Variable".to_string(),
              },
              variant.field_type.alignment
            );
          }
        }
        ResolvedTypeKind::Enum { tag_expression, tag_constant_status, variants } => {
          println!("   Kind: Enum");
          println!("   Tag Expression: {:?}", tag_expression);
          println!("   Tag Status: {:?}", tag_constant_status);
          println!("   Variants:");
          for variant in variants {
            println!(
              "     - {} (tag={}): size={:?}, align={}",
              variant.name,
              variant.tag_value,
              match &variant.variant_type.size {
                crate::abi::resolved::Size::Const(s) => s.to_string(),
                crate::abi::resolved::Size::Variable(_) => "Variable".to_string(),
              },
              variant.variant_type.alignment
            );
          }
        }
        ResolvedTypeKind::Array { element_type, size_expression, size_constant_status } => {
          println!("   Kind: Array");
          println!(
            "   Element Type: size={:?}, align={}",
            match &element_type.size {
              crate::abi::resolved::Size::Const(s) => s.to_string(),
              crate::abi::resolved::Size::Variable(_) => "Variable".to_string(),
            },
            element_type.alignment
          );
          println!("   Size Expression: {:?}", size_expression);
          println!("   Size Status: {:?}", size_constant_status);
        }
        ResolvedTypeKind::SizeDiscriminatedUnion { variants } => {
          println!("   Kind: SizeDiscriminatedUnion");
          println!("   Variants:");
          for variant in variants {
            println!(
              "     - {} (expected_size={}): size={:?}, align={}",
              variant.name,
              variant.expected_size,
              match &variant.variant_type.size {
                crate::abi::resolved::Size::Const(s) => s.to_string(),
                crate::abi::resolved::Size::Variable(_) => "Variable".to_string(),
              },
              variant.variant_type.alignment
            );
          }
        }
        ResolvedTypeKind::TypeRef { target_name, resolved: is_resolved } => {
          println!("   Kind: TypeRef -> {}", target_name);
          println!("   Resolved: {}", is_resolved);
        }
      }

      if let crate::abi::resolved::Size::Variable(variable_map) = &resolved.size {
        println!("   Variable Size References:");
        print_variable_references(variable_map, 2, resolver, resolved);
      }
    } else {
      println!("\n[✗] Type '{}' could not be resolved", typedef.name);
    }
  }
  println!("\n[✓] Analysis complete!");
}
