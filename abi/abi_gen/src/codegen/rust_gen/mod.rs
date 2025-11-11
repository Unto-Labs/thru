pub mod types;
pub mod functions;
pub mod functions_opaque;
pub mod helpers;
pub mod footprint;
pub mod size;
pub mod init;
pub mod validate;

/* Re-export main public functions */
pub use types::emit_type;
pub use functions::{emit_functions, emit_functions_for_resolved_type};
pub use functions_opaque::emit_opaque_functions;
pub use footprint::emit_footprint_fn;
pub use size::emit_size_fn;
pub use init::emit_init_fn;
pub use validate::emit_validate_fn;
