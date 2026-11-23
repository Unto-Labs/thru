/* Program error lookup
 *
 * A program reverts with a single 64-bit code. Its ABI names those codes on
 * the errors root (`root-types.errors`): a struct whose first field is the
 * integer code, followed by an enum keyed on that field with one variant per
 * code. This module maps a code to its variant name and comment.
 *
 * The lookup reads the type definitions directly. It needs no buffer and no
 * layout, so it works with a code of any integer width and with negative
 * codes.
 */

use crate::errors::{ReflectError, ReflectResult};
use abi_gen::abi::expr::ExprKind;
use abi_gen::abi::file::RootTypes;
use abi_gen::abi::types::{EnumType, IntegralType, PrimitiveType, TypeDef, TypeKind};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/* One named error code of a program */
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReflectedError {
    /* Name of the errors root type, e.g. "TokenError" */
    pub type_name: String,
    /* Variant name, e.g. "insufficient_funds" */
    pub name: String,
    /* The code as the program passes it to revert, as an unsigned 64-bit
     * decimal string. A string so that JSON readers keep all 64 bits. */
    pub code: String,
    /* One-sentence meaning, when the ABI gives one */
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comment: Option<String>,
}

/* Look up the name of a revert code on the ABI's errors root.
 *
 * Returns Ok(None) when the code is not listed, including when the errors
 * root lists no codes at all. Returns an error when the ABI declares no
 * errors root or the declared type does not exist. */
pub fn reflect_error(
    types: &[TypeDef],
    root_types: &RootTypes,
    code: u64,
) -> ReflectResult<Option<ReflectedError>> {
    let (type_name, root) = errors_root(types, root_types)?;
    let Some((code_type, error_enum)) = code_and_enum(root) else {
        return Ok(None);
    };
    /* Search the borrowed variants and build only the match: the ABI comes
    from whoever published the program, so a lookup must not copy every
    variant's strings. */
    Ok(error_enum
        .variants
        .iter()
        .find(|variant| normalize_code(variant.tag_value, code_type) == code)
        .map(|variant| ReflectedError {
            type_name: type_name.to_string(),
            name: variant.name.clone(),
            code: code.to_string(),
            comment: variant.comment.clone(),
        }))
}

/* List every named error code of the ABI's errors root, in ABI order.
 *
 * Empty when the errors root is only a code field with no enum. */
pub fn error_variants(
    types: &[TypeDef],
    root_types: &RootTypes,
) -> ReflectResult<Vec<ReflectedError>> {
    let (type_name, root) = errors_root(types, root_types)?;
    let Some((code_type, error_enum)) = code_and_enum(root) else {
        return Ok(Vec::new());
    };
    Ok(error_enum
        .variants
        .iter()
        .map(|variant| ReflectedError {
            type_name: type_name.to_string(),
            name: variant.name.clone(),
            code: normalize_code(variant.tag_value, code_type).to_string(),
            comment: variant.comment.clone(),
        })
        .collect())
}

/* Check that the errors root has the shape the lookup reads: a struct whose
 * first field is an integer, optionally followed by an enum keyed on that
 * field, with no two variants sharing a code or a name. A problem is returned
 * as a sentence naming the type. */
pub fn validate_errors_root(types: &[TypeDef], root_types: &RootTypes) -> Result<(), String> {
    let (type_name, root) = errors_root(types, root_types).map_err(|err| err.to_string())?;
    let TypeKind::Struct(root_struct) = &root.kind else {
        return Err(format!("errors root '{type_name}' must be a struct"));
    };
    let Some(code_field) = root_struct.fields.first() else {
        return Err(format!("errors root '{type_name}' has no code field"));
    };
    if integral_type(&code_field.field_type).is_none() {
        return Err(format!(
            "errors root '{type_name}': first field '{}' must be an integer",
            code_field.name
        ));
    }
    if root_struct.fields.len() > 1 && code_and_enum(root).is_none() {
        return Err(format!(
            "errors root '{type_name}': the field after '{}' must be an enum keyed on it",
            code_field.name
        ));
    }

    let mut by_code: BTreeMap<String, String> = BTreeMap::new();
    let mut names: BTreeMap<String, ()> = BTreeMap::new();
    for variant in error_variants(types, root_types).map_err(|err| err.to_string())? {
        if names.insert(variant.name.clone(), ()).is_some() {
            return Err(format!(
                "errors root '{type_name}': variant name '{}' is listed twice",
                variant.name
            ));
        }
        if let Some(previous) = by_code.insert(variant.code.clone(), variant.name.clone()) {
            return Err(format!(
                "errors root '{type_name}': '{previous}' and '{}' share code {}",
                variant.name, variant.code
            ));
        }
    }
    Ok(())
}

fn errors_root<'a>(
    types: &'a [TypeDef],
    root_types: &'a RootTypes,
) -> ReflectResult<(&'a str, &'a TypeDef)> {
    let declared = root_types
        .errors
        .as_deref()
        .ok_or(ReflectError::MissingRootType {
            root_kind: "errors",
        })?;
    /* A root may be qualified by the ABI's own package. */
    let type_name = declared.rsplit_once('.').map_or(declared, |(_, name)| name);
    let root = types
        .iter()
        .find(|ty| ty.name == type_name)
        .ok_or_else(|| ReflectError::UnknownType {
            type_name: declared.to_string(),
        })?;
    Ok((type_name, root))
}

/* The code field's integer type and the enum keyed on it, when present */
fn code_and_enum(root: &TypeDef) -> Option<(&IntegralType, &EnumType)> {
    let TypeKind::Struct(root_struct) = &root.kind else {
        return None;
    };
    let code_field = root_struct.fields.first()?;
    let code_type = integral_type(&code_field.field_type)?;
    let error_enum = root_struct.fields.iter().skip(1).find_map(|field| {
        let TypeKind::Enum(candidate) = &field.field_type else {
            return None;
        };
        let ExprKind::FieldRef(tag_ref) = &candidate.tag_ref else {
            return None;
        };
        let referenced: Vec<&str> = tag_ref
            .path
            .iter()
            .flat_map(|segment| segment.split('/'))
            .filter(|segment| !segment.is_empty() && *segment != "..")
            .collect();
        (referenced == [code_field.name.as_str()]).then_some(candidate)
    })?;
    Some((code_type, error_enum))
}

fn integral_type(kind: &TypeKind) -> Option<&IntegralType> {
    match kind {
        TypeKind::Primitive(PrimitiveType::Integral(integral)) => Some(integral),
        _ => None,
    }
}

/* Widen a listed tag to the 64-bit value a program reverts with.
 *
 * The tag is first cut to the code field's width, then sign-extended when the
 * field is signed. So `-1` on a u16 code is 65535, and `-101` on a u64 or i64
 * code is 2^64 - 101. */
fn normalize_code(tag_value: u64, code_type: &IntegralType) -> u64 {
    let (bits, signed) = match code_type {
        IntegralType::U8 | IntegralType::Char => (8u32, false),
        IntegralType::I8 => (8, true),
        IntegralType::U16 => (16, false),
        IntegralType::I16 => (16, true),
        IntegralType::U32 => (32, false),
        IntegralType::I32 => (32, true),
        IntegralType::U64 | IntegralType::I64 => return tag_value,
    };
    let mask = (1u64 << bits) - 1;
    let low = tag_value & mask;
    if signed && (low >> (bits - 1)) == 1 {
        low | !mask
    } else {
        low
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use abi_gen::abi::file::AbiFile;

    fn load(yaml: &str) -> AbiFile {
        serde_yml::from_str(yaml).expect("test ABI parses")
    }

    fn abi(code_type: &str, variants: &str) -> AbiFile {
        load(&format!(
            r#"
abi:
  package: test.errors
  abi-version: 1
  package-version: "1.0.0"
  description: test
  options:
    program-metadata:
      root-types:
        errors: DemoError
types:
- name: DemoError
  kind:
    struct:
      packed: true
      fields:
      - name: code
        field-type:
          primitive: {code_type}
      - name: error
        field-type:
          enum:
            tag-ref:
              field-ref:
                path: [code]
            variants:
{variants}
"#
        ))
    }

    const VARIANTS: &str = r#"            - name: invalid_instruction
              tag-value: 1
              comment: Instruction tag is not known.
            - name: insufficient_funds
              tag-value: 7
            - name: crossed_book
              tag-value: -101
              comment: Order would cross the book.
"#;

    #[test]
    fn names_a_listed_code_with_its_comment() {
        let abi = abi("u64", VARIANTS);
        let found = reflect_error(&abi.types, abi.root_types(), 1)
            .unwrap()
            .unwrap();
        assert_eq!(found.type_name, "DemoError");
        assert_eq!(found.name, "invalid_instruction");
        assert_eq!(found.code, "1");
        assert_eq!(
            found.comment.as_deref(),
            Some("Instruction tag is not known.")
        );

        let no_comment = reflect_error(&abi.types, abi.root_types(), 7)
            .unwrap()
            .unwrap();
        assert_eq!(no_comment.name, "insufficient_funds");
        assert_eq!(no_comment.comment, None);
    }

    #[test]
    fn unlisted_code_is_none() {
        let abi = abi("u64", VARIANTS);
        assert_eq!(
            reflect_error(&abi.types, abi.root_types(), 2).unwrap(),
            None
        );
    }

    #[test]
    fn negative_tag_matches_the_twos_complement_revert_code() {
        let abi = abi("u64", VARIANTS);
        let code = (-101i64) as u64;
        let found = reflect_error(&abi.types, abi.root_types(), code)
            .unwrap()
            .unwrap();
        assert_eq!(found.name, "crossed_book");
        assert_eq!(found.code, "18446744073709551515");
    }

    #[test]
    fn narrow_code_is_cut_to_its_width() {
        let unsigned = abi("u16", VARIANTS);
        /* -101 as u16 is 65435; a u16 code never has higher bits set. */
        let found = reflect_error(&unsigned.types, unsigned.root_types(), 65435)
            .unwrap()
            .unwrap();
        assert_eq!(found.name, "crossed_book");
        assert_eq!(
            reflect_error(&unsigned.types, unsigned.root_types(), (-101i64) as u64).unwrap(),
            None
        );

        let signed = abi("i32", VARIANTS);
        let found = reflect_error(&signed.types, signed.root_types(), (-101i64) as u64)
            .unwrap()
            .unwrap();
        assert_eq!(found.name, "crossed_book");
    }

    #[test]
    fn code_only_root_lists_nothing() {
        let abi = load(
            r#"
abi:
  package: test.errors
  abi-version: 1
  package-version: "1.0.0"
  description: test
  options:
    program-metadata:
      root-types:
        errors: DemoError
types:
- name: DemoError
  kind:
    struct:
      packed: true
      fields:
      - name: code
        field-type:
          primitive: u64
"#,
        );
        assert_eq!(
            reflect_error(&abi.types, abi.root_types(), 1).unwrap(),
            None
        );
        assert!(validate_errors_root(&abi.types, abi.root_types()).is_ok());
    }

    #[test]
    fn missing_errors_root_is_an_error() {
        let abi = abi("u64", VARIANTS);
        let no_root = RootTypes::default();
        assert!(matches!(
            reflect_error(&abi.types, &no_root, 1),
            Err(ReflectError::MissingRootType {
                root_kind: "errors"
            })
        ));
    }

    #[test]
    fn validation_rejects_shared_codes_and_names() {
        let shared_code = abi(
            "u64",
            r#"            - name: first
              tag-value: 5
            - name: second
              tag-value: 5
"#,
        );
        let err = validate_errors_root(&shared_code.types, shared_code.root_types()).unwrap_err();
        assert!(err.contains("share code 5"), "{err}");

        let shared_name = abi(
            "u64",
            r#"            - name: same
              tag-value: 5
            - name: same
              tag-value: 6
"#,
        );
        let err = validate_errors_root(&shared_name.types, shared_name.root_types()).unwrap_err();
        assert!(err.contains("listed twice"), "{err}");

        assert!(validate_errors_root(
            &abi("u64", VARIANTS).types,
            abi("u64", VARIANTS).root_types()
        )
        .is_ok());
    }

    /* Every ABI in the type library that declares an errors root must have a
     * root the lookup can read. */
    #[test]
    fn type_library_errors_roots_are_well_formed() {
        let dir = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../type-library");
        let mut checked = 0;
        for entry in std::fs::read_dir(&dir).unwrap() {
            let path = entry.unwrap().path();
            if !path.to_string_lossy().ends_with(".abi.yaml") {
                continue;
            }
            let abi = load(&std::fs::read_to_string(&path).unwrap());
            if abi.root_types().errors.is_none() {
                continue;
            }
            if let Err(problem) = validate_errors_root(&abi.types, abi.root_types()) {
                panic!("{}: {problem}", path.display());
            }
            checked += 1;
        }
        assert!(checked > 0, "no type-library ABI declares an errors root");
    }
}
