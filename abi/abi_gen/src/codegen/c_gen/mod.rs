pub mod dcls;
pub mod footprint;
pub mod functions_opaque;
pub mod get;
pub mod helpers;
pub mod init;
pub mod ir_footprint;
pub mod ir_validate;
pub mod set;
pub mod size;
pub mod types;
pub mod validate;

// Re-export main public functions
pub use dcls::emit_forward_declarations;
pub use footprint::{collect_and_emit_nested_footprints, emit_footprint_fn};
pub use functions_opaque::emit_opaque_functions;
pub use get::emit_accessor_fn;
pub use helpers::emit_checked_arithmetic_helpers;
pub use init::emit_init_fn;
pub use ir_footprint::{IrFootprintEmitter, IrFootprintError, emit_ir_footprint_fn};
pub use ir_validate::{IrValidateEmitter, IrValidateError, emit_ir_validate_fn};
pub use set::emit_set_fn;
pub use size::emit_size_fn;
pub use types::emit_type;
pub use validate::emit_validate_fn;
