//! Local ABI toolchain command implementations

use std::fs;
use std::path::PathBuf;

use abi_gen::abi::file::ImportResolver as GenImportResolver;
use abi_gen::abi::resolved::TypeResolver;
use abi_loader::{EnhancedImportResolver, FetcherConfig};
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
    go_module: Option<String>,
) -> Result<(), CliError> {
    let language = match language {
        AbiLanguage::C => abi_gen::cmds::codegen::Language::C,
        AbiLanguage::Rust => abi_gen::cmds::codegen::Language::Rust,
        AbiLanguage::TypeScript => abi_gen::cmds::codegen::Language::TypeScript,
        AbiLanguage::Go => abi_gen::cmds::codegen::Language::Go,
    };
    abi_gen::cmds::codegen::run_with_options(
        files,
        include_dirs,
        language,
        output_dir,
        verbose,
        &abi_gen::cmds::codegen::CodegenOptions { go_module },
    )?;
    Ok(())
}

pub fn handle_analyze_command(
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

pub fn handle_flatten_command(
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

pub fn handle_prep_for_publish_command(
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

    let yaml =
        abi_gen::cmds::common::prepare_for_publish(&file, &include_dirs, &target_network, verbose)?;
    fs::write(&output, &yaml)?;

    if verbose {
        println!("  Written to: {}", output.display());
    }

    Ok(())
}

pub fn handle_bundle_command(
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
    use abi_loader::{AbiFile, ImportSource};
    use std::collections::HashMap;
    use tempfile::TempDir;

    use crate::config::NetworkConfig;

    fn write_test_file(dir: &TempDir, name: &str, contents: &str) -> PathBuf {
        let path = dir.path().join(name);
        fs::write(&path, contents).expect("test fixture should be written");
        path
    }

    #[test]
    fn codegen_go_writes_a_module() {
        let dir = TempDir::new().expect("temp dir");
        let abi = write_test_file(&dir, "dep.abi.yaml", dependency_abi());
        let out = dir.path().join("gen");
        handle_codegen_command(
            vec![abi],
            Vec::new(),
            AbiLanguage::Go,
            out.clone(),
            false,
            Some("example.com/me/abi".to_string()),
        )
        .expect("go codegen");
        let go_mod = fs::read_to_string(out.join("go.mod")).expect("go.mod");
        assert!(go_mod.starts_with("module example.com/me/abi\n"));
        assert!(out.join("tnabi/runtime.go").exists());
        let types = fs::read_to_string(out.join("test/dep/types.go")).expect("types.go");
        assert!(types.contains("package dep\n"));
        assert!(types.contains("func ParseSharedType("));
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
      struct:
        packed: true
        fields:
          - name: value
            field-type:
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

        handle_flatten_command(
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

        handle_prep_for_publish_command(
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

        let err = handle_prep_for_publish_command(
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

        handle_bundle_command(
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

    #[test]
    fn preparation_requires_exact_local_qualifiers_and_unique_names() {
        let dir = TempDir::new().unwrap();
        write_test_file(&dir, "dep.abi.yaml", dependency_abi());
        for (index, reference) in [
            "name: SharedType\n                package: test.dep.extra",
            "name: test.dep.extra.SharedType",
            "name: Missing\n                package: test.dep",
            "name: test.dep.Missing",
            "name: SharedType\n                package: unknown",
            "name: test.dep.SharedType\n                package: other",
        ]
        .iter()
        .enumerate()
        {
            let input = root_abi_with_path_imports().replace(
                "name: SharedType\n                package: test.dep",
                reference,
            );
            let root = write_test_file(&dir, "root.abi.yaml", &input);
            let output = dir.path().join(format!("invalid-{index}.yaml"));
            assert!(
                handle_prep_for_publish_command(
                    root.clone(),
                    vec![],
                    "mainnet".into(),
                    output.clone(),
                    false
                )
                .is_err()
            );
            assert!(handle_flatten_command(root, vec![], output.clone(), false).is_err());
            assert!(!output.exists());
        }
        // The same layout from a root declaration is not the imported identity.
        let input = root_abi_with_path_imports().to_owned()
            + "  - name: SharedType\n    kind:\n      primitive: u64\n";
        let root = write_test_file(&dir, "root.abi.yaml", &input);
        let err = handle_prep_for_publish_command(
            root,
            vec![],
            "mainnet".into(),
            dir.path().join("collision.yaml"),
            false,
        )
        .unwrap_err();
        assert!(err.to_string().contains("Conflicting declarations"));
    }

    #[test]
    fn preparation_preserves_remote_qualification_without_fetching() {
        let dir = TempDir::new().unwrap();
        write_test_file(&dir, "dep.abi.yaml", dependency_abi());
        for (index, reference) in [
            "name: external.pkg.RemoteType",
            "name: RemoteType\n                package: external.pkg",
        ]
        .iter()
        .enumerate()
        {
            let input = root_abi_for_publish_same_network().replace(
                "name: SharedType\n                package: test.dep",
                reference,
            );
            let root = write_test_file(&dir, "root.abi.yaml", &input);
            let output = dir.path().join(format!("remote-{index}.yaml"));
            handle_prep_for_publish_command(
                root.clone(),
                vec![],
                "mainnet".into(),
                output.clone(),
                false,
            )
            .unwrap();
            let bytes = fs::read_to_string(output).unwrap();
            assert_eq!(
                bytes,
                abi_loader::prepare_for_publish(&root, &[], "mainnet", false).unwrap()
            );
            let prepared: AbiFile = serde_yml::from_str(&bytes).unwrap();
            let original: AbiFile = serde_yml::from_str(&input).unwrap();
            let root_type = prepared
                .types
                .iter()
                .find(|ty| ty.name == "RootType")
                .unwrap();
            assert_eq!(root_type.kind, original.types[0].kind);
            assert_eq!(prepared.imports().len(), 1);
        }
    }

    #[test]
    fn preparation_diamond_and_checkout_independence() {
        let mut outputs = Vec::new();
        for reverse in [false, true] {
            let dir = TempDir::new().unwrap();
            write_test_file(&dir, "dep.abi.yaml", dependency_abi());
            for (file, package) in [("left.yaml", "test.left"), ("right.yaml", "test.right")] {
                let branch = format!(
                    "abi:\n  package: {package}\n  abi-version: 1\n  package-version: 1.0.0\n  description: branch\n  imports: [{{type: path, path: dep.abi.yaml}}]\ntypes: []\n"
                );
                write_test_file(&dir, file, &branch);
            }
            let imports = if reverse {
                "    - type: path\n      path: right.yaml\n    - type: path\n      path: left.yaml"
            } else {
                "    - type: path\n      path: left.yaml\n    - type: path\n      path: right.yaml"
            };
            let input = root_abi_with_path_imports()
                .replace("    - type: path\n      path: dep.abi.yaml", imports);
            let root = write_test_file(&dir, "root.abi.yaml", &input);
            let output = dir.path().join("publish.yaml");
            handle_prep_for_publish_command(root, vec![], "mainnet".into(), output.clone(), false)
                .unwrap();
            let bytes = fs::read_to_string(output).unwrap();
            let prepared: AbiFile = serde_yml::from_str(&bytes).unwrap();
            assert_eq!(
                prepared
                    .types
                    .iter()
                    .filter(|ty| ty.name == "SharedType")
                    .count(),
                1
            );
            outputs.push(bytes);
        }
        assert_eq!(outputs[0], outputs[1]);
    }

    #[test]
    fn preparation_rejects_remote_imports_below_root_and_root_web_imports() {
        let dir = TempDir::new().unwrap();
        for import in [
            "{type: onchain, address: taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQE, network: mainnet}",
            "{type: http, url: 'https://invalid.example/abi'}",
            "{type: git, url: 'https://invalid.example/repo', ref: main, path: abi.yaml}",
        ] {
            let dependency =
                dependency_abi().replace("types:", &format!("  imports: [{import}]\ntypes:"));
            write_test_file(&dir, "dep.abi.yaml", &dependency);
            let root = write_test_file(&dir, "root.abi.yaml", root_abi_with_path_imports());
            let error = handle_prep_for_publish_command(
                root,
                vec![],
                "mainnet".into(),
                dir.path().join("publish.yaml"),
                false,
            )
            .unwrap_err();
            assert!(
                error
                    .to_string()
                    .contains("Remote import found in local dependency")
            );
            if !import.contains("onchain") {
                let input =
                    dependency_abi().replace("types:", &format!("  imports: [{import}]\ntypes:"));
                let root = write_test_file(&dir, "root.abi.yaml", &input);
                assert!(
                    handle_prep_for_publish_command(
                        root,
                        vec![],
                        "mainnet".into(),
                        dir.path().join("publish.yaml"),
                        false
                    )
                    .is_err()
                );
            }
        }
    }

    #[test]
    fn preparation_rejects_missing_program_roots_before_writing() {
        let dir = TempDir::new().unwrap();
        for role in ["instruction-root", "account-root", "errors", "events"] {
            let input = dependency_abi().replace(
                "types:", &format!("  options:\n    program-metadata:\n      root-types:\n        {role}: Missing\ntypes:"),
            );
            let root = write_test_file(&dir, "root.abi.yaml", &input);
            let output = dir.path().join(format!("missing-{role}.yaml"));
            let error = handle_prep_for_publish_command(
                root,
                vec![],
                "mainnet".into(),
                output.clone(),
                false,
            )
            .unwrap_err();
            assert!(
                error
                    .to_string()
                    .contains(&format!("Unresolved declared {role} root 'Missing'"))
            );
            assert!(!output.exists());
        }
    }
}
