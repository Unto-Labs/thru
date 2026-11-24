//! Loading an app image onto the device, as `trezorlib.extapp.load_tapp`
//! does.
//!
//! An image is three files (`trezorctl extapp load` reads the same):
//! `<name>.tapp` (header and payload chunks), `<name>.proof` beside it, and
//! the root packet in `root-packets/` two directories above the `.tapp`.

use std::path::{Path, PathBuf};

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD as BASE64;
use serde::Deserialize;
use sha2::{Digest, Sha256};

use crate::client::Trezor;
use crate::error::{Result, TrezorError};
use crate::messages::{
    ExtAppDataChunkAck, ExtAppDataChunkRequest, ExtAppHeaderAck, ExtAppHeaderRequest, ExtAppLoad,
    ExtAppLoaded, ExtAppRootPacketAck, ExtAppRootPacketRequest, Version, Wire,
};
use crate::transport::Transport;

/// Magic at the start of an app header.
const HEADER_MAGIC: &[u8; 4] = b"TRZA";
/// Magic at the start of a root packet.
const ROOT_PACKET_MAGIC: &[u8; 4] = b"TRRP";
/// The bytes of the header this crate reads end at the chunk size.
const HEADER_MIN_LEN: usize = 162;
/// Where the header names the model the image was built for: four ASCII
/// characters padded with zeros (`AppHeader.model` of trezorlib), after the
/// id, name and vendor fields of 32 bytes each.
const HEADER_MODEL: std::ops::Range<usize> = 104..108;

#[derive(Deserialize)]
struct TappFile {
    header: String,
    chunks: Vec<(String, String)>,
}

#[derive(Deserialize)]
struct ProofFile {
    proof: Vec<String>,
}

#[derive(Deserialize)]
struct RootPacketFile {
    root_packet: String,
}

/// One payload chunk and the hash the device checks it against: the hash of
/// the chain from the next chunk on (zeros for the last).
#[derive(Clone, Debug)]
pub struct Chunk {
    pub hash: Vec<u8>,
    pub data: Vec<u8>,
}

/// An app image read from disk, ready to send.
#[derive(Clone, Debug)]
pub struct AppImage {
    /// The app's id, for example `thru.thru.org`.
    pub id: String,
    /// The app's version: major, minor, patch, build.
    pub version: [u8; 4],
    /// The privilege ring from the header.
    pub app_ring: u8,
    /// The header, as the device wants it.
    pub header: Vec<u8>,
    /// The concatenated proof.
    pub proof: Vec<u8>,
    /// The root packet.
    pub root_packet: Vec<u8>,
    /// The signing time of the root packet.
    pub root_packet_timestamp: i64,
    pub chunks: Vec<Chunk>,
}

fn image_error(path: &Path, what: impl std::fmt::Display) -> TrezorError {
    TrezorError::AppImage(format!("{}: {what}", path.display()))
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Result<T> {
    let bytes = std::fs::read(path).map_err(|e| image_error(path, e))?;
    serde_json::from_slice(&bytes).map_err(|e| image_error(path, format!("not valid: {e}")))
}

fn decode_base64(path: &Path, field: &str, text: &str) -> Result<Vec<u8>> {
    BASE64
        .decode(text)
        .map_err(|e| image_error(path, format!("{field} is not base64: {e}")))
}

fn sha256(parts: &[&[u8]]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update(part);
    }
    hasher.finalize().into()
}

impl AppImage {
    /// The SHA-256 of the header, `header_size` bytes of it: what the device
    /// records as the image's fingerprint (`app_arena_create_image` hashes
    /// `header_raw` up to `header->header_size`, the bytes it was sent in
    /// `ExtAppHeaderAck.header`) and what trezorlib's
    /// `AppHeader.fingerprint` computes.
    pub(crate) fn fingerprint(&self) -> [u8; 32] {
        let size = self
            .header
            .get(4..8)
            .and_then(|bytes| <[u8; 4]>::try_from(bytes).ok())
            .and_then(|bytes| usize::try_from(u32::from_le_bytes(bytes)).ok())
            .map_or(self.header.len(), |size| size.min(self.header.len()));
        sha256(&[&self.header[..size]])
    }

    /// The model the image was built for, as its header names it: `T3W1` for
    /// the Safe 7, `T3T1` for the Safe 5.
    pub fn model(&self) -> Result<String> {
        let field = self
            .header
            .get(HEADER_MODEL)
            .ok_or_else(|| TrezorError::AppImage("the image header is too short".into()))?;
        let end = field.iter().position(|b| *b == 0).unwrap_or(field.len());
        match std::str::from_utf8(&field[..end]) {
            Ok(model) if !model.is_empty() && model.is_ascii() => Ok(model.to_owned()),
            _ => Err(TrezorError::AppImage(
                "the image header does not name the model the image was built for".into(),
            )),
        }
    }

    /// Reads the image whose `.tapp` is at `tapp_path`, with the `.proof`
    /// beside it and the root packet two directories up, and checks the
    /// chunks against the header.
    ///
    /// Refuses an app version outside `0.1.1 <= version < 0.2.0`.
    pub fn read(tapp_path: impl AsRef<Path>) -> Result<Self> {
        let image = Self::read_any_version(tapp_path.as_ref())?;
        check_image_version(tapp_path.as_ref(), image.version)?;
        Ok(image)
    }

    fn read_any_version(tapp_path: &Path) -> Result<Self> {
        let tapp: TappFile = read_json(tapp_path)?;
        let header = decode_base64(tapp_path, "header", &tapp.header)?;
        let header_info = parse_header(tapp_path, &header)?;

        let proof_path = tapp_path.with_extension("proof");
        let proof_file: ProofFile = read_json(&proof_path)?;
        let proof = hex::decode(proof_file.proof.concat())
            .map_err(|e| image_error(&proof_path, format!("proof is not hex: {e}")))?;

        let root_packet_path = root_packet_path(tapp_path, header_info.app_ring)?;
        let root_packet_file: RootPacketFile = read_json(&root_packet_path)?;
        let root_packet = decode_base64(
            &root_packet_path,
            "root_packet",
            &root_packet_file.root_packet,
        )?;
        let root_packet_timestamp = parse_root_packet(&root_packet_path, &root_packet)?;

        let mut chunks = Vec::with_capacity(tapp.chunks.len());
        for (index, (hash, data)) in tapp.chunks.iter().enumerate() {
            let hash = hex::decode(hash).map_err(|e| {
                image_error(tapp_path, format!("hash of chunk {index} is not hex: {e}"))
            })?;
            let data = decode_base64(tapp_path, &format!("chunk {index}"), data)?;
            chunks.push(Chunk { hash, data });
        }
        check_chunks(
            tapp_path,
            &chunks,
            &header_info.chunk_hash,
            header_info.chunk_size,
        )?;

        Ok(AppImage {
            id: header_info.id,
            version: header_info.version,
            app_ring: header_info.app_ring,
            header,
            proof,
            root_packet,
            root_packet_timestamp,
            chunks,
        })
    }
}

struct HeaderInfo {
    id: String,
    version: [u8; 4],
    app_ring: u8,
    chunk_hash: [u8; 32],
    chunk_size: usize,
}

/// Reads the fields of the header this crate needs (layout of
/// `trezorlib.extapp.AppHeader`, little endian).
fn parse_header(path: &Path, header: &[u8]) -> Result<HeaderInfo> {
    if header.len() < HEADER_MIN_LEN {
        return Err(image_error(path, "header is too short"));
    }
    if &header[0..4] != HEADER_MAGIC {
        return Err(image_error(path, "header does not start with TRZA"));
    }
    let header_size = u32::from_le_bytes([header[4], header[5], header[6], header[7]]);
    if usize::try_from(header_size).map_or(true, |size| size > header.len()) {
        return Err(image_error(
            path,
            format!(
                "header says it is {header_size} bytes but has {}",
                header.len()
            ),
        ));
    }
    let id_field = &header[8..40];
    let id_end = id_field
        .iter()
        .position(|b| *b == 0)
        .unwrap_or(id_field.len());
    let id = std::str::from_utf8(&id_field[..id_end])
        .map_err(|_| image_error(path, "app id is not UTF-8"))?
        .to_owned();
    let mut chunk_hash = [0u8; 32];
    chunk_hash.copy_from_slice(&header[128..160]);
    Ok(HeaderInfo {
        id,
        version: [header[108], header[109], header[110], header[111]],
        app_ring: header[118],
        chunk_hash,
        chunk_size: usize::from(u16::from_le_bytes([header[160], header[161]])),
    })
}

/// Ring 0 apps are signed by the ring 0 root packet, rings 1 and 2 by the
/// other.
fn root_packet_path(tapp_path: &Path, app_ring: u8) -> Result<PathBuf> {
    let name = if app_ring == 0 {
        "rootpacket_ring0.tmr"
    } else {
        "rootpacket_ring12.tmr"
    };
    let root = tapp_path
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .ok_or_else(|| image_error(tapp_path, "has no root-packets directory two levels up"))?;
    Ok(root.join("root-packets").join(name))
}

/// Returns the timestamp of a root packet (`i64` at offset 8).
fn parse_root_packet(path: &Path, packet: &[u8]) -> Result<i64> {
    if packet.len() < 16 || &packet[0..4] != ROOT_PACKET_MAGIC {
        return Err(image_error(path, "not a root packet"));
    }
    let mut bytes = [0u8; 8];
    bytes.copy_from_slice(&packet[8..16]);
    Ok(i64::from_le_bytes(bytes))
}

/// Checks the hash chain as `AppImage.chunks()` of trezorlib does: from the
/// last chunk back, each chunk carries the hash of everything after it, and
/// the result for the first chunk is the header's `chunk_hash`.
fn check_chunks(
    path: &Path,
    chunks: &[Chunk],
    header_chunk_hash: &[u8; 32],
    chunk_size: usize,
) -> Result<()> {
    if chunk_size == 0 {
        return Err(image_error(path, "header chunk size is 0"));
    }
    let mut chain = [0u8; 32];
    for (index, chunk) in chunks.iter().enumerate().rev() {
        let last = index + 1 == chunks.len();
        if chunk.data.len() > chunk_size || (!last && chunk.data.len() != chunk_size) {
            return Err(image_error(
                path,
                format!("chunk {index} has {} bytes", chunk.data.len()),
            ));
        }
        if chunk.hash != chain {
            return Err(image_error(
                path,
                format!("hash of chunk {index} does not follow from the chunks after it"),
            ));
        }
        chain = sha256(&[&chain, &chunk.data]);
    }
    if &chain != header_chunk_hash {
        return Err(image_error(
            path,
            "the chunks do not hash to the header's chunk hash",
        ));
    }
    Ok(())
}

/// One request and the device's answer, as `load` needs it.
trait Exchange {
    fn call_any(&mut self, id: u16, payload: &[u8]) -> Result<(u16, Vec<u8>)>;
}

impl<T: Transport> Exchange for Trezor<T> {
    fn call_any(&mut self, id: u16, payload: &[u8]) -> Result<(u16, Vec<u8>)> {
        Trezor::call_any(self, id, payload)
    }
}

/// Sends `request` and returns whatever the device answers.
fn ask<E: Exchange, Q: Wire>(exchange: &mut E, request: &Q) -> Result<(u16, Vec<u8>)> {
    exchange.call_any(Q::ID, &request.encode_to_vec())
}

fn decode<A: Wire>(data: &[u8]) -> Result<A> {
    A::decode(data)
        .map_err(|e| TrezorError::Unexpected(format!("{} could not be decoded: {e}", A::NAME)))
}

fn unexpected(context: &str, id: u16) -> TrezorError {
    TrezorError::Unexpected(format!("message {id} while {context}"))
}

/// Loads `image` and returns the instance id to address the app with.
///
/// The request names the app id, the image's version as the minimum, and the
/// SHA-256 of the image's header (see [`AppImage::fingerprint`]). The device
/// answers `ExtAppLoaded` at once if it already holds an image of that id with
/// a version at least the one asked for; otherwise it asks for the header,
/// the root packet if its own is out of date, and every chunk.
///
/// What is guaranteed: the app that runs has this image's id (the device
/// matches it) and a version inside the range this host supports (checked on
/// the answer). Whether it is this very image depends on the firmware: one
/// built with Python assertions (the emulator) compares the fingerprint and
/// loads this image when the held one differs; other firmware keeps an image
/// it already holds with the same id and a version at least as high, even if
/// its contents differ.
///
/// Before anything is sent, the model the image was built for (its header)
/// must be the model the device reports (`T3W1` for a Safe 7, `T3T1` for a
/// Safe 5); otherwise this fails with [`TrezorError::AppImage`] naming both.
/// The device does not check it, and the app's texts are built per model.
/// This is a check of the image the host supplies: an image the device holds
/// already is not looked at (see the fingerprint rule above).
pub fn load<T: Transport>(trezor: &mut Trezor<T>, image: &AppImage) -> Result<u32> {
    check_model(&image.model()?, trezor.device_model()?)?;
    load_with(trezor, image)
}

/// [`load`] without the model check, for the vector run, whose made-up image
/// has no model in its header.
#[cfg(test)]
pub(crate) fn load_unchecked<T: Transport>(
    trezor: &mut Trezor<T>,
    image: &AppImage,
) -> Result<u32> {
    load_with(trezor, image)
}

/// Refuses an image built for another model than the device's, naming both.
fn check_model(image_model: &str, device_model: &str) -> Result<()> {
    if image_model == device_model {
        return Ok(());
    }
    Err(TrezorError::AppImage(format!(
        "the app image is built for the {image_model}, and this Trezor is a {device_model}; use \
         the image built for the {device_model}"
    )))
}

fn load_with<E: Exchange>(trezor: &mut E, image: &AppImage) -> Result<u32> {
    let [major, minor, patch, build] = image.version.map(u32::from);
    let (mut id, mut data) = ask(
        trezor,
        &ExtAppLoad {
            id: image.id.clone(),
            version: Version {
                major,
                minor,
                patch: Some(patch),
                build: Some(build),
            },
            fingerprint: Some(image.fingerprint().to_vec()),
        },
    )?;

    if id == ExtAppHeaderRequest::ID {
        (id, data) = ask(
            trezor,
            &ExtAppHeaderAck {
                header: image.header.clone(),
                proof: image.proof.clone(),
                root_packet_timestamp: image.root_packet_timestamp,
            },
        )?;
        // The device asks for each chunk once, and for the root packet at
        // most once; allow slack for nothing else.
        let mut root_packet_sent = false;
        let budget = image.chunks.len() * 2 + 4;
        for _ in 0..budget {
            if id == ExtAppRootPacketRequest::ID && !root_packet_sent {
                root_packet_sent = true;
                (id, data) = ask(
                    trezor,
                    &ExtAppRootPacketAck {
                        root_packet: image.root_packet.clone(),
                    },
                )?;
            } else if id == ExtAppDataChunkRequest::ID {
                let request: ExtAppDataChunkRequest = decode(&data)?;
                let chunk = usize::try_from(request.index)
                    .ok()
                    .and_then(|index| image.chunks.get(index))
                    .ok_or_else(|| {
                        TrezorError::Unexpected(format!(
                            "the device asked for chunk {} of {}",
                            request.index,
                            image.chunks.len()
                        ))
                    })?;
                (id, data) = ask(
                    trezor,
                    &ExtAppDataChunkAck {
                        data: chunk.data.clone(),
                        hash: chunk.hash.clone(),
                    },
                )?;
            } else {
                break;
            }
        }
    }

    if id != ExtAppLoaded::ID {
        return Err(unexpected("loading the app", id));
    }
    // Both paths end here: the app was held or was just uploaded. The
    // version asked for is only a minimum for the device, so what it ran may
    // be a newer one this host does not know the protocol of.
    let loaded: ExtAppLoaded = decode(&data)?;
    check_loaded_version(&loaded.version)?;
    Ok(loaded.instance_id)
}

/// The app versions this host speaks: `0.1.1 <= version < 0.2.0`. Patch 1
/// added the optional token hint and the message signing messages; a version
/// without a patch number is patch 0.
const SUPPORTED_RANGE: &str = "0.1.1 up to (not including) 0.2.0";

/// Whether `major.minor.patch` is in [`SUPPORTED_RANGE`].
fn version_supported(major: u32, minor: u32, patch: u32) -> bool {
    (major, minor, patch) >= (0, 1, 1) && (major, minor) < (0, 2)
}

/// Refuses an app version outside the supported range, naming both.
fn check_loaded_version(version: &Version) -> Result<()> {
    if version_supported(version.major, version.minor, version.patch.unwrap_or(0)) {
        return Ok(());
    }
    let part = |value: Option<u32>| value.map_or_else(|| "?".to_owned(), |v| v.to_string());
    Err(TrezorError::App(format!(
        "the device runs app version {}.{}.{}.{}, this host supports {SUPPORTED_RANGE}; \
         update thru or the app on the device",
        version.major,
        version.minor,
        part(version.patch),
        part(version.build),
    )))
}

/// The same rule for the version in an image header.
fn check_image_version(path: &Path, version: [u8; 4]) -> Result<()> {
    if version_supported(
        u32::from(version[0]),
        u32::from(version[1]),
        u32::from(version[2]),
    ) {
        return Ok(());
    }
    Err(image_error(
        path,
        format!(
            "app version {}.{}.{}.{} is not supported, this host supports {SUPPORTED_RANGE}",
            version[0], version[1], version[2], version[3]
        ),
    ))
}

#[cfg(test)]
mod tests {
    use prost::Message as _;

    use super::*;

    const IMAGE: &str = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../trezor/app-thru/target/artifacts/serialized/thru.thru.org/0.1.1.0/",
        "thru.thru.org_0.1.1.0_sdk0.1_macos-aarch64_abi1_T3W1_en.tapp"
    );

    /// The built image is not committed. Without it the tests that read it
    /// have nothing to read; the emulator script fails loudly in that case.
    fn image_or_skip() -> Option<AppImage> {
        if !Path::new(IMAGE).exists() {
            eprintln!("skipped: no app image at {IMAGE}");
            return None;
        }
        Some(AppImage::read_any_version(Path::new(IMAGE)).expect("the image reads"))
    }

    fn version(major: u32, minor: u32, patch: Option<u32>, build: Option<u32>) -> Version {
        Version {
            major,
            minor,
            patch,
            build,
        }
    }

    /// 512 bytes `(i * 7 + 3) % 256` with the magic and a `header_size` of
    /// 400: the 112 bytes after `header_size` are not part of the fingerprint.
    fn test_header() -> Vec<u8> {
        let mut header: Vec<u8> = (0..512usize).map(|i| ((i * 7 + 3) % 256) as u8).collect();
        header[0..4].copy_from_slice(b"TRZA");
        header[4..8].copy_from_slice(&400u32.to_le_bytes());
        header
    }

    fn test_image() -> AppImage {
        AppImage {
            id: "thru.thru.org".into(),
            version: [0, 1, 1, 0],
            app_ring: 2,
            header: test_header(),
            proof: vec![0x11; 32],
            root_packet: vec![0x22; 16],
            root_packet_timestamp: 7,
            chunks: vec![
                Chunk {
                    hash: vec![0x33; 32],
                    data: vec![1, 2, 3],
                },
                Chunk {
                    hash: vec![0; 32],
                    data: vec![4],
                },
            ],
        }
    }

    /// `hashlib.sha256(header[:400]).hexdigest()` in Python, computed apart
    /// from this crate.
    const TEST_FINGERPRINT: &str =
        "f105247e6b5f623a0e5df964209b818ca710b5ed11cdde6753b4158dfaa4d84b";

    #[test]
    fn the_fingerprint_is_the_sha256_of_header_size_bytes() {
        let image = test_image();
        assert_eq!(hex::encode(image.fingerprint()), TEST_FINGERPRINT);
        // Not of the whole 512 bytes.
        assert_ne!(
            hex::encode(sha256(&[&image.header])),
            TEST_FINGERPRINT,
            "the bytes after header_size must not count"
        );
    }

    #[test]
    fn a_real_image_fingerprint_hashes_its_header_size_bytes() {
        let Some(image) = image_or_skip() else { return };
        let size = u32::from_le_bytes(image.header[4..8].try_into().expect("4 bytes"));
        assert_eq!(
            image.fingerprint(),
            sha256(&[&image.header[..size as usize]])
        );

        // The build tool records the fingerprint of every image it writes.
        let index = Path::new(IMAGE)
            .parent()
            .and_then(Path::parent)
            .expect("the image is two levels below the index")
            .join("index.v1.json");
        let index: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&index).expect("the index reads"))
                .expect("the index is JSON");
        let name = Path::new(IMAGE).file_name().and_then(|name| name.to_str());
        let recorded = index["releases"]
            .as_array()
            .into_iter()
            .flatten()
            .flat_map(|release| release["builds"].as_array().into_iter().flatten())
            .find(|build| {
                build["file"]
                    .as_str()
                    .and_then(|file| file.rsplit('/').next())
                    == name
            })
            .and_then(|build| build["fingerprint"].as_str())
            .expect("the index lists the image with its fingerprint");
        assert_eq!(hex::encode(image.fingerprint()), recorded);
    }

    #[test]
    fn the_load_request_encodes_the_fingerprint() {
        let request = ExtAppLoad {
            id: "thru.thru.org".into(),
            version: Version {
                major: 0,
                minor: 1,
                patch: Some(1),
                build: Some(0),
            },
            fingerprint: Some(hex::decode(TEST_FINGERPRINT).expect("hex")),
        };
        // Fields 1 (id), 2 (version) and 3 (fingerprint, 32 bytes).
        assert_eq!(
            hex::encode(request.encode_to_vec()),
            format!(
                "0a0d746872752e746872752e6f726712080800100118012000\
                 1a20{TEST_FINGERPRINT}"
            )
        );
    }

    /// The device side of the exchange: answers from a script and records
    /// what it was sent.
    struct Script {
        answers: std::collections::VecDeque<(u16, Vec<u8>)>,
        sent: Vec<(u16, Vec<u8>)>,
    }

    impl Script {
        fn new(answers: Vec<(u16, Vec<u8>)>) -> Self {
            Script {
                answers: answers.into(),
                sent: Vec::new(),
            }
        }
    }

    impl Exchange for Script {
        fn call_any(&mut self, id: u16, payload: &[u8]) -> Result<(u16, Vec<u8>)> {
            self.sent.push((id, payload.to_vec()));
            self.answers
                .pop_front()
                .ok_or_else(|| TrezorError::Unexpected("the script ran out".into()))
        }
    }

    fn loaded(instance_id: u32) -> (u16, Vec<u8>) {
        (
            ExtAppLoaded::ID,
            ExtAppLoaded {
                instance_id,
                version: version(0, 1, Some(1), Some(0)),
            }
            .encode_to_vec(),
        )
    }

    fn chunk_request(index: u32) -> (u16, Vec<u8>) {
        (
            ExtAppDataChunkRequest::ID,
            ExtAppDataChunkRequest { index }.encode_to_vec(),
        )
    }

    fn sent_load(script: &Script) -> ExtAppLoad {
        let (id, payload) = &script.sent[0];
        assert_eq!(*id, ExtAppLoad::ID);
        decode(payload).expect("an ExtAppLoad")
    }

    #[test]
    fn load_sends_the_fingerprint_and_ends_when_the_app_is_held() {
        let image = test_image();
        let mut script = Script::new(vec![loaded(42)]);
        assert_eq!(load_with(&mut script, &image).expect("loaded"), 42);
        assert_eq!(script.sent.len(), 1);
        let request = sent_load(&script);
        assert_eq!(request.id, "thru.thru.org");
        assert_eq!(request.fingerprint, Some(image.fingerprint().to_vec()));
    }

    #[test]
    fn load_uploads_header_root_packet_and_chunks_when_the_app_is_not_held() {
        let image = test_image();
        let mut script = Script::new(vec![
            (
                ExtAppHeaderRequest::ID,
                ExtAppHeaderRequest {}.encode_to_vec(),
            ),
            (
                ExtAppRootPacketRequest::ID,
                ExtAppRootPacketRequest { app_ring: 2 }.encode_to_vec(),
            ),
            chunk_request(0),
            chunk_request(1),
            loaded(9),
        ]);
        assert_eq!(load_with(&mut script, &image).expect("loaded"), 9);
        let request = sent_load(&script);
        assert_eq!(request.fingerprint, Some(image.fingerprint().to_vec()));
        let ids: Vec<u16> = script.sent.iter().map(|(id, _)| *id).collect();
        assert_eq!(
            ids,
            [
                ExtAppLoad::ID,
                ExtAppHeaderAck::ID,
                ExtAppRootPacketAck::ID,
                ExtAppDataChunkAck::ID,
                ExtAppDataChunkAck::ID
            ]
        );
        let ack: ExtAppHeaderAck = decode(&script.sent[1].1).expect("header ack");
        assert_eq!(ack.header, image.header);
        assert_eq!(ack.proof, image.proof);
        assert_eq!(ack.root_packet_timestamp, 7);
        let chunk: ExtAppDataChunkAck = decode(&script.sent[4].1).expect("chunk ack");
        assert_eq!(chunk.data, vec![4]);
    }

    #[test]
    fn load_refuses_an_app_outside_the_supported_range_in_both_paths() {
        let image = test_image();
        let old = (
            ExtAppLoaded::ID,
            ExtAppLoaded {
                instance_id: 1,
                version: version(0, 2, Some(0), Some(0)),
            }
            .encode_to_vec(),
        );
        let mut held = Script::new(vec![old.clone()]);
        assert!(matches!(
            load_with(&mut held, &image),
            Err(TrezorError::App(_))
        ));
        let mut uploaded = Script::new(vec![
            (
                ExtAppHeaderRequest::ID,
                ExtAppHeaderRequest {}.encode_to_vec(),
            ),
            chunk_request(0),
            chunk_request(1),
            old,
        ]);
        assert!(matches!(
            load_with(&mut uploaded, &image),
            Err(TrezorError::App(_))
        ));
    }

    #[test]
    fn the_supported_range_is_accepted() {
        check_loaded_version(&version(0, 1, Some(1), Some(0))).expect("0.1.1.0");
        check_loaded_version(&version(0, 1, Some(9), Some(3))).expect("0.1.9.3");
    }

    #[test]
    fn versions_outside_the_range_are_refused_naming_both() {
        for found in [
            version(0, 1, Some(0), Some(0)),
            version(0, 2, Some(0), Some(0)),
            version(1, 0, Some(0), Some(0)),
            version(0, 0, Some(9), Some(0)),
            // No patch number is patch 0.
            version(0, 1, None, None),
        ] {
            let error = check_loaded_version(&found).expect_err("outside the range");
            let TrezorError::App(text) = error else {
                panic!("wrong error: {error}");
            };
            let found_text = format!("{}.{}.", found.major, found.minor);
            assert!(text.contains(&found_text), "{text}");
            assert!(text.contains("0.1.1 up to (not including) 0.2.0"), "{text}");
        }
        let TrezorError::App(text) =
            check_loaded_version(&version(0, 2, Some(3), None)).expect_err("refused")
        else {
            panic!("wrong error");
        };
        assert!(text.contains("0.2.3.?"), "{text}");
    }

    #[test]
    fn the_image_version_follows_the_same_rule() {
        let path = Path::new("app.tapp");
        for ok in [[0, 1, 1, 0], [0, 1, 9, 4]] {
            check_image_version(path, ok).expect("supported");
        }
        for bad in [[0, 1, 0, 0], [0, 2, 0, 0], [1, 0, 0, 0], [0, 0, 5, 0]] {
            let error = check_image_version(path, bad).expect_err("refused");
            let TrezorError::AppImage(text) = error else {
                panic!("wrong error: {error}");
            };
            assert!(text.contains("app.tapp"), "{text}");
            assert!(
                text.contains(&format!("{}.{}.{}", bad[0], bad[1], bad[2])),
                "{text}"
            );
            assert!(text.contains("0.1.1 up to (not including) 0.2.0"), "{text}");
        }
    }

    #[test]
    fn a_real_image_below_the_range_is_refused_when_read() {
        let Some(image) = image_or_skip() else { return };
        if image.version[..3] < [0, 1, 1][..] {
            let error = AppImage::read(IMAGE).expect_err("refused");
            assert!(matches!(error, TrezorError::AppImage(_)), "{error}");
        } else {
            AppImage::read(IMAGE).expect("in range");
        }
    }

    #[test]
    fn reads_the_real_image() {
        let Some(image) = image_or_skip() else { return };
        assert_eq!(image.id, "thru.thru.org");
        assert_eq!(image.version[..2], [0, 1]);
        assert_eq!(image.app_ring, 2);
        assert_eq!(image.header.len(), 512);
        assert!(!image.chunks.is_empty());
        // A tree of one image (no device build beside the emulator's) has an
        // empty proof.
        assert_eq!(image.proof.len() % 32, 0);
        assert!(image.root_packet_timestamp > 0);
    }

    #[test]
    fn a_damaged_chunk_is_caught() {
        let Some(mut image) = image_or_skip() else {
            return;
        };
        let header = parse_header(Path::new("x"), &image.header).expect("header");
        image.chunks[3].data[0] ^= 1;
        let error = check_chunks(
            Path::new("x.tapp"),
            &image.chunks,
            &header.chunk_hash,
            header.chunk_size,
        )
        .expect_err("must fail");
        assert!(matches!(error, TrezorError::AppImage(m) if m.contains("x.tapp")));
    }

    #[test]
    fn a_missing_file_names_itself() {
        let error = AppImage::read("/nonexistent/dir/app.tapp").expect_err("must fail");
        assert!(matches!(error, TrezorError::AppImage(m) if m.contains("app.tapp")));
    }

    #[test]
    fn header_fields_are_read_at_their_offsets() {
        let mut header = vec![0u8; 512];
        header[0..4].copy_from_slice(b"TRZA");
        header[4..8].copy_from_slice(&512u32.to_le_bytes());
        header[8..13].copy_from_slice(b"a.b.c");
        header[108..112].copy_from_slice(&[1, 2, 3, 4]);
        header[118] = 1;
        header[128..160].copy_from_slice(&[9; 32]);
        header[160..162].copy_from_slice(&2048u16.to_le_bytes());
        let info = parse_header(Path::new("x"), &header).expect("header");
        assert_eq!(info.id, "a.b.c");
        assert_eq!(info.version, [1, 2, 3, 4]);
        assert_eq!(info.app_ring, 1);
        assert_eq!(info.chunk_hash, [9; 32]);
        assert_eq!(info.chunk_size, 2048);
        header[0] = b'X';
        assert!(parse_header(Path::new("x"), &header).is_err());
    }

    #[test]
    fn root_packet_timestamp_is_at_offset_8() {
        let mut packet = vec![0u8; 20];
        packet[0..4].copy_from_slice(b"TRRP");
        packet[8..16].copy_from_slice(&(-5i64).to_le_bytes());
        assert_eq!(parse_root_packet(Path::new("x"), &packet).expect("ok"), -5);
    }

    #[test]
    fn ring_picks_the_root_packet() {
        let tapp = Path::new("/r/serialized/app/1.0/app.tapp");
        let ring0 = root_packet_path(tapp, 0).expect("path");
        let ring2 = root_packet_path(tapp, 2).expect("path");
        assert_eq!(
            ring0,
            Path::new("/r/serialized/root-packets/rootpacket_ring0.tmr")
        );
        assert_eq!(
            ring2,
            Path::new("/r/serialized/root-packets/rootpacket_ring12.tmr")
        );
    }
}
