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

/* Legacy modules - used only by analyze command for comparison */
#[deprecated(note = "Legacy module, use ir_footprint instead")]
pub mod footprint;
#[deprecated(note = "Legacy module, use ir_validate instead")]
pub mod validate;

#[cfg(test)]
mod param_cache_tests;

/* Re-export main public functions */
pub use builder::emit_builder;
pub use functions_opaque::emit_opaque_functions;
pub use ir_footprint::{emit_ir_footprint_fn, IrFootprintEmitter, IrFootprintError};
pub use ir_validate::{emit_ir_validate_fn, IrValidateEmitter, IrValidateError};
pub use types::emit_type;

/* Legacy re-exports - only for analyze command comparison */
#[allow(deprecated)]
pub use footprint::emit_footprint_fn;
#[allow(deprecated)]
pub use validate::emit_validate_fn;
