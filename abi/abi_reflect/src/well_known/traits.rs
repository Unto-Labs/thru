/* Well-known type trait and context definitions */

use crate::value::ReflectedValue;
use serde_json::{Map, Value as JsonValue};

/* Context for well-known type processing */
pub struct WellKnownContext<'a> {
    /* The reflected value being processed */
    pub value: &'a ReflectedValue,
    /* Type name from reflection */
    pub type_name: &'a str,
    /* Struct fields if this is a struct */
    pub fields: Option<&'a [(String, ReflectedValue)]>,
}

/* Result of well-known type processing */
pub enum WellKnownResult {
    /* Additional fields to merge into the JSON object */
    EnrichFields(Map<String, JsonValue>),
    /* Replace the entire formatted value */
    Replace(JsonValue),
    /* No special handling needed */
    None,
}

/* Trait for well-known type handlers */
pub trait WellKnownType: Send + Sync {
    /* The canonical name of this well-known type */
    fn type_name(&self) -> &'static str;

    /* Check if this handler applies to the given type */
    fn matches(&self, ctx: &WellKnownContext) -> bool {
        ctx.type_name == self.type_name()
    }

    /* Process the value and return enrichment or replacement */
    fn process(&self, ctx: &WellKnownContext) -> WellKnownResult;

    /* Category for grouping (e.g., "thru", "google", "system") */
    fn category(&self) -> &'static str {
        "thru"
    }
}
