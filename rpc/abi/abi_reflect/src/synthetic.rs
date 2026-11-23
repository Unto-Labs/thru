/* Evaluate synthetic (computed) struct fields.
 *
 * Inputs are a struct's decoded wire fields and caller-supplied context
 * (the transaction's account list). Nothing outside those is read. Each
 * field succeeds or fails on its own; a failure never fails the reflection.
 *
 * A field's result is a decoded value of its declared ABI type, built here
 * rather than read from bytes, so the formatter treats it like a wire value
 * (well-known enrichment, display forms) with no byte range. */

use crate::types::{ReflectedField, ReflectedType, ReflectedTypeKind};
use crate::value::{
    PrimitiveValue, PrimitiveValueI16, PrimitiveValueI32, PrimitiveValueI64, PrimitiveValueI8,
    PrimitiveValueU16, PrimitiveValueU32, PrimitiveValueU64, PrimitiveValueU8, ReflectedValue,
    Value,
};
use crate::well_known::handlers::decode_thru_address;
use crate::well_known::WellKnownRegistry;
use abi_gen::abi::types::synthetic::{
    parse_expression, type_label, BinaryOp, PathSegment, SyntheticExpr, TemplatePart, UnaryOp,
    MAX_SYNTHETIC_FIELDS, MAX_SYNTHETIC_TEXT_BYTES,
};
use abi_gen::abi::types::{
    IntegralType, PrimitiveType, StructDisplay, SyntheticField, SyntheticType, TypeKind,
};
use std::collections::BTreeMap;

/* Context a caller may supply. Every field is optional: without it, the
 * functions that need it report the value as unavailable. */
#[derive(Debug, Clone, Default)]
pub struct SyntheticContext<'a> {
    pub account_addresses: Option<&'a [String]>,
    /* The well-known handlers formatting uses, so a template writes a value
     * the same way the value itself is shown. Without it, structured values
     * cannot go into text. */
    pub registry: Option<&'a WellKnownRegistry>,
}

/* A computed value, already checked against the field's return type: a
 * decoded value of that type, or none for an optional field. */
#[derive(Debug, Clone)]
pub enum SyntheticValue {
    Value(ReflectedValue),
    None,
}

/* Why a field has no value. `Unavailable` means context was missing;
 * `Error` means the recorded data could not produce a value. */
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SyntheticFailure {
    Unavailable(String),
    Error(String),
}

impl SyntheticFailure {
    pub fn status(&self) -> &'static str {
        match self {
            SyntheticFailure::Unavailable(_) => "unavailable",
            SyntheticFailure::Error(_) => "error",
        }
    }

    pub fn message(&self) -> &str {
        match self {
            SyntheticFailure::Unavailable(m) | SyntheticFailure::Error(m) => m,
        }
    }
}

pub type SyntheticOutcome = Result<SyntheticValue, SyntheticFailure>;

/* Evaluate every synthetic field of one struct, in declared order. */
pub fn evaluate_struct<'a>(
    display: &'a StructDisplay,
    fields: &'a [(String, ReflectedValue)],
    ctx: &'a SyntheticContext<'a>,
) -> Vec<(String, SyntheticOutcome)> {
    let mut evaluator = Evaluator {
        display,
        fields,
        ctx,
        done: BTreeMap::new(),
        in_progress: Vec::new(),
        eval_depth: 0,
        depth_failures: 0,
    };
    display
        .synthetic
        .iter()
        .map(|field| (field.name.clone(), evaluator.field(field)))
        .collect()
}

/* An intermediate value while evaluating an expression. */
#[derive(Debug, Clone)]
enum Val<'v> {
    Int(i128),
    Text(String),
    Bool(bool),
    Address(String),
    None,
    /* A decoded wire value, borrowed from the struct being formatted. */
    Node(&'v ReflectedValue),
    /* A value built by a built-in or by another synthetic field. */
    Built(ReflectedValue),
}

impl Val<'_> {
    fn node(&self) -> Option<&ReflectedValue> {
        match self {
            Val::Node(node) => Some(node),
            Val::Built(node) => Some(node),
            _ => None,
        }
    }
}

struct Evaluator<'a, 'v> {
    display: &'a StructDisplay,
    fields: &'v [(String, ReflectedValue)],
    ctx: &'a SyntheticContext<'a>,
    done: BTreeMap<String, SyntheticOutcome>,
    in_progress: Vec<String>,
    /* Expression levels on the stack right now, across every field being
     * evaluated, so chained fields cannot stack their depths unbounded. */
    eval_depth: usize,
    /* Times a depth budget ran out. Such failures depend on where the
     * caller started, so they are never cached. */
    depth_failures: usize,
}

/* Largest FixedPoint scale whose 10^scale fits a u64. */
const MAX_FIXED_POINT_SCALE: u8 = 19;

/* Most expression levels evaluated at once, counting calls into other
 * fields. Each expression is at most MAX_NESTING deep on its own. */
const MAX_EVAL_DEPTH: usize = 256;

fn error<T>(message: impl Into<String>) -> Result<T, SyntheticFailure> {
    Err(SyntheticFailure::Error(message.into()))
}

impl<'a, 'v> Evaluator<'a, 'v> {
    fn field(&mut self, field: &SyntheticField) -> SyntheticOutcome {
        if let Some(outcome) = self.done.get(&field.name) {
            return outcome.clone();
        }
        if self.in_progress.contains(&field.name) {
            return error(format!("'{}' depends on itself", field.name));
        }
        /* Raw JSON can skip load-time checks, so bound the chain here too. */
        if self.in_progress.len() >= MAX_SYNTHETIC_FIELDS {
            self.depth_failures += 1;
            return error("synthetic fields depend on each other too deeply");
        }
        let depth_failures_before = self.depth_failures;
        self.in_progress.push(field.name.clone());
        let outcome = parse_expression(&field.expression)
            .map_err(|err| SyntheticFailure::Error(format!("invalid expression: {err}")))
            .and_then(|expr| self.eval(&expr))
            .and_then(|value| coerce(value, &field.return_type, self.ctx.registry));
        self.in_progress.pop();
        /* A failure that came from the caller's remaining depth is not this
         * field's own; evaluated from the top it may well succeed. Errors
         * short-circuit, so an uncached failure never fans out. */
        if outcome.is_ok() || self.depth_failures == depth_failures_before {
            self.done.insert(field.name.clone(), outcome.clone());
        }
        outcome
    }

    fn eval(&mut self, expr: &SyntheticExpr) -> Result<Val<'v>, SyntheticFailure> {
        if self.eval_depth >= MAX_EVAL_DEPTH {
            self.depth_failures += 1;
            return error("expressions nest too deeply across fields");
        }
        self.eval_depth += 1;
        let result = self.eval_node(expr);
        self.eval_depth -= 1;
        result
    }

    fn eval_node(&mut self, expr: &SyntheticExpr) -> Result<Val<'v>, SyntheticFailure> {
        match expr {
            SyntheticExpr::Integer(n) => Ok(Val::Int(*n)),
            SyntheticExpr::Str(s) => Ok(Val::Text(s.clone())),
            SyntheticExpr::Bool(b) => Ok(Val::Bool(*b)),
            SyntheticExpr::None => Ok(Val::None),
            SyntheticExpr::Path(segments) => self.path(segments),
            SyntheticExpr::Unary(op, inner) => {
                let value = self.eval(inner)?;
                match op {
                    UnaryOp::Not => Ok(Val::Bool(!as_bool(&value)?)),
                    UnaryOp::Neg => as_int(&value)?
                        .checked_neg()
                        .map(Val::Int)
                        .ok_or_else(|| SyntheticFailure::Error("integer overflow".into())),
                }
            }
            SyntheticExpr::Binary(op, left, right) => self.binary(*op, left, right),
            SyntheticExpr::If(cond, then, otherwise) => {
                let cond = self.eval(cond)?;
                if as_bool(&cond)? {
                    self.eval(then)
                } else {
                    self.eval(otherwise)
                }
            }
            SyntheticExpr::Template(parts) => {
                let mut out = String::new();
                for part in parts {
                    match part {
                        TemplatePart::Text(text) => push_bounded(&mut out, text)?,
                        TemplatePart::Expr(expr) => {
                            let value = self.eval(expr)?;
                            push_bounded(&mut out, &as_text(&value, self.ctx.registry)?)?;
                        }
                    }
                }
                Ok(Val::Text(out))
            }
            SyntheticExpr::Call(name, args) => {
                let mut values = Vec::with_capacity(args.len());
                for arg in args {
                    values.push(self.eval(arg)?);
                }
                self.call(name, &values)
            }
        }
    }

    fn binary(
        &mut self,
        op: BinaryOp,
        left: &SyntheticExpr,
        right: &SyntheticExpr,
    ) -> Result<Val<'v>, SyntheticFailure> {
        /* && and || skip the right side when the left side decides. */
        if matches!(op, BinaryOp::And | BinaryOp::Or) {
            let left = as_bool(&self.eval(left)?)?;
            if (op == BinaryOp::And) != left {
                return Ok(Val::Bool(left));
            }
            return Ok(Val::Bool(as_bool(&self.eval(right)?)?));
        }
        let left = self.eval(left)?;
        let right = self.eval(right)?;
        if matches!(op, BinaryOp::Eq | BinaryOp::Ne) {
            let equal = values_equal(&left, &right, self.ctx.registry)?;
            return Ok(Val::Bool(equal == (op == BinaryOp::Eq)));
        }
        let (a, b) = (as_int(&left)?, as_int(&right)?);
        let overflow = || SyntheticFailure::Error("integer overflow".into());
        Ok(match op {
            BinaryOp::Add => Val::Int(a.checked_add(b).ok_or_else(overflow)?),
            BinaryOp::Sub => Val::Int(a.checked_sub(b).ok_or_else(overflow)?),
            BinaryOp::Mul => Val::Int(a.checked_mul(b).ok_or_else(overflow)?),
            BinaryOp::Div | BinaryOp::Mod if b == 0 => return error("division by zero"),
            BinaryOp::Div => Val::Int(a.checked_div(b).ok_or_else(overflow)?),
            BinaryOp::Mod => Val::Int(a.checked_rem(b).ok_or_else(overflow)?),
            BinaryOp::Lt => Val::Bool(a < b),
            BinaryOp::Le => Val::Bool(a <= b),
            BinaryOp::Gt => Val::Bool(a > b),
            BinaryOp::Ge => Val::Bool(a >= b),
            BinaryOp::Eq | BinaryOp::Ne | BinaryOp::And | BinaryOp::Or => unreachable!(),
        })
    }

    fn path(&mut self, segments: &[PathSegment]) -> Result<Val<'v>, SyntheticFailure> {
        let Some(PathSegment::Field(root)) = segments.first() else {
            return error("empty path");
        };
        let mut current: Val<'v> =
            if let Some((_, value)) = self.fields.iter().find(|(name, _)| name == root) {
                Val::Node(value)
            } else if let Some(field) = self.display.synthetic.iter().find(|f| &f.name == root) {
                match self.field(field) {
                    Ok(value) => from_synthetic(value),
                    Err(SyntheticFailure::Unavailable(m)) => {
                        return Err(SyntheticFailure::Unavailable(format!("{root}: {m}")))
                    }
                    Err(SyntheticFailure::Error(m)) => return error(format!("{root}: {m}")),
                }
            } else {
                return error(format!("unknown field '{root}'"));
            };
        for segment in &segments[1..] {
            current = match current {
                Val::Node(node) => Val::Node(child(deref(node), segment)?),
                Val::Built(node) => Val::Built(child(deref(&node), segment)?.clone()),
                _ => return error("only decoded fields can be navigated"),
            };
        }
        Ok(current)
    }

    fn call(&self, name: &str, args: &[Val<'v>]) -> Result<Val<'v>, SyntheticFailure> {
        match (name, args) {
            ("accountAddress", [index]) => {
                let index = as_int(index)?;
                let Some(accounts) = self.ctx.account_addresses else {
                    return Err(SyntheticFailure::Unavailable(
                        "transaction account list not provided".into(),
                    ));
                };
                usize::try_from(index)
                    .ok()
                    .and_then(|i| accounts.get(i))
                    .map(|address| Val::Address(address.clone()))
                    .ok_or_else(|| {
                        SyntheticFailure::Error(format!(
                            "account index {index} out of range ({} accounts)",
                            accounts.len()
                        ))
                    })
            }
            ("toDecimal", [amount, decimals]) => Ok(Val::Built(decimal_node(&decimal_digits(
                as_int(amount)?,
                as_int(decimals)?,
            )?))),
            ("toFixedPoint", [mantissa, scale]) => {
                let mantissa = i64::try_from(as_int(mantissa)?)
                    .map_err(|_| SyntheticFailure::Error("mantissa does not fit i64".into()))?;
                /* FixedPoint divides by 10^scale in a u64, so 19 is the largest
                 * scale it can show; refuse more rather than display 0. */
                let scale = u8::try_from(as_int(scale)?)
                    .ok()
                    .filter(|scale| *scale <= MAX_FIXED_POINT_SCALE)
                    .ok_or_else(|| {
                        SyntheticFailure::Error(format!(
                            "scale above {MAX_FIXED_POINT_SCALE} is not supported"
                        ))
                    })?;
                Ok(Val::Built(fixed_point_node(mantissa, scale)))
            }
            ("toMoney", [amount, decimals, currency]) => {
                let (units, nanos) = money_parts(as_int(amount)?, as_int(decimals)?)?;
                let currency = as_text(currency, self.ctx.registry)?;
                if currency.len() != 3 || !currency.bytes().all(|b| b.is_ascii_uppercase()) {
                    return error(format!("currency '{currency}' is not a 3-letter code"));
                }
                Ok(Val::Built(money_node(currency.as_bytes(), units, nanos)))
            }
            ("timestamp", [seconds]) => {
                let seconds = i64::try_from(as_int(seconds)?)
                    .map_err(|_| SyntheticFailure::Error("seconds do not fit i64".into()))?;
                Ok(Val::Built(timestamp_node(seconds)))
            }
            ("text", [bytes, length]) => {
                /* Check the length first, then read only that prefix, so the
                 * cost never depends on how large the array is. */
                let length = usize::try_from(as_int(length)?)
                    .map_err(|_| SyntheticFailure::Error("negative text length".into()))?;
                if length > MAX_SYNTHETIC_TEXT_BYTES {
                    return error(format!("text longer than {MAX_SYNTHETIC_TEXT_BYTES} bytes"));
                }
                let (bytes, total) = as_byte_prefix(bytes, length)?;
                if length > total {
                    return error(format!("text length {length} exceeds {total} bytes"));
                }
                String::from_utf8(bytes)
                    .map(Val::Text)
                    .map_err(|_| SyntheticFailure::Error("text is not valid UTF-8".into()))
            }
            _ => error(format!(
                "unknown function '{name}' with {} argument(s)",
                args.len()
            )),
        }
    }
}

/* Append text, failing the field rather than growing past the per-value cap.
 * With at most MAX_SYNTHETIC_FIELDS per struct, a struct's computed text is
 * bounded no matter how templates chain. */
fn push_bounded(out: &mut String, piece: &str) -> Result<(), SyntheticFailure> {
    if out.len() + piece.len() > MAX_SYNTHETIC_TEXT_BYTES {
        return error(format!("text longer than {MAX_SYNTHETIC_TEXT_BYTES} bytes"));
    }
    out.push_str(piece);
    Ok(())
}

/* Follow type references to the underlying decoded value. */
fn deref(mut node: &ReflectedValue) -> &ReflectedValue {
    while let Value::TypeRef { value, .. } = node.get_value() {
        node = value;
    }
    node
}

fn from_synthetic<'v>(value: SyntheticValue) -> Val<'v> {
    match value {
        SyntheticValue::Value(node) => Val::Built(node),
        SyntheticValue::None => Val::None,
    }
}

fn child<'x>(
    node: &'x ReflectedValue,
    segment: &PathSegment,
) -> Result<&'x ReflectedValue, SyntheticFailure> {
    match (segment, node.get_value()) {
        (PathSegment::Field(name), Value::Struct { fields }) => fields
            .iter()
            .find(|(field, _)| field == name)
            .map(|(_, value)| value)
            .ok_or_else(|| SyntheticFailure::Error(format!("no field '{name}'"))),
        (PathSegment::Index(i), Value::Array { elements }) => usize::try_from(*i)
            .ok()
            .and_then(|i| elements.get(i))
            .ok_or_else(|| SyntheticFailure::Error(format!("index {i} out of range"))),
        (PathSegment::Field(name), _) => error(format!("no field '{name}'")),
        (PathSegment::Index(_), _) => error("not an array"),
    }
}

/* The ABI type name of a decoded or built value. */
fn node_type_name(node: &ReflectedValue) -> &str {
    match (&node.value, &node.type_info.kind) {
        (Value::TypeRef { target_name, .. }, _) => target_name,
        (_, ReflectedTypeKind::TypeRef { target_name, .. }) => target_name,
        _ => &node.type_info.name,
    }
}

fn primitive_int(value: &PrimitiveValue) -> Option<i128> {
    Some(match value {
        PrimitiveValue::U8(v) => v.value.into(),
        PrimitiveValue::U16(v) => v.value.into(),
        PrimitiveValue::U32(v) => v.value.into(),
        PrimitiveValue::U64(v) => v.value.into(),
        PrimitiveValue::I8(v) => v.value.into(),
        PrimitiveValue::I16(v) => v.value.into(),
        PrimitiveValue::I32(v) => v.value.into(),
        PrimitiveValue::I64(v) => v.value.into(),
        _ => return None,
    })
}

fn as_int(value: &Val) -> Result<i128, SyntheticFailure> {
    match value {
        Val::Int(n) => Ok(*n),
        Val::Node(_) | Val::Built(_) => match value.node().map(|node| deref(node).get_value()) {
            Some(Value::Primitive(p)) => primitive_int(p)
                .ok_or_else(|| SyntheticFailure::Error("expected an integer".into())),
            _ => error("expected an integer"),
        },
        _ => error("expected an integer"),
    }
}

fn as_bool(value: &Val) -> Result<bool, SyntheticFailure> {
    match value {
        Val::Bool(b) => Ok(*b),
        Val::Node(node) if node_type_name(node) == "Bool" => bool_field(node),
        Val::Built(node) if node_type_name(node) == "Bool" => bool_field(node),
        _ => error("expected true or false"),
    }
}

fn bool_field(node: &ReflectedValue) -> Result<bool, SyntheticFailure> {
    child(deref(node), &PathSegment::Field("value".into()))
        .ok()
        .and_then(|value| match deref(value).get_value() {
            Value::Primitive(p) => primitive_int(p),
            _ => None,
        })
        .map(|byte| byte != 0)
        .ok_or_else(|| SyntheticFailure::Error("expected true or false".into()))
}

/* The first `limit` bytes of a decoded byte array (or of a struct wrapping
 * one, like Pubkey), plus the array's full length. Visits at most `limit`
 * elements. */
fn as_byte_prefix(value: &Val, limit: usize) -> Result<(Vec<u8>, usize), SyntheticFailure> {
    let Some(node) = value.node() else {
        return error("expected bytes");
    };
    node_byte_prefix(node, limit).ok_or_else(|| SyntheticFailure::Error("expected bytes".into()))
}

fn node_byte_prefix(node: &ReflectedValue, limit: usize) -> Option<(Vec<u8>, usize)> {
    match deref(node).get_value() {
        Value::Array { elements } => {
            let prefix = elements
                .iter()
                .take(limit)
                .map(|element| match deref(element).get_value() {
                    Value::Primitive(PrimitiveValue::U8(v)) => Some(v.value),
                    _ => None,
                })
                .collect::<Option<Vec<u8>>>()?;
            Some((prefix, elements.len()))
        }
        Value::Struct { fields } if fields.len() == 1 => node_byte_prefix(&fields[0].1, limit),
        _ => None,
    }
}

fn address_bytes(value: &Val) -> Result<[u8; 32], SyntheticFailure> {
    match value {
        Val::Address(address) => decode_thru_address(address)
            .ok_or_else(|| SyntheticFailure::Error(format!("'{address}' is not an address"))),
        Val::Node(_) | Val::Built(_) => as_byte_prefix(value, 32)
            .ok()
            .filter(|(_, total)| *total == 32)
            .and_then(|(bytes, _)| bytes.try_into().ok())
            .ok_or_else(|| SyntheticFailure::Error("expected a 32-byte address".into())),
        _ => error("expected an address"),
    }
}

fn as_text(value: &Val, registry: Option<&WellKnownRegistry>) -> Result<String, SyntheticFailure> {
    match value {
        Val::Text(s) | Val::Address(s) => Ok(s.clone()),
        Val::Int(n) => Ok(n.to_string()),
        Val::Bool(b) => Ok(b.to_string()),
        Val::None => error("cannot put none into text"),
        Val::Node(node) => node_text(node, registry),
        Val::Built(node) => node_text(node, registry),
    }
}

/* Text for a decoded value: an integer's digits, or a well-known type's
 * display text (an address, an ISO time, a decimal). */
fn node_text(
    node: &ReflectedValue,
    registry: Option<&WellKnownRegistry>,
) -> Result<String, SyntheticFailure> {
    if let Value::Primitive(p) = deref(node).get_value() {
        if let Some(n) = primitive_int(p) {
            return Ok(n.to_string());
        }
    }
    registry
        .and_then(|registry| crate::formatter::display_form_of(node, registry))
        .map(|(_, text)| text)
        .ok_or_else(|| SyntheticFailure::Error("cannot put a structured value into text".into()))
}

fn values_equal(
    left: &Val,
    right: &Val,
    registry: Option<&WellKnownRegistry>,
) -> Result<bool, SyntheticFailure> {
    let int_like = |v: &Val| matches!(v, Val::Int(_)) || (v.node().is_some() && as_int(v).is_ok());
    Ok(match (left, right) {
        (Val::None, Val::None) => true,
        (Val::None, _) | (_, Val::None) => false,
        (Val::Bool(a), Val::Bool(b)) => a == b,
        (Val::Text(a), Val::Text(b)) => a == b,
        /* A computed Bool or Text against a literal, in either order. */
        (Val::Bool(_), _) | (_, Val::Bool(_)) => as_bool(left)? == as_bool(right)?,
        (Val::Text(_), _) | (_, Val::Text(_)) => {
            as_text(left, registry)? == as_text(right, registry)?
        }
        _ if int_like(left) && int_like(right) => as_int(left)? == as_int(right)?,
        (
            Val::Address(_) | Val::Node(_) | Val::Built(_),
            Val::Address(_) | Val::Node(_) | Val::Built(_),
        ) => match (address_bytes(left), address_bytes(right)) {
            (Ok(a), Ok(b)) => a == b,
            _ => as_text(left, registry)? == as_text(right, registry)?,
        },
        _ => return error("cannot compare values of different kinds"),
    })
}

/* Exact decimal digits of amount / 10^decimals: 2500000 with 6 decimals is
 * "2.5". Never rounds; trailing fractional zeros are dropped. */
fn decimal_digits(amount: i128, decimals: i128) -> Result<String, SyntheticFailure> {
    let decimals = usize::try_from(decimals)
        .ok()
        .filter(|d| *d <= 38)
        .ok_or_else(|| SyntheticFailure::Error(format!("unsupported decimals {decimals}")))?;
    let sign = if amount < 0 { "-" } else { "" };
    let digits = format!("{:0>width$}", amount.unsigned_abs(), width = decimals + 1);
    let (whole, fraction) = digits.split_at(digits.len() - decimals);
    let fraction = fraction.trim_end_matches('0');
    Ok(if fraction.is_empty() {
        format!("{sign}{whole}")
    } else {
        format!("{sign}{whole}.{fraction}")
    })
}

/* amount / 10^decimals as Money's whole units and nanos (billionths), with
 * the same sign. Fails rather than drop digits finer than a nano. */
fn money_parts(amount: i128, decimals: i128) -> Result<(i64, i32), SyntheticFailure> {
    let decimals = u32::try_from(decimals)
        .ok()
        .filter(|d| *d <= 38)
        .ok_or_else(|| SyntheticFailure::Error(format!("unsupported decimals {decimals}")))?;
    let scale = 10i128.pow(decimals);
    let (units, rest) = (amount / scale, amount % scale);
    let nanos = if decimals <= 9 {
        rest * 10i128.pow(9 - decimals)
    } else {
        let drop = 10i128.pow(decimals - 9);
        if rest % drop != 0 {
            return error("amount has digits finer than Money's nanos");
        }
        rest / drop
    };
    let units = i64::try_from(units)
        .map_err(|_| SyntheticFailure::Error("amount does not fit Money's units".into()))?;
    Ok((units, nanos as i32))
}

/* ---------------------------------------------------------------------------
 * Built values: decoded values of a declared type, made without bytes. Field
 * names and types follow the type library (thru.common.primitives,
 * google.type), so they format exactly like the same type read off the wire.
 * ------------------------------------------------------------------------- */

fn type_info(name: &str, kind: ReflectedTypeKind, size: Option<u64>) -> ReflectedType {
    ReflectedType {
        name: name.to_string(),
        kind,
        size,
        alignment: 1,
        comment: None,
        format: None,
        display: None,
        dynamic_params: BTreeMap::new(),
    }
}

fn integral_node(integral: &IntegralType, n: i128) -> Result<ReflectedValue, SyntheticFailure> {
    let out_of_range = || {
        SyntheticFailure::Error(format!(
            "{n} does not fit {}",
            format!("{integral:?}").to_lowercase()
        ))
    };
    macro_rules! prim {
        ($variant:ident, $wrapper:ident, $ty:ty, $name:literal) => {
            (
                PrimitiveValue::$variant($wrapper {
                    type_name: $name.to_string(),
                    value: <$ty>::try_from(n).map_err(|_| out_of_range())?,
                }),
                std::mem::size_of::<$ty>() as u64,
            )
        };
    }
    let (value, size) = match integral {
        IntegralType::U8 => prim!(U8, PrimitiveValueU8, u8, "u8"),
        IntegralType::U16 => prim!(U16, PrimitiveValueU16, u16, "u16"),
        IntegralType::U32 => prim!(U32, PrimitiveValueU32, u32, "u32"),
        IntegralType::U64 => prim!(U64, PrimitiveValueU64, u64, "u64"),
        IntegralType::I8 => prim!(I8, PrimitiveValueI8, i8, "i8"),
        IntegralType::I16 => prim!(I16, PrimitiveValueI16, i16, "i16"),
        IntegralType::I32 => prim!(I32, PrimitiveValueI32, i32, "i32"),
        IntegralType::I64 => prim!(I64, PrimitiveValueI64, i64, "i64"),
        IntegralType::Char => return error("cannot build a char"),
    };
    let name = format!("{integral:?}").to_lowercase();
    Ok(ReflectedValue::new(
        type_info(
            &name,
            ReflectedTypeKind::Primitive {
                prim_type: PrimitiveType::Integral(integral.clone()),
            },
            Some(size),
        ),
        Value::Primitive(value),
    ))
}

fn int_field(integral: IntegralType, n: i128) -> ReflectedValue {
    integral_node(&integral, n).expect("value checked by the caller")
}

fn bytes_node(bytes: &[u8]) -> ReflectedValue {
    let element = type_info(
        "u8",
        ReflectedTypeKind::Primitive {
            prim_type: PrimitiveType::Integral(IntegralType::U8),
        },
        Some(1),
    );
    ReflectedValue::new(
        type_info(
            "u8[]",
            ReflectedTypeKind::Array {
                element_type: Box::new(element),
                size_expression: bytes.len().to_string(),
                size_constant_status: "Constant".into(),
            },
            Some(bytes.len() as u64),
        ),
        Value::Array {
            elements: bytes
                .iter()
                .map(|b| int_field(IntegralType::U8, (*b).into()))
                .collect(),
        },
    )
}

fn struct_node(name: &str, fields: Vec<(&str, ReflectedValue)>) -> ReflectedValue {
    let size = fields
        .iter()
        .map(|(_, value)| value.type_info.size)
        .sum::<Option<u64>>();
    let kind = ReflectedTypeKind::Struct {
        fields: fields
            .iter()
            .map(|(field, value)| ReflectedField {
                name: field.to_string(),
                field_type: value.type_info.clone(),
                offset: None,
            })
            .collect(),
        packed: true,
        custom_alignment: None,
    };
    ReflectedValue::new(
        type_info(name, kind, size),
        Value::Struct {
            fields: fields
                .into_iter()
                .map(|(field, value)| (field.to_string(), value))
                .collect(),
        },
    )
}

fn pubkey_node(bytes: &[u8; 32]) -> ReflectedValue {
    struct_node("Pubkey", vec![("bytes", bytes_node(bytes))])
}

fn text_node(text: &str) -> Result<ReflectedValue, SyntheticFailure> {
    let len = u16::try_from(text.len())
        .map_err(|_| SyntheticFailure::Error("text longer than 65535 bytes".into()))?;
    Ok(struct_node(
        "Text",
        vec![
            ("len", int_field(IntegralType::U16, len.into())),
            ("bytes", bytes_node(text.as_bytes())),
        ],
    ))
}

fn bool_node(value: bool) -> ReflectedValue {
    struct_node(
        "Bool",
        vec![("value", int_field(IntegralType::U8, value.into()))],
    )
}

fn decimal_node(digits: &str) -> ReflectedValue {
    /* decimal_digits gives at most 40 characters, so the length fits. */
    struct_node(
        "Decimal",
        vec![
            (
                "value_len",
                int_field(IntegralType::U16, digits.len() as i128),
            ),
            ("value", bytes_node(digits.as_bytes())),
        ],
    )
}

fn fixed_point_node(mantissa: i64, scale: u8) -> ReflectedValue {
    struct_node(
        "FixedPoint",
        vec![
            ("mantissa", int_field(IntegralType::I64, mantissa.into())),
            ("scale", int_field(IntegralType::U8, scale.into())),
        ],
    )
}

fn money_node(currency: &[u8], units: i64, nanos: i32) -> ReflectedValue {
    struct_node(
        "Money",
        vec![
            ("currency_code", bytes_node(currency)),
            ("units", int_field(IntegralType::I64, units.into())),
            ("nanos", int_field(IntegralType::I32, nanos.into())),
        ],
    )
}

fn timestamp_node(seconds: i64) -> ReflectedValue {
    struct_node(
        "Timestamp",
        vec![("seconds", int_field(IntegralType::I64, seconds.into()))],
    )
}

/* Drop display info from a value and everything inside it. */
fn strip_display(node: &mut ReflectedValue) {
    node.type_info.display = None;
    match &mut node.value {
        Value::Struct { fields } => fields.iter_mut().for_each(|(_, v)| strip_display(v)),
        Value::Union { variants } => variants.iter_mut().for_each(|(_, v)| strip_display(v)),
        Value::Array { elements } => elements.iter_mut().for_each(strip_display),
        Value::Enum { variant_value, .. } | Value::SizeDiscriminatedUnion { variant_value, .. } => {
            strip_display(variant_value)
        }
        Value::TypeRef { value, .. } => strip_display(value),
        Value::Primitive(_) => {}
    }
}

/* Turn an expression's result into a value of the declared type. */
fn coerce(
    value: Val,
    return_type: &SyntheticType,
    registry: Option<&WellKnownRegistry>,
) -> SyntheticOutcome {
    match (return_type, value) {
        (SyntheticType::Optional(_), Val::None) => Ok(SyntheticValue::None),
        (_, Val::None) => error("value is none, but the return-type is not optional"),
        (_, value) => build(value, return_type.inner(), registry).map(SyntheticValue::Value),
    }
}

fn build(
    value: Val,
    kind: &TypeKind,
    registry: Option<&WellKnownRegistry>,
) -> Result<ReflectedValue, SyntheticFailure> {
    match kind {
        TypeKind::Primitive(PrimitiveType::Integral(integral)) => {
            integral_node(integral, as_int(&value)?)
        }
        TypeKind::TypeRef(type_ref) => {
            let name = type_ref.name.as_str();
            /* A decoded or built value of the same named type passes through,
             * as plain data: without its own display info, so formatting the
             * copy never evaluates nested synthetic fields again. */
            if let Some(node) = value.node() {
                if node_type_name(node) == name {
                    let mut copy = node.clone();
                    strip_display(&mut copy);
                    return Ok(copy);
                }
            }
            match name {
                "Pubkey" => Ok(pubkey_node(&address_bytes(&value)?)),
                "Text" => text_node(&as_text(&value, registry)?),
                "Bool" => Ok(bool_node(as_bool(&value)?)),
                _ => error(format!("expected a {name} value")),
            }
        }
        other => error(format!("cannot build a {} value", type_label(other))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use abi_gen::abi::types::{StructDisplay, SyntheticField, SyntheticType, TypeRefType};

    fn i64_type() -> SyntheticType {
        SyntheticType::Value(TypeKind::Primitive(PrimitiveType::Integral(
            IntegralType::I64,
        )))
    }

    fn named(name: &str) -> SyntheticType {
        SyntheticType::Value(TypeKind::TypeRef(TypeRefType {
            name: name.into(),
            package: None,
            comment: None,
        }))
    }

    /* The integer a built value holds, or the failure. */
    fn int(outcome: &SyntheticOutcome) -> Result<i128, SyntheticFailure> {
        match outcome {
            Ok(SyntheticValue::Value(node)) => as_int(&Val::Node(node)),
            Ok(SyntheticValue::None) => error("none"),
            Err(failure) => Err(failure.clone()),
        }
    }

    fn text(outcome: &SyntheticOutcome) -> Result<String, SyntheticFailure> {
        match outcome {
            Ok(SyntheticValue::Value(node)) => {
                node_text(node, Some(&WellKnownRegistry::with_defaults()))
            }
            Ok(SyntheticValue::None) => error("none"),
            Err(failure) => Err(failure.clone()),
        }
    }

    fn display(fields: Vec<(String, String, SyntheticType)>) -> StructDisplay {
        StructDisplay {
            synthetic: fields
                .into_iter()
                .map(|(name, expression, return_type)| SyntheticField {
                    name,
                    return_type,
                    expression,
                    display_name: None,
                    user_display: Some(true),
                    position: 0,
                })
                .collect(),
            ..StructDisplay::default()
        }
    }

    fn run(display: &StructDisplay) -> Vec<SyntheticOutcome> {
        let registry = WellKnownRegistry::with_defaults();
        let ctx = SyntheticContext {
            registry: Some(&registry),
            ..SyntheticContext::default()
        };
        evaluate_struct(display, &[], &ctx)
            .into_iter()
            .map(|(_, outcome)| outcome)
            .collect()
    }

    #[test]
    fn signed_overflow_is_a_field_error_not_a_panic() {
        let min = "(-170141183460469231731687303715884105727 - 1)";
        let d = display(vec![
            ("div".into(), format!("{min} / -1"), i64_type()),
            ("rem".into(), format!("{min} % -1"), i64_type()),
            ("ok".into(), "7 / 2".into(), i64_type()),
        ]);
        let out = run(&d);
        assert_eq!(
            int(&out[0]),
            Err(SyntheticFailure::Error("integer overflow".into()))
        );
        assert_eq!(
            int(&out[1]),
            Err(SyntheticFailure::Error("integer overflow".into()))
        );
        assert_eq!(int(&out[2]), Ok(3));
    }

    #[test]
    fn doubling_templates_stop_at_the_text_cap() {
        let mut fields = vec![("s0".to_string(), "\"xxxxxxxx\"".to_string(), named("Text"))];
        for i in 1..40 {
            fields.push((
                format!("s{i}"),
                format!("`${{s{p}}}${{s{p}}}`", p = i - 1),
                named("Text"),
            ));
        }
        let out = run(&display(fields));
        /* 8 * 2^7 = 1024 bytes fits; the next doubling does not. */
        assert_eq!(text(&out[7]).map(|t| t.len()), Ok(1024));
        assert!(
            matches!(&out[8], Err(SyntheticFailure::Error(m)) if m.contains("text longer than")),
            "{:?}",
            text(&out[8])
        );
        assert!(out[39].is_err());
    }

    #[test]
    fn long_dependency_chains_fail_instead_of_recursing() {
        /* Raw JSON can carry more fields than load-time validation allows. */
        /* Declared so that evaluating f0 first walks the whole chain. */
        let mut fields: Vec<_> = (0..199)
            .map(|i| (format!("f{i}"), format!("f{} + 1", i + 1), i64_type()))
            .collect();
        fields.push(("f199".to_string(), "1".to_string(), i64_type()));
        let out = run(&display(fields));
        assert!(matches!(&out[0], Err(SyntheticFailure::Error(m)) if m.contains("too deeply")));
        assert_eq!(int(&out[199]), Ok(1));
    }

    #[test]
    fn deep_expressions_across_fields_fail_instead_of_overflowing() {
        /* 64 fields, each 60 levels deep and reading the next field: the
         * combined depth passes the evaluation budget. */
        let mut fields: Vec<_> = (0..63)
            .map(|i| {
                (
                    format!("f{i}"),
                    format!("f{}{}", i + 1, "+0".repeat(58)),
                    i64_type(),
                )
            })
            .collect();
        fields.push(("f63".to_string(), "1".to_string(), i64_type()));
        let out = run(&display(fields));
        assert!(matches!(&out[0], Err(SyntheticFailure::Error(m)) if m.contains("too deeply")));
        assert_eq!(int(&out[63]), Ok(1));
        assert_eq!(int(&out[62]), Ok(1));
    }

    #[test]
    fn depth_failures_are_not_cached_against_other_fields() {
        /* f0..f4 each ~60 levels deep and read the next field. From f0 the
         * chain passes the budget inside f4; f1..f4 alone each fit. */
        let mut fields: Vec<_> = (0..4)
            .map(|i| {
                (
                    format!("f{i}"),
                    format!("f{}{}", i + 1, "+0".repeat(58)),
                    i64_type(),
                )
            })
            .collect();
        fields.push((
            "f4".to_string(),
            format!("1{}", "+0".repeat(58)),
            i64_type(),
        ));
        let out = run(&display(fields));
        assert!(matches!(&out[0], Err(SyntheticFailure::Error(m)) if m.contains("too deeply")));
        for (i, outcome) in out.iter().enumerate().skip(1) {
            assert_eq!(int(outcome), Ok(1), "f{i}");
        }
    }

    #[test]
    fn decimal_digits_are_exact() {
        assert_eq!(decimal_digits(2_500_000, 6).unwrap(), "2.5");
        assert_eq!(decimal_digits(1, 6).unwrap(), "0.000001");
        assert_eq!(decimal_digits(1_000_000, 6).unwrap(), "1");
        assert_eq!(decimal_digits(123, 0).unwrap(), "123");
        assert_eq!(decimal_digits(-1_500, 3).unwrap(), "-1.5");
        assert_eq!(
            decimal_digits(u64::MAX.into(), 9).unwrap(),
            "18446744073.709551615"
        );
        assert!(decimal_digits(1, 39).is_err());
    }

    #[test]
    fn money_parts_keep_every_digit_or_fail() {
        assert_eq!(money_parts(1_234, 2).unwrap(), (12, 340_000_000));
        assert_eq!(money_parts(-1_234, 2).unwrap(), (-12, -340_000_000));
        assert_eq!(money_parts(1_000_000_000_000, 12).unwrap(), (1, 0));
        assert!(money_parts(1, 12).is_err());
        assert!(money_parts(i128::from(i64::MAX) * 10 + 10, 1).is_err());
    }

    #[test]
    fn integer_returns_are_range_checked() {
        let u8_type = SyntheticType::Value(TypeKind::Primitive(PrimitiveType::Integral(
            IntegralType::U8,
        )));
        let out = run(&display(vec![
            ("fits".into(), "255".into(), u8_type.clone()),
            ("over".into(), "256".into(), u8_type.clone()),
            ("negative".into(), "0 - 1".into(), u8_type),
        ]));
        assert_eq!(int(&out[0]), Ok(255));
        assert!(
            matches!(&out[1], Err(SyntheticFailure::Error(m)) if m.contains("does not fit u8"))
        );
        assert!(out[2].is_err());
    }

    #[test]
    fn computed_text_and_bool_compare_with_literals() {
        let out = run(&display(vec![
            ("label".into(), "\"hello\"".into(), named("Text")),
            ("flag".into(), "1 < 2".into(), named("Bool")),
            ("a".into(), "label == \"hello\"".into(), named("Bool")),
            ("b".into(), "\"hello\" == label".into(), named("Bool")),
            ("c".into(), "flag == true".into(), named("Bool")),
            ("d".into(), "false != flag".into(), named("Bool")),
            ("e".into(), "label == \"bye\"".into(), named("Bool")),
        ]));
        for (i, expected) in [
            (2, "true"),
            (3, "true"),
            (4, "true"),
            (5, "true"),
            (6, "false"),
        ] {
            assert_eq!(text(&out[i]).unwrap(), expected, "field {i}");
        }
    }

    #[test]
    fn templates_use_the_callers_handlers() {
        use crate::well_known::{WellKnownContext, WellKnownResult, WellKnownType};
        struct CustomTime;
        impl WellKnownType for CustomTime {
            fn type_name(&self) -> &'static str {
                "Timestamp"
            }
            fn display_key(&self) -> Option<(&'static str, &'static str)> {
                Some(("time", "iso8601"))
            }
            fn process(&self, _: &WellKnownContext) -> WellKnownResult {
                let mut map = serde_json::Map::new();
                map.insert("iso8601".into(), "custom time".into());
                WellKnownResult::EnrichFields(map)
            }
        }
        let fields = display(vec![
            ("when".into(), "timestamp(0)".into(), named("Timestamp")),
            ("label".into(), "`at ${when}`".into(), named("Text")),
        ]);
        let mut custom = WellKnownRegistry::with_defaults();
        custom.register(std::sync::Arc::new(CustomTime));
        let ctx = SyntheticContext {
            registry: Some(&custom),
            ..SyntheticContext::default()
        };
        let out: Vec<_> = evaluate_struct(&fields, &[], &ctx)
            .into_iter()
            .map(|(_, o)| o)
            .collect();
        assert_eq!(text(&out[1]).unwrap(), "at custom time");

        /* With no handlers, a structured value cannot go into text. */
        let out: Vec<_> = evaluate_struct(&fields, &[], &SyntheticContext::default())
            .into_iter()
            .map(|(_, o)| o)
            .collect();
        assert!(out[1].is_err());
    }

    #[test]
    fn fixed_point_scale_is_capped() {
        let out = run(&display(vec![
            (
                "ok".into(),
                "toFixedPoint(1, 19)".into(),
                named("FixedPoint"),
            ),
            (
                "big".into(),
                "toFixedPoint(1, 20)".into(),
                named("FixedPoint"),
            ),
        ]));
        assert_eq!(text(&out[0]).unwrap(), "0.0000000000000000001");
        assert!(matches!(&out[1], Err(SyntheticFailure::Error(m)) if m.contains("scale above 19")));
    }

    #[test]
    fn built_ins_make_well_known_values() {
        let out = run(&display(vec![
            (
                "amount".into(),
                "toDecimal(2500000, 6)".into(),
                named("Decimal"),
            ),
            (
                "fixed".into(),
                "toFixedPoint(1234, 2)".into(),
                named("FixedPoint"),
            ),
            (
                "price".into(),
                "toMoney(1234, 2, \"USD\")".into(),
                named("Money"),
            ),
            ("when".into(), "timestamp(0)".into(), named("Timestamp")),
            (
                "label".into(),
                "`${amount} at ${when}`".into(),
                named("Text"),
            ),
            (
                "bad".into(),
                "toMoney(1, 2, \"usd\")".into(),
                named("Money"),
            ),
            ("flag".into(), "1 < 2".into(), named("Bool")),
        ]));
        assert_eq!(text(&out[0]).unwrap(), "2.5");
        assert_eq!(text(&out[1]).unwrap(), "12.34");
        assert_eq!(text(&out[2]).unwrap(), "USD 12.34");
        assert_eq!(text(&out[3]).unwrap(), "1970-01-01T00:00:00+00:00");
        assert_eq!(text(&out[4]).unwrap(), "2.5 at 1970-01-01T00:00:00+00:00");
        assert!(out[5].is_err());
        assert_eq!(text(&out[6]).unwrap(), "true");
    }
}
