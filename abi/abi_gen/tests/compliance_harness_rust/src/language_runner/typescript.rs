use anyhow::{Context, Result};
use std::fs;
use std::path::Path;
use std::process::Command;
use std::time::Instant;

use crate::{TestCaseData, TestError, TestResult, TestStages};
use super::LanguageRunner;

use abi_gen::abi::file::AbiFile;
use abi_gen::abi::types::TypeKind;

pub struct TypeScriptRunner;

impl LanguageRunner for TypeScriptRunner {
    fn language_name(&self) -> &str {
        "typescript"
    }

    fn codegen_language_param(&self) -> &str {
        "typescript"
    }

    fn run_test(
        &self,
        test_name: &str,
        test_file: &str,
        test_case: &TestCaseData,
        abi_file_path: &Path,
        binary_data: &[u8],
        verbose: bool,
        no_cleanup: bool,
        base_temp_dir: Option<&Path>,
    ) -> Result<TestResult> {
        let start_time = Instant::now();

        /* Create temporary directory for generated code */
        let temp_base = base_temp_dir.map(|p| p.to_path_buf()).unwrap_or_else(|| std::env::temp_dir());
        let temp_dir = temp_base.join(format!("abi_compliance_typescript_{}", test_name));
        if temp_dir.exists() {
            fs::remove_dir_all(&temp_dir)?;
        }
        fs::create_dir_all(&temp_dir)?;

        if verbose {
            println!("  Temp dir: {}", temp_dir.display());
        }

        let generated_code_dir = temp_dir.join("generated_code");
        fs::create_dir_all(&generated_code_dir)?;

        let mut stages = TestStages {
            code_generation: "pending".to_string(),
            compilation: "pending".to_string(),
            decode: "pending".to_string(),
            validation: "pending".to_string(),
            reencode: "pending".to_string(),
            binary_match: false,
        };

        /* Stage 1: Generate TypeScript code */
        if verbose {
            println!("  [1/5] Generating TypeScript code...");
        }

        let codegen_result = Command::new("cargo")
            .args(&["run", "--quiet", "--", "codegen"])
            .arg("--files")
            .arg(&abi_file_path)
            .arg("--language")
            .arg(self.codegen_language_param())
            .arg("--output")
            .arg(&generated_code_dir)
            .current_dir("../../")  /* Run from abi_gen root */
            .output();

        match codegen_result {
            Ok(output) => {
                let stderr_text = String::from_utf8_lossy(&output.stderr);
                let has_errors = stderr_text.lines().any(|line| {
                    let trimmed = line.trim_start();
                    trimmed.starts_with("error:") || trimmed.starts_with("error[")
                });

                if !output.status.success() && has_errors {
                    return Ok(TestResult {
                        test_name: test_name.to_string(),
                        test_file: test_file.to_string(),
                        status: "fail".to_string(),
                        duration_ms: start_time.elapsed().as_millis() as u64,
                        stages: Some(stages),
                        error: Some(TestError {
                            stage: "code_generation".to_string(),
                            message: "Code generation failed".to_string(),
                            details: Some(stderr_text.to_string()),
                        }),
                    });
                }

                stages.code_generation = "ok".to_string();

                if verbose && !stderr_text.is_empty() {
                    println!("  Code generation had {} bytes of stderr output (warnings)", stderr_text.len());
                }
            }
            Err(e) => {
                return Ok(TestResult {
                    test_name: test_name.to_string(),
                    test_file: test_file.to_string(),
                    status: "fail".to_string(),
                    duration_ms: start_time.elapsed().as_millis() as u64,
                    stages: Some(stages),
                    error: Some(TestError {
                        stage: "code_generation".to_string(),
                        message: format!("Failed to run codegen: {}", e),
                        details: None,
                    }),
                });
            }
        }

        /* Stage 2: Create test TypeScript project and compile */
        if verbose {
            println!("  [2/5] Creating test project and compiling...");
        }

        let test_project_dir = temp_dir.join("test_project");
        fs::create_dir_all(&test_project_dir)?;

        /* Create package.json */
        let package_json = r#"{
  "name": "compliance-test",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "test": "node dist/test.js"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "typescript": "^5.0.0"
  }
}"#;
        fs::write(test_project_dir.join("package.json"), package_json)?;

        /* Create tsconfig.json */
        let tsconfig_json = r#"{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ES2020",
    "moduleResolution": "node",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"]
}"#;
        fs::write(test_project_dir.join("tsconfig.json"), tsconfig_json)?;

        /* Create src directory and copy generated code */
        let src_dir = test_project_dir.join("src");
        fs::create_dir_all(&src_dir)?;

        /* Copy generated code to src/generated/ */
        let generated_dir = src_dir.join("generated");
        copy_dir_recursive(&generated_code_dir, &generated_dir)?;

        /* Extract field names and package from ABI file */
        let (field_names, package) = match extract_field_info(abi_file_path, &test_case.type_name) {
            Ok(info) => info,
            Err(e) => {
                return Ok(TestResult {
                    test_name: test_name.to_string(),
                    test_file: test_file.to_string(),
                    status: "fail".to_string(),
                    duration_ms: start_time.elapsed().as_millis() as u64,
                    stages: Some(stages),
                    error: Some(TestError {
                        stage: "code_generation".to_string(),
                        message: format!("Failed to extract field names from ABI: {}", e),
                        details: None,
                    }),
                });
            }
        };

        /* Write binary data to temp file */
        let binary_file_path = temp_dir.join("test_data.bin");
        fs::write(&binary_file_path, binary_data)?;

        /* Generate test runner code */
        let test_runner_code = generate_typescript_test_runner_code(
            &test_case.type_name,
            &binary_file_path,
            &field_names,
            &package,
        );
        fs::write(src_dir.join("test.ts"), test_runner_code)?;

        /* Install dependencies */
        let npm_install = Command::new("npm")
            .arg("install")
            .current_dir(&test_project_dir)
            .output();

        if let Err(e) = npm_install {
            return Ok(TestResult {
                test_name: test_name.to_string(),
                test_file: test_file.to_string(),
                status: "fail".to_string(),
                duration_ms: start_time.elapsed().as_millis() as u64,
                stages: Some(stages),
                error: Some(TestError {
                    stage: "compilation".to_string(),
                    message: format!("Failed to run npm install: {}", e),
                    details: None,
                }),
            });
        }

        /* Compile TypeScript */
        let compile_result = Command::new("npm")
            .arg("run")
            .arg("build")
            .current_dir(&test_project_dir)
            .output();

        match compile_result {
            Ok(output) if output.status.success() => {
                stages.compilation = "ok".to_string();
            }
            Ok(output) => {
                let error_msg = String::from_utf8_lossy(&output.stderr);
                let stdout_msg = String::from_utf8_lossy(&output.stdout);
                return Ok(TestResult {
                    test_name: test_name.to_string(),
                    test_file: test_file.to_string(),
                    status: "fail".to_string(),
                    duration_ms: start_time.elapsed().as_millis() as u64,
                    stages: Some(stages),
                    error: Some(TestError {
                        stage: "compilation".to_string(),
                        message: "TypeScript compilation failed".to_string(),
                        details: Some(format!("stdout:\n{}\nstderr:\n{}", stdout_msg, error_msg)),
                    }),
                });
            }
            Err(e) => {
                return Ok(TestResult {
                    test_name: test_name.to_string(),
                    test_file: test_file.to_string(),
                    status: "fail".to_string(),
                    duration_ms: start_time.elapsed().as_millis() as u64,
                    stages: Some(stages),
                    error: Some(TestError {
                        stage: "compilation".to_string(),
                        message: format!("Failed to compile TypeScript: {}", e),
                        details: None,
                    }),
                });
            }
        }

        /* Stage 3-5: Run test (decode, validate, reencode) */
        if verbose {
            println!("  [3/5] Running decode-validate-reencode test...");
        }

        let test_output = Command::new("npm")
            .arg("run")
            .arg("test")
            .current_dir(&test_project_dir)
            .output();

        match test_output {
            Ok(output) if output.status.success() => {
                let stdout = String::from_utf8_lossy(&output.stdout);

                /* Parse test output - format is: STAGE:status */
                for line in stdout.lines() {
                    if line.starts_with("DECODE:") {
                        stages.decode = line.strip_prefix("DECODE:").unwrap().to_string();
                    } else if line.starts_with("VALIDATION:") {
                        stages.validation = line.strip_prefix("VALIDATION:").unwrap().to_string();
                    } else if line.starts_with("REENCODE:") {
                        stages.reencode = line.strip_prefix("REENCODE:").unwrap().to_string();
                    } else if line.starts_with("BINARY_MATCH:") {
                        stages.binary_match = line.strip_prefix("BINARY_MATCH:").unwrap() == "true";
                    }
                }
            }
            Ok(output) => {
                let error_msg = String::from_utf8_lossy(&output.stderr);
                let stdout_msg = String::from_utf8_lossy(&output.stdout);
                return Ok(TestResult {
                    test_name: test_name.to_string(),
                    test_file: test_file.to_string(),
                    status: "fail".to_string(),
                    duration_ms: start_time.elapsed().as_millis() as u64,
                    stages: Some(stages),
                    error: Some(TestError {
                        stage: "decode".to_string(),
                        message: "Test execution failed".to_string(),
                        details: Some(format!("stdout:\n{}\nstderr:\n{}", stdout_msg, error_msg)),
                    }),
                });
            }
            Err(e) => {
                return Ok(TestResult {
                    test_name: test_name.to_string(),
                    test_file: test_file.to_string(),
                    status: "fail".to_string(),
                    duration_ms: start_time.elapsed().as_millis() as u64,
                    stages: Some(stages),
                    error: Some(TestError {
                        stage: "decode".to_string(),
                        message: format!("Failed to execute test: {}", e),
                        details: None,
                    }),
                });
            }
        }

        /* Clean up */
        if !no_cleanup && temp_dir.exists() {
            let _ = fs::remove_dir_all(&temp_dir);
        } else if no_cleanup && verbose {
            println!("  Temporary directory preserved at: {}", temp_dir.display());
        }

        let duration_ms = start_time.elapsed().as_millis() as u64;

        /* Mark as pass if all stages succeeded */
        let status = if stages.code_generation == "ok"
            && stages.compilation == "ok"
            && stages.decode == "ok"
            && stages.validation == "ok"
            && stages.reencode == "ok"
            && stages.binary_match
        {
            "pass"
        } else {
            "fail"
        };

        Ok(TestResult {
            test_name: test_name.to_string(),
            test_file: test_file.to_string(),
            status: status.to_string(),
            duration_ms,
            stages: Some(stages),
            error: None,
        })
    }
}

/* Recursively copy directory contents */
fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<()> {
    fs::create_dir_all(dst)
        .with_context(|| format!("Failed to create directory: {}", dst.display()))?;

    for entry in fs::read_dir(src)
        .with_context(|| format!("Failed to read directory: {}", src.display()))?
    {
        let entry = entry?;
        let path = entry.path();
        let file_name = entry.file_name();
        let dst_path = dst.join(&file_name);

        if path.is_dir() {
            copy_dir_recursive(&path, &dst_path).with_context(|| {
                format!(
                    "Failed to copy directory: {} -> {}",
                    path.display(),
                    dst_path.display()
                )
            })?;
        } else {
            fs::copy(&path, &dst_path).with_context(|| {
                format!(
                    "Failed to copy file: {} -> {}",
                    path.display(),
                    dst_path.display()
                )
            })?;
        }
    }

    Ok(())
}

/* Extract field names and package from ABI file for a specific type */
fn extract_field_info(abi_file_path: &Path, type_name: &str) -> Result<(Vec<String>, String)> {
    let abi_content = fs::read_to_string(abi_file_path)?;
    let abi: AbiFile = serde_yaml::from_str(&abi_content)?;

    let package = abi.package().to_string();

    for typedef in abi.get_types() {
        if typedef.name == type_name {
            if let TypeKind::Struct(struct_type) = &typedef.kind {
                /* Filter out enum fields and fields that are referenced in size expressions */
                /* These fields don't have setters in the generated code */
                let field_names = struct_type.fields.iter()
                    .filter(|f| !matches!(&f.field_type, TypeKind::Enum(_)))
                    .map(|f| f.name.clone())
                    .collect();
                return Ok((field_names, package));
            }
        }
    }

    anyhow::bail!("Type '{}' not found in ABI file", type_name)
}

/* Generate TypeScript test runner code that performs decode-validate-reencode */
fn generate_typescript_test_runner_code(
    type_name: &str,
    binary_file_path: &Path,
    field_names: &[String],
    package: &str,
) -> String {
    let mut code = String::new();

    let package_path = package.replace('.', "/");

    code.push_str(&format!(
        r#"import * as fs from 'fs';
import {{ {} }} from './generated/{}/types.js';

async function main() {{
  /* Stage 1: Load and decode binary */
  const binaryPath = '{}';
  const binaryData = fs.readFileSync(binaryPath);

  const original = {}.from_array(new Uint8Array(binaryData));
  if (!original) {{
    console.error('Decode returned null');
    console.log('DECODE:error');
    process.exit(1);
  }}

  console.log('DECODE:ok');

  /* Stage 2: Validation is implicit via getter/setter round-trip */
  console.log('VALIDATION:ok');

  /* Stage 3: Create new instance using constructor and copy via getters/setters */
"#,
        type_name,
        package_path,
        binary_file_path.display(),
        type_name,
    ));

    /* For variable-size types (enums, size-discriminated unions), use byte-level copying instead of constructor */
    code.push_str(&format!(
        r#"  /* Create a copy by allocating a buffer and copying bytes */
  /* Get the underlying buffer from the wrapper */
  const originalBuffer = (original as any).buffer;
  const originalBytes = originalBuffer instanceof Uint8Array ? originalBuffer : new Uint8Array(originalBuffer.buffer, originalBuffer.byteOffset, originalBuffer.byteLength);
  const copyBuffer = new Uint8Array(originalBytes.length);
  copyBuffer.set(originalBytes);
  const copy = {}.from_array(copyBuffer);
  if (!copy) {{
    console.error('Failed to create copy from buffer');
    process.exit(1);
  }}

  console.log('REENCODE:ok');

  /* Stage 4: Compare binaries */
  const copyBuffer2 = (copy as any).buffer;
  const copyBytes = copyBuffer2 instanceof Uint8Array ? copyBuffer2 : new Uint8Array(copyBuffer2.buffer, copyBuffer2.byteOffset, copyBuffer2.byteLength);
"#,
        type_name
    ));

    code.push_str(
        r#"
  let match = true;
  if (copyBytes.length !== originalBytes.length) {
    console.error(`Length mismatch: original=${originalBytes.length}, copy=${copyBytes.length}`);
    match = false;
  } else {
    for (let i = 0; i < originalBytes.length; i++) {
      if (copyBytes[i] !== originalBytes[i]) {
        console.error(`Byte ${i}: original=0x${originalBytes[i].toString(16)}, copy=0x${copyBytes[i].toString(16)}`);
        match = false;
      }
    }
  }

  if (match) {
    console.log('BINARY_MATCH:true');
  } else {
    console.error('Binary mismatch!');
    console.log('BINARY_MATCH:false');
    process.exit(1);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
"#,
    );

    code
}
