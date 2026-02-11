use super::ir_footprint::{format_ir_parameter_list, sanitize_symbol};
use crate::codegen::shared::ir::{BinaryOpNode, CallNestedNode, IrNode, SwitchNode, TypeIr};
use std::fmt::Write;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum IrValidateError {
    #[error("unsupported IR node in C validator emitter")]
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
        let fn_name = sanitize_symbol(&format!("{}_validate_ir", self.type_ir.type_name));
        let mut params = format_ir_parameter_list(self.type_ir);
        let signature = if params == "void" {
            format!(
                "int {}( uint64_t buf_sz, uint64_t * out_bytes_consumed )",
                fn_name
            )
        } else {
            params.insert_str(0, ", ");
            format!(
                "int {}( uint64_t buf_sz, uint64_t * out_bytes_consumed{} )",
                fn_name, params
            )
        };

        writeln!(&mut self.output, "{} {{", signature).unwrap();
        let result_var = self.emit_node(&self.type_ir.root, 1)?;
        writeln!(
            &mut self.output,
            "  if( {} > buf_sz ) return 1;",
            result_var
        )
        .unwrap();
        writeln!(
            &mut self.output,
            "  if( out_bytes_consumed ) *out_bytes_consumed = {};\n  return 0;\n}}\n",
            result_var
        )
        .unwrap();
        Ok(self.output)
    }

    fn emit_node(&mut self, node: &IrNode, indent_lv: usize) -> Result<String, IrValidateError> {
        match node {
            IrNode::Const(c) => {
                let var = self.new_var();
                writeln!(
                    &mut self.output,
                    "{}uint64_t {} = {}ULL;",
                    Self::indent(indent_lv),
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
                    "{}uint64_t {} = 0ULL;",
                    Self::indent(indent_lv),
                    var
                )
                .unwrap();
                Ok(var)
            }
            IrNode::FieldRef(field) => Ok(self.resolve_field_param(field)),
            IrNode::AddChecked(add) => self.emit_binary(add, indent_lv, "tn_checked_add_u64", "3"),
            IrNode::MulChecked(mul) => self.emit_binary(mul, indent_lv, "tn_checked_mul_u64", "3"),
            IrNode::AlignUp(node) => self.emit_align(node, indent_lv),
            IrNode::CallNested(node) => self.emit_call_nested(node, indent_lv),
            IrNode::Switch(node) => self.emit_switch(node, indent_lv),
            IrNode::SumOverArray(node) => self.emit_sum_over_array(node, indent_lv),
        }
    }

    fn emit_sum_over_array(
        &mut self,
        _node: &crate::codegen::shared::ir::SumOverArrayNode,
        _indent_lv: usize,
    ) -> Result<String, IrValidateError> {
        /* Jagged arrays require instance data for validation.
           C IR helpers are free functions without a self pointer. */
        Err(IrValidateError::UnsupportedNode)
    }

    fn emit_binary(
        &mut self,
        node: &BinaryOpNode,
        indent_lv: usize,
        helper: &str,
        err_code: &str,
    ) -> Result<String, IrValidateError> {
        let left = self.emit_node(&node.left, indent_lv)?;
        let right = self.emit_node(&node.right, indent_lv)?;
        let var = self.new_var();
        writeln!(
            &mut self.output,
            "{}uint64_t {} = 0ULL;",
            Self::indent(indent_lv),
            var
        )
        .unwrap();
        writeln!(
            &mut self.output,
            "{}if( {}( {}, {}, &{} ) ) return {};",
            Self::indent(indent_lv),
            helper,
            left,
            right,
            var,
            err_code
        )
        .unwrap();
        Ok(var)
    }

    fn emit_align(
        &mut self,
        node: &crate::codegen::shared::ir::AlignNode,
        indent_lv: usize,
    ) -> Result<String, IrValidateError> {
        let align = node.alignment.max(1);
        let inner = self.emit_node(&node.node, indent_lv)?;
        if align <= 1 {
            return Ok(inner);
        }

        let aligned_var = self.new_var();
        writeln!(
            &mut self.output,
            "{}uint64_t {} = {};",
            Self::indent(indent_lv),
            aligned_var,
            inner
        )
        .unwrap();
        let rem_var = self.new_var();
        writeln!(
            &mut self.output,
            "{}uint64_t {} = {} % {}ULL;",
            Self::indent(indent_lv),
            rem_var,
            aligned_var,
            align
        )
        .unwrap();
        writeln!(
            &mut self.output,
            "{}if( {} ) {{",
            Self::indent(indent_lv),
            rem_var
        )
        .unwrap();
        let delta_var = self.new_var();
        writeln!(
            &mut self.output,
            "{}  uint64_t {} = {}ULL - {};",
            Self::indent(indent_lv),
            delta_var,
            align,
            rem_var
        )
        .unwrap();
        writeln!(
            &mut self.output,
            "{}  if( tn_checked_add_u64( {}, {}, &{} ) ) return 3;",
            Self::indent(indent_lv),
            aligned_var,
            delta_var,
            aligned_var
        )
        .unwrap();
        writeln!(&mut self.output, "{}}}", Self::indent(indent_lv)).unwrap();
        Ok(aligned_var)
    }

    fn emit_call_nested(
        &mut self,
        node: &CallNestedNode,
        indent_lv: usize,
    ) -> Result<String, IrValidateError> {
        let fn_name = sanitize_symbol(&format!("{}_footprint_ir", node.type_name));
        let mut args = String::new();
        for (idx, arg) in node.arguments.iter().enumerate() {
            if idx > 0 {
                args.push_str(", ");
            }
            args.push_str(&sanitize_symbol(&arg.value.replace('.', "_")));
        }
        let call = if args.is_empty() {
            format!("{}()", fn_name)
        } else {
            format!("{}( {} )", fn_name, args)
        };

        let var = self.new_var();
        writeln!(
            &mut self.output,
            "{}uint64_t {} = {};",
            Self::indent(indent_lv),
            var,
            call
        )
        .unwrap();
        Ok(var)
    }

    fn emit_switch(
        &mut self,
        node: &SwitchNode,
        indent_lv: usize,
    ) -> Result<String, IrValidateError> {
        let tag = sanitize_symbol(&node.tag.replace('.', "_"));
        let result_var = self.new_var();
        writeln!(
            &mut self.output,
            "{}uint64_t {} = 0ULL;",
            Self::indent(indent_lv),
            result_var
        )
        .unwrap();
        writeln!(
            &mut self.output,
            "{}switch( {} ) {{",
            Self::indent(indent_lv),
            tag
        )
        .unwrap();
        for case in &node.cases {
            writeln!(
                &mut self.output,
                "{}  case {}: {{",
                Self::indent(indent_lv),
                case.tag_value
            )
            .unwrap();
            let case_result = self.emit_node(&case.node, indent_lv + 2)?;
            writeln!(
                &mut self.output,
                "{}    {} = {};",
                Self::indent(indent_lv),
                result_var,
                case_result
            )
            .unwrap();
            writeln!(&mut self.output, "{}    break;", Self::indent(indent_lv)).unwrap();
            writeln!(&mut self.output, "{}  }}", Self::indent(indent_lv)).unwrap();
        }
        if let Some(default_node) = &node.default {
            writeln!(&mut self.output, "{}  default: {{", Self::indent(indent_lv)).unwrap();
            let default_val = self.emit_node(default_node, indent_lv + 2)?;
            writeln!(
                &mut self.output,
                "{}    {} = {};",
                Self::indent(indent_lv),
                result_var,
                default_val
            )
            .unwrap();
            writeln!(&mut self.output, "{}    break;", Self::indent(indent_lv)).unwrap();
            writeln!(&mut self.output, "{}  }}", Self::indent(indent_lv)).unwrap();
        } else {
            writeln!(
                &mut self.output,
                "{}  default: return 2;",
                Self::indent(indent_lv)
            )
            .unwrap();
        }
        writeln!(&mut self.output, "{}}}", Self::indent(indent_lv)).unwrap();
        Ok(result_var)
    }

    fn resolve_field_param(&self, field: &crate::codegen::shared::ir::FieldRefNode) -> String {
        if let Some(param) = &field.parameter {
            sanitize_symbol(&param.replace('.', "_"))
        } else {
            sanitize_symbol(&field.path.replace('.', "_"))
        }
    }

    fn new_var(&mut self) -> String {
        let name = format!("tn_val_{}", self.temp_idx);
        self.temp_idx += 1;
        name
    }

    fn indent(level: usize) -> String {
        "  ".repeat(level)
    }
}

pub fn emit_ir_validate_fn(type_ir: &TypeIr) -> Result<String, IrValidateError> {
    IrValidateEmitter::new(type_ir).emit()
}
