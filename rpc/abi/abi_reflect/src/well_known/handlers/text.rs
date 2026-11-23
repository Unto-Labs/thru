/* Handler for Text type */

use super::{extract_bytes, get_field};
use crate::well_known::traits::{WellKnownContext, WellKnownResult, WellKnownType};
use serde_json::{Map, Value as JsonValue};

/* Handler for Text values: UTF-8 bytes with a 16-bit length */
pub struct TextHandler;

impl WellKnownType for TextHandler {
    fn type_name(&self) -> &'static str {
        "Text"
    }

    fn display_key(&self) -> Option<(&'static str, &'static str)> {
        Some(("text", "text"))
    }

    fn process(&self, ctx: &WellKnownContext) -> WellKnownResult {
        let Some(fields) = ctx.fields else {
            return WellKnownResult::None;
        };
        let text = get_field(fields, "bytes")
            .and_then(extract_bytes)
            .and_then(|bytes| String::from_utf8(bytes).ok());
        match text {
            Some(text) => {
                let mut enrichment = Map::new();
                enrichment.insert("text".to_string(), JsonValue::String(text));
                WellKnownResult::EnrichFields(enrichment)
            }
            None => WellKnownResult::None,
        }
    }
}
