/* High-level reflection API */

use crate::errors::{ReflectError, ReflectResult};
use crate::ir::{
    build_derived_params, build_layout_ir, DerivedParams, IrInterpreter, IrValidationResult,
    ParamMap,
};
use crate::params::ParamExtractor;
use crate::parser::{reflected_runtime_size, Parser, BUFFER_SIZE_REF};
use crate::types::ReflectedType;
use crate::value::ReflectedValue;
use abi_gen::abi::file::RootTypes;
use abi_gen::abi::resolved::{ResolvedType, ResolvedTypeKind, TypeResolver};
use abi_gen::codegen::shared::ir::{IrNode, LayoutIr, TypeIr};
use std::collections::{BTreeMap, BTreeSet};

/* Configuration toggles for the reflector */
#[derive(Clone, Debug, Default)]
pub struct ReflectorConfig {
    /* Enable verbose IR tracing (wired in future phases) */
    pub enable_ir_trace: bool,
}

/* Main reflector that provides high-level reflection capabilities */
pub struct Reflector {
    /* Type resolver containing all resolved types */
    resolver: TypeResolver,
    /* Cached layout IR per type name */
    layout_ir: LayoutIr,
    /* Name -> index mapping for quick IR lookups */
    ir_index: BTreeMap<String, usize>,
    /* Computed enum tags per type, evaluated from the type's parameters */
    derived_params: DerivedParams,
    /* Runtime configuration */
    config: ReflectorConfig,
    /* Root type names for program reflection */
    root_types: RootTypes,
}

impl Reflector {
    /* Create a new reflector from a type resolver */
    pub fn new(resolver: TypeResolver) -> ReflectResult<Self> {
        Self::with_config(resolver, ReflectorConfig::default())
    }

    /* Create a new reflector with custom configuration */
    pub fn with_config(resolver: TypeResolver, config: ReflectorConfig) -> ReflectResult<Self> {
        Self::with_root_types(resolver, config, RootTypes::default())
    }

    /* Create a new reflector with root types configuration */
    pub fn with_root_types(
        resolver: TypeResolver,
        config: ReflectorConfig,
        root_types: RootTypes,
    ) -> ReflectResult<Self> {
        let layout_ir = build_layout_ir(&resolver)?;
        let mut ir_index = BTreeMap::new();
        for (idx, type_ir) in layout_ir.types.iter().enumerate() {
            ir_index.insert(type_ir.type_name.clone(), idx);
        }
        let derived_params = build_derived_params(&resolver, &layout_ir);

        Ok(Self {
            resolver,
            layout_ir,
            ir_index,
            derived_params,
            config,
            root_types,
        })
    }

    /* Access the cached IR definition for a given type */
    pub fn type_ir(&self, type_name: &str) -> ReflectResult<&TypeIr> {
        self.ir_index
            .get(type_name)
            .and_then(|idx| self.layout_ir.types.get(*idx))
            .ok_or_else(|| ReflectError::UnknownType {
                type_name: type_name.to_string(),
            })
    }

    /* Access the full layout IR */
    pub fn layout_ir(&self) -> &LayoutIr {
        &self.layout_ir
    }

    /* Return the current configuration */
    pub fn config(&self) -> &ReflectorConfig {
        &self.config
    }

    /* Validate a buffer against the shared IR */
    pub fn validate_buffer_ir(
        &self,
        type_name: &str,
        buffer: &[u8],
        params: &ParamMap,
    ) -> ReflectResult<IrValidationResult> {
        let type_ir = self.type_ir(type_name)?;
        self.validate_with_params(type_ir, buffer, params)
    }

    /* Validate a buffer: its IR footprint fits and its bytes parse as the
     * type (enum tags, size-discriminated union sizes, nested values). A type
     * with dynamic parameters that are not extracted from a struct root
     * cannot be checked, so it fails rather than passing unchecked. */
    pub fn validate_buffer(
        &self,
        type_name: &str,
        buffer: &[u8],
    ) -> ReflectResult<IrValidationResult> {
        let resolved_type = self.get_resolved_type(type_name)?;
        let type_ir = self.type_ir(type_name)?;
        let params = if Self::supports_param_extraction(resolved_type) {
            self.extract_params(resolved_type, type_ir, buffer)?
        } else if type_ir.parameters.is_empty() {
            ParamMap::new()
        } else {
            return Err(ReflectError::UnsupportedOperation {
                operation: "validate_buffer".to_string(),
                reason: format!(
                    "type '{}' has dynamic parameters, which can only be extracted from a struct",
                    resolved_type.name
                ),
            });
        };
        let result = if self.requires_byte_backed_validation(type_ir) {
            IrValidationResult {
                bytes_consumed: buffer.len() as u128,
            }
        } else {
            self.validate_with_params(type_ir, buffer, &params)?
        };
        let mut parser = Parser::new(&self.resolver, params);
        parser
            .parse(buffer, resolved_type)
            .map_err(|source| ReflectError::Parse {
                type_name: resolved_type.name.clone(),
                source,
            })?;
        Ok(result)
    }

    pub fn dynamic_params(&self, type_name: &str, data: &[u8]) -> ReflectResult<ParamMap> {
        let resolved_type = self.get_resolved_type(type_name)?;
        let type_ir = self.type_ir(type_name)?;
        self.extract_params(resolved_type, type_ir, data)
    }

    /* Get type information for a type by name */
    pub fn get_type_info(&self, type_name: &str) -> Option<ReflectedType> {
        self.resolver.get_type_info(type_name).map(|resolved| {
            ReflectedType::from_resolved_with_format(
                resolved,
                self.resolver.format_for_type(&resolved.name).cloned(),
            )
        })
    }

    /* Reflect binary data according to a type name */
    pub fn reflect(&self, data: &[u8], type_name: &str) -> ReflectResult<ReflectedValue> {
        let resolved_type = self.get_resolved_type(type_name)?;
        self.reflect_with_type(data, resolved_type)
    }

    pub fn reflect_with_type(
        &self,
        data: &[u8],
        resolved_type: &ResolvedType,
    ) -> ReflectResult<ReflectedValue> {
        let type_ir = self.type_ir(&resolved_type.name)?;
        let requires_byte_backed_validation = self.requires_byte_backed_validation(type_ir);
        let (params, should_validate) = if Self::supports_param_extraction(resolved_type) {
            let params = self.extract_params(resolved_type, type_ir, data)?;
            (params, !requires_byte_backed_validation)
        } else {
            (
                ParamMap::new(),
                type_ir.parameters.is_empty() && !requires_byte_backed_validation,
            )
        };
        if should_validate {
            self.validate_with_params(type_ir, data, &params)?;
        }
        let mut parser = Parser::new(&self.resolver, params.clone());
        parser
            .parse(data, resolved_type)
            .map_err(|source| ReflectError::Parse {
                type_name: resolved_type.name.clone(),
                source,
            })
    }

    /* Get all available type names */
    pub fn get_type_names(&self) -> Vec<String> {
        self.resolver.types.keys().cloned().collect()
    }

    /* Get the underlying type resolver */
    pub fn resolver(&self) -> &TypeResolver {
        &self.resolver
    }

    /* Get the configured root types */
    pub fn root_types(&self) -> &RootTypes {
        &self.root_types
    }

    /* Reflect instruction data using the configured instruction-root type.
     * Returns an error if instruction-root is not configured in the ABI.
     *
     * The decoded root must cover every byte. Programs such as the CLOB loop
     * over the whole buffer, so bytes after the decoded value still execute;
     * a preview that drops them would hide signed behavior. When the decoded
     * size cannot be measured, this fails closed for the same reason. */
    pub fn reflect_instruction(&self, data: &[u8]) -> ReflectResult<ReflectedValue> {
        let type_name =
            self.root_types
                .instruction_root
                .as_ref()
                .ok_or(ReflectError::MissingRootType {
                    root_kind: "instruction",
                })?;
        let reflected = self.reflect(data, type_name)?;
        let consumed = reflected_runtime_size(&reflected);
        if consumed != Some(data.len()) {
            return Err(ReflectError::TrailingBytes {
                type_name: type_name.clone(),
                consumed: consumed.map(|size| size as u64),
                available: data.len() as u64,
            });
        }
        Ok(reflected)
    }

    /* Reflect account data using the configured account-root type.
     * Returns an error if account-root is not configured in the ABI. */
    pub fn reflect_account(&self, data: &[u8]) -> ReflectResult<ReflectedValue> {
        let type_name =
            self.root_types
                .account_root
                .as_ref()
                .ok_or(ReflectError::MissingRootType {
                    root_kind: "account",
                })?;
        self.reflect(data, type_name)
    }

    /* Reflect event data using the configured events type.
     * Returns an error if events is not configured in the ABI. */
    pub fn reflect_event(&self, data: &[u8]) -> ReflectResult<ReflectedValue> {
        let type_name = self
            .root_types
            .events
            .as_ref()
            .ok_or(ReflectError::MissingRootType {
                root_kind: "events",
            })?;
        self.reflect(data, type_name)
    }

    fn get_resolved_type(&self, type_name: &str) -> ReflectResult<&ResolvedType> {
        self.resolver
            .get_type_info(type_name)
            .ok_or_else(|| ReflectError::UnknownType {
                type_name: type_name.to_string(),
            })
    }

    fn validate_with_params(
        &self,
        type_ir: &TypeIr,
        buffer: &[u8],
        params: &ParamMap,
    ) -> ReflectResult<IrValidationResult> {
        self.interpreter().validate(type_ir, buffer.len(), params)
    }

    fn interpreter(&self) -> IrInterpreter<'_> {
        IrInterpreter::with_derived_params(&self.layout_ir, &self.ir_index, &self.derived_params)
    }

    fn extract_params(
        &self,
        resolved_type: &ResolvedType,
        type_ir: &TypeIr,
        data: &[u8],
    ) -> ReflectResult<ParamMap> {
        if type_ir.parameters.is_empty() {
            return Ok(ParamMap::new());
        }
        let extractor = ParamExtractor::new(&self.resolver, resolved_type, type_ir)?;
        extractor.extract(data)
    }

    fn supports_param_extraction(resolved_type: &ResolvedType) -> bool {
        matches!(resolved_type.kind, ResolvedTypeKind::Struct { .. })
    }

    fn requires_byte_backed_validation(&self, type_ir: &TypeIr) -> bool {
        let mut visited = BTreeSet::new();
        self.node_requires_byte_backed_validation(&type_ir.root, &mut visited)
    }

    fn node_requires_byte_backed_validation(
        &self,
        node: &IrNode,
        visited: &mut BTreeSet<String>,
    ) -> bool {
        match node {
            IrNode::ZeroSize { .. } | IrNode::Const(_) | IrNode::FieldRef(_) => false,
            IrNode::AlignUp(node) => self.node_requires_byte_backed_validation(&node.node, visited),
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
                self.node_requires_byte_backed_validation(&node.left, visited)
                    || self.node_requires_byte_backed_validation(&node.right, visited)
            }
            IrNode::Switch(node) => {
                node.cases
                    .iter()
                    .any(|case| self.node_requires_byte_backed_validation(&case.node, visited))
                    || match node.default.as_ref() {
                        Some(default) => {
                            self.node_requires_byte_backed_validation(default, visited)
                        }
                        None => false,
                    }
            }
            IrNode::CallNested(node) => {
                if !visited.insert(node.type_name.clone()) {
                    return false;
                }
                match self
                    .ir_index
                    .get(&node.type_name)
                    .and_then(|idx| self.layout_ir.types.get(*idx))
                {
                    /* The bytes left for a nested `__buffer_size`-sized value
                     * are not an IR value, so only the parser can size it. */
                    Some(type_ir) => {
                        node_reads_buffer_size(&type_ir.root)
                            || self.node_requires_byte_backed_validation(&type_ir.root, visited)
                    }
                    None => false,
                }
            }
            IrNode::SumOverArray(_) => true,
        }
    }
}

/* Does `node` read `__buffer_size` itself (not through a nested call)? */
fn node_reads_buffer_size(node: &IrNode) -> bool {
    match node {
        IrNode::FieldRef(field) => field.parameter.is_none() && field.path == BUFFER_SIZE_REF,
        IrNode::ZeroSize { .. } | IrNode::Const(_) | IrNode::CallNested(_) => false,
        IrNode::AlignUp(node) => node_reads_buffer_size(&node.node),
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
            node_reads_buffer_size(&node.left) || node_reads_buffer_size(&node.right)
        }
        IrNode::Switch(node) => {
            node.cases
                .iter()
                .any(|case| node_reads_buffer_size(&case.node))
                || node.default.as_deref().is_some_and(node_reads_buffer_size)
        }
        IrNode::SumOverArray(_) => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ir::ParamMap;
    use crate::value::Value;
    use abi_gen::abi::expr::{ExprKind, FieldRefExpr};
    use abi_gen::abi::types::{
        ArrayType, ContainerAttributes, IntegralType, PrimitiveType, StructField, StructType,
        TypeDef, TypeKind,
    };

    #[test]
    fn builds_ir_cache_for_simple_type() {
        let mut resolver = TypeResolver::new();
        resolver.add_typedef(TypeDef {
            name: "MyU32".into(),
            format: None,
            kind: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U32)),
        });
        resolver.resolve_all().expect("resolver succeeds");

        let reflector = Reflector::new(resolver).expect("reflector initializes");
        let type_ir = reflector.type_ir("MyU32").expect("type present");
        assert_eq!(type_ir.type_name, "MyU32");
    }

    #[test]
    fn validates_const_type_against_buffer() {
        let mut resolver = TypeResolver::new();
        resolver.add_typedef(TypeDef {
            name: "MyU64".into(),
            format: None,
            kind: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U64)),
        });
        resolver.resolve_all().expect("resolver succeeds");

        let reflector = Reflector::new(resolver).expect("reflector initializes");
        let buffer = vec![0u8; 8];
        let params = ParamMap::new();
        let result = reflector
            .validate_buffer_ir("MyU64", &buffer, &params)
            .expect("validation succeeds");
        assert_eq!(result.bytes_consumed, 8);
    }

    #[test]
    fn dynamic_params_extract_for_simple_struct() {
        let mut resolver = TypeResolver::new();
        resolver.add_typedef(TypeDef {
            name: "DynStruct".into(),
            format: None,
            kind: TypeKind::Struct(StructType {
                container_attributes: ContainerAttributes {
                    packed: true,
                    aligned: 0,
                    comment: None,
                },
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
                            container_attributes: ContainerAttributes::default(),
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
        resolver.resolve_all().expect("resolver succeeds");

        let reflector = Reflector::new(resolver).expect("reflector initializes");
        let mut buffer = Vec::new();
        buffer.extend_from_slice(&2u32.to_le_bytes());
        buffer.extend_from_slice(&[0xAA, 0xBB]);

        let type_ir = reflector.type_ir("DynStruct").expect("ir present");
        let params = reflector
            .dynamic_params("DynStruct", &buffer)
            .expect("params extracted");
        assert_eq!(type_ir.parameters.len(), 1);
        let param_name = &type_ir.parameters[0].name;
        assert_eq!(params.get(param_name.as_str()), Some(&2u128));

        let validation = reflector
            .validate_buffer("DynStruct", &buffer)
            .expect("validation succeeds");
        assert_eq!(validation.bytes_consumed, buffer.len() as u128);

        let reflected = reflector
            .reflect(&buffer, "DynStruct")
            .expect("reflection succeeds");
        assert_eq!(reflected.type_name(), "DynStruct");
        let len_field = reflected
            .get_struct_field("len")
            .expect("len field present");
        if let Value::Primitive(prim) = len_field.get_value() {
            assert_eq!(prim.to_u64(), Some(2));
        } else {
            panic!("len field is not primitive");
        }
        let data_field = reflected
            .get_struct_field("data")
            .expect("data field present");
        if let Value::Array { elements } = data_field.get_value() {
            assert_eq!(elements.len(), 2);
            let bytes: Vec<u8> = elements
                .iter()
                .map(|elem| {
                    if let Value::Primitive(prim) = elem.get_value() {
                        prim.to_u64().expect("u8 value") as u8
                    } else {
                        panic!("array element is not primitive");
                    }
                })
                .collect();
            assert_eq!(bytes, vec![0xAA, 0xBB]);
        } else {
            panic!("data field is not an array");
        }
    }

    #[test]
    fn reflect_instruction_uses_configured_root_type() {
        let mut resolver = TypeResolver::new();
        resolver.add_typedef(TypeDef {
            name: "MyInstruction".into(),
            format: None,
            kind: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U32)),
        });
        resolver.resolve_all().expect("resolver succeeds");

        let root_types = RootTypes {
            instruction_root: Some("MyInstruction".to_string()),
            account_root: None,
            errors: None,
            events: None,
        };
        let reflector =
            Reflector::with_root_types(resolver, ReflectorConfig::default(), root_types)
                .expect("reflector initializes");

        let buffer = 42u32.to_le_bytes();
        let reflected = reflector
            .reflect_instruction(&buffer)
            .expect("reflection succeeds");
        assert_eq!(reflected.type_name(), "MyInstruction");
    }

    fn u32_instruction_reflector() -> Reflector {
        let mut resolver = TypeResolver::new();
        resolver.add_typedef(TypeDef {
            name: "MyInstruction".into(),
            format: None,
            kind: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U32)),
        });
        resolver.resolve_all().expect("resolver succeeds");
        let root_types = RootTypes {
            instruction_root: Some("MyInstruction".to_string()),
            account_root: Some("MyInstruction".to_string()),
            errors: None,
            events: None,
        };
        Reflector::with_root_types(resolver, ReflectorConfig::default(), root_types)
            .expect("reflector initializes")
    }

    fn dyn_instruction_reflector() -> Reflector {
        let mut resolver = TypeResolver::new();
        resolver.add_typedef(TypeDef {
            name: "DynInstruction".into(),
            format: None,
            kind: TypeKind::Struct(StructType {
                container_attributes: ContainerAttributes {
                    packed: true,
                    aligned: 0,
                    comment: None,
                },
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
                            container_attributes: ContainerAttributes::default(),
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
        resolver.resolve_all().expect("resolver succeeds");
        let root_types = RootTypes {
            instruction_root: Some("DynInstruction".to_string()),
            account_root: None,
            errors: None,
            events: None,
        };
        Reflector::with_root_types(resolver, ReflectorConfig::default(), root_types)
            .expect("reflector initializes")
    }

    #[test]
    fn reflect_instruction_rejects_trailing_bytes() {
        let reflector = u32_instruction_reflector();
        let mut buffer = 42u32.to_le_bytes().to_vec();
        buffer.push(0xFF);

        match reflector.reflect_instruction(&buffer).unwrap_err() {
            ReflectError::TrailingBytes {
                type_name,
                consumed,
                available,
            } => {
                assert_eq!(type_name, "MyInstruction");
                assert_eq!(consumed, Some(4));
                assert_eq!(available, 5);
            }
            other => panic!("unexpected error: {:?}", other),
        }
    }

    #[test]
    fn reflect_account_still_allows_trailing_capacity() {
        /* Account data can be larger than its decoded root; only signed
         * instruction data must be covered exactly. */
        let reflector = u32_instruction_reflector();
        let mut buffer = 42u32.to_le_bytes().to_vec();
        buffer.extend_from_slice(&[0u8; 4]);
        reflector
            .reflect_account(&buffer)
            .expect("account reflection ignores trailing capacity");
    }

    #[test]
    fn reflect_instruction_accepts_exact_dynamic_struct() {
        let reflector = dyn_instruction_reflector();
        let mut buffer = 2u32.to_le_bytes().to_vec();
        buffer.extend_from_slice(&[0xAA, 0xBB]);
        reflector
            .reflect_instruction(&buffer)
            .expect("exact dynamic instruction reflects");
    }

    #[test]
    fn reflect_instruction_rejects_bytes_after_dynamic_struct() {
        let reflector = dyn_instruction_reflector();
        let mut buffer = 2u32.to_le_bytes().to_vec();
        buffer.extend_from_slice(&[0xAA, 0xBB, 0xCC]);
        match reflector.reflect_instruction(&buffer).unwrap_err() {
            ReflectError::TrailingBytes {
                consumed,
                available,
                ..
            } => {
                assert_eq!(consumed, Some(6));
                assert_eq!(available, 7);
            }
            other => panic!("unexpected error: {:?}", other),
        }
    }

    /* Non-packed struct with a u64 `suffix`, a u32 `len` and `bytes: [u8; len]`.
    With `suffix_first == false` the order is { len, bytes, suffix }: the parser
    aligns `suffix` to 8 after the variable-length array. With
    `suffix_first == true` the order is { suffix, len, bytes }: the struct
    ends padded to 8, as the IR footprint requires. */
    fn padded_instruction_reflector(suffix_first: bool) -> Reflector {
        let suffix = StructField {
            name: "suffix".into(),
            format: None,
            field_type: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U64)),
        };
        let len = StructField {
            name: "len".into(),
            format: None,
            field_type: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U32)),
        };
        let bytes = StructField {
            name: "bytes".into(),
            format: None,
            field_type: TypeKind::Array(ArrayType {
                container_attributes: ContainerAttributes::default(),
                size: ExprKind::FieldRef(FieldRefExpr {
                    path: vec!["len".into()],
                }),
                element_type: Box::new(TypeKind::Primitive(PrimitiveType::Integral(
                    IntegralType::U8,
                ))),
                jagged: false,
            }),
        };
        let fields = if suffix_first {
            vec![suffix, len, bytes]
        } else {
            vec![len, bytes, suffix]
        };

        let mut resolver = TypeResolver::new();
        resolver.add_typedef(TypeDef {
            name: "PaddedInstruction".into(),
            format: None,
            kind: TypeKind::Struct(StructType {
                container_attributes: ContainerAttributes::default(),
                fields,
            }),
        });
        resolver.resolve_all().expect("resolver succeeds");
        let root_types = RootTypes {
            instruction_root: Some("PaddedInstruction".to_string()),
            account_root: None,
            errors: None,
            events: None,
        };
        Reflector::with_root_types(resolver, ReflectorConfig::default(), root_types)
            .expect("reflector initializes")
    }

    fn padded_instruction_bytes() -> Vec<u8> {
        let mut buffer = 1u32.to_le_bytes().to_vec();
        buffer.push(0xAA);
        buffer.extend_from_slice(&[0u8; 3]);
        buffer.extend_from_slice(&7u64.to_le_bytes());
        buffer
    }

    #[test]
    fn reflect_instruction_counts_tail_padding_in_non_packed_struct() {
        let reflector = padded_instruction_reflector(true);
        let mut buffer = 7u64.to_le_bytes().to_vec();
        buffer.extend_from_slice(&1u32.to_le_bytes());
        buffer.push(0xAA);
        buffer.extend_from_slice(&[0u8; 3]);
        assert_eq!(buffer.len(), 16);

        reflector
            .reflect_instruction(&buffer)
            .expect("tail-padded non-packed instruction reflects");

        buffer.push(0xFF);
        assert!(matches!(
            reflector.reflect_instruction(&buffer),
            Err(ReflectError::TrailingBytes {
                consumed: Some(16),
                available: 17,
                ..
            })
        ));
    }

    #[test]
    fn reflect_instruction_counts_padding_in_non_packed_struct() {
        let reflector = padded_instruction_reflector(false);
        let buffer = padded_instruction_bytes();
        assert_eq!(buffer.len(), 16);

        let reflected = reflector
            .reflect_instruction(&buffer)
            .expect("padded non-packed instruction reflects");
        let suffix = reflected.get_struct_field("suffix").expect("suffix field");
        let Value::Primitive(prim) = suffix.get_value() else {
            panic!("suffix is not primitive");
        };
        assert_eq!(prim.to_u64(), Some(7));
    }

    #[test]
    fn reflect_instruction_rejects_bytes_after_non_packed_struct() {
        let reflector = padded_instruction_reflector(false);
        let mut buffer = padded_instruction_bytes();
        buffer.push(0xFF);

        match reflector.reflect_instruction(&buffer).unwrap_err() {
            ReflectError::TrailingBytes {
                consumed,
                available,
                ..
            } => {
                assert_eq!(consumed, Some(16));
                assert_eq!(available, 17);
            }
            other => panic!("unexpected error: {:?}", other),
        }
    }

    #[test]
    fn reflect_instruction_errors_when_not_configured() {
        let mut resolver = TypeResolver::new();
        resolver.add_typedef(TypeDef {
            name: "SomeType".into(),
            format: None,
            kind: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U32)),
        });
        resolver.resolve_all().expect("resolver succeeds");

        let reflector = Reflector::new(resolver).expect("reflector initializes");
        let buffer = 42u32.to_le_bytes();
        let result = reflector.reflect_instruction(&buffer);

        assert!(result.is_err());
        match result.unwrap_err() {
            ReflectError::MissingRootType { root_kind } => {
                assert_eq!(root_kind, "instruction");
            }
            other => panic!("unexpected error: {:?}", other),
        }
    }

    #[test]
    fn reflect_account_uses_configured_root_type() {
        let mut resolver = TypeResolver::new();
        resolver.add_typedef(TypeDef {
            name: "MyAccount".into(),
            format: None,
            kind: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U64)),
        });
        resolver.resolve_all().expect("resolver succeeds");

        let root_types = RootTypes {
            instruction_root: None,
            account_root: Some("MyAccount".to_string()),
            errors: None,
            events: None,
        };
        let reflector =
            Reflector::with_root_types(resolver, ReflectorConfig::default(), root_types)
                .expect("reflector initializes");

        let buffer = 123u64.to_le_bytes();
        let reflected = reflector
            .reflect_account(&buffer)
            .expect("reflection succeeds");
        assert_eq!(reflected.type_name(), "MyAccount");
    }

    #[test]
    fn reflect_event_uses_configured_root_type() {
        let mut resolver = TypeResolver::new();
        resolver.add_typedef(TypeDef {
            name: "MyEvent".into(),
            format: None,
            kind: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U16)),
        });
        resolver.resolve_all().expect("resolver succeeds");

        let root_types = RootTypes {
            instruction_root: None,
            account_root: None,
            errors: None,
            events: Some("MyEvent".to_string()),
        };
        let reflector =
            Reflector::with_root_types(resolver, ReflectorConfig::default(), root_types)
                .expect("reflector initializes");

        let buffer = 999u16.to_le_bytes();
        let reflected = reflector
            .reflect_event(&buffer)
            .expect("reflection succeeds");
        assert_eq!(reflected.type_name(), "MyEvent");
    }
}
