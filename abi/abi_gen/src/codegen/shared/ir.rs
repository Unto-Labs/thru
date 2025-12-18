//! Shared layout IR definitions used by every codegen backend.
//!
//! The IR is intentionally conservative: it encodes only the minimal pieces
//! needed by the requirements in `abi/enum-fams.md`, keeps parameter names
//! fully-qualified, and carries endianness/alignment metadata alongside every
//! node. Backends are expected to consume this tree directly (C/Rust
//! generators) or after serialization (TypeScript/reflection tooling).
//!
//! # Example
//! ```
//! use abi_gen::codegen::shared::ir::*;
//!
//! let bytes = IrNode::Const(ConstNode {
//!     value: 4,
//!     meta: NodeMetadata::aligned(4),
//! });
//! let layout = LayoutIr::new(vec![TypeIr {
//!     type_name: "Example".into(),
//!     alignment: 4,
//!     root: bytes,
//!     parameters: vec![],
//! }]);
//!
//! assert_eq!(layout.version, IR_SCHEMA_VERSION);
//! assert_eq!(layout.types[0].type_name, "Example");
//! ```

use serde_derive::{Deserialize, Serialize};
use serde_json;

/// Schema version used for every serialized IR export.
pub const IR_SCHEMA_VERSION: u32 = 1;

/// Container for the full IR associated with a set of ABI types.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayoutIr {
    /// IR schema version (mirrors `IR_SCHEMA_VERSION`).
    pub version: u32,
    /// Per-type IR payloads.
    pub types: Vec<TypeIr>,
}

impl LayoutIr {
    /// Creates a new IR container, automatically wiring the schema version.
    pub fn new(types: Vec<TypeIr>) -> Self {
        Self {
            version: IR_SCHEMA_VERSION,
            types,
        }
    }
}

/// Layout description for a single ABI type.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TypeIr {
    /// Fully-qualified ABI type name.
    pub type_name: String,
    /// Required alignment for the type (bytes).
    pub alignment: u64,
    /// Root node describing the full footprint expression.
    pub root: IrNode,
    /// Dynamic parameters exposed by this type (counts, tags, etc.).
    #[serde(default)]
    pub parameters: Vec<IrParameter>,
}

/// Fully-qualified parameter descriptor shared across backends.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IrParameter {
    /// Fully-qualified name (e.g. `variant.payload.count`).
    pub name: String,
    /// Optional description for documentation/diagnostics.
    #[serde(default)]
    pub description: Option<String>,
    /// True when this parameter is derived from other params/fields rather than
    /// supplied directly by callers.
    #[serde(default)]
    pub derived: bool,
}

/// Endianness for multi-byte numeric encodings.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Endianness {
    Little,
    Big,
}

impl Default for Endianness {
    fn default() -> Self {
        Endianness::Little
    }
}

/// Metadata shared by every IR node.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct NodeMetadata {
    /// Optional label for the size expression that produced this node.
    #[serde(default)]
    pub size_expr: Option<String>,
    /// Required alignment after executing this node.
    #[serde(default = "NodeMetadata::default_alignment")]
    pub alignment: u64,
    /// Endianness used for any loads/stores performed by the node.
    #[serde(default)]
    pub endianness: Endianness,
}

impl NodeMetadata {
    fn default_alignment() -> u64 {
        1
    }

    /// Convenience helper for creating metadata with a concrete alignment.
    pub fn aligned(alignment: u64) -> Self {
        Self {
            size_expr: None,
            alignment,
            endianness: Endianness::Little,
        }
    }
}

impl Default for NodeMetadata {
    fn default() -> Self {
        Self {
            size_expr: None,
            alignment: Self::default_alignment(),
            endianness: Endianness::Little,
        }
    }
}

/// Core IR node enum. Every variant carries explicit metadata as required by
/// the spec (size/alignment/endianness).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "kebab-case")]
pub enum IrNode {
    ZeroSize {
        #[serde(flatten)]
        meta: NodeMetadata,
    },
    Const(ConstNode),
    FieldRef(FieldRefNode),
    AlignUp(AlignNode),
    Switch(SwitchNode),
    CallNested(CallNestedNode),
    AddChecked(BinaryOpNode),
    MulChecked(BinaryOpNode),
}

/// Represents a compile-time constant footprint contribution.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConstNode {
    pub value: u64,
    #[serde(flatten)]
    pub meta: NodeMetadata,
}

/// Represents a dynamic field reference (count, tag, etc.).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FieldRefNode {
    /// Fully-qualified reference path.
    pub path: String,
    /// Optional cached parameter name (mirrors `IrParameter::name`).
    #[serde(default)]
    pub parameter: Option<String>,
    #[serde(flatten)]
    pub meta: NodeMetadata,
}

/// Node that rounds its inner payload up to the specified alignment.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AlignNode {
    pub alignment: u64,
    pub node: Box<IrNode>,
    #[serde(flatten)]
    pub meta: NodeMetadata,
}

/// Switch over a tag value, allowing variant-specific IR subtrees.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwitchNode {
    /// Name of the tag parameter used for this dispatch.
    pub tag: String,
    pub cases: Vec<SwitchCase>,
    #[serde(default)]
    pub default: Option<Box<IrNode>>,
    #[serde(flatten)]
    pub meta: NodeMetadata,
}

/// Case entry for [`SwitchNode`].
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SwitchCase {
    pub tag_value: u64,
    pub node: Box<IrNode>,
    /// Parameters that become available inside this branch.
    #[serde(default)]
    pub parameters: Vec<IrParameter>,
}

/// Calls into another type's IR (nested struct/enum/union).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CallNestedNode {
    /// Target type name.
    pub type_name: String,
    /// Arguments provided to the callee (fully-qualified names).
    #[serde(default)]
    pub arguments: Vec<IrArgument>,
    #[serde(flatten)]
    pub meta: NodeMetadata,
}

/// Argument passed to [`CallNestedNode`].
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IrArgument {
    /// Parameter name defined by the callee.
    pub name: String,
    /// Expression or parameter reference in the caller.
    pub value: String,
}

/// Checked arithmetic nodes (Add/Mul).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BinaryOpNode {
    pub left: Box<IrNode>,
    pub right: Box<IrNode>,
    #[serde(flatten)]
    pub meta: NodeMetadata,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_ir_roundtrip() {
        let ir = LayoutIr::new(vec![TypeIr {
            type_name: "Example".into(),
            alignment: 4,
            root: IrNode::Const(ConstNode {
                value: 4,
                meta: NodeMetadata::aligned(4),
            }),
            parameters: vec![IrParameter {
                name: "payload.len".into(),
                description: Some("Number of elements in payload".into()),
                derived: false,
            }],
        }]);

        let json = serde_json::to_string_pretty(&ir).expect("serialize");
        let de: LayoutIr = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(de.version, IR_SCHEMA_VERSION);
        assert_eq!(de.types.len(), 1);
        assert_eq!(de.types[0].type_name, "Example");
        if let IrNode::Const(ConstNode { value, .. }) = &de.types[0].root {
            assert_eq!(value, &4);
        } else {
            panic!("expected const node");
        }
    }
}
