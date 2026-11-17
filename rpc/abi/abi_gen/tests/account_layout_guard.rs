/* Account layout guard.

Thru's programs follow the account discriminator convention (strongly
recommended, not enforced by the runtime): a one-byte discriminator at the
start of each account, one value per (account kind, layout) pair, never
edited in place and never reused (rpc/abi/abi_gen/ABI_SPECIFICATION.md,
"Program account discriminator"). This test keeps every ABI in this
repository that declares an `account-root` on it:

1. Shape: the root is a packed struct of exactly `account_type: u8` and
   `payload`, an enum keyed on `account_type` whose variants are named
   `<kind>_v<n>`, have nonzero unique values and point at a named type.
2. Freeze: rpc/abi/account-layout-baselines/ records the layout of every
   value. A recorded value must keep its variant name and its exact
   layout (field names, order, types, sizes, offsets), and every current
   value must be recorded.

To record new values (never to change recorded ones):
  ACCOUNT_LAYOUT_RECORD=1 cargo test -p thru-abi-gen --test account_layout_guard
Recording only adds values and new ABIs; a changed layout still fails. */

use abi_gen::abi::expr::ExprKind;
use abi_gen::abi::file::{AbiFile, ImportResolver};
use abi_gen::abi::resolved::{ResolvedType, ResolvedTypeKind, Size, TypeResolver};
use abi_gen::abi::types::{IntegralType, PrimitiveType};
use serde_json::{Map, Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

/* ABI files that are copies, fixtures or tool tests rather than program
ABI sources. */
const EXCLUDED_PREFIXES: &[&str] = &[
    "rpc/abi/abi_gen/tests/",
    "rpc/abi/abi_reflect/tests/",
    "sdks/go/abi/testdata/",
    "programs/bootstrap/generated/",
    "programs/bootstrap/tests/fixtures/",
    "rpc/cli/crates/thru-core/abi/",
    "docs/",
];

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .unwrap()
}

fn baseline_dir(root: &Path) -> PathBuf {
    root.join("rpc/abi/account-layout-baselines")
}

fn abi_files(root: &Path) -> Vec<String> {
    let out = Command::new("git")
        .args([
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "*.abi.yaml",
        ])
        .current_dir(root)
        .output()
        .expect("git ls-files");
    assert!(out.status.success(), "git ls-files failed");
    let mut files: Vec<String> = String::from_utf8(out.stdout)
        .unwrap()
        .lines()
        .filter(|p| !EXCLUDED_PREFIXES.iter().any(|x| p.starts_with(x)))
        .filter(|p| root.join(p).exists())
        .map(str::to_string)
        .collect();
    files.sort();
    files.dedup();
    files
}

fn account_root(root: &Path, rel: &str) -> Option<String> {
    let text = fs::read_to_string(root.join(rel)).unwrap();
    let abi: AbiFile = serde_yml::from_str(&text).unwrap_or_else(|e| panic!("{rel}: parse: {e}"));
    abi.root_types().account_root.clone()
}

fn resolve(root: &Path, rel: &str) -> TypeResolver {
    let path = root.join(rel);
    let mut loader = ImportResolver::new(vec![
        path.parent().unwrap().to_path_buf(),
        root.join("rpc/abi/type-library"),
    ]);
    loader
        .load_file_with_imports(&path, false)
        .unwrap_or_else(|e| panic!("{rel}: load: {e:?}"));
    let mut resolver = TypeResolver::new();
    for typedef in loader.get_all_types() {
        resolver.add_typedef(typedef.clone());
    }
    resolver
        .resolve_all()
        .unwrap_or_else(|e| panic!("{rel}: resolve: {e:?}"));
    resolver
}

/* Deterministic description of a type's bytes: names, order, primitive
types, sizes, offsets and nested types, with type references inlined.
Comments and dynamic-parameter bookkeeping are left out. */
fn describe(resolver: &TypeResolver, ty: &ResolvedType, stack: &mut Vec<String>) -> Value {
    let size = match &ty.size {
        Size::Const(n) => json!(n),
        Size::Variable(_) => json!("variable"),
    };
    let kind = match &ty.kind {
        ResolvedTypeKind::Primitive { prim_type } => {
            json!({ "primitive": format!("{prim_type:?}") })
        }
        ResolvedTypeKind::Struct {
            fields,
            packed,
            custom_alignment,
        } => json!({
            "struct": {
                "packed": packed,
                "aligned": custom_alignment,
                "fields": fields.iter().map(|f| json!({
                    "name": f.name,
                    "offset": f.offset,
                    "type": describe(resolver, &f.field_type, stack),
                })).collect::<Vec<_>>(),
            }
        }),
        ResolvedTypeKind::Union { variants } => json!({
            "union": variants.iter().map(|f| json!({
                "name": f.name,
                "type": describe(resolver, &f.field_type, stack),
            })).collect::<Vec<_>>(),
        }),
        ResolvedTypeKind::Enum {
            tag_expression,
            variants,
            ..
        } => json!({
            "enum": {
                "tag": serde_json::to_value(tag_expression).unwrap(),
                "variants": variants.iter().map(|v| json!({
                    "name": v.name,
                    "tag": v.tag_value,
                    "type": describe(resolver, &v.variant_type, stack),
                })).collect::<Vec<_>>(),
            }
        }),
        ResolvedTypeKind::Array {
            element_type,
            size_expression,
            jagged,
            ..
        } => json!({
            "array": {
                "size": serde_json::to_value(size_expression).unwrap(),
                "jagged": jagged,
                "element": describe(resolver, element_type, stack),
            }
        }),
        ResolvedTypeKind::SizeDiscriminatedUnion { variants } => json!({
            "size_union": variants.iter().map(|v| json!({
                "name": v.name,
                "size": v.expected_size,
                "type": describe(resolver, &v.variant_type, stack),
            })).collect::<Vec<_>>(),
        }),
        ResolvedTypeKind::TypeRef { target_name, .. } => {
            if stack.contains(target_name) {
                json!({ "recursive_ref": target_name })
            } else {
                let target = resolver
                    .get_type_info(target_name)
                    .unwrap_or_else(|| panic!("unresolved type {target_name}"));
                stack.push(target_name.clone());
                let inner = describe(resolver, target, stack);
                stack.pop();
                json!({ "ref": target_name, "layout": inner })
            }
        }
    };
    json!({ "size": size, "alignment": ty.alignment, "kind": kind })
}

fn variant_name_ok(name: &str) -> bool {
    let Some((kind, version)) = name.rsplit_once("_v") else {
        return false;
    };
    !kind.is_empty()
        && kind.chars().next().unwrap().is_ascii_lowercase()
        && kind
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_')
        && !version.is_empty()
        && !version.starts_with('0')
        && version.chars().all(|c| c.is_ascii_digit())
}

/* Returns value -> (variant name, layout), or the shape violations. */
fn check_shape(
    rel: &str,
    root_name: &str,
    resolver: &TypeResolver,
) -> Result<BTreeMap<u64, (String, Value)>, Vec<String>> {
    let mut errors = Vec::new();
    let Some(root) = resolver.get_type_info(root_name) else {
        return Err(vec![format!(
            "{rel}: account-root {root_name} is not defined"
        )]);
    };
    let ResolvedTypeKind::Struct { fields, packed, .. } = &root.kind else {
        return Err(vec![format!(
            "{rel}: account-root {root_name} must be a struct"
        )]);
    };
    if !packed {
        errors.push(format!("{rel}: account-root {root_name} must be packed"));
    }
    if fields.len() != 2 {
        errors.push(format!(
            "{rel}: account-root {root_name} must have exactly two fields (account_type, payload), has {}",
            fields.len()
        ));
    }
    match fields.first() {
        Some(f)
            if f.name == "account_type"
                && matches!(
                    f.field_type.kind,
                    ResolvedTypeKind::Primitive {
                        prim_type: PrimitiveType::Integral(IntegralType::U8)
                    }
                ) => {}
        _ => errors.push(format!(
            "{rel}: {root_name} field 0 must be `account_type: u8`"
        )),
    }
    let mut values = BTreeMap::new();
    match fields.get(1) {
        Some(f) if f.name == "payload" => match &f.field_type.kind {
            ResolvedTypeKind::Enum {
                tag_expression,
                variants,
                ..
            } => {
                let keyed = matches!(tag_expression,
                    ExprKind::FieldRef(r) if r.path == vec!["account_type".to_string()]);
                if !keyed {
                    errors.push(format!(
                        "{rel}: {root_name}.payload must be keyed on [account_type]"
                    ));
                }
                let mut names = BTreeSet::new();
                for v in variants {
                    if v.tag_value == 0 || v.tag_value > 255 {
                        errors.push(format!(
                            "{rel}: variant {} has value {} (must be 1..=255)",
                            v.name, v.tag_value
                        ));
                    }
                    if !variant_name_ok(&v.name) {
                        errors.push(format!(
                            "{rel}: variant {} must be named <kind>_v<n>",
                            v.name
                        ));
                    }
                    if !names.insert(v.name.clone()) {
                        errors.push(format!("{rel}: variant name {} is repeated", v.name));
                    }
                    if !matches!(v.variant_type.kind, ResolvedTypeKind::TypeRef { .. }) {
                        errors.push(format!(
                            "{rel}: variant {} must point at a named type (type-ref)",
                            v.name
                        ));
                    }
                    let layout = describe(resolver, &v.variant_type, &mut vec![]);
                    if values
                        .insert(v.tag_value, (v.name.clone(), layout))
                        .is_some()
                    {
                        errors.push(format!("{rel}: value {} is used twice", v.tag_value));
                    }
                }
            }
            _ => errors.push(format!("{rel}: {root_name}.payload must be an enum")),
        },
        _ => errors.push(format!("{rel}: {root_name} field 1 must be `payload`")),
    }
    if errors.is_empty() {
        Ok(values)
    } else {
        Err(errors)
    }
}

fn baseline_path(root: &Path, rel: &str) -> PathBuf {
    let name = rel.trim_end_matches(".abi.yaml").replace('/', "__");
    baseline_dir(root).join(format!("{name}.json"))
}

#[test]
fn account_roots_follow_the_discriminator_convention_and_never_change() {
    let root = repo_root();
    let record = std::env::var_os("ACCOUNT_LAYOUT_RECORD").is_some();
    let mut errors = Vec::new();
    let mut seen = BTreeSet::new();

    for rel in abi_files(&root) {
        let Some(root_name) = account_root(&root, &rel) else {
            continue;
        };
        let resolver = resolve(&root, &rel);
        let values = match check_shape(&rel, &root_name, &resolver) {
            Ok(v) => v,
            Err(e) => {
                errors.extend(e);
                continue;
            }
        };
        let path = baseline_path(&root, &rel);
        seen.insert(path.clone());
        let mut baseline: Map<String, Value> = fs::read_to_string(&path)
            .ok()
            .map(|t| {
                serde_json::from_str::<Value>(&t).unwrap()["values"]
                    .as_object()
                    .unwrap()
                    .clone()
            })
            .unwrap_or_default();
        if baseline.is_empty() && !record {
            errors.push(format!(
                "{rel}: no recorded layouts at {}; record them",
                path.display()
            ));
            continue;
        }

        for (value, recorded) in &baseline {
            let value_num: u64 = value.parse().unwrap();
            let name = recorded["variant"].as_str().unwrap();
            match values.get(&value_num) {
                None => errors.push(format!("{rel}: value {value} ({name}) was removed; values are never retired from the ABI")),
                Some((current, _)) if current != name => errors.push(format!(
                    "{rel}: value {value} was renamed {name} -> {current}; add a new value instead")),
                Some((_, layout)) if layout != &recorded["layout"] => errors.push(format!(
                    "{rel}: value {value} ({name}) changed layout; a changed layout takes the next unused value")),
                _ => {}
            }
        }
        let mut added = false;
        for (value, (name, layout)) in &values {
            if !baseline.contains_key(&value.to_string()) {
                if record {
                    baseline.insert(
                        value.to_string(),
                        json!({ "variant": name, "layout": layout }),
                    );
                    added = true;
                } else {
                    errors.push(format!(
                        "{rel}: value {value} ({name}) is not recorded; record it"
                    ));
                }
            }
        }
        if record && added {
            fs::create_dir_all(baseline_dir(&root)).unwrap();
            let doc = json!({ "abi": rel, "account_root": root_name, "values": baseline });
            fs::write(&path, serde_json::to_string_pretty(&doc).unwrap() + "\n").unwrap();
        }
    }

    if let Ok(entries) = fs::read_dir(baseline_dir(&root)) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().is_some_and(|e| e == "json") && !seen.contains(&path) {
                errors.push(format!(
                    "{}: its ABI no longer exists or lost its account-root",
                    path.display()
                ));
            }
        }
    }

    assert!(
        errors.is_empty(),
        "account layout guard:\n  {}\n\nTo record new values (never changed ones): \
         ACCOUNT_LAYOUT_RECORD=1 cargo test -p thru-abi-gen --test account_layout_guard",
        errors.join("\n  ")
    );
}

#[test]
fn variant_names_follow_kind_v_n() {
    for ok in ["mint_v1", "token_account_v2", "cbook_v10", "a1_v3"] {
        assert!(variant_name_ok(ok), "{ok}");
    }
    for bad in [
        "mint", "Mint_v1", "mint_v0", "mint_v", "_v1", "mint_v01", "mint-v1",
    ] {
        assert!(!variant_name_ok(bad), "{bad}");
    }
}
