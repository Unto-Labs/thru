//! Signing-key reference metadata (`public_key` + `source`) and the shared
//! "open file source, read seed, match canonical `ta` public_key" check.
//! File policy lives in `key_file`; this module never echoes secret input.

use std::{
    io,
    path::{Path, PathBuf},
};

use serde::Deserialize;
use zeroize::Zeroizing;

use crate::{
    key_file,
    signer::{LocalSigner, Signer},
    tn_tools::Pubkey,
};

/// Where a referenced signing key lives.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "type", deny_unknown_fields)]
pub enum KeySource {
    #[serde(rename = "file")]
    File {
        path: PathBuf,
        #[serde(default)]
        managed: bool,
    },
    #[serde(rename = "macos-keychain")]
    MacosKeychain { id: String },
}

/// One `keys:` entry of the CLI config: reference metadata, never a seed.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KeyReference {
    pub public_key: String,
    pub source: KeySource,
}

impl KeyReference {
    /// Canonical 32-byte public key; rejects anything but a canonical `ta` address.
    pub fn expected_public_key(&self) -> io::Result<[u8; 32]> {
        let invalid = |message: &'static str| io::Error::new(io::ErrorKind::InvalidData, message);
        let expected = Pubkey::new(self.public_key.clone())
            .and_then(|public_key| public_key.to_bytes())
            .map_err(|_| invalid("Invalid signing key public_key metadata"))?;
        if Pubkey::from_bytes(&expected).as_str() != self.public_key {
            return Err(invalid(
                "Signing key public_key metadata must be a canonical ta address",
            ));
        }
        Ok(expected)
    }

    /// Open the file source (relative paths resolve against `base_dir`) under the
    /// `key_file` policy, read the seed and check it derives `public_key`.
    /// Returns the seed and its public key. Keychain sources are refused.
    pub fn load_file_seed(
        &self,
        base_dir: &Path,
    ) -> io::Result<(Zeroizing<[u8; 32]>, [u8; 32])> {
        let path = match &self.source {
            KeySource::File { path, .. } => base_dir.join(path),
            KeySource::MacosKeychain { .. } => {
                return Err(io::Error::new(
                    io::ErrorKind::Unsupported,
                    "A dedicated file-backed signing key is required; macos-keychain sources are unsupported and will not be exported or used as a fallback",
                ));
            }
        };
        let expected = self.expected_public_key()?;
        #[cfg(not(unix))]
        return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            format!(
                "{}: signing key files require Unix ownership and permission checks",
                path.display()
            ),
        ));
        #[cfg(unix)]
        {
            let file = key_file::open_key_file(&path)?;
            let seed = key_file::read_seed(file).map_err(|error| {
                io::Error::new(
                    error.kind(),
                    format!("Signing key file {}: {error}", path.display()),
                )
            })?;
            let public_key = LocalSigner::from_seed(*seed).public_key();
            if public_key != expected {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidData,
                    format!(
                        "Signing key file {} does not match public_key metadata",
                        path.display()
                    ),
                ));
            }
            Ok((seed, public_key))
        }
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn reference(directory: &Path, seed: &str) -> KeyReference {
        let path = directory.join("k.hex");
        std::fs::write(&path, format!("\n{seed}\t\n")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        let mut bytes = [0u8; 32];
        hex::decode_to_slice(seed, &mut bytes).unwrap();
        let public_key = LocalSigner::from_seed(bytes).public_key();
        KeyReference {
            public_key: Pubkey::from_bytes(&public_key).as_str().to_string(),
            source: KeySource::File {
                path: PathBuf::from("k.hex"),
                managed: false,
            },
        }
    }

    #[test]
    fn matches_canonical_public_key_and_rejects_mismatch_without_echo() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        let seed = "ab".repeat(32);
        let mut entry = reference(directory.path(), &seed);
        let (loaded, public_key) = entry.load_file_seed(directory.path()).unwrap();
        assert_eq!(*loaded, [0xab; 32]);
        assert_eq!(public_key, entry.expected_public_key().unwrap());

        entry.public_key = Pubkey::from_bytes(&[0; 32]).as_str().to_string();
        let error = entry.load_file_seed(directory.path()).unwrap_err().to_string();
        assert!(error.contains("does not match") && !error.contains(&seed));
        entry.public_key = seed.clone();
        let error = entry.load_file_seed(directory.path()).unwrap_err().to_string();
        assert!(error.contains("metadata") && !error.contains(&seed));

        entry.source = KeySource::MacosKeychain { id: "k.hex".into() };
        let error = entry.load_file_seed(directory.path()).unwrap_err().to_string();
        assert!(error.contains("file-backed") && !error.contains("k.hex"));
    }
}
