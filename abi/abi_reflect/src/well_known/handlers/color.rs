/* Handler for Color type */

use super::{extract_f32, get_field};
use crate::well_known::traits::{WellKnownContext, WellKnownResult, WellKnownType};
use serde_json::{Map, Value as JsonValue};

/* Handler for Color values (RGBA floats 0.0-1.0) */
pub struct ColorHandler;

impl WellKnownType for ColorHandler {
    fn type_name(&self) -> &'static str {
        "Color"
    }

    fn category(&self) -> &'static str {
        "google"
    }

    fn process(&self, ctx: &WellKnownContext) -> WellKnownResult {
        let Some(fields) = ctx.fields else {
            return WellKnownResult::None;
        };

        let red = get_field(fields, "red").and_then(extract_f32);
        let green = get_field(fields, "green").and_then(extract_f32);
        let blue = get_field(fields, "blue").and_then(extract_f32);
        let alpha = get_field(fields, "alpha").and_then(extract_f32).unwrap_or(1.0);

        if let (Some(r), Some(g), Some(b)) = (red, green, blue) {
            /* Convert to 0-255 range and format as hex */
            let r8 = (r.clamp(0.0, 1.0) * 255.0).round() as u8;
            let g8 = (g.clamp(0.0, 1.0) * 255.0).round() as u8;
            let b8 = (b.clamp(0.0, 1.0) * 255.0).round() as u8;
            let a8 = (alpha.clamp(0.0, 1.0) * 255.0).round() as u8;

            let hex = format!("#{:02X}{:02X}{:02X}{:02X}", r8, g8, b8, a8);

            let mut enrichment = Map::new();
            enrichment.insert("hex".to_string(), JsonValue::String(hex));
            return WellKnownResult::EnrichFields(enrichment);
        }

        WellKnownResult::None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn color_handler_type_name() {
        let handler = ColorHandler;
        assert_eq!(handler.type_name(), "Color");
        assert_eq!(handler.category(), "google");
    }
}
