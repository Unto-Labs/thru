use super::helpers::{
    escape_c_keyword, format_type_to_c, get_c_accessor_type, is_nested_complex_type,
    primitive_to_c_type, sanitize_type_name,
};
use super::ir_footprint::{format_ir_parameter_list, sanitize_symbol};
use crate::abi::resolved::{ResolvedType, ResolvedTypeKind, Size};
use crate::abi::types::PrimitiveType;
use crate::codegen::shared::ir::TypeIr;
use std::collections::{BTreeMap, HashSet};

/* Extract field names that are referenced in struct field expressions (like enum tag-refs and FAM sizes) */
fn extract_referenced_fields(fields: &[crate::abi::resolved::ResolvedField]) -> HashSet<String> {
    use crate::abi::expr::ExprKind;
    let mut referenced = HashSet::new();

    for field in fields {
        match &field.field_type.kind {
            ResolvedTypeKind::Enum { tag_expression, .. } => {
                // Extract field refs from tag expression
                extract_field_refs_from_expr(tag_expression, &mut referenced);
            }
            ResolvedTypeKind::Array {
                size_expression, ..
            } => {
                // Extract field refs from FAM size expression
                if !matches!(field.field_type.size, crate::abi::resolved::Size::Const(..)) {
                    extract_field_refs_from_expr(size_expression, &mut referenced);
                }
            }
            ResolvedTypeKind::Struct {
                fields: nested_fields,
                ..
            } => {
                /* Recurse into nested struct fields */
                for nested_field in nested_fields {
                    match &nested_field.field_type.kind {
                        ResolvedTypeKind::Array {
                            size_expression, ..
                        } => {
                            if !matches!(
                                nested_field.field_type.size,
                                crate::abi::resolved::Size::Const(..)
                            ) {
                                extract_field_refs_from_expr(size_expression, &mut referenced);
                            }
                        }
                        ResolvedTypeKind::Enum { tag_expression, .. } => {
                            extract_field_refs_from_expr(tag_expression, &mut referenced);
                        }
                        _ => {}
                    }
                }
            }
            _ => {}
        }
    }

    referenced
}

/* Recursively extract field references from an expression */
fn extract_field_refs_from_expr(expr: &crate::abi::expr::ExprKind, refs: &mut HashSet<String>) {
    use crate::abi::expr::ExprKind;

    match expr {
        ExprKind::FieldRef(field_ref) => {
            // Join the full path with underscores for nested field refs
            // e.g., ["first", "count"] becomes "first_count"
            let full_path = field_ref.path.join("_");
            refs.insert(full_path);
        }
        // For binary operations, recursively check both sides
        ExprKind::Add(e) => {
            extract_field_refs_from_expr(&e.left, refs);
            extract_field_refs_from_expr(&e.right, refs);
        }
        ExprKind::Sub(e) => {
            extract_field_refs_from_expr(&e.left, refs);
            extract_field_refs_from_expr(&e.right, refs);
        }
        ExprKind::Mul(e) => {
            extract_field_refs_from_expr(&e.left, refs);
            extract_field_refs_from_expr(&e.right, refs);
        }
        ExprKind::Div(e) => {
            extract_field_refs_from_expr(&e.left, refs);
            extract_field_refs_from_expr(&e.right, refs);
        }
        ExprKind::Mod(e) => {
            extract_field_refs_from_expr(&e.left, refs);
            extract_field_refs_from_expr(&e.right, refs);
        }
        ExprKind::Pow(e) => {
            extract_field_refs_from_expr(&e.left, refs);
            extract_field_refs_from_expr(&e.right, refs);
        }
        ExprKind::BitAnd(e) => {
            extract_field_refs_from_expr(&e.left, refs);
            extract_field_refs_from_expr(&e.right, refs);
        }
        ExprKind::BitOr(e) => {
            extract_field_refs_from_expr(&e.left, refs);
            extract_field_refs_from_expr(&e.right, refs);
        }
        ExprKind::BitXor(e) => {
            extract_field_refs_from_expr(&e.left, refs);
            extract_field_refs_from_expr(&e.right, refs);
        }
        ExprKind::LeftShift(e) => {
            extract_field_refs_from_expr(&e.left, refs);
            extract_field_refs_from_expr(&e.right, refs);
        }
        ExprKind::RightShift(e) => {
            extract_field_refs_from_expr(&e.left, refs);
            extract_field_refs_from_expr(&e.right, refs);
        }
        // For unary operations
        ExprKind::BitNot(e) => {
            extract_field_refs_from_expr(&e.operand, refs);
        }
        ExprKind::Neg(e) => {
            extract_field_refs_from_expr(&e.operand, refs);
        }
        ExprKind::Not(e) => {
            extract_field_refs_from_expr(&e.operand, refs);
        }
        ExprKind::Popcount(e) => {
            extract_field_refs_from_expr(&e.operand, refs);
        }
        // Literals, sizeof, alignof don't reference fields
        _ => {}
    }
}

/* Generate forward declarations for all functions of a type */
pub fn emit_forward_declarations(resolved_type: &ResolvedType, type_ir: Option<&TypeIr>) -> String {
    /* Convert type name from "Parent::nested" to "Parent_nested" for C syntax */
    let type_name = sanitize_type_name(&resolved_type.name);
    let mut output = format!(
        "\n/*  ----- FORWARD DECLARATIONS FOR {} ----- */\n\n",
        type_name
    );

    match &resolved_type.kind {
        ResolvedTypeKind::Struct { fields, .. } => {
            /* Opaque wrapper forward declarations */

            /* from_slice() - returns const pointer to opaque type */
            output.push_str(&format!(
                "{}_t const * {}_from_slice( uint8_t const * data, uint64_t data_len );\n",
                type_name, type_name
            ));

            /* from_slice_mut() - returns mutable pointer to opaque type */
            output.push_str(&format!(
                "{}_t * {}_from_slice_mut( uint8_t * data, uint64_t data_len );\n",
                type_name, type_name
            ));

            /* Check if this is a nested inline struct (name contains "::") */
            let is_nested = resolved_type.name.contains("::");

            /* Only generate new() forward declaration for top-level types, not nested inline structs */
            if !is_nested {
                /* new() - takes buffer instead of allocating */
                output.push_str(&format!(
                    "int {}_new( uint8_t * buffer, uint64_t buffer_size",
                    type_name
                ));

                /* Only include fields referenced in struct expressions (like enum tags and FAM sizes) */
                let referenced_fields = extract_referenced_fields(fields);

                /* Generate parameters in field order by iterating through fields and checking if referenced */
                /* First collect top-level referenced primitives */
                for field in fields {
                    if let ResolvedTypeKind::Primitive { prim_type } = &field.field_type.kind {
                        if referenced_fields.contains(&field.name) {
                            output.push_str(", ");
                            let c_type = primitive_to_c_type(prim_type);
                            output.push_str(&format!("{} {}", c_type, field.name));
                        }
                    }
                }

                /* Then collect nested referenced primitives in field order */
                for field in fields {
                    if let ResolvedTypeKind::Struct {
                        fields: nested_fields,
                        ..
                    } = &field.field_type.kind
                    {
                        for nested_field in nested_fields {
                            if let ResolvedTypeKind::Primitive { prim_type } =
                                &nested_field.field_type.kind
                            {
                                let nested_path = format!("{}_{}", field.name, nested_field.name);
                                if referenced_fields.contains(&nested_path) {
                                    output.push_str(", ");
                                    let c_type = primitive_to_c_type(prim_type);
                                    output.push_str(&format!("{} {}", c_type, nested_path));
                                }
                            }
                        }
                    }
                }

                /* Add payload-size parameters for size-discriminated union fields */
                for field in fields {
                    if matches!(
                        &field.field_type.kind,
                        ResolvedTypeKind::SizeDiscriminatedUnion { .. }
                    ) {
                        output.push_str(&format!(", uint64_t {}_payload_size", field.name));
                    }
                }

                output.push_str(", uint64_t * out_size );\n");
            } /* end if !is_nested */

            /* footprint() forward declaration */
            if matches!(resolved_type.size, Size::Const(_)) {
                /* Constant size */
                output.push_str(&format!("uint64_t {}_footprint( void );\n", type_name));
            } else {
                /* Variable size - need parameters */
                let mut all_field_refs: BTreeMap<String, PrimitiveType> = BTreeMap::new();
                if let Size::Variable(variable_refs) = &resolved_type.size {
                    for refs in variable_refs.values() {
                        for (ref_path, prim_type) in refs {
                            all_field_refs
                                .entry(ref_path.clone())
                                .or_insert_with(|| prim_type.clone());
                        }
                    }
                }

                let non_constant_refs: Vec<String> = all_field_refs.keys().cloned().collect();
                output.push_str(&format!("uint64_t {}_footprint( ", type_name));
                if non_constant_refs.is_empty() {
                    output.push_str("void );\n");
                } else {
                    let mut first = true;
                    for field_ref in &non_constant_refs {
                        if !field_ref.starts_with("_typeref_") {
                            if !first {
                                output.push_str(", ");
                            }
                            let param_name = field_ref.replace(".", "_");
                            output.push_str(&format!("int64_t {}", param_name));
                            first = false;
                        }
                    }
                    output.push_str(" );\n");
                }
            }

            if let Some(type_ir) = type_ir {
                let fn_name = sanitize_symbol(&format!("{}_footprint_ir", type_ir.type_name));
                let params = format_ir_parameter_list(type_ir);
                output.push_str(&format!("uint64_t {}( {} );\n", fn_name, params));
                let validate_fn = sanitize_symbol(&format!("{}_validate_ir", type_ir.type_name));
                let validate_params = format_ir_parameter_list(type_ir);
                if validate_params == "void" {
                    output.push_str(&format!(
                        "int {}( uint64_t buf_sz, uint64_t * out_bytes_consumed );\n",
                        validate_fn
                    ));
                } else {
                    output.push_str(&format!(
                        "int {}( uint64_t buf_sz, uint64_t * out_bytes_consumed, {} );\n",
                        validate_fn, validate_params
                    ));
                }
            }

            /* validate() */
            output.push_str(&format!("int {}_validate( uint8_t const * data, uint64_t data_len, uint64_t * out_size );\n",
                               type_name));

            /* Getters for each primitive field */
            for field in fields.iter() {
                if let ResolvedTypeKind::Primitive { prim_type } = &field.field_type.kind {
                    let c_type = primitive_to_c_type(prim_type);
                    output.push_str(&format!(
                        "{} {}_get_{}( {}_t const * self );\n",
                        c_type, type_name, field.name, type_name
                    ));
                }
            }

            output.push_str("\n");

            /* Forward declarations for enum size helpers */
            for field in fields.iter() {
                if let ResolvedTypeKind::Enum { .. } = &field.field_type.kind {
                    output.push_str(&format!(
                        "uint64_t {}_get_{}_size( {}_t const * self );\n",
                        type_name, field.name, type_name
                    ));
                }
            }

            /* Forward declarations for size-discriminated union tag and size helpers */
            for field in fields.iter() {
                if let ResolvedTypeKind::SizeDiscriminatedUnion { .. } = &field.field_type.kind {
                    let escaped_name = escape_c_keyword(&field.name);
                    output.push_str(&format!(
                        "uint8_t {}_{}_tag_from_size( uint64_t size );\n",
                        type_name, escaped_name
                    ));
                    output.push_str(&format!(
                        "uint64_t {}_{}_size_from_tag( uint8_t tag );\n",
                        type_name, escaped_name
                    ));
                    output.push_str(&format!(
                        "uint64_t {}_{}_size( {}_t const * self, uint64_t buffer_size );\n",
                        type_name, escaped_name, type_name
                    ));
                }
            }

            if fields.iter().any(|f| {
                matches!(
                    &f.field_type.kind,
                    ResolvedTypeKind::Enum { .. } | ResolvedTypeKind::SizeDiscriminatedUnion { .. }
                )
            }) {
                output.push_str("\n");
            }

            /* Forward declarations for enum body getters/setters (Layer 1) */
            for field in fields.iter() {
                if let ResolvedTypeKind::Enum { .. } = &field.field_type.kind {
                    output.push_str(&format!(
                        "uint8_t const * {}_get_{}_body( {}_t const * self );\n",
                        type_name, field.name, type_name
                    ));
                    output.push_str(&format!("int {}_set_{}_body( {}_t * self, uint8_t const * body, uint64_t body_len );\n",
                                 type_name, field.name, type_name));
                }
            }

            /* Forward declarations for size-discriminated union variant getters and setters (like enums) */
            for field in fields.iter() {
                if let ResolvedTypeKind::SizeDiscriminatedUnion { variants } =
                    &field.field_type.kind
                {
                    let escaped_name = escape_c_keyword(&field.name);
                    for variant in variants {
                        let variant_escaped = escape_c_keyword(&variant.name);
                        let variant_type_name =
                            format!("{}_{}_{}_inner_t", type_name, escaped_name, variant_escaped);
                        /* Variant getters are generated in get.rs - forward declarations added there */
                        /* Variant setters */
                        output.push_str(&format!(
                            "void {}_{}_set_{}( {}_t * self, {} const * value );\n",
                            type_name, escaped_name, variant_escaped, type_name, variant_type_name
                        ));
                    }
                }
            }

            if fields
                .iter()
                .any(|f| matches!(&f.field_type.kind, ResolvedTypeKind::Enum { .. }))
            {
                output.push_str("\n");
            }

            /* Setters for each primitive field (except size-affecting fields) */
            /* Identify size-affecting fields */
            let size_affecting_fields = extract_referenced_fields(fields);

            for field in fields.iter() {
                if let ResolvedTypeKind::Primitive { prim_type } = &field.field_type.kind {
                    /* Skip setters for size-affecting fields */
                    if size_affecting_fields.contains(&field.name) {
                        continue;
                    }
                    let c_type = primitive_to_c_type(prim_type);
                    output.push_str(&format!(
                        "void {}_set_{}( {}_t * self, {} value );\n",
                        type_name, field.name, type_name, c_type
                    ));
                }
            }

            output.push_str("\n");

            /* Array accessors for each array field */
            for field in fields.iter() {
                if let ResolvedTypeKind::Array { element_type, .. } = &field.field_type.kind {
                    if let crate::abi::resolved::Size::Const(array_size) = field.field_type.size {
                        if let ResolvedTypeKind::Primitive { prim_type } = &element_type.kind {
                            let elem_c_type = primitive_to_c_type(prim_type);
                            let elem_size: u64 = match prim_type {
                                PrimitiveType::Integral(int_type) => match int_type {
                                    crate::abi::types::IntegralType::U8
                                    | crate::abi::types::IntegralType::I8 => 1,
                                    crate::abi::types::IntegralType::U16
                                    | crate::abi::types::IntegralType::I16 => 2,
                                    crate::abi::types::IntegralType::U32
                                    | crate::abi::types::IntegralType::I32 => 4,
                                    crate::abi::types::IntegralType::U64
                                    | crate::abi::types::IntegralType::I64 => 8,
                                },
                                PrimitiveType::FloatingPoint(float_type) => match float_type {
                                    crate::abi::types::FloatingPointType::F16 => 2,
                                    crate::abi::types::FloatingPointType::F32 => 4,
                                    crate::abi::types::FloatingPointType::F64 => 8,
                                },
                            };

                            /* Only generate if array_size is divisible by elem_size (valid array) */
                            if array_size % elem_size == 0 {
                                /* Length getter */
                                output.push_str(&format!(
                                    "uint64_t {}_get_{}_length( {}_t const * self );\n",
                                    type_name, field.name, type_name
                                ));

                                /* Index getter */
                                output.push_str(&format!(
                                    "{} {}_get_{}_at( {}_t const * self, uint64_t index );\n",
                                    elem_c_type, type_name, field.name, type_name
                                ));

                                /* Index setter */
                                output.push_str(&format!(
                                    "void {}_set_{}_at( {}_t * self, uint64_t index, {} value );\n",
                                    type_name, field.name, type_name, elem_c_type
                                ));
                            }
                        }
                    }
                }
            }

            output.push_str("\n");

            /* Nested struct accessors for each TypeRef field */
            for field in fields.iter() {
                if let ResolvedTypeKind::TypeRef { target_name, .. } = &field.field_type.kind {
                    if let Size::Const(_nested_size) = field.field_type.size {
                        /* Const getter - returns const pointer */
                        output.push_str(&format!(
                            "{}_t const * {}_get_{}_const( {}_t const * self );\n",
                            target_name, type_name, field.name, type_name
                        ));

                        /* Mutable getter - returns mutable pointer */
                        output.push_str(&format!(
                            "{}_t * {}_get_{}( uint8_t * data );\n",
                            target_name, type_name, field.name
                        ));

                        /* Setter - accepts wrapper by const pointer */
                        output.push_str(&format!(
                            "int {}_set_{}( {}_t * self, {}_t const * nested );\n",
                            type_name, field.name, type_name, target_name
                        ));
                    }
                }
            }

            /* For inline nested structs, generate forward declarations for parent-scoped accessors */
            for field in fields {
                if let ResolvedTypeKind::Struct {
                    fields: nested_fields,
                    ..
                } = &field.field_type.kind
                {
                    /* This is an inline nested struct - generate parent-scoped accessors for its fields */
                    output.push_str(&format!(
                        "\n/* Nested struct {}.* accessor forward declarations */\n",
                        field.name
                    ));

                    for nested_field in nested_fields {
                        match &nested_field.field_type.kind {
                            ResolvedTypeKind::Primitive { prim_type } => {
                                let prim_c_type = primitive_to_c_type(prim_type);
                                output.push_str(&format!(
                                    "{} {}_get_{}_{}( {}_t const * self );\n",
                                    prim_c_type,
                                    type_name,
                                    field.name,
                                    nested_field.name,
                                    type_name
                                ));
                            }
                            ResolvedTypeKind::Array { element_type, .. } => {
                                if let ResolvedTypeKind::Primitive { prim_type } =
                                    &element_type.kind
                                {
                                    if !matches!(
                                        nested_field.field_type.size,
                                        crate::abi::resolved::Size::Const(..)
                                    ) {
                                        let elem_c_type = primitive_to_c_type(prim_type);
                                        /* Variable-size array - generate length getter, element getter, and element setter */
                                        output.push_str(&format!(
                                            "uint64_t {}_get_{}_{}_length( {}_t const * self );\n",
                                            type_name, field.name, nested_field.name, type_name
                                        ));
                                        output.push_str(&format!("{} {}_get_{}_{}_at( {}_t const * self, uint64_t index );\n",
                      elem_c_type, type_name, field.name, nested_field.name, type_name));
                                        output.push_str(&format!("void {}_set_{}_{}_at( {}_t * self, uint64_t index, {} value );\n",
                      type_name, field.name, nested_field.name, type_name, elem_c_type));
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                }
            }

            output.push_str("\n");
            return output;
        }
        ResolvedTypeKind::Union { .. } | ResolvedTypeKind::Enum { .. } => {
            /* Footprint function declaration */
            if matches!(resolved_type.size, Size::Const(_)) {
                /* Constant size */
                output.push_str(&format!("uint64_t {}_footprint( void );\n", type_name));
            } else {
                /* Variable size - need parameters */
                let mut all_field_refs: BTreeMap<String, PrimitiveType> = BTreeMap::new();
                if let Size::Variable(variable_refs) = &resolved_type.size {
                    for refs in variable_refs.values() {
                        for (ref_path, prim_type) in refs {
                            all_field_refs
                                .entry(ref_path.clone())
                                .or_insert_with(|| prim_type.clone());
                        }
                    }
                }
                let non_constant_refs: Vec<String> = all_field_refs.keys().cloned().collect();

                output.push_str(&format!("uint64_t {}_footprint( ", type_name));
                if non_constant_refs.is_empty() {
                    output.push_str("void ");
                } else {
                    let mut first = true;
                    for field_ref in &non_constant_refs {
                        if !field_ref.starts_with("_typeref_") {
                            if !first {
                                output.push_str(", ");
                            }
                            let param_name = field_ref.replace(".", "_");
                            output.push_str(&format!("int64_t {}", param_name));
                            first = false;
                        }
                    }
                    output.push_str(" ");
                }
                output.push_str(");\n");
            }

            /* Init function declarations */
            match &resolved_type.kind {
                ResolvedTypeKind::Struct { fields, .. } => {
                    let mut field_param_lines: Vec<String> = Vec::new();

                    for field in fields {
                        let field_name = &field.name;
                        let param_name = escape_c_keyword(&field.name);
                        let is_fam = matches!(&field.field_type.size, Size::Variable(_));

                        /* Skip enum fields in init - they're initialized separately */
                        if matches!(&field.field_type.kind, ResolvedTypeKind::Enum { .. }) {
                            continue;
                        }

                        match &field.field_type.kind {
                            ResolvedTypeKind::Primitive { prim_type } => {
                                let type_str = primitive_to_c_type(prim_type);
                                field_param_lines.push(format!("{} {}", type_str, param_name));
                            }
                            ResolvedTypeKind::Array { element_type, .. } => {
                                let mut element_param_type = format_type_to_c(element_type);
                                if is_nested_complex_type(element_type) {
                                    element_param_type =
                                        format!("{}_{}_inner_t", type_name, field_name);
                                }
                                let len_name = format!("{}_len", param_name);
                                field_param_lines.push(format!(
                                    "{} const * {}, uint64_t {}",
                                    element_param_type, param_name, len_name
                                ));
                            }
                            _ => {
                                /* Special handling for enums: they accept void const * + size */
                                if matches!(&field.field_type.kind, ResolvedTypeKind::Enum { .. }) {
                                    let size_param_name = format!("{}_sz", param_name);
                                    field_param_lines.push(format!(
                                        "void const * {}, uint64_t {}",
                                        param_name, size_param_name
                                    ));
                                } else {
                                    let mut pointer_type = format_type_to_c(&field.field_type);
                                    if is_nested_complex_type(&field.field_type) {
                                        pointer_type =
                                            format!("{}_{}_inner_t", type_name, field_name);
                                    }
                                    if is_fam {
                                        let size_param_name = format!("{}_sz", param_name);
                                        field_param_lines.push(format!(
                                            "{} const * {}, uint64_t {}",
                                            pointer_type, param_name, size_param_name
                                        ));
                                    } else {
                                        field_param_lines.push(format!(
                                            "{} const * {}",
                                            pointer_type, param_name
                                        ));
                                    }
                                }
                            }
                        }
                    }

                    if field_param_lines.is_empty() {
                        output.push_str(&format!(
                            "int {}_init( void * buffer, uint64_t buf_sz );\n",
                            type_name
                        ));
                    } else {
                        output.push_str(&format!(
                            "int {}_init( void * buffer, uint64_t buf_sz,\n",
                            type_name
                        ));
                        for (idx, line) in field_param_lines.iter().enumerate() {
                            let suffix = if idx + 1 == field_param_lines.len() {
                                "\n"
                            } else {
                                ",\n"
                            };
                            output.push_str("  ");
                            output.push_str(line);
                            output.push_str(suffix);
                        }
                        output.push_str(");\n");
                    }
                    output.push_str(&format!(
            "int {}_validate( void const * buffer, uint64_t buf_sz, uint64_t * out_bytes_consumed );\n",
            type_name
          ));

                    output.push_str(&format!(
                        "uint64_t {}_size( {}_t const * self );\n",
                        type_name, type_name
                    ));
                }
                ResolvedTypeKind::Union { variants } => {
                    for variant in variants {
                        let escaped_variant = escape_c_keyword(&variant.name);
                        let param_decl = match &variant.field_type.kind {
                            ResolvedTypeKind::Primitive { .. } => {
                                let type_str = format_type_to_c(&variant.field_type);
                                format!("{} value", type_str)
                            }
                            ResolvedTypeKind::Array { element_type, .. } => {
                                let mut element_c_type = format_type_to_c(element_type);
                                if is_nested_complex_type(element_type) {
                                    element_c_type =
                                        format!("{}_{}_inner_t", type_name, escaped_variant);
                                }
                                format!("{} const * value, uint64_t len", element_c_type)
                            }
                            ResolvedTypeKind::TypeRef { target_name, .. } => {
                                format!("{}_t const * value", target_name)
                            }
                            _ => {
                                let target_name = if is_nested_complex_type(&variant.field_type) {
                                    format!("{}_{}_inner_t", type_name, escaped_variant)
                                } else {
                                    format_type_to_c(&variant.field_type)
                                };
                                format!("{} const * value", target_name)
                            }
                        };

                        output.push_str(&format!(
                            "int {}_init_{}( void * buffer, uint64_t buf_sz, {} );\n",
                            type_name, escaped_variant, param_decl
                        ));
                    }
                    output.push_str(&format!(
            "int {}_validate( void const * buffer, uint64_t buf_sz, uint64_t * out_bytes_consumed );\n",
            type_name
          ));

                    output.push_str(&format!(
                        "uint64_t {}_size( {}_t const * self );\n",
                        type_name, type_name
                    ));
                }
                _ => {}
            }

            if !matches!(
                resolved_type.kind,
                ResolvedTypeKind::Struct { .. } | ResolvedTypeKind::Union { .. }
            ) {
                output.push_str(&format!(
                    "uint64_t {}_size( {}_t const * self );\n",
                    type_name, type_name
                ));
            }

            /* Set function declarations - only for primitive fields that are NOT field references */
            if let ResolvedTypeKind::Struct { fields, .. } = &resolved_type.kind {
                /* First, get the BTree of all field references inside the type */
                let mut all_field_refs: BTreeMap<String, PrimitiveType> = BTreeMap::new();
                if let Size::Variable(variable_refs) = &resolved_type.size {
                    for refs in variable_refs.values() {
                        for (ref_path, prim_type) in refs {
                            all_field_refs
                                .entry(ref_path.clone())
                                .or_insert_with(|| prim_type.clone());
                        }
                    }
                }

                for field in fields {
                    let escaped_name = escape_c_keyword(&field.name);

                    /* Generate set functions for primitive and TypeRef fields */
                    match &field.field_type.kind {
                        ResolvedTypeKind::Primitive { prim_type } => {
                            /* Generate setter for all primitive fields (including tag fields) */
                            let field_type_str = primitive_to_c_type(prim_type);
                            output.push_str(&format!(
                                "void {}_set_{}( {}_t * self, {} value );\n",
                                type_name, escaped_name, type_name, field_type_str
                            ));
                        }
                        ResolvedTypeKind::TypeRef { target_name, .. } => {
                            /* For TypeRef fields, emit setter that accepts const pointer */
                            output.push_str(&format!(
                                "void {}_set_{}( {}_t * self, {}_t const * value );\n",
                                type_name, escaped_name, type_name, target_name
                            ));
                        }
                        ResolvedTypeKind::Enum { variants, .. } => {
                            /* For enum fields, emit generic body getter/setter */
                            output.push_str(&format!(
                                "void const * {}_get_{}( {}_t const * self );\n",
                                type_name, escaped_name, type_name
                            ));
                            output.push_str(&format!(
                                "void {}_set_{}( {}_t * self, void const * value );\n",
                                type_name, escaped_name, type_name
                            ));

                            /* Also emit variant-specific setters - include field name for disambiguation */
                            for variant in variants {
                                let variant_escaped = escape_c_keyword(&variant.name);
                                let variant_type_name = format!(
                                    "{}_{}_{}_inner_t",
                                    type_name, escaped_name, variant_escaped
                                );
                                output.push_str(&format!(
                                    "void {}_{}_set_{}( {}_t * self, {} const * value );\n",
                                    type_name,
                                    escaped_name,
                                    variant_escaped,
                                    type_name,
                                    variant_type_name
                                ));
                            }
                        }
                        _ => { /* Skip other field types */ }
                    }
                }
            }

            /* Accessor function declarations */
            if let ResolvedTypeKind::Struct { fields, .. } = &resolved_type.kind {
                for field in fields {
                    let escaped_name = escape_c_keyword(&field.name);

                    /* Determine return type and generate declaration */
                    match &field.field_type.kind {
                        ResolvedTypeKind::Primitive { .. } => {
                            let field_type = get_c_accessor_type(&field.field_type);
                            output.push_str(&format!(
                                "{} {}_get_{}( {}_t const * self );\n",
                                field_type, type_name, escaped_name, type_name
                            ));
                        }
                        ResolvedTypeKind::Array { element_type, .. } => {
                            /* Arrays get three functions: const getter, mutable getter, and size */
                            let element_c_type = format_type_to_c(element_type);

                            /* Const getter */
                            output.push_str(&format!(
                                "{} const * {}_get_{}_const( {}_t const * self );\n",
                                element_c_type, type_name, escaped_name, type_name
                            ));

                            /* Mutable getter */
                            output.push_str(&format!(
                                "{} * {}_get_{}( {}_t * self );\n",
                                element_c_type, type_name, escaped_name, type_name
                            ));

                            /* Size function */
                            output.push_str(&format!(
                                "uint64_t {}_get_{}_size( {}_t const * self );\n",
                                type_name, escaped_name, type_name
                            ));
                        }
                        ResolvedTypeKind::Struct { .. }
                        | ResolvedTypeKind::Union { .. }
                        | ResolvedTypeKind::SizeDiscriminatedUnion { .. } => {
                            /* Const getter */
                            output.push_str(&format!(
                                "{}_{}_inner_t const * {}_get_{}_const( {}_t const * self );\n",
                                type_name, escaped_name, type_name, escaped_name, type_name
                            ));
                            /* Mutable getter */
                            output.push_str(&format!(
                                "{}_{}_inner_t * {}_get_{}( {}_t * self );\n",
                                type_name, escaped_name, type_name, escaped_name, type_name
                            ));
                        }
                        ResolvedTypeKind::TypeRef { target_name, .. } => {
                            /* Const getter */
                            output.push_str(&format!(
                                "{}_t const * {}_get_{}_const( {}_t const * self );\n",
                                target_name, type_name, escaped_name, type_name
                            ));
                            /* Mutable getter */
                            output.push_str(&format!(
                                "{}_t * {}_get_{}( {}_t * self );\n",
                                target_name, type_name, escaped_name, type_name
                            ));
                        }
                        ResolvedTypeKind::Enum { variants, .. } => {
                            /* For enum fields, generate variant getters */
                            for variant in variants {
                                let variant_escaped = escape_c_keyword(&variant.name);
                                let variant_type_name = format!(
                                    "{}_{}_{}_inner_t",
                                    type_name, escaped_name, variant_escaped
                                );

                                /* Const getter - includes field name for disambiguation */
                                output.push_str(&format!(
                                    "{} const * {}_{}_get_{}_const( {}_t const * self );\n",
                                    variant_type_name,
                                    type_name,
                                    escaped_name,
                                    variant_escaped,
                                    type_name
                                ));

                                /* Mutable getter - includes field name for disambiguation */
                                output.push_str(&format!(
                                    "{} * {}_{}_get_{}( {}_t * self );\n",
                                    variant_type_name,
                                    type_name,
                                    escaped_name,
                                    variant_escaped,
                                    type_name
                                ));
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
        _ => {}
    }

    output
}
