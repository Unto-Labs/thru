/// Size of an Ed25519 signature in bytes (FD_ED25519_SIG_SZ in C).
pub const ED25519_SIG_SZ: usize = 64;

/// An Ed25519 signature (fd_ed25519_sig_t in C).
pub type Ed25519Sig = [u8; ED25519_SIG_SZ];
