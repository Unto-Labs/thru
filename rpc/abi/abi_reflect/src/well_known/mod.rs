/* Well-known type handlers for ABI reflection formatting
 *
 * This module provides a registry-based system for handling well-known types
 * during ABI reflection. Each handler can enrich the formatted JSON output
 * with human-readable representations of the underlying data.
 *
 * Categories:
 * - thru: Core Thru types (Pubkey, Signature, Hash, Timestamp, etc.)
 * - google: Google protobuf common types (Color, LatLng, Money, etc.)
 * - system: System types (InstructionData for recursive resolution)
 */

pub mod handlers;
pub mod registry;
pub mod traits;

pub use handlers::*;
pub use registry::WellKnownRegistry;
pub use traits::{WellKnownContext, WellKnownResult, WellKnownType};
