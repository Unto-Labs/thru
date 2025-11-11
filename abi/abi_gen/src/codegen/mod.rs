pub mod c;
pub mod c_gen;
pub mod rust;
pub mod rust_gen;
pub mod ts;
pub mod ts_gen;

use crate::abi::resolved::{ResolvedType, TypeResolver};

pub const OUTPUT_DIR: &str = "generated"; // Change this to any directory you want

pub fn generate_all(resolver: &TypeResolver) -> Result<(), Box<dyn std::error::Error>> {
  println!("[*] Starting code generation...");
  std::fs::create_dir_all(OUTPUT_DIR)?;

  // Collect resolved types in resolution order
  let resolved_types: Vec<&ResolvedType> = resolver.resolution_order.iter().filter_map(|name| resolver.get_type_info(name)).collect();

  // Generate C code
  let c_options = c::CCodeGeneratorOptions {
    output_dir: OUTPUT_DIR.to_string(),
    emit_type_definitions: true,
    emit_functions: true,
    package: None,
    all_packages: Vec::new(),
    import_resolver: None,
  };
  let c_generator = c::CCodeGenerator::new(c_options);
  c_generator.emit_code(&resolved_types);
  println!("[✓] Generated C code: {}/types.h and {}/functions.c", OUTPUT_DIR, OUTPUT_DIR);

  // Generate Rust code
  // let rust_options = rust::RustCodeGeneratorOptions {
  //     output_dir: OUTPUT_DIR.to_string(),
  //     emit_type_definitions: true,
  //     emit_accessors: true,
  // };
  // let rust_generator = rust::RustCodeGenerator::new(rust_options);
  // let rust_code = rust_generator.emit_code(typedefs.to_vec());
  // std::fs::write(format!("{}/types.rs", OUTPUT_DIR), rust_code)?;
  // println!("[✓] Generated Rust code: {}/types.rs", OUTPUT_DIR);

  /* Generate TypeScript code */
  let ts_options = ts::TypeScriptCodeGeneratorOptions {
    output_dir: OUTPUT_DIR.to_string(),
    emit_type_definitions: true,
    emit_methods: true,
  };
  let ts_generator = ts::TypeScriptCodeGenerator::new(ts_options);
  ts_generator.emit_code(&resolved_types);
  println!("[✓] Generated TypeScript code: {}/types.ts", OUTPUT_DIR);

  println!("[✓] Code generation complete!");
  Ok(())
}
