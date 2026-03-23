/* Parser tests for abi_reflect, focusing on complex ABI types like StateProof */

use abi_gen::abi::file::ImportResolver;
use abi_gen::abi::resolved::TypeResolver;
use abi_reflect::ir::ParamMap;
use abi_reflect::parser::Parser;
use abi_reflect::value::Value;
use std::path::PathBuf;

fn load_state_proof_resolver() -> TypeResolver {
    let type_library_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../type-library");
    let state_proof_path = type_library_dir.join("state_proof.abi.yaml");

    let mut resolver_loader = ImportResolver::new(vec![type_library_dir]);
    resolver_loader
        .load_file_with_imports(&state_proof_path, false)
        .expect("load state_proof ABI");

    let mut resolver = TypeResolver::new();
    for typedef in resolver_loader.get_all_types() {
        resolver.add_typedef(typedef.clone());
    }
    resolver.resolve_all().expect("resolve types");
    resolver
}

#[test]
fn state_proof_existing_variant_parses_correctly() {
    let resolver = load_state_proof_resolver();

    /* Build test data for StateProof with "existing" variant (tag = 0)
     *
     * StateProof layout:
     *   - hdr: StateProofHeader (40 bytes)
     *     - type_slot: u64 (bits 62-63 encode tag, 0 = existing)
     *     - path_bitset: Hash (32 bytes)
     *   - proof_body: enum (variable size based on tag)
     *     - existing variant: sibling_hashes array
     *       - array size = popcount(bytes[0]) + popcount(bytes[1]) + popcount(bytes[2]) + popcount(bytes[3])
     */
    let mut buffer = Vec::new();

    /* StateProofHeader: type_slot (u64) + path_bitset (Hash = 32 bytes) */
    let type_slot: u64 = 0; /* tag = (type_slot >> 62) & 3 = 0 (existing) */
    buffer.extend_from_slice(&type_slot.to_le_bytes());

    /* path_bitset: Hash with bytes[0..4] determining popcount
     * bytes[0] = 0x01 (popcount = 1)
     * bytes[1] = 0x03 (popcount = 2)
     * bytes[2] = 0x00 (popcount = 0)
     * bytes[3] = 0x00 (popcount = 0)
     * Total = 3 sibling_hashes */
    let mut path_bitset = [0u8; 32];
    path_bitset[0] = 0x01;
    path_bitset[1] = 0x03;
    buffer.extend_from_slice(&path_bitset);

    /* proof_body: "existing" variant with 3 sibling_hashes (3 * 32 = 96 bytes) */
    for i in 0..3u8 {
        let mut hash = [0u8; 32];
        hash[0] = i + 1; /* Make each hash distinct: 1, 2, 3 */
        buffer.extend_from_slice(&hash);
    }

    assert_eq!(buffer.len(), 136); /* 8 + 32 + 96 = 136 */

    /* Parse the StateProof */
    let state_proof_type = resolver
        .get_type_info("StateProof")
        .expect("StateProof type resolved");

    let params = ParamMap::new();
    let mut parser = Parser::new(&resolver, params);
    let reflected = parser
        .parse(&buffer, state_proof_type)
        .expect("parsing succeeds");

    assert_eq!(reflected.type_info.name, "StateProof");

    /* Verify the parsed structure */
    if let Value::Struct { fields } = &reflected.value {
        assert_eq!(fields.len(), 2);
        assert_eq!(fields[0].0, "hdr");
        assert_eq!(fields[1].0, "proof_body");

        /* Verify proof_body is the "existing" variant with 3 sibling_hashes */
        if let Value::Enum {
            variant_name,
            tag_value,
            variant_value,
        } = &fields[1].1.value
        {
            assert_eq!(variant_name, "existing");
            assert_eq!(*tag_value, 0);

            /* The variant value should be a struct with sibling_hashes field */
            if let Value::Struct {
                fields: variant_fields,
            } = &variant_value.value
            {
                assert_eq!(variant_fields.len(), 1);
                assert_eq!(variant_fields[0].0, "sibling_hashes");

                /* sibling_hashes should be an array with 3 elements */
                if let Value::Array { elements } = &variant_fields[0].1.value {
                    assert_eq!(elements.len(), 3, "Expected 3 sibling hashes");
                } else {
                    panic!("sibling_hashes should be an array");
                }
            } else {
                panic!("variant value should be a struct");
            }
        } else {
            panic!("proof_body should be an enum");
        }
    } else {
        panic!("StateProof should be a struct");
    }
}

#[test]
fn state_proof_updating_variant_parses_correctly() {
    let resolver = load_state_proof_resolver();

    let mut buffer = Vec::new();

    /* type_slot with tag = 1 (updating): (1 << 62) */
    let type_slot: u64 = 1 << 62;
    buffer.extend_from_slice(&type_slot.to_le_bytes());

    /* path_bitset with 2 bits set: bytes[0] = 0x03 (popcount = 2) */
    let mut path_bitset = [0u8; 32];
    path_bitset[0] = 0x03;
    buffer.extend_from_slice(&path_bitset);

    /* updating variant: existing_leaf_hash (32 bytes) + sibling_hashes (2 * 32 = 64 bytes) */
    let existing_leaf_hash = [0xAAu8; 32];
    buffer.extend_from_slice(&existing_leaf_hash);

    for i in 0..2u8 {
        let mut hash = [0u8; 32];
        hash[0] = 0xBB + i;
        buffer.extend_from_slice(&hash);
    }

    assert_eq!(buffer.len(), 136); /* 8 + 32 + 32 + 64 = 136 */

    let state_proof_type = resolver
        .get_type_info("StateProof")
        .expect("StateProof type resolved");

    let params = ParamMap::new();
    let mut parser = Parser::new(&resolver, params);
    let reflected = parser
        .parse(&buffer, state_proof_type)
        .expect("parsing succeeds");

    if let Value::Struct { fields } = &reflected.value {
        if let Value::Enum {
            variant_name,
            tag_value,
            variant_value,
        } = &fields[1].1.value
        {
            assert_eq!(variant_name, "updating");
            assert_eq!(*tag_value, 1);

            if let Value::Struct {
                fields: variant_fields,
            } = &variant_value.value
            {
                assert_eq!(variant_fields.len(), 2);
                assert_eq!(variant_fields[0].0, "existing_leaf_hash");
                assert_eq!(variant_fields[1].0, "sibling_hashes");

                if let Value::Array { elements } = &variant_fields[1].1.value {
                    assert_eq!(elements.len(), 2, "Expected 2 sibling hashes");
                } else {
                    panic!("sibling_hashes should be an array");
                }
            } else {
                panic!("variant value should be a struct");
            }
        } else {
            panic!("proof_body should be an enum");
        }
    } else {
        panic!("StateProof should be a struct");
    }
}

#[test]
fn state_proof_creation_variant_parses_correctly() {
    let resolver = load_state_proof_resolver();

    let mut buffer = Vec::new();

    /* type_slot with tag = 2 (creation): (2 << 62) */
    let type_slot: u64 = 2 << 62;
    buffer.extend_from_slice(&type_slot.to_le_bytes());

    /* path_bitset with 1 bit set: bytes[0] = 0x01 (popcount = 1) */
    let mut path_bitset = [0u8; 32];
    path_bitset[0] = 0x01;
    buffer.extend_from_slice(&path_bitset);

    /* creation variant: existing_leaf_pubkey (32) + existing_leaf_hash (32) + sibling_hashes (1 * 32) */
    let existing_leaf_pubkey = [0xCCu8; 32];
    buffer.extend_from_slice(&existing_leaf_pubkey);

    let existing_leaf_hash = [0xDDu8; 32];
    buffer.extend_from_slice(&existing_leaf_hash);

    let sibling_hash = [0xEEu8; 32];
    buffer.extend_from_slice(&sibling_hash);

    assert_eq!(buffer.len(), 136); /* 8 + 32 + 32 + 32 + 32 = 136 */

    let state_proof_type = resolver
        .get_type_info("StateProof")
        .expect("StateProof type resolved");

    let params = ParamMap::new();
    let mut parser = Parser::new(&resolver, params);
    let reflected = parser
        .parse(&buffer, state_proof_type)
        .expect("parsing succeeds");

    if let Value::Struct { fields } = &reflected.value {
        if let Value::Enum {
            variant_name,
            tag_value,
            variant_value,
        } = &fields[1].1.value
        {
            assert_eq!(variant_name, "creation");
            assert_eq!(*tag_value, 2);

            if let Value::Struct {
                fields: variant_fields,
            } = &variant_value.value
            {
                assert_eq!(variant_fields.len(), 3);
                assert_eq!(variant_fields[0].0, "existing_leaf_pubkey");
                assert_eq!(variant_fields[1].0, "existing_leaf_hash");
                assert_eq!(variant_fields[2].0, "sibling_hashes");

                if let Value::Array { elements } = &variant_fields[2].1.value {
                    assert_eq!(elements.len(), 1, "Expected 1 sibling hash");
                } else {
                    panic!("sibling_hashes should be an array");
                }
            } else {
                panic!("variant value should be a struct");
            }
        } else {
            panic!("proof_body should be an enum");
        }
    } else {
        panic!("StateProof should be a struct");
    }
}

#[test]
fn state_proof_popcount_sums_multiple_bytes() {
    /* Test that popcount correctly sums across bytes[0..4] */
    let resolver = load_state_proof_resolver();

    let mut buffer = Vec::new();

    let type_slot: u64 = 0; /* existing variant */
    buffer.extend_from_slice(&type_slot.to_le_bytes());

    /* Set all 4 bytes to have different popcounts:
     * bytes[0] = 0xFF (8 bits)
     * bytes[1] = 0x0F (4 bits)
     * bytes[2] = 0x07 (3 bits)
     * bytes[3] = 0x01 (1 bit)
     * Total = 16 sibling_hashes */
    let mut path_bitset = [0u8; 32];
    path_bitset[0] = 0xFF;
    path_bitset[1] = 0x0F;
    path_bitset[2] = 0x07;
    path_bitset[3] = 0x01;
    buffer.extend_from_slice(&path_bitset);

    /* Add 16 sibling hashes */
    for i in 0..16u8 {
        let mut hash = [0u8; 32];
        hash[0] = i;
        buffer.extend_from_slice(&hash);
    }

    assert_eq!(buffer.len(), 40 + 16 * 32); /* header (40) + 16 hashes (512) = 552 */

    let state_proof_type = resolver
        .get_type_info("StateProof")
        .expect("StateProof type resolved");

    let params = ParamMap::new();
    let mut parser = Parser::new(&resolver, params);
    let reflected = parser
        .parse(&buffer, state_proof_type)
        .expect("parsing succeeds");

    if let Value::Struct { fields } = &reflected.value {
        if let Value::Enum { variant_value, .. } = &fields[1].1.value {
            if let Value::Struct {
                fields: variant_fields,
            } = &variant_value.value
            {
                if let Value::Array { elements } = &variant_fields[0].1.value {
                    assert_eq!(
                        elements.len(),
                        16,
                        "Expected 16 sibling hashes (8+4+3+1 popcount)"
                    );
                } else {
                    panic!("sibling_hashes should be an array");
                }
            } else {
                panic!("variant value should be a struct");
            }
        } else {
            panic!("proof_body should be an enum");
        }
    } else {
        panic!("StateProof should be a struct");
    }
}
