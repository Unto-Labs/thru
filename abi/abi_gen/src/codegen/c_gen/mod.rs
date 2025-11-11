pub mod helpers;
pub mod types;
pub mod dcls;
pub mod init;
pub mod footprint;
pub mod size;
pub mod get;
pub mod set;
pub mod validate;
pub mod functions_opaque;

// Re-export main public functions
pub use types::emit_type;
pub use dcls::emit_forward_declarations;
pub use init::emit_init_fn;
pub use footprint::{collect_and_emit_nested_footprints, emit_footprint_fn};
pub use size::emit_size_fn;
pub use get::emit_accessor_fn;
pub use set::emit_set_fn;
pub use validate::emit_validate_fn;
pub use functions_opaque::emit_opaque_functions;
