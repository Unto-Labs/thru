mod interpreter;

use abi_gen::abi::resolved::TypeResolver;
use abi_gen::codegen::shared::builder::{IrBuildError, IrBuilder};
use abi_gen::codegen::shared::ir::LayoutIr;

pub use interpreter::{IrInterpreter, IrValidationResult, ParamMap};

/// Build the shared Layout IR for every type in the resolver.
pub fn build_layout_ir(resolver: &TypeResolver) -> Result<LayoutIr, IrBuildError> {
    let builder = IrBuilder::new(resolver);
    builder.build_all()
}
