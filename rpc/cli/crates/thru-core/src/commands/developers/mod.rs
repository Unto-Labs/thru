//! Public OAuth device grant, the per-machine RPC API key, API keys
//! approved in the browser (`thru auth keys create`), and authenticated
//! test-network funding.
mod agent;
mod cli_key;
mod storage;
#[cfg(test)]
mod tests;

use crate::{
    cli::{AuthCommands, AuthKeysCommands},
    config::{Config, ProvisionedApiKey, ProvisionedKeySource},
    error::CliError,
    output,
};
use cli_key::{KeyMetadata, KeyStore, valid_api_key, valid_key_id, valid_text};
use reqwest::{Client, Method, Response};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use storage::{Store, storage_error};
use url::{Host, Url};

pub use agent::valid_agent_client;
use agent::{InstallPaths, KnownClient, Runner, SystemRunner};

const CLIENT_ID: &str = "thru-cli";
const SCOPE: &str = "profile offline_access faucet:fund keys:cli";
/// Scopes a Developers deployment that predates `keys:cli` accepts. Such a
/// deployment rejects [`SCOPE`] outright, so login retries with this set once
/// and skips key provisioning.
const LEGACY_SCOPE: &str = "profile offline_access faucet:fund";
const MAX_MACHINE_NAME_LEN: usize = 48;
/// Consecutive network or server errors tolerated while polling a key
/// request.
const MAX_TRANSIENT_POLLS: u32 = 5;

#[derive(Clone, PartialEq, Serialize, Deserialize)]
struct Credentials {
    origin: String,
    access_token: String,
    refresh_token: String,
    expires_at: u64,
}
impl Credentials {
    fn valid(&self) -> bool {
        valid_token(&self.access_token) && valid_token(&self.refresh_token) && self.expires_at > 0
    }
}

#[derive(Deserialize, Serialize)]
struct Account {
    id: String,
    name: Option<String>,
}
#[derive(Deserialize)]
struct DeviceCode {
    device_code: String,
    user_code: String,
    verification_uri: String,
    verification_uri_complete: Option<String>,
    expires_in: u64,
    interval: u64,
}
/// A validated device authorization, before polling.
struct DeviceAuthorization {
    device_code: String,
    user_code: String,
    /// Approval URL on the configured origin, with `ref=cli`.
    verification: Url,
    expires_in: u64,
    interval: u64,
    /// Whether the login requested `keys:cli` (see [`LEGACY_SCOPE`]).
    key_scope: bool,
}

/// A device authorization saved by `thru auth login --no-wait` for
/// `--resume`. The device code is a short-lived credential, so the file is
/// owner-only and removed once the code is spent or expired.
#[derive(Serialize, Deserialize)]
struct PendingLogin {
    origin: String,
    device_code: String,
    user_code: String,
    verification_uri_complete: String,
    interval: u64,
    /// Unix seconds.
    expires_at: u64,
    key_scope: bool,
}
impl PendingLogin {
    /// The `--no-wait` output. Never includes the device code.
    fn to_json(&self) -> Value {
        json!({"auth":{
            "status":"pending",
            "verification_uri_complete":self.verification_uri_complete,
            "user_code":self.user_code,
            "expires_in":self.expires_at.saturating_sub(now()),
            "next":"thru auth login --resume",
        }})
    }
}

fn valid_user_code(code: &str) -> bool {
    code.len() == 8
        && code
            .bytes()
            .all(|b| b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789".contains(&b))
}
fn valid_interval(interval: u64) -> bool {
    (1..=300).contains(&interval)
}

/// `url` with `ref=cli` (replacing any `ref`), so dev.thru.org attributes a
/// sign-up through the approval link to the CLI.
fn with_cli_ref(mut url: Url) -> Url {
    let pairs: Vec<(String, String)> = url
        .query_pairs()
        .into_owned()
        .filter(|(name, _)| name != "ref")
        .collect();
    url.query_pairs_mut()
        .clear()
        .extend_pairs(pairs)
        .append_pair("ref", "cli");
    url
}

fn pending_expired() -> CliError {
    failure(
        "expired_token",
        "The pending login expired. Run `thru auth login --no-wait` again.",
        None,
    )
}

/// Whether a failed `--resume` poll leaves the saved device code unusable:
/// any answer from the token endpoint except a server error or rate limit,
/// and local expiry. A network error keeps it for another `--resume`.
fn spends_pending_login(error: &CliError) -> bool {
    match error {
        CliError::Developers { code, status, .. } => {
            matches!(
                code.as_str(),
                "expired_token" | "access_denied" | "invalid_grant"
            ) || matches!(status, Some(status) if *status < 500 && *status != 429)
        }
        _ => true,
    }
}

/// `POST /api/cli/keys` 201 body. `plaintext` is never printed or logged.
#[derive(Deserialize)]
struct ProvisionedKeyResponse {
    key: ProvisionedKeyInfo,
    plaintext: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProvisionedKeyInfo {
    id: String,
    name: String,
    prefix: String,
    organization_id: String,
    organization_name: String,
}

/// Rate limits as dev.thru.org reports them; printed in snake_case.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all(deserialize = "camelCase"))]
struct RateLimits {
    weighted_rps: serde_json::Number,
    bytes_per_sec: serde_json::Number,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
struct Organization {
    id: String,
    name: String,
}
impl Organization {
    fn valid(&self) -> bool {
        valid_text(&self.id) && valid_text(&self.name)
    }
}
/// An organization API key as `/api/cli/org/keys` reports it (never the
/// secret); printed in snake_case.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all(deserialize = "camelCase"))]
struct OrgKey {
    id: String,
    name: String,
    prefix: String,
    #[serde(default)]
    origin_allowlist: Option<Vec<String>>,
    #[serde(default)]
    cli_machine: Option<String>,
    /// The key's own limits, only when an operator cap holds it below the
    /// organization's; otherwise the organization limits apply.
    #[serde(default)]
    limits: Option<RateLimits>,
    created_at: String,
    #[serde(default)]
    last_used_at: Option<String>,
}
impl OrgKey {
    /// Ids are path segments and text is printed, so both are checked.
    fn valid(&self) -> bool {
        valid_key_id(&self.id)
            && [&self.name, &self.prefix, &self.created_at]
                .into_iter()
                .chain(self.cli_machine.as_ref())
                .chain(self.last_used_at.as_ref())
                .chain(self.origin_allowlist.iter().flatten())
                .all(|text| valid_text(text))
    }
}
/// `GET /api/cli/org/keys` 200 body.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OrgKeys {
    organization: Organization,
    #[serde(default)]
    organization_limits: Option<RateLimits>,
    keys: Vec<OrgKey>,
}
/// `POST /api/cli/key-requests` 201 body: a browser approval for one key.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct KeyRequestResponse {
    request_id: String,
    user_code: String,
    verification_uri: String,
    #[serde(default)]
    verification_uri_complete: Option<String>,
    expires_in: u64,
    interval: u64,
    poll_token: String,
}
/// A validated key request, before polling.
struct KeyRequest {
    user_code: String,
    /// Approval URL on the configured origin, with `ref=cli`.
    verification: Url,
    expires_in: u64,
    interval: u64,
    poll_token: String,
}

fn valid_request_code(code: &str) -> bool {
    !code.is_empty()
        && code.len() <= 32
        && code
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
}

/// The organization of an approved key.
#[derive(Clone, Debug, Deserialize, Serialize)]
struct KeyOrganization {
    id: String,
    name: String,
    #[serde(default)]
    slug: Option<String>,
}
/// The key in an `approved` poll answer. `secret` is printed once or
/// installed for the agent client; never logged or stored by the CLI.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApprovedKey {
    id: String,
    name: String,
    secret: String,
    prefix: String,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    agent_client: Option<String>,
    organization: KeyOrganization,
}
impl std::fmt::Debug for ApprovedKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ApprovedKey")
            .field("id", &self.id)
            .field("name", &self.name)
            .field("prefix", &self.prefix)
            .finish_non_exhaustive()
    }
}
impl ApprovedKey {
    /// Text from the server is printed, so all of it is checked.
    fn valid(&self) -> bool {
        valid_key_id(&self.id)
            && valid_api_key(&self.secret)
            && self.tags.len() <= 16
            && self.agent_client.as_deref().is_none_or(valid_agent_client)
            && [
                &self.name,
                &self.prefix,
                &self.organization.id,
                &self.organization.name,
            ]
            .into_iter()
            .chain(self.organization.slug.as_ref())
            .chain(&self.tags)
            .all(|text| valid_text(text))
    }
    /// The key as printed: never the secret.
    fn public_json(&self) -> Value {
        json!({
            "id": self.id,
            "name": self.name,
            "prefix": self.prefix,
            "tags": self.tags,
            "agent_client": self.agent_client,
        })
    }
}

/// One answer to `POST /api/cli/key-requests/poll`.
#[derive(Debug)]
enum KeyPoll {
    Pending,
    /// Poll less often: the interval grows by 5 s.
    SlowDown,
    Approved(ApprovedKey),
    /// A server error or unreadable answer; polling continues a few times.
    Transient,
    Failed(CliError),
}

/// Classifies a poll answer by its HTTP status and JSON body (`None` when
/// the body is missing or not JSON).
fn classify_key_poll(status: u16, body: Option<&Value>) -> KeyPoll {
    let state = body
        .and_then(|body| body.get("status"))
        .and_then(Value::as_str);
    match (status, state) {
        (404, _) => KeyPoll::Failed(failure(
            "KEY_REQUEST_NOT_FOUND",
            "Thru Developers does not know this key request (it may have expired). Run the command again.",
            Some(404),
        )),
        (_, Some("slow_down")) | (429, None) => KeyPoll::SlowDown,
        (200..=299, Some("pending")) => KeyPoll::Pending,
        (200..=299, Some("approved")) => {
            match body
                .and_then(|body| body.get("key"))
                .and_then(|key| serde_json::from_value::<ApprovedKey>(key.clone()).ok())
                .filter(ApprovedKey::valid)
            {
                Some(key) => KeyPoll::Approved(key),
                None => KeyPoll::Failed(failure(
                    "INVALID_RESPONSE",
                    "Developers returned an invalid API key; no key was printed or installed. Revoke the unused key in the Thru Developers dashboard and run the command again.",
                    Some(status),
                )),
            }
        }
        (_, Some("denied")) => KeyPoll::Failed(failure(
            "access_denied",
            "The key request was denied in the browser.",
            Some(status),
        )),
        (_, Some("expired")) => KeyPoll::Failed(failure(
            "expired_token",
            "The browser approval expired before the key was approved. Run the command again.",
            Some(status),
        )),
        (_, Some("consumed")) => KeyPoll::Failed(failure(
            "KEY_REQUEST_CONSUMED",
            "This key request was already completed. Run the command again for a new key, and revoke any key you did not receive in the Thru Developers dashboard.",
            Some(status),
        )),
        _ if status >= 500 || body.is_none() => KeyPoll::Transient,
        (200..=299, _) => KeyPoll::Failed(failure(
            "INVALID_RESPONSE",
            "Developers returned an unknown key request status",
            Some(status),
        )),
        _ => KeyPoll::Failed(Developers::request_error(
            status,
            None,
            body.unwrap_or(&Value::Null),
        )),
    }
}

/// `thru auth keys create` options.
struct CreateKey {
    name: Option<String>,
    agent: Option<String>,
    origins: Vec<String>,
    print: bool,
    no_skill: bool,
    no_browser: bool,
    no_wait: bool,
    resume: bool,
}

/// A validated `thru auth keys create`: what to request and what to do with
/// the approved key.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
struct KeyPlan {
    name: String,
    agent: Option<String>,
    print: bool,
    no_skill: bool,
}
impl KeyPlan {
    fn valid(&self) -> bool {
        valid_text(&self.name) && self.agent.as_deref().is_none_or(valid_agent_client)
    }
    /// The supported client the key is installed into, unless `--print`.
    fn install_into(&self) -> Option<KnownClient> {
        self.agent
            .as_deref()
            .and_then(KnownClient::from_label)
            .filter(|_| !self.print)
    }
}

/// A key request saved by `thru auth keys create --no-wait` for `--resume`.
/// The poll token is a short-lived credential, so the file is owner-only and
/// removed once the request is spent or expired.
#[derive(Serialize, Deserialize)]
struct PendingKeyRequest {
    origin: String,
    poll_token: String,
    user_code: String,
    verification_uri_complete: String,
    interval: u64,
    /// Unix seconds.
    expires_at: u64,
    plan: KeyPlan,
}
impl PendingKeyRequest {
    /// The `--no-wait` output. Never includes the poll token.
    fn to_json(&self) -> Value {
        json!({"auth_key":{
            "status":"pending",
            "verification_uri_complete":self.verification_uri_complete,
            "user_code":self.user_code,
            "expires_in":self.expires_at.saturating_sub(now()),
            "next":KEY_RESUME_COMMAND,
        }})
    }
}

const KEY_RESUME_COMMAND: &str = "thru auth keys create --resume";

/// Whether a failed `--resume` poll leaves the saved key request unusable:
/// anything but repeated network or server errors.
fn spends_pending_key_request(error: &CliError) -> bool {
    !matches!(error, CliError::Developers { code, status: None, .. } if code == "AUTH_UNAVAILABLE")
}

/// Result of provisioning the per-machine API key during login. Login never
/// fails because of it.
enum KeyProvisioning {
    /// The new key, and what happened to the key a previous login recorded.
    Provisioned(KeyMetadata, KeyRevocation),
    /// The Developers server predates `POST /api/cli/keys` or `keys:cli`.
    Unavailable,
    Failed(String),
}
impl KeyProvisioning {
    fn to_json(&self) -> Value {
        match self {
            Self::Provisioned(key, previous) => json!({
                "status": "provisioned",
                "name": key.name,
                "prefix": key.prefix,
                "organization": key.organization_name,
                "previous_key": previous.as_str(),
            }),
            Self::Unavailable => json!({"status": "unavailable"}),
            Self::Failed(reason) => json!({"status": "failed", "reason": reason}),
        }
    }
    fn report(&self, json_format: bool) {
        match self {
            Self::Provisioned(key, _) => {
                let line = format!(
                    "Provisioned API key \"{}\" ({}...) for organization \"{}\"; it is used automatically with official Thru RPC endpoints.",
                    key.name, key.prefix, key.organization_name
                );
                if json_format {
                    eprintln!("{line}");
                } else {
                    println!("{line}");
                }
            }
            Self::Unavailable => eprintln!(
                "API key provisioning is not available on this Developers server; continuing without an RPC API key."
            ),
            Self::Failed(reason) => eprintln!(
                "warning: could not provision an RPC API key ({reason}); login still succeeded. Run `thru auth login` again to retry."
            ),
        }
    }
}

/// Server-side outcome for a previously provisioned key, at logout or when
/// a new login replaces it.
#[derive(Debug, PartialEq, Eq)]
enum KeyRevocation {
    /// No provisioned key was stored.
    None,
    Revoked,
    /// Local copy cleared, but server revocation could not be confirmed.
    Unconfirmed,
}
impl KeyRevocation {
    fn as_str(&self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Revoked => "revoked",
            Self::Unconfirmed => "unconfirmed",
        }
    }
}

/// Short reason for a failed key request, without any credential material.
fn describe(error: &CliError) -> String {
    match error {
        CliError::Developers {
            code,
            status: Some(403),
            ..
        } if code == "SCOPE_REQUIRED" => "this login was not granted the keys:cli scope".into(),
        CliError::Developers {
            code,
            status: Some(status),
            ..
        } => format!("{code}, HTTP {status}"),
        CliError::Developers {
            code, status: None, ..
        } if code == "AUTH_UNAVAILABLE" => "could not contact Thru Developers".into(),
        CliError::Developers { code, .. } => code.clone(),
        _ => "unexpected error".into(),
    }
}

/// Warning for a key whose server-side revocation was not confirmed. It
/// names the key by prefix and organization; never by its secret.
fn unrevoked_key_warning(key: &KeyMetadata, error: &CliError) -> String {
    format!(
        "warning: could not revoke API key {}... in organization \"{}\" ({}); revoke it in Organization settings.",
        key.prefix,
        key.organization_name,
        describe(error)
    )
}

/// Runs a blocking key-store (file) operation off the async workers.
async fn blocking<T: Send + 'static>(
    keys: &KeyStore,
    operation: impl FnOnce(&KeyStore) -> Result<T, CliError> + Send + 'static,
) -> Result<T, CliError> {
    let keys = keys.clone();
    tokio::task::spawn_blocking(move || operation(&keys))
        .await
        .map_err(|_| storage_error("Credential storage task failed"))?
}

/// This machine's name for the provisioned key: printable ASCII, trimmed,
/// at most [`MAX_MACHINE_NAME_LEN`] characters.
fn machine_name() -> String {
    sanitize_machine_name(&gethostname::gethostname().to_string_lossy())
}
fn sanitize_machine_name(raw: &str) -> String {
    let printable: String = raw
        .chars()
        .filter(|c| c.is_ascii_graphic() || *c == ' ')
        .collect();
    let name: String = printable
        .trim()
        .chars()
        .take(MAX_MACHINE_NAME_LEN)
        .collect();
    let name = name.trim_end();
    if name.is_empty() {
        "thru-cli".into()
    } else {
        name.into()
    }
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: String,
    expires_in: u64,
    expires_at: Option<u64>,
    token_type: String,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn valid_token(token: &str) -> bool {
    !token.is_empty()
        && token.len() <= 16384
        && token
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._-~+/=".contains(&byte))
}
fn failure(code: &str, message: &str, status: Option<u16>) -> CliError {
    CliError::Developers {
        code: code.into(),
        message: message.into(),
        status,
        retry_after: None,
        signature: None,
    }
}

struct Developers {
    origin: Url,
    client: Client,
}
/// The Developers origin selected by `THRU_DEVELOPERS_URL` (default
/// `https://dev.thru.org`), validated like [`Developers::new`].
fn configured_origin() -> Result<Url, CliError> {
    let origin = match std::env::var("THRU_DEVELOPERS_URL") {
        Ok(value) => value,
        Err(std::env::VarError::NotPresent) => "https://dev.thru.org".into(),
        Err(_) => {
            return Err(failure(
                "INVALID_ORIGIN",
                "Invalid THRU_DEVELOPERS_URL",
                None,
            ));
        }
    };
    parse_origin(&origin)
}

fn parse_origin(origin: &str) -> Result<Url, CliError> {
    let url = Url::parse(origin).map_err(|_| failure("INVALID_ORIGIN", "Developers URL must be an HTTPS origin (or explicit HTTP loopback for local development)", None))?;
    let loopback = match url.host() {
        Some(Host::Domain("localhost")) => true,
        Some(Host::Ipv4(address)) => address.is_loopback(),
        Some(Host::Ipv6(address)) => address.is_loopback(),
        _ => false,
    };
    if !(url.scheme() == "https" || (url.scheme() == "http" && loopback))
        || url.host().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(failure(
            "INVALID_ORIGIN",
            "Developers URL must be an HTTPS origin without userinfo, path, query or fragment; HTTP is allowed only for explicit loopback",
            None,
        ));
    }
    Ok(url)
}

impl Developers {
    fn configured() -> Result<Self, CliError> {
        Self::from_url(configured_origin()?)
    }
    #[cfg(test)]
    fn new(origin: &str) -> Result<Self, CliError> {
        Self::from_url(parse_origin(origin)?)
    }
    fn from_url(url: Url) -> Result<Self, CliError> {
        let client = Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|_| {
                failure(
                    "HTTP_CLIENT",
                    "Could not initialize the TLS-verified Developers client",
                    None,
                )
            })?;
        Ok(Self {
            origin: url,
            client,
        })
    }
    fn origin(&self) -> String {
        self.origin.origin().ascii_serialization()
    }
    fn endpoint(&self, path: &str) -> Url {
        self.origin
            .join(path)
            .expect("constant absolute Developers path")
    }
    fn network_error(funding: bool) -> CliError {
        if funding {
            failure(
                "FUNDING_STATUS_UNKNOWN",
                "Funding result is unknown. Check your account balance/history before retrying; no automatic retry was performed.",
                None,
            )
        } else {
            failure(
                "AUTH_UNAVAILABLE",
                "Could not contact Thru Developers; saved credentials were preserved",
                None,
            )
        }
    }
    async fn body(
        mut response: Response,
        funding: bool,
    ) -> Result<(u16, Option<u64>, Value), CliError> {
        let status = response.status().as_u16();
        let retry_after = response
            .headers()
            .get("retry-after")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse().ok());
        if (300..400).contains(&status) {
            return Err(failure(
                "UNEXPECTED_REDIRECT",
                "Developers redirects are never followed. Verify the configured origin before retrying; funding is not automatically retried.",
                Some(status),
            ));
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| Self::network_error(funding))?
        {
            if bytes.len().saturating_add(chunk.len()) > 1024 * 1024 {
                return Err(Self::network_error(funding));
            }
            bytes.extend_from_slice(&chunk);
        }
        let value = serde_json::from_slice(&bytes).map_err(|_| {
            if funding {
                Self::network_error(true)
            } else {
                failure(
                    "INVALID_RESPONSE",
                    "Developers returned an invalid response; no credential data was printed",
                    Some(status),
                )
            }
        })?;
        Ok((status, retry_after, value))
    }
    fn protocol_error(
        status: u16,
        retry_after: Option<u64>,
        value: &Value,
        funding: bool,
    ) -> CliError {
        let code = value
            .get("error")
            .and_then(Value::as_str)
            .or_else(|| {
                value
                    .get("error")
                    .and_then(|error| error.get("code"))
                    .and_then(Value::as_str)
            })
            .filter(|code| {
                !code.is_empty()
                    && code.len() <= 80
                    && code.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
            })
            .unwrap_or(if funding && status >= 500 {
                "FUNDING_STATUS_UNKNOWN"
            } else {
                "DEVELOPERS_REQUEST_FAILED"
            });
        let message = match code {
            "invalid_grant" => {
                "This CLI authorization expired or was revoked. Run thru auth login again."
            }
            "authorization_pending" => "Waiting for browser approval.",
            "access_denied" => "CLI authorization was denied in the browser.",
            "expired_token" => "The browser approval code expired. Run thru auth login again.",
            "RATE_LIMITED" | "FAUCET_RATE_LIMITED" => {
                "Faucet account limit reached. Wait for the reported retry interval."
            }
            "UNCONFIGURED" if funding => {
                "The Developers faucet is not configured. No funding request was sent. Configure the Developers server's faucet service URL."
            }
            "FAUCET_AUTH_UNAVAILABLE" if funding => {
                "The Developers server could not authenticate to the faucet service. Check its service credentials and invocation permissions."
            }
            "AUTH_UNAVAILABLE" if funding => {
                "Developers could not verify authentication. No funding request was sent."
            }
            "RATE_LIMIT_UNAVAILABLE" if funding => {
                "Developers could not check the account limit. No funding request was sent."
            }
            "FUNDING_STATUS_UNKNOWN" => {
                "Funding result is unknown. Check your account balance/history before retrying; no automatic retry was performed."
            }
            "AUTH_REQUIRED" if !funding => {
                "Your CLI login is invalid or expired. Run `thru auth login`."
            }
            "SCOPE_REQUIRED" => {
                "This CLI login cannot manage API keys. Run `thru auth login` again to grant it."
            }
            "NO_ORGANIZATION" => {
                "Your account has no organization in which you can manage API keys. Create one, or ask an organization owner or admin for access, on Thru Developers."
            }
            "KEY_NOT_FOUND" => {
                "No API key with that id is available in your organization. Run `thru auth keys list` to see key ids."
            }
            _ if funding && status >= 500 => {
                "Funding result is unknown. Check your account balance/history before retrying; no automatic retry was performed."
            }
            _ if status == 401 => {
                "Developers authorization is invalid. Run thru auth status or thru auth login before retrying."
            }
            _ if status == 429 => {
                "Developers rate limit reached. Wait before making a new request."
            }
            _ => "Thru Developers rejected the request; no automatic retry was performed.",
        };
        let signature = value
            .get("transactionSignature")
            .or_else(|| {
                value
                    .get("error")
                    .and_then(|error| error.get("transactionSignature"))
            })
            .or_else(|| value.get("error").and_then(|error| error.get("signature")))
            .and_then(Value::as_str)
            .filter(|value| {
                value.len() <= 256
                    && value
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || b"_-".contains(&byte))
            })
            .map(str::to_owned);
        CliError::Developers {
            code: code.into(),
            message: message.into(),
            status: Some(status),
            retry_after,
            signature,
        }
    }
    /// [`Self::protocol_error`] for a non-funding request. A validation
    /// failure's own message says what to fix; it is shown only when it is
    /// plain, bounded text.
    fn request_error(status: u16, retry_after: Option<u64>, value: &Value) -> CliError {
        let mut error = Self::protocol_error(status, retry_after, value, false);
        if status == 400
            && let (Some(text), CliError::Developers { message, .. }) = (
                value
                    .pointer("/error/message")
                    .and_then(Value::as_str)
                    .filter(|text| valid_text(text)),
                &mut error,
            )
        {
            *message = text.to_owned();
        }
        error
    }
    async fn token(&self, fields: &[(&str, &str)]) -> Result<Credentials, CliError> {
        let response = self
            .client
            .post(self.endpoint("/api/auth/oauth2/token"))
            .form(fields)
            .send()
            .await
            .map_err(|_| Self::network_error(false))?;
        let (status, retry_after, value) = Self::body(response, false).await?;
        if !(200..300).contains(&status) {
            return Err(Self::protocol_error(status, retry_after, &value, false));
        }
        let token: TokenResponse = serde_json::from_value(value).map_err(|_| {
            failure(
                "INVALID_RESPONSE",
                "Invalid Developers token response",
                Some(status),
            )
        })?;
        let credentials = Credentials {
            origin: self.origin(),
            access_token: token.access_token,
            refresh_token: token.refresh_token,
            expires_at: token
                .expires_at
                .unwrap_or_else(|| now().saturating_add(token.expires_in)),
        };
        if !credentials.valid()
            || !token.token_type.eq_ignore_ascii_case("bearer")
            || token.expires_in == 0
            || token.expires_in > 3600
            || credentials.expires_at <= now()
            || credentials.expires_at > now().saturating_add(3600)
        {
            return Err(failure(
                "INVALID_RESPONSE",
                "Invalid Developers token response",
                Some(status),
            ));
        }
        Ok(credentials)
    }
    async fn access(&self, store: &Store) -> Result<Credentials, CliError> {
        let saved = store.load().await?.ok_or_else(|| {
            failure(
                "NOT_LOGGED_IN",
                "No saved CLI login for this Developers origin. Run thru auth login; API-key overrides apply only to faucet withdrawals",
                None,
            )
        })?;
        if saved.expires_at > now().saturating_add(30) {
            return Ok(saved);
        }
        self.refresh(store, &saved).await
    }
    async fn refresh(&self, store: &Store, saved: &Credentials) -> Result<Credentials, CliError> {
        let origin = self.origin();
        match self
            .token(&[
                ("grant_type", "refresh_token"),
                ("client_id", CLIENT_ID),
                ("refresh_token", &saved.refresh_token),
                ("resource", &origin),
            ])
            .await
        {
            Ok(credentials) => {
                if store.save(&credentials).await.is_err() {
                    let revoked = self.revoke(&credentials.refresh_token).await.is_ok();
                    let cleared = store.clear().await.is_ok();
                    return Err(failure(
                        "REFRESH_STORAGE_FAILED",
                        &format!(
                            "Refreshed credentials could not be saved. Local credentials {}. Installation revocation {}. Review Developers Account settings and log in again.",
                            if cleared {
                                "were cleared"
                            } else {
                                "could not be cleared; fix owner-only storage permissions"
                            },
                            if revoked {
                                "was confirmed"
                            } else {
                                "could not be confirmed"
                            }
                        ),
                        None,
                    ));
                }
                Ok(credentials)
            }
            Err(error) => {
                if matches!(&error, CliError::Developers { code, status: Some(400), .. } if code == "invalid_grant")
                {
                    store.clear().await?;
                }
                Err(error)
            }
        }
    }
    async fn status(&self, store: &Store) -> Result<Account, CliError> {
        let _guard = store.lock().await?;
        let saved = self.access(store).await?;
        match self.account(&saved.access_token).await {
            Err(CliError::Developers {
                status: Some(401), ..
            }) => {
                let refreshed = self.refresh(store, &saved).await?;
                self.account(&refreshed.access_token).await
            }
            result => result,
        }
    }
    async fn account(&self, bearer: &str) -> Result<Account, CliError> {
        let response = self
            .client
            .get(self.endpoint("/api/cli/account"))
            .bearer_auth(bearer)
            .send()
            .await
            .map_err(|_| Self::network_error(false))?;
        let (status, retry_after, value) = Self::body(response, false).await?;
        if !(200..300).contains(&status) {
            return Err(Self::protocol_error(status, retry_after, &value, false));
        }
        serde_json::from_value(value).map_err(|_| {
            failure(
                "INVALID_RESPONSE",
                "Invalid Developers account response",
                Some(status),
            )
        })
    }
    /// Sends one request with the CLI access token. A 2xx answer yields its
    /// JSON body; anything else a [`CliError::Developers`]. A non-JSON 404
    /// means the server predates the route.
    async fn send_authorized(
        &self,
        bearer: &str,
        method: Method,
        path: &str,
        body: Option<&Value>,
    ) -> Result<(u16, Value), CliError> {
        let mut request = self
            .client
            .request(method, self.endpoint(path))
            .bearer_auth(bearer);
        if let Some(body) = body {
            request = request.json(body);
        }
        let response = request
            .send()
            .await
            .map_err(|_| Self::network_error(false))?;
        let route_missing = response.status() == reqwest::StatusCode::NOT_FOUND;
        let (status, retry_after, value) = match Self::body(response, false).await {
            Err(CliError::Developers { code, .. })
                if route_missing && code == "INVALID_RESPONSE" =>
            {
                return Err(failure(
                    "UNSUPPORTED",
                    "This Developers server does not support managing API keys from the CLI.",
                    Some(404),
                ));
            }
            result => result?,
        };
        if !(200..300).contains(&status) {
            return Err(Self::request_error(status, retry_after, &value));
        }
        Ok((status, value))
    }

    /// [`Self::send_authorized`] with the saved CLI login, under the store
    /// lock: the access token is refreshed when near expiry, and once more
    /// when the server rejects it with 401 (a rejected request had no effect,
    /// so repeating it is safe).
    async fn authorized(
        &self,
        store: &Store,
        method: Method,
        path: &str,
        body: Option<&Value>,
    ) -> Result<(u16, Value), CliError> {
        let _guard = store.lock().await?;
        let saved = self.access(store).await?;
        match self
            .send_authorized(&saved.access_token, method.clone(), path, body)
            .await
        {
            Err(CliError::Developers {
                status: Some(401), ..
            }) => {
                let refreshed = self.refresh(store, &saved).await?;
                self.send_authorized(&refreshed.access_token, method, path, body)
                    .await
            }
            result => result,
        }
    }

    /// The organization the CLI login manages keys in, its limits and keys.
    async fn org_keys(&self, store: &Store) -> Result<OrgKeys, CliError> {
        let (status, value) = self
            .authorized(store, Method::GET, "/api/cli/org/keys", None)
            .await?;
        serde_json::from_value::<OrgKeys>(value)
            .ok()
            .filter(|list| list.organization.valid() && list.keys.iter().all(OrgKey::valid))
            .ok_or_else(|| {
                failure(
                    "INVALID_RESPONSE",
                    "Invalid Developers API key list",
                    Some(status),
                )
            })
    }

    /// Revokes an organization key by id.
    async fn revoke_org_key(&self, store: &Store, id: &str) -> Result<(), CliError> {
        if !valid_key_id(id) {
            return Err(failure(
                "INVALID_KEY_ID",
                "Invalid API key id. Run `thru auth keys list` to see key ids.",
                None,
            ));
        }
        self.authorized(
            store,
            Method::POST,
            &format!("/api/cli/org/keys/{id}/revoke"),
            Some(&json!({})),
        )
        .await
        .map(|_| ())
    }

    async fn revoke(&self, refresh_token: &str) -> Result<(), CliError> {
        let response = self
            .client
            .post(self.endpoint("/api/cli/logout"))
            .form(&[("client_id", CLIENT_ID), ("refresh_token", refresh_token)])
            .send()
            .await
            .map_err(|_| Self::network_error(false))?;
        let (status, retry_after, value) = Self::body(response, false).await?;
        if !(200..300).contains(&status) || value.get("success") != Some(&Value::Bool(true)) {
            return Err(Self::protocol_error(status, retry_after, &value, false));
        }
        Ok(())
    }
    async fn logout(
        &self,
        store: &Store,
        keys: &KeyStore,
    ) -> Result<(bool, KeyRevocation), CliError> {
        let _guard = store.lock().await?;
        // The key is revoked first, while the CLI login can still authorize it.
        let key = self.revoke_provisioned_key(store, keys).await;
        let saved = match store.load().await {
            Ok(Some(saved)) => saved,
            Ok(None) => return Ok((false, key)),
            Err(_) => {
                store.clear().await?;
                return Err(failure(
                    "REVOCATION_UNCONFIRMED",
                    "Local credentials were cleared but could not be read for server revocation. Revoke this installation in Developers Account settings.",
                    None,
                ));
            }
        };
        let remote = self.revoke(&saved.refresh_token).await;
        store.clear().await?;
        remote.map(|()| (true, key)).map_err(|_| failure("REVOCATION_UNCONFIRMED", "Local Developers credentials were cleared, but server revocation could not be confirmed. Revoke this CLI installation in Developers Account settings.", None))
    }
    async fn login(
        &self,
        store: &Store,
        keys: &KeyStore,
        machine: &str,
        no_browser: bool,
        json_format: bool,
    ) -> Result<(Account, KeyProvisioning), CliError> {
        // Serialize the entire login, including browser approval, so a second process
        // cannot create an installation that this process cannot persist.
        let _guard = store.lock().await?;
        let previous = store.load().await?;
        let (credentials, key_scope) = self.authorize(no_browser, json_format).await?;
        self.complete_login(
            store,
            keys,
            machine,
            previous,
            credentials,
            key_scope,
            json_format,
        )
        .await
    }

    /// Starts a device authorization for `thru auth login --no-wait` and saves
    /// it (owner-only, beside the credentials) for [`Self::resume_login`].
    /// Never opens a browser and never waits.
    async fn start_pending_login(&self, store: &Store) -> Result<PendingLogin, CliError> {
        let _guard = store.lock().await?;
        let device = self.request_device_authorization().await?;
        let pending = PendingLogin {
            origin: self.origin(),
            device_code: device.device_code,
            user_code: device.user_code,
            verification_uri_complete: device.verification.to_string(),
            interval: device.interval,
            expires_at: now().saturating_add(device.expires_in),
            key_scope: device.key_scope,
        };
        let raw = serde_json::to_vec(&pending)
            .map_err(|_| storage_error("Could not serialize the pending login"))?;
        store.save_pending_login(&raw)?;
        Ok(pending)
    }

    /// The pending login saved by `--no-wait`, if it is valid, for this origin
    /// and not expired. An invalid or expired file is removed.
    fn load_pending_login(&self, store: &Store) -> Result<PendingLogin, CliError> {
        let pending = store.load_pending_login()?.ok_or_else(|| {
            failure(
                "NO_PENDING_LOGIN",
                "No pending login to resume. Run `thru auth login --no-wait` again.",
                None,
            )
        })?;
        let pending = serde_json::from_str::<PendingLogin>(&pending)
            .ok()
            .filter(|pending| {
                pending.origin == self.origin()
                    && valid_token(&pending.device_code)
                    && valid_user_code(&pending.user_code)
                    && valid_interval(pending.interval)
                    && Url::parse(&pending.verification_uri_complete)
                        .is_ok_and(|url| self.own_approval_url(&url))
            });
        let Some(pending) = pending else {
            let _ = store.clear_pending_login();
            return Err(failure(
                "NO_PENDING_LOGIN",
                "The saved pending login is invalid. Run `thru auth login --no-wait` again.",
                None,
            ));
        };
        if pending.expires_at <= now() {
            let _ = store.clear_pending_login();
            return Err(pending_expired());
        }
        Ok(pending)
    }

    /// `thru auth login --resume`: polls the code saved by `--no-wait` for
    /// its remaining lifetime, then finishes the login as [`Self::login`]
    /// does. The saved code is removed once it is spent (approval), expired or
    /// rejected; it is kept after a network or server error so `--resume` can
    /// be run again.
    async fn resume_login(
        &self,
        store: &Store,
        keys: &KeyStore,
        machine: &str,
        json_format: bool,
    ) -> Result<(Account, KeyProvisioning), CliError> {
        let _guard = store.lock().await?;
        let pending = self.load_pending_login(store)?;
        let previous = store.load().await?;
        eprintln!(
            "Waiting for approval at {}\nCode: {}",
            pending.verification_uri_complete, pending.user_code
        );
        let remaining = Duration::from_secs(pending.expires_at.saturating_sub(now()));
        let result = self
            .poll_device_token(&pending.device_code, pending.interval, remaining)
            .await;
        if result.as_ref().map_or_else(spends_pending_login, |_| true) {
            let _ = store.clear_pending_login();
        }
        let credentials = result.map_err(|error| match error {
            CliError::Developers { code, .. } if code == "expired_token" => pending_expired(),
            error => error,
        })?;
        self.complete_login(
            store,
            keys,
            machine,
            previous,
            credentials,
            pending.key_scope,
            json_format,
        )
        .await
    }

    /// Verifies and saves freshly authorized credentials, provisions this
    /// machine's API key and revokes the previous installation. Caller holds
    /// the store lock and passes the credentials saved before authorizing.
    #[allow(clippy::too_many_arguments)]
    async fn complete_login(
        &self,
        store: &Store,
        keys: &KeyStore,
        machine: &str,
        previous: Option<Credentials>,
        credentials: Credentials,
        key_scope: bool,
        json_format: bool,
    ) -> Result<(Account, KeyProvisioning), CliError> {
        let account = match self.account(&credentials.access_token).await {
            Ok(account) => account,
            Err(error) => {
                if self.revoke(&credentials.refresh_token).await.is_err() {
                    return Err(failure(
                        "REVOCATION_UNCONFIRMED",
                        "New Developers login could not be verified or revoked. Local credentials were unchanged. Revoke the new installation in Developers Account settings.",
                        None,
                    ));
                }
                return Err(error);
            }
        };
        if store.save(&credentials).await.is_err() {
            // A store can fail after writing (for example, directory fsync).
            // Check for the old value first, then restore it if necessary.
            let preserved = match store.load().await {
                Ok(saved) if saved == previous => true,
                _ => match &previous {
                    Some(saved) => store.save(saved).await.is_ok(),
                    None => store.clear().await.is_ok(),
                },
            };
            let revoked = self.revoke(&credentials.refresh_token).await.is_ok();
            return Err(failure(
                "LOGIN_STORAGE_FAILED",
                &format!(
                    "Authorized credentials could not be saved. {} New installation revocation {}. Review Developers Account settings before logging in again.",
                    match (previous.is_some(), preserved) {
                        (true, true) => "Previous login was preserved.",
                        (false, true) => "Local credentials were cleared.",
                        (_, false) => "Previous credential state could not be restored.",
                    },
                    if revoked {
                        "was confirmed"
                    } else {
                        "could not be confirmed"
                    }
                ),
                None,
            ));
        }
        // Provision before revoking the previous installation so a saved login
        // always gets a key attempt; failures here never fail the login.
        let previous_key = blocking(keys, |keys| keys.load_metadata()).await;
        let mut provisioning = if key_scope {
            self.provision_key(keys, &credentials.access_token, machine)
                .await
        } else {
            KeyProvisioning::Unavailable
        };
        provisioning.report(json_format);
        // The new key now replaces the local record. The server replaces the
        // previous key of this login, and of the same machine in the same
        // organization, and revokes a login's key when that login is logged
        // out; a key from a different organization or account is revoked here
        // explicitly, before the previous installation is logged out.
        if let KeyProvisioning::Provisioned(key, outcome) = &mut provisioning {
            *outcome = match &previous_key {
                Ok(None) => KeyRevocation::None,
                Ok(Some(previous)) if previous.id == key.id => KeyRevocation::None,
                Ok(Some(previous)) => {
                    match self
                        .delete_key(&credentials.access_token, &previous.id)
                        .await
                    {
                        Ok(()) => KeyRevocation::Revoked,
                        Err(error) => {
                            eprintln!("{}", unrevoked_key_warning(previous, &error));
                            KeyRevocation::Unconfirmed
                        }
                    }
                }
                Err(_) => {
                    eprintln!(
                        "warning: details of a previously stored API key were unreadable, so it could not be revoked; check Organization settings for an unused key."
                    );
                    KeyRevocation::Unconfirmed
                }
            };
        }
        if let Some(previous) = previous {
            if self.revoke(&previous.refresh_token).await.is_err() {
                return Err(failure(
                    "REVOCATION_UNCONFIRMED",
                    "New Developers login was saved, but revoking the previous installation could not be confirmed. Revoke the previous installation in Developers Account settings.",
                    None,
                ));
            }
            // Revoking the previous installation also revokes its API key on
            // the server. When no new key replaced it locally, drop the stale
            // record so RPC calls go unkeyed instead of sending a revoked key.
            if !matches!(provisioning, KeyProvisioning::Provisioned(..))
                && matches!(previous_key, Ok(Some(_)))
                && blocking(keys, |keys| keys.clear()).await.is_err()
            {
                eprintln!(
                    "warning: the previous login's API key was revoked but could not be removed locally; run `thru auth logout` to clear it."
                );
            }
        }
        Ok((account, provisioning))
    }

    /// Creates an org API key named for this machine and stores it locally,
    /// overwriting any previous local record. The server replaces this login's
    /// previous key and the same machine's key in the same organization;
    /// [`Self::login`] revokes any other recorded key.
    async fn provision_key(&self, keys: &KeyStore, bearer: &str, machine: &str) -> KeyProvisioning {
        let response = match self
            .client
            .post(self.endpoint("/api/cli/keys"))
            .bearer_auth(bearer)
            .json(&json!({ "machine": machine }))
            .send()
            .await
        {
            Ok(response) => response,
            Err(_) => return KeyProvisioning::Failed("could not contact Thru Developers".into()),
        };
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return KeyProvisioning::Unavailable;
        }
        let (status, retry_after, value) = match Self::body(response, false).await {
            Ok(body) => body,
            Err(error) => return KeyProvisioning::Failed(describe(&error)),
        };
        if !(200..300).contains(&status) {
            return KeyProvisioning::Failed(describe(&Self::protocol_error(
                status,
                retry_after,
                &value,
                false,
            )));
        }
        let id = value
            .pointer("/key/id")
            .and_then(Value::as_str)
            .filter(|id| valid_key_id(id))
            .map(str::to_owned);
        let parsed = serde_json::from_value::<ProvisionedKeyResponse>(value)
            .ok()
            .filter(|response| {
                valid_api_key(&response.plaintext)
                    && valid_key_id(&response.key.id)
                    && [
                        &response.key.name,
                        &response.key.prefix,
                        &response.key.organization_id,
                        &response.key.organization_name,
                    ]
                    .iter()
                    .all(|text| valid_text(text))
            });
        let Some(ProvisionedKeyResponse { key, plaintext }) = parsed else {
            let revoked = match &id {
                Some(id) => self.delete_key(bearer, id).await.is_ok(),
                None => false,
            };
            return KeyProvisioning::Failed(format!(
                "Developers returned an invalid API key response{}",
                if revoked { "; the key was revoked" } else { "" }
            ));
        };
        let metadata = KeyMetadata {
            origin: self.origin(),
            id: key.id,
            name: key.name,
            prefix: key.prefix,
            organization_id: key.organization_id,
            organization_name: key.organization_name,
        };
        let id = metadata.id.clone();
        match blocking(keys, move |keys| keys.save(metadata, &plaintext)).await {
            Ok(saved) => KeyProvisioning::Provisioned(saved, KeyRevocation::None),
            Err(_) => {
                let revoked = self.delete_key(bearer, &id).await.is_ok();
                KeyProvisioning::Failed(format!(
                    "the key could not be stored locally and {}",
                    if revoked {
                        "was revoked"
                    } else {
                        "its revocation could not be confirmed; revoke it in Organization settings"
                    }
                ))
            }
        }
    }

    /// Revokes a provisioned key. Only a 2xx confirms it: the server answers
    /// 204 for this account's keys even when already revoked, and 404
    /// `KEY_NOT_FOUND` for a key this account cannot see (for example one
    /// created by another account), which is therefore still live.
    async fn delete_key(&self, bearer: &str, id: &str) -> Result<(), CliError> {
        if !valid_key_id(id) {
            return Err(failure("INVALID_KEY_ID", "Invalid stored API key id", None));
        }
        let response = self
            .client
            .delete(self.endpoint(&format!("/api/cli/keys/{id}")))
            .bearer_auth(bearer)
            .send()
            .await
            .map_err(|_| Self::network_error(false))?;
        if response.status().is_success() {
            return Ok(());
        }
        let (status, retry_after, value) = Self::body(response, false).await?;
        Err(Self::protocol_error(status, retry_after, &value, false))
    }

    /// Revokes the provisioned key on the server (best effort; warns on
    /// failure), then removes the local copy. Caller holds the store lock.
    async fn revoke_provisioned_key(&self, store: &Store, keys: &KeyStore) -> KeyRevocation {
        let metadata = match blocking(keys, |keys| keys.load_metadata()).await {
            Ok(None) => return KeyRevocation::None,
            Ok(Some(metadata)) => Some(metadata),
            Err(_) => None,
        };
        let outcome = match &metadata {
            Some(metadata) => {
                let remote = match self.access(store).await {
                    Ok(saved) => match self.delete_key(&saved.access_token, &metadata.id).await {
                        Err(CliError::Developers {
                            status: Some(401), ..
                        }) => match self.refresh(store, &saved).await {
                            Ok(refreshed) => {
                                self.delete_key(&refreshed.access_token, &metadata.id).await
                            }
                            Err(error) => Err(error),
                        },
                        result => result,
                    },
                    Err(error) => Err(error),
                };
                match remote {
                    Ok(()) => KeyRevocation::Revoked,
                    Err(error) => {
                        eprintln!("{}", unrevoked_key_warning(metadata, &error));
                        KeyRevocation::Unconfirmed
                    }
                }
            }
            None => {
                eprintln!(
                    "warning: stored API key details are unreadable, so it could not be revoked on the server; revoke it in Organization settings."
                );
                KeyRevocation::Unconfirmed
            }
        };
        if blocking(keys, |keys| keys.clear()).await.is_err() {
            eprintln!(
                "warning: could not remove the local API key; remove the cli-key files under ~/.thru/cli/auth."
            );
        }
        outcome
    }

    /// Starts a device authorization for `scope`.
    async fn device_code(&self, scope: &str) -> Result<(u16, Option<u64>, Value), CliError> {
        let origin = self.origin();
        let response = self
            .client
            .post(self.endpoint("/api/auth/device/code"))
            .form(&[
                ("client_id", CLIENT_ID),
                ("scope", scope),
                ("resource", origin.as_str()),
            ])
            .send()
            .await
            .map_err(|_| Self::network_error(false))?;
        Self::body(response, false).await
    }

    /// Runs the device grant: [`Self::request_device_authorization`], then
    /// [`Self::poll_device_token`] for the code's lifetime. The flag is whether
    /// the login carries `keys:cli`.
    async fn authorize(
        &self,
        no_browser: bool,
        json_format: bool,
    ) -> Result<(Credentials, bool), CliError> {
        let device = self.request_device_authorization().await?;
        show_approval(
            &device.verification,
            &device.user_code,
            no_browser,
            json_format,
        );
        let credentials = self
            .poll_device_token(
                &device.device_code,
                device.interval,
                Duration::from_secs(device.expires_in),
            )
            .await?;
        Ok((credentials, device.key_scope))
    }

    /// Requests a device code and validates it. A Developers deployment that
    /// predates `keys:cli` rejects the request (400 `invalid_request`, or
    /// `invalid_scope`), so the request is retried once with [`LEGACY_SCOPE`].
    /// The approval URL must belong to the configured origin; it gets
    /// `ref=cli` so a sign-up through it is attributed to the CLI.
    async fn request_device_authorization(&self) -> Result<DeviceAuthorization, CliError> {
        let mut key_scope = true;
        let (mut status, mut retry_after, mut value) = self.device_code(SCOPE).await?;
        if status == 400
            && matches!(
                &Self::protocol_error(status, retry_after, &value, false),
                CliError::Developers { code, .. } if code == "invalid_request" || code == "invalid_scope"
            )
        {
            key_scope = false;
            (status, retry_after, value) = self.device_code(LEGACY_SCOPE).await?;
        }
        if !(200..300).contains(&status) {
            return Err(Self::protocol_error(status, retry_after, &value, false));
        }
        let code: DeviceCode = serde_json::from_value(value).map_err(|_| {
            failure(
                "INVALID_RESPONSE",
                "Invalid Developers device authorization response",
                Some(status),
            )
        })?;
        if !valid_token(&code.device_code)
            || !valid_user_code(&code.user_code)
            || code.expires_in == 0
            || code.expires_in > 3600
            || !valid_interval(code.interval)
        {
            return Err(failure(
                "INVALID_RESPONSE",
                "Invalid Developers device authorization response",
                Some(status),
            ));
        }
        let verification = Url::parse(
            code.verification_uri_complete
                .as_deref()
                .unwrap_or(&code.verification_uri),
        )
        .map_err(|_| {
            failure(
                "INVALID_RESPONSE",
                "Invalid browser approval URL",
                Some(status),
            )
        })?;
        if !self.own_approval_url(&verification) {
            return Err(failure(
                "INVALID_RESPONSE",
                "Browser approval URL must belong to the configured Developers origin",
                Some(status),
            ));
        }
        Ok(DeviceAuthorization {
            device_code: code.device_code,
            user_code: code.user_code,
            verification: with_cli_ref(verification),
            expires_in: code.expires_in,
            interval: code.interval,
            key_scope,
        })
    }

    /// Starts a browser approval for one API key (`POST
    /// /api/cli/key-requests`, no login needed) and validates the answer.
    async fn request_key(&self, body: &Value) -> Result<KeyRequest, CliError> {
        let response = self
            .client
            .post(self.endpoint("/api/cli/key-requests"))
            .json(body)
            .send()
            .await
            .map_err(|_| Self::network_error(false))?;
        let unsupported = || {
            failure(
                "UNSUPPORTED",
                "This Developers server does not support approving API keys from the CLI yet.",
                Some(404),
            )
        };
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Err(unsupported());
        }
        let (status, retry_after, value) = Self::body(response, false).await?;
        if !(200..300).contains(&status) {
            return Err(Self::request_error(status, retry_after, &value));
        }
        let invalid = || {
            failure(
                "INVALID_RESPONSE",
                "Invalid Developers key request response",
                Some(status),
            )
        };
        let request: KeyRequestResponse = serde_json::from_value(value).map_err(|_| invalid())?;
        if !valid_key_id(&request.request_id)
            || !valid_request_code(&request.user_code)
            || !valid_token(&request.poll_token)
            || request.expires_in == 0
            || request.expires_in > 3600
            || !valid_interval(request.interval)
        {
            return Err(invalid());
        }
        let verification = Url::parse(
            request
                .verification_uri_complete
                .as_deref()
                .unwrap_or(&request.verification_uri),
        )
        .map_err(|_| invalid())?;
        if !self.own_approval_url(&verification) {
            return Err(failure(
                "INVALID_RESPONSE",
                "Browser approval URL must belong to the configured Developers origin",
                Some(status),
            ));
        }
        Ok(KeyRequest {
            user_code: request.user_code,
            verification: with_cli_ref(verification),
            expires_in: request.expires_in,
            interval: request.interval,
            poll_token: request.poll_token,
        })
    }

    /// Polls a key request every `interval` seconds (plus 5 s per
    /// `slow_down`) until it is approved, fails, or `lifetime` elapses.
    /// Network and server errors are retried, at most
    /// [`MAX_TRANSIENT_POLLS`] times in a row.
    async fn poll_key_request(
        &self,
        poll_token: &str,
        interval: u64,
        lifetime: Duration,
    ) -> Result<ApprovedKey, CliError> {
        let deadline = tokio::time::Instant::now() + lifetime;
        let mut interval = Duration::from_secs(interval);
        let mut transient = 0;
        loop {
            tokio::time::sleep(
                interval.min(deadline.saturating_duration_since(tokio::time::Instant::now())),
            )
            .await;
            if tokio::time::Instant::now() >= deadline {
                return Err(failure(
                    "expired_token",
                    "The browser approval expired before the key was approved. Run the command again.",
                    None,
                ));
            }
            let answer = match self
                .client
                .post(self.endpoint("/api/cli/key-requests/poll"))
                .json(&json!({ "pollToken": poll_token }))
                .send()
                .await
            {
                Err(_) => KeyPoll::Transient,
                Ok(response) => {
                    let status = response.status().as_u16();
                    let body = Self::body(response, false)
                        .await
                        .ok()
                        .map(|(_, _, value)| value);
                    classify_key_poll(status, body.as_ref())
                }
            };
            match answer {
                KeyPoll::Pending => transient = 0,
                KeyPoll::SlowDown => {
                    transient = 0;
                    interval = interval.saturating_add(Duration::from_secs(5));
                }
                KeyPoll::Approved(key) => return Ok(key),
                KeyPoll::Transient => {
                    transient += 1;
                    if transient >= MAX_TRANSIENT_POLLS {
                        return Err(Self::network_error(false));
                    }
                }
                KeyPoll::Failed(error) => return Err(error),
            }
        }
    }

    /// Requests the key described by `body`, shows the approval link and
    /// waits for the user's decision.
    async fn approve_key(
        &self,
        body: &Value,
        no_browser: bool,
        json_format: bool,
    ) -> Result<ApprovedKey, CliError> {
        let request = self.request_key(body).await?;
        show_approval(
            &request.verification,
            &request.user_code,
            no_browser,
            json_format,
        );
        eprintln!(
            "Waiting for approval in the browser (expires in {} minutes)...\nAgents: if this tool call can time out, stop it and run the command with --no-wait instead, ask the user to approve, then run `{KEY_RESUME_COMMAND}`.",
            request.expires_in.div_ceil(60)
        );
        self.poll_key_request(
            &request.poll_token,
            request.interval,
            Duration::from_secs(request.expires_in),
        )
        .await
    }

    /// Whether `url` is a browser approval URL on the configured origin.
    fn own_approval_url(&self, url: &Url) -> bool {
        url.origin() == self.origin.origin()
            && url.username().is_empty()
            && url.password().is_none()
    }

    /// Polls the token endpoint for `device_code` every `interval` seconds
    /// (plus 5 s per `slow_down`) until approval, a terminal error, or
    /// `lifetime` elapses (`expired_token`).
    async fn poll_device_token(
        &self,
        device_code: &str,
        interval: u64,
        lifetime: Duration,
    ) -> Result<Credentials, CliError> {
        let origin = self.origin();
        let deadline = tokio::time::Instant::now() + lifetime;
        let mut interval = Duration::from_secs(interval);
        loop {
            tokio::time::sleep(
                interval.min(deadline.saturating_duration_since(tokio::time::Instant::now())),
            )
            .await;
            if tokio::time::Instant::now() >= deadline {
                return Err(failure(
                    "expired_token",
                    "The browser approval code expired. Run thru auth login again.",
                    None,
                ));
            }
            let result = self
                .token(&[
                    ("grant_type", "urn:ietf:params:oauth:grant-type:device_code"),
                    ("client_id", CLIENT_ID),
                    ("device_code", device_code),
                    ("resource", &origin),
                ])
                .await;
            match result {
                Ok(credentials) => return Ok(credentials),
                Err(CliError::Developers { code, .. }) if code == "authorization_pending" => {}
                Err(CliError::Developers { code, .. }) if code == "slow_down" => {
                    interval = interval.saturating_add(Duration::from_secs(5))
                }
                Err(error) => return Err(error),
            }
        }
    }
}

/// Prints the approval URL and code (on stderr with `--json`, so stdout
/// stays one JSON document) and opens the browser unless `no_browser`.
fn show_approval(url: &Url, code: &str, no_browser: bool, json_format: bool) {
    if json_format {
        eprintln!("Approve at {url}\nCode: {code}");
    } else {
        println!("Approve at {url}\nCode: {code}");
    }
    if !no_browser && open_browser(url.as_str()).is_err() {
        eprintln!("Could not open a browser. Open the approval URL shown above.");
    }
}

fn open_browser(url: &str) -> std::io::Result<()> {
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(target_os = "linux")]
    let mut command = std::process::Command::new("xdg-open");
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = std::process::Command::new("rundll32.exe");
        command.arg("url.dll,FileProtocolHandler");
        command
    };
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    return Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "Use --no-browser on this platform",
    ));
    #[cfg(any(target_os = "macos", target_os = "linux", target_os = "windows"))]
    {
        let child = command
            .arg(url)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()?;
        let mut child = child;
        std::thread::spawn(move || {
            let _ = child.wait();
        });
        Ok(())
    }
}

fn api_key() -> Result<Option<String>, CliError> {
    match std::env::var("THRU_DEVELOPERS_API_KEY") {
        Ok(key) if valid_token(&key) => Ok(Some(key)),
        Err(std::env::VarError::NotPresent) => Ok(None),
        _ => Err(failure(
            "INVALID_API_KEY",
            "THRU_DEVELOPERS_API_KEY must contain a raw Bearer API key, never a header or newline",
            None,
        )),
    }
}

/// Runs a `thru auth` command. `rpc` is the user's RPC configuration, used
/// only by `status` to say whether RPC calls carry an API key; the other
/// commands ignore it.
pub async fn handle_auth(
    command: AuthCommands,
    json_format: bool,
    rpc: &Config,
) -> Result<(), CliError> {
    let developers = Developers::configured()?;
    let origin = developers.origin();
    match command {
        AuthCommands::Login { no_wait: true, .. } => {
            let pending = developers
                .start_pending_login(&Store::configured(&origin)?)
                .await?;
            output::print_output(pending.to_json(), json_format);
        }
        AuthCommands::Login {
            no_browser, resume, ..
        } => {
            let store = Store::configured(&origin)?;
            let keys = KeyStore::configured(&origin)?;
            let (account, provisioning) = if resume {
                developers
                    .resume_login(&store, &keys, &machine_name(), json_format)
                    .await?
            } else {
                developers
                    .login(&store, &keys, &machine_name(), no_browser, json_format)
                    .await?
            };
            output::print_output(
                json!({"auth":{"status":"authenticated","origin":origin,"account":account,"rpc_api_key":provisioning.to_json()}}),
                json_format,
            );
        }
        AuthCommands::Status => {
            let status = auth_status(
                &developers,
                &Store::configured(&origin)?,
                &KeyStore::configured(&origin)?,
                rpc,
            )
            .await?;
            output::print_output(status, json_format);
        }
        AuthCommands::Logout => {
            let (revoked, key) = developers
                .logout(
                    &Store::configured(&origin)?,
                    &KeyStore::configured(&origin)?,
                )
                .await?;
            output::print_output(
                json!({"auth":{"status":"logged_out","origin":origin,"installation_revoked":revoked,"rpc_api_key":key.as_str()}}),
                json_format,
            );
        }
        AuthCommands::Keys {
            subcommand:
                AuthKeysCommands::Create {
                    name,
                    agent,
                    origins,
                    print,
                    no_skill,
                    no_browser,
                    no_wait,
                    resume,
                },
        } => {
            let options = CreateKey {
                name,
                agent,
                origins,
                print,
                no_skill,
                no_browser,
                no_wait,
                resume,
            };
            let (result, shown) = create_key(
                &developers,
                &Store::configured(&origin)?,
                &options,
                &machine_name(),
                json_format,
                &SystemRunner,
                InstallPaths::configured,
            )
            .await?;
            output::print_output(result, json_format);
            if shown {
                eprintln!("{NEW_KEY_WARNING}");
            }
        }
        AuthCommands::Keys { subcommand } => {
            let result = auth_keys(&developers, &Store::configured(&origin)?, subcommand).await?;
            output::print_output(result, json_format);
        }
    }
    Ok(())
}

/// `thru auth keys create`: a browser approval for one key, then the key is
/// printed once, or installed into the agent client named by `--agent`.
/// `--no-wait` only starts the approval and saves it in `store`; `--resume`
/// finishes it. Returns the output and whether it shows the secret. `paths`
/// locates the clients' configuration and is only called to install a key.
async fn create_key<R: Runner>(
    developers: &Developers,
    store: &Store,
    options: &CreateKey,
    machine: &str,
    json_format: bool,
    runner: &R,
    paths: impl FnOnce() -> Result<InstallPaths, CliError>,
) -> Result<(Value, bool), CliError> {
    if options.resume {
        return resume_key(developers, store, runner, paths).await;
    }
    let plan = plan_key(developers, options, machine)?;
    // Checked before the approval so a bad setting does not waste it.
    let url = plan_mcp_url(&plan)?;
    if options.no_wait {
        let pending = start_pending_key(developers, store, &plan, machine).await?;
        return Ok((pending.to_json(), false));
    }
    let paths = plan_paths(&plan, paths)?;
    let key = developers
        .approve_key(
            &key_request_body(&plan, machine),
            options.no_browser,
            json_format,
        )
        .await?;
    finish_key(developers, &plan, url, key, runner, paths).await
}

/// Validates the options of a new key request.
fn plan_key(
    developers: &Developers,
    options: &CreateKey,
    machine: &str,
) -> Result<KeyPlan, CliError> {
    if !options.origins.is_empty() {
        return Err(failure(
            "ORIGIN_UNSUPPORTED",
            &format!(
                "--origin is not supported by `thru auth keys create`. Create the key, then set its allowed origins in the Thru Developers dashboard ({}).",
                developers.endpoint("/keys")
            ),
            None,
        ));
    }
    let agent = options.agent.as_deref();
    if agent.is_some_and(|agent| !valid_agent_client(agent)) {
        return Err(failure(
            "INVALID_AGENT_CLIENT",
            "--agent must be 1-32 lowercase letters, digits or '-', starting with a letter or digit",
            None,
        ));
    }
    let name = match (&options.name, agent) {
        (Some(name), _) => name.trim().to_owned(),
        (None, Some(agent)) => agent::default_key_name(agent, machine),
        (None, None) => {
            return Err(failure(
                "NAME_REQUIRED",
                "Pass --name <NAME>, --agent <CLIENT>, or both.",
                None,
            ));
        }
    };
    if !valid_text(&name) {
        return Err(failure(
            "INVALID_NAME",
            "--name must be non-empty printable text",
            None,
        ));
    }
    Ok(KeyPlan {
        name,
        agent: options.agent.clone(),
        print: options.print,
        no_skill: options.no_skill,
    })
}

/// The MCP URL, for an agent key.
fn plan_mcp_url(plan: &KeyPlan) -> Result<Option<String>, CliError> {
    plan.agent.as_ref().map(|_| agent::mcp_url()).transpose()
}

/// The client config locations, when the key is installed.
fn plan_paths(
    plan: &KeyPlan,
    paths: impl FnOnce() -> Result<InstallPaths, CliError>,
) -> Result<Option<InstallPaths>, CliError> {
    plan.install_into().map(|_| paths()).transpose()
}

/// `--no-wait`: starts the key request and saves it (owner-only, beside the
/// login credentials) for [`resume_key`]. Never opens a browser.
async fn start_pending_key(
    developers: &Developers,
    store: &Store,
    plan: &KeyPlan,
    machine: &str,
) -> Result<PendingKeyRequest, CliError> {
    let _guard = store.lock().await?;
    let request = developers
        .request_key(&key_request_body(plan, machine))
        .await?;
    let pending = PendingKeyRequest {
        origin: developers.origin(),
        poll_token: request.poll_token,
        user_code: request.user_code,
        verification_uri_complete: request.verification.to_string(),
        interval: request.interval,
        expires_at: now().saturating_add(request.expires_in),
        plan: plan.clone(),
    };
    let raw = serde_json::to_vec(&pending)
        .map_err(|_| storage_error("Could not serialize the pending key request"))?;
    store.save_pending_key_request(&raw)?;
    Ok(pending)
}

/// The key request saved by `--no-wait`, if it is valid, for this origin
/// and not expired. An invalid or expired file is removed.
fn load_pending_key(developers: &Developers, store: &Store) -> Result<PendingKeyRequest, CliError> {
    let start_again = |message: &str| failure("NO_PENDING_KEY_REQUEST", message, None);
    let raw = store.load_pending_key_request()?.ok_or_else(|| {
        start_again(
            "No pending key request to resume. Run `thru auth keys create --no-wait` again.",
        )
    })?;
    let pending = serde_json::from_str::<PendingKeyRequest>(&raw)
        .ok()
        .filter(|pending| {
            pending.origin == developers.origin()
                && valid_token(&pending.poll_token)
                && valid_request_code(&pending.user_code)
                && valid_interval(pending.interval)
                && pending.plan.valid()
                && Url::parse(&pending.verification_uri_complete)
                    .is_ok_and(|url| developers.own_approval_url(&url))
        });
    let Some(pending) = pending else {
        let _ = store.clear_pending_key_request();
        return Err(start_again(
            "The saved key request is invalid. Run `thru auth keys create --no-wait` again.",
        ));
    };
    if pending.expires_at <= now() {
        let _ = store.clear_pending_key_request();
        return Err(failure(
            "expired_token",
            "The pending key request expired. Run `thru auth keys create --no-wait` again.",
            None,
        ));
    }
    Ok(pending)
}

/// `--resume`: polls the request saved by `--no-wait` for its remaining
/// lifetime, then prints or installs the key as planned then. The saved
/// request is removed once it is spent (approved, denied, expired or
/// unknown); it is kept after repeated network or server errors so
/// `--resume` can be run again.
async fn resume_key<R: Runner>(
    developers: &Developers,
    store: &Store,
    runner: &R,
    paths: impl FnOnce() -> Result<InstallPaths, CliError>,
) -> Result<(Value, bool), CliError> {
    let _guard = store.lock().await?;
    let pending = load_pending_key(developers, store)?;
    let url = plan_mcp_url(&pending.plan)?;
    let paths = plan_paths(&pending.plan, paths)?;
    eprintln!(
        "Waiting for approval at {}\nCode: {}",
        pending.verification_uri_complete, pending.user_code
    );
    let remaining = Duration::from_secs(pending.expires_at.saturating_sub(now()));
    let result = developers
        .poll_key_request(&pending.poll_token, pending.interval, remaining)
        .await;
    if result
        .as_ref()
        .map_or_else(spends_pending_key_request, |_| true)
    {
        let _ = store.clear_pending_key_request();
    }
    finish_key(developers, &pending.plan, url, result?, runner, paths).await
}

/// `POST /api/cli/key-requests` body for `plan`.
fn key_request_body(plan: &KeyPlan, machine: &str) -> Value {
    let mut body = json!({ "name": plan.name, "machine": machine });
    if let Some(agent) = &plan.agent {
        body["agentClient"] = json!(agent);
    }
    body
}

/// Prints or installs an approved key, then installs the skill.
async fn finish_key<R: Runner>(
    developers: &Developers,
    plan: &KeyPlan,
    url: Option<String>,
    key: ApprovedKey,
    runner: &R,
    paths: Option<InstallPaths>,
) -> Result<(Value, bool), CliError> {
    let mut out = json!({
        "organization": key.organization,
        "key": key.public_json(),
    });
    let mut shown = false;
    match (plan.install_into(), &paths, &url) {
        (Some(client), Some(paths), Some(url)) => {
            let installation = agent::install(runner, paths, client, url, &key.secret)
                .await
                .map_err(|error| {
                    failure(
                        "KEY_NOT_SAVED",
                        &format!(
                            "API key \"{}\" (id {}) was created but could neither be installed nor saved ({}). Revoke it in the Thru Developers dashboard ({}) and run the command again, with --print to show the key.",
                            key.name,
                            key.id,
                            agent::error_message(&error),
                            developers.endpoint("/keys")
                        ),
                        None,
                    )
                })?;
            out["install"] = installation.to_json();
        }
        _ => {
            out["plaintext"] = json!(key.secret);
            shown = true;
            if let Some(url) = &url {
                out["mcp"] = json!({
                    "url": url,
                    "header": "Authorization",
                    "value": "Bearer <key>",
                });
            }
        }
    }
    if plan.agent.is_some() && !plan.no_skill {
        eprintln!(
            "Installing the Thru skill (npx skills add {})...",
            agent::SKILL_SOURCE
        );
        let known = plan.agent.as_deref().and_then(KnownClient::from_label);
        out["skill"] = agent::install_skill(runner, known).await;
    }
    Ok((json!({ "auth_key": out }), shown))
}

/// Shown after `thru auth keys create` prints a key.
const NEW_KEY_WARNING: &str = "warning: this is the only time this API key is shown. Store it now, for example in a secret manager or CI secret; it cannot be retrieved later.";

/// `thru auth status` output: the account, this machine's key, the
/// organization and its limits, and whether RPC calls to the endpoint `rpc`
/// selects carry an API key.
async fn auth_status(
    developers: &Developers,
    store: &Store,
    keys: &KeyStore,
    rpc: &Config,
) -> Result<Value, CliError> {
    let origin = developers.origin();
    // API-key automation is faucet-only, never used for account introspection.
    let account = developers.status(store).await?;
    // Metadata only: status never reads the secret.
    let rpc_api_key = match blocking(keys, |keys| keys.load_metadata()).await {
        Ok(Some(key)) => {
            json!({"present":true,"prefix":key.prefix,"organization":key.organization_name})
        }
        Ok(None) => json!({"present":false}),
        Err(_) => json!({"present":false,"error":"stored API key details are unreadable"}),
    };
    let mut status = json!({
        "status":"authenticated",
        "origin":origin,
        "credential_kind":"device",
        "api_key_override_configured":std::env::var_os("THRU_DEVELOPERS_API_KEY").is_some(),
        "account":account,
        "rpc_api_key":rpc_api_key,
    });
    // Status never fails because organization details are unavailable.
    match developers.org_keys(store).await {
        Ok(list) => {
            status["organization"] = json!(list.organization);
            status["organization_limits"] = json!(list.organization_limits);
        }
        Err(CliError::Developers { code, .. }) if code == "SCOPE_REQUIRED" => {
            status["note"] = json!(
                "This login cannot read organization details or manage API keys. Run `thru auth login` again to grant it."
            );
        }
        Err(CliError::Developers { code, .. }) if code == "NO_ORGANIZATION" => {
            status["note"] =
                json!("Your account has no organization in which you can manage API keys.");
        }
        Err(error) => {
            status["note"] = json!(format!(
                "Organization details are unavailable ({}).",
                describe(&error)
            ));
        }
    }
    status["rpc_endpoint"] = json!(rpc.rpc_base_url);
    status["rpc_api_key_used"] = json!(rpc.rpc_auth_token_present());
    Ok(json!({ "auth": status }))
}

/// `thru auth keys list` and `revoke` output, with the `thru auth login`
/// credentials.
async fn auth_keys(
    developers: &Developers,
    store: &Store,
    command: AuthKeysCommands,
) -> Result<Value, CliError> {
    match command {
        AuthKeysCommands::List => {
            let list = developers.org_keys(store).await?;
            Ok(json!({"auth_keys":{
                "organization":list.organization,
                "organization_limits":list.organization_limits,
                "keys":list.keys,
            }}))
        }
        // Needs a browser approval, not the login: see [`create_key`].
        AuthKeysCommands::Create { .. } => Err(failure(
            "UNSUPPORTED",
            "Creating a key needs a browser approval; run `thru auth keys create`.",
            None,
        )),
        AuthKeysCommands::Revoke { key_id } => {
            developers.revoke_org_key(store, &key_id).await?;
            Ok(json!({"auth_key":{"id":key_id,"status":"revoked"}}))
        }
    }
}

/// Runs the interactive `thru auth login` (browser approval), as offered by
/// the sign-in prompt after the no-key note or a rate-limit hint.
pub async fn sign_in_interactively() -> Result<(), CliError> {
    handle_auth(
        AuthCommands::Login {
            no_browser: false,
            no_wait: false,
            resume: false,
        },
        false,
        &Config::default(),
    )
    .await
}

/// Reads the key provisioned by `thru auth login` for the configured
/// Developers origin, for use as the RPC bearer on official endpoints.
struct ProvisionedKeyLoader {
    warn: bool,
}
impl ProvisionedKeyLoader {
    fn keys() -> Option<KeyStore> {
        let origin = configured_origin().ok()?.origin().ascii_serialization();
        KeyStore::configured(&origin).ok()
    }
}
impl ProvisionedKeySource for ProvisionedKeyLoader {
    fn present(&self) -> bool {
        Self::keys().is_some_and(|keys| matches!(keys.load_metadata(), Ok(Some(_))))
    }
    fn load(&self) -> Option<String> {
        match Self::keys()?.load_secret() {
            Ok(key) => key,
            Err(_) => {
                if self.warn {
                    eprintln!(
                        "warning: could not read the API key from `thru auth login`; continuing without it. Run `thru auth login` again to restore it."
                    );
                }
                None
            }
        }
    }
}

/// Atomically writes a small file at `path` inside `root`, owner-only (0600)
/// on Unix, refusing to replace a symlink. For CLI state that is not a secret
/// but is nobody else's business, such as one-time notice markers.
pub(crate) fn write_owner_only_file(
    root: &std::path::Path,
    path: &std::path::Path,
    raw: &[u8],
) -> Result<(), CliError> {
    #[cfg(unix)]
    {
        storage::write_private(root, path, raw)
    }
    #[cfg(not(unix))]
    {
        storage::write_plain(root, path, raw)
    }
}

/// The API key provisioned by `thru auth login`, read lazily: nothing is read
/// until an official RPC endpoint would receive it. `warn` reports an
/// unreadable key on stderr.
pub fn provisioned_rpc_key(warn: bool) -> ProvisionedApiKey {
    ProvisionedApiKey::new(Arc::new(ProvisionedKeyLoader { warn }))
}

fn selected_network(config: &Config) -> Result<&'static str, CliError> {
    let rpc = Url::parse(&config.rpc_base_url).map_err(|_| {
        failure(
            "UNSUPPORTED_NETWORK",
            "Select the canonical Betanet RPC profile before funding",
            None,
        )
    })?;
    if rpc.scheme() != "https"
        || rpc.port_or_known_default() != Some(443)
        || rpc.path() != "/"
        || rpc.query().is_some()
        || rpc.fragment().is_some()
        || !rpc.username().is_empty()
        || rpc.password().is_some()
    {
        return Err(failure(
            "UNSUPPORTED_NETWORK",
            "Custom/local RPC funding is not inferred. Select the canonical Betanet network profile",
            None,
        ));
    }
    match rpc.host_str() {
        Some("rpc.betanet.thru.org") => Ok("betanet"),
        _ => Err(failure(
            "UNSUPPORTED_NETWORK",
            "Funding supports only the canonical Betanet RPC; no request was sent",
            None,
        )),
    }
}

#[cfg(test)]
async fn submit_fund(
    developers: &Developers,
    bearer: &str,
    network: &str,
    token_account: &str,
    amount: &str,
) -> Result<Value, CliError> {
    submit_funding(
        developers,
        bearer,
        &json!({"network":network,"tokenAddress":token_account,"amount":amount}),
    )
    .await
}

async fn submit_funding(
    developers: &Developers,
    bearer: &str,
    payload: &Value,
) -> Result<Value, CliError> {
    let response = developers
        .client
        .post(developers.endpoint("/api/faucet/fund"))
        .bearer_auth(bearer)
        .json(payload)
        .send()
        .await
        .map_err(|_| Developers::network_error(true))?;
    let (status, retry_after, value) = Developers::body(response, true).await?;
    if !(200..300).contains(&status) {
        return Err(Developers::protocol_error(
            status,
            retry_after,
            &value,
            true,
        ));
    }
    let signature = value
        .get("transactionSignature")
        .and_then(Value::as_str)
        .filter(|signature| {
            signature.starts_with("ts")
                && signature.len() <= 256
                && signature
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"_-".contains(&byte))
                && !signature.contains(bearer)
        });
    if value.get("success") != Some(&Value::Bool(true)) || signature.is_none() {
        let mut error = Developers::network_error(true);
        if let CliError::Developers {
            signature: known,
            status: http_status,
            ..
        } = &mut error
        {
            *known = signature.map(str::to_owned);
            *http_status = Some(status);
        }
        return Err(error);
    }
    // Only the documented public result is emitted, never arbitrary response fields.
    Ok(json!({"success":true,"transactionSignature":signature}))
}

pub async fn fund(
    config: &Config,
    token_account: &str,
    amount: &str,
    json_format: bool,
) -> Result<(), CliError> {
    if !token_account.starts_with("ta") || token_account.len() != 46 {
        return Err(failure(
            "INVALID_TOKEN_ACCOUNT",
            "UUSD account must be an existing ta... token-account address",
            None,
        ));
    }
    crate::utils::validate_address_or_hex(token_account)?;
    let valid_amount = amount.len() <= 128
        && regex::Regex::new(r"^(0|[1-9][0-9]*)(\.[0-9]+)?$")
            .expect("constant decimal regex")
            .is_match(amount)
        && amount.bytes().any(|byte| matches!(byte, b'1'..=b'9'));
    if !valid_amount {
        return Err(failure(
            "INVALID_AMOUNT",
            "UUSD amount must be a positive decimal string without exponent, sign or separators",
            None,
        ));
    }
    fund_asset(config, "uusd", token_account, amount, json_format).await
}

pub async fn fund_thru(
    config: &Config,
    account: &str,
    amount: u64,
    json_format: bool,
) -> Result<(), CliError> {
    if amount == 0 || amount > 10_000 {
        return Err(failure(
            "INVALID_AMOUNT",
            "THRU amount must be 1 to 10000 raw balance units",
            None,
        ));
    }
    let bytes = config.keys.resolve_public_key(account)?;
    let address = thru_base::tn_tools::Pubkey::from_bytes(&bytes).to_string();
    fund_asset(config, "thru", &address, &amount.to_string(), json_format).await
}

async fn fund_asset(
    config: &Config,
    asset: &str,
    account: &str,
    amount: &str,
    json_format: bool,
) -> Result<(), CliError> {
    let network = selected_network(config)?;
    let payload = if asset == "thru" {
        json!({"asset":"thru","network":network,"recipientAddress":account,"amount":amount})
    } else {
        json!({"network":network,"tokenAddress":account,"amount":amount})
    };
    let developers = Developers::configured()?;
    let key = api_key()?;
    let result = if let Some(key) = key {
        submit_funding(&developers, &key, &payload).await?
    } else {
        let store = Store::configured(&developers.origin())?;
        let _guard = store.lock().await?;
        let saved = developers.access(&store).await?;
        submit_funding(&developers, &saved.access_token, &payload).await?
    };
    let mut funding =
        json!({"asset":asset,"network":network,"account":account,"amount":amount,"result":result});
    if asset == "uusd" {
        funding["token_account"] = json!(account);
    }
    output::print_output(json!({"faucet_fund":funding}), json_format);
    Ok(())
}
