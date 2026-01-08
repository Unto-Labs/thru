use super::ir_helpers::sanitize_param_name;
use crate::codegen::shared::ir::{
    AlignNode, BinaryOpNode, CallNestedNode, IrNode, SwitchNode, TypeIr,
};
use std::fmt::Write;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum IrFootprintError {
    #[error("unsupported IR node in Rust footprint emitter")]
    UnsupportedNode,
}

pub struct IrFootprintEmitter<'a> {
    type_ir: &'a TypeIr,
}

impl<'a> IrFootprintEmitter<'a> {
    pub fn new(type_ir: &'a TypeIr) -> Self {
        Self { type_ir }
    }

    pub fn emit(&self) -> Result<String, IrFootprintError> {
        let params = format_ir_parameter_list(self.type_ir);
        let body = self.node_to_expr(&self.type_ir.root)?;
        let fn_name = format!(
            "{}_footprint_ir",
            sanitize_param_name(&self.type_ir.type_name)
        );
        if params.is_empty() {
            Ok(format!(
                "pub fn {}() -> u64 {{\n    {}\n}}\n",
                fn_name, body
            ))
        } else {
            Ok(format!(
                "pub fn {}({}) -> u64 {{\n    {}\n}}\n",
                fn_name, params, body
            ))
        }
    }

    fn node_to_expr(&self, node: &IrNode) -> Result<String, IrFootprintError> {
        match node {
            IrNode::Const(c) => Ok(format!("{}u64", c.value)),
            IrNode::ZeroSize { .. } => Ok("0u64".to_string()),
            IrNode::FieldRef(field) => Ok(if let Some(param) = &field.parameter {
                sanitize_param_name(param)
            } else {
                sanitize_param_name(&field.path)
            }),
            IrNode::AddChecked(node) => self.combine_binary(node, "+"),
            IrNode::MulChecked(node) => self.combine_binary(node, "*"),
            IrNode::AlignUp(node) => self.align_expr(node),
            IrNode::CallNested(node) => self.call_nested_expr(node),
            IrNode::Switch(node) => self.switch_expr(node),
            IrNode::SumOverArray(node) => self.sum_over_array_expr(node),
        }
    }

    fn sum_over_array_expr(
        &self,
        _node: &crate::codegen::shared::ir::SumOverArrayNode,
    ) -> Result<String, IrFootprintError> {
        /* Jagged arrays require iteration over actual data for size calculation.
           IR helper functions are free functions without access to instance data,
           so we can't generate footprint IR for types containing jagged arrays. */
        Err(IrFootprintError::UnsupportedNode)
    }

    fn combine_binary(&self, node: &BinaryOpNode, op: &str) -> Result<String, IrFootprintError> {
        let left = self.node_to_expr(&node.left)?;
        let right = self.node_to_expr(&node.right)?;
        Ok(format!("({} {} {})", left, op, right))
    }

    fn align_expr(&self, node: &AlignNode) -> Result<String, IrFootprintError> {
        let inner = self.node_to_expr(&node.node)?;
        let align = node.alignment.max(1);
        if align <= 1 {
            return Ok(inner);
        }
        Ok(format!(
            "((({inner}) + {align}u64 - 1u64) & !({align}u64 - 1u64))",
            inner = inner,
            align = align
        ))
    }

    fn call_nested_expr(&self, node: &CallNestedNode) -> Result<String, IrFootprintError> {
        let mut args = String::new();
        for (idx, arg) in node.arguments.iter().enumerate() {
            if idx > 0 {
                args.push_str(", ");
            }
            write!(&mut args, "{}", sanitize_param_name(&arg.value)).unwrap();
        }
        let fn_name = format!("{}_footprint_ir", sanitize_param_name(&node.type_name));
        Ok(format!("{}({})", fn_name, args))
    }

    fn switch_expr(&self, node: &SwitchNode) -> Result<String, IrFootprintError> {
        let tag = sanitize_param_name(&node.tag);
        let mut out = String::new();
        writeln!(
            &mut out,
            "{{\n        let tn_tag = {};\n        match tn_tag {{",
            tag
        )
        .unwrap();
        for case in &node.cases {
            let expr = self.node_to_expr(&case.node)?;
            writeln!(&mut out, "            {} => {},", case.tag_value, expr).unwrap();
        }
        if let Some(default_node) = &node.default {
            let expr = self.node_to_expr(default_node)?;
            writeln!(&mut out, "            _ => {},", expr).unwrap();
        } else {
            writeln!(&mut out, "            _ => 0u64,").unwrap();
        }
        writeln!(&mut out, "        }}\n    }}").unwrap();
        Ok(out)
    }
}

pub fn emit_ir_footprint_fn(type_ir: &TypeIr) -> Result<String, IrFootprintError> {
    IrFootprintEmitter::new(type_ir).emit()
}

fn format_ir_parameter_list(type_ir: &TypeIr) -> String {
    type_ir
        .parameters
        .iter()
        .map(|param| format!("{}: u64", sanitize_param_name(&param.name)))
        .collect::<Vec<_>>()
        .join(", ")
}
