/* Program account roots: byte 0 is account_type and the payload enum is
 * keyed on it. When every variant has the same size (a single-variant root,
 * or same-size kinds) the enum is fixed-size; its tag still comes from the
 * enclosing struct. */

use abi_gen::abi::file::AbiFile;
use abi_gen::abi::resolved::TypeResolver;
use abi_reflect::{format_reflection, Reflector};
use serde_json::json;
use std::fs;
use std::path::PathBuf;

fn reflector() -> Reflector {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../abi_gen/tests/compliance_tests/abi_definitions/account_root.abi.yaml");
    let abi: AbiFile =
        serde_yml::from_str(&fs::read_to_string(path).expect("read ABI")).expect("parse ABI");
    let roots = abi.root_types().clone();
    let mut resolver = TypeResolver::new();
    for typedef in abi.types {
        resolver.add_typedef(typedef);
    }
    resolver.resolve_all().expect("resolve ABI");
    Reflector::with_root_types(resolver, Default::default(), roots).expect("build reflector")
}

fn payload(r: &Reflector, ty: &str, data: &[u8]) -> serde_json::Value {
    let value = r
        .reflect(data, ty)
        .unwrap_or_else(|err| panic!("reflect {ty} {data:?}: {err}"));
    format_reflection(&value).value["payload"].clone()
}

#[test]
fn decodes_fixed_and_variable_size_roots() {
    let r = reflector();
    let counter = [1, 5, 0, 0, 0, 0, 0, 0, 0];
    let want_counter =
        json!({"variant": "counter_v1", "value": {"value": 5, "typeName": "CounterV1"}});
    assert_eq!(payload(&r, "SingleAccount", &counter), want_counter);
    assert_eq!(payload(&r, "SameSizeAccount", &counter), want_counter);
    assert_eq!(payload(&r, "MixedAccount", &counter), want_counter);
    assert_eq!(
        payload(&r, "SameSizeAccount", &[2, 7, 0, 0, 0, 0, 0, 0, 0]),
        json!({"variant": "gauge_v1", "value": {"reading": 7, "typeName": "GaugeV1"}})
    );
    assert_eq!(
        payload(&r, "MixedAccount", &[2, 2, 1, 0, 2, 0]),
        json!({"variant": "log_v1", "value": {"count": 2, "entries": [1, 2], "typeName": "LogV1"}})
    );
    /* reflect_account goes through the configured account-root. */
    assert!(r.reflect_account(&counter).is_ok());
}

#[test]
fn rejects_zeroed_unknown_and_truncated_accounts() {
    let r = reflector();
    for (ty, bad) in [
        ("SingleAccount", &[0u8, 5, 0, 0, 0, 0, 0, 0, 0][..]), /* type 0 is invalid */
        ("SingleAccount", &[2, 5, 0, 0, 0, 0, 0, 0, 0][..]),   /* unknown type */
        ("SingleAccount", &[1, 5, 0, 0][..]),                  /* truncated */
        ("SameSizeAccount", &[3, 5, 0, 0, 0, 0, 0, 0, 0][..]), /* unknown type */
        ("SameSizeAccount", &[0; 9][..]),                      /* zeroed */
        ("MixedAccount", &[2, 2, 1, 0][..]),                   /* log truncated */
        ("MixedAccount", &[0, 0][..]),                         /* zeroed */
    ] {
        assert!(r.reflect(bad, ty).is_err(), "{ty} accepted {bad:?}");
    }
}
