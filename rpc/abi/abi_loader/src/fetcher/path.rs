//! Path-based Import Fetcher
//!
//! Fetches ABI files from local filesystem paths.

use crate::fetcher::{FetchContext, FetchError, FetchResult, ImportFetcher};
use crate::file::ImportSource;
use std::path::PathBuf;

/* Local filesystem path fetcher */
pub struct PathFetcher;

impl PathFetcher {
    /* Create a new path fetcher */
    pub fn new() -> Self {
        Self
    }

    /* Resolve an import path relative to base file or include directories */
    fn resolve_path(&self, import_path: &str, ctx: &FetchContext) -> Result<PathBuf, FetchError> {
        /* First try relative to the base file's directory */
        if let Some(base) = &ctx.base_path {
            if let Some(parent) = base.parent() {
                let relative_path = parent.join(import_path);
                if relative_path.exists() {
                    return relative_path
                        .canonicalize()
                        .map_err(|e| FetchError::Io(e));
                }
            }
        }

        /* Then try each include directory */
        for include_dir in &ctx.include_dirs {
            let include_path = include_dir.join(import_path);
            if include_path.exists() {
                return include_path
                    .canonicalize()
                    .map_err(|e| FetchError::Io(e));
            }
        }

        Err(FetchError::NotFound(format!(
            "Import '{}' not found relative to {:?} or in include directories",
            import_path,
            ctx.base_path
        )))
    }
}

impl Default for PathFetcher {
    fn default() -> Self {
        Self::new()
    }
}

impl ImportFetcher for PathFetcher {
    fn handles(&self, source: &ImportSource) -> bool {
        matches!(source, ImportSource::Path { .. })
    }

    fn fetch(&self, source: &ImportSource, ctx: &FetchContext) -> Result<FetchResult, FetchError> {
        let ImportSource::Path { path } = source else {
            return Err(FetchError::UnsupportedSource(
                "PathFetcher only handles Path imports".to_string(),
            ));
        };

        /* Enforce remote import restriction: local imports not allowed from remote parents */
        if ctx.parent_is_remote {
            return Err(FetchError::LocalFromRemote(path.clone()));
        }

        /* Resolve the path */
        let resolved_path = self.resolve_path(path, ctx)?;

        /* Read the file content */
        let content = std::fs::read_to_string(&resolved_path)?;

        /* Create canonical location for caching/cycle detection */
        let canonical_location = resolved_path.to_string_lossy().to_string();

        Ok(FetchResult {
            content,
            canonical_location,
            is_remote: false,
            resolved_path: Some(resolved_path),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::TempDir;

    fn create_test_abi(dir: &std::path::Path, name: &str, content: &str) -> PathBuf {
        let path = dir.join(name);
        let mut file = std::fs::File::create(&path).unwrap();
        file.write_all(content.as_bytes()).unwrap();
        path
    }

    #[test]
    fn test_path_fetcher_handles() {
        let fetcher = PathFetcher::new();

        let path_import = ImportSource::Path {
            path: "test.abi.yaml".to_string(),
        };
        let git_import = ImportSource::Git {
            url: "https://github.com/test/repo".to_string(),
            git_ref: "main".to_string(),
            path: "abi.yaml".to_string(),
        };

        assert!(fetcher.handles(&path_import));
        assert!(!fetcher.handles(&git_import));
    }

    #[test]
    fn test_path_fetcher_relative_import() {
        let temp_dir = TempDir::new().unwrap();
        let abi_content = r#"
abi:
  package: "test.package"
  abi-version: 1
  package-version: "1.0.0"
  description: "Test ABI"
types: []
"#;

        let abi_path = create_test_abi(temp_dir.path(), "test.abi.yaml", abi_content);

        let fetcher = PathFetcher::new();
        let source = ImportSource::Path {
            path: "test.abi.yaml".to_string(),
        };
        let ctx = FetchContext {
            base_path: Some(temp_dir.path().join("main.abi.yaml")),
            parent_is_remote: false,
            include_dirs: vec![],
        };

        let result = fetcher.fetch(&source, &ctx).unwrap();
        assert!(!result.is_remote);
        assert!(result.content.contains("test.package"));
        assert_eq!(
            result.resolved_path.unwrap().canonicalize().unwrap(),
            abi_path.canonicalize().unwrap()
        );
    }

    #[test]
    fn test_path_fetcher_include_dir() {
        let temp_dir = TempDir::new().unwrap();
        let include_dir = temp_dir.path().join("include");
        std::fs::create_dir(&include_dir).unwrap();

        let abi_content = r#"
abi:
  package: "include.package"
  abi-version: 1
  package-version: "1.0.0"
  description: "Include ABI"
types: []
"#;
        create_test_abi(&include_dir, "include.abi.yaml", abi_content);

        let fetcher = PathFetcher::new();
        let source = ImportSource::Path {
            path: "include.abi.yaml".to_string(),
        };
        let ctx = FetchContext {
            base_path: Some(temp_dir.path().join("other").join("main.abi.yaml")),
            parent_is_remote: false,
            include_dirs: vec![include_dir],
        };

        let result = fetcher.fetch(&source, &ctx).unwrap();
        assert!(result.content.contains("include.package"));
    }

    #[test]
    fn test_path_fetcher_rejects_local_from_remote() {
        let fetcher = PathFetcher::new();
        let source = ImportSource::Path {
            path: "test.abi.yaml".to_string(),
        };
        let ctx = FetchContext {
            base_path: None,
            parent_is_remote: true, /* Parent was remote */
            include_dirs: vec![],
        };

        let result = fetcher.fetch(&source, &ctx);
        assert!(matches!(result, Err(FetchError::LocalFromRemote(_))));
    }

    #[test]
    fn test_path_fetcher_not_found() {
        let fetcher = PathFetcher::new();
        let source = ImportSource::Path {
            path: "nonexistent.abi.yaml".to_string(),
        };
        let ctx = FetchContext {
            base_path: Some(PathBuf::from("/tmp/test.abi.yaml")),
            parent_is_remote: false,
            include_dirs: vec![],
        };

        let result = fetcher.fetch(&source, &ctx);
        assert!(matches!(result, Err(FetchError::NotFound(_))));
    }
}
