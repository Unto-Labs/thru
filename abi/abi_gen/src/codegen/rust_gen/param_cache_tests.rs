use crate::abi::expr::{ExprKind, FieldRefExpr, LiteralExpr};
use crate::abi::resolved::{
    ConstantStatus, ResolvedEnumVariant, ResolvedField, ResolvedSizeDiscriminatedVariant,
    ResolvedType, ResolvedTypeKind, Size,
};
use crate::abi::types::IntegralType;
use crate::codegen::rust_gen::param_cache::{extract_param_cache, ParamEvalError};
use std::collections::{BTreeMap, HashMap};

fn primitive(name: &str, int: IntegralType) -> ResolvedType {
    let size = match int {
        IntegralType::U8 | IntegralType::I8 => 1,
        IntegralType::U16 | IntegralType::I16 => 2,
        IntegralType::U32 | IntegralType::I32 => 4,
        IntegralType::U64 | IntegralType::I64 => 8,
    };
    ResolvedType {
        name: name.into(),
        size: Size::Const(size),
        alignment: size,
        comment: None,
        dynamic_params: BTreeMap::new(),
        kind: ResolvedTypeKind::Primitive {
            prim_type: crate::abi::types::PrimitiveType::Integral(int),
        },
    }
}

#[test]
fn state_proof_style_computed_tag_and_payload() -> Result<(), ParamEvalError> {
    let version_field = ResolvedField {
        name: "version".into(),
        field_type: primitive("version", IntegralType::U8),
        offset: Some(0),
    };
    let proof_variant = ResolvedEnumVariant {
        name: "proof".into(),
        tag_value: 1,
        variant_type: ResolvedType {
            name: "proof_payload".into(),
            size: Size::Variable(HashMap::new()),
            alignment: 1,
            comment: None,
            dynamic_params: BTreeMap::new(),
            kind: ResolvedTypeKind::Array {
                element_type: Box::new(primitive("byte", IntegralType::U8)),
                size_expression: ExprKind::FieldRef(FieldRefExpr {
                    path: vec!["version".into()],
                }),
                size_constant_status: ConstantStatus::NonConstant(HashMap::new()),
                    jagged: false,
            },
        },
        requires_payload_size: true,
    };
    let enum_field = ResolvedField {
        name: "payload".into(),
        field_type: ResolvedType {
            name: "payload_t".into(),
            size: Size::Variable(HashMap::new()),
            alignment: 1,
            comment: None,
            dynamic_params: BTreeMap::new(),
            kind: ResolvedTypeKind::Enum {
                tag_expression: ExprKind::FieldRef(FieldRefExpr {
                    path: vec!["version".into()],
                }),
                tag_constant_status: ConstantStatus::NonConstant(HashMap::new()),
                variants: vec![proof_variant],
            },
        },
        offset: None,
    };
    let ty = ResolvedType {
        name: "state_proof".into(),
        size: Size::Variable(HashMap::new()),
        alignment: 1,
        comment: None,
        dynamic_params: BTreeMap::new(),
        kind: ResolvedTypeKind::Struct {
            fields: vec![version_field, enum_field],
            packed: true,
            custom_alignment: None,
        },
    };
    let buf = [1u8, 0xaa];
    let cache = extract_param_cache(&ty, &buf, &BTreeMap::new(), &["payload".into()])?;
    assert_eq!(cache.derived.get("payload.tag"), Some(&1));
    assert_eq!(cache.params.get("payload.proof.0"), Some(0xaa));
    assert_eq!(cache.params.get("payload.proof.payload_size"), Some(1));
    assert_eq!(cache.offsets.get("payload"), Some(&1));
    Ok(())
}

#[test]
fn size_discriminated_union_captures_payload_size() -> Result<(), ParamEvalError> {
    let variant_a = ResolvedSizeDiscriminatedVariant {
        name: "a".into(),
        expected_size: 1,
        variant_type: primitive("a", IntegralType::U8),
    };
    let variant_b = ResolvedSizeDiscriminatedVariant {
        name: "b".into(),
        expected_size: 3,
        variant_type: ResolvedType {
            name: "b_arr".into(),
            size: Size::Variable(HashMap::new()),
            alignment: 1,
            comment: None,
            dynamic_params: BTreeMap::new(),
            kind: ResolvedTypeKind::Array {
                element_type: Box::new(primitive("elem", IntegralType::U8)),
                size_expression: ExprKind::Literal(LiteralExpr::U64(3)),
                size_constant_status: ConstantStatus::Constant,
                jagged: false,
            },
        },
    };
    let payload_field = ResolvedField {
        name: "payload".into(),
        field_type: ResolvedType {
            name: "sdu".into(),
            size: Size::Variable(HashMap::new()),
            alignment: 1,
            comment: None,
            dynamic_params: BTreeMap::new(),
            kind: ResolvedTypeKind::SizeDiscriminatedUnion {
                variants: vec![variant_a, variant_b],
            },
        },
        offset: None,
    };
    let ty = ResolvedType {
        name: "wrapper".into(),
        size: Size::Variable(HashMap::new()),
        alignment: 1,
        comment: None,
        dynamic_params: BTreeMap::new(),
        kind: ResolvedTypeKind::Struct {
            fields: vec![payload_field],
            packed: true,
            custom_alignment: None,
        },
    };
    let buf = [9u8, 8, 7];
    let cache = extract_param_cache(&ty, &buf, &BTreeMap::new(), &[])?;
    assert_eq!(cache.params.get("payload.b.0"), Some(9));
    assert_eq!(cache.params.get("payload.b.1"), Some(8));
    assert_eq!(cache.params.get("payload.b.2"), Some(7));
    assert_eq!(cache.params.get("payload.payload_size"), Some(3));
    Ok(())
}

#[test]
fn typeref_binding_smoke() -> Result<(), ParamEvalError> {
    let leaf = ResolvedType {
        name: "leaf".into(),
        size: Size::Variable(HashMap::new()),
        alignment: 1,
        comment: None,
        dynamic_params: BTreeMap::new(),
        kind: ResolvedTypeKind::Struct {
            fields: vec![
                ResolvedField {
                    name: "len".into(),
                    field_type: primitive("len", IntegralType::U8),
                    offset: Some(0),
                },
                ResolvedField {
                    name: "data".into(),
                    field_type: ResolvedType {
                        name: "data".into(),
                        size: Size::Variable(HashMap::new()),
                        alignment: 1,
                        comment: None,
                        dynamic_params: BTreeMap::new(),
                        kind: ResolvedTypeKind::Array {
                            element_type: Box::new(primitive("item", IntegralType::U8)),
                            size_expression: ExprKind::FieldRef(FieldRefExpr {
                                path: vec!["len".into()],
                            }),
                            size_constant_status: ConstantStatus::NonConstant(HashMap::new()),
                    jagged: false,
                        },
                    },
                    offset: None,
                },
            ],
            packed: true,
            custom_alignment: None,
        },
    };
    let mut lookup = BTreeMap::new();
    lookup.insert("Leaf".into(), leaf.clone());
    let ty = ResolvedType {
        name: "holder".into(),
        size: Size::Variable(HashMap::new()),
        alignment: 1,
        comment: None,
        dynamic_params: BTreeMap::new(),
        kind: ResolvedTypeKind::Struct {
            fields: vec![ResolvedField {
                name: "body".into(),
                field_type: ResolvedType {
                    name: "body_t".into(),
                    size: Size::Variable(HashMap::new()),
                    alignment: 1,
                    comment: None,
                    dynamic_params: BTreeMap::new(),
                    kind: ResolvedTypeKind::TypeRef {
                        target_name: "Leaf".into(),
                        resolved: true,
                    },
                },
                offset: None,
            }],
            packed: true,
            custom_alignment: None,
        },
    };
    let buf = [2u8, 3, 4];
    let cache = extract_param_cache(&ty, &buf, &lookup, &["body.data".into()])?;
    assert_eq!(cache.params.get("body.len"), Some(2));
    assert_eq!(cache.params.get("body.data.0"), Some(3));
    assert_eq!(cache.params.get("body.data.1"), Some(4));
    assert_eq!(cache.offsets.get("body.data"), Some(&1));
    Ok(())
}

#[test]
fn enum_tail_variant_uses_inner_count() -> Result<(), ParamEvalError> {
    let tail_payload = ResolvedType {
        name: "tail_payload".into(),
        size: Size::Variable(HashMap::new()),
        alignment: 1,
        comment: None,
        dynamic_params: BTreeMap::new(),
        kind: ResolvedTypeKind::Struct {
            fields: vec![
                ResolvedField {
                    name: "count".into(),
                    field_type: primitive("count", IntegralType::U8),
                    offset: Some(0),
                },
                ResolvedField {
                    name: "data".into(),
                    field_type: ResolvedType {
                        name: "data".into(),
                        size: Size::Variable(HashMap::new()),
                        alignment: 1,
                        comment: None,
                        dynamic_params: BTreeMap::new(),
                        kind: ResolvedTypeKind::Array {
                            element_type: Box::new(primitive("byte", IntegralType::U8)),
                            size_expression: ExprKind::FieldRef(FieldRefExpr {
                                path: vec!["count".into()],
                            }),
                            size_constant_status: ConstantStatus::NonConstant(HashMap::new()),
                    jagged: false,
                        },
                    },
                    offset: None,
                },
            ],
            packed: true,
            custom_alignment: None,
        },
    };
    let tail_variant = ResolvedEnumVariant {
        name: "tail".into(),
        tag_value: 7,
        variant_type: tail_payload,
        requires_payload_size: true,
    };
    let root = ResolvedType {
        name: "tail_enum_wrapper".into(),
        size: Size::Variable(HashMap::new()),
        alignment: 1,
        comment: None,
        dynamic_params: BTreeMap::new(),
        kind: ResolvedTypeKind::Struct {
            fields: vec![
                ResolvedField {
                    name: "tag".into(),
                    field_type: primitive("tag", IntegralType::U8),
                    offset: Some(0),
                },
                ResolvedField {
                    name: "body".into(),
                    field_type: ResolvedType {
                        name: "body_enum".into(),
                        size: Size::Variable(HashMap::new()),
                        alignment: 1,
                        comment: None,
                        dynamic_params: BTreeMap::new(),
                        kind: ResolvedTypeKind::Enum {
                            tag_expression: ExprKind::FieldRef(FieldRefExpr {
                                path: vec!["tag".into()],
                            }),
                            tag_constant_status: ConstantStatus::NonConstant(HashMap::new()),
                            variants: vec![tail_variant],
                        },
                    },
                    offset: None,
                },
            ],
            packed: true,
            custom_alignment: None,
        },
    };
    let buf = [7u8, 2, 0xaa, 0xbb];
    let cache = extract_param_cache(&root, &buf, &BTreeMap::new(), &["body".into()])?;
    assert_eq!(cache.derived.get("body.tag"), Some(&7));
    assert_eq!(cache.params.get("body.tail.count"), Some(2));
    assert_eq!(cache.params.get("body.tail.data.0"), Some(0xaa));
    assert_eq!(cache.params.get("body.tail.data.1"), Some(0xbb));
    assert_eq!(cache.params.get("body.tail.payload_size"), Some(3));
    assert_eq!(cache.offsets.get("body"), Some(&1));
    Ok(())
}
