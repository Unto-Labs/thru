use prost::{Message, Oneof};

#[derive(Clone, PartialEq, Message)]
pub struct LayoutIr {
    #[prost(uint32, tag = "1")]
    pub version: u32,
    #[prost(message, repeated, tag = "2")]
    pub types: Vec<TypeIr>,
}

#[derive(Clone, PartialEq, Message)]
pub struct TypeIr {
    #[prost(string, tag = "1")]
    pub type_name: String,
    #[prost(uint64, tag = "2")]
    pub alignment: u64,
    #[prost(message, optional, tag = "3")]
    pub root: Option<IrNode>,
    #[prost(message, repeated, tag = "4")]
    pub parameters: Vec<IrParameter>,
}

#[derive(Clone, PartialEq, Message)]
pub struct IrParameter {
    #[prost(string, tag = "1")]
    pub name: String,
    #[prost(string, optional, tag = "2")]
    pub description: Option<String>,
    #[prost(bool, tag = "3")]
    pub derived: bool,
}

#[derive(Clone, PartialEq, Message)]
pub struct NodeMetadata {
    #[prost(string, optional, tag = "1")]
    pub size_expr: Option<String>,
    #[prost(uint64, tag = "2")]
    pub alignment: u64,
    #[prost(enumeration = "Endianness", tag = "3")]
    pub endianness: i32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, ::prost::Enumeration)]
#[repr(i32)]
pub enum Endianness {
    Little = 0,
    Big = 1,
}

#[derive(Clone, PartialEq, Message)]
pub struct IrNode {
    #[prost(oneof = "ir_node::Kind", tags = "1, 2, 3, 4, 5, 6, 7")]
    pub kind: Option<ir_node::Kind>,
}

pub mod ir_node {
    use super::*;

    #[derive(Clone, PartialEq, Oneof)]
    pub enum Kind {
        #[prost(message, tag = "1")]
        ZeroSize(super::ZeroSizeNode),
        #[prost(message, tag = "2")]
        Const(super::ConstNode),
        #[prost(message, tag = "3")]
        FieldRef(super::FieldRefNode),
        #[prost(message, boxed, tag = "4")]
        AlignUp(super::AlignNode),
        #[prost(message, tag = "5")]
        Switch(super::SwitchNode),
        #[prost(message, tag = "6")]
        CallNested(super::CallNestedNode),
        #[prost(message, boxed, tag = "7")]
        BinaryOp(super::BinaryOpNode),
    }
}

#[derive(Clone, PartialEq, Message)]
pub struct ZeroSizeNode {
    #[prost(message, optional, tag = "1")]
    pub meta: Option<NodeMetadata>,
}

#[derive(Clone, PartialEq, Message)]
pub struct ConstNode {
    #[prost(uint64, tag = "1")]
    pub value: u64,
    #[prost(message, optional, tag = "2")]
    pub meta: Option<NodeMetadata>,
}

#[derive(Clone, PartialEq, Message)]
pub struct FieldRefNode {
    #[prost(string, tag = "1")]
    pub path: String,
    #[prost(string, optional, tag = "2")]
    pub parameter: Option<String>,
    #[prost(message, optional, tag = "3")]
    pub meta: Option<NodeMetadata>,
}

#[derive(Clone, PartialEq, Message)]
pub struct AlignNode {
    #[prost(uint64, tag = "1")]
    pub alignment: u64,
    #[prost(message, optional, tag = "2")]
    pub node: Option<Box<IrNode>>,
    #[prost(message, optional, tag = "3")]
    pub meta: Option<NodeMetadata>,
}

#[derive(Clone, PartialEq, Message)]
pub struct SwitchNode {
    #[prost(string, tag = "1")]
    pub tag: String,
    #[prost(message, repeated, tag = "2")]
    pub cases: Vec<SwitchCase>,
    #[prost(message, optional, tag = "3")]
    pub default: Option<Box<IrNode>>,
    #[prost(message, optional, tag = "4")]
    pub meta: Option<NodeMetadata>,
}

#[derive(Clone, PartialEq, Message)]
pub struct SwitchCase {
    #[prost(uint64, tag = "1")]
    pub tag_value: u64,
    #[prost(message, optional, tag = "2")]
    pub node: Option<Box<IrNode>>,
    #[prost(message, repeated, tag = "3")]
    pub parameters: Vec<IrParameter>,
}

#[derive(Clone, PartialEq, Message)]
pub struct CallNestedNode {
    #[prost(string, tag = "1")]
    pub type_name: String,
    #[prost(message, repeated, tag = "2")]
    pub arguments: Vec<IrArgument>,
    #[prost(message, optional, tag = "3")]
    pub meta: Option<NodeMetadata>,
}

#[derive(Clone, PartialEq, Message)]
pub struct IrArgument {
    #[prost(string, tag = "1")]
    pub name: String,
    #[prost(string, tag = "2")]
    pub value: String,
}

#[derive(Clone, PartialEq, Message)]
pub struct BinaryOpNode {
    #[prost(enumeration = "BinaryOpKind", tag = "1")]
    pub op: i32,
    #[prost(message, optional, tag = "2")]
    pub left: Option<Box<IrNode>>,
    #[prost(message, optional, tag = "3")]
    pub right: Option<Box<IrNode>>,
    #[prost(message, optional, tag = "4")]
    pub meta: Option<NodeMetadata>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, ::prost::Enumeration)]
#[repr(i32)]
pub enum BinaryOpKind {
    AddChecked = 0,
    MulChecked = 1,
}
