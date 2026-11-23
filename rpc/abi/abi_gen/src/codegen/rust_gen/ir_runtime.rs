/* IR runtime evaluator for Rust codegen.
Evaluates `TypeIr` trees with checked arithmetic, switch handling, and nested calls.
Intended to mirror the TypeScript runtime semantics (BigInt/checked math, missing switch detection). */

use crate::codegen::shared::ir::{
    AlignNode, BinaryOpNode, CallNestedNode, Endianness, IrNode, NodeMetadata, SwitchNode, TypeIr,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum IrErrorCode {
    MissingParam,
    MissingSwitchCase,
    UnknownNestedType,
    ArithmeticOverflow,
    UnsupportedEndianness,
    UnsupportedOperation,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IrError {
    pub code: IrErrorCode,
    pub context: Option<String>,
}

impl IrError {
    pub fn missing_param(name: impl Into<String>) -> Self {
        Self {
            code: IrErrorCode::MissingParam,
            context: Some(name.into()),
        }
    }

    pub fn missing_switch_case(tag: u64) -> Self {
        Self {
            code: IrErrorCode::MissingSwitchCase,
            context: Some(tag.to_string()),
        }
    }

    pub fn unknown_nested(type_name: impl Into<String>) -> Self {
        Self {
            code: IrErrorCode::UnknownNestedType,
            context: Some(type_name.into()),
        }
    }

    pub const fn overflow() -> Self {
        Self {
            code: IrErrorCode::ArithmeticOverflow,
            context: None,
        }
    }

    pub const fn unsupported_endianness() -> Self {
        Self {
            code: IrErrorCode::UnsupportedEndianness,
            context: None,
        }
    }

    pub fn unsupported_operation(description: impl Into<String>) -> Self {
        Self {
            code: IrErrorCode::UnsupportedOperation,
            context: Some(description.into()),
        }
    }
}

pub type ParamLookup<'a> = &'a dyn Fn(&str) -> Option<u64>;
pub type NestedCaller<'a> = &'a dyn Fn(&str, &[u64]) -> Result<u64, IrError>;

pub fn eval_footprint(
    ir: &TypeIr,
    params: ParamLookup<'_>,
    nested: NestedCaller<'_>,
) -> Result<u64, IrError> {
    eval_node(&ir.root, params, nested)
}

fn eval_node(
    node: &IrNode,
    params: ParamLookup<'_>,
    nested: NestedCaller<'_>,
) -> Result<u64, IrError> {
    match node {
        IrNode::Const(c) => {
            ensure_little(&c.meta)?;
            Ok(c.value)
        }
        IrNode::ZeroSize { meta } => {
            ensure_little(meta)?;
            Ok(0)
        }
        IrNode::FieldRef(field) => {
            ensure_little(&field.meta)?;
            let name = field
                .parameter
                .as_deref()
                .unwrap_or_else(|| field.path.as_str());
            params(name).ok_or_else(|| IrError::missing_param(name))
        }
        IrNode::AddChecked(node) => combine_binary(node, params, nested, checked_add),
        IrNode::SubChecked(node) => combine_binary(node, params, nested, checked_sub),
        IrNode::MulChecked(node) => combine_binary(node, params, nested, checked_mul),
        IrNode::DivChecked(node) => combine_binary(node, params, nested, checked_div),
        IrNode::ModChecked(node) => combine_binary(node, params, nested, checked_mod),
        IrNode::BitAnd(node) => combine_binary(node, params, nested, bit_and),
        IrNode::BitOr(node) => combine_binary(node, params, nested, bit_or),
        IrNode::BitXor(node) => combine_binary(node, params, nested, bit_xor),
        IrNode::LeftShift(node) => combine_binary(node, params, nested, checked_left_shift),
        IrNode::RightShift(node) => combine_binary(node, params, nested, checked_right_shift),
        IrNode::AlignUp(node) => align_expr(node, params, nested),
        IrNode::CallNested(node) => call_nested(node, params, nested),
        IrNode::Switch(node) => switch_expr(node, params, nested),
        IrNode::SumOverArray(_node) => {
            /* Jagged arrays are not supported in runtime IR evaluation.
            Size calculation requires iteration over actual data. */
            Err(IrError::unsupported_operation(
                "SumOverArray requires iteration over actual data",
            ))
        }
    }
}

fn combine_binary(
    node: &BinaryOpNode,
    params: ParamLookup<'_>,
    nested: NestedCaller<'_>,
    op: fn(u64, u64) -> Result<u64, IrError>,
) -> Result<u64, IrError> {
    let left = eval_node(&node.left, params, nested)?;
    let right = eval_node(&node.right, params, nested)?;
    op(left, right)
}

fn checked_add(a: u64, b: u64) -> Result<u64, IrError> {
    a.checked_add(b).ok_or_else(IrError::overflow)
}

fn checked_sub(a: u64, b: u64) -> Result<u64, IrError> {
    a.checked_sub(b).ok_or_else(IrError::overflow)
}

fn checked_mul(a: u64, b: u64) -> Result<u64, IrError> {
    a.checked_mul(b).ok_or_else(IrError::overflow)
}

fn checked_div(a: u64, b: u64) -> Result<u64, IrError> {
    a.checked_div(b).ok_or_else(IrError::overflow)
}

fn checked_mod(a: u64, b: u64) -> Result<u64, IrError> {
    a.checked_rem(b).ok_or_else(IrError::overflow)
}

fn bit_and(a: u64, b: u64) -> Result<u64, IrError> {
    Ok(a & b)
}

fn bit_or(a: u64, b: u64) -> Result<u64, IrError> {
    Ok(a | b)
}

fn bit_xor(a: u64, b: u64) -> Result<u64, IrError> {
    Ok(a ^ b)
}

fn checked_left_shift(a: u64, b: u64) -> Result<u64, IrError> {
    if b >= 64 {
        return Err(IrError::overflow());
    }
    Ok(a << b)
}

fn checked_right_shift(a: u64, b: u64) -> Result<u64, IrError> {
    if b >= 64 {
        return Err(IrError::overflow());
    }
    Ok(a >> b)
}

fn align_expr(
    node: &AlignNode,
    params: ParamLookup<'_>,
    nested: NestedCaller<'_>,
) -> Result<u64, IrError> {
    ensure_little(&node.meta)?;
    let inner = eval_node(&node.node, params, nested)?;
    let alignment = node.alignment.max(1);
    if alignment <= 1 {
        return Ok(inner);
    }
    let add = checked_add(inner, alignment - 1)?;
    Ok(add & !(alignment - 1))
}

fn call_nested(
    node: &CallNestedNode,
    params: ParamLookup<'_>,
    nested: NestedCaller<'_>,
) -> Result<u64, IrError> {
    ensure_little(&node.meta)?;
    let mut args = Vec::with_capacity(node.arguments.len());
    for arg in &node.arguments {
        let value_name = arg.value.as_str();
        let Some(val) = params(value_name) else {
            return Err(IrError::missing_param(value_name));
        };
        args.push(val);
    }
    nested(&node.type_name, &args)
}

fn switch_expr(
    node: &SwitchNode,
    params: ParamLookup<'_>,
    nested: NestedCaller<'_>,
) -> Result<u64, IrError> {
    ensure_little(&node.meta)?;
    let tag = node.tag.as_str();
    let tag_val = params(tag).ok_or_else(|| IrError::missing_param(tag))?;
    for case in &node.cases {
        if case.tag_value == tag_val {
            return eval_node(&case.node, params, nested);
        }
    }
    if let Some(default) = &node.default {
        return eval_node(default, params, nested);
    }
    Err(IrError::missing_switch_case(tag_val))
}

fn ensure_little(meta: &NodeMetadata) -> Result<(), IrError> {
    match meta.endianness {
        Endianness::Little => Ok(()),
        _ => Err(IrError::unsupported_endianness()),
    }
}
