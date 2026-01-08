/* Handler for DateTime type */

use super::{extract_i32, extract_u8_field, get_field};
use crate::well_known::traits::{WellKnownContext, WellKnownResult, WellKnownType};
use chrono::{FixedOffset, TimeZone, Timelike};
use serde_json::{Map, Value as JsonValue};

/* Handler for DateTime values (full date and time with timezone) */
pub struct DateTimeHandler;

impl WellKnownType for DateTimeHandler {
    fn type_name(&self) -> &'static str {
        "DateTime"
    }

    fn process(&self, ctx: &WellKnownContext) -> WellKnownResult {
        let Some(fields) = ctx.fields else {
            return WellKnownResult::None;
        };

        let year = get_field(fields, "year").and_then(extract_i32);
        let month = get_field(fields, "month").and_then(extract_u8_field);
        let day = get_field(fields, "day").and_then(extract_u8_field);
        let hours = get_field(fields, "hours").and_then(extract_u8_field);
        let minutes = get_field(fields, "minutes").and_then(extract_u8_field);
        let seconds = get_field(fields, "seconds").and_then(extract_u8_field);
        let nanos = get_field(fields, "nanos").and_then(extract_i32).unwrap_or(0);
        let utc_offset_seconds = get_field(fields, "utc_offset_seconds")
            .and_then(extract_i32)
            .unwrap_or(0);

        if let (Some(y), Some(mo), Some(d), Some(h), Some(mi), Some(s)) =
            (year, month, day, hours, minutes, seconds)
        {
            /* Create datetime with timezone offset */
            let offset = match FixedOffset::east_opt(utc_offset_seconds) {
                Some(o) => o,
                None => return WellKnownResult::None,
            };

            let dt = match offset.with_ymd_and_hms(y, mo as u32, d as u32, h as u32, mi as u32, s as u32) {
                chrono::LocalResult::Single(dt) => dt,
                _ => return WellKnownResult::None,
            };

            let dt_with_nanos = dt
                .with_nanosecond(nanos as u32)
                .unwrap_or(dt);

            let mut enrichment = Map::new();
            enrichment.insert("iso8601".to_string(), JsonValue::String(dt_with_nanos.to_rfc3339()));
            return WellKnownResult::EnrichFields(enrichment);
        }

        WellKnownResult::None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn datetime_handler_type_name() {
        let handler = DateTimeHandler;
        assert_eq!(handler.type_name(), "DateTime");
    }
}
