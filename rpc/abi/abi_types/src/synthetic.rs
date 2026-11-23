//! Display metadata and synthetic (computed) struct fields.
//!
//! Synthetic fields take no bytes. They are computed from a struct's wire
//! fields plus caller-supplied context (for example, a transaction's account
//! list). They live beside `StructType::fields`, never inside it, so wire
//! layout, IR and codegen are unaffected.

use crate::types::{IntegralType, PrimitiveType, TypeKind};
use serde_derive::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;

/// Built-in functions an expression may call, with their argument counts.
/// None of them read anything outside the decoded value and its context.
/// Most synthetic fields one struct may declare. This also bounds how deep
/// one field's dependencies can go, at load time and when evaluating.
pub const MAX_SYNTHETIC_FIELDS: usize = 64;

/// Most bytes any one computed text value may hold.
pub const MAX_SYNTHETIC_TEXT_BYTES: usize = 1024;

pub const SYNTHETIC_BUILTINS: &[(&str, usize)] = &[
    ("accountAddress", 1),
    ("text", 2),
    ("toDecimal", 2),
    ("toFixedPoint", 2),
    ("toMoney", 3),
    ("timestamp", 1),
];

/// Well-known types that reflection can build from a computed value. A
/// `return-type` naming one of these needs no definition in the ABI; any other
/// named type must be defined there, and the value must be a field of it.
pub const BUILT_VALUE_TYPES: &[&str] = &[
    "Pubkey",
    "Text",
    "Bool",
    "Decimal",
    "FixedPoint",
    "Money",
    "Timestamp",
];

/// The type a synthetic field produces: an ABI type, the same shape as a wire
/// field's `field-type`, or `{ optional: <field-type> }` for a value that may
/// be missing. Computed values never become bytes, so any ABI type is allowed
/// in principle; reflection builds integers and the `BUILT_VALUE_TYPES`.
#[derive(Debug, PartialEq, Eq, Clone)]
pub enum SyntheticType {
    Value(TypeKind),
    Optional(Box<TypeKind>),
}

impl SyntheticType {
    /// The ABI type itself, with any `optional` wrapper removed.
    pub fn inner(&self) -> &TypeKind {
        match self {
            SyntheticType::Value(kind) => kind,
            SyntheticType::Optional(kind) => kind,
        }
    }

    /// The ABI type itself, for rewriting (import flattening normalizes it).
    pub fn inner_mut(&mut self) -> &mut TypeKind {
        match self {
            SyntheticType::Value(kind) => kind,
            SyntheticType::Optional(kind) => kind,
        }
    }
}

impl serde::Serialize for SyntheticType {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            SyntheticType::Value(kind) => kind.serialize(serializer),
            SyntheticType::Optional(kind) => {
                use serde::ser::SerializeMap;
                let mut map = serializer.serialize_map(Some(1))?;
                map.serialize_entry("optional", kind)?;
                map.end()
            }
        }
    }
}

impl<'de> serde::Deserialize<'de> for SyntheticType {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Repr {
            Optional { optional: Box<TypeKind> },
            Value(TypeKind),
        }
        match Repr::deserialize(deserializer).map_err(|_| {
            serde::de::Error::custom(
                "return-type must be an ABI type (like `primitive: u64` or `type-ref: { name: Pubkey }`) or `optional: <type>`",
            )
        })? {
            Repr::Optional { optional } => Ok(SyntheticType::Optional(optional)),
            Repr::Value(kind) => Ok(SyntheticType::Value(kind)),
        }
    }
}

/// Writes the type as an ABI author reads it: `Pubkey`, `u64`, `optional<Text>`.
impl fmt::Display for SyntheticType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            SyntheticType::Value(kind) => f.write_str(&type_label(kind)),
            SyntheticType::Optional(kind) => write!(f, "optional<{}>", type_label(kind)),
        }
    }
}

/// A short name for an ABI type: `u64`, `Pubkey`, `u8[]`, `struct`.
pub fn type_label(kind: &TypeKind) -> String {
    match kind {
        TypeKind::Primitive(PrimitiveType::Integral(integral)) => {
            format!("{integral:?}").to_lowercase()
        }
        TypeKind::Primitive(PrimitiveType::FloatingPoint(float)) => {
            format!("{float:?}").to_lowercase()
        }
        TypeKind::TypeRef(type_ref) => type_ref.name.clone(),
        TypeKind::Array(array) => format!("{}[]", type_label(&array.element_type)),
        TypeKind::Struct(_) => "struct".into(),
        TypeKind::Enum(_) => "enum".into(),
        TypeKind::Union(_) | TypeKind::SizeDiscriminatedUnion(_) => "union".into(),
    }
}

/// Label and visibility for a wire field.
#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone, Default)]
#[serde(rename_all = "kebab-case")]
pub struct FieldDisplay {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_display: Option<bool>,
}

/// A computed field declared in a struct's field list.
#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct SyntheticField {
    pub name: String,
    pub return_type: SyntheticType,
    pub expression: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_display: Option<bool>,
    /// Number of wire fields declared before this one; keeps declared order.
    pub position: usize,
}

/// Everything about a struct that is for people rather than for layout.
#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone, Default)]
#[serde(rename_all = "kebab-case")]
pub struct StructDisplay {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub field_labels: BTreeMap<String, FieldDisplay>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub synthetic: Vec<SyntheticField>,
}

impl StructDisplay {
    pub fn is_empty(&self) -> bool {
        self.display_name.is_none() && self.field_labels.is_empty() && self.synthetic.is_empty()
    }

    /// Wire fields are shown unless hidden; synthetic fields must opt in.
    pub fn wire_field_visible(&self, name: &str) -> bool {
        self.field_labels
            .get(name)
            .and_then(|label| label.user_display)
            .unwrap_or(true)
    }

    /// Checks names, expressions, calls and dependencies against the
    /// struct's wire field names. Returns every problem found.
    pub fn validate(&self, wire_fields: &[&str]) -> Vec<String> {
        let mut errors = Vec::new();
        if self.synthetic.len() > MAX_SYNTHETIC_FIELDS {
            /* Stop here: the dependency walk below is bounded by this limit. */
            errors.push(format!(
                "{} synthetic fields; at most {MAX_SYNTHETIC_FIELDS} are allowed",
                self.synthetic.len()
            ));
            return errors;
        }
        let wire: BTreeSet<&str> = wire_fields.iter().copied().collect();
        let mut synthetic_names = BTreeSet::new();

        for label in self.field_labels.keys() {
            if !wire.contains(label.as_str()) {
                errors.push(format!("display info for unknown field '{label}'"));
            }
        }

        let mut deps: BTreeMap<&str, BTreeSet<String>> = BTreeMap::new();
        for field in &self.synthetic {
            if wire.contains(field.name.as_str()) || !synthetic_names.insert(field.name.as_str()) {
                errors.push(format!("duplicate field name '{}'", field.name));
            }
            if field.position > wire_fields.len() {
                errors.push(format!(
                    "synthetic field '{}' has an invalid position",
                    field.name
                ));
            }
            match parse_expression(&field.expression) {
                Err(err) => errors.push(format!("synthetic field '{}': {err}", field.name)),
                Ok(expr) => {
                    let mut calls = Vec::new();
                    expr.collect_calls(&mut calls);
                    for (name, arity) in calls {
                        match SYNTHETIC_BUILTINS.iter().find(|(builtin, _)| *builtin == name) {
                            None => errors.push(format!(
                                "synthetic field '{}': unknown function '{name}'",
                                field.name
                            )),
                            Some((_, expected)) if *expected != arity => errors.push(format!(
                                "synthetic field '{}': '{name}' takes {expected} argument(s), got {arity}",
                                field.name
                            )),
                            _ => {}
                        }
                    }
                    deps.insert(field.name.as_str(), expr.root_fields());
                }
            }
        }

        for (name, refs) in &deps {
            for reference in refs {
                if !wire.contains(reference.as_str())
                    && !synthetic_names.contains(reference.as_str())
                {
                    errors.push(format!(
                        "synthetic field '{name}': unknown field '{reference}'"
                    ));
                }
            }
        }

        if let Some(name) = find_cycle(&deps) {
            errors.push(format!("synthetic field '{name}' depends on itself"));
        }
        errors
    }
}

/* ---------------------------------------------------------------------------
 * Load-time type checks
 * ------------------------------------------------------------------------- */

/// What an expression produces, as far as load time can tell. `Unknown` is
/// for values whose type depends on decoded data (a float, an inline struct,
/// a path the checker cannot follow); evaluation still checks those.
#[derive(Debug, Clone, PartialEq, Eq)]
enum ExprType {
    Int,
    Bool,
    Text,
    Bytes,
    Named(String),
    None,
    Unknown,
}

impl fmt::Display for ExprType {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ExprType::Int => f.write_str("an integer"),
            ExprType::Bool => f.write_str("true/false"),
            ExprType::Text => f.write_str("Text"),
            ExprType::Bytes => f.write_str("bytes"),
            ExprType::Named(name) => f.write_str(name),
            ExprType::None => f.write_str("none"),
            ExprType::Unknown => f.write_str("an unknown value"),
        }
    }
}

/// `Text` and `Bool` are the named forms of the expression language's own
/// text and true/false values.
fn named(name: &str) -> ExprType {
    match name {
        "Text" => ExprType::Text,
        "Bool" => ExprType::Bool,
        other => ExprType::Named(other.to_string()),
    }
}

/// Most type-ref hops followed while checking, so alias chains stay bounded.
const MAX_TYPE_REF_HOPS: usize = 16;

/// A type-checking lookup: the definition of a named ABI type, if any.
pub type TypeLookup<'a> = dyn Fn(&str) -> Option<&'a TypeKind> + 'a;

fn follow<'a: 'x, 'x>(mut kind: &'x TypeKind, lookup: &TypeLookup<'a>) -> Option<&'x TypeKind> {
    for _ in 0..MAX_TYPE_REF_HOPS {
        match kind {
            TypeKind::TypeRef(type_ref) => kind = lookup(&type_ref.name)?,
            other => return Some(other),
        }
    }
    None
}

fn kind_type<'a: 'x, 'x>(kind: &'x TypeKind, lookup: &TypeLookup<'a>) -> ExprType {
    if let TypeKind::TypeRef(type_ref) = kind {
        /* An alias of an integer is an integer; any other named type keeps
         * its name, which is what built-ins and return types match on. */
        return match follow(kind, lookup) {
            Some(TypeKind::Primitive(PrimitiveType::Integral(_))) => ExprType::Int,
            _ => named(&type_ref.name),
        };
    }
    match kind {
        TypeKind::Primitive(PrimitiveType::Integral(_)) => ExprType::Int,
        TypeKind::Array(array) => match follow(&array.element_type, lookup) {
            Some(TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U8))) => ExprType::Bytes,
            _ => ExprType::Unknown,
        },
        _ => ExprType::Unknown,
    }
}

/// The value a declared return type expects, or why it cannot be one.
fn return_target<'a: 'x, 'x>(
    kind: &'x TypeKind,
    lookup: &TypeLookup<'a>,
) -> Result<ExprType, String> {
    match kind {
        /* A char is one byte of text, not a number reflection can build. */
        TypeKind::Primitive(PrimitiveType::Integral(IntegralType::Char)) => {
            Err("return-type char is not supported; use { primitive: u8 } or Text".into())
        }
        TypeKind::Primitive(PrimitiveType::Integral(_)) => Ok(ExprType::Int),
        TypeKind::TypeRef(type_ref) => {
            let name = type_ref.name.as_str();
            if BUILT_VALUE_TYPES.contains(&name) {
                return Ok(named(name));
            }
            if lookup(name).is_none() {
                return Err(format!("return-type names unknown type '{name}'"));
            }
            /* Reflection builds integers from the declared width, which an
             * alias hides; any other named type passes through as itself. */
            if let Some(TypeKind::Primitive(PrimitiveType::Integral(integral))) =
                follow(kind, lookup)
            {
                return Err(format!(
                    "return-type '{name}' is an integer alias; use {{ primitive: {} }}",
                    format!("{integral:?}").to_lowercase()
                ));
            }
            Ok(named(name))
        }
        other => Err(format!(
            "return-type must be an integer type or a named type, not {}",
            type_label(other)
        )),
    }
}

/// Well-known types with a display form: evaluation compares two of them by
/// their display text. Kept in step with abi_reflect's handlers.
const DISPLAY_TYPES: &[&str] = &[
    "Pubkey",
    "Hash",
    "Signature",
    "Timestamp",
    "Duration",
    "Date",
    "DateTime",
    "TimeOfDay",
    "Decimal",
    "FixedPoint",
    "Fraction",
    "Money",
    "Color",
    "LatLng",
    "Quaternion",
    "Interval",
    "DayOfWeek",
    "Month",
    "CalendarPeriod",
];

/// Whether evaluation can compare the two: plain values of one kind, two
/// well-known values of one type, an address against 32 bytes, or anything
/// against none or a value load time cannot type.
fn comparable(left: &ExprType, right: &ExprType) -> bool {
    let unknown = |t: &ExprType| matches!(t, ExprType::Unknown | ExprType::None);
    let address_pair = |a: &ExprType, b: &ExprType| {
        *a == ExprType::Named("Pubkey".into()) && *b == ExprType::Bytes
    };
    if unknown(left) || unknown(right) || address_pair(left, right) || address_pair(right, left) {
        return true;
    }
    left == right
        && match left {
            ExprType::Int | ExprType::Bool | ExprType::Text => true,
            ExprType::Named(name) => DISPLAY_TYPES.contains(&name.as_str()),
            _ => false,
        }
}

fn accepts(expected: &ExprType, actual: &ExprType) -> bool {
    actual == expected
        || *actual == ExprType::Unknown
        /* 32 bytes become an address; evaluation checks the length. */
        || (*expected == ExprType::Named("Pubkey".into()) && *actual == ExprType::Bytes)
}

struct TypeChecker<'a, 'd> {
    display: &'d StructDisplay,
    wire: &'d [(&'d str, &'a TypeKind)],
    lookup: &'d TypeLookup<'a>,
    in_progress: Vec<&'d str>,
}

impl<'a, 'd> TypeChecker<'a, 'd> {
    fn field_type(&mut self, field: &'d SyntheticField) -> ExprType {
        if self.in_progress.contains(&field.name.as_str()) {
            return ExprType::Unknown;
        }
        /* A declared return type is what other expressions see, whatever the
         * expression says; its own mismatch is reported once, for itself. */
        match field.return_type.inner() {
            kind @ TypeKind::Primitive(_) | kind @ TypeKind::TypeRef(_) => {
                return_target(kind, self.lookup).unwrap_or(ExprType::Unknown)
            }
            _ => ExprType::Unknown,
        }
    }

    fn path(&mut self, segments: &[PathSegment]) -> ExprType {
        let Some(PathSegment::Field(root)) = segments.first() else {
            return ExprType::Unknown;
        };
        let mut current: &'a TypeKind =
            if let Some((_, kind)) = self.wire.iter().find(|(name, _)| name == root) {
                kind
            } else if let Some(field) = self.display.synthetic.iter().find(|f| &f.name == root) {
                return if segments.len() == 1 {
                    self.field_type(field)
                } else {
                    ExprType::Unknown
                };
            } else {
                return ExprType::Unknown;
            };
        for segment in &segments[1..] {
            let Some(resolved) = follow(current, self.lookup) else {
                return ExprType::Unknown;
            };
            current = match (segment, resolved) {
                (PathSegment::Field(name), TypeKind::Struct(st)) => {
                    match st.fields.iter().find(|f| &f.name == name) {
                        Some(field) => &field.field_type,
                        None => return ExprType::Unknown,
                    }
                }
                (PathSegment::Index(_), TypeKind::Array(array)) => &array.element_type,
                _ => return ExprType::Unknown,
            };
        }
        kind_type(current, self.lookup)
    }

    /// A Pubkey return accepts a named byte array or byte wrapper too (like
    /// Seed32); evaluation still checks that it holds exactly 32 bytes.
    fn named_bytes_as_address(&self, target: &ExprType, actual: &ExprType) -> bool {
        *target == ExprType::Named("Pubkey".into())
            && matches!(actual, ExprType::Named(name) if self.wraps_bytes(name))
    }

    /// Whether evaluation can read a named value as bytes: a named byte array
    /// (like Seed32) or a struct whose only field is one (like Pubkey).
    fn wraps_bytes(&self, name: &str) -> bool {
        let Some(kind) = (self.lookup)(name) else {
            /* Undefined built-ins that are 32 or 64 raw bytes. */
            return matches!(name, "Pubkey" | "Hash" | "Signature");
        };
        match follow(kind, self.lookup) {
            /* A named byte array, like Seed32. */
            Some(array @ TypeKind::Array(_)) => kind_type(array, self.lookup) == ExprType::Bytes,
            Some(TypeKind::Struct(st)) => match st.fields.as_slice() {
                [field] => kind_type(&field.field_type, self.lookup) == ExprType::Bytes,
                _ => false,
            },
            _ => false,
        }
    }

    /// Whether the expression can give none: the literal, an `if` branch that
    /// can, or a synthetic field declared optional.
    fn can_be_none(&self, expr: &SyntheticExpr) -> bool {
        match expr {
            SyntheticExpr::None => true,
            SyntheticExpr::If(_, then, otherwise) => {
                self.can_be_none(then) || self.can_be_none(otherwise)
            }
            SyntheticExpr::Path(segments) if segments.len() == 1 => match &segments[0] {
                PathSegment::Field(name) => self.display.synthetic.iter().any(|field| {
                    &field.name == name && matches!(field.return_type, SyntheticType::Optional(_))
                }),
                PathSegment::Index(_) => false,
            },
            _ => false,
        }
    }

    fn expect(&self, what: &str, expected: &ExprType, actual: &ExprType) -> Result<(), String> {
        if accepts(expected, actual) {
            Ok(())
        } else {
            Err(format!("{what} needs {expected}, got {actual}"))
        }
    }

    fn infer(&mut self, expr: &SyntheticExpr) -> Result<ExprType, String> {
        Ok(match expr {
            SyntheticExpr::Integer(_) => ExprType::Int,
            SyntheticExpr::Str(_) => ExprType::Text,
            SyntheticExpr::Bool(_) => ExprType::Bool,
            SyntheticExpr::None => ExprType::None,
            SyntheticExpr::Path(segments) => self.path(segments),
            SyntheticExpr::Unary(op, inner) => {
                let inner = self.infer(inner)?;
                match op {
                    UnaryOp::Not => {
                        self.expect("'!'", &ExprType::Bool, &inner)?;
                        ExprType::Bool
                    }
                    UnaryOp::Neg => {
                        self.expect("'-'", &ExprType::Int, &inner)?;
                        ExprType::Int
                    }
                }
            }
            SyntheticExpr::Binary(op, left, right) => {
                let (left, right) = (self.infer(left)?, self.infer(right)?);
                match op {
                    BinaryOp::And | BinaryOp::Or => {
                        self.expect("'&&'/'||'", &ExprType::Bool, &left)?;
                        self.expect("'&&'/'||'", &ExprType::Bool, &right)?;
                        ExprType::Bool
                    }
                    BinaryOp::Eq | BinaryOp::Ne => {
                        if !comparable(&left, &right) {
                            return Err(format!("cannot compare {left} with {right}"));
                        }
                        ExprType::Bool
                    }
                    _ => {
                        self.expect("arithmetic and ordering", &ExprType::Int, &left)?;
                        self.expect("arithmetic and ordering", &ExprType::Int, &right)?;
                        if matches!(
                            op,
                            BinaryOp::Lt | BinaryOp::Le | BinaryOp::Gt | BinaryOp::Ge
                        ) {
                            ExprType::Bool
                        } else {
                            ExprType::Int
                        }
                    }
                }
            }
            SyntheticExpr::If(cond, then, otherwise) => {
                let cond = self.infer(cond)?;
                self.expect("'if'", &ExprType::Bool, &cond)?;
                let (then, otherwise) = (self.infer(then)?, self.infer(otherwise)?);
                match (&then, &otherwise) {
                    (a, b) if a == b => then,
                    (ExprType::None | ExprType::Unknown, _) => otherwise,
                    (_, ExprType::None | ExprType::Unknown) => then,
                    _ => return Err(format!("'if' branches give {then} and {otherwise}")),
                }
            }
            SyntheticExpr::Template(parts) => {
                for part in parts {
                    if let TemplatePart::Expr(inner) = part {
                        let inner = self.infer(inner)?;
                        if matches!(inner, ExprType::Bytes | ExprType::None) {
                            return Err(format!("cannot put {inner} into text"));
                        }
                    }
                }
                ExprType::Text
            }
            SyntheticExpr::Call(name, args) => {
                let mut types = Vec::with_capacity(args.len());
                for arg in args {
                    types.push(self.infer(arg)?);
                }
                let (params, result): (&[ExprType], ExprType) = match name.as_str() {
                    "accountAddress" => (&[ExprType::Int], named("Pubkey")),
                    "toDecimal" => (&[ExprType::Int, ExprType::Int], named("Decimal")),
                    "toFixedPoint" => (&[ExprType::Int, ExprType::Int], named("FixedPoint")),
                    "toMoney" => (
                        &[ExprType::Int, ExprType::Int, ExprType::Text],
                        named("Money"),
                    ),
                    "timestamp" => (&[ExprType::Int], named("Timestamp")),
                    "text" => {
                        if let Some(first) = types.first() {
                            let bytes = match first {
                                ExprType::Bytes | ExprType::Unknown => true,
                                ExprType::Named(name) => self.wraps_bytes(name),
                                _ => false,
                            };
                            if !bytes {
                                return Err(format!("'text' needs bytes, got {first}"));
                            }
                        }
                        if let Some(length) = types.get(1) {
                            self.expect("'text' length", &ExprType::Int, length)?;
                        }
                        return Ok(ExprType::Text);
                    }
                    /* Unknown names and arities are reported by `validate`. */
                    _ => return Ok(ExprType::Unknown),
                };
                for (i, (param, actual)) in params.iter().zip(&types).enumerate() {
                    self.expect(&format!("'{name}' argument {}", i + 1), param, actual)?;
                }
                result
            }
        })
    }
}

impl StructDisplay {
    /// Checks each synthetic field's expression against the ABI types of the
    /// fields it reads, the built-ins' signatures, and its declared return
    /// type. `wire_fields` pairs each wire field with its type; `lookup` finds
    /// a named type. Returns every problem found.
    pub fn check_types<'a, 'd>(
        &'d self,
        wire_fields: &'d [(&'d str, &'a TypeKind)],
        lookup: &'d TypeLookup<'a>,
    ) -> Vec<String> {
        let mut errors = Vec::new();
        /* `validate` reports an oversized struct; checking it would scan the
         * synthetic list once per reference, so stop before doing any work. */
        if self.synthetic.len() > MAX_SYNTHETIC_FIELDS {
            return errors;
        }
        let mut checker = TypeChecker {
            display: self,
            wire: wire_fields,
            lookup,
            in_progress: Vec::new(),
        };
        for field in &self.synthetic {
            let target = match return_target(field.return_type.inner(), lookup) {
                Ok(target) => target,
                Err(err) => {
                    errors.push(format!("synthetic field '{}': {err}", field.name));
                    continue;
                }
            };
            let Ok(expr) = parse_expression(&field.expression) else {
                continue; /* reported by `validate` */
            };
            checker.in_progress.push(field.name.as_str());
            let result = checker.infer(&expr);
            checker.in_progress.pop();
            let required = matches!(field.return_type, SyntheticType::Value(_));
            match result {
                Err(err) => errors.push(format!("synthetic field '{}': {err}", field.name)),
                Ok(_) if required && checker.can_be_none(&expr) => errors.push(format!(
                    "synthetic field '{}': can be none, so its return-type must be optional",
                    field.name
                )),
                Ok(actual)
                    if actual != ExprType::None
                        && !accepts(&target, &actual)
                        && !checker.named_bytes_as_address(&target, &actual) =>
                {
                    errors.push(format!(
                        "synthetic field '{}': expression gives {actual}, but return-type is {}",
                        field.name, field.return_type
                    ));
                }
                Ok(_) => {}
            }
        }
        errors
    }
}

fn find_cycle(deps: &BTreeMap<&str, BTreeSet<String>>) -> Option<String> {
    fn visit<'a>(
        node: &'a str,
        deps: &'a BTreeMap<&str, BTreeSet<String>>,
        state: &mut BTreeMap<&'a str, u8>,
    ) -> Option<String> {
        match state.get(node) {
            Some(1) => return Some(node.to_string()),
            Some(2) => return None,
            _ => {}
        }
        state.insert(node, 1);
        if let Some(refs) = deps.get(node) {
            for reference in refs {
                if let Some((key, _)) = deps.get_key_value(reference.as_str()) {
                    if let Some(found) = visit(key, deps, state) {
                        return Some(found);
                    }
                }
            }
        }
        state.insert(node, 2);
        None
    }
    let mut state = BTreeMap::new();
    deps.keys().find_map(|node| visit(node, deps, &mut state))
}

/* ---------------------------------------------------------------------------
 * Expression AST
 * ------------------------------------------------------------------------- */

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PathSegment {
    Field(String),
    Index(u64),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UnaryOp {
    Not,
    Neg,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BinaryOp {
    Add,
    Sub,
    Mul,
    Div,
    Mod,
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
    And,
    Or,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TemplatePart {
    Text(String),
    Expr(SyntheticExpr),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SyntheticExpr {
    Integer(i128),
    Str(String),
    Bool(bool),
    None,
    /// First segment is always a field of the same struct.
    Path(Vec<PathSegment>),
    Unary(UnaryOp, Box<SyntheticExpr>),
    Binary(BinaryOp, Box<SyntheticExpr>, Box<SyntheticExpr>),
    If(Box<SyntheticExpr>, Box<SyntheticExpr>, Box<SyntheticExpr>),
    Template(Vec<TemplatePart>),
    Call(String, Vec<SyntheticExpr>),
}

impl SyntheticExpr {
    /// Names of the struct fields this expression reads directly.
    pub fn root_fields(&self) -> BTreeSet<String> {
        let mut out = BTreeSet::new();
        self.walk(&mut |expr| {
            if let SyntheticExpr::Path(segments) = expr {
                if let Some(PathSegment::Field(name)) = segments.first() {
                    out.insert(name.clone());
                }
            }
        });
        out
    }

    /// Depth of the tree, measured without recursion.
    pub fn depth(&self) -> usize {
        let mut deepest = 0;
        let mut stack = vec![(self, 1usize)];
        while let Some((expr, depth)) = stack.pop() {
            deepest = deepest.max(depth);
            match expr {
                SyntheticExpr::Unary(_, inner) => stack.push((inner, depth + 1)),
                SyntheticExpr::Binary(_, left, right) => {
                    stack.push((left, depth + 1));
                    stack.push((right, depth + 1));
                }
                SyntheticExpr::If(cond, then, otherwise) => {
                    stack.push((cond, depth + 1));
                    stack.push((then, depth + 1));
                    stack.push((otherwise, depth + 1));
                }
                SyntheticExpr::Template(parts) => {
                    for part in parts {
                        if let TemplatePart::Expr(inner) = part {
                            stack.push((inner, depth + 1));
                        }
                    }
                }
                SyntheticExpr::Call(_, args) => {
                    for arg in args {
                        stack.push((arg, depth + 1));
                    }
                }
                _ => {}
            }
        }
        deepest
    }

    fn collect_calls(&self, out: &mut Vec<(String, usize)>) {
        self.walk(&mut |expr| {
            if let SyntheticExpr::Call(name, args) = expr {
                out.push((name.clone(), args.len()));
            }
        });
    }

    fn walk(&self, visit: &mut dyn FnMut(&SyntheticExpr)) {
        visit(self);
        match self {
            SyntheticExpr::Unary(_, inner) => inner.walk(visit),
            SyntheticExpr::Binary(_, left, right) => {
                left.walk(visit);
                right.walk(visit);
            }
            SyntheticExpr::If(cond, then, otherwise) => {
                cond.walk(visit);
                then.walk(visit);
                otherwise.walk(visit);
            }
            SyntheticExpr::Template(parts) => {
                for part in parts {
                    if let TemplatePart::Expr(expr) = part {
                        expr.walk(visit);
                    }
                }
            }
            SyntheticExpr::Call(_, args) => {
                for arg in args {
                    arg.walk(visit);
                }
            }
            _ => {}
        }
    }
}

/* ---------------------------------------------------------------------------
 * Parser
 * ------------------------------------------------------------------------- */

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExprParseError {
    pub message: String,
    pub offset: usize,
}

impl fmt::Display for ExprParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} at offset {}", self.message, self.offset)
    }
}

impl std::error::Error for ExprParseError {}

/// Longest expression accepted, and deepest nesting, to bound parse work.
const MAX_EXPRESSION_LEN: usize = 4096;
pub const MAX_NESTING: usize = 64;

pub fn parse_expression(source: &str) -> Result<SyntheticExpr, ExprParseError> {
    if source.len() > MAX_EXPRESSION_LEN {
        return Err(ExprParseError {
            message: format!("expression longer than {MAX_EXPRESSION_LEN} bytes"),
            offset: 0,
        });
    }
    let mut parser = ExprParser {
        src: source,
        pos: 0,
        depth: 0,
    };
    let expr = parser.expr()?;
    parser.skip_ws();
    if parser.pos != source.len() {
        return Err(parser.error("unexpected input"));
    }
    /* Operator chains like `a+0+0+...` build depth without nesting, so
     * measure the finished tree: evaluation recurses once per level. */
    if expr.depth() > MAX_NESTING {
        return Err(ExprParseError {
            message: format!("expression nested deeper than {MAX_NESTING} levels"),
            offset: 0,
        });
    }
    Ok(expr)
}

struct ExprParser<'a> {
    src: &'a str,
    pos: usize,
    depth: usize,
}

impl<'a> ExprParser<'a> {
    fn error(&self, message: &str) -> ExprParseError {
        ExprParseError {
            message: message.to_string(),
            offset: self.pos,
        }
    }

    fn rest(&self) -> &'a str {
        &self.src[self.pos..]
    }

    fn skip_ws(&mut self) {
        let trimmed = self.rest().trim_start();
        self.pos = self.src.len() - trimmed.len();
    }

    fn eat(&mut self, token: &str) -> bool {
        self.skip_ws();
        if self.rest().starts_with(token) {
            self.pos += token.len();
            true
        } else {
            false
        }
    }

    /// Eat a keyword only when it is not the prefix of a longer identifier.
    fn eat_keyword(&mut self, word: &str) -> bool {
        self.skip_ws();
        let rest = self.rest();
        if rest.starts_with(word)
            && !rest[word.len()..]
                .chars()
                .next()
                .is_some_and(|c| c.is_ascii_alphanumeric() || c == '_')
        {
            self.pos += word.len();
            true
        } else {
            false
        }
    }

    fn expect(&mut self, token: &str) -> Result<(), ExprParseError> {
        if self.eat(token) {
            Ok(())
        } else {
            Err(self.error(&format!("expected '{token}'")))
        }
    }

    fn nested<T>(
        &mut self,
        f: impl FnOnce(&mut Self) -> Result<T, ExprParseError>,
    ) -> Result<T, ExprParseError> {
        self.depth += 1;
        if self.depth > MAX_NESTING {
            return Err(self.error("expression nested too deeply"));
        }
        let result = f(self);
        self.depth -= 1;
        result
    }

    fn expr(&mut self) -> Result<SyntheticExpr, ExprParseError> {
        self.nested(|p| {
            if p.eat_keyword("if") {
                let cond = p.expr()?;
                p.expect("{")?;
                let then = p.expr()?;
                p.expect("}")?;
                if !p.eat_keyword("else") {
                    return Err(p.error("expected 'else'"));
                }
                let otherwise = if p.rest().trim_start().starts_with("if") {
                    p.expr()?
                } else {
                    p.expect("{")?;
                    let otherwise = p.expr()?;
                    p.expect("}")?;
                    otherwise
                };
                return Ok(SyntheticExpr::If(
                    Box::new(cond),
                    Box::new(then),
                    Box::new(otherwise),
                ));
            }
            p.binary(0)
        })
    }

    fn binary(&mut self, min_level: usize) -> Result<SyntheticExpr, ExprParseError> {
        const LEVELS: &[&[(&str, BinaryOp)]] = &[
            &[("||", BinaryOp::Or)],
            &[("&&", BinaryOp::And)],
            &[("==", BinaryOp::Eq), ("!=", BinaryOp::Ne)],
            &[
                ("<=", BinaryOp::Le),
                (">=", BinaryOp::Ge),
                ("<", BinaryOp::Lt),
                (">", BinaryOp::Gt),
            ],
            &[("+", BinaryOp::Add), ("-", BinaryOp::Sub)],
            &[
                ("*", BinaryOp::Mul),
                ("/", BinaryOp::Div),
                ("%", BinaryOp::Mod),
            ],
        ];
        if min_level == LEVELS.len() {
            return self.unary();
        }
        let mut left = self.binary(min_level + 1)?;
        'outer: loop {
            for (token, op) in LEVELS[min_level] {
                if self.eat(token) {
                    let right = self.binary(min_level + 1)?;
                    left = SyntheticExpr::Binary(*op, Box::new(left), Box::new(right));
                    continue 'outer;
                }
            }
            return Ok(left);
        }
    }

    fn unary(&mut self) -> Result<SyntheticExpr, ExprParseError> {
        self.nested(|p| {
            if p.eat("!") {
                return Ok(SyntheticExpr::Unary(UnaryOp::Not, Box::new(p.unary()?)));
            }
            if p.eat("-") {
                return Ok(SyntheticExpr::Unary(UnaryOp::Neg, Box::new(p.unary()?)));
            }
            p.primary()
        })
    }

    fn primary(&mut self) -> Result<SyntheticExpr, ExprParseError> {
        self.skip_ws();
        let Some(c) = self.rest().chars().next() else {
            return Err(self.error("unexpected end of expression"));
        };
        match c {
            '(' => {
                self.pos += 1;
                let inner = self.expr()?;
                self.expect(")")?;
                Ok(inner)
            }
            '"' => Ok(SyntheticExpr::Str(self.string()?)),
            '`' => self.template(),
            '0'..='9' => self.integer(),
            c if c.is_ascii_alphabetic() || c == '_' => {
                let name = self.identifier();
                match name.as_str() {
                    "true" => return Ok(SyntheticExpr::Bool(true)),
                    "false" => return Ok(SyntheticExpr::Bool(false)),
                    "none" => return Ok(SyntheticExpr::None),
                    "if" | "else" => return Err(self.error("unexpected keyword")),
                    _ => {}
                }
                if self.eat("(") {
                    let mut args = Vec::new();
                    if !self.eat(")") {
                        loop {
                            args.push(self.expr()?);
                            if self.eat(")") {
                                break;
                            }
                            self.expect(",")?;
                        }
                    }
                    return Ok(SyntheticExpr::Call(name, args));
                }
                let mut segments = vec![PathSegment::Field(name)];
                loop {
                    if self.rest().starts_with('.') {
                        self.pos += 1;
                        let next = self.rest().chars().next();
                        if !next.is_some_and(|c| c.is_ascii_alphabetic() || c == '_') {
                            return Err(self.error("expected field name after '.'"));
                        }
                        segments.push(PathSegment::Field(self.identifier()));
                    } else if self.rest().starts_with('[') {
                        self.pos += 1;
                        self.skip_ws();
                        let SyntheticExpr::Integer(index) = self.integer()? else {
                            unreachable!()
                        };
                        let index =
                            u64::try_from(index).map_err(|_| self.error("index out of range"))?;
                        self.expect("]")?;
                        segments.push(PathSegment::Index(index));
                    } else {
                        break;
                    }
                }
                Ok(SyntheticExpr::Path(segments))
            }
            _ => Err(self.error(&format!("unexpected character '{c}'"))),
        }
    }

    fn identifier(&mut self) -> String {
        let rest = self.rest();
        let len = rest
            .find(|c: char| !(c.is_ascii_alphanumeric() || c == '_'))
            .unwrap_or(rest.len());
        self.pos += len;
        rest[..len].to_string()
    }

    fn integer(&mut self) -> Result<SyntheticExpr, ExprParseError> {
        let rest = self.rest();
        let len = rest
            .find(|c: char| !c.is_ascii_digit())
            .unwrap_or(rest.len());
        if len == 0 {
            return Err(self.error("expected integer"));
        }
        let value = rest[..len]
            .parse::<i128>()
            .map_err(|_| self.error("integer out of range"))?;
        self.pos += len;
        Ok(SyntheticExpr::Integer(value))
    }

    fn string(&mut self) -> Result<String, ExprParseError> {
        self.pos += 1; /* opening quote */
        let mut out = String::new();
        let mut chars = self.rest().char_indices();
        while let Some((i, c)) = chars.next() {
            match c {
                '"' => {
                    self.pos += i + 1;
                    return Ok(out);
                }
                '\\' => match chars.next() {
                    Some((_, '"')) => out.push('"'),
                    Some((_, '\\')) => out.push('\\'),
                    Some((_, 'n')) => out.push('\n'),
                    _ => {
                        self.pos += i;
                        return Err(self.error("invalid escape"));
                    }
                },
                c => out.push(c),
            }
        }
        Err(self.error("unterminated string"))
    }

    fn template(&mut self) -> Result<SyntheticExpr, ExprParseError> {
        self.pos += 1; /* opening backtick */
        let mut parts = Vec::new();
        let mut text = String::new();
        loop {
            let rest = self.rest();
            if rest.is_empty() {
                return Err(self.error("unterminated template"));
            }
            if rest.starts_with('`') {
                self.pos += 1;
                break;
            }
            if rest.starts_with("${") {
                if !text.is_empty() {
                    parts.push(TemplatePart::Text(std::mem::take(&mut text)));
                }
                self.pos += 2;
                let inner = self.expr()?;
                self.expect("}")?;
                parts.push(TemplatePart::Expr(inner));
                continue;
            }
            let c = rest.chars().next().unwrap();
            text.push(c);
            self.pos += c.len_utf8();
        }
        if !text.is_empty() {
            parts.push(TemplatePart::Text(text));
        }
        Ok(SyntheticExpr::Template(parts))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn path(names: &[&str]) -> SyntheticExpr {
        SyntheticExpr::Path(
            names
                .iter()
                .map(|n| PathSegment::Field(n.to_string()))
                .collect(),
        )
    }

    #[test]
    fn parses_calls_paths_and_indexes() {
        assert_eq!(
            parse_expression("accountAddress(dest_account_index)").unwrap(),
            SyntheticExpr::Call("accountAddress".into(), vec![path(&["dest_account_index"])])
        );
        assert_eq!(
            parse_expression("ticker.bytes[2]").unwrap(),
            SyntheticExpr::Path(vec![
                PathSegment::Field("ticker".into()),
                PathSegment::Field("bytes".into()),
                PathSegment::Index(2),
            ])
        );
    }

    #[test]
    fn respects_precedence() {
        let expr = parse_expression("a + b * 2 == 7 && !c").unwrap();
        let SyntheticExpr::Binary(BinaryOp::And, left, right) = expr else {
            panic!()
        };
        assert!(matches!(*right, SyntheticExpr::Unary(UnaryOp::Not, _)));
        let SyntheticExpr::Binary(BinaryOp::Eq, sum, _) = *left else {
            panic!()
        };
        let SyntheticExpr::Binary(BinaryOp::Add, _, product) = *sum else {
            panic!()
        };
        assert!(matches!(
            *product,
            SyntheticExpr::Binary(BinaryOp::Mul, _, _)
        ));
    }

    #[test]
    fn parses_if_chains_templates_and_literals() {
        let expr = parse_expression(
            r#"if flag == 1 { "a" } else if flag == 2 { none } else { `x ${n + 1} y` }"#,
        )
        .unwrap();
        let SyntheticExpr::If(_, then, otherwise) = expr else {
            panic!()
        };
        assert_eq!(*then, SyntheticExpr::Str("a".into()));
        let SyntheticExpr::If(_, then, otherwise) = *otherwise else {
            panic!()
        };
        assert_eq!(*then, SyntheticExpr::None);
        let SyntheticExpr::Template(parts) = *otherwise else {
            panic!()
        };
        assert_eq!(parts.len(), 3);
    }

    #[test]
    fn keywords_do_not_swallow_identifiers() {
        assert_eq!(parse_expression("iffy").unwrap(), path(&["iffy"]));
        assert_eq!(parse_expression("none_left").unwrap(), path(&["none_left"]));
    }

    #[test]
    fn rejects_bad_input() {
        for bad in [
            "",
            "a +",
            "f(a,",
            "\"open",
            "`open",
            "a.",
            "x[y]",
            "if a { b }",
            "a b",
        ] {
            assert!(parse_expression(bad).is_err(), "should reject {bad:?}");
        }
        let deep = format!("{}1{}", "(".repeat(200), ")".repeat(200));
        assert!(parse_expression(&deep).is_err());
        /* A flat operator chain is deep too, even without parentheses. */
        let chain = format!("a{}", "+0".repeat(100));
        assert!(parse_expression(&chain)
            .unwrap_err()
            .message
            .contains("deeper than"));
        assert!(parse_expression(&format!("a{}", "+0".repeat(40))).is_ok());
    }

    fn synthetic(name: &str, expression: &str) -> SyntheticField {
        SyntheticField {
            name: name.into(),
            return_type: SyntheticType::Value(TypeKind::Primitive(PrimitiveType::Integral(
                IntegralType::U64,
            ))),
            expression: expression.into(),
            display_name: None,
            user_display: Some(true),
            position: 0,
        }
    }

    #[test]
    fn validation_reports_each_problem() {
        let mut display = StructDisplay {
            synthetic: Vec::new(),
            ..StructDisplay::default()
        };
        display
            .field_labels
            .insert("missing".into(), FieldDisplay::default());
        display.synthetic = vec![
            synthetic("a", "accountAddress(idx)"),
            synthetic("idx", "1"),
            synthetic("b", "lookup(idx)"),
            synthetic("c", "text(idx)"),
            synthetic("d", "nope + 1"),
            synthetic("e", "f + 1"),
            synthetic("f", "e + 1"),
        ];
        let errors = display.validate(&["idx"]).join("\n");
        assert!(errors.contains("unknown field 'missing'"), "{errors}");
        assert!(errors.contains("duplicate field name 'idx'"), "{errors}");
        assert!(errors.contains("unknown function 'lookup'"), "{errors}");
        assert!(
            errors.contains("'text' takes 2 argument(s), got 1"),
            "{errors}"
        );
        assert!(errors.contains("unknown field 'nope'"), "{errors}");
        assert!(errors.contains("depends on itself"), "{errors}");
    }

    #[test]
    fn too_many_synthetic_fields_are_rejected() {
        let display = StructDisplay {
            synthetic: (0..=MAX_SYNTHETIC_FIELDS)
                .map(|i| synthetic(&format!("f{i}"), if i == 0 { "1" } else { "f0" }))
                .collect(),
            ..StructDisplay::default()
        };
        let errors = display.validate(&[]);
        assert_eq!(errors.len(), 1);
        assert!(errors[0].contains("at most 64"), "{errors:?}");
    }

    #[test]
    fn valid_display_has_no_errors() {
        let display = StructDisplay {
            synthetic: vec![
                synthetic("addr", "accountAddress(idx)"),
                synthetic("label", "`to ${addr}`"),
            ],
            ..StructDisplay::default()
        };
        assert!(display.validate(&["idx"]).is_empty());
    }
}
