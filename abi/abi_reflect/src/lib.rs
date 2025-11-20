/* ABI Reflection Library
 *
 * This library provides runtime reflection capabilities for ABI types,
 * allowing you to parse binary data and get back a recursive structure
 * containing all type information and parsed values.
 */

pub mod parser;
pub mod reflect;
pub mod types;
pub mod value;

pub use parser::Parser;
pub use reflect::Reflector;
pub use types::*;
pub use value::{ReflectedValue, Value, ValueOnly};

