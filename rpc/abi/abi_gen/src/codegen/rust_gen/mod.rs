pub mod emit;
pub mod emit_builder;
pub mod fat_ptr;
pub mod ir_footprint;
pub mod ir_helpers;
pub mod ir_runtime;
pub mod ir_validate;
pub mod model;
pub mod names;
pub mod param_cache;

/* Re-export main public functions */
pub use ir_footprint::{
    IrFootprintEmitter, IrFootprintError, emit_ir_footprint_fn, emit_ir_footprint_fn_named,
};
pub use ir_validate::{
    IrValidateEmitter, IrValidateError, emit_ir_validate_fn, emit_ir_validate_fn_named,
};
