use curve25519_dalek::{
    edwards::{CompressedEdwardsY, EdwardsPoint},
    scalar::Scalar,
};
use ed25519_dalek::{hazmat::ExpandedSecretKey, SigningKey, VerifyingKey};
use sha2::{Digest, Sha512};
use std::{convert::TryInto, fmt};

const DOMAIN_BLOCK_SIZE: usize = 128;

#[derive(Clone, Copy, Debug)]
pub enum SignatureDomain {
    Transaction,
    BlockHeader,
    Block,
    Gossip,
}

impl SignatureDomain {
    fn tag(self) -> u64 {
        match self {
            SignatureDomain::Transaction => 1,
            SignatureDomain::BlockHeader => 2,
            SignatureDomain::Block => 3,
            SignatureDomain::Gossip => 4,
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

fn domain_block(domain: SignatureDomain) -> [u8; DOMAIN_BLOCK_SIZE] {
    let mut block = [0u8; DOMAIN_BLOCK_SIZE];
    block[..8].copy_from_slice(&domain.tag().to_be_bytes());
    block
}

pub fn sign(
    domain: SignatureDomain,
    msg: &[u8],
    public_key: &[u8; 32],
    private_key: &[u8; 32],
) -> Result<[u8; 64], TnSignatureError> {
    let signing_key = SigningKey::from_bytes(private_key);
    let expanded: ExpandedSecretKey = signing_key.as_bytes().into();
    let block = domain_block(domain);

    let mut h_r = Sha512::new();
    h_r.update(&block);
    h_r.update(&expanded.hash_prefix);
    h_r.update(msg);
    let r = Scalar::from_hash(h_r);
    let r_point = EdwardsPoint::mul_base(&r).compress();

    let mut h_k = Sha512::new();
    h_k.update(&block);
    h_k.update(r_point.as_bytes());
    h_k.update(public_key);
    h_k.update(msg);
    let k = Scalar::from_hash(h_k);

    let s = k * expanded.scalar + r;

    let mut sig = [0u8; 64];
    sig[..32].copy_from_slice(r_point.as_bytes());
    sig[32..].copy_from_slice(&s.to_bytes());
    Ok(sig)
}

pub fn verify(
    domain: SignatureDomain,
    msg: &[u8],
    sig: &[u8; 64],
    public_key: &[u8; 32],
) -> Result<(), TnSignatureError> {
    let r_bytes: [u8; 32] = sig[..32].try_into().map_err(|_| TnSignatureError::InvalidSignature)?;
    let s_bytes: [u8; 32] = sig[32..]
        .try_into()
        .map_err(|_| TnSignatureError::InvalidSignature)?;

    let r_point = CompressedEdwardsY(r_bytes)
        .decompress()
        .ok_or(TnSignatureError::InvalidSignature)?;
    if r_point.is_small_order() {
        return Err(TnSignatureError::InvalidSignature);
    }

    let s_scalar = Option::<Scalar>::from(Scalar::from_canonical_bytes(s_bytes))
        .ok_or(TnSignatureError::InvalidScalar)?;

    let verifying_key =
        VerifyingKey::from_bytes(public_key).map_err(|_| TnSignatureError::InvalidPublicKey)?;
    let a_point: EdwardsPoint = verifying_key.into();
    if a_point.is_small_order() {
        return Err(TnSignatureError::InvalidPublicKey);
    }

    let block = domain_block(domain);
    let mut h_k = Sha512::new();
    h_k.update(&block);
    h_k.update(&r_bytes);
    h_k.update(public_key);
    h_k.update(msg);
    let k = Scalar::from_hash(h_k);

    let minus_a = -a_point;
    let r_cmp =
        EdwardsPoint::vartime_double_scalar_mul_basepoint(&k, &minus_a, &s_scalar).compress();

    if r_cmp.as_bytes() == &r_bytes {
        return Ok(());
    }
    Err(TnSignatureError::InvalidSignature)
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
