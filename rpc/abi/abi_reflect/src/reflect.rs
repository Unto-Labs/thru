/* High-level reflection API */

use crate::errors::{ReflectError, ReflectResult};
use crate::ir::{build_layout_ir, IrInterpreter, IrValidationResult, ParamMap};
use crate::params::ParamExtractor;
use crate::parser::Parser;
use crate::types::ReflectedType;
use crate::value::ReflectedValue;
use abi_gen::abi::file::RootTypes;
use abi_gen::abi::resolved::{ResolvedType, ResolvedTypeKind, TypeResolver};
use abi_gen::codegen::shared::ir::{LayoutIr, TypeIr};
use std::collections::BTreeMap;

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

        Ok(Self {
            resolver,
            layout_ir,
            ir_index,
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

    pub fn validate_buffer(
        &self,
        type_name: &str,
        buffer: &[u8],
    ) -> ReflectResult<IrValidationResult> {
        let resolved_type = self.get_resolved_type(type_name)?;
        let type_ir = self.type_ir(type_name)?;
        if Self::supports_param_extraction(resolved_type) {
            let params = self.extract_params(resolved_type, type_ir, buffer)?;
            self.validate_with_params(type_ir, buffer, &params)
        } else if type_ir.parameters.is_empty() {
            self.validate_with_params(type_ir, buffer, &ParamMap::new())
        } else {
            Ok(IrValidationResult {
                bytes_consumed: buffer.len() as u128,
            })
        }
    }

    pub fn dynamic_params(&self, type_name: &str, data: &[u8]) -> ReflectResult<ParamMap> {
        let resolved_type = self.get_resolved_type(type_name)?;
        let type_ir = self.type_ir(type_name)?;
        self.extract_params(resolved_type, type_ir, data)
    }

    /* Get type information for a type by name */
    pub fn get_type_info(&self, type_name: &str) -> Option<ReflectedType> {
        self.resolver
            .get_type_info(type_name)
            .map(ReflectedType::from_resolved)
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
        let (params, should_validate) = if Self::supports_param_extraction(resolved_type) {
            let params = self.extract_params(resolved_type, type_ir, data)?;
            (params, true)
        } else {
            (ParamMap::new(), type_ir.parameters.is_empty())
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
     * Returns an error if instruction-root is not configured in the ABI. */
    pub fn reflect_instruction(&self, data: &[u8]) -> ReflectResult<ReflectedValue> {
        let type_name =
            self.root_types
                .instruction_root
                .as_ref()
                .ok_or(ReflectError::MissingRootType {
                    root_kind: "instruction",
                })?;
        self.reflect(data, type_name)
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
        IrInterpreter::new(&self.layout_ir, &self.ir_index)
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
            kind: TypeKind::Struct(StructType {
                container_attributes: ContainerAttributes {
                    packed: true,
                    aligned: 0,
                    comment: None,
                },
                fields: vec![
                    StructField {
                        name: "len".into(),
                        field_type: TypeKind::Primitive(PrimitiveType::Integral(IntegralType::U32)),
                    },
                    StructField {
                        name: "data".into(),
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

    #[test]
    fn reflect_instruction_errors_when_not_configured() {
        let mut resolver = TypeResolver::new();
        resolver.add_typedef(TypeDef {
            name: "SomeType".into(),
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
