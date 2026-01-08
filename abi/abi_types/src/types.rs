use crate::expr::ExprKind;
use serde_derive::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub enum IntegralType {
    U8,
    U16,
    U32,
    U64,
    I8,
    I16,
    I32,
    I64,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub enum FloatingPointType {
    F16,
    F32,
    F64,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
#[serde(untagged)]
#[serde(expecting = "expected integral or floating point type")]
pub enum PrimitiveType {
    Integral(IntegralType),
    FloatingPoint(FloatingPointType),
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct ContainerAttributes {
    #[serde(default)]
    pub packed: bool,
    #[serde(default)]
    pub aligned: u64,
    #[serde(default)]
    pub comment: Option<String>,
}

impl Default for ContainerAttributes {
    fn default() -> Self {
        Self {
            packed: false,
            aligned: 0,
            comment: None,
        }
    }
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct EnumVariant {
    pub name: String,
    pub tag_value: u64,
    pub variant_type: TypeKind,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct EnumType {
    #[serde(flatten)]
    pub container_attributes: ContainerAttributes,
    pub tag_ref: ExprKind,
    pub variants: Vec<EnumVariant>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct ArrayType {
    #[serde(flatten)]
    pub container_attributes: ContainerAttributes,
    pub size: ExprKind,
    pub element_type: Box<TypeKind>,
    /// When true, allows variable-size elements (jagged array). Each element must be
    /// self-describing (have a footprint function). Element access becomes O(n).
    #[serde(default)]
    pub jagged: bool,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct TypeRefType {
    pub name: String,
    pub comment: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct UnionVariant {
    pub name: String,
    pub variant_type: TypeKind,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct UnionType {
    #[serde(flatten)]
    pub container_attributes: ContainerAttributes,
    pub variants: Vec<UnionVariant>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct SizeDiscriminatedVariant {
    pub name: String,
    pub expected_size: u64,
    pub variant_type: TypeKind,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct SizeDiscriminatedUnionType {
    #[serde(flatten)]
    pub container_attributes: ContainerAttributes,
    pub variants: Vec<SizeDiscriminatedVariant>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct StructField {
    pub name: String,
    pub field_type: TypeKind,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct StructType {
    #[serde(flatten)]
    pub container_attributes: ContainerAttributes,
    pub fields: Vec<StructField>,
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub enum TypeKind {
    Struct(StructType),
    Union(UnionType),
    Enum(EnumType),
    Array(ArrayType),
    SizeDiscriminatedUnion(SizeDiscriminatedUnionType),
    Primitive(PrimitiveType),
    TypeRef(TypeRefType),
}

#[derive(Serialize, Deserialize, Debug, PartialEq, Eq, Clone)]
#[serde(rename_all = "kebab-case")]
pub struct TypeDef {
    pub name: String,
    #[serde(with = "serde_yml::with::singleton_map_recursive")]
    pub kind: TypeKind,
}
