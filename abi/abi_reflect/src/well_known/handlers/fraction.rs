/* Handler for Fraction type */

use super::{extract_i64, get_field};
use crate::well_known::traits::{WellKnownContext, WellKnownResult, WellKnownType};
use serde_json::{Map, Value as JsonValue};

/* Handler for Fraction values (numerator / denominator) */
pub struct FractionHandler;

impl WellKnownType for FractionHandler {
    fn type_name(&self) -> &'static str {
        "Fraction"
    }

    fn category(&self) -> &'static str {
        "google"
    }

    fn process(&self, ctx: &WellKnownContext) -> WellKnownResult {
        let Some(fields) = ctx.fields else {
            return WellKnownResult::None;
        };

        let numerator = get_field(fields, "numerator").and_then(extract_i64);
        let denominator = get_field(fields, "denominator").and_then(extract_i64);

        if let (Some(num), Some(denom)) = (numerator, denominator) {
            let formatted = format!("{}/{}", num, denom);

            /* Also compute decimal value if denominator is non-zero */
            let decimal = if denom != 0 {
                Some(num as f64 / denom as f64)
            } else {
                None
            };

            let mut enrichment = Map::new();
            enrichment.insert("formatted".to_string(), JsonValue::String(formatted));
            if let Some(dec) = decimal {
                enrichment.insert("decimal".to_string(), JsonValue::from(dec));
            }
            return WellKnownResult::EnrichFields(enrichment);
        }

        WellKnownResult::None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fraction_handler_type_name() {
        let handler = FractionHandler;
        assert_eq!(handler.type_name(), "Fraction");
        assert_eq!(handler.category(), "google");
    }
}
