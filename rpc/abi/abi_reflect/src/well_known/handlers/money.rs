/* Handler for Money type */

use super::{extract_bytes, extract_i32, extract_i64, get_field};
use crate::well_known::traits::{WellKnownContext, WellKnownResult, WellKnownType};
use serde_json::{Map, Value as JsonValue};

/* Handler for Money values (currency code + units + nanos) */
pub struct MoneyHandler;

impl WellKnownType for MoneyHandler {
    fn type_name(&self) -> &'static str {
        "Money"
    }

    fn category(&self) -> &'static str {
        "google"
    }

    fn process(&self, ctx: &WellKnownContext) -> WellKnownResult {
        let Some(fields) = ctx.fields else {
            return WellKnownResult::None;
        };

        let currency_code = get_field(fields, "currency_code")
            .and_then(extract_bytes)
            .and_then(|bytes| String::from_utf8(bytes).ok())
            .map(|s| s.trim_end_matches('\0').to_string());
        let units = get_field(fields, "units").and_then(extract_i64);
        let nanos = get_field(fields, "nanos").and_then(extract_i32).unwrap_or(0);

        if let (Some(code), Some(u)) = (currency_code, units) {
            /* Format as "USD 123.45" */
            let abs_units = u.unsigned_abs();
            let abs_nanos = nanos.unsigned_abs();
            let is_negative = u < 0 || (u == 0 && nanos < 0);

            let formatted = if abs_nanos > 0 {
                /* Convert nanos to decimal */
                let decimal = abs_nanos as f64 / 1_000_000_000.0;
                let decimal_str = format!("{:.9}", decimal);
                let frac_part = decimal_str
                    .trim_start_matches("0.")
                    .trim_end_matches('0');
                let sign = if is_negative { "-" } else { "" };
                format!("{} {}{}.{}", code, sign, abs_units, frac_part)
            } else {
                let sign = if is_negative { "-" } else { "" };
                format!("{} {}{}", code, sign, abs_units)
            };

            let mut enrichment = Map::new();
            enrichment.insert("currencyCode".to_string(), JsonValue::String(code));
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
    fn money_handler_type_name() {
        let handler = MoneyHandler;
        assert_eq!(handler.type_name(), "Money");
        assert_eq!(handler.category(), "google");
    }
}
