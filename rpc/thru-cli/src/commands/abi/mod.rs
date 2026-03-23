//! ABI command dispatch and module wiring

use crate::cli::AbiCommands;
use crate::config::Config;
use crate::error::CliError;

pub mod account;
pub mod toolchain;

pub async fn handle_abi_command(
    config: &Config,
    subcommand: AbiCommands,
    json_format: bool,
) -> Result<(), CliError> {
    match subcommand {
        AbiCommands::Account { subcommand } => {
            account::handle_abi_account_command(config, subcommand, json_format).await
        }
        AbiCommands::Codegen {
            files,
            include_dirs,
            language,
            output_dir,
            verbose,
        } => toolchain::handle_codegen_command(files, include_dirs, language, output_dir, verbose),
        AbiCommands::Analyze {
            files,
            include_dirs,
            print_ir,
            ir_format,
            print_footprint,
            print_validate,
        } => toolchain::handle_analyze_command(
            files,
            include_dirs,
            print_ir,
            ir_format,
            print_footprint,
            print_validate,
        ),
        AbiCommands::Reflect {
            abi_files,
            include_dirs,
            type_name,
            data_file,
            pretty,
            values_only,
            validate_only,
            show_params,
            include_byte_offsets,
        } => toolchain::handle_reflect_command(
            abi_files,
            include_dirs,
            type_name,
            data_file,
            pretty,
            values_only,
            validate_only,
            show_params,
            include_byte_offsets,
        ),
        AbiCommands::Flatten {
            file,
            include_dirs,
            output,
            verbose,
        } => toolchain::handle_flatten_command(file, include_dirs, output, verbose),
        AbiCommands::PrepForPublish {
            file,
            include_dirs,
            target_network,
            output,
            verbose,
        } => toolchain::handle_prep_for_publish_command(
            file,
            include_dirs,
            target_network,
            output,
            verbose,
        ),
        AbiCommands::Bundle {
            file,
            include_dirs,
            output,
            verbose,
        } => {
            let config = config.clone();
            tokio::task::spawn_blocking(move || {
                toolchain::handle_bundle_command(&config, file, include_dirs, output, verbose)
            })
            .await
            .map_err(|e| CliError::Generic {
                message: format!("Bundle task failed: {}", e),
            })?
        }
    }
}
