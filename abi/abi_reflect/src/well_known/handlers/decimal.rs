/* Handler for Decimal type */

use super::{extract_bytes, get_field};
use crate::well_known::traits::{WellKnownContext, WellKnownResult, WellKnownType};
use serde_json::{Map, Value as JsonValue};

/* Handler for Decimal values (string-encoded arbitrary precision) */
pub struct DecimalHandler;

impl WellKnownType for DecimalHandler {
    fn type_name(&self) -> &'static str {
        "Decimal"
    }

    fn process(&self, ctx: &WellKnownContext) -> WellKnownResult {
        let Some(fields) = ctx.fields else {
            return WellKnownResult::None;
        };

        /* Extract the string value from bytes */
        if let Some(value_field) = get_field(fields, "value") {
            if let Some(bytes) = extract_bytes(value_field) {
                if let Ok(formatted) = String::from_utf8(bytes) {
                    let mut enrichment = Map::new();
                    enrichment.insert("formatted".to_string(), JsonValue::String(formatted));
                    return WellKnownResult::EnrichFields(enrichment);
                }
            }
        }

        WellKnownResult::None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decimal_handler_type_name() {
        let handler = DecimalHandler;
        assert_eq!(handler.type_name(), "Decimal");
    }
}
