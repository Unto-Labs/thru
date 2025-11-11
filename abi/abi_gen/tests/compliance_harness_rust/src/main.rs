use anyhow::{Context, Result};
use clap::Parser;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

mod language_runner;

#[derive(Parser, Debug)]
#[command(name = "compliance_harness")]
#[command(about = "Multi-language ABI compliance test harness")]
struct Args {
    /// Path to test case YAML file or directory
    #[arg(value_name = "TEST_CASE")]
    test_case: PathBuf,

    /// Language to test (rust, c, typescript, or all)
    #[arg(short, long, value_name = "LANGUAGE", default_value = "all")]
    language: String,

    /// Output results to JSON file
    #[arg(short, long, value_name = "FILE")]
    output: Option<PathBuf>,

    /// Verbose output
    #[arg(short, long)]
    verbose: bool,

    /// Don't clean up temporary directories after tests
    #[arg(long)]
    no_cleanup: bool,

    /// Temporary directory for test artifacts (default: system temp dir)
    #[arg(long, value_name = "DIR")]
    temp_dir: Option<PathBuf>,
}

#[derive(Debug, Deserialize)]
struct TestCase {
    #[serde(rename = "test-case")]
    test_case: TestCaseData,
}

#[derive(Debug, Deserialize)]
struct TestCaseData {
    name: String,
    #[serde(rename = "abi-file")]
    abi_file: String,
    #[serde(rename = "type")]
    type_name: String,
    #[serde(rename = "binary-hex")]
    binary_hex: String,
    #[allow(dead_code)]
    description: String,
    #[allow(dead_code)]
    tags: Vec<String>,
}

/* Parse hex string to bytes, stripping whitespace */
fn parse_hex_string(hex: &str) -> Result<Vec<u8>> {
    /* Remove all whitespace */
    let hex_clean: String = hex.chars().filter(|c| !c.is_whitespace()).collect();

    /* Validate even length */
    if hex_clean.len() % 2 != 0 {
        anyhow::bail!("Hex string must have even length (got {})", hex_clean.len());
    }

    /* Parse hex digits into bytes */
    let mut bytes = Vec::with_capacity(hex_clean.len() / 2);
    for i in (0..hex_clean.len()).step_by(2) {
        let byte_str = &hex_clean[i..i + 2];
        let byte = u8::from_str_radix(byte_str, 16)
            .with_context(|| format!("Invalid hex digits: {}", byte_str))?;
        bytes.push(byte);
    }

    Ok(bytes)
}

#[derive(Debug, Serialize)]
struct TestRun {
    timestamp: String,
    language: String,
    harness_version: String,
    total_tests: usize,
    passed: usize,
    failed: usize,
    skipped: usize,
    duration_ms: u64,
}

#[derive(Debug, Serialize)]
struct TestResult {
    test_name: String,
    test_file: String,
    status: String,
    duration_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    stages: Option<TestStages>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<TestError>,
}

#[derive(Debug, Serialize)]
struct TestStages {
    code_generation: String,
    compilation: String,
    decode: String,
    validation: String,
    reencode: String,
    binary_match: bool,
}

#[derive(Debug, Serialize)]
struct TestError {
    stage: String,
    message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    details: Option<String>,
}

#[derive(Debug, Serialize)]
struct TestOutput {
    test_run: TestRun,
    results: Vec<TestResult>,
}

fn main() -> Result<()> {
    let args = Args::parse();

    /* Determine which languages to test */
    let languages = if args.language.to_lowercase() == "all" {
        vec!["rust".to_string(), "c".to_string(), "typescript".to_string()]
    } else {
        vec![args.language.clone()]
    };

    let test_cases = if args.test_case.is_dir() {
        discover_test_cases(&args.test_case)?
    } else {
        vec![args.test_case.clone()]
    };

    let start_time = Instant::now();
    let mut all_results = Vec::new();

    /* Run tests for each language */
    for language in &languages {
        let runner = match language_runner::get_runner(language) {
            Some(r) => r,
            None => {
                eprintln!("Unknown language: {}", language);
                eprintln!("Supported languages: rust, c, typescript");
                std::process::exit(1);
            }
        };

        if args.verbose || languages.len() > 1 {
            println!("\n=== Testing {} codegen ===", language.to_uppercase());
        }

        for test_case_path in &test_cases {
            if args.verbose {
                println!("Running test: {}", test_case_path.display());
            }

            match run_test_case(test_case_path, args.verbose, args.no_cleanup, args.temp_dir.as_deref(), &*runner) {
                Ok(result) => all_results.push(result),
                Err(e) => {
                    eprintln!("Error running test {}: {}", test_case_path.display(), e);
                    all_results.push(TestResult {
                        test_name: test_case_path.file_stem().unwrap().to_str().unwrap().to_string(),
                        test_file: test_case_path.display().to_string(),
                        status: "error".to_string(),
                        duration_ms: 0,
                        stages: None,
                        error: Some(TestError {
                            stage: "setup".to_string(),
                            message: e.to_string(),
                            details: None,
                        }),
                    });
                }
            }
        }
    }

    let duration_ms = start_time.elapsed().as_millis() as u64;
    let passed = all_results.iter().filter(|r| r.status == "pass").count();
    let failed = all_results.iter().filter(|r| r.status == "fail").count();

    let language_label = if languages.len() > 1 {
        "all".to_string()
    } else {
        languages[0].clone()
    };

    let output = TestOutput {
        test_run: TestRun {
            timestamp: chrono::Utc::now().to_rfc3339(),
            language: language_label,
            harness_version: "2.0.0".to_string(),
            total_tests: all_results.len(),
            passed,
            failed,
            skipped: 0,
            duration_ms,
        },
        results: all_results,
    };

    let json_output = serde_json::to_string_pretty(&output)?;

    if let Some(output_file) = args.output {
        fs::write(&output_file, &json_output)?;
        println!("Results written to: {}", output_file.display());
    } else {
        println!("{}", json_output);
    }

    println!("\n=== Summary ===");
    println!("Total: {}", output.test_run.total_tests);
    println!("Passed: {}", output.test_run.passed);
    println!("Failed: {}", output.test_run.failed);
    println!("Duration: {}ms", output.test_run.duration_ms);

    if output.test_run.failed > 0 {
        std::process::exit(1);
    }

    Ok(())
}

fn discover_test_cases(dir: &Path) -> Result<Vec<PathBuf>> {
    let mut test_cases = Vec::new();

    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();

        if path.is_file() && path.extension().map(|e| e == "yaml").unwrap_or(false) {
            test_cases.push(path);
        } else if path.is_dir() {
            test_cases.extend(discover_test_cases(&path)?);
        }
    }

    Ok(test_cases)
}

fn run_test_case(
    test_case_path: &Path,
    verbose: bool,
    no_cleanup: bool,
    temp_dir: Option<&Path>,
    runner: &dyn language_runner::LanguageRunner,
) -> Result<TestResult> {
    /* Load test case */
    let test_case_content = fs::read_to_string(test_case_path)
        .context("Failed to read test case file")?;
    let test_case: TestCase = serde_yaml::from_str(&test_case_content)
        .context("Failed to parse test case YAML")?;

    let test_name = test_case.test_case.name.clone();
    let test_file = test_case_path.display().to_string();

    /* Resolve paths relative to test case file */
    let test_case_dir = test_case_path.parent().unwrap();
    let abi_file_path = test_case_dir
        .join(&test_case.test_case.abi_file)
        .canonicalize()
        .context("Failed to resolve ABI file path")?;

    /* Parse hex string to binary data */
    let binary_data = parse_hex_string(&test_case.test_case.binary_hex)
        .context("Failed to parse binary-hex field")?;

    if verbose {
        println!("  ABI file: {}", abi_file_path.display());
        println!("  Binary data: {} bytes", binary_data.len());
        println!("  Type: {}", test_case.test_case.type_name);
    }

    /* Delegate to language-specific runner */
    runner.run_test(
        &test_name,
        &test_file,
        &test_case.test_case,
        &abi_file_path,
        &binary_data,
        verbose,
        no_cleanup,
        temp_dir,
    )
}
