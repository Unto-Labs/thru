/* Handler for DayOfWeek type */

use super::{extract_u8_field, get_field};
use crate::well_known::traits::{WellKnownContext, WellKnownResult, WellKnownType};
use serde_json::{Map, Value as JsonValue};

const DAY_NAMES: [&str; 7] = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
];

/* Handler for DayOfWeek values (0=Sunday through 6=Saturday) */
pub struct DayOfWeekHandler;

impl WellKnownType for DayOfWeekHandler {
    fn type_name(&self) -> &'static str {
        "DayOfWeek"
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
            let name = if (v as usize) < DAY_NAMES.len() {
                DAY_NAMES[v as usize].to_string()
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn day_of_week_handler_type_name() {
        let handler = DayOfWeekHandler;
        assert_eq!(handler.type_name(), "DayOfWeek");
        assert_eq!(handler.category(), "google");
    }
}
