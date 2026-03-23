/* Binary for parsing ABI binary data and printing JSON reflection results */

use abi_gen::abi::file::ImportResolver;
use abi_gen::abi::resolved::TypeResolver;
use abi_reflect::Reflector;
use clap::Parser as ClapParser;
use std::path::PathBuf;

#[derive(ClapParser)]
#[command(name = "abi-reflect")]
#[command(about = "Parse ABI binary data and print JSON reflection results")]
struct Args {
    /* ABI file(s) to load */
    #[arg(short, long, required = true)]
    abi_file: Vec<PathBuf>,

    /* Include directories for resolving imports */
    #[arg(short = 'I', long)]
    include_dir: Vec<PathBuf>,

    /* Type name to parse */
    #[arg(short, long, required = true)]
    type_name: String,

    /* Binary data file to parse */
    #[arg(short, long, required = true)]
    data_file: PathBuf,

    /* Pretty print JSON output */
    #[arg(short, long)]
    pretty: bool,

    /* Show only values (no type information) */
    #[arg(short = 'v', long)]
    values_only: bool,

    /* Only validate buffer without decoding */
    #[arg(long)]
    validate_only: bool,

    /* Print dynamic parameters inferred from the buffer */
    #[arg(long)]
    show_params: bool,
}

fn main() -> anyhow::Result<()> {
    let args = Args::parse();

    /* Create import resolver */
    let mut import_resolver = ImportResolver::new(args.include_dir);

    /* Load all ABI files */
    for abi_file in &args.abi_file {
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
    let binary_data = std::fs::read(&args.data_file)?;

    if args.show_params {
        let params = reflector
            .dynamic_params(&args.type_name, &binary_data)
            .map_err(|e| anyhow::anyhow!("Failed to extract dynamic params: {}", e))?;
        println!("Dynamic parameters:");
        for (name, value) in &params {
            println!("  {name} = {value}");
        }
    }

    let validation = reflector
        .validate_buffer(&args.type_name, &binary_data)
        .map_err(|e| anyhow::anyhow!("Validation failed: {}", e))?;
    if args.validate_only {
        println!(
            "Validation succeeded (bytes consumed = {})",
            validation.bytes_consumed
        );
        return Ok(());
    }

    /* Parse the data */
    let reflected = reflector
        .reflect(&binary_data, &args.type_name)
        .map_err(|e| anyhow::anyhow!("Failed to parse binary data: {}", e))?;

    /* Serialize to JSON */
    if args.values_only {
        /* Extract just the values */
        let value_only = reflected.extract_value();
        if args.pretty {
            let json = serde_json::to_string_pretty(&value_only)?;
            println!("{}", json);
        } else {
            let json = serde_json::to_string(&value_only)?;
            println!("{}", json);
        }
    } else {
        /* Show full reflection with type information */
        if args.pretty {
            let json = serde_json::to_string_pretty(&reflected)?;
            println!("{}", json);
        } else {
            let json = serde_json::to_string(&reflected)?;
            println!("{}", json);
        }
    }

    Ok(())
}
