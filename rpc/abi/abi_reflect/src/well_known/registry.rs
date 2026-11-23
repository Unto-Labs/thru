/* Registry of well-known type handlers */

use super::handlers;
use super::traits::{WellKnownContext, WellKnownResult, WellKnownType};
use std::collections::HashMap;
use std::sync::Arc;

/* Registry of well-known type handlers */
#[derive(Clone)]
pub struct WellKnownRegistry {
    handlers: HashMap<String, Arc<dyn WellKnownType>>,
}

impl std::fmt::Debug for WellKnownRegistry {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WellKnownRegistry")
            .field("handlers", &self.handlers.keys().collect::<Vec<_>>())
            .finish()
    }
}

impl WellKnownRegistry {
    pub fn new() -> Self {
        Self {
            handlers: HashMap::new(),
        }
    }

    /* Create registry with default handlers */
    pub fn with_defaults() -> Self {
        let mut registry = Self::new();
        registry.register_defaults();
        registry
    }

    /* Register a handler */
    pub fn register(&mut self, handler: Arc<dyn WellKnownType>) {
        self.handlers
            .insert(handler.type_name().to_string(), handler);
    }

    /* Process a value through matching handlers */
    pub fn process(&self, ctx: &WellKnownContext) -> WellKnownResult {
        if let Some(handler) = self.handlers.get(ctx.type_name) {
            if handler.matches(ctx) {
                return handler.process(ctx);
            }
        }
        WellKnownResult::None
    }

    /* The one-line form of an enriched value of `type_name`: its display
     * kind and text. None when the type has no display form or the
     * enrichment lacks the text. */
    pub fn display_form(
        &self,
        type_name: &str,
        enriched: &serde_json::Map<String, serde_json::Value>,
    ) -> Option<(&'static str, String)> {
        let (kind, key) = self.handlers.get(type_name)?.display_key()?;
        let text = match enriched.get(key)? {
            serde_json::Value::String(text) => text.clone(),
            serde_json::Value::Bool(b) => b.to_string(),
            serde_json::Value::Number(n) => n.to_string(),
            _ => return None,
        };
        Some((kind, text))
    }

    /* Get list of registered type names */
    pub fn registered_types(&self) -> Vec<&str> {
        self.handlers.keys().map(|s| s.as_str()).collect()
    }

    fn register_defaults(&mut self) {
        /* Thru primitives */
        self.register(Arc::new(handlers::PubkeyHandler));
        self.register(Arc::new(handlers::SignatureHandler));
        self.register(Arc::new(handlers::HashHandler));
        self.register(Arc::new(handlers::BoolHandler));
        self.register(Arc::new(handlers::TextHandler));

        /* Time types */
        self.register(Arc::new(handlers::TimestampHandler));
        self.register(Arc::new(handlers::DurationHandler));
        self.register(Arc::new(handlers::DateHandler));
        self.register(Arc::new(handlers::DateTimeHandler));
        self.register(Arc::new(handlers::TimeOfDayHandler));

        /* Numeric types */
        self.register(Arc::new(handlers::DecimalHandler));
        self.register(Arc::new(handlers::FixedPointHandler));
        self.register(Arc::new(handlers::FractionHandler));

        /* Google types */
        self.register(Arc::new(handlers::ColorHandler));
        self.register(Arc::new(handlers::LatLngHandler));
        self.register(Arc::new(handlers::MoneyHandler));
        self.register(Arc::new(handlers::QuaternionHandler));
        self.register(Arc::new(handlers::IntervalHandler));
        self.register(Arc::new(handlers::DayOfWeekHandler));
        self.register(Arc::new(handlers::MonthHandler));
        self.register(Arc::new(handlers::CalendarPeriodHandler));

        /* System types */
        self.register(Arc::new(handlers::InstructionDataHandler));
    }
}

impl Default for WellKnownRegistry {
    fn default() -> Self {
        Self::with_defaults()
    }
}
