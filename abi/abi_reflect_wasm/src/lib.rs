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
