//! Owner-only filesystem storage shared by signing keys and API credentials.
//! Signing keys additionally require a private parent and a single hard link.
//!
//! Signing key file format, version 1 (what the CLI writes):
//!
//! ```json
//! {
//!   "version": 1,
//!   "key_type": "ed25519",
//!   "public_key": "ta...",
//!   "seed": "<64 hex characters>"
//! }
//! ```
//!
//! Readers also accept the legacy format: a bare 64-hex-character seed.

use std::{
    fs::{self, File, Metadata, OpenOptions},
    io::{self, Read},
    path::Path,
};
use zeroize::Zeroizing;

use crate::{
    signer::{LocalSigner, Signer},
    tn_tools::Pubkey,
};

const MAX_KEY_FILE_BYTES: usize = 4096;

/// Version of the JSON signing key file format.
pub const KEY_FILE_VERSION: u64 = 1;
/// The only key type version 1 defines.
pub const KEY_FILE_KEY_TYPE: &str = "ed25519";

/// How a signing key file was encoded.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyFileFormat {
    /// Version-1 JSON (`version`, `key_type`, `public_key`, `seed`).
    Json,
    /// Legacy bare 64-hex-character seed.
    LegacyHex,
}

fn path_error(path: &Path, error: io::Error) -> io::Error {
    io::Error::new(error.kind(), format!("{}: {error}", path.display()))
}

fn unsafe_path(path: &Path, message: &str) -> io::Error {
    path_error(
        path,
        io::Error::new(io::ErrorKind::PermissionDenied, message),
    )
}

/// Validate effective-user ownership and reject all group/other permissions.
/// On non-Unix platforms, retain the CLI's portable file-type-only policy.
pub fn validate_owner(metadata: &Metadata, path: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        if metadata.uid() != unsafe { libc::geteuid() }
            || metadata.permissions().mode() & 0o077 != 0
        {
            return Err(unsafe_path(
                path,
                "Secret storage must be owned by this user with owner-only permissions",
            ));
        }
    }
    #[cfg(not(unix))]
    let _ = (metadata, path);
    Ok(())
}

pub fn inspect_private_dir(root: &Path) -> io::Result<Option<Metadata>> {
    let metadata = match fs::symlink_metadata(root) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(path_error(root, error)),
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(unsafe_path(
            root,
            "Refusing a symlink or non-directory secret storage directory",
        ));
    }
    validate_owner(&metadata, root)?;
    Ok(Some(metadata))
}

/// Create missing private directories without chmod'ing existing directories.
pub fn ensure_private_dir(root: &Path) -> io::Result<Metadata> {
    if let Some(metadata) = inspect_private_dir(root)? {
        return Ok(metadata);
    }
    let mut builder = fs::DirBuilder::new();
    builder.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    builder
        .create(root)
        .map_err(|error| path_error(root, error))?;
    inspect_private_dir(root)?.ok_or_else(|| {
        path_error(
            root,
            io::Error::new(
                io::ErrorKind::NotFound,
                "Secret storage directory disappeared",
            ),
        )
    })
}

/// Open only a regular, owner-only file without following a final symlink.
/// O_NONBLOCK prevents a raced-in FIFO from hanging before the handle check.
/// This API intentionally preserves the API-credential policy on hard links.
pub fn secure_open(path: &Path, write: bool, create: bool) -> io::Result<File> {
    let mut options = OpenOptions::new();
    options.read(true).write(write).create(create);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err(unsafe_path(
                    path,
                    "Refusing a symlink or non-regular secret file",
                ));
            }
            validate_owner(&metadata, path)?;
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(path_error(path, error)),
    }
    let file = options
        .open(path)
        .map_err(|error| path_error(path, error))?;
    let metadata = file.metadata().map_err(|error| path_error(path, error))?;
    if !metadata.is_file() {
        return Err(unsafe_path(path, "Secret storage must be a regular file"));
    }
    validate_owner(&metadata, path)?;
    Ok(file)
}

/// Open a signing key relative to its already-validated parent descriptor.
pub fn open_key_file(path: &Path) -> io::Result<File> {
    #[cfg(unix)]
    {
        let parent = open_key_parent(path)?;
        open_key_file_at(&parent, path)
    }
    #[cfg(not(unix))]
    {
        let parent = path
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
            .unwrap_or(Path::new("."));
        inspect_private_dir(parent)?.ok_or_else(|| {
            path_error(
                parent,
                io::Error::new(
                    io::ErrorKind::NotFound,
                    "Signing key directory does not exist",
                ),
            )
        })?;
        secure_open(path, false, false)
    }
}

#[cfg(unix)]
fn open_key_parent(path: &Path) -> io::Result<File> {
    use std::os::unix::fs::OpenOptionsExt;

    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let directory = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(parent)
        .map_err(|error| path_error(parent, error))?;
    let metadata = directory
        .metadata()
        .map_err(|error| path_error(parent, error))?;
    validate_owner(&metadata, parent)?;
    Ok(directory)
}

#[cfg(unix)]
fn open_key_file_at(parent: &File, path: &Path) -> io::Result<File> {
    use std::{
        ffi::CString,
        os::{
            fd::{AsRawFd, FromRawFd},
            unix::{ffi::OsStrExt, fs::MetadataExt},
        },
    };

    let name = path
        .file_name()
        .ok_or_else(|| unsafe_path(path, "Signing key path must name a regular file"))?;
    let name = CString::new(name.as_bytes()).map_err(|_| {
        path_error(
            path,
            io::Error::new(io::ErrorKind::InvalidInput, "Invalid signing key path"),
        )
    })?;
    // The parent cannot be redirected by a rename after its ownership check.
    let fd = unsafe {
        libc::openat(
            parent.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC,
        )
    };
    if fd < 0 {
        return Err(path_error(path, io::Error::last_os_error()));
    }
    // SAFETY: openat returned a new descriptor owned exclusively by this File.
    let file = unsafe { File::from_raw_fd(fd) };
    let metadata = file.metadata().map_err(|error| path_error(path, error))?;
    if !metadata.is_file() {
        return Err(unsafe_path(
            path,
            "Signing key storage must be a regular file",
        ));
    }
    validate_owner(&metadata, path)?;
    if metadata.nlink() != 1 {
        return Err(unsafe_path(path, "Refusing a hard-linked signing key file"));
    }
    Ok(file)
}

fn invalid_key(message: &'static str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message)
}

/// The `seed` field decodes straight into zeroizing storage; its text is never
/// kept or echoed.
struct JsonSeed(Zeroizing<[u8; 32]>);

impl<'de> serde::Deserialize<'de> for JsonSeed {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct SeedVisitor;
        impl serde::de::Visitor<'_> for SeedVisitor {
            type Value = JsonSeed;
            fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                formatter.write_str("a 64-character hex seed")
            }
            fn visit_str<E: serde::de::Error>(self, value: &str) -> Result<JsonSeed, E> {
                let mut seed = Zeroizing::new([0; 32]);
                hex::decode_to_slice(value, seed.as_mut())
                    .map_err(|_| E::custom("invalid seed"))?;
                Ok(JsonSeed(seed))
            }
        }
        deserializer.deserialize_str(SeedVisitor)
    }
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct KeyFileV1 {
    version: u64,
    key_type: String,
    public_key: String,
    seed: JsonSeed,
}

fn decode_json_key(raw: &[u8]) -> io::Result<Zeroizing<[u8; 32]>> {
    let file: KeyFileV1 = serde_json::from_slice(raw).map_err(|error| {
        // serde messages can quote values; report only the position.
        io::Error::new(
            io::ErrorKind::InvalidData,
            format!(
                "Signing key file is not a valid version-1 key file (JSON error at line {}, column {})",
                error.line(),
                error.column()
            ),
        )
    })?;
    if file.version != KEY_FILE_VERSION {
        return Err(invalid_key(
            "Unsupported signing key file version; expected 1",
        ));
    }
    if file.key_type != KEY_FILE_KEY_TYPE {
        return Err(invalid_key(
            "Unsupported signing key type; expected ed25519",
        ));
    }
    let derived = Pubkey::from_bytes(&LocalSigner::from_seed(*file.seed.0).public_key());
    if derived.as_str() != file.public_key {
        return Err(invalid_key(
            "Signing key file public_key does not match its seed",
        ));
    }
    Ok(file.seed.0)
}

/// Decode a version-1 JSON key file or a legacy bare hex seed. Errors never
/// include the input.
pub fn decode_key_file(raw: &[u8]) -> io::Result<(Zeroizing<[u8; 32]>, KeyFileFormat)> {
    if raw.len() > MAX_KEY_FILE_BYTES {
        return Err(invalid_key("Signing key input exceeds the 4096-byte limit"));
    }
    let raw = raw.trim_ascii();
    if raw.first() == Some(&b'{') {
        return decode_json_key(raw).map(|seed| (seed, KeyFileFormat::Json));
    }
    let mut seed = Zeroizing::new([0; 32]);
    hex::decode_to_slice(raw, seed.as_mut()).map_err(|_| {
        invalid_key(
            "Signing key must be a version-1 JSON key file or exactly 64 hexadecimal characters (a 32-byte seed)",
        )
    })?;
    Ok((seed, KeyFileFormat::LegacyHex))
}

pub fn decode_seed(raw: &[u8]) -> io::Result<Zeroizing<[u8; 32]>> {
    decode_key_file(raw).map(|(seed, _)| seed)
}

/// Encode `seed` as a version-1 JSON key file. The result holds the seed, so it
/// is zeroized on drop; its capacity is reserved so no partial copy is left.
pub fn encode_key_file(seed: &[u8; 32]) -> Zeroizing<String> {
    let address = Pubkey::from_bytes(&LocalSigner::from_seed(*seed).public_key());
    let mut hex_seed = Zeroizing::new([0; 64]);
    hex::encode_to_slice(seed, hex_seed.as_mut()).expect("64-byte buffer for a 32-byte seed");
    let mut out = Zeroizing::new(String::with_capacity(256));
    out.push_str("{\n  \"version\": 1,\n  \"key_type\": \"ed25519\",\n  \"public_key\": \"");
    out.push_str(address.as_str());
    out.push_str("\",\n  \"seed\": \"");
    out.push_str(std::str::from_utf8(hex_seed.as_ref()).expect("hex is ASCII"));
    out.push_str("\"\n}\n");
    out
}

/// Read at most 4097 bytes and report the format; never include reader data in
/// diagnostics.
pub fn read_key_file(reader: impl Read) -> io::Result<(Zeroizing<[u8; 32]>, KeyFileFormat)> {
    let mut raw = Zeroizing::new([0; MAX_KEY_FILE_BYTES + 1]);
    let mut length = 0;
    let mut reader = reader.take(raw.len() as u64);
    while length < raw.len() {
        match reader.read(&mut raw[length..]) {
            Ok(0) => break,
            Ok(count) => length += count,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error) => {
                return Err(io::Error::new(
                    error.kind(),
                    "Unable to read signing key input",
                ));
            }
        }
    }
    decode_key_file(&raw[..length])
}

/// Read at most 4097 bytes; never include reader data in diagnostics.
pub fn read_seed(reader: impl Read) -> io::Result<Zeroizing<[u8; 32]>> {
    read_key_file(reader).map(|(seed, _)| seed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seed_decoder_is_bounded_ascii_only_and_sanitized() {
        let seed = "ab".repeat(32);
        assert_eq!(
            *decode_seed(format!(" \t\r\n{seed}\n").as_bytes()).unwrap(),
            [0xab; 32]
        );
        assert_eq!(*read_seed(seed.as_bytes()).unwrap(), [0xab; 32]);
        for raw in [
            format!("\u{a0}{seed}").into_bytes(),
            format!("\u{b}{seed}").into_bytes(),
            format!("{seed}invalid").into_bytes(),
            format!("{seed}{}", " ".repeat(4096)).into_bytes(),
            vec![0xff; 64],
            Vec::new(),
        ] {
            for error in [
                decode_seed(&raw).unwrap_err(),
                read_seed(raw.as_slice()).unwrap_err(),
            ] {
                assert_eq!(error.kind(), io::ErrorKind::InvalidData);
                assert!(!error.to_string().contains(&seed));
            }
        }
    }

    #[test]
    fn json_key_files_round_trip_and_are_strict_without_echo() {
        let seed = [0x5a; 32];
        let hex_seed = hex::encode(seed);
        let encoded = encode_key_file(&seed);
        let (decoded, format) = decode_key_file(encoded.as_bytes()).unwrap();
        assert_eq!((*decoded, format), (seed, KeyFileFormat::Json));
        assert_eq!(*read_seed(encoded.as_bytes()).unwrap(), seed);
        assert_eq!(
            decode_key_file(hex_seed.as_bytes()).unwrap().1,
            KeyFileFormat::LegacyHex
        );
        let value: serde_json::Value = serde_json::from_str(&encoded).unwrap();
        let address = Pubkey::from_bytes(&LocalSigner::from_seed(seed).public_key());
        assert_eq!(value["public_key"], address.as_str());
        assert_eq!(value["version"], 1);
        assert_eq!(value["key_type"], "ed25519");

        let other = Pubkey::from_bytes(&LocalSigner::from_seed([1; 32]).public_key());
        let replace = |from: &str, to: &str| encoded.replace(from, to);
        for (raw, expected) in [
            (replace("\"version\": 1", "\"version\": 2"), "version"),
            (replace("ed25519", "secp256k1"), "key type"),
            (replace(address.as_str(), other.as_str()), "does not match"),
            (
                replace("\"version\": 1,", "\"version\": 1, \"extra\": 0,"),
                "JSON",
            ),
            (replace("\"version\": 1,", ""), "JSON"),
            (replace(&hex_seed, &hex_seed[..62]), "JSON"),
            (
                replace(&format!("\"{hex_seed}\""), &format!("[\"{hex_seed}\"]")),
                "JSON",
            ),
            (replace("\n}\n", ""), "JSON"),
        ] {
            let error = decode_key_file(raw.as_bytes()).unwrap_err();
            assert_eq!(error.kind(), io::ErrorKind::InvalidData);
            let message = error.to_string();
            assert!(message.contains(expected), "{message}");
            assert!(!message.contains(&hex_seed[..16]), "{message}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn owner_only_read_only_modes_are_accepted_without_chmod() {
        use std::os::unix::fs::PermissionsExt;
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("secret");
        secure_open(&path, true, true).unwrap();
        for file_mode in [0o400, 0o600, 0o700] {
            fs::set_permissions(&path, fs::Permissions::from_mode(file_mode)).unwrap();
            fs::set_permissions(directory.path(), fs::Permissions::from_mode(0o500)).unwrap();
            assert!(open_key_file(&path).is_ok());
            assert_eq!(
                ensure_private_dir(directory.path())
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o500
            );
        }
        fs::set_permissions(directory.path(), fs::Permissions::from_mode(0o700)).unwrap();
        for file_mode in [0o604, 0o640, 0o644, 0o660] {
            fs::set_permissions(&path, fs::Permissions::from_mode(file_mode)).unwrap();
            let error = open_key_file(&path).unwrap_err();
            assert!(error.to_string().contains(&path.display().to_string()));
        }
        fs::set_permissions(&path, fs::Permissions::from_mode(0o400)).unwrap();
        for directory_mode in [0o701, 0o710, 0o755] {
            fs::set_permissions(directory.path(), fs::Permissions::from_mode(directory_mode))
                .unwrap();
            assert!(open_key_file(&path).is_err());
            assert!(ensure_private_dir(directory.path()).is_err());
            assert_eq!(
                fs::metadata(directory.path()).unwrap().permissions().mode() & 0o777,
                directory_mode
            );
        }
        fs::set_permissions(directory.path(), fs::Permissions::from_mode(0o700)).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn child_open_stays_in_validated_parent_after_replacement() {
        use std::os::unix::fs::{PermissionsExt, symlink};

        for replace_with_symlink in [false, true] {
            let root = tempfile::tempdir().unwrap();
            let parent_path = root.path().join("keys");
            fs::create_dir(&parent_path).unwrap();
            fs::set_permissions(&parent_path, fs::Permissions::from_mode(0o700)).unwrap();
            let path = parent_path.join("secret");
            let original = "ab".repeat(32);
            fs::write(&path, original).unwrap();
            fs::set_permissions(&path, fs::Permissions::from_mode(0o400)).unwrap();
            let parent = open_key_parent(&path).unwrap();

            // Replace the pathname precisely between parent validation and openat.
            fs::rename(&parent_path, root.path().join("original")).unwrap();
            let replacement = root.path().join("replacement");
            fs::create_dir(&replacement).unwrap();
            fs::set_permissions(&replacement, fs::Permissions::from_mode(0o700)).unwrap();
            let replacement_key = replacement.join("secret");
            fs::write(&replacement_key, "cd".repeat(32)).unwrap();
            fs::set_permissions(&replacement_key, fs::Permissions::from_mode(0o400)).unwrap();
            if replace_with_symlink {
                symlink(&replacement, &parent_path).unwrap();
            } else {
                fs::rename(&replacement, &parent_path).unwrap();
            }

            assert_eq!(
                *read_seed(open_key_file_at(&parent, &path).unwrap()).unwrap(),
                [0xab; 32]
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn signing_files_reject_links_and_non_regular_files() {
        use std::os::unix::fs::symlink;
        let directory = tempfile::tempdir().unwrap();
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(directory.path(), fs::Permissions::from_mode(0o700)).unwrap();
        let path = directory.path().join("secret");
        secure_open(&path, true, true).unwrap();
        let link = directory.path().join("link");
        symlink(&path, &link).unwrap();
        assert!(secure_open(&link, false, false).is_err());
        assert!(secure_open(directory.path(), false, false).is_err());
        fs::remove_file(&link).unwrap();
        fs::hard_link(&path, &link).unwrap();
        assert!(open_key_file(&path).is_err());
        assert!(secure_open(&path, false, false).is_ok());
        let fifo = directory.path().join("fifo");
        let fifo_path = std::ffi::CString::new(fifo.as_os_str().as_encoded_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(fifo_path.as_ptr(), 0o600) }, 0);
        assert!(open_key_file(&fifo).is_err());
        let parent_link = directory.path().join("parent");
        symlink(directory.path(), &parent_link).unwrap();
        assert!(open_key_file(&parent_link.join("secret")).is_err());
        let missing = directory.path().join("missing");
        assert!(
            open_key_file(&missing)
                .unwrap_err()
                .to_string()
                .contains(&missing.display().to_string())
        );
    }
}
