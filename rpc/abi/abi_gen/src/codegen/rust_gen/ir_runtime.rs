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
        IrNode::MulChecked(node) => combine_binary(node, params, nested, checked_mul),
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

fn checked_mul(a: u64, b: u64) -> Result<u64, IrError> {
    a.checked_mul(b).ok_or_else(IrError::overflow)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codegen::shared::ir::{
        AlignNode, BinaryOpNode, ConstNode, Endianness, IrNode, NodeMetadata, SwitchCase,
        SwitchNode, TypeIr,
    };

    fn metadata() -> NodeMetadata {
        NodeMetadata {
            size_expr: None,
            alignment: 1,
            endianness: Endianness::Little,
        }
    }

    fn noop_nested(_: &str, _: &[u64]) -> Result<u64, IrError> {
        Err(IrError::unknown_nested("noop"))
    }

    #[test]
    fn eval_const() {
        let ir = TypeIr {
            type_name: "ConstOnly".into(),
            alignment: 1,
            root: IrNode::Const(ConstNode {
                value: 16,
                meta: metadata(),
            }),
            parameters: Vec::new(),
        };
        let params = |_name: &str| None;
        assert_eq!(eval_footprint(&ir, &params, &noop_nested).unwrap(), 16);
    }

    #[test]
    fn add_overflow() {
        let ir = TypeIr {
            type_name: "Overflow".into(),
            alignment: 1,
            root: IrNode::AddChecked(BinaryOpNode {
                left: Box::new(IrNode::Const(ConstNode {
                    value: u64::MAX,
                    meta: metadata(),
                })),
                right: Box::new(IrNode::Const(ConstNode {
                    value: 1,
                    meta: metadata(),
                })),
                meta: metadata(),
            }),
            parameters: Vec::new(),
        };
        let params = |_name: &str| None;
        let err = eval_footprint(&ir, &params, &noop_nested).unwrap_err();
        assert_eq!(err.code, IrErrorCode::ArithmeticOverflow);
    }

    #[test]
    fn switch_missing_case() {
        let ir = TypeIr {
            type_name: "Switch".into(),
            alignment: 1,
            root: IrNode::Switch(SwitchNode {
                tag: "tag".into(),
                cases: vec![SwitchCase {
                    tag_value: 1,
                    node: Box::new(IrNode::Const(ConstNode {
                        value: 4,
                        meta: metadata(),
                    })),
                    parameters: Vec::new(),
                }],
                default: None,
                meta: metadata(),
            }),
            parameters: Vec::new(),
        };
        let params = |name: &str| if name == "tag" { Some(2) } else { None };
        let err = eval_footprint(&ir, &params, &noop_nested).unwrap_err();
        assert_eq!(err.code, IrErrorCode::MissingSwitchCase);
    }

    #[test]
    fn align_rounds_up() {
        let ir = TypeIr {
            type_name: "Align".into(),
            alignment: 4,
            root: IrNode::AlignUp(AlignNode {
                alignment: 8,
                node: Box::new(IrNode::Const(ConstNode {
                    value: 5,
                    meta: metadata(),
                })),
                meta: metadata(),
            }),
            parameters: Vec::new(),
        };
        let params = |_name: &str| None;
        let got = eval_footprint(&ir, &params, &noop_nested).unwrap();
        assert_eq!(got, 8);
    }

    #[test]
    fn call_nested_uses_args() {
        let ir = TypeIr {
            type_name: "Call".into(),
            alignment: 1,
            root: IrNode::CallNested(CallNestedNode {
                type_name: "Other".into(),
                arguments: vec![
                    crate::codegen::shared::ir::IrArgument {
                        name: "len".into(),
                        value: "payload.len".into(),
                    },
                    crate::codegen::shared::ir::IrArgument {
                        name: "tag".into(),
                        value: "tag".into(),
                    },
                ],
                meta: metadata(),
            }),
            parameters: Vec::new(),
        };
        let params = |name: &str| match name {
            "payload.len" => Some(3),
            "tag" => Some(7),
            _ => None,
        };
        let nested = |name: &str, args: &[u64]| -> Result<u64, IrError> {
            if name == "Other" {
                assert_eq!(args, &[3, 7]);
                Ok(10)
            } else {
                Err(IrError::unknown_nested(name))
            }
        };
        assert_eq!(eval_footprint(&ir, &params, &nested).unwrap(), 10);
    }

    #[test]
    fn rejects_non_little_endian() {
        let ir = TypeIr {
            type_name: "BigEndian".into(),
            alignment: 1,
            root: IrNode::Const(ConstNode {
                value: 1,
                meta: NodeMetadata {
                    size_expr: None,
                    alignment: 1,
                    endianness: Endianness::Big,
                },
            }),
            parameters: Vec::new(),
        };
        let params = |_name: &str| None;
        let err = eval_footprint(&ir, &params, &noop_nested).unwrap_err();
        assert_eq!(err.code, IrErrorCode::UnsupportedEndianness);
    }
}
