//! HTTP/HTTPS Import Fetcher
//!
//! Fetches ABI files from HTTP/HTTPS URLs.

use crate::fetcher::{FetchContext, FetchError, FetchResult, ImportFetcher};
use crate::file::ImportSource;
use std::time::Duration;

/* HTTP/HTTPS URL fetcher */
pub struct HttpFetcher {
    client: reqwest::blocking::Client,
}

impl HttpFetcher {
    /* Create a new HTTP fetcher with default configuration */
    pub fn new() -> Result<Self, FetchError> {
        Self::with_timeout(30)
    }

    /* Create with custom timeout */
    pub fn with_timeout(timeout_seconds: u64) -> Result<Self, FetchError> {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(timeout_seconds))
            .user_agent("thru-abi-loader/1.0")
            .build()
            .map_err(|e| FetchError::Http {
                status: 0,
                message: format!("Failed to create HTTP client: {}", e),
            })?;

        Ok(Self { client })
    }
}

impl ImportFetcher for HttpFetcher {
    fn handles(&self, source: &ImportSource) -> bool {
        matches!(source, ImportSource::Http { .. })
    }

    fn fetch(&self, source: &ImportSource, _ctx: &FetchContext) -> Result<FetchResult, FetchError> {
        let ImportSource::Http { url } = source else {
            return Err(FetchError::UnsupportedSource(
                "HttpFetcher only handles Http imports".to_string(),
            ));
        };

        /* Perform the HTTP request */
        let response = self
            .client
            .get(url)
            .send()
            .map_err(|e| FetchError::Http {
                status: 0,
                message: format!("Request failed: {}", e),
            })?;

        /* Check response status */
        let status = response.status();
        if !status.is_success() {
            return Err(FetchError::Http {
                status: status.as_u16(),
                message: format!("HTTP {} for {}", status, url),
            });
        }

        /* Read response body */
        let content = response.text().map_err(|e| FetchError::Http {
            status: 0,
            message: format!("Failed to read response body: {}", e),
        })?;

        Ok(FetchResult {
            content,
            canonical_location: url.clone(),
            is_remote: true,
            resolved_path: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_http_fetcher_handles() {
        let fetcher = HttpFetcher::new().unwrap();

        let http_import = ImportSource::Http {
            url: "https://example.com/types.abi.yaml".to_string(),
        };
        let path_import = ImportSource::Path {
            path: "local.abi.yaml".to_string(),
        };
        let git_import = ImportSource::Git {
            url: "https://github.com/test/repo".to_string(),
            git_ref: "main".to_string(),
            path: "abi.yaml".to_string(),
        };

        assert!(fetcher.handles(&http_import));
        assert!(!fetcher.handles(&path_import));
        assert!(!fetcher.handles(&git_import));
    }

    /* Integration test - requires network access */
    #[test]
    #[ignore] /* Run with: cargo test -- --ignored */
    fn test_http_fetcher_real_request() {
        let fetcher = HttpFetcher::new().unwrap();
        let source = ImportSource::Http {
            url: "https://httpbin.org/get".to_string(),
        };
        let ctx = FetchContext {
            base_path: None,
            parent_is_remote: false,
            include_dirs: vec![],
        };

        let result = fetcher.fetch(&source, &ctx);
        assert!(result.is_ok());

        let fetch_result = result.unwrap();
        assert!(fetch_result.is_remote);
        assert!(fetch_result.content.contains("httpbin"));
    }
}
