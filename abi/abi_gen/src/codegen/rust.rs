use crate::abi::resolved::{ResolvedType, ResolvedTypeKind, TypeResolver};
use crate::codegen::rust_gen::{emit_ir_footprint_fn, emit_ir_validate_fn, emit_opaque_functions};
use crate::codegen::shared::builder::IrBuilder;
use crate::codegen::shared::ir::TypeIr;
use std::fs;

pub struct RustCodeGenerator<'a> {
    options: RustCodeGeneratorOptions<'a>,
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
            ir_builder: IrBuilder::new(resolver),
        }
    }

    pub fn emit_code(self, resolved_types: &[&ResolvedType]) -> String {
        let mut types_output = String::new();
        let mut functions_output = String::new();
        let mut include_ir_runtime = false;

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
                    types_output.push_str(&format!("use {}::*;\n", use_path));
                }
            }

            if !dependencies.is_empty() {
                types_output.push_str("\n");
            }
        }

        for resolved_type in resolved_types {
            types_output.push_str(&emit_resolved_type(resolved_type));
            types_output.push_str("\n");

            if self.options.emit_accessors {
                let mut type_ir: Option<TypeIr> = None;
                let mut ir_error: Option<String> = None;
                match self.ir_builder.build_type(resolved_type) {
                    Ok(ir) => {
                        include_ir_runtime = true;
                        type_ir = Some(ir);
                    }
                    Err(err) => {
                        ir_error = Some(err.to_string());
                    }
                }

                functions_output.push_str(&emit_opaque_functions(
                    resolved_type,
                    type_ir.as_ref(),
                    ir_error.as_deref(),
                ));
                functions_output.push_str("\n");

                if let Some(ir) = type_ir.as_ref() {
                    match emit_ir_footprint_fn(ir) {
                        Ok(ir_fn) => functions_output.push_str(&ir_fn),
                        Err(err) => functions_output.push_str(&format!(
                            "/* Failed to emit IR footprint for {}: {} */\n",
                            resolved_type.name, err
                        )),
                    }
                    match emit_ir_validate_fn(ir) {
                        Ok(ir_fn) => functions_output.push_str(&ir_fn),
                        Err(err) => functions_output.push_str(&format!(
                            "/* Failed to emit IR validator for {}: {} */\n",
                            resolved_type.name, err
                        )),
                    }
                } else if let Some(msg) = ir_error.as_ref() {
                    functions_output.push_str(&format!(
                        "/* IR helpers unavailable for {}: {} */\n",
                        resolved_type.name, msg
                    ));
                }
            }
        }

        if !types_output.is_empty() {
            let types_path = format!("{}/types.rs", self.options.output_dir);
            if let Err(e) = fs::write(&types_path, &types_output) {
                eprintln!("Warning: Failed to write types to {}: {}", types_path, e);
            }
        }

        if !functions_output.is_empty() {
            let mut complete_functions = String::new();
            complete_functions.push_str("use super::types::*;\n\n");
            if include_ir_runtime {
                complete_functions.push_str(IR_VALIDATE_RUNTIME_HELPERS);
                complete_functions.push('\n');
            }
            complete_functions.push_str(&functions_output);

            let functions_path = format!("{}/functions.rs", self.options.output_dir);
            if let Err(e) = fs::write(&functions_path, &complete_functions) {
                eprintln!(
                    "Warning: Failed to write functions to {}: {}",
                    functions_path, e
                );
            }
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

        /* Build use path */
        let mut path_parts = Vec::new();

        /* Go up to common ancestor */
        if from_parts.len() > common_len {
            path_parts.push("super".to_string());
            for _ in (common_len + 1)..from_parts.len() {
                path_parts.push("super".to_string());
            }
        } else {
            path_parts.push("crate".to_string());
        }

        /* Add the unique parts of to_package */
        for part in &to_parts[common_len..] {
            path_parts.push(part.to_string());
        }

        path_parts.join("::")
    }
}

const IR_VALIDATE_RUNTIME_HELPERS: &str = r#"
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AbiIrValidateError {
    BufferTooSmall,
    InvalidVariant,
    ArithmeticOverflow,
}

impl AbiIrValidateError {
    pub const fn as_str(self) -> &'static str {
        match self {
            AbiIrValidateError::BufferTooSmall => "buffer too small",
            AbiIrValidateError::InvalidVariant => "invalid variant tag",
            AbiIrValidateError::ArithmeticOverflow => "size arithmetic overflow",
        }
    }
}

fn abi_ir_error_str(err: AbiIrValidateError) -> &'static str {
    err.as_str()
}

fn tn_checked_add_u64(a: u64, b: u64) -> Result<u64, AbiIrValidateError> {
    a.checked_add(b)
        .ok_or(AbiIrValidateError::ArithmeticOverflow)
}

fn tn_checked_mul_u64(a: u64, b: u64) -> Result<u64, AbiIrValidateError> {
    a.checked_mul(b)
        .ok_or(AbiIrValidateError::ArithmeticOverflow)
}
"#;

/* Recursively emit nested anonymous types before the parent type */
fn emit_recursive_types(resolved_type: &ResolvedType, output: &mut String) {
    /* First emit all nested anonymous types */
    match &resolved_type.kind {
        ResolvedTypeKind::Struct { fields, .. } => {
            for field in fields {
                emit_recursive_types(&field.field_type, output);
            }
        }
        ResolvedTypeKind::Union { variants } => {
            for variant in variants {
                emit_recursive_types(&variant.field_type, output);
            }
        }
        ResolvedTypeKind::Enum { .. } => {
            /* Skip enum variants - they're ghost fields in opaque wrapper approach */
        }
        ResolvedTypeKind::Array { element_type, .. } => {
            emit_recursive_types(element_type, output);
        }
        ResolvedTypeKind::SizeDiscriminatedUnion { variants } => {
            for variant in variants {
                emit_recursive_types(&variant.variant_type, output);
            }
        }
        _ => {}
    }

    /* Then emit this type if it's a struct/union/sdu (not primitive, TypeRef, or Enum) */
    /* Skip enums - they're ghost fields in opaque wrapper approach */
    /* Skip size-discriminated unions - they're ghost fields in opaque wrapper approach */
    match &resolved_type.kind {
        ResolvedTypeKind::Struct { .. } | ResolvedTypeKind::Union { .. } => {
            output.push_str(&emit_single_type(resolved_type));
            output.push('\n');
        }
        ResolvedTypeKind::SizeDiscriminatedUnion { .. } => {
            /* Skip - SDUs are ghost fields, handled via accessor methods only */
        }
        _ => {}
    }
}

/* Generate Rust code for a single type (non-recursive) */
fn emit_single_type(resolved_type: &ResolvedType) -> String {
    let mut output = String::new();

    let type_name = sanitize_rust_type_name(&resolved_type.name);

    output.push_str(&format!("/* Type: {} */\n", resolved_type.name));

    match &resolved_type.kind {
        ResolvedTypeKind::Struct { packed, .. } => {
            /* Emit a repr stub so downstream code can assert attributes */
            let repr_attr = if *packed {
                "#[repr(C, packed)]"
            } else {
                "#[repr(C)]"
            };
            let layout_name = format!("{}__layout", type_name);
            output.push_str("#[allow(dead_code)]\n");
            output.push_str(repr_attr);
            output.push('\n');
            output.push_str(&format!(
                "pub struct {} {{ _private: [u8; 0], }}\n\n",
                layout_name
            ));

            /* Immutable wrapper */
            output.push_str("#[allow(non_camel_case_types, non_snake_case)]\n");
            output.push_str("#[derive(Copy, Clone)]\n");
            output.push_str(&format!("pub struct {}<'a> {{\n", type_name));
            output.push_str("    pub(crate) data: &'a [u8],\n");
            output.push_str("}\n\n");

            /* Mutable wrapper */
            output.push_str("#[allow(non_camel_case_types, non_snake_case)]\n");
            output.push_str(&format!("pub struct {}Mut<'a> {{\n", type_name));
            output.push_str("    pub(crate) data: &'a mut [u8],\n");
            output.push_str("}\n");
        }
        ResolvedTypeKind::Enum { variants, .. } => {
            /* Allow non-standard naming since this is FFI code matching ABI spec */
            output.push_str("#[allow(non_camel_case_types, non_snake_case)]\n");
            output.push_str("#[derive(Copy, Clone)]\n");
            output.push_str("#[repr(C)]\n");
            output.push_str(&format!("pub enum {} {{\n", type_name));
            for variant in variants {
                let rust_type = get_rust_type(&variant.variant_type);
                output.push_str(&format!("    {}({}),\n", variant.name, rust_type));
            }
            output.push_str("}\n");
        }
        ResolvedTypeKind::Union { variants } => {
            emit_union_type(
                &mut output,
                &type_name,
                variants
                    .iter()
                    .map(|variant| (variant.name.as_str(), &variant.field_type)),
            );
        }
        ResolvedTypeKind::SizeDiscriminatedUnion { variants } => {
            emit_union_type(
                &mut output,
                &type_name,
                variants
                    .iter()
                    .map(|variant| (variant.name.as_str(), &variant.variant_type)),
            );
        }
        ResolvedTypeKind::Primitive { prim_type } => {
            let rust_type = match prim_type {
                crate::abi::types::PrimitiveType::Integral(int_type) => match int_type {
                    crate::abi::types::IntegralType::U8 => "u8",
                    crate::abi::types::IntegralType::U16 => "u16",
                    crate::abi::types::IntegralType::U32 => "u32",
                    crate::abi::types::IntegralType::U64 => "u64",
                    crate::abi::types::IntegralType::I8 => "i8",
                    crate::abi::types::IntegralType::I16 => "i16",
                    crate::abi::types::IntegralType::I32 => "i32",
                    crate::abi::types::IntegralType::I64 => "i64",
                },
                crate::abi::types::PrimitiveType::FloatingPoint(float_type) => match float_type {
                    crate::abi::types::FloatingPointType::F16 => "f16",
                    crate::abi::types::FloatingPointType::F32 => "f32",
                    crate::abi::types::FloatingPointType::F64 => "f64",
                },
            };
            output.push_str(&format!("pub type {} = {};\n", type_name, rust_type));
        }
        _ => {
            output.push_str(&format!(
                "// TODO: Implement code generation for {:?}\n",
                resolved_type.kind
            ));
        }
    }

    output
}

/* Generate Rust code for a resolved type (public API) */
fn emit_resolved_type(resolved_type: &ResolvedType) -> String {
    let mut output = String::new();
    emit_recursive_types(resolved_type, &mut output);
    output
}

/* Escape Rust keywords by adding r# prefix */
fn escape_rust_keyword(name: &str) -> String {
    const RUST_KEYWORDS: &[&str] = &[
        "as", "break", "const", "continue", "crate", "else", "enum", "extern", "false", "fn",
        "for", "if", "impl", "in", "let", "loop", "match", "mod", "move", "mut", "pub", "ref",
        "return", "self", "Self", "static", "struct", "super", "trait", "true", "type", "unsafe",
        "use", "where", "while", "async", "await", "dyn", "abstract", "become", "box", "do",
        "final", "macro", "override", "priv", "typeof", "unsized", "virtual", "yield", "try",
    ];

    if RUST_KEYWORDS.contains(&name) {
        format!("r#{}", name)
    } else {
        name.to_string()
    }
}

/* Convert type name to valid Rust identifier */
fn sanitize_rust_type_name(name: &str) -> String {
    /* Replace :: with _ for anonymous nested types */
    let name = name.replace("::", "_");
    escape_rust_keyword(&name)
}

/* Get Rust type name for a resolved type */
fn get_rust_type(resolved_type: &ResolvedType) -> String {
    match &resolved_type.kind {
        ResolvedTypeKind::Primitive { prim_type } => match prim_type {
            crate::abi::types::PrimitiveType::Integral(int_type) => match int_type {
                crate::abi::types::IntegralType::U8 => "u8".to_string(),
                crate::abi::types::IntegralType::U16 => "u16".to_string(),
                crate::abi::types::IntegralType::U32 => "u32".to_string(),
                crate::abi::types::IntegralType::U64 => "u64".to_string(),
                crate::abi::types::IntegralType::I8 => "i8".to_string(),
                crate::abi::types::IntegralType::I16 => "i16".to_string(),
                crate::abi::types::IntegralType::I32 => "i32".to_string(),
                crate::abi::types::IntegralType::I64 => "i64".to_string(),
            },
            crate::abi::types::PrimitiveType::FloatingPoint(float_type) => match float_type {
                crate::abi::types::FloatingPointType::F16 => "f16".to_string(),
                crate::abi::types::FloatingPointType::F32 => "f32".to_string(),
                crate::abi::types::FloatingPointType::F64 => "f64".to_string(),
            },
        },
        ResolvedTypeKind::Array {
            element_type,
            size_constant_status,
            ..
        } => {
            use crate::abi::resolved::ConstantStatus;
            let elem_type = get_rust_type(element_type);
            match size_constant_status {
                ConstantStatus::Constant => {
                    if let crate::abi::resolved::Size::Const(size) = &resolved_type.size {
                        let elem_size = match &element_type.size {
                            crate::abi::resolved::Size::Const(s) => *s,
                            _ => 1,
                        };
                        format!("[{}; {}]", elem_type, size / elem_size)
                    } else {
                        /* FAM: use zero-sized array for C FFI compatibility */
                        format!("[{}; 0]", elem_type)
                    }
                }
                _ => {
                    /* FAM: use zero-sized array for C FFI compatibility */
                    format!("[{}; 0]", elem_type)
                }
            }
        }
        ResolvedTypeKind::TypeRef { target_name, .. } => {
            /* For TypeRef, use the target_name (just the simple type name, not FQDN) */
            sanitize_rust_type_name(target_name)
        }
        _ => sanitize_rust_type_name(&resolved_type.name),
    }
}

fn type_requires_lifetime(resolved_type: &ResolvedType) -> bool {
    matches!(
        resolved_type.kind,
        ResolvedTypeKind::Struct { .. }
            | ResolvedTypeKind::Union { .. }
            | ResolvedTypeKind::SizeDiscriminatedUnion { .. }
            | ResolvedTypeKind::TypeRef { .. }
    )
}

fn rust_type_with_lifetime(resolved_type: &ResolvedType) -> String {
    match &resolved_type.kind {
        ResolvedTypeKind::Struct { .. }
        | ResolvedTypeKind::Union { .. }
        | ResolvedTypeKind::SizeDiscriminatedUnion { .. } => {
            format!("{}<'a>", sanitize_rust_type_name(&resolved_type.name))
        }
        ResolvedTypeKind::TypeRef { target_name, .. } => {
            format!("{}<'a>", sanitize_rust_type_name(target_name))
        }
        _ => get_rust_type(resolved_type),
    }
}

fn emit_union_type<'a, I>(output: &mut String, type_name: &str, variants: I)
where
    I: IntoIterator<Item = (&'a str, &'a ResolvedType)>,
{
    let collected: Vec<(String, &'a ResolvedType)> = variants
        .into_iter()
        .map(|(name, ty)| (sanitize_rust_type_name(name), ty))
        .collect();

    let requires_lifetime = collected.iter().any(|(_, ty)| type_requires_lifetime(ty));

    output.push_str("#[allow(non_camel_case_types, non_snake_case");
    if requires_lifetime {
        output.push_str(", unused_lifetimes");
    }
    output.push_str(")]\n");
    output.push_str("#[derive(Copy, Clone)]\n");
    output.push_str("#[repr(C)]\n");

    let lifetime_decl = if requires_lifetime { "<'a>" } else { "" };
    output.push_str(&format!("pub union {}{} {{\n", type_name, lifetime_decl));

    for (variant_name, ty) in collected {
        let rust_type = if requires_lifetime {
            rust_type_with_lifetime(ty)
        } else {
            get_rust_type(ty)
        };
        output.push_str(&format!("    pub {}: {},\n", variant_name, rust_type));
    }
    output.push_str("}\n");
}
