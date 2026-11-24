//! Pairing credentials: what the host keeps so that it need not pair again,
//! and the lookup the handshake does with them.
//!
//! A credential ties one device (its static public key) to one host static
//! private key, with the opaque credential blob the device issued. During the
//! Noise handshake the device sends its static key masked, and the host finds
//! the credential for it with the rule of `trezorlib/thp/credentials.py`.

use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use prost::Message as _;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use trezor_thp::credential::{CredentialStore, FoundCredential};
use zeroize::{Zeroize, Zeroizing};

use crate::error::{Result, TrezorError};
use crate::messages::ThpHandshakeCompletionReqNoisePayload;

/// Length of X25519 keys.
const KEY_LEN: usize = 32;

/// The longest credential from the device that can be sent back: the handshake
/// payload wraps it in a protobuf field (a tag byte and a one-byte length, as
/// the credential is shorter than 128 bytes), and the whole payload must fit
/// `trezor-thp`'s buffer.
pub(crate) const MAX_CREDENTIAL_LEN: usize = trezor_thp::channel::MAX_CREDENTIAL_LEN - 2;

/// Serializes byte strings as lowercase hex.
mod hex_bytes {
    use serde::{Deserialize, Deserializer, Serializer, de::Error};
    use zeroize::Zeroizing;

    pub fn serialize<S: Serializer, T: AsRef<[u8]>>(
        value: &T,
        serializer: S,
    ) -> Result<S::Ok, S::Error> {
        // The text may carry the host static private key.
        let text = Zeroizing::new(hex::encode(value.as_ref()));
        serializer.serialize_str(&text)
    }

    pub fn deserialize<'de, D: Deserializer<'de>, T: for<'a> TryFrom<&'a [u8]>>(
        deserializer: D,
    ) -> Result<T, D::Error> {
        let text = Zeroizing::new(String::deserialize(deserializer)?);
        let bytes = Zeroizing::new(hex::decode(text.as_bytes()).map_err(D::Error::custom)?);
        T::try_from(bytes.as_slice()).map_err(|_| D::Error::custom("wrong length"))
    }
}

/// One pairing: the device, the host key that goes with it, and the credential
/// the device issued for that key.
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Credential {
    /// The device's static public key.
    #[serde(with = "hex_bytes")]
    pub trezor_static_pubkey: [u8; 32],
    /// The host's static private key the device issued the credential for.
    #[serde(with = "hex_bytes")]
    pub host_static_privkey: [u8; 32],
    /// The credential blob, sent to the device in the handshake.
    #[serde(with = "hex_bytes")]
    pub credential: Vec<u8>,
}

impl std::fmt::Debug for Credential {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Credential")
            .field(
                "trezor_static_pubkey",
                &hex::encode(self.trezor_static_pubkey),
            )
            .field("host_static_privkey", &"<hidden>")
            .field("credential_len", &self.credential.len())
            .finish()
    }
}

impl Drop for Credential {
    fn drop(&mut self) {
        self.host_static_privkey.zeroize();
    }
}

/// Where credentials live between runs.
pub trait CredentialStorage {
    /// Every credential known, in any order.
    fn load(&self) -> Result<Vec<Credential>>;

    /// Remembers `credential`. A credential for the same device replaces the
    /// earlier one.
    fn store(&self, credential: &Credential) -> Result<()>;
}

/// Credentials kept in memory only: they are gone when the process ends.
#[derive(Default)]
pub struct MemoryCredentialStorage {
    credentials: Mutex<Vec<Credential>>,
}

impl MemoryCredentialStorage {
    pub fn new() -> Self {
        Self::default()
    }
}

impl CredentialStorage for MemoryCredentialStorage {
    fn load(&self) -> Result<Vec<Credential>> {
        let credentials = self
            .credentials
            .lock()
            .map_err(|_| TrezorError::Credentials("storage lock poisoned".into()))?;
        Ok(credentials.clone())
    }

    fn store(&self, credential: &Credential) -> Result<()> {
        let mut credentials = self
            .credentials
            .lock()
            .map_err(|_| TrezorError::Credentials("storage lock poisoned".into()))?;
        credentials.retain(|c| c.trezor_static_pubkey != credential.trezor_static_pubkey);
        credentials.push(credential.clone());
        Ok(())
    }
}

/// Version of the credential file format.
const FILE_VERSION: u32 = 1;

/// The JSON document of a [`FileCredentialStorage`].
#[derive(Serialize, Deserialize)]
struct CredentialFile {
    version: u32,
    credentials: Vec<Credential>,
}

/// Credentials kept in one JSON file.
///
/// A missing file means no credentials. A file that cannot be read or parsed
/// is an error naming the path, and is never overwritten: the user decides
/// whether to delete it. The file holds host private keys, so it is written
/// with mode 0600 (and its directory created with mode 0700) on Unix. Each
/// write goes to a temporary file in the same directory and is renamed over
/// the old one, so a crash leaves either the old or the new file.
pub struct FileCredentialStorage {
    path: PathBuf,
    /// Serializes this process's read-modify-write cycles.
    write_lock: Mutex<()>,
}

impl FileCredentialStorage {
    /// A store in the file at `path`. Nothing is touched until it is used.
    pub fn new(path: impl Into<PathBuf>) -> Self {
        FileCredentialStorage {
            path: path.into(),
            write_lock: Mutex::new(()),
        }
    }

    /// The file this store uses.
    pub fn path(&self) -> &Path {
        &self.path
    }

    fn error(&self, what: impl std::fmt::Display) -> TrezorError {
        TrezorError::Credentials(format!("{}: {what}", self.path.display()))
    }

    fn read(&self) -> Result<Vec<Credential>> {
        let bytes = match std::fs::read(&self.path) {
            Ok(bytes) => Zeroizing::new(bytes),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(e) => return Err(self.error(format!("cannot be read: {e}"))),
        };
        let file: CredentialFile = serde_json::from_slice(&bytes)
            .map_err(|e| self.error(format!("is not a credential file ({e}); fix or delete it")))?;
        if file.version != FILE_VERSION {
            return Err(self.error(format!(
                "has format version {}, this program reads version {FILE_VERSION}",
                file.version
            )));
        }
        Ok(file.credentials)
    }

    fn write(&self, credentials: Vec<Credential>) -> Result<()> {
        let file = CredentialFile {
            version: FILE_VERSION,
            credentials,
        };
        let json = Zeroizing::new(
            serde_json::to_vec_pretty(&file)
                .map_err(|e| self.error(format!("cannot be encoded: {e}")))?,
        );
        let dir = match self.path.parent() {
            Some(dir) if !dir.as_os_str().is_empty() => dir.to_path_buf(),
            _ => PathBuf::from("."),
        };
        create_private_dir(&dir)
            .map_err(|e| self.error(format!("directory cannot be created: {e}")))?;
        let file_name = self
            .path
            .file_name()
            .ok_or_else(|| self.error("is not a file path"))?
            .to_string_lossy();
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let temporary = dir.join(format!(
            ".{file_name}.{}.{}.tmp",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let result = write_private_file(&temporary, &json)
            .and_then(|()| std::fs::rename(&temporary, &self.path));
        if let Err(e) = result {
            let _ = std::fs::remove_file(&temporary);
            return Err(self.error(format!("cannot be written: {e}")));
        }
        sync_dir(&dir);
        Ok(())
    }
}

/// Creates `dir` and its missing parents, the new ones private to the user.
fn create_private_dir(dir: &Path) -> std::io::Result<()> {
    let mut builder = std::fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt as _;
        builder.mode(0o700);
    }
    builder.create(dir)
}

/// Writes a new file at `path`, readable by the user only, and flushes it.
fn write_private_file(path: &Path, contents: &[u8]) -> std::io::Result<()> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt as _;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    file.write_all(contents)?;
    file.sync_all()
}

/// Flushes the directory entry of a rename, where the platform allows it.
fn sync_dir(dir: &Path) {
    #[cfg(unix)]
    if let Ok(handle) = std::fs::File::open(dir) {
        let _ = handle.sync_all();
    }
    #[cfg(not(unix))]
    let _ = dir;
}

impl CredentialStorage for FileCredentialStorage {
    fn load(&self) -> Result<Vec<Credential>> {
        self.read()
    }

    fn store(&self, credential: &Credential) -> Result<()> {
        let _guard = self.write_lock.lock().unwrap_or_else(|e| e.into_inner());
        let mut credentials = self.read()?;
        credentials.retain(|c| c.trezor_static_pubkey != credential.trezor_static_pubkey);
        credentials.push(credential.clone());
        self.write(credentials)
    }
}

/// Whether `credential` belongs to the device that sent `masked_static_pubkey`
/// with `ephemeral_pubkey`: `x25519(SHA-256(trezor_static_pubkey ||
/// ephemeral_pubkey), trezor_static_pubkey) == masked_static_pubkey`.
fn matches(credential: &Credential, ephemeral_pubkey: &[u8], masked_static_pubkey: &[u8]) -> bool {
    let mut hasher = Sha256::new();
    hasher.update(credential.trezor_static_pubkey);
    hasher.update(ephemeral_pubkey);
    let mask: Zeroizing<[u8; KEY_LEN]> = Zeroizing::new(hasher.finalize().into());
    let masked = x25519_dalek::x25519(*mask, credential.trezor_static_pubkey);
    // The comparison is not secret (all inputs are public), so `==` is fine.
    masked.as_slice() == masked_static_pubkey
}

/// The keys of one handshake: the credentials known, and a fresh host static
/// key for when none matches.
pub(crate) struct HandshakeKeys {
    known: Vec<Credential>,
    fresh: Zeroizing<[u8; KEY_LEN]>,
    /// The key the handshake used, once `lookup` ran.
    chosen: Option<Zeroizing<[u8; KEY_LEN]>>,
    /// Whether `lookup` found a stored credential and sent it, as opposed to
    /// sending the fresh key and an empty credential.
    matched: bool,
}

impl HandshakeKeys {
    /// Builds the keys from `known` credentials and a new random key.
    pub(crate) fn new(known: Vec<Credential>) -> Result<Self> {
        let mut fresh = Zeroizing::new([0u8; KEY_LEN]);
        crate::random::fill(fresh.as_mut_slice())
            .map_err(|e| TrezorError::Protocol(format!("random source failed: {e}")))?;
        Ok(Self::with_fresh_key(known, *fresh))
    }

    /// As [`HandshakeKeys::new`], with the fresh key given (for tests).
    pub(crate) fn with_fresh_key(known: Vec<Credential>, fresh: [u8; KEY_LEN]) -> Self {
        HandshakeKeys {
            known,
            fresh: Zeroizing::new(fresh),
            chosen: None,
            matched: false,
        }
    }

    /// Whether the handshake used a stored credential (the device sent a
    /// static key one of them belongs to). False before the handshake looked,
    /// and when nothing matched.
    pub(crate) fn credential_matched(&self) -> bool {
        self.matched
    }

    /// The host static private key the handshake used: the matching
    /// credential's, or the fresh one if none matched (or the handshake has
    /// not looked yet).
    pub(crate) fn chosen_privkey(&self) -> [u8; KEY_LEN] {
        match &self.chosen {
            Some(key) => **key,
            None => *self.fresh,
        }
    }

    /// The credential blob sent in the handshake: the matching credential's,
    /// or empty.
    #[cfg(test)]
    fn find(&self, ephemeral_pubkey: &[u8], masked_static_pubkey: &[u8]) -> Option<&Credential> {
        self.known
            .iter()
            .find(|c| matches(c, ephemeral_pubkey, masked_static_pubkey))
    }
}

/// Locks the keys of a handshake. A panic elsewhere cannot leave them in a
/// half-written state (every update is a single assignment), so a poisoned
/// lock is still usable.
pub(crate) fn lock_keys(keys: &Mutex<HandshakeKeys>) -> MutexGuard<'_, HandshakeKeys> {
    keys.lock().unwrap_or_else(|e| e.into_inner())
}

/// The handshake's view of [`HandshakeKeys`], which `trezor-thp` calls while
/// it runs.
///
/// `lookup` always finds something. When it returns `None` the crate makes a
/// host key of its own and never says what it is, and the host needs that key
/// to store a credential after pairing. Returning the fresh key with an empty
/// credential is exactly what the crate sends when nothing is found.
pub(crate) struct HandshakeStore(pub Arc<Mutex<HandshakeKeys>>);

impl CredentialStore for HandshakeStore {
    fn lookup<'a>(
        &self,
        ephemeral_pubkey: &[u8],
        masked_static_pubkey: &[u8],
        dest: &'a mut [u8],
    ) -> Option<FoundCredential<'a>> {
        #[cfg(test)]
        crate::testing::note_lookup(ephemeral_pubkey, masked_static_pubkey);
        let mut keys = lock_keys(&self.0);
        let (key_dest, credential_dest) = dest.split_at_mut(KEY_LEN);
        let found = keys
            .known
            .iter()
            .find(|c| matches(c, ephemeral_pubkey, masked_static_pubkey))
            // A credential that does not fit the crate's buffer cannot be
            // sent; fall back to a fresh key, which makes the device pair.
            .filter(|c| c.credential.len() <= MAX_CREDENTIAL_LEN);
        // `trezor-thp` sends this as the Noise payload of the handshake as it
        // is, and the device reads that payload as a
        // `ThpHandshakeCompletionReqNoisePayload`, so the credential goes in
        // wrapped (trezorlib: `channel.py`, `_send_handshake_completion_request`).
        let mut matched = false;
        let (privkey, credential_len) = match found {
            Some(c) => {
                let payload = ThpHandshakeCompletionReqNoisePayload {
                    host_pairing_credential: Some(c.credential.clone()),
                }
                .encode_to_vec();
                match credential_dest.get_mut(..payload.len()) {
                    Some(room) => {
                        room.copy_from_slice(&payload);
                        matched = true;
                        (Zeroizing::new(c.host_static_privkey), payload.len())
                    }
                    None => (keys.fresh.clone(), 0),
                }
            }
            None => (keys.fresh.clone(), 0),
        };
        key_dest.copy_from_slice(privkey.as_slice());
        keys.chosen = Some(privkey);
        keys.matched = matched;
        let key_dest: &'a [u8] = key_dest;
        let credential_dest: &'a [u8] = credential_dest;
        Some(FoundCredential {
            local_static_privkey: key_dest.try_into().ok()?,
            auth_credential: &credential_dest[..credential_len],
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A device key pair from a fixed seed, as the public half only.
    fn device_pubkey(seed: u8) -> [u8; 32] {
        x25519_dalek::x25519([seed; 32], x25519_dalek::X25519_BASEPOINT_BYTES)
    }

    /// What a device sends for `static_pubkey` and `ephemeral`.
    fn mask(static_pubkey: [u8; 32], ephemeral: &[u8]) -> [u8; 32] {
        let mut hasher = Sha256::new();
        hasher.update(static_pubkey);
        hasher.update(ephemeral);
        let key: [u8; 32] = hasher.finalize().into();
        x25519_dalek::x25519(key, static_pubkey)
    }

    fn credential(seed: u8, blob: &[u8]) -> Credential {
        Credential {
            trezor_static_pubkey: device_pubkey(seed),
            host_static_privkey: [seed.wrapping_add(100); 32],
            credential: blob.to_vec(),
        }
    }

    fn lookup(keys: &Arc<Mutex<HandshakeKeys>>, eph: &[u8], masked: &[u8]) -> (Vec<u8>, Vec<u8>) {
        let store = HandshakeStore(keys.clone());
        let mut buf = vec![0u8; 32 + 128];
        let found = store.lookup(eph, masked, &mut buf).expect("always Some");
        (
            found.local_static_privkey.to_vec(),
            found.auth_credential.to_vec(),
        )
    }

    /// The rule against a value produced by `trezorlib/thp/credentials.py`
    /// (`credentials.py::is_valid` arithmetic with the `cryptography` package):
    /// trezor pubkey = x25519(0x07 * 32, basepoint), ephemeral = 0x42 * 32.
    #[test]
    fn mask_rule_matches_trezorlib() {
        let trezor = device_pubkey(7);
        let masked = mask(trezor, &[0x42; 32]);
        assert_eq!(
            hex::encode(masked),
            include_str!("../tests/data/mask_vector.txt").trim()
        );
    }

    #[test]
    fn matching_credential_is_found() {
        let eph = [0x42u8; 32];
        let known = credential(7, b"blob-seven");
        let other = credential(8, b"blob-eight");
        let keys = Arc::new(Mutex::new(HandshakeKeys::with_fresh_key(
            vec![other.clone(), known.clone()],
            [0xAA; 32],
        )));
        let masked = mask(known.trezor_static_pubkey, &eph);
        assert!(lock_keys(&keys).find(&eph, &masked).is_some());
        let (privkey, blob) = lookup(&keys, &eph, &masked);
        assert_eq!(privkey, known.host_static_privkey);
        // The payload the device reads: field 1, the credential.
        assert_eq!(blob, [&[0x0a, 10][..], b"blob-seven"].concat());
        assert_eq!(lock_keys(&keys).chosen_privkey(), known.host_static_privkey);
        assert!(lock_keys(&keys).credential_matched());
    }

    #[test]
    fn unknown_device_gets_the_fresh_key_and_an_empty_credential() {
        let eph = [0x42u8; 32];
        let keys = Arc::new(Mutex::new(HandshakeKeys::with_fresh_key(
            vec![credential(8, b"blob-eight")],
            [0xAA; 32],
        )));
        // Before the handshake looked, the fresh key is the answer.
        assert_eq!(lock_keys(&keys).chosen_privkey(), [0xAA; 32]);
        let masked = mask(device_pubkey(7), &eph);
        let (privkey, blob) = lookup(&keys, &eph, &masked);
        assert_eq!(privkey, vec![0xAA; 32]);
        assert!(blob.is_empty());
        assert_eq!(lock_keys(&keys).chosen_privkey(), [0xAA; 32]);
        assert!(!lock_keys(&keys).credential_matched());
    }

    #[test]
    fn longest_credential_still_fits_the_handshake_buffer() {
        let eph = [0x42u8; 32];
        for len in [1, 63, MAX_CREDENTIAL_LEN] {
            let known = credential(7, &vec![0x5a; len]);
            let keys = Arc::new(Mutex::new(HandshakeKeys::with_fresh_key(
                vec![known.clone()],
                [0xAA; 32],
            )));
            let masked = mask(known.trezor_static_pubkey, &eph);
            let (privkey, payload) = lookup(&keys, &eph, &masked);
            assert_eq!(privkey, known.host_static_privkey, "len {len}");
            let decoded =
                ThpHandshakeCompletionReqNoisePayload::decode(payload.as_slice()).expect("decode");
            assert_eq!(
                decoded.host_pairing_credential,
                Some(known.credential.clone())
            );
            assert!(payload.len() <= trezor_thp::channel::MAX_CREDENTIAL_LEN);
        }
    }

    #[test]
    fn credential_too_long_for_the_handshake_is_not_used() {
        let eph = [0x42u8; 32];
        let known = credential(7, &[0x5a; MAX_CREDENTIAL_LEN + 1]);
        let keys = Arc::new(Mutex::new(HandshakeKeys::with_fresh_key(
            vec![known.clone()],
            [0xAA; 32],
        )));
        let masked = mask(known.trezor_static_pubkey, &eph);
        let (privkey, payload) = lookup(&keys, &eph, &masked);
        assert_eq!(privkey, vec![0xAA; 32]);
        assert!(payload.is_empty());
    }

    #[test]
    fn wrong_ephemeral_key_does_not_match() {
        let known = credential(7, b"blob-seven");
        let keys = Arc::new(Mutex::new(HandshakeKeys::with_fresh_key(
            vec![known.clone()],
            [0xAA; 32],
        )));
        let masked = mask(known.trezor_static_pubkey, &[0x42; 32]);
        let (privkey, blob) = lookup(&keys, &[0x43; 32], &masked);
        assert_eq!(privkey, vec![0xAA; 32]);
        assert!(blob.is_empty());
    }

    #[test]
    fn debug_hides_the_private_key() {
        let c = credential(7, b"x");
        let text = format!("{c:?}");
        assert!(!text.contains(&hex::encode(c.host_static_privkey)));
        assert!(text.contains("<hidden>"));
    }

    #[test]
    fn credential_round_trips_as_hex_json() {
        let c = credential(7, b"blob");
        let json = serde_json::to_string(&c).expect("serialize");
        assert!(json.contains(&hex::encode(b"blob")));
        let back: Credential = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back, c);
    }

    #[test]
    fn memory_storage_replaces_by_device() {
        let storage = MemoryCredentialStorage::new();
        storage.store(&credential(7, b"one")).expect("store");
        storage.store(&credential(7, b"two")).expect("store");
        storage.store(&credential(8, b"other")).expect("store");
        let all = storage.load().expect("load");
        assert_eq!(all.len(), 2);
        assert!(all.iter().any(|c| c.credential == b"two"));
    }

    /// A directory removed when dropped.
    struct TempDir(PathBuf);

    impl TempDir {
        fn new(tag: &str) -> Self {
            static COUNTER: AtomicU64 = AtomicU64::new(0);
            let dir = std::env::temp_dir().join(format!(
                "thru-trezor-test-{tag}-{}-{}",
                std::process::id(),
                COUNTER.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir_all(&dir).expect("create test directory");
            TempDir(dir)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn file_storage_missing_file_is_empty() {
        let dir = TempDir::new("missing");
        let storage = FileCredentialStorage::new(dir.0.join("none.json"));
        assert!(storage.load().expect("load").is_empty());
        assert!(!dir.0.join("none.json").exists());
    }

    #[test]
    fn file_storage_round_trip_and_replacement() {
        let dir = TempDir::new("roundtrip");
        let path = dir.0.join("credentials.json");
        let storage = FileCredentialStorage::new(&path);
        storage.store(&credential(7, b"one")).expect("store");
        storage.store(&credential(8, b"other")).expect("store");
        storage.store(&credential(7, b"two")).expect("store");

        // A second store object sees what the first wrote.
        let all = FileCredentialStorage::new(&path).load().expect("load");
        assert_eq!(all.len(), 2);
        assert_eq!(
            all.iter()
                .find(|c| c.trezor_static_pubkey == device_pubkey(7))
                .map(|c| c.credential.clone()),
            Some(b"two".to_vec())
        );
        assert!(all.contains(&credential(8, b"other")));

        // Nothing but the credential file is left in the directory.
        let names: Vec<_> = std::fs::read_dir(&dir.0)
            .expect("list")
            .map(|e| e.expect("entry").file_name())
            .collect();
        assert_eq!(names, vec![std::ffi::OsString::from("credentials.json")]);
    }

    #[cfg(unix)]
    #[test]
    fn file_storage_modes_are_private() {
        use std::os::unix::fs::PermissionsExt as _;
        let dir = TempDir::new("modes");
        let path = dir.0.join("nested").join("deeper").join("credentials.json");
        let storage = FileCredentialStorage::new(&path);
        storage.store(&credential(7, b"one")).expect("store");
        let mode = |p: &Path| std::fs::metadata(p).expect("metadata").permissions().mode() & 0o777;
        assert_eq!(mode(&path), 0o600);
        assert_eq!(mode(path.parent().expect("parent")), 0o700);
        // A replacement keeps the mode.
        storage.store(&credential(8, b"two")).expect("store");
        assert_eq!(mode(&path), 0o600);
    }

    #[test]
    fn file_storage_corrupted_file_is_an_error_and_is_kept() {
        let dir = TempDir::new("corrupt");
        let path = dir.0.join("credentials.json");
        std::fs::write(&path, b"{ not json").expect("write");
        let storage = FileCredentialStorage::new(&path);

        let error = storage.load().expect_err("must fail");
        assert!(matches!(&error, TrezorError::Credentials(m) if m.contains("credentials.json")));
        let error = storage
            .store(&credential(7, b"one"))
            .expect_err("must not overwrite");
        assert!(matches!(&error, TrezorError::Credentials(m) if m.contains("credentials.json")));
        assert_eq!(std::fs::read(&path).expect("read"), b"{ not json");
    }

    #[test]
    fn file_storage_unknown_version_is_an_error() {
        let dir = TempDir::new("version");
        let path = dir.0.join("credentials.json");
        std::fs::write(&path, br#"{"version":2,"credentials":[]}"#).expect("write");
        let error = FileCredentialStorage::new(&path)
            .load()
            .expect_err("must fail");
        assert!(matches!(&error, TrezorError::Credentials(m) if m.contains("version 2")));
    }

    #[test]
    fn file_storage_file_holds_hex_and_no_extra_text() {
        let dir = TempDir::new("format");
        let path = dir.0.join("credentials.json");
        let storage = FileCredentialStorage::new(&path);
        storage.store(&credential(7, b"blob")).expect("store");
        let text = std::fs::read_to_string(&path).expect("read");
        assert!(text.contains(&hex::encode(b"blob")));
        assert!(text.contains("\"version\": 1"));
    }
}
