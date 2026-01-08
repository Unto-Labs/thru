use super::*;
use crate::abi::expr::*;
use crate::abi::types::*;

#[cfg(test)]
mod dependency_tests {
    use super::*;

    fn create_literal_expr(value: u64) -> ExprKind {
        ExprKind::Literal(LiteralExpr::U64(value))
    }

    fn create_field_ref_expr(path: Vec<&str>) -> ExprKind {
        ExprKind::FieldRef(FieldRefExpr {
            path: path.into_iter().map(|s| s.to_string()).collect(),
        })
    }

    fn create_u32_primitive() -> TypeKind {
        TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U32))
    }

    fn create_u8_primitive() -> TypeKind {
        TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U8))
    }

    fn create_type_ref(name: &str) -> TypeKind {
        TypeKind::TypeRef(TypeRefType {
            name: name.to_string(),
            comment: None,
        })
    }

    #[test]
    fn test_simple_type_dependency() {
        let mut analyzer = DependencyAnalyzer::new();

        let typedefs = vec![
            TypeDef {
                name: "BaseType".to_string(),
                kind: create_u32_primitive(),
            },
            TypeDef {
                name: "DerivedType".to_string(),
                kind: TypeKind::Struct(StructType {
                    container_attributes: Default::default(),
                    fields: vec![StructField {
                        name: "base_field".to_string(),
                        field_type: create_type_ref("BaseType"),
                    }],
                }),
            },
        ];

        let analysis = analyzer.analyze_multiple_typedefs(&typedefs);

        assert!(analysis.cycles.is_empty());
        assert!(analysis.topological_order.is_some());
        assert!(analysis.layout_violations.is_empty());

        let topo_order = analysis.topological_order.unwrap();
        let base_pos = topo_order.iter().position(|x| x == "BaseType").unwrap();
        let derived_pos = topo_order.iter().position(|x| x == "DerivedType").unwrap();
        assert!(base_pos < derived_pos);
    }

    #[test]
    fn test_circular_type_dependency() {
        let mut analyzer = DependencyAnalyzer::new();

        let typedefs = vec![
            TypeDef {
                name: "TypeA".to_string(),
                kind: TypeKind::Struct(StructType {
                    container_attributes: Default::default(),
                    fields: vec![StructField {
                        name: "field_b".to_string(),
                        field_type: create_type_ref("TypeB"),
                    }],
                }),
            },
            TypeDef {
                name: "TypeB".to_string(),
                kind: TypeKind::Struct(StructType {
                    container_attributes: Default::default(),
                    fields: vec![StructField {
                        name: "field_a".to_string(),
                        field_type: create_type_ref("TypeA"),
                    }],
                }),
            },
        ];

        let analysis = analyzer.analyze_multiple_typedefs(&typedefs);

        assert!(!analysis.cycles.is_empty());
        assert!(analysis.topological_order.is_none());

        let cycle = &analysis.cycles[0];
        assert!(cycle.cycle.contains(&"TypeA".to_string()));
        assert!(cycle.cycle.contains(&"TypeB".to_string()));
    }

    #[test]
    fn test_valid_enum_with_constant_tag() {
        let mut analyzer = DependencyAnalyzer::new();

        let typedefs = vec![TypeDef {
            name: "MyEnum".to_string(),
            kind: TypeKind::Enum(EnumType {
                container_attributes: Default::default(),
                tag_ref: create_literal_expr(42), // Constant tag - valid
                variants: vec![EnumVariant {
                    name: "Variant1".to_string(),
                    tag_value: 1,
                    variant_type: create_u32_primitive(),
                }],
            }),
        }];

        let analysis = analyzer.analyze_multiple_typedefs(&typedefs);

        assert!(analysis.cycles.is_empty());
        assert!(analysis.layout_violations.is_empty());
    }

    #[test]
    fn test_invalid_enum_tag_layout_cycle() {
        let mut analyzer = DependencyAnalyzer::new();

        let typedefs = vec![
            TypeDef {
                name: "Container".to_string(),
                kind: TypeKind::Struct(StructType {
                    container_attributes: Default::default(),
                    fields: vec![
                        StructField {
                            name: "my_enum".to_string(),
                            field_type: create_type_ref("MyEnum"),
                        },
                        StructField {
                            name: "other_field".to_string(),
                            field_type: create_u32_primitive(),
                        },
                    ],
                }),
            },
            TypeDef {
                name: "MyEnum".to_string(),
                kind: TypeKind::Enum(EnumType {
                    container_attributes: Default::default(),
                    // Invalid: tag references a field whose offset depends on this enum's size
                    tag_ref: create_field_ref_expr(vec!["Container", "other_field"]),
                    variants: vec![EnumVariant {
                        name: "Variant1".to_string(),
                        tag_value: 1,
                        variant_type: create_u32_primitive(),
                    }],
                }),
            },
        ];

        let analysis = analyzer.analyze_multiple_typedefs(&typedefs);

        println!("Layout violations: {}", analysis.layout_violations.len());
        for violation in &analysis.layout_violations {
            println!("  {}: {}", violation.violating_type, violation.reason);
        }

        assert!(!analysis.layout_violations.is_empty());
        let violation = &analysis.layout_violations[0];
        // The violation can be attributed to either MyEnum or Container since it's a cycle
        assert!(violation.violating_type == "MyEnum" || violation.violating_type == "Container");
        // The violation can be detected as either a layout cycle or forward dependency
        assert!(
            violation.reason.contains("layout cycle")
                || violation.reason.contains("creating a layout cycle")
                || violation.reason.contains("forward dependency")
        );
    }

    #[test]
    fn test_valid_array_with_constant_size() {
        let mut analyzer = DependencyAnalyzer::new();

        let typedefs = vec![TypeDef {
            name: "MyArray".to_string(),
            kind: TypeKind::Array(ArrayType {
                container_attributes: Default::default(),
                size: create_literal_expr(10), // Constant size - valid
                element_type: Box::new(create_u8_primitive()),
                jagged: false,
            }),
        }];

        let analysis = analyzer.analyze_multiple_typedefs(&typedefs);

        assert!(analysis.cycles.is_empty());
        assert!(analysis.layout_violations.is_empty());
    }

    #[test]
    fn test_invalid_array_size_layout_cycle() {
        let mut analyzer = DependencyAnalyzer::new();

        let typedefs = vec![
            TypeDef {
                name: "Container".to_string(),
                kind: TypeKind::Struct(StructType {
                    container_attributes: Default::default(),
                    fields: vec![
                        StructField {
                            name: "dynamic_array".to_string(),
                            field_type: create_type_ref("MyArray"),
                        },
                        StructField {
                            name: "size_field".to_string(),
                            field_type: create_u32_primitive(),
                        },
                    ],
                }),
            },
            TypeDef {
                name: "MyArray".to_string(),
                kind: TypeKind::Array(ArrayType {
                    container_attributes: Default::default(),
                    // Invalid: size references a field whose offset depends on this array's size
                    size: create_field_ref_expr(vec!["Container", "size_field"]),
                    element_type: Box::new(create_u8_primitive()),
                    jagged: false,
                }),
            },
        ];

        let analysis = analyzer.analyze_multiple_typedefs(&typedefs);

        assert!(!analysis.layout_violations.is_empty());
        let violation = &analysis.layout_violations[0];
        // The violation can be attributed to either MyArray or Container since it's a cycle
        assert!(violation.violating_type == "MyArray" || violation.violating_type == "Container");
        // The violation can be detected as either a layout cycle or forward dependency
        assert!(
            violation.reason.contains("layout cycle")
                || violation.reason.contains("creating a layout cycle")
                || violation.reason.contains("forward dependency")
        );
    }

    #[test]
    fn test_forward_field_reference_violation() {
        let mut analyzer = DependencyAnalyzer::new();

        let typedefs = vec![
            TypeDef {
                name: "BadStruct".to_string(),
                kind: TypeKind::Struct(StructType {
                    container_attributes: Default::default(),
                    fields: vec![
                        StructField {
                            name: "early_field".to_string(),
                            field_type: create_type_ref("ArrayWithForwardRef"),
                        },
                        StructField {
                            name: "middle_field".to_string(),
                            field_type: create_u32_primitive(),
                        },
                        StructField {
                            name: "late_field".to_string(),
                            field_type: create_u32_primitive(),
                        },
                    ],
                }),
            },
            TypeDef {
                name: "ArrayWithForwardRef".to_string(),
                kind: TypeKind::Array(ArrayType {
                    container_attributes: Default::default(),
                    // Invalid: references a field that comes later in the same struct
                    size: create_field_ref_expr(vec!["BadStruct", "late_field"]),
                    element_type: Box::new(create_u8_primitive()),
                    jagged: false,
                }),
            },
        ];

        let analysis = analyzer.analyze_multiple_typedefs(&typedefs);

        assert!(!analysis.layout_violations.is_empty());
        let violation = &analysis.layout_violations[0];
        assert_eq!(violation.violating_type, "BadStruct");
        assert!(violation.reason.contains("forward dependency"));
    }

    #[test]
    fn test_complex_expression_dependencies() {
        let mut analyzer = DependencyAnalyzer::new();

        let typedefs = vec![
            TypeDef {
                name: "ComplexEnum".to_string(),
                kind: TypeKind::Enum(EnumType {
                    container_attributes: Default::default(),
                    // Complex expression with multiple field references
                    tag_ref: ExprKind::Add(AddExpr {
                        left: Box::new(create_field_ref_expr(vec!["SomeStruct", "field1"])),
                        right: Box::new(ExprKind::Mul(MulExpr {
                            left: Box::new(create_field_ref_expr(vec!["SomeStruct", "field2"])),
                            right: Box::new(create_literal_expr(2)),
                        })),
                    }),
                    variants: vec![EnumVariant {
                        name: "Variant1".to_string(),
                        tag_value: 1,
                        variant_type: create_u32_primitive(),
                    }],
                }),
            },
            TypeDef {
                name: "SomeStruct".to_string(),
                kind: TypeKind::Struct(StructType {
                    container_attributes: Default::default(),
                    fields: vec![
                        StructField {
                            name: "field1".to_string(),
                            field_type: create_u32_primitive(),
                        },
                        StructField {
                            name: "field2".to_string(),
                            field_type: create_u32_primitive(),
                        },
                    ],
                }),
            },
        ];

        let analysis = analyzer.analyze_multiple_typedefs(&typedefs);

        // Should detect dependencies to both field1 and field2
        let enum_deps = analysis
            .graph
            .edges
            .iter()
            .filter(|dep| dep.from == "ComplexEnum")
            .collect::<Vec<_>>();

        assert!(enum_deps.len() >= 2);
        assert!(enum_deps.iter().any(|dep| dep.to.contains("field1")));
        assert!(enum_deps.iter().any(|dep| dep.to.contains("field2")));
    }

    #[test]
    fn test_sizeof_and_alignof_dependencies() {
        let mut analyzer = DependencyAnalyzer::new();

        let typedefs = vec![
            TypeDef {
                name: "ArrayWithSizeof".to_string(),
                kind: TypeKind::Array(ArrayType {
                    container_attributes: Default::default(),
                    size: ExprKind::Sizeof(SizeofExpr {
                        type_name: "SomeType".to_string(),
                    }),
                    element_type: Box::new(create_u8_primitive()),
                    jagged: false,
                }),
            },
            TypeDef {
                name: "SomeType".to_string(),
                kind: create_u32_primitive(),
            },
        ];

        let analysis = analyzer.analyze_multiple_typedefs(&typedefs);

        assert!(analysis.cycles.is_empty());
        assert!(analysis.layout_violations.is_empty());

        // Should have a dependency from ArrayWithSizeof to SomeType
        let sizeof_deps = analysis
            .graph
            .edges
            .iter()
            .filter(|dep| dep.from == "ArrayWithSizeof" && dep.to == "SomeType")
            .collect::<Vec<_>>();

        assert_eq!(sizeof_deps.len(), 1);
        assert_eq!(sizeof_deps[0].kind, DependencyKind::TypeReference);
    }

    #[test]
    fn test_union_dependencies() {
        let mut analyzer = DependencyAnalyzer::new();

        let typedefs = vec![
            TypeDef {
                name: "MyUnion".to_string(),
                kind: TypeKind::Union(UnionType {
                    container_attributes: Default::default(),
                    variants: vec![
                        UnionVariant {
                            name: "variant1".to_string(),
                            variant_type: create_type_ref("TypeA"),
                        },
                        UnionVariant {
                            name: "variant2".to_string(),
                            variant_type: create_type_ref("TypeB"),
                        },
                    ],
                }),
            },
            TypeDef {
                name: "TypeA".to_string(),
                kind: create_u32_primitive(),
            },
            TypeDef {
                name: "TypeB".to_string(),
                kind: create_u8_primitive(),
            },
        ];

        let analysis = analyzer.analyze_multiple_typedefs(&typedefs);

        assert!(analysis.cycles.is_empty());
        assert!(analysis.layout_violations.is_empty());

        // Should have dependencies from MyUnion to both TypeA and TypeB
        let union_deps = analysis
            .graph
            .edges
            .iter()
            .filter(|dep| dep.from == "MyUnion")
            .collect::<Vec<_>>();

        assert_eq!(union_deps.len(), 2);
        assert!(union_deps.iter().any(|dep| dep.to == "TypeA"));
        assert!(union_deps.iter().any(|dep| dep.to == "TypeB"));
    }

    #[test]
    fn test_packed_struct_analysis() {
        let mut analyzer = DependencyAnalyzer::new();

        let typedefs = vec![TypeDef {
            name: "PackedStruct".to_string(),
            kind: TypeKind::Struct(StructType {
                container_attributes: ContainerAttributes {
                    packed: true,
                    aligned: 0,
                    comment: None,
                },
                fields: vec![
                    StructField {
                        name: "field1".to_string(),
                        field_type: create_u8_primitive(),
                    },
                    StructField {
                        name: "field2".to_string(),
                        field_type: create_u32_primitive(),
                    },
                ],
            }),
        }];

        let analysis = analyzer.analyze_multiple_typedefs(&typedefs);

        assert!(analysis.cycles.is_empty());
        assert!(analysis.layout_violations.is_empty());
    }

    #[test]
    fn test_aligned_struct_analysis() {
        let mut analyzer = DependencyAnalyzer::new();

        let typedefs = vec![TypeDef {
            name: "AlignedStruct".to_string(),
            kind: TypeKind::Struct(StructType {
                container_attributes: ContainerAttributes {
                    packed: false,
                    aligned: 16,
                    comment: Some("16-byte aligned".to_string()),
                },
                fields: vec![StructField {
                    name: "field1".to_string(),
                    field_type: create_u32_primitive(),
                }],
            }),
        }];

        let analysis = analyzer.analyze_multiple_typedefs(&typedefs);

        assert!(analysis.cycles.is_empty());
        assert!(analysis.layout_violations.is_empty());
    }

    #[test]
    fn test_deeply_nested_type_cycle() {
        let mut analyzer = DependencyAnalyzer::new();

        let typedefs = vec![
            TypeDef {
                name: "TypeA".to_string(),
                kind: TypeKind::Struct(StructType {
                    container_attributes: Default::default(),
                    fields: vec![StructField {
                        name: "field_b".to_string(),
                        field_type: create_type_ref("TypeB"),
                    }],
                }),
            },
            TypeDef {
                name: "TypeB".to_string(),
                kind: TypeKind::Struct(StructType {
                    container_attributes: Default::default(),
                    fields: vec![StructField {
                        name: "field_c".to_string(),
                        field_type: create_type_ref("TypeC"),
                    }],
                }),
            },
            TypeDef {
                name: "TypeC".to_string(),
                kind: TypeKind::Struct(StructType {
                    container_attributes: Default::default(),
                    fields: vec![StructField {
                        name: "field_a".to_string(),
                        field_type: create_type_ref("TypeA"), // Back to TypeA - creates cycle
                    }],
                }),
            },
        ];

        let analysis = analyzer.analyze_multiple_typedefs(&typedefs);

        assert!(!analysis.cycles.is_empty());
        assert!(analysis.topological_order.is_none());

        let cycle = &analysis.cycles[0];
        assert_eq!(cycle.cycle.len(), 4); // Type cycle with starting type repeated
        // The cycle can start from any type in the cycle, so just check it's a valid cycle
        assert_eq!(cycle.cycle[0], cycle.cycle[3]); // First and last should be the same
        // All three types should be present in the cycle
        let cycle_types: std::collections::HashSet<&String> = cycle.cycle.iter().collect();
        assert!(cycle_types.contains(&"TypeA".to_string()));
        assert!(cycle_types.contains(&"TypeB".to_string()));
        assert!(cycle_types.contains(&"TypeC".to_string()));
    }

    #[test]
    fn test_transitive_layout_dependency_violation() {
        let mut analyzer = DependencyAnalyzer::new();

        let typedefs = vec![
            // Container holds TypeA and TypeB
            TypeDef {
                name: "Container".to_string(),
                kind: TypeKind::Struct(StructType {
                    container_attributes: Default::default(),
                    fields: vec![
                        StructField {
                            name: "type_a".to_string(),
                            field_type: create_type_ref("TypeA"),
                        },
                        StructField {
                            name: "type_b".to_string(),
                            field_type: create_type_ref("TypeB"),
                        },
                        StructField {
                            name: "reference_field".to_string(),
                            field_type: create_u32_primitive(),
                        },
                    ],
                }),
            },
            // TypeA contains an array whose size affects Container layout
            TypeDef {
                name: "TypeA".to_string(),
                kind: TypeKind::Struct(StructType {
                    container_attributes: Default::default(),
                    fields: vec![StructField {
                        name: "dynamic_array".to_string(),
                        field_type: create_type_ref("DynamicArray"),
                    }],
                }),
            },
            // DynamicArray's size depends on a field in Container
            TypeDef {
                name: "DynamicArray".to_string(),
                kind: TypeKind::Array(ArrayType {
                    container_attributes: Default::default(),
                    // This creates a transitive dependency: Container -> TypeA -> DynamicArray -> Container
                    size: create_field_ref_expr(vec!["Container", "reference_field"]),
                    element_type: Box::new(create_u8_primitive()),
                    jagged: false,
                }),
            },
            // TypeB is independent
            TypeDef {
                name: "TypeB".to_string(),
                kind: create_u32_primitive(),
            },
        ];

        let analysis = analyzer.analyze_multiple_typedefs(&typedefs);

        assert!(!analysis.layout_violations.is_empty());

        let violations: Vec<_> = analysis
            .layout_violations
            .iter()
            .filter(|v| v.violating_type == "DynamicArray")
            .collect();

        assert!(!violations.is_empty());
        let violation = violations[0];
        assert!(violation.reason.contains("transitive"));
    }

    #[test]
    fn test_multiple_field_references_in_expression() {
        let mut analyzer = DependencyAnalyzer::new();

        let typedefs = vec![
            TypeDef {
                name: "ComplexArray".to_string(),
                kind: TypeKind::Array(ArrayType {
                    container_attributes: Default::default(),
                    // Expression references multiple fields
                    size: ExprKind::Add(AddExpr {
                        left: Box::new(create_field_ref_expr(vec!["DataStruct", "size1"])),
                        right: Box::new(ExprKind::Sub(SubExpr {
                            left: Box::new(create_field_ref_expr(vec!["DataStruct", "size2"])),
                            right: Box::new(create_literal_expr(5)),
                        })),
                    }),
                    element_type: Box::new(create_u8_primitive()),
                    jagged: false,
                }),
            },
            TypeDef {
                name: "DataStruct".to_string(),
                kind: TypeKind::Struct(StructType {
                    container_attributes: Default::default(),
                    fields: vec![
                        StructField {
                            name: "size1".to_string(),
                            field_type: create_u32_primitive(),
                        },
                        StructField {
                            name: "size2".to_string(),
                            field_type: create_u32_primitive(),
                        },
                    ],
                }),
            },
        ];

        let analysis = analyzer.analyze_multiple_typedefs(&typedefs);

        // Should detect multiple field reference dependencies
        let array_deps = analysis
            .graph
            .edges
            .iter()
            .filter(|dep| dep.from == "ComplexArray")
            .collect::<Vec<_>>();

        assert!(array_deps.len() >= 2);

        // Check that both size1 and size2 are referenced
        let dep_targets: Vec<&String> = array_deps.iter().map(|dep| &dep.to).collect();
        assert!(dep_targets.iter().any(|target| target.contains("size1")));
        assert!(dep_targets.iter().any(|target| target.contains("size2")));
    }

    #[test]
    fn test_array_with_non_constant_element_type() {
        let mut analyzer = DependencyAnalyzer::new();

        let typedefs = vec![
            TypeDef {
                name: "BadArray".to_string(),
                kind: TypeKind::Array(ArrayType {
                    container_attributes: Default::default(),
                    size: create_literal_expr(10), // Constant size
                    element_type: Box::new(create_type_ref("DynamicStruct")), // Non-constant element type
                    jagged: false,
                }),
            },
            TypeDef {
                name: "DynamicStruct".to_string(),
                kind: TypeKind::Struct(StructType {
                    container_attributes: Default::default(),
                    fields: vec![StructField {
                        name: "dynamic_array".to_string(),
                        field_type: TypeKind::Array(ArrayType {
                            container_attributes: Default::default(),
                            size: create_field_ref_expr(vec!["some_field"]), // Non-constant size
                            element_type: Box::new(create_u8_primitive()),
                            jagged: false,
                        }),
                    }],
                }),
            },
        ];

        let analysis = analyzer.analyze_multiple_typedefs(&typedefs);

        // Should detect layout violation due to non-constant element type size
        assert!(!analysis.layout_violations.is_empty());
        let violation = analysis
            .layout_violations
            .iter()
            .find(|v| v.violating_type == "BadArray")
            .expect("Should find violation for BadArray");

        assert!(
            violation
                .reason
                .contains("element type with non-constant size")
        );
        assert!(
            violation
                .violating_expression
                .contains("array element type")
        );
    }

    #[test]
    fn test_array_with_deeply_nested_non_constant_element_type() {
        let mut analyzer = DependencyAnalyzer::new();

        let typedefs = vec![
            TypeDef {
                name: "DeepArray".to_string(),
                kind: TypeKind::Array(ArrayType {
                    container_attributes: Default::default(),
                    size: create_literal_expr(5), // Constant size
                    element_type: Box::new(create_type_ref("WrapperStruct")), // Element type that contains non-constant nested type
                    jagged: false,
                }),
            },
            TypeDef {
                name: "WrapperStruct".to_string(),
                kind: TypeKind::Struct(StructType {
                    container_attributes: Default::default(),
                    fields: vec![
                        StructField {
                            name: "constant_field".to_string(),
                            field_type: create_u32_primitive(), // This field is constant
                        },
                        StructField {
                            name: "enum_field".to_string(),
                            field_type: create_type_ref("DynamicEnum"), // This makes the whole struct non-constant
                        },
                    ],
                }),
            },
            TypeDef {
                name: "DynamicEnum".to_string(),
                kind: TypeKind::Enum(EnumType {
                    container_attributes: Default::default(),
                    // Non-constant tag makes this enum's size non-constant
                    tag_ref: create_field_ref_expr(vec!["some_external_field"]),
                    variants: vec![
                        EnumVariant {
                            name: "Variant1".to_string(),
                            tag_value: 1,
                            variant_type: create_u32_primitive(),
                        },
                        EnumVariant {
                            name: "Variant2".to_string(),
                            tag_value: 2,
                            variant_type: create_u64_primitive(), // Different sizes
                        },
                    ],
                }),
            },
        ];

        let analysis = analyzer.analyze_multiple_typedefs(&typedefs);

        // Should detect layout violation due to deeply nested non-constant element type
        assert!(!analysis.layout_violations.is_empty());
        let violation = analysis
            .layout_violations
            .iter()
            .find(|v| v.violating_type == "DeepArray")
            .expect("Should find violation for DeepArray");

        assert!(
            violation
                .reason
                .contains("element type with non-constant size")
        );
    }

    #[test]
    fn test_shift_operations_in_expressions() {
        let mut analyzer = DependencyAnalyzer::new();

        let typedefs = vec![
            TypeDef {
                name: "ShiftArray".to_string(),
                kind: TypeKind::Array(ArrayType {
                    container_attributes: Default::default(),
                    // Array size using shift operations: (base_size << shift_amount) >> 1
                    size: ExprKind::RightShift(RightShiftExpr {
                        left: Box::new(ExprKind::LeftShift(LeftShiftExpr {
                            left: Box::new(create_field_ref_expr(vec![
                                "ConfigStruct",
                                "base_size",
                            ])),
                            right: Box::new(create_field_ref_expr(vec![
                                "ConfigStruct",
                                "shift_amount",
                            ])),
                        })),
                        right: Box::new(create_literal_expr(1)),
                    }),
                    element_type: Box::new(create_u8_primitive()),
                    jagged: false,
                }),
            },
            TypeDef {
                name: "ConfigStruct".to_string(),
                kind: TypeKind::Struct(StructType {
                    container_attributes: Default::default(),
                    fields: vec![
                        StructField {
                            name: "base_size".to_string(),
                            field_type: create_u32_primitive(),
                        },
                        StructField {
                            name: "shift_amount".to_string(),
                            field_type: create_u32_primitive(),
                        },
                    ],
                }),
            },
        ];

        let analysis = analyzer.analyze_multiple_typedefs(&typedefs);

        assert!(analysis.cycles.is_empty());
        assert!(analysis.layout_violations.is_empty());

        // Should detect field reference dependencies from shift operations
        let array_deps = analysis
            .graph
            .edges
            .iter()
            .filter(|dep| dep.from == "ShiftArray")
            .collect::<Vec<_>>();

        assert!(array_deps.len() >= 2);

        // Check that both base_size and shift_amount are referenced
        let dep_targets: Vec<&String> = array_deps.iter().map(|dep| &dep.to).collect();
        assert!(
            dep_targets
                .iter()
                .any(|target| target.contains("base_size"))
        );
        assert!(
            dep_targets
                .iter()
                .any(|target| target.contains("shift_amount"))
        );
    }

    #[test]
    fn test_empty_typedefs() {
        let mut analyzer = DependencyAnalyzer::new();
        let analysis = analyzer.analyze_multiple_typedefs(&[]);

        assert!(analysis.cycles.is_empty());
        assert!(analysis.layout_violations.is_empty());
        assert_eq!(analysis.topological_order, Some(vec![]));
    }

    #[test]
    fn test_single_primitive_typedef() {
        let mut analyzer = DependencyAnalyzer::new();

        let typedefs = vec![TypeDef {
            name: "MyU32".to_string(),
            kind: create_u32_primitive(),
        }];

        let analysis = analyzer.analyze_multiple_typedefs(&typedefs);

        assert!(analysis.cycles.is_empty());
        assert!(analysis.layout_violations.is_empty());
        assert_eq!(analysis.topological_order, Some(vec!["MyU32".to_string()]));
    }

    #[test]
    fn test_constant_expression_analysis() {
        let literal_expr = create_literal_expr(42);
        assert!(literal_expr.is_constant());

        let field_ref_expr = create_field_ref_expr(vec!["field"]);
        assert!(!field_ref_expr.is_constant());

        let sizeof_expr = ExprKind::Sizeof(SizeofExpr {
            type_name: "SomeType".to_string(),
        });
        assert!(sizeof_expr.is_constant());

        let mixed_expr = ExprKind::Add(AddExpr {
            left: Box::new(literal_expr),
            right: Box::new(field_ref_expr),
        });
        assert!(!mixed_expr.is_constant());

        let const_expr = ExprKind::Mul(MulExpr {
            left: Box::new(create_literal_expr(10)),
            right: Box::new(create_literal_expr(20)),
        });
        assert!(const_expr.is_constant());

        // Test shift operations
        let left_shift_expr = ExprKind::LeftShift(LeftShiftExpr {
            left: Box::new(create_literal_expr(4)),
            right: Box::new(create_literal_expr(2)),
        });
        assert!(left_shift_expr.is_constant());

        let right_shift_expr = ExprKind::RightShift(RightShiftExpr {
            left: Box::new(create_literal_expr(16)),
            right: Box::new(create_literal_expr(2)),
        });
        assert!(right_shift_expr.is_constant());

        let mixed_shift_expr = ExprKind::LeftShift(LeftShiftExpr {
            left: Box::new(create_literal_expr(8)),
            right: Box::new(create_field_ref_expr(vec!["shift_amount"])),
        });
        assert!(!mixed_shift_expr.is_constant());

        // Test popcount operations
        let popcount_const_expr = ExprKind::Popcount(PopcountExpr {
            operand: Box::new(create_literal_expr(15)), // 15 = 0b1111, popcount = 4
        });
        assert!(popcount_const_expr.is_constant());

        let popcount_non_const_expr = ExprKind::Popcount(PopcountExpr {
            operand: Box::new(create_field_ref_expr(vec!["some_field"])),
        });
        assert!(!popcount_non_const_expr.is_constant());
    }

    #[test]
    fn test_duplicate_type_names() {
        let mut analyzer = DependencyAnalyzer::new();

        let typedefs = vec![
            TypeDef {
                name: "DuplicateName".to_string(),
                kind: create_u32_primitive(),
            },
            TypeDef {
                name: "DuplicateName".to_string(), // Duplicate!
                kind: create_u8_primitive(),
            },
        ];

        let analysis = analyzer.analyze_multiple_typedefs(&typedefs);

        assert!(!analysis.validation_errors.is_empty());
        let duplicate_error = analysis
            .validation_errors
            .iter()
            .find(|e| e.error_type == "DuplicateTypeName")
            .expect("Should find duplicate type name error");

        assert_eq!(duplicate_error.violating_type, "DuplicateName");
        assert_eq!(duplicate_error.duplicate_name, "DuplicateName");
    }

    #[test]
    fn test_duplicate_struct_field_names() {
        let mut analyzer = DependencyAnalyzer::new();

        let typedefs = vec![TypeDef {
            name: "BadStruct".to_string(),
            kind: TypeKind::Struct(StructType {
                container_attributes: Default::default(),
                fields: vec![
                    StructField {
                        name: "duplicate_field".to_string(),
                        field_type: create_u32_primitive(),
                    },
                    StructField {
                        name: "duplicate_field".to_string(), // Duplicate!
                        field_type: create_u8_primitive(),
                    },
                    StructField {
                        name: "unique_field".to_string(),
                        field_type: create_u32_primitive(),
                    },
                ],
            }),
        }];

        let analysis = analyzer.analyze_multiple_typedefs(&typedefs);

        assert!(!analysis.validation_errors.is_empty());
        let duplicate_error = analysis
            .validation_errors
            .iter()
            .find(|e| e.error_type == "DuplicateFieldName")
            .expect("Should find duplicate field name error");

        assert_eq!(duplicate_error.violating_type, "BadStruct");
        assert_eq!(duplicate_error.duplicate_name, "duplicate_field");
    }

    #[test]
    fn test_duplicate_union_variant_names() {
        let mut analyzer = DependencyAnalyzer::new();

        let typedefs = vec![TypeDef {
            name: "BadUnion".to_string(),
            kind: TypeKind::Union(UnionType {
                container_attributes: Default::default(),
                variants: vec![
                    UnionVariant {
                        name: "duplicate_variant".to_string(),
                        variant_type: create_u32_primitive(),
                    },
                    UnionVariant {
                        name: "duplicate_variant".to_string(), // Duplicate!
                        variant_type: create_u8_primitive(),
                    },
                ],
            }),
        }];

        let analysis = analyzer.analyze_multiple_typedefs(&typedefs);

        assert!(!analysis.validation_errors.is_empty());
        let duplicate_error = analysis
            .validation_errors
            .iter()
            .find(|e| e.error_type == "DuplicateVariantName")
            .expect("Should find duplicate variant name error");

        assert_eq!(duplicate_error.violating_type, "BadUnion");
        assert_eq!(duplicate_error.duplicate_name, "duplicate_variant");
    }

    #[test]
    fn test_duplicate_enum_variant_names() {
        let mut analyzer = DependencyAnalyzer::new();

        let typedefs = vec![TypeDef {
            name: "BadEnum".to_string(),
            kind: TypeKind::Enum(EnumType {
                container_attributes: Default::default(),
                tag_ref: create_literal_expr(0),
                variants: vec![
                    EnumVariant {
                        name: "duplicate_variant".to_string(),
                        tag_value: 1,
                        variant_type: create_u32_primitive(),
                    },
                    EnumVariant {
                        name: "duplicate_variant".to_string(), // Duplicate name!
                        tag_value: 2,
                        variant_type: create_u8_primitive(),
                    },
                ],
            }),
        }];

        let analysis = analyzer.analyze_multiple_typedefs(&typedefs);

        assert!(!analysis.validation_errors.is_empty());
        let duplicate_error = analysis
            .validation_errors
            .iter()
            .find(|e| e.error_type == "DuplicateVariantName")
            .expect("Should find duplicate variant name error");

        assert_eq!(duplicate_error.violating_type, "BadEnum");
        assert_eq!(duplicate_error.duplicate_name, "duplicate_variant");
    }

    #[test]
    fn test_duplicate_enum_tag_values() {
        let mut analyzer = DependencyAnalyzer::new();

        let typedefs = vec![TypeDef {
            name: "BadEnum".to_string(),
            kind: TypeKind::Enum(EnumType {
                container_attributes: Default::default(),
                tag_ref: create_literal_expr(0),
                variants: vec![
                    EnumVariant {
                        name: "variant1".to_string(),
                        tag_value: 1,
                        variant_type: create_u32_primitive(),
                    },
                    EnumVariant {
                        name: "variant2".to_string(),
                        tag_value: 1, // Duplicate tag value!
                        variant_type: create_u8_primitive(),
                    },
                ],
            }),
        }];

        let analysis = analyzer.analyze_multiple_typedefs(&typedefs);

        assert!(!analysis.validation_errors.is_empty());
        let duplicate_error = analysis
            .validation_errors
            .iter()
            .find(|e| e.error_type == "DuplicateTagValue")
            .expect("Should find duplicate tag value error");

        assert_eq!(duplicate_error.violating_type, "BadEnum");
        assert_eq!(duplicate_error.duplicate_name, "1");
    }

    #[test]
    fn test_multiple_validation_errors() {
        let mut analyzer = DependencyAnalyzer::new();

        let typedefs = vec![
            // Duplicate type names
            TypeDef {
                name: "DuplicateType".to_string(),
                kind: create_u32_primitive(),
            },
            TypeDef {
                name: "DuplicateType".to_string(),
                kind: create_u8_primitive(),
            },
            // Struct with duplicate fields
            TypeDef {
                name: "BadStruct".to_string(),
                kind: TypeKind::Struct(StructType {
                    container_attributes: Default::default(),
                    fields: vec![
                        StructField {
                            name: "bad_field".to_string(),
                            field_type: create_u32_primitive(),
                        },
                        StructField {
                            name: "bad_field".to_string(),
                            field_type: create_u8_primitive(),
                        },
                    ],
                }),
            },
            // Enum with duplicate variants and tag values
            TypeDef {
                name: "BadEnum".to_string(),
                kind: TypeKind::Enum(EnumType {
                    container_attributes: Default::default(),
                    tag_ref: create_literal_expr(0),
                    variants: vec![
                        EnumVariant {
                            name: "bad_variant".to_string(),
                            tag_value: 5,
                            variant_type: create_u32_primitive(),
                        },
                        EnumVariant {
                            name: "bad_variant".to_string(),
                            tag_value: 5,
                            variant_type: create_u8_primitive(),
                        },
                    ],
                }),
            },
        ];

        let analysis = analyzer.analyze_multiple_typedefs(&typedefs);

        // Should have multiple validation errors
        assert!(analysis.validation_errors.len() >= 4);

        // Check we have all expected error types
        let error_types: HashSet<String> = analysis
            .validation_errors
            .iter()
            .map(|e| e.error_type.clone())
            .collect();

        assert!(error_types.contains("DuplicateTypeName"));
        assert!(error_types.contains("DuplicateFieldName"));
        assert!(error_types.contains("DuplicateVariantName"));
        assert!(error_types.contains("DuplicateTagValue"));
    }

    #[test]
    fn test_valid_names_no_errors() {
        let mut analyzer = DependencyAnalyzer::new();

        let typedefs = vec![
            TypeDef {
                name: "ValidStruct".to_string(),
                kind: TypeKind::Struct(StructType {
                    container_attributes: Default::default(),
                    fields: vec![
                        StructField {
                            name: "field1".to_string(),
                            field_type: create_u32_primitive(),
                        },
                        StructField {
                            name: "field2".to_string(),
                            field_type: create_u8_primitive(),
                        },
                    ],
                }),
            },
            TypeDef {
                name: "ValidEnum".to_string(),
                kind: TypeKind::Enum(EnumType {
                    container_attributes: Default::default(),
                    tag_ref: create_literal_expr(0),
                    variants: vec![
                        EnumVariant {
                            name: "variant1".to_string(),
                            tag_value: 1,
                            variant_type: create_u32_primitive(),
                        },
                        EnumVariant {
                            name: "variant2".to_string(),
                            tag_value: 2,
                            variant_type: create_u8_primitive(),
                        },
                    ],
                }),
            },
            TypeDef {
                name: "ValidUnion".to_string(),
                kind: TypeKind::Union(UnionType {
                    container_attributes: Default::default(),
                    variants: vec![
                        UnionVariant {
                            name: "variant1".to_string(),
                            variant_type: create_u32_primitive(),
                        },
                        UnionVariant {
                            name: "variant2".to_string(),
                            variant_type: create_u8_primitive(),
                        },
                    ],
                }),
            },
        ];

        let analysis = analyzer.analyze_multiple_typedefs(&typedefs);

        // Should have no validation errors for valid definitions
        assert!(analysis.validation_errors.is_empty());
    }

    #[test]
    fn test_layout_dependency_chain_detection() {
        let mut analyzer = DependencyAnalyzer::new();

        // Create a complex dependency chain that should be detected
        let typedefs = vec![
            TypeDef {
                name: "RootStruct".to_string(),
                kind: TypeKind::Struct(StructType {
                    container_attributes: Default::default(),
                    fields: vec![
                        StructField {
                            name: "intermediate".to_string(),
                            field_type: create_type_ref("IntermediateStruct"),
                        },
                        StructField {
                            name: "target_field".to_string(),
                            field_type: create_u32_primitive(),
                        },
                    ],
                }),
            },
            TypeDef {
                name: "IntermediateStruct".to_string(),
                kind: TypeKind::Struct(StructType {
                    container_attributes: Default::default(),
                    fields: vec![StructField {
                        name: "problematic_array".to_string(),
                        field_type: create_type_ref("ProblematicArray"),
                    }],
                }),
            },
            TypeDef {
                name: "ProblematicArray".to_string(),
                kind: TypeKind::Array(ArrayType {
                    container_attributes: Default::default(),
                    // This creates a transitive dependency back to RootStruct
                    size: create_field_ref_expr(vec!["RootStruct", "target_field"]),
                    element_type: Box::new(create_u8_primitive()),
                    jagged: false,
                }),
            },
        ];

        let analysis = analyzer.analyze_multiple_typedefs(&typedefs);

        // Should detect the transitive layout dependency violation
        assert!(!analysis.layout_violations.is_empty());

        let violation = analysis
            .layout_violations
            .iter()
            .find(|v| v.violating_type == "ProblematicArray")
            .expect("Should find violation for ProblematicArray");

        assert!(violation.dependency_chain.len() > 1);
        assert!(violation.reason.contains("transitive"));
    }

    #[test]
    fn test_valid_enum_tag_after_enum_in_struct() {
        let mut analyzer = DependencyAnalyzer::new();

        // Create a scenario where an enum tag field comes after the enum field
        // This should be valid since the enum has constant-sized variants
        let typedefs = vec![
            TypeDef {
                name: "ValidStruct".to_string(),
                kind: TypeKind::Struct(StructType {
                    container_attributes: Default::default(),
                    fields: vec![
                        StructField {
                            name: "my_enum".to_string(),
                            field_type: create_type_ref("ConstantSizeEnum"),
                        },
                        StructField {
                            name: "tag_field".to_string(),
                            field_type: create_u32_primitive(),
                        },
                        StructField {
                            name: "other_data".to_string(),
                            field_type: create_u64_primitive(),
                        },
                    ],
                }),
            },
            TypeDef {
                name: "ConstantSizeEnum".to_string(),
                kind: TypeKind::Enum(EnumType {
                    container_attributes: Default::default(),
                    // Tag references a field that comes after the enum field
                    tag_ref: create_field_ref_expr(vec!["ValidStruct", "tag_field"]),
                    variants: vec![
                        EnumVariant {
                            name: "VariantA".to_string(),
                            tag_value: 1,
                            variant_type: create_u32_primitive(), // 4 bytes
                        },
                        EnumVariant {
                            name: "VariantB".to_string(),
                            tag_value: 2,
                            variant_type: create_u32_primitive(), // 4 bytes (same size)
                        },
                        EnumVariant {
                            name: "VariantC".to_string(),
                            tag_value: 3,
                            variant_type: create_u32_primitive(), // 4 bytes (same size)
                        },
                    ],
                }),
            },
        ];

        let analysis = analyzer.analyze_multiple_typedefs(&typedefs);

        // This should NOT create layout violations since:
        // 1. The enum has constant-sized variants (all u32)
        // 2. The enum's size is deterministic regardless of the tag value
        // 3. The tag field comes after the enum, so it doesn't affect the enum's offset
        assert!(
            analysis.layout_violations.is_empty(),
            "Should not have layout violations for enum with constant-sized variants referencing later tag field"
        );

        // Should have no cycles since this is a valid dependency pattern
        assert!(analysis.cycles.is_empty());

        // Should be able to compute topological order
        assert!(analysis.topological_order.is_some());

        // Should have normal type dependencies
        assert!(!analysis.graph.edges.is_empty());
    }

    fn create_u64_primitive() -> TypeKind {
        TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U64))
    }

    fn create_size_discriminated_union(
        _name: &str,
        variants: Vec<(&str, u64, TypeKind)>,
    ) -> TypeKind {
        TypeKind::SizeDiscriminatedUnion(SizeDiscriminatedUnionType {
            container_attributes: Default::default(),
            variants: variants
                .into_iter()
                .map(
                    |(variant_name, size, variant_type)| SizeDiscriminatedVariant {
                        name: variant_name.to_string(),
                        expected_size: size,
                        variant_type,
                    },
                )
                .collect(),
        })
    }

    #[test]
    fn test_valid_size_discriminated_union() {
        let mut analyzer = DependencyAnalyzer::new();

        // Create a valid size-discriminated union as the top-level type
        let typedefs = vec![TypeDef {
            name: "TokenAccountUnion".to_string(),
            kind: create_size_discriminated_union(
                "TokenAccountUnion",
                vec![
                    ("token_account", 165, create_u32_primitive()),
                    ("token_mint", 82, create_u64_primitive()),
                ],
            ),
        }];

        let analysis = analyzer.analyze_multiple_typedefs(&typedefs);

        assert!(analysis.cycles.is_empty());
        assert!(analysis.layout_violations.is_empty());
        assert!(analysis.validation_errors.is_empty());
    }

    #[test]
    fn test_size_discriminated_union_duplicate_sizes() {
        let mut analyzer = DependencyAnalyzer::new();

        // Size-discriminated union with duplicate sizes (should be a violation)
        let typedefs = vec![TypeDef {
            name: "BadUnion".to_string(),
            kind: create_size_discriminated_union(
                "BadUnion",
                vec![
                    ("variant1", 100, create_u32_primitive()),
                    ("variant2", 100, create_u64_primitive()), // Duplicate size!
                ],
            ),
        }];

        let analysis = analyzer.analyze_multiple_typedefs(&typedefs);

        assert!(!analysis.layout_violations.is_empty());
        let violation = &analysis.layout_violations[0];
        assert_eq!(violation.violating_type, "BadUnion");
        assert!(violation.reason.contains("same expected size"));
    }

    #[test]
    fn test_size_discriminated_union_insufficient_variants() {
        let mut analyzer = DependencyAnalyzer::new();

        // Size-discriminated union with only one variant
        let typedefs = vec![TypeDef {
            name: "SingleVariantUnion".to_string(),
            kind: create_size_discriminated_union(
                "SingleVariantUnion",
                vec![("only_variant", 100, create_u32_primitive())],
            ),
        }];

        let analysis = analyzer.analyze_multiple_typedefs(&typedefs);

        assert!(!analysis.layout_violations.is_empty());
        let violation = &analysis.layout_violations[0];
        assert_eq!(violation.violating_type, "SingleVariantUnion");
        assert!(violation.reason.contains("at least 2 variants"));
    }

    #[test]
    fn test_size_discriminated_union_as_sole_factor_in_struct() {
        let mut analyzer = DependencyAnalyzer::new();

        // Valid: size-discriminated union as the sole variable-size factor in a struct
        let typedefs = vec![
            TypeDef {
                name: "TokenAccountUnion".to_string(),
                kind: create_size_discriminated_union(
                    "TokenAccountUnion",
                    vec![
                        ("token_account", 165, create_u32_primitive()),
                        ("token_mint", 82, create_u64_primitive()),
                    ],
                ),
            },
            TypeDef {
                name: "ValidContainer".to_string(),
                kind: TypeKind::Struct(StructType {
                    container_attributes: Default::default(),
                    fields: vec![
                        StructField {
                            name: "fixed_header".to_string(),
                            field_type: create_u32_primitive(), // Fixed size
                        },
                        StructField {
                            name: "account_data".to_string(),
                            field_type: create_type_ref("TokenAccountUnion"), // Only variable factor
                        },
                    ],
                }),
            },
        ];

        let analysis = analyzer.analyze_multiple_typedefs(&typedefs);

        assert!(analysis.cycles.is_empty());
        assert!(analysis.layout_violations.is_empty());
    }

    #[test]
    fn test_size_discriminated_union_with_other_variable_factor() {
        let mut analyzer = DependencyAnalyzer::new();

        // Invalid: size-discriminated union with other variable-size components
        let typedefs = vec![
            TypeDef {
                name: "TokenAccountUnion".to_string(),
                kind: create_size_discriminated_union(
                    "TokenAccountUnion",
                    vec![
                        ("token_account", 165, create_u32_primitive()),
                        ("token_mint", 82, create_u64_primitive()),
                    ],
                ),
            },
            TypeDef {
                name: "InvalidContainer".to_string(),
                kind: TypeKind::Struct(StructType {
                    container_attributes: Default::default(),
                    fields: vec![
                        StructField {
                            name: "account_data".to_string(),
                            field_type: create_type_ref("TokenAccountUnion"),
                        },
                        StructField {
                            name: "dynamic_array".to_string(),
                            field_type: TypeKind::Array(ArrayType {
                                container_attributes: Default::default(),
                                size: create_field_ref_expr(vec!["some_field"]), // Non-constant size!
                                element_type: Box::new(create_u8_primitive()),
                                jagged: false,
                            }),
                        },
                    ],
                }),
            },
        ];

        let analysis = analyzer.analyze_multiple_typedefs(&typedefs);

        assert!(!analysis.layout_violations.is_empty());
        let violation = analysis
            .layout_violations
            .iter()
            .find(|v| v.violating_type == "InvalidContainer")
            .expect("Should find violation for InvalidContainer");
        assert!(violation.reason.contains("not the sole factor affecting"));
    }

    #[test]
    fn test_size_discriminated_union_in_array() {
        let mut analyzer = DependencyAnalyzer::new();

        // Invalid: size-discriminated union as array element
        let typedefs = vec![
            TypeDef {
                name: "TokenAccountUnion".to_string(),
                kind: create_size_discriminated_union(
                    "TokenAccountUnion",
                    vec![
                        ("token_account", 165, create_u32_primitive()),
                        ("token_mint", 82, create_u64_primitive()),
                    ],
                ),
            },
            TypeDef {
                name: "InvalidArray".to_string(),
                kind: TypeKind::Array(ArrayType {
                    container_attributes: Default::default(),
                    size: create_literal_expr(10),
                    element_type: Box::new(create_type_ref("TokenAccountUnion")), // Invalid!
                    jagged: false,
                }),
            },
        ];

        let analysis = analyzer.analyze_multiple_typedefs(&typedefs);

        assert!(!analysis.layout_violations.is_empty());
        let violation = analysis
            .layout_violations
            .iter()
            .find(|v| v.violating_type == "InvalidArray")
            .expect("Should find violation for InvalidArray");
        assert!(
            violation
                .reason
                .contains("Arrays cannot have elements with variable sizes")
        );
    }

    #[test]
    fn test_size_discriminated_union_in_regular_union() {
        let mut analyzer = DependencyAnalyzer::new();

        // Invalid: size-discriminated union inside regular union
        let typedefs = vec![
            TypeDef {
                name: "TokenAccountUnion".to_string(),
                kind: create_size_discriminated_union(
                    "TokenAccountUnion",
                    vec![
                        ("token_account", 165, create_u32_primitive()),
                        ("token_mint", 82, create_u64_primitive()),
                    ],
                ),
            },
            TypeDef {
                name: "InvalidRegularUnion".to_string(),
                kind: TypeKind::Union(UnionType {
                    container_attributes: Default::default(),
                    variants: vec![
                        UnionVariant {
                            name: "variant1".to_string(),
                            variant_type: create_u32_primitive(),
                        },
                        UnionVariant {
                            name: "variant2".to_string(),
                            variant_type: create_type_ref("TokenAccountUnion"), // Invalid!
                        },
                    ],
                }),
            },
        ];

        let analysis = analyzer.analyze_multiple_typedefs(&typedefs);

        assert!(!analysis.layout_violations.is_empty());
        let violation = analysis
            .layout_violations
            .iter()
            .find(|v| v.violating_type == "InvalidRegularUnion")
            .expect("Should find violation for InvalidRegularUnion");
        assert!(
            violation
                .reason
                .contains("unions/enums cannot contain size-discriminated unions")
        );
    }

    #[test]
    fn test_size_discriminated_union_via_typeref_propagation() {
        let mut analyzer = DependencyAnalyzer::new();

        // Test that constraints propagate through TypeRefs
        let typedefs = vec![
            TypeDef {
                name: "TokenAccountUnion".to_string(),
                kind: create_size_discriminated_union(
                    "TokenAccountUnion",
                    vec![
                        ("token_account", 165, create_u32_primitive()),
                        ("token_mint", 82, create_u64_primitive()),
                    ],
                ),
            },
            TypeDef {
                name: "WrapperType".to_string(),
                kind: create_type_ref("TokenAccountUnion"),
            },
            TypeDef {
                name: "InvalidContainer".to_string(),
                kind: TypeKind::Struct(StructType {
                    container_attributes: Default::default(),
                    fields: vec![
                        StructField {
                            name: "wrapper".to_string(),
                            field_type: create_type_ref("WrapperType"), // Points to size-disc union via TypeRef
                        },
                        StructField {
                            name: "other_var".to_string(),
                            field_type: TypeKind::Array(ArrayType {
                                container_attributes: Default::default(),
                                size: create_field_ref_expr(vec!["field"]), // Other variable component
                                element_type: Box::new(create_u8_primitive()),
                                jagged: false,
                            }),
                        },
                    ],
                }),
            },
        ];

        let analysis = analyzer.analyze_multiple_typedefs(&typedefs);

        assert!(!analysis.layout_violations.is_empty());
        let violation = analysis
            .layout_violations
            .iter()
            .find(|v| v.violating_type == "InvalidContainer")
            .expect("Should find violation for InvalidContainer");
        assert!(violation.reason.contains("not the sole factor affecting"));
    }

    #[test]
    fn test_size_discriminated_union_duplicate_variant_names() {
        let mut analyzer = DependencyAnalyzer::new();

        // Test duplicate variant names validation
        let typedefs = vec![TypeDef {
            name: "BadNamesUnion".to_string(),
            kind: TypeKind::SizeDiscriminatedUnion(SizeDiscriminatedUnionType {
                container_attributes: Default::default(),
                variants: vec![
                    SizeDiscriminatedVariant {
                        name: "duplicate_name".to_string(),
                        expected_size: 100,
                        variant_type: create_u32_primitive(),
                    },
                    SizeDiscriminatedVariant {
                        name: "duplicate_name".to_string(), // Duplicate!
                        expected_size: 200,
                        variant_type: create_u64_primitive(),
                    },
                ],
            }),
        }];

        let analysis = analyzer.analyze_multiple_typedefs(&typedefs);

        assert!(!analysis.validation_errors.is_empty());
        let error = analysis
            .validation_errors
            .iter()
            .find(|e| e.error_type == "DuplicateVariantName")
            .expect("Should find duplicate variant name error");
        assert_eq!(error.violating_type, "BadNamesUnion");
        assert_eq!(error.duplicate_name, "duplicate_name");
    }
}

#[cfg(test)]
mod resolved_tests {
    use super::*;
    use crate::abi::resolved::*;

    #[test]
    fn test_constant_status_analysis() {
        let resolver = TypeResolver::new();

        // Test constant literal
        let const_expr = ExprKind::Literal(LiteralExpr::U32(42));
        let status = resolver
            .analyze_expression_constantness(&const_expr, None)
            .unwrap();
        assert_eq!(status, ConstantStatus::Constant);

        // Test field reference (non-constant)
        let field_expr = ExprKind::FieldRef(FieldRefExpr {
            path: vec!["field".to_string()],
        });
        let status = resolver
            .analyze_expression_constantness(&field_expr, None)
            .unwrap();
        assert!(matches!(status, ConstantStatus::NonConstant(_)));

        // Test complex expression with field reference
        let complex_expr = ExprKind::Add(AddExpr {
            left: Box::new(const_expr),
            right: Box::new(field_expr),
        });
        let status = resolver
            .analyze_expression_constantness(&complex_expr, None)
            .unwrap();
        assert!(matches!(status, ConstantStatus::NonConstant(_)));
    }

    #[test]
    fn test_primitive_type_resolution() {
        let mut resolver = TypeResolver::new();

        let typedef = TypeDef {
            name: "MyU32".to_string(),
            kind: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U32)),
        };

        resolver.add_typedef(typedef);
        resolver.resolve_all().unwrap();

        let resolved = resolver.get_type_info("MyU32").unwrap();
        assert_eq!(resolved.size, Size::Const(4));
        assert_eq!(resolved.alignment, 4);
        assert!(matches!(resolved.kind, ResolvedTypeKind::Primitive { .. }));
    }

    #[test]
    fn test_struct_type_resolution() {
        let mut resolver = TypeResolver::new();

        let typedefs = vec![TypeDef {
            name: "SimpleStruct".to_string(),
            kind: TypeKind::Struct(StructType {
                container_attributes: Default::default(),
                fields: vec![
                    StructField {
                        name: "field1".to_string(),
                        field_type: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U8)),
                    },
                    StructField {
                        name: "field2".to_string(),
                        field_type: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U32)),
                    },
                ],
            }),
        }];

        for typedef in typedefs {
            resolver.add_typedef(typedef);
        }
        resolver.resolve_all().unwrap();

        let resolved = resolver.get_type_info("SimpleStruct").unwrap();
        assert_eq!(resolved.size, Size::Const(8)); // u8 + padding + u32 = 8 bytes (aligned)
        assert_eq!(resolved.alignment, 4);

        if let ResolvedTypeKind::Struct { fields, .. } = &resolved.kind {
            assert_eq!(fields.len(), 2);
            assert_eq!(fields[0].offset, Some(0));
            assert_eq!(fields[1].offset, Some(4)); // Aligned to u32 boundary
        } else {
            panic!("Expected struct type");
        }
    }

    #[test]
    fn test_packed_struct_resolution() {
        let mut resolver = TypeResolver::new();

        let typedef = TypeDef {
            name: "PackedStruct".to_string(),
            kind: TypeKind::Struct(StructType {
                container_attributes: ContainerAttributes {
                    packed: true,
                    aligned: 0,
                    comment: None,
                },
                fields: vec![
                    StructField {
                        name: "field1".to_string(),
                        field_type: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U8)),
                    },
                    StructField {
                        name: "field2".to_string(),
                        field_type: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U32)),
                    },
                ],
            }),
        };

        resolver.add_typedef(typedef);
        resolver.resolve_all().unwrap();

        let resolved = resolver.get_type_info("PackedStruct").unwrap();
        assert_eq!(resolved.size, Size::Const(5)); // u8 + u32 = 5 bytes (packed, no padding)

        if let ResolvedTypeKind::Struct { fields, packed, .. } = &resolved.kind {
            assert!(packed);
            assert_eq!(fields[0].offset, Some(0));
            assert_eq!(fields[1].offset, Some(1)); // No alignment padding in packed struct
        } else {
            panic!("Expected struct type");
        }
    }

    #[test]
    fn test_array_with_constant_size() {
        let mut resolver = TypeResolver::new();

        let typedef = TypeDef {
            name: "ConstantArray".to_string(),
            kind: TypeKind::Array(ArrayType {
                container_attributes: Default::default(),
                size: ExprKind::Literal(LiteralExpr::U64(10)),
                element_type: Box::new(TypeKind::Primitive(PrimitiveType::Integral(
                    IntegralType::U8,
                ))),
                jagged: false,
            }),
        };

        resolver.add_typedef(typedef);
        resolver.resolve_all().unwrap();

        let resolved = resolver.get_type_info("ConstantArray").unwrap();
        // Size is now Size::Const(10) because we evaluate constant expressions
        assert_eq!(resolved.size, Size::Const(10));
        assert_eq!(resolved.alignment, 1);

        if let ResolvedTypeKind::Array {
            size_constant_status,
            ..
        } = &resolved.kind
        {
            assert_eq!(*size_constant_status, ConstantStatus::Constant);
        } else {
            panic!("Expected array type");
        }
    }

    #[test]
    fn test_array_with_field_reference() {
        let mut resolver = TypeResolver::new();

        let typedef = TypeDef {
            name: "DynamicArray".to_string(),
            kind: TypeKind::Array(ArrayType {
                container_attributes: Default::default(),
                size: ExprKind::FieldRef(FieldRefExpr {
                    path: vec!["some_field".to_string()],
                }),
                element_type: Box::new(TypeKind::Primitive(PrimitiveType::Integral(
                    IntegralType::U8,
                ))),
                jagged: false,
            }),
        };

        resolver.add_typedef(typedef);
        resolver.resolve_all().unwrap();

        let resolved = resolver.get_type_info("DynamicArray").unwrap();
        assert!(matches!(resolved.size, Size::Variable(_))); // Cannot determine size with field reference

        if let ResolvedTypeKind::Array {
            size_constant_status,
            ..
        } = &resolved.kind
        {
            assert!(matches!(
                size_constant_status,
                ConstantStatus::NonConstant(_)
            ));
        } else {
            panic!("Expected array type");
        }
    }

    #[test]
    fn test_union_type_resolution() {
        let mut resolver = TypeResolver::new();

        let typedef = TypeDef {
            name: "SimpleUnion".to_string(),
            kind: TypeKind::Union(UnionType {
                container_attributes: Default::default(),
                variants: vec![
                    UnionVariant {
                        name: "variant1".to_string(),
                        variant_type: TypeKind::Primitive(PrimitiveType::Integral(
                            IntegralType::U8,
                        )),
                    },
                    UnionVariant {
                        name: "variant2".to_string(),
                        variant_type: TypeKind::Primitive(PrimitiveType::Integral(
                            IntegralType::U32,
                        )),
                    },
                ],
            }),
        };

        resolver.add_typedef(typedef);
        resolver.resolve_all().unwrap();

        let resolved = resolver.get_type_info("SimpleUnion").unwrap();
        assert_eq!(resolved.size, Size::Const(4)); // Size of largest variant (u32)
        assert_eq!(resolved.alignment, 4);

        if let ResolvedTypeKind::Union { variants } = &resolved.kind {
            assert_eq!(variants.len(), 2);
            // All variants should have offset 0 in a union
            assert_eq!(variants[0].offset, Some(0));
            assert_eq!(variants[1].offset, Some(0));
        } else {
            panic!("Expected union type");
        }
    }

    #[test]
    fn test_enum_type_resolution() {
        let mut resolver = TypeResolver::new();

        let typedef = TypeDef {
            name: "SimpleEnum".to_string(),
            kind: TypeKind::Enum(EnumType {
                container_attributes: Default::default(),
                tag_ref: ExprKind::Literal(LiteralExpr::U64(0)),
                variants: vec![
                    EnumVariant {
                        name: "Variant1".to_string(),
                        tag_value: 1,
                        variant_type: TypeKind::Primitive(PrimitiveType::Integral(
                            IntegralType::U32,
                        )),
                    },
                    EnumVariant {
                        name: "Variant2".to_string(),
                        tag_value: 2,
                        variant_type: TypeKind::Primitive(PrimitiveType::Integral(
                            IntegralType::U8,
                        )),
                    },
                ],
            }),
        };

        resolver.add_typedef(typedef);
        resolver.resolve_all().unwrap();

        let resolved = resolver.get_type_info("SimpleEnum").unwrap();
        assert!(
            matches!(resolved.size, Size::Variable(_)),
            "Enums with variant-dependent payloads should report variable size"
        );
        assert_eq!(resolved.alignment, 4); // Alignment of largest variant

        if let ResolvedTypeKind::Enum {
            tag_constant_status,
            variants,
            ..
        } = &resolved.kind
        {
            assert_eq!(*tag_constant_status, ConstantStatus::Constant);
            assert_eq!(variants.len(), 2);
            assert_eq!(variants[0].tag_value, 1);
            assert_eq!(variants[1].tag_value, 2);
        } else {
            panic!("Expected enum type");
        }
    }

    #[test]
    fn test_circular_type_reference_detection() {
        let mut resolver = TypeResolver::new();

        let typedefs = vec![
            TypeDef {
                name: "TypeA".to_string(),
                kind: TypeKind::Struct(StructType {
                    container_attributes: Default::default(),
                    fields: vec![StructField {
                        name: "field_b".to_string(),
                        field_type: TypeKind::TypeRef(TypeRefType {
                            name: "TypeB".to_string(),
                            comment: None,
                        }),
                    }],
                }),
            },
            TypeDef {
                name: "TypeB".to_string(),
                kind: TypeKind::TypeRef(TypeRefType {
                    name: "TypeA".to_string(),
                    comment: None,
                }),
            },
        ];

        for typedef in typedefs {
            resolver.add_typedef(typedef);
        }

        // Should detect circular dependency and fail to resolve
        let result = resolver.resolve_all();
        assert!(result.is_err());
        assert!(matches!(
            result.unwrap_err(),
            ResolutionError::CircularDependency(_)
        ));
    }

    #[test]
    fn test_field_reference_collection() {
        let resolver = TypeResolver::new();

        // Test simple field reference
        let simple_ref = ExprKind::FieldRef(FieldRefExpr {
            path: vec!["field".to_string()],
        });
        let status = resolver
            .analyze_expression_constantness(&simple_ref, None)
            .unwrap();
        if let ConstantStatus::NonConstant(ref refs) = status {
            assert_eq!(refs.len(), 1);
            assert!(refs.contains_key("field"));
        } else {
            panic!("Expected non-constant status for field reference");
        }

        // Test complex expression with multiple field references
        let complex_expr = ExprKind::Add(AddExpr {
            left: Box::new(ExprKind::FieldRef(FieldRefExpr {
                path: vec!["field1".to_string()],
            })),
            right: Box::new(ExprKind::Mul(MulExpr {
                left: Box::new(ExprKind::FieldRef(FieldRefExpr {
                    path: vec!["field2".to_string()],
                })),
                right: Box::new(ExprKind::Literal(LiteralExpr::U32(2))),
            })),
        });
        let status = resolver
            .analyze_expression_constantness(&complex_expr, None)
            .unwrap();
        if let ConstantStatus::NonConstant(ref refs) = status {
            assert_eq!(refs.len(), 2);
            assert!(refs.contains_key("field1"));
            assert!(refs.contains_key("field2"));
        } else {
            panic!("Expected non-constant status for complex expression");
        }
    }

    #[test]
    fn test_non_constant_dependency_tracking() {
        let mut resolver = TypeResolver::new();

        let typedef = TypeDef {
            name: "DependentArray".to_string(),
            kind: TypeKind::Array(ArrayType {
                container_attributes: Default::default(),
                size: ExprKind::Add(AddExpr {
                    left: Box::new(ExprKind::FieldRef(FieldRefExpr {
                        path: vec!["size_field".to_string()],
                    })),
                    right: Box::new(ExprKind::Literal(LiteralExpr::U32(10))),
                }),
                element_type: Box::new(TypeKind::Primitive(PrimitiveType::Integral(
                    IntegralType::U8,
                ))),
                jagged: false,
            }),
        };

        resolver.add_typedef(typedef);
        resolver.resolve_all().unwrap();

        let resolved = resolver
            .get_type_info("DependentArray")
            .expect("Type should be resolved");
        assert!(matches!(resolved.size, Size::Variable(_)));

        if let ResolvedTypeKind::Array {
            size_constant_status,
            ..
        } = &resolved.kind
        {
            if let ConstantStatus::NonConstant(refs) = size_constant_status {
                assert_eq!(refs.len(), 1);
                assert!(refs.contains_key("size_field"));
            } else {
                panic!("Expected non-constant size status for DependentArray");
            }
        } else {
            panic!("DependentArray should resolve to an array type");
        }
    }

    #[test]
    fn test_shift_operations_constant_evaluation() {
        let mut resolver = TypeResolver::new();

        // Test array with constant shift operations
        let typedef = TypeDef {
            name: "ShiftArray".to_string(),
            kind: TypeKind::Array(ArrayType {
                container_attributes: Default::default(),
                // Size = (4 << 2) >> 1 = 16 >> 1 = 8
                size: ExprKind::RightShift(RightShiftExpr {
                    left: Box::new(ExprKind::LeftShift(LeftShiftExpr {
                        left: Box::new(ExprKind::Literal(LiteralExpr::U64(4))),
                        right: Box::new(ExprKind::Literal(LiteralExpr::U64(2))),
                    })),
                    right: Box::new(ExprKind::Literal(LiteralExpr::U64(1))),
                }),
                element_type: Box::new(TypeKind::Primitive(PrimitiveType::Integral(
                    IntegralType::U8,
                ))),
                jagged: false,
            }),
        };

        resolver.add_typedef(typedef);
        resolver.resolve_all().unwrap();

        let resolved = resolver.get_type_info("ShiftArray").unwrap();
        assert_eq!(resolved.size, Size::Const(8)); // (4 << 2) >> 1 = 8
        assert_eq!(resolved.alignment, 1);

        if let ResolvedTypeKind::Array {
            size_constant_status,
            ..
        } = &resolved.kind
        {
            assert_eq!(*size_constant_status, ConstantStatus::Constant);
        } else {
            panic!("Expected array type");
        }
    }

    #[test]
    fn test_popcount_operations_constant_evaluation() {
        let mut resolver = TypeResolver::new();

        // Test array with popcount-based size
        let typedef = TypeDef {
            name: "PopcountArray".to_string(),
            kind: TypeKind::Array(ArrayType {
                container_attributes: Default::default(),
                // Size = popcount(0b1111) = 4
                size: ExprKind::Popcount(PopcountExpr {
                    operand: Box::new(ExprKind::Literal(LiteralExpr::U64(15))), // 15 = 0b1111
                }),
                element_type: Box::new(TypeKind::Primitive(PrimitiveType::Integral(
                    IntegralType::U8,
                ))),
                jagged: false,
            }),
        };

        resolver.add_typedef(typedef);
        resolver.resolve_all().unwrap();

        let resolved = resolver.get_type_info("PopcountArray").unwrap();
        assert_eq!(resolved.size, Size::Const(4)); // popcount(15) = 4
        assert_eq!(resolved.alignment, 1);

        if let ResolvedTypeKind::Array {
            size_constant_status,
            ..
        } = &resolved.kind
        {
            assert_eq!(*size_constant_status, ConstantStatus::Constant);
        } else {
            panic!("Expected array type");
        }
    }

    #[test]
    fn test_size_discriminated_union_type_resolution() {
        let mut resolver = TypeResolver::new();

        let typedef = TypeDef {
            name: "TokenAccountUnion".to_string(),
            kind: TypeKind::SizeDiscriminatedUnion(SizeDiscriminatedUnionType {
                container_attributes: Default::default(),
                variants: vec![
                    SizeDiscriminatedVariant {
                        name: "token_account".to_string(),
                        expected_size: 4,
                        variant_type: TypeKind::Primitive(PrimitiveType::Integral(
                            IntegralType::U32,
                        )),
                    },
                    SizeDiscriminatedVariant {
                        name: "token_mint".to_string(),
                        expected_size: 8,
                        variant_type: TypeKind::Primitive(PrimitiveType::Integral(
                            IntegralType::U64,
                        )),
                    },
                ],
            }),
        };

        resolver.add_typedef(typedef);
        resolver.resolve_all().unwrap();

        let resolved = resolver.get_type_info("TokenAccountUnion").unwrap();
        assert!(matches!(resolved.size, Size::Variable(_))); // Size-discriminated unions have variable size
        assert_eq!(resolved.alignment, 8); // Max alignment of variants (u64 = 8)

        if let ResolvedTypeKind::SizeDiscriminatedUnion { variants } = &resolved.kind {
            assert_eq!(variants.len(), 2);
            assert_eq!(variants[0].name, "token_account");
            assert_eq!(variants[0].expected_size, 4);
            assert_eq!(variants[1].name, "token_mint");
            assert_eq!(variants[1].expected_size, 8);
        } else {
            panic!("Expected size-discriminated union type");
        }
    }
}
