/* Handler for Interval type */

use super::{extract_i64, get_field};
use crate::well_known::traits::{WellKnownContext, WellKnownResult, WellKnownType};
use chrono::{DateTime, TimeZone, Utc};
use serde_json::{Map, Value as JsonValue};

/* Handler for Interval values (start and end timestamps) */
pub struct IntervalHandler;

impl WellKnownType for IntervalHandler {
    fn type_name(&self) -> &'static str {
        "Interval"
    }

    fn category(&self) -> &'static str {
        "google"
    }

    fn process(&self, ctx: &WellKnownContext) -> WellKnownResult {
        let Some(fields) = ctx.fields else {
            return WellKnownResult::None;
        };

        let start_time = get_field(fields, "start_time").and_then(extract_i64);
        let end_time = get_field(fields, "end_time").and_then(extract_i64);

        if let (Some(start), Some(end)) = (start_time, end_time) {
            let start_dt: Option<DateTime<Utc>> = match Utc.timestamp_opt(start, 0) {
                chrono::LocalResult::Single(dt) => Some(dt),
                _ => None,
            };
            let end_dt: Option<DateTime<Utc>> = match Utc.timestamp_opt(end, 0) {
                chrono::LocalResult::Single(dt) => Some(dt),
                _ => None,
            };

            let formatted = match (start_dt, end_dt) {
                (Some(s), Some(e)) => format!("{} - {}", s.to_rfc3339(), e.to_rfc3339()),
                _ => format!("{} - {}", start, end),
            };

            let mut enrichment = Map::new();
            enrichment.insert("formatted".to_string(), JsonValue::String(formatted));
            if let Some(s) = start_dt {
                enrichment.insert("startIso8601".to_string(), JsonValue::String(s.to_rfc3339()));
            }
            if let Some(e) = end_dt {
                enrichment.insert("endIso8601".to_string(), JsonValue::String(e.to_rfc3339()));
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
    fn interval_handler_type_name() {
        let handler = IntervalHandler;
        assert_eq!(handler.type_name(), "Interval");
        assert_eq!(handler.category(), "google");
    }
}
