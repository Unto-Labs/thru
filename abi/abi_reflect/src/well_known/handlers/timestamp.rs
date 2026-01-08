/* Handler for Timestamp type */

use super::{extract_i32, extract_i64, get_field};
use crate::well_known::traits::{WellKnownContext, WellKnownResult, WellKnownType};
use chrono::{DateTime, TimeZone, Utc};
use serde_json::{Map, Value as JsonValue};

/* Handler for Unix timestamp values (seconds and nanoseconds since epoch) */
pub struct TimestampHandler;

impl WellKnownType for TimestampHandler {
    fn type_name(&self) -> &'static str {
        "Timestamp"
    }

    fn process(&self, ctx: &WellKnownContext) -> WellKnownResult {
        let Some(fields) = ctx.fields else {
            return WellKnownResult::None;
        };

        /* Try to extract seconds and nanos fields */
        let seconds = get_field(fields, "seconds").and_then(extract_i64);
        let nanos = get_field(fields, "nanos").and_then(extract_i32).unwrap_or(0);

        if let Some(secs) = seconds {
            let dt: DateTime<Utc> = match Utc.timestamp_opt(secs, nanos as u32) {
                chrono::LocalResult::Single(dt) => dt,
                _ => return WellKnownResult::None,
            };

            let mut enrichment = Map::new();
            enrichment.insert("iso8601".to_string(), JsonValue::String(dt.to_rfc3339()));
            return WellKnownResult::EnrichFields(enrichment);
        }

        WellKnownResult::None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timestamp_handler_type_name() {
        let handler = TimestampHandler;
        assert_eq!(handler.type_name(), "Timestamp");
    }
}
