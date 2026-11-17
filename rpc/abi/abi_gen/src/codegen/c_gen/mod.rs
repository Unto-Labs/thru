pub mod emit;
pub mod footprint;
pub mod helpers;
pub mod ir_footprint;
pub mod ir_validate;
pub mod meta;
pub mod model;
pub mod names;
pub mod runtime;
pub mod validate;

// Re-export main public functions
pub use footprint::{collect_and_emit_nested_footprints, emit_footprint_fn};
pub use helpers::emit_checked_arithmetic_helpers;
pub use ir_footprint::{IrFootprintEmitter, IrFootprintError, emit_ir_footprint_fn};
pub use ir_validate::{IrValidateEmitter, IrValidateError, emit_ir_validate_fn};
pub use validate::emit_validate_fn;
