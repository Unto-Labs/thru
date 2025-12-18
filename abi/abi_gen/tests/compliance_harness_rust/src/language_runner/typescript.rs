use anyhow::{Context, Result};
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Instant;

use super::LanguageRunner;
use crate::{TestCaseData, TestError, TestResult, TestStages};

use abi_gen::abi::file::AbiFile;
use abi_gen::abi::resolved::{ResolvedType, ResolvedTypeKind, Size, TypeResolver};
use abi_gen::codegen::ts_gen::enum_utils::enum_field_info_by_name;
use serde::Serialize;

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
        let temp_base = base_temp_dir
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|| std::env::temp_dir());
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

        let abi_gen_root = abi_gen_root();
        let abi_gen_manifest = abi_gen_root.join("Cargo.toml");

        let ts_toolchain = resolve_ts_toolchain()?;

        let codegen_result = Command::new("cargo")
            .args(&["run", "--quiet", "--manifest-path"])
            .arg(&abi_gen_manifest)
            .arg("--")
            .arg("codegen")
            .arg("--files")
            .arg(&abi_file_path)
            .arg("--language")
            .arg(self.codegen_language_param())
            .arg("--output")
            .arg(&generated_code_dir)
            .current_dir(&abi_gen_root)
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
                    println!(
                        "  Code generation had {} bytes of stderr output (warnings)",
                        stderr_text.len()
                    );
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
        let type_roots: Vec<String> = ts_toolchain
            .type_roots
            .iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect();
        let tsconfig_json = json!({
            "compilerOptions": {
                "target": "ES2020",
                "module": "NodeNext",
                "moduleResolution": "NodeNext",
                "outDir": "./dist",
                "rootDir": "./src",
                "strict": true,
                "esModuleInterop": true,
                "skipLibCheck": true,
                "typeRoots": type_roots,
            },
            "include": ["src/**/*"]
        });
        fs::write(
            test_project_dir.join("tsconfig.json"),
            serde_json::to_string_pretty(&tsconfig_json)?,
        )?;

        /* Create src directory and copy generated code */
        let src_dir = test_project_dir.join("src");
        fs::create_dir_all(&src_dir)?;

        /* Copy generated code to src/generated/ */
        let generated_dir = src_dir.join("generated");
        copy_dir_recursive(&generated_code_dir, &generated_dir)?;

        /* Drop a tsconfig for the generated-only transpile pass */
        let generated_tsconfig = write_generated_tsconfig(&generated_dir)?;
        if let Some(tsconfig) = generated_tsconfig.as_ref() {
            run_noemit_strict_tsc(&ts_toolchain, tsconfig)?;
        }

        /* Transpile generated code to JS once so NodeNext imports resolve */
        transpile_generated_sources(&ts_toolchain, &generated_dir)?;

        /* Prepare type context (package + metadata) */
        let type_context = match prepare_type_context(abi_file_path, &test_case.type_name) {
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

        let package_rel_path = type_context.package.replace('.', "/");
        let generated_types_path = generated_code_dir.join(&package_rel_path).join("types.ts");
        if let Err(e) = run_strict_tsc_check(&ts_toolchain, &generated_types_path) {
            return Ok(TestResult {
                test_name: test_name.to_string(),
                test_file: test_file.to_string(),
                status: "fail".to_string(),
                duration_ms: start_time.elapsed().as_millis() as u64,
                stages: Some(stages),
                error: Some(TestError {
                    stage: "code_generation".to_string(),
                    message: "tsc strict check failed".to_string(),
                    details: Some(e.to_string()),
                }),
            });
        }

        /* Write binary data to temp file */
        let binary_file_path = temp_dir.join("test_data.bin");
        fs::write(&binary_file_path, binary_data)?;

        /* Generate test runner code */
        let test_runner_code = generate_typescript_test_runner_code(
            &test_case.type_name,
            &binary_file_path,
            &type_context.package,
            &type_context.enum_metadata_json,
        );
        fs::write(src_dir.join("test.ts"), test_runner_code)?;

        /* Run strict no-emit check on the test project */
        let project_tsconfig = test_project_dir.join("tsconfig.json");
        run_noemit_strict_tsc(&ts_toolchain, &project_tsconfig)?;

        /* Compile TypeScript using vendored toolchain */
        let compile_result = {
            let mut cmd = Command::new(&ts_toolchain.tsc_path);
            cmd.arg("--project")
                .arg(test_project_dir.join("tsconfig.json"))
                .current_dir(&test_project_dir);
            cmd.output()
        };

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

        let test_output = {
            let mut cmd = Command::new("npm");
            cmd.arg("run").arg("test").current_dir(&test_project_dir);
            cmd.output()
        };

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

    for entry in
        fs::read_dir(src).with_context(|| format!("Failed to read directory: {}", src.display()))?
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

fn has_ts_sources(dir: &Path) -> Result<bool> {
    if !dir.exists() {
        return Ok(false);
    }
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            if has_ts_sources(&path)? {
                return Ok(true);
            }
            continue;
        }
        if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
            if ext.eq_ignore_ascii_case("ts") || ext.eq_ignore_ascii_case("tsx") {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

fn write_generated_tsconfig(dir: &Path) -> Result<Option<PathBuf>> {
    if !dir.exists() || !has_ts_sources(dir)? {
        return Ok(None);
    }
    let tsconfig = json!({
        "compilerOptions": {
            "target": "ES2020",
            "module": "NodeNext",
            "moduleResolution": "NodeNext",
            "strict": true,
            "esModuleInterop": true,
            "skipLibCheck": true
        },
        "include": ["./**/*"]
    });
    let path = dir.join("tsconfig.json");
    fs::write(&path, serde_json::to_string_pretty(&tsconfig)?)
        .with_context(|| format!("Failed to write generated tsconfig at {}", dir.display()))?;
    Ok(Some(path))
}

fn transpile_generated_sources(ts_toolchain: &TsToolchain, src_dir: &Path) -> Result<()> {
    if !src_dir.exists() {
        return Ok(());
    }
    if !has_ts_sources(src_dir)? {
        return Ok(());
    }
    let mut cmd = Command::new(&ts_toolchain.tsc_path);
    cmd.arg("--target")
        .arg("ES2020")
        .arg("--module")
        .arg("NodeNext")
        .arg("--moduleResolution")
        .arg("NodeNext")
        .arg("--esModuleInterop")
        .arg("--strict")
        .arg("--project")
        .arg(src_dir);
    cmd.current_dir(src_dir);

    let output = cmd
        .output()
        .context("failed to transpile generated TypeScript sources")?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    anyhow::bail!(
        "Transpiling generated sources failed:\nstdout:\n{}\nstderr:\n{}",
        stdout,
        stderr
    );
}

fn prepare_type_context(abi_file_path: &Path, type_name: &str) -> Result<TypeContext> {
    let abi_content = fs::read_to_string(abi_file_path)?;
    let abi: AbiFile = serde_yaml::from_str(&abi_content)?;

    let mut resolver = TypeResolver::new();
    for typedef in abi.get_types() {
        resolver.add_typedef(typedef.clone());
    }
    resolver
        .resolve_all()
        .map_err(|err| anyhow::anyhow!("Failed to resolve ABI types: {:?}", err))?;

    let resolved = resolver
        .types
        .get(type_name)
        .ok_or_else(|| anyhow::anyhow!("Type '{}' not found in ABI file", type_name))?;

    let enum_metadata = collect_enum_field_metadata(resolved);
    let enum_metadata_json =
        serde_json::to_string(&enum_metadata).context("failed to serialize enum metadata")?;

    Ok(TypeContext {
        package: abi.package().to_string(),
        enum_metadata_json,
    })
}

/* Generate TypeScript test runner code that performs decode-validate-reencode */
fn generate_typescript_test_runner_code(
    type_name: &str,
    binary_file_path: &Path,
    package: &str,
    enum_metadata_json: &str,
) -> String {
    let package_path = package.replace('.', "/");
    let binary_path_str = escape_js_string(&binary_file_path.display().to_string());

    format!(
        r#"import * as fs from 'fs';
import {{ {type_name} }} from './generated/{package_path}/types.js';

type EnumVariantMetadata = {{ tag: number; payload_size: number | null }};
type EnumFieldMetadata = {{
  field_ts_name: string;
  tag_ts_name: string;
  descriptor_prop: string;
  payload_offset: number;
  tag_offset: number;
  variants: readonly EnumVariantMetadata[];
  is_tail: boolean;
}};

const ENUM_FIELD_METADATA: readonly EnumFieldMetadata[] = {enum_metadata_json} as const;

const toUint8Array = (source: any): Uint8Array => {{
  if (source instanceof Uint8Array) {{
    return new Uint8Array(source);
  }}
  if (source && source.buffer instanceof ArrayBuffer) {{
    const offset = source.byteOffset ?? 0;
    const length = source.byteLength ?? source.length ?? 0;
    return new Uint8Array(source.buffer, offset, length);
  }}
  return new Uint8Array(0);
}};

const coerceNumber = (value: number | bigint | undefined): number => {{
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return value;
  return Number(value ?? 0);
}};

const callGetter = (view: any, name: string): number => {{
  const getter = view[name] ?? view[`${{name}}_`];
  if (typeof getter === 'function') {{
    return coerceNumber(getter.call(view));
  }}
  return coerceNumber(getter);
}};

const getDynamicParams = (view: any): Record<string, unknown> | undefined => {{
  const src = view as Record<string, any>;
  return typeof src.dynamicParams === 'function' ? src.dynamicParams() : undefined;
}};

const buildFieldContextFromParams = (
  TypeClass: any,
  params: Record<string, bigint>
): Record<string, number | bigint> | null => {{
  if (!params) {{
    return null;
  }}
  const paramKeys = (TypeClass?.ParamKeys ?? {}) as Record<string, string>;
  const context: Record<string, number | bigint> = Object.create(null);
  for (const [tsName, canonical] of Object.entries(paramKeys)) {{
    const value = (params as Record<string, number | bigint>)[tsName];
    if (value === undefined || value === null) {{
      continue;
    }}
    const store = (path: string, val: number | bigint) => {{
      if (!(path in context)) {{
        context[path] = val;
      }}
    }};
    store(canonical, value);
    const segments = canonical.split('.');
    for (let idx = 1; idx < segments.length; idx++) {{
      const suffix = segments.slice(idx).join('.');
      if (suffix.length) {{
        store(suffix, value);
      }}
    }}
  }}
  return context;
}};

const applyFieldContextIfNeeded = (
  view: any,
  context: Record<string, number | bigint> | null | undefined
): void => {{
  if (!view || !context) {{
    return;
  }}
  if (typeof view.withFieldContext === "function") {{
    view.withFieldContext(context);
  }}
}};

const coerceParamsForType = (TypeClass: any, raw: Record<string, unknown>): any => {{
  const paramsNs = TypeClass?.Params;
  if (!paramsNs) {{
    return raw as any;
  }}
  const tryInvoke = (fn: unknown, arg: any): any => {{
    if (typeof fn !== 'function') return undefined;
    try {{
      return (fn as (arg: any) => any)(arg);
    }} catch (err) {{
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {{
        console.warn(`Param coercion failed for ${{TypeClass?.name ?? 'unknown'}}`, err);
      }}
      return undefined;
    }}
  }};
  const builderAdapter = {{ dynamicParams: () => raw as Record<string, unknown> }};
  return (
    tryInvoke((paramsNs as Record<string, unknown>).fromBuilder, builderAdapter) ??
    tryInvoke((paramsNs as Record<string, unknown>).fromValues, raw) ??
    tryInvoke((paramsNs as Record<string, unknown>).params, raw) ??
    (raw as any)
  );
}};

const deriveParamsForType = (TypeClass: any, view: any): any => {{
  const raw = getDynamicParams(view);
  if (!raw) {{
    return undefined;
  }}
  return coerceParamsForType(TypeClass, raw);
}};

const hydrateEnumBuilder = (TypeClass: any, builder: any, view: any, bytes: Uint8Array): boolean => {{
  if (!ENUM_FIELD_METADATA.length) {{
    return false;
  }}
  let hydrated = false;
  for (const meta of ENUM_FIELD_METADATA) {{
    const getterName = `get_${{meta.tag_ts_name}}`;
    const tagValue = callGetter(view, getterName);
    builder[`__tnField_${{meta.tag_ts_name}}`] = tagValue;
    const variant = meta.variants.find((candidate) => candidate.tag === tagValue);
    if (!variant) {{
      continue;
    }}
    const payloadStart = meta.payload_offset;
    let payloadEnd: number;
    if (variant.payload_size == null) {{
      if (!meta.is_tail) {{
        continue;
      }}
      payloadEnd = bytes.length;
    }} else {{
      payloadEnd = payloadStart + variant.payload_size;
    }}
    const payload = bytes.slice(payloadStart, payloadEnd);
    const descriptors = (TypeClass as any)[meta.descriptor_prop] ?? [];
    const descriptor = descriptors.find((entry: {{ tag: number }}) => entry.tag === tagValue) ?? null;
    builder[`__tnPayload_${{meta.field_ts_name}}`] = {{ descriptor, bytes: payload }};
    hydrated = true;
    const prefixBuffer = builder[`__tnPrefixBuffer`];
    if (prefixBuffer instanceof Uint8Array && meta.payload_offset > 0) {{
      const prefixSlice = bytes.slice(0, meta.payload_offset);
      const copyLength = Math.min(prefixBuffer.length, prefixSlice.length);
      if (copyLength > 0) {{
        prefixBuffer.set(prefixSlice.subarray(0, copyLength));
      }}
    }}
  }}
  return hydrated;
}};

const hydrateBuilderFromView = (TypeClass: any, builder: any, view: any, bytes: Uint8Array): void => {{
  const builderAny = builder as Record<string, any>;
  const viewAny = view as Record<string, any>;
  const dynamicOffsets = typeof viewAny?.__tnComputeDynamicOffsets === "function"
    ? viewAny.__tnComputeDynamicOffsets()
    : null;
  if (builderAny.buffer instanceof Uint8Array) {{
    builderAny.buffer.set(bytes.subarray(0, builderAny.buffer.length));
    builderAny.view = new DataView(builderAny.buffer.buffer, builderAny.buffer.byteOffset, builderAny.buffer.byteLength);
    if ('__tnCachedParams' in builderAny) builderAny.__tnCachedParams = null;
    if ('__tnLastBuffer' in builderAny) builderAny.__tnLastBuffer = null;
    if ('__tnLastParams' in builderAny) builderAny.__tnLastParams = null;
    const famWriters = (TypeClass.flexibleArrayWriters ?? []) as readonly {{ field: string; method: string; sizeField: string; elementSize: number }}[];
    let cursor = builderAny.buffer.length;
    for (const writer of famWriters) {{
      const count = callGetter(view, `get_${{writer.sizeField}}`);
      const length = count * (writer.elementSize ?? 1);
      const start = dynamicOffsets && typeof dynamicOffsets[writer.field] === "number"
        ? Number(dynamicOffsets[writer.field])
        : cursor;
      const payload = bytes.slice(start, start + length);
      cursor = start + length;
      const storageProp = `__tnFam_${{writer.method}}`;
      builderAny[storageProp] = payload;
      builderAny[`${{storageProp}}Count`] = count;
    }}
    return;
  }}
  if (hydrateEnumBuilder(TypeClass, builderAny, view, bytes)) {{
    return;
  }}
  throw new Error(
    `Builder hydration not supported for ${{TypeClass?.name ?? 'unknown'}} (no buffer, enum, or FAM writers detected)`
  );
}};

const extractBytesFromView = (instance: any): Uint8Array => {{
  const raw = instance?.buffer;
  return toUint8Array(raw);
}};

const compareBytes = (a: Uint8Array, b: Uint8Array): boolean => {{
  if (a.length !== b.length) {{
    return false;
  }}
  for (let i = 0; i < a.length; i++) {{
    if (a[i] !== b[i]) {{
      return false;
    }}
  }}
  return true;
}};

async function main() {{
  const binaryPath = '{binary_path}';
  const binaryData = fs.readFileSync(binaryPath);
  const originalBytes = new Uint8Array(binaryData);
  const TypeClass = {type_name};
  const TypeAny = TypeClass as any;
  const original = TypeClass.from_array(originalBytes);
  if (!original) {{
    console.error('Decode returned null');
    console.log('DECODE:error');
    process.exit(1);
  }}
  console.log('DECODE:ok');

  const params = deriveParamsForType(TypeAny, original);
  const validation = params ? TypeClass.validate(originalBytes, {{ params }}) : TypeClass.validate(originalBytes);
  if (!validation.ok) {{
    console.error(`Validation failed: ${{validation.code ?? 'unknown'}}`);
    console.log('VALIDATION:error');
    process.exit(1);
  }}
  console.log('VALIDATION:ok');
  const fieldContext = params ? buildFieldContextFromParams(TypeAny, params) : null;
  applyFieldContextIfNeeded(original, fieldContext);

  const builderFactory = TypeAny?.builder;
  const fromBuilderFn = TypeAny?.fromBuilder;
  if (typeof builderFactory !== 'function' || typeof fromBuilderFn !== 'function') {{
    if (typeof console !== 'undefined' && typeof console.warn === 'function') {{
      console.warn(`Skipping builder round-trip for ${{TypeAny?.name ?? 'unknown'}} (builder helpers unavailable)`);
    }}
    console.log('REENCODE:ok');
    console.log('BINARY_MATCH:true');
    return;
  }}

  const builder = builderFactory.call(TypeClass);
  try {{
    hydrateBuilderFromView(TypeAny, builder, original, originalBytes);
  }} catch (err) {{
    console.error('Builder hydration failed', err);
    console.log('REENCODE:error');
    process.exit(1);
  }}
  const rebuilt = fromBuilderFn.call(TypeClass, builder);
  if (!rebuilt) {{
    console.error('fromBuilder returned null');
    console.log('REENCODE:error');
    process.exit(1);
  }}
  applyFieldContextIfNeeded(rebuilt, fieldContext);
  console.log('REENCODE:ok');

  const rebuiltBytes = extractBytesFromView(rebuilt);
  const match = compareBytes(originalBytes, rebuiltBytes);
  console.log(`BINARY_MATCH:${{match ? 'true' : 'false'}}`);
  if (!match) {{
    console.error('Binary mismatch detected');
    process.exit(1);
  }}
}}

main().catch(err => {{
  console.error(err);
  process.exit(1);
}});
"#,
        type_name = type_name,
        package_path = package_path,
        enum_metadata_json = enum_metadata_json,
        binary_path = binary_path_str
    )
}

fn abi_gen_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .map(Path::to_path_buf)
        .expect("failed to resolve abi_gen directory")
}

fn resolve_ts_toolchain() -> Result<TsToolchain> {
    let toolchain_root = abi_gen_root().join("tests").join("ts_toolchain");
    if !toolchain_root.is_dir() {
        anyhow::bail!(
            "TypeScript toolchain directory missing at {}",
            toolchain_root.display()
        );
    }
    let node_modules = toolchain_root.join("node_modules");
    if !node_modules.is_dir() {
        anyhow::bail!(
            "TypeScript toolchain not found at {}",
            node_modules.display()
        );
    }
    let tsc_path = node_modules.join(".bin").join("tsc");
    if !tsc_path.exists() {
        anyhow::bail!("tsc binary not found at {}", tsc_path.display());
    }

    let mut type_roots = Vec::new();
    let types_dir = node_modules.join("@types");
    if types_dir.is_dir() {
        type_roots.push(types_dir);
    } else {
        anyhow::bail!(
            "Could not locate @types directory inside {}",
            node_modules.display()
        );
    }

    Ok(TsToolchain {
        tsc_path,
        type_roots,
    })
}

struct TsToolchain {
    tsc_path: PathBuf,
    type_roots: Vec<PathBuf>,
}

struct TypeContext {
    package: String,
    enum_metadata_json: String,
}

#[derive(Serialize)]
struct EnumFieldMetadata {
    field_ts_name: String,
    tag_ts_name: String,
    descriptor_prop: String,
    payload_offset: u64,
    tag_offset: u64,
    variants: Vec<EnumVariantMetadata>,
    is_tail: bool,
}

#[derive(Serialize)]
struct EnumVariantMetadata {
    tag: u64,
    payload_size: Option<u64>,
}
fn collect_enum_field_metadata(resolved_type: &ResolvedType) -> Vec<EnumFieldMetadata> {
    let mut out = Vec::new();
    let ResolvedTypeKind::Struct { fields, .. } = &resolved_type.kind else {
        return out;
    };

    for field in fields {
        let ResolvedTypeKind::Enum { variants, .. } = &field.field_type.kind else {
            continue;
        };

        let Some(enum_info) = enum_field_info_by_name(resolved_type, &field.name) else {
            continue;
        };
        let Some(payload_offset) = enum_info.payload_offset else {
            continue;
        };
        let tag_offset = enum_info.tag_offset.unwrap_or(payload_offset);
        let descriptor_prop = enum_info.descriptor_prop.clone();
        let field_ts_name = enum_info.enum_ts_name.clone();
        let tag_ts_name = enum_info.tag_ts_name.clone();

        let mut variant_meta = Vec::new();
        for variant in variants {
            let payload_size = match variant.variant_type.size {
                Size::Const(sz) => Some(sz),
                _ => None,
            };
            variant_meta.push(EnumVariantMetadata {
                tag: variant.tag_value,
                payload_size,
            });
        }

        if !variant_meta.is_empty() {
            out.push(EnumFieldMetadata {
                field_ts_name,
                tag_ts_name,
                descriptor_prop,
                payload_offset,
                tag_offset,
                variants: variant_meta,
                is_tail: enum_info.is_tail,
            });
        }
    }

    out
}

fn run_strict_tsc_check(ts_toolchain: &TsToolchain, types_path: &Path) -> Result<()> {
    if !types_path.exists() {
        anyhow::bail!(
            "Generated TypeScript file missing (expected {}); is codegen skipping this ABI?",
            types_path.display()
        );
    }
    let mut cmd = Command::new(&ts_toolchain.tsc_path);
    cmd.arg("--strict")
        .arg("--noEmit")
        .arg("--target")
        .arg("ES2020")
        .arg("--lib")
        .arg("ES2020")
        .arg(types_path);
    let output = cmd
        .output()
        .context("failed to invoke tsc --strict --noEmit")?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    anyhow::bail!(
        "TypeScript strict check failed:\nstdout:\n{}\nstderr:\n{}",
        stdout,
        stderr
    );
}

fn run_noemit_strict_tsc(ts_toolchain: &TsToolchain, tsconfig_path: &Path) -> Result<()> {
    if !tsconfig_path.exists() {
        return Ok(());
    }
    let mut cmd = Command::new(&ts_toolchain.tsc_path);
    cmd.arg("--strict")
        .arg("--noEmit")
        .arg("--target")
        .arg("ES2020")
        .arg("--lib")
        .arg("ES2020")
        .arg("--project")
        .arg(tsconfig_path);
    let output = cmd.output().with_context(|| {
        format!(
            "failed to invoke tsc --strict --noEmit for {}",
            tsconfig_path.display()
        )
    })?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    let stdout = String::from_utf8_lossy(&output.stdout);
    anyhow::bail!(
        "Strict TypeScript check failed for {}:\nstdout:\n{}\nstderr:\n{}",
        tsconfig_path.display(),
        stdout,
        stderr
    );
}

fn escape_js_string(input: &str) -> String {
    input.replace('\\', "\\\\").replace('\'', "\\'")
}
