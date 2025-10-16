// Thru public address encode/decode, translated from C
// See: tn_public_address_encode and tn_public_address_decode

use sha2::{Digest, Sha256};

const BASE64_URL_ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/// Encodes a 32-byte public key into a 46-character address string (ta...)
/// Output buffer must be at least 46 bytes.
pub fn tn_public_address_encode(out: &mut [u8], input: &[u8; 32]) {
    let mut checksum: u64 = 0;
    out[0] = b't';
    out[1] = b'a';

    let mut encoded_len = 2;
    let mut accumulator: u32 = 0;
    let mut bits_collected = 0;
    let mut data_len = 30;
    let mut data_idx = 0;

    while data_len > 0 {
        checksum += input[data_idx] as u64;
        accumulator = (accumulator << 8) | input[data_idx] as u32;
        bits_collected += 8;
        data_idx += 1;
        data_len -= 1;

        while bits_collected >= 6 {
            out[encoded_len] =
                BASE64_URL_ALPHABET[((accumulator >> (bits_collected - 6)) & 0x3F) as usize];
            encoded_len += 1;
            bits_collected -= 6;
        }
    }
    // last two bytes and checksum
    checksum += input[data_idx] as u64;
    accumulator = (accumulator << 8) | input[data_idx] as u32;
    bits_collected += 8;
    data_idx += 1;
    checksum += input[data_idx] as u64;
    accumulator = (accumulator << 8) | input[data_idx] as u32;
    bits_collected += 8;
    accumulator = (accumulator << 8) | ((checksum & 0xFF) as u32);
    bits_collected += 8;

    while bits_collected >= 6 {
        out[encoded_len] =
            BASE64_URL_ALPHABET[((accumulator >> (bits_collected - 6)) & 0x3F) as usize];
        encoded_len += 1;
        bits_collected -= 6;
    }
}

/// Decodes a 46-character address string (ta...) into a 32-byte public key.
/// Returns Ok(()) on success, or Err(error_code) on failure.
pub fn tn_public_address_decode(out: &mut [u8; 32], input: &[u8]) -> Result<(), i32> {
    if input.len() != 46 {
        return Err(-1);
    }
    if input[0] != b't' || input[1] != b'a' {
        return Err(-2);
    }
    let mut in_sz = 40;
    let mut in_idx = 2;
    let mut checksum: u64 = 0;
    let mut out_idx = 0;

    // Inverse lookup table for base64-url
    let mut invlut = [0xFFu8; 256];
    for (i, &b) in BASE64_URL_ALPHABET.iter().enumerate() {
        invlut[b as usize] = i as u8;
    }

    while in_sz >= 4 {
        let a = invlut[input[in_idx + 0] as usize] as i32;
        let b = invlut[input[in_idx + 1] as usize] as i32;
        let c = invlut[input[in_idx + 2] as usize] as i32;
        let d = invlut[input[in_idx + 3] as usize] as i32;
        if a < 0 || b < 0 || c < 0 || d < 0 {
            return Err(-3);
        }
        let triple = ((a as u32) << 18) | ((b as u32) << 12) | ((c as u32) << 6) | (d as u32);
        let temp1 = ((triple >> 16) & 0xFF) as u8;
        checksum += temp1 as u64;
        out[out_idx] = temp1;
        out_idx += 1;
        let temp2 = ((triple >> 8) & 0xFF) as u8;
        checksum += temp2 as u64;
        out[out_idx] = temp2;
        out_idx += 1;
        let temp3 = (triple & 0xFF) as u8;
        checksum += temp3 as u64;
        out[out_idx] = temp3;
        out_idx += 1;
        in_idx += 4;
        in_sz -= 4;
    }
    let a = invlut[input[in_idx + 0] as usize] as i32;
    let b = invlut[input[in_idx + 1] as usize] as i32;
    let c = invlut[input[in_idx + 2] as usize] as i32;
    let d = invlut[input[in_idx + 3] as usize] as i32;
    if a < 0 || b < 0 || c < 0 || d < 0 {
        return Err(-4);
    }
    let triple = ((a as u32) << 18) | ((b as u32) << 12) | ((c as u32) << 6) | (d as u32);
    let temp1 = ((triple >> 16) & 0xFF) as u8;
    checksum += temp1 as u64;
    out[out_idx] = temp1;
    out_idx += 1;
    let temp2 = ((triple >> 8) & 0xFF) as u8;
    checksum += temp2 as u64;
    out[out_idx] = temp2;
    let incoming_checksum = (triple & 0xFF) as u8;
    checksum = checksum & 0xFF;
    if checksum as u8 != incoming_checksum {
        return Err(-5);
    }
    Ok(())
}

/// Helper to encode a 32-byte public key as a public address string (ta...)
pub fn tn_pubkey_to_address_string(pubkey: &[u8; 32]) -> String {
    let mut out = [0u8; 46];
    tn_public_address_encode(&mut out, pubkey);
    // SAFETY: All bytes are valid ASCII, so this is safe
    String::from_utf8_lossy(&out).to_string()
}

/// Creates a program-defined account address using SHA-256 hash
/// Translates the C function create_program_defined_account_address from tn_vm_syscalls.c
///
/// Note: The C implementation always uses exactly 32-byte seeds via tn_vm_pack_seed()
/// which packs 4 ulong arguments (4 × 8 bytes = 32 bytes) into the seed.
///
/// # Arguments
/// * `owner` - The owner pubkey (32 bytes)
/// * `is_ephemeral` - Whether the account is ephemeral (1 byte: 0 or 1)
/// * `seed` - The seed bytes (exactly 32 bytes)
///
/// # Returns
/// A 32-byte account address derived from SHA-256(owner || is_ephemeral || seed)
pub fn create_program_defined_account_address(
    owner: &[u8; 32],
    is_ephemeral: bool,
    seed: &[u8; 32],
) -> [u8; 32] {
    let mut hasher = Sha256::new();

    // Hash owner pubkey (32 bytes)
    hasher.update(owner);

    // Hash is_ephemeral flag (1 byte)
    hasher.update(&[if is_ephemeral { 1u8 } else { 0u8 }]);

    // Hash seed bytes (always 32 bytes in C implementation)
    hasher.update(seed);

    // Finalize to get 32-byte result
    let result = hasher.finalize();
    let mut pubkey = [0u8; 32];
    pubkey.copy_from_slice(&result);

    pubkey
}

/// Helper to create a program-defined account address and return it as an address string
pub fn create_program_defined_account_address_string(
    owner: &[u8; 32],
    is_ephemeral: bool,
    seed: &[u8; 32],
) -> String {
    let pubkey = create_program_defined_account_address(owner, is_ephemeral, seed);
    tn_pubkey_to_address_string(&pubkey)
}

/// Creates a 32-byte seed from 4 u64 values, matching tn_vm_pack_seed() from C
/// This replicates the exact packing behavior used in the VM syscalls
pub fn pack_seed(arg0: u64, arg1: u64, arg2: u64, arg3: u64) -> [u8; 32] {
    let mut seed = [0u8; 32];
    seed[0..8].copy_from_slice(&arg0.to_le_bytes());
    seed[8..16].copy_from_slice(&arg1.to_le_bytes());
    seed[16..24].copy_from_slice(&arg2.to_le_bytes());
    seed[24..32].copy_from_slice(&arg3.to_le_bytes());
    seed
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::RngCore;

    #[test]
    fn test_public_address_encoder() {
        let mut rng = rand::rng();
        let mut pub_key = [0u8; 32];
        let mut decoded_pub_key = [0u8; 32];
        let mut encoded_pub = [0u8; 64]; // plenty of space
        for _ in 0..10_000 {
            rng.fill_bytes(&mut pub_key);
            // Encode
            encoded_pub.fill(0);
            tn_public_address_encode(&mut encoded_pub, &pub_key);
            // The encoded address is always 46 bytes
            let encoded_slice = &encoded_pub[..46];
            // Decode
            let res = tn_public_address_decode(&mut decoded_pub_key, encoded_slice);
            assert!(res.is_ok(), "decode failed: {:?}", res);
            assert_eq!(pub_key, decoded_pub_key, "roundtrip mismatch");
        }
        // Corrupt checksum
        let mut corrupted = [0u8; 64];
        rng.fill_bytes(&mut pub_key);
        tn_public_address_encode(&mut corrupted, &pub_key);
        let encoded_slice = &mut corrupted[..46];
        // Flip last byte
        encoded_slice[45] = if encoded_slice[45] == b'A' {
            b'B'
        } else {
            b'A'
        };
        let res = tn_public_address_decode(&mut decoded_pub_key, encoded_slice);
        assert_eq!(res, Err(-5), "corrupt checksum should fail with -5");
    }

    #[test]
    fn test_create_program_defined_account_address() {
        // Test with known values to ensure consistency
        let owner = [1u8; 32];
        let seed = pack_seed(
            0x1234567890abcdef,
            0xfedcba0987654321,
            0x1111111111111111,
            0x2222222222222222,
        );

        // Test non-ephemeral account
        let addr1 = create_program_defined_account_address(&owner, false, &seed);
        let addr2 = create_program_defined_account_address(&owner, false, &seed);
        assert_eq!(addr1, addr2, "Same inputs should produce same address");

        // Test ephemeral account
        let addr3 = create_program_defined_account_address(&owner, true, &seed);
        assert_ne!(addr1, addr3, "Ephemeral flag should change the address");

        // Test different seed
        let different_seed = pack_seed(
            0xaaaaaaaaaaaaaaaa,
            0xbbbbbbbbbbbbbbbb,
            0xcccccccccccccccc,
            0xdddddddddddddddd,
        );
        let addr4 = create_program_defined_account_address(&owner, false, &different_seed);
        assert_ne!(
            addr1, addr4,
            "Different seed should produce different address"
        );

        // Test different owner
        let different_owner = [2u8; 32];
        let addr5 = create_program_defined_account_address(&different_owner, false, &seed);
        assert_ne!(
            addr1, addr5,
            "Different owner should produce different address"
        );

        // Test address string conversion
        let addr_string = create_program_defined_account_address_string(&owner, false, &seed);
        assert!(
            addr_string.starts_with("ta"),
            "Address string should start with 'ta'"
        );
        assert_eq!(
            addr_string.len(),
            46,
            "Address string should be 46 characters"
        );
    }

    #[test]
    fn test_ephemeral_account_addresses() {
        // Test system program (all zeros) with ephemeral flag
        let system_program = [0u8; 32];
        let seed = pack_seed(
            0x1111111111111111,
            0x2222222222222222,
            0x3333333333333333,
            0x4444444444444444,
        );

        let ephemeral_addr = create_program_defined_account_address(&system_program, true, &seed);
        let persistent_addr = create_program_defined_account_address(&system_program, false, &seed);

        assert_ne!(
            ephemeral_addr, persistent_addr,
            "Ephemeral and persistent addresses should differ"
        );

        // Test that the address is deterministic
        let ephemeral_addr2 = create_program_defined_account_address(&system_program, true, &seed);
        assert_eq!(
            ephemeral_addr, ephemeral_addr2,
            "Ephemeral address should be deterministic"
        );
    }

    #[test]
    fn test_pack_seed() {
        // Test that pack_seed produces expected 32-byte arrays
        let seed = pack_seed(
            0x1234567890abcdef,
            0xfedcba0987654321,
            0xaaaaaaaaaaaaaaaa,
            0xbbbbbbbbbbbbbbbb,
        );
        assert_eq!(seed.len(), 32, "Packed seed should be exactly 32 bytes");

        // Test little-endian packing (matching C implementation)
        assert_eq!(&seed[0..8], &0x1234567890abcdefu64.to_le_bytes());
        assert_eq!(&seed[8..16], &0xfedcba0987654321u64.to_le_bytes());
        assert_eq!(&seed[16..24], &0xaaaaaaaaaaaaaaaau64.to_le_bytes());
        assert_eq!(&seed[24..32], &0xbbbbbbbbbbbbbbbbu64.to_le_bytes());

        // Test that different inputs produce different seeds
        let seed2 = pack_seed(1, 2, 3, 4);
        assert_ne!(
            seed, seed2,
            "Different inputs should produce different seeds"
        );

        // Test that same inputs produce same seeds
        let seed3 = pack_seed(
            0x1234567890abcdef,
            0xfedcba0987654321,
            0xaaaaaaaaaaaaaaaa,
            0xbbbbbbbbbbbbbbbb,
        );
        assert_eq!(seed, seed3, "Same inputs should produce same seeds");
    }
}
