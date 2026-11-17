use super::ir_helpers::sanitize_param_name;
use super::names::{IrNameFn, IrNames, plain_ir_names};
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
    names: Option<IrNameFn<'a>>,
}

impl<'a> IrFootprintEmitter<'a> {
    pub fn new(type_ir: &'a TypeIr) -> Self {
        Self {
            type_ir,
            names: None,
        }
    }

    /* Take helper names (this type's and its callees') from `names`. */
    pub fn with_names(mut self, names: IrNameFn<'a>) -> Self {
        self.names = Some(names);
        self
    }

    fn fn_names(&self, type_name: &str) -> IrNames {
        match self.names {
            Some(f) => f(type_name),
            None => plain_ir_names(type_name),
        }
    }

    pub fn emit(&self) -> Result<String, IrFootprintError> {
        let mut params = format_ir_parameter_list(self.type_ir);
        let mut args = format_ir_argument_list(self.type_ir);
        if contains_buffer_size_ref(&self.type_ir.root) {
            params = if params.is_empty() {
                "buf_sz: u64".to_string()
            } else {
                format!("buf_sz: u64, {}", params)
            };
            args = if args.is_empty() {
                "buf_sz".to_string()
            } else {
                format!("buf_sz, {}", args)
            };
        }
        let body = self.node_to_expr(&self.type_ir.root)?;
        let names = self.fn_names(&self.type_ir.type_name);
        Ok(format!(
            "/// IR footprint of `{ty}` with checked arithmetic.
#[allow(unused_variables, clippy::all)]
pub fn {checked}({params}) -> ::core::result::Result<u64, AbiError> {{
    Ok({body})
}}
/// IR footprint of `{ty}`; `u64::MAX` when the parameters overflow or select no variant.
#[allow(clippy::all)]
pub fn {plain}({params}) -> u64 {{
    match {checked}({args}) {{
        Ok(size) => size,
        Err(_) => u64::MAX,
    }}
}}
",
            ty = self.type_ir.type_name,
            checked = names.footprint_checked,
            plain = names.footprint,
            params = params,
            args = args,
            body = body
        ))
    }

    fn node_to_expr(&self, node: &IrNode) -> Result<String, IrFootprintError> {
        match node {
            IrNode::Const(c) => Ok(format!("{}u64", c.value)),
            IrNode::ZeroSize { .. } => Ok("0u64".to_string()),
            IrNode::FieldRef(field) => Ok(
                if field.parameter.is_none() && field.path == "__buffer_size" {
                    "buf_sz".to_string()
                } else if let Some(param) = &field.parameter {
                    sanitize_param_name(param)
                } else {
                    sanitize_param_name(&field.path)
                },
            ),
            IrNode::AddChecked(node) => self.call_binary(node, "tn_e_add", true),
            IrNode::SubChecked(node) => self.call_binary(node, "tn_e_sub", true),
            IrNode::MulChecked(node) => self.call_binary(node, "tn_e_mul", true),
            IrNode::DivChecked(node) => self.call_binary(node, "tn_e_div", true),
            IrNode::ModChecked(node) => self.call_binary(node, "tn_e_mod", true),
            IrNode::BitAnd(node) => self.combine_binary(node, "&"),
            IrNode::BitOr(node) => self.combine_binary(node, "|"),
            IrNode::BitXor(node) => self.combine_binary(node, "^"),
            IrNode::LeftShift(node) => self.call_binary(node, "tn_e_shl", true),
            IrNode::RightShift(node) => self.call_binary(node, "tn_e_shr", false),
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

    fn call_binary(
        &self,
        node: &BinaryOpNode,
        func: &str,
        fallible: bool,
    ) -> Result<String, IrFootprintError> {
        let left = self.node_to_expr(&node.left)?;
        let right = self.node_to_expr(&node.right)?;
        Ok(format!(
            "{}({}, {}){}",
            func,
            left,
            right,
            if fallible { "?" } else { "" }
        ))
    }

    fn align_expr(&self, node: &AlignNode) -> Result<String, IrFootprintError> {
        let inner = self.node_to_expr(&node.node)?;
        let align = node.alignment.max(1);
        if align <= 1 {
            return Ok(inner);
        }
        Ok(format!("tn_align_u64({}, {})?", inner, align))
    }

    fn call_nested_expr(&self, node: &CallNestedNode) -> Result<String, IrFootprintError> {
        let mut args = String::new();
        for (idx, arg) in node.arguments.iter().enumerate() {
            if idx > 0 {
                args.push_str(", ");
            }
            write!(&mut args, "{}", sanitize_param_name(&arg.value)).unwrap();
        }
        let fn_name = self.fn_names(&node.type_name).footprint_checked;
        Ok(format!("{}({})?", fn_name, args))
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
            writeln!(
                &mut out,
                "            _ => return Err(AbiError::MissingSwitchCase),"
            )
            .unwrap();
        }
        writeln!(&mut out, "        }}\n    }}").unwrap();
        Ok(out)
    }
}

fn contains_buffer_size_ref(node: &IrNode) -> bool {
    match node {
        IrNode::FieldRef(field) => field.parameter.is_none() && field.path == "__buffer_size",
        IrNode::AlignUp(node) => contains_buffer_size_ref(&node.node),
        IrNode::Switch(node) => {
            node.cases
                .iter()
                .any(|case| contains_buffer_size_ref(&case.node))
                || node
                    .default
                    .as_ref()
                    .map(|default| contains_buffer_size_ref(default))
                    .unwrap_or(false)
        }
        IrNode::AddChecked(node)
        | IrNode::SubChecked(node)
        | IrNode::MulChecked(node)
        | IrNode::DivChecked(node)
        | IrNode::ModChecked(node)
        | IrNode::BitAnd(node)
        | IrNode::BitOr(node)
        | IrNode::BitXor(node)
        | IrNode::LeftShift(node)
        | IrNode::RightShift(node) => {
            contains_buffer_size_ref(&node.left) || contains_buffer_size_ref(&node.right)
        }
        IrNode::SumOverArray(node) => contains_buffer_size_ref(&node.count),
        IrNode::ZeroSize { .. } | IrNode::Const(_) | IrNode::CallNested(_) => false,
    }
}

pub fn emit_ir_footprint_fn(type_ir: &TypeIr) -> Result<String, IrFootprintError> {
    IrFootprintEmitter::new(type_ir).emit()
}

/* `emit_ir_footprint_fn` with helper names from a package's name table. */
pub fn emit_ir_footprint_fn_named(
    type_ir: &TypeIr,
    names: IrNameFn<'_>,
) -> Result<String, IrFootprintError> {
    IrFootprintEmitter::new(type_ir).with_names(names).emit()
}

fn format_ir_parameter_list(type_ir: &TypeIr) -> String {
    type_ir
        .parameters
        .iter()
        .map(|param| format!("{}: u64", sanitize_param_name(&param.name)))
        .collect::<Vec<_>>()
        .join(", ")
}

fn format_ir_argument_list(type_ir: &TypeIr) -> String {
    type_ir
        .parameters
        .iter()
        .map(|param| sanitize_param_name(&param.name))
        .collect::<Vec<_>>()
        .join(", ")
}
