//! Project initialization commands

use anyhow::Result;
use colored::Colorize;
use std::collections::HashMap;
use std::path::PathBuf;

use crate::error::CliError;

use super::templates;

/// Initialize a new C project
pub async fn init_c_project(
    project_name: &str,
    custom_path: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    if !json_format {
        println!(
            "{}",
            format!("Initializing C project: {}", project_name).cyan()
        );
    }

    /* Determine project directory */
    let project_dir = if let Some(path) = custom_path {
        PathBuf::from(path).join(project_name)
    } else {
        PathBuf::from(project_name)
    };

    /* Check if project directory already exists */
    if project_dir.exists() {
        return Err(CliError::Generic {
            message: format!(
                "Directory '{}' already exists. Please choose a different name or location.",
                project_dir.display()
            ),
        });
    }

    /* Create project directory structure */
    tokio::fs::create_dir_all(&project_dir)
        .await
        .map_err(|e| CliError::Generic {
            message: format!("Failed to create project directory: {}", e),
        })?;

    let examples_dir = project_dir.join("examples");
    tokio::fs::create_dir_all(&examples_dir)
        .await
        .map_err(|e| CliError::Generic {
            message: format!("Failed to create examples directory: {}", e),
        })?;

    /* Prepare template variables */
    let program_name = templates::sanitize_program_name(project_name);
    let mut vars = HashMap::new();
    vars.insert("PROJECT_NAME".to_string(), project_name.to_string());
    vars.insert("PROGRAM_NAME".to_string(), program_name.clone());

    /* Create GNUmakefile */
    let gnumakefile_path = project_dir.join("GNUmakefile");
    let gnumakefile_content = templates::replace_template_vars(templates::GNUMAKEFILE_TEMPLATE, &vars);
    tokio::fs::write(&gnumakefile_path, gnumakefile_content)
        .await
        .map_err(|e| CliError::Generic {
            message: format!("Failed to create GNUmakefile: {}", e),
        })?;

    /* Create examples/Local.mk */
    let local_mk_path = examples_dir.join("Local.mk");
    let local_mk_content = templates::replace_template_vars(templates::LOCAL_MK_TEMPLATE, &vars);
    tokio::fs::write(&local_mk_path, local_mk_content)
        .await
        .map_err(|e| CliError::Generic {
            message: format!("Failed to create Local.mk: {}", e),
        })?;

    /* Create examples/{program_name}.c */
    let program_c_path = examples_dir.join(format!("{}.c", program_name));
    let program_c_content =
        templates::replace_template_vars(templates::PROGRAM_C_TEMPLATE, &vars);
    tokio::fs::write(&program_c_path, program_c_content)
        .await
        .map_err(|e| CliError::Generic {
            message: format!("Failed to create program source file: {}", e),
        })?;

    /* Create README.md */
    let readme_path = project_dir.join("README.md");
    let readme_content = templates::replace_template_vars(templates::README_TEMPLATE, &vars);
    tokio::fs::write(&readme_path, readme_content)
        .await
        .map_err(|e| CliError::Generic {
            message: format!("Failed to create README.md: {}", e),
        })?;

    /* Create .gitignore */
    let gitignore_path = project_dir.join(".gitignore");
    tokio::fs::write(&gitignore_path, templates::GITIGNORE_TEMPLATE)
        .await
        .map_err(|e| CliError::Generic {
            message: format!("Failed to create .gitignore: {}", e),
        })?;

    if json_format {
        println!(
            "{{\"status\":\"success\",\"project\":\"{}\",\"path\":\"{}\"}}",
            project_name,
            project_dir.display()
        );
    } else {
        println!(
            "\n{}",
            "✓ Project initialized successfully".green().bold()
        );
        println!("\nCreated files:");
        println!("  {}", gnumakefile_path.display());
        println!("  {}", readme_path.display());
        println!("  {}", gitignore_path.display());
        println!("  {}", local_mk_path.display());
        println!("  {}", program_c_path.display());

        println!("\n{}", "Next steps:".cyan().bold());
        println!("  1. cd {}", project_name);
        println!("  2. make -j");
        println!(
            "  3. Deploy with: thru-cli uploader upload <seed> build/thruvm/bin/{}_c.bin",
            program_name
        );
    }

    Ok(())
}

/// Initialize a new C++ project (not yet implemented)
pub async fn init_cpp_project(
    _project_name: &str,
    _custom_path: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    if json_format {
        println!("{{\"status\":\"error\",\"message\":\"C++ projects not yet implemented\"}}");
    } else {
        println!("{}", "C++ project initialization is not yet implemented.".yellow());
        println!("This feature will be available in a future release.");
    }
    Ok(())
}

/// Initialize a new Rust project (not yet implemented)
pub async fn init_rust_project(
    _project_name: &str,
    _custom_path: Option<&str>,
    json_format: bool,
) -> Result<(), CliError> {
    if json_format {
        println!("{{\"status\":\"error\",\"message\":\"Rust projects not yet implemented\"}}");
    } else {
        println!("{}", "Rust project initialization is not yet implemented.".yellow());
        println!("This feature will be available in a future release.");
    }
    Ok(())
}
