use crate::abi::types::{TypeDef, TypeKind};
use std::collections::{BTreeMap, BTreeSet, VecDeque};

#[cfg(feature = "layout_graph_trace")]
fn trace_log(msg: impl AsRef<str>) {
    eprintln!("[layout_graph] {}", msg.as_ref());
}

#[cfg(not(feature = "layout_graph_trace"))]
fn trace_log(_msg: impl AsRef<str>) {}

/// Tracks type dependency information for building layout/IR in topological order.
#[derive(Debug)]
pub struct LayoutGraph {
    nodes: BTreeMap<String, LayoutGraphNode>,
}

#[derive(Debug, Clone)]
pub struct LayoutGraphNode {
    pub id: usize,
    pub name: String,
    pub deps: BTreeSet<String>,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum LayoutGraphError {
    #[error("circular dependency detected: {0:?}")]
    CircularDependency(Vec<String>),
}

impl LayoutGraph {
    pub fn build(typedefs: &[TypeDef]) -> Self {
        let mut nodes = BTreeMap::new();
        for (idx, typedef) in typedefs.iter().enumerate() {
            let mut deps = BTreeSet::new();
            collect_dependencies(&typedef.kind, &mut deps);
            deps.remove(&typedef.name); // Ignore self references.
            nodes.insert(
                typedef.name.clone(),
                LayoutGraphNode {
                    id: idx,
                    name: typedef.name.clone(),
                    deps,
                },
            );
        }
        Self { nodes }
    }

    /// Computes a deterministic topological ordering using Kahn's algorithm.
    pub fn topo_order(&self) -> Result<Vec<String>, LayoutGraphError> {
        let mut in_degree: BTreeMap<String, usize> = BTreeMap::new();
        let mut adjacency: BTreeMap<String, Vec<String>> = BTreeMap::new();

        for (name, node) in &self.nodes {
            in_degree.entry(name.clone()).or_insert(0);
            for dep in &node.deps {
                adjacency.entry(dep.clone()).or_default().push(name.clone());
                *in_degree.entry(name.clone()).or_insert(0) += 1;
            }
        }

        let mut queue: VecDeque<String> = in_degree
            .iter()
            .filter_map(|(name, degree)| {
                if *degree == 0 {
                    Some(name.clone())
                } else {
                    None
                }
            })
            .collect();

        let mut order = Vec::with_capacity(self.nodes.len());

        while let Some(name) = queue.pop_front() {
            trace_log(format!("processing node {name}"));
            order.push(name.clone());

            if let Some(children) = adjacency.get(&name) {
                for child in children {
                    if let Some(degree) = in_degree.get_mut(child) {
                        *degree = degree.saturating_sub(1);
                        if *degree == 0 {
                            trace_log(format!("enqueue {child}"));
                            queue.push_back(child.clone());
                        }
                    }
                }
            }
        }

        if order.len() == self.nodes.len() {
            Ok(order)
        } else {
            let cycle: Vec<String> = in_degree
                .into_iter()
                .filter_map(|(name, degree)| if degree > 0 { Some(name) } else { None })
                .collect();
            Err(LayoutGraphError::CircularDependency(cycle))
        }
    }

    pub fn nodes(&self) -> impl Iterator<Item = &LayoutGraphNode> {
        self.nodes.values()
    }
}

fn collect_dependencies(kind: &TypeKind, deps: &mut BTreeSet<String>) {
    match kind {
        TypeKind::Primitive(_) => {}
        TypeKind::TypeRef(type_ref) => {
            deps.insert(type_ref.name.clone());
        }
        TypeKind::Struct(struct_type) => {
            for field in &struct_type.fields {
                collect_dependencies(&field.field_type, deps);
            }
        }
        TypeKind::Union(union_type) => {
            for variant in &union_type.variants {
                collect_dependencies(&variant.variant_type, deps);
            }
        }
        TypeKind::Enum(enum_type) => {
            for variant in &enum_type.variants {
                collect_dependencies(&variant.variant_type, deps);
            }
        }
        TypeKind::Array(array_type) => {
            collect_dependencies(&array_type.element_type, deps);
        }
        TypeKind::SizeDiscriminatedUnion(sdu_type) => {
            for variant in &sdu_type.variants {
                collect_dependencies(&variant.variant_type, deps);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::abi::expr::{ExprKind, FieldRefExpr, LiteralExpr};
    use crate::abi::types::{
        ArrayType, EnumType, PrimitiveType, StructField, StructType, TypeRefType, UnionType,
    };
    use crate::abi::types::{EnumVariant, IntegralType};

    #[test]
    fn layout_graph_topological_order() {
        let typedefs = vec![
            TypeDef {
                name: "B".to_string(),
                kind: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U32)),
            },
            TypeDef {
                name: "A".to_string(),
                kind: TypeKind::Struct(StructType {
                    container_attributes: Default::default(),
                    fields: vec![StructField {
                        name: "field_b".to_string(),
                        field_type: TypeKind::TypeRef(TypeRefType {
                            name: "B".to_string(),
                            comment: None,
                        }),
                    }],
                }),
            },
        ];

        let graph = LayoutGraph::build(&typedefs);
        let order = graph.topo_order().unwrap();
        assert_eq!(order, vec!["B".to_string(), "A".to_string()]);
    }

    #[test]
    fn layout_graph_detects_cycle() {
        let typedefs = vec![
            TypeDef {
                name: "X".to_string(),
                kind: TypeKind::Struct(StructType {
                    container_attributes: Default::default(),
                    fields: vec![StructField {
                        name: "y".to_string(),
                        field_type: TypeKind::TypeRef(TypeRefType {
                            name: "Y".to_string(),
                            comment: None,
                        }),
                    }],
                }),
            },
            TypeDef {
                name: "Y".to_string(),
                kind: TypeKind::Struct(StructType {
                    container_attributes: Default::default(),
                    fields: vec![StructField {
                        name: "x".to_string(),
                        field_type: TypeKind::TypeRef(TypeRefType {
                            name: "X".to_string(),
                            comment: None,
                        }),
                    }],
                }),
            },
        ];

        let graph = LayoutGraph::build(&typedefs);
        let err = graph.topo_order().unwrap_err();
        assert!(matches!(err, LayoutGraphError::CircularDependency(_)));
    }

    #[test]
    fn collects_nested_dependencies() {
        let typedefs = vec![
            TypeDef {
                name: "Leaf".to_string(),
                kind: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U8)),
            },
            TypeDef {
                name: "Node".to_string(),
                kind: TypeKind::Enum(EnumType {
                    container_attributes: Default::default(),
                    tag_ref: ExprKind::FieldRef(crate::abi::expr::FieldRefExpr {
                        path: vec!["tag".to_string()],
                    }),
                    variants: vec![crate::abi::types::EnumVariant {
                        name: "leaf_variant".to_string(),
                        tag_value: 0,
                        variant_type: TypeKind::Array(ArrayType {
                            container_attributes: Default::default(),
                            size: ExprKind::Literal(crate::abi::expr::LiteralExpr::U8(1)),
                            element_type: Box::new(TypeKind::TypeRef(TypeRefType {
                                name: "Leaf".to_string(),
                                comment: None,
                            })),
                        }),
                    }],
                }),
            },
        ];

        let graph = LayoutGraph::build(&typedefs);
        let order = graph.topo_order().unwrap();
        assert_eq!(order, vec!["Leaf".to_string(), "Node".to_string()]);
    }

    #[test]
    fn deterministic_order_with_multiple_roots() {
        let typedefs = vec![
            TypeDef {
                name: "C".to_string(),
                kind: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U8)),
            },
            TypeDef {
                name: "A".to_string(),
                kind: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U8)),
            },
            TypeDef {
                name: "B".to_string(),
                kind: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U8)),
            },
        ];

        let graph = LayoutGraph::build(&typedefs);
        let order = graph.topo_order().unwrap();
        assert_eq!(
            order,
            vec!["A".to_string(), "B".to_string(), "C".to_string()]
        );
    }

    #[test]
    fn allows_recursive_reference_via_nested_struct() {
        let typedefs = vec![TypeDef {
            name: "Node".to_string(),
            kind: TypeKind::Struct(StructType {
                container_attributes: Default::default(),
                fields: vec![
                    StructField {
                        name: "value".to_string(),
                        field_type: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U8)),
                    },
                    StructField {
                        name: "child".to_string(),
                        field_type: TypeKind::Struct(StructType {
                            container_attributes: Default::default(),
                            fields: vec![StructField {
                                name: "parent_link".to_string(),
                                field_type: TypeKind::TypeRef(TypeRefType {
                                    name: "Node".to_string(),
                                    comment: None,
                                }),
                            }],
                        }),
                    },
                ],
            }),
        }];

        let graph = LayoutGraph::build(&typedefs);
        let order = graph.topo_order().unwrap();
        assert_eq!(order, vec!["Node".to_string()]);
    }

    #[test]
    fn detects_illegal_forward_reference_cycle() {
        let typedefs = vec![
            TypeDef {
                name: "Parent".to_string(),
                kind: TypeKind::Struct(StructType {
                    container_attributes: Default::default(),
                    fields: vec![
                        StructField {
                            name: "header".to_string(),
                            field_type: TypeKind::Primitive(PrimitiveType::Integral(
                                IntegralType::U8,
                            )),
                        },
                        StructField {
                            name: "child".to_string(),
                            field_type: TypeKind::TypeRef(TypeRefType {
                                name: "Child".to_string(),
                                comment: None,
                            }),
                        },
                    ],
                }),
            },
            TypeDef {
                name: "Child".to_string(),
                kind: TypeKind::Struct(StructType {
                    container_attributes: Default::default(),
                    fields: vec![
                        StructField {
                            name: "tag".to_string(),
                            field_type: TypeKind::Primitive(PrimitiveType::Integral(
                                IntegralType::U8,
                            )),
                        },
                        StructField {
                            name: "payload".to_string(),
                            field_type: TypeKind::TypeRef(TypeRefType {
                                name: "Parent".to_string(),
                                comment: None,
                            }),
                        },
                    ],
                }),
            },
        ];

        let graph = LayoutGraph::build(&typedefs);
        let err = graph.topo_order().unwrap_err();
        assert!(matches!(err, LayoutGraphError::CircularDependency(cycle) if cycle.len() == 2));
    }
}
