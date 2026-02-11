//! On-chain ABI Import Fetcher
//!
//! Fetches ABI files from on-chain ABI accounts via RPC.

use crate::fetcher::{FetchContext, FetchError, FetchResult, ImportFetcher, OnchainFetcherConfig};
use crate::file::{ImportSource, OnchainTarget, RevisionSpec};
use base64::engine::general_purpose;
use base64::Engine as _;
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::time::Duration;

/* ABI account header size in bytes */
const ABI_ACCOUNT_HEADER_SIZE: usize = 45;

/* ABI account state constants */
const ABI_STATE_OPEN: u8 = 0x00;
const ABI_STATE_FINALIZED: u8 = 0x01;

/* ABI meta account layout */
const ABI_META_HEADER_SIZE: usize = 4;
const ABI_META_BODY_SIZE: usize = 96;
const ABI_META_ACCOUNT_SIZE: usize = ABI_META_HEADER_SIZE + ABI_META_BODY_SIZE;
const ABI_META_VERSION: u8 = 1;
const ABI_META_KIND_OFFICIAL: u8 = 0x00;
const ABI_META_KIND_EXTERNAL: u8 = 0x01;
const ABI_ACCOUNT_SUFFIX: &[u8] = b"_abi_account";
const DEFAULT_ABI_MANAGER_PROGRAM_ID: &str = "taAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACrG7";

#[derive(Deserialize)]
struct RawAccountResponse {
    #[serde(rename = "rawData")]
    raw_data: Option<String>,
}

struct AbiMetaAccount {
    kind: u8,
    body: [u8; ABI_META_BODY_SIZE],
}

/* On-chain ABI fetcher */
pub struct OnchainFetcher {
    config: OnchainFetcherConfig,
    client: reqwest::blocking::Client,
}

impl OnchainFetcher {
    /* Create a new on-chain fetcher with the given configuration */
    pub fn new(config: &OnchainFetcherConfig) -> Self {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(config.timeout_seconds))
            .build()
            .expect("Failed to create HTTP client");

        Self {
            config: config.clone(),
            client,
        }
    }

    /* Check if an address is a TNS name (ends with .thru) */
    fn is_tns_name(address: &str) -> bool {
        address.ends_with(".thru")
    }

    /* Resolve TNS name to address via name service */
    fn resolve_tns_name(&self, name: &str, network: &str) -> Result<String, FetchError> {
        /* TODO: Implement TNS resolution via name service program
           For now, return an error indicating TNS is not yet supported */
        let _ = network;
        Err(FetchError::Onchain(format!(
            "TNS resolution not yet implemented for '{}'",
            name
        )))
    }

    fn decode_address(&self, address: &str) -> Result<[u8; 32], FetchError> {
        self.decode_thru_address(address)
    }

    fn decode_thru_address(&self, address: &str) -> Result<[u8; 32], FetchError> {
        const BASE64_URL_ALPHABET: &[u8; 64] =
            b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        let input = address.as_bytes();
        if input.len() != 46 || input[0] != b't' || input[1] != b'a' {
            return Err(FetchError::Onchain(format!(
                "Invalid Thru address format: {}",
                address
            )));
        }

        let mut invlut = [0xFFu8; 256];
        for (i, &b) in BASE64_URL_ALPHABET.iter().enumerate() {
            invlut[b as usize] = i as u8;
        }

        let mut checksum: u64 = 0;
        let mut out = [0u8; 32];
        let mut out_idx = 0usize;
        let mut in_idx = 2usize;
        let mut in_sz = 40usize;

        while in_sz >= 4 {
            let a = invlut[input[in_idx + 0] as usize];
            let b = invlut[input[in_idx + 1] as usize];
            let c = invlut[input[in_idx + 2] as usize];
            let d = invlut[input[in_idx + 3] as usize];
            if a == 0xFF || b == 0xFF || c == 0xFF || d == 0xFF {
                return Err(FetchError::Onchain(format!(
                    "Invalid Thru address character at {}",
                    in_idx
                )));
            }
            let triple = ((a as u32) << 18) | ((b as u32) << 12) | ((c as u32) << 6) | (d as u32);
            let temp1 = ((triple >> 16) & 0xFF) as u8;
            checksum += temp1 as u64;
            out[out_idx] = temp1;
            out_idx += 1;
            let temp2 = ((triple >> 8) & 0xFF) as u8;
            checksum += temp2 as u64;
            out[out_idx] = temp2;
            out_idx += 1;
            let temp3 = (triple & 0xFF) as u8;
            checksum += temp3 as u64;
            out[out_idx] = temp3;
            out_idx += 1;
            in_idx += 4;
            in_sz -= 4;
        }

        let a = invlut[input[in_idx + 0] as usize];
        let b = invlut[input[in_idx + 1] as usize];
        let c = invlut[input[in_idx + 2] as usize];
        let d = invlut[input[in_idx + 3] as usize];
        if a == 0xFF || b == 0xFF || c == 0xFF || d == 0xFF {
            return Err(FetchError::Onchain(format!(
                "Invalid Thru address character at {}",
                in_idx
            )));
        }
        let triple = ((a as u32) << 18) | ((b as u32) << 12) | ((c as u32) << 6) | (d as u32);
        let temp1 = ((triple >> 16) & 0xFF) as u8;
        checksum += temp1 as u64;
        out[out_idx] = temp1;
        out_idx += 1;
        let temp2 = ((triple >> 8) & 0xFF) as u8;
        checksum += temp2 as u64;
        out[out_idx] = temp2;
        let incoming_checksum = (triple & 0xFF) as u8;
        if (checksum & 0xFF) as u8 != incoming_checksum {
            return Err(FetchError::Onchain("Invalid Thru address checksum".to_string()));
        }

        Ok(out)
    }

    fn encode_thru_address(bytes: &[u8; 32]) -> String {
        const BASE64_URL_ALPHABET: &[u8; 64] =
            b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

        fn mask_for_bits(bits: u32) -> u32 {
            if bits == 0 { 0 } else { (1 << bits) - 1 }
        }

        let mut output = String::with_capacity(46);
        output.push('t');
        output.push('a');

        let mut checksum: u32 = 0;
        let mut accumulator: u32 = 0;
        let mut bits_collected: u32 = 0;

        for i in 0..30 {
            let byte = bytes[i] as u32;
            checksum += byte;
            accumulator = (accumulator << 8) | byte;
            bits_collected += 8;
            while bits_collected >= 6 {
                let index = (accumulator >> (bits_collected - 6)) & 0x3f;
                output.push(BASE64_URL_ALPHABET[index as usize] as char);
                bits_collected -= 6;
                accumulator &= mask_for_bits(bits_collected);
            }
        }

        let second_last = bytes[30] as u32;
        checksum += second_last;
        accumulator = (accumulator << 8) | second_last;
        bits_collected += 8;

        let last = bytes[31] as u32;
        checksum += last;
        accumulator = (accumulator << 8) | last;
        bits_collected += 8;

        accumulator = (accumulator << 8) | (checksum & 0xff);
        bits_collected += 8;

        while bits_collected >= 6 {
            let index = (accumulator >> (bits_collected - 6)) & 0x3f;
            output.push(BASE64_URL_ALPHABET[index as usize] as char);
            bits_collected -= 6;
            accumulator &= mask_for_bits(bits_collected);
        }

        output
    }

    fn abi_manager_program_id(&self) -> Result<[u8; 32], FetchError> {
        let id = if self.config.abi_manager_program_id.is_empty() {
            DEFAULT_ABI_MANAGER_PROGRAM_ID
        } else {
            self.config.abi_manager_program_id.as_str()
        };
        self.decode_address(id)
    }

    fn abi_meta_body_for_program(&self, program: &[u8; 32]) -> [u8; ABI_META_BODY_SIZE] {
        let mut body = [0u8; ABI_META_BODY_SIZE];
        body[0..32].copy_from_slice(program);
        body
    }

    fn derive_abi_account_seed(&self, kind: u8, body: &[u8; ABI_META_BODY_SIZE]) -> [u8; 32] {
        let mut hasher = Sha256::new();
        hasher.update(&[kind]);
        hasher.update(body);
        hasher.update(ABI_ACCOUNT_SUFFIX);
        let digest = hasher.finalize();
        let mut seed = [0u8; 32];
        seed.copy_from_slice(&digest[..32]);
        seed
    }

    fn create_program_defined_account_address(
        &self,
        owner: &[u8; 32],
        is_ephemeral: bool,
        seed: &[u8; 32],
    ) -> [u8; 32] {
        let mut hasher = Sha256::new();
        hasher.update(owner);
        hasher.update(&[if is_ephemeral { 1u8 } else { 0u8 }]);
        hasher.update(seed);
        let digest = hasher.finalize();
        let mut out = [0u8; 32];
        out.copy_from_slice(&digest[..32]);
        out
    }

    fn derive_abi_account_address(&self, kind: u8, body: &[u8; ABI_META_BODY_SIZE]) -> Result<String, FetchError> {
        let owner = self.abi_manager_program_id()?;
        let seed = self.derive_abi_account_seed(kind, body);
        let address = self.create_program_defined_account_address(
            &owner,
            self.config.abi_manager_is_ephemeral,
            &seed,
        );
        Ok(Self::encode_thru_address(&address))
    }

    fn parse_abi_meta_account(&self, data: &[u8]) -> Result<AbiMetaAccount, FetchError> {
        if data.len() < ABI_META_ACCOUNT_SIZE {
            return Err(FetchError::Onchain(format!(
                "ABI meta data too small: {} bytes, need at least {}",
                data.len(),
                ABI_META_ACCOUNT_SIZE
            )));
        }

        let version = data[0];
        let kind = data[1];
        if version != ABI_META_VERSION {
            return Err(FetchError::Onchain(format!(
                "Unsupported ABI meta version: {}",
                version
            )));
        }
        if kind != ABI_META_KIND_OFFICIAL && kind != ABI_META_KIND_EXTERNAL {
            return Err(FetchError::Onchain(format!(
                "Unsupported ABI meta kind: {}",
                kind
            )));
        }

        let mut body = [0u8; ABI_META_BODY_SIZE];
        body.copy_from_slice(&data[ABI_META_HEADER_SIZE..ABI_META_HEADER_SIZE + ABI_META_BODY_SIZE]);

        Ok(AbiMetaAccount { kind, body })
    }

    /* Fetch ABI account data from RPC */
    fn fetch_abi_account(
        &self,
        address: &str,
        network: &str,
    ) -> Result<(Vec<u8>, u64), FetchError> {
        let endpoint = self
            .config
            .get_endpoint(network)
            .ok_or_else(|| FetchError::UnknownNetwork(network.to_string()))?;

        let base = endpoint.trim_end_matches('/');
        let url = format!("{}/v1/accounts/{}:raw", base, address);

        let response = self
            .client
            .get(&url)
            .send()
            .map_err(|e| FetchError::Http {
                status: 0,
                message: format!("Request failed: {}", e),
            })?;

        let status = response.status();
        if status == reqwest::StatusCode::NOT_FOUND {
            return Err(FetchError::NotFound(format!(
                "ABI account not found: {}",
                address
            )));
        }
        if !status.is_success() {
            return Err(FetchError::Http {
                status: status.as_u16(),
                message: format!("HTTP {} for {}", status, url),
            });
        }

        let parsed: RawAccountResponse = response.json().map_err(|e| {
            FetchError::Parse(format!("Failed to parse account response: {}", e))
        })?;

        let raw_data = parsed.raw_data.ok_or_else(|| {
            FetchError::Onchain(format!("Account '{}' has no raw data", address))
        })?;

        let data = general_purpose::STANDARD
            .decode(raw_data.as_bytes())
            .map_err(|e| FetchError::Parse(format!("Failed to decode raw data: {}", e)))?;

        Ok((data, 0))
    }

    /* Parse ABI account data */
    fn parse_abi_account(&self, data: &[u8]) -> Result<(u64, u8, String), FetchError> {
        if data.len() < ABI_ACCOUNT_HEADER_SIZE {
            return Err(FetchError::Onchain(format!(
                "Account data too small: {} bytes, need at least {}",
                data.len(),
                ABI_ACCOUNT_HEADER_SIZE
            )));
        }

        /* Parse header:
           - abi_meta_acc: [u8; 32] (bytes 0-31)
           - revision: u64 (bytes 32-39)
           - state: u8 (byte 40)
           - content_sz: u32 (bytes 41-44)
           - contents: [u8; content_sz] (bytes 45+)
        */

        let revision = u64::from_le_bytes(
            data[32..40]
                .try_into()
                .map_err(|_| FetchError::Parse("Failed to parse revision".to_string()))?,
        );

        let state = data[40];
        if state != ABI_STATE_OPEN && state != ABI_STATE_FINALIZED {
            return Err(FetchError::Onchain(format!(
                "Invalid ABI account state: {}",
                state
            )));
        }

        let content_sz = u32::from_le_bytes(
            data[41..45]
                .try_into()
                .map_err(|_| FetchError::Parse("Failed to parse content size".to_string()))?,
        ) as usize;

        if data.len() < ABI_ACCOUNT_HEADER_SIZE + content_sz {
            return Err(FetchError::Onchain(format!(
                "Account data truncated: expected {} bytes of content, got {}",
                content_sz,
                data.len() - ABI_ACCOUNT_HEADER_SIZE
            )));
        }

        let content = std::str::from_utf8(&data[ABI_ACCOUNT_HEADER_SIZE..ABI_ACCOUNT_HEADER_SIZE + content_sz])
            .map_err(|e| FetchError::Parse(format!("ABI content is not valid UTF-8: {}", e)))?;

        Ok((revision, state, content.to_string()))
    }

    /* Check if a revision satisfies the requirement */
    fn check_revision(&self, actual: u64, required: &RevisionSpec) -> Result<(), FetchError> {
        if !required.satisfies(actual) {
            let req_str = match required {
                RevisionSpec::Exact(v) => format!("{}", v),
                RevisionSpec::Specifier(s) => s.clone(),
            };
            return Err(FetchError::RevisionMismatch {
                required: req_str,
                actual,
            });
        }
        Ok(())
    }
}

impl ImportFetcher for OnchainFetcher {
    fn handles(&self, source: &ImportSource) -> bool {
        matches!(source, ImportSource::Onchain { .. })
    }

    fn fetch(&self, source: &ImportSource, _ctx: &FetchContext) -> Result<FetchResult, FetchError> {
        let ImportSource::Onchain {
            address,
            target,
            network,
            revision,
        } = source
        else {
            return Err(FetchError::UnsupportedSource(
                "OnchainFetcher only handles Onchain imports".to_string(),
            ));
        };

        /* Resolve address (TNS or direct) */
        let resolved_address = if Self::is_tns_name(address) {
            self.resolve_tns_name(address, network)?
        } else {
            address.clone()
        };

        /* Resolve ABI account address based on target */
        let abi_address = match target {
            OnchainTarget::Program => {
                let program_bytes = self.decode_address(&resolved_address)?;
                let body = self.abi_meta_body_for_program(&program_bytes);
                self.derive_abi_account_address(ABI_META_KIND_OFFICIAL, &body)?
            }
            OnchainTarget::AbiMeta => {
                let (meta_data, _) = self.fetch_abi_account(&resolved_address, network)?;
                let meta = self.parse_abi_meta_account(&meta_data)?;
                self.derive_abi_account_address(meta.kind, &meta.body)?
            }
            OnchainTarget::Abi => resolved_address.clone(),
        };

        /* Fetch the account data */
        let (data, actual_revision) = self.fetch_abi_account(&abi_address, network)?;

        /* Parse the ABI content */
        let (parsed_revision, _state, content) = self.parse_abi_account(&data)?;

        /* Verify revision matches (use parsed_revision if fetch didn't return it) */
        let final_revision = if actual_revision > 0 {
            actual_revision
        } else {
            parsed_revision
        };
        self.check_revision(final_revision, revision)?;

        /* Create canonical location */
        let target_str = match target {
            OnchainTarget::Program => "program",
            OnchainTarget::AbiMeta => "abi-meta",
            OnchainTarget::Abi => "abi",
        };
        let canonical_location = format!(
            "onchain://{}@{}:{}?rev={}",
            network, target_str, resolved_address, final_revision
        );

        Ok(FetchResult {
            content,
            canonical_location,
            is_remote: true,
            resolved_path: None,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_onchain_fetcher_handles() {
        let config = OnchainFetcherConfig::default();
        let fetcher = OnchainFetcher::new(&config);

        let onchain_import = ImportSource::Onchain {
            address: "11111111111111111111111111111111".to_string(),
            target: OnchainTarget::Program,
            network: "mainnet".to_string(),
            revision: RevisionSpec::default(),
        };
        let path_import = ImportSource::Path {
            path: "local.abi.yaml".to_string(),
        };

        assert!(fetcher.handles(&onchain_import));
        assert!(!fetcher.handles(&path_import));
    }

    #[test]
    fn test_is_tns_name() {
        assert!(OnchainFetcher::is_tns_name("mypackage.thru"));
        assert!(OnchainFetcher::is_tns_name("foo.bar.thru"));
        assert!(!OnchainFetcher::is_tns_name("11111111111111111111111111111111"));
        assert!(!OnchainFetcher::is_tns_name("mypackage.sol"));
    }

    #[test]
    fn test_revision_check() {
        let config = OnchainFetcherConfig::default();
        let fetcher = OnchainFetcher::new(&config);

        /* Exact match */
        assert!(fetcher
            .check_revision(5, &RevisionSpec::Exact(5))
            .is_ok());
        assert!(fetcher
            .check_revision(5, &RevisionSpec::Exact(6))
            .is_err());

        /* Minimum */
        assert!(fetcher
            .check_revision(5, &RevisionSpec::Specifier(">=5".to_string()))
            .is_ok());
        assert!(fetcher
            .check_revision(6, &RevisionSpec::Specifier(">=5".to_string()))
            .is_ok());
        assert!(fetcher
            .check_revision(4, &RevisionSpec::Specifier(">=5".to_string()))
            .is_err());

        /* Latest */
        assert!(fetcher
            .check_revision(1, &RevisionSpec::Specifier("latest".to_string()))
            .is_ok());
        assert!(fetcher
            .check_revision(100, &RevisionSpec::Specifier("latest".to_string()))
            .is_ok());
    }

    #[test]
    fn test_parse_abi_account() {
        let config = OnchainFetcherConfig::default();
        let fetcher = OnchainFetcher::new(&config);

        /* Create mock account data */
        let yaml_content = b"abi:\n  package: test\n";
        let mut data = vec![0u8; ABI_ACCOUNT_HEADER_SIZE + yaml_content.len()];

        /* Fill header */
        /* abi_meta_acc: bytes 0-31 (zeros) */
        /* revision: bytes 32-39 */
        data[32..40].copy_from_slice(&5u64.to_le_bytes());
        /* state: byte 40 */
        data[40] = ABI_STATE_FINALIZED;
        /* content_sz: bytes 41-44 */
        data[41..45].copy_from_slice(&(yaml_content.len() as u32).to_le_bytes());
        /* content */
        data[45..].copy_from_slice(yaml_content);

        let (revision, state, content) = fetcher.parse_abi_account(&data).unwrap();
        assert_eq!(revision, 5);
        assert_eq!(state, ABI_STATE_FINALIZED);
        assert_eq!(content, "abi:\n  package: test\n");
    }
}
