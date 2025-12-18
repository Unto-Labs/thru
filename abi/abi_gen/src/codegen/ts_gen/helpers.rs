use crate::abi::expr::{ConstantExpression, ExprKind, LiteralExpr};
use crate::abi::resolved::{ResolvedType, ResolvedTypeKind, Size};
use crate::abi::types::{FloatingPointType, IntegralType, PrimitiveType};

/* Convert primitive types to TypeScript types */
pub fn primitive_to_ts_type(prim_type: &PrimitiveType) -> &'static str {
    match prim_type {
        PrimitiveType::Integral(int_type) => match int_type {
            IntegralType::U8 | IntegralType::U16 | IntegralType::U32 | IntegralType::U64 => {
                "number"
            }
            IntegralType::I8 | IntegralType::I16 | IntegralType::I32 | IntegralType::I64 => {
                "number"
            }
        },
        PrimitiveType::FloatingPoint(_) => "number",
    }
}

/* Convert primitive types to DataView method names for reading */
pub fn primitive_to_dataview_getter(prim_type: &PrimitiveType) -> &'static str {
    match prim_type {
        PrimitiveType::Integral(int_type) => match int_type {
            IntegralType::U8 => "getUint8",
            IntegralType::U16 => "getUint16",
            IntegralType::U32 => "getUint32",
            IntegralType::U64 => "getBigUint64",
            IntegralType::I8 => "getInt8",
            IntegralType::I16 => "getInt16",
            IntegralType::I32 => "getInt32",
            IntegralType::I64 => "getBigInt64",
        },
        PrimitiveType::FloatingPoint(float_type) => match float_type {
            FloatingPointType::F16 => "getFloat16", /* Note: Not widely supported */
            FloatingPointType::F32 => "getFloat32",
            FloatingPointType::F64 => "getFloat64",
        },
    }
}

/* Convert primitive types to DataView method names for writing */
pub fn primitive_to_dataview_setter(prim_type: &PrimitiveType) -> &'static str {
    match prim_type {
        PrimitiveType::Integral(int_type) => match int_type {
            IntegralType::U8 => "setUint8",
            IntegralType::U16 => "setUint16",
            IntegralType::U32 => "setUint32",
            IntegralType::U64 => "setBigUint64",
            IntegralType::I8 => "setInt8",
            IntegralType::I16 => "setInt16",
            IntegralType::I32 => "setInt32",
            IntegralType::I64 => "setBigInt64",
        },
        PrimitiveType::FloatingPoint(float_type) => match float_type {
            FloatingPointType::F16 => "setFloat16", /* Note: Not widely supported */
            FloatingPointType::F32 => "setFloat32",
            FloatingPointType::F64 => "setFloat64",
        },
    }
}

/* Get the TypeScript type for return values (handles BigInt for 64-bit integers) */
pub fn primitive_to_ts_return_type(prim_type: &PrimitiveType) -> &'static str {
    match prim_type {
        PrimitiveType::Integral(int_type) => match int_type {
            IntegralType::U64 | IntegralType::I64 => "bigint",
            _ => "number",
        },
        PrimitiveType::FloatingPoint(_) => "number",
    }
}

/* Get primitive size in bytes */
pub fn primitive_size(prim_type: &PrimitiveType) -> u64 {
    match prim_type {
        PrimitiveType::Integral(int_type) => match int_type {
            IntegralType::U8 | IntegralType::I8 => 1,
            IntegralType::U16 | IntegralType::I16 => 2,
            IntegralType::U32 | IntegralType::I32 => 4,
            IntegralType::U64 | IntegralType::I64 => 8,
        },
        PrimitiveType::FloatingPoint(float_type) => match float_type {
            FloatingPointType::F16 => 2,
            FloatingPointType::F32 => 4,
            FloatingPointType::F64 => 8,
        },
    }
}

/* Check if a primitive type needs endianness argument in DataView methods */
pub fn needs_endianness_arg(prim_type: &PrimitiveType) -> bool {
    /* Single-byte types (U8, I8) don't need endianness argument */
    !matches!(
        prim_type,
        PrimitiveType::Integral(IntegralType::U8) | PrimitiveType::Integral(IntegralType::I8)
    )
}

/* Check if a type is a complex nested type that needs separate class definition */
pub fn is_nested_complex_type(resolved_type: &ResolvedType) -> bool {
    matches!(
        &resolved_type.kind,
        ResolvedTypeKind::Struct { .. }
            | ResolvedTypeKind::Union { .. }
            | ResolvedTypeKind::Enum { .. }
    )
}

/* Convert literal expression to string */
pub fn literal_to_string(lit: &LiteralExpr) -> String {
    match lit {
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

/* Convert literal expression to BigInt-compatible string (with 'n' suffix) */
pub fn literal_to_bigint_string(lit: &LiteralExpr) -> String {
    match lit {
        LiteralExpr::U64(v) => format!("{}n", v),
        LiteralExpr::U32(v) => format!("{}n", v),
        LiteralExpr::U16(v) => format!("{}n", v),
        LiteralExpr::U8(v) => format!("{}n", v),
        LiteralExpr::I64(v) => format!("{}n", v),
        LiteralExpr::I32(v) => format!("{}n", v),
        LiteralExpr::I16(v) => format!("{}n", v),
        LiteralExpr::I8(v) => format!("{}n", v),
    }
}

/* Convert expression to TypeScript string */
pub fn format_expr_to_ts(expr: &ExprKind, field_refs: &[String]) -> String {
    match expr {
        ExprKind::Literal(lit) => literal_to_string(lit),
        ExprKind::FieldRef(field_ref) => {
            let path = field_ref.path.join("_");
            let dotted = field_ref.path.join(".");
            if field_refs.is_empty() {
                return path;
            }
            let alias = resolve_param_alias(&path, field_refs);
            if field_refs.contains(&alias) {
                alias
            } else if field_refs.contains(&dotted) {
                dotted
            } else {
                format!("/* constant field ref: {} */", path)
            }
        }
        ExprKind::Add(expr) => {
            let lhs_str = format_expr_to_ts(&expr.left, field_refs);
            let rhs_str = format_expr_to_ts(&expr.right, field_refs);
            format!("({} + {})", lhs_str, rhs_str)
        }
        ExprKind::Sub(expr) => {
            let lhs_str = format_expr_to_ts(&expr.left, field_refs);
            let rhs_str = format_expr_to_ts(&expr.right, field_refs);
            format!("({} - {})", lhs_str, rhs_str)
        }
        ExprKind::Mul(expr) => {
            let lhs_str = format_expr_to_ts(&expr.left, field_refs);
            let rhs_str = format_expr_to_ts(&expr.right, field_refs);
            format!("({} * {})", lhs_str, rhs_str)
        }
        ExprKind::Div(expr) => {
            let lhs_str = format_expr_to_ts(&expr.left, field_refs);
            let rhs_str = format_expr_to_ts(&expr.right, field_refs);
            format!("({} / {})", lhs_str, rhs_str)
        }
        ExprKind::Neg(expr) => {
            let operand_str = format_expr_to_ts(&expr.operand, field_refs);
            format!("(-{})", operand_str)
        }
        ExprKind::Mod(expr) => {
            let lhs_str = format_expr_to_ts(&expr.left, field_refs);
            let rhs_str = format_expr_to_ts(&expr.right, field_refs);
            format!("({} % {})", lhs_str, rhs_str)
        }
        ExprKind::BitAnd(expr) => {
            let lhs_str = format_expr_to_ts(&expr.left, field_refs);
            let rhs_str = format_expr_to_ts(&expr.right, field_refs);
            format!("({} & {})", lhs_str, rhs_str)
        }
        ExprKind::BitOr(expr) => {
            let lhs_str = format_expr_to_ts(&expr.left, field_refs);
            let rhs_str = format_expr_to_ts(&expr.right, field_refs);
            format!("({} | {})", lhs_str, rhs_str)
        }
        ExprKind::BitXor(expr) => {
            let lhs_str = format_expr_to_ts(&expr.left, field_refs);
            let rhs_str = format_expr_to_ts(&expr.right, field_refs);
            format!("({} ^ {})", lhs_str, rhs_str)
        }
        ExprKind::LeftShift(expr) => {
            let lhs_str = format_expr_to_ts(&expr.left, field_refs);
            let rhs_str = format_expr_to_ts(&expr.right, field_refs);
            format!("({} << {})", lhs_str, rhs_str)
        }
        ExprKind::RightShift(expr) => {
            let lhs_str = format_expr_to_ts(&expr.left, field_refs);
            let rhs_str = format_expr_to_ts(&expr.right, field_refs);
            format!("({} >> {})", lhs_str, rhs_str)
        }
        ExprKind::BitNot(expr) => {
            let operand = format_expr_to_ts(&expr.operand, field_refs);
            format!("(~{})", operand)
        }
        ExprKind::Popcount(expr) => {
            let operand = format_expr_to_ts(&expr.operand, field_refs);
            format!("__tnPopcount({})", operand)
        }
        ExprKind::Not(expr) => {
            let operand = format_expr_to_ts(&expr.operand, field_refs);
            format!("(Number(!({})))", operand)
        }
        _ => "0".to_string(),
    }
}

pub fn resolve_param_alias(candidate: &str, params: &[String]) -> String {
    if params.iter().any(|name| name == candidate) {
        return candidate.to_string();
    }
    params
        .iter()
        .find(|name| {
            name.len() > candidate.len()
                && name.ends_with(candidate)
                && name
                    .as_bytes()
                    .get(name.len() - candidate.len() - 1)
                    .map(|b| *b == b'_')
                    .unwrap_or(false)
        })
        .cloned()
        .unwrap_or_else(|| candidate.to_string())
}

pub fn collect_field_value_refs(expr: &ExprKind) -> Vec<String> {
    let mut refs = Vec::new();
    collect_field_value_refs_inner(expr, &mut refs);
    refs.sort();
    refs.dedup();
    refs
}

fn collect_field_value_refs_inner(expr: &ExprKind, refs: &mut Vec<String>) {
    match expr {
        ExprKind::FieldRef(field_ref) => {
            if let Some(head) = field_ref.path.first() {
                refs.push(head.clone());
            }
        }
        ExprKind::Add(e) => {
            collect_field_value_refs_inner(&e.left, refs);
            collect_field_value_refs_inner(&e.right, refs);
        }
        ExprKind::Sub(e) => {
            collect_field_value_refs_inner(&e.left, refs);
            collect_field_value_refs_inner(&e.right, refs);
        }
        ExprKind::Mul(e) => {
            collect_field_value_refs_inner(&e.left, refs);
            collect_field_value_refs_inner(&e.right, refs);
        }
        ExprKind::Div(e) => {
            collect_field_value_refs_inner(&e.left, refs);
            collect_field_value_refs_inner(&e.right, refs);
        }
        ExprKind::Mod(e) => {
            collect_field_value_refs_inner(&e.left, refs);
            collect_field_value_refs_inner(&e.right, refs);
        }
        ExprKind::BitAnd(e) => {
            collect_field_value_refs_inner(&e.left, refs);
            collect_field_value_refs_inner(&e.right, refs);
        }
        ExprKind::BitOr(e) => {
            collect_field_value_refs_inner(&e.left, refs);
            collect_field_value_refs_inner(&e.right, refs);
        }
        ExprKind::BitXor(e) => {
            collect_field_value_refs_inner(&e.left, refs);
            collect_field_value_refs_inner(&e.right, refs);
        }
        ExprKind::LeftShift(e) => {
            collect_field_value_refs_inner(&e.left, refs);
            collect_field_value_refs_inner(&e.right, refs);
        }
        ExprKind::RightShift(e) => {
            collect_field_value_refs_inner(&e.left, refs);
            collect_field_value_refs_inner(&e.right, refs);
        }
        ExprKind::Pow(e) => {
            collect_field_value_refs_inner(&e.left, refs);
            collect_field_value_refs_inner(&e.right, refs);
        }
        ExprKind::BitNot(e) => {
            collect_field_value_refs_inner(&e.operand, refs);
        }
        ExprKind::Neg(e) => {
            collect_field_value_refs_inner(&e.operand, refs);
        }
        ExprKind::Not(e) => {
            collect_field_value_refs_inner(&e.operand, refs);
        }
        ExprKind::Popcount(e) => {
            collect_field_value_refs_inner(&e.operand, refs);
        }
        _ => {}
    }
}

pub fn collect_field_ref_paths(expr: &ExprKind) -> Vec<Vec<String>> {
    fn inner(expr: &ExprKind, refs: &mut Vec<Vec<String>>) {
        match expr {
            ExprKind::FieldRef(field_ref) => refs.push(field_ref.path.clone()),
            ExprKind::Add(e) => {
                inner(&e.left, refs);
                inner(&e.right, refs);
            }
            ExprKind::Sub(e) => {
                inner(&e.left, refs);
                inner(&e.right, refs);
            }
            ExprKind::Mul(e) => {
                inner(&e.left, refs);
                inner(&e.right, refs);
            }
            ExprKind::Div(e) => {
                inner(&e.left, refs);
                inner(&e.right, refs);
            }
            ExprKind::Mod(e) => {
                inner(&e.left, refs);
                inner(&e.right, refs);
            }
            ExprKind::Pow(e) => {
                inner(&e.left, refs);
                inner(&e.right, refs);
            }
            ExprKind::BitAnd(e) => {
                inner(&e.left, refs);
                inner(&e.right, refs);
            }
            ExprKind::BitOr(e) => {
                inner(&e.left, refs);
                inner(&e.right, refs);
            }
            ExprKind::BitXor(e) => {
                inner(&e.left, refs);
                inner(&e.right, refs);
            }
            ExprKind::LeftShift(e) => {
                inner(&e.left, refs);
                inner(&e.right, refs);
            }
            ExprKind::RightShift(e) => {
                inner(&e.left, refs);
                inner(&e.right, refs);
            }
            ExprKind::BitNot(e) => inner(&e.operand, refs),
            ExprKind::Neg(e) => inner(&e.operand, refs),
            ExprKind::Not(e) => inner(&e.operand, refs),
            ExprKind::Popcount(e) => inner(&e.operand, refs),
            _ => {}
        }
    }

    let mut refs = Vec::new();
    inner(expr, &mut refs);
    refs.sort();
    refs.dedup();
    refs
}

pub fn sequential_size_expression(expr: &ExprKind) -> Option<String> {
    match expr {
        ExprKind::Literal(lit) => Some(literal_to_string(lit)),
        ExprKind::FieldRef(field_ref) => field_ref
            .path
            .first()
            .map(|seg| format!("Number(__tnFieldValue_{})", escape_ts_keyword(seg))),
        ExprKind::Add(e) => Some(format!(
            "({} + {})",
            sequential_size_expression(&e.left)?,
            sequential_size_expression(&e.right)?
        )),
        ExprKind::Sub(e) => Some(format!(
            "({} - {})",
            sequential_size_expression(&e.left)?,
            sequential_size_expression(&e.right)?
        )),
        ExprKind::Mul(e) => Some(format!(
            "({} * {})",
            sequential_size_expression(&e.left)?,
            sequential_size_expression(&e.right)?
        )),
        ExprKind::Div(e) => Some(format!(
            "({} / {})",
            sequential_size_expression(&e.left)?,
            sequential_size_expression(&e.right)?
        )),
        ExprKind::Mod(e) => Some(format!(
            "({} % {})",
            sequential_size_expression(&e.left)?,
            sequential_size_expression(&e.right)?
        )),
        ExprKind::BitAnd(e) => Some(format!(
            "({} & {})",
            sequential_size_expression(&e.left)?,
            sequential_size_expression(&e.right)?
        )),
        ExprKind::BitOr(e) => Some(format!(
            "({} | {})",
            sequential_size_expression(&e.left)?,
            sequential_size_expression(&e.right)?
        )),
        ExprKind::BitXor(e) => Some(format!(
            "({} ^ {})",
            sequential_size_expression(&e.left)?,
            sequential_size_expression(&e.right)?
        )),
        ExprKind::LeftShift(e) => Some(format!(
            "({} << {})",
            sequential_size_expression(&e.left)?,
            sequential_size_expression(&e.right)?
        )),
        ExprKind::RightShift(e) => Some(format!(
            "({} >> {})",
            sequential_size_expression(&e.left)?,
            sequential_size_expression(&e.right)?
        )),
        ExprKind::BitNot(e) => Some(format!("(~({}))", sequential_size_expression(&e.operand)?)),
        ExprKind::Neg(e) => Some(format!("(-({}))", sequential_size_expression(&e.operand)?)),
        ExprKind::Not(e) => Some(format!(
            "(Number(!({})))",
            sequential_size_expression(&e.operand)?
        )),
        _ => None,
    }
}

pub fn expr_to_ts_with_resolver<F>(expr: &ExprKind, resolver: &mut F) -> Option<String>
where
    F: FnMut(&[String]) -> Option<String>,
{
    match expr {
        ExprKind::Literal(lit) => Some(literal_to_string(lit)),
        ExprKind::FieldRef(field_ref) => resolver(&field_ref.path),
        ExprKind::Add(e) => Some(format!(
            "({} + {})",
            expr_to_ts_with_resolver(&e.left, resolver)?,
            expr_to_ts_with_resolver(&e.right, resolver)?
        )),
        ExprKind::Sub(e) => Some(format!(
            "({} - {})",
            expr_to_ts_with_resolver(&e.left, resolver)?,
            expr_to_ts_with_resolver(&e.right, resolver)?
        )),
        ExprKind::Mul(e) => Some(format!(
            "({} * {})",
            expr_to_ts_with_resolver(&e.left, resolver)?,
            expr_to_ts_with_resolver(&e.right, resolver)?
        )),
        ExprKind::Div(e) => Some(format!(
            "({} / {})",
            expr_to_ts_with_resolver(&e.left, resolver)?,
            expr_to_ts_with_resolver(&e.right, resolver)?
        )),
        ExprKind::Mod(e) => Some(format!(
            "({} % {})",
            expr_to_ts_with_resolver(&e.left, resolver)?,
            expr_to_ts_with_resolver(&e.right, resolver)?
        )),
        ExprKind::BitAnd(e) => Some(format!(
            "({} & {})",
            expr_to_ts_with_resolver(&e.left, resolver)?,
            expr_to_ts_with_resolver(&e.right, resolver)?
        )),
        ExprKind::BitOr(e) => Some(format!(
            "({} | {})",
            expr_to_ts_with_resolver(&e.left, resolver)?,
            expr_to_ts_with_resolver(&e.right, resolver)?
        )),
        ExprKind::BitXor(e) => Some(format!(
            "({} ^ {})",
            expr_to_ts_with_resolver(&e.left, resolver)?,
            expr_to_ts_with_resolver(&e.right, resolver)?
        )),
        ExprKind::LeftShift(e) => Some(format!(
            "({} << {})",
            expr_to_ts_with_resolver(&e.left, resolver)?,
            expr_to_ts_with_resolver(&e.right, resolver)?
        )),
        ExprKind::RightShift(e) => Some(format!(
            "({} >> {})",
            expr_to_ts_with_resolver(&e.left, resolver)?,
            expr_to_ts_with_resolver(&e.right, resolver)?
        )),
        ExprKind::BitNot(e) => Some(format!(
            "(~({}))",
            expr_to_ts_with_resolver(&e.operand, resolver)?
        )),
        ExprKind::Neg(e) => Some(format!(
            "(-({}))",
            expr_to_ts_with_resolver(&e.operand, resolver)?
        )),
        ExprKind::Not(e) => Some(format!(
            "(Number(!({})))",
            expr_to_ts_with_resolver(&e.operand, resolver)?
        )),
        ExprKind::Popcount(e) => Some(format!(
            "(__tnPopcount({}))",
            expr_to_ts_with_resolver(&e.operand, resolver)?
        )),
        _ => None,
    }
}

/// Convert expression to TypeScript string with BigInt literals.
///
/// This is similar to `expr_to_ts_with_resolver` but uses BigInt-compatible
/// literals (e.g., `62n` instead of `62`) so that bitwise operations work
/// correctly with 64-bit field values.
///
/// JavaScript's bitwise operators on Number are limited to 32 bits and will
/// truncate larger values. By using BigInt literals, we ensure that operations
/// like `value >> 62n` work correctly for 64-bit values.
pub fn expr_to_ts_bigint_with_resolver<F>(expr: &ExprKind, resolver: &mut F) -> Option<String>
where
    F: FnMut(&[String]) -> Option<String>,
{
    match expr {
        ExprKind::Literal(lit) => Some(literal_to_bigint_string(lit)),
        ExprKind::FieldRef(field_ref) => resolver(&field_ref.path),
        ExprKind::Add(e) => Some(format!(
            "({} + {})",
            expr_to_ts_bigint_with_resolver(&e.left, resolver)?,
            expr_to_ts_bigint_with_resolver(&e.right, resolver)?
        )),
        ExprKind::Sub(e) => Some(format!(
            "({} - {})",
            expr_to_ts_bigint_with_resolver(&e.left, resolver)?,
            expr_to_ts_bigint_with_resolver(&e.right, resolver)?
        )),
        ExprKind::Mul(e) => Some(format!(
            "({} * {})",
            expr_to_ts_bigint_with_resolver(&e.left, resolver)?,
            expr_to_ts_bigint_with_resolver(&e.right, resolver)?
        )),
        ExprKind::Div(e) => Some(format!(
            "({} / {})",
            expr_to_ts_bigint_with_resolver(&e.left, resolver)?,
            expr_to_ts_bigint_with_resolver(&e.right, resolver)?
        )),
        ExprKind::Mod(e) => Some(format!(
            "({} % {})",
            expr_to_ts_bigint_with_resolver(&e.left, resolver)?,
            expr_to_ts_bigint_with_resolver(&e.right, resolver)?
        )),
        ExprKind::BitAnd(e) => Some(format!(
            "({} & {})",
            expr_to_ts_bigint_with_resolver(&e.left, resolver)?,
            expr_to_ts_bigint_with_resolver(&e.right, resolver)?
        )),
        ExprKind::BitOr(e) => Some(format!(
            "({} | {})",
            expr_to_ts_bigint_with_resolver(&e.left, resolver)?,
            expr_to_ts_bigint_with_resolver(&e.right, resolver)?
        )),
        ExprKind::BitXor(e) => Some(format!(
            "({} ^ {})",
            expr_to_ts_bigint_with_resolver(&e.left, resolver)?,
            expr_to_ts_bigint_with_resolver(&e.right, resolver)?
        )),
        ExprKind::LeftShift(e) => Some(format!(
            "({} << {})",
            expr_to_ts_bigint_with_resolver(&e.left, resolver)?,
            expr_to_ts_bigint_with_resolver(&e.right, resolver)?
        )),
        ExprKind::RightShift(e) => Some(format!(
            "({} >> {})",
            expr_to_ts_bigint_with_resolver(&e.left, resolver)?,
            expr_to_ts_bigint_with_resolver(&e.right, resolver)?
        )),
        ExprKind::BitNot(e) => Some(format!(
            "(~({}))",
            expr_to_ts_bigint_with_resolver(&e.operand, resolver)?
        )),
        ExprKind::Neg(e) => Some(format!(
            "(-({}))",
            expr_to_ts_bigint_with_resolver(&e.operand, resolver)?
        )),
        ExprKind::Not(e) => Some(format!(
            "(Number(!({})))",
            expr_to_ts_bigint_with_resolver(&e.operand, resolver)?
        )),
        ExprKind::Popcount(e) => Some(format!(
            "(__tnPopcount({}))",
            expr_to_ts_bigint_with_resolver(&e.operand, resolver)?
        )),
        _ => None,
    }
}

/* Escape TypeScript keywords */
pub fn escape_ts_keyword(name: &str) -> String {
    match name {
        "break" | "case" | "catch" | "class" | "const" | "continue" | "debugger" | "default"
        | "delete" | "do" | "else" | "enum" | "export" | "extends" | "false" | "finally"
        | "for" | "function" | "if" | "import" | "in" | "instanceof" | "new" | "null"
        | "return" | "super" | "switch" | "this" | "throw" | "true" | "try" | "typeof" | "var"
        | "void" | "while" | "with" | "as" | "implements" | "interface" | "let" | "package"
        | "private" | "protected" | "public" | "static" | "yield" | "any" | "boolean"
        | "constructor" | "declare" | "get" | "module" | "require" | "number" | "set"
        | "string" | "symbol" | "type" | "from" | "of" | "namespace" | "async" | "await" => {
            format!("{}_", name)
        }
        _ => name.to_string(),
    }
}

/* Convert resolved type to TypeScript type name */
pub fn format_type_to_ts(resolved_type: &ResolvedType) -> String {
    match &resolved_type.kind {
        ResolvedTypeKind::Primitive { prim_type } => {
            primitive_to_ts_return_type(prim_type).to_string()
        }
        ResolvedTypeKind::TypeRef { target_name, .. } => target_name.clone(),
        ResolvedTypeKind::Array { element_type, .. } => {
            format!("{}[]", format_type_to_ts(element_type))
        }
        _ => resolved_type.name.clone(),
    }
}

pub fn sanitize_type_ident(name: &str) -> String {
    name.chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .collect()
}

pub fn generated_type_ident(name: &str) -> String {
    if name.contains("::") {
        let collapsed = name.replace("::", "_");
        let ident = format!("{}_Inner", collapsed);
        escape_ts_keyword(&sanitize_type_ident(&ident))
    } else {
        escape_ts_keyword(&sanitize_type_ident(name))
    }
}

pub fn align_up(value: u64, alignment: u64) -> u64 {
    if alignment <= 1 {
        return value;
    }
    let remainder = value % alignment;
    if remainder == 0 {
        value
    } else {
        value + (alignment - remainder)
    }
}

pub fn struct_field_const_offset(struct_type: &ResolvedType, field_name: &str) -> Option<u64> {
    let ResolvedTypeKind::Struct { fields, packed, .. } = &struct_type.kind else {
        return None;
    };
    let mut offset = 0u64;
    for field in fields {
        let align = if *packed {
            1
        } else {
            field.field_type.alignment.max(1)
        };
        offset = align_up(offset, align);
        if field.name == field_name {
            return Some(offset);
        }
        match field.field_type.size {
            Size::Const(sz) => {
                offset = offset.saturating_add(sz);
            }
            Size::Variable(_) => {
                return None;
            }
        }
    }
    None
}

pub fn to_camel_case(input: &str) -> String {
    let mut out = String::new();
    for segment in input.split(|c: char| c == '_' || c == '-' || c == ' ') {
        if segment.is_empty() {
            continue;
        }
        let mut chars = segment.chars();
        if let Some(first) = chars.next() {
            out.push(first.to_ascii_uppercase());
            for ch in chars {
                out.push(ch.to_ascii_lowercase());
            }
        }
    }
    out
}

pub fn to_lower_camel_case(input: &str) -> String {
    let upper = to_camel_case(input);
    let mut chars = upper.chars();
    if let Some(first) = chars.next() {
        let mut out = String::new();
        out.push(first.to_ascii_lowercase());
        out.extend(chars);
        out
    } else {
        String::new()
    }
}

/// Collect field reference paths from enum variant structs' FAM size expressions.
/// These are the parent field refs that inner variant classes will need to resolve.
pub fn collect_enum_variant_fam_refs(
    variants: &[crate::abi::resolved::ResolvedEnumVariant],
) -> Vec<Vec<String>> {
    use crate::abi::resolved::ResolvedTypeKind;

    let mut refs = Vec::new();

    for variant in variants {
        collect_struct_fam_refs(&variant.variant_type, &mut refs);
    }

    // Deduplicate
    refs.sort();
    refs.dedup();
    refs
}

fn collect_struct_fam_refs(ty: &crate::abi::resolved::ResolvedType, refs: &mut Vec<Vec<String>>) {
    use crate::abi::resolved::ResolvedTypeKind;

    if let ResolvedTypeKind::Struct { fields, .. } = &ty.kind {
        for field in fields {
            // Check if this field is a variable-size array (FAM)
            if let ResolvedTypeKind::Array {
                size_expression,
                size_constant_status,
                ..
            } = &field.field_type.kind
            {
                if !matches!(
                    size_constant_status,
                    crate::abi::resolved::ConstantStatus::Constant
                ) {
                    // Collect field refs from the size expression
                    refs.extend(collect_field_ref_paths(size_expression));
                }
            }
            // Recurse into nested structs
            collect_struct_fam_refs(&field.field_type, refs);
        }
    }
}
