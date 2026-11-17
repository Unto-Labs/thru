use crate::abi::resolved::{ResolvedType, ResolvedTypeKind, TypeResolver};
use crate::codegen::c_gen::emit::Emitter;
use crate::codegen::c_gen::ir_footprint::{
    contains_buffer_size_ref, format_ir_footprint_parameter_list, sanitize_symbol,
};
use crate::codegen::c_gen::ir_validate::IrValidateEmitter;
use crate::codegen::c_gen::model::Model;
use crate::codegen::c_gen::names::{NameTable, token};
use crate::codegen::c_gen::runtime::{HEADER_RUNTIME, SOURCE_RUNTIME};
use crate::codegen::shared::builder::IrBuilder;
use crate::codegen::shared::ir::{CallNestedNode, IrNode, TypeIr};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write;
use std::fs;

pub struct CCodeGenerator<'a> {
    options: CCodeGeneratorOptions<'a>,
    ir_builder: IrBuilder<'a>,
    resolver: &'a TypeResolver,
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
    pub fn new(resolver: &'a TypeResolver, options: CCodeGeneratorOptions<'a>) -> Self {
        Self {
            options,
            ir_builder: IrBuilder::new(resolver),
            resolver,
        }
    }

    /// Writes `types.h` and `functions.c` into the output directory and
    /// returns the header text.
    pub fn emit_code(self, resolved_types: &[&ResolvedType]) -> String {
        /* Every package builds the whole type set, so a type's params hold
        the values its importers read through it (see `Model::build_all`). */
        let mut model = Model::new(self.resolver);
        model.build_all();
        let ids: Vec<_> = resolved_types
            .iter()
            .map(|ty| model.named(&ty.name))
            .collect();

        /* File-scope names come from one table over the whole type set
        (see `names.rs`): emit everything with name tokens, allocate, then
        replace the tokens of this package's text. */
        let tok = model.tokenized();
        let prefixes: BTreeMap<String, String> = tok
            .named_ids()
            .map(|(name, id)| (name.to_string(), token(id)))
            .collect();
        let prefix = |name: &str| {
            prefixes
                .get(name)
                .cloned()
                .unwrap_or_else(|| sanitize_symbol(name))
        };
        let table = {
            let mut order: Vec<&str> = self
                .resolver
                .resolution_order
                .iter()
                .map(String::as_str)
                .collect();
            let mut rest: Vec<&str> = tok.named_ids().map(|(name, _)| name).collect();
            rest.sort();
            order.extend(rest);
            let mut all = Emitter::new(&tok);
            let mut all_types = Vec::new();
            let mut done = BTreeSet::new();
            for name in order {
                let (Some(id), Some(ty)) = (tok.named_id(name), self.resolver.get_type_info(name))
                else {
                    continue;
                };
                if done.insert(id) {
                    all.emit_named(id);
                    all_types.push(ty);
                }
            }
            let (protos, defs) = self.emit_all_ir_helpers(&all_types, &prefix);
            let text = [
                all.types,
                all.protos,
                all.static_protos,
                all.defs,
                all.asserts,
                protos,
                defs,
            ]
            .concat();
            NameTable::build(&model, &text, &[HEADER_RUNTIME, SOURCE_RUNTIME].concat())
        };
        let named = |text: &str| table.apply(&model, text);

        let mut emitter = Emitter::new(&tok);
        for id in &ids {
            emitter.emit_named(*id);
        }
        let (ir_protos, ir_defs) = self.emit_all_ir_helpers(resolved_types, &prefix);
        let types = named(&emitter.types);
        let protos = named(&emitter.protos);
        let static_protos = named(&emitter.static_protos);
        let defs = named(&emitter.defs);
        let asserts = named(&emitter.asserts);
        let ir_protos = named(&ir_protos);
        let ir_defs = named(&ir_defs);

        let mut header =
            String::from("#pragma once\n\n#include <stdint.h>\n#include <stddef.h>\n\n");

        /* Add includes for imported types from other packages */
        if let (Some(current_package), Some(import_resolver)) =
            (&self.options.package, &self.options.import_resolver)
        {
            let mut includes = BTreeSet::new();
            for resolved_type in resolved_types {
                self.collect_type_dependencies(
                    resolved_type,
                    &mut includes,
                    import_resolver,
                    current_package,
                );
            }
            for dep_package in &includes {
                if dep_package != current_package {
                    let relative_path =
                        self.get_relative_include_path(current_package, dep_package);
                    writeln!(header, "#include \"{}/types.h\"", relative_path).unwrap();
                }
            }
            if !includes.is_empty() {
                header.push('\n');
            }
        }

        header.push_str(HEADER_RUNTIME);
        if self.options.emit_type_definitions {
            header.push_str(&types);
        }
        if self.options.emit_functions {
            header.push_str("/* ----- FUNCTION PROTOTYPES ----- */\n\n");
            header.push_str(&protos);
            header.push_str(&ir_protos);
        }

        let types_path = format!("{}/types.h", self.options.output_dir);
        if let Err(e) = fs::write(&types_path, &header) {
            eprintln!("Warning: Failed to write types to {}: {}", types_path, e);
        }

        if self.options.emit_functions {
            let mut src = String::new();
            src.push_str("#include <stdint.h>\n#include <stddef.h>\n#include <string.h> /* memcpy, memset */\n#include \"types.h\"\n\n");
            src.push_str(SOURCE_RUNTIME);
            if !asserts.is_empty() {
                src.push_str("/* Native struct layouts match the ABI. */\n");
                src.push_str(&asserts);
                src.push('\n');
            }
            src.push_str("/* Internal helpers. */\n");
            src.push_str(&static_protos);
            src.push('\n');
            src.push_str(&defs);
            src.push_str(&ir_defs);
            let functions_path = format!("{}/functions.c", self.options.output_dir);
            if let Err(e) = fs::write(&functions_path, &src) {
                eprintln!(
                    "Warning: Failed to write functions to {}: {}",
                    functions_path, e
                );
            }
        }

        header
    }

    /// IR-backed helpers (`_validate_ir` / `_footprint_ir`, kept for IR
    /// parity) of the `types` that support them: (prototypes, definitions).
    fn emit_all_ir_helpers(
        &self,
        types: &[&ResolvedType],
        prefix: &dyn Fn(&str) -> String,
    ) -> (String, String) {
        let mut protos = String::new();
        let mut defs = String::new();
        let mut helper_support_cache = BTreeMap::new();
        for resolved_type in types {
            let Ok(type_ir) = self.ir_builder.build_type(resolved_type) else {
                continue;
            };
            if !static_ir_helpers_supported(
                &self.ir_builder,
                &type_ir.type_name,
                &mut helper_support_cache,
                &mut BTreeSet::new(),
            ) {
                continue;
            }
            if let Some((p, d)) = self.emit_ir_helpers(&type_ir, prefix) {
                protos.push_str(&p);
                defs.push_str(&d);
            }
        }
        (protos, defs)
    }

    /// `<T>_validate_ir` from the layout IR plus a checked `<T>_footprint_ir`
    /// wrapper (UINT64_MAX on overflow or invalid input). Only for types
    /// `static_ir_helpers_supported` accepts: no nested call takes `buf_sz`.
    fn emit_ir_helpers(
        &self,
        type_ir: &TypeIr,
        prefix: &dyn Fn(&str) -> String,
    ) -> Option<(String, String)> {
        let validate = IrValidateEmitter::new(type_ir)
            .with_prefix(prefix)
            .emit()
            .ok()?;
        let validate_sig = validate.split(" {").next()?.trim().to_string();

        let name = prefix(&type_ir.type_name);
        let fp_params = format_ir_footprint_parameter_list(type_ir);
        let mut args: Vec<String> = Vec::new();
        args.push(if contains_buffer_size_ref(&type_ir.root) {
            "buf_sz".to_string()
        } else {
            "UINT64_MAX".to_string()
        });
        args.push("&sz".to_string());
        for param in &type_ir.parameters {
            args.push(sanitize_symbol(&param.name.replace('.', "_")));
        }
        let fp_sig = format!("uint64_t {name}_footprint_ir( {fp_params} )");
        let mut defs = validate;
        writeln!(
            defs,
            "{fp_sig} {{\n  uint64_t sz = 0UL;\n  if( {name}_validate_ir( {} ) ) return UINT64_MAX;\n  return sz;\n}}\n",
            args.join(", ")
        )
        .unwrap();
        Some((format!("{validate_sig};\n{fp_sig};\n"), defs))
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
                    self.collect_from_resolved_type(
                        &field.field_type,
                        includes,
                        import_resolver,
                        current_package,
                    );
                }
            }
            ResolvedTypeKind::Union { variants } => {
                for variant in variants {
                    self.collect_from_resolved_type(
                        &variant.field_type,
                        includes,
                        import_resolver,
                        current_package,
                    );
                }
            }
            ResolvedTypeKind::Enum { variants, .. } => {
                for variant in variants {
                    self.collect_from_resolved_type(
                        &variant.variant_type,
                        includes,
                        import_resolver,
                        current_package,
                    );
                }
            }
            ResolvedTypeKind::Array { element_type, .. } => {
                self.collect_from_resolved_type(
                    element_type,
                    includes,
                    import_resolver,
                    current_package,
                );
            }
            ResolvedTypeKind::SizeDiscriminatedUnion { variants } => {
                for variant in variants {
                    self.collect_from_resolved_type(
                        &variant.variant_type,
                        includes,
                        import_resolver,
                        current_package,
                    );
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

    /* Relative path from the directory of the current package to that of a
    dependency (both allocated by `c_package_paths` over the run's packages). */
    fn get_relative_include_path(&self, from_package: &str, to_package: &str) -> String {
        let mut all = self.options.all_packages.clone();
        all.push(from_package.to_string());
        all.push(to_package.to_string());
        let paths = c_package_paths(&all);
        crate::codegen::shared::package_paths::relative_path(
            &paths[from_package],
            &paths[to_package],
        )
    }
}

/* Directories of the packages of one run (`a.b.c` -> `a/b/c`), by the rule
shared with the other backends (`shared::package_paths`): distinct packages
get distinct directories even on a case-insensitive file system
(`cases.Foo` -> `cases/Foo`, `cases.foo` -> `cases/foo_`). Segments keep
`[A-Za-z0-9_-]`; anything else becomes `_`. */
pub fn c_package_paths<'p>(
    packages: impl IntoIterator<Item = &'p String>,
) -> std::collections::BTreeMap<String, Vec<String>> {
    use crate::codegen::shared::package_paths::{PathRules, package_paths};
    fn segment(s: &str) -> String {
        let out: String = s
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                    c
                } else {
                    '_'
                }
            })
            .collect();
        if out.is_empty() { "_".to_string() } else { out }
    }
    package_paths(
        packages,
        &PathRules {
            segment,
            root_reserved: &[],
            child_reserved: &[],
        },
    )
}

fn static_ir_helpers_supported(
    ir_builder: &IrBuilder<'_>,
    type_name: &str,
    cache: &mut BTreeMap<String, bool>,
    visiting: &mut BTreeSet<String>,
) -> bool {
    if let Some(supported) = cache.get(type_name) {
        return *supported;
    }

    if !visiting.insert(type_name.to_string()) {
        cache.insert(type_name.to_string(), false);
        return false;
    }

    let supported = ir_builder
        .build_type_name(type_name)
        .map(|ir| {
            if ir.contains_sum_over_array() {
                return false;
            }

            /* A call must pass every parameter of the callee's helper (the IR
            of a union selects a variant through a parameter its callers do
            not supply), and the callee must not take the buffer size: the
            bytes left for a nested value are not an IR value (passing the
            caller's own buffer size gives wrong answers). Requiring the
            callee to be supported excludes such calls transitively. */
            let mut calls = Vec::new();
            call_nested_nodes(&ir.root, &mut calls);
            calls.into_iter().all(|call| {
                ir_builder
                    .build_type_name(&call.type_name)
                    .is_ok_and(|callee| {
                        callee.parameters.len() == call.arguments.len()
                            && !contains_buffer_size_ref(&callee.root)
                    })
                    && static_ir_helpers_supported(ir_builder, &call.type_name, cache, visiting)
            })
        })
        .unwrap_or(false);

    visiting.remove(type_name);
    cache.insert(type_name.to_string(), supported);
    supported
}

/// Every `CallNested` node in `node`, outermost first.
fn call_nested_nodes<'n>(node: &'n IrNode, out: &mut Vec<&'n CallNestedNode>) {
    match node {
        IrNode::ZeroSize { .. } | IrNode::Const(_) | IrNode::FieldRef(_) => {}
        IrNode::AlignUp(n) => call_nested_nodes(&n.node, out),
        IrNode::Switch(n) => {
            for case in &n.cases {
                call_nested_nodes(&case.node, out);
            }
            if let Some(default) = &n.default {
                call_nested_nodes(default, out);
            }
        }
        IrNode::CallNested(n) => out.push(n),
        IrNode::AddChecked(n)
        | IrNode::SubChecked(n)
        | IrNode::MulChecked(n)
        | IrNode::DivChecked(n)
        | IrNode::ModChecked(n)
        | IrNode::BitAnd(n)
        | IrNode::BitOr(n)
        | IrNode::BitXor(n)
        | IrNode::LeftShift(n)
        | IrNode::RightShift(n) => {
            call_nested_nodes(&n.left, out);
            call_nested_nodes(&n.right, out);
        }
        /* Jagged arrays are rejected before calls are checked. */
        IrNode::SumOverArray(n) => call_nested_nodes(&n.count, out),
    }
}
