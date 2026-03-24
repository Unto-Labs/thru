//! Toolchain management commands

use anyhow::{anyhow, Result};
use colored::Colorize;
use flate2::read::GzDecoder;
use std::path::{Path, PathBuf};
use std::process::Command;
use tar::Archive;

use crate::config::Config;
use crate::error::CliError;

use super::github;

/// Get the default toolchain installation path
fn get_default_toolchain_path() -> Result<PathBuf> {
    let home_dir = dirs::home_dir().ok_or_else(|| anyhow!("Could not find home directory"))?;
    Ok(home_dir.join(".thru").join("sdk").join("toolchain"))
}

/// Get the toolchain path from config or default
fn get_toolchain_path(config: &Config, custom_path: Option<&str>) -> Result<PathBuf> {
    if let Some(path) = custom_path {
        Ok(PathBuf::from(path))
    } else if let Some(path) = &config.toolchain_path {
        Ok(path.clone())
    } else {
        get_default_toolchain_path()
    }
}

/// Detect the current operating system
fn detect_os() -> Result<String> {
    let output = Command::new("uname").arg("-s").output()?;

    if !output.status.success() {
        return Err(anyhow!("Failed to detect operating system"));
    }

    let os_name = String::from_utf8(output.stdout)?.trim().to_string();

    Ok(os_name)
}

/// Detect the current architecture
fn detect_arch() -> Result<String> {
    let output = Command::new("uname").arg("-m").output()?;

    if !output.status.success() {
        return Err(anyhow!("Failed to detect architecture"));
    }

    let arch_name = String::from_utf8(output.stdout)?.trim().to_string();

    Ok(arch_name)
}

/// Verify that the toolchain is properly installed
fn verify_toolchain(toolchain_path: &Path) -> Result<String> {
    let gcc_path = toolchain_path
        .join("bin")
        .join("riscv64-unknown-elf-gcc");

    if !gcc_path.exists() {
        return Err(anyhow!(
            "Toolchain verification failed: {} not found",
            gcc_path.display()
        ));
    }

    /* Try to run gcc --version to verify it works */
    let output = Command::new(&gcc_path).arg("--version").output()?;

    if !output.status.success() {
        return Err(anyhow!("Toolchain verification failed: gcc not executable"));
    }

    /* Parse version from output */
    let version_output = String::from_utf8(output.stdout)?;
    let version_line = version_output
        .lines()
        .next()
        .ok_or_else(|| anyhow!("Could not parse gcc version"))?;

    Ok(version_line.to_string())
}

/// Extract a tar.gz archive
async fn extract_tarball(archive_path: &Path, dest_dir: &Path) -> Result<()> {
    println!("{}", "Extracting toolchain...".cyan());

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

    /* The archive contains a directory with the toolchain name, we need to move its contents */
    /* Find the extracted directory (should be the only directory in temp_extract) */
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

/// Install the toolchain
pub async fn install_toolchain(
    config: &mut Config,
    version: Option<&str>,
    custom_path: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
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
            format!("Installing toolchain version: {}", version_to_install).cyan()
        );
    }

    /* Detect platform */
    let os_name = detect_os().map_err(|e| CliError::Generic {
        message: format!("Failed to detect OS: {}", e),
    })?;

    let arch_name = detect_arch().map_err(|e| CliError::Generic {
        message: format!("Failed to detect architecture: {}", e),
    })?;

    if !json_format {
        println!(
            "{}",
            format!("Detected platform: {}-{}", os_name, arch_name).cyan()
        );
    }

    /* Get installation path */
    let install_path = get_toolchain_path(config, custom_path).map_err(|e| CliError::Generic {
        message: format!("Failed to determine installation path: {}", e),
    })?;

    if !json_format {
        println!(
            "{}",
            format!("Installation path: {}", install_path.display()).cyan()
        );
    }

    /* Check if toolchain already exists */
    if install_path.exists() {
        if !json_format {
            println!(
                "{}",
                format!(
                    "Toolchain already exists at {}. It will be replaced.",
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

    /* Download toolchain */
    let download_path = install_path.with_extension("tar.gz");

    github::download_toolchain(
        &version_to_install,
        &os_name,
        &arch_name,
        &download_path,
        repo,
    )
    .await
    .map_err(|e| CliError::Generic {
        message: format!("Failed to download toolchain: {}", e),
    })?;

    /* Extract toolchain */
    extract_tarball(&download_path, &install_path)
        .await
        .map_err(|e| CliError::Generic {
            message: format!("Failed to extract toolchain: {}", e),
        })?;

    /* Clean up download */
    tokio::fs::remove_file(&download_path)
        .await
        .map_err(|e| CliError::Generic {
            message: format!("Failed to remove download file: {}", e),
        })?;

    /* Verify installation */
    let gcc_version = verify_toolchain(&install_path).map_err(|e| CliError::Generic {
        message: format!("Toolchain verification failed: {}", e),
    })?;

    if !json_format {
        println!("{}", "Toolchain verification successful".green());
        println!("{}", format!("GCC: {}", gcc_version).green());
    }

    /* Update config */
    if custom_path.is_some() {
        config.toolchain_path = Some(install_path.clone());
    }
    config.toolchain_version = Some(version_to_install.clone());
    config.save().await?;

    if json_format {
        println!(
            "{{\"status\":\"success\",\"version\":\"{}\",\"path\":\"{}\"}}",
            version_to_install,
            install_path.display()
        );
    } else {
        println!("\n{}", "✓ Toolchain installed successfully".green().bold());
        println!("  Version: {}", version_to_install);
        println!("  Path: {}", install_path.display());
    }

    Ok(())
}

/// Update the toolchain to the latest version
pub async fn update_toolchain(
    config: &mut Config,
    custom_path: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    /* Get repository from config or use default */
    let repo = config.github_repo.as_deref();

    if !json_format {
        println!("{}", "Updating toolchain...".cyan());
    }

    /* Get the current version */
    let current_version = config.toolchain_version.clone();

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
                    "{{\"status\":\"up_to_date\",\"version\":\"{}\"}}",
                    current
                );
            } else {
                println!(
                    "{}",
                    format!("Toolchain is already up to date ({})", current).green()
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

    /* Backup existing toolchain if it exists */
    let install_path = get_toolchain_path(config, custom_path).map_err(|e| CliError::Generic {
        message: format!("Failed to determine installation path: {}", e),
    })?;

    let backup_path = install_path.with_extension("backup");

    if install_path.exists() {
        if !json_format {
            println!("{}", "Backing up existing toolchain...".cyan());
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
    let result = install_toolchain(config, Some(&latest_version), custom_path, json_format).await;

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

/// Uninstall the toolchain
pub async fn uninstall_toolchain(
    config: &mut Config,
    custom_path: Option<&str>,
    force: bool,
    json_format: bool,
) -> Result<(), CliError> {
    let install_path = get_toolchain_path(config, custom_path).map_err(|e| CliError::Generic {
        message: format!("Failed to determine installation path: {}", e),
    })?;

    if !install_path.exists() {
        if json_format {
            println!("{{\"status\":\"not_found\"}}");
        } else {
            println!(
                "{}",
                format!("No toolchain found at {}", install_path.display()).yellow()
            );
        }
        return Ok(());
    }

    /* Confirm with user unless --force is used */
    if !force && !json_format {
        println!(
            "{}",
            format!("This will remove the toolchain at: {}", install_path.display()).yellow()
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

    /* Remove toolchain directory */
    tokio::fs::remove_dir_all(&install_path)
        .await
        .map_err(|e| CliError::Generic {
            message: format!("Failed to remove toolchain: {}", e),
        })?;

    /* Clear config */
    config.toolchain_path = None;
    config.toolchain_version = None;
    config.save().await?;

    if json_format {
        println!("{{\"status\":\"success\"}}");
    } else {
        println!("{}", "✓ Toolchain uninstalled successfully".green());
    }

    Ok(())
}

/// Get the toolchain installation path
pub async fn get_path(
    config: &Config,
    custom_path: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    let install_path = get_toolchain_path(config, custom_path).map_err(|e| CliError::Generic {
        message: format!("Failed to determine installation path: {}", e),
    })?;

    let exists = install_path.exists();

    /* Try to verify if it exists */
    let verified = if exists {
        verify_toolchain(&install_path).is_ok()
    } else {
        false
    };

    if json_format {
        println!(
            "{{\"path\":\"{}\",\"exists\":{},\"verified\":{}}}",
            install_path.display(),
            exists,
            verified
        );
    } else {
        println!("Toolchain path: {}", install_path.display());
        if exists {
            if verified {
                println!("Status: {} (verified)", "installed".green());
                if let Ok(version) = verify_toolchain(&install_path) {
                    println!("GCC: {}", version);
                }
            } else {
                println!("Status: {} (not verified)", "installed".yellow());
            }
        } else {
            println!("Status: {}", "not installed".red());
        }
    }

    Ok(())
}
