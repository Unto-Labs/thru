//! GitHub API interaction for downloading toolchain releases

use anyhow::{anyhow, Result};
use indicatif::{ProgressBar, ProgressStyle};
use reqwest::Client;
use serde::Deserialize;
use std::path::Path;
use tokio::io::AsyncWriteExt;

const GITHUB_API_BASE: &str = "https://api.github.com";
const DEFAULT_GITHUB_REPO: &str = "Unto-Labs/thru";

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    #[allow(dead_code)]
    name: String,
    assets: Vec<GitHubAsset>,
}

#[derive(Debug, Deserialize)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
    size: u64,
}

/// Parse repository string into owner and name
fn parse_repo(repo: &str) -> Result<(&str, &str)> {
    let parts: Vec<&str> = repo.split('/').collect();
    if parts.len() != 2 {
        return Err(anyhow!(
            "Invalid repository format '{}'. Expected 'owner/repo'",
            repo
        ));
    }
    Ok((parts[0], parts[1]))
}

/// Get the latest release from GitHub
pub async fn get_latest_release(repo: Option<&str>) -> Result<String> {
    let repo = repo.unwrap_or(DEFAULT_GITHUB_REPO);
    let (owner, name) = parse_repo(repo)?;

    let client = Client::new();
    let url = format!(
        "{}/repos/{}/{}/releases/latest",
        GITHUB_API_BASE, owner, name
    );

    let response = client
        .get(&url)
        .header("User-Agent", "thru-cli")
        .send()
        .await?;

    if !response.status().is_success() {
        return Err(anyhow!(
            "Failed to fetch latest release: HTTP {}",
            response.status()
        ));
    }

    let release: GitHubRelease = response.json().await?;
    Ok(release.tag_name)
}

/// Get a specific release from GitHub
async fn get_release(version: &str, repo: Option<&str>) -> Result<GitHubRelease> {
    let repo = repo.unwrap_or(DEFAULT_GITHUB_REPO);
    let (owner, name) = parse_repo(repo)?;

    let client = Client::new();
    let url = format!(
        "{}/repos/{}/{}/releases/tags/{}",
        GITHUB_API_BASE, owner, name, version
    );

    let response = client
        .get(&url)
        .header("User-Agent", "thru-cli")
        .send()
        .await?;

    if !response.status().is_success() {
        return Err(anyhow!(
            "Failed to fetch release {}: HTTP {}",
            version,
            response.status()
        ));
    }

    Ok(response.json().await?)
}

/// Download a toolchain archive from GitHub releases
pub async fn download_toolchain(
    version: &str,
    os_name: &str,
    arch_name: &str,
    dest_path: &Path,
    repo: Option<&str>,
) -> Result<()> {
    let release = get_release(version, repo).await?;

    /* Construct the asset name */
    let asset_name = format!("thru-toolchain-{}-{}-{}.tar.gz", os_name, arch_name, version);

    /* Find the asset in the release */
    let asset = release
        .assets
        .iter()
        .find(|a| a.name == asset_name)
        .ok_or_else(|| {
            anyhow!(
                "Toolchain not found for {}-{} in release {}. Available assets: {}",
                os_name,
                arch_name,
                version,
                release
                    .assets
                    .iter()
                    .map(|a| a.name.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        })?;

    /* Download the asset */
    download_file_with_progress(&asset.browser_download_url, asset.size, dest_path).await?;

    Ok(())
}

/// Download a file with progress indication
pub async fn download_file_with_progress(url: &str, total_size: u64, dest_path: &Path) -> Result<()> {
    let client = Client::new();

    /* Create progress bar */
    let pb = ProgressBar::new(total_size);
    pb.set_style(
        ProgressStyle::default_bar()
            .template(
                "{msg}\n{spinner:.green} [{elapsed_precise}] [{wide_bar:.cyan/blue}] {bytes}/{total_bytes} ({eta})"
            )?
            .progress_chars("#>-"),
    );
    pb.set_message("Downloading toolchain");

    /* Send request */
    let response = client.get(url).send().await?;

    if !response.status().is_success() {
        return Err(anyhow!("Failed to download file: HTTP {}", response.status()));
    }

    /* Create temporary file */
    let temp_path = dest_path.with_extension("tmp");
    let mut file = tokio::fs::File::create(&temp_path).await?;

    /* Download chunks and write to file */
    let mut downloaded: u64 = 0;
    let mut stream = response.bytes_stream();

    use futures_util::StreamExt;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        file.write_all(&chunk).await?;
        downloaded += chunk.len() as u64;
        pb.set_position(downloaded);
    }

    file.flush().await?;
    drop(file);

    /* Rename temp file to final destination */
    tokio::fs::rename(&temp_path, dest_path).await?;

    pb.finish_with_message("Download complete");

    Ok(())
}
