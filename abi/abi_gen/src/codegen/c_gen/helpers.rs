use crate::abi::expr::{ExprKind, LiteralExpr};
use crate::abi::resolved::{ResolvedType, ResolvedTypeKind, Size};
use crate::abi::types::{FloatingPointType, IntegralType, PrimitiveType};
use std::collections::{BTreeMap, HashMap};
use std::fmt::Write;

/* Convert literal expression to C code string */
pub fn literal_to_c_string(literal: &LiteralExpr) -> String {
    match literal {
        LiteralExpr::U64(v) => v.to_string(),
        LiteralExpr::U32(v) => v.to_string(),
        LiteralExpr::U16(v) => v.to_string(),
        LiteralExpr::U8(v) => v.to_string(),
        LiteralExpr::I64(v) => v.to_string(),
        LiteralExpr::I32(v) => v.to_string(),
        LiteralExpr::I16(v) => v.to_string(),
        LiteralExpr::I8(v) => v.to_string(),
    }
}

pub fn flatten_variable_refs_map(
    variable_refs: &HashMap<String, HashMap<String, PrimitiveType>>,
) -> BTreeMap<String, PrimitiveType> {
    let mut out = BTreeMap::new();
    for refs in variable_refs.values() {
        for (path, prim_type) in refs {
            out.entry(path.clone()).or_insert_with(|| prim_type.clone());
        }
    }
    out
}

pub fn flatten_size_refs(size: &Size) -> BTreeMap<String, PrimitiveType> {
    match size {
        Size::Const(_) => BTreeMap::new(),
        Size::Variable(map) => flatten_variable_refs_map(map),
    }
}

pub fn variable_ref_param_names(refs: &BTreeMap<String, PrimitiveType>) -> Vec<String> {
    refs.keys()
        .map(|ref_path| ref_path.replace('.', "_"))
        .collect()
}

/* Format expression to C code, converting field references to parameter names */
pub fn format_expr_to_c(expr: &ExprKind, params: &[String]) -> String {
    match expr {
        ExprKind::Literal(lit) => literal_to_c_string(lit),
        ExprKind::FieldRef(field_ref) => {
            /* Convert field reference to parameter name */
            let field_path_underscore = field_ref.path.join("_");
            if params.iter().any(|param| param == &field_path_underscore) {
                return field_path_underscore;
            }
            let field_path_dot = field_ref.path.join(".");
            if params.iter().any(|param| param == &field_path_dot) {
                return field_path_underscore;
            }
            if let Some(param) = params.iter().find(|param| {
                param
                    .rsplit('_')
                    .next()
                    .map(|suffix| suffix == field_path_underscore)
                    .unwrap_or(false)
            }) {
                return param.clone();
            }
            let suffix = format!("_{}", field_path_underscore);
            if let Some(param) = params.iter().find(|param| param.ends_with(&suffix)) {
                return param.clone();
            }
            /* If not found in params, use dot notation for struct access */
            field_path_dot
        }
        ExprKind::Sizeof(sizeof_expr) => format!("sizeof({})", sizeof_expr.type_name),
        ExprKind::Alignof(alignof_expr) => format!("alignof({})", alignof_expr.type_name),

        // Binary operations
        ExprKind::Add(e) => format!(
            "({}+{})",
            format_expr_to_c(&e.left, params),
            format_expr_to_c(&e.right, params)
        ),
        ExprKind::Sub(e) => format!(
            "({}-{})",
            format_expr_to_c(&e.left, params),
            format_expr_to_c(&e.right, params)
        ),
        ExprKind::Mul(e) => format!(
            "({}*{})",
            format_expr_to_c(&e.left, params),
            format_expr_to_c(&e.right, params)
        ),
        ExprKind::Div(e) => format!(
            "({}/{})",
            format_expr_to_c(&e.left, params),
            format_expr_to_c(&e.right, params)
        ),
        ExprKind::Mod(e) => format!(
            "({}%{})",
            format_expr_to_c(&e.left, params),
            format_expr_to_c(&e.right, params)
        ),
        ExprKind::Pow(e) => {
            format!(
                "pow({},{})",
                format_expr_to_c(&e.left, params),
                format_expr_to_c(&e.right, params)
            )
        }

        // Bitwise operations
        ExprKind::BitAnd(e) => {
            format!(
                "({}&{})",
                format_expr_to_c(&e.left, params),
                format_expr_to_c(&e.right, params)
            )
        }
        ExprKind::BitOr(e) => format!(
            "({}|{})",
            format_expr_to_c(&e.left, params),
            format_expr_to_c(&e.right, params)
        ),
        ExprKind::BitXor(e) => {
            format!(
                "({}^{})",
                format_expr_to_c(&e.left, params),
                format_expr_to_c(&e.right, params)
            )
        }
        ExprKind::LeftShift(e) => {
            format!(
                "({}<<{})",
                format_expr_to_c(&e.left, params),
                format_expr_to_c(&e.right, params)
            )
        }
        ExprKind::RightShift(e) => {
            format!(
                "({}>>{})",
                format_expr_to_c(&e.left, params),
                format_expr_to_c(&e.right, params)
            )
        }

        // Unary operations
        ExprKind::BitNot(e) => format!("~({})", format_expr_to_c(&e.operand, params)),
        ExprKind::Neg(e) => format!("-({})", format_expr_to_c(&e.operand, params)),
        ExprKind::Not(e) => format!("!({})", format_expr_to_c(&e.operand, params)),
        ExprKind::Popcount(e) => {
            format!(
                "__builtin_popcount({})",
                format_expr_to_c(&e.operand, params)
            )
        }

        // Comparison operations
        ExprKind::Eq(e) => format!(
            "({}=={})",
            format_expr_to_c(&e.left, params),
            format_expr_to_c(&e.right, params)
        ),
        ExprKind::Ne(e) => format!(
            "({}!={})",
            format_expr_to_c(&e.left, params),
            format_expr_to_c(&e.right, params)
        ),
        ExprKind::Lt(e) => format!(
            "({}<{})",
            format_expr_to_c(&e.left, params),
            format_expr_to_c(&e.right, params)
        ),
        ExprKind::Gt(e) => format!(
            "({}>{})",
            format_expr_to_c(&e.left, params),
            format_expr_to_c(&e.right, params)
        ),
        ExprKind::Le(e) => format!(
            "({}<={})",
            format_expr_to_c(&e.left, params),
            format_expr_to_c(&e.right, params)
        ),
        ExprKind::Ge(e) => format!(
            "({}>={})",
            format_expr_to_c(&e.left, params),
            format_expr_to_c(&e.right, params)
        ),

        // Logical operations
        ExprKind::And(e) => format!(
            "({}&&{})",
            format_expr_to_c(&e.left, params),
            format_expr_to_c(&e.right, params)
        ),
        ExprKind::Or(e) => format!(
            "({}||{})",
            format_expr_to_c(&e.left, params),
            format_expr_to_c(&e.right, params)
        ),
        ExprKind::Xor(e) => {
            format!(
                "(({})!=({}))",
                format_expr_to_c(&e.left, params),
                format_expr_to_c(&e.right, params)
            )
        }
    }
}

pub fn escape_c_keyword(name: &str) -> String {
    const C_KEYWORDS: &[&str] = &[
        // C keywords
        "auto",
        "break",
        "case",
        "char",
        "const",
        "continue",
        "default",
        "do",
        "double",
        "else",
        "enum",
        "extern",
        "float",
        "for",
        "goto",
        "if",
        "inline",
        "int",
        "long",
        "register",
        "restrict",
        "return",
        "short",
        "signed",
        "sizeof",
        "static",
        "struct",
        "switch",
        "typedef",
        "union",
        "unsigned",
        "void",
        "volatile",
        "while",
        // C99 keywords
        "_Alignas",
        "_Alignof",
        "_Atomic",
        "_Bool",
        "_Complex",
        "_Generic",
        "_Imaginary",
        "_Noreturn",
        "_Static_assert",
        "_Thread_local",
        // Common reserved identifiers
        "bool",
        "complex",
        "imaginary",
        // Commonly used types that might conflict
        "size_t",
        "ssize_t",
        "ptrdiff_t",
        "wchar_t",
        "NULL",
    ];

    let mut sanitized: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();

    if sanitized.is_empty() {
        sanitized.push('_');
    }

    if sanitized
        .chars()
        .next()
        .map(|c| c.is_ascii_digit())
        .unwrap_or(false)
    {
        sanitized.insert(0, '_');
    }

    if C_KEYWORDS.contains(&sanitized.as_str()) {
        sanitized.push('_');
    }

    sanitized
}

pub fn sanitize_type_name(name: &str) -> String {
    escape_c_keyword(&name.replace("::", "_"))
}

pub fn primitive_to_c_type(prim_type: &PrimitiveType) -> &'static str {
    match prim_type {
        PrimitiveType::Integral(int_type) => match int_type {
            IntegralType::U8 => "uint8_t",
            IntegralType::U16 => "uint16_t",
            IntegralType::U32 => "uint32_t",
            IntegralType::U64 => "uint64_t",
            IntegralType::I8 => "int8_t",
            IntegralType::I16 => "int16_t",
            IntegralType::I32 => "int32_t",
            IntegralType::I64 => "int64_t",
            IntegralType::Char => "char",
        },
        PrimitiveType::FloatingPoint(float_type) => match float_type {
            FloatingPointType::F16 => "_Float16",
            FloatingPointType::F32 => "float",
            FloatingPointType::F64 => "double",
        },
    }
}

/* Generate code to access a nested field reference, eg "box.first" */
pub fn generate_nested_field_access(
    field_ref: &str,
    type_name: &str,
    field_prim_type: &PrimitiveType,
) -> String {
    let mut output = String::new();
    let var_name = field_ref.replace('.', "_");

    // For both nested and non-nested paths, call the parent-scoped accessor
    // e.g., "first.count" -> ParentType_get_first_count(self)
    // e.g., "count" -> ParentType_get_count(self)
    write!(
        &mut output,
        "  int64_t {} = (int64_t)({}_get_{}( self ));\n",
        var_name, type_name, var_name
    )
    .unwrap();

    output
}

/* Format a type to C string - simplified version for function generation */
pub fn format_type_to_c(resolved_type: &ResolvedType) -> String {
    match &resolved_type.kind {
        ResolvedTypeKind::Primitive { prim_type } => match prim_type {
            PrimitiveType::Integral(int_type) => match int_type {
                IntegralType::U8 => "uint8_t".to_string(),
                IntegralType::U16 => "uint16_t".to_string(),
                IntegralType::U32 => "uint32_t".to_string(),
                IntegralType::U64 => "uint64_t".to_string(),
                IntegralType::I8 => "int8_t".to_string(),
                IntegralType::I16 => "int16_t".to_string(),
                IntegralType::I32 => "int32_t".to_string(),
                IntegralType::I64 => "int64_t".to_string(),
                IntegralType::Char => "char".to_string(),
            },
            PrimitiveType::FloatingPoint(float_type) => match float_type {
                FloatingPointType::F16 => "_Float16".to_string(),
                FloatingPointType::F32 => "float".to_string(),
                FloatingPointType::F64 => "double".to_string(),
            },
        },
        ResolvedTypeKind::Array { element_type, .. } => {
            format_type_to_c(element_type) // For arrays, just return the element type
        }
        ResolvedTypeKind::TypeRef { target_name, .. } => {
            format!("{}_t", target_name)
        }
        _ => {
            /* For complex inline types, we'll handle them specially in get_c_accessor_type */
            "void".to_string()
        }
    }
}

/* Get the C type for accessor function return types */
pub fn get_c_accessor_type(resolved_type: &ResolvedType) -> String {
    match &resolved_type.kind {
        ResolvedTypeKind::Primitive { .. } => format_type_to_c(resolved_type),
        ResolvedTypeKind::Array { element_type, .. } => {
            format!("{} const *", format_type_to_c(element_type)) //pointer to element type
        }
        ResolvedTypeKind::TypeRef { target_name, .. } => {
            format!("{}_t const *", target_name) /* TypeRefs return pointer to the type */
        }
        _ => {
            /* For complex inline types (struct/union/enum), they have special handling
            in the accessor generation and don't use this function */
            panic!(
                "get_c_accessor_type called with unsupported type: {:?}",
                resolved_type.kind
            )
        }
    }
}

/// Emits shared checked arithmetic helpers used by generated C validators/builders.
pub fn emit_checked_arithmetic_helpers() -> &'static str {
    CHECKED_ARITH_HELPERS
}

const CHECKED_ARITH_HELPERS: &str = "/* Checked arithmetic helpers */\n\
static inline int tn_checked_add_u64( uint64_t a,\n\
                                      uint64_t b,\n\
                                      uint64_t * out ) {\n\
  if( !out ) return 1;\n\
  if( a > UINT64_MAX - b ) return 1;\n\
  *out = a + b;\n\
  return 0;\n\
}\n\
\n\
static inline int tn_checked_mul_u64( uint64_t a,\n\
                                      uint64_t b,\n\
                                      uint64_t * out ) {\n\
  if( !out ) return 1;\n\
  if( a && b > UINT64_MAX / a ) return 1;\n\
  *out = a * b;\n\
  return 0;\n\
}\n";

/* Helper function to check if a type is a nested complex type that needs its own footprint */
pub fn is_nested_complex_type(resolved_type: &ResolvedType) -> bool {
    matches!(
        resolved_type.kind,
        ResolvedTypeKind::Struct { .. }
            | ResolvedTypeKind::Union { .. }
            | ResolvedTypeKind::SizeDiscriminatedUnion { .. }
            | ResolvedTypeKind::Enum { .. }
    )
}
