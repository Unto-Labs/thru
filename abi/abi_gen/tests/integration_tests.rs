use abi_gen::{
    abi::resolved::{ConstantStatus, ResolutionError, ResolvedTypeKind, Size, TypeResolver},
    abi::{expr::*, types::*},
    dependency::DependencyAnalyzer,
};
use std::collections::HashSet;

#[test]
fn test_complete_abi_analysis_pipeline() {
    // Test the complete pipeline: parse -> analyze dependencies -> resolve types -> validate constraints

    let typedefs = vec![
        // Simple base type
        TypeDef {
            name: "BaseType".to_string(),
            kind: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U32)),
        },
        // Struct with valid constant array
        TypeDef {
            name: "ValidStruct".to_string(),
            kind: TypeKind::Struct(StructType {
                container_attributes: Default::default(),
                fields: vec![
                    StructField {
                        name: "header".to_string(),
                        field_type: TypeKind::TypeRef(TypeRefType {
                            name: "BaseType".to_string(),
                            comment: None,
                        }),
                    },
                    StructField {
                        name: "data".to_string(),
                        field_type: TypeKind::Array(ArrayType {
                            container_attributes: Default::default(),
                            size: ExprKind::Literal(LiteralExpr::U64(16)),
                            element_type: Box::new(TypeKind::Primitive(PrimitiveType::Integral(
                                IntegralType::U8,
                            ))),
                        }),
                    },
                ],
            }),
        },
        // Enum with constant tag
        TypeDef {
            name: "ValidEnum".to_string(),
            kind: TypeKind::Enum(EnumType {
                container_attributes: Default::default(),
                tag_ref: ExprKind::Sizeof(SizeofExpr {
                    type_name: "BaseType".to_string(),
                }),
                variants: vec![EnumVariant {
                    name: "Variant1".to_string(),
                    tag_value: 1,
                    variant_type: TypeKind::TypeRef(TypeRefType {
                        name: "ValidStruct".to_string(),
                        comment: None,
                    }),
                }],
            }),
        },
    ];

    // Run dependency analysis
    let mut analyzer = DependencyAnalyzer::new();
    let analysis = analyzer.analyze_multiple_typedefs(&typedefs);

    // Debug output
    if !analysis.cycles.is_empty() {
        println!("Cycles found: {}", analysis.cycles.len());
        for cycle in &analysis.cycles {
            println!("  Cycle: {:?}", cycle.cycle);
        }
        println!("Dependencies:");
        for dep in &analysis.graph.edges {
            println!("  {} -> {}", dep.from, dep.to);
        }
    }

    // Should have no cycles or violations
    assert!(analysis.cycles.is_empty(), "Should not have cycles");
    assert!(
        analysis.layout_violations.is_empty(),
        "Should not have layout violations"
    );
    assert!(
        analysis.topological_order.is_some(),
        "Should have topological order"
    );

    // Verify dependency ordering
    let topo_order = analysis.topological_order.unwrap();
    let base_pos = topo_order.iter().position(|x| x == "BaseType").unwrap();
    let struct_pos = topo_order.iter().position(|x| x == "ValidStruct").unwrap();
    let enum_pos = topo_order.iter().position(|x| x == "ValidEnum").unwrap();

    assert!(
        base_pos < struct_pos,
        "BaseType should come before ValidStruct"
    );
    assert!(
        struct_pos < enum_pos,
        "ValidStruct should come before ValidEnum"
    );

    // Run type resolution
    let mut resolver = TypeResolver::new();
    for typedef in &typedefs {
        resolver.add_typedef(typedef.clone());
    }
    resolver.resolve_all().expect("Should resolve all types");

    // Verify resolved types
    let base_type = resolver.get_type_info("BaseType").unwrap();
    assert_eq!(base_type.size, Size::Const(4));
    assert_eq!(base_type.alignment, 4);

    let struct_type = resolver.get_type_info("ValidStruct").unwrap();
    assert_eq!(struct_type.size, Size::Const(20)); // 4 (u32) + 16 (array)
    assert_eq!(struct_type.alignment, 4);

    let enum_type = resolver.get_type_info("ValidEnum").unwrap();
    assert_eq!(enum_type.size, Size::Const(20)); // Maximum variant size (ValidStruct = 20 bytes)
    assert_eq!(enum_type.alignment, 4); // Alignment of ValidStruct
}

#[test]
fn test_invalid_enum_tag_layout_cycle_detection() {
    let typedefs = vec![
        // Container struct
        TypeDef {
            name: "Container".to_string(),
            kind: TypeKind::Struct(StructType {
                container_attributes: Default::default(),
                fields: vec![
                    StructField {
                        name: "problematic_enum".to_string(),
                        field_type: TypeKind::TypeRef(TypeRefType {
                            name: "ProblematicEnum".to_string(),
                            comment: None,
                        }),
                    },
                    StructField {
                        name: "referenced_field".to_string(),
                        field_type: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U32)),
                    },
                ],
            }),
        },
        // Enum that creates a layout cycle
        TypeDef {
            name: "ProblematicEnum".to_string(),
            kind: TypeKind::Enum(EnumType {
                container_attributes: Default::default(),
                // This tag references a field whose offset depends on this enum's size
                tag_ref: ExprKind::FieldRef(FieldRefExpr {
                    path: vec!["Container".to_string(), "referenced_field".to_string()],
                }),
                variants: vec![EnumVariant {
                    name: "Variant1".to_string(),
                    tag_value: 1,
                    variant_type: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U32)),
                }],
            }),
        },
    ];

    let mut analyzer = DependencyAnalyzer::new();
    let analysis = analyzer.analyze_multiple_typedefs(&typedefs);

    // Should detect layout violations
    assert!(
        !analysis.layout_violations.is_empty(),
        "Should detect layout violations"
    );

    let violation = analysis
        .layout_violations
        .iter()
        .find(|v| v.violating_type == "ProblematicEnum")
        .expect("Should find violation for ProblematicEnum");

    assert!(
        violation.reason.contains("forward reference")
            || violation.reason.contains("layout cycle")
            || violation.reason.contains("circular dependency")
    );
    assert!(violation.violating_expression.contains("referenced_field"));
}

#[test]
fn test_forward_field_reference_detection() {
    let typedefs = vec![
        TypeDef {
            name: "ForwardRefStruct".to_string(),
            kind: TypeKind::Struct(StructType {
                container_attributes: Default::default(),
                fields: vec![
                    StructField {
                        name: "early_array".to_string(),
                        field_type: TypeKind::TypeRef(TypeRefType {
                            name: "ForwardRefArray".to_string(),
                            comment: None,
                        }),
                    },
                    StructField {
                        name: "middle_field".to_string(),
                        field_type: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U32)),
                    },
                    StructField {
                        name: "late_field".to_string(),
                        field_type: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U32)),
                    },
                ],
            }),
        },
        TypeDef {
            name: "ForwardRefArray".to_string(),
            kind: TypeKind::Array(ArrayType {
                container_attributes: Default::default(),
                // Invalid: references a field that comes later in the parent struct
                size: ExprKind::FieldRef(FieldRefExpr {
                    path: vec!["ForwardRefStruct".to_string(), "late_field".to_string()],
                }),
                element_type: Box::new(TypeKind::Primitive(PrimitiveType::Integral(
                    IntegralType::U8,
                ))),
            }),
        },
    ];

    let mut analyzer = DependencyAnalyzer::new();
    let analysis = analyzer.analyze_multiple_typedefs(&typedefs);

    assert!(!analysis.layout_violations.is_empty());

    let violation = analysis
        .layout_violations
        .iter()
        .find(|v| v.violating_type == "ForwardRefStruct")
        .expect("Should find forward reference violation");

    assert!(violation.reason.contains("forward dependency"));
    assert!(violation.violating_expression.contains("late_field"));
}

#[test]
fn test_struct_field_forward_reference_rejected() {
    let mut resolver = TypeResolver::new();

    let typedef = TypeDef {
        name: "BadStruct".to_string(),
        kind: TypeKind::Struct(StructType {
            container_attributes: Default::default(),
            fields: vec![
                StructField {
                    name: "payload".to_string(),
                    field_type: TypeKind::Array(ArrayType {
                        container_attributes: Default::default(),
                        size: ExprKind::FieldRef(FieldRefExpr {
                            path: vec!["len".to_string()],
                        }),
                        element_type: Box::new(TypeKind::Primitive(PrimitiveType::Integral(
                            IntegralType::U8,
                        ))),
                    }),
                },
                StructField {
                    name: "len".to_string(),
                    field_type: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U16)),
                },
            ],
        }),
    };

    resolver.add_typedef(typedef);
    let err = resolver.resolve_all().unwrap_err();
    match err {
        ResolutionError::ForwardFieldReference {
            type_name,
            field_name,
            referenced_field,
        } => {
            assert_eq!(type_name, "BadStruct");
            assert_eq!(field_name, "payload");
            assert_eq!(referenced_field, "len");
        }
        other => panic!("unexpected error: {:?}", other),
    }
}

#[test]
fn test_complex_transitive_dependency_chain() {
    let typedefs = vec![
        // Root container
        TypeDef {
            name: "RootContainer".to_string(),
            kind: TypeKind::Struct(StructType {
                container_attributes: Default::default(),
                fields: vec![
                    StructField {
                        name: "level1".to_string(),
                        field_type: TypeKind::TypeRef(TypeRefType {
                            name: "Level1".to_string(),
                            comment: None,
                        }),
                    },
                    StructField {
                        name: "target_field".to_string(),
                        field_type: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U32)),
                    },
                ],
            }),
        },
        // Level 1 nesting
        TypeDef {
            name: "Level1".to_string(),
            kind: TypeKind::Struct(StructType {
                container_attributes: Default::default(),
                fields: vec![StructField {
                    name: "level2".to_string(),
                    field_type: TypeKind::TypeRef(TypeRefType {
                        name: "Level2".to_string(),
                        comment: None,
                    }),
                }],
            }),
        },
        // Level 2 nesting with problematic array
        TypeDef {
            name: "Level2".to_string(),
            kind: TypeKind::Struct(StructType {
                container_attributes: Default::default(),
                fields: vec![StructField {
                    name: "problematic_array".to_string(),
                    field_type: TypeKind::TypeRef(TypeRefType {
                        name: "TransitiveArray".to_string(),
                        comment: None,
                    }),
                }],
            }),
        },
        // Array that creates transitive dependency back to root
        TypeDef {
            name: "TransitiveArray".to_string(),
            kind: TypeKind::Array(ArrayType {
                container_attributes: Default::default(),
                // This creates: RootContainer -> Level1 -> Level2 -> TransitiveArray -> RootContainer
                size: ExprKind::FieldRef(FieldRefExpr {
                    path: vec!["RootContainer".to_string(), "target_field".to_string()],
                }),
                element_type: Box::new(TypeKind::Primitive(PrimitiveType::Integral(
                    IntegralType::U8,
                ))),
            }),
        },
    ];

    let mut analyzer = DependencyAnalyzer::new();
    let analysis = analyzer.analyze_multiple_typedefs(&typedefs);

    // Should detect the transitive layout cycle
    assert!(!analysis.layout_violations.is_empty());

    let violation = analysis
        .layout_violations
        .iter()
        .find(|v| v.violating_type == "TransitiveArray")
        .expect("Should find transitive dependency violation");

    assert!(violation.reason.contains("transitive"));
    assert!(violation.dependency_chain.len() > 1);
}

#[test]
fn test_packed_vs_aligned_struct_analysis() {
    let typedefs = vec![
        // Regular struct
        TypeDef {
            name: "RegularStruct".to_string(),
            kind: TypeKind::Struct(StructType {
                container_attributes: Default::default(),
                fields: vec![
                    StructField {
                        name: "byte_field".to_string(),
                        field_type: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U8)),
                    },
                    StructField {
                        name: "int_field".to_string(),
                        field_type: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U32)),
                    },
                ],
            }),
        },
        // Packed struct
        TypeDef {
            name: "PackedStruct".to_string(),
            kind: TypeKind::Struct(StructType {
                container_attributes: ContainerAttributes {
                    packed: true,
                    aligned: 0,
                    comment: None,
                },
                fields: vec![
                    StructField {
                        name: "byte_field".to_string(),
                        field_type: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U8)),
                    },
                    StructField {
                        name: "int_field".to_string(),
                        field_type: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U32)),
                    },
                ],
            }),
        },
        // Aligned struct
        TypeDef {
            name: "AlignedStruct".to_string(),
            kind: TypeKind::Struct(StructType {
                container_attributes: ContainerAttributes {
                    packed: false,
                    aligned: 16,
                    comment: None,
                },
                fields: vec![StructField {
                    name: "byte_field".to_string(),
                    field_type: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U8)),
                }],
            }),
        },
    ];

    let mut analyzer = DependencyAnalyzer::new();
    let analysis = analyzer.analyze_multiple_typedefs(&typedefs);

    // Should not have layout violations for these simple structs
    assert!(analysis.layout_violations.is_empty());

    // Test type resolution
    let mut resolver = TypeResolver::new();
    for typedef in &typedefs {
        resolver.add_typedef(typedef.clone());
    }
    resolver
        .resolve_all()
        .expect("Should resolve all struct types");

    // Regular struct: u8 + padding + u32 = 8 bytes
    let regular = resolver.get_type_info("RegularStruct").unwrap();
    assert_eq!(regular.size, Size::Const(8));
    assert_eq!(regular.alignment, 4);

    // Packed struct: u8 + u32 = 5 bytes (no padding)
    let packed = resolver.get_type_info("PackedStruct").unwrap();
    assert_eq!(packed.size, Size::Const(5));
    assert_eq!(packed.alignment, 1); // Packed structs have alignment 1

    // Aligned struct: u8 with 16-byte alignment
    let aligned = resolver.get_type_info("AlignedStruct").unwrap();
    assert_eq!(aligned.size, Size::Const(16)); // Padded to 16-byte boundary
    assert_eq!(aligned.alignment, 16);
}

#[test]
fn test_constant_expression_analysis_integration() {
    let typedefs = vec![
        // Array with constant size
        TypeDef {
            name: "ConstantArray".to_string(),
            kind: TypeKind::Array(ArrayType {
                container_attributes: Default::default(),
                size: ExprKind::Mul(MulExpr {
                    left: Box::new(ExprKind::Literal(LiteralExpr::U64(4))),
                    right: Box::new(ExprKind::Sizeof(SizeofExpr {
                        type_name: "u32".to_string(),
                    })),
                }),
                element_type: Box::new(TypeKind::Primitive(PrimitiveType::Integral(
                    IntegralType::U8,
                ))),
            }),
        },
        // Array with non-constant size
        TypeDef {
            name: "DynamicArray".to_string(),
            kind: TypeKind::Array(ArrayType {
                container_attributes: Default::default(),
                size: ExprKind::Add(AddExpr {
                    left: Box::new(ExprKind::Literal(LiteralExpr::U64(10))),
                    right: Box::new(ExprKind::FieldRef(FieldRefExpr {
                        path: vec!["dynamic_size".to_string()],
                    })),
                }),
                element_type: Box::new(TypeKind::Primitive(PrimitiveType::Integral(
                    IntegralType::U8,
                ))),
            }),
        },
    ];

    let mut resolver = TypeResolver::new();
    for typedef in &typedefs {
        resolver.add_typedef(typedef.clone());
    }
    resolver.resolve_all().expect("Should resolve array types");

    // Constant array should be marked as constant
    let constant_array = resolver.get_type_info("ConstantArray").unwrap();
    if let ResolvedTypeKind::Array {
        size_constant_status,
        ..
    } = &constant_array.kind
    {
        assert_eq!(*size_constant_status, ConstantStatus::Constant);
    } else {
        panic!("Expected array type");
    }

    // Dynamic array should be marked as non-constant
    let dynamic_array = resolver.get_type_info("DynamicArray").unwrap();
    if let ResolvedTypeKind::Array {
        size_constant_status,
        ..
    } = &dynamic_array.kind
    {
        assert!(matches!(
            size_constant_status,
            ConstantStatus::NonConstant(_)
        ));
    } else {
        panic!("Expected array type");
    }

    // Check non-constant dependencies
    let deps = resolver.get_non_constant_dependencies("DynamicArray");
    assert_eq!(deps.len(), 1);
    assert_eq!(deps[0], "dynamic_size");
}

#[test]
fn test_comprehensive_error_reporting() {
    let typedefs = vec![
        // Multiple violations in one analysis
        TypeDef {
            name: "MultiViolationStruct".to_string(),
            kind: TypeKind::Struct(StructType {
                container_attributes: Default::default(),
                fields: vec![
                    StructField {
                        name: "problematic_enum".to_string(),
                        field_type: TypeKind::TypeRef(TypeRefType {
                            name: "BadEnum".to_string(),
                            comment: None,
                        }),
                    },
                    StructField {
                        name: "problematic_array".to_string(),
                        field_type: TypeKind::TypeRef(TypeRefType {
                            name: "BadArray".to_string(),
                            comment: None,
                        }),
                    },
                    StructField {
                        name: "reference_field".to_string(),
                        field_type: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U32)),
                    },
                ],
            }),
        },
        // Enum with layout cycle
        TypeDef {
            name: "BadEnum".to_string(),
            kind: TypeKind::Enum(EnumType {
                container_attributes: Default::default(),
                tag_ref: ExprKind::FieldRef(FieldRefExpr {
                    path: vec![
                        "MultiViolationStruct".to_string(),
                        "reference_field".to_string(),
                    ],
                }),
                variants: vec![EnumVariant {
                    name: "Variant1".to_string(),
                    tag_value: 1,
                    variant_type: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U32)),
                }],
            }),
        },
        // Array with layout cycle
        TypeDef {
            name: "BadArray".to_string(),
            kind: TypeKind::Array(ArrayType {
                container_attributes: Default::default(),
                size: ExprKind::FieldRef(FieldRefExpr {
                    path: vec![
                        "MultiViolationStruct".to_string(),
                        "reference_field".to_string(),
                    ],
                }),
                element_type: Box::new(TypeKind::Primitive(PrimitiveType::Integral(
                    IntegralType::U8,
                ))),
            }),
        },
    ];

    let mut analyzer = DependencyAnalyzer::new();
    let analysis = analyzer.analyze_multiple_typedefs(&typedefs);

    // Should detect multiple violations
    assert!(analysis.layout_violations.len() >= 2);

    // Check that we have violations for both enum and array
    let enum_violations: Vec<_> = analysis
        .layout_violations
        .iter()
        .filter(|v| v.violating_type == "BadEnum")
        .collect();
    let array_violations: Vec<_> = analysis
        .layout_violations
        .iter()
        .filter(|v| v.violating_type == "BadArray")
        .collect();

    assert!(!enum_violations.is_empty(), "Should have enum violation");
    assert!(!array_violations.is_empty(), "Should have array violation");

    // Verify violation details
    for violation in &analysis.layout_violations {
        assert!(!violation.reason.is_empty(), "Should have violation reason");
        assert!(
            !violation.violating_expression.is_empty(),
            "Should have violating expression"
        );
        assert!(
            !violation.dependency_chain.is_empty(),
            "Should have dependency chain"
        );
    }
}

#[test]
fn test_real_world_scenario_token_account() {
    // Simulates a real-world token account structure similar to the example in in.yaml
    let typedefs = vec![TypeDef {
        name: "TokenAccount".to_string(),
        kind: TypeKind::Struct(StructType {
            container_attributes: ContainerAttributes {
                packed: true,
                aligned: 1,
                comment: Some("Token account structure".to_string()),
            },
            fields: vec![
                StructField {
                    name: "is_initialized".to_string(),
                    field_type: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U8)),
                },
                StructField {
                    name: "is_frozen".to_string(),
                    field_type: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U8)),
                },
                StructField {
                    name: "mint".to_string(),
                    field_type: TypeKind::Array(ArrayType {
                        container_attributes: Default::default(),
                        size: ExprKind::Literal(LiteralExpr::U64(32)),
                        element_type: Box::new(TypeKind::Primitive(PrimitiveType::Integral(
                            IntegralType::U8,
                        ))),
                    }),
                },
                StructField {
                    name: "owner".to_string(),
                    field_type: TypeKind::Array(ArrayType {
                        container_attributes: Default::default(),
                        size: ExprKind::Literal(LiteralExpr::U64(32)),
                        element_type: Box::new(TypeKind::Primitive(PrimitiveType::Integral(
                            IntegralType::U8,
                        ))),
                    }),
                },
                StructField {
                    name: "amount".to_string(),
                    field_type: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U64)),
                },
            ],
        }),
    }];

    // Run complete analysis
    let mut analyzer = DependencyAnalyzer::new();
    let analysis = analyzer.analyze_multiple_typedefs(&typedefs);

    // Should be completely valid
    assert!(analysis.cycles.is_empty());
    assert!(analysis.layout_violations.is_empty());
    assert_eq!(
        analysis.topological_order,
        Some(vec!["TokenAccount".to_string()])
    );

    // Resolve types
    let mut resolver = TypeResolver::new();
    for typedef in &typedefs {
        resolver.add_typedef(typedef.clone());
    }
    resolver
        .resolve_all()
        .expect("Should resolve token account");

    let token_account = resolver.get_type_info("TokenAccount").unwrap();
    // Packed struct: u8 + u8 + 32 + 32 + u64 = 74 bytes
    assert_eq!(token_account.size, Size::Const(74));
    assert_eq!(token_account.alignment, 1); // Packed with align 1
}

#[test]
fn test_comprehensive_validation_integration() {
    // Test all validation features together: duplicates, layout cycles, dependencies
    let typedefs = vec![
        // Valid base type
        TypeDef {
            name: "BaseType".to_string(),
            kind: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U32)),
        },
        // Duplicate type name (validation error)
        TypeDef {
            name: "BaseType".to_string(), // Duplicate!
            kind: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U8)),
        },
        // Struct with duplicate field names (validation error)
        TypeDef {
            name: "BadStruct".to_string(),
            kind: TypeKind::Struct(StructType {
                container_attributes: Default::default(),
                fields: vec![
                    StructField {
                        name: "duplicate_field".to_string(),
                        field_type: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U32)),
                    },
                    StructField {
                        name: "duplicate_field".to_string(), // Duplicate field!
                        field_type: TypeKind::TypeRef(TypeRefType {
                            name: "ProblematicArray".to_string(),
                            comment: None,
                        }),
                    },
                    StructField {
                        name: "problematic_enum".to_string(),
                        field_type: TypeKind::TypeRef(TypeRefType {
                            name: "ProblematicEnum".to_string(),
                            comment: None,
                        }),
                    },
                    StructField {
                        name: "reference_field".to_string(),
                        field_type: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U32)),
                    },
                ],
            }),
        },
        // Array with layout cycle (layout violation)
        TypeDef {
            name: "ProblematicArray".to_string(),
            kind: TypeKind::Array(ArrayType {
                container_attributes: Default::default(),
                // Layout cycle: references field in struct that contains this array
                size: ExprKind::FieldRef(FieldRefExpr {
                    path: vec!["BadStruct".to_string(), "reference_field".to_string()],
                }),
                element_type: Box::new(TypeKind::Primitive(PrimitiveType::Integral(
                    IntegralType::U8,
                ))),
            }),
        },
        // Enum with duplicate variants and layout cycle
        TypeDef {
            name: "ProblematicEnum".to_string(),
            kind: TypeKind::Enum(EnumType {
                container_attributes: Default::default(),
                // Layout cycle: references field in struct affected by this enum
                tag_ref: ExprKind::FieldRef(FieldRefExpr {
                    path: vec!["BadStruct".to_string(), "reference_field".to_string()],
                }),
                variants: vec![
                    EnumVariant {
                        name: "duplicate".to_string(),
                        tag_value: 1,
                        variant_type: TypeKind::Primitive(PrimitiveType::Integral(
                            IntegralType::U32,
                        )),
                    },
                    EnumVariant {
                        name: "duplicate".to_string(), // Duplicate variant name!
                        tag_value: 1,                  // Duplicate tag value!
                        variant_type: TypeKind::Primitive(PrimitiveType::Integral(
                            IntegralType::U8,
                        )),
                    },
                ],
            }),
        },
        // Valid struct (should pass all checks)
        TypeDef {
            name: "ValidStruct".to_string(),
            kind: TypeKind::Struct(StructType {
                container_attributes: Default::default(),
                fields: vec![
                    StructField {
                        name: "field1".to_string(),
                        field_type: TypeKind::TypeRef(TypeRefType {
                            name: "BaseType".to_string(),
                            comment: None,
                        }),
                    },
                    StructField {
                        name: "field2".to_string(),
                        field_type: TypeKind::Array(ArrayType {
                            container_attributes: Default::default(),
                            size: ExprKind::Literal(LiteralExpr::U64(10)), // Constant size - valid
                            element_type: Box::new(TypeKind::Primitive(PrimitiveType::Integral(
                                IntegralType::U8,
                            ))),
                        }),
                    },
                ],
            }),
        },
    ];

    let mut analyzer = DependencyAnalyzer::new();
    let analysis = analyzer.analyze_multiple_typedefs(&typedefs);

    // Should detect all types of violations
    assert!(
        !analysis.validation_errors.is_empty(),
        "Should have validation errors"
    );
    assert!(
        !analysis.layout_violations.is_empty(),
        "Should have layout violations"
    );

    // Check specific validation errors
    let validation_error_types: HashSet<String> = analysis
        .validation_errors
        .iter()
        .map(|e| e.error_type.clone())
        .collect();

    assert!(validation_error_types.contains("DuplicateTypeName"));
    assert!(validation_error_types.contains("DuplicateFieldName"));
    assert!(validation_error_types.contains("DuplicateVariantName"));
    assert!(validation_error_types.contains("DuplicateTagValue"));

    // Check layout violations
    let layout_violating_types: HashSet<String> = analysis
        .layout_violations
        .iter()
        .map(|v| v.violating_type.clone())
        .collect();

    assert!(layout_violating_types.contains("ProblematicArray"));
    assert!(layout_violating_types.contains("ProblematicEnum"));

    // Should still build dependency graph despite errors
    assert!(!analysis.graph.nodes.is_empty());
    assert!(!analysis.graph.edges.is_empty());

    // Error reporting should be comprehensive
    for error in &analysis.validation_errors {
        assert!(!error.reason.is_empty());
        assert!(!error.violating_type.is_empty());
        assert!(!error.duplicate_name.is_empty());
    }

    for violation in &analysis.layout_violations {
        assert!(!violation.reason.is_empty());
        assert!(!violation.violating_type.is_empty());
        assert!(!violation.violating_expression.is_empty());
    }
}
