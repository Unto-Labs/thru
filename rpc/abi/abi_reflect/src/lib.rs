/* ABI Reflection Library
 *
 * This library provides runtime reflection capabilities for ABI types,
 * allowing you to parse binary data and get back a recursive structure
 * containing all type information and parsed values.
 */

pub mod errors;
pub mod formatter;
pub mod ir;
pub mod nested_instruction_data;
pub mod params;
pub mod parser;
pub mod reflect;
pub mod types;
pub mod value;
pub mod well_known;

pub use abi_gen::abi::file::RootTypes;
pub use errors::{ReflectError, ReflectResult};
pub use formatter::{
    format_reflection, format_reflection_with_options, ByteRange, FormatOptions,
    FormattedReflection,
};
pub use ir::{IrInterpreter, IrValidationResult, ParamMap};
pub use nested_instruction_data::{
    resolve_nested_instruction_data, resolve_nested_instruction_data_with_options,
    NestedInstructionDecodeOptions, MAX_NESTED_INSTRUCTION_DEPTH,
};
pub use parser::Parser;
pub use reflect::{Reflector, ReflectorConfig};
pub use types::*;
pub use value::{ReflectedValue, Value, ValueOnly};
pub use well_known::{WellKnownContext, WellKnownRegistry, WellKnownResult, WellKnownType};
