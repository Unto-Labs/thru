use crate::abi::resolved::{ResolvedType, ResolvedTypeKind};
use crate::codegen::c_gen::{
  emit_type, emit_opaque_functions,
  emit_forward_declarations
};
use std::fs;

pub fn emit_functions(resolved_type: &ResolvedType) -> String {
  let mut output = format!("/*  ----- FUNCTIONS FOR {} ----- */\n\n", resolved_type.name);

  /* Use opaque wrapper functions for structs */
  match &resolved_type.kind {
    ResolvedTypeKind::Struct { .. } => {
      output.push_str(&emit_opaque_functions(resolved_type));
    }
    _ => {
      /* For non-struct types, would use old approach if needed */
    }
  }

  output
}

pub struct CCodeGenerator<'a> {
  options: CCodeGeneratorOptions<'a>,
}

pub struct CCodeGeneratorOptions<'a> {
  pub output_dir: String,
  pub emit_type_definitions: bool,
  pub emit_functions: bool,
  pub package: Option<String>,
  pub all_packages: Vec<String>,
  pub import_resolver: Option<&'a crate::abi::file::ImportResolver>,
}

impl<'a> Default for CCodeGeneratorOptions<'a> {
  fn default() -> Self {
    Self {
      output_dir: ".".to_string(), // Default to current directory, should be overridden
      emit_type_definitions: true,
      emit_functions: true,
      package: None,
      all_packages: Vec::new(),
      import_resolver: None,
    }
  }
}

impl<'a> CCodeGenerator<'a> {
  pub fn new(options: CCodeGeneratorOptions<'a>) -> Self {
    Self { options }
  }

  pub fn emit_code(self, resolved_types: &[&ResolvedType]) -> String {
    let mut types_output = String::new();
    let mut functions_output = String::new();
    let mut forward_decls = String::new();

    // Generate types, forward declarations, and functions for each resolved type
    for resolved_type in resolved_types {
      if self.options.emit_type_definitions {
        types_output.push_str(&emit_type(resolved_type));
      }
      if self.options.emit_functions {
        forward_decls.push_str(&emit_forward_declarations(resolved_type));
        functions_output.push_str(&emit_functions(resolved_type));
      }
    }

    // Prepare header output with pragma once, includes, and forward declarations
    if !types_output.is_empty() || !forward_decls.is_empty() {
      let mut header_output = String::from("#pragma once\n\n");
      header_output.push_str("#include <stdint.h>\n");
      header_output.push_str("#include <stddef.h>\n\n");

      /* Add includes for imported types from other packages */
      if let (Some(current_package), Some(import_resolver)) = (&self.options.package, &self.options.import_resolver) {
        let mut includes = std::collections::BTreeSet::new();

        /* Find all type references and determine which packages they belong to */
        for resolved_type in resolved_types {
          self.collect_type_dependencies(resolved_type, &mut includes, import_resolver, current_package);
        }

        /* Generate relative includes */
        for dep_package in &includes {
          if dep_package != current_package {
            let relative_path = self.get_relative_include_path(current_package, dep_package);
            header_output.push_str(&format!("#include \"{}/types.h\"\n", relative_path));
          }
        }

        if !includes.is_empty() {
          header_output.push_str("\n");
        }
      }

      header_output.push_str(&types_output);
      if !forward_decls.is_empty() {
        header_output.push_str(&forward_decls);
      }
      types_output = header_output;
    }

    // Write types to file if any were generated
    if !types_output.is_empty() {
      let types_path = format!("{}/types.h", self.options.output_dir);
      if let Err(e) = fs::write(&types_path, &types_output) {
        eprintln!("Warning: Failed to write types to {}: {}", types_path, e);
      }
    }

    // Write functions to file if any were generated
    if !functions_output.is_empty() {
      // Add necessary includes at the top
      let mut complete_functions = String::new();
      complete_functions.push_str("#include <stdint.h> /* for uint8_t, int64_t, etc. */\n");
      complete_functions.push_str("#include <stddef.h> /* for offsetof */\n");
      complete_functions.push_str("#include <stdlib.h> /* for malloc */\n");
      complete_functions.push_str("#include <string.h> /* for memcpy */\n");
      complete_functions.push_str("#include <assert.h> /* for assert */\n");
      complete_functions.push_str("#include \"types.h\" /* for type definitions */\n\n");

      complete_functions.push_str("/* Safe arithmetic helpers for validation */\n");
      complete_functions.push_str("static inline int safe_mul_u64( uint64_t a, uint64_t b, uint64_t * out ) {\n");
      complete_functions.push_str("  if( a && b > UINT64_MAX / a ) return 1;\n");
      complete_functions.push_str("  *out = a * b;\n");
      complete_functions.push_str("  return 0;\n");
      complete_functions.push_str("}\n\n");
      complete_functions.push_str("static inline int safe_add_u64( uint64_t a, uint64_t b, uint64_t * out ) {\n");
      complete_functions.push_str("  if( a > UINT64_MAX - b ) return 1;\n");
      complete_functions.push_str("  *out = a + b;\n");
      complete_functions.push_str("  return 0;\n");
      complete_functions.push_str("}\n\n");
      complete_functions.push_str(&functions_output);

      let functions_path = format!("{}/functions.c", self.options.output_dir);
      if let Err(e) = fs::write(&functions_path, &complete_functions) {
        eprintln!("Warning: Failed to write functions to {}: {}", functions_path, e);
      }
    }

    types_output
  }

  /* Collect all type dependencies from a resolved type */
  fn collect_type_dependencies(
    &self,
    resolved_type: &ResolvedType,
    includes: &mut std::collections::BTreeSet<String>,
    import_resolver: &crate::abi::file::ImportResolver,
    current_package: &str,
  ) {
    use crate::abi::resolved::ResolvedTypeKind;

    match &resolved_type.kind {
      ResolvedTypeKind::Struct { fields, .. } => {
        for field in fields {
          self.collect_from_resolved_type(&field.field_type, includes, import_resolver, current_package);
        }
      }
      ResolvedTypeKind::Union { variants } => {
        for variant in variants {
          self.collect_from_resolved_type(&variant.field_type, includes, import_resolver, current_package);
        }
      }
      ResolvedTypeKind::Enum { variants, .. } => {
        for variant in variants {
          self.collect_from_resolved_type(&variant.variant_type, includes, import_resolver, current_package);
        }
      }
      ResolvedTypeKind::Array { element_type, .. } => {
        self.collect_from_resolved_type(element_type, includes, import_resolver, current_package);
      }
      ResolvedTypeKind::SizeDiscriminatedUnion { variants } => {
        for variant in variants {
          self.collect_from_resolved_type(&variant.variant_type, includes, import_resolver, current_package);
        }
      }
      ResolvedTypeKind::TypeRef { target_name, .. } => {
        if let Some(package) = import_resolver.get_package_for_type(target_name) {
          if package != current_package {
            includes.insert(package);
          }
        }
      }
      ResolvedTypeKind::Primitive { .. } => {}
    }
  }

  /* Helper to recursively collect from a resolved type */
  fn collect_from_resolved_type(
    &self,
    resolved_type: &crate::abi::resolved::ResolvedType,
    includes: &mut std::collections::BTreeSet<String>,
    import_resolver: &crate::abi::file::ImportResolver,
    current_package: &str,
  ) {
    self.collect_type_dependencies(resolved_type, includes, import_resolver, current_package);
  }

  /* Calculate relative path from current package to dependency package */
  fn get_relative_include_path(&self, from_package: &str, to_package: &str) -> String {
    let from_parts: Vec<&str> = from_package.split('.').collect();
    let to_parts: Vec<&str> = to_package.split('.').collect();

    /* Find common prefix */
    let mut common_len = 0;
    for (i, (f, t)) in from_parts.iter().zip(to_parts.iter()).enumerate() {
      if f == t {
        common_len = i + 1;
      } else {
        break;
      }
    }

    /* Build relative path */
    let mut path_parts = Vec::new();

    /* Go up directories for non-common parts of from_package */
    for _ in common_len..from_parts.len() {
      path_parts.push("..");
    }

    /* Add the unique parts of to_package */
    for part in &to_parts[common_len..] {
      path_parts.push(*part);
    }

    path_parts.join("/")
  }
}
