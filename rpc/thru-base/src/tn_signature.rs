//! Standardized Thru Ed25519 signing: RFC-8032 Ed25519 over a domain-separated
//! message `M = DST_domain ‖ context`, where `DST_domain` is a fixed 16-byte
//! ASCII tag.  This is byte-identical to any stock Ed25519 signer over `M`
//! (HSM / MPC / SDK), unlike the previous non-standard in-hash-domain scheme.
//! See specs/mpc-hsm-signer-design.md §4.1.

use ed25519_dalek::{Signature, Signer, SigningKey, VerifyingKey};
use sha2::{Digest, Sha256};
use std::fmt;

/// Field prime p = 2^255 - 19, little-endian.
const P_LE: [u8; 32] = [
    0xED, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
    0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0x7F,
];

/// A 32-byte little-endian Ed25519 point encoding is canonical iff its
/// y-coordinate (sign bit masked off) is `< p`.
fn enc_is_canonical(enc: &[u8; 32]) -> bool {
    let mut y = *enc;
    y[31] &= 0x7F;
    for i in (0..32).rev() {
        if y[i] != P_LE[i] {
            return y[i] < P_LE[i];
        }
    }
    false // y == p is non-canonical
}

/// Signing domain enum -- byte-for-byte in step with `tn_signature_domain_t`
/// in `src/thru/util/tn_signature.h` (variants must not be reordered).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum SignatureDomain {
    Transaction = 0,
    BlockHeader = 1,
    Block = 2,
    Gossip = 3,
    NodeRecord = 4,
    EoaCreate = 5,
    EoaDelete = 6,
    /// Generic wallet / user message signing (see `sign_message`).
    Msg = 7,
}

impl SignatureDomain {
    /// Fixed 16-byte ASCII domain-separation tag.  Where the version suffix is
    /// shorter than the tag width, the tag is padded with trailing '_' rather
    /// than zero-digits (e.g. `v1__`, not `v001`).  This table is the Rust
    /// mirror of the C `tn_signature_dst_table[]` in
    /// `src/thru/util/tn_signature.c` and must be kept in step with it.
    pub fn dst(self) -> &'static [u8; 16] {
        match self {
            SignatureDomain::Transaction => b"tn_txn_sign_v1__",
            SignatureDomain::BlockHeader => b"tn_blkhdr_sig_v1",
            SignatureDomain::Block       => b"tn_block_sig_v1_",
            SignatureDomain::Gossip      => b"tn_gossip_sig_v1",
            SignatureDomain::NodeRecord  => b"tn_node_rec_v1__",
            SignatureDomain::EoaCreate   => b"tn_eoa_create_v1",
            SignatureDomain::EoaDelete   => b"tn_eoa_delete_v1",
            SignatureDomain::Msg         => b"tn_msg_sign_v1__",
        }
    }
}

#[derive(Debug)]
pub enum TnSignatureError {
    InvalidSignature,
    InvalidPublicKey,
    InvalidScalar,
}

impl fmt::Display for TnSignatureError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            TnSignatureError::InvalidSignature => write!(f, "invalid signature"),
            TnSignatureError::InvalidPublicKey => write!(f, "invalid public key"),
            TnSignatureError::InvalidScalar => write!(f, "invalid scalar"),
        }
    }
}

impl std::error::Error for TnSignatureError {}

/// `M = DST_domain ‖ context`.  For the transaction domain the context is
/// `SHA-256(msg)`; for the others it is `msg` verbatim.
fn build_msg(domain: SignatureDomain, msg: &[u8]) -> Vec<u8> {
    let dst = domain.dst();
    match domain {
        // TXN signs DST ‖ SHA-256(body): a fixed 48 bytes regardless of body size.
        SignatureDomain::Transaction => {
            let digest = Sha256::digest(msg);
            let mut m = Vec::with_capacity(dst.len() + digest.len());
            m.extend_from_slice(dst);
            m.extend_from_slice(&digest);
            m
        }
        // Other domains prefix the raw context (e.g. the 104-byte block header),
        // so size to msg.len() to avoid a reallocation on extend.
        _ => {
            let mut m = Vec::with_capacity(dst.len() + msg.len());
            m.extend_from_slice(dst);
            m.extend_from_slice(msg);
            m
        }
    }
}

/// Sign `M = DST_domain ‖ context` with standard RFC-8032 Ed25519.  The public
/// key is derived from `private_key`; the `public_key` argument is accepted for
/// API parity but not used (a correct keypair yields the same bytes).
pub fn sign(
    domain: SignatureDomain,
    msg: &[u8],
    public_key: &[u8; 32],
    private_key: &[u8; 32],
) -> Result<[u8; 64], TnSignatureError> {
    let signing_key = SigningKey::from_bytes(private_key);
    // Require the supplied public key equals the one derived from the seed, then
    // sign with the derived key (byte-identical across langs; mismatch = error).
    if signing_key.verifying_key().to_bytes() != *public_key {
        return Err(TnSignatureError::InvalidPublicKey);
    }
    let m = build_msg(domain, msg);
    let sig: Signature = signing_key.sign(&m);
    Ok(sig.to_bytes())
}

/// Verify under the Thru strict/canonical policy: reject non-canonical `A`/`R`
/// encodings, then `verify_strict` (canonical `S`, small-order rejection,
/// cofactorless) over `M = DST_domain ‖ context`.
pub fn verify(
    domain: SignatureDomain,
    msg: &[u8],
    sig: &[u8; 64],
    public_key: &[u8; 32],
) -> Result<(), TnSignatureError> {
    if !enc_is_canonical(public_key) {
        return Err(TnSignatureError::InvalidPublicKey);
    }
    let r_bytes: [u8; 32] = sig[..32].try_into().unwrap();
    if !enc_is_canonical(&r_bytes) {
        return Err(TnSignatureError::InvalidSignature);
    }

    let verifying_key =
        VerifyingKey::from_bytes(public_key).map_err(|_| TnSignatureError::InvalidPublicKey)?;
    let signature = Signature::from_bytes(sig);
    let m = build_msg(domain, msg);
    verifying_key
        .verify_strict(&m, &signature)
        .map_err(|_| TnSignatureError::InvalidSignature)
}

/// Strict/canonical verify of `sig` over a raw, already-domain-prefixed message
/// `m` (e.g. the 48-byte `M = DST_TXN ‖ SHA-256(body)` an external signer signs).
/// Unlike [`verify`], this does no inner hashing — `m` is used verbatim.
pub fn verify_message(
    m: &[u8],
    sig: &[u8; 64],
    public_key: &[u8; 32],
) -> Result<(), TnSignatureError> {
    if !enc_is_canonical(public_key) {
        return Err(TnSignatureError::InvalidPublicKey);
    }
    let r_bytes: [u8; 32] = sig[..32].try_into().unwrap();
    if !enc_is_canonical(&r_bytes) {
        return Err(TnSignatureError::InvalidSignature);
    }
    let verifying_key =
        VerifyingKey::from_bytes(public_key).map_err(|_| TnSignatureError::InvalidPublicKey)?;
    verifying_key
        .verify_strict(m, &Signature::from_bytes(sig))
        .map_err(|_| TnSignatureError::InvalidSignature)
}

/// Compute `M = DST_domain ‖ context` (public so the external-signer surface can
/// hand the exact bytes to an HSM/MPC backend).
pub fn signing_message(domain: SignatureDomain, msg: &[u8]) -> Vec<u8> {
    build_msg(domain, msg)
}

pub fn sign_transaction(
    msg: &[u8],
    public_key: &[u8; 32],
    private_key: &[u8; 32],
) -> Result<[u8; 64], TnSignatureError> {
    sign(SignatureDomain::Transaction, msg, public_key, private_key)
}

pub fn verify_transaction(
    msg: &[u8],
    sig: &[u8; 64],
    public_key: &[u8; 32],
) -> Result<(), TnSignatureError> {
    verify(SignatureDomain::Transaction, msg, sig, public_key)
}

/// Sign a generic user/wallet message under `SignatureDomain::Msg`.  Distinct
/// DST from txn / block / node record / EOA authorizations so a signature
/// produced by a wallet's "sign message" flow can never be replayed as any of
/// them.
pub fn sign_message(
    msg: &[u8],
    public_key: &[u8; 32],
    private_key: &[u8; 32],
) -> Result<[u8; 64], TnSignatureError> {
    sign(SignatureDomain::Msg, msg, public_key, private_key)
}

/// Verify a generic user/wallet message signature produced by [`sign_message`].
pub fn verify_wallet_message(
    msg: &[u8],
    sig: &[u8; 64],
    public_key: &[u8; 32],
) -> Result<(), TnSignatureError> {
    verify(SignatureDomain::Msg, msg, sig, public_key)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex32(s: &str) -> [u8; 32] {
        let b = hex_decode(s);
        b.try_into().unwrap()
    }
    fn hex_decode(s: &str) -> Vec<u8> {
        (0..s.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
            .collect()
    }

    #[test]
    fn round_trip_and_domain_separation() {
        let seed = [0xA0u8; 32];
        let sk = SigningKey::from_bytes(&seed);
        let pk = sk.verifying_key().to_bytes();
        let msg = b"hello thru";
        let sig = sign(SignatureDomain::Transaction, msg, &pk, &seed).unwrap();
        assert!(verify(SignatureDomain::Transaction, msg, &sig, &pk).is_ok());
        // wrong domain must fail
        assert!(verify(SignatureDomain::Block, msg, &sig, &pk).is_err());
        // tampered sig must fail
        let mut bad = sig;
        bad[40] ^= 1;
        assert!(verify(SignatureDomain::Transaction, msg, &bad, &pk).is_err());
    }

    /// Cross-language golden anchor: must match the C `test_tn_signature`
    /// GOLDEN txn vector (RFC-8032 test-1 seed, body "Thru golden1").
    #[test]
    fn golden_txn_matches_c() {
        let seed = hex32("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60");
        let pk_expected =
            hex32("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a");
        // Regenerated for DST "tn_txn_sign_v1__" (v001 → v1__ underscore padding).
        let sig_expected = "8edfec88b713fce257ffa9da964d89b43d31b8d179aa1a467bbb32e024461c360bb5daf4f10cf774e439d4446b25297567cddb6bcd08ca931f6fb723b8fdfc0a";
        let body = b"Thru golden1";

        let sk = SigningKey::from_bytes(&seed);
        assert_eq!(sk.verifying_key().to_bytes(), pk_expected);

        let sig = sign(SignatureDomain::Transaction, body, &pk_expected, &seed).unwrap();
        assert_eq!(sig.to_vec(), hex_decode(sig_expected), "Rust txn sig must match C golden");
        assert!(verify(SignatureDomain::Transaction, body, &sig, &pk_expected).is_ok());
    }

    #[test]
    fn rejects_non_canonical() {
        assert!(!enc_is_canonical(&P_LE)); // y == p
        let mut z = [0u8; 32];
        assert!(enc_is_canonical(&z)); // y == 0
        z[31] = 0x80; // sign bit only
        assert!(enc_is_canonical(&z));
    }
}
