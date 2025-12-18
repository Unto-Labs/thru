use crate::errors::{ReflectError, ReflectResult};
use abi_gen::codegen::shared::ir::{
    CallNestedNode, IrArgument, IrNode, LayoutIr, SwitchNode, TypeIr,
};
use std::collections::BTreeMap;

/// Shared parameter map passed into the IR interpreter.
pub type ParamMap = BTreeMap<String, u128>;

/// Result of validating a type via the IR interpreter.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IrValidationResult {
    pub bytes_consumed: u128,
}

/// Evaluates layout IR nodes and enforces overflow/parameter safety.
pub struct IrInterpreter<'a> {
    layout_ir: &'a LayoutIr,
    ir_index: &'a BTreeMap<String, usize>,
}

impl<'a> IrInterpreter<'a> {
    pub fn new(layout_ir: &'a LayoutIr, ir_index: &'a BTreeMap<String, usize>) -> Self {
        Self {
            layout_ir,
            ir_index,
        }
    }

    pub fn validate(
        &self,
        type_ir: &TypeIr,
        buffer_len: usize,
        params: &ParamMap,
    ) -> ReflectResult<IrValidationResult> {
        let ctx = EvalContext {
            type_name: &type_ir.type_name,
            params,
        };
        let required = self.eval_node(&type_ir.root, &ctx)?;
        let available = buffer_len as u64;
        if required > available as u128 {
            return Err(ReflectError::BufferTooSmall {
                type_name: type_ir.type_name.clone(),
                required,
                available,
            });
        }
        Ok(IrValidationResult {
            bytes_consumed: required,
        })
    }

    fn eval_node(&self, node: &IrNode, ctx: &EvalContext<'_>) -> ReflectResult<u128> {
        match node {
            IrNode::Const(const_node) => Ok(const_node.value as u128),
            IrNode::ZeroSize { .. } => Ok(0),
            IrNode::FieldRef(field) => {
                let name = field.parameter.as_ref().unwrap_or(&field.path).to_string();
                ctx.params
                    .get(&name)
                    .copied()
                    .ok_or_else(|| ReflectError::MissingIrParameter {
                        type_name: ctx.type_name.to_string(),
                        parameter: name,
                    })
            }
            IrNode::AddChecked(node) => {
                let left = self.eval_node(&node.left, ctx)?;
                let right = self.eval_node(&node.right, ctx)?;
                checked_add(left, right, ctx.type_name)
            }
            IrNode::MulChecked(node) => {
                let left = self.eval_node(&node.left, ctx)?;
                let right = self.eval_node(&node.right, ctx)?;
                checked_mul(left, right, ctx.type_name)
            }
            IrNode::AlignUp(node) => {
                let inner = self.eval_node(&node.node, ctx)?;
                align_up(inner, node.alignment, ctx.type_name)
            }
            IrNode::Switch(node) => self.eval_switch(node, ctx),
            IrNode::CallNested(node) => self.eval_call(node, ctx),
        }
    }

    fn eval_switch(&self, node: &SwitchNode, ctx: &EvalContext<'_>) -> ReflectResult<u128> {
        let tag_value =
            ctx.params
                .get(&node.tag)
                .copied()
                .ok_or_else(|| ReflectError::MissingIrParameter {
                    type_name: ctx.type_name.to_string(),
                    parameter: node.tag.clone(),
                })?;
        let tag_number = tag_value as u64;
        for case in &node.cases {
            if case.tag_value == tag_number {
                return self.eval_node(&case.node, ctx);
            }
        }
        if let Some(default) = &node.default {
            return self.eval_node(default, ctx);
        }
        Err(ReflectError::InvalidTagValue {
            type_name: ctx.type_name.to_string(),
            tag: node.tag.clone(),
            value: tag_value,
        })
    }

    fn eval_call(&self, node: &CallNestedNode, ctx: &EvalContext<'_>) -> ReflectResult<u128> {
        let mut nested_params = self.collect_arguments(&node.arguments, ctx)?;
        let nested_type = self.lookup_type(&node.type_name)?;
        for param in &nested_type.parameters {
            if !nested_params.contains_key(&param.name) {
                if let Some(value) = ctx.params.get(&param.name) {
                    nested_params.insert(param.name.clone(), *value);
                }
            }
        }
        let nested_ctx = EvalContext {
            type_name: &nested_type.type_name,
            params: &nested_params,
        };
        self.eval_node(&nested_type.root, &nested_ctx)
    }

    fn collect_arguments(
        &self,
        args: &[IrArgument],
        ctx: &EvalContext<'_>,
    ) -> ReflectResult<ParamMap> {
        let mut map = ParamMap::new();
        for arg in args {
            let value = ctx.params.get(&arg.value).copied().ok_or_else(|| {
                ReflectError::MissingIrParameter {
                    type_name: ctx.type_name.to_string(),
                    parameter: arg.value.clone(),
                }
            })?;
            map.insert(arg.name.clone(), value);
        }
        Ok(map)
    }

    fn lookup_type(&self, type_name: &str) -> ReflectResult<&TypeIr> {
        self.ir_index
            .get(type_name)
            .and_then(|idx| self.layout_ir.types.get(*idx))
            .ok_or_else(|| ReflectError::UnknownType {
                type_name: type_name.to_string(),
            })
    }
}

struct EvalContext<'a> {
    type_name: &'a str,
    params: &'a ParamMap,
}

fn checked_add(left: u128, right: u128, type_name: &str) -> ReflectResult<u128> {
    left.checked_add(right)
        .ok_or_else(|| ReflectError::ArithmeticOverflow {
            type_name: type_name.to_string(),
            op: "addition",
        })
}

fn checked_mul(left: u128, right: u128, type_name: &str) -> ReflectResult<u128> {
    left.checked_mul(right)
        .ok_or_else(|| ReflectError::ArithmeticOverflow {
            type_name: type_name.to_string(),
            op: "multiplication",
        })
}

fn align_up(value: u128, alignment: u64, type_name: &str) -> ReflectResult<u128> {
    if alignment <= 1 {
        return Ok(value);
    }
    let align = alignment as u128;
    let remainder = value % align;
    if remainder == 0 {
        return Ok(value);
    }
    let delta = align - remainder;
    checked_add(value, delta, type_name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use abi_gen::codegen::shared::ir::{
        BinaryOpNode, ConstNode, FieldRefNode, IrParameter, NodeMetadata,
    };

    fn layout_with_types(types: Vec<TypeIr>) -> (LayoutIr, BTreeMap<String, usize>) {
        let mut index = BTreeMap::new();
        for (idx, ty) in types.iter().enumerate() {
            index.insert(ty.type_name.clone(), idx);
        }
        (LayoutIr::new(types), index)
    }

    #[test]
    fn call_nested_reuses_parent_params() {
        let child = TypeIr {
            type_name: "Child".into(),
            alignment: 1,
            root: IrNode::AddChecked(BinaryOpNode {
                left: Box::new(IrNode::FieldRef(FieldRefNode {
                    path: "count".into(),
                    parameter: Some("count".into()),
                    meta: NodeMetadata::default(),
                })),
                right: Box::new(IrNode::FieldRef(FieldRefNode {
                    path: "items_len".into(),
                    parameter: Some("items_len".into()),
                    meta: NodeMetadata::default(),
                })),
                meta: NodeMetadata::default(),
            }),
            parameters: vec![
                IrParameter {
                    name: "count".into(),
                    description: None,
                    derived: false,
                },
                IrParameter {
                    name: "items_len".into(),
                    description: None,
                    derived: false,
                },
            ],
        };

        let parent = TypeIr {
            type_name: "Parent".into(),
            alignment: 1,
            root: IrNode::AddChecked(BinaryOpNode {
                left: Box::new(IrNode::Const(ConstNode {
                    value: 4,
                    meta: NodeMetadata::default(),
                })),
                right: Box::new(IrNode::CallNested(CallNestedNode {
                    type_name: "Child".into(),
                    arguments: vec![IrArgument {
                        name: "count".into(),
                        value: "count".into(),
                    }],
                    meta: NodeMetadata::default(),
                })),
                meta: NodeMetadata::default(),
            }),
            parameters: vec![
                IrParameter {
                    name: "count".into(),
                    description: None,
                    derived: false,
                },
                IrParameter {
                    name: "items_len".into(),
                    description: None,
                    derived: false,
                },
            ],
        };

        let (layout, index) = layout_with_types(vec![parent.clone(), child]);
        let interpreter = IrInterpreter::new(&layout, &index);
        let mut params = ParamMap::new();
        params.insert("count".into(), 2);
        params.insert("items_len".into(), 10);
        let result = interpreter
            .validate(&parent, 64, &params)
            .expect("validate");
        assert_eq!(result.bytes_consumed, 4 + 12);
    }
}
