/* Handler for CalendarPeriod type */

use super::{extract_u8_field, get_field};
use crate::well_known::traits::{WellKnownContext, WellKnownResult, WellKnownType};
use serde_json::{Map, Value as JsonValue};

const PERIOD_NAMES: [&str; 8] = [
    "CALENDAR_PERIOD_UNSPECIFIED",
    "DAY",
    "WEEK",
    "FORTNIGHT",
    "MONTH",
    "QUARTER",
    "HALF",
    "YEAR",
];

/* Handler for CalendarPeriod values */
pub struct CalendarPeriodHandler;

impl WellKnownType for CalendarPeriodHandler {
    fn type_name(&self) -> &'static str {
        "CalendarPeriod"
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
            let name = if (v as usize) < PERIOD_NAMES.len() {
                PERIOD_NAMES[v as usize].to_string()
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
    fn calendar_period_handler_type_name() {
        let handler = CalendarPeriodHandler;
        assert_eq!(handler.type_name(), "CalendarPeriod");
        assert_eq!(handler.category(), "google");
    }
}
