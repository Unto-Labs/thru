//! Version string utilities for thru binaries.
//!
//! Provides a macro to generate version strings with git info.
//! The macro must be used because env vars are resolved per-crate at compile time.

/// Generate a version string with git info.
///
/// Returns format: "0.1.0+abc1234" or "0.1.0+abc1234-dirty"
///
/// # Example
/// ```ignore
/// use thru_base::get_version;
/// let version: &'static str = get_version!();
/// ```
#[macro_export]
macro_rules! get_version {
    () => {{
        use std::sync::OnceLock;
        static VERSION: OnceLock<&'static str> = OnceLock::new();

        *VERSION.get_or_init(|| {
            let base = env!("CARGO_PKG_VERSION");
            let sha = option_env!("VERGEN_GIT_SHA").unwrap_or("unknown");
            let sha_short = if sha.len() > 7 { &sha[..7] } else { sha };
            let dirty = option_env!("VERGEN_GIT_DIRTY")
                .map(|d| if d == "true" { "-dirty" } else { "" })
                .unwrap_or("");
            let version = format!("{}+{}{}", base, sha_short, dirty);
            Box::leak(version.into_boxed_str())
        })
    }};
}
