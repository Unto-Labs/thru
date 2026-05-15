//! Version string utilities for thru binaries.
//!
//! Provides a macro to generate version strings with git info.
//! The macro must be used because env vars are resolved per-crate at compile time.

/// Generate a version string with git info.
///
/// Returns format: "0.1.0+abc12345" for release builds, or
/// "0.1.0-local+abc12345.dirty" for local dirty builds.
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
            if let Some(version) = option_env!("THRU_BUILD_VERSION") {
                return version;
            }

            let base = env!("CARGO_PKG_VERSION");
            let sha = option_env!("VERGEN_GIT_SHA").unwrap_or("unknown");
            let sha_short = if sha.len() > 8 { &sha[..8] } else { sha };
            let dirty = option_env!("VERGEN_GIT_DIRTY") == Some("true");
            let describe = option_env!("VERGEN_GIT_DESCRIBE").unwrap_or("");
            let release_tag = format!("v{}", base);
            let inferred_release = !dirty && (describe == base || describe == release_tag);
            let release = match option_env!("THRU_BUILD_CHANNEL") {
                Some("release") => true,
                Some("local") => false,
                _ => inferred_release,
            };
            let local_suffix = if release { "" } else { "-local" };
            let dirty_suffix = if dirty { ".dirty" } else { "" };
            let version = format!("{}{}+{}{}", base, local_suffix, sha_short, dirty_suffix);
            Box::leak(version.into_boxed_str())
        })
    }};
}
