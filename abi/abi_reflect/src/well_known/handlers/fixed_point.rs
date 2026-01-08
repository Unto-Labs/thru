/* Handler for FixedPoint type */

use super::{extract_i64, extract_u8_field, get_field};
use crate::well_known::traits::{WellKnownContext, WellKnownResult, WellKnownType};
use serde_json::{Map, Value as JsonValue};

/* Handler for FixedPoint values (mantissa + scale) */
pub struct FixedPointHandler;

impl WellKnownType for FixedPointHandler {
    fn type_name(&self) -> &'static str {
        "FixedPoint"
    }

    fn process(&self, ctx: &WellKnownContext) -> WellKnownResult {
        let Some(fields) = ctx.fields else {
            return WellKnownResult::None;
        };

        let mantissa = get_field(fields, "mantissa").and_then(extract_i64);
        let scale = get_field(fields, "scale").and_then(extract_u8_field);

        if let (Some(m), Some(s)) = (mantissa, scale) {
            let formatted = format_fixed_point(m, s);

            let mut enrichment = Map::new();
            enrichment.insert("formatted".to_string(), JsonValue::String(formatted));
            return WellKnownResult::EnrichFields(enrichment);
        }

        WellKnownResult::None
    }
}

/* Format a fixed-point number with given mantissa and scale */
fn format_fixed_point(mantissa: i64, scale: u8) -> String {
    if scale == 0 {
        return mantissa.to_string();
    }

    let is_negative = mantissa < 0;
    let abs_mantissa = mantissa.unsigned_abs();

    let divisor = match 10u64.checked_pow(scale as u32) {
        Some(d) => d,
        None => return "0".to_string(), // Scale too large - fallback to "0"
    };

    let integer_part = abs_mantissa / divisor;
    let fractional_part = abs_mantissa % divisor;

    let sign = if is_negative { "-" } else { "" };

    if fractional_part == 0 {
        format!("{sign}{integer_part}")
    } else {
        /* Format fractional part with leading zeros preserved */
        let frac_str = format!("{:0>width$}", fractional_part, width = scale as usize);
        let trimmed = frac_str.trim_end_matches('0');
        format!("{sign}{integer_part}.{trimmed}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_fixed_point_basic() {
        assert_eq!(format_fixed_point(12345, 2), "123.45");
        assert_eq!(format_fixed_point(100, 2), "1");
        assert_eq!(format_fixed_point(1, 2), "0.01");
    }

    #[test]
    fn format_fixed_point_negative() {
        assert_eq!(format_fixed_point(-12345, 2), "-123.45");
    }

    #[test]
    fn format_fixed_point_no_scale() {
        assert_eq!(format_fixed_point(12345, 0), "12345");
    }
}
