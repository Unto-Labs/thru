use clap::{Parser, Subcommand, ValueEnum};
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "abi")]
#[command(about = "ABI toolchain for thru-net - code generation, analysis, reflection, and flattening")]
#[command(version)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Generate code from ABI type definitions
    Codegen {
        /// Input YAML files containing type definitions
        #[arg(short = 'f', long = "files", value_name = "FILE", required = true)]
        files: Vec<PathBuf>,

        /// Include directories for imported type files
        #[arg(short = 'i', long = "include-dir", value_name = "DIR")]
        include_dirs: Vec<PathBuf>,

        /// Target language for code generation
        #[arg(short = 'l', long = "language", value_enum)]
        language: Language,

        /// Output directory for generated code
        #[arg(
            short = 'o',
            long = "output",
            value_name = "DIR",
            default_value = "generated"
        )]
        output_dir: PathBuf,

        /// Enable verbose output
        #[arg(short = 'v', long = "verbose")]
        verbose: bool,
    },

    /// Analyze ABI type definitions and show detailed type information
    Analyze {
        /// Input YAML files containing type definitions
        #[arg(short = 'f', long = "files", value_name = "FILE", required = true)]
        files: Vec<PathBuf>,

        /// Include directories for imported type files
        #[arg(short = 'i', long = "include-dir", value_name = "DIR")]
        include_dirs: Vec<PathBuf>,

        /// Print the shared layout IR after analysis
        #[arg(long = "print-ir")]
        print_ir: bool,

        /// Format to use when printing the shared layout IR
        #[arg(long = "ir-format", value_enum, default_value = "json")]
        ir_format: IrFormat,

        /// Print the generated legacy + IR footprint helpers for a specific type
        #[arg(long = "print-footprint", value_name = "TYPE")]
        print_footprint: Option<String>,

        /// Print the generated legacy + IR validate helpers for a specific type
        #[arg(long = "print-validate", value_name = "TYPE")]
        print_validate: Option<String>,
    },

    /// Parse ABI binary data and print JSON reflection results
    Reflect {
        /// ABI file(s) to load
        #[arg(short = 'f', long = "abi-file", required = true)]
        abi_files: Vec<PathBuf>,

        /// Include directories for resolving imports
        #[arg(short = 'i', long = "include-dir")]
        include_dirs: Vec<PathBuf>,

        /// Type name to parse
        #[arg(short = 't', long = "type-name", required = true)]
        type_name: String,

        /// Binary data file to parse
        #[arg(short = 'd', long = "data-file", required = true)]
        data_file: PathBuf,

        /// Pretty print JSON output
        #[arg(short = 'p', long = "pretty")]
        pretty: bool,

        /// Show only values (no type information)
        #[arg(short = 'v', long = "values-only")]
        values_only: bool,

        /// Only validate buffer without decoding
        #[arg(long = "validate-only")]
        validate_only: bool,

        /// Print dynamic parameters inferred from the buffer
        #[arg(long = "show-params")]
        show_params: bool,

        /// Include byte offset information in the output
        #[arg(long = "include-byte-offsets")]
        include_byte_offsets: bool,
    },

    /// Flatten an ABI file by resolving all imports
    Flatten {
        /// Input ABI file
        #[arg(short = 'f', long = "file", required = true)]
        file: PathBuf,

        /// Include directories for resolving imports
        #[arg(short = 'i', long = "include-dir")]
        include_dirs: Vec<PathBuf>,

        /// Output file path
        #[arg(short = 'o', long = "output", required = true)]
        output: PathBuf,

        /// Verbose output
        #[arg(short = 'v', long = "verbose")]
        verbose: bool,
    },
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, ValueEnum, Debug)]
enum Language {
    /// Generate C code (.h and .c files)
    C,
    /// Generate Rust code (.rs files)
    Rust,
    /// Generate TypeScript code (.ts files)
    #[value(name = "typescript")]
    TypeScript,
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, ValueEnum, Debug)]
enum IrFormat {
    Json,
    Protobuf,
}

fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Codegen {
            files,
            include_dirs,
            language,
            output_dir,
            verbose,
        } => {
            let lang = match language {
                Language::C => abi_gen::cmds::codegen::Language::C,
                Language::Rust => abi_gen::cmds::codegen::Language::Rust,
                Language::TypeScript => abi_gen::cmds::codegen::Language::TypeScript,
            };
            abi_gen::cmds::codegen::run(files, include_dirs, lang, output_dir, verbose)?;
        }

        Commands::Analyze {
            files,
            include_dirs,
            print_ir,
            ir_format,
            print_footprint,
            print_validate,
        } => {
            let format = match ir_format {
                IrFormat::Json => abi_gen::cmds::analyze::IrOutputFormat::Json,
                IrFormat::Protobuf => abi_gen::cmds::analyze::IrOutputFormat::Protobuf,
            };
            abi_gen::cmds::analyze::run(
                files,
                include_dirs,
                print_ir,
                format,
                print_footprint,
                print_validate,
            )?;
        }

        Commands::Reflect {
            abi_files,
            include_dirs,
            type_name,
            data_file,
            pretty,
            values_only,
            validate_only,
            show_params,
            include_byte_offsets,
        } => {
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
            )?;
        }

        Commands::Flatten {
            file,
            include_dirs,
            output,
            verbose,
        } => {
            run_flatten(file, include_dirs, output, verbose)?;
        }
    }

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
) -> anyhow::Result<()> {
    use abi_gen::abi::file::ImportResolver;
    use abi_gen::abi::resolved::TypeResolver;
    use abi_reflect::{format_reflection_with_options, FormatOptions, Reflector};

    /* Create import resolver */
    let mut import_resolver = ImportResolver::new(include_dirs);

    /* Load all ABI files */
    for abi_file in &abi_files {
        import_resolver.load_file_with_imports(abi_file, false)?;
    }

    /* Create type resolver and resolve all types */
    let mut type_resolver = TypeResolver::new();
    for typedef in import_resolver.get_all_types() {
        type_resolver.add_typedef(typedef.clone());
    }
    type_resolver
        .resolve_all()
        .map_err(|e| anyhow::anyhow!("Type resolution failed: {:?}", e))?;

    /* Create reflector */
    let reflector = Reflector::new(type_resolver)
        .map_err(|e| anyhow::anyhow!("Failed to initialize reflector: {}", e))?;

    /* Read binary data */
    let binary_data = std::fs::read(&data_file)?;

    if show_params {
        let params = reflector
            .dynamic_params(&type_name, &binary_data)
            .map_err(|e| anyhow::anyhow!("Failed to extract dynamic params: {}", e))?;
        println!("Dynamic parameters:");
        for (name, value) in &params {
            println!("  {name} = {value}");
        }
    }

    let validation = reflector
        .validate_buffer(&type_name, &binary_data)
        .map_err(|e| anyhow::anyhow!("Validation failed: {}", e))?;
    if validate_only {
        println!(
            "Validation succeeded (bytes consumed = {})",
            validation.bytes_consumed
        );
        return Ok(());
    }

    /* Parse the data */
    let reflected = reflector
        .reflect(&binary_data, &type_name)
        .map_err(|e| anyhow::anyhow!("Failed to parse binary data: {}", e))?;

    /* Serialize to JSON */
    if values_only {
        let value_only = reflected.extract_value();
        if pretty {
            println!("{}", serde_json::to_string_pretty(&value_only)?);
        } else {
            println!("{}", serde_json::to_string(&value_only)?);
        }
    } else if include_byte_offsets {
        let options = FormatOptions {
            include_byte_offsets: true,
            ..Default::default()
        };
        let formatted = format_reflection_with_options(&reflected, &options);
        if pretty {
            println!("{}", serde_json::to_string_pretty(&formatted)?);
        } else {
            println!("{}", serde_json::to_string(&formatted)?);
        }
    } else if pretty {
        println!("{}", serde_json::to_string_pretty(&reflected)?);
    } else {
        println!("{}", serde_json::to_string(&reflected)?);
    }

    Ok(())
}

fn run_flatten(
    file: PathBuf,
    include_dirs: Vec<PathBuf>,
    output: PathBuf,
    verbose: bool,
) -> anyhow::Result<()> {
    if verbose {
        println!("Flattening: {}", file.display());
        for dir in &include_dirs {
            println!("  Include dir: {}", dir.display());
        }
    }

    let flattened = abi_loader::flatten_with_options(&file, &include_dirs, verbose)?;
    let yaml = serde_yml::to_string(&flattened)?;
    std::fs::write(&output, &yaml)?;

    if verbose {
        println!("Written to: {}", output.display());
    }

    Ok(())
}
