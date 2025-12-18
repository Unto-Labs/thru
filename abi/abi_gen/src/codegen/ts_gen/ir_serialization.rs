use crate::abi::resolved::ResolvedType;
use crate::codegen::shared::ir::*;
use crate::codegen::ts_gen::helpers::sanitize_type_ident;

pub fn emit_ir_constant(resolved_type: &ResolvedType, type_ir: &TypeIr) -> String {
    let const_name = ir_constant_name(resolved_type);
    let mut out = String::new();
    out.push_str(&format!(
        "const {} = {{\n  typeName: \"{}\",\n  root: {}\n}} as const;\n\n",
        const_name,
        resolved_type.name,
        emit_ir_node(&type_ir.root, 2)
    ));
    out
}

pub fn ir_constant_name(resolved_type: &ResolvedType) -> String {
    format!(
        "__tn_ir_{}",
        sanitize_type_ident(resolved_type.name.as_str())
    )
}

fn emit_ir_node(node: &IrNode, indent: usize) -> String {
    match node {
        IrNode::ZeroSize { .. } => format!("{{ op: \"zero\" }}"),
        IrNode::Const(c) => format!("{{ op: \"const\", value: {}n }}", c.value),
        IrNode::FieldRef(field) => {
            let param = field
                .parameter
                .as_deref()
                .unwrap_or_else(|| field.path.as_str());
            format!(
                "{{ op: \"field\", param: \"{}\" }}",
                param.replace('\"', "\\\"")
            )
        }
        IrNode::AddChecked(add) => format!(
            "{{ op: \"add\", left: {}, right: {} }}",
            emit_ir_node(&add.left, indent),
            emit_ir_node(&add.right, indent)
        ),
        IrNode::MulChecked(mul) => format!(
            "{{ op: \"mul\", left: {}, right: {} }}",
            emit_ir_node(&mul.left, indent),
            emit_ir_node(&mul.right, indent)
        ),
        IrNode::AlignUp(align) => format!(
            "{{ op: \"align\", alignment: {}, node: {} }}",
            align.alignment,
            emit_ir_node(&align.node, indent)
        ),
        IrNode::Switch(sw) => {
            let mut cases = String::new();
            cases.push('[');
            for (idx, case) in sw.cases.iter().enumerate() {
                if idx > 0 {
                    cases.push_str(", ");
                }
                cases.push_str(&format!(
                    "{{ value: {}, node: {} }}",
                    case.tag_value,
                    emit_ir_node(&case.node, indent + 2)
                ));
            }
            cases.push(']');
            let default = sw
                .default
                .as_ref()
                .map(|node| emit_ir_node(node, indent + 2))
                .map(|s| format!(", default: {}", s))
                .unwrap_or_default();
            format!(
                "{{ op: \"switch\", tag: \"{}\", cases: {}{} }}",
                sw.tag.replace('\"', "\\\""),
                cases,
                default
            )
        }
        IrNode::CallNested(call) => {
            let mut args = String::new();
            args.push('[');
            for (idx, arg) in call.arguments.iter().enumerate() {
                if idx > 0 {
                    args.push_str(", ");
                }
                args.push_str(&format!(
                    "{{ name: \"{}\", source: \"{}\" }}",
                    arg.name.replace('\"', "\\\""),
                    arg.value.replace('\"', "\\\"")
                ));
            }
            args.push(']');
            format!(
                "{{ op: \"call\", typeName: \"{}\", args: {} }}",
                call.type_name.replace('\"', "\\\""),
                args
            )
        }
    }
}
