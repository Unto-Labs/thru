//! Git Repository Import Fetcher
//!
//! Fetches ABI files from git repositories with support for branch, tag, and commit pinning.

use crate::fetcher::{FetchContext, FetchError, FetchResult, GitFetcherConfig, ImportFetcher};
use crate::file::ImportSource;
use git2::{Cred, FetchOptions, RemoteCallbacks, Repository};
use sha2::{Digest, Sha256};
use std::path::PathBuf;

/* Git repository fetcher */
pub struct GitFetcher {
    config: GitFetcherConfig,
    cache_dir: PathBuf,
}

impl GitFetcher {
    /* Create a new git fetcher with the given configuration */
    pub fn new(config: &GitFetcherConfig) -> Self {
        let cache_dir = dirs::cache_dir()
            .unwrap_or_else(|| PathBuf::from("/tmp"))
            .join("thru-abi-git-cache");

        Self {
            config: config.clone(),
            cache_dir,
        }
    }

    /* Generate a cache key for a repository URL */
    fn cache_key(&self, url: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(url.as_bytes());
        let result = hasher.finalize();
        hex::encode(&result[..16])
    }

    /* Get the cached repository path */
    fn repo_cache_path(&self, url: &str) -> PathBuf {
        self.cache_dir.join(self.cache_key(url))
    }

    /* Create fetch options with authentication callbacks */
    fn create_fetch_options(&self) -> FetchOptions<'_> {
        let mut callbacks = RemoteCallbacks::new();

        /* Set up credentials callback */
        let ssh_key_path = self.config.ssh_key_path.clone();
        let use_credential_helper = self.config.use_credential_helper;

        callbacks.credentials(move |url, username_from_url, allowed_types| {
            /* Try SSH key authentication first */
            if allowed_types.contains(git2::CredentialType::SSH_KEY) {
                if let Some(ref key_path) = ssh_key_path {
                    /* Use explicit SSH key */
                    return Cred::ssh_key(
                        username_from_url.unwrap_or("git"),
                        None,
                        key_path,
                        None,
                    );
                } else {
                    /* Try SSH agent */
                    if let Ok(cred) = Cred::ssh_key_from_agent(username_from_url.unwrap_or("git")) {
                        return Ok(cred);
                    }
                }
            }

            /* Try credential helper for HTTPS */
            if allowed_types.contains(git2::CredentialType::USER_PASS_PLAINTEXT)
                && use_credential_helper
            {
                return Cred::credential_helper(
                    &git2::Config::open_default().unwrap_or_else(|_| git2::Config::new().unwrap()),
                    url,
                    username_from_url,
                );
            }

            /* Try default credentials */
            if allowed_types.contains(git2::CredentialType::DEFAULT) {
                return Cred::default();
            }

            Err(git2::Error::from_str("no authentication methods available"))
        });

        let mut fetch_options = FetchOptions::new();
        fetch_options.remote_callbacks(callbacks);
        fetch_options.download_tags(git2::AutotagOption::All);

        /* Set proxy if configured */
        if let Some(ref proxy_url) = self.config.proxy {
            let mut proxy_opts = git2::ProxyOptions::new();
            proxy_opts.url(proxy_url);
            fetch_options.proxy_options(proxy_opts);
        }

        fetch_options
    }

    /* Clone or update a repository */
    fn clone_or_fetch(&self, url: &str) -> Result<Repository, FetchError> {
        let repo_path = self.repo_cache_path(url);

        if repo_path.exists() {
            /* Try to open existing repo and fetch updates */
            match Repository::open(&repo_path) {
                Ok(repo) => {
                    /* Fetch latest from origin */
                    {
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
                    } /* Drop remote here before returning repo */

                    return Ok(repo);
                }
                Err(_) => {
                    /* Remove corrupted cache and re-clone */
                    let _ = std::fs::remove_dir_all(&repo_path);
                }
            }
        }

        /* Create cache directory if needed */
        std::fs::create_dir_all(&self.cache_dir)
            .map_err(|e| FetchError::Io(e))?;

        /* Clone the repository */
        let mut builder = git2::build::RepoBuilder::new();
        builder.fetch_options(self.create_fetch_options());

        builder
            .clone(url, &repo_path)
            .map_err(|e| FetchError::Git(format!("Failed to clone {}: {}", url, e)))
    }

    /* Checkout a specific ref (branch, tag, or commit) */
    #[allow(dead_code)]
    fn checkout_ref(&self, repo: &Repository, git_ref: &str) -> Result<(), FetchError> {
        /* Try to resolve the ref */
        let obj = repo
            .revparse_single(git_ref)
            .map_err(|e| FetchError::Git(format!("Failed to resolve ref '{}': {}", git_ref, e)))?;

        /* Checkout the commit */
        repo.checkout_tree(&obj, None)
            .map_err(|e| FetchError::Git(format!("Failed to checkout '{}': {}", git_ref, e)))?;

        /* Set HEAD to detached state at the commit */
        repo.set_head_detached(obj.id())
            .map_err(|e| FetchError::Git(format!("Failed to set HEAD: {}", e)))?;

        Ok(())
    }

    /* Read a file from the repository at a specific ref */
    fn read_file_at_ref(
        &self,
        repo: &Repository,
        git_ref: &str,
        path: &str,
    ) -> Result<String, FetchError> {
        /* Resolve the ref to a commit */
        let obj = repo
            .revparse_single(git_ref)
            .map_err(|e| FetchError::Git(format!("Failed to resolve ref '{}': {}", git_ref, e)))?;

        let commit = obj
            .peel_to_commit()
            .map_err(|e| FetchError::Git(format!("Failed to get commit: {}", e)))?;

        let tree = commit
            .tree()
            .map_err(|e| FetchError::Git(format!("Failed to get tree: {}", e)))?;

        /* Find the file in the tree */
        let entry = tree
            .get_path(std::path::Path::new(path))
            .map_err(|_| FetchError::NotFound(format!("File '{}' not found at ref '{}'", path, git_ref)))?;

        let blob = repo
            .find_blob(entry.id())
            .map_err(|e| FetchError::Git(format!("Failed to get blob: {}", e)))?;

        /* Read content as UTF-8 */
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

        /* Clone or update the repository */
        let repo = self.clone_or_fetch(url)?;

        /* Read the file at the specified ref */
        let content = self.read_file_at_ref(&repo, git_ref, path)?;

        /* Create canonical location identifier */
        let canonical_location = format!("git:{}@{}:{}", url, git_ref, path);

        Ok(FetchResult {
            content,
            canonical_location,
            is_remote: true,
            resolved_path: None,
        })
    }
}

/* Hex encoding helper (simple implementation to avoid extra dependency) */
mod hex {
    pub fn encode(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{:02x}", b)).collect()
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
