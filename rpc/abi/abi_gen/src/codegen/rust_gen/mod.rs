pub mod builder;
pub mod fat_ptr;
pub mod functions_opaque;
pub mod helpers;
pub mod ir_footprint;
pub mod ir_helpers;
pub mod ir_runtime;
pub mod ir_validate;
pub mod param_cache;
pub mod types;

#[cfg(test)]
mod param_cache_tests;

/* Re-export main public functions */
pub use builder::emit_builder;
pub use functions_opaque::emit_opaque_functions;
pub use ir_footprint::{IrFootprintEmitter, IrFootprintError, emit_ir_footprint_fn};
pub use ir_validate::{IrValidateEmitter, IrValidateError, emit_ir_validate_fn};
pub use types::emit_type;
