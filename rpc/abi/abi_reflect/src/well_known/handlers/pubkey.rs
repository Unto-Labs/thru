/* Handler for Pubkey type */

use super::try_extract_bytes_field;
use crate::well_known::traits::{WellKnownContext, WellKnownResult, WellKnownType};
use serde_json::{Map, Value as JsonValue};

const BASE64_URL_ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/* Handler for 32-byte Pubkey values */
pub struct PubkeyHandler;

impl WellKnownType for PubkeyHandler {
    fn type_name(&self) -> &'static str {
        "Pubkey"
    }

    fn display_key(&self) -> Option<(&'static str, &'static str)> {
        Some(("address", "address"))
    }

    fn process(&self, ctx: &WellKnownContext) -> WellKnownResult {
        let Some(fields) = ctx.fields else {
            return WellKnownResult::None;
        };

        if let Some(pubkey_bytes) = try_extract_bytes_field(fields, 32) {
            if let Some(address) = encode_thru_address(&pubkey_bytes) {
                let mut enrichment = Map::new();
                enrichment.insert("address".to_string(), JsonValue::String(address));
                return WellKnownResult::EnrichFields(enrichment);
            }
        }

        WellKnownResult::None
    }
}

/* Decode a Thru address (ta... format) to its 32 bytes, checking the
 * checksum by encoding them again. */
pub fn decode_thru_address(address: &str) -> Option<[u8; 32]> {
    let body = address.strip_prefix("ta")?;
    if body.len() != 44 {
        return None;
    }
    let mut out = Vec::with_capacity(33);
    let mut accumulator: u32 = 0;
    let mut bits: u32 = 0;
    for c in body.bytes() {
        let index = BASE64_URL_ALPHABET.iter().position(|&a| a == c)? as u32;
        accumulator = (accumulator << 6) | index;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((accumulator >> bits) as u8);
            accumulator &= mask_for_bits(bits);
        }
    }
    let key: [u8; 32] = out.get(..32)?.try_into().ok()?;
    (encode_thru_address(&key)? == address).then_some(key)
}

/* Encode 32 bytes as a Thru address (ta... format) */
pub fn encode_thru_address(bytes: &[u8]) -> Option<String> {
    if bytes.len() != 32 {
        return None;
    }

    let mut output = String::with_capacity(46);
    output.push('t');
    output.push('a');

    let mut checksum: u32 = 0;
    let mut accumulator: u32 = 0;
    let mut bits_collected: u32 = 0;

    for i in 0..30 {
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

    let second_last = bytes[30] as u32;
    checksum += second_last;
    accumulator = (accumulator << 8) | second_last;
    bits_collected += 8;

    let last = bytes[31] as u32;
    checksum += last;
    accumulator = (accumulator << 8) | last;
    bits_collected += 8;

    accumulator = (accumulator << 8) | (checksum & 0xff);
    bits_collected += 8;

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

    fn hex_to_bytes(hex: &str) -> Vec<u8> {
        let cleaned: String = hex.chars().filter(|c| !c.is_whitespace()).collect();
        (0..cleaned.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&cleaned[i..i + 2], 16).expect("valid hex"))
            .collect()
    }

    #[test]
    fn encode_thru_address_zeros() {
        let bytes = [0u8; 32];
        let address = encode_thru_address(&bytes).expect("should encode");
        assert_eq!(address, "taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
        assert_eq!(address.len(), 46, "thru addresses are always 46 characters");
    }

    #[test]
    fn encode_thru_address_mint_bytes() {
        let bytes =
            hex_to_bytes("906b582852c5940dfe2664bc77717eb62e05e9c5b5b5c8d59cd4756d5c3dd771");
        let address = encode_thru_address(&bytes).expect("should encode");
        assert_eq!(address, "takGtYKFLFlA3-JmS8d3F-ti4F6cW1tcjVnNR1bVw913Gu");
    }

    #[test]
    fn encode_thru_address_owner_bytes() {
        let bytes =
            hex_to_bytes("ace7124bd312557a711a15c92d38a2d7e0d2fbf6ede3092df4a543d0a00122ae");
        let address = encode_thru_address(&bytes).expect("should encode");
        assert_eq!(address, "tarOcSS9MSVXpxGhXJLTii1-DS-_bt4wkt9KVD0KABIq6x");
    }

    #[test]
    fn decode_inverts_encode() {
        let bytes: Vec<u8> = (0u8..32).collect();
        let address = encode_thru_address(&bytes).unwrap();
        assert_eq!(decode_thru_address(&address).unwrap().to_vec(), bytes);
        let mut tampered = address.clone().into_bytes();
        tampered[10] = if tampered[10] == b'A' { b'B' } else { b'A' };
        assert!(decode_thru_address(&String::from_utf8(tampered).unwrap()).is_none());
        assert!(decode_thru_address("tashort").is_none());
    }

    #[test]
    fn encode_thru_address_wrong_length_returns_none() {
        let short = [0u8; 31];
        assert!(encode_thru_address(&short).is_none());

        let long = [0u8; 33];
        assert!(encode_thru_address(&long).is_none());
    }
}
