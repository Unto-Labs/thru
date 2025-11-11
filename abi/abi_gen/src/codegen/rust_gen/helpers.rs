/* Helper utilities for Rust code generation */

use crate::abi::expr::ExprKind;
use crate::abi::resolved::{ResolvedType, ResolvedTypeKind};
use crate::abi::types::{FloatingPointType, IntegralType, PrimitiveType};

/* Convert primitive type to Rust type string */
pub fn primitive_to_rust_type(prim_type: &PrimitiveType) -> &'static str {
  match prim_type {
    PrimitiveType::Integral(int_type) => match int_type {
      IntegralType::U8 => "u8",
      IntegralType::U16 => "u16",
      IntegralType::U32 => "u32",
      IntegralType::U64 => "u64",
      IntegralType::I8 => "i8",
      IntegralType::I16 => "i16",
      IntegralType::I32 => "i32",
      IntegralType::I64 => "i64",
    },
    PrimitiveType::FloatingPoint(float_type) => match float_type {
      FloatingPointType::F16 => "f16",
      FloatingPointType::F32 => "f32",
      FloatingPointType::F64 => "f64",
    },
  }
}

/* Escape Rust keywords to valid identifiers */
pub fn escape_rust_keyword(name: &str) -> String {
  const RUST_KEYWORDS: &[&str] = &[
    "as", "break", "const", "continue", "crate", "else", "enum", "extern",
    "false", "fn", "for", "if", "impl", "in", "let", "loop", "match", "mod",
    "move", "mut", "pub", "ref", "return", "self", "Self", "static", "struct",
    "super", "trait", "true", "type", "unsafe", "use", "where", "while",
    "async", "await", "dyn", "abstract", "become", "box", "do", "final",
    "macro", "override", "priv", "typeof", "unsized", "virtual", "yield", "try",
  ];

  if RUST_KEYWORDS.contains(&name) {
    format!("r#{}", name)
  } else {
    name.to_string()
  }
}

/* Format a resolved type to Rust type string */
pub fn format_type_to_rust(resolved_type: &ResolvedType) -> String {
  match &resolved_type.kind {
    ResolvedTypeKind::Primitive { prim_type } => {
      primitive_to_rust_type(prim_type).to_string()
    }
    ResolvedTypeKind::Array { element_type, .. } => {
      format_type_to_rust(element_type) /* For FAMs, just return element type */
    }
    ResolvedTypeKind::TypeRef { target_name, .. } => {
      format!("{}_t", target_name)
    }
    _ => "()".to_string(),
  }
}

/* Get Rust accessor return type */
pub fn get_rust_accessor_type(resolved_type: &ResolvedType) -> String {
  match &resolved_type.kind {
    ResolvedTypeKind::Primitive { .. } => format_type_to_rust(resolved_type),
    ResolvedTypeKind::Array { element_type, .. } => {
      format!("*const {}", format_type_to_rust(element_type))
    }
    ResolvedTypeKind::TypeRef { target_name, .. } => {
      format!("*const {}_t", target_name)
    }
    _ => {
      panic!("get_rust_accessor_type called with unsupported type: {:?}", resolved_type.kind)
    }
  }
}

/* Check if a type is a nested complex type that needs special handling */
pub fn is_nested_complex_type(resolved_type: &ResolvedType) -> bool {
  matches!(
    resolved_type.kind,
    ResolvedTypeKind::Struct { .. }
      | ResolvedTypeKind::Union { .. }
      | ResolvedTypeKind::SizeDiscriminatedUnion { .. }
      | ResolvedTypeKind::Enum { .. }
  )
}

/* Format expression to Rust code string */
pub fn format_expr_to_rust(expr: &ExprKind, params: &[String]) -> String {
  use crate::abi::expr::LiteralExpr;

  match expr {
    ExprKind::Literal(lit) => match lit {
      LiteralExpr::U64(v) => v.to_string(),
      LiteralExpr::U32(v) => v.to_string(),
      LiteralExpr::U16(v) => v.to_string(),
      LiteralExpr::U8(v) => v.to_string(),
      LiteralExpr::I64(v) => v.to_string(),
      LiteralExpr::I32(v) => v.to_string(),
      LiteralExpr::I16(v) => v.to_string(),
      LiteralExpr::I8(v) => v.to_string(),
    },
    ExprKind::FieldRef(field_ref) => {
      /* Convert field reference to parameter name */
      let field_path_underscore = field_ref.path.join("_");
      for param in params {
        if param == &field_path_underscore {
          return field_path_underscore;
        }
      }
      /* If not found in params, use dot notation for struct access */
      field_ref.path.join(".")
    }
    ExprKind::Sizeof(sizeof_expr) => format!("std::mem::size_of::<{}>()", sizeof_expr.type_name),
    ExprKind::Alignof(alignof_expr) => format!("std::mem::align_of::<{}>()", alignof_expr.type_name),

    /* Binary operations */
    ExprKind::Add(e) => format!("({} + {})", format_expr_to_rust(&e.left, params), format_expr_to_rust(&e.right, params)),
    ExprKind::Sub(e) => format!("({} - {})", format_expr_to_rust(&e.left, params), format_expr_to_rust(&e.right, params)),
    ExprKind::Mul(e) => format!("({} * {})", format_expr_to_rust(&e.left, params), format_expr_to_rust(&e.right, params)),
    ExprKind::Div(e) => format!("({} / {})", format_expr_to_rust(&e.left, params), format_expr_to_rust(&e.right, params)),
    ExprKind::Mod(e) => format!("({} % {})", format_expr_to_rust(&e.left, params), format_expr_to_rust(&e.right, params)),
    ExprKind::Pow(e) => format!("({}.pow({} as u32))", format_expr_to_rust(&e.left, params), format_expr_to_rust(&e.right, params)),

    /* Bitwise operations */
    ExprKind::BitAnd(e) => format!("({} & {})", format_expr_to_rust(&e.left, params), format_expr_to_rust(&e.right, params)),
    ExprKind::BitOr(e) => format!("({} | {})", format_expr_to_rust(&e.left, params), format_expr_to_rust(&e.right, params)),
    ExprKind::BitXor(e) => format!("({} ^ {})", format_expr_to_rust(&e.left, params), format_expr_to_rust(&e.right, params)),
    ExprKind::LeftShift(e) => format!("({} << {})", format_expr_to_rust(&e.left, params), format_expr_to_rust(&e.right, params)),
    ExprKind::RightShift(e) => format!("({} >> {})", format_expr_to_rust(&e.left, params), format_expr_to_rust(&e.right, params)),

    /* Unary operations */
    ExprKind::BitNot(e) => format!("!({})", format_expr_to_rust(&e.operand, params)),
    ExprKind::Neg(e) => format!("-({})", format_expr_to_rust(&e.operand, params)),
    ExprKind::Not(e) => format!("!({})", format_expr_to_rust(&e.operand, params)),
    ExprKind::Popcount(e) => format!("({}).count_ones()", format_expr_to_rust(&e.operand, params)),

    /* Comparison operations */
    ExprKind::Eq(e) => format!("({} == {})", format_expr_to_rust(&e.left, params), format_expr_to_rust(&e.right, params)),
    ExprKind::Ne(e) => format!("({} != {})", format_expr_to_rust(&e.left, params), format_expr_to_rust(&e.right, params)),
    ExprKind::Lt(e) => format!("({} < {})", format_expr_to_rust(&e.left, params), format_expr_to_rust(&e.right, params)),
    ExprKind::Gt(e) => format!("({} > {})", format_expr_to_rust(&e.left, params), format_expr_to_rust(&e.right, params)),
    ExprKind::Le(e) => format!("({} <= {})", format_expr_to_rust(&e.left, params), format_expr_to_rust(&e.right, params)),
    ExprKind::Ge(e) => format!("({} >= {})", format_expr_to_rust(&e.left, params), format_expr_to_rust(&e.right, params)),

    /* Logical operations */
    ExprKind::And(e) => format!("({} && {})", format_expr_to_rust(&e.left, params), format_expr_to_rust(&e.right, params)),
    ExprKind::Or(e) => format!("({} || {})", format_expr_to_rust(&e.left, params), format_expr_to_rust(&e.right, params)),
    ExprKind::Xor(e) => format!("(({}) != ({}))", format_expr_to_rust(&e.left, params), format_expr_to_rust(&e.right, params)),
  }
}

/* Generate code to read a nested field reference */
pub fn generate_nested_field_access(field_ref: &str, _type_name: &str, prim_type: &PrimitiveType) -> String {
  let mut output = String::new();
  let var_name = field_ref.replace('.', "_");
  let rust_type = primitive_to_rust_type(prim_type);

  /* Read field directly using unsafe pointer cast */
  output.push_str(&format!("  let {} = unsafe {{\n", var_name));
  output.push_str(&format!("    std::ptr::read_unaligned(std::ptr::addr_of!((*self).{}) as *const {})\n", field_ref, rust_type));
  output.push_str("  };\n");

  output
}
