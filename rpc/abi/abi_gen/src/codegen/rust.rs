use crate::abi::resolved::{ResolvedType, ResolvedTypeKind, TypeResolver};
use crate::codegen::rust_gen::emit::Emitter;
use crate::codegen::rust_gen::emit_builder::emit_builders;
use crate::codegen::rust_gen::model::{Model, prim_rust};
use crate::codegen::rust_gen::{emit_ir_footprint_fn_named, emit_ir_validate_fn_named};
use crate::codegen::shared::builder::IrBuilder;
use crate::codegen::shared::ir::{CallNestedNode, IrNode};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;

/* Runtime shared by all generated packages (views, walkers, errors). */
pub const RUNTIME_MODULE_CONTENT: &str = include_str!("rust_gen/runtime_template.rs");

/* Name of the shared runtime module written at the output root by `abi codegen`. */
pub const SHARED_RUNTIME_MODULE: &str = "tn_abi_runtime";

/* Public function to get the runtime module content for testing */
pub fn get_runtime_module_content() -> &'static str {
    RUNTIME_MODULE_CONTENT
}

const FILE_HEADER: &str = "#![allow(dead_code, non_camel_case_types, non_snake_case, unused_imports, unused_mut, unused_variables, unused_parens, clippy::all)]\n";

pub struct RustCodeGenerator<'a> {
    options: RustCodeGeneratorOptions<'a>,
    resolver: &'a TypeResolver,
    ir_builder: IrBuilder<'a>,
}

pub struct RustCodeGeneratorOptions<'a> {
    pub output_dir: String,
    pub emit_type_definitions: bool,
    pub emit_accessors: bool,
    pub package: Option<String>,
    pub all_packages: Vec<String>,
    pub import_resolver: Option<&'a crate::abi::file::ImportResolver>,
}

impl<'a> Default for RustCodeGeneratorOptions<'a> {
    fn default() -> Self {
        Self {
            output_dir: ".".to_string(),
            emit_type_definitions: true,
            emit_accessors: true,
            package: None,
            all_packages: Vec::new(),
            import_resolver: None,
        }
    }
}

impl<'a> RustCodeGenerator<'a> {
    pub fn new(resolver: &'a TypeResolver, options: RustCodeGeneratorOptions<'a>) -> Self {
        Self {
            options,
            resolver,
            ir_builder: IrBuilder::new(resolver),
        }
    }

    pub fn emit_code(self, resolved_types: &[&ResolvedType]) -> String {
        let mut types_output = String::from(FILE_HEADER);
        let mut functions_output = String::new();

        /* Add use statements for dependencies */
        if let (Some(current_package), Some(import_resolver)) =
            (&self.options.package, &self.options.import_resolver)
        {
            let mut dependencies = std::collections::BTreeSet::new();

            for resolved_type in resolved_types {
                self.collect_type_dependencies(
                    resolved_type,
                    &mut dependencies,
                    import_resolver,
                    current_package,
                );
            }

            for dep_package in &dependencies {
                if dep_package != current_package {
                    let use_path = self.get_rust_use_path(current_package, dep_package);
                    types_output.push_str(&format!("pub use {}::*;\n", use_path));
                }
            }

            if !dependencies.is_empty() {
                types_output.push('\n');
            }
        }

        let model = Model::new(self.resolver);
        /* Each package names its items from its own table (`rust_gen/names.rs`). */
        let mut pkg_of = HashMap::new();
        if let Some(import_resolver) = &self.options.import_resolver {
            for name in self.resolver.types.keys() {
                if let Some(package) = import_resolver.get_package_for_type(name) {
                    pkg_of.insert(name.clone(), package);
                }
            }
        }
        let current = self
            .options
            .package
            .clone()
            .filter(|_| self.options.import_resolver.is_some());
        let emitter = Emitter::new(&model).with_packages(pkg_of, current);
        let ir_names = |type_name: &str| (*emitter.ir_names(type_name)).clone();
        let mut helper_support_cache = BTreeMap::new();

        for resolved_type in resolved_types {
            match &resolved_type.kind {
                ResolvedTypeKind::Primitive { prim_type } => {
                    types_output.push_str(&format!(
                        "/* Type: {} */\npub type {} = {};\n\n",
                        resolved_type.name,
                        emitter.nm(&resolved_type.name).ty,
                        prim_rust(prim_type)
                    ));
                }
                ResolvedTypeKind::TypeRef { target_name, .. } => {
                    emit_alias(&emitter, resolved_type, target_name, &mut types_output);
                }
                _ => {
                    model.collect_named(&resolved_type.name);
                    for cell in model.views_of_root(&resolved_type.name) {
                        let name = cell.borrow().name.clone();
                        let Some(info) = emitter.info(&name) else {
                            continue;
                        };
                        emitter.emit_view_types(&info, &mut types_output);
                        if self.options.emit_accessors {
                            emitter.emit_view_functions(&info, &mut functions_output);
                            functions_output.push_str(&emit_builders(&emitter, &info));
                        }
                    }
                }
            }

            if !self.options.emit_accessors {
                continue;
            }
            /* IR-derived helpers (`<type>_footprint_ir`, `<type>_validate_ir`). */
            if let Ok(ir) = self.ir_builder.build_type(resolved_type) {
                if static_ir_helpers_supported(
                    &self.ir_builder,
                    &ir.type_name,
                    &mut helper_support_cache,
                    &mut BTreeSet::new(),
                ) && !calls_buffer_sized(&self.ir_builder, &ir.root, 0)
                {
                    if let Ok(code) = emit_ir_footprint_fn_named(&ir, &ir_names) {
                        functions_output.push_str(&code);
                    }
                    if let Ok(code) = emit_ir_validate_fn_named(&ir, &ir_names) {
                        functions_output.push_str(&code);
                    }
                }
            }
        }

        let types_path = format!("{}/types.rs", self.options.output_dir);
        if let Err(e) = fs::write(&types_path, &types_output) {
            eprintln!("Warning: Failed to write types to {}: {}", types_path, e);
        }

        /* Packages share one runtime at the output root; standalone output gets a copy. */
        let runtime_path = format!("{}/runtime.rs", self.options.output_dir);
        let runtime_content = match &self.options.package {
            Some(package) => {
                let depth = package.split('.').count() + 1;
                format!(
                    "/* Generated ABI runtime re-export - DO NOT EDIT */\npub use {}{}::*;\n",
                    "super::".repeat(depth),
                    SHARED_RUNTIME_MODULE
                )
            }
            None => RUNTIME_MODULE_CONTENT.to_string(),
        };
        if let Err(e) = fs::write(&runtime_path, runtime_content) {
            eprintln!(
                "Warning: Failed to write runtime to {}: {}",
                runtime_path, e
            );
        }

        let mut complete_functions = String::from(FILE_HEADER);
        /* Std items are spelled by absolute path (and `alloc` under a private
         * name) so ABI types named `Result`, `Vec`, `alloc`, ... cannot shadow them. */
        complete_functions.push_str("extern crate alloc as __tn_alloc;\n");
        complete_functions.push_str("use super::types::*;\n");
        complete_functions.push_str("use super::runtime::*;\n\n");
        complete_functions.push_str(&functions_output);
        let functions_path = format!("{}/functions.rs", self.options.output_dir);
        if let Err(e) = fs::write(&functions_path, &complete_functions) {
            eprintln!(
                "Warning: Failed to write functions to {}: {}",
                functions_path, e
            );
        }

        types_output
    }

    /* Collect all type dependencies from a resolved type */
    fn collect_type_dependencies(
        &self,
        resolved_type: &ResolvedType,
        dependencies: &mut std::collections::BTreeSet<String>,
        import_resolver: &crate::abi::file::ImportResolver,
        current_package: &str,
    ) {
        match &resolved_type.kind {
            ResolvedTypeKind::Struct { fields, .. } => {
                for field in fields {
                    self.collect_from_resolved_type(
                        &field.field_type,
                        dependencies,
                        import_resolver,
                        current_package,
                    );
                }
            }
            ResolvedTypeKind::Union { variants } => {
                for variant in variants {
                    self.collect_from_resolved_type(
                        &variant.field_type,
                        dependencies,
                        import_resolver,
                        current_package,
                    );
                }
            }
            ResolvedTypeKind::Enum { variants, .. } => {
                for variant in variants {
                    self.collect_from_resolved_type(
                        &variant.variant_type,
                        dependencies,
                        import_resolver,
                        current_package,
                    );
                }
            }
            ResolvedTypeKind::Array { element_type, .. } => {
                self.collect_from_resolved_type(
                    element_type,
                    dependencies,
                    import_resolver,
                    current_package,
                );
            }
            ResolvedTypeKind::SizeDiscriminatedUnion { variants } => {
                for variant in variants {
                    self.collect_from_resolved_type(
                        &variant.variant_type,
                        dependencies,
                        import_resolver,
                        current_package,
                    );
                }
            }
            ResolvedTypeKind::TypeRef { target_name, .. } => {
                if let Some(package) = import_resolver.get_package_for_type(target_name) {
                    if package != current_package {
                        dependencies.insert(package);
                    }
                }
            }
            ResolvedTypeKind::Primitive { .. } => {}
        }
    }

    /* Helper to recursively collect from a resolved type */
    fn collect_from_resolved_type(
        &self,
        resolved_type: &ResolvedType,
        dependencies: &mut std::collections::BTreeSet<String>,
        import_resolver: &crate::abi::file::ImportResolver,
        current_package: &str,
    ) {
        self.collect_type_dependencies(
            resolved_type,
            dependencies,
            import_resolver,
            current_package,
        );
    }

    /* Calculate Rust use path from current package to dependency package */
    fn get_rust_use_path(&self, from_package: &str, to_package: &str) -> String {
        crate::codegen::rust_gen::names::rust_use_path(
            &self.options.all_packages,
            from_package,
            to_package,
        )
    }
}

pub fn static_ir_helpers_supported(
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
            of a union with variable-size variants selects one through a
            parameter its callers do not supply), as in the C backend. */
            let mut calls = Vec::new();
            call_nested_nodes(&ir.root, &mut calls);
            calls.into_iter().all(|call| {
                ir_builder
                    .build_type_name(&call.type_name)
                    .is_ok_and(|callee| callee.parameters.len() == call.arguments.len())
                    && static_ir_helpers_supported(ir_builder, &call.type_name, cache, visiting)
            })
        })
        .unwrap_or(false);

    visiting.remove(type_name);
    cache.insert(type_name.to_string(), supported);
    supported
}

/* Does `node` call (directly or through other calls) a helper that takes the
buffer size? Its caller cannot pass one: the bytes left for a nested value are
not an IR value. Such a type gets no IR helpers (the callee keeps its own). */
fn calls_buffer_sized(ir_builder: &IrBuilder<'_>, node: &IrNode, depth: usize) -> bool {
    if depth > 64 {
        return true;
    }
    let mut calls = Vec::new();
    call_nested_nodes(node, &mut calls);
    calls
        .into_iter()
        .any(|call| match ir_builder.build_type_name(&call.type_name) {
            Ok(callee) => {
                uses_buffer_size(&callee.root)
                    || calls_buffer_sized(ir_builder, &callee.root, depth + 1)
            }
            Err(_) => true,
        })
}

/* Does `node` itself read `__buffer_size`? */
fn uses_buffer_size(node: &IrNode) -> bool {
    match node {
        IrNode::FieldRef(f) => f.parameter.is_none() && f.path == "__buffer_size",
        IrNode::ZeroSize { .. } | IrNode::Const(_) | IrNode::CallNested(_) => false,
        IrNode::AlignUp(n) => uses_buffer_size(&n.node),
        IrNode::Switch(n) => {
            n.cases.iter().any(|c| uses_buffer_size(&c.node))
                || n.default.as_deref().is_some_and(uses_buffer_size)
        }
        IrNode::AddChecked(n)
        | IrNode::SubChecked(n)
        | IrNode::MulChecked(n)
        | IrNode::DivChecked(n)
        | IrNode::ModChecked(n)
        | IrNode::BitAnd(n)
        | IrNode::BitOr(n)
        | IrNode::BitXor(n)
        | IrNode::LeftShift(n)
        | IrNode::RightShift(n) => uses_buffer_size(&n.left) || uses_buffer_size(&n.right),
        IrNode::SumOverArray(n) => uses_buffer_size(&n.count),
    }
}

/* Every `CallNested` node in `node`, outermost first. */
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

/* A named type that is just another name for an existing type. */
fn emit_alias(e: &Emitter<'_, '_>, ty: &ResolvedType, target: &str, out: &mut String) {
    let model = e.m;
    let name = e.nm(&ty.name);
    let target_ty = model.named(target).map(|t| model.deref(t));
    out.push_str(&format!("/* Type: {} (alias of {}) */\n", ty.name, target));
    match target_ty.map(|t| &t.kind) {
        Some(ResolvedTypeKind::Primitive { prim_type }) => {
            out.push_str(&format!(
                "pub type {} = {};\n\n",
                name.ty,
                prim_rust(prim_type)
            ));
        }
        Some(_) => {
            let t = e.nm(&target_ty.unwrap().name);
            out.push_str(&format!(
                "#[allow(non_camel_case_types)]\npub type {nv}<B> = {tv}<B>;\n#[allow(non_camel_case_types)]\npub type {n}<'a> = {t}<'a>;\n#[allow(non_camel_case_types)]\npub type {nm}<'a> = {tm}<'a>;\n\n",
                nv = name.view,
                tv = t.view,
                n = name.ty,
                t = t.ty,
                nm = name.mut_,
                tm = t.mut_
            ));
        }
        None => {}
    }
}
