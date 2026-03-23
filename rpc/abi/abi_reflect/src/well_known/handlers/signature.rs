/* Handler for Signature type */

use super::try_extract_bytes_field;
use crate::well_known::traits::{WellKnownContext, WellKnownResult, WellKnownType};
use serde_json::{Map, Value as JsonValue};

const BASE64_URL_ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/* Handler for 64-byte Signature values */
pub struct SignatureHandler;

impl WellKnownType for SignatureHandler {
    fn type_name(&self) -> &'static str {
        "Signature"
    }

    fn process(&self, ctx: &WellKnownContext) -> WellKnownResult {
        let Some(fields) = ctx.fields else {
            return WellKnownResult::None;
        };

        if let Some(sig_bytes) = try_extract_bytes_field(fields, 64) {
            if let Some(signature) = encode_thru_signature(&sig_bytes) {
                let mut enrichment = Map::new();
                enrichment.insert("signature".to_string(), JsonValue::String(signature));
                return WellKnownResult::EnrichFields(enrichment);
            }
        }

        WellKnownResult::None
    }
}

/* Encode 64 bytes as a Thru signature (ts... format) */
pub fn encode_thru_signature(bytes: &[u8]) -> Option<String> {
    if bytes.len() != 64 {
        return None;
    }

    let mut output = String::with_capacity(90);
    output.push('t');
    output.push('s');

    let mut checksum: u32 = 0;
    let mut accumulator: u32 = 0;
    let mut bits_collected: u32 = 0;

    for i in 0..63 {
        let byte = bytes[i] as u32;
        checksum += byte;
        accumulator = (accumulator << 8) | byte;
        bits_collected += 8;
        while bits_collected >= 6 {
            let index = (accumulator >> (bits_collected - 6)) & 0x3f;
            output.push(BASE64_URL_ALPHABET[index as usize] as char);
            bits_collected -= 6;
            accumulator &= mask_for_bits(bits_collected);
        }
    }

    let last_byte = bytes[63] as u32;
    checksum += last_byte;
    accumulator = (accumulator << 8) | last_byte;
    bits_collected += 8;

    accumulator = (accumulator << 16) | (checksum & 0xffff);
    bits_collected += 16;

    while bits_collected >= 6 {
        let index = (accumulator >> (bits_collected - 6)) & 0x3f;
        output.push(BASE64_URL_ALPHABET[index as usize] as char);
        bits_collected -= 6;
        accumulator &= mask_for_bits(bits_collected);
    }

    Some(output)
}

fn mask_for_bits(bits: u32) -> u32 {
    if bits == 0 {
        0
    } else {
        (1 << bits) - 1
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_thru_signature_zeros() {
        let bytes = [0u8; 64];
        let sig = encode_thru_signature(&bytes).expect("should encode");
        assert_eq!(
            sig,
            "tsAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
        );
        assert_eq!(sig.len(), 90, "thru signatures are always 90 characters");
    }

    #[test]
    fn encode_thru_signature_sequential() {
        let mut bytes = [0u8; 64];
        for i in 0..64 {
            bytes[i] = i as u8;
        }
        let sig = encode_thru_signature(&bytes).expect("should encode");
        assert_eq!(
            sig,
            "tsAAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8gISIjJCUmJygpKissLS4vMDEyMzQ1Njc4OTo7PD0-Pwfg"
        );
    }

    #[test]
    fn encode_thru_signature_all_ff() {
        let bytes = [0xffu8; 64];
        let sig = encode_thru_signature(&bytes).expect("should encode");
        assert_eq!(
            sig,
            "ts_____________________________________________________________________________________z_A"
        );
    }

    #[test]
    fn encode_thru_signature_wrong_length_returns_none() {
        let short = [0u8; 63];
        assert!(encode_thru_signature(&short).is_none());

        let long = [0u8; 65];
        assert!(encode_thru_signature(&long).is_none());
    }
}
