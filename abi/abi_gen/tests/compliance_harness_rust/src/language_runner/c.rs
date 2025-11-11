use anyhow::Result;
use std::fs;
use std::path::Path;
use std::process::Command;
use std::time::Instant;

use crate::{TestCaseData, TestError, TestResult, TestStages};
use super::LanguageRunner;

use abi_gen::abi::file::AbiFile;
use abi_gen::abi::types::TypeKind;

pub struct CRunner;

impl LanguageRunner for CRunner {
    fn language_name(&self) -> &str {
        "c"
    }

    fn codegen_language_param(&self) -> &str {
        "c"
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
        let temp_dir = temp_base.join(format!("abi_compliance_c_{}", test_name));
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

        /* Stage 1: Generate C code */
        if verbose {
            println!("  [1/5] Generating C code...");
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

        /* Stage 2: Generate and compile C test code */
        if verbose {
            println!("  [2/5] Generating test code and compiling...");
        }

        /* Extract field information for opaque wrapper API */
        let (referenced_primitive_fields, non_referenced_primitive_fields, enum_fields, array_fields, nested_fields, package) = match extract_field_info_opaque(abi_file_path, &test_case.type_name) {
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
                        message: format!("Failed to extract field info from ABI: {}", e),
                        details: None,
                    }),
                });
            }
        };

        /* Write binary data to temp file */
        let binary_file_path = temp_dir.join("test_data.bin");
        fs::write(&binary_file_path, binary_data)?;

        /* Generate C test runner code using opaque wrapper API */
        let test_runner_code = generate_c_test_runner_code_opaque(
            &test_case.type_name,
            &binary_file_path,
            &referenced_primitive_fields,
            &non_referenced_primitive_fields,
            &enum_fields,
            &array_fields,
            &nested_fields,
            &package,
        );

        let test_file_path = temp_dir.join("test.c");
        fs::write(&test_file_path, test_runner_code)?;

        /* Compile test - functions.c is included directly in test code */
        let compile_result = Command::new("gcc")
            .arg("-std=c11")
            .arg(format!("-I{}", generated_code_dir.display()))
            .arg("-o")
            .arg(temp_dir.join("test"))
            .arg(&test_file_path)
            .arg("-lm")
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
                        message: "Test compilation failed".to_string(),
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
                        message: format!("Failed to compile test: {}", e),
                        details: None,
                    }),
                });
            }
        }

        /* Stage 3-5: Run test (decode, validate, reencode) */
        if verbose {
            println!("  [3/5] Running decode-validate-reencode test...");
        }

        let test_binary = temp_dir.join("test");
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

/* Field information for code generation */
#[derive(Debug)]
struct FieldInfo {
    name: String,
    is_array: bool,
    element_type: Option<String>, // For arrays: the C type of elements
}

/* Map ABI primitive type to C type name */
fn primitive_to_c_type(prim: &abi_gen::abi::types::PrimitiveType) -> String {
    use abi_gen::abi::types::{PrimitiveType, IntegralType, FloatingPointType};
    match prim {
        PrimitiveType::Integral(IntegralType::U8) => "uint8_t",
        PrimitiveType::Integral(IntegralType::U16) => "uint16_t",
        PrimitiveType::Integral(IntegralType::U32) => "uint32_t",
        PrimitiveType::Integral(IntegralType::U64) => "uint64_t",
        PrimitiveType::Integral(IntegralType::I8) => "int8_t",
        PrimitiveType::Integral(IntegralType::I16) => "int16_t",
        PrimitiveType::Integral(IntegralType::I32) => "int32_t",
        PrimitiveType::Integral(IntegralType::I64) => "int64_t",
        PrimitiveType::FloatingPoint(FloatingPointType::F16) => "uint16_t", /* No native f16 in C */
        PrimitiveType::FloatingPoint(FloatingPointType::F32) => "float",
        PrimitiveType::FloatingPoint(FloatingPointType::F64) => "double",
    }.to_string()
}

/* Enum variant information */
#[derive(Debug, Clone)]
struct EnumVariantInfo {
    name: String,
    tag_value: u64,
}

/* Enum field information (one per enum field in the struct) */
#[derive(Debug)]
struct EnumFieldInfo {
    field_name: String,          /* Name of the enum field */
    tag_field_name: String,      /* Name of the tag field (e.g., "first_tag") */
    variants: Vec<EnumVariantInfo>, /* All variants for this enum */
}

/* Field classification for test generation */
#[derive(Debug)]
struct FieldClassification {
    settable_fields: Vec<FieldInfo>,   /* Fields with setters */
    init_fields: Vec<FieldInfo>,       /* Fields only settable via init */
    enum_fields: Vec<EnumFieldInfo>,   /* Enum fields (one entry per enum field) */
}

/* Extract field information for opaque wrapper API */
fn extract_field_info_opaque(abi_file_path: &Path, type_name: &str) -> Result<(Vec<String>, Vec<String>, Vec<String>, Vec<(String, bool, bool, Option<String>)>, Vec<(String, String, Vec<String>, u64)>, String)> {
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
                    /* Extract fields from nested struct field expressions */
                    if let TypeKind::Struct(nested_struct) = &field.field_type {
                        for nested_field in &nested_struct.fields {
                            if let TypeKind::Enum(enum_type) = &nested_field.field_type {
                                extract_field_refs_from_expr(&enum_type.tag_ref, &mut referenced_fields);
                            }
                            if let TypeKind::Array(array_type) = &nested_field.field_type {
                                extract_field_refs_from_expr(&array_type.size, &mut referenced_fields);
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

                /* Collect non-referenced primitive fields (both top-level and nested) */
                let mut non_referenced_primitive_fields = Vec::new();
                for f in &struct_type.fields {
                    match &f.field_type {
                        TypeKind::Primitive(_) if !referenced_fields.contains(&f.name) => {
                            non_referenced_primitive_fields.push(f.name.clone());
                        }
                        TypeKind::Struct(nested_struct) => {
                            /* Also collect non-referenced primitives from nested inline structs */
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

                /* Also collect array fields with element type info
                   Format: (field_name, is_byte_array, is_struct_array, element_type_name) */
                let mut array_fields: Vec<(String, bool, bool, Option<String>)> = struct_type.fields.iter()
                    .filter_map(|f| {
                        match &f.field_type {
                            TypeKind::Array(array_type) => {
                                /* Check if element type is u8 (byte array) */
                                let is_byte_array = matches!(&*array_type.element_type, TypeKind::Primitive(prim)
                                    if matches!(prim, abi_gen::abi::types::PrimitiveType::Integral(
                                        abi_gen::abi::types::IntegralType::U8)));
                                /* Check if element type is a struct (TypeRef) and get its name */
                                let (is_struct_array, elem_type_name) = if let TypeKind::TypeRef(type_ref) = &*array_type.element_type {
                                    (true, Some(type_ref.name.clone()))
                                } else {
                                    (false, None)
                                };
                                Some((f.name.clone(), is_byte_array, is_struct_array, elem_type_name))
                            },
                            _ => None,
                        }
                    })
                    .collect();

                /* Also extract arrays from nested inline structs - they are accessed via parent methods like parent_nested_array_at() */
                for field in &struct_type.fields {
                    if let TypeKind::Struct(nested_struct) = &field.field_type {
                        for nested_field in &nested_struct.fields {
                            if let TypeKind::Array(array_type) = &nested_field.field_type {
                                /* Check if element type is u8 (byte array) */
                                let is_byte_array = matches!(&*array_type.element_type, TypeKind::Primitive(prim)
                                    if matches!(prim, abi_gen::abi::types::PrimitiveType::Integral(
                                        abi_gen::abi::types::IntegralType::U8)));
                                /* Check if element type is a struct (TypeRef) and get its name */
                                let (is_struct_array, elem_type_name) = if let TypeKind::TypeRef(type_ref) = &*array_type.element_type {
                                    (true, Some(type_ref.name.clone()))
                                } else {
                                    (false, None)
                                };
                                /* Use nested field name format: "parent_child" */
                                let nested_field_name = format!("{}_{}", field.name, nested_field.name);
                                array_fields.push((nested_field_name, is_byte_array, is_struct_array, elem_type_name));
                            }
                        }
                    }
                }

                /* Extract nested struct fields (TypeRef) with their field names and sizes
                   Format: (field_name, nested_type_name, vec_of_nested_field_names, size_in_bytes) */
                let nested_fields: Vec<(String, String, Vec<String>, u64)> = struct_type.fields.iter()
                    .filter_map(|f| {
                        match &f.field_type {
                            TypeKind::TypeRef(type_ref) => {
                                /* Look up the nested struct type and get its primitive fields + calculate size */
                                let nested_type_name = &type_ref.name;
                                let (nested_field_names, size) = abi.get_types().iter()
                                    .find(|t| &t.name == nested_type_name)
                                    .and_then(|t| {
                                        if let TypeKind::Struct(nested_struct) = &t.kind {
                                            let mut total_size = 0u64;
                                            let field_names: Vec<String> = nested_struct.fields.iter()
                                                .filter_map(|nf| {
                                                    match &nf.field_type {
                                                        TypeKind::Primitive(prim_type) => {
                                                            /* Add primitive size */
                                                            use abi_gen::abi::types::{IntegralType, FloatingPointType};
                                                            let field_size = match prim_type {
                                                                abi_gen::abi::types::PrimitiveType::Integral(int_type) => match int_type {
                                                                    IntegralType::U8 | IntegralType::I8 => 1,
                                                                    IntegralType::U16 | IntegralType::I16 => 2,
                                                                    IntegralType::U32 | IntegralType::I32 => 4,
                                                                    IntegralType::U64 | IntegralType::I64 => 8,
                                                                },
                                                                abi_gen::abi::types::PrimitiveType::FloatingPoint(float_type) => match float_type {
                                                                    FloatingPointType::F16 => 2,
                                                                    FloatingPointType::F32 => 4,
                                                                    FloatingPointType::F64 => 8,
                                                                },
                                                            };
                                                            total_size += field_size;
                                                            Some(nf.name.clone())
                                                        },
                                                        _ => {
                                                            /* For now, skip non-primitive fields in nested structs */
                                                            None
                                                        }
                                                    }
                                                })
                                                .collect();
                                            Some((field_names, total_size))
                                        } else {
                                            None
                                        }
                                    })
                                    .unwrap_or((Vec::new(), 0));
                                Some((f.name.clone(), nested_type_name.clone(), nested_field_names, size))
                            },
                            _ => None,
                        }
                    })
                    .collect();

                return Ok((referenced_primitive_fields, non_referenced_primitive_fields, enum_fields, array_fields, nested_fields, package));
            }
        }
    }

    anyhow::bail!("Type '{}' not found in ABI file", type_name)
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

/* OLD: Extract field classification and package from ABI file for a specific type */
fn extract_field_info(abi_file_path: &Path, type_name: &str) -> Result<(FieldClassification, String)> {
    use abi_gen::abi::expr::ExprKind;

    let abi_content = fs::read_to_string(abi_file_path)?;
    let abi: AbiFile = serde_yaml::from_str(&abi_content)?;

    let package = abi.package().to_string();

    for typedef in abi.get_types() {
        if typedef.name == type_name {
            if let TypeKind::Struct(struct_type) = &typedef.kind {
                let mut settable_fields = Vec::new();
                let mut init_fields = Vec::new();
                let mut enum_fields = Vec::new();

                /* Collect tag field references and enum field information */
                let mut tag_fields = std::collections::HashSet::new();
                for field in &struct_type.fields {
                    if let TypeKind::Enum(enum_type) = &field.field_type {
                        /* Collect enum variants for this enum field */
                        let mut variants = Vec::new();
                        for variant in &enum_type.variants {
                            variants.push(EnumVariantInfo {
                                name: variant.name.clone(),
                                tag_value: variant.tag_value,
                            });
                        }

                        /* Get tag field name */
                        let tag_field_name = if let ExprKind::FieldRef(field_ref) = &enum_type.tag_ref {
                            if let Some(tag_name) = field_ref.path.first() {
                                tag_fields.insert(tag_name.clone());
                                tag_name.clone()
                            } else {
                                "tag".to_string()
                            }
                        } else {
                            "tag".to_string()
                        };

                        enum_fields.push(EnumFieldInfo {
                            field_name: field.name.clone(),
                            tag_field_name,
                            variants,
                        });
                    }
                }

                /* Classify each field */
                for f in &struct_type.fields {
                    /* Skip enum fields - they're not regular fields */
                    if matches!(&f.field_type, TypeKind::Enum(_)) {
                        continue;
                    }

                    let field_info = match &f.field_type {
                        TypeKind::Array(array_type) => {
                            let elem_type = match &*array_type.element_type {
                                TypeKind::Primitive(prim) => Some(primitive_to_c_type(prim)),
                                _ => None,
                            };
                            FieldInfo {
                                name: f.name.clone(),
                                is_array: true,
                                element_type: elem_type,
                            }
                        }
                        _ => FieldInfo {
                            name: f.name.clone(),
                            is_array: false,
                            element_type: None,
                        }
                    };

                    /* Classify: fields referenced as tags go to init_fields, others to settable_fields */
                    if tag_fields.contains(&f.name) {
                        init_fields.push(field_info);
                    } else {
                        settable_fields.push(field_info);
                    }
                }

                let classification = FieldClassification {
                    settable_fields,
                    init_fields,
                    enum_fields,
                };

                return Ok((classification, package));
            }
        }
    }

    anyhow::bail!("Type '{}' not found in ABI file", type_name)
}

/* Generate C test runner code that performs decode-validate-reencode */
fn generate_c_test_runner_code(
    type_name: &str,
    binary_file_path: &Path,
    classification: &FieldClassification,
    package: &str,
) -> String {
    let mut code = String::new();

    let package_path = package.replace('.', "/");

    code.push_str(&format!(
        r#"#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "generated_code/{}/types.h"

int main( void ) {{
  /* Stage 1: Load binary */
  FILE *f = fopen( "{}", "rb" );
  if ( !f ) {{
    fprintf( stderr, "Failed to open binary file\n" );
    printf( "DECODE:error\n" );
    return 1;
  }}

  fseek( f, 0, SEEK_END );
  long file_size = ftell( f );
  fseek( f, 0, SEEK_SET );

  unsigned char *original_buffer = malloc( file_size );
  if ( !original_buffer ) {{
    fprintf( stderr, "Failed to allocate buffer\n" );
    fclose( f );
    printf( "DECODE:error\n" );
    return 1;
  }}

  fread( original_buffer, 1, file_size, f );
  fclose( f );

  /* Stage 2: Decode */
  {}_t *original = ({}_t *)original_buffer;
  printf( "DECODE:ok\n" );

  /* Stage 3: Validate using generated validate function */
  uint64_t bytes_consumed = 0;
  int validate_result = {}_validate( original_buffer, file_size, &bytes_consumed );

  if ( validate_result != 0 ) {{
    fprintf( stderr, "Validation failed with code %d\n", validate_result );
    printf( "VALIDATION:error\n" );
    free( original_buffer );
    return 1;
  }}

  printf( "VALIDATION:ok\n" );

  /* Stage 4: Get size */
  uint64_t struct_size = {}_size( original );

  /* Stage 5: Create new instance */
  unsigned char *new_buffer = malloc( struct_size );
  if ( !new_buffer ) {{
    fprintf( stderr, "Failed to allocate new buffer\n" );
    free( original_buffer );
    printf( "REENCODE:error\n" );
    return 1;
  }}

  memset( new_buffer, 0, struct_size );
"#,
        package_path,
        binary_file_path.display(),
        type_name,
        type_name,
        type_name,
        type_name,
    ));

    /* Initialize using init() if there are init fields, otherwise just cast */
    if !classification.init_fields.is_empty() {
        /* Call init with values from original */
        code.push_str(&format!("  int init_result = {}_init( new_buffer, struct_size", type_name));
        for field_info in &classification.init_fields {
            code.push_str(&format!(", {}_get_{}( original )", type_name, field_info.name));
        }
        code.push_str(" );\n");
        code.push_str("  if ( init_result != 0 ) {\n");
        code.push_str("    fprintf( stderr, \"Init failed with code %d\\n\", init_result );\n");
        code.push_str("    printf( \"REENCODE:error\\n\" );\n");
        code.push_str("    free( original_buffer );\n");
        code.push_str("    free( new_buffer );\n");
        code.push_str("    return 1;\n");
        code.push_str("  }\n");
    }

    code.push_str(&format!("  {}_t *copy = ({}_t *)new_buffer;\n\n", type_name, type_name));

    /* Generate field copying code for settable fields */
    if !classification.settable_fields.is_empty() {
        code.push_str("  /* Copy settable fields using getters and setters */\n");
        for field_info in &classification.settable_fields {
            if field_info.is_array {
                /* For arrays: use memcpy with getters and size function */
                let default_type = "unsigned char".to_string();
                let element_type = field_info.element_type.as_ref().unwrap_or(&default_type);
                code.push_str(&format!(
                    "  memcpy( {}_get_{}( copy ), {}_get_{}_const( original ), {}_get_{}_size( original ) * sizeof( {} ) );\n",
                    type_name, field_info.name,
                    type_name, field_info.name,
                    type_name, field_info.name,
                    element_type
                ));
            } else {
                /* For non-arrays: use setter/getter pairs */
                code.push_str(&format!(
                    "  {}_set_{}( copy, {}_get_{}( original ) );\n",
                    type_name, field_info.name, type_name, field_info.name
                ));
            }
        }
    }

    /* For enums, use variant-specific setters based on tag - one switch per enum field */
    if !classification.enum_fields.is_empty() {
        code.push_str("\n  /* Copy enum variant data using variant setters */\n");

        for enum_field in &classification.enum_fields {
            code.push_str(&format!("  /* Enum field: {} (tag: {}) */\n", enum_field.field_name, enum_field.tag_field_name));
            code.push_str(&format!("  uint8_t {} = {}_get_{}( original );\n",
                enum_field.tag_field_name, type_name, enum_field.tag_field_name));
            code.push_str(&format!("  switch ( {} ) {{\n", enum_field.tag_field_name));

            for variant in &enum_field.variants {
                code.push_str(&format!("    case {}: /* {} */\n", variant.tag_value, variant.name));
                code.push_str(&format!(
                    "      {}_{}_set_{}( copy, {}_{}_get_{}_const( original ) );\n",
                    type_name, enum_field.field_name, variant.name, type_name, enum_field.field_name, variant.name
                ));
                code.push_str("      break;\n");
            }

            code.push_str("    default:\n");
            code.push_str(&format!("      fprintf( stderr, \"Invalid enum tag value for {}: %d\\n\", {} );\n",
                enum_field.field_name, enum_field.tag_field_name));
            code.push_str("      break;\n");
            code.push_str("  }\n");
        }
    }

    code.push_str(
        r#"
  printf( "REENCODE:ok\n" );

  /* Stage 6: Binary comparison via memcmp */
  int cmp_result = memcmp( original_buffer, new_buffer, struct_size );

  if ( cmp_result == 0 ) {
    printf( "BINARY_MATCH:true\n" );
  } else {
    fprintf( stderr, "Binary mismatch after getter/setter round-trip\n" );
    printf( "BINARY_MATCH:false\n" );
    free( original_buffer );
    free( new_buffer );
    return 1;
  }

  free( original_buffer );
  free( new_buffer );
  return 0;
}
"#,
    );

    code
}

/* Generate test runner code for opaque wrapper API */
fn generate_c_test_runner_code_opaque(
    type_name: &str,
    binary_file_path: &Path,
    referenced_primitive_fields: &[String],
    non_referenced_primitive_fields: &[String],
    enum_fields: &[String],
    array_fields: &[(String, bool, bool, Option<String>)],  /* (field_name, is_byte_array, is_struct_array, element_type_name) */
    nested_fields: &[(String, String, Vec<String>, u64)],  /* (field_name, nested_type_name, nested_struct_field_names, size) */
    package: &str,
) -> String {
    let mut code = String::new();

    let package_path = package.replace('.', "/");

    code.push_str(&format!(
        r#"#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "generated_code/{}/types.h"
#include "generated_code/{}/functions.c"

int main( void ) {{
  /* Stage 1: Load binary */
  FILE *f = fopen( "{}", "rb" );
  if ( !f ) {{
    fprintf( stderr, "Failed to open binary file\n" );
    printf( "DECODE:error\n" );
    return 1;
  }}

  fseek( f, 0, SEEK_END );
  long file_size = ftell( f );
  fseek( f, 0, SEEK_SET );

  unsigned char *original_data = malloc( file_size );
  if ( !original_data ) {{
    fprintf( stderr, "Failed to allocate buffer\n" );
    fclose( f );
    printf( "DECODE:error\n" );
    return 1;
  }}

  fread( original_data, 1, file_size, f );
  fclose( f );

  /* Stage 2: Decode using from_slice() - opaque wrapper */
  {}_t const * original = {}_from_slice( original_data, file_size );
  if ( original == NULL ) {{
    fprintf( stderr, "from_slice validation failed\n" );
    printf( "DECODE:error\n" );
    free( original_data );
    return 1;
  }}

  printf( "DECODE:ok\n" );

  /* Stage 3: Validate - validation happens in from_slice() */
  printf( "VALIDATION:ok\n" );

  /* Stage 4: Reencode using new() constructor with getters */
  /* Allocate buffer for reencoding - use same size as original */
  unsigned char *reencoded_data = malloc( file_size );
  if ( !reencoded_data ) {{
    fprintf( stderr, "Failed to allocate reencode buffer\n" );
    printf( "REENCODE:error\n" );
    free( original_data );
    return 1;
  }}

  uint64_t reencoded_size;
"#,
        package_path,
        package_path,
        binary_file_path.display(),
        type_name,
        type_name,
    ));

    if referenced_primitive_fields.is_empty() {
        /* No referenced fields - just create empty instance */
        code.push_str(&format!(
            "  int new_result = {}_new( reencoded_data, file_size, &reencoded_size );\n",
            type_name
        ));
    } else {
        /* Has referenced fields - pass them to new() constructor */
        code.push_str(&format!("  int new_result = {}_new( reencoded_data, file_size,\n", type_name));

        /* Generate getter calls for referenced primitive fields only */
        for (idx, field_name) in referenced_primitive_fields.iter().enumerate() {
            if idx > 0 {
                code.push_str(",\n");
            }
            code.push_str(&format!("    {}_get_{}( original )", type_name, field_name));
        }
        code.push_str(",\n    &reencoded_size );\n");
    }

    code.push_str(
        r#"
  if ( new_result != 0 ) {{
    fprintf( stderr, "new() failed with code %d\n", new_result );
    printf( "REENCODE:error\n" );
    free( original_data );
    free( reencoded_data );
    return 1;
  }}
"#,
    );

    /* Set non-referenced primitive fields via setters */
    if !non_referenced_primitive_fields.is_empty() {
        code.push_str("\n  /* Set non-referenced primitive fields via setters */\n");
        for field_name in non_referenced_primitive_fields {
            code.push_str(&format!("  {}_set_{}( reencoded_data, {}_get_{}( original ) );\n",
                type_name, field_name, type_name, field_name));
        }
    }

    /* Set enum fields via body setters (Layer 1 API) */
    if !enum_fields.is_empty() {
        code.push_str("\n  /* Set enum fields via body setters (Layer 1 API) */\n");
        for field_name in enum_fields {
            code.push_str(&format!("  {{\n"));
            code.push_str(&format!("    uint8_t const * body = {}_get_{}_body( original );\n",
                                 type_name, field_name));
            code.push_str(&format!("    uint64_t body_len = {}_get_{}_size( original );\n",
                                 type_name, field_name));
            code.push_str(&format!("    if ( {}_set_{}_body( reencoded_data, body, body_len ) != 0 ) {{\n",
                                 type_name, field_name));
            code.push_str("      fprintf( stderr, \"Failed to set enum body\\n\" );\n");
            code.push_str("      printf( \"REENCODE:error\\n\" );\n");
            code.push_str("      free( original_data );\n");
            code.push_str("      free( reencoded_data );\n");
            code.push_str("      return 1;\n");
            code.push_str("    }\n");
            code.push_str("  }\n");
        }
    }

    /* Copy nested struct fields */
    if !nested_fields.is_empty() {
        code.push_str("\n  /* Copy nested struct fields */\n");
        for (field_name, nested_type_name, _nested_field_names, _size) in nested_fields {
            code.push_str(&format!("  {{\n"));
            code.push_str(&format!("    /* Get nested struct wrapper from original */\n"));
            code.push_str(&format!("    {}_t const * nested = {}_get_{}_const( original );\n",
                                 nested_type_name, type_name, field_name));
            code.push_str(&format!("    /* Copy nested struct to reencoded data */\n"));
            code.push_str(&format!("    if ( {}_set_{}( reencoded_data, nested ) != 0 ) {{\n",
                                 type_name, field_name));
            code.push_str("      fprintf( stderr, \"Failed to set nested struct\\n\" );\n");
            code.push_str("      printf( \"REENCODE:error\\n\" );\n");
            code.push_str("      free( original_data );\n");
            code.push_str("      free( reencoded_data );\n");
            code.push_str("      return 1;\n");
            code.push_str("    }\n");
            code.push_str("  }\n");
        }
    }

    /* Copy array data if there are any array fields */
    if !array_fields.is_empty() {
        code.push_str("\n  /* Copy array data using setters */\n");

        for (array_field, _is_byte_array, is_struct_array, elem_type_name) in array_fields {
            /* Get array length and copy element by element */
            code.push_str(&format!("  {{\n"));
            code.push_str(&format!("    uint64_t array_len = {}_get_{}_length( original );\n", type_name, array_field));
            code.push_str(&format!("    for ( uint64_t i = 0; i < array_len; i++ ) {{\n"));
            if *is_struct_array {
                /* For struct arrays, getter returns const pointer, setter expects const pointer */
                let elem_type = elem_type_name.as_ref().unwrap();
                code.push_str(&format!("      {}_t const * elem = {}_get_{}_at( original, i );\n",
                                     elem_type, type_name, array_field));
                code.push_str(&format!("      {}_set_{}_at( reencoded_data, i, elem );\n",
                                     type_name, array_field));
            } else {
                /* For primitive arrays, pass value directly */
                code.push_str(&format!("      {}_set_{}_at( reencoded_data, i, {}_get_{}_at( original, i ) );\n",
                                     type_name, array_field, type_name, array_field));
            }
            code.push_str("    }\n");
            code.push_str("  }\n");
        }

        code.push_str("\n");
    }

    code.push_str("  printf( \"REENCODE:ok\\n\" );\n");
    code.push_str(
        r#"

  /* Stage 5: Binary comparison */
  if ( file_size != reencoded_size ) {
    fprintf( stderr, "Binary size mismatch after decode/reencode round-trip!\n" );
    fprintf( stderr, "  Original size: %ld bytes\n", file_size );
    fprintf( stderr, "  Reencoded size: %lu bytes\n", reencoded_size );
    printf( "BINARY_MATCH:false\n" );
    free( original_data );
    free( reencoded_data );
    return 1;
  }

  int cmp_result = memcmp( original_data, reencoded_data, file_size );
  if ( cmp_result == 0 ) {
    printf( "BINARY_MATCH:true\n" );
  } else {
    fprintf( stderr, "Binary mismatch after decode/reencode round-trip!\n" );
    printf( "BINARY_MATCH:false\n" );
    free( original_data );
    free( reencoded_data );
    return 1;
  }

  free( original_data );
  free( reencoded_data );
  return 0;
}
"#,
    );

    code
}
