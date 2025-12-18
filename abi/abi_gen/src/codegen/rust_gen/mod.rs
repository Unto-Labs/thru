pub mod footprint;
pub mod functions;
pub mod functions_opaque;
pub mod helpers;
pub mod init;
pub mod ir_footprint;
pub mod ir_helpers;
pub mod ir_validate;
pub mod size;
pub mod types;
pub mod validate;

/* Re-export main public functions */
pub use footprint::emit_footprint_fn;
pub use functions::{emit_functions, emit_functions_for_resolved_type};
pub use functions_opaque::emit_opaque_functions;
pub use init::emit_init_fn;
pub use ir_footprint::{IrFootprintEmitter, IrFootprintError, emit_ir_footprint_fn};
pub use ir_validate::{IrValidateEmitter, IrValidateError, emit_ir_validate_fn};
pub use size::emit_size_fn;
pub use types::emit_type;
pub use validate::emit_validate_fn;
