//! CPace key exchange for Trezor "code entry" pairing (Trezor Host Protocol).
//!
//! Host side of CPace255 as implemented by `trezorlib.thp.cpace`: the
//! generator is `elligator2(sha512(generator_string)[..32])`, the host public
//! key is `X25519(a, generator)` and the shared secret is `X25519(a, B)`.

use std::fmt;

use sha2::{Digest, Sha512};
use subtle::{Choice, ConditionallySelectable, ConstantTimeEq};
use zeroize::{Zeroize, Zeroizing};

/// Domain separation identifier of CPace255.
const DSI: &[u8] = b"CPace255";
/// SHA-512 block size in bytes.
const HASH_BLOCK_SIZE: usize = 128;

/// Outcome of the host's side of CPace.
pub(crate) struct CpaceResult {
    /// Public key to send to the device.
    pub host_public_key: [u8; 32],
    /// Shared secret, zeroized on drop.
    pub shared_secret: [u8; 32],
}

impl Drop for CpaceResult {
    fn drop(&mut self) {
        self.shared_secret.zeroize();
    }
}

impl fmt::Debug for CpaceResult {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("CpaceResult")
            .field("host_public_key", &self.host_public_key)
            .field("shared_secret", &"<redacted>")
            .finish()
    }
}

/// Failure of the host's side of CPace.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CpaceError {
    /// The shared secret is all zeros: the device sent a low-order point.
    LowOrderPoint,
    /// The code or handshake hash is longer than 127 bytes, which the
    /// single-byte length prefix of the generator string cannot express.
    InputTooLong,
    /// The operating system's random source failed.
    Random,
}

impl fmt::Display for CpaceError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::LowOrderPoint => {
                f.write_str("CPace shared secret is all zeros (low-order device public key)")
            }
            Self::InputTooLong => f.write_str("CPace code or handshake hash is too long"),
            Self::Random => f.write_str("the operating system's random source failed"),
        }
    }
}

impl std::error::Error for CpaceError {}

/// Runs the host side of CPace.
///
/// `code`: the digits as ASCII; `handshake_hash`: the channel's handshake hash.
pub(crate) fn cpace(
    code: &[u8],
    handshake_hash: &[u8],
    trezor_public_key: &[u8; 32],
) -> Result<CpaceResult, CpaceError> {
    let mut key = Zeroizing::new([0u8; 32]);
    crate::random::fill(&mut key[..]).map_err(|_| CpaceError::Random)?;
    cpace_with_key(code, handshake_hash, trezor_public_key, *key)
}

pub(crate) fn cpace_with_key(
    code: &[u8],
    handshake_hash: &[u8],
    trezor_public_key: &[u8; 32],
    host_private_key: [u8; 32],
) -> Result<CpaceResult, CpaceError> {
    let key = Zeroizing::new(host_private_key);
    let (_, generator) = generator_steps(code, handshake_hash)?;
    let mut generator = Zeroizing::new(generator);
    let host_public_key = x25519_dalek::x25519(*key, *generator);
    generator.zeroize();
    let shared_secret = Zeroizing::new(x25519_dalek::x25519(*key, *trezor_public_key));
    let zero: Choice = shared_secret[..].ct_eq(&[0u8; 32][..]);
    if bool::from(zero) {
        return Err(CpaceError::LowOrderPoint);
    }
    Ok(CpaceResult {
        host_public_key,
        shared_secret: *shared_secret,
    })
}

/// The first two steps of CPace: the first 32 bytes of SHA-512 of the
/// generator string, and the point `elligator2` maps them to (the generator).
pub(crate) fn generator_steps(
    code: &[u8],
    handshake_hash: &[u8],
) -> Result<([u8; 32], [u8; 32]), CpaceError> {
    let mut hashed = Zeroizing::new([0u8; 32]);
    {
        let gen_str = Zeroizing::new(generator_string(code, handshake_hash)?);
        let digest: Zeroizing<[u8; 64]> = Zeroizing::new(Sha512::digest(&gen_str[..]).into());
        hashed.copy_from_slice(&digest[..32]);
    }
    Ok((*hashed, elligator2(&hashed)))
}

/// `lv_cat(DSI, prs, zpad, ci, sid)` with an empty `sid`, as the reference.
pub(crate) fn generator_string(prs: &[u8], ci: &[u8]) -> Result<Vec<u8>, CpaceError> {
    if prs.len() > 0x7F || ci.len() > 0x7F {
        return Err(CpaceError::InputTooLong);
    }
    let zpad = HASH_BLOCK_SIZE.saturating_sub((1 + DSI.len()) + (1 + prs.len()) + 1);
    let mut out = Vec::with_capacity(HASH_BLOCK_SIZE + 2 + ci.len());
    // All lengths below are at most 0x7F, so `as u8` is exact.
    for part in [DSI, prs, &vec![0u8; zpad][..], ci, &[][..]] {
        out.push(part.len() as u8);
        out.extend_from_slice(part);
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Field arithmetic modulo p = 2^255 - 19, five 51-bit limbs.
// ---------------------------------------------------------------------------

const LOW_51: u64 = (1 << 51) - 1;

/// p - 2, little-endian.
const P_MINUS_2: [u8; 32] = [
    0xeb, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f,
];
/// (p - 5) / 8, little-endian.
const P_MINUS_5_DIV_8: [u8; 32] = [
    0xfd, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x0f,
];
/// sqrt(-1) mod p, little-endian.
const SQRT_M1: [u8; 32] = [
    0xb0, 0xa0, 0x0e, 0x4a, 0x27, 0x1b, 0xee, 0xc4, 0x78, 0xe4, 0x2f, 0xad, 0x06, 0x18, 0x43, 0x2f,
    0xa7, 0xd7, 0xfb, 0x3d, 0x99, 0x00, 0x4d, 0x2b, 0x0b, 0xdf, 0xc1, 0x4f, 0x80, 0x24, 0x83, 0x2b,
];
/// Montgomery curve constant J = 486662.
const J: u64 = 486_662;

#[derive(Clone, Copy)]
struct Fe([u64; 5]);

impl Fe {
    const ZERO: Fe = Fe([0; 5]);
    const ONE: Fe = Fe([1, 0, 0, 0, 0]);

    fn from_u64(x: u64) -> Fe {
        // x < 2^51 for every constant used here.
        Fe([x & LOW_51, x >> 51, 0, 0, 0])
    }

    /// Little-endian load; the top bit is masked and the value is reduced
    /// lazily (the result may still be >= p until `to_bytes`).
    fn from_bytes(b: &[u8; 32]) -> Fe {
        let load8 = |i: usize| -> u64 {
            let mut w = [0u8; 8];
            w.copy_from_slice(&b[i..i + 8]);
            u64::from_le_bytes(w)
        };
        Fe([
            load8(0) & LOW_51,
            (load8(6) >> 3) & LOW_51,
            (load8(12) >> 6) & LOW_51,
            (load8(19) >> 1) & LOW_51,
            (load8(24) >> 12) & LOW_51,
        ])
    }

    /// Weak reduction: every limb below 2^51 + small.
    fn reduce(self) -> Fe {
        let l = self.0;
        let c = [l[0] >> 51, l[1] >> 51, l[2] >> 51, l[3] >> 51, l[4] >> 51];
        Fe([
            (l[0] & LOW_51) + c[4] * 19,
            (l[1] & LOW_51) + c[0],
            (l[2] & LOW_51) + c[1],
            (l[3] & LOW_51) + c[2],
            (l[4] & LOW_51) + c[3],
        ])
    }

    fn add(self, o: Fe) -> Fe {
        let (a, b) = (self.0, o.0);
        Fe([
            a[0] + b[0],
            a[1] + b[1],
            a[2] + b[2],
            a[3] + b[3],
            a[4] + b[4],
        ])
        .reduce()
    }

    /// `self - o`, adding 16p first so no limb underflows.
    fn sub(self, o: Fe) -> Fe {
        let (a, b) = (self.0, o.0);
        Fe([
            (a[0] + 36_028_797_018_963_664) - b[0],
            (a[1] + 36_028_797_018_963_952) - b[1],
            (a[2] + 36_028_797_018_963_952) - b[2],
            (a[3] + 36_028_797_018_963_952) - b[3],
            (a[4] + 36_028_797_018_963_952) - b[4],
        ])
        .reduce()
    }

    fn neg(self) -> Fe {
        Fe::ZERO.sub(self)
    }

    fn mul(self, o: Fe) -> Fe {
        let a = self.0.map(u128::from);
        let b = o.0.map(u128::from);
        let b19 = [b[0] * 19, b[1] * 19, b[2] * 19, b[3] * 19, b[4] * 19];
        let mut c0 = a[0] * b[0] + a[4] * b19[1] + a[3] * b19[2] + a[2] * b19[3] + a[1] * b19[4];
        let mut c1 = a[1] * b[0] + a[0] * b[1] + a[4] * b19[2] + a[3] * b19[3] + a[2] * b19[4];
        let mut c2 = a[2] * b[0] + a[1] * b[1] + a[0] * b[2] + a[4] * b19[3] + a[3] * b19[4];
        let mut c3 = a[3] * b[0] + a[2] * b[1] + a[1] * b[2] + a[0] * b[3] + a[4] * b19[4];
        let mut c4 = a[4] * b[0] + a[3] * b[1] + a[2] * b[2] + a[1] * b[3] + a[0] * b[4];
        let mask = u128::from(LOW_51);
        c1 += c0 >> 51;
        c0 &= mask;
        c2 += c1 >> 51;
        c1 &= mask;
        c3 += c2 >> 51;
        c2 &= mask;
        c4 += c3 >> 51;
        c3 &= mask;
        let carry = c4 >> 51;
        c4 &= mask;
        // carry < 2^64 for reduced-ish inputs, so carry * 19 fits in u128.
        c0 += carry * 19;
        c1 += c0 >> 51;
        c0 &= mask;
        Fe([c0 as u64, c1 as u64, c2 as u64, c3 as u64, c4 as u64])
    }

    fn square(self) -> Fe {
        self.mul(self)
    }

    /// `self ^ exp` for a public little-endian exponent (branches on its bits).
    fn pow(self, exp: &[u8; 32]) -> Fe {
        let mut acc = Fe::ONE;
        for byte in exp.iter().rev() {
            for bit in (0..8).rev() {
                acc = acc.square();
                if (byte >> bit) & 1 == 1 {
                    acc = acc.mul(self);
                }
            }
        }
        acc
    }

    fn invert(self) -> Fe {
        self.pow(&P_MINUS_2)
    }

    /// Canonical little-endian encoding (fully reduced mod p).
    fn to_bytes(self) -> [u8; 32] {
        let mut l = self.reduce().0;
        // q is 1 iff the value is >= p.
        let mut q = (l[0] + 19) >> 51;
        q = (l[1] + q) >> 51;
        q = (l[2] + q) >> 51;
        q = (l[3] + q) >> 51;
        q = (l[4] + q) >> 51;
        l[0] += 19 * q;
        l[1] += l[0] >> 51;
        l[0] &= LOW_51;
        l[2] += l[1] >> 51;
        l[1] &= LOW_51;
        l[3] += l[2] >> 51;
        l[2] &= LOW_51;
        l[4] += l[3] >> 51;
        l[3] &= LOW_51;
        l[4] &= LOW_51;
        let w = [
            l[0] | (l[1] << 51),
            (l[1] >> 13) | (l[2] << 38),
            (l[2] >> 26) | (l[3] << 25),
            (l[3] >> 39) | (l[4] << 12),
        ];
        let mut out = [0u8; 32];
        for (chunk, word) in out.chunks_exact_mut(8).zip(w) {
            chunk.copy_from_slice(&word.to_le_bytes());
        }
        out
    }
}

impl ConstantTimeEq for Fe {
    fn ct_eq(&self, other: &Fe) -> Choice {
        self.to_bytes().ct_eq(&other.to_bytes())
    }
}

impl ConditionallySelectable for Fe {
    /// Returns `b` if `choice` is set, else `a`.
    fn conditional_select(a: &Fe, b: &Fe, choice: Choice) -> Fe {
        Fe([
            u64::conditional_select(&a.0[0], &b.0[0], choice),
            u64::conditional_select(&a.0[1], &b.0[1], choice),
            u64::conditional_select(&a.0[2], &b.0[2], choice),
            u64::conditional_select(&a.0[3], &b.0[3], choice),
            u64::conditional_select(&a.0[4], &b.0[4], choice),
        ])
    }
}

/// RFC 9380 `map_to_curve_elligator2_curve25519`, returning the Montgomery u
/// coordinate; the input is decoded like an X25519 u coordinate.
pub(crate) fn elligator2(point: &[u8; 32]) -> [u8; 32] {
    elligator2_choices(point).0
}

/// `elligator2` plus the two conditions that drive its conditional moves.
/// They depend on the pairing code, so they stay [`Choice`]s: only test code
/// turns them into `bool`.
fn elligator2_choices(point: &[u8; 32]) -> ([u8; 32], Choice, Choice) {
    let c3 = Fe::from_bytes(&SQRT_M1);
    let j = Fe::from_u64(J);
    let u = Fe::from_bytes(point);
    let tv1 = u.square().add(u.square()); // 2 * u^2
    let xd = tv1.add(Fe::ONE);
    let x1n = j.neg();
    let mut tv2 = xd.square();
    let gxd = tv2.mul(xd);
    let mut gx1 = j.mul(tv1);
    gx1 = gx1.mul(x1n).add(tv2).mul(x1n);
    let mut tv3 = gxd.square();
    tv2 = tv3.square();
    tv3 = tv3.mul(gxd).mul(gx1);
    tv2 = tv2.mul(tv3);
    let y11 = tv2.pow(&P_MINUS_5_DIV_8).mul(tv3);
    let y12 = y11.mul(c3);
    let e1 = y11.square().mul(gxd).ct_eq(&gx1);
    let y1 = Fe::conditional_select(&y12, &y11, e1);
    let x2n = x1n.mul(tv1);
    let e3 = y1.square().mul(gxd).ct_eq(&gx1);
    let xn = Fe::conditional_select(&x2n, &x1n, e3);
    let x = xn.mul(xd.invert());
    (x.to_bytes(), e1, e3)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) struct ExchangeVector {
        pub(crate) code: &'static str,
        pub(crate) handshake_hash: &'static str,
        pub(crate) trezor_public_key: &'static str,
        pub(crate) host_private_key: &'static str,
        pub(crate) host_public_key: &'static str,
        pub(crate) shared_secret: &'static str,
    }

    pub(crate) const ELLIGATOR_VECTORS: &[(&str, &str, &str)] = &[
        (
            "0000000000000000000000000000000000000000000000000000000000000000",
            "0000000000000000000000000000000000000000000000000000000000000000",
            "0000000000000000000000000000000000000000000000000000000000000000",
        ),
        (
            "0100000000000000000000000000000000000000000000000000000000000000",
            "0100000000000000000000000000000000000000000000000000000000000000",
            "9cdb525555555555555555555555555555555555555555555555555555555555",
        ),
        (
            "0200000000000000000000000000000000000000000000000000000000000000",
            "0200000000000000000000000000000000000000000000000000000000000000",
            "b349328ee3388ee3388ee3388ee3388ee3388ee3388ee3388ee3388ee3388e63",
        ),
        (
            "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
            "ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
            "9cdb525555555555555555555555555555555555555555555555555555555555",
        ),
        (
            "edffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
            "0000000000000000000000000000000000000000000000000000000000000000",
            "0000000000000000000000000000000000000000000000000000000000000000",
        ),
        (
            "eeffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
            "0100000000000000000000000000000000000000000000000000000000000000",
            "9cdb525555555555555555555555555555555555555555555555555555555555",
        ),
        (
            "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f",
            "1200000000000000000000000000000000000000000000000000000000000000",
            "1e5942dd97c756040d27755f1e5b11349cd47d796c45d07052f7e5b11541c349",
        ),
        (
            "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            "1200000000000000000000000000000000000000000000000000000000000000",
            "1e5942dd97c756040d27755f1e5b11349cd47d796c45d07052f7e5b11541c349",
        ),
        (
            "0100000000000000000000000000000000000000000000000000000000000080",
            "0100000000000000000000000000000000000000000000000000000000000000",
            "9cdb525555555555555555555555555555555555555555555555555555555555",
        ),
        (
            "0500000000000000000000000000000000000000000000000000000000000080",
            "0500000000000000000000000000000000000000000000000000000000000000",
            "e967a8afafafafafafafafafafafafafafafafafafafafafafafafafafafaf2f",
        ),
        (
            "85901d15771874218692acfca8d7ee8c7e42388c724fb28ed5139d7c3681f60d",
            "85901d15771874218692acfca8d7ee8c7e42388c724fb28ed5139d7c3681f60d",
            "5327ae53556dfe2d74f6a6ca21f9340f4861497ad0ce946e06a0c6a99312760c",
        ),
        (
            "76f848d83ae58b4a1f87d7f76df6fbb9dc04e12ecd7529dda6f7b5a17d81e760",
            "76f848d83ae58b4a1f87d7f76df6fbb9dc04e12ecd7529dda6f7b5a17d81e760",
            "47747acfeb2d71dc03cc2a5272a4bbec3752e359c2c5a44dc1a669308d9c242d",
        ),
        (
            "f5386497e2078b1d20c34138cc59c0961de17d8c59a14492c85487382c60cdcd",
            "f5386497e2078b1d20c34138cc59c0961de17d8c59a14492c85487382c60cd4d",
            "e53c3ce9c3e940bafbf99b2439b26f76b20d200230ae9de73e48ea90b43c592b",
        ),
        (
            "1f33bbdc7cbc7925aa1765644f38d41f2f8e8ab42db8bd9de6bd0af1c6529333",
            "1f33bbdc7cbc7925aa1765644f38d41f2f8e8ab42db8bd9de6bd0af1c6529333",
            "d8f345a8651361395938109b46b3e6ea8f821c836163da29644925fc70e0d06b",
        ),
        (
            "62be4f4e1447649d57e45d6e05b6df02b630e07ecbb58cacdbfc7e1c572324a4",
            "62be4f4e1447649d57e45d6e05b6df02b630e07ecbb58cacdbfc7e1c57232424",
            "686621810fa43d877445b7d7fee59c6a66ab2e399e20ae99f3e3ba734910867e",
        ),
        (
            "d5f283c812234b3b718ab1fd3a4877006a64b9d8a5f022ee8e6ab1848185af8b",
            "d5f283c812234b3b718ab1fd3a4877006a64b9d8a5f022ee8e6ab1848185af0b",
            "310420ceb1b12ab6fb088cc1ba313fe5633d54c3d7c97a6705fad08f037dfc0d",
        ),
        (
            "3482540eba42767998cc650afa234144ba1bc457dafc224370f8c8af85a8d673",
            "3482540eba42767998cc650afa234144ba1bc457dafc224370f8c8af85a8d673",
            "9360450a4431ef0dddf090a29527746e9f6fe297bcf2659eea03b53e8fd7c16c",
        ),
        (
            "7bc0c70cc8b5a4b6fc68766693701d0bc1c2156715b472e59f800f66dbd0875e",
            "7bc0c70cc8b5a4b6fc68766693701d0bc1c2156715b472e59f800f66dbd0875e",
            "7eeb940120e9636bd8db1314a15c0831e3312f628cdf9c0b9c2edb7cd654b155",
        ),
        (
            "4ef5b7c467b32d71971175425a1ddc1c6cdbfdda8afb64977bcff9c782a62eab",
            "4ef5b7c467b32d71971175425a1ddc1c6cdbfdda8afb64977bcff9c782a62e2b",
            "dbf756ef7fedea48b950b8053a88e460eb0917452bd5b741b2fa0c023c1ddc35",
        ),
        (
            "01547831fea066b31ca2ece22c48c3b675f069f7d0786b4f3ef14246d6fea7e1",
            "01547831fea066b31ca2ece22c48c3b675f069f7d0786b4f3ef14246d6fea761",
            "d7a4c9933b846d89fded60b9468a84d45d5b44226440d020687c89400d684104",
        ),
        (
            "71bbe67e94c3972b6b5865b34237a40a47ea7d408be03da295081be5e4998f92",
            "71bbe67e94c3972b6b5865b34237a40a47ea7d408be03da295081be5e4998f12",
            "7b801004eeefd02dfade7decd0fc9a4c308f3e95c5d47feda904c62092904c4a",
        ),
        (
            "13367c658ffed879d6997a38b089c82aa00ad83b5ab3a6f64fbf221fd6421370",
            "13367c658ffed879d6997a38b089c82aa00ad83b5ab3a6f64fbf221fd6421370",
            "9dff57ef5d8d8698912e70adc6c759f9022441e5214befedf881c51d9ed1841d",
        ),
        (
            "aa485c77bdb792a25595af55b6e0313ae5f8ec8be617db4047d650835863b657",
            "aa485c77bdb792a25595af55b6e0313ae5f8ec8be617db4047d650835863b657",
            "2989c0ef2ba56f072d14a1c8e044bc89da81c52e985ee1f2826cd3f1fa01cf41",
        ),
        (
            "7df5a52c7da1d5266ce11bc449161f9f639bdcff754710361b135ee41d411ac2",
            "7df5a52c7da1d5266ce11bc449161f9f639bdcff754710361b135ee41d411a42",
            "0331baaad1288d1bedd44a569b4401d5bc7e89db6e694b8d785873ac8051f46b",
        ),
        (
            "937c72104946631ecc44dbfd07bf0b42f9695033fae4a550c8fe1d431e941456",
            "937c72104946631ecc44dbfd07bf0b42f9695033fae4a550c8fe1d431e941456",
            "265d6714b11b313806f2ac978b4e2aba9c9ee9830045ff45d8653ce671eb641f",
        ),
        (
            "968744947289f432852ed8cdc9939d206bf9fa8589f24f866e34d70948c478af",
            "968744947289f432852ed8cdc9939d206bf9fa8589f24f866e34d70948c4782f",
            "7a645f271001faf11dbe36ffc5731a7be75e93784c8a9e30f4b6218a6e45e66c",
        ),
        (
            "95a929b264482dcffbb27cf2885e82a6f3fa5d43078b4948d10f129d8b7e1b11",
            "95a929b264482dcffbb27cf2885e82a6f3fa5d43078b4948d10f129d8b7e1b11",
            "66a9c0c2b68b3410fb2b5bf0d94ab803fd0311e4808433f2831644a24bec3a4f",
        ),
        (
            "d89d7a96e1176b74f13c1973d1d9c5ae6baa0dfe010d9aed9ea42ba554c63dea",
            "d89d7a96e1176b74f13c1973d1d9c5ae6baa0dfe010d9aed9ea42ba554c63d6a",
            "962762f7368c7cc63cf1f0277fa5b94202e1a72447bfe7c42c8ce13961a27852",
        ),
        (
            "05ab14f333281dcdebf9a8bdbc28e1a56f32e3bc288dc123ca284282f51fc975",
            "05ab14f333281dcdebf9a8bdbc28e1a56f32e3bc288dc123ca284282f51fc975",
            "5b5e357372ca803a41ee499803ed040f5aa3716a54d84627133716168464e862",
        ),
        (
            "48afbee9add9ae1810cee35468284fac3331ddeabc5582213339a7ff79537fe9",
            "48afbee9add9ae1810cee35468284fac3331ddeabc5582213339a7ff79537f69",
            "a6e154351f088ea24ef97d12be011361e62c43e368ce58c8e808a53022e17411",
        ),
        (
            "ac02ace7fd3a00139c673d6345e85bcdc16b0f2959a763b1a66ef57b87ee0e8d",
            "ac02ace7fd3a00139c673d6345e85bcdc16b0f2959a763b1a66ef57b87ee0e0d",
            "7a73fe38ec941436fbc8d27fa5a246ca5346d8f4d5dd414ec7063031cb46632e",
        ),
        (
            "b904c8093d60598c8d5277f5d6c1b8069b9721f02e8446a464ce532d63e26038",
            "b904c8093d60598c8d5277f5d6c1b8069b9721f02e8446a464ce532d63e26038",
            "5cb546786f984221e8cbdf302964d8cfe5303dbcbb1e5d33e1ab9c202303c62a",
        ),
        (
            "5b69125d3e4c77ae008d9617802c5e8cc047adca4b13414625a9288eb205c4e5",
            "5b69125d3e4c77ae008d9617802c5e8cc047adca4b13414625a9288eb205c465",
            "42ae6d49b54e4647c5d5052ae2525fc3944ff5c6ed8ec46c2f54f8a1f3c08855",
        ),
        (
            "c99241b458029a166def5b7f4afe0cd5cce10a5ba83a4e76d38ad847f1cdd27e",
            "c99241b458029a166def5b7f4afe0cd5cce10a5ba83a4e76d38ad847f1cdd27e",
            "9180ee41333696eac045c501c10feb13b5a218032518d2245144d757f7e8a006",
        ),
        (
            "76cbd97d07bed7d2bced0a749ace03e55ad440949f371c0e675e537ba933f370",
            "76cbd97d07bed7d2bced0a749ace03e55ad440949f371c0e675e537ba933f370",
            "9c0e17d926cf05015faeb8a6abf806dd13301e29a8bd060eea267b7115bafc4c",
        ),
        (
            "103eaf1d2f78a08461a679be6a68d38815f696cbe261ff71a8fe815defab662b",
            "103eaf1d2f78a08461a679be6a68d38815f696cbe261ff71a8fe815defab662b",
            "76181bfefc35eba7ff7123d8b90ead05ab0f35cfce1a062098398da731e50e58",
        ),
        (
            "ca617b62b06e60226743c7798753dc14f88c49c0513ba344d3d73227ce12e1bf",
            "ca617b62b06e60226743c7798753dc14f88c49c0513ba344d3d73227ce12e13f",
            "42bd03097ec9eeb630ed4ad096500a2bddd9b9535a7275ef6d2d7a0b60148576",
        ),
        (
            "3bede4c6e98de717468110cdd0a91f78e426c26499cd71ddc01f4ecdbb7841e1",
            "3bede4c6e98de717468110cdd0a91f78e426c26499cd71ddc01f4ecdbb784161",
            "47801f1a22837d94a59e7ba43523588f1819df4076e13b4ba1f4cb67a5740a11",
        ),
        (
            "7796937d457e624425606972e710929a6301fe9a6a863caf8960721c98fa769d",
            "7796937d457e624425606972e710929a6301fe9a6a863caf8960721c98fa761d",
            "d7a76e4f651e302476ad573b0ec8a96e016be528f7cdf70a19501d93b508df6a",
        ),
        (
            "e061e5981001e8d2ccaf4e6046d0e2327f911caade7a947d80285aa47b117674",
            "e061e5981001e8d2ccaf4e6046d0e2327f911caade7a947d80285aa47b117674",
            "ad9d3ef49ddbcb8c91e61770358bffe3724d06a8c8f08716b1491258ae300609",
        ),
        (
            "80862e791f9a67f8f439298cb8dab78fbca8ef5f4f2aff1ea512d324c72c878a",
            "80862e791f9a67f8f439298cb8dab78fbca8ef5f4f2aff1ea512d324c72c870a",
            "41dfad66c8f752f40ef3191783d3898b4dd2cb7e5f8e103212c2fd99d789bb74",
        ),
        (
            "cff8987c94e3243ea6af4cf53123227e375bfee1e5d67a9955a32798aecacab2",
            "cff8987c94e3243ea6af4cf53123227e375bfee1e5d67a9955a32798aecaca32",
            "e35753647695b9ced5cea337d0e58b662f79d0bdf731409a67f200cf0e4ab50f",
        ),
        (
            "67c2f6a6f3f6e036cc136211453a88a50e41936dcd3f478a620e427ce1ebf4ba",
            "67c2f6a6f3f6e036cc136211453a88a50e41936dcd3f478a620e427ce1ebf43a",
            "4ba2e6cd115490a018a9a5250fa9730eb3424a13bf5d0366de8f72ec87e89415",
        ),
        (
            "551ec91bb026dc56c279ca297ae1e881e200bb7fa563ada15626c4cf077c5933",
            "551ec91bb026dc56c279ca297ae1e881e200bb7fa563ada15626c4cf077c5933",
            "cc741e453d28af5a2980f3c0cc0d88be125acec818c1bd10979c5e1befb31713",
        ),
        (
            "c6069d6f6d77c631c3c002218e0de6f02aecbc455bd6f82004b8ad7bae38a6e9",
            "c6069d6f6d77c631c3c002218e0de6f02aecbc455bd6f82004b8ad7bae38a669",
            "2169c8ec7f46734d249df8137a40c5eec948440e0c6628b72a1cbed28514c829",
        ),
        (
            "3f44b45db443c7b0225086f7186b52bab584329e33755e84f9ae41f077020bbc",
            "3f44b45db443c7b0225086f7186b52bab584329e33755e84f9ae41f077020b3c",
            "19cefc389859b1137f6defdeb4fd33f3f04ead2a67c8a84d1a31da4c7dd99552",
        ),
        (
            "760045031bf2df77bb9b375d9f4050dad0d829178b49e37484964b90961e9ca2",
            "760045031bf2df77bb9b375d9f4050dad0d829178b49e37484964b90961e9c22",
            "5febcc22238c5ee1109e17775ef8dc05e44cf0a4f5329c487f6bfedb9da18a5e",
        ),
        (
            "ac2463f3844c4c746e3d7f5263c787111a910094f16dc62d473d229b11fe4a72",
            "ac2463f3844c4c746e3d7f5263c787111a910094f16dc62d473d229b11fe4a72",
            "680a0f83d1c168326b5200ad70fbc3d17d68a689b67465ec5e75df2ca36f852d",
        ),
        (
            "c8cd5faf6c2aba5846ca2ee8cc04921e38cadc277eecc521148c116d788430b7",
            "c8cd5faf6c2aba5846ca2ee8cc04921e38cadc277eecc521148c116d78843037",
            "f6fd889578a70ea944172daa908eae99c8615afa83c8f60640682269ccc2bb4c",
        ),
        (
            "2faeaff4f021a0aeb463665f96294b4f1486060e995ab9a9ec523f291d3799ae",
            "2faeaff4f021a0aeb463665f96294b4f1486060e995ab9a9ec523f291d37992e",
            "45def9b35c03dacf419301e0e9d656ca816937bd3ec8f733b36ef63897de2d60",
        ),
        (
            "c6adbcf532baa363d0a09a9e8bdd456741954cd8a23ab20e01fcaed99cb0cd83",
            "c6adbcf532baa363d0a09a9e8bdd456741954cd8a23ab20e01fcaed99cb0cd03",
            "0d272855bab8dd947c875cdcf22042470684402bd4caf715f3d27d2173b7582f",
        ),
        (
            "6010dd5a787284291b5c8b3358f7d10f0cd65d7d98c6501514bc94de0741fbe6",
            "6010dd5a787284291b5c8b3358f7d10f0cd65d7d98c6501514bc94de0741fb66",
            "bd74db223993eb2b4c9db22551a26bb4827c58f58968aafef87ad0302a3ef63e",
        ),
        (
            "ff979021ae657d72ddb9600ca81f25f3d02180009b8cfc56685ab48e190d0bc7",
            "ff979021ae657d72ddb9600ca81f25f3d02180009b8cfc56685ab48e190d0b47",
            "681ee3e0aa53ff9406560f5b84fac4cf1a568bbd822739ef16eadd9450c03f4f",
        ),
        (
            "1d1b264bea711810aabf121a2d8b6b18d0e2fc6b1f38e1836b195d6334b7d479",
            "1d1b264bea711810aabf121a2d8b6b18d0e2fc6b1f38e1836b195d6334b7d479",
            "6f703c7ad72573c1e6458c0d3ad5d8a18789c6afa966208f48224135af618816",
        ),
        (
            "8b1e42ec8914fb8eaa6ffcb74d2c24a4b67cfc8b5f9b2cbb1a6be5fdba73bcf4",
            "8b1e42ec8914fb8eaa6ffcb74d2c24a4b67cfc8b5f9b2cbb1a6be5fdba73bc74",
            "045c6cc30ab8ce517b3b9ced311252377a1efec3b5c7f91323c063d8d46c0b10",
        ),
        (
            "48bdfbdf209dc9cf5e870feeee8f22ee6e9d31133678f4a93e87e60f7775c699",
            "48bdfbdf209dc9cf5e870feeee8f22ee6e9d31133678f4a93e87e60f7775c619",
            "09baaed9a0eba0f2a84cc5a0d9e90d637dfa366a072ea9052243490670466704",
        ),
        (
            "1bde81ad84a65dc7d7ad47d0dfae61ba9d46dd34940c04879ff8f29f9a17ba83",
            "1bde81ad84a65dc7d7ad47d0dfae61ba9d46dd34940c04879ff8f29f9a17ba03",
            "e8ecbb592ee39440a34e8951d4453f2090f54b7023016fcd5c1d00f9cb7b776d",
        ),
        (
            "2cdfc713126872edc67b3ac4dcd75aac217a10f4046d74d6a284b24012645cc5",
            "2cdfc713126872edc67b3ac4dcd75aac217a10f4046d74d6a284b24012645c45",
            "e90b1296f7da5c100f5af9251e8026d9aa4667e0b99648e6b2c0a7f74c431803",
        ),
        (
            "bb768cdc1d667e3971493a5eaf7160a9149aa5961b7a9492c99385f327c7da42",
            "bb768cdc1d667e3971493a5eaf7160a9149aa5961b7a9492c99385f327c7da42",
            "60eee5cf260abf56b039f8987276a5a4ad60c77024115d44c144d99bc3b6722b",
        ),
        (
            "73bfb263f83cd7bd058c803893147ea764320a672c1459b2bf677e92a4657aec",
            "73bfb263f83cd7bd058c803893147ea764320a672c1459b2bf677e92a4657a6c",
            "be1a32bf2d3c48fff0a1119dc8533da11e1c7bc775ce9de13c105281895ed805",
        ),
        (
            "0b5fa5d15e5e099765acdd2d91e63e47c29d2f965e93afe3b6d68d658b2ff92b",
            "0b5fa5d15e5e099765acdd2d91e63e47c29d2f965e93afe3b6d68d658b2ff92b",
            "d69a1d234ce0c999342ac3f3a9525377e233ed72ddf6856d76b076655b0ee704",
        ),
        (
            "08ee872a0ec8638e47302acc20037ed52ea06f701db4be0e36b3cbe3ec865ca2",
            "08ee872a0ec8638e47302acc20037ed52ea06f701db4be0e36b3cbe3ec865c22",
            "63ef8a1654a91752c10affc90b1de476a9dfed68a9c4038f6bd5d778d7bee30e",
        ),
        (
            "b218ecea987c5e9bb3e836baa89b5bf50a9adabb41e72cc81fa1dd4881b9a2d1",
            "b218ecea987c5e9bb3e836baa89b5bf50a9adabb41e72cc81fa1dd4881b9a251",
            "9ce2b00f03525625502279ae069e2a818629e8080467d2026fc951c21badd55e",
        ),
        (
            "ce54d2ba88bfc5f618b3ecb85589e512c9d8e07c9348479efbf401d19f7a7b69",
            "ce54d2ba88bfc5f618b3ecb85589e512c9d8e07c9348479efbf401d19f7a7b69",
            "364d5837b9e1faf2c91b6329e167e6eac9ed14e2086f163932f7551aeafb7c33",
        ),
        (
            "f7d90ddbd6950de8e791262f938d4b8686a7803b9c368782a31a61eb540b8c5f",
            "f7d90ddbd6950de8e791262f938d4b8686a7803b9c368782a31a61eb540b8c5f",
            "88e3a7c6298e81c50e0dfc99b227bd073b35fdcc0350b498099e8220dd474627",
        ),
        (
            "f197b89b5dc21576ad47126abf4cb9f1d848888140a59747a6cc5f650cd9e313",
            "f197b89b5dc21576ad47126abf4cb9f1d848888140a59747a6cc5f650cd9e313",
            "25fe70d7db70ba6528d59176bd129cbc29efa460d3faaf0a578250b5da16cc77",
        ),
        (
            "9da606be40f511d2b86ecdab64f254caffcfe7d24ad4dc839af7ea48baecebc0",
            "9da606be40f511d2b86ecdab64f254caffcfe7d24ad4dc839af7ea48baeceb40",
            "6022e54c6d7fca210834fd0ffe4e482b117ab2c8ed7cf490613e1f66722bea01",
        ),
        (
            "ffdf43652d45d09d1747404c70aa196e83c585b489402debf98d3a7a9f3247b1",
            "ffdf43652d45d09d1747404c70aa196e83c585b489402debf98d3a7a9f324731",
            "fbbcdfd05807eadd6762427b9c2967d6ece254e3ec9f9b233553712c2b0c4805",
        ),
        (
            "a3d5ee6b53b049249c107a16b7c64059017c72be117364ce3218e203da2a55b0",
            "a3d5ee6b53b049249c107a16b7c64059017c72be117364ce3218e203da2a5530",
            "aaf69526c942dbd91770ea40b183a19ca363d6c2e91333b90910bda3a5fc9879",
        ),
        (
            "e4e17f69bb9a824c0af199b9e36fa1ed2b9c1edcf600c64d480fc1dc83dff270",
            "e4e17f69bb9a824c0af199b9e36fa1ed2b9c1edcf600c64d480fc1dc83dff270",
            "686592f453c139f24e12b331fc458685deefaaa0984e6701e1edc32d21b37a2c",
        ),
        (
            "df6a1cfca2e9f94b377582ede76f0fa40a7f73ea9efff152fb46b16a2424752a",
            "df6a1cfca2e9f94b377582ede76f0fa40a7f73ea9efff152fb46b16a2424752a",
            "1f201022edd12b15a8af56ccffbb762b60dad258a3f90bfad45b36146ec4a104",
        ),
        (
            "2f5fd1625c5fa480f7a9078dfe4c763ec7b01287609027786eded791f5709856",
            "2f5fd1625c5fa480f7a9078dfe4c763ec7b01287609027786eded791f5709856",
            "286b80126a2c99d980616245df0fa2e98685c27dc909a5ff4fa7c5bbb0d50f45",
        ),
        (
            "f5208563528e9cffe954a2aaad4db4e0cbfd60fe56ce620e6eeed1c11000f04e",
            "f5208563528e9cffe954a2aaad4db4e0cbfd60fe56ce620e6eeed1c11000f04e",
            "66a9d554c3eb6c3f951217d32de932e710bbc8cf2f86a281aa43816f12482d46",
        ),
        (
            "8cc239f9ee7c7941432abd852bef65aa800adcf09eb90e4aecbe3ddd7de216ae",
            "8cc239f9ee7c7941432abd852bef65aa800adcf09eb90e4aecbe3ddd7de2162e",
            "6bc11c8b1ba57cd67dfd4253eeae3086a188d8b41dec5c4dabac884de3349f37",
        ),
    ];

    pub(crate) const EXCHANGE_VECTORS: &[ExchangeVector] = &[
        ExchangeVector {
            code: "000042",
            handshake_hash: "64169d1fb54e9b67e371c4473b71fc1a8c7d78ee79f8781e44495403dcbd01b6",
            trezor_public_key: "89b5fe8f8bf392be0d61583688c04e3b078b68f0ac55554dd9079f14569e056e",
            host_private_key: "98c956bebebd19af6d4f81d3e2d506c3e05bfea0c69d405875d377557cee8526",
            host_public_key: "7dafc9da8ec4a944251129148fced88f4d6932ec188b185bbd36eb56d3b5501d",
            shared_secret: "cb6a0d44400478490b8384426f00112bb33b7dc8431a5bbdb2d3518ce8321932",
        },
        ExchangeVector {
            code: "123456",
            handshake_hash: "15d5b21e328ca484854933e63b7b40f87f91e9de051ce9d60add75d350c33b01",
            trezor_public_key: "d5db78aa21075255f394432aee74d36937f1ea7f1238eb5a165996ba1b9134e1",
            host_private_key: "e016872dadb58a2f4fee551ced6605d2eac97d0b3b835784484db173eddc2a14",
            host_public_key: "498771e50d09390b315fcec7b0e2304ea657e5585e5dd735f3bd3e1b88781676",
            shared_secret: "0901cf07d9ebf39ca6996df18e41874d65d893d462a1efac758c0c7cf6cd6e5f",
        },
        ExchangeVector {
            code: "000000",
            handshake_hash: "344690aca75ec1ad156230c680dfdffd58f655e800af35b57a131fb536550da7",
            trezor_public_key: "31784552715cb5f44065f107adfa2d09f84a008c91d310391f46528747b2d823",
            host_private_key: "ea9cfa25236efea5022623f24b318a19bb8f7e8bb9e3bfa8217ab0aeb76088d1",
            host_public_key: "6e9185368668e69f83f44f1421c49c2079a04de0f302d54cd614ba29fdda1130",
            shared_secret: "1ac63078d1e00a3f50096ef5beb0e94878eaf924c2ee9316485919c6429e2f1e",
        },
        ExchangeVector {
            code: "999999",
            handshake_hash: "336514c98ab6fd67c89f22cf0c01fb26297346782ca6f325f4595c49f9134e80",
            trezor_public_key: "b1b48fe2d68edc77860eb480f955f59701dd342d6454397eeafac6cec59cbe02",
            host_private_key: "9b223da6b57a4478e7a9fa2e980d0ff62386555ece25224296638b37d27a3369",
            host_public_key: "6839ab339ab33410d91c499bf2cbf704c09244b0ec3eea611050a23cc1e5f513",
            shared_secret: "b28657a0849955cf161f2ecb98894d1e2e1f7830e5d3c4a88a046de54df70925",
        },
        ExchangeVector {
            code: "007300",
            handshake_hash: "1ac56f73c7685469f91703e7f4bfeecddeefa1c0488fbed54d55e0a8f2dd38f5",
            trezor_public_key: "a33d664ceff80ff25bec6231e02f285434074efa12ae4c91cf125f4aac4bdf64",
            host_private_key: "86e91d52f4a6d926ed8ab31172aacc7e432b2afae3731d85d6f44dd233e12f2b",
            host_public_key: "a0944040220d8b65cdcf77fee5015844aaa4748e3bf30cb38a3b34326d9d9a23",
            shared_secret: "f71eaa38725632cabe527e5dadb9d4703fec818edeb80adcb742a0f172c6a009",
        },
        ExchangeVector {
            code: "100000",
            handshake_hash: "72d2bc6036e8d203c3fe010d73a1d0055f1e21faaf69f69bc1807cd5eff2e736",
            trezor_public_key: "5ab225bf64caa99ff4a6ef016be6c40fae01e6bcc3ad81e1d79f51eb6bd47a0d",
            host_private_key: "54f29665bf918b317e0cbeeb398ae7784b8e9657a860ccf7e4911ac160fda662",
            host_public_key: "f2e7271b2908d000a878e8b3f6557c6f57b89d1575a04fc48b2ceb1d15a2e117",
            shared_secret: "a3acf557577b72f15ccf3e0e24cd99778a346745d209030cee2ba93371fd7e51",
        },
        ExchangeVector {
            code: "424242",
            handshake_hash: "e290442b6b4f0670fcd12279f6e298d5f6bf9a5e8a3cf41ad65dd5e648f96f3e",
            trezor_public_key: "a5f3c150289c67a0a50836746d244966c5e10c3d087a30e458bf3a2cab4dc55c",
            host_private_key: "8c4428e7d928a776f6454ef042e250e1b3b7a985fd9fb0131184449d66f6bba0",
            host_public_key: "a5e83a2e7303d0bd316b92f0d24a0102032901f7cc09f1617d8a5c448decba47",
            shared_secret: "42ef299edd31c9a3bbf21da610d38562c9d5d7fe45a36f03a9781230c25d9379",
        },
        ExchangeVector {
            code: "050505",
            handshake_hash: "ccc3b791f7d422527d2144a1fc8106ef8431fd6f2b230bd7776c3c877a04fc96",
            trezor_public_key: "10e6752bd44aee5a11fa5d3e2f6c970e47a119de952dcf36b144cb00f6e62093",
            host_private_key: "b901a126ebae395a9b9769d840afcb0eacd5ae0ebf7328e76f721465d3a2f7a0",
            host_public_key: "2dc00cb355a75536dacc72c1b7e1b3242ca0bade69bee520200f38be3bcf4706",
            shared_secret: "1b595d56352869efc920e547a1e813cbc93a7df879a6134b080fe6ef40227845",
        },
        ExchangeVector {
            code: "000001",
            handshake_hash: "f4f2a3215a4e9758d226346e7b97cc539ac2e74905d51247dd33138854e166be",
            trezor_public_key: "110595fc7b740bb066864c3b9736024196390daa2aea37c999950ed54090302f",
            host_private_key: "7169d5df4335962aabc53ba7c1ba75c72f87ce5e49795dcea78b34cba45ff278",
            host_public_key: "b466b152a8b24457d0de224672c7300f532921b0201455810b0d14fa8e9de901",
            shared_secret: "31fd94e46898bbbf15e33040c3dcc0d1f267516cc8932e0a22488cfc773fd479",
        },
    ];

    pub(crate) const GENERATOR_STRING_HEX: &str = "084350616365323535063030303034326f00000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000020000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f00";

    fn h32(s: &str) -> [u8; 32] {
        hex::decode(s).unwrap().try_into().unwrap()
    }

    #[test]
    fn constants_match_python() {
        assert_eq!(
            hex::encode(P_MINUS_2),
            "ebffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f"
        );
        assert_eq!(
            hex::encode(P_MINUS_5_DIV_8),
            "fdffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff0f"
        );
    }

    #[test]
    fn sqrt_minus_one_squares_to_minus_one() {
        let s = Fe::from_bytes(&SQRT_M1);
        let minus_one = Fe::ONE.neg();
        assert_eq!(s.square().to_bytes(), minus_one.to_bytes());
        let mut p_minus_1 = [0xffu8; 32];
        p_minus_1[0] = 0xec;
        p_minus_1[31] = 0x7f;
        assert_eq!(minus_one.to_bytes(), p_minus_1);
    }

    #[test]
    fn inversion_gives_one() {
        for (x, _, _) in ELLIGATOR_VECTORS.iter().skip(1).take(20) {
            let x = Fe::from_bytes(&h32(x));
            if bool::from(x.ct_eq(&Fe::ZERO)) {
                continue;
            }
            assert_eq!(x.mul(x.invert()).to_bytes(), Fe::ONE.to_bytes());
        }
    }

    #[test]
    fn field_ops_agree_with_identities() {
        let a = Fe::from_bytes(&h32(ELLIGATOR_VECTORS[20].0));
        let b = Fe::from_bytes(&h32(ELLIGATOR_VECTORS[21].0));
        // (a + b) - b == a, a - a == 0, -(-a) == a, (a+b)^2 == a^2 + 2ab + b^2
        assert_eq!(a.add(b).sub(b).to_bytes(), a.to_bytes());
        assert_eq!(a.sub(a).to_bytes(), [0u8; 32]);
        assert_eq!(a.neg().neg().to_bytes(), a.to_bytes());
        let ab = a.mul(b);
        let lhs = a.add(b).square();
        let rhs = a.square().add(ab).add(ab).add(b.square());
        assert_eq!(lhs.to_bytes(), rhs.to_bytes());
    }

    #[test]
    fn from_to_bytes_reduces_like_decode_coordinate() {
        for (input, decoded, _) in ELLIGATOR_VECTORS {
            assert_eq!(
                hex::encode(Fe::from_bytes(&h32(input)).to_bytes()),
                *decoded,
                "input {input}"
            );
        }
    }

    #[test]
    fn elligator2_matches_reference() {
        assert!(ELLIGATOR_VECTORS.len() >= 64);
        let mut seen = [[false; 2]; 2];
        for (input, _, expected) in ELLIGATOR_VECTORS {
            let (out, e1, e3) = elligator2_choices(&h32(input));
            let (e1, e3) = (bool::from(e1), bool::from(e3));
            assert_eq!(hex::encode(out), *expected, "input {input}");
            assert_eq!(elligator2(&h32(input)), out);
            seen[0][usize::from(e1)] = true;
            seen[1][usize::from(e3)] = true;
        }
        // Both outcomes of both conditional moves occur in the vectors.
        assert_eq!(seen, [[true, true], [true, true]]);
    }

    #[test]
    fn generator_string_matches_reference() {
        let ci: Vec<u8> = (0..32).collect();
        let got = generator_string(b"000042", &ci).unwrap();
        assert_eq!(hex::encode(got), GENERATOR_STRING_HEX);
    }

    #[test]
    fn generator_string_rejects_long_input() {
        assert_eq!(
            generator_string(&[b'1'; 128], &[0; 32]),
            Err(CpaceError::InputTooLong)
        );
        assert_eq!(
            generator_string(b"000042", &[0; 128]),
            Err(CpaceError::InputTooLong)
        );
    }

    #[test]
    fn exchanges_match_reference() {
        assert!(EXCHANGE_VECTORS.len() >= 8);
        for v in EXCHANGE_VECTORS {
            let r = cpace_with_key(
                v.code.as_bytes(),
                &hex::decode(v.handshake_hash).unwrap(),
                &h32(v.trezor_public_key),
                h32(v.host_private_key),
            )
            .unwrap();
            assert_eq!(
                hex::encode(r.host_public_key),
                v.host_public_key,
                "code {}",
                v.code
            );
            assert_eq!(
                hex::encode(r.shared_secret),
                v.shared_secret,
                "code {}",
                v.code
            );
        }
    }

    #[test]
    fn low_order_points_are_rejected() {
        let mut one = [0u8; 32];
        one[0] = 1;
        let ci = [7u8; 32];
        for point in [[0u8; 32], one] {
            let err = cpace_with_key(b"123456", &ci, &point, [9u8; 32]).unwrap_err();
            assert_eq!(err, CpaceError::LowOrderPoint);
            assert!(!err.to_string().is_empty());
        }
    }

    #[test]
    fn random_key_exchange_is_consistent() {
        let ci = [3u8; 32];
        let mut other = [0u8; 32];
        other[0] = 9;
        let a = cpace(b"000042", &ci, &other).unwrap();
        let b = cpace(b"000042", &ci, &other).unwrap();
        assert_ne!(a.host_public_key, b.host_public_key);
    }
}
