/* Handler for LatLng type */

use super::{extract_f64, get_field};
use crate::well_known::traits::{WellKnownContext, WellKnownResult, WellKnownType};
use serde_json::{Map, Value as JsonValue};

/* Handler for LatLng values (geographic coordinates) */
pub struct LatLngHandler;

impl WellKnownType for LatLngHandler {
    fn type_name(&self) -> &'static str {
        "LatLng"
    }

    fn category(&self) -> &'static str {
        "google"
    }

    fn process(&self, ctx: &WellKnownContext) -> WellKnownResult {
        let Some(fields) = ctx.fields else {
            return WellKnownResult::None;
        };

        let latitude = get_field(fields, "latitude").and_then(extract_f64);
        let longitude = get_field(fields, "longitude").and_then(extract_f64);

        if let (Some(lat), Some(lng)) = (latitude, longitude) {
            let formatted = format!("{:.6}, {:.6}", lat, lng);

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
    fn latlng_handler_type_name() {
        let handler = LatLngHandler;
        assert_eq!(handler.type_name(), "LatLng");
        assert_eq!(handler.category(), "google");
    }
}
