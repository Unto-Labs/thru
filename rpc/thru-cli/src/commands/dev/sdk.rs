//! SDK management commands

use anyhow::{anyhow, Result};
use colored::Colorize;
use flate2::read::GzDecoder;
use std::path::{Path, PathBuf};
use tar::Archive;

use crate::config::Config;
use crate::error::CliError;

use super::github;

/// Get the default SDK installation path for a language
fn get_default_sdk_path(language: &str) -> Result<PathBuf> {
    let home_dir = dirs::home_dir().ok_or_else(|| anyhow!("Could not find home directory"))?;
    Ok(home_dir.join(".thru").join("sdk").join(language))
}

/// Get the SDK path from config or default
fn get_sdk_path(config: &Config, language: &str, custom_path: Option<&str>) -> Result<PathBuf> {
    if let Some(path) = custom_path {
        return Ok(PathBuf::from(path));
    } else if let Some(ref paths) = config.sdk_paths {
        if let Some(path) = paths.get(language) {
            return Ok(path.clone());
        }
    }
    get_default_sdk_path(language)
}

/// Validate SDK language
fn validate_language(language: &str) -> Result<(), CliError> {
    match language {
        "c" | "cpp" | "rust" => Ok(()),
        _ => Err(CliError::Validation(format!(
            "Invalid SDK language '{}'. Must be one of: c, cpp, rust",
            language
        ))),
    }
}

/// Verify that the SDK is properly installed
fn verify_sdk(sdk_path: &Path, language: &str) -> Result<String> {
    /* Check for key SDK files based on language */
    match language {
        "c" => {
            let header_path = sdk_path.join("thru-sdk").join("c").join("tn_sdk.h");
            if !header_path.exists() {
                return Err(anyhow!(
                    "SDK verification failed: {} not found",
                    header_path.display()
                ));
            }
            Ok("C SDK verified".to_string())
        }
        "cpp" => {
            let header_path = sdk_path.join("thru-sdk").join("cpp").join("tn_sdk.hpp");
            if !header_path.exists() {
                return Err(anyhow!(
                    "SDK verification failed: {} not found",
                    header_path.display()
                ));
            }
            Ok("C++ SDK verified".to_string())
        }
        "rust" => {
            let cargo_path = sdk_path.join("Cargo.toml");
            if !cargo_path.exists() {
                return Err(anyhow!(
                    "SDK verification failed: {} not found",
                    cargo_path.display()
                ));
            }
            Ok("Rust SDK verified".to_string())
        }
        _ => Err(anyhow!("Unknown language: {}", language)),
    }
}

/// Extract a tar.gz archive
async fn extract_sdk_tarball(archive_path: &Path, dest_dir: &Path) -> Result<()> {
    println!("{}", "Extracting SDK...".cyan());

    /* Open the tar.gz file */
    let tar_gz = std::fs::File::open(archive_path)?;
    let tar = GzDecoder::new(tar_gz);
    let mut archive = Archive::new(tar);

    /* Extract to a temporary directory first */
    let temp_extract = dest_dir.with_file_name(format!(
        "{}.extract",
        dest_dir.file_name().unwrap().to_str().unwrap()
    ));

    if temp_extract.exists() {
        tokio::fs::remove_dir_all(&temp_extract).await?;
    }

    tokio::fs::create_dir_all(&temp_extract).await?;

    /* Extract the archive */
    archive.unpack(&temp_extract)?;

    /* The archive contains a directory, we need to move its contents */
    let mut entries = tokio::fs::read_dir(&temp_extract).await?;
    let extracted_dir = loop {
        if let Some(entry) = entries.next_entry().await? {
            if entry.file_type().await?.is_dir() {
                break entry.path();
            }
        } else {
            return Err(anyhow!("No directory found in extracted archive"));
        }
    };

    /* Move the contents to the final destination */
    if dest_dir.exists() {
        tokio::fs::remove_dir_all(dest_dir).await?;
    }

    tokio::fs::rename(&extracted_dir, dest_dir).await?;

    /* Clean up temp directory */
    tokio::fs::remove_dir_all(&temp_extract).await?;

    println!("{}", "Extraction complete".green());

    Ok(())
}

/// Download SDK from GitHub releases
async fn download_sdk(version: &str, language: &str, dest_path: &Path, repo: Option<&str>) -> Result<()> {
    /* Construct the asset name */
    let asset_name = format!("thru-program-sdk-{}-{}.tar.gz", language, version);

    /* Parse repository */
    let repo_str = repo.unwrap_or("Unto-Labs/thru");
    let parts: Vec<&str> = repo_str.split('/').collect();
    if parts.len() != 2 {
        return Err(anyhow!(
            "Invalid repository format '{}'. Expected 'owner/repo'",
            repo_str
        ));
    }

    /* Use the github module to download */
    let client = reqwest::Client::new();
    let url = format!(
        "https://api.github.com/repos/{}/releases/tags/{}",
        repo_str, version
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

    #[derive(serde::Deserialize)]
    struct Release {
        assets: Vec<Asset>,
    }

    #[derive(serde::Deserialize)]
    struct Asset {
        name: String,
        browser_download_url: String,
        size: u64,
    }

    let release: Release = response.json().await?;

    /* Find the asset */
    let asset = release
        .assets
        .iter()
        .find(|a| a.name == asset_name)
        .ok_or_else(|| {
            anyhow!(
                "SDK not found for {} in release {}. Available assets: {}",
                language,
                version,
                release
                    .assets
                    .iter()
                    .map(|a| a.name.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            )
        })?;

    /* Download using the helper from github module */
    github::download_file_with_progress(&asset.browser_download_url, asset.size, dest_path).await?;

    Ok(())
}

/// Install the SDK
pub async fn install_sdk(
    config: &mut Config,
    language: &str,
    version: Option<&str>,
    custom_path: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    validate_language(language)?;

    /* Get repository from config or use default */
    let repo = config.github_repo.as_deref();

    /* Determine version to install */
    let version_to_install = if let Some(v) = version {
        v.to_string()
    } else {
        if !json_format {
            println!("{}", "Fetching latest release...".cyan());
        }
        github::get_latest_release(repo)
            .await
            .map_err(|e| CliError::Generic {
                message: format!("Failed to get latest release: {}", e),
            })?
    };

    if !json_format {
        println!(
            "{}",
            format!("Installing {} SDK version: {}", language.to_uppercase(), version_to_install)
                .cyan()
        );
    }

    /* Get installation path */
    let install_path = get_sdk_path(config, language, custom_path).map_err(|e| {
        CliError::Generic {
            message: format!("Failed to determine installation path: {}", e),
        }
    })?;

    if !json_format {
        println!(
            "{}",
            format!("Installation path: {}", install_path.display()).cyan()
        );
    }

    /* Check if SDK already exists */
    if install_path.exists() {
        if !json_format {
            println!(
                "{}",
                format!(
                    "SDK already exists at {}. It will be replaced.",
                    install_path.display()
                )
                .yellow()
            );
        }
    }

    /* Create parent directories */
    if let Some(parent) = install_path.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| CliError::Generic {
                message: format!("Failed to create directory {}: {}", parent.display(), e),
            })?;
    }

    /* Download SDK */
    let download_path = install_path.with_extension("tar.gz");

    download_sdk(&version_to_install, language, &download_path, repo)
        .await
        .map_err(|e| CliError::Generic {
            message: format!("Failed to download SDK: {}", e),
        })?;

    /* Extract SDK */
    extract_sdk_tarball(&download_path, &install_path)
        .await
        .map_err(|e| CliError::Generic {
            message: format!("Failed to extract SDK: {}", e),
        })?;

    /* Clean up download */
    tokio::fs::remove_file(&download_path)
        .await
        .map_err(|e| CliError::Generic {
            message: format!("Failed to remove download file: {}", e),
        })?;

    /* Build SDK for C/C++ languages */
    if language == "c" || language == "cpp" {
        if !json_format {
            println!("{}", "Building SDK...".cyan());
        }

        let make_result = tokio::process::Command::new("make")
            .arg(format!("BASEDIR={}/", install_path.display()))
            .arg("BUILDDIR=thru-sdk")
            .arg("all")
            .arg("lib")
            .arg("include")
            .current_dir(&install_path)
            .output()
            .await
            .map_err(|e| CliError::Generic {
                message: format!("Failed to run make command: {}", e),
            })?;

        if !make_result.status.success() {
            let stderr = String::from_utf8_lossy(&make_result.stderr);
            return Err(CliError::Generic {
                message: format!("SDK build failed: {}", stderr),
            });
        }

        if !json_format {
            println!("{}", "SDK build complete".green());
        }
    }

    /* Verify installation */
    let verify_msg = verify_sdk(&install_path, language).map_err(|e| CliError::Generic {
        message: format!("SDK verification failed: {}", e),
    })?;

    if !json_format {
        println!("{}", verify_msg.green());
    }

    /* Update config */
    if custom_path.is_some() || config.sdk_paths.is_some() {
        let mut paths = config.sdk_paths.clone().unwrap_or_default();
        paths.insert(language.to_string(), install_path.clone());
        config.sdk_paths = Some(paths);
    }

    let mut versions = config.sdk_versions.clone().unwrap_or_default();
    versions.insert(language.to_string(), version_to_install.clone());
    config.sdk_versions = Some(versions);

    config.save().await?;

    if json_format {
        println!(
            "{{\"status\":\"success\",\"language\":\"{}\",\"version\":\"{}\",\"path\":\"{}\"}}",
            language,
            version_to_install,
            install_path.display()
        );
    } else {
        println!("\n{}", "✓ SDK installed successfully".green().bold());
        println!("  Language: {}", language);
        println!("  Version: {}", version_to_install);
        println!("  Path: {}", install_path.display());
    }

    Ok(())
}

/// Update the SDK to the latest version
pub async fn update_sdk(
    config: &mut Config,
    language: &str,
    custom_path: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    validate_language(language)?;

    /* Get repository from config or use default */
    let repo = config.github_repo.as_deref();

    if !json_format {
        println!(
            "{}",
            format!("Updating {} SDK...", language.to_uppercase()).cyan()
        );
    }

    /* Get the current version */
    let current_version = config
        .sdk_versions
        .as_ref()
        .and_then(|v| v.get(language).cloned());

    /* Get latest version */
    let latest_version = github::get_latest_release(repo)
        .await
        .map_err(|e| CliError::Generic {
            message: format!("Failed to get latest release: {}", e),
        })?;

    if let Some(ref current) = current_version {
        if current == &latest_version {
            if json_format {
                println!(
                    "{{\"status\":\"up_to_date\",\"language\":\"{}\",\"version\":\"{}\"}}",
                    language, current
                );
            } else {
                println!(
                    "{}",
                    format!("{} SDK is already up to date ({})", language.to_uppercase(), current)
                        .green()
                );
            }
            return Ok(());
        }

        if !json_format {
            println!(
                "Updating from {} to {}",
                current.yellow(),
                latest_version.green()
            );
        }
    }

    /* Backup existing SDK if it exists */
    let install_path = get_sdk_path(config, language, custom_path).map_err(|e| {
        CliError::Generic {
            message: format!("Failed to determine installation path: {}", e),
        }
    })?;

    let backup_path = install_path.with_extension("backup");

    if install_path.exists() {
        if !json_format {
            println!("{}", "Backing up existing SDK...".cyan());
        }

        if backup_path.exists() {
            tokio::fs::remove_dir_all(&backup_path)
                .await
                .map_err(|e| CliError::Generic {
                    message: format!("Failed to remove old backup: {}", e),
                })?;
        }

        tokio::fs::rename(&install_path, &backup_path)
            .await
            .map_err(|e| CliError::Generic {
                message: format!("Failed to create backup: {}", e),
            })?;
    }

    /* Install new version */
    let result = install_sdk(config, language, Some(&latest_version), custom_path, json_format).await;

    match result {
        Ok(_) => {
            /* Remove backup on success */
            if backup_path.exists() {
                tokio::fs::remove_dir_all(&backup_path)
                    .await
                    .map_err(|e| CliError::Generic {
                        message: format!("Failed to remove backup: {}", e),
                    })?;
            }
            Ok(())
        }
        Err(e) => {
            /* Restore backup on failure */
            if backup_path.exists() {
                if !json_format {
                    println!("{}", "Installation failed, restoring backup...".yellow());
                }

                if install_path.exists() {
                    tokio::fs::remove_dir_all(&install_path)
                        .await
                        .map_err(|e| CliError::Generic {
                            message: format!("Failed to remove failed installation: {}", e),
                        })?;
                }

                tokio::fs::rename(&backup_path, &install_path)
                    .await
                    .map_err(|e| CliError::Generic {
                        message: format!("Failed to restore backup: {}", e),
                    })?;
            }
            Err(e)
        }
    }
}

/// Uninstall the SDK
pub async fn uninstall_sdk(
    config: &mut Config,
    language: &str,
    custom_path: Option<&str>,
    force: bool,
    json_format: bool,
) -> Result<(), CliError> {
    validate_language(language)?;

    let install_path = get_sdk_path(config, language, custom_path).map_err(|e| {
        CliError::Generic {
            message: format!("Failed to determine installation path: {}", e),
        }
    })?;

    if !install_path.exists() {
        if json_format {
            println!("{{\"status\":\"not_found\",\"language\":\"{}\"}}", language);
        } else {
            println!(
                "{}",
                format!(
                    "No {} SDK found at {}",
                    language.to_uppercase(),
                    install_path.display()
                )
                .yellow()
            );
        }
        return Ok(());
    }

    /* Confirm with user unless --force is used */
    if !force && !json_format {
        println!(
            "{}",
            format!(
                "This will remove the {} SDK at: {}",
                language.to_uppercase(),
                install_path.display()
            )
            .yellow()
        );
        println!("Are you sure? (yes/no)");

        let mut input = String::new();
        std::io::stdin()
            .read_line(&mut input)
            .map_err(|e| CliError::Generic {
                message: format!("Failed to read input: {}", e),
            })?;

        if input.trim().to_lowercase() != "yes" {
            println!("{}", "Uninstall cancelled".yellow());
            return Ok(());
        }
    }

    /* Remove SDK directory */
    tokio::fs::remove_dir_all(&install_path)
        .await
        .map_err(|e| CliError::Generic {
            message: format!("Failed to remove SDK: {}", e),
        })?;

    /* Clear config */
    if let Some(ref mut paths) = config.sdk_paths {
        paths.remove(language);
    }
    if let Some(ref mut versions) = config.sdk_versions {
        versions.remove(language);
    }
    config.save().await?;

    if json_format {
        println!("{{\"status\":\"success\",\"language\":\"{}\"}}", language);
    } else {
        println!(
            "{}",
            format!("✓ {} SDK uninstalled successfully", language.to_uppercase()).green()
        );
    }

    Ok(())
}

/// Get the SDK installation path
pub async fn get_sdk_path_command(
    config: &Config,
    language: &str,
    custom_path: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    validate_language(language)?;

    let install_path = get_sdk_path(config, language, custom_path).map_err(|e| {
        CliError::Generic {
            message: format!("Failed to determine installation path: {}", e),
        }
    })?;

    let exists = install_path.exists();

    /* Try to verify if it exists */
    let verified = if exists {
        verify_sdk(&install_path, language).is_ok()
    } else {
        false
    };

    if json_format {
        println!(
            "{{\"language\":\"{}\",\"path\":\"{}\",\"exists\":{},\"verified\":{}}}",
            language,
            install_path.display(),
            exists,
            verified
        );
    } else {
        println!(
            "{} SDK path: {}",
            language.to_uppercase(),
            install_path.display()
        );
        if exists {
            if verified {
                println!("Status: {} (verified)", "installed".green());
            } else {
                println!("Status: {} (not verified)", "installed".yellow());
            }
        } else {
            println!("Status: {}", "not installed".red());
        }
    }

    Ok(())
}
