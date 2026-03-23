/* Handler for InstructionData type */

use super::{extract_bytes, extract_u16, extract_u64, get_field};
use crate::well_known::traits::{WellKnownContext, WellKnownResult, WellKnownType};
use serde_json::{Map, Value as JsonValue};

/* Handler for InstructionData values (for recursive multicall resolution) */
pub struct InstructionDataHandler;

impl WellKnownType for InstructionDataHandler {
    fn type_name(&self) -> &'static str {
        "InstructionData"
    }

    fn category(&self) -> &'static str {
        "system"
    }

    fn process(&self, ctx: &WellKnownContext) -> WellKnownResult {
        let Some(fields) = ctx.fields else {
            return WellKnownResult::None;
        };

        let program_idx = get_field(fields, "program_idx").and_then(extract_u16);
        let data_size = get_field(fields, "data_size").and_then(extract_u64);
        let data = get_field(fields, "data").and_then(extract_bytes);

        let mut enrichment = Map::new();

        if let Some(idx) = program_idx {
            enrichment.insert(
                "programIndex".to_string(),
                JsonValue::Number(idx.into()),
            );
        }

        if let Some(size) = data_size {
            enrichment.insert(
                "dataSize".to_string(),
                JsonValue::Number(size.into()),
            );
        }

        if let Some(bytes) = &data {
            let hex = bytes
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>();
            enrichment.insert("dataHex".to_string(), JsonValue::String(format!("0x{hex}")));

            /* Mark as pending recursive resolution - actual resolution happens at API layer */
            enrichment.insert("_pendingReflection".to_string(), JsonValue::Bool(true));
        }

        if enrichment.is_empty() {
            WellKnownResult::None
        } else {
            WellKnownResult::EnrichFields(enrichment)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn instruction_data_handler_type_name() {
        let handler = InstructionDataHandler;
        assert_eq!(handler.type_name(), "InstructionData");
        assert_eq!(handler.category(), "system");
    }
}
