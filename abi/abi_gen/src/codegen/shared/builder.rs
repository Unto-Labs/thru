use super::ir::*;
use crate::abi::expr::{ExprKind, LiteralExpr};
use crate::abi::layout_graph::{LayoutGraph, LayoutGraphError};
use crate::abi::resolved::{ResolvedType, ResolvedTypeKind, Size, TypeResolver};
use std::collections::{BTreeMap, BTreeSet};
use thiserror::Error;

#[derive(Default)]
struct ParameterRegistry {
    params: Vec<IrParameter>,
    lookup: BTreeMap<(String, String), usize>,
    owner_index: BTreeMap<String, Vec<usize>>,
}

impl ParameterRegistry {
    fn from_dynamic(
        dynamic_params: &BTreeMap<String, BTreeMap<String, crate::abi::types::PrimitiveType>>,
    ) -> Self {
        let mut registry = Self::default();
        registry.extend_with(dynamic_params);
        registry
    }

    fn ensure(
        &mut self,
        owner: &str,
        stored_path: &str,
        description: Option<String>,
        derived: bool,
    ) -> usize {
        let normalized = normalize_path(owner, stored_path);
        let key = (owner.to_string(), normalized.clone());
        if let Some(idx) = self.lookup.get(&key) {
            return *idx;
        }
        let canonical = canonical_name(owner, stored_path);
        let idx = self.params.len();
        self.params.push(IrParameter {
            name: canonical.clone(),
            description,
            derived,
        });
        self.lookup.insert(key, idx);
        for alias in alternate_owner_aliases(stored_path, &normalized) {
            self.lookup.entry((owner.to_string(), alias)).or_insert(idx);
        }
        self.owner_index
            .entry(owner.to_string())
            .or_default()
            .push(idx);
        idx
    }

    fn extend_with(
        &mut self,
        dynamic_params: &BTreeMap<String, BTreeMap<String, crate::abi::types::PrimitiveType>>,
    ) {
        for (owner, refs) in dynamic_params {
            for path in refs.keys() {
                self.ensure(owner, path, None, false);
            }
        }
    }

    fn lookup_name(&self, owner: &str, path: &str) -> Option<&str> {
        let normalized = normalize_path(owner, path);
        let key = (owner.to_string(), normalized);
        self.lookup
            .get(&key)
            .map(|idx| self.params[*idx].name.as_str())
    }

    fn owner_parameters(&self, owner: &str) -> Vec<IrParameter> {
        self.owner_index
            .get(owner)
            .map(|indices| {
                indices
                    .iter()
                    .map(|idx| self.params[*idx].clone())
                    .collect()
            })
            .unwrap_or_default()
    }

    fn add_synthetic(
        &mut self,
        owner: &str,
        stored_path: &str,
        canonical_override: Option<String>,
        description: Option<String>,
        derived: bool,
    ) -> String {
        let normalized = normalize_path(owner, stored_path);
        let key = (owner.to_string(), normalized);
        if let Some(idx) = self.lookup.get(&key) {
            return self.params[*idx].name.clone();
        }
        let canonical = canonical_override.unwrap_or_else(|| canonical_name(owner, stored_path));
        let idx = self.params.len();
        self.params.push(IrParameter {
            name: canonical.clone(),
            description,
            derived,
        });
        self.lookup.insert(key, idx);
        self.owner_index
            .entry(owner.to_string())
            .or_default()
            .push(idx);
        canonical
    }

    fn mark_derived(&mut self, owner: &str, stored_path: &str) {
        let normalized = normalize_path(owner, stored_path);
        if let Some(idx) = self.lookup.get(&(owner.to_string(), normalized)) {
            if let Some(param) = self.params.get_mut(*idx) {
                param.derived = true;
            }
        }
    }

    fn into_parameters(self) -> Vec<IrParameter> {
        let mut seen = BTreeSet::new();
        let mut out = Vec::new();
        for param in self.params {
            if seen.insert(param.name.clone()) {
                out.push(param);
            }
        }
        out
    }
}

fn canonical_name(owner: &str, path: &str) -> String {
    if path.is_empty() {
        owner.to_string()
    } else if path == owner {
        owner.to_string()
    } else if let Some(stripped) = path.strip_prefix(&(owner.to_owned() + ".")) {
        format!("{owner}.{stripped}")
    } else {
        format!("{owner}.{path}")
    }
}

fn normalize_path(owner: &str, path: &str) -> String {
    if path == owner {
        String::new()
    } else if let Some(stripped) = path.strip_prefix(&(owner.to_owned() + ".")) {
        stripped.to_string()
    } else {
        path.to_string()
    }
}

fn alternate_owner_aliases(stored_path: &str, normalized: &str) -> Vec<String> {
    let mut aliases = Vec::new();
    if let Some(idx) = stored_path.rfind("::") {
        let suffix = &stored_path[idx + 2..];
        if !suffix.is_empty() && suffix != normalized {
            aliases.push(suffix.to_string());
        }
    }
    aliases
}

/// Builds the shared Layout IR from resolved ABI types.
pub struct IrBuilder<'a> {
    resolver: &'a TypeResolver,
}

impl<'a> IrBuilder<'a> {
    pub fn new(resolver: &'a TypeResolver) -> Self {
        Self { resolver }
    }

    /// Builds IR for every resolved type in dependency order.
    pub fn build_all(&self) -> Result<LayoutIr, IrBuildError> {
        let typedefs: Vec<_> = self.resolver.typedefs.values().cloned().collect();
        let graph = LayoutGraph::build(&typedefs);
        let order = graph.topo_order().map_err(|err| match err {
            LayoutGraphError::CircularDependency(cycle) => IrBuildError::DependencyCycle { cycle },
        })?;
        let mut types = Vec::with_capacity(order.len());
        for name in order {
            if let Some(ty) = self.resolver.get_type_info(&name) {
                types.push(self.build_type(ty)?);
            }
        }
        Ok(LayoutIr::new(types))
    }

    /// Builds IR for a single resolved type.
    pub fn build_type(&self, ty: &ResolvedType) -> Result<TypeIr, IrBuildError> {
        let mut params = ParameterRegistry::from_dynamic(&ty.dynamic_params);
        let root = self.node_from_resolved(ty, &mut params)?;
        Ok(TypeIr {
            type_name: ty.name.clone(),
            alignment: ty.alignment,
            root,
            parameters: params.into_parameters(),
        })
    }

    fn node_from_resolved(
        &self,
        ty: &ResolvedType,
        params: &mut ParameterRegistry,
    ) -> Result<IrNode, IrBuildError> {
        match &ty.kind {
            ResolvedTypeKind::Primitive { .. } => Self::const_node(ty),
            ResolvedTypeKind::TypeRef { .. } => self.build_typeref_node(ty),
            ResolvedTypeKind::Struct { .. } => match &ty.size {
                Size::Const(_) => Self::const_node(ty),
                Size::Variable(_) => self.build_variable_struct(ty, params),
            },
            ResolvedTypeKind::Union { .. } => match &ty.size {
                Size::Const(_) => Self::const_node(ty),
                Size::Variable(_) => self.build_union_node(ty, params),
            },
            ResolvedTypeKind::Enum { .. } => match &ty.size {
                Size::Const(_) => Self::const_node(ty),
                Size::Variable(_) => self.build_enum_node(ty, params),
            },
            ResolvedTypeKind::Array { .. } => match &ty.size {
                Size::Const(_) => Self::const_node(ty),
                Size::Variable(_) => self.build_array_node(ty, params),
            },
            ResolvedTypeKind::SizeDiscriminatedUnion { .. } => match &ty.size {
                Size::Const(_) => Self::const_node(ty),
                Size::Variable(_) => self.build_size_discriminated_union_node(ty, params),
            },
        }
    }

    fn build_typeref_node(&self, ty: &ResolvedType) -> Result<IrNode, IrBuildError> {
        let target_name = match &ty.kind {
            ResolvedTypeKind::TypeRef { target_name, .. } => target_name,
            _ => {
                return Err(IrBuildError::UnsupportedSize {
                    type_name: ty.name.clone(),
                });
            }
        };

        let target =
            self.resolver
                .get_type_info(target_name)
                .ok_or_else(|| IrBuildError::MissingType {
                    type_name: target_name.clone(),
                })?;

        let arguments = self.collect_callee_arguments(target);
        Ok(IrNode::CallNested(CallNestedNode {
            type_name: target_name.clone(),
            arguments,
            meta: NodeMetadata::aligned(ty.alignment),
        }))
    }

    fn collect_callee_arguments(&self, ty: &ResolvedType) -> Vec<IrArgument> {
        let mut args = Vec::new();
        for (owner, refs) in &ty.dynamic_params {
            for path in refs.keys() {
                let name = canonical_name(owner, path);
                args.push(IrArgument {
                    name: name.clone(),
                    value: name,
                });
            }
        }
        args
    }

    fn build_variable_struct(
        &self,
        ty: &ResolvedType,
        params: &mut ParameterRegistry,
    ) -> Result<IrNode, IrBuildError> {
        let ResolvedTypeKind::Struct { fields, .. } = &ty.kind else {
            return Err(IrBuildError::UnsupportedSize {
                type_name: ty.name.clone(),
            });
        };

        let mut nodes: Vec<IrNode> = Vec::new();
        for field in fields {
            let mut extend_field_dynamic = true;
            let field_node = match &field.field_type.size {
                Size::Const(value) => Self::const_or_zero(*value, field.field_type.alignment),
                Size::Variable(_) => match &field.field_type.kind {
                    ResolvedTypeKind::Array { .. } => self.build_array_node_with_prefix(
                        &field.field_type,
                        params,
                        &field.name,
                        "",
                        &ty.name,
                    )?,
                    ResolvedTypeKind::Enum { .. } => {
                        let owner_refs = ty.dynamic_params.get(&field.name);
                        let has_payload_param = owner_refs.map_or(false, |refs| {
                            refs.keys().any(|path| path.ends_with(".payload_size"))
                        });
                        if has_payload_param {
                            extend_field_dynamic = false;
                        }
                        let node = if has_payload_param {
                            let refs =
                                owner_refs.ok_or_else(|| IrBuildError::MissingDynamicRefs {
                                    type_name: format!("{}::{}", ty.name, field.name),
                                })?;
                            let filtered: BTreeMap<String, crate::abi::types::PrimitiveType> = refs
                                .iter()
                                .filter(|(path, _)| path.ends_with(".payload_size"))
                                .map(|(k, v)| (k.clone(), v.clone()))
                                .collect();
                            let dynamic_nodes = self.build_field_ref_nodes(
                                &field.name,
                                &filtered,
                                params,
                                &ty.name,
                            )?;
                            self.combine_checked_add(dynamic_nodes, &field.field_type.name)?
                        } else {
                            self.build_enum_node(&field.field_type, params)?
                        };
                        Self::align_node(node, field.field_type.alignment)
                    }
                    ResolvedTypeKind::SizeDiscriminatedUnion { .. } => {
                        let node =
                            self.build_size_discriminated_union_node(&field.field_type, params)?;
                        Self::align_node(node, field.field_type.alignment)
                    }
                    ResolvedTypeKind::TypeRef { .. } => {
                        extend_field_dynamic = false;
                        let node = self.build_typeref_node(&field.field_type)?;
                        Self::align_node(node, field.field_type.alignment)
                    }
                    _ => {
                        let refs = ty.dynamic_params.get(&field.name).ok_or_else(|| {
                            IrBuildError::MissingDynamicRefs {
                                type_name: format!("{}::{}", ty.name, field.name),
                            }
                        })?;
                        let dynamic_nodes =
                            self.build_field_ref_nodes(&field.name, refs, params, &ty.name)?;
                        self.combine_checked_add(dynamic_nodes, &field.field_type.name)?
                    }
                },
            };
            if extend_field_dynamic {
                params.extend_with(&field.field_type.dynamic_params);
            }
            nodes.push(field_node);
        }

        let acc = self.combine_checked_add(nodes, &ty.name)?;
        Ok(Self::align_node(acc, ty.alignment))
    }

    fn build_array_node(
        &self,
        ty: &ResolvedType,
        params: &mut ParameterRegistry,
    ) -> Result<IrNode, IrBuildError> {
        let owner =
            self.select_array_owner(ty)
                .ok_or_else(|| IrBuildError::MissingDynamicRefs {
                    type_name: format!("{} (array requires dynamic size expression)", ty.name),
                })?;
        self.build_array_node_with_prefix(ty, params, &owner, "", &ty.name)
    }

    fn build_array_node_with_prefix(
        &self,
        ty: &ResolvedType,
        params: &mut ParameterRegistry,
        owner: &str,
        path_prefix: &str,
        type_name: &str,
    ) -> Result<IrNode, IrBuildError> {
        let (element_type, size_expr, jagged) = match &ty.kind {
            ResolvedTypeKind::Array {
                element_type,
                size_expression,
                jagged,
                ..
            } => (element_type.as_ref(), size_expression, *jagged),
            _ => {
                return Err(IrBuildError::UnsupportedSize {
                    type_name: ty.name.clone(),
                });
            }
        };

        let count = self.build_expr_ir(size_expr, owner, params, type_name, path_prefix)?;
        params.extend_with(&element_type.dynamic_params);

        /* For jagged arrays with variable-size elements, use SumOverArray node */
        if jagged && matches!(element_type.size, Size::Variable(_)) {
            let element_type_name = match &element_type.kind {
                ResolvedTypeKind::TypeRef { target_name, .. } => target_name.clone(),
                _ => {
                    return Err(IrBuildError::UnsupportedArrayElement {
                        type_name: ty.name.clone(),
                    });
                }
            };

            let node = IrNode::SumOverArray(SumOverArrayNode {
                count: Box::new(count),
                element_type_name,
                field_name: owner.to_string(),
                meta: NodeMetadata::aligned(ty.alignment),
            });

            return Ok(Self::align_node(node, ty.alignment));
        }

        let elem = match element_type.size {
            Size::Const(value) => IrNode::Const(ConstNode {
                value,
                meta: NodeMetadata::aligned(element_type.alignment),
            }),
            Size::Variable(_) => match &element_type.kind {
                ResolvedTypeKind::Array { .. } => {
                    let child_prefix = Self::extend_element_prefix(path_prefix);
                    self.build_array_node_with_prefix(
                        element_type,
                        params,
                        owner,
                        &child_prefix,
                        type_name,
                    )?
                }
                _ => {
                    return Err(IrBuildError::UnsupportedArrayElement {
                        type_name: ty.name.clone(),
                    });
                }
            },
        };

        let product = IrNode::MulChecked(BinaryOpNode {
            left: Box::new(count),
            right: Box::new(elem),
            meta: NodeMetadata::aligned(ty.alignment),
        });

        Ok(Self::align_node(product, ty.alignment))
    }

    fn build_enum_node(
        &self,
        ty: &ResolvedType,
        params: &mut ParameterRegistry,
    ) -> Result<IrNode, IrBuildError> {
        params.extend_with(&ty.dynamic_params);
        let (tag_expr, variants) = match &ty.kind {
            ResolvedTypeKind::Enum {
                tag_expression,
                variants,
                ..
            } => (tag_expression, variants),
            _ => {
                return Err(IrBuildError::UnsupportedSize {
                    type_name: ty.name.clone(),
                });
            }
        };

        let tag_name = self.enum_tag_parameter(tag_expr, &ty.name, params)?;
        let mut cases = Vec::new();

        for variant in variants {
            let node = match variant.variant_type.size {
                Size::Const(value) => Self::const_or_zero(value, variant.variant_type.alignment),
                Size::Variable(_) => {
                    let refs = ty.dynamic_params.get(&variant.name).ok_or_else(|| {
                        IrBuildError::MissingDynamicRefs {
                            type_name: ty.name.clone(),
                        }
                    })?;
                    let nodes =
                        self.build_field_ref_nodes(&variant.name, refs, params, &ty.name)?;
                    let acc = self.combine_checked_add(nodes, &ty.name)?;
                    Self::align_node(acc, variant.variant_type.alignment)
                }
            };

            cases.push(SwitchCase {
                tag_value: variant.tag_value,
                node: Box::new(node),
                parameters: params.owner_parameters(&variant.name),
            });
        }

        Ok(IrNode::Switch(SwitchNode {
            tag: tag_name,
            cases,
            default: None,
            meta: NodeMetadata::aligned(ty.alignment),
        }))
    }

    fn build_union_node(
        &self,
        ty: &ResolvedType,
        params: &mut ParameterRegistry,
    ) -> Result<IrNode, IrBuildError> {
        params.extend_with(&ty.dynamic_params);
        let variants = match &ty.kind {
            ResolvedTypeKind::Union { variants } => variants,
            _ => {
                return Err(IrBuildError::UnsupportedSize {
                    type_name: ty.name.clone(),
                });
            }
        };

        let tag_name = params.add_synthetic(
            &ty.name,
            "__variant",
            Some(format!("{}.variant", ty.name)),
            Some("Active union variant selector".into()),
            false,
        );

        let mut cases = Vec::new();
        for (idx, variant) in variants.iter().enumerate() {
            let node = match variant.field_type.size {
                Size::Const(value) => Self::const_or_zero(value, variant.field_type.alignment),
                Size::Variable(_) => {
                    let refs = ty.dynamic_params.get(&variant.name).ok_or_else(|| {
                        IrBuildError::MissingDynamicRefs {
                            type_name: ty.name.clone(),
                        }
                    })?;
                    let nodes =
                        self.build_field_ref_nodes(&variant.name, refs, params, &ty.name)?;
                    let acc = self.combine_checked_add(nodes, &ty.name)?;
                    Self::align_node(acc, variant.field_type.alignment)
                }
            };

            cases.push(SwitchCase {
                tag_value: idx as u64,
                node: Box::new(node),
                parameters: params.owner_parameters(&variant.name),
            });
        }

        Ok(IrNode::Switch(SwitchNode {
            tag: tag_name,
            cases,
            default: None,
            meta: NodeMetadata::aligned(ty.alignment),
        }))
    }

    fn build_size_discriminated_union_node(
        &self,
        ty: &ResolvedType,
        params: &mut ParameterRegistry,
    ) -> Result<IrNode, IrBuildError> {
        params.extend_with(&ty.dynamic_params);
        let variants = match &ty.kind {
            ResolvedTypeKind::SizeDiscriminatedUnion { variants } => variants,
            _ => {
                return Err(IrBuildError::UnsupportedSize {
                    type_name: ty.name.clone(),
                });
            }
        };

        if variants.is_empty() {
            return Err(IrBuildError::UnsupportedSize {
                type_name: ty.name.clone(),
            });
        }

        let tag_name = params.add_synthetic(
            &ty.name,
            "__payload_size",
            Some(format!("{}.payload_size", ty.name)),
            Some("Runtime payload size (bytes) selecting size-discriminated variant".into()),
            false,
        );

        let cases = variants
            .iter()
            .map(|variant| {
                let node =
                    Self::const_or_zero(variant.expected_size, variant.variant_type.alignment);
                SwitchCase {
                    tag_value: variant.expected_size,
                    node: Box::new(node),
                    parameters: params.owner_parameters(&variant.name),
                }
            })
            .collect();

        Ok(IrNode::Switch(SwitchNode {
            tag: tag_name,
            cases,
            default: None,
            meta: NodeMetadata::aligned(ty.alignment),
        }))
    }

    fn build_field_ref_nodes(
        &self,
        owner: &str,
        refs: &BTreeMap<String, crate::abi::types::PrimitiveType>,
        params: &ParameterRegistry,
        type_name: &str,
    ) -> Result<Vec<IrNode>, IrBuildError> {
        let mut nodes = Vec::new();
        for path in refs.keys() {
            let parameter =
                params
                    .lookup_name(owner, path)
                    .ok_or_else(|| IrBuildError::MissingParameter {
                        owner: owner.to_string(),
                        path: path.clone(),
                        type_name: type_name.to_string(),
                    })?;

            nodes.push(IrNode::FieldRef(FieldRefNode {
                path: path.clone(),
                parameter: Some(parameter.to_string()),
                meta: NodeMetadata {
                    size_expr: Some(format!("{owner}:{path}")),
                    ..Default::default()
                },
            }));
        }
        Ok(nodes)
    }

    fn combine_checked_add(
        &self,
        mut nodes: Vec<IrNode>,
        type_name: &str,
    ) -> Result<IrNode, IrBuildError> {
        if nodes.is_empty() {
            return Err(IrBuildError::MissingDynamicRefs {
                type_name: type_name.to_string(),
            });
        }

        let mut iter = nodes.drain(..);
        let first = iter.next().unwrap();
        Ok(iter.fold(first, |left, right| {
            IrNode::AddChecked(BinaryOpNode {
                left: Box::new(left),
                right: Box::new(right),
                meta: NodeMetadata::default(),
            })
        }))
    }

    fn align_node(node: IrNode, alignment: u64) -> IrNode {
        IrNode::AlignUp(AlignNode {
            alignment,
            node: Box::new(node),
            meta: NodeMetadata::aligned(alignment),
        })
    }

    fn enum_tag_parameter(
        &self,
        expr: &ExprKind,
        type_name: &str,
        params: &mut ParameterRegistry,
    ) -> Result<String, IrBuildError> {
        match expr {
            ExprKind::FieldRef(field_ref) => {
                let path = field_ref.path.join(".");
                if let Some(name) = params.lookup_name(type_name, &path) {
                    return Ok(name.to_string());
                }

                if let Some(qualified) = qualify_parent_path(type_name, &path) {
                    if let Some(name) = params.lookup_name(type_name, &qualified) {
                        return Ok(name.to_string());
                    }
                }

                Err(IrBuildError::MissingParameter {
                    owner: type_name.to_string(),
                    path,
                    type_name: type_name.to_string(),
                })
            }
            _ => {
                mark_expression_field_refs(type_name, expr, params);
                let synthetic = params.add_synthetic(
                    type_name,
                    "__computed_tag",
                    Some(format!("{}.computed_tag", type_name)),
                    Some("Computed enum tag expression".into()),
                    true,
                );
                Ok(synthetic)
            }
        }
    }

    fn build_expr_ir(
        &self,
        expr: &ExprKind,
        owner: &str,
        params: &ParameterRegistry,
        type_name: &str,
        path_prefix: &str,
    ) -> Result<IrNode, IrBuildError> {
        match expr {
            ExprKind::Literal(lit) => {
                let value =
                    literal_to_u64(lit).ok_or_else(|| IrBuildError::UnsupportedExpression {
                        type_name: type_name.to_string(),
                    })?;
                Ok(IrNode::Const(ConstNode {
                    value,
                    meta: NodeMetadata::default(),
                }))
            }
            ExprKind::FieldRef(field_ref) => {
                let raw_path = field_ref.path.join(".");
                let path = Self::apply_path_prefix(path_prefix, &raw_path);
                let param = params.lookup_name(owner, &path).ok_or_else(|| {
                    IrBuildError::MissingParameter {
                        owner: owner.to_string(),
                        path: path.clone(),
                        type_name: type_name.to_string(),
                    }
                })?;
                Ok(IrNode::FieldRef(FieldRefNode {
                    path,
                    parameter: Some(param.to_string()),
                    meta: NodeMetadata::default(),
                }))
            }
            ExprKind::Add(expr) => {
                let left = self.build_expr_ir(&expr.left, owner, params, type_name, path_prefix)?;
                let right =
                    self.build_expr_ir(&expr.right, owner, params, type_name, path_prefix)?;
                Ok(IrNode::AddChecked(BinaryOpNode {
                    left: Box::new(left),
                    right: Box::new(right),
                    meta: NodeMetadata::default(),
                }))
            }
            ExprKind::Mul(expr) => {
                let left = self.build_expr_ir(&expr.left, owner, params, type_name, path_prefix)?;
                let right =
                    self.build_expr_ir(&expr.right, owner, params, type_name, path_prefix)?;
                Ok(IrNode::MulChecked(BinaryOpNode {
                    left: Box::new(left),
                    right: Box::new(right),
                    meta: NodeMetadata::default(),
                }))
            }
            _ => Err(IrBuildError::UnsupportedExpression {
                type_name: type_name.to_string(),
            }),
        }
    }

    fn const_or_zero(value: u64, alignment: u64) -> IrNode {
        if value == 0 {
            IrNode::ZeroSize {
                meta: NodeMetadata::aligned(alignment),
            }
        } else {
            Self::align_node(
                IrNode::Const(ConstNode {
                    value,
                    meta: NodeMetadata::aligned(alignment),
                }),
                alignment,
            )
        }
    }

    fn select_array_owner(&self, ty: &ResolvedType) -> Option<String> {
        if ty.dynamic_params.is_empty() {
            return None;
        }

        let field_key = if let Some(pos) = ty.name.rfind("::") {
            ty.name[pos + 2..].to_string()
        } else {
            "array".to_string()
        };

        if ty.dynamic_params.contains_key(&field_key) {
            return Some(field_key);
        }

        if ty.dynamic_params.contains_key(&ty.name) {
            return Some(ty.name.clone());
        }

        ty.dynamic_params.keys().next().cloned()
    }

    fn extend_element_prefix(prefix: &str) -> String {
        if prefix.is_empty() {
            "element.".to_string()
        } else {
            format!("{prefix}element.")
        }
    }

    fn apply_path_prefix(prefix: &str, path: &str) -> String {
        if prefix.is_empty() {
            path.to_string()
        } else if path.is_empty() {
            prefix.trim_end_matches('.').to_string()
        } else {
            format!("{prefix}{path}")
        }
    }

    fn const_node(ty: &ResolvedType) -> Result<IrNode, IrBuildError> {
        match ty.size {
            Size::Const(bytes) => Ok(IrNode::Const(ConstNode {
                value: bytes,
                meta: NodeMetadata::aligned(ty.alignment),
            })),
            Size::Variable(_) => Err(IrBuildError::UnsupportedSize {
                type_name: ty.name.clone(),
            }),
        }
    }
}

fn mark_expression_field_refs(owner: &str, expr: &ExprKind, params: &mut ParameterRegistry) {
    fn walk(expr: &ExprKind, out: &mut Vec<String>) {
        match expr {
            ExprKind::FieldRef(field_ref) => {
                if !field_ref.path.is_empty() {
                    out.push(field_ref.path.join("."));
                }
            }
            ExprKind::Add(e) => {
                walk(&e.left, out);
                walk(&e.right, out);
            }
            ExprKind::Sub(e) => {
                walk(&e.left, out);
                walk(&e.right, out);
            }
            ExprKind::Mul(e) => {
                walk(&e.left, out);
                walk(&e.right, out);
            }
            ExprKind::Div(e) => {
                walk(&e.left, out);
                walk(&e.right, out);
            }
            ExprKind::Mod(e) => {
                walk(&e.left, out);
                walk(&e.right, out);
            }
            ExprKind::Pow(e) => {
                walk(&e.left, out);
                walk(&e.right, out);
            }
            ExprKind::BitAnd(e) => {
                walk(&e.left, out);
                walk(&e.right, out);
            }
            ExprKind::BitOr(e) => {
                walk(&e.left, out);
                walk(&e.right, out);
            }
            ExprKind::BitXor(e) => {
                walk(&e.left, out);
                walk(&e.right, out);
            }
            ExprKind::LeftShift(e) => {
                walk(&e.left, out);
                walk(&e.right, out);
            }
            ExprKind::RightShift(e) => {
                walk(&e.left, out);
                walk(&e.right, out);
            }
            ExprKind::BitNot(e) => walk(&e.operand, out),
            ExprKind::Neg(e) => walk(&e.operand, out),
            ExprKind::Not(e) => walk(&e.operand, out),
            ExprKind::Popcount(e) => walk(&e.operand, out),
            _ => {}
        }
    }

    let mut refs = Vec::new();
    walk(expr, &mut refs);
    for path in refs {
        params.mark_derived(owner, &path);
    }
}

fn qualify_parent_path(owner: &str, path: &str) -> Option<String> {
    owner
        .rsplit_once("::")
        .map(|(parent, _)| format!("{parent}::{path}"))
}

fn literal_to_u64(literal: &LiteralExpr) -> Option<u64> {
    match literal {
        LiteralExpr::U64(v) => Some(*v),
        LiteralExpr::U32(v) => Some(*v as u64),
        LiteralExpr::U16(v) => Some(*v as u64),
        LiteralExpr::U8(v) => Some(*v as u64),
        LiteralExpr::I64(v) if *v >= 0 => Some(*v as u64),
        LiteralExpr::I32(v) if *v >= 0 => Some(*v as u64),
        LiteralExpr::I16(v) if *v >= 0 => Some(*v as u64),
        LiteralExpr::I8(v) if *v >= 0 => Some(*v as u64),
        _ => None,
    }
}

#[derive(Debug, Error)]
pub enum IrBuildError {
    #[error("type '{type_name}' uses unsupported size/shape for IR builder")]
    UnsupportedSize { type_name: String },
    #[error("type '{type_name}' is missing dynamic references required for layout math")]
    MissingDynamicRefs { type_name: String },
    #[error("missing parameter '{owner}:{path}' while building type '{type_name}'")]
    MissingParameter {
        owner: String,
        path: String,
        type_name: String,
    },
    #[error("array '{type_name}' has unsupported element shape")]
    UnsupportedArrayElement { type_name: String },
    #[error("expression in '{type_name}' cannot be converted into IR nodes yet")]
    UnsupportedExpression { type_name: String },
    #[error("enum '{type_name}' has unsupported tag expression")]
    UnsupportedTagExpression { type_name: String },
    #[error("circular dependency detected during IR build: {cycle:?}")]
    DependencyCycle { cycle: Vec<String> },
    #[error("type '{type_name}' referenced in IR builder but not found in resolver")]
    MissingType { type_name: String },
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::abi::expr::{ExprKind, FieldRefExpr};
    use crate::abi::types::{
        ArrayType, EnumType, EnumVariant, IntegralType, PrimitiveType, SizeDiscriminatedUnionType,
        SizeDiscriminatedVariant, StructField, StructType, TypeDef, TypeKind, TypeRefType,
        UnionType, UnionVariant,
    };
    use crate::codegen::shared::serialization::{layout_ir_to_json, layout_ir_to_protobuf};

    #[test]
    fn builder_emits_const_node_for_primitives() {
        let mut resolver = TypeResolver::new();
        resolver.add_typedef(TypeDef {
            name: "U32".into(),
            kind: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U32)),
        });
        resolver.resolve_all().unwrap();

        let builder = IrBuilder::new(&resolver);
        let ir = builder.build_all().unwrap();
        assert_eq!(ir.version, IR_SCHEMA_VERSION);
        assert_eq!(ir.types.len(), 1);
        let ty = &ir.types[0];
        assert_eq!(ty.type_name, "U32");
        match &ty.root {
            IrNode::Const(node) => assert_eq!(node.value, 4),
            other => panic!("unexpected node: {:?}", other),
        }
    }

    #[test]
    fn builder_handles_typeref_with_callnested() {
        let mut resolver = TypeResolver::new();
        resolver.add_typedef(TypeDef {
            name: "BaseType".into(),
            kind: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U16)),
        });
        resolver.add_typedef(TypeDef {
            name: "Ptr".into(),
            kind: TypeKind::TypeRef(crate::abi::types::TypeRefType {
                name: "BaseType".into(),
                comment: None,
            }),
        });
        resolver.resolve_all().unwrap();

        let builder = IrBuilder::new(&resolver);
        let ir = builder.build_all().unwrap();
        let ptr_ir = ir.types.iter().find(|t| t.type_name == "Ptr").unwrap();
        match &ptr_ir.root {
            IrNode::CallNested(node) => assert_eq!(node.type_name, "BaseType"),
            other => panic!("expected CallNested node, got {:?}", other),
        }
    }

    #[test]
    fn builder_emits_fieldref_for_dynamic_struct() {
        let mut resolver = TypeResolver::new();
        resolver.add_typedef(TypeDef {
            name: "VarStruct".into(),
            kind: TypeKind::Struct(StructType {
                container_attributes: Default::default(),
                fields: vec![
                    StructField {
                        name: "len".into(),
                        field_type: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U32)),
                    },
                    StructField {
                        name: "data".into(),
                        field_type: TypeKind::Array(ArrayType {
                            container_attributes: Default::default(),
                            size: ExprKind::FieldRef(FieldRefExpr {
                                path: vec!["len".into()],
                            }),
                            element_type: Box::new(TypeKind::Primitive(PrimitiveType::Integral(
                                IntegralType::U8,
                            ))),
                            jagged: false,
                        }),
                    },
                ],
            }),
        });
        resolver.resolve_all().unwrap();

        let builder = IrBuilder::new(&resolver);
        let ir = builder.build_all().unwrap();
        let var_ir = ir
            .types
            .iter()
            .find(|t| t.type_name == "VarStruct")
            .unwrap();
        match &var_ir.root {
            IrNode::AlignUp(align) => match &*align.node {
                IrNode::AddChecked(add) => {
                    match add.left.as_ref() {
                        IrNode::AlignUp(inner) => match inner.node.as_ref() {
                            IrNode::Const(c) => assert_eq!(c.value, 4),
                            other => panic!("expected const header, got {:?}", other),
                        },
                        other => panic!("expected aligned const header, got {:?}", other),
                    };
                    match add.right.as_ref() {
                        IrNode::AlignUp(inner_align) => match inner_align.node.as_ref() {
                            IrNode::MulChecked(mul) => {
                                match mul.left.as_ref() {
                                    IrNode::FieldRef(field_ref) => {
                                        assert_eq!(field_ref.path, "len")
                                    }
                                    other => {
                                        panic!("expected FieldRef contribution, got {:?}", other)
                                    }
                                }
                                match mul.right.as_ref() {
                                    IrNode::Const(c) => assert_eq!(c.value, 1),
                                    other => panic!("expected element const, got {:?}", other),
                                }
                            }
                            other => panic!("expected MulChecked for array body, got {:?}", other),
                        },
                        other => panic!("expected aligned array body, got {:?}", other),
                    }
                }
                other => panic!("expected AddChecked inside AlignUp, got {:?}", other),
            },
            other => panic!("expected AlignUp node, got {:?}", other),
        }
    }

    #[test]
    fn builder_finds_enum_tag_parameter_with_parent_field_ref() {
        let mut resolver = TypeResolver::new();
        resolver.add_typedef(TypeDef {
            name: "VariantPayload".into(),
            kind: TypeKind::Struct(StructType {
                container_attributes: Default::default(),
                fields: vec![StructField {
                    name: "value".into(),
                    field_type: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U16)),
                }],
            }),
        });

        resolver.add_typedef(TypeDef {
            name: "EnumParent".into(),
            kind: TypeKind::Struct(StructType {
                container_attributes: Default::default(),
                fields: vec![
                    StructField {
                        name: "tag".into(),
                        field_type: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U8)),
                    },
                    StructField {
                        name: "payload".into(),
                        field_type: TypeKind::Enum(EnumType {
                            container_attributes: Default::default(),
                            tag_ref: ExprKind::FieldRef(FieldRefExpr {
                                path: vec!["tag".into()],
                            }),
                            variants: vec![EnumVariant {
                                name: "variant".into(),
                                tag_value: 0,
                                variant_type: TypeKind::TypeRef(TypeRefType {
                                    name: "VariantPayload".into(),
                                    comment: None,
                                }),
                            }],
                        }),
                    },
                ],
            }),
        });

        resolver.resolve_all().unwrap();
        let builder = IrBuilder::new(&resolver);
        let enum_ty = resolver
            .get_type_info("EnumParent")
            .and_then(|ty| match &ty.kind {
                ResolvedTypeKind::Struct { fields, .. } => fields
                    .iter()
                    .find(|field| field.name == "payload")
                    .map(|field| field.field_type.clone()),
                _ => None,
            })
            .expect("enum payload type");
        builder.build_type(&enum_ty).expect("enum IR builds");
    }

    #[test]
    fn builder_emits_switch_for_constant_enum() {
        let mut resolver = TypeResolver::new();
        resolver.add_typedef(TypeDef {
            name: "SimpleEnum".into(),
            kind: TypeKind::Enum(EnumType {
                container_attributes: Default::default(),
                tag_ref: ExprKind::FieldRef(FieldRefExpr {
                    path: vec!["tag".into()],
                }),
                variants: vec![
                    EnumVariant {
                        name: "One".into(),
                        tag_value: 0,
                        variant_type: TypeKind::Primitive(PrimitiveType::Integral(
                            IntegralType::U32,
                        )),
                    },
                    EnumVariant {
                        name: "Two".into(),
                        tag_value: 1,
                        variant_type: TypeKind::Primitive(PrimitiveType::Integral(
                            IntegralType::U64,
                        )),
                    },
                ],
            }),
        });
        resolver.resolve_all().unwrap();

        let builder = IrBuilder::new(&resolver);
        let ir = builder.build_all().unwrap();
        let enum_ir = ir
            .types
            .iter()
            .find(|t| t.type_name == "SimpleEnum")
            .unwrap();

        match &enum_ir.root {
            IrNode::Switch(node) => {
                assert_eq!(node.cases.len(), 2);
                assert!(node.tag.contains("SimpleEnum"));
                for case in &node.cases {
                    assert!(case.parameters.is_empty());
                    match case.node.as_ref() {
                        IrNode::AlignUp(align) => match align.node.as_ref() {
                            IrNode::Const(_) | IrNode::ZeroSize { .. } => {}
                            other => panic!("expected const or zero node, got {:?}", other),
                        },
                        other => panic!("expected aligned node, got {:?}", other),
                    }
                }
            }
            other => panic!("expected Switch node, got {:?}", other),
        }
    }

    #[test]
    fn builder_switch_cases_include_variant_parameters() {
        let mut resolver = TypeResolver::new();
        resolver.add_typedef(TypeDef {
            name: "FamEnum".into(),
            kind: TypeKind::Enum(EnumType {
                container_attributes: Default::default(),
                tag_ref: ExprKind::FieldRef(FieldRefExpr {
                    path: vec!["tag".into()],
                }),
                variants: vec![
                    EnumVariant {
                        name: "Dyn".into(),
                        tag_value: 1,
                        variant_type: TypeKind::Struct(StructType {
                            container_attributes: Default::default(),
                            fields: vec![
                                StructField {
                                    name: "len".into(),
                                    field_type: TypeKind::Primitive(PrimitiveType::Integral(
                                        IntegralType::U32,
                                    )),
                                },
                                StructField {
                                    name: "payload".into(),
                                    field_type: TypeKind::Array(ArrayType {
                                        container_attributes: Default::default(),
                                        size: ExprKind::FieldRef(FieldRefExpr {
                                            path: vec!["len".into()],
                                        }),
                                        element_type: Box::new(TypeKind::Primitive(
                                            PrimitiveType::Integral(IntegralType::U8),
                                        )),
                                        jagged: false,
                                    }),
                                },
                            ],
                        }),
                    },
                    EnumVariant {
                        name: "Const".into(),
                        tag_value: 2,
                        variant_type: TypeKind::Primitive(PrimitiveType::Integral(
                            IntegralType::U16,
                        )),
                    },
                ],
            }),
        });
        resolver.resolve_all().unwrap();

        let builder = IrBuilder::new(&resolver);
        let ir = builder.build_all().unwrap();
        let enum_ir = ir.types.iter().find(|t| t.type_name == "FamEnum").unwrap();
        let switch = match &enum_ir.root {
            IrNode::Switch(node) => node,
            other => panic!("expected switch, got {:?}", other),
        };

        let dyn_case = switch
            .cases
            .iter()
            .find(|c| c.tag_value == 1)
            .expect("dyn case");
        assert!(
            dyn_case
                .parameters
                .iter()
                .any(|param| param.name.contains("Dyn")),
            "expected variant parameters"
        );
    }

    #[test]
    fn builder_emits_switch_for_union_without_tag() {
        let mut resolver = TypeResolver::new();
        resolver.add_typedef(TypeDef {
            name: "PayloadUnion".into(),
            kind: TypeKind::Union(UnionType {
                container_attributes: Default::default(),
                variants: vec![
                    UnionVariant {
                        name: "Bytes".into(),
                        variant_type: TypeKind::Struct(StructType {
                            container_attributes: Default::default(),
                            fields: vec![
                                StructField {
                                    name: "len".into(),
                                    field_type: TypeKind::Primitive(PrimitiveType::Integral(
                                        IntegralType::U32,
                                    )),
                                },
                                StructField {
                                    name: "data".into(),
                                    field_type: TypeKind::Array(ArrayType {
                                        container_attributes: Default::default(),
                                        size: ExprKind::FieldRef(FieldRefExpr {
                                            path: vec!["len".into()],
                                        }),
                                        element_type: Box::new(TypeKind::Primitive(
                                            PrimitiveType::Integral(IntegralType::U8),
                                        )),
                                        jagged: false,
                                    }),
                                },
                            ],
                        }),
                    },
                    UnionVariant {
                        name: "Number".into(),
                        variant_type: TypeKind::Primitive(PrimitiveType::Integral(
                            IntegralType::U64,
                        )),
                    },
                ],
            }),
        });
        resolver.resolve_all().unwrap();

        let builder = IrBuilder::new(&resolver);
        let ir = builder.build_all().unwrap();
        let union_ir = ir
            .types
            .iter()
            .find(|t| t.type_name == "PayloadUnion")
            .unwrap();
        let switch = match &union_ir.root {
            IrNode::Switch(node) => node,
            other => panic!("expected switch, got {:?}", other),
        };
        assert!(switch.tag.ends_with(".variant"));
        assert_eq!(switch.cases.len(), 2);
    }

    #[test]
    fn builder_emits_mulchecked_for_variable_array() {
        let mut resolver = TypeResolver::new();
        resolver.add_typedef(TypeDef {
            name: "DynArray".into(),
            kind: TypeKind::Array(ArrayType {
                container_attributes: Default::default(),
                size: ExprKind::FieldRef(FieldRefExpr {
                    path: vec!["count".into()],
                }),
                element_type: Box::new(TypeKind::Primitive(PrimitiveType::Integral(
                    IntegralType::U16,
                ))),
                jagged: false,
            }),
        });
        resolver.resolve_all().unwrap();

        let builder = IrBuilder::new(&resolver);
        let ir = builder.build_all().unwrap();
        let ty = ir.types.iter().find(|t| t.type_name == "DynArray").unwrap();
        match &ty.root {
            IrNode::AlignUp(align) => match align.node.as_ref() {
                IrNode::MulChecked(_) => {}
                other => panic!("expected mulchecked node, got {:?}", other),
            },
            other => panic!("expected aligned mul node, got {:?}", other),
        }
    }

    #[test]
    fn builder_emits_nested_mul_for_two_dimensional_array() {
        let mut resolver = TypeResolver::new();
        resolver.add_typedef(TypeDef {
            name: "Matrix".into(),
            kind: TypeKind::Array(ArrayType {
                container_attributes: Default::default(),
                size: ExprKind::FieldRef(FieldRefExpr {
                    path: vec!["rows".into()],
                }),
                element_type: Box::new(TypeKind::Array(ArrayType {
                    container_attributes: Default::default(),
                    size: ExprKind::FieldRef(FieldRefExpr {
                        path: vec!["cols".into()],
                    }),
                    element_type: Box::new(TypeKind::Primitive(PrimitiveType::Integral(
                        IntegralType::U16,
                    ))),
                    jagged: false,
                })),
                jagged: false,
            }),
        });
        resolver.resolve_all().unwrap();

        let builder = IrBuilder::new(&resolver);
        let ir = builder.build_all().unwrap();
        let ty = ir.types.iter().find(|t| t.type_name == "Matrix").unwrap();
        let mut param_names: Vec<&str> = ty.parameters.iter().map(|p| p.name.as_str()).collect();
        param_names.sort();
        assert_eq!(
            param_names,
            vec!["array.element.cols", "array.rows"],
            "expected canonical parameter names for both dimensions"
        );

        let outer_align = match &ty.root {
            IrNode::AlignUp(node) => node,
            other => panic!("expected align node, got {:?}", other),
        };
        let outer_mul = match outer_align.node.as_ref() {
            IrNode::MulChecked(node) => node,
            other => panic!("expected mulchecked node for rows, got {:?}", other),
        };
        match outer_mul.left.as_ref() {
            IrNode::FieldRef(field_ref) => {
                let param = field_ref.parameter.as_deref().expect("parameter");
                assert_eq!(param, "array.rows");
            }
            other => panic!("expected field ref for rows, got {:?}", other),
        }

        let inner_align = match outer_mul.right.as_ref() {
            IrNode::AlignUp(node) => node,
            other => panic!("expected inner align node, got {:?}", other),
        };
        let inner_mul = match inner_align.node.as_ref() {
            IrNode::MulChecked(node) => node,
            other => panic!("expected inner mulchecked node, got {:?}", other),
        };
        match inner_mul.left.as_ref() {
            IrNode::FieldRef(field_ref) => {
                let param = field_ref.parameter.as_deref().expect("parameter");
                assert_eq!(param, "array.element.cols");
            }
            other => panic!("expected field ref for cols, got {:?}", other),
        }
        match inner_mul.right.as_ref() {
            IrNode::AlignUp(node) => match node.node.as_ref() {
                IrNode::Const(const_node) => assert_eq!(const_node.value, 2),
                other => panic!("expected const primitive size, got {:?}", other),
            },
            IrNode::Const(const_node) => assert_eq!(const_node.value, 2),
            other => panic!("expected primitive const contribution, got {:?}", other),
        }
    }

    #[test]
    fn builder_detects_dependency_cycles() {
        let mut resolver = TypeResolver::new();
        resolver.add_typedef(TypeDef {
            name: "A".into(),
            kind: TypeKind::Struct(StructType {
                container_attributes: Default::default(),
                fields: vec![StructField {
                    name: "b".into(),
                    field_type: TypeKind::TypeRef(TypeRefType {
                        name: "B".into(),
                        comment: None,
                    }),
                }],
            }),
        });
        resolver.add_typedef(TypeDef {
            name: "B".into(),
            kind: TypeKind::Struct(StructType {
                container_attributes: Default::default(),
                fields: vec![StructField {
                    name: "a".into(),
                    field_type: TypeKind::TypeRef(TypeRefType {
                        name: "A".into(),
                        comment: None,
                    }),
                }],
            }),
        });

        let builder = IrBuilder::new(&resolver);
        let err = builder.build_all().unwrap_err();
        match err {
            IrBuildError::DependencyCycle { cycle } => {
                assert!(cycle.contains(&"A".to_string()));
                assert!(cycle.contains(&"B".to_string()));
            }
            other => panic!("expected dependency cycle error, got {:?}", other),
        }
    }

    #[test]
    fn builder_typeref_passes_parameters() {
        let mut resolver = TypeResolver::new();
        resolver.add_typedef(TypeDef {
            name: "Inner".into(),
            kind: TypeKind::Struct(StructType {
                container_attributes: Default::default(),
                fields: vec![StructField {
                    name: "value".into(),
                    field_type: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U32)),
                }],
            }),
        });
        resolver.add_typedef(TypeDef {
            name: "InnerAlias".into(),
            kind: TypeKind::TypeRef(crate::abi::types::TypeRefType {
                name: "Inner".into(),
                comment: None,
            }),
        });
        resolver.resolve_all().unwrap();

        let builder = IrBuilder::new(&resolver);
        let ir = builder.build_all().unwrap();
        let alias_ir = ir
            .types
            .iter()
            .find(|t| t.type_name == "InnerAlias")
            .expect("alias type");
        assert!(alias_ir.parameters.is_empty());
        match &alias_ir.root {
            IrNode::CallNested(call) => {
                assert_eq!(call.type_name, "Inner");
                assert!(call.arguments.is_empty());
            }
            other => panic!("expected CallNested node, got {:?}", other),
        }
    }

    #[test]
    fn builder_ir_is_deterministic_across_insertion_orders() {
        fn add_typedef(resolver: &mut TypeResolver, name: &str) {
            match name {
                "Leaf" => resolver.add_typedef(TypeDef {
                    name: "Leaf".into(),
                    kind: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U16)),
                }),
                "Node" => resolver.add_typedef(TypeDef {
                    name: "Node".into(),
                    kind: TypeKind::Struct(StructType {
                        container_attributes: Default::default(),
                        fields: vec![
                            StructField {
                                name: "len".into(),
                                field_type: TypeKind::Primitive(PrimitiveType::Integral(
                                    IntegralType::U8,
                                )),
                            },
                            StructField {
                                name: "payload".into(),
                                field_type: TypeKind::Array(ArrayType {
                                    container_attributes: Default::default(),
                                    size: ExprKind::FieldRef(FieldRefExpr {
                                        path: vec!["len".into()],
                                    }),
                                    element_type: Box::new(TypeKind::TypeRef(
                                        crate::abi::types::TypeRefType {
                                            name: "Leaf".into(),
                                            comment: None,
                                        },
                                    )),
                                    jagged: false,
                                }),
                            },
                        ],
                    }),
                }),
                other => panic!("unknown typedef {other}"),
            }
        }

        fn build_serialized(order: &[&str]) -> (String, Vec<u8>) {
            let mut resolver = TypeResolver::new();
            for name in order {
                add_typedef(&mut resolver, name);
            }
            resolver.resolve_all().unwrap();
            let builder = IrBuilder::new(&resolver);
            let ir = builder.build_all().unwrap();
            let json = layout_ir_to_json(&ir).unwrap();
            let proto = layout_ir_to_protobuf(&ir).unwrap();
            (json, proto)
        }

        let (json_a, proto_a) = build_serialized(&["Leaf", "Node"]);
        let (json_b, proto_b) = build_serialized(&["Node", "Leaf"]);
        assert_eq!(json_a, json_b);
        assert_eq!(proto_a, proto_b);
    }

    #[test]
    fn builder_emits_switch_for_size_discriminated_union() {
        let mut resolver = TypeResolver::new();
        resolver.add_typedef(TypeDef {
            name: "Payload".into(),
            kind: TypeKind::SizeDiscriminatedUnion(SizeDiscriminatedUnionType {
                container_attributes: Default::default(),
                variants: vec![
                    SizeDiscriminatedVariant {
                        name: "FourBytes".into(),
                        expected_size: 4,
                        variant_type: TypeKind::Primitive(PrimitiveType::Integral(
                            IntegralType::U32,
                        )),
                    },
                    SizeDiscriminatedVariant {
                        name: "EightBytes".into(),
                        expected_size: 8,
                        variant_type: TypeKind::Primitive(PrimitiveType::Integral(
                            IntegralType::U64,
                        )),
                    },
                ],
            }),
        });
        resolver.resolve_all().unwrap();

        let builder = IrBuilder::new(&resolver);
        let ir = builder.build_all().unwrap();
        let ty = ir.types.iter().find(|t| t.type_name == "Payload").unwrap();
        assert!(
            ty.parameters
                .iter()
                .any(|param| param.name.ends_with(".payload_size")),
            "expected synthetic payload size parameter"
        );

        match &ty.root {
            IrNode::Switch(node) => {
                assert_eq!(node.cases.len(), 2);
                assert!(node.tag.ends_with(".payload_size"));
                let mut sizes: Vec<u64> = node.cases.iter().map(|case| case.tag_value).collect();
                sizes.sort();
                assert_eq!(sizes, vec![4, 8]);
                for case in &node.cases {
                    match case.node.as_ref() {
                        IrNode::AlignUp(align) => match align.node.as_ref() {
                            IrNode::Const(const_node) => {
                                assert_eq!(const_node.value, case.tag_value)
                            }
                            IrNode::ZeroSize { .. } => assert_eq!(case.tag_value, 0),
                            other => panic!("expected const node per variant, got {:?}", other),
                        },
                        other => panic!("expected aligned const node, got {:?}", other),
                    }
                }
            }
            other => panic!("expected switch node, got {:?}", other),
        }
    }
}
