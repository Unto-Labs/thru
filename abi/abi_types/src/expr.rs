use serde::de::{Deserializer, Error as DeError};
use serde_derive::{Deserialize, Serialize};

pub trait ConstantExpression {
    fn is_constant(&self) -> bool;
}

impl ConstantExpression for ExprKind {
    fn is_constant(&self) -> bool {
        match self {
            ExprKind::Literal(_) => true,
            ExprKind::FieldRef(_) => false, // Field references are never constant
            ExprKind::Sizeof(_) => true,    // Sizeof is constant once types are resolved
            ExprKind::Alignof(_) => true,   // Alignof is constant once types are resolved

            // Binary operations are constant if both operands are constant
            ExprKind::Add(expr) => expr.left.is_constant() && expr.right.is_constant(),
            ExprKind::Sub(expr) => expr.left.is_constant() && expr.right.is_constant(),
            ExprKind::Mul(expr) => expr.left.is_constant() && expr.right.is_constant(),
            ExprKind::Div(expr) => expr.left.is_constant() && expr.right.is_constant(),
            ExprKind::Mod(expr) => expr.left.is_constant() && expr.right.is_constant(),
            ExprKind::Pow(expr) => expr.left.is_constant() && expr.right.is_constant(),

            ExprKind::BitAnd(expr) => expr.left.is_constant() && expr.right.is_constant(),
            ExprKind::BitOr(expr) => expr.left.is_constant() && expr.right.is_constant(),
            ExprKind::BitXor(expr) => expr.left.is_constant() && expr.right.is_constant(),
            ExprKind::LeftShift(expr) => expr.left.is_constant() && expr.right.is_constant(),
            ExprKind::RightShift(expr) => expr.left.is_constant() && expr.right.is_constant(),

            ExprKind::Eq(expr) => expr.left.is_constant() && expr.right.is_constant(),
            ExprKind::Ne(expr) => expr.left.is_constant() && expr.right.is_constant(),
            ExprKind::Lt(expr) => expr.left.is_constant() && expr.right.is_constant(),
            ExprKind::Gt(expr) => expr.left.is_constant() && expr.right.is_constant(),
            ExprKind::Le(expr) => expr.left.is_constant() && expr.right.is_constant(),
            ExprKind::Ge(expr) => expr.left.is_constant() && expr.right.is_constant(),

            ExprKind::And(expr) => expr.left.is_constant() && expr.right.is_constant(),
            ExprKind::Or(expr) => expr.left.is_constant() && expr.right.is_constant(),
            ExprKind::Xor(expr) => expr.left.is_constant() && expr.right.is_constant(),

            // Unary operations are constant if the operand is constant
            ExprKind::BitNot(expr) => expr.operand.is_constant(),
            ExprKind::Neg(expr) => expr.operand.is_constant(),
            ExprKind::Not(expr) => expr.operand.is_constant(),
            ExprKind::Popcount(expr) => expr.operand.is_constant(),
        }
    }
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub enum ExprKind {
    Literal(LiteralExpr),
    FieldRef(FieldRefExpr),
    Sizeof(SizeofExpr),
    Alignof(AlignofExpr),

    // Binary ops
    Add(AddExpr),
    Sub(SubExpr),
    Mul(MulExpr),
    Div(DivExpr),
    Mod(ModExpr),
    Pow(PowExpr),

    // Bitwise ops
    BitAnd(BitAndExpr),
    BitOr(BitOrExpr),
    BitXor(BitXorExpr),
    LeftShift(LeftShiftExpr),
    RightShift(RightShiftExpr),

    // Unary ops
    BitNot(BitNotExpr),
    Neg(NegExpr),
    Not(NotExpr),
    Popcount(PopcountExpr),

    // Comparison ops
    Eq(EqExpr),
    Ne(NeExpr),
    Lt(LtExpr),
    Gt(GtExpr),
    Le(LeExpr),
    Ge(GeExpr),

    // Logical ops
    And(AndExpr),
    Or(OrExpr),
    Xor(XorExpr),
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub enum LiteralExpr {
    U64(u64),
    U32(u32),
    U16(u16),
    U8(u8),
    I64(i64),
    I32(i32),
    I16(i16),
    I8(i8),
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct FieldRefExpr {
    #[serde(deserialize_with = "deserialize_field_path")]
    pub path: Vec<String>, // Path to the field, e.g., ["parent", "field"] for parent.field
}

impl FieldRefExpr {
    /// Convert the field reference path to C field access syntax
    /// Handles paths like ["../tag"] or ["../hdr/type_slot"] and converts them to "tag" or "hdr.type_slot"
    pub fn to_c_field_access(&self) -> String {
        let tag_path: Vec<String> = self
            .path
            .iter()
            .flat_map(|s| s.split('/'))
            .map(|s| s.trim_start_matches(".."))
            .filter(|s| !s.is_empty())
            .fold(Vec::new(), |mut acc, seg| {
                if seg.chars().all(|c| c.is_ascii_digit()) {
                    let formatted = format!("[{}]", seg);
                    if let Some(last) = acc.last_mut() {
                        last.push_str(&formatted);
                    } else {
                        acc.push(formatted);
                    }
                } else {
                    acc.push(seg.to_string());
                }
                acc
            });

        if tag_path.is_empty() {
            "tag".to_string()
        } else {
            tag_path.join(".")
        }
    }
}

#[derive(Deserialize)]
#[serde(untagged)]
enum FieldPathSegmentValue {
    Str(String),
    Unsigned(u64),
    Signed(i64),
}

fn deserialize_field_path<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: Deserializer<'de>,
{
    let segments: Vec<FieldPathSegmentValue> = serde::Deserialize::deserialize(deserializer)?;
    let mut out = Vec::with_capacity(segments.len());
    for seg in segments {
        let value = match seg {
            FieldPathSegmentValue::Str(s) => s,
            FieldPathSegmentValue::Unsigned(u) => u.to_string(),
            FieldPathSegmentValue::Signed(i) => i.to_string(),
        };
        if value.is_empty() {
            return Err(DeError::custom("field-ref path segments cannot be empty"));
        }
        out.push(value);
    }
    Ok(out)
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct SizeofExpr {
    pub type_name: String, // Name of the type to get size of
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct AlignofExpr {
    pub type_name: String, // Name of the type to get alignment of
}

// Binary arithmetic operations
#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct AddExpr {
    pub left: Box<ExprKind>,
    pub right: Box<ExprKind>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct SubExpr {
    pub left: Box<ExprKind>,
    pub right: Box<ExprKind>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct MulExpr {
    pub left: Box<ExprKind>,
    pub right: Box<ExprKind>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct DivExpr {
    pub left: Box<ExprKind>,
    pub right: Box<ExprKind>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct ModExpr {
    pub left: Box<ExprKind>,
    pub right: Box<ExprKind>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct PowExpr {
    pub left: Box<ExprKind>,
    pub right: Box<ExprKind>,
}

// Bitwise operations
#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct BitAndExpr {
    pub left: Box<ExprKind>,
    pub right: Box<ExprKind>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct BitOrExpr {
    pub left: Box<ExprKind>,
    pub right: Box<ExprKind>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct BitXorExpr {
    pub left: Box<ExprKind>,
    pub right: Box<ExprKind>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct LeftShiftExpr {
    pub left: Box<ExprKind>,
    pub right: Box<ExprKind>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct RightShiftExpr {
    pub left: Box<ExprKind>,
    pub right: Box<ExprKind>,
}

// Comparison operations
#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct EqExpr {
    pub left: Box<ExprKind>,
    pub right: Box<ExprKind>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct NeExpr {
    pub left: Box<ExprKind>,
    pub right: Box<ExprKind>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct LtExpr {
    pub left: Box<ExprKind>,
    pub right: Box<ExprKind>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct GtExpr {
    pub left: Box<ExprKind>,
    pub right: Box<ExprKind>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct LeExpr {
    pub left: Box<ExprKind>,
    pub right: Box<ExprKind>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct GeExpr {
    pub left: Box<ExprKind>,
    pub right: Box<ExprKind>,
}

// Logical operations
#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct AndExpr {
    pub left: Box<ExprKind>,
    pub right: Box<ExprKind>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct OrExpr {
    pub left: Box<ExprKind>,
    pub right: Box<ExprKind>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct XorExpr {
    pub left: Box<ExprKind>,
    pub right: Box<ExprKind>,
}

// Unary operations
#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct BitNotExpr {
    pub operand: Box<ExprKind>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct NegExpr {
    pub operand: Box<ExprKind>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct NotExpr {
    pub operand: Box<ExprKind>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct PopcountExpr {
    pub operand: Box<ExprKind>,
}

// Expression evaluation functionality
impl ExprKind {
    /// Recursively evaluate this expression to a constant value if possible
    /// Returns None if the expression contains unresolvable references (like field refs)
    pub fn try_evaluate_constant(&self) -> Option<u64> {
        match self {
            ExprKind::Literal(literal) => {
                match literal {
                    LiteralExpr::U64(val) => Some(*val),
                    LiteralExpr::U32(val) => Some(*val as u64),
                    LiteralExpr::U16(val) => Some(*val as u64),
                    LiteralExpr::U8(val) => Some(*val as u64),
                    LiteralExpr::I64(val) if *val >= 0 => Some(*val as u64),
                    LiteralExpr::I32(val) if *val >= 0 => Some(*val as u64),
                    LiteralExpr::I16(val) if *val >= 0 => Some(*val as u64),
                    LiteralExpr::I8(val) if *val >= 0 => Some(*val as u64),
                    _ => None, // Negative values can't be converted to u64
                }
            }

            ExprKind::Add(add_expr) => {
                let left = add_expr.left.try_evaluate_constant()?;
                let right = add_expr.right.try_evaluate_constant()?;
                left.checked_add(right)
            }

            ExprKind::Sub(sub_expr) => {
                let left = sub_expr.left.try_evaluate_constant()?;
                let right = sub_expr.right.try_evaluate_constant()?;
                left.checked_sub(right)
            }

            ExprKind::Mul(mul_expr) => {
                let left = mul_expr.left.try_evaluate_constant()?;
                let right = mul_expr.right.try_evaluate_constant()?;
                left.checked_mul(right)
            }

            ExprKind::Div(div_expr) => {
                let left = div_expr.left.try_evaluate_constant()?;
                let right = div_expr.right.try_evaluate_constant()?;
                if right == 0 {
                    None // Division by zero
                } else {
                    left.checked_div(right)
                }
            }

            ExprKind::Mod(mod_expr) => {
                let left = mod_expr.left.try_evaluate_constant()?;
                let right = mod_expr.right.try_evaluate_constant()?;
                if right == 0 {
                    None // Modulo by zero
                } else {
                    Some(left % right)
                }
            }

            ExprKind::Pow(pow_expr) => {
                let left = pow_expr.left.try_evaluate_constant()?;
                let right = pow_expr.right.try_evaluate_constant()?;
                if right <= u32::MAX as u64 {
                    left.checked_pow(right as u32)
                } else {
                    None // Exponent too large
                }
            }

            ExprKind::BitAnd(expr) => {
                let left = expr.left.try_evaluate_constant()?;
                let right = expr.right.try_evaluate_constant()?;
                Some(left & right)
            }

            ExprKind::BitOr(expr) => {
                let left = expr.left.try_evaluate_constant()?;
                let right = expr.right.try_evaluate_constant()?;
                Some(left | right)
            }

            ExprKind::BitXor(expr) => {
                let left = expr.left.try_evaluate_constant()?;
                let right = expr.right.try_evaluate_constant()?;
                Some(left ^ right)
            }

            ExprKind::LeftShift(expr) => {
                let left = expr.left.try_evaluate_constant()?;
                let right = expr.right.try_evaluate_constant()?;
                if right < 64 {
                    left.checked_shl(right as u32)
                } else {
                    None // Shift amount too large
                }
            }

            ExprKind::RightShift(expr) => {
                let left = expr.left.try_evaluate_constant()?;
                let right = expr.right.try_evaluate_constant()?;
                if right < 64 {
                    Some(left >> right)
                } else {
                    None // Shift amount too large
                }
            }

            ExprKind::BitNot(expr) => {
                let operand = expr.operand.try_evaluate_constant()?;
                Some(!operand)
            }

            ExprKind::Neg(expr) => {
                // Negation only works if the result can fit in i64 and be converted back to u64
                let operand = expr.operand.try_evaluate_constant()?;
                if operand <= i64::MAX as u64 {
                    let signed = operand as i64;
                    let negated = -signed;
                    if negated >= 0 {
                        Some(negated as u64)
                    } else {
                        None // Negative result
                    }
                } else {
                    None // Can't negate large unsigned values
                }
            }

            ExprKind::Popcount(expr) => {
                let operand = expr.operand.try_evaluate_constant()?;
                Some(operand.count_ones() as u64)
            }

            // These operations can't be evaluated to constants without more context
            ExprKind::FieldRef(_) => None, // Would need field value resolution
            ExprKind::Sizeof(_) => None,   // Would need type size information
            ExprKind::Alignof(_) => None,  // Would need type alignment information
            ExprKind::Eq(_)
            | ExprKind::Ne(_)
            | ExprKind::Lt(_)
            | ExprKind::Gt(_)
            | ExprKind::Le(_)
            | ExprKind::Ge(_) => None, // Comparison results are booleans
            ExprKind::And(_) | ExprKind::Or(_) | ExprKind::Xor(_) | ExprKind::Not(_) => None, // Logical ops
        }
    }

    /// Format the expression as a C-style mathematical expression
    /// This format is compatible with C, Rust, and TypeScript for most operations
    pub fn to_c_string(&self) -> String {
        match self {
            ExprKind::Literal(lit) => match lit {
                LiteralExpr::U64(val) => val.to_string(),
                LiteralExpr::U32(val) => val.to_string(),
                LiteralExpr::U16(val) => val.to_string(),
                LiteralExpr::U8(val) => val.to_string(),
                LiteralExpr::I64(val) => val.to_string(),
                LiteralExpr::I32(val) => val.to_string(),
                LiteralExpr::I16(val) => val.to_string(),
                LiteralExpr::I8(val) => val.to_string(),
            },
            ExprKind::FieldRef(field_ref) => field_ref.path.join("."),
            ExprKind::Sizeof(sizeof_expr) => format!("sizeof({})", sizeof_expr.type_name),
            ExprKind::Alignof(alignof_expr) => format!("alignof({})", alignof_expr.type_name),

            // Binary operations
            ExprKind::Add(e) => format!("({}+{})", e.left.to_c_string(), e.right.to_c_string()),
            ExprKind::Sub(e) => format!("({}-{})", e.left.to_c_string(), e.right.to_c_string()),
            ExprKind::Mul(e) => format!("({}*{})", e.left.to_c_string(), e.right.to_c_string()),
            ExprKind::Div(e) => format!("({}/{})", e.left.to_c_string(), e.right.to_c_string()),
            ExprKind::Mod(e) => format!("({}%{})", e.left.to_c_string(), e.right.to_c_string()),
            ExprKind::Pow(e) => format!("pow({},{})", e.left.to_c_string(), e.right.to_c_string()),

            // Bitwise operations
            ExprKind::BitAnd(e) => format!("({}&{})", e.left.to_c_string(), e.right.to_c_string()),
            ExprKind::BitOr(e) => format!("({}|{})", e.left.to_c_string(), e.right.to_c_string()),
            ExprKind::BitXor(e) => format!("({}^{})", e.left.to_c_string(), e.right.to_c_string()),
            ExprKind::LeftShift(e) => {
                format!("({}<<{})", e.left.to_c_string(), e.right.to_c_string())
            }
            ExprKind::RightShift(e) => {
                format!("({}>>{})", e.left.to_c_string(), e.right.to_c_string())
            }

            // Unary operations
            ExprKind::BitNot(e) => format!("~({})", e.operand.to_c_string()),
            ExprKind::Neg(e) => format!("-({})", e.operand.to_c_string()),
            ExprKind::Not(e) => format!("!({})", e.operand.to_c_string()),
            ExprKind::Popcount(e) => format!("__builtin_popcount({})", e.operand.to_c_string()),

            // Comparison operations
            ExprKind::Eq(e) => format!("({}=={})", e.left.to_c_string(), e.right.to_c_string()),
            ExprKind::Ne(e) => format!("({}!={})", e.left.to_c_string(), e.right.to_c_string()),
            ExprKind::Lt(e) => format!("({}<{})", e.left.to_c_string(), e.right.to_c_string()),
            ExprKind::Gt(e) => format!("({}>{})", e.left.to_c_string(), e.right.to_c_string()),
            ExprKind::Le(e) => format!("({}<={})", e.left.to_c_string(), e.right.to_c_string()),
            ExprKind::Ge(e) => format!("({}>={})", e.left.to_c_string(), e.right.to_c_string()),

            // Logical operations
            ExprKind::And(e) => format!("({}&&{})", e.left.to_c_string(), e.right.to_c_string()),
            ExprKind::Or(e) => format!("({}||{})", e.left.to_c_string(), e.right.to_c_string()),
            ExprKind::Xor(e) => format!("({}^^{})", e.left.to_c_string(), e.right.to_c_string()), // Note: ^^ is not standard in C
        }
    }

    /// Generate a debug string representation of the expression
    pub fn to_debug_string(&self) -> String {
        match self {
            ExprKind::Literal(literal) => match literal {
                LiteralExpr::U64(val) => format!("Literal(U64: {})", val),
                LiteralExpr::U32(val) => format!("Literal(U32: {})", val),
                LiteralExpr::U16(val) => format!("Literal(U16: {})", val),
                LiteralExpr::U8(val) => format!("Literal(U8: {})", val),
                LiteralExpr::I64(val) => format!("Literal(I64: {})", val),
                LiteralExpr::I32(val) => format!("Literal(I32: {})", val),
                LiteralExpr::I16(val) => format!("Literal(I16: {})", val),
                LiteralExpr::I8(val) => format!("Literal(I8: {})", val),
            },
            ExprKind::FieldRef(field_ref) => {
                format!("FieldRef(path: [{}])", field_ref.path.join(", "))
            }
            ExprKind::Sizeof(sizeof_expr) => {
                format!("Sizeof(type: {})", sizeof_expr.type_name)
            }
            ExprKind::Alignof(alignof_expr) => {
                format!("Alignof(type: {})", alignof_expr.type_name)
            }
            ExprKind::Add(expr) => {
                format!(
                    "Add({} + {})",
                    expr.left.to_debug_string(),
                    expr.right.to_debug_string()
                )
            }
            ExprKind::Sub(expr) => {
                format!(
                    "Sub({} - {})",
                    expr.left.to_debug_string(),
                    expr.right.to_debug_string()
                )
            }
            ExprKind::Mul(expr) => {
                format!(
                    "Mul({} * {})",
                    expr.left.to_debug_string(),
                    expr.right.to_debug_string()
                )
            }
            ExprKind::Div(expr) => {
                format!(
                    "Div({} / {})",
                    expr.left.to_debug_string(),
                    expr.right.to_debug_string()
                )
            }
            ExprKind::Mod(expr) => {
                format!(
                    "Mod({} % {})",
                    expr.left.to_debug_string(),
                    expr.right.to_debug_string()
                )
            }
            ExprKind::Pow(expr) => {
                format!(
                    "Pow({} ** {})",
                    expr.left.to_debug_string(),
                    expr.right.to_debug_string()
                )
            }
            ExprKind::BitAnd(expr) => {
                format!(
                    "BitAnd({} & {})",
                    expr.left.to_debug_string(),
                    expr.right.to_debug_string()
                )
            }
            ExprKind::BitOr(expr) => {
                format!(
                    "BitOr({} | {})",
                    expr.left.to_debug_string(),
                    expr.right.to_debug_string()
                )
            }
            ExprKind::BitXor(expr) => {
                format!(
                    "BitXor({} ^ {})",
                    expr.left.to_debug_string(),
                    expr.right.to_debug_string()
                )
            }
            ExprKind::LeftShift(expr) => {
                format!(
                    "LeftShift({} << {})",
                    expr.left.to_debug_string(),
                    expr.right.to_debug_string()
                )
            }
            ExprKind::RightShift(expr) => {
                format!(
                    "RightShift({} >> {})",
                    expr.left.to_debug_string(),
                    expr.right.to_debug_string()
                )
            }
            ExprKind::BitNot(expr) => {
                format!("BitNot(~{})", expr.operand.to_debug_string())
            }
            ExprKind::Neg(expr) => {
                format!("Neg(-{})", expr.operand.to_debug_string())
            }
            ExprKind::Not(expr) => {
                format!("Not(!{})", expr.operand.to_debug_string())
            }
            ExprKind::Popcount(expr) => {
                format!("Popcount(popcount({}))", expr.operand.to_debug_string())
            }
            ExprKind::Eq(expr) => {
                format!(
                    "Eq({} == {})",
                    expr.left.to_debug_string(),
                    expr.right.to_debug_string()
                )
            }
            ExprKind::Ne(expr) => {
                format!(
                    "Ne({} != {})",
                    expr.left.to_debug_string(),
                    expr.right.to_debug_string()
                )
            }
            ExprKind::Lt(expr) => {
                format!(
                    "Lt({} < {})",
                    expr.left.to_debug_string(),
                    expr.right.to_debug_string()
                )
            }
            ExprKind::Gt(expr) => {
                format!(
                    "Gt({} > {})",
                    expr.left.to_debug_string(),
                    expr.right.to_debug_string()
                )
            }
            ExprKind::Le(expr) => {
                format!(
                    "Le({} <= {})",
                    expr.left.to_debug_string(),
                    expr.right.to_debug_string()
                )
            }
            ExprKind::Ge(expr) => {
                format!(
                    "Ge({} >= {})",
                    expr.left.to_debug_string(),
                    expr.right.to_debug_string()
                )
            }
            ExprKind::And(expr) => {
                format!(
                    "And({} && {})",
                    expr.left.to_debug_string(),
                    expr.right.to_debug_string()
                )
            }
            ExprKind::Or(expr) => {
                format!(
                    "Or({} || {})",
                    expr.left.to_debug_string(),
                    expr.right.to_debug_string()
                )
            }
            ExprKind::Xor(expr) => {
                format!(
                    "Xor({} ^^ {})",
                    expr.left.to_debug_string(),
                    expr.right.to_debug_string()
                )
            }
        }
    }
}
