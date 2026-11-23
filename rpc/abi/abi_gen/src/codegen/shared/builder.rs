use super::ir::*;
use crate::abi::expr::{ExprKind, LiteralExpr};
use crate::abi::layout_graph::{LayoutGraph, LayoutGraphError};
use crate::abi::resolved::{
    ResolvedField, ResolvedType, ResolvedTypeKind, Size, TypeResolver, qualify_struct_path,
};
use std::collections::{BTreeMap, BTreeSet, HashSet};
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
    /* TypeScript only: size values whose byte size their own bytes decide
    (unions with variable-size variants) by a `payload_size` parameter. */
    payload_size_params: bool,
}

impl<'a> IrBuilder<'a> {
    pub fn new(resolver: &'a TypeResolver) -> Self {
        Self {
            resolver,
            payload_size_params: false,
        }
    }

    /// IR for the TypeScript backend. A union with a variable-size variant
    /// spans its largest variant over the same bytes, which no parameter of
    /// its variants fixes: as a root it is sized by `<T>.payload_size`, and a
    /// struct field holding one (inline or by type-ref) by
    /// `<field>.payload_size`. Struct fields whose own bytes decide their
    /// size (non-tail enums with such a variant, inline structs sized by their
    /// own counts) and jagged arrays get `<field>.payload_size` too. The
    /// other backends do not use these.
    pub fn for_typescript(resolver: &'a TypeResolver) -> Self {
        Self {
            resolver,
            payload_size_params: true,
        }
    }

    /* Whether struct field `field` of `parent` is sized by `<field>.payload_size`. */
    fn is_payload_field(&self, parent: &ResolvedType, field: &ResolvedField) -> bool {
        if !self.payload_size_params {
            return false;
        }
        let ty = &field.field_type;
        match &ty.kind {
            ResolvedTypeKind::Union { .. } => matches!(ty.size, Size::Variable(_)),
            ResolvedTypeKind::TypeRef { target_name, .. } => self
                .resolver
                .get_type_info(target_name)
                .map_or(false, |target| {
                    matches!(target.kind, ResolvedTypeKind::Union { .. })
                        && matches!(target.size, Size::Variable(_))
                }),
            ResolvedTypeKind::Enum { .. } => {
                /* Tail enums already carry the resolver's `<field>.payload_size`. */
                let has_resolver_payload = parent
                    .dynamic_params
                    .get(&field.name)
                    .map_or(false, |refs| {
                        refs.keys().any(|p| p.ends_with(".payload_size"))
                    });
                !has_resolver_payload && is_self_sized(ty)
            }
            /* An inline variable-size struct (`{ n, bytes[n], count }`, or one
            sized by an enclosing field through `..`): its byte size. */
            ResolvedTypeKind::Struct { .. } => matches!(ty.size, Size::Variable(_)),
            /* Inline variable-size elements that are not an enum stride
            (`{ tag, body: enum by tag }`): sized by their byte total. */
            ResolvedTypeKind::Array { element_type, .. } => {
                matches!(element_type.size, Size::Variable(_))
                    && !matches!(element_type.kind, ResolvedTypeKind::TypeRef { .. })
                    && !is_enum_stride(element_type)
            }
            _ => false,
        }
    }

    /* Dynamic params of `ty` without those a payload field's size replaces:
    everything owned by a union field, and an enum field's variant refs. */
    fn root_dynamic_params(
        &self,
        ty: &ResolvedType,
    ) -> BTreeMap<String, BTreeMap<String, crate::abi::types::PrimitiveType>> {
        let ResolvedTypeKind::Struct { fields, .. } = &ty.kind else {
            return ty.dynamic_params.clone();
        };
        let mut out = BTreeMap::new();
        for (owner, refs) in &ty.dynamic_params {
            let field = fields
                .iter()
                .find(|f| &f.name == owner && self.is_payload_field(ty, f));
            let is_array = fields.iter().any(|f| {
                &f.name == owner && matches!(f.field_type.kind, ResolvedTypeKind::Array { .. })
            });
            let kept: BTreeMap<_, _> = match field.map(|f| &f.field_type.kind) {
                /* An array element's own references are read per element. */
                None if self.payload_size_params && is_array => refs
                    .iter()
                    .filter(|(path, _)| {
                        let local = path
                            .strip_prefix(&format!("{owner}."))
                            .unwrap_or(path.as_str());
                        !local.starts_with("element.")
                    })
                    .map(|(k, v)| (k.clone(), v.clone()))
                    .collect(),
                None => refs.clone(),
                Some(ResolvedTypeKind::Enum { variants, .. }) => refs
                    .iter()
                    .filter(|(path, _)| {
                        let local = path
                            .strip_prefix(&format!("{owner}."))
                            .unwrap_or(path.as_str());
                        !variants
                            .iter()
                            .any(|v| local.starts_with(&format!("{}.", v.name)))
                    })
                    .map(|(k, v)| (k.clone(), v.clone()))
                    .collect(),
                Some(_) => BTreeMap::new(),
            };
            if !kept.is_empty() {
                out.insert(owner.clone(), kept);
            }
        }
        out
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
        if self.payload_size_params
            && matches!(ty.kind, ResolvedTypeKind::Union { .. })
            && matches!(ty.size, Size::Variable(_))
        {
            let mut params = ParameterRegistry::default();
            let name = params.add_synthetic(
                &ty.name,
                "__payload_size",
                Some(format!("{}.payload_size", ty.name)),
                Some("Byte size of the union: its largest variant over these bytes".into()),
                false,
            );
            let root = Self::align_node(
                IrNode::FieldRef(FieldRefNode {
                    path: "payload_size".into(),
                    parameter: Some(name),
                    meta: NodeMetadata::default(),
                }),
                ty.alignment,
            );
            return Ok(TypeIr {
                type_name: ty.name.clone(),
                alignment: ty.alignment,
                root,
                parameters: params.into_parameters(),
            });
        }
        let mut params = ParameterRegistry::from_dynamic(&self.root_dynamic_params(ty));
        /* TypeScript: a top-level enum whose variants share one size still
        takes its tag as a parameter, so validation checks it (as C, Rust and
        Go do with the tag their callers pass). */
        let root = match &ty.kind {
            ResolvedTypeKind::Enum {
                tag_expression: ExprKind::FieldRef(tag),
                ..
            } if self.payload_size_params && matches!(ty.size, Size::Const(_)) => {
                params.ensure(
                    &ty.name,
                    &tag.path.join("."),
                    Some("Enum tag the enclosing type stores".into()),
                    false,
                );
                self.build_enum_node(ty, &mut params)?
            }
            _ => self.node_from_resolved(ty, &mut params)?,
        };
        let mut parameters = filter_jagged_element_parameters(ty, params.into_parameters());
        /* TypeScript sizes a `__buffer_size` layout from params by that size. */
        if self.payload_size_params
            && reads_buffer_size(&root)
            && !parameters.iter().any(|p| p.name == "__buffer_size")
        {
            parameters.push(IrParameter {
                name: "__buffer_size".into(),
                description: Some("Byte size of the buffer the value spans".into()),
                derived: false,
            });
        }
        Ok(TypeIr {
            type_name: ty.name.clone(),
            alignment: ty.alignment,
            root,
            parameters,
        })
    }

    /// Builds IR for a resolved type by name.
    pub fn build_type_name(&self, type_name: &str) -> Result<TypeIr, IrBuildError> {
        let ty =
            self.resolver
                .get_type_info(type_name)
                .ok_or_else(|| IrBuildError::MissingType {
                    type_name: type_name.to_string(),
                })?;
        self.build_type(ty)
    }

    fn node_from_resolved(
        &self,
        ty: &ResolvedType,
        params: &mut ParameterRegistry,
    ) -> Result<IrNode, IrBuildError> {
        match &ty.kind {
            ResolvedTypeKind::Primitive { .. } => Self::const_node(ty),
            ResolvedTypeKind::TypeRef { .. } => self.build_typeref_node(ty, params),
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

    /* The value of `sizeof(T)` / `alignof(T)` for a constant-size `T`. */
    fn type_constant(&self, expr: &ExprKind) -> Option<u64> {
        match expr {
            ExprKind::Sizeof(e) => match self.resolver.get_type_info(&e.type_name)?.size {
                Size::Const(size) => Some(size),
                Size::Variable(_) => None,
            },
            ExprKind::Alignof(e) => Some(self.resolver.get_type_info(&e.type_name)?.alignment),
            _ => None,
        }
    }

    /* The element size of an array of inline enums whose variants all have a
    constant size and whose tag is a plain reference outside the element. */
    fn enum_stride_node(
        &self,
        element: &ResolvedType,
        owner: &str,
        params: &mut ParameterRegistry,
    ) -> Option<IrNode> {
        let ResolvedTypeKind::Enum {
            tag_expression: ExprKind::FieldRef(tag),
            variants,
            ..
        } = &element.kind
        else {
            return None;
        };
        if !matches!(element.size, Size::Variable(_)) {
            return None;
        }
        let mut cases = Vec::new();
        for variant in variants {
            let Size::Const(size) = variant.variant_type.size else {
                return None;
            };
            cases.push(SwitchCase {
                tag_value: variant.tag_value,
                node: Box::new(Self::const_or_zero(size, 1)),
                parameters: Vec::new(),
            });
        }
        let path = tag.path.join(".");
        let idx = params.ensure(owner, &path, None, false);
        Some(IrNode::Switch(SwitchNode {
            tag: params.params[idx].name.clone(),
            cases,
            default: None,
            meta: NodeMetadata::default(),
        }))
    }

    /* TypeScript: a named type's own outside references (a top-level enum's
    tag `kind`) name fields of the struct holding it; bind those call
    arguments to `<field>.<path>` params read from the holder. */
    fn bind_context_args(
        &self,
        parent: &ResolvedType,
        field: &ResolvedField,
        target_name: &str,
        node: &mut IrNode,
        params: &mut ParameterRegistry,
    ) {
        let (IrNode::CallNested(call), ResolvedTypeKind::Struct { fields, .. }) =
            (node, &parent.kind)
        else {
            return;
        };
        let Some(target) = self.resolver.get_type_info(target_name) else {
            return;
        };
        let Some(refs) = target.dynamic_params.get(target_name) else {
            return;
        };
        for path in refs.keys() {
            let head = path.split('.').next().unwrap_or("");
            if !fields
                .iter()
                .any(|f| f.name == head && f.name != field.name)
            {
                continue;
            }
            let idx = params.ensure(&field.name, path, None, false);
            let source = params.params[idx].name.clone();
            let name = canonical_name(target_name, path);
            for arg in call.arguments.iter_mut().filter(|arg| arg.name == name) {
                arg.value = source.clone();
            }
            /* The callee-named parameter `collect_callee_arguments` added is
            no longer read: keep it out of the params surface. */
            params.mark_derived(target_name, path);
        }
    }

    fn build_typeref_node(
        &self,
        ty: &ResolvedType,
        params: &mut ParameterRegistry,
    ) -> Result<IrNode, IrBuildError> {
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

        let arguments = self.collect_callee_arguments(target, params);
        Ok(IrNode::CallNested(CallNestedNode {
            type_name: target_name.clone(),
            arguments,
            meta: NodeMetadata::aligned(ty.alignment),
        }))
    }

    fn collect_callee_arguments(
        &self,
        ty: &ResolvedType,
        params: &mut ParameterRegistry,
    ) -> Vec<IrArgument> {
        let mut args = Vec::new();
        for (owner, refs) in &ty.dynamic_params {
            for path in refs.keys() {
                let name = canonical_name(owner, path);
                params.ensure(owner, path, None, false);
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
        let ResolvedTypeKind::Struct { fields, packed, .. } = &ty.kind else {
            return Err(IrBuildError::UnsupportedSize {
                type_name: ty.name.clone(),
            });
        };

        let mut nodes: Vec<IrNode> = Vec::new();
        let mut prefix_end = 0;
        for field in fields {
            /* A packed struct places fields back to back, so a field's size
            is not rounded up to its type's alignment. */
            let field_align = if *packed {
                1
            } else {
                field.field_type.alignment
            };
            /* Preserve resolved padding through the first variable-sized field. */
            if let Some(offset) = field.offset {
                if offset > prefix_end {
                    nodes.push(Self::const_or_zero(offset - prefix_end, 1));
                }
                if let Size::Const(size) = field.field_type.size {
                    prefix_end = offset + size;
                }
            }
            let mut extend_field_dynamic = true;
            let field_node = match &field.field_type.size {
                Size::Variable(_) if self.is_payload_field(ty, field) => {
                    extend_field_dynamic = false;
                    let idx = params.ensure(
                        &field.name,
                        "payload_size",
                        Some(format!("Byte size of field '{}'", field.name)),
                        false,
                    );
                    let param = params.params[idx].name.clone();
                    let node = match &field.field_type.kind {
                        ResolvedTypeKind::TypeRef { target_name, .. } => {
                            IrNode::CallNested(CallNestedNode {
                                type_name: target_name.clone(),
                                arguments: vec![IrArgument {
                                    name: format!("{target_name}.payload_size"),
                                    value: param,
                                }],
                                meta: NodeMetadata::aligned(field.field_type.alignment),
                            })
                        }
                        _ => IrNode::FieldRef(FieldRefNode {
                            path: format!("{}.payload_size", field.name),
                            parameter: Some(param),
                            meta: NodeMetadata::default(),
                        }),
                    };
                    Self::align_node(node, field_align)
                }
                Size::Const(value) => Self::const_or_zero(*value, field_align),
                Size::Variable(_) => match &field.field_type.kind {
                    ResolvedTypeKind::Array {
                        element_type,
                        jagged,
                        ..
                    } => {
                        /* An enum stride reads its tag from this struct; the
                        element's own references are not parameters. */
                        if self.payload_size_params && is_enum_stride(element_type) {
                            extend_field_dynamic = false;
                        }
                        /* TypeScript sizes a jagged array from params by its
                        byte total (`sumOverArray` reads `<field>.payload_size`
                        when no buffer is given). */
                        if self.payload_size_params
                            && *jagged
                            && matches!(element_type.size, Size::Variable(_))
                            && matches!(element_type.kind, ResolvedTypeKind::TypeRef { .. })
                        {
                            params.ensure(
                                &field.name,
                                "payload_size",
                                Some(format!("Byte size of jagged array '{}'", field.name)),
                                false,
                            );
                        }
                        self.build_array_node_with_prefix(
                            &field.field_type,
                            params,
                            &field.name,
                            "",
                            &ty.name,
                        )?
                    }
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
                        Self::align_node(node, field_align)
                    }
                    ResolvedTypeKind::SizeDiscriminatedUnion { .. } => {
                        let node =
                            self.build_size_discriminated_union_node(&field.field_type, params)?;
                        Self::align_node(node, field_align)
                    }
                    ResolvedTypeKind::TypeRef { target_name, .. } => {
                        extend_field_dynamic = false;
                        let mut node = self.build_typeref_node(&field.field_type, params)?;
                        if self.payload_size_params {
                            self.bind_context_args(ty, field, target_name, &mut node, params);
                        }
                        Self::align_node(node, field_align)
                    }
                    ResolvedTypeKind::Struct { .. } => {
                        /* Its references are already parameters of this
                        struct, under the names the inline build maps to. */
                        extend_field_dynamic = false;
                        let mut node = self.build_inline_struct_node(ty, field, params)?;
                        /* Its `__buffer_size` is the bytes left for it: this
                        struct's, less the bytes before the field. */
                        if reads_buffer_size(&node) && !nodes.is_empty() {
                            /* Each read gets its own copy of the bytes before
                            the field, and a later sibling copies this one
                            again, so the tree doubles per such sibling.
                            Check the size the copies give before making
                            them. */
                            let copy = nodes
                                .iter()
                                .map(ir_node_count)
                                .fold(nodes.len() + 3, usize::saturating_add);
                            let grown = buffer_size_reads(&node)
                                .saturating_mul(copy)
                                .saturating_add(ir_node_count(&node));
                            if grown > MAX_IR_NODES {
                                return Err(IrBuildError::TooManyNodes {
                                    type_name: ty.name.clone(),
                                    limit: MAX_IR_NODES,
                                });
                            }
                            let mut offset = self.combine_checked_add(nodes.clone(), &ty.name)?;
                            if !*packed {
                                offset = Self::align_node(offset, field.field_type.alignment);
                            }
                            let available = IrNode::SubChecked(BinaryOpNode {
                                left: Box::new(Self::buffer_size_node()),
                                right: Box::new(offset),
                                meta: NodeMetadata::default(),
                            });
                            replace_buffer_size(&mut node, &available);
                        }
                        Self::align_node(node, field_align)
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

    /* A variable-size inline struct is sized like a named one, from all of
    its fields (fixed ones and array element widths included), but its
    references are parameters of the struct holding it. The resolver names
    each one there with `qualify_struct_path`, so the inline build's
    parameter names are mapped to those; any other parameter the build adds
    keeps a name of its own (see below). */
    fn build_inline_struct_node(
        &self,
        parent: &ResolvedType,
        field: &ResolvedField,
        params: &mut ParameterRegistry,
    ) -> Result<IrNode, IrBuildError> {
        let inline = &field.field_type;
        let mut inner = ParameterRegistry::from_dynamic(&inline.dynamic_params);
        let mut node = self.build_variable_struct(inline, &mut inner)?;

        let parent_fields: HashSet<String> = match &parent.kind {
            ResolvedTypeKind::Struct { fields, .. } => {
                fields.iter().map(|f| f.name.clone()).collect()
            }
            _ => HashSet::new(),
        };
        let mut renames: BTreeMap<String, String> = BTreeMap::new();
        for (owner, refs) in &inline.dynamic_params {
            for path in refs.keys() {
                let Some(inner_name) = inner.lookup_name(owner, path) else {
                    continue;
                };
                let outer_path = qualify_struct_path(&field.name, path, &parent_fields);
                let idx = params.ensure(&field.name, &outer_path, None, false);
                renames.insert(inner_name.to_string(), params.params[idx].name.clone());
            }
        }
        /* Of the others, those named after a type inside this inline struct
        (`Outer::inner::body.computed_tag`, `..payload_size`) keep their
        names: the derived-tag lookup and parameter extraction find them by
        those, and the type name already tells two inline structs apart. The
        rest, such as a named child's inputs (`items.n`), are named after
        fields, so they take this field's name (`left.items.n`) to stay
        apart from those of a sibling inline struct. */
        let qualified = format!("{}::", inline.name);
        for param in &inner.params {
            if !renames.contains_key(&param.name) {
                let outer_name = if param.name.starts_with(&qualified) {
                    param.name.clone()
                } else {
                    format!("{}.{}", field.name, param.name)
                };
                let name = params.add_synthetic(
                    &field.name,
                    &param.name,
                    Some(outer_name),
                    param.description.clone(),
                    param.derived,
                );
                renames.insert(param.name.clone(), name);
            }
        }
        /* A parameter the inline build derives is derived here too. */
        for param in inner.params.iter().filter(|p| p.derived) {
            if let Some(outer) = renames.get(&param.name) {
                if let Some(target) = params.params.iter_mut().find(|p| &p.name == outer) {
                    target.derived = true;
                }
            }
        }
        rename_ir_parameters(&mut node, &renames);
        Ok(node)
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

        let count = match self.build_expr_ir(size_expr, owner, params, type_name, path_prefix) {
            Ok(count) => count,
            /* TypeScript: a count the IR cannot express (comparisons,
            short-circuit `&&` / `||`) is a derived `<owner>.computed_size`
            parameter that the TypeScript backend evaluates from the other
            params (checked u64, short-circuit), like a computed enum tag. */
            Err(IrBuildError::UnsupportedExpression { .. })
                if self.payload_size_params
                    && path_prefix.is_empty()
                    && ts_can_evaluate(size_expr) =>
            {
                let name = params.add_synthetic(
                    owner,
                    "__computed_size",
                    Some(format!("{owner}.computed_size")),
                    Some("Computed element count".into()),
                    true,
                );
                IrNode::FieldRef(FieldRefNode {
                    path: format!("{owner}.computed_size"),
                    parameter: Some(name),
                    meta: NodeMetadata::default(),
                })
            }
            Err(err) => return Err(err),
        };

        /* TypeScript: elements that are inline enums with constant-size
        variants selected by an outside tag all have one size (the stride),
        jagged or not, as in C and Rust: `count * switch(tag)`. */
        if self.payload_size_params {
            if let Some(stride) = self.enum_stride_node(element_type, owner, params) {
                /* Elements are laid out back to back at the selected
                variant's size (packed layout, as the measuring walk reads). */
                return Ok(IrNode::MulChecked(BinaryOpNode {
                    left: Box::new(count),
                    right: Box::new(stride),
                    meta: NodeMetadata::default(),
                }));
            }
        }

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

        params.extend_with(&element_type.dynamic_params);

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

        /* TypeScript: a constant tag selects one variant for good. */
        if self.payload_size_params {
            if let Some(tag) = constant_tag(tag_expr) {
                let variant = variants
                    .iter()
                    .find(|v| v.tag_value == tag)
                    .ok_or_else(|| IrBuildError::UnsupportedExpression {
                        type_name: ty.name.clone(),
                    })?;
                if let Size::Const(size) = variant.variant_type.size {
                    return Ok(Self::const_or_zero(size, 1));
                }
            }
        }

        let tag_name = self.enum_tag_parameter(tag_expr, &ty.name, params)?;
        let mut cases = Vec::new();

        for variant in variants {
            /* TypeScript: variants are payloads read in place (packed); an
            inline enum payload is sized by its own tag. */
            let variant_align = if self.payload_size_params {
                1
            } else {
                variant.variant_type.alignment
            };
            let stride = if self.payload_size_params {
                self.enum_stride_node(&variant.variant_type, &variant.name, params)
            } else {
                None
            };
            let node = match variant.variant_type.size {
                Size::Const(value) => Self::const_or_zero(value, variant_align),
                Size::Variable(_) if stride.is_some() => stride.unwrap_or(IrNode::ZeroSize {
                    meta: NodeMetadata::default(),
                }),
                Size::Variable(_) => {
                    let refs = ty.dynamic_params.get(&variant.name).ok_or_else(|| {
                        IrBuildError::MissingDynamicRefs {
                            type_name: ty.name.clone(),
                        }
                    })?;
                    let nodes =
                        self.build_field_ref_nodes(&variant.name, refs, params, &ty.name)?;
                    let acc = self.combine_checked_add(nodes, &ty.name)?;
                    Self::align_node(acc, variant_align)
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
        /* TypeScript: `sizeof` / `alignof` of a constant-size type are
        constants. */
        if self.payload_size_params {
            if let Some(value) = self.type_constant(expr) {
                return Ok(IrNode::Const(ConstNode {
                    value,
                    meta: NodeMetadata::default(),
                }));
            }
        }
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
                if raw_path == "__buffer_size" {
                    return Ok(Self::buffer_size_node());
                }
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
            ExprKind::Add(expr) => self.build_binary_expr_ir(
                &expr.left,
                &expr.right,
                owner,
                params,
                type_name,
                path_prefix,
                IrNode::AddChecked,
            ),
            ExprKind::Sub(expr) => self.build_binary_expr_ir(
                &expr.left,
                &expr.right,
                owner,
                params,
                type_name,
                path_prefix,
                IrNode::SubChecked,
            ),
            ExprKind::Mul(expr) => self.build_binary_expr_ir(
                &expr.left,
                &expr.right,
                owner,
                params,
                type_name,
                path_prefix,
                IrNode::MulChecked,
            ),
            ExprKind::Div(expr) => self.build_binary_expr_ir(
                &expr.left,
                &expr.right,
                owner,
                params,
                type_name,
                path_prefix,
                IrNode::DivChecked,
            ),
            ExprKind::Mod(expr) => self.build_binary_expr_ir(
                &expr.left,
                &expr.right,
                owner,
                params,
                type_name,
                path_prefix,
                IrNode::ModChecked,
            ),
            ExprKind::BitAnd(expr) => self.build_binary_expr_ir(
                &expr.left,
                &expr.right,
                owner,
                params,
                type_name,
                path_prefix,
                IrNode::BitAnd,
            ),
            ExprKind::BitOr(expr) => self.build_binary_expr_ir(
                &expr.left,
                &expr.right,
                owner,
                params,
                type_name,
                path_prefix,
                IrNode::BitOr,
            ),
            ExprKind::BitXor(expr) => self.build_binary_expr_ir(
                &expr.left,
                &expr.right,
                owner,
                params,
                type_name,
                path_prefix,
                IrNode::BitXor,
            ),
            ExprKind::LeftShift(expr) => self.build_binary_expr_ir(
                &expr.left,
                &expr.right,
                owner,
                params,
                type_name,
                path_prefix,
                IrNode::LeftShift,
            ),
            ExprKind::RightShift(expr) => self.build_binary_expr_ir(
                &expr.left,
                &expr.right,
                owner,
                params,
                type_name,
                path_prefix,
                IrNode::RightShift,
            ),
            _ => Err(IrBuildError::UnsupportedExpression {
                type_name: type_name.to_string(),
            }),
        }
    }

    fn build_binary_expr_ir(
        &self,
        left_expr: &ExprKind,
        right_expr: &ExprKind,
        owner: &str,
        params: &ParameterRegistry,
        type_name: &str,
        path_prefix: &str,
        build_node: fn(BinaryOpNode) -> IrNode,
    ) -> Result<IrNode, IrBuildError> {
        let left = self.build_expr_ir(left_expr, owner, params, type_name, path_prefix)?;
        let right = self.build_expr_ir(right_expr, owner, params, type_name, path_prefix)?;
        Ok(build_node(BinaryOpNode {
            left: Box::new(left),
            right: Box::new(right),
            meta: NodeMetadata::default(),
        }))
    }

    /* The bytes available to the value being sized (`__buffer_size`). */
    fn buffer_size_node() -> IrNode {
        IrNode::FieldRef(FieldRefNode {
            path: "__buffer_size".into(),
            parameter: None,
            meta: NodeMetadata::default(),
        })
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

/// Most nodes a variable-size inline struct reading `__buffer_size` may give
/// once its reads are replaced by the bytes before it (see
/// `build_variable_struct`). Past it the type's IR fails to build with
/// [`IrBuildError::TooManyNodes`]: the tree would double per such sibling.
pub const MAX_IR_NODES: usize = 1 << 16;

/* The number of nodes in `node`. */
fn ir_node_count(node: &IrNode) -> usize {
    let children = match node {
        IrNode::ZeroSize { .. }
        | IrNode::Const(_)
        | IrNode::FieldRef(_)
        | IrNode::CallNested(_) => 0,
        IrNode::AlignUp(align) => ir_node_count(&align.node),
        IrNode::Switch(switch) => switch
            .cases
            .iter()
            .map(|case| ir_node_count(&case.node))
            .chain(switch.default.as_deref().map(ir_node_count))
            .fold(0, usize::saturating_add),
        IrNode::AddChecked(op)
        | IrNode::SubChecked(op)
        | IrNode::MulChecked(op)
        | IrNode::DivChecked(op)
        | IrNode::ModChecked(op)
        | IrNode::BitAnd(op)
        | IrNode::BitOr(op)
        | IrNode::BitXor(op)
        | IrNode::LeftShift(op)
        | IrNode::RightShift(op) => {
            ir_node_count(&op.left).saturating_add(ir_node_count(&op.right))
        }
        IrNode::SumOverArray(sum) => ir_node_count(&sum.count),
    };
    children.saturating_add(1)
}

/* The number of `__buffer_size` reads in `node` that `replace_buffer_size`
 * replaces. */
fn buffer_size_reads(node: &IrNode) -> usize {
    match node {
        IrNode::FieldRef(field_ref) => usize::from(field_ref.path == "__buffer_size"),
        IrNode::ZeroSize { .. } | IrNode::Const(_) | IrNode::CallNested(_) => 0,
        IrNode::AlignUp(align) => buffer_size_reads(&align.node),
        IrNode::Switch(switch) => switch
            .cases
            .iter()
            .map(|case| buffer_size_reads(&case.node))
            .chain(switch.default.as_deref().map(buffer_size_reads))
            .fold(0, usize::saturating_add),
        IrNode::AddChecked(op)
        | IrNode::SubChecked(op)
        | IrNode::MulChecked(op)
        | IrNode::DivChecked(op)
        | IrNode::ModChecked(op)
        | IrNode::BitAnd(op)
        | IrNode::BitOr(op)
        | IrNode::BitXor(op)
        | IrNode::LeftShift(op)
        | IrNode::RightShift(op) => {
            buffer_size_reads(&op.left).saturating_add(buffer_size_reads(&op.right))
        }
        IrNode::SumOverArray(sum) => buffer_size_reads(&sum.count),
    }
}

/* Replaces every `__buffer_size` read in `node` (those `reads_buffer_size`
 * finds) by `available`. */
fn replace_buffer_size(node: &mut IrNode, available: &IrNode) {
    match node {
        IrNode::FieldRef(field_ref) if field_ref.path == "__buffer_size" => {
            *node = available.clone();
        }
        IrNode::ZeroSize { .. } | IrNode::Const(_) | IrNode::FieldRef(_) => {}
        IrNode::CallNested(_) => {}
        IrNode::AlignUp(align) => replace_buffer_size(&mut align.node, available),
        IrNode::Switch(switch) => {
            for case in &mut switch.cases {
                replace_buffer_size(&mut case.node, available);
            }
            if let Some(default) = switch.default.as_mut() {
                replace_buffer_size(default, available);
            }
        }
        IrNode::AddChecked(op)
        | IrNode::SubChecked(op)
        | IrNode::MulChecked(op)
        | IrNode::DivChecked(op)
        | IrNode::ModChecked(op)
        | IrNode::BitAnd(op)
        | IrNode::BitOr(op)
        | IrNode::BitXor(op)
        | IrNode::LeftShift(op)
        | IrNode::RightShift(op) => {
            replace_buffer_size(&mut op.left, available);
            replace_buffer_size(&mut op.right, available);
        }
        IrNode::SumOverArray(sum) => replace_buffer_size(&mut sum.count, available),
    }
}

/* Renames every parameter `node` reads (field references, switch tags,
 * nested-call arguments and case parameters) by `renames`. */
fn rename_ir_parameters(node: &mut IrNode, renames: &BTreeMap<String, String>) {
    let rename = |name: &mut String| {
        if let Some(new_name) = renames.get(name.as_str()) {
            *name = new_name.clone();
        }
    };
    match node {
        IrNode::ZeroSize { .. } | IrNode::Const(_) => {}
        IrNode::FieldRef(field_ref) => {
            /* The path names the parameter too, qualified as it is. */
            if let Some(new_name) = field_ref
                .parameter
                .as_deref()
                .and_then(|parameter| renames.get(parameter))
            {
                field_ref.path = new_name.clone();
                field_ref.parameter = Some(new_name.clone());
            }
        }
        IrNode::AlignUp(align) => rename_ir_parameters(&mut align.node, renames),
        IrNode::Switch(switch) => {
            rename(&mut switch.tag);
            for case in &mut switch.cases {
                for parameter in &mut case.parameters {
                    rename(&mut parameter.name);
                }
                rename_ir_parameters(&mut case.node, renames);
            }
            if let Some(default) = switch.default.as_mut() {
                rename_ir_parameters(default, renames);
            }
        }
        IrNode::CallNested(call) => {
            for argument in &mut call.arguments {
                rename(&mut argument.value);
            }
        }
        IrNode::AddChecked(op)
        | IrNode::SubChecked(op)
        | IrNode::MulChecked(op)
        | IrNode::DivChecked(op)
        | IrNode::ModChecked(op)
        | IrNode::BitAnd(op)
        | IrNode::BitOr(op)
        | IrNode::BitXor(op)
        | IrNode::LeftShift(op)
        | IrNode::RightShift(op) => {
            rename_ir_parameters(&mut op.left, renames);
            rename_ir_parameters(&mut op.right, renames);
        }
        IrNode::SumOverArray(sum) => rename_ir_parameters(&mut sum.count, renames),
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

/// Whether `ty` is an inline enum whose variants all have a constant size
/// and whose tag is a plain field reference: as an array element, every
/// element has the size its tag selects (one stride).
pub fn is_enum_stride(ty: &ResolvedType) -> bool {
    match &ty.kind {
        ResolvedTypeKind::Enum {
            tag_expression: ExprKind::FieldRef(_),
            variants,
            ..
        } => {
            matches!(ty.size, Size::Variable(_))
                && variants
                    .iter()
                    .all(|v| matches!(v.variant_type.size, Size::Const(_)))
        }
        _ => false,
    }
}

/* The value of a tag expression without field references. */
fn constant_tag(expr: &ExprKind) -> Option<u64> {
    use crate::abi::expr::ConstantExpression;
    if !expr.is_constant() {
        return None;
    }
    expr.try_evaluate_constant()
}

/// Whether the TypeScript backend can evaluate `expr` as a derived
/// parameter: everything but `__buffer_size`, which is not a parameter
/// (`sizeof` / `alignof` are folded to constants first).
pub fn ts_can_evaluate(expr: &ExprKind) -> bool {
    match expr {
        ExprKind::Literal(_) => true,
        ExprKind::FieldRef(f) => f.path.join(".") != "__buffer_size",
        /* The TypeScript backend folds these to constants. */
        ExprKind::Sizeof(_) | ExprKind::Alignof(_) => true,
        ExprKind::Add(e) => ts_can_evaluate(&e.left) && ts_can_evaluate(&e.right),
        ExprKind::Sub(e) => ts_can_evaluate(&e.left) && ts_can_evaluate(&e.right),
        ExprKind::Mul(e) => ts_can_evaluate(&e.left) && ts_can_evaluate(&e.right),
        ExprKind::Div(e) => ts_can_evaluate(&e.left) && ts_can_evaluate(&e.right),
        ExprKind::Mod(e) => ts_can_evaluate(&e.left) && ts_can_evaluate(&e.right),
        ExprKind::Pow(e) => ts_can_evaluate(&e.left) && ts_can_evaluate(&e.right),
        ExprKind::BitAnd(e) => ts_can_evaluate(&e.left) && ts_can_evaluate(&e.right),
        ExprKind::BitOr(e) => ts_can_evaluate(&e.left) && ts_can_evaluate(&e.right),
        ExprKind::BitXor(e) => ts_can_evaluate(&e.left) && ts_can_evaluate(&e.right),
        ExprKind::LeftShift(e) => ts_can_evaluate(&e.left) && ts_can_evaluate(&e.right),
        ExprKind::RightShift(e) => ts_can_evaluate(&e.left) && ts_can_evaluate(&e.right),
        ExprKind::Eq(e) => ts_can_evaluate(&e.left) && ts_can_evaluate(&e.right),
        ExprKind::Ne(e) => ts_can_evaluate(&e.left) && ts_can_evaluate(&e.right),
        ExprKind::Lt(e) => ts_can_evaluate(&e.left) && ts_can_evaluate(&e.right),
        ExprKind::Gt(e) => ts_can_evaluate(&e.left) && ts_can_evaluate(&e.right),
        ExprKind::Le(e) => ts_can_evaluate(&e.left) && ts_can_evaluate(&e.right),
        ExprKind::Ge(e) => ts_can_evaluate(&e.left) && ts_can_evaluate(&e.right),
        ExprKind::And(e) => ts_can_evaluate(&e.left) && ts_can_evaluate(&e.right),
        ExprKind::Or(e) => ts_can_evaluate(&e.left) && ts_can_evaluate(&e.right),
        ExprKind::Xor(e) => ts_can_evaluate(&e.left) && ts_can_evaluate(&e.right),
        ExprKind::BitNot(e) => ts_can_evaluate(&e.operand),
        ExprKind::Neg(e) => ts_can_evaluate(&e.operand),
        ExprKind::Not(e) => ts_can_evaluate(&e.operand),
        ExprKind::Popcount(e) => ts_can_evaluate(&e.operand),
    }
}

/* Whether `node` reads `__buffer_size`. */
fn reads_buffer_size(node: &IrNode) -> bool {
    match node {
        IrNode::FieldRef(f) => f.path == "__buffer_size",
        IrNode::AlignUp(a) => reads_buffer_size(&a.node),
        IrNode::Switch(sw) => {
            sw.cases.iter().any(|c| reads_buffer_size(&c.node))
                || sw.default.as_deref().map_or(false, reads_buffer_size)
        }
        IrNode::AddChecked(b)
        | IrNode::SubChecked(b)
        | IrNode::MulChecked(b)
        | IrNode::DivChecked(b)
        | IrNode::ModChecked(b)
        | IrNode::BitAnd(b)
        | IrNode::BitOr(b)
        | IrNode::BitXor(b)
        | IrNode::LeftShift(b)
        | IrNode::RightShift(b) => reads_buffer_size(&b.left) || reads_buffer_size(&b.right),
        IrNode::SumOverArray(n) => reads_buffer_size(&n.count),
        _ => false,
    }
}

/// Whether the byte size of `ty` depends on its own bytes: a union with a
/// variable-size variant, a size-discriminated union, a variable-size named
/// type, a jagged array, an array or struct sized by its own count fields,
/// or an enum with such a variant.
pub fn is_self_sized(ty: &ResolvedType) -> bool {
    if !matches!(ty.size, Size::Variable(_)) {
        return false;
    }
    match &ty.kind {
        ResolvedTypeKind::Union { .. }
        | ResolvedTypeKind::SizeDiscriminatedUnion { .. }
        | ResolvedTypeKind::TypeRef { .. } => true,
        ResolvedTypeKind::Array {
            element_type,
            jagged,
            ..
        } => *jagged || is_self_sized(element_type),
        ResolvedTypeKind::Enum { variants, .. } => {
            variants.iter().any(|v| is_self_sized(&v.variant_type))
        }
        ResolvedTypeKind::Struct { fields, .. } => fields.iter().enumerate().any(|(i, f)| {
            is_self_sized(&f.field_type) || sized_by_earlier_field(&f.field_type, &fields[..i])
        }),
        ResolvedTypeKind::Primitive { .. } => false,
    }
}

fn sized_by_earlier_field(ty: &ResolvedType, earlier: &[ResolvedField]) -> bool {
    let expr = match &ty.kind {
        ResolvedTypeKind::Array {
            size_expression, ..
        } if matches!(ty.size, Size::Variable(_)) => size_expression,
        ResolvedTypeKind::Enum { tag_expression, .. } if matches!(ty.size, Size::Variable(_)) => {
            tag_expression
        }
        _ => return false,
    };
    let mut paths = Vec::new();
    collect_ref_heads(expr, &mut paths);
    paths
        .iter()
        .any(|head| earlier.iter().any(|f| &f.name == head))
}

fn collect_ref_heads(expr: &ExprKind, out: &mut Vec<String>) {
    match expr {
        ExprKind::FieldRef(f) => {
            /* `..` names an enclosing struct's field, never this one's. */
            let mut segments = f
                .path
                .iter()
                .flat_map(|s| s.split('/'))
                .filter(|s| !s.is_empty() && *s != ".");
            if let Some(head) = segments.next() {
                if head != ".." {
                    out.push(head.to_string());
                }
            }
        }
        ExprKind::Add(e) => {
            collect_ref_heads(&e.left, out);
            collect_ref_heads(&e.right, out);
        }
        ExprKind::Sub(e) => {
            collect_ref_heads(&e.left, out);
            collect_ref_heads(&e.right, out);
        }
        ExprKind::Mul(e) => {
            collect_ref_heads(&e.left, out);
            collect_ref_heads(&e.right, out);
        }
        ExprKind::Div(e) => {
            collect_ref_heads(&e.left, out);
            collect_ref_heads(&e.right, out);
        }
        ExprKind::Mod(e) => {
            collect_ref_heads(&e.left, out);
            collect_ref_heads(&e.right, out);
        }
        ExprKind::BitAnd(e) => {
            collect_ref_heads(&e.left, out);
            collect_ref_heads(&e.right, out);
        }
        ExprKind::BitOr(e) => {
            collect_ref_heads(&e.left, out);
            collect_ref_heads(&e.right, out);
        }
        ExprKind::LeftShift(e) => {
            collect_ref_heads(&e.left, out);
            collect_ref_heads(&e.right, out);
        }
        ExprKind::RightShift(e) => {
            collect_ref_heads(&e.left, out);
            collect_ref_heads(&e.right, out);
        }
        ExprKind::Popcount(e) => collect_ref_heads(&e.operand, out),
        _ => {}
    }
}

fn filter_jagged_element_parameters(
    root_type: &ResolvedType,
    parameters: Vec<IrParameter>,
) -> Vec<IrParameter> {
    parameters
        .into_iter()
        .filter(|param| !is_jagged_element_parameter(root_type, &param.name))
        .collect()
}

fn is_jagged_element_parameter(root_type: &ResolvedType, parameter: &str) -> bool {
    let normalized = parameter.replace("::", ".");
    let segments: Vec<&str> = normalized.split('.').collect();
    let Some(element_idx) = segments.iter().position(|segment| *segment == "element") else {
        return false;
    };
    if element_idx == 0 {
        return false;
    }

    let array_field_name = segments[element_idx - 1];
    let ResolvedTypeKind::Struct { fields, .. } = &root_type.kind else {
        return false;
    };
    fields.iter().any(|field| {
        field.name == array_field_name
            && matches!(
                field.field_type.kind,
                ResolvedTypeKind::Array { jagged: true, .. }
            )
    })
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
    #[error("type '{type_name}' layout IR would exceed {limit} nodes")]
    TooManyNodes { type_name: String, limit: usize },
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::abi::expr::{ExprKind, FieldRefExpr, LiteralExpr};
    use crate::abi::types::{
        ArrayType, EnumType, EnumVariant, IntegralType, PrimitiveType, SizeDiscriminatedUnionType,
        SizeDiscriminatedVariant, StructField, StructType, TypeDef, TypeKind, TypeRefType,
        UnionType, UnionVariant,
    };
    use crate::codegen::shared::serialization::{layout_ir_to_json, layout_ir_to_protobuf};

    fn contains_node(node: &IrNode, pred: fn(&IrNode) -> bool) -> bool {
        if pred(node) {
            return true;
        }
        match node {
            IrNode::ZeroSize { .. } | IrNode::Const(_) | IrNode::FieldRef(_) => false,
            IrNode::AlignUp(node) => contains_node(&node.node, pred),
            IrNode::Switch(node) => {
                node.cases
                    .iter()
                    .any(|case| contains_node(&case.node, pred))
                    || node
                        .default
                        .as_ref()
                        .map(|default| contains_node(default, pred))
                        .unwrap_or(false)
            }
            IrNode::CallNested(_) => false,
            IrNode::AddChecked(node)
            | IrNode::SubChecked(node)
            | IrNode::MulChecked(node)
            | IrNode::DivChecked(node)
            | IrNode::ModChecked(node)
            | IrNode::BitAnd(node)
            | IrNode::BitOr(node)
            | IrNode::BitXor(node)
            | IrNode::LeftShift(node)
            | IrNode::RightShift(node) => {
                contains_node(&node.left, pred) || contains_node(&node.right, pred)
            }
            IrNode::SumOverArray(node) => contains_node(&node.count, pred),
        }
    }

    #[test]
    fn builder_emits_const_node_for_primitives() {
        let mut resolver = TypeResolver::new();
        resolver.add_typedef(TypeDef {
            name: "U32".into(),
            format: None,
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
    fn builder_emits_fieldref_for_dynamic_struct() {
        let mut resolver = TypeResolver::new();
        resolver.add_typedef(TypeDef {
            name: "VarStruct".into(),
            format: None,
            kind: TypeKind::Struct(StructType {
                display: Default::default(),
                container_attributes: Default::default(),
                fields: vec![
                    StructField {
                        name: "len".into(),
                        format: None,
                        field_type: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U32)),
                    },
                    StructField {
                        name: "data".into(),
                        format: None,
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
    fn builder_lowers_flag_bit_dynamic_array_size() {
        let mut resolver = TypeResolver::new();
        resolver.add_typedef(TypeDef {
            name: "FlaggedTail".into(),
            format: None,
            kind: TypeKind::Struct(StructType {
                display: Default::default(),
                container_attributes: Default::default(),
                fields: vec![
                    StructField {
                        name: "flags".into(),
                        format: None,
                        field_type: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U8)),
                    },
                    StructField {
                        name: "tail".into(),
                        format: None,
                        field_type: TypeKind::Array(ArrayType {
                            container_attributes: Default::default(),
                            size: ExprKind::Mul(crate::abi::expr::MulExpr {
                                left: Box::new(ExprKind::BitAnd(crate::abi::expr::BitAndExpr {
                                    left: Box::new(ExprKind::RightShift(
                                        crate::abi::expr::RightShiftExpr {
                                            left: Box::new(ExprKind::FieldRef(FieldRefExpr {
                                                path: vec!["flags".into()],
                                            })),
                                            right: Box::new(ExprKind::Literal(LiteralExpr::U8(6))),
                                        },
                                    )),
                                    right: Box::new(ExprKind::Literal(LiteralExpr::U8(1))),
                                })),
                                right: Box::new(ExprKind::Literal(LiteralExpr::U64(16))),
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
        let ir = builder.build_type_name("FlaggedTail").unwrap();
        assert!(contains_node(&ir.root, |node| matches!(
            node,
            IrNode::RightShift(_)
        )));
        assert!(contains_node(&ir.root, |node| matches!(
            node,
            IrNode::BitAnd(_)
        )));
        assert!(contains_node(&ir.root, |node| matches!(
            node,
            IrNode::MulChecked(_)
        )));

        let json = layout_ir_to_json(&LayoutIr::new(vec![ir])).unwrap();
        assert!(json.contains("right-shift"));
        assert!(json.contains("bit-and"));
    }

    #[test]
    fn builder_finds_enum_tag_parameter_with_parent_field_ref() {
        let mut resolver = TypeResolver::new();
        resolver.add_typedef(TypeDef {
            name: "VariantPayload".into(),
            format: None,
            kind: TypeKind::Struct(StructType {
                display: Default::default(),
                container_attributes: Default::default(),
                fields: vec![StructField {
                    name: "value".into(),
                    format: None,
                    field_type: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U16)),
                }],
            }),
        });

        resolver.add_typedef(TypeDef {
            name: "EnumParent".into(),
            format: None,
            kind: TypeKind::Struct(StructType {
                display: Default::default(),
                container_attributes: Default::default(),
                fields: vec![
                    StructField {
                        name: "tag".into(),
                        format: None,
                        field_type: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U8)),
                    },
                    StructField {
                        name: "payload".into(),
                        format: None,
                        field_type: TypeKind::Enum(EnumType {
                            container_attributes: Default::default(),
                            tag_ref: ExprKind::FieldRef(FieldRefExpr {
                                path: vec!["tag".into()],
                            }),
                            variants: vec![EnumVariant {
                                comment: None,
                                name: "variant".into(),
                                tag_value: 0,
                                variant_type: TypeKind::TypeRef(TypeRefType {
                                    name: "VariantPayload".into(),
                                    package: None,
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
            format: None,
            kind: TypeKind::Enum(EnumType {
                container_attributes: Default::default(),
                tag_ref: ExprKind::FieldRef(FieldRefExpr {
                    path: vec!["tag".into()],
                }),
                variants: vec![
                    EnumVariant {
                        comment: None,
                        name: "One".into(),
                        tag_value: 0,
                        variant_type: TypeKind::Primitive(PrimitiveType::Integral(
                            IntegralType::U32,
                        )),
                    },
                    EnumVariant {
                        comment: None,
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
            format: None,
            kind: TypeKind::Enum(EnumType {
                container_attributes: Default::default(),
                tag_ref: ExprKind::FieldRef(FieldRefExpr {
                    path: vec!["tag".into()],
                }),
                variants: vec![
                    EnumVariant {
                        comment: None,
                        name: "Dyn".into(),
                        tag_value: 1,
                        variant_type: TypeKind::Struct(StructType {
                            display: Default::default(),
                            container_attributes: Default::default(),
                            fields: vec![
                                StructField {
                                    name: "len".into(),
                                    format: None,
                                    field_type: TypeKind::Primitive(PrimitiveType::Integral(
                                        IntegralType::U32,
                                    )),
                                },
                                StructField {
                                    name: "payload".into(),
                                    format: None,
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
                        comment: None,
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
            format: None,
            kind: TypeKind::Union(UnionType {
                container_attributes: Default::default(),
                variants: vec![
                    UnionVariant {
                        name: "Bytes".into(),
                        variant_type: TypeKind::Struct(StructType {
                            display: Default::default(),
                            container_attributes: Default::default(),
                            fields: vec![
                                StructField {
                                    name: "len".into(),
                                    format: None,
                                    field_type: TypeKind::Primitive(PrimitiveType::Integral(
                                        IntegralType::U32,
                                    )),
                                },
                                StructField {
                                    name: "data".into(),
                                    format: None,
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
    fn builder_emits_nested_mul_for_two_dimensional_array() {
        let mut resolver = TypeResolver::new();
        resolver.add_typedef(TypeDef {
            name: "Matrix".into(),
            format: None,
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
            format: None,
            kind: TypeKind::Struct(StructType {
                display: Default::default(),
                container_attributes: Default::default(),
                fields: vec![StructField {
                    name: "b".into(),
                    format: None,
                    field_type: TypeKind::TypeRef(TypeRefType {
                        name: "B".into(),
                        package: None,
                        comment: None,
                    }),
                }],
            }),
        });
        resolver.add_typedef(TypeDef {
            name: "B".into(),
            format: None,
            kind: TypeKind::Struct(StructType {
                display: Default::default(),
                container_attributes: Default::default(),
                fields: vec![StructField {
                    name: "a".into(),
                    format: None,
                    field_type: TypeKind::TypeRef(TypeRefType {
                        name: "A".into(),
                        package: None,
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
            format: None,
            kind: TypeKind::Struct(StructType {
                display: Default::default(),
                container_attributes: Default::default(),
                fields: vec![StructField {
                    name: "value".into(),
                    format: None,
                    field_type: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U32)),
                }],
            }),
        });
        resolver.add_typedef(TypeDef {
            name: "InnerAlias".into(),
            format: None,
            kind: TypeKind::TypeRef(crate::abi::types::TypeRefType {
                name: "Inner".into(),
                package: None,
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
                    format: None,
                    kind: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U16)),
                }),
                "Node" => resolver.add_typedef(TypeDef {
                    name: "Node".into(),
                    format: None,
                    kind: TypeKind::Struct(StructType {
                        display: Default::default(),
                        container_attributes: Default::default(),
                        fields: vec![
                            StructField {
                                name: "len".into(),
                                format: None,
                                field_type: TypeKind::Primitive(PrimitiveType::Integral(
                                    IntegralType::U8,
                                )),
                            },
                            StructField {
                                name: "payload".into(),
                                format: None,
                                field_type: TypeKind::Array(ArrayType {
                                    container_attributes: Default::default(),
                                    size: ExprKind::FieldRef(FieldRefExpr {
                                        path: vec!["len".into()],
                                    }),
                                    element_type: Box::new(TypeKind::TypeRef(
                                        crate::abi::types::TypeRefType {
                                            name: "Leaf".into(),
                                            package: None,
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
            format: None,
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
