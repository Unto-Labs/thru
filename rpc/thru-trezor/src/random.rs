//! The one place this crate asks for random bytes (the host's static key, the
//! pairing challenge, the CPace scalar, the channel allocation nonce).
//!
//! Tests can queue the bytes the next calls must return, so that a whole
//! conversation with a simulated device is reproducible; see `testing.rs`.

/// Fills `dest` from the operating system's random source.
pub(crate) fn fill(dest: &mut [u8]) -> Result<(), getrandom::Error> {
    #[cfg(test)]
    if crate::testing::take_scripted_random(dest) {
        return Ok(());
    }
    getrandom::fill(dest)
}
