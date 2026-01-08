/* Handler for TimeOfDay type */

use super::{extract_i32, extract_u8_field, get_field};
use crate::well_known::traits::{WellKnownContext, WellKnownResult, WellKnownType};
use serde_json::{Map, Value as JsonValue};

/* Handler for TimeOfDay values (hours, minutes, seconds, nanos) */
pub struct TimeOfDayHandler;

impl WellKnownType for TimeOfDayHandler {
    fn type_name(&self) -> &'static str {
        "TimeOfDay"
    }

    fn process(&self, ctx: &WellKnownContext) -> WellKnownResult {
        let Some(fields) = ctx.fields else {
            return WellKnownResult::None;
        };

        let hours = get_field(fields, "hours").and_then(extract_u8_field);
        let minutes = get_field(fields, "minutes").and_then(extract_u8_field);
        let seconds = get_field(fields, "seconds").and_then(extract_u8_field);
        let nanos = get_field(fields, "nanos").and_then(extract_i32).unwrap_or(0);

        if let (Some(h), Some(m), Some(s)) = (hours, minutes, seconds) {
            let formatted = if nanos > 0 {
                let frac = nanos as f64 / 1_000_000_000.0;
                let frac_str = format!("{:.9}", frac);
                let frac_part = frac_str.trim_start_matches("0.").trim_end_matches('0');
                format!("{:02}:{:02}:{:02}.{}", h, m, s, frac_part)
            } else {
                format!("{:02}:{:02}:{:02}", h, m, s)
            };

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
    fn time_of_day_handler_type_name() {
        let handler = TimeOfDayHandler;
        assert_eq!(handler.type_name(), "TimeOfDay");
    }
}
