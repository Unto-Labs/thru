/* Handler for Duration type */

use super::{extract_i32, extract_i64, get_field};
use crate::well_known::traits::{WellKnownContext, WellKnownResult, WellKnownType};
use serde_json::{Map, Value as JsonValue};

/* Handler for Duration values (seconds + nanos) */
pub struct DurationHandler;

impl WellKnownType for DurationHandler {
    fn type_name(&self) -> &'static str {
        "Duration"
    }

    fn process(&self, ctx: &WellKnownContext) -> WellKnownResult {
        let Some(fields) = ctx.fields else {
            return WellKnownResult::None;
        };

        let seconds = get_field(fields, "seconds").and_then(extract_i64);
        let nanos = get_field(fields, "nanos").and_then(extract_i32).unwrap_or(0);

        if let Some(secs) = seconds {
            let iso8601 = format_iso8601_duration(secs, nanos);

            let mut enrichment = Map::new();
            enrichment.insert("iso8601".to_string(), JsonValue::String(iso8601));
            return WellKnownResult::EnrichFields(enrichment);
        }

        WellKnownResult::None
    }
}

/* Format duration as ISO 8601 (e.g., PT1H30M, PT-1H30M for negative) */
fn format_iso8601_duration(seconds: i64, nanos: i32) -> String {
    let is_negative = seconds < 0 || (seconds == 0 && nanos < 0);
    let total_secs = seconds.unsigned_abs();
    let abs_nanos = nanos.unsigned_abs();

    let hours = total_secs / 3600;
    let minutes = (total_secs % 3600) / 60;
    let secs = total_secs % 60;

    let mut result = String::from("P");
    if is_negative {
        result.push('-');
    }
    result.push('T');

    if hours > 0 {
        result.push_str(&format!("{hours}H"));
    }
    if minutes > 0 {
        result.push_str(&format!("{minutes}M"));
    }
    if secs > 0 || abs_nanos > 0 || (hours == 0 && minutes == 0) {
        if abs_nanos > 0 {
            let frac = abs_nanos as f64 / 1_000_000_000.0;
            let frac_str = format!("{:.9}", frac);
            let frac_part = frac_str.trim_start_matches("0.").trim_end_matches('0');
            result.push_str(&format!("{secs}.{frac_part}S"));
        } else {
            result.push_str(&format!("{secs}S"));
        }
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_duration_simple() {
        assert_eq!(format_iso8601_duration(3600, 0), "PT1H");
        assert_eq!(format_iso8601_duration(90, 0), "PT1M30S");
        assert_eq!(format_iso8601_duration(5400, 0), "PT1H30M");
    }

    #[test]
    fn format_duration_with_nanos() {
        assert_eq!(format_iso8601_duration(1, 500_000_000), "PT1.5S");
    }

    #[test]
    fn format_duration_zero() {
        assert_eq!(format_iso8601_duration(0, 0), "PT0S");
    }
}
