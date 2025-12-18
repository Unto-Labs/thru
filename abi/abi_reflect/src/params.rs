use crate::errors::{ReflectError, ReflectResult};
use crate::ir::ParamMap;
use abi_gen::abi::expr::{ExprKind, FieldRefExpr, LiteralExpr};
use abi_gen::abi::resolved::{ResolvedType, ResolvedTypeKind, Size, TypeResolver};
use abi_gen::abi::types::{FloatingPointType, IntegralType, PrimitiveType};
use abi_gen::codegen::shared::ir::TypeIr;
use std::collections::{BTreeMap, HashMap};

/// Extracts IR parameters by walking the resolved struct layout.
pub struct ParamExtractor<'a> {
    type_name: &'a str,
    resolved_type: &'a ResolvedType,
    resolver: &'a TypeResolver,
    field_params: BTreeMap<String, Vec<&'a str>>,
    payload_targets: BTreeMap<&'a str, String>,
}

impl<'a> ParamExtractor<'a> {
    pub fn new(
        resolver: &'a TypeResolver,
        resolved_type: &'a ResolvedType,
        type_ir: &'a TypeIr,
    ) -> ReflectResult<Self> {
        let ResolvedTypeKind::Struct { .. } = &resolved_type.kind else {
            return Err(ReflectError::UnsupportedDynamicParam {
                type_name: resolved_type.name.clone(),
                parameter: "<all>".into(),
                reason: "dynamic parameter extraction only supports struct roots".into(),
            });
        };

        let (field_params, payload_targets) = build_param_mapping(resolved_type, type_ir)?;

        Ok(Self {
            type_name: &resolved_type.name,
            resolved_type,
            resolver,
            field_params,
            payload_targets,
        })
    }

    pub fn extract(&self, data: &[u8]) -> ReflectResult<ParamMap> {
        let mut walker = StructWalker::new(
            self.type_name,
            self.resolver,
            &self.field_params,
            &self.payload_targets,
        );
        let mut path = Vec::new();
        walker.process_struct(self.resolved_type, &mut path, data)?;
        walker.finish()
    }
}

fn build_param_mapping<'a>(
    resolved_type: &'a ResolvedType,
    type_ir: &'a TypeIr,
) -> ReflectResult<(BTreeMap<String, Vec<&'a str>>, BTreeMap<&'a str, String>)> {
    let mut dynamic_lookup: BTreeMap<String, (String, String, bool)> = BTreeMap::new();
    for (owner, refs) in &resolved_type.dynamic_params {
        let owner_norm = normalize_binding_path(owner);
        let owner_trimmed = trim_type_prefix(&owner_norm, &resolved_type.name);
        for (path, _) in refs {
            let canonical = canonical_param_name(owner, path);
            let trimmed = strip_typeref_prefix(path);
            let normalized = normalize_binding_path(trimmed);
            let is_payload =
                trimmed.ends_with("payload_size") || normalized.ends_with("payload_size");
            let target_path = if normalized.is_empty() {
                owner_trimmed.to_string()
            } else {
                trim_type_prefix(&normalized, &resolved_type.name).to_string()
            };
            dynamic_lookup.insert(
                canonical,
                (target_path, owner_trimmed.to_string(), is_payload),
            );
        }
    }

    let mut field_params: BTreeMap<String, Vec<&'a str>> = BTreeMap::new();
    let mut payload_targets: BTreeMap<&'a str, String> = BTreeMap::new();

    for param in &type_ir.parameters {
        if param.derived {
            continue;
        }
        let normalized = normalize_binding_path(&param.name);
        let trimmed = trim_type_prefix(&normalized, &resolved_type.name);
        let lookup = dynamic_lookup
            .get(&param.name)
            .or_else(|| dynamic_lookup.get(&normalized))
            .or_else(|| dynamic_lookup.get(trimmed));
        if let Some((field_path, owner_path, is_payload)) = lookup {
            if *is_payload {
                payload_targets
                    .entry(param.name.as_str())
                    .or_insert_with(|| owner_path.clone());
            } else {
                field_params
                    .entry(field_path.clone())
                    .or_default()
                    .push(param.name.as_str());
            }
        } else {
            if normalized.is_empty() {
                continue;
            }
            let trimmed = trimmed.to_string();
            if trimmed.ends_with("payload_size") {
                let owner = trimmed
                    .strip_suffix(".payload_size")
                    .unwrap_or(&trimmed)
                    .to_string();
                payload_targets.entry(param.name.as_str()).or_insert(owner);
            } else {
                field_params
                    .entry(trimmed)
                    .or_default()
                    .push(param.name.as_str());
            }
        }
    }

    Ok((field_params, payload_targets))
}

fn canonical_param_name(owner: &str, path: &str) -> String {
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

fn normalize_binding_path(input: &str) -> String {
    let mut trimmed = input;
    while let Some(stripped) = trimmed.strip_prefix("../") {
        trimmed = stripped;
    }
    if let Some(stripped) = trimmed.strip_prefix("./") {
        trimmed = stripped;
    }
    let trimmed = trimmed.trim_matches('.');
    if trimmed.is_empty() {
        return String::new();
    }
    let replaced = trimmed
        .replace("::", ".")
        .replace('/', ".")
        .replace('[', ".")
        .replace(']', "");
    replaced
        .split('.')
        .filter(|seg| !seg.is_empty())
        .collect::<Vec<_>>()
        .join(".")
}

fn strip_typeref_prefix(path: &str) -> &str {
    if let Some(stripped) = path.strip_prefix("_typeref_") {
        if let Some(idx) = stripped.find("::") {
            &stripped[idx + 2..]
        } else {
            stripped
        }
    } else {
        path
    }
}

fn trim_type_prefix<'a>(path: &'a str, type_name: &str) -> &'a str {
    if path.is_empty() {
        return path;
    }
    if let Some(stripped) = path.strip_prefix(type_name) {
        stripped.strip_prefix('.').unwrap_or(stripped)
    } else {
        path
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use abi_gen::abi::resolved::{
        ConstantStatus, ResolvedEnumVariant, ResolvedField, ResolvedSizeDiscriminatedVariant,
    };
    use abi_gen::abi::types::{IntegralType, PrimitiveType};
    use abi_gen::codegen::shared::ir::IrParameter;
    use abi_gen::codegen::shared::ir::{ConstNode, IrNode, NodeMetadata};
    use std::collections::HashMap;

    fn primitive_type(name: &str, prim: PrimitiveType) -> ResolvedType {
        let size = match &prim {
            PrimitiveType::Integral(int) => match int {
                IntegralType::U8 | IntegralType::I8 => 1,
                IntegralType::U16 | IntegralType::I16 => 2,
                IntegralType::U32 | IntegralType::I32 => 4,
                IntegralType::U64 | IntegralType::I64 => 8,
            },
            PrimitiveType::FloatingPoint(ft) => match ft {
                FloatingPointType::F16 => 2,
                FloatingPointType::F32 => 4,
                FloatingPointType::F64 => 8,
            },
        };
        ResolvedType {
            name: name.into(),
            size: Size::Const(size),
            alignment: 1,
            comment: None,
            dynamic_params: BTreeMap::new(),
            kind: ResolvedTypeKind::Primitive { prim_type: prim },
        }
    }

    #[test]
    fn extracts_payload_size_param_for_tail_sdu() {
        let fixed_field = primitive_type("Fixed", PrimitiveType::Integral(IntegralType::U8));
        let payload_variant =
            primitive_type("PayloadVariant", PrimitiveType::Integral(IntegralType::U32));
        let payload_union = ResolvedType {
            name: "PayloadUnion".into(),
            size: Size::Variable(HashMap::new()),
            alignment: 1,
            comment: None,
            dynamic_params: BTreeMap::new(),
            kind: ResolvedTypeKind::SizeDiscriminatedUnion {
                variants: vec![ResolvedSizeDiscriminatedVariant {
                    name: "Variant".into(),
                    expected_size: 4,
                    variant_type: payload_variant,
                }],
            },
        };

        let mut payload_refs = BTreeMap::new();
        payload_refs.insert(
            "payload.payload_size".into(),
            PrimitiveType::Integral(IntegralType::U64),
        );
        let mut dynamic_params = BTreeMap::new();
        dynamic_params.insert("payload".into(), payload_refs);

        let root_type = ResolvedType {
            name: "Container".into(),
            size: Size::Variable(HashMap::new()),
            alignment: 1,
            comment: None,
            dynamic_params,
            kind: ResolvedTypeKind::Struct {
                fields: vec![
                    ResolvedField {
                        name: "fixed".into(),
                        field_type: fixed_field.clone(),
                        offset: Some(0),
                    },
                    ResolvedField {
                        name: "payload".into(),
                        field_type: payload_union.clone(),
                        offset: Some(1),
                    },
                ],
                packed: true,
                custom_alignment: None,
            },
        };

        let mut resolver = TypeResolver::new();
        resolver
            .types
            .insert(root_type.name.clone(), root_type.clone());

        let type_ir = TypeIr {
            type_name: root_type.name.clone(),
            alignment: 1,
            root: IrNode::Const(ConstNode {
                value: 0,
                meta: NodeMetadata::default(),
            }),
            parameters: vec![IrParameter {
                name: "payload.payload_size".into(),
                description: None,
                derived: false,
            }],
        };

        let extractor = ParamExtractor::new(&resolver, &root_type, &type_ir).expect("extractor");
        let mut buffer = vec![0xAB];
        buffer.extend_from_slice(&[0xDE, 0xAD, 0xBE, 0xEF]);

        let params = extractor.extract(&buffer).expect("params");
        assert_eq!(params.get("payload.payload_size"), Some(&4u128));
    }

    #[test]
    fn records_enum_tag_parameters() {
        let tag_field = primitive_type("tag", PrimitiveType::Integral(IntegralType::U8));
        let variant_body = primitive_type("Body", PrimitiveType::Integral(IntegralType::U16));
        let enum_type = ResolvedType {
            name: "InnerEnum".into(),
            size: Size::Variable(HashMap::new()),
            alignment: 1,
            comment: None,
            dynamic_params: BTreeMap::new(),
            kind: ResolvedTypeKind::Enum {
                tag_expression: ExprKind::FieldRef(FieldRefExpr {
                    path: vec!["tag".into()],
                }),
                tag_constant_status: ConstantStatus::Constant,
                variants: vec![ResolvedEnumVariant {
                    name: "Variant".into(),
                    tag_value: 7,
                    variant_type: variant_body,
                    requires_payload_size: false,
                }],
            },
        };

        let mut dynamic_params = BTreeMap::new();
        let mut enum_refs = BTreeMap::new();
        enum_refs.insert("body.tag".into(), PrimitiveType::Integral(IntegralType::U8));
        dynamic_params.insert("body".into(), enum_refs);

        let root_type = ResolvedType {
            name: "Container".into(),
            size: Size::Variable(HashMap::new()),
            alignment: 1,
            comment: None,
            dynamic_params,
            kind: ResolvedTypeKind::Struct {
                fields: vec![
                    ResolvedField {
                        name: "tag".into(),
                        field_type: tag_field,
                        offset: Some(0),
                    },
                    ResolvedField {
                        name: "body".into(),
                        field_type: enum_type.clone(),
                        offset: Some(1),
                    },
                ],
                packed: true,
                custom_alignment: None,
            },
        };

        let mut resolver = TypeResolver::new();
        resolver
            .types
            .insert(root_type.name.clone(), root_type.clone());
        let type_ir = TypeIr {
            type_name: root_type.name.clone(),
            alignment: 1,
            root: IrNode::Const(ConstNode {
                value: 0,
                meta: NodeMetadata::default(),
            }),
            parameters: vec![IrParameter {
                name: "body.tag".into(),
                description: None,
                derived: false,
            }],
        };

        let extractor = ParamExtractor::new(&resolver, &root_type, &type_ir).expect("extractor");
        let buffer = vec![7u8, 0x34, 0x12];
        let params = extractor.extract(&buffer).expect("params");
        assert_eq!(params.get("body.tag"), Some(&7u128));
    }

    #[test]
    fn maps_type_qualified_params_to_parent_fields() {
        let tag_field = primitive_type("event_type", PrimitiveType::Integral(IntegralType::U8));
        let short_variant = primitive_type("Short", PrimitiveType::Integral(IntegralType::U8));
        let long_variant = primitive_type("Long", PrimitiveType::Integral(IntegralType::U16));

        let mut enum_param_refs = BTreeMap::new();
        let mut enum_refs = BTreeMap::new();
        enum_refs.insert("event_type".into(), PrimitiveType::Integral(IntegralType::U8));
        enum_param_refs.insert("Event::payload".into(), enum_refs.clone());

        let mut tag_status = HashMap::new();
        tag_status.insert("event_type".into(), PrimitiveType::Integral(IntegralType::U8));

        let payload_enum = ResolvedType {
            name: "Event::payload".into(),
            size: Size::Variable(HashMap::new()),
            alignment: 1,
            comment: None,
            dynamic_params: enum_param_refs.clone(),
            kind: ResolvedTypeKind::Enum {
                tag_expression: ExprKind::FieldRef(FieldRefExpr {
                    path: vec!["event_type".into()],
                }),
                tag_constant_status: ConstantStatus::NonConstant(tag_status),
                variants: vec![
                    ResolvedEnumVariant {
                        name: "Short".into(),
                        tag_value: 0,
                        variant_type: short_variant,
                        requires_payload_size: false,
                    },
                    ResolvedEnumVariant {
                        name: "Long".into(),
                        tag_value: 1,
                        variant_type: long_variant,
                        requires_payload_size: false,
                    },
                ],
            },
        };

        let mut struct_dynamic = BTreeMap::new();
        let mut struct_refs = BTreeMap::new();
        struct_refs.insert("event_type".into(), PrimitiveType::Integral(IntegralType::U8));
        struct_dynamic.insert("payload".into(), struct_refs);

        let root_type = ResolvedType {
            name: "Event".into(),
            size: Size::Variable(HashMap::new()),
            alignment: 1,
            comment: None,
            dynamic_params: struct_dynamic,
            kind: ResolvedTypeKind::Struct {
                fields: vec![
                    ResolvedField {
                        name: "event_type".into(),
                        field_type: tag_field,
                        offset: Some(0),
                    },
                    ResolvedField {
                        name: "payload".into(),
                        field_type: payload_enum,
                        offset: None,
                    },
                ],
                packed: true,
                custom_alignment: None,
            },
        };

        let mut resolver = TypeResolver::new();
        resolver
            .types
            .insert(root_type.name.clone(), root_type.clone());

        let type_ir = TypeIr {
            type_name: root_type.name.clone(),
            alignment: 1,
            root: IrNode::Const(ConstNode {
                value: 0,
                meta: NodeMetadata::default(),
            }),
            parameters: vec![
                IrParameter {
                    name: "payload.event_type".into(),
                    description: None,
                    derived: false,
                },
                IrParameter {
                    name: "Event::payload.event_type".into(),
                    description: None,
                    derived: false,
                },
            ],
        };

        let extractor = ParamExtractor::new(&resolver, &root_type, &type_ir).expect("extractor");
        let buffer = vec![1u8, 0xAB, 0xCD];
        let params = extractor.extract(&buffer).expect("params");
        assert_eq!(params.get("payload.event_type"), Some(&1u128));
        assert_eq!(
            params.get("Event::payload.event_type"),
            Some(&1u128)
        );
    }
}

struct StructWalker<'a> {
    type_name: &'a str,
    resolver: &'a TypeResolver,
    field_params: &'a BTreeMap<String, Vec<&'a str>>,
    params: ParamMap,
    value_lookup: HashMap<String, u128>,
    remaining_payload: BTreeMap<&'a str, String>,
    scope_stack: Vec<String>,
}

impl<'a> StructWalker<'a> {
    fn new(
        type_name: &'a str,
        resolver: &'a TypeResolver,
        field_params: &'a BTreeMap<String, Vec<&'a str>>,
        payload_targets: &'a BTreeMap<&'a str, String>,
    ) -> Self {
        Self {
            type_name,
            resolver,
            field_params,
            params: ParamMap::new(),
            value_lookup: HashMap::new(),
            remaining_payload: payload_targets.clone(),
            scope_stack: vec![String::new()],
        }
    }

    fn process_struct(
        &mut self,
        ty: &ResolvedType,
        path: &mut Vec<String>,
        data: &[u8],
    ) -> ReflectResult<usize> {
        let scope_marker = path_key(path);
        self.scope_stack.push(scope_marker);
        let result = self.process_struct_inner(ty, path, data);
        self.scope_stack.pop();
        result
    }

    fn process_struct_inner(
        &mut self,
        ty: &ResolvedType,
        path: &mut Vec<String>,
        data: &[u8],
    ) -> ReflectResult<usize> {
        let ResolvedTypeKind::Struct {
            fields,
            packed,
            custom_alignment,
        } = &ty.kind
        else {
            return Err(ReflectError::UnsupportedDynamicParam {
                type_name: self.type_name.to_string(),
                parameter: "<struct>".into(),
                reason: "expected struct type for parameter extraction".into(),
            });
        };

        let mut cursor = 0usize;
        let align_struct = custom_alignment.unwrap_or(ty.alignment);

        for (idx, field) in fields.iter().enumerate() {
            if !*packed {
                cursor = align_up(cursor, field.field_type.alignment)
                    .ok_or_else(|| self.align_error(&field.name))?;
            }
            if cursor > data.len() {
                return Err(self.buffer_error(cursor as u64));
            }

            path.push(field.name.clone());
            let is_last = idx + 1 == fields.len();
            let consumed = self.process_field(&field.field_type, path, &data[cursor..], is_last)?;
            path.pop();

            cursor = cursor
                .checked_add(consumed)
                .ok_or_else(|| self.align_error(&field.name))?;
        }

        if !*packed && align_struct > 1 {
            cursor = align_up(cursor, align_struct).ok_or_else(|| self.align_error("struct"))?;
        }

        Ok(cursor)
    }

    fn process_field(
        &mut self,
        ty: &ResolvedType,
        path: &mut Vec<String>,
        data: &[u8],
        is_last: bool,
    ) -> ReflectResult<usize> {
        let consumed = match &ty.kind {
            ResolvedTypeKind::Primitive { prim_type } => {
                self.read_primitive(path, data, prim_type)?;
                primitive_size(prim_type)
            }
            ResolvedTypeKind::Struct { .. } => self.process_struct_at(ty, path, data)?,
            ResolvedTypeKind::Array { .. } => self.process_array(ty, path, data)?,
            ResolvedTypeKind::Enum { .. } => self.process_enum(ty, path, data)?,
            ResolvedTypeKind::SizeDiscriminatedUnion { .. } => {
                self.process_sdu(path, data, is_last)?
            }
            ResolvedTypeKind::Union { .. } => self.process_union(ty, path, data)?,
            ResolvedTypeKind::TypeRef { target_name, .. } => {
                let target = self.resolver.get_type_info(target_name).ok_or_else(|| {
                    ReflectError::UnsupportedDynamicParam {
                        type_name: self.type_name.to_string(),
                        parameter: target_name.clone(),
                        reason: "type reference target not found".into(),
                    }
                })?;
                return self.process_field(target, path, data, is_last);
            }
        };

        self.record_tail_payload(path, consumed, is_last);
        Ok(consumed)
    }

    fn process_struct_at(
        &mut self,
        ty: &ResolvedType,
        path: &mut Vec<String>,
        data: &[u8],
    ) -> ReflectResult<usize> {
        self.process_struct(ty, path, data)
    }

    fn process_array(
        &mut self,
        ty: &ResolvedType,
        path: &mut Vec<String>,
        data: &[u8],
    ) -> ReflectResult<usize> {
        let (element_type, size_expression) = match &ty.kind {
            ResolvedTypeKind::Array {
                element_type,
                size_expression,
                ..
            } => (element_type.as_ref(), size_expression),
            _ => unreachable!(),
        };

        let count = self.eval_expr(size_expression)? as usize;
        if element_type.size == Size::Const(0) || count == 0 {
            return Ok(0);
        }

        let element_size = match element_type.size {
            Size::Const(value) => value as usize,
            Size::Variable(_) => {
                return Err(ReflectError::UnsupportedDynamicParam {
                    type_name: self.type_name.to_string(),
                    parameter: path.join("."),
                    reason: "arrays with variable-sized elements are not supported yet".into(),
                })
            }
        };
        let key = path_key(path);
        let bytes = element_size.checked_mul(count).ok_or_else(|| {
            ReflectError::UnsupportedDynamicParam {
                type_name: self.type_name.to_string(),
                parameter: key,
                reason: "array size overflowed".into(),
            }
        })?;
        let consumed = bytes;

        if consumed > data.len() {
            return Err(self.buffer_error(consumed as u64));
        }

        /* Store each element's value in value_lookup for field reference resolution */
        if let ResolvedTypeKind::Primitive { prim_type } = &element_type.kind {
            for i in 0..count {
                let offset = i * element_size;
                let element_data = &data[offset..offset + element_size];
                path.push(i.to_string());
                if let PrimitiveType::Integral(_) = prim_type {
                    let value = read_primitive_value(
                        element_data,
                        prim_type,
                        self.type_name,
                        &path_key(path),
                    )?;
                    self.store_field_value(path, value);
                    if let Some(param_names) = self.field_params.get(&path_key(path)) {
                        for &name in param_names {
                            self.params.insert(name.to_string(), value);
                        }
                    }
                }
                path.pop();
            }
        } else {
            /* For arrays of non-primitives, recurse into each element */
            for i in 0..count {
                let offset = i * element_size;
                let element_data = &data[offset..offset + element_size];
                path.push(i.to_string());
                self.process_field(element_type, path, element_data, false)?;
                path.pop();
            }
        }

        Ok(consumed)
    }

    fn process_enum(
        &mut self,
        ty: &ResolvedType,
        path: &mut Vec<String>,
        data: &[u8],
    ) -> ReflectResult<usize> {
        let (tag_expression, variants) = match &ty.kind {
            ResolvedTypeKind::Enum {
                tag_expression,
                variants,
                ..
            } => (tag_expression, variants),
            _ => unreachable!(),
        };

        let tag_value = self.eval_expr(tag_expression)? as u64;
        let variant = variants
            .iter()
            .find(|variant| variant.tag_value == tag_value)
            .ok_or_else(|| ReflectError::UnsupportedDynamicParam {
                type_name: self.type_name.to_string(),
                parameter: path.join("."),
                reason: format!("enum tag value {tag_value} not found"),
            })?;
        self.record_enum_tag(path, tag_value as u128);

        let consumed = self.process_field(&variant.variant_type, path, data, false)?;
        Ok(consumed)
    }

    fn process_sdu(
        &mut self,
        path: &mut Vec<String>,
        data: &[u8],
        is_last: bool,
    ) -> ReflectResult<usize> {
        if !is_last {
            return Err(ReflectError::UnsupportedDynamicParam {
                type_name: self.type_name.to_string(),
                parameter: path_key(path),
                reason: "size-discriminated unions must be the final field".into(),
            });
        }
        let payload = data.len();
        let field_key = path_key(path);
        let mut matched = Vec::new();
        for (&name, target) in self.remaining_payload.iter() {
            if target == &field_key {
                matched.push(name);
            }
        }
        for name in matched {
            self.params.insert(name.to_string(), payload as u128);
            self.remaining_payload.remove(&name);
        }
        Ok(payload)
    }

    fn process_union(
        &mut self,
        ty: &ResolvedType,
        path: &mut Vec<String>,
        data: &[u8],
    ) -> ReflectResult<usize> {
        let size = match ty.size {
            Size::Const(value) => value as usize,
            Size::Variable(_) => {
                return Err(ReflectError::UnsupportedDynamicParam {
                    type_name: self.type_name.to_string(),
                    parameter: path_key(path),
                    reason: "unions with variable size are not supported yet".into(),
                })
            }
        };
        if size > data.len() {
            return Err(self.buffer_error(size as u64));
        }
        self.store_field_value(path, size as u128);
        if let Some(param_names) = self.field_params.get(&path_key(path)) {
            for &name in param_names {
                self.params.insert(name.to_string(), size as u128);
            }
        }
        Ok(size)
    }

    fn record_tail_payload(&mut self, path: &[String], consumed: usize, is_last: bool) {
        if !is_last || self.remaining_payload.is_empty() {
            return;
        }

        let field_key = path_key(path);
        let mut matched = Vec::new();
        for (&name, target) in self.remaining_payload.iter() {
            if target == &field_key {
                matched.push(name);
            }
        }

        for name in matched {
            self.params.insert(name.to_string(), consumed as u128);
            self.remaining_payload.remove(&name);
        }
    }

    fn record_enum_tag(&mut self, path: &[String], tag_value: u128) {
        let mut tag_path = path.to_vec();
        tag_path.push("tag".into());
        let key = path_key(&tag_path);
        self.insert_param_value(&key, tag_value);
    }

    fn insert_param_value(&mut self, key: &str, value: u128) {
        if let Some(param_names) = self.field_params.get(key) {
            for &name in param_names {
                self.params.insert(name.to_string(), value);
            }
        }
    }

    fn read_primitive(
        &mut self,
        path: &mut Vec<String>,
        data: &[u8],
        prim_type: &PrimitiveType,
    ) -> ReflectResult<()> {
        let size = primitive_size(prim_type);
        if size > data.len() {
            return Err(self.buffer_error(size as u64));
        }

        if let PrimitiveType::Integral(_) = prim_type {
            let value =
                read_primitive_value(&data[..size], prim_type, self.type_name, &path_key(path))?;
            self.store_field_value(path, value);
            if let Some(param_names) = self.field_params.get(&path_key(path)) {
                for &name in param_names {
                    self.params.insert(name.to_string(), value);
                }
            }
        }

        Ok(())
    }

    fn store_field_value(&mut self, path: &[String], value: u128) {
        if path.is_empty() {
            return;
        }
        let key = path_key(path);
        self.value_lookup.insert(key, value);
        if path.len() == 1 {
            self.value_lookup.insert(path[0].clone(), value);
        }
    }

    fn lookup_field_value(&self, key: &str) -> Option<u128> {
        if let Some(val) = self.value_lookup.get(key) {
            return Some(*val);
        }

        for scope in self.scope_stack.iter().rev() {
            if scope.is_empty() {
                continue;
            }
            let candidate = if key.is_empty() {
                scope.clone()
            } else {
                format!("{}.{}", scope, key)
            };
            if let Some(val) = self.value_lookup.get(&candidate) {
                return Some(*val);
            }
        }

        None
    }

    fn eval_expr(&self, expr: &ExprKind) -> ReflectResult<u128> {
        let value = self.eval_expr_signed(expr)?;
        if value < 0 {
            return Err(ReflectError::UnsupportedDynamicParam {
                type_name: self.type_name.to_string(),
                parameter: expr_name(expr),
                reason: "expression evaluated to a negative value".into(),
            });
        }
        Ok(value as u128)
    }

    fn eval_expr_signed(&self, expr: &ExprKind) -> ReflectResult<i128> {
        match expr {
            ExprKind::Literal(lit) => Ok(match lit {
                LiteralExpr::U64(v) => *v as i128,
                LiteralExpr::U32(v) => *v as i128,
                LiteralExpr::U16(v) => *v as i128,
                LiteralExpr::U8(v) => *v as i128,
                LiteralExpr::I64(v) => *v as i128,
                LiteralExpr::I32(v) => *v as i128,
                LiteralExpr::I16(v) => *v as i128,
                LiteralExpr::I8(v) => *v as i128,
            }),
            ExprKind::FieldRef(field_ref) => {
                let key = flatten_field_ref(field_ref);
                self.lookup_field_value(&key)
                    .map(|v| v as i128)
                    .ok_or_else(|| ReflectError::UnsupportedDynamicParam {
                        type_name: self.type_name.to_string(),
                        parameter: key,
                        reason: "required field value not available".into(),
                    })
            }
            ExprKind::Sizeof(expr) => {
                let ty = self
                    .resolver
                    .get_type_info(&expr.type_name)
                    .ok_or_else(|| ReflectError::UnsupportedDynamicParam {
                        type_name: self.type_name.to_string(),
                        parameter: expr.type_name.clone(),
                        reason: "sizeof target type not found".into(),
                    })?;
                match ty.size {
                    Size::Const(value) => Ok(value as i128),
                    Size::Variable(_) => Err(ReflectError::UnsupportedDynamicParam {
                        type_name: self.type_name.to_string(),
                        parameter: expr.type_name.clone(),
                        reason: "sizeof of variable type unsupported".into(),
                    }),
                }
            }
            ExprKind::Alignof(expr) => {
                let ty = self
                    .resolver
                    .get_type_info(&expr.type_name)
                    .ok_or_else(|| ReflectError::UnsupportedDynamicParam {
                        type_name: self.type_name.to_string(),
                        parameter: expr.type_name.clone(),
                        reason: "alignof target type not found".into(),
                    })?;
                Ok(ty.alignment as i128)
            }
            ExprKind::Add(expr) => self.binary(&expr.left, &expr.right, |l, r| Ok(l + r)),
            ExprKind::Sub(expr) => self.binary(&expr.left, &expr.right, |l, r| Ok(l - r)),
            ExprKind::Mul(expr) => self.binary(&expr.left, &expr.right, |l, r| Ok(l * r)),
            ExprKind::Div(expr) => self.binary(&expr.left, &expr.right, |l, r| {
                if r == 0 {
                    Err("division by zero")
                } else {
                    Ok(l / r)
                }
            }),
            ExprKind::Mod(expr) => self.binary(&expr.left, &expr.right, |l, r| {
                if r == 0 {
                    Err("modulo by zero")
                } else {
                    Ok(l % r)
                }
            }),
            ExprKind::Pow(expr) => {
                let left = self.eval_expr_signed(&expr.left)?;
                let right = self.eval_expr_signed(&expr.right)?;
                if right < 0 {
                    return Err(ReflectError::UnsupportedDynamicParam {
                        type_name: self.type_name.to_string(),
                        parameter: "pow".into(),
                        reason: "negative exponent unsupported".into(),
                    });
                }
                let exp = right as u32;
                Ok(left.pow(exp))
            }
            ExprKind::BitAnd(expr) => self.binary(&expr.left, &expr.right, |l, r| Ok(l & r)),
            ExprKind::BitOr(expr) => self.binary(&expr.left, &expr.right, |l, r| Ok(l | r)),
            ExprKind::BitXor(expr) => self.binary(&expr.left, &expr.right, |l, r| Ok(l ^ r)),
            ExprKind::LeftShift(expr) => self.binary(&expr.left, &expr.right, |l, r| {
                if r < 0 {
                    Err("negative shift")
                } else {
                    Ok(l << r)
                }
            }),
            ExprKind::RightShift(expr) => self.binary(&expr.left, &expr.right, |l, r| {
                if r < 0 {
                    Err("negative shift")
                } else {
                    Ok(l >> r)
                }
            }),
            ExprKind::BitNot(expr) => Ok(!self.eval_expr_signed(&expr.operand)?),
            ExprKind::Neg(expr) => Ok(-self.eval_expr_signed(&expr.operand)?),
            ExprKind::Not(expr) => {
                let v = self.eval_expr_signed(&expr.operand)?;
                Ok(if v == 0 { 1 } else { 0 })
            }
            ExprKind::Popcount(expr) => {
                let v = self.eval_expr_signed(&expr.operand)?;
                Ok((v as u128).count_ones() as i128)
            }
            ExprKind::Eq(expr) => self.compare(&expr.left, &expr.right, |l, r| l == r),
            ExprKind::Ne(expr) => self.compare(&expr.left, &expr.right, |l, r| l != r),
            ExprKind::Lt(expr) => self.compare(&expr.left, &expr.right, |l, r| l < r),
            ExprKind::Gt(expr) => self.compare(&expr.left, &expr.right, |l, r| l > r),
            ExprKind::Le(expr) => self.compare(&expr.left, &expr.right, |l, r| l <= r),
            ExprKind::Ge(expr) => self.compare(&expr.left, &expr.right, |l, r| l >= r),
            ExprKind::And(expr) => self.logical(&expr.left, &expr.right, |l, r| l != 0 && r != 0),
            ExprKind::Or(expr) => self.logical(&expr.left, &expr.right, |l, r| l != 0 || r != 0),
            ExprKind::Xor(expr) => {
                self.logical(&expr.left, &expr.right, |l, r| (l != 0) ^ (r != 0))
            }
        }
    }

    fn binary<F>(&self, left: &ExprKind, right: &ExprKind, f: F) -> ReflectResult<i128>
    where
        F: FnOnce(i128, i128) -> Result<i128, &'static str>,
    {
        let left = self.eval_expr_signed(left)?;
        let right = self.eval_expr_signed(right)?;
        f(left, right).map_err(|reason| ReflectError::UnsupportedDynamicParam {
            type_name: self.type_name.to_string(),
            parameter: "expression".into(),
            reason: reason.into(),
        })
    }

    fn compare<F>(&self, left: &ExprKind, right: &ExprKind, cmp: F) -> ReflectResult<i128>
    where
        F: FnOnce(i128, i128) -> bool,
    {
        let l = self.eval_expr_signed(left)?;
        let r = self.eval_expr_signed(right)?;
        Ok(if cmp(l, r) { 1 } else { 0 })
    }

    fn logical<F>(&self, left: &ExprKind, right: &ExprKind, op: F) -> ReflectResult<i128>
    where
        F: FnOnce(i128, i128) -> bool,
    {
        let l = self.eval_expr_signed(left)?;
        let r = self.eval_expr_signed(right)?;
        Ok(if op(l, r) { 1 } else { 0 })
    }

    fn finish(self) -> ReflectResult<ParamMap> {
        if !self.remaining_payload.is_empty() {
            let missing = self
                .remaining_payload
                .keys()
                .next()
                .map(|name| (*name).to_string())
                .unwrap_or_else(|| "payload_size".into());
            return Err(ReflectError::UnsupportedDynamicParam {
                type_name: self.type_name.to_string(),
                parameter: missing,
                reason: "payload size could not be determined".into(),
            });
        }
        Ok(self.params)
    }

    fn align_error(&self, field: &str) -> ReflectError {
        ReflectError::UnsupportedDynamicParam {
            type_name: self.type_name.to_string(),
            parameter: field.to_string(),
            reason: "alignment overflow".into(),
        }
    }

    fn buffer_error(&self, required: u64) -> ReflectError {
        ReflectError::BufferTooSmall {
            type_name: self.type_name.to_string(),
            required: required as u128,
            available: required,
        }
    }
}

fn flatten_field_ref(expr: &FieldRefExpr) -> String {
    expr.path
        .iter()
        .flat_map(|segment| segment.split('/'))
        .map(|segment| segment.trim_start_matches(".."))
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join(".")
}

fn path_key(path: &[String]) -> String {
    path.join(".")
}

fn expr_name(expr: &ExprKind) -> String {
    match expr {
        ExprKind::Literal(_) => "literal".into(),
        ExprKind::FieldRef(field) => format!("field({})", flatten_field_ref(field)),
        ExprKind::Sizeof(expr) => format!("sizeof({})", expr.type_name),
        ExprKind::Alignof(expr) => format!("alignof({})", expr.type_name),
        _ => "expression".into(),
    }
}

fn read_primitive_value(
    data: &[u8],
    prim_type: &PrimitiveType,
    type_name: &str,
    parameter: &str,
) -> ReflectResult<u128> {
    match prim_type {
        PrimitiveType::Integral(int_type) => match int_type {
            IntegralType::U8 => Ok(u8::from_le_bytes([data[0]]) as u128),
            IntegralType::U16 => Ok(u16::from_le_bytes([data[0], data[1]]) as u128),
            IntegralType::U32 => {
                Ok(u32::from_le_bytes([data[0], data[1], data[2], data[3]]) as u128)
            }
            IntegralType::U64 => Ok(u64::from_le_bytes([
                data[0], data[1], data[2], data[3], data[4], data[5], data[6], data[7],
            ]) as u128),
            IntegralType::I8 => {
                positive_integral(i8::from_le_bytes([data[0]]) as i128, type_name, parameter)
            }
            IntegralType::I16 => positive_integral(
                i16::from_le_bytes([data[0], data[1]]) as i128,
                type_name,
                parameter,
            ),
            IntegralType::I32 => positive_integral(
                i32::from_le_bytes([data[0], data[1], data[2], data[3]]) as i128,
                type_name,
                parameter,
            ),
            IntegralType::I64 => positive_integral(
                i64::from_le_bytes([
                    data[0], data[1], data[2], data[3], data[4], data[5], data[6], data[7],
                ]) as i128,
                type_name,
                parameter,
            ),
        },
        PrimitiveType::FloatingPoint(_) => Err(ReflectError::UnsupportedDynamicParam {
            type_name: type_name.to_string(),
            parameter: parameter.to_string(),
            reason: "floating point values cannot drive dynamic parameters".into(),
        }),
    }
}

fn positive_integral(value: i128, type_name: &str, parameter: &str) -> ReflectResult<u128> {
    if value < 0 {
        return Err(ReflectError::NegativeDynamicParam {
            type_name: type_name.to_string(),
            parameter: parameter.to_string(),
        });
    }
    Ok(value as u128)
}

fn primitive_size(prim_type: &PrimitiveType) -> usize {
    match prim_type {
        PrimitiveType::Integral(int_type) => match int_type {
            IntegralType::U8 | IntegralType::I8 => 1,
            IntegralType::U16 | IntegralType::I16 => 2,
            IntegralType::U32 | IntegralType::I32 => 4,
            IntegralType::U64 | IntegralType::I64 => 8,
        },
        PrimitiveType::FloatingPoint(ftype) => match ftype {
            FloatingPointType::F16 => 2,
            FloatingPointType::F32 => 4,
            FloatingPointType::F64 => 8,
        },
    }
}

fn align_up(offset: usize, alignment: u64) -> Option<usize> {
    if alignment <= 1 {
        return Some(offset);
    }
    let align = alignment as usize;
    let mask = align - 1;
    let remainder = offset & mask;
    if remainder == 0 {
        Some(offset)
    } else {
        offset.checked_add(align - remainder)
    }
}
