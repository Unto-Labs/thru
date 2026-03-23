/* Handler for Date type */

use super::{extract_i32, extract_u8_field, get_field};
use crate::well_known::traits::{WellKnownContext, WellKnownResult, WellKnownType};
use chrono::NaiveDate;
use serde_json::{Map, Value as JsonValue};

/* Handler for Date values (year, month, day) */
pub struct DateHandler;

impl WellKnownType for DateHandler {
    fn type_name(&self) -> &'static str {
        "Date"
    }

    fn process(&self, ctx: &WellKnownContext) -> WellKnownResult {
        let Some(fields) = ctx.fields else {
            return WellKnownResult::None;
        };

        let year = get_field(fields, "year").and_then(extract_i32);
        let month = get_field(fields, "month").and_then(extract_u8_field);
        let day = get_field(fields, "day").and_then(extract_u8_field);

        if let (Some(y), Some(m), Some(d)) = (year, month, day) {
            /* Validate date using chrono before formatting */
            let date = match NaiveDate::from_ymd_opt(y, m as u32, d as u32) {
                Some(d) => d,
                None => return WellKnownResult::None,
            };

            /* Format as ISO 8601 date: YYYY-MM-DD */
            let iso8601 = date.format("%Y-%m-%d").to_string();

            let mut enrichment = Map::new();
            enrichment.insert("iso8601".to_string(), JsonValue::String(iso8601));
            return WellKnownResult::EnrichFields(enrichment);
        }

        WellKnownResult::None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn date_handler_type_name() {
        let handler = DateHandler;
        assert_eq!(handler.type_name(), "Date");
    }
}
