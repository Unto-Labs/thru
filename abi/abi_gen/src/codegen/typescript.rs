use crate::abi::types::TypeDef;

pub struct TypeScriptCodeGenerator {
  options: TypeScriptCodeGeneratorOptions,
}

pub struct TypeScriptCodeGeneratorOptions {
  output_dir: String,
  emit_interfaces: bool,
  emit_type_guards: bool,
}

impl Default for TypeScriptCodeGeneratorOptions {
  fn default() -> Self {
    Self {
      output_dir: ".".to_string(),
      emit_interfaces: true,
      emit_type_guards: true,
    }
  }
}

impl TypeScriptCodeGenerator {
  pub fn new(options: TypeScriptCodeGeneratorOptions) -> Self {
    Self { options }
  }

  pub fn emit_code(self, type_defs: Vec<TypeDef>) -> String {
    let mut output = String::new();
    output.push_str("// Auto-generated TypeScript code\n\n");

    for type_def in type_defs {
      // TODO: Implement TypeScript code generation logic
      output.push_str(&format!("// TODO: Format type {}\n", type_def.name));
      unimplemented!()
    }

    output
  }
}