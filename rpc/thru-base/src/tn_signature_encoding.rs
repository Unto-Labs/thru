// Thru signature encode/decode, translated from C
// See: tn_signature_encode and tn_signature_decode

const BASE64_URL_ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/// Encodes a 64-byte signature into a 90-character string (ts...)
/// Output buffer must be at least 90 bytes.
pub fn tn_signature_encode(out: &mut [u8], input: &[u8; 64]) {
    let mut checksum: u64 = 0;
    out[0] = b't';
    out[1] = b's';

    let mut encoded_len = 2;
    let mut accumulator: u32 = 0;
    let mut bits_collected = 0;
    let mut data_len = 63;
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
    // last byte and checksum (16 bits)
    checksum += input[data_idx] as u64;
    accumulator = (accumulator << 8) | input[data_idx] as u32;
    bits_collected += 8;
    accumulator = (accumulator << 16) | ((checksum & 0xFFFF) as u32);
    bits_collected += 16;

    while bits_collected >= 6 {
        out[encoded_len] =
            BASE64_URL_ALPHABET[((accumulator >> (bits_collected - 6)) & 0x3F) as usize];
        encoded_len += 1;
        bits_collected -= 6;
    }
}

/// Decodes a 90-character signature string (ts...) into a 64-byte signature.
/// Returns Ok(()) on success, or Err(error_code) on failure.
pub fn tn_signature_decode(out: &mut [u8; 64], input: &[u8]) -> Result<(), i32> {
    if input.len() != 90 {
        return Err(-1);
    }
    if input[0] != b't' || input[1] != b's' {
        return Err(-2);
    }
    let mut in_sz = 84;
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
    let incoming_checksum = (triple & 0xFFFF) as u16;
    checksum = checksum & 0xFFFF;
    if checksum as u16 != incoming_checksum {
        return Err(-5);
    }
    Ok(())
}

/// Helper to encode a 64-byte signature as a string (ts...)
pub fn tn_signature_to_string(signature: &[u8; 64]) -> String {
    let mut out = [0u8; 90];
    tn_signature_encode(&mut out, signature);
    // SAFETY: All bytes are valid ASCII, so this is safe
    String::from_utf8_lossy(&out).to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::RngCore;

    #[test]
    fn test_signature_encoder() {
        let mut rng = rand::rng();
        let mut signature = [0u8; 64];
        let mut decoded_signature = [0u8; 64];
        let mut encoded_signature = [0u8; 128]; // plenty of space
        for _ in 0..10_000 {
            rng.fill_bytes(&mut signature);
            // Encode
            encoded_signature.fill(0);
            tn_signature_encode(&mut encoded_signature, &signature);
            let encoded_slice = &encoded_signature[..90];
            // Decode
            let res = tn_signature_decode(&mut decoded_signature, encoded_slice);
            assert!(res.is_ok(), "decode failed: {:?}", res);
            assert_eq!(signature, decoded_signature, "roundtrip mismatch");
        }
        // Corrupt checksum
        let mut corrupted = [0u8; 128];
        rng.fill_bytes(&mut signature);
        tn_signature_encode(&mut corrupted, &signature);
        let encoded_slice = &mut corrupted[..90];
        // Flip a byte in the checksum (last two bytes)
        encoded_slice[88] = if encoded_slice[88] == b'A' {
            b'B'
        } else {
            b'A'
        };
        let res = tn_signature_decode(&mut decoded_signature, encoded_slice);
        assert_eq!(res, Err(-5), "corrupt checksum should fail with -5");
    }
}
