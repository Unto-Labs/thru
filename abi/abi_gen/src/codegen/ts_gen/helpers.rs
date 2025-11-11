use crate::abi::expr::{ConstantExpression, ExprKind, LiteralExpr};
use crate::abi::resolved::{ResolvedType, ResolvedTypeKind};
use crate::abi::types::{FloatingPointType, IntegralType, PrimitiveType};

/* Convert primitive types to TypeScript types */
pub fn primitive_to_ts_type(prim_type: &PrimitiveType) -> &'static str {
  match prim_type {
    PrimitiveType::Integral(int_type) => match int_type {
      IntegralType::U8 | IntegralType::U16 | IntegralType::U32 | IntegralType::U64 => "number",
      IntegralType::I8 | IntegralType::I16 | IntegralType::I32 | IntegralType::I64 => "number",
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
    ResolvedTypeKind::Struct { .. } | ResolvedTypeKind::Union { .. } | ResolvedTypeKind::Enum { .. }
  )
}

/* Convert literal expression to string */
fn literal_to_string(lit: &LiteralExpr) -> String {
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

/* Convert expression to TypeScript string */
pub fn format_expr_to_ts(expr: &ExprKind, field_refs: &[String]) -> String {
  match expr {
    ExprKind::Literal(lit) => literal_to_string(lit),
    ExprKind::FieldRef(field_ref) => {
      let path = field_ref.path.join("_");
      /* Check both underscore and dot formats for compatibility */
      if field_refs.contains(&path) || field_refs.contains(&field_ref.path.join(".")) {
        path
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
    _ => "0 /* TODO: Expression */".to_string(),
  }
}

/* Escape TypeScript keywords */
pub fn escape_ts_keyword(name: &str) -> String {
  match name {
    "break" | "case" | "catch" | "class" | "const" | "continue" | "debugger" | "default" | "delete" | "do"
    | "else" | "enum" | "export" | "extends" | "false" | "finally" | "for" | "function" | "if" | "import"
    | "in" | "instanceof" | "new" | "null" | "return" | "super" | "switch" | "this" | "throw" | "true"
    | "try" | "typeof" | "var" | "void" | "while" | "with" | "as" | "implements" | "interface" | "let"
    | "package" | "private" | "protected" | "public" | "static" | "yield" | "any" | "boolean" | "constructor"
    | "declare" | "get" | "module" | "require" | "number" | "set" | "string" | "symbol" | "type" | "from"
    | "of" | "namespace" | "async" | "await" => format!("{}_", name),
    _ => name.to_string(),
  }
}

/* Convert resolved type to TypeScript type name */
pub fn format_type_to_ts(resolved_type: &ResolvedType) -> String {
  match &resolved_type.kind {
    ResolvedTypeKind::Primitive { prim_type } => primitive_to_ts_return_type(prim_type).to_string(),
    ResolvedTypeKind::TypeRef { target_name, .. } => target_name.clone(),
    ResolvedTypeKind::Array { element_type, .. } => {
      format!("{}[]", format_type_to_ts(element_type))
    }
    _ => resolved_type.name.clone(),
  }
}
