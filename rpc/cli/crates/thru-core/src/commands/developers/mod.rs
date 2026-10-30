//! Public OAuth device grant and authenticated test-network funding.
mod storage;
#[cfg(test)]
mod tests;

use crate::{cli::AuthCommands, config::Config, error::CliError, output};
use reqwest::{Client, Response};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use storage::Store;
use url::{Host, Url};

const CLIENT_ID: &str = "thru-cli";
const SCOPE: &str = "profile offline_access faucet:fund";

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
impl Developers {
    fn configured() -> Result<Self, CliError> {
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
        Self::new(&origin)
    }
    fn new(origin: &str) -> Result<Self, CliError> {
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
    async fn logout(&self, store: &Store) -> Result<bool, CliError> {
        let _guard = store.lock().await?;
        let saved = match store.load().await {
            Ok(Some(saved)) => saved,
            Ok(None) => return Ok(false),
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
        remote.map(|()| true).map_err(|_| failure("REVOCATION_UNCONFIRMED", "Local Developers credentials were cleared, but server revocation could not be confirmed. Revoke this CLI installation in Developers Account settings.", None))
    }
    async fn login(
        &self,
        store: &Store,
        no_browser: bool,
        json_format: bool,
    ) -> Result<Account, CliError> {
        // Serialize the entire login, including browser approval, so a second process
        // cannot create an installation that this process cannot persist.
        let _guard = store.lock().await?;
        let previous = store.load().await?;
        let credentials = self.authorize(no_browser, json_format).await?;
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
        if let Some(previous) = previous {
            if self.revoke(&previous.refresh_token).await.is_err() {
                return Err(failure(
                    "REVOCATION_UNCONFIRMED",
                    "New Developers login was saved, but revoking the previous installation could not be confirmed. Revoke the previous installation in Developers Account settings.",
                    None,
                ));
            }
        }
        Ok(account)
    }

    async fn authorize(
        &self,
        no_browser: bool,
        json_format: bool,
    ) -> Result<Credentials, CliError> {
        let origin = self.origin();
        let response = self
            .client
            .post(self.endpoint("/api/auth/device/code"))
            .form(&[
                ("client_id", CLIENT_ID),
                ("scope", SCOPE),
                ("resource", origin.as_str()),
            ])
            .send()
            .await
            .map_err(|_| Self::network_error(false))?;
        let (status, retry_after, value) = Self::body(response, false).await?;
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
            || code.user_code.len() != 8
            || !code
                .user_code
                .bytes()
                .all(|b| b"ABCDEFGHJKLMNPQRSTUVWXYZ23456789".contains(&b))
            || code.expires_in == 0
            || code.expires_in > 3600
            || code.interval == 0
            || code.interval > 300
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
        if verification.origin() != self.origin.origin()
            || !verification.username().is_empty()
            || verification.password().is_some()
        {
            return Err(failure(
                "INVALID_RESPONSE",
                "Browser approval URL must belong to the configured Developers origin",
                Some(status),
            ));
        }
        if json_format {
            eprintln!("Approve at {verification}\nCode: {}", code.user_code);
        } else {
            println!("Approve at {verification}\nCode: {}", code.user_code);
        }
        if !no_browser && open_browser(verification.as_str()).is_err() {
            eprintln!("Could not open a browser. Open the approval URL shown above.");
        }
        let deadline = tokio::time::Instant::now() + Duration::from_secs(code.expires_in);
        let mut interval = Duration::from_secs(code.interval);
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
                    ("device_code", &code.device_code),
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

pub async fn handle_auth(command: AuthCommands, json_format: bool) -> Result<(), CliError> {
    let developers = Developers::configured()?;
    let origin = developers.origin();
    match command {
        AuthCommands::Login { no_browser } => {
            let store = Store::configured(&origin)?;
            let account = developers.login(&store, no_browser, json_format).await?;
            output::print_output(
                json!({"auth":{"status":"authenticated","origin":origin,"account":account}}),
                json_format,
            );
        }
        AuthCommands::Status => {
            // API-key automation is faucet-only, never used for account introspection.
            let account = developers.status(&Store::configured(&origin)?).await?;
            output::print_output(
                json!({"auth":{"status":"authenticated","origin":origin,"credential_kind":"device","api_key_override_configured":std::env::var_os("THRU_DEVELOPERS_API_KEY").is_some(),"account":account}}),
                json_format,
            );
        }
        AuthCommands::Logout => {
            let revoked = developers.logout(&Store::configured(&origin)?).await?;
            output::print_output(
                json!({"auth":{"status":"logged_out","origin":origin,"installation_revoked":revoked}}),
                json_format,
            );
        }
    }
    Ok(())
}

fn selected_network(config: &Config) -> Result<&'static str, CliError> {
    let rpc = Url::parse(&config.rpc_base_url).map_err(|_| {
        failure(
            "UNSUPPORTED_NETWORK",
            "Select the canonical Alphanet or Betanet RPC profile before funding",
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
            "Custom/local RPC funding is not inferred. Select the canonical Alphanet or Betanet network profile",
            None,
        ));
    }
    match rpc.host_str() {
        Some("rpc.alphanet.thru.org") => Ok("alphanet"),
        Some("rpc.betanet.thru.org") => Ok("betanet"),
        _ => Err(failure(
            "UNSUPPORTED_NETWORK",
            "Funding supports only canonical Alphanet/Betanet RPCs; no request was sent",
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
            "THRUSD account must be an existing ta... token-account address",
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
            "THRUSD amount must be a positive decimal string without exponent, sign or separators",
            None,
        ));
    }
    fund_asset(config, "thrusd", token_account, amount, json_format).await
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
    let bytes = if let Ok(secret) = config.keys.get_key(account) {
        crate::crypto::keypair_from_hex(secret)?.public_key
    } else {
        crate::utils::validate_address_or_hex(account)?
    };
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
    if asset == "thrusd" {
        funding["token_account"] = json!(account);
    }
    output::print_output(json!({"faucet_fund":funding}), json_format);
    Ok(())
}
