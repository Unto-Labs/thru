/* Handler for Hash type */

use super::try_extract_bytes_field;
use crate::well_known::traits::{WellKnownContext, WellKnownResult, WellKnownType};
use serde_json::{Map, Value as JsonValue};

/* Handler for 32-byte Hash values */
pub struct HashHandler;

impl WellKnownType for HashHandler {
    fn type_name(&self) -> &'static str {
        "Hash"
    }

    fn process(&self, ctx: &WellKnownContext) -> WellKnownResult {
        let Some(fields) = ctx.fields else {
            return WellKnownResult::None;
        };

        if let Some(hash_bytes) = try_extract_bytes_field(fields, 32) {
            let hex = hash_bytes
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>();

            let mut enrichment = Map::new();
            enrichment.insert("hex".to_string(), JsonValue::String(format!("0x{hex}")));
            return WellKnownResult::EnrichFields(enrichment);
        }

        WellKnownResult::None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_handler_type_name() {
        let handler = HashHandler;
        assert_eq!(handler.type_name(), "Hash");
    }
}
