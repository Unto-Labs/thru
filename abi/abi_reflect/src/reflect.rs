/* High-level reflection API */

use abi_gen::abi::resolved::TypeResolver;
use crate::parser::{ParseError, Parser};
use crate::types::ReflectedType;
use crate::value::ReflectedValue;

/* Main reflector that provides high-level reflection capabilities */
pub struct Reflector {
  /* Type resolver containing all resolved types */
  resolver: TypeResolver,
}

impl Reflector {
  /* Create a new reflector from a type resolver */
  pub fn new(resolver: TypeResolver) -> Self {
    Self { resolver }
  }

  /* Get type information for a type by name */
  pub fn get_type_info(&self, type_name: &str) -> Option<ReflectedType> {
    self.resolver.get_type_info(type_name).map(ReflectedType::from_resolved)
  }

  /* Reflect binary data according to a type name */
  pub fn reflect(&self, data: &[u8], type_name: &str) -> Result<ReflectedValue, ParseError> {
    let resolved_type = self
      .resolver
      .get_type_info(type_name)
      .ok_or_else(|| ParseError::TypeResolutionFailed(type_name.to_string()))?;

    let mut parser = Parser::new(&self.resolver);
    parser.parse(data, resolved_type)
  }

  /* Reflect binary data using a resolved type directly */
  pub fn reflect_with_type(&self, data: &[u8], resolved_type: &abi_gen::abi::resolved::ResolvedType) -> Result<ReflectedValue, ParseError> {
    let mut parser = Parser::new(&self.resolver);
    parser.parse(data, resolved_type)
  }

  /* Get all available type names */
  pub fn get_type_names(&self) -> Vec<String> {
    self.resolver.types.keys().cloned().collect()
  }

  /* Get the underlying type resolver */
  pub fn resolver(&self) -> &TypeResolver {
    &self.resolver
  }
}



