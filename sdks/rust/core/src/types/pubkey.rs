use core::fmt;
use data_encoding::BASE64URL_NOPAD;
use zerocopy_derive::{FromBytes, Immutable, IntoBytes, KnownLayout};

#[repr(C)]
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Default, FromBytes, KnownLayout, Immutable, IntoBytes,
)]
pub struct Pubkey(pub [u8; 32]);

impl fmt::Display for Pubkey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut buf = [0u8; 44]; // max 43 chars for 32 bytes, +1 for safety
        let mut output = &mut buf[0..BASE64URL_NOPAD.encode_len(self.0.len())];
        BASE64URL_NOPAD.encode_mut(&self.0, &mut output);
        let s = core::str::from_utf8(&output).unwrap();
        f.write_str(s)
    }
}
