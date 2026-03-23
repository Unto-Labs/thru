//! Local ABI toolchain command implementations

use std::fs;
use std::path::PathBuf;

use abi_gen::abi::file::ImportResolver as GenImportResolver;
use abi_gen::abi::resolved::TypeResolver;
use abi_loader::{
    AbiFile, AbiMetadata, EnhancedImportResolver, FetcherConfig, ImportResolver, ImportSource,
};
use abi_reflect::{FormatOptions, Reflector, format_reflection_with_options};

use crate::cli::{AbiIrFormat, AbiLanguage};
use crate::config::Config;
use crate::error::CliError;

pub fn handle_codegen_command(
    files: Vec<PathBuf>,
    include_dirs: Vec<PathBuf>,
    language: AbiLanguage,
    output_dir: PathBuf,
    verbose: bool,
) -> Result<(), CliError> {
    run_codegen(files, include_dirs, language, output_dir, verbose)
}

pub fn handle_analyze_command(
    files: Vec<PathBuf>,
    include_dirs: Vec<PathBuf>,
    print_ir: bool,
    ir_format: AbiIrFormat,
    print_footprint: Option<String>,
    print_validate: Option<String>,
) -> Result<(), CliError> {
    run_analyze(
        files,
        include_dirs,
        print_ir,
        ir_format,
        print_footprint,
        print_validate,
    )
}

pub fn handle_reflect_command(
    abi_files: Vec<PathBuf>,
    include_dirs: Vec<PathBuf>,
    type_name: String,
    data_file: PathBuf,
    pretty: bool,
    values_only: bool,
    validate_only: bool,
    show_params: bool,
    include_byte_offsets: bool,
) -> Result<(), CliError> {
    run_reflect(
        abi_files,
        include_dirs,
        type_name,
        data_file,
        pretty,
        values_only,
        validate_only,
        show_params,
        include_byte_offsets,
    )
}

pub fn handle_flatten_command(
    file: PathBuf,
    include_dirs: Vec<PathBuf>,
    output: PathBuf,
    verbose: bool,
) -> Result<(), CliError> {
    run_flatten(file, include_dirs, output, verbose)
}

pub fn handle_prep_for_publish_command(
    file: PathBuf,
    include_dirs: Vec<PathBuf>,
    target_network: String,
    output: PathBuf,
    verbose: bool,
) -> Result<(), CliError> {
    run_prep_for_publish(file, include_dirs, target_network, output, verbose)
}

pub fn handle_bundle_command(
    config: &Config,
    file: PathBuf,
    include_dirs: Vec<PathBuf>,
    output: PathBuf,
    verbose: bool,
) -> Result<(), CliError> {
    run_bundle(config, file, include_dirs, output, verbose)
}

fn run_codegen(
    files: Vec<PathBuf>,
    include_dirs: Vec<PathBuf>,
    language: AbiLanguage,
    output_dir: PathBuf,
    verbose: bool,
) -> Result<(), CliError> {
    let language = match language {
        AbiLanguage::C => abi_gen::cmds::codegen::Language::C,
        AbiLanguage::Rust => abi_gen::cmds::codegen::Language::Rust,
        AbiLanguage::TypeScript => abi_gen::cmds::codegen::Language::TypeScript,
    };
    abi_gen::cmds::codegen::run(files, include_dirs, language, output_dir, verbose)?;
    Ok(())
}

fn run_analyze(
    files: Vec<PathBuf>,
    include_dirs: Vec<PathBuf>,
    print_ir: bool,
    ir_format: AbiIrFormat,
    print_footprint: Option<String>,
    print_validate: Option<String>,
) -> Result<(), CliError> {
    let ir_format = match ir_format {
        AbiIrFormat::Json => abi_gen::cmds::analyze::IrOutputFormat::Json,
        AbiIrFormat::Protobuf => abi_gen::cmds::analyze::IrOutputFormat::Protobuf,
    };
    abi_gen::cmds::analyze::run(
        files,
        include_dirs,
        print_ir,
        ir_format,
        print_footprint,
        print_validate,
    )?;
    Ok(())
}

fn run_reflect(
    abi_files: Vec<PathBuf>,
    include_dirs: Vec<PathBuf>,
    type_name: String,
    data_file: PathBuf,
    pretty: bool,
    values_only: bool,
    validate_only: bool,
    show_params: bool,
    include_byte_offsets: bool,
) -> Result<(), CliError> {
    let mut import_resolver = GenImportResolver::new(include_dirs);

    for abi_file in &abi_files {
        import_resolver.load_file_with_imports(abi_file, false)?;
    }

    let mut type_resolver = TypeResolver::new();
    for typedef in import_resolver.get_all_types() {
        type_resolver.add_typedef(typedef.clone());
    }
    type_resolver
        .resolve_all()
        .map_err(|err| CliError::Generic {
            message: format!("Type resolution failed: {:?}", err),
        })?;

    let reflector = Reflector::new(type_resolver).map_err(|err| CliError::Generic {
        message: format!("Failed to initialize reflector: {}", err),
    })?;

    let binary_data = fs::read(&data_file)?;

    if show_params {
        let params = reflector
            .dynamic_params(&type_name, &binary_data)
            .map_err(|err| CliError::Generic {
                message: format!("Failed to extract dynamic params: {}", err),
            })?;
        println!("Dynamic parameters:");
        for (name, value) in &params {
            println!("  {name} = {value}");
        }
    }

    let validation = reflector
        .validate_buffer(&type_name, &binary_data)
        .map_err(|err| CliError::Generic {
            message: format!("Validation failed: {}", err),
        })?;
    if validate_only {
        println!(
            "Validation succeeded (bytes consumed = {})",
            validation.bytes_consumed
        );
        return Ok(());
    }

    let reflected =
        reflector
            .reflect(&binary_data, &type_name)
            .map_err(|err| CliError::Generic {
                message: format!("Failed to parse binary data: {}", err),
            })?;

    if values_only {
        let value_only = reflected.extract_value();
        if pretty {
            println!(
                "{}",
                serde_json::to_string_pretty(&value_only).map_err(anyhow::Error::from)?
            );
        } else {
            println!(
                "{}",
                serde_json::to_string(&value_only).map_err(anyhow::Error::from)?
            );
        }
    } else if include_byte_offsets {
        let options = FormatOptions {
            include_byte_offsets: true,
            ..Default::default()
        };
        let formatted = format_reflection_with_options(&reflected, &options);
        if pretty {
            println!(
                "{}",
                serde_json::to_string_pretty(&formatted).map_err(anyhow::Error::from)?
            );
        } else {
            println!(
                "{}",
                serde_json::to_string(&formatted).map_err(anyhow::Error::from)?
            );
        }
    } else if pretty {
        println!(
            "{}",
            serde_json::to_string_pretty(&reflected).map_err(anyhow::Error::from)?
        );
    } else {
        println!(
            "{}",
            serde_json::to_string(&reflected).map_err(anyhow::Error::from)?
        );
    }

    Ok(())
}

fn run_flatten(
    file: PathBuf,
    include_dirs: Vec<PathBuf>,
    output: PathBuf,
    verbose: bool,
) -> Result<(), CliError> {
    if verbose {
        println!("Flattening: {}", file.display());
        for dir in &include_dirs {
            println!("  Include dir: {}", dir.display());
        }
    }

    let flattened = abi_loader::flatten_with_options(&file, &include_dirs, verbose)?;
    let yaml = serde_yml::to_string(&flattened).map_err(anyhow::Error::from)?;
    fs::write(&output, &yaml)?;

    if verbose {
        println!("Written to: {}", output.display());
    }

    Ok(())
}

fn run_prep_for_publish(
    file: PathBuf,
    include_dirs: Vec<PathBuf>,
    target_network: String,
    output: PathBuf,
    verbose: bool,
) -> Result<(), CliError> {
    if verbose {
        println!("Preparing for publish: {}", file.display());
        println!("  Target network: {}", target_network);
    }

    let mut resolver = ImportResolver::new(include_dirs.clone());
    resolver.load_file_with_imports_skip_remote(&file, verbose)?;

    let all_files = resolver.get_all_files();
    if all_files.is_empty() {
        return Err(CliError::Generic {
            message: "No ABI files loaded".to_string(),
        });
    }

    if verbose {
        println!("  Resolved {} local packages", resolver.loaded_file_count());
    }

    if all_files.len() > 1 {
        for abi_file in &all_files[..all_files.len() - 1] {
            for import in abi_file.imports() {
                if !matches!(import, ImportSource::Path { .. }) {
                    return Err(CliError::Generic {
                        message: format!(
                            "Remote import found in local dependency '{}': {:?}",
                            abi_file.package(),
                            import
                        ),
                    });
                }
            }
        }
    }

    let mut all_types = resolver.get_all_types().to_vec();
    abi_loader::normalize_type_refs(&mut all_types, &resolver);

    let root_abi = all_files.last().expect("checked non-empty above");

    for import in root_abi.imports() {
        match import {
            ImportSource::Git { url, .. } => {
                return Err(CliError::Generic {
                    message: format!("Git imports not allowed for publishing: {}", url),
                });
            }
            ImportSource::Http { url } => {
                return Err(CliError::Generic {
                    message: format!("HTTP imports not allowed for publishing: {}", url),
                });
            }
            _ => {}
        }
    }

    let mut remaining_imports: Vec<ImportSource> = Vec::new();
    for import in root_abi.imports() {
        match import {
            ImportSource::Onchain {
                address,
                network: net,
                ..
            } => {
                if net != &target_network {
                    return Err(CliError::Generic {
                        message: format!(
                            "On-chain import '{}' uses network '{}' but prep-for-publish target is '{}'",
                            address, net, target_network
                        ),
                    });
                }
                remaining_imports.push(import.clone());
            }
            ImportSource::Path { path } => {
                if verbose {
                    println!("  Inlining path import: {}", path);
                }
            }
            _ => {}
        }
    }

    let output_metadata = AbiMetadata {
        package: root_abi.package().to_string(),
        name: root_abi.name().map(|value| value.to_string()),
        abi_version: root_abi.abi_version(),
        package_version: root_abi.package_version().to_string(),
        description: root_abi.description().to_string(),
        imports: remaining_imports,
        options: root_abi.options().clone(),
    };

    let output_abi = AbiFile {
        abi: output_metadata,
        types: all_types,
    };

    let yaml = serde_yml::to_string(&output_abi).map_err(anyhow::Error::from)?;
    fs::write(&output, &yaml)?;

    if verbose {
        println!("  Written to: {}", output.display());
        println!("  Total types: {}", output_abi.get_types().len());
    }

    Ok(())
}

fn run_bundle(
    config: &Config,
    file: PathBuf,
    include_dirs: Vec<PathBuf>,
    output: PathBuf,
    verbose: bool,
) -> Result<(), CliError> {
    if verbose {
        println!("Bundling: {}", file.display());
    }

    let fetcher_config = build_bundle_fetcher_config(config);
    let resolver = EnhancedImportResolver::new(fetcher_config, include_dirs)
        .map_err(|err| CliError::Generic {
            message: err.to_string(),
        })?
        .with_verbose(verbose);

    let resolution = resolver
        .resolve_file(&file)
        .map_err(|err| CliError::Generic {
            message: err.to_string(),
        })?;

    if verbose {
        println!("  Resolved {} packages", resolution.package_count());
        for pkg in &resolution.all_packages {
            println!("    - {} @ {}", pkg.package_name(), pkg.version());
        }
    }

    let manifest = resolution.to_manifest();
    let json = serde_json::to_string_pretty(&manifest).map_err(anyhow::Error::from)?;
    fs::write(&output, &json)?;

    if verbose {
        println!("  Written to: {}", output.display());
    }

    Ok(())
}

fn build_bundle_fetcher_config(config: &Config) -> FetcherConfig {
    let mut fetcher_config = FetcherConfig::cli_default();
    for (name, network_config) in &config.networks {
        fetcher_config
            .onchain_config
            .set_endpoint(name.clone(), network_config.url.clone());
    }
    if let Some(default_network) = &config.default_network {
        fetcher_config.onchain_config.default_network = default_network.clone();
    }
    fetcher_config.onchain_config.abi_manager_program_id =
        config.abi_manager_program_public_key.clone();
    fetcher_config
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use tempfile::TempDir;

    use crate::config::NetworkConfig;

    fn write_test_file(dir: &TempDir, name: &str, contents: &str) -> PathBuf {
        let path = dir.path().join(name);
        fs::write(&path, contents).expect("test fixture should be written");
        path
    }

    fn dependency_abi() -> &'static str {
        r#"
abi:
  package: test.dep
  abi-version: 1
  package-version: "1.0.0"
  description: "Dependency ABI"
types:
  - name: SharedType
    kind:
      primitive: u64
"#
    }

    fn root_abi_with_path_imports() -> &'static str {
        r#"
abi:
  package: test.root
  abi-version: 1
  package-version: "1.0.0"
  description: "Root ABI"
  imports:
    - type: path
      path: dep.abi.yaml
types:
  - name: RootType
    kind:
      struct:
        packed: true
        fields:
          - name: shared
            field-type:
              type-ref:
                name: SharedType
                package: test.dep
"#
    }

    fn root_abi_for_publish_same_network() -> &'static str {
        r#"
abi:
  package: test.root
  abi-version: 1
  package-version: "1.0.0"
  description: "Root ABI"
  imports:
    - type: path
      path: dep.abi.yaml
    - type: onchain
      address: taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQE
      target: program
      network: mainnet
types:
  - name: RootType
    kind:
      struct:
        packed: true
        fields:
          - name: shared
            field-type:
              type-ref:
                name: SharedType
                package: test.dep
"#
    }

    fn root_abi_for_publish_cross_network() -> &'static str {
        r#"
abi:
  package: test.root
  abi-version: 1
  package-version: "1.0.0"
  description: "Root ABI"
  imports:
    - type: path
      path: dep.abi.yaml
    - type: onchain
      address: taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQE
      target: program
      network: mainnet
    - type: onchain
      address: taBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBQE
      target: program
      network: testnet
types:
  - name: RootType
    kind:
      struct:
        packed: true
        fields:
          - name: shared
            field-type:
              type-ref:
                name: SharedType
                package: test.dep
"#
    }

    #[test]
    fn flatten_inlines_local_imports() {
        let temp_dir = TempDir::new().expect("tempdir");
        let root_path = write_test_file(&temp_dir, "root.abi.yaml", root_abi_with_path_imports());
        write_test_file(&temp_dir, "dep.abi.yaml", dependency_abi());
        let output_path = temp_dir.path().join("flattened.abi.yaml");

        run_flatten(
            root_path,
            vec![temp_dir.path().to_path_buf()],
            output_path.clone(),
            false,
        )
        .expect("flatten should succeed");

        let output = fs::read_to_string(output_path).expect("flatten output should exist");
        let flattened: AbiFile = serde_yml::from_str(&output).expect("flattened YAML should parse");

        assert!(flattened.imports().is_empty());
        assert!(
            flattened
                .get_types()
                .iter()
                .any(|ty| ty.name == "SharedType")
        );
        assert!(flattened.get_types().iter().any(|ty| ty.name == "RootType"));
    }

    #[test]
    fn prep_for_publish_inlines_path_imports_and_keeps_target_network() {
        let temp_dir = TempDir::new().expect("tempdir");
        let root_path = write_test_file(
            &temp_dir,
            "root.abi.yaml",
            root_abi_for_publish_same_network(),
        );
        write_test_file(&temp_dir, "dep.abi.yaml", dependency_abi());
        let output_path = temp_dir.path().join("publish.abi.yaml");

        run_prep_for_publish(
            root_path,
            vec![temp_dir.path().to_path_buf()],
            "mainnet".to_string(),
            output_path.clone(),
            false,
        )
        .expect("prep-for-publish should succeed");

        let output = fs::read_to_string(output_path).expect("publish output should exist");
        let prepared: AbiFile = serde_yml::from_str(&output).expect("prepared YAML should parse");

        assert_eq!(prepared.imports().len(), 1);
        match &prepared.imports()[0] {
            ImportSource::Onchain { network, .. } => assert_eq!(network, "mainnet"),
            other => panic!("expected onchain import, got {:?}", other),
        }
        assert!(
            prepared
                .get_types()
                .iter()
                .any(|ty| ty.name == "SharedType")
        );
    }

    #[test]
    fn prep_for_publish_rejects_cross_network_onchain_imports() {
        let temp_dir = TempDir::new().expect("tempdir");
        let root_path = write_test_file(
            &temp_dir,
            "root.abi.yaml",
            root_abi_for_publish_cross_network(),
        );
        write_test_file(&temp_dir, "dep.abi.yaml", dependency_abi());
        let output_path = temp_dir.path().join("publish.abi.yaml");

        let err = run_prep_for_publish(
            root_path,
            vec![temp_dir.path().to_path_buf()],
            "mainnet".to_string(),
            output_path,
            false,
        )
        .expect_err("prep-for-publish should fail on cross-network on-chain imports");

        match err {
            CliError::Generic { message } => {
                assert!(message.contains("prep-for-publish target is 'mainnet'"));
                assert!(message.contains("network 'testnet'"));
            }
            other => panic!("expected generic cli error, got {:?}", other),
        }
    }

    #[test]
    fn bundle_writes_manifest_for_local_dependency_graph() {
        let temp_dir = TempDir::new().expect("tempdir");
        let root_path = write_test_file(&temp_dir, "root.abi.yaml", root_abi_with_path_imports());
        write_test_file(&temp_dir, "dep.abi.yaml", dependency_abi());
        let output_path = temp_dir.path().join("bundle.json");

        run_bundle(
            &Config::default(),
            root_path,
            vec![temp_dir.path().to_path_buf()],
            output_path.clone(),
            false,
        )
        .expect("bundle should succeed");

        let output = fs::read_to_string(output_path).expect("bundle output should exist");
        let manifest: HashMap<String, String> =
            serde_json::from_str(&output).expect("bundle manifest should parse");

        assert!(manifest.contains_key("test.root"));
        assert!(manifest.contains_key("test.dep"));
        assert!(
            manifest
                .get("test.dep")
                .expect("dep manifest entry should exist")
                .contains("SharedType")
        );
    }

    #[test]
    fn bundle_fetcher_config_includes_named_network_profiles() {
        let mut config = Config::default();
        config.networks.insert(
            "local".to_string(),
            NetworkConfig {
                url: "http://127.0.0.1:8472".to_string(),
                auth_token: Some("secret".to_string()),
            },
        );
        config.default_network = Some("local".to_string());

        let fetcher_config = build_bundle_fetcher_config(&config);

        assert_eq!(
            fetcher_config.onchain_config.get_endpoint("local"),
            Some("http://127.0.0.1:8472")
        );
        assert_eq!(fetcher_config.onchain_config.default_network, "local");
        assert_eq!(
            fetcher_config.onchain_config.abi_manager_program_id,
            config.abi_manager_program_public_key
        );
    }
}
