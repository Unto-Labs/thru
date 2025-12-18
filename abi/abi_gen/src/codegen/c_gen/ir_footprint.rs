use crate::codegen::shared::ir::{
    AlignNode, BinaryOpNode, CallNestedNode, IrNode, SwitchNode, TypeIr,
};
use std::fmt::Write;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum IrFootprintError {
    #[error("unsupported IR node in C footprint emitter")]
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
        let fn_name = sanitize_symbol(&format!("{}_footprint_ir", self.type_ir.type_name));
        Ok(format!(
            "uint64_t {}( {} ) {{\n    return {};\n}}\n",
            fn_name, params, body
        ))
    }

    fn node_to_expr(&self, node: &IrNode) -> Result<String, IrFootprintError> {
        match node {
            IrNode::Const(c) => Ok(format!("{}ULL", c.value)),
            IrNode::ZeroSize { .. } => Ok("0ULL".to_string()),
            IrNode::FieldRef(field) => Ok(if let Some(param) = &field.parameter {
                sanitize_symbol(param)
            } else {
                sanitize_symbol(&field.path)
            }),
            IrNode::AddChecked(node) => self.combine_binary(node, "+"),
            IrNode::MulChecked(node) => self.combine_binary(node, "*"),
            IrNode::AlignUp(node) => self.align_expr(node),
            IrNode::CallNested(node) => self.call_nested_expr(node),
            IrNode::Switch(node) => self.switch_expr(node),
        }
    }

    fn combine_binary(&self, node: &BinaryOpNode, op: &str) -> Result<String, IrFootprintError> {
        let left = self.node_to_expr(&node.left)?;
        let right = self.node_to_expr(&node.right)?;
        Ok(format!("({} {} {})", left, op, right))
    }

    fn align_expr(&self, node: &AlignNode) -> Result<String, IrFootprintError> {
        let inner = self.node_to_expr(&node.node)?;
        let align = node.alignment.max(1);
        Ok(format!(
            "((({inner}) + {align}ULL - 1ULL) & ~({align}ULL - 1ULL))",
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
            write!(&mut args, "{}", sanitize_symbol(&arg.value)).unwrap();
        }
        let fn_name = sanitize_symbol(&format!("{}_footprint_ir", node.type_name));
        Ok(format!("{}({})", fn_name, args))
    }

    fn switch_expr(&self, node: &SwitchNode) -> Result<String, IrFootprintError> {
        let tag = sanitize_symbol(&node.tag);
        let mut out = String::new();
        writeln!(
            &mut out,
            "({{ uint64_t tn_result = 0ULL; switch( {} ) {{",
            tag
        )
        .unwrap();
        for case in &node.cases {
            let expr = self.node_to_expr(&case.node)?;
            writeln!(
                &mut out,
                "    case {}:\n        tn_result = {};\n        break;",
                case.tag_value, expr
            )
            .unwrap();
        }
        if let Some(default_node) = &node.default {
            let expr = self.node_to_expr(default_node)?;
            writeln!(
                &mut out,
                "    default:\n        tn_result = {};\n        break;",
                expr
            )
            .unwrap();
        } else {
            writeln!(
                &mut out,
                "    default:\n        tn_result = 0ULL;\n        break;"
            )
            .unwrap();
        }
        writeln!(&mut out, "  }}\n  tn_result;\n}})").unwrap();
        Ok(out)
    }
}

pub fn emit_ir_footprint_fn(type_ir: &TypeIr) -> Result<String, IrFootprintError> {
    IrFootprintEmitter::new(type_ir).emit()
}

pub(crate) fn sanitize_symbol(input: &str) -> String {
    input
        .chars()
        .map(|c| match c {
            ':' | '.' | '-' => '_',
            other => other,
        })
        .collect()
}

pub fn format_ir_parameter_list(type_ir: &TypeIr) -> String {
    let mut params = String::new();
    for (idx, param) in type_ir.parameters.iter().enumerate() {
        if idx > 0 {
            params.push_str(", ");
        }
        write!(
            &mut params,
            "uint64_t {}",
            sanitize_symbol(&param.name.replace('.', "_"))
        )
        .unwrap();
    }
    if params.is_empty() {
        params.push_str("void");
    }
    params
}

pub fn resolve_param_binding<'a>(ir_param: &str, available: &'a [String]) -> Option<&'a String> {
    if let Some(idx) = available.iter().find(|cand| cand.as_str() == ir_param) {
        return Some(idx);
    }

    available.iter().find(|cand| {
        if ir_param.len() <= cand.len() {
            return false;
        }
        if !ir_param.ends_with(cand.as_str()) {
            return false;
        }
        let prefix_idx = ir_param.len() - cand.len() - 1;
        ir_param
            .as_bytes()
            .get(prefix_idx)
            .map(|c| *c == b'_')
            .unwrap_or(false)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codegen::shared::ir::{
        AlignNode, BinaryOpNode, ConstNode, FieldRefNode, IR_SCHEMA_VERSION, IrParameter, LayoutIr,
        NodeMetadata, SwitchCase, SwitchNode,
    };

    fn simple_type_ir(node: IrNode) -> TypeIr {
        TypeIr {
            type_name: "Sample".into(),
            alignment: 1,
            root: node,
            parameters: vec![IrParameter {
                name: "arr.len".into(),
                description: None,
                derived: false,
            }],
        }
    }

    #[test]
    fn emitter_handles_const_nodes() {
        let type_ir = simple_type_ir(IrNode::Const(ConstNode {
            value: 8,
            meta: NodeMetadata::default(),
        }));
        let emitter = IrFootprintEmitter::new(&type_ir);
        let output = emitter.emit().unwrap();
        assert!(output.contains("Sample_footprint_ir"));
        assert!(output.contains("8ULL"));
    }

    #[test]
    fn emitter_emits_switch_statements() {
        let node = IrNode::Switch(SwitchNode {
            tag: "Sample.tag".into(),
            cases: vec![
                SwitchCase {
                    tag_value: 0,
                    node: Box::new(IrNode::ZeroSize {
                        meta: NodeMetadata::default(),
                    }),
                    parameters: vec![],
                },
                SwitchCase {
                    tag_value: 1,
                    node: Box::new(IrNode::Const(ConstNode {
                        value: 4,
                        meta: NodeMetadata::default(),
                    })),
                    parameters: vec![],
                },
            ],
            default: None,
            meta: NodeMetadata::default(),
        });
        let type_ir = simple_type_ir(node);
        let emitter = IrFootprintEmitter::new(&type_ir);
        let output = emitter.emit().unwrap();
        assert!(output.contains("switch"));
        assert!(output.contains("case 1"));
    }

    #[test]
    fn layout_ir_round_trip() {
        let type_ir = simple_type_ir(IrNode::FieldRef(FieldRefNode {
            path: "arr.len".into(),
            parameter: Some("arr.len".into()),
            meta: NodeMetadata::default(),
        }));
        let layout = LayoutIr {
            version: IR_SCHEMA_VERSION,
            types: vec![type_ir],
        };
        assert_eq!(layout.version, IR_SCHEMA_VERSION);
    }

    #[test]
    fn emit_ir_wrapper_function() {
        let type_ir = simple_type_ir(IrNode::Const(ConstNode {
            value: 16,
            meta: NodeMetadata::default(),
        }));
        let output = emit_ir_footprint_fn(&type_ir).unwrap();
        assert!(output.contains("Sample_footprint_ir"));
        assert!(output.contains("return 16ULL"));
    }

    #[test]
    fn emitter_handles_zero_size_nodes() {
        let type_ir = TypeIr {
            type_name: "Empty".into(),
            alignment: 1,
            root: IrNode::ZeroSize {
                meta: NodeMetadata::default(),
            },
            parameters: vec![],
        };
        let emitter = IrFootprintEmitter::new(&type_ir);
        let output = emitter.emit().unwrap();
        assert!(output.contains("return 0ULL"));
    }

    #[test]
    fn emitter_formats_align_nodes() {
        let type_ir = TypeIr {
            type_name: "Aligned".into(),
            alignment: 8,
            root: IrNode::AlignUp(AlignNode {
                alignment: 8,
                node: Box::new(IrNode::Const(ConstNode {
                    value: 12,
                    meta: NodeMetadata::default(),
                })),
                meta: NodeMetadata::default(),
            }),
            parameters: vec![],
        };
        let emitter = IrFootprintEmitter::new(&type_ir);
        let output = emitter.emit().unwrap();
        assert!(output.contains("+ 8ULL - 1ULL) & ~(8ULL - 1ULL)"));
    }

    #[test]
    fn emitter_handles_nested_mulchecked_arrays() {
        fn field_ref(name: &str) -> IrNode {
            IrNode::FieldRef(FieldRefNode {
                path: name.into(),
                parameter: Some(name.into()),
                meta: NodeMetadata::default(),
            })
        }

        let element_bytes = IrNode::AlignUp(AlignNode {
            alignment: 4,
            node: Box::new(IrNode::Const(ConstNode {
                value: 4,
                meta: NodeMetadata::default(),
            })),
            meta: NodeMetadata::default(),
        });
        let inner_mul = IrNode::MulChecked(BinaryOpNode {
            left: Box::new(field_ref("matrix.element.cols")),
            right: Box::new(element_bytes),
            meta: NodeMetadata::default(),
        });
        let inner_align = IrNode::AlignUp(AlignNode {
            alignment: 4,
            node: Box::new(inner_mul),
            meta: NodeMetadata::default(),
        });
        let root = IrNode::MulChecked(BinaryOpNode {
            left: Box::new(field_ref("matrix.rows")),
            right: Box::new(inner_align),
            meta: NodeMetadata::default(),
        });

        let type_ir = TypeIr {
            type_name: "Matrix".into(),
            alignment: 4,
            root,
            parameters: vec![
                IrParameter {
                    name: "matrix.rows".into(),
                    description: None,
                    derived: false,
                },
                IrParameter {
                    name: "matrix.element.cols".into(),
                    description: None,
                    derived: false,
                },
            ],
        };

        let emitter = IrFootprintEmitter::new(&type_ir);
        let output = emitter.emit().unwrap();
        assert!(output.contains("uint64_t matrix_rows"));
        assert!(output.contains("uint64_t matrix_element_cols"));
        assert!(output.contains("matrix_rows *"));
        assert!(output.contains("matrix_element_cols"));
    }

    #[test]
    fn switch_expr_uses_default_branch_when_present() {
        let node = IrNode::Switch(SwitchNode {
            tag: "Choice.tag".into(),
            cases: vec![SwitchCase {
                tag_value: 1,
                node: Box::new(IrNode::Const(ConstNode {
                    value: 32,
                    meta: NodeMetadata::default(),
                })),
                parameters: vec![],
            }],
            default: Some(Box::new(IrNode::Const(ConstNode {
                value: 64,
                meta: NodeMetadata::default(),
            }))),
            meta: NodeMetadata::default(),
        });
        let type_ir = TypeIr {
            type_name: "Choice".into(),
            alignment: 1,
            root: node,
            parameters: vec![IrParameter {
                name: "Choice.tag".into(),
                description: None,
                derived: false,
            }],
        };
        let emitter = IrFootprintEmitter::new(&type_ir);
        let output = emitter.emit().unwrap();
        assert!(output.contains("default:\n        tn_result = 64ULL;"));
    }
}
