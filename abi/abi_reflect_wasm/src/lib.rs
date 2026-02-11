use abi_gen::abi::file::AbiFile;
use abi_gen::abi::resolved::TypeResolver;
use abi_reflect::{
    format_reflection as format_value,
    format_reflection_with_options as format_value_with_options,
    FormatOptions,
    ReflectError,
    ReflectorConfig,
    Reflector,
};
use console_error_panic_hook::set_once as set_panic_hook_once;
use js_sys::Uint8Array;
use std::collections::HashMap;
use wasm_bindgen::prelude::*;

#[wasm_bindgen(start)]
pub fn wasm_start() {
    set_panic_hook_once();
}

#[wasm_bindgen]
pub fn reflect(abi_yaml: &str, type_name: &str, buffer: Uint8Array) -> Result<JsValue, JsValue> {
    let reflector = build_reflector(abi_yaml)?;
    let bytes = buffer.to_vec();
    let reflected = reflector
        .reflect(&bytes, type_name)
        .map_err(map_reflect_error)?;
    Ok(js_string(
        serde_json::to_string(&reflected).map_err(map_serde_error)?,
    ))
}

#[wasm_bindgen]
pub fn reflect_instruction(abi_yaml: &str, buffer: Uint8Array) -> Result<JsValue, JsValue> {
    let reflector = build_reflector(abi_yaml)?;
    let bytes = buffer.to_vec();
    let reflected = reflector
        .reflect_instruction(&bytes)
        .map_err(map_reflect_error)?;
    Ok(js_string(
        serde_json::to_string(&reflected).map_err(map_serde_error)?,
    ))
}

#[wasm_bindgen]
pub fn reflect_account(abi_yaml: &str, buffer: Uint8Array) -> Result<JsValue, JsValue> {
    let reflector = build_reflector(abi_yaml)?;
    let bytes = buffer.to_vec();
    let reflected = reflector
        .reflect_account(&bytes)
        .map_err(map_reflect_error)?;
    Ok(js_string(
        serde_json::to_string(&reflected).map_err(map_serde_error)?,
    ))
}

#[wasm_bindgen]
pub fn reflect_event(abi_yaml: &str, buffer: Uint8Array) -> Result<JsValue, JsValue> {
    let reflector = build_reflector(abi_yaml)?;
    let bytes = buffer.to_vec();
    let reflected = reflector
        .reflect_event(&bytes)
        .map_err(map_reflect_error)?;
    Ok(js_string(
        serde_json::to_string(&reflected).map_err(map_serde_error)?,
    ))
}

#[wasm_bindgen]
pub fn build_layout_ir(abi_yaml: &str) -> Result<JsValue, JsValue> {
    let reflector = build_reflector(abi_yaml)?;
    Ok(js_string(
        serde_json::to_string(reflector.layout_ir()).map_err(map_serde_error)?,
    ))
}

#[wasm_bindgen]
pub fn format_reflection(raw_json: &str) -> Result<JsValue, JsValue> {
    let value: abi_reflect::ReflectedValue =
        serde_json::from_str(raw_json).map_err(map_serde_error)?;
    let formatted = format_value(&value);
    Ok(js_string(
        serde_json::to_string(&formatted).map_err(map_serde_error)?,
    ))
}

#[wasm_bindgen]
pub fn format_reflection_with_options(raw_json: &str, options_json: &str) -> Result<JsValue, JsValue> {
    let value: abi_reflect::ReflectedValue =
        serde_json::from_str(raw_json).map_err(map_serde_error)?;
    let options: FormatOptions =
        serde_json::from_str(options_json).map_err(map_serde_error)?;
    let formatted = format_value_with_options(&value, &options);
    Ok(js_string(
        serde_json::to_string(&formatted).map_err(map_serde_error)?,
    ))
}

fn build_reflector(abi_yaml: &str) -> Result<Reflector, JsValue> {
    let abi_file: AbiFile = serde_yml::from_str(abi_yaml)
        .map_err(|err| js_error(format!("Invalid ABI YAML: {err}")))?;

    if !abi_file.imports().is_empty() {
        return Err(js_error(
            "ABI imports are currently unsupported in the WASM runtime".into(),
        ));
    }

    let root_types = abi_file.root_types().clone();

    let mut resolver = TypeResolver::new();
    for typedef in abi_file.types {
        resolver.add_typedef(typedef);
    }

    resolver
        .resolve_all()
        .map_err(|err| js_error(format!("Failed to resolve types: {err:?}")))?;

    Reflector::with_root_types(resolver, ReflectorConfig::default(), root_types)
        .map_err(map_reflect_error)
}

fn map_reflect_error(err: ReflectError) -> JsValue {
    js_error(format!("Reflection error: {err}"))
}

fn map_serde_error(err: serde_json::Error) -> JsValue {
    js_error(format!("Serialization error: {err}"))
}

fn js_error(message: String) -> JsValue {
    js_sys::Error::new(&message).into()
}

fn js_string(value: String) -> JsValue {
    JsValue::from_str(&value)
}

/* ============================================================================
   Manifest-based Functions

   These functions accept a pre-resolved manifest (JSON map of package name to
   ABI YAML content) enabling reflection on ABIs with imports in the WASM runtime.
   ============================================================================ */

/// Reflect a binary buffer using a pre-resolved manifest.
///
/// The manifest is a JSON object mapping package names to their ABI YAML content.
/// The root_package parameter specifies which package contains the target type
/// and root type configuration.
///
/// Example manifest:
/// ```json
/// {
///   "thru.program.token": "abi:\n  package: thru.program.token\n  ...",
///   "thru.common.primitives": "abi:\n  package: thru.common.primitives\n  ..."
/// }
/// ```
#[wasm_bindgen]
pub fn reflect_with_manifest(
    manifest_json: &str,
    root_package: &str,
    type_name: &str,
    buffer: Uint8Array,
) -> Result<JsValue, JsValue> {
    let reflector = build_reflector_from_manifest(manifest_json, root_package)?;
    let bytes = buffer.to_vec();
    let reflected = reflector
        .reflect(&bytes, type_name)
        .map_err(map_reflect_error)?;
    Ok(js_string(
        serde_json::to_string(&reflected).map_err(map_serde_error)?,
    ))
}

/// Reflect an instruction using a pre-resolved manifest.
#[wasm_bindgen]
pub fn reflect_instruction_with_manifest(
    manifest_json: &str,
    root_package: &str,
    buffer: Uint8Array,
) -> Result<JsValue, JsValue> {
    let reflector = build_reflector_from_manifest(manifest_json, root_package)?;
    let bytes = buffer.to_vec();
    let reflected = reflector
        .reflect_instruction(&bytes)
        .map_err(map_reflect_error)?;
    Ok(js_string(
        serde_json::to_string(&reflected).map_err(map_serde_error)?,
    ))
}

/// Reflect an account using a pre-resolved manifest.
#[wasm_bindgen]
pub fn reflect_account_with_manifest(
    manifest_json: &str,
    root_package: &str,
    buffer: Uint8Array,
) -> Result<JsValue, JsValue> {
    let reflector = build_reflector_from_manifest(manifest_json, root_package)?;
    let bytes = buffer.to_vec();
    let reflected = reflector
        .reflect_account(&bytes)
        .map_err(map_reflect_error)?;
    Ok(js_string(
        serde_json::to_string(&reflected).map_err(map_serde_error)?,
    ))
}

/// Reflect an event using a pre-resolved manifest.
#[wasm_bindgen]
pub fn reflect_event_with_manifest(
    manifest_json: &str,
    root_package: &str,
    buffer: Uint8Array,
) -> Result<JsValue, JsValue> {
    let reflector = build_reflector_from_manifest(manifest_json, root_package)?;
    let bytes = buffer.to_vec();
    let reflected = reflector
        .reflect_event(&bytes)
        .map_err(map_reflect_error)?;
    Ok(js_string(
        serde_json::to_string(&reflected).map_err(map_serde_error)?,
    ))
}

/// Build layout IR from a pre-resolved manifest.
#[wasm_bindgen]
pub fn build_layout_ir_with_manifest(
    manifest_json: &str,
    root_package: &str,
) -> Result<JsValue, JsValue> {
    let reflector = build_reflector_from_manifest(manifest_json, root_package)?;
    Ok(js_string(
        serde_json::to_string(reflector.layout_ir()).map_err(map_serde_error)?,
    ))
}

/// Get the list of package names in a manifest.
#[wasm_bindgen]
pub fn get_manifest_packages(manifest_json: &str) -> Result<JsValue, JsValue> {
    let manifest: HashMap<String, String> = serde_json::from_str(manifest_json)
        .map_err(|err| js_error(format!("Invalid manifest JSON: {err}")))?;

    let packages: Vec<&String> = manifest.keys().collect();
    Ok(js_string(
        serde_json::to_string(&packages).map_err(map_serde_error)?,
    ))
}

/// Validate a manifest and return information about its contents.
#[wasm_bindgen]
pub fn validate_manifest(manifest_json: &str) -> Result<JsValue, JsValue> {
    let manifest: HashMap<String, String> = serde_json::from_str(manifest_json)
        .map_err(|err| js_error(format!("Invalid manifest JSON: {err}")))?;

    let mut packages_info = Vec::new();

    for (name, yaml) in &manifest {
        let abi_file: AbiFile = serde_yml::from_str(yaml)
            .map_err(|err| js_error(format!("Invalid ABI YAML for package '{}': {}", name, err)))?;

        packages_info.push(serde_json::json!({
            "name": name,
            "package": abi_file.package(),
            "version": abi_file.abi_version(),
            "type_count": abi_file.types.len(),
            "has_root_types": abi_file.root_types().instruction_root.is_some()
                || abi_file.root_types().account_root.is_some()
        }));
    }

    Ok(js_string(
        serde_json::to_string(&packages_info).map_err(map_serde_error)?,
    ))
}

fn build_reflector_from_manifest(manifest_json: &str, root_package: &str) -> Result<Reflector, JsValue> {
    let manifest: HashMap<String, String> = serde_json::from_str(manifest_json)
        .map_err(|err| js_error(format!("Invalid manifest JSON: {err}")))?;

    if manifest.is_empty() {
        return Err(js_error("Manifest is empty".into()));
    }

    /* Find the root package to get root types configuration */
    let root_yaml = manifest.get(root_package)
        .ok_or_else(|| js_error(format!("Root package '{}' not found in manifest", root_package)))?;

    let root_abi: AbiFile = serde_yml::from_str(root_yaml)
        .map_err(|err| js_error(format!("Invalid ABI YAML for root package '{}': {}", root_package, err)))?;

    let root_types = root_abi.root_types().clone();

    /* Build type resolver with all types from all packages */
    let mut resolver = TypeResolver::new();

    for (name, yaml) in &manifest {
        let abi_file: AbiFile = serde_yml::from_str(yaml)
            .map_err(|err| js_error(format!("Invalid ABI YAML for package '{}': {}", name, err)))?;

        for typedef in abi_file.types {
            resolver.add_typedef(typedef);
        }
    }

    resolver
        .resolve_all()
        .map_err(|err| js_error(format!("Failed to resolve types: {err:?}")))?;

    Reflector::with_root_types(resolver, ReflectorConfig::default(), root_types)
        .map_err(map_reflect_error)
}
