//! Feature gate / chain param registry loading.
//!
//! The registry is the off-chain metadata layer: it gives account indices human
//! names, descriptions, lifecycle/status information, and value encodings. The
//! live values themselves are read from the on-chain global feature-gate account.

use crate::error::CliError;
use serde::Deserialize;
use std::collections::HashSet;
use std::path::Path;

// The default registry is bundled so installed CLI binaries do not depend on a
// source-checkout path. --registry remains available for local/dev overrides.
const DEFAULT_FEATURE_GATE_REGISTRY_TOML: &str =
    include_str!("../registry/feature-gates-registry.toml");

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FeatureGateRegistryKind {
    FeatureGate,
    ChainParam,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FeatureGateRegistryStatus {
    Reserved,
    PendingImplementation,
    Deployed,
    Armed,
    Activated,
    Deactivated,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FeatureGateRegistryType {
    U8,
    U16,
    U32,
    U64,
    U128,
    U256,
    U512,
}

impl FeatureGateRegistryType {
    pub fn width_bytes(&self) -> usize {
        match self {
            FeatureGateRegistryType::U8 => 1,
            FeatureGateRegistryType::U16 => 2,
            FeatureGateRegistryType::U32 => 4,
            FeatureGateRegistryType::U64 => 8,
            FeatureGateRegistryType::U128 => 16,
            FeatureGateRegistryType::U256 => 32,
            FeatureGateRegistryType::U512 => 64,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FeatureGateRegistryCategory {
    ConsensusCritical,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FeatureGateRegistryEntry {
    pub index: u32,
    pub name: String,
    pub kind: FeatureGateRegistryKind,
    pub description: String,
    pub status: Option<FeatureGateRegistryStatus>,
    pub category: Option<FeatureGateRegistryCategory>,
    pub value_type: Option<FeatureGateRegistryType>,
    pub tracking: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FeatureGateRegistry {
    entries: Vec<FeatureGateRegistryEntry>,
}

impl FeatureGateRegistry {
    pub fn entries(&self) -> &[FeatureGateRegistryEntry] {
        &self.entries
    }

    pub fn get_by_index(&self, index: u32) -> Option<&FeatureGateRegistryEntry> {
        self.entries
            .get(index as usize)
            .filter(|entry| entry.index == index)
    }

    pub fn get_by_name(&self, name: &str) -> Option<&FeatureGateRegistryEntry> {
        self.entries.iter().find(|entry| entry.name == name)
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawRegistry {
    entry: Vec<RawRegistryEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct RawRegistryEntry {
    index: u32,
    name: String,
    kind: String,
    description: String,
    status: Option<String>,
    category: Option<String>,
    #[serde(rename = "type")]
    value_type: Option<String>,
    tracking: String,
}

pub fn load_feature_gate_registry(path: Option<&Path>) -> Result<FeatureGateRegistry, CliError> {
    if let Some(path) = path {
        let content = std::fs::read_to_string(path).map_err(|err| {
            CliError::Io(std::io::Error::new(
                err.kind(),
                format!(
                    "failed to read feature gate registry {}: {}",
                    path.display(),
                    err
                ),
            ))
        })?;
        return parse_feature_gate_registry(&content);
    }

    parse_feature_gate_registry(DEFAULT_FEATURE_GATE_REGISTRY_TOML)
}

pub fn parse_feature_gate_registry(content: &str) -> Result<FeatureGateRegistry, CliError> {
    let raw: RawRegistry = toml::from_str(content).map_err(|err| {
        CliError::Validation(format!("invalid feature gate registry TOML: {}", err))
    })?;

    if raw.entry.is_empty() {
        return Err(CliError::Validation(
            "feature gate registry must contain at least one entry".to_string(),
        ));
    }

    let mut seen_names = HashSet::new();
    let mut entries = Vec::with_capacity(raw.entry.len());

    for (position, raw_entry) in raw.entry.into_iter().enumerate() {
        // Registry order is the canonical on-chain table order.  Requiring
        // index == position prevents holes and accidental index reuse.
        let expected_index = u32::try_from(position).map_err(|_| {
            CliError::Validation("feature gate registry has too many entries".to_string())
        })?;
        if raw_entry.index != expected_index {
            return Err(CliError::Validation(format!(
                "feature gate registry entry '{}' has index {}, expected {}",
                raw_entry.name, raw_entry.index, expected_index
            )));
        }

        validate_non_empty("name", &raw_entry.name)?;
        validate_registry_name(&raw_entry.name)?;
        validate_non_empty("description", &raw_entry.description)?;
        validate_non_empty("tracking", &raw_entry.tracking)?;

        if !seen_names.insert(raw_entry.name.clone()) {
            return Err(CliError::Validation(format!(
                "duplicate feature gate registry name '{}'",
                raw_entry.name
            )));
        }

        let kind = parse_kind(&raw_entry.kind)?;
        // Feature gates and chain params share the same account table, but their
        // metadata fields are intentionally disjoint.
        let (status, category, value_type) = match kind {
            FeatureGateRegistryKind::FeatureGate => {
                if raw_entry.category.is_some() || raw_entry.value_type.is_some() {
                    return Err(CliError::Validation(format!(
                        "feature gate registry entry '{}' must not set category or type",
                        raw_entry.name
                    )));
                }
                let status = raw_entry.status.as_deref().ok_or_else(|| {
                    CliError::Validation(format!(
                        "feature gate registry entry '{}' is missing status",
                        raw_entry.name
                    ))
                })?;
                (Some(parse_status(status)?), None, None)
            }
            FeatureGateRegistryKind::ChainParam => {
                if raw_entry.status.is_some() {
                    return Err(CliError::Validation(format!(
                        "chain param registry entry '{}' must not set status",
                        raw_entry.name
                    )));
                }
                let category = raw_entry.category.as_deref().ok_or_else(|| {
                    CliError::Validation(format!(
                        "chain param registry entry '{}' is missing category",
                        raw_entry.name
                    ))
                })?;
                let value_type = raw_entry.value_type.as_deref().ok_or_else(|| {
                    CliError::Validation(format!(
                        "chain param registry entry '{}' is missing type",
                        raw_entry.name
                    ))
                })?;
                (
                    None,
                    Some(parse_category(category)?),
                    Some(parse_type(value_type)?),
                )
            }
        };

        entries.push(FeatureGateRegistryEntry {
            index: raw_entry.index,
            name: raw_entry.name,
            kind,
            description: raw_entry.description,
            status,
            category,
            value_type,
            tracking: raw_entry.tracking,
        });
    }

    Ok(FeatureGateRegistry { entries })
}

fn validate_non_empty(field: &str, value: &str) -> Result<(), CliError> {
    if value.trim().is_empty() {
        return Err(CliError::Validation(format!(
            "feature gate registry field '{}' must not be empty",
            field
        )));
    }
    Ok(())
}

fn validate_registry_name(name: &str) -> Result<(), CliError> {
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return Err(CliError::Validation(
            "feature gate registry name must not be empty".to_string(),
        ));
    };
    if !first.is_ascii_lowercase() {
        return Err(CliError::Validation(format!(
            "feature gate registry name '{}' must start with a lowercase letter",
            name
        )));
    }
    if !chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_') {
        return Err(CliError::Validation(format!(
            "feature gate registry name '{}' must contain only lowercase letters, digits, or underscores",
            name
        )));
    }
    Ok(())
}

fn parse_kind(kind: &str) -> Result<FeatureGateRegistryKind, CliError> {
    match kind {
        "feature-gate" => Ok(FeatureGateRegistryKind::FeatureGate),
        "chain-param" => Ok(FeatureGateRegistryKind::ChainParam),
        other => Err(CliError::Validation(format!(
            "unsupported feature gate registry kind '{}'",
            other
        ))),
    }
}

fn parse_status(status: &str) -> Result<FeatureGateRegistryStatus, CliError> {
    match status {
        "reserved" => Ok(FeatureGateRegistryStatus::Reserved),
        "pending-implementation" => Ok(FeatureGateRegistryStatus::PendingImplementation),
        "deployed" => Ok(FeatureGateRegistryStatus::Deployed),
        "armed" => Ok(FeatureGateRegistryStatus::Armed),
        "activated" => Ok(FeatureGateRegistryStatus::Activated),
        "deactivated" => Ok(FeatureGateRegistryStatus::Deactivated),
        other => Err(CliError::Validation(format!(
            "unsupported feature gate registry status '{}'",
            other
        ))),
    }
}

fn parse_category(category: &str) -> Result<FeatureGateRegistryCategory, CliError> {
    match category {
        "consensus-critical" => Ok(FeatureGateRegistryCategory::ConsensusCritical),
        other => Err(CliError::Validation(format!(
            "unsupported feature gate registry category '{}'",
            other
        ))),
    }
}

fn parse_type(value_type: &str) -> Result<FeatureGateRegistryType, CliError> {
    match value_type {
        "u8" => Ok(FeatureGateRegistryType::U8),
        "u16" => Ok(FeatureGateRegistryType::U16),
        "u32" => Ok(FeatureGateRegistryType::U32),
        "u64" => Ok(FeatureGateRegistryType::U64),
        "u128" => Ok(FeatureGateRegistryType::U128),
        "u256" => Ok(FeatureGateRegistryType::U256),
        "u512" => Ok(FeatureGateRegistryType::U512),
        other => Err(CliError::Validation(format!(
            "unsupported feature gate registry type '{}'",
            other
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const VALID_REGISTRY: &str = r#"
[[entry]]
index = 0
name = "parallel_exec"
kind = "feature-gate"
description = "Reserved binary feature gate used by genesis tests."
status = "reserved"
tracking = "UNTO-1818"

[[entry]]
index = 1
name = "max_compute_units_per_txn"
kind = "chain-param"
description = "Reserved consensus-critical runtime parameter encoded as a u64."
category = "consensus-critical"
type = "u64"
tracking = "UNTO-1818"
"#;

    #[test]
    fn parses_valid_registry() {
        let registry = parse_feature_gate_registry(VALID_REGISTRY).expect("valid registry");

        assert_eq!(registry.entries().len(), 2);
        assert_eq!(registry.get_by_index(0).unwrap().name, "parallel_exec");
        assert_eq!(
            registry
                .get_by_name("max_compute_units_per_txn")
                .unwrap()
                .kind,
            FeatureGateRegistryKind::ChainParam
        );
        assert_eq!(
            registry
                .get_by_name("max_compute_units_per_txn")
                .unwrap()
                .value_type,
            Some(FeatureGateRegistryType::U64)
        );
    }

    #[test]
    fn loads_bundled_default_registry() {
        let registry = load_feature_gate_registry(None).expect("bundled registry parses");

        assert!(!registry.entries().is_empty());
    }

    #[test]
    fn rejects_non_monotonic_index() {
        let content = VALID_REGISTRY.replace("index = 1", "index = 2");
        let err = parse_feature_gate_registry(&content).unwrap_err();

        assert!(err.to_string().contains("expected 1"));
    }

    #[test]
    fn rejects_duplicate_name() {
        let content = VALID_REGISTRY.replace("max_compute_units_per_txn", "parallel_exec");
        let err = parse_feature_gate_registry(&content).unwrap_err();

        assert!(err.to_string().contains("duplicate"));
    }

    #[test]
    fn rejects_invalid_registry_name() {
        let content = VALID_REGISTRY.replace("parallel_exec", "Parallel-Exec");
        let err = parse_feature_gate_registry(&content).unwrap_err();

        assert!(err.to_string().contains("lowercase"));
    }

    #[test]
    fn accepts_documented_feature_gate_statuses() {
        for status in [
            "reserved",
            "pending-implementation",
            "deployed",
            "armed",
            "activated",
            "deactivated",
        ] {
            let content = VALID_REGISTRY
                .replace("status = \"reserved\"", &format!("status = \"{}\"", status));
            parse_feature_gate_registry(&content).unwrap_or_else(|err| {
                panic!("status {} should parse: {}", status, err);
            });
        }
    }

    #[test]
    fn rejects_feature_gate_without_status() {
        let content = VALID_REGISTRY.replace("status = \"reserved\"\n", "");
        let err = parse_feature_gate_registry(&content).unwrap_err();

        assert!(err.to_string().contains("missing status"));
    }

    #[test]
    fn rejects_chain_param_without_category() {
        let content = VALID_REGISTRY.replace("category = \"consensus-critical\"\n", "");
        let err = parse_feature_gate_registry(&content).unwrap_err();

        assert!(err.to_string().contains("missing category"));
    }

    #[test]
    fn accepts_documented_chain_param_types() {
        for (value_type, width) in [
            ("u8", 1),
            ("u16", 2),
            ("u32", 4),
            ("u64", 8),
            ("u128", 16),
            ("u256", 32),
            ("u512", 64),
        ] {
            let content =
                VALID_REGISTRY.replace("type = \"u64\"", &format!("type = \"{}\"", value_type));
            let registry = parse_feature_gate_registry(&content).unwrap_or_else(|err| {
                panic!("type {} should parse: {}", value_type, err);
            });
            assert_eq!(
                registry
                    .get_by_name("max_compute_units_per_txn")
                    .unwrap()
                    .value_type
                    .as_ref()
                    .unwrap()
                    .width_bytes(),
                width
            );
        }
    }

    #[test]
    fn rejects_unsupported_chain_param_type() {
        let content = VALID_REGISTRY.replace("type = \"u64\"", "type = \"i64\"");
        let err = parse_feature_gate_registry(&content).unwrap_err();

        assert!(err.to_string().contains("unsupported"));
    }
}
