use super::ir::{
    AlignNode, BinaryOpNode, CallNestedNode, ConstNode, Endianness, FieldRefNode, IrArgument,
    IrNode, IrParameter, LayoutIr, NodeMetadata, SwitchCase, SwitchNode, TypeIr,
};
use super::ir_proto;
use prost::Message;
use thiserror::Error;

/// Serialize the layout IR into pretty JSON.
pub fn layout_ir_to_json(layout_ir: &LayoutIr) -> serde_json::Result<String> {
    serde_json::to_string_pretty(layout_ir)
}

/// Serialize the layout IR into a protobuf byte vector.
pub fn layout_ir_to_protobuf(layout_ir: &LayoutIr) -> Result<Vec<u8>, IrSerializationError> {
    let proto: ir_proto::LayoutIr = layout_ir.into();
    let mut buf = Vec::with_capacity(proto.encoded_len());
    proto.encode(&mut buf).map_err(IrSerializationError::from)?;
    Ok(buf)
}

#[derive(Debug, Error)]
pub enum IrSerializationError {
    #[error("failed to encode protobuf: {0}")]
    ProtobufEncode(#[from] prost::EncodeError),
}

impl From<&LayoutIr> for ir_proto::LayoutIr {
    fn from(value: &LayoutIr) -> Self {
        Self {
            version: value.version,
            types: value.types.iter().map(ir_proto::TypeIr::from).collect(),
        }
    }
}

impl From<&TypeIr> for ir_proto::TypeIr {
    fn from(value: &TypeIr) -> Self {
        Self {
            type_name: value.type_name.clone(),
            alignment: value.alignment,
            root: Some(ir_proto::IrNode::from(&value.root)),
            parameters: value
                .parameters
                .iter()
                .map(ir_proto::IrParameter::from)
                .collect(),
        }
    }
}

impl From<&IrParameter> for ir_proto::IrParameter {
    fn from(value: &IrParameter) -> Self {
        Self {
            name: value.name.clone(),
            description: value.description.clone(),
            derived: value.derived,
        }
    }
}

impl From<&NodeMetadata> for ir_proto::NodeMetadata {
    fn from(value: &NodeMetadata) -> Self {
        Self {
            size_expr: value.size_expr.clone(),
            alignment: value.alignment,
            endianness: match value.endianness {
                Endianness::Little => ir_proto::Endianness::Little as i32,
                Endianness::Big => ir_proto::Endianness::Big as i32,
            },
        }
    }
}

impl From<&IrNode> for ir_proto::IrNode {
    fn from(value: &IrNode) -> Self {
        use ir_proto::ir_node::Kind;
        let kind = match value {
            IrNode::ZeroSize { meta } => Kind::ZeroSize(ir_proto::ZeroSizeNode {
                meta: Some(meta.into()),
            }),
            IrNode::Const(node) => Kind::Const(ir_proto::ConstNode {
                value: node.value,
                meta: Some((&node.meta).into()),
            }),
            IrNode::FieldRef(node) => Kind::FieldRef(ir_proto::FieldRefNode {
                path: node.path.clone(),
                parameter: node.parameter.clone(),
                meta: Some((&node.meta).into()),
            }),
            IrNode::AlignUp(node) => Kind::AlignUp(convert_align(node)),
            IrNode::Switch(node) => Kind::Switch(convert_switch(node)),
            IrNode::CallNested(node) => Kind::CallNested(ir_proto::CallNestedNode {
                type_name: node.type_name.clone(),
                arguments: node
                    .arguments
                    .iter()
                    .map(ir_proto::IrArgument::from)
                    .collect(),
                meta: Some((&node.meta).into()),
            }),
            IrNode::AddChecked(node) => {
                Kind::BinaryOp(convert_binary_op(node, ir_proto::BinaryOpKind::AddChecked))
            }
            IrNode::MulChecked(node) => {
                Kind::BinaryOp(convert_binary_op(node, ir_proto::BinaryOpKind::MulChecked))
            }
        };

        ir_proto::IrNode { kind: Some(kind) }
    }
}

fn convert_align(node: &AlignNode) -> ir_proto::AlignNode {
    ir_proto::AlignNode {
        alignment: node.alignment,
        node: Some(Box::new(ir_proto::IrNode::from(node.node.as_ref()))),
        meta: Some((&node.meta).into()),
    }
}

fn convert_switch(node: &SwitchNode) -> ir_proto::SwitchNode {
    ir_proto::SwitchNode {
        tag: node.tag.clone(),
        cases: node.cases.iter().map(ir_proto::SwitchCase::from).collect(),
        default: node
            .default
            .as_ref()
            .map(|d| Box::new(ir_proto::IrNode::from(d.as_ref()))),
        meta: Some((&node.meta).into()),
    }
}

fn convert_binary_op(node: &BinaryOpNode, kind: ir_proto::BinaryOpKind) -> ir_proto::BinaryOpNode {
    ir_proto::BinaryOpNode {
        op: kind as i32,
        left: Some(Box::new(ir_proto::IrNode::from(node.left.as_ref()))),
        right: Some(Box::new(ir_proto::IrNode::from(node.right.as_ref()))),
        meta: Some((&node.meta).into()),
    }
}

impl From<&SwitchCase> for ir_proto::SwitchCase {
    fn from(value: &SwitchCase) -> Self {
        Self {
            tag_value: value.tag_value,
            node: Some(Box::new(ir_proto::IrNode::from(value.node.as_ref()))),
            parameters: value
                .parameters
                .iter()
                .map(ir_proto::IrParameter::from)
                .collect(),
        }
    }
}

impl From<&IrArgument> for ir_proto::IrArgument {
    fn from(value: &IrArgument) -> Self {
        Self {
            name: value.name.clone(),
            value: value.value.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::codegen::shared::ir::{IR_SCHEMA_VERSION, LayoutIr, TypeIr};

    #[test]
    fn protobuf_roundtrip_matches_proto_struct() {
        let layout = LayoutIr::new(vec![TypeIr {
            type_name: "Example".into(),
            alignment: 8,
            root: IrNode::FieldRef(FieldRefNode {
                path: "payload.len".into(),
                parameter: Some("payload.len".into()),
                meta: NodeMetadata::aligned(8),
            }),
            parameters: vec![IrParameter {
                name: "payload.len".into(),
                description: Some("payload length".into()),
                derived: false,
            }],
        }]);

        let proto_expected: ir_proto::LayoutIr = (&layout).into();
        assert_eq!(proto_expected.version, IR_SCHEMA_VERSION);

        let bytes = layout_ir_to_protobuf(&layout).expect("encode");
        let decoded = ir_proto::LayoutIr::decode(bytes.as_slice()).expect("decode");

        assert_eq!(decoded.version, proto_expected.version);
        assert_eq!(decoded.types.len(), proto_expected.types.len());
        assert_eq!(decoded.types[0].type_name, "Example");
    }
}
