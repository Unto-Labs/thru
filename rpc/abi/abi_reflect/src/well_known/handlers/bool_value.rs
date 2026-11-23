/* Handler for Bool type */

use super::{extract_u8_field, get_field};
use crate::well_known::traits::{WellKnownContext, WellKnownResult, WellKnownType};
use serde_json::{Map, Value as JsonValue};

/* Handler for Bool values: one byte, 0 is false and anything else true */
pub struct BoolHandler;

impl WellKnownType for BoolHandler {
    fn type_name(&self) -> &'static str {
        "Bool"
    }

    fn display_key(&self) -> Option<(&'static str, &'static str)> {
        Some(("bool", "bool"))
    }

    fn process(&self, ctx: &WellKnownContext) -> WellKnownResult {
        let Some(fields) = ctx.fields else {
            return WellKnownResult::None;
        };
        match get_field(fields, "value").and_then(extract_u8_field) {
            Some(byte) => {
                let mut enrichment = Map::new();
                enrichment.insert("bool".to_string(), JsonValue::Bool(byte != 0));
                WellKnownResult::EnrichFields(enrichment)
            }
            None => WellKnownResult::None,
        }
    }
}
