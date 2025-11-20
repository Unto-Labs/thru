use anyhow::{Context, Result};
use std::fs;
use std::path::Path;
use std::process::Command;
use std::time::Instant;

use crate::{TestCaseData, TestError, TestResult, TestStages};
use super::LanguageRunner;

use abi_gen::abi::file::AbiFile;
use abi_gen::abi::types::TypeKind;

pub struct RustRunner;

impl LanguageRunner for RustRunner {
    fn language_name(&self) -> &str {
        "rust"
    }

    fn codegen_language_param(&self) -> &str {
        "rust"
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
        let temp_dir = temp_base.join(format!("abi_compliance_rust_{}", test_name));
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

        /* Stage 1: Generate Rust code */
        if verbose {
            println!("  [1/5] Generating Rust code...");
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

        /* Stage 2: Create test Cargo project and compile */
        if verbose {
            println!("  [2/5] Creating test project and compiling...");
        }

        let test_project_dir = temp_dir.join("test_project");
        fs::create_dir_all(&test_project_dir)?;

        /* Create Cargo.toml for test project */
        let cargo_toml = r#"[package]
name = "compliance_test"
version = "0.1.0"
edition = "2021"

[[bin]]
name = "test_runner"
path = "src/main.rs"
"#;
        fs::write(test_project_dir.join("Cargo.toml"), cargo_toml)?;

        /* Create src directory and copy generated code */
        let src_dir = test_project_dir.join("src");
        fs::create_dir_all(&src_dir)?;

        /* Copy generated code to src/generated/ */
        let generated_dir = src_dir.join("generated");
        copy_dir_recursive(&generated_code_dir, &generated_dir)?;

        /* Extract field names and package from ABI file */
        let (referenced_primitive_fields, non_referenced_primitive_fields, enum_fields, array_fields, nested_fields, size_discriminated_union_fields, package) = match extract_field_info(abi_file_path, &test_case.type_name) {
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

        /* Extract SDU variant info from ABI */
        let abi_content = fs::read_to_string(abi_file_path)?;
        let abi: AbiFile = serde_yaml::from_str(&abi_content)?;
        let sdu_fields_with_variants: Vec<(String, Vec<(String, u64)>)> = abi.get_types().iter()
            .find(|t| t.name == test_case.type_name)
            .and_then(|t| {
                if let TypeKind::Struct(struct_type) = &t.kind {
                    Some(struct_type.fields.iter()
                        .filter_map(|f| {
                            match &f.field_type {
                                TypeKind::SizeDiscriminatedUnion(sdu_type) => {
                                    let variants: Vec<(String, u64)> = sdu_type.variants.iter()
                                        .map(|v| (v.name.clone(), v.expected_size))
                                        .collect();
                                    Some((f.name.clone(), variants))
                                },
                                _ => None,
                            }
                        })
                        .collect())
                } else {
                    None
                }
            })
            .unwrap_or_default();

        /* Generate test runner code */
        let test_runner_code = generate_rust_test_runner_code(
            &test_case.type_name,
            &binary_file_path,
            &referenced_primitive_fields,
            &non_referenced_primitive_fields,
            &enum_fields,
            &array_fields,
            &nested_fields,
            &size_discriminated_union_fields,
            &sdu_fields_with_variants,
            &package,
        );
        fs::write(src_dir.join("main.rs"), test_runner_code)?;

        /* Compile the test project */
        let compile_result = Command::new("cargo")
            .args(&["build", "--release", "--quiet"])
            .current_dir(&test_project_dir)
            .output();

        match compile_result {
            Ok(output) if output.status.success() => {
                stages.compilation = "ok".to_string();
            }
            Ok(output) => {
                let error_msg = String::from_utf8_lossy(&output.stderr);
                return Ok(TestResult {
                    test_name: test_name.to_string(),
                    test_file: test_file.to_string(),
                    status: "fail".to_string(),
                    duration_ms: start_time.elapsed().as_millis() as u64,
                    stages: Some(stages),
                    error: Some(TestError {
                        stage: "compilation".to_string(),
                        message: "Test project compilation failed".to_string(),
                        details: Some(error_msg.to_string()),
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
                        message: format!("Failed to compile test project: {}", e),
                        details: None,
                    }),
                });
            }
        }

        /* Stage 3-5: Run test (decode, validate, reencode) */
        if verbose {
            println!("  [3/5] Running decode-validate-reencode test...");
        }

        let test_binary = test_project_dir.join("target/release/test_runner");
        let test_output = Command::new(&test_binary).output();

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

/* Helper to extract field references from expressions */
fn extract_field_refs_from_expr(expr: &abi_gen::abi::expr::ExprKind, refs: &mut std::collections::HashSet<String>) {
    use abi_gen::abi::expr::ExprKind;
    match expr {
        ExprKind::FieldRef(field_ref) => {
            // Join the full path with underscores for nested field refs
            // e.g., ["first", "count"] becomes "first_count"
            let full_path = field_ref.path.join("_");
            refs.insert(full_path);
        }
        /* Recursively extract from binary operations */
        ExprKind::Add(e) => {
            extract_field_refs_from_expr(&e.left, refs);
            extract_field_refs_from_expr(&e.right, refs);
        }
        ExprKind::Sub(e) => {
            extract_field_refs_from_expr(&e.left, refs);
            extract_field_refs_from_expr(&e.right, refs);
        }
        ExprKind::Mul(e) => {
            extract_field_refs_from_expr(&e.left, refs);
            extract_field_refs_from_expr(&e.right, refs);
        }
        ExprKind::Div(e) => {
            extract_field_refs_from_expr(&e.left, refs);
            extract_field_refs_from_expr(&e.right, refs);
        }
        ExprKind::Mod(e) => {
            extract_field_refs_from_expr(&e.left, refs);
            extract_field_refs_from_expr(&e.right, refs);
        }
        ExprKind::Pow(e) => {
            extract_field_refs_from_expr(&e.left, refs);
            extract_field_refs_from_expr(&e.right, refs);
        }
        ExprKind::BitAnd(e) => {
            extract_field_refs_from_expr(&e.left, refs);
            extract_field_refs_from_expr(&e.right, refs);
        }
        ExprKind::BitOr(e) => {
            extract_field_refs_from_expr(&e.left, refs);
            extract_field_refs_from_expr(&e.right, refs);
        }
        ExprKind::BitXor(e) => {
            extract_field_refs_from_expr(&e.left, refs);
            extract_field_refs_from_expr(&e.right, refs);
        }
        ExprKind::LeftShift(e) => {
            extract_field_refs_from_expr(&e.left, refs);
            extract_field_refs_from_expr(&e.right, refs);
        }
        ExprKind::RightShift(e) => {
            extract_field_refs_from_expr(&e.left, refs);
            extract_field_refs_from_expr(&e.right, refs);
        }
        /* Unary operations */
        ExprKind::BitNot(e) => {
            extract_field_refs_from_expr(&e.operand, refs);
        }
        ExprKind::Neg(e) => {
            extract_field_refs_from_expr(&e.operand, refs);
        }
        ExprKind::Not(e) => {
            extract_field_refs_from_expr(&e.operand, refs);
        }
        ExprKind::Popcount(e) => {
            extract_field_refs_from_expr(&e.operand, refs);
        }
        _ => {}
    }
}

/* Extract field names and package from ABI file for a specific type */
fn extract_field_info(abi_file_path: &Path, type_name: &str) -> Result<(Vec<String>, Vec<String>, Vec<String>, Vec<(String, bool, bool)>, Vec<(String, Vec<String>)>, Vec<String>, String)> {
    use std::collections::HashSet;

    let abi_content = fs::read_to_string(abi_file_path)?;
    let abi: AbiFile = serde_yaml::from_str(&abi_content)?;

    let package = abi.package().to_string();

    for typedef in abi.get_types() {
        if typedef.name == type_name {
            if let TypeKind::Struct(struct_type) = &typedef.kind {
                /* Extract which fields are referenced in expressions (like enum tag-refs and FAM sizes) */
                let mut referenced_fields = HashSet::new();
                for field in &struct_type.fields {
                    if let TypeKind::Enum(enum_type) = &field.field_type {
                        extract_field_refs_from_expr(&enum_type.tag_ref, &mut referenced_fields);
                    }
                    /* Extract fields from FAM size expressions */
                    if let TypeKind::Array(array_type) = &field.field_type {
                        extract_field_refs_from_expr(&array_type.size, &mut referenced_fields);
                    }
                    /* Extract fields from nested inline structs */
                    if let TypeKind::Struct(nested_struct) = &field.field_type {
                        for nested_field in &nested_struct.fields {
                            if let TypeKind::Array(array_type) = &nested_field.field_type {
                                extract_field_refs_from_expr(&array_type.size, &mut referenced_fields);
                            }
                            if let TypeKind::Enum(enum_type) = &nested_field.field_type {
                                extract_field_refs_from_expr(&enum_type.tag_ref, &mut referenced_fields);
                            }
                        }
                    }
                }

                /* For opaque wrappers, collect fields by category:
                   - Referenced primitives (passed to new() - like enum tags)
                   - Non-referenced primitives (set via setters after new())
                   - Enums (set via setters after new())
                   - Arrays (set via setters after new())
                   - Nested structs (set via setters after new()) */

                // Collect referenced primitive fields (both top-level and nested)
                let mut referenced_primitive_fields = Vec::new();
                for f in &struct_type.fields {
                    match &f.field_type {
                        TypeKind::Primitive(_) if referenced_fields.contains(&f.name) => {
                            referenced_primitive_fields.push(f.name.clone());
                        }
                        TypeKind::Struct(nested_struct) => {
                            // Check nested struct fields for referenced primitives
                            for nested_field in &nested_struct.fields {
                                if let TypeKind::Primitive(_) = &nested_field.field_type {
                                    let nested_path = format!("{}_{}", f.name, nested_field.name);
                                    if referenced_fields.contains(&nested_path) {
                                        referenced_primitive_fields.push(nested_path);
                                    }
                                }
                            }
                        }
                        _ => {}
                    }
                }

                // Collect non-referenced primitive fields (both top-level and nested)
                let mut non_referenced_primitive_fields = Vec::new();
                for f in &struct_type.fields {
                    match &f.field_type {
                        TypeKind::Primitive(_) if !referenced_fields.contains(&f.name) => {
                            non_referenced_primitive_fields.push(f.name.clone());
                        }
                        TypeKind::Struct(nested_struct) => {
                            // Also collect non-referenced primitives from nested inline structs
                            for nested_field in &nested_struct.fields {
                                if let TypeKind::Primitive(_) = &nested_field.field_type {
                                    let nested_path = format!("{}_{}", f.name, nested_field.name);
                                    if !referenced_fields.contains(&nested_path) {
                                        non_referenced_primitive_fields.push(nested_path);
                                    }
                                }
                            }
                        }
                        _ => {}
                    }
                }

                let enum_fields: Vec<String> = struct_type.fields.iter()
                    .filter_map(|f| {
                        match &f.field_type {
                            TypeKind::Enum(_) => Some(f.name.clone()),
                            _ => None,
                        }
                    })
                    .collect();

                let size_discriminated_union_fields: Vec<String> = struct_type.fields.iter()
                    .filter_map(|f| {
                        match &f.field_type {
                            TypeKind::SizeDiscriminatedUnion(_) => Some(f.name.clone()),
                            _ => None,
                        }
                    })
                    .collect();

                /* Also collect array fields for post-new() initialization
                   Format: (field_name, is_byte_array, is_struct_array) */
                let array_fields: Vec<(String, bool, bool)> = struct_type.fields.iter()
                    .filter_map(|f| {
                        match &f.field_type {
                            TypeKind::Array(array_type) => {
                                /* Check if element type is u8 (byte array) */
                                let is_byte_array = matches!(&*array_type.element_type, TypeKind::Primitive(prim)
                                    if matches!(prim, abi_gen::abi::types::PrimitiveType::Integral(
                                        abi_gen::abi::types::IntegralType::U8)));
                                /* Check if element type is a struct (TypeRef) */
                                let is_struct_array = matches!(&*array_type.element_type, TypeKind::TypeRef(_));
                                Some((f.name.clone(), is_byte_array, is_struct_array))
                            },
                            _ => None,
                        }
                    })
                    .collect();

                /* Also collect nested struct fields (both TypeRef and inline) with their field names
                   Format: (field_name, vec_of_nested_field_names) */
                let nested_fields: Vec<(String, Vec<String>)> = struct_type.fields.iter()
                    .filter_map(|f| {
                        match &f.field_type {
                            TypeKind::TypeRef(type_ref) => {
                                /* Look up the nested struct type and get its fields */
                                let nested_type_name = &type_ref.name;
                                let nested_field_names = abi.get_types().iter()
                                    .find(|t| &t.name == nested_type_name)
                                    .and_then(|t| {
                                        if let TypeKind::Struct(nested_struct) = &t.kind {
                                            Some(nested_struct.fields.iter()
                                                .filter_map(|nf| {
                                                    /* Only include primitive fields for now */
                                                    match &nf.field_type {
                                                        TypeKind::Primitive(_) => Some(nf.name.clone()),
                                                        _ => None,
                                                    }
                                                })
                                                .collect())
                                        } else {
                                            None
                                        }
                                    })
                                    .unwrap_or_default();
                                Some((f.name.clone(), nested_field_names))
                            },
                            TypeKind::Struct(nested_struct) => {
                                /* Inline anonymous nested struct - only include arrays, not primitives
                                   (primitives are already handled via flattened field names like first_x, first_y) */
                                let nested_field_names: Vec<String> = nested_struct.fields.iter()
                                    .filter_map(|nf| {
                                        match &nf.field_type {
                                            TypeKind::Array(_) => Some(nf.name.clone()),
                                            _ => None,
                                        }
                                    })
                                    .collect();
                                if !nested_field_names.is_empty() {
                                    Some((f.name.clone(), nested_field_names))
                                } else {
                                    None
                                }
                            },
                            _ => None,
                        }
                    })
                    .collect();

                return Ok((referenced_primitive_fields, non_referenced_primitive_fields, enum_fields, array_fields, nested_fields, size_discriminated_union_fields, package));
            }
        }
    }

    anyhow::bail!("Type '{}' not found in ABI file", type_name)
}

/* Generate test runner code that performs decode-validate-reencode */
fn generate_rust_test_runner_code(
    type_name: &str,
    binary_file_path: &Path,
    referenced_primitive_fields: &[String],
    non_referenced_primitive_fields: &[String],
    enum_fields: &[String],
    array_fields: &[(String, bool, bool)],  /* (field_name, is_byte_array, is_struct_array) */
    nested_fields: &[(String, Vec<String>)],  /* (field_name, nested_struct_field_names) */
    size_discriminated_union_fields: &[String],
    sdu_fields_with_variants: &[(String, Vec<(String, u64)>)],
    package: &str,
) -> String {
    let mut code = String::new();

    /* Convert package to module path: compliance.arrays -> generated::compliance::arrays */
    let module_path = format!("generated::{}", package.replace('.', "::"));

    code.push_str(&format!(
        r#"use std::fs;
use std::path::Path;

mod generated;

fn main() {{
    /* Stage 1: Load binary */
    let binary_path = Path::new({:?});
    let original_data = match fs::read(binary_path) {{
        Ok(data) => data,
        Err(e) => {{
            eprintln!("Failed to read binary file: {{}}", e);
            println!("DECODE:error");
            std::process::exit(1);
        }}
    }};

    /* Stage 2: Decode from binary using from_slice() - opaque wrapper */
    let original = match {}::{}::from_slice(&original_data) {{
        Ok(val) => val,  /* Opaque wrapper borrows the slice */
        Err(e) => {{
            eprintln!("Validation failed: {{}}", e);
            println!("DECODE:error");
            std::process::exit(1);
        }}
    }};

    println!("DECODE:ok");

    /* Stage 3: Validate - validation happens in from_slice() */
    println!("VALIDATION:ok");

    /* Stage 4: Reencode using new() constructor with getters */
    /* Allocate buffer for reencoding - use same size as original */
    let mut reencoded_buffer = vec![0u8; original_data.len()];
"#,
        binary_file_path.display(),
        module_path,
        type_name,
    ));

    if referenced_primitive_fields.is_empty() && size_discriminated_union_fields.is_empty() {
        /* No referenced fields or SDU fields - just create empty instance */
        code.push_str(&format!(
            "    let reencoded_size = {}::{}::new(&mut reencoded_buffer).expect(\"new() failed\");\n",
            module_path, type_name
        ));
    } else {
        /* Has referenced fields or SDU fields - use new() constructor with values */
        code.push_str("    let reencoded_size = ");
        code.push_str(&format!("{}::{}::new(&mut reencoded_buffer,\n", module_path, type_name));

        let mut param_count = 0;
        /* Generate getter calls for referenced primitive fields */
        for field_name in referenced_primitive_fields {
            if param_count > 0 {
                code.push_str(",\n");
            }
            code.push_str(&format!("        original.{}()", field_name));
            param_count += 1;
        }
        /* Generate tag getter calls for size-discriminated union fields */
        for field_name in size_discriminated_union_fields {
            if param_count > 0 {
                code.push_str(",\n");
            }
            code.push_str(&format!("        original.{}_tag()", field_name));
            param_count += 1;
        }
        code.push_str("\n    ).expect(\"new() failed\");\n");
    }

    /* Set non-referenced primitive fields, enums, arrays, nested structs, and size-discriminated unions via setters */
    if !non_referenced_primitive_fields.is_empty() || !enum_fields.is_empty() || !array_fields.is_empty() || !nested_fields.is_empty() || !size_discriminated_union_fields.is_empty() {
        code.push_str("\n    /* Set non-referenced fields using mutable wrapper */\n");
        code.push_str(&format!("    {{\n"));
        code.push_str(&format!("        let mut reencoded_mut = {}::{}Mut::from_slice_mut(&mut reencoded_buffer[..reencoded_size]).expect(\"from_slice_mut failed\");\n", module_path, type_name));

        /* Set non-referenced primitive fields */
        for field_name in non_referenced_primitive_fields {
            code.push_str(&format!("        reencoded_mut.set_{}(original.{}());\n", field_name, field_name));
        }

        /* Set enum fields using body getters and setters */
        if !enum_fields.is_empty() {
            code.push_str("\n        /* Set enum fields using body getters and setters */\n");
            for field_name in enum_fields {
                code.push_str(&format!("        {{\n"));
                code.push_str(&format!("            let body = original.{}_body();\n", field_name));
                code.push_str(&format!("            reencoded_mut.set_{}_body(body).expect(\"Failed to set enum body\");\n", field_name));
                code.push_str("        }\n");
            }
        }

        /* Set size-discriminated union fields using variant-specific getters and setters (like enums) */
        if !sdu_fields_with_variants.is_empty() {
            code.push_str("\n        /* Set size-discriminated union fields using variant-specific getters and setters */\n");
            for (field_name, variants) in sdu_fields_with_variants {
                code.push_str("        {\n");
                code.push_str(&format!("            let tag = original.{}_tag();\n", field_name));
                code.push_str(&format!("            match tag {{\n"));
                
                for (idx, (variant_name, _expected_size)) in variants.iter().enumerate() {
                    let variant_name_snake = variant_name.to_lowercase().replace("-", "_");
                    code.push_str(&format!("                {} => {{\n", idx));
                    code.push_str(&format!("                    let variant = original.{}_{}();\n", field_name, variant_name_snake));
                    code.push_str(&format!("                    reencoded_mut.{}_set_{}(&variant).expect(\"Failed to set SDU variant\");\n", field_name, variant_name_snake));
                    code.push_str("                }\n");
                }
                
                code.push_str(&format!("                _ => panic!(\"Invalid SDU tag for {}: {{}}\", tag),\n", field_name));
                code.push_str("            }\n");
                code.push_str("        }\n");
            }
        }

        /* Copy arrays */
        for (array_field, is_byte_array, is_struct_array) in array_fields {
            if *is_byte_array {
                /* Byte arrays have a slice getter and slice setter */
                code.push_str(&format!("        let array_data = original.{}();\n", array_field));
                code.push_str(&format!("        reencoded_mut.set_{}(array_data);\n", array_field));
            } else if *is_struct_array {
                /* Struct arrays need element-by-element copy with reference */
                code.push_str(&format!("        for i in 0..original.{}_len() {{\n", array_field));
                code.push_str(&format!("            reencoded_mut.{}_set(i, &original.{}_get(i));\n", array_field, array_field));
                code.push_str("        }\n");
            } else {
                /* Primitive arrays (non-byte) need element-by-element copy */
                code.push_str(&format!("        for i in 0..original.{}_len() {{\n", array_field));
                code.push_str(&format!("            reencoded_mut.{}_set(i, original.{}_get(i));\n", array_field, array_field));
                code.push_str("        }\n");
            }
        }

        /* Copy nested structs using their getters and setters */
        for (nested_field_name, nested_field_names) in nested_fields {
            code.push_str(&format!("        {{\n"));
            code.push_str(&format!("            let original_nested = original.{}();\n", nested_field_name));
            code.push_str(&format!("            let mut nested_mut = reencoded_mut.{}();\n", nested_field_name));
            /* Copy each field of the nested struct (primitives and arrays) */
            for field_name in nested_field_names {
                /* Try byte array copy first (for u8 arrays), fallback to primitive setter */
                code.push_str(&format!("            /* Copy {} from nested struct */\n", field_name));
                code.push_str(&format!("            let {}_val = original_nested.{}();\n", field_name, field_name));
                /* Generate code that works for both &[u8] arrays and primitive types */
                code.push_str(&format!("            nested_mut.set_{}({}_val);\n", field_name, field_name));
            }
            code.push_str("        }\n");
        }

        code.push_str("    }\n");
    }

    code.push_str("    let reencoded_data = &reencoded_buffer[..reencoded_size];\n");

    code.push_str(
        r#"
    println!("REENCODE:ok");

    /* Stage 5: Binary comparison */
    if &reencoded_data[..] == &original_data[..] {
        println!("BINARY_MATCH:true");
    } else {
        eprintln!("Binary mismatch after decode/reencode round-trip!");
        eprintln!("  Original size: {} bytes", original_data.len());
        eprintln!("  Reencoded size: {} bytes", reencoded_data.len());
        for (i, (orig, copy)) in original_data.iter().zip(reencoded_data.iter()).enumerate() {
            if orig != copy {
                eprintln!("  Byte {}: original=0x{:02x}, reencoded=0x{:02x}", i, orig, copy);
            }
        }
        println!("BINARY_MATCH:false");
        std::process::exit(1);
    }
}
"#,
    );

    code
}
