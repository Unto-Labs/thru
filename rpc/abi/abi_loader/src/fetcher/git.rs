//! Git Repository Import Fetcher
//!
//! Fetches ABI files from git repositories with support for branch, tag, and commit pinning.

use crate::fetcher::{FetchContext, FetchError, FetchResult, GitFetcherConfig, ImportFetcher};
use crate::file::ImportSource;
use git2::{Cred, FetchOptions, RemoteCallbacks, Repository};
use sha2::{Digest, Sha256};
use std::path::PathBuf;

pub struct GitFetcher {
    config: GitFetcherConfig,
    cache_dir: PathBuf,
}

impl GitFetcher {
    pub fn new(config: &GitFetcherConfig) -> Self {
        let cache_dir = dirs::cache_dir()
            .unwrap_or_else(|| PathBuf::from("/tmp"))
            .join("thru-abi-git-cache");

        Self {
            config: config.clone(),
            cache_dir,
        }
    }

    fn cache_key(&self, url: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(url.as_bytes());
        let result = hasher.finalize();
        hex::encode(&result[..16])
    }

    fn repo_cache_path(&self, url: &str) -> PathBuf {
        self.cache_dir.join(self.cache_key(url))
    }

    fn create_fetch_options(&self) -> FetchOptions<'_> {
        let mut callbacks = RemoteCallbacks::new();

        let ssh_key_path = self.config.ssh_key_path.clone();
        let use_credential_helper = self.config.use_credential_helper;

        callbacks.credentials(move |url, username_from_url, allowed_types| {
            if allowed_types.contains(git2::CredentialType::SSH_KEY) {
                if let Some(ref key_path) = ssh_key_path {
                    return Cred::ssh_key(username_from_url.unwrap_or("git"), None, key_path, None);
                } else if let Ok(cred) =
                    Cred::ssh_key_from_agent(username_from_url.unwrap_or("git"))
                {
                    return Ok(cred);
                }
            }

            if allowed_types.contains(git2::CredentialType::USER_PASS_PLAINTEXT)
                && use_credential_helper
            {
                return Cred::credential_helper(
                    &git2::Config::open_default().unwrap_or_else(|_| git2::Config::new().unwrap()),
                    url,
                    username_from_url,
                );
            }

            if allowed_types.contains(git2::CredentialType::DEFAULT) {
                return Cred::default();
            }

            Err(git2::Error::from_str("no authentication methods available"))
        });

        let mut fetch_options = FetchOptions::new();
        fetch_options.remote_callbacks(callbacks);
        fetch_options.download_tags(git2::AutotagOption::All);

        if let Some(ref proxy_url) = self.config.proxy {
            let mut proxy_opts = git2::ProxyOptions::new();
            proxy_opts.url(proxy_url);
            fetch_options.proxy_options(proxy_opts);
        }

        fetch_options
    }

    fn clone_or_fetch(&self, url: &str) -> Result<Repository, FetchError> {
        let repo_path = self.repo_cache_path(url);

        match Repository::open(&repo_path) {
            Ok(repo) => {
                let mut remote = repo
                    .find_remote("origin")
                    .map_err(|e| FetchError::Git(format!("Failed to find remote: {}", e)))?;

                let mut fetch_options = self.create_fetch_options();
                remote
                    .fetch(
                        &["refs/heads/*:refs/heads/*", "refs/tags/*:refs/tags/*"],
                        Some(&mut fetch_options),
                        None,
                    )
                    .map_err(|e| FetchError::Git(format!("Failed to fetch: {}", e)))?;
                drop(remote);

                Ok(repo)
            }
            Err(_) => {
                /* Open failed: either the cache is absent or corrupted.
                Wipe any remnant (no-op if absent) and clone fresh. */
                if repo_path.exists() {
                    std::fs::remove_dir_all(&repo_path).map_err(FetchError::Io)?;
                }
                std::fs::create_dir_all(&self.cache_dir).map_err(FetchError::Io)?;

                let mut builder = git2::build::RepoBuilder::new();
                builder.fetch_options(self.create_fetch_options());

                builder
                    .clone(url, &repo_path)
                    .map_err(|e| FetchError::Git(format!("Failed to clone {}: {}", url, e)))
            }
        }
    }

    fn read_file_at_ref(
        &self,
        repo: &Repository,
        git_ref: &str,
        path: &str,
    ) -> Result<String, FetchError> {
        let obj = repo
            .revparse_single(git_ref)
            .map_err(|e| FetchError::Git(format!("Failed to resolve ref '{}': {}", git_ref, e)))?;

        let commit = obj
            .peel_to_commit()
            .map_err(|e| FetchError::Git(format!("Failed to get commit: {}", e)))?;

        let tree = commit
            .tree()
            .map_err(|e| FetchError::Git(format!("Failed to get tree: {}", e)))?;

        let entry = tree.get_path(std::path::Path::new(path)).map_err(|_| {
            FetchError::NotFound(format!("File '{}' not found at ref '{}'", path, git_ref))
        })?;

        let blob = repo
            .find_blob(entry.id())
            .map_err(|e| FetchError::Git(format!("Failed to get blob: {}", e)))?;

        let content = std::str::from_utf8(blob.content())
            .map_err(|e| FetchError::Parse(format!("File is not valid UTF-8: {}", e)))?;

        Ok(content.to_string())
    }
}

impl ImportFetcher for GitFetcher {
    fn handles(&self, source: &ImportSource) -> bool {
        matches!(source, ImportSource::Git { .. })
    }

    fn fetch(&self, source: &ImportSource, _ctx: &FetchContext) -> Result<FetchResult, FetchError> {
        let ImportSource::Git { url, git_ref, path } = source else {
            return Err(FetchError::UnsupportedSource(
                "GitFetcher only handles Git imports".to_string(),
            ));
        };

        let repo = self.clone_or_fetch(url)?;
        let content = self.read_file_at_ref(&repo, git_ref, path)?;
        let canonical_location = format!("git:{}@{}:{}", url, git_ref, path);

        Ok(FetchResult {
            content,
            canonical_location,
            is_remote: true,
            resolved_path: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_git_fetcher_handles() {
        let config = GitFetcherConfig::default();
        let fetcher = GitFetcher::new(&config);

        let git_import = ImportSource::Git {
            url: "https://github.com/test/repo".to_string(),
            git_ref: "main".to_string(),
            path: "abi.yaml".to_string(),
        };
        let path_import = ImportSource::Path {
            path: "local.abi.yaml".to_string(),
        };

        assert!(fetcher.handles(&git_import));
        assert!(!fetcher.handles(&path_import));
    }

    #[test]
    fn test_cache_key_generation() {
        let config = GitFetcherConfig::default();
        let fetcher = GitFetcher::new(&config);

        let key1 = fetcher.cache_key("https://github.com/test/repo1");
        let key2 = fetcher.cache_key("https://github.com/test/repo2");
        let key1_again = fetcher.cache_key("https://github.com/test/repo1");

        assert_ne!(key1, key2);
        assert_eq!(key1, key1_again);
        assert_eq!(key1.len(), 32); /* SHA256 truncated to 16 bytes = 32 hex chars */
    }
}
