//! `thru-cli` — legacy binary name for the Thru blockchain CLI.
//!
//! This is a thin wrapper around [`thru_core::run`].

use anyhow::Result;
use tracing_subscriber::{EnvFilter, fmt, prelude::*};

fn print_deprecation_warning() {
    use std::io::IsTerminal;
    if std::io::stderr().is_terminal() {
        eprintln!("\n\x1b[33mWarning: `thru-cli` is being moved to `thru`, and will soon be deprecated.\x1b[0m");
        eprintln!("\x1b[33m  Install it with: cargo install thru\x1b[0m");
        eprintln!();
    }
}

#[tokio::main]
async fn main() -> Result<()> {
    print_deprecation_warning();

    tracing_subscriber::registry()
        .with(fmt::layer())
        .with(EnvFilter::from_default_env())
        .init();

    thru_core::run().await
}
