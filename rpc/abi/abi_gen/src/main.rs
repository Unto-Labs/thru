#![allow(dead_code)]
#![allow(unused_imports)]

use clap::{Parser, Subcommand, ValueEnum};
use cmds::analyze::IrOutputFormat;
use std::path::PathBuf;

mod abi;
mod cmds;
mod codegen;
mod dependency;

#[derive(Parser)]
#[command(name = "abi")]
#[command(about = "ABI code generation tool for thru-net", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /* Generate code from ABI type definitions */
    Codegen {
        /* Input YAML files containing type definitions */
        #[arg(short = 'f', long = "files", value_name = "FILE", required = true)]
        files: Vec<PathBuf>,

        /* Include directories for imported type files */
        #[arg(short = 'i', long = "include-dir", value_name = "DIR")]
        include_dirs: Vec<PathBuf>,

        /* Target language for code generation */
        #[arg(short = 'l', long = "language", value_enum)]
        language: Language,

        /* Output directory for generated code */
        #[arg(
            short = 'o',
            long = "output",
            value_name = "DIR",
            default_value = "generated"
        )]
        output_dir: PathBuf,

        /* Enable verbose output */
        #[arg(short = 'v', long = "verbose")]
        verbose: bool,
    },

    /* Analyze ABI type definitions and show detailed type information */
    Analyze {
        /* Input YAML files containing type definitions */
        #[arg(short = 'f', long = "files", value_name = "FILE", required = true)]
        files: Vec<PathBuf>,

        /* Include directories for imported type files */
        #[arg(short = 'i', long = "include-dir", value_name = "DIR")]
        include_dirs: Vec<PathBuf>,

        /* Print the shared layout IR (JSON) after analysis */
        #[arg(long = "print-ir")]
        print_ir: bool,

        /* Format to use when printing the shared layout IR */
        #[arg(long = "ir-format", value_enum, default_value = "json")]
        ir_format: IrOutputFormat,

        /* Print the generated legacy + IR footprint helpers for a specific type */
        #[arg(long = "print-footprint", value_name = "TYPE")]
        print_footprint: Option<String>,

        /* Print the generated legacy + IR validate helpers for a specific type */
        #[arg(long = "print-validate", value_name = "TYPE")]
        print_validate: Option<String>,
    },
}

#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, ValueEnum, Debug)]
enum Language {
    /* Generate C code (.h and .c files) */
    C,
    /* Generate Rust code (.rs files) */
    Rust,
    /* Generate TypeScript code (.ts files) */
    #[value(name = "typescript")]
    TypeScript,
}

impl From<Language> for cmds::codegen::Language {
    fn from(lang: Language) -> Self {
        match lang {
            Language::C => cmds::codegen::Language::C,
            Language::Rust => cmds::codegen::Language::Rust,
            Language::TypeScript => cmds::codegen::Language::TypeScript,
        }
    }
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
            cmds::codegen::run(files, include_dirs, language.into(), output_dir, verbose)?;
        }

        Commands::Analyze {
            files,
            include_dirs,
            print_ir,
            ir_format,
            print_footprint,
            print_validate,
        } => {
            cmds::analyze::run(
                files,
                include_dirs,
                print_ir,
                ir_format,
                print_footprint,
                print_validate,
            )?;
        }
    }

    Ok(())
}
