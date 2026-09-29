use abi_gen::abi::file::AbiFile;
use abi_gen::abi::resolved::TypeResolver;
use abi_reflect::{ReflectError, Reflector};

#[test]
fn reports_actual_input_length_for_truncated_dynamic_array() {
    let abi: AbiFile = serde_yml::from_str(include_str!("fixtures/buffer_size.abi.yaml"))
        .expect("parse ABI fixture");
    let mut resolver = TypeResolver::new();
    for typedef in abi.types {
        resolver.add_typedef(typedef);
    }
    resolver.resolve_all().expect("resolve ABI fixture");
    let reflector = Reflector::new(resolver).expect("build reflector");

    let mut bytes = 12u32.to_le_bytes().to_vec();
    bytes.extend_from_slice(&[0; 12]);
    let error = reflector.reflect(&bytes, "Payload").unwrap_err();

    assert_eq!(
        error.to_string(),
        "type 'Payload' requires 48 bytes but only 16 available"
    );
    assert!(matches!(
        error,
        ReflectError::BufferTooSmall {
            required: 48,
            available: 16,
            ..
        }
    ));
}
