use super::ir_helpers::sanitize_param_name;
use crate::codegen::shared::ir::{
    AlignNode, BinaryOpNode, CallNestedNode, IrNode, SwitchNode, TypeIr,
};
use std::fmt::Write;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum IrValidateError {
    #[error("unsupported IR node in Rust validator emitter")]
    UnsupportedNode,
}

pub struct IrValidateEmitter<'a> {
    type_ir: &'a TypeIr,
    output: String,
    temp_idx: usize,
}

impl<'a> IrValidateEmitter<'a> {
    pub fn new(type_ir: &'a TypeIr) -> Self {
        Self {
            type_ir,
            output: String::new(),
            temp_idx: 0,
        }
    }

    pub fn emit(mut self) -> Result<String, IrValidateError> {
        let fn_name = format!(
            "{}_validate_ir",
            sanitize_param_name(&self.type_ir.type_name)
        );
        let params = format_ir_parameter_list(self.type_ir);
        let mut signature = format!("pub fn {}(buf_sz: u64", fn_name);
        if !params.is_empty() {
            signature.push_str(", ");
            signature.push_str(&params);
        }
        signature.push_str(") -> Result<u64, AbiIrValidateError>");

        writeln!(&mut self.output, "{} {{", signature).unwrap();
        let result_var = self.emit_node(&self.type_ir.root, 1)?;
        writeln!(&mut self.output, "    if {} > buf_sz {{", result_var).unwrap();
        writeln!(
            &mut self.output,
            "        return Err(AbiIrValidateError::BufferTooSmall);"
        )
        .unwrap();
        writeln!(&mut self.output, "    }}").unwrap();
        writeln!(&mut self.output, "    Ok({})", result_var).unwrap();
        writeln!(&mut self.output, "}}\n").unwrap();
        Ok(self.output)
    }

    fn emit_node(&mut self, node: &IrNode, indent: usize) -> Result<String, IrValidateError> {
        match node {
            IrNode::Const(c) => {
                let var = self.new_var();
                writeln!(
                    &mut self.output,
                    "{}let {}: u64 = {};",
                    Self::indent(indent),
                    var,
                    c.value
                )
                .unwrap();
                Ok(var)
            }
            IrNode::ZeroSize { .. } => {
                let var = self.new_var();
                writeln!(
                    &mut self.output,
                    "{}let {}: u64 = 0;",
                    Self::indent(indent),
                    var
                )
                .unwrap();
                Ok(var)
            }
            IrNode::FieldRef(field) => Ok(if let Some(param) = &field.parameter {
                sanitize_param_name(param)
            } else {
                sanitize_param_name(&field.path)
            }),
            IrNode::AddChecked(node) => self.emit_binary(node, indent, "tn_checked_add_u64"),
            IrNode::MulChecked(node) => self.emit_binary(node, indent, "tn_checked_mul_u64"),
            IrNode::AlignUp(node) => self.emit_align(node, indent),
            IrNode::CallNested(node) => self.emit_call_nested(node, indent),
            IrNode::Switch(node) => self.emit_switch(node, indent),
            IrNode::SumOverArray(node) => self.emit_sum_over_array(node, indent),
        }
    }

    fn emit_sum_over_array(
        &mut self,
        _node: &crate::codegen::shared::ir::SumOverArrayNode,
        _indent: usize,
    ) -> Result<String, IrValidateError> {
        /* Jagged arrays require iteration over actual data for validation.
           IR helper functions are free functions without access to instance data,
           so we can't generate validation IR for types containing jagged arrays. */
        Err(IrValidateError::UnsupportedNode)
    }

    fn emit_binary(
        &mut self,
        node: &BinaryOpNode,
        indent: usize,
        helper: &str,
    ) -> Result<String, IrValidateError> {
        let left = self.emit_node(&node.left, indent)?;
        let right = self.emit_node(&node.right, indent)?;
        let var = self.new_var();
        writeln!(
            &mut self.output,
            "{}let {} = {}({}, {})?;",
            Self::indent(indent),
            var,
            helper,
            left,
            right
        )
        .unwrap();
        Ok(var)
    }

    fn emit_align(
        &mut self,
        node: &crate::codegen::shared::ir::AlignNode,
        indent: usize,
    ) -> Result<String, IrValidateError> {
        let align = node.alignment.max(1);
        let inner = self.emit_node(&node.node, indent)?;
        if align <= 1 {
            return Ok(inner);
        }
        let aligned = self.new_var();
        writeln!(
            &mut self.output,
            "{}let mut {} = {};",
            Self::indent(indent),
            aligned,
            inner
        )
        .unwrap();
        writeln!(
            &mut self.output,
            "{}let rem = {} % {};",
            Self::indent(indent),
            aligned,
            align
        )
        .unwrap();
        writeln!(&mut self.output, "{}if rem != 0 {{", Self::indent(indent)).unwrap();
        writeln!(
            &mut self.output,
            "{}    {} = tn_checked_add_u64({}, {} - rem)?;",
            Self::indent(indent),
            aligned,
            aligned,
            align
        )
        .unwrap();
        writeln!(&mut self.output, "{}}}", Self::indent(indent)).unwrap();
        Ok(aligned)
    }

    fn emit_call_nested(
        &mut self,
        node: &CallNestedNode,
        indent: usize,
    ) -> Result<String, IrValidateError> {
        let fn_name = format!("{}_footprint_ir", sanitize_param_name(&node.type_name));
        let mut args = String::new();
        for (idx, arg) in node.arguments.iter().enumerate() {
            if idx > 0 {
                args.push_str(", ");
            }
            args.push_str(&sanitize_param_name(&arg.value));
        }
        let call = if args.is_empty() {
            format!("{}()", fn_name)
        } else {
            format!("{}({})", fn_name, args)
        };
        let var = self.new_var();
        writeln!(
            &mut self.output,
            "{}let {} = {};",
            Self::indent(indent),
            var,
            call
        )
        .unwrap();
        Ok(var)
    }

    fn emit_switch(&mut self, node: &SwitchNode, indent: usize) -> Result<String, IrValidateError> {
        let tag = sanitize_param_name(&node.tag);
        let result = self.new_var();
        writeln!(
            &mut self.output,
            "{}let {} = match {} {{",
            Self::indent(indent),
            result,
            tag
        )
        .unwrap();
        for case in &node.cases {
            writeln!(
                &mut self.output,
                "{}{} => {{",
                Self::indent(indent + 1),
                case.tag_value
            )
            .unwrap();
            let case_expr = self.emit_node(&case.node, indent + 2)?;
            writeln!(
                &mut self.output,
                "{}{}",
                Self::indent(indent + 2),
                case_expr
            )
            .unwrap();
            writeln!(&mut self.output, "{}}},", Self::indent(indent + 1)).unwrap();
        }
        if let Some(default_node) = &node.default {
            writeln!(&mut self.output, "{}_ => {{", Self::indent(indent + 1)).unwrap();
            let expr = self.emit_node(default_node, indent + 2)?;
            writeln!(&mut self.output, "{}{}", Self::indent(indent + 2), expr).unwrap();
            writeln!(&mut self.output, "{}}},", Self::indent(indent + 1)).unwrap();
        } else {
            writeln!(
                &mut self.output,
                "{}_ => return Err(AbiIrValidateError::InvalidVariant),",
                Self::indent(indent + 1)
            )
            .unwrap();
        }
        writeln!(&mut self.output, "{}}};", Self::indent(indent)).unwrap();
        Ok(result)
    }

    fn new_var(&mut self) -> String {
        let name = format!("tn_val_{}", self.temp_idx);
        self.temp_idx += 1;
        name
    }

    fn indent(level: usize) -> String {
        "    ".repeat(level)
    }
}

pub fn emit_ir_validate_fn(type_ir: &TypeIr) -> Result<String, IrValidateError> {
    IrValidateEmitter::new(type_ir).emit()
}

fn format_ir_parameter_list(type_ir: &TypeIr) -> String {
    type_ir
        .parameters
        .iter()
        .map(|param| format!("{}: u64", sanitize_param_name(&param.name)))
        .collect::<Vec<_>>()
        .join(", ")
}
