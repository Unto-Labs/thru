use crate::abi::resolved::{ResolvedType, ResolvedTypeKind};
use crate::codegen::shared::ir::TypeIr;
use crate::codegen::ts_gen::{
    builder, emit_footprint_method, emit_from_array_method, emit_new_method, emit_type, runtime,
};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;
use std::sync::Arc;

pub fn emit_functions(resolved_type: &ResolvedType, type_ir: Option<&TypeIr>) -> String {
    let mut output = String::new();

    /* Emit methods inside the class */
    output.push_str(&emit_footprint_method(resolved_type, type_ir));
    output.push_str(&emit_new_method(resolved_type, type_ir));
    output.push_str(&emit_from_array_method(resolved_type, type_ir));

    output
}

pub struct TypeScriptCodeGenerator {
    options: TypeScriptCodeGeneratorOptions,
}

pub struct TypeScriptCodeGeneratorOptions {
    pub output_dir: String,
    pub emit_type_definitions: bool,
    pub emit_methods: bool,
    pub package_name: Option<String>,
    pub package_path: Option<String>,
    pub type_package_map: Option<Arc<HashMap<String, String>>>,
    pub package_path_map: Option<Arc<HashMap<String, String>>>,
}

impl Default for TypeScriptCodeGeneratorOptions {
    fn default() -> Self {
        Self {
            output_dir: ".".to_string(),
            emit_type_definitions: true,
            emit_methods: true,
            package_name: None,
            package_path: None,
            type_package_map: None,
            package_path_map: None,
        }
    }
}

impl TypeScriptCodeGenerator {
    pub fn new(options: TypeScriptCodeGeneratorOptions) -> Self {
        Self { options }
    }

    pub fn emit_code(
        self,
        resolved_types: &[(&ResolvedType, Option<TypeIr>)],
        all_types: Option<&[&ResolvedType]>,
    ) -> String {
        let mut output = String::new();
        output.push_str("/* Auto-generated TypeScript code */\n");
        output.push_str("/* WARNING: Do not modify this file directly. It is generated from ABI definitions. */\n\n");

        if let Some(imports) = self.emit_imports(resolved_types) {
            if !imports.is_empty() {
                output.push_str(&imports);
                output.push('\n');
            }
        }

        output.push_str(runtime::emit_runtime_helpers());
        output.push_str("\n");

        // Build type_lookup from all types (including imports) if available,
        // otherwise fall back to just the types in this package
        let mut type_lookup = BTreeMap::new();
        if let Some(all) = all_types {
            for resolved_type in all {
                type_lookup.insert(resolved_type.name.clone(), (*resolved_type).clone());
            }
        } else {
            for (resolved_type, _type_ir) in resolved_types {
                type_lookup.insert(resolved_type.name.clone(), (*resolved_type).clone());
            }
        }

        let mut builder_availability = BTreeMap::new();
        let mut builder_snippets = BTreeMap::new();
        for (resolved_type, type_ir) in resolved_types {
            if let Some(code) = builder::emit_builder(resolved_type, type_ir.as_ref()) {
                builder_availability.insert(resolved_type.name.clone(), true);
                builder_snippets.insert(resolved_type.name.clone(), code);
            } else {
                builder_availability.insert(resolved_type.name.clone(), false);
            }
        }

        /* Generate type definitions and methods for each resolved type */
        for (resolved_type, type_ir) in resolved_types {
            if self.options.emit_type_definitions {
                let has_builder = *builder_availability
                    .get(&resolved_type.name)
                    .unwrap_or(&false);
                let mut type_code = emit_type(
                    resolved_type,
                    type_ir.as_ref(),
                    has_builder,
                    &builder_availability,
                    &type_lookup,
                );

                if self.options.emit_methods {
                    let methods = emit_functions(resolved_type, type_ir.as_ref());
                    let namespace_marker = "\n}\n\nexport namespace";
                    let insert_pos = type_code
                        .rfind(namespace_marker)
                        .or_else(|| type_code.rfind('}'))
                        .unwrap_or(type_code.len());
                    type_code.insert_str(insert_pos, &methods);
                }

                output.push_str(&type_code);

                if let Some(builder_code) = builder_snippets.get(&resolved_type.name) {
                    output.push_str(builder_code);
                }
            }
        }

        /* Write to file */
        let types_path = format!("{}/types.ts", self.options.output_dir);
        if let Err(e) = fs::write(&types_path, &output) {
            eprintln!(
                "Warning: Failed to write TypeScript types to {}: {}",
                types_path, e
            );
        }

        output
    }

    fn emit_imports(&self, resolved_types: &[(&ResolvedType, Option<TypeIr>)]) -> Option<String> {
        let current_package = self.options.package_name.as_deref()?;
        let current_path = self.options.package_path.as_deref()?;
        let type_package = self.options.type_package_map.as_ref()?;
        let package_paths = self.options.package_path_map.as_ref()?;

        let mut dep_packages: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
        for (resolved_type, _) in resolved_types {
            collect_typeref_dependencies(resolved_type, &mut |type_name: &str| {
                if let Some(package) = type_package.get(type_name) {
                    if package != current_package {
                        dep_packages
                            .entry(package.clone())
                            .or_default()
                            .insert(type_name.to_string());
                    }
                }
            });
        }

        if dep_packages.is_empty() {
            return Some(String::new());
        }

        let mut imports = String::new();
        for (package, symbols) in dep_packages {
            if let Some(dep_path) = package_paths.get(&package) {
                let module_path = relative_module_path(current_path, dep_path);
                let module = format!("{}/types", module_path);
                let join_symbols = symbols.into_iter().collect::<Vec<_>>().join(", ");
                imports.push_str(&format!(
                    "import {{ {} }} from \"{}\";\n",
                    join_symbols, module
                ));
            }
        }

        Some(imports)
    }
}

fn collect_typeref_dependencies<F>(ty: &ResolvedType, visitor: &mut F)
where
    F: FnMut(&str),
{
    match &ty.kind {
        ResolvedTypeKind::Struct { fields, .. } => {
            for field in fields {
                collect_typeref_dependencies(&field.field_type, visitor);
            }
        }
        ResolvedTypeKind::Enum { variants, .. } => {
            for variant in variants {
                collect_typeref_dependencies(&variant.variant_type, visitor);
            }
        }
        ResolvedTypeKind::Union { variants } => {
            for variant in variants {
                collect_typeref_dependencies(&variant.field_type, visitor);
            }
        }
        ResolvedTypeKind::Array { element_type, .. } => {
            collect_typeref_dependencies(element_type, visitor);
        }
        ResolvedTypeKind::SizeDiscriminatedUnion { variants } => {
            for variant in variants {
                collect_typeref_dependencies(&variant.variant_type, visitor);
            }
        }
        ResolvedTypeKind::TypeRef { target_name, .. } => {
            visitor(target_name);
        }
        _ => {}
    }
}

fn relative_module_path(from: &str, to: &str) -> String {
    let from_parts: Vec<&str> = from.split('/').collect();
    let to_parts: Vec<&str> = to.split('/').collect();
    let mut common = 0;
    while common < from_parts.len()
        && common < to_parts.len()
        && from_parts[common] == to_parts[common]
    {
        common += 1;
    }
    let mut rel_parts = Vec::new();
    for _ in common..from_parts.len() {
        rel_parts.push("..");
    }
    rel_parts.extend_from_slice(&to_parts[common..]);
    if rel_parts.is_empty() {
        ".".to_string()
    } else {
        rel_parts.join("/")
    }
}
