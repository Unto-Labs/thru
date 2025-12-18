use abi_loader::flatten_with_options;
use clap::Parser;
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "abi-flatten")]
#[command(about = "Flatten an ABI file by resolving all imports")]
struct Args {
    /// Input ABI file
    #[arg(short, long, required = true)]
    file: PathBuf,

    /// Include directories for resolving imports
    #[arg(short = 'I', long)]
    include_dir: Vec<PathBuf>,

    /// Output file path
    #[arg(short, long, required = true)]
    output: PathBuf,

    /// Verbose output
    #[arg(short, long)]
    verbose: bool,
}

fn main() -> anyhow::Result<()> {
    let args = Args::parse();

    if args.verbose {
        println!("Flattening: {}", args.file.display());
        for dir in &args.include_dir {
            println!("  Include dir: {}", dir.display());
        }
    }

    let flattened = flatten_with_options(&args.file, &args.include_dir, args.verbose)?;
    let yaml = serde_yml::to_string(&flattened)?;
    std::fs::write(&args.output, &yaml)?;

    if args.verbose {
        println!("Written to: {}", args.output.display());
    }

    Ok(())
}
