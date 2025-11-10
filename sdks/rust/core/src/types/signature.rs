use core::fmt;
use data_encoding::BASE64URL_NOPAD;
use zerocopy_derive::{FromBytes, Immutable, KnownLayout};

#[repr(C)]
#[derive(Debug, Clone, Copy, PartialEq, Eq, FromBytes, KnownLayout, Immutable)]
pub struct Signature(pub [u8; 64]);

impl fmt::Display for Signature {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut buf = [0u8; 88]; // max 86 chars for 64 bytes, +2 for safety
        let mut output = &mut buf[0..BASE64URL_NOPAD.encode_len(self.0.len())];
        BASE64URL_NOPAD.encode_mut(&self.0, &mut output);
        let s = core::str::from_utf8(&output).unwrap();
        f.write_str(s)
    }
}
