/* Handler for Quaternion type */

use super::{extract_f64, get_field};
use crate::well_known::traits::{WellKnownContext, WellKnownResult, WellKnownType};
use serde_json::{Map, Value as JsonValue};

/* Handler for Quaternion values (x, y, z, w components) */
pub struct QuaternionHandler;

impl WellKnownType for QuaternionHandler {
    fn type_name(&self) -> &'static str {
        "Quaternion"
    }

    fn category(&self) -> &'static str {
        "google"
    }

    fn process(&self, ctx: &WellKnownContext) -> WellKnownResult {
        let Some(fields) = ctx.fields else {
            return WellKnownResult::None;
        };

        let x = get_field(fields, "x").and_then(extract_f64);
        let y = get_field(fields, "y").and_then(extract_f64);
        let z = get_field(fields, "z").and_then(extract_f64);
        let w = get_field(fields, "w").and_then(extract_f64);

        if let (Some(x), Some(y), Some(z), Some(w)) = (x, y, z, w) {
            let formatted = format!("({:.6}, {:.6}, {:.6}, {:.6})", x, y, z, w);

            let mut enrichment = Map::new();
            enrichment.insert("formatted".to_string(), JsonValue::String(formatted));
            return WellKnownResult::EnrichFields(enrichment);
        }

        WellKnownResult::None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quaternion_handler_type_name() {
        let handler = QuaternionHandler;
        assert_eq!(handler.type_name(), "Quaternion");
        assert_eq!(handler.category(), "google");
    }
}
