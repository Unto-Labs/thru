use crate::abi::resolved::ResolvedType;
use crate::codegen::ts_gen::{emit_type, emit_footprint_method, emit_new_method, emit_from_array_method};
use std::fs;

pub fn emit_functions(resolved_type: &ResolvedType) -> String {
  let mut output = String::new();

  /* Emit methods inside the class */
  output.push_str(&emit_footprint_method(resolved_type));
  output.push_str(&emit_new_method(resolved_type));
  output.push_str(&emit_from_array_method(resolved_type));

  output
}

pub struct TypeScriptCodeGenerator {
  options: TypeScriptCodeGeneratorOptions,
}

pub struct TypeScriptCodeGeneratorOptions {
  pub output_dir: String,
  pub emit_type_definitions: bool,
  pub emit_methods: bool,
}

impl Default for TypeScriptCodeGeneratorOptions {
  fn default() -> Self {
    Self {
      output_dir: ".".to_string(),
      emit_type_definitions: true,
      emit_methods: true,
    }
  }
}

impl TypeScriptCodeGenerator {
  pub fn new(options: TypeScriptCodeGeneratorOptions) -> Self {
    Self { options }
  }

  pub fn emit_code(self, resolved_types: &[&ResolvedType]) -> String {
    let mut output = String::new();
    output.push_str("/* Auto-generated TypeScript code */\n");
    output.push_str("/* WARNING: Do not modify this file directly. It is generated from ABI definitions. */\n\n");

    /* Generate type definitions and methods for each resolved type */
    for resolved_type in resolved_types {
      if self.options.emit_type_definitions {
        /* Emit the class definition (includes nested types) */
        let type_code = emit_type(resolved_type);

        /* Insert methods into the class before the closing brace */
        if self.options.emit_methods {
          let methods = emit_functions(resolved_type);

          /* Find the last closing brace and insert methods before it */
          if let Some(last_brace_pos) = type_code.rfind('}') {
            let (before, after) = type_code.split_at(last_brace_pos);
            output.push_str(before);
            output.push_str(&methods);
            output.push_str(after);
          } else {
            /* No class definition found, just append type code */
            output.push_str(&type_code);
          }
        } else {
          output.push_str(&type_code);
        }
      }
    }

    /* Write to file */
    let types_path = format!("{}/types.ts", self.options.output_dir);
    if let Err(e) = fs::write(&types_path, &output) {
      eprintln!("Warning: Failed to write TypeScript types to {}: {}", types_path, e);
    }

    output
  }
}
