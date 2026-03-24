//! `thru` — canonical binary for the Thru blockchain CLI.
//!
//! This is a thin wrapper around [`thru_core::run`].

use anyhow::Result;
use tracing_subscriber::{EnvFilter, fmt, prelude::*};

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::registry()
        .with(fmt::layer())
        .with(EnvFilter::from_default_env())
        .init();

    thru_core::run().await
}
