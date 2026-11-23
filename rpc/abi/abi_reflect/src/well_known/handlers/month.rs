/* Handler for Month type */

use super::{extract_u8_field, get_field};
use crate::well_known::traits::{WellKnownContext, WellKnownResult, WellKnownType};
use serde_json::{Map, Value as JsonValue};

const MONTH_NAMES: [&str; 12] = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];

/* Handler for Month values (1-12) */
pub struct MonthHandler;

impl WellKnownType for MonthHandler {
    fn type_name(&self) -> &'static str {
        "Month"
    }

    fn display_key(&self) -> Option<(&'static str, &'static str)> {
        Some(("text", "name"))
    }

    fn category(&self) -> &'static str {
        "google"
    }

    fn process(&self, ctx: &WellKnownContext) -> WellKnownResult {
        let Some(fields) = ctx.fields else {
            return WellKnownResult::None;
        };

        let value = get_field(fields, "value").and_then(extract_u8_field);

        if let Some(v) = value {
            let name = if v >= 1 && v <= 12 {
                MONTH_NAMES[(v - 1) as usize].to_string()
            } else {
                format!("Unknown({})", v)
            };

            let mut enrichment = Map::new();
            enrichment.insert("name".to_string(), JsonValue::String(name));
            return WellKnownResult::EnrichFields(enrichment);
        }

        WellKnownResult::None
    }
}
