/* Reflection types that represent ABI type information */

use abi_gen::abi::resolved::{ResolvedType, ResolvedTypeKind};
use abi_gen::abi::types::PrimitiveType;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/* Reflected type information - contains metadata about the type */
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReflectedType {
    /* Type name */
    pub name: String,

    /* Type kind */
    pub kind: ReflectedTypeKind,

    /* Size in bytes (None if variable size) */
    pub size: Option<u64>,

    /* Alignment in bytes */
    pub alignment: u64,

    /* Optional comment */
    pub comment: Option<String>,

    /* Fully-qualified dynamic parameter references (owner -> path -> primitive) */
    pub dynamic_params: BTreeMap<String, BTreeMap<String, PrimitiveType>>,
}

/* Reflected type kind - mirrors ResolvedTypeKind but serializable */
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum ReflectedTypeKind {
    Primitive {
        prim_type: PrimitiveType,
    },
    Struct {
        fields: Vec<ReflectedField>,
        packed: bool,
        custom_alignment: Option<u64>,
    },
    Union {
        variants: Vec<ReflectedField>,
    },
    Enum {
        tag_expression: String,
        tag_constant_status: String,
        variants: Vec<ReflectedEnumVariant>,
    },
    Array {
        element_type: Box<ReflectedType>,
        size_expression: String,
        size_constant_status: String,
    },
    SizeDiscriminatedUnion {
        variants: Vec<ReflectedSizeDiscriminatedVariant>,
    },
    TypeRef {
        target_name: String,
        resolved: bool,
    },
}

/* Reflected field information */
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReflectedField {
    /* Field name */
    pub name: String,

    /* Field type */
    pub field_type: ReflectedType,

    /* Field offset in bytes (None if variable size) */
    pub offset: Option<u64>,
}

/* Reflected enum variant */
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReflectedEnumVariant {
    /* Variant name */
    pub name: String,

    /* Tag value */
    pub tag_value: u64,

    /* Variant type */
    pub variant_type: ReflectedType,

    /* Whether this variant relies on a runtime payload_size parameter */
    pub requires_payload_size: bool,
}

/* Reflected size-discriminated union variant */
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReflectedSizeDiscriminatedVariant {
    /* Variant name */
    pub name: String,

    /* Expected size */
    pub expected_size: u64,

    /* Variant type */
    pub variant_type: ReflectedType,
}

impl ReflectedType {
    /* Convert a ResolvedType to a ReflectedType */
    pub fn from_resolved(resolved: &ResolvedType) -> Self {
        let size = match &resolved.size {
            abi_gen::abi::resolved::Size::Const(s) => Some(*s),
            abi_gen::abi::resolved::Size::Variable(_) => None,
        };

        let kind = match &resolved.kind {
            ResolvedTypeKind::Primitive { prim_type } => ReflectedTypeKind::Primitive {
                prim_type: prim_type.clone(),
            },
            ResolvedTypeKind::Struct {
                fields,
                packed,
                custom_alignment,
            } => ReflectedTypeKind::Struct {
                fields: fields
                    .iter()
                    .map(|f| ReflectedField::from_resolved(f))
                    .collect(),
                packed: *packed,
                custom_alignment: *custom_alignment,
            },
            ResolvedTypeKind::Union { variants } => ReflectedTypeKind::Union {
                variants: variants
                    .iter()
                    .map(|f| ReflectedField::from_resolved(f))
                    .collect(),
            },
            ResolvedTypeKind::Enum {
                tag_expression,
                tag_constant_status,
                variants,
            } => ReflectedTypeKind::Enum {
                tag_expression: tag_expression.to_c_string(),
                tag_constant_status: format!("{:?}", tag_constant_status),
                variants: variants
                    .iter()
                    .map(|v| ReflectedEnumVariant::from_resolved(v))
                    .collect(),
            },
            ResolvedTypeKind::Array {
                element_type,
                size_expression,
                size_constant_status,
                ..
            } => ReflectedTypeKind::Array {
                element_type: Box::new(ReflectedType::from_resolved(element_type)),
                size_expression: size_expression.to_c_string(),
                size_constant_status: format!("{:?}", size_constant_status),
            },
            ResolvedTypeKind::SizeDiscriminatedUnion { variants } => {
                ReflectedTypeKind::SizeDiscriminatedUnion {
                    variants: variants
                        .iter()
                        .map(|v| ReflectedSizeDiscriminatedVariant::from_resolved(v))
                        .collect(),
                }
            }
            ResolvedTypeKind::TypeRef {
                target_name,
                resolved,
            } => ReflectedTypeKind::TypeRef {
                target_name: target_name.clone(),
                resolved: *resolved,
            },
        };

        Self {
            name: resolved.name.clone(),
            kind,
            size,
            alignment: resolved.alignment,
            comment: resolved.comment.clone(),
            dynamic_params: resolved.dynamic_params.clone(),
        }
    }
}

impl ReflectedField {
    /* Convert a ResolvedField to a ReflectedField */
    pub fn from_resolved(field: &abi_gen::abi::resolved::ResolvedField) -> Self {
        Self {
            name: field.name.clone(),
            field_type: ReflectedType::from_resolved(&field.field_type),
            offset: field.offset,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use abi_gen::abi::resolved::Size;
    use abi_gen::abi::types::IntegralType;

    #[test]
    fn reflected_type_carries_dynamic_params() {
        let mut inner = BTreeMap::new();
        inner.insert(
            "len".to_string(),
            PrimitiveType::Integral(IntegralType::U32),
        );

        let mut params = BTreeMap::new();
        params.insert("data".to_string(), inner.clone());

        let resolved = ResolvedType {
            name: "TestStruct".to_string(),
            size: Size::Const(0),
            alignment: 1,
            comment: None,
            dynamic_params: params.clone(),
            kind: ResolvedTypeKind::Struct {
                fields: Vec::new(),
                packed: false,
                custom_alignment: None,
            },
        };

        let reflected = ReflectedType::from_resolved(&resolved);
        assert_eq!(reflected.dynamic_params, params);
    }
}

impl ReflectedEnumVariant {
    /* Convert a ResolvedEnumVariant to a ReflectedEnumVariant */
    pub fn from_resolved(variant: &abi_gen::abi::resolved::ResolvedEnumVariant) -> Self {
        Self {
            name: variant.name.clone(),
            tag_value: variant.tag_value,
            variant_type: ReflectedType::from_resolved(&variant.variant_type),
            requires_payload_size: variant.requires_payload_size,
        }
    }
}

impl ReflectedSizeDiscriminatedVariant {
    /* Convert a ResolvedSizeDiscriminatedVariant to a ReflectedSizeDiscriminatedVariant */
    pub fn from_resolved(
        variant: &abi_gen::abi::resolved::ResolvedSizeDiscriminatedVariant,
    ) -> Self {
        Self {
            name: variant.name.clone(),
            expected_size: variant.expected_size,
            variant_type: ReflectedType::from_resolved(&variant.variant_type),
        }
    }
}
