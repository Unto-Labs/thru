//! Only isolated files and loopback mock servers are used; no user credentials.
#![cfg(unix)]
use super::*;
use crate::cli::{Cli, Commands, FaucetCommands, FaucetWithdrawCommands};
use clap::Parser;
use cli_key::fake::FakeKeychain;
use std::{
    collections::HashMap,
    fs,
    os::unix::fs::PermissionsExt,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
};
use tempfile::TempDir;
use wiremock::{
    Mock, MockServer, Request, Respond, ResponseTemplate,
    matchers::{header, method, path},
};

fn record(origin: &str, expires_at: u64) -> Credentials {
    Credentials {
        origin: origin.into(),
        access_token: "old-access".into(),
        refresh_token: "old-refresh".into(),
        expires_at,
    }
}
fn token_response() -> Value {
    json!({"token_type":"Bearer","access_token":"new-access","refresh_token":"new-refresh","expires_in":300,"expires_at":now()+300})
}
fn account_response() -> Value {
    json!({"id":"account-1","name":"CLI user","email":"should-not-be-exposed@example.test"})
}
/// Isolated provisioned-key store; `keychain` is a fake (never the OS keychain).
fn key_fixture(origin: &str, keychain: Option<Arc<FakeKeychain>>) -> (TempDir, KeyStore) {
    let directory = tempfile::tempdir().unwrap();
    let keychain = keychain.map(|keychain| keychain as Arc<dyn cli_key::Keychain>);
    let keys = KeyStore::new(directory.path().join("auth"), origin, keychain);
    (directory, keys)
}
/// Login with a throwaway key store, for tests that do not inspect the key.
async fn login(
    developers: &Developers,
    store: &Store,
) -> Result<(Account, KeyProvisioning), CliError> {
    let (_directory, keys) = key_fixture(&developers.origin(), None);
    developers
        .login(store, &keys, "test-machine", true, true)
        .await
}
fn fixture(origin: &str) -> (TempDir, Store) {
    let directory = tempfile::tempdir().unwrap();
    let store = Store::fixture(directory.path().join("auth"), origin);
    (directory, store)
}
// Keep an unserved socket reserved throughout each timeout fixture. Dropping a
// pooled Wiremock server would let another concurrent test inherit its URL.
fn unavailable_target() -> (std::net::TcpListener, Developers) {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    let mut developers = Developers::new(&origin).unwrap();
    developers.client = Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .timeout(Duration::from_millis(50))
        .build()
        .unwrap();
    (listener, developers)
}

fn code(error: &CliError) -> &str {
    match error {
        CliError::Developers { code, .. } => code,
        _ => "unexpected",
    }
}
fn forms(request: &Request) -> HashMap<String, String> {
    url::form_urlencoded::parse(&request.body)
        .into_owned()
        .collect()
}
async fn device(server: &MockServer, expires_in: u64, interval: u64) {
    Mock::given(method("POST"))
        .and(path("/api/auth/device/code"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "device_code":"private-device-code","user_code":"ABCD2345",
            "verification_uri":format!("{}/device",server.uri()),
            "verification_uri_complete":format!("{}/device?user_code=ABCD2345",server.uri()),
            "expires_in":expires_in,"interval":interval,
        })))
        .expect(1)
        .mount(server)
        .await;
}

#[derive(Clone)]
struct Sequence {
    templates: Arc<Vec<ResponseTemplate>>,
    count: Arc<AtomicUsize>,
    times: Arc<Mutex<Vec<std::time::Instant>>>,
}
impl Sequence {
    fn new(templates: Vec<ResponseTemplate>) -> Self {
        Self {
            templates: Arc::new(templates),
            count: Arc::new(AtomicUsize::new(0)),
            times: Arc::new(Mutex::new(Vec::new())),
        }
    }
}
impl Respond for Sequence {
    fn respond(&self, _: &Request) -> ResponseTemplate {
        self.times.lock().unwrap().push(std::time::Instant::now());
        self.templates[self
            .count
            .fetch_add(1, Ordering::SeqCst)
            .min(self.templates.len() - 1)]
        .clone()
    }
}

#[test]
fn parser_routes_thru_and_thrusd_withdrawals_separately() {
    let parsed = Cli::try_parse_from(["thru", "auth", "login", "--no-browser"]).unwrap();
    assert!(matches!(
        parsed.command,
        Commands::Auth {
            subcommand: AuthCommands::Login { no_browser: true }
        }
    ));
    for name in ["status", "logout"] {
        assert!(Cli::try_parse_from(["thru", "auth", name]).is_ok());
    }
    let parsed = Cli::try_parse_from([
        "thru",
        "--network",
        "betanet",
        "faucet",
        "withdraw",
        "thrusd",
        "ta-example",
        "0.000001",
    ])
    .unwrap();
    assert_eq!(parsed.network.as_deref(), Some("betanet"));
    assert!(matches!(parsed.command, Commands::Faucet {
        subcommand: FaucetCommands::Withdraw {
            subcommand: FaucetWithdrawCommands::Thrusd { account, amount }
        }
    } if account == "ta-example" && amount == "0.000001"));
    /* `native` is a hidden alias kept for scripts written against earlier releases. */
    for name in ["thru", "native"] {
        let parsed =
            Cli::try_parse_from(["thru", "faucet", "withdraw", name, "recipient", "42"]).unwrap();
        assert!(matches!(parsed.command, Commands::Faucet {
            subcommand: FaucetCommands::Withdraw {
                subcommand: FaucetWithdrawCommands::Thru { account, amount: 42 }
            }
        } if account == "recipient"));
    }
    let mut command = <Cli as clap::CommandFactory>::command();
    let help = command
        .find_subcommand_mut("faucet")
        .and_then(|faucet| faucet.find_subcommand_mut("withdraw"))
        .unwrap()
        .render_help()
        .to_string();
    assert!(help.contains("thru") && !help.contains("native"));
    assert!(Cli::try_parse_from(["thru", "faucet", "deposit", "existing-key", "42"]).is_ok());
    for args in [
        vec!["thru", "faucet", "withdraw", "thrusd", "ta-example"],
        vec!["thru", "faucet", "withdraw", "thru", "recipient", "0.001"],
        vec!["thru", "faucet", "withdraw", "recipient", "42"],
        vec![
            "thru",
            "faucet",
            "fund",
            "--token-account",
            "ta-example",
            "--amount",
            "1",
        ],
        vec![
            "thru",
            "faucet",
            "withdraw",
            "thrusd",
            "ta-example",
            "1",
            "--fee-payer",
            "signer",
        ],
    ] {
        assert!(Cli::try_parse_from(args).is_err());
    }
}

#[test]
fn origins_are_strict_and_credentials_cannot_select_a_custom_chain() {
    for origin in [
        "http://evil.test",
        "https://user:secret@dev.thru.org",
        "https://dev.thru.org/path",
        "https://dev.thru.org?q=1",
        "https://dev.thru.org/#x",
    ] {
        assert!(Developers::new(origin).is_err());
    }
    for origin in [
        "https://dev.thru.org",
        "http://127.0.0.1:3000",
        "http://localhost:3000",
        "http://[::1]:3000",
    ] {
        assert!(Developers::new(origin).is_ok());
    }
    let mut config = Config::default();
    assert_eq!(selected_network(&config).unwrap(), "alphanet");
    config.rpc_base_url = "https://rpc.betanet.thru.org:443".into();
    assert_eq!(selected_network(&config).unwrap(), "betanet");
    for url in [
        "http://127.0.0.1:8472",
        "https://rpc.alphanet.thru.org:8443",
        "https://custom.example",
        "https://rpc.betanet.thru.org/path",
    ] {
        config.rpc_base_url = url.into();
        assert!(selected_network(&config).is_err());
    }
}

#[tokio::test]
async fn storage_is_origin_isolated_atomic_owner_only_and_symlink_safe() {
    let (directory, store) = fixture("https://dev.thru.org");
    let _guard = store.lock().await.unwrap();
    store
        .save(&record("https://dev.thru.org", now() + 300))
        .await
        .unwrap();
    let path = fs::read_dir(directory.path().join("auth"))
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .find(|path| {
            path.extension()
                .is_some_and(|extension| extension == "json")
        })
        .unwrap();
    assert_eq!(
        fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    assert_eq!(
        fs::metadata(directory.path().join("auth"))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o700
    );
    let other = Store::fixture(
        directory.path().join("auth"),
        "https://dev.staging.web.5f1.net",
    );
    assert!(other.load().await.unwrap().is_none());
    fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
    assert!(store.load().await.is_err());
    fs::remove_file(&path).unwrap();
    let target = directory.path().join("untouched");
    fs::write(&target, "untouched").unwrap();
    std::os::unix::fs::symlink(&target, &path).unwrap();
    assert!(store.load().await.is_err());
    assert!(
        store
            .save(&record("https://dev.thru.org", now() + 300))
            .await
            .is_err()
    );
    assert_eq!(fs::read_to_string(target).unwrap(), "untouched");
}

#[tokio::test]
async fn refresh_rotates_under_lock_and_status_checks_the_remote_account() {
    let server = MockServer::start().await;
    let developers = Developers::new(&server.uri()).unwrap();
    let (_directory, store) = fixture(&developers.origin());
    store
        .save(&record(&developers.origin(), now() - 1))
        .await
        .unwrap();
    Mock::given(method("POST"))
        .and(path("/api/auth/oauth2/token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(token_response()))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/cli/account"))
        .and(header("authorization", "Bearer new-access"))
        .respond_with(ResponseTemplate::new(200).set_body_json(account_response()))
        .expect(1)
        .mount(&server)
        .await;
    let account = developers.status(&store).await.unwrap();
    assert_eq!(account.id, "account-1");
    assert!(
        serde_json::to_value(account)
            .unwrap()
            .get("email")
            .is_none()
    );
    assert_eq!(
        store.load().await.unwrap().unwrap().refresh_token,
        "new-refresh"
    );
    let requests = server.received_requests().await.unwrap();
    let payload = forms(
        requests
            .iter()
            .find(|request| request.url.path() == "/api/auth/oauth2/token")
            .unwrap(),
    );
    assert_eq!(payload["grant_type"], "refresh_token");
    assert_eq!(payload["refresh_token"], "old-refresh");
    assert_eq!(payload["resource"], developers.origin());
    assert!(!payload.contains_key("client_secret"));
}

#[tokio::test]
async fn concurrent_status_commands_do_not_replay_a_rotating_refresh_token() {
    let server = MockServer::start().await;
    let developers = Arc::new(Developers::new(&server.uri()).unwrap());
    let (_directory, store) = fixture(&developers.origin());
    store
        .save(&record(&developers.origin(), now() - 1))
        .await
        .unwrap();
    Mock::given(method("POST"))
        .and(path("/api/auth/oauth2/token"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(token_response())
                .set_delay(Duration::from_millis(100)),
        )
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/cli/account"))
        .and(header("authorization", "Bearer new-access"))
        .respond_with(ResponseTemplate::new(200).set_body_json(account_response()))
        .expect(2)
        .mount(&server)
        .await;
    let first = {
        let developers = developers.clone();
        let store = store.clone();
        tokio::spawn(async move { developers.status(&store).await })
    };
    let second = {
        let developers = developers.clone();
        let store = store.clone();
        tokio::spawn(async move { developers.status(&store).await })
    };
    first.await.unwrap().unwrap();
    second.await.unwrap().unwrap();
}

#[tokio::test]
async fn remote_expiry_triggers_one_idempotent_status_refresh() {
    let server = MockServer::start().await;
    let developers = Developers::new(&server.uri()).unwrap();
    let (_directory, store) = fixture(&developers.origin());
    store
        .save(&record(&developers.origin(), now() + 300))
        .await
        .unwrap();
    Mock::given(method("GET"))
        .and(path("/api/cli/account"))
        .and(header("authorization", "Bearer old-access"))
        .respond_with(ResponseTemplate::new(401).set_body_json(json!({"error":"invalid_token"})))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/api/auth/oauth2/token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(token_response()))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/api/cli/account"))
        .and(header("authorization", "Bearer new-access"))
        .respond_with(ResponseTemplate::new(200).set_body_json(account_response()))
        .expect(1)
        .mount(&server)
        .await;
    developers.status(&store).await.unwrap();
}

#[tokio::test]
async fn transient_refresh_preserves_credentials_but_invalid_grant_clears_them() {
    for status in [503, 400] {
        let server = MockServer::start().await;
        let developers = Developers::new(&server.uri()).unwrap();
        let (_directory, store) = fixture(&developers.origin());
        store
            .save(&record(&developers.origin(), now() - 1))
            .await
            .unwrap();
        Mock::given(method("POST"))
            .and(path("/api/auth/oauth2/token"))
            .respond_with(
                ResponseTemplate::new(status).set_body_json(json!({"error":"invalid_grant"})),
            )
            .expect(1)
            .mount(&server)
            .await;
        let _guard = store.lock().await.unwrap();
        assert!(developers.access(&store).await.is_err());
        assert_eq!(store.load().await.unwrap().is_none(), status == 400);
    }
}

#[tokio::test]
async fn successful_logout_revokes_refresh_and_clears_local_credentials() {
    let server = MockServer::start().await;
    let developers = Developers::new(&server.uri()).unwrap();
    let (_directory, store) = fixture(&developers.origin());
    store
        .save(&record(&developers.origin(), now() - 1))
        .await
        .unwrap();
    Mock::given(method("POST"))
        .and(path("/api/cli/logout"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"success":true})))
        .expect(1)
        .mount(&server)
        .await;
    let (_keys_directory, keys) = key_fixture(&developers.origin(), None);
    assert_eq!(
        developers.logout(&store, &keys).await.unwrap(),
        (true, KeyRevocation::None)
    );
    assert!(store.load().await.unwrap().is_none());
    assert_eq!(
        forms(&server.received_requests().await.unwrap()[0])["refresh_token"],
        "old-refresh"
    );
}

#[tokio::test]
async fn offline_logout_clears_local_credentials_and_reports_unconfirmed_revocation() {
    let (_listener, developers) = unavailable_target();
    let (_directory, store) = fixture(&developers.origin());
    store
        .save(&record(&developers.origin(), now() + 300))
        .await
        .unwrap();
    let (_keys_directory, keys) = key_fixture(&developers.origin(), None);
    let error = developers.logout(&store, &keys).await.unwrap_err();
    assert_eq!(code(&error), "REVOCATION_UNCONFIRMED");
    assert!(store.load().await.unwrap().is_none());
    assert!(!error.to_string().contains("old-refresh"));
}

async fn approved_login(server: &MockServer) {
    device(server, 20, 1).await;
    Mock::given(method("POST"))
        .and(path("/api/auth/oauth2/token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(token_response()))
        .expect(1)
        .mount(server)
        .await;
}

#[tokio::test]
async fn login_replaces_credentials_then_revokes_previous_installation() {
    let server = MockServer::start().await;
    let developers = Developers::new(&server.uri()).unwrap();
    let (directory, store) = fixture(&developers.origin());
    store
        .save(&record(&developers.origin(), now() + 300))
        .await
        .unwrap();
    approved_login(&server).await;
    Mock::given(method("GET"))
        .and(path("/api/cli/account"))
        .and(header("authorization", "Bearer new-access"))
        .respond_with(ResponseTemplate::new(200).set_body_json(account_response()))
        .expect(1)
        .mount(&server)
        .await;
    let root = directory.path().join("auth");
    Mock::given(method("POST"))
        .and(path("/api/cli/logout"))
        .respond_with(move |request: &Request| {
            assert_eq!(forms(request)["refresh_token"], "old-refresh");
            let saved = fs::read_dir(&root)
                .unwrap()
                .map(|entry| entry.unwrap().path())
                .find(|path| path.extension().is_some_and(|ext| ext == "json"))
                .unwrap();
            let credentials: Credentials =
                serde_json::from_slice(&fs::read(saved).unwrap()).unwrap();
            assert_eq!(credentials.refresh_token, "new-refresh");
            ResponseTemplate::new(200).set_body_json(json!({"success":true}))
        })
        .expect(1)
        .mount(&server)
        .await;
    assert_eq!(login(&developers, &store).await.unwrap().0.id, "account-1");
    assert_eq!(
        store.load().await.unwrap().unwrap().refresh_token,
        "new-refresh"
    );
}

#[tokio::test]
async fn denied_relogin_keeps_previous_credentials() {
    let server = MockServer::start().await;
    let developers = Developers::new(&server.uri()).unwrap();
    let (_directory, store) = fixture(&developers.origin());
    store
        .save(&record(&developers.origin(), now() + 300))
        .await
        .unwrap();
    device(&server, 20, 1).await;
    Mock::given(method("POST"))
        .and(path("/api/auth/oauth2/token"))
        .respond_with(ResponseTemplate::new(400).set_body_json(json!({"error":"access_denied"})))
        .expect(1)
        .mount(&server)
        .await;
    let error = login(&developers, &store).await.err().unwrap();
    assert_eq!(code(&error), "access_denied");
    assert_eq!(
        store.load().await.unwrap().unwrap().refresh_token,
        "old-refresh"
    );
    assert!(
        server
            .received_requests()
            .await
            .unwrap()
            .iter()
            .all(|r| r.url.path() != "/api/cli/logout")
    );
}

#[tokio::test]
async fn invalid_new_account_keeps_previous_login_and_revokes_new_grant() {
    let server = MockServer::start().await;
    let developers = Developers::new(&server.uri()).unwrap();
    let (_directory, store) = fixture(&developers.origin());
    store
        .save(&record(&developers.origin(), now() + 300))
        .await
        .unwrap();
    approved_login(&server).await;
    Mock::given(method("GET"))
        .and(path("/api/cli/account"))
        .respond_with(ResponseTemplate::new(401).set_body_json(json!({"error":"invalid_token"})))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/api/cli/logout"))
        .respond_with(|request: &Request| {
            assert_eq!(forms(request)["refresh_token"], "new-refresh");
            ResponseTemplate::new(200).set_body_json(json!({"success":true}))
        })
        .expect(1)
        .mount(&server)
        .await;
    assert!(login(&developers, &store).await.is_err());
    assert_eq!(
        store.load().await.unwrap().unwrap().refresh_token,
        "old-refresh"
    );
}

#[tokio::test]
async fn relogin_save_failure_keeps_previous_credentials_and_revokes_new_grant() {
    let server = MockServer::start().await;
    let developers = Developers::new(&server.uri()).unwrap();
    let (directory, store) = fixture(&developers.origin());
    store
        .save(&record(&developers.origin(), now() + 300))
        .await
        .unwrap();
    approved_login(&server).await;
    let root = directory.path().join("auth");
    let blocked_root = root.clone();
    Mock::given(method("GET"))
        .and(path("/api/cli/account"))
        .respond_with(move |_: &Request| {
            fs::set_permissions(&blocked_root, fs::Permissions::from_mode(0o500)).unwrap();
            ResponseTemplate::new(200).set_body_json(account_response())
        })
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/api/cli/logout"))
        .respond_with(|request: &Request| {
            assert_eq!(forms(request)["refresh_token"], "new-refresh");
            ResponseTemplate::new(200).set_body_json(json!({"success":true}))
        })
        .expect(1)
        .mount(&server)
        .await;
    let result = login(&developers, &store).await;
    fs::set_permissions(root, fs::Permissions::from_mode(0o700)).unwrap();
    let error = result.err().unwrap();
    assert_eq!(code(&error), "LOGIN_STORAGE_FAILED");
    assert!(error.to_string().contains("Previous login was preserved"));
    assert_eq!(
        store.load().await.unwrap().unwrap().refresh_token,
        "old-refresh"
    );
}

#[tokio::test]
async fn relogin_revocation_failure_keeps_new_login_and_reports_cleanup() {
    let server = MockServer::start().await;
    let developers = Developers::new(&server.uri()).unwrap();
    let (_directory, store) = fixture(&developers.origin());
    store
        .save(&record(&developers.origin(), now() + 300))
        .await
        .unwrap();
    approved_login(&server).await;
    Mock::given(method("GET"))
        .and(path("/api/cli/account"))
        .respond_with(ResponseTemplate::new(200).set_body_json(account_response()))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/api/cli/logout"))
        .respond_with(ResponseTemplate::new(503).set_body_json(json!({"error":"unavailable"})))
        .expect(1)
        .mount(&server)
        .await;
    let error = login(&developers, &store).await.err().unwrap();
    assert_eq!(code(&error), "REVOCATION_UNCONFIRMED");
    assert!(error.to_string().contains("New Developers login was saved"));
    assert_eq!(
        store.load().await.unwrap().unwrap().refresh_token,
        "new-refresh"
    );
}

#[tokio::test]
async fn device_polling_waits_for_pending_approval_and_uses_the_public_client() {
    let server = MockServer::start().await;
    let developers = Developers::new(&server.uri()).unwrap();
    device(&server, 20, 1).await;
    let sequence = Sequence::new(vec![
        ResponseTemplate::new(400).set_body_json(json!({"error":"authorization_pending"})),
        ResponseTemplate::new(200).set_body_json(token_response()),
    ]);
    Mock::given(method("POST"))
        .and(path("/api/auth/oauth2/token"))
        .respond_with(sequence.clone())
        .expect(2)
        .mount(&server)
        .await;
    let started = std::time::Instant::now();
    let (credentials, key_scope) = developers.authorize(true, true).await.unwrap();
    assert_eq!(credentials.refresh_token, "new-refresh");
    assert!(key_scope);
    {
        let times = sequence.times.lock().unwrap();
        assert!(times[0].duration_since(started) >= Duration::from_millis(950));
        assert!(times[1].duration_since(times[0]) >= Duration::from_millis(950));
    }
    let requests = server.received_requests().await.unwrap();
    let device_request = requests
        .iter()
        .find(|request| request.url.path() == "/api/auth/device/code")
        .unwrap();
    let token_request = requests
        .iter()
        .find(|request| request.url.path() == "/api/auth/oauth2/token")
        .unwrap();
    assert_eq!(forms(device_request)["scope"], SCOPE);
    assert_eq!(
        forms(token_request)["grant_type"],
        "urn:ietf:params:oauth:grant-type:device_code"
    );
    assert_eq!(forms(token_request)["client_id"], "thru-cli");
    assert!(!forms(token_request).contains_key("client_secret"));
}

#[tokio::test]
async fn device_slow_down_adds_five_seconds_without_fast_polling() {
    let server = MockServer::start().await;
    let developers = Developers::new(&server.uri()).unwrap();
    device(&server, 20, 1).await;
    let sequence = Sequence::new(vec![
        ResponseTemplate::new(400).set_body_json(json!({"error":"slow_down"})),
        ResponseTemplate::new(200).set_body_json(token_response()),
    ]);
    Mock::given(method("POST"))
        .and(path("/api/auth/oauth2/token"))
        .respond_with(sequence.clone())
        .expect(2)
        .mount(&server)
        .await;
    developers.authorize(true, true).await.unwrap();
    let times = sequence.times.lock().unwrap();
    assert!(times[1].duration_since(times[0]) >= Duration::from_millis(5950));
}

#[tokio::test]
async fn denied_and_expired_device_grants_stop_without_repolling() {
    for code_value in ["access_denied", "expired_token"] {
        let server = MockServer::start().await;
        let developers = Developers::new(&server.uri()).unwrap();
        device(&server, 20, 1).await;
        Mock::given(method("POST"))
            .and(path("/api/auth/oauth2/token"))
            .respond_with(ResponseTemplate::new(400).set_body_json(json!({"error":code_value})))
            .expect(1)
            .mount(&server)
            .await;
        assert_eq!(
            code(&developers.authorize(true, true).await.err().unwrap()),
            code_value
        );
    }
    let server = MockServer::start().await;
    let developers = Developers::new(&server.uri()).unwrap();
    device(&server, 1, 2).await;
    assert_eq!(
        code(&developers.authorize(true, true).await.err().unwrap()),
        "expired_token"
    );
    assert_eq!(server.received_requests().await.unwrap().len(), 1);
}

#[tokio::test]
async fn funding_is_one_attempt_and_preserves_decimal_and_rate_information() {
    let server = MockServer::start().await;
    let developers = Developers::new(&server.uri()).unwrap();
    Mock::given(method("POST")).and(path("/api/faucet/fund")).and(header("authorization","Bearer automation-key"))
        .respond_with(ResponseTemplate::new(429).insert_header("retry-after","17").set_body_json(json!({"error":{"code":"RATE_LIMITED","message":"must-not-echo-automation-key"}}))).expect(1).mount(&server).await;
    let error = submit_fund(
        &developers,
        "automation-key",
        "betanet",
        "ta-existing",
        "0.000001",
    )
    .await
    .unwrap_err();
    assert_eq!(code(&error), "RATE_LIMITED");
    assert!(matches!(
        error,
        CliError::Developers {
            retry_after: Some(17),
            status: Some(429),
            ..
        }
    ));
    assert!(!error.to_string().contains("automation-key"));
    let request = &server.received_requests().await.unwrap()[0];
    let body: Value = serde_json::from_slice(&request.body).unwrap();
    assert_eq!(
        body,
        json!({"network":"betanet","tokenAddress":"ta-existing","amount":"0.000001"})
    );
}

#[tokio::test]
async fn funding_configuration_failures_are_actionable_and_never_retried() {
    for (error_code, expected) in [
        ("UNCONFIGURED", "faucet is not configured"),
        ("FAUCET_AUTH_UNAVAILABLE", "invocation permissions"),
        ("AUTH_UNAVAILABLE", "could not verify authentication"),
        (
            "RATE_LIMIT_UNAVAILABLE",
            "could not check the account limit",
        ),
    ] {
        let server = MockServer::start().await;
        let developers = Developers::new(&server.uri()).unwrap();
        Mock::given(method("POST"))
            .and(path("/api/faucet/fund"))
            .respond_with(ResponseTemplate::new(503).set_body_json(json!({
                "success":false,"transactionSignature":null,
                "error":{"code":error_code,"message":"must-not-echo-private-details"}
            })))
            .expect(1)
            .mount(&server)
            .await;
        let error = submit_fund(&developers, "secret", "betanet", "ta-existing", "100")
            .await
            .unwrap_err();
        assert_eq!(code(&error), error_code);
        assert!(error.to_string().contains(expected));
        assert!(!error.to_string().contains("Funding result is unknown"));
        assert!(!error.to_string().contains("must-not-echo"));
        assert_eq!(server.received_requests().await.unwrap().len(), 1);
    }
}

#[tokio::test]
async fn funding_401_never_refreshes_or_retries_and_redirects_never_leak_bearer() {
    let receiver = MockServer::start().await;
    for status in [401, 307] {
        let server = MockServer::start().await;
        let developers = Developers::new(&server.uri()).unwrap();
        let response = if status == 307 {
            ResponseTemplate::new(307).insert_header("location", receiver.uri())
        } else {
            ResponseTemplate::new(401).set_body_json(json!({"error":{"code":"UNAUTHORIZED"}}))
        };
        Mock::given(method("POST"))
            .and(path("/api/faucet/fund"))
            .respond_with(response)
            .expect(1)
            .mount(&server)
            .await;
        assert!(
            submit_fund(&developers, "secret-access", "alphanet", "ta-existing", "1")
                .await
                .is_err()
        );
        assert_eq!(server.received_requests().await.unwrap().len(), 1);
    }
    assert!(receiver.received_requests().await.unwrap().is_empty());
}

#[tokio::test]
async fn transport_and_confirmation_errors_report_unknown_results_and_known_signature() {
    let server = MockServer::start().await;
    let developers = Developers::new(&server.uri()).unwrap();
    Mock::given(method("POST")).and(path("/api/faucet/fund"))
        .respond_with(ResponseTemplate::new(504).set_body_json(json!({"transactionSignature":"known-signature","error":{"code":"FUNDING_STATUS_UNKNOWN"}}))).expect(1).mount(&server).await;
    let error = submit_fund(&developers, "access", "alphanet", "ta-existing", "1")
        .await
        .unwrap_err();
    assert!(
        matches!(error,CliError::Developers{signature:Some(ref signature),..} if signature=="known-signature")
    );
    assert!(error.to_string().contains("Check your account balance"));
    let (_listener, developers) = unavailable_target();
    assert_eq!(
        code(
            &submit_fund(&developers, "access", "alphanet", "ta-existing", "1")
                .await
                .unwrap_err()
        ),
        "FUNDING_STATUS_UNKNOWN"
    );
}

#[tokio::test]
async fn funding_only_emits_confirmed_public_transaction_fields() {
    for (body, succeeds) in [
        (
            json!({"success":true,"transactionSignature":"tsPublicSignature", "access_token":"secret", "other":"private"}),
            true,
        ),
        (
            json!({"success":false,"transactionSignature":"tsPublicSignature"}),
            false,
        ),
        (json!({"success":true,"transactionSignature":null}), false),
        (
            json!({"success":true,"transactionSignature":"tssecret"}),
            false,
        ),
    ] {
        let server = MockServer::start().await;
        let developers = Developers::new(&server.uri()).unwrap();
        Mock::given(method("POST"))
            .and(path("/api/faucet/fund"))
            .respond_with(ResponseTemplate::new(200).set_body_json(body))
            .expect(1)
            .mount(&server)
            .await;
        let result = submit_fund(&developers, "secret", "alphanet", "ta-existing", "1").await;
        if succeeds {
            assert_eq!(
                result.unwrap(),
                json!({"success":true,"transactionSignature":"tsPublicSignature"})
            );
        } else {
            let error = result.unwrap_err();
            assert_eq!(code(&error), "FUNDING_STATUS_UNKNOWN");
            if let CliError::Developers {
                signature: Some(signature),
                ..
            } = error
            {
                assert_eq!(signature, "tsPublicSignature");
            }
        }
    }
}

#[test]
fn lock_child_process() {
    let Some(root) = std::env::var_os("THRU_TEST_AUTH_LOCK") else {
        return;
    };
    let runtime = tokio::runtime::Runtime::new().unwrap();
    runtime.block_on(async {
        let store = Store::fixture(std::path::PathBuf::from(&root), "https://dev.test");
        let _guard = store.lock().await.unwrap();
        fs::write(
            std::path::PathBuf::from(root).join("child-acquired"),
            "locked",
        )
        .unwrap();
    });
}

#[tokio::test]
async fn refresh_lock_serializes_other_cli_processes() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("auth");
    let store = Store::fixture(root.clone(), "https://dev.test");
    let guard = store.lock().await.unwrap();
    let mut child = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "commands::developers::tests::lock_child_process",
            "--nocapture",
        ])
        .env("THRU_TEST_AUTH_LOCK", &root)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .unwrap();
    tokio::time::sleep(Duration::from_millis(150)).await;
    assert!(!root.join("child-acquired").exists());
    drop(guard);
    for _ in 0..100 {
        if child.try_wait().unwrap().is_some() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(child.wait().unwrap().success());
    assert!(root.join("child-acquired").exists());
}

#[tokio::test]
async fn rotated_token_storage_failure_revokes_the_new_installation_and_reports_cleanup() {
    let server = MockServer::start().await;
    let developers = Developers::new(&server.uri()).unwrap();
    let (directory, store) = fixture(&developers.origin());
    let saved = record(&developers.origin(), now() - 1);
    store.save(&saved).await.unwrap();
    Mock::given(method("POST"))
        .and(path("/api/auth/oauth2/token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(token_response()))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/api/cli/logout"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"success":true})))
        .expect(1)
        .mount(&server)
        .await;
    let root = directory.path().join("auth");
    fs::set_permissions(&root, fs::Permissions::from_mode(0o500)).unwrap();
    let error = developers.refresh(&store, &saved).await.err().unwrap();
    fs::set_permissions(&root, fs::Permissions::from_mode(0o700)).unwrap();
    assert_eq!(code(&error), "REFRESH_STORAGE_FAILED");
    assert!(error.to_string().contains("revocation was confirmed"));
    assert!(error.to_string().contains("could not be cleared"));
    assert!(!error.to_string().contains("new-refresh"));
    assert_eq!(
        store.load().await.unwrap().unwrap().refresh_token,
        "old-refresh"
    );
    let requests = server.received_requests().await.unwrap();
    assert_eq!(
        forms(
            requests
                .iter()
                .find(|request| request.url.path() == "/api/cli/logout")
                .unwrap()
        )["refresh_token"],
        "new-refresh"
    );
}

#[tokio::test]
async fn thru_funding_uses_the_hosted_contract_without_replaying_unknown_results() {
    let server = MockServer::start().await;
    let developers = Developers::new(&server.uri()).unwrap();
    let payload = json!({"asset":"thru","network":"betanet","recipientAddress":"ta-existing","amount":"10000"});
    Mock::given(method("POST")).and(path("/api/faucet/fund"))
        .and(header("authorization", "Bearer automation-key"))
        .respond_with(ResponseTemplate::new(504).set_body_json(json!({"success":false,"transactionSignature":"ts_known","error":{"code":"CONFIRMATION_TIMEOUT"}})))
        .expect(1).mount(&server).await;
    let error = submit_funding(&developers, "automation-key", &payload)
        .await
        .unwrap_err();
    assert!(
        matches!(error, CliError::Developers { signature: Some(ref value), .. } if value == "ts_known")
    );
    let requests = server.received_requests().await.unwrap();
    assert_eq!(
        serde_json::from_slice::<Value>(&requests[0].body).unwrap(),
        payload
    );
}

#[test]
fn hosted_thru_has_no_local_fee_payer_flag() {
    assert!(
        Cli::try_parse_from([
            "thru",
            "faucet",
            "withdraw",
            "thru",
            "recipient",
            "42",
            "--fee-payer",
            "signer"
        ])
        .is_err()
    );
}

// ---- Provisioned per-machine RPC API key ----

const PLAINTEXT: &str = "thru_live_provisioned_plaintext_secret";

fn key_response(id: &str, plaintext: &str) -> Value {
    json!({
        "key": {
            "id": id,
            "name": "thru-cli: test-machine",
            "prefix": "thru_live_pro",
            "organizationId": "org-1",
            "organizationName": "Acme Labs",
        },
        "plaintext": plaintext,
    })
}
fn key_metadata(origin: &str, id: &str) -> KeyMetadata {
    KeyMetadata {
        origin: origin.into(),
        id: id.into(),
        name: "thru-cli: old".into(),
        prefix: "thru_live_old".into(),
        organization_id: "org-1".into(),
        organization_name: "Acme Labs".into(),
        location: SecretLocation::Keychain,
    }
}
fn files_with_extension(root: &std::path::Path, extension: &str) -> Vec<std::path::PathBuf> {
    match fs::read_dir(root) {
        Ok(entries) => entries
            .map(|entry| entry.unwrap().path())
            .filter(|path| path.extension().is_some_and(|ext| ext == extension))
            .collect(),
        Err(_) => Vec::new(),
    }
}
/// Every file under `root` (recursively) as lossy text.
fn all_file_contents(root: &std::path::Path) -> String {
    let mut text = String::new();
    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries {
            let path = entry.unwrap().path();
            if path.is_dir() {
                text.push_str(&all_file_contents(&path));
            } else {
                text.push_str(&String::from_utf8_lossy(&fs::read(path).unwrap()));
            }
        }
    }
    text
}
async fn mount_account(server: &MockServer) {
    Mock::given(method("GET"))
        .and(path("/api/cli/account"))
        .and(header("authorization", "Bearer new-access"))
        .respond_with(ResponseTemplate::new(200).set_body_json(account_response()))
        .expect(1)
        .mount(server)
        .await;
}
async fn mount_key_post(server: &MockServer, response: ResponseTemplate) {
    Mock::given(method("POST"))
        .and(path("/api/cli/keys"))
        .and(header("authorization", "Bearer new-access"))
        .and(wiremock::matchers::body_json(
            json!({"machine":"test-machine"}),
        ))
        .respond_with(response)
        .expect(1)
        .mount(server)
        .await;
}

#[test]
fn machine_names_are_printable_trimmed_and_bounded() {
    assert_eq!(sanitize_machine_name("  dev-box.local \n"), "dev-box.local");
    assert_eq!(sanitize_machine_name("evil\u{1b}[2Jbox\u{7}"), "evil[2Jbox");
    assert_eq!(sanitize_machine_name("caf\u{e9}-mac"), "caf-mac");
    assert_eq!(sanitize_machine_name(""), "thru-cli");
    assert_eq!(sanitize_machine_name("\t\n "), "thru-cli");
    let long = format!("{} tail", "a".repeat(47));
    let name = sanitize_machine_name(&long);
    assert_eq!(name, "a".repeat(47));
    assert!(sanitize_machine_name(&"x".repeat(200)).len() == MAX_MACHINE_NAME_LEN);
    assert!(!machine_name().is_empty() && machine_name().len() <= MAX_MACHINE_NAME_LEN);
}

#[tokio::test]
async fn login_requests_key_scope_and_stores_provisioned_key_in_keychain() {
    let server = MockServer::start().await;
    let developers = Developers::new(&server.uri()).unwrap();
    let (directory, store) = fixture(&developers.origin());
    let keychain = Arc::new(FakeKeychain::available());
    let (keys_directory, keys) = key_fixture(&developers.origin(), Some(keychain.clone()));
    approved_login(&server).await;
    mount_account(&server).await;
    mount_key_post(
        &server,
        ResponseTemplate::new(201).set_body_json(key_response("key-1", PLAINTEXT)),
    )
    .await;
    let (account, provisioning) = developers
        .login(&store, &keys, "test-machine", true, true)
        .await
        .unwrap();
    assert_eq!(account.id, "account-1");
    let KeyProvisioning::Provisioned(metadata, previous) = &provisioning else {
        panic!("expected a provisioned key");
    };
    assert_eq!(metadata.id, "key-1");
    assert_eq!(*previous, KeyRevocation::None);
    assert_eq!(provisioning.to_json()["previous_key"], "none");
    assert_eq!(metadata.organization_name, "Acme Labs");
    assert_eq!(metadata.location, SecretLocation::Keychain);
    // Output describes the key without the plaintext.
    let output = provisioning.to_json().to_string();
    assert!(output.contains("thru_live_pro") && output.contains("Acme Labs"));
    assert!(!output.contains(PLAINTEXT));

    let requests = server.received_requests().await.unwrap();
    let device = forms(
        requests
            .iter()
            .find(|request| request.url.path() == "/api/auth/device/code")
            .unwrap(),
    );
    assert_eq!(
        device["scope"],
        "profile offline_access faucet:fund keys:cli"
    );

    // Plaintext only in the (fake) keychain, under the Developers origin.
    assert_eq!(
        keychain
            .entries
            .lock()
            .unwrap()
            .get(&developers.origin())
            .map(String::as_str),
        Some(PLAINTEXT)
    );
    assert_eq!(keys.load_secret().unwrap().as_deref(), Some(PLAINTEXT));
    let root = keys_directory.path().join("auth");
    let metadata_files = files_with_extension(&root, "cli-key");
    assert_eq!(metadata_files.len(), 1);
    assert_eq!(
        fs::metadata(&metadata_files[0])
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
    assert!(files_with_extension(&root, "cli-key-secret").is_empty());
    assert!(!all_file_contents(keys_directory.path()).contains(PLAINTEXT));
    assert!(!all_file_contents(directory.path()).contains(PLAINTEXT));
}

#[tokio::test]
async fn login_falls_back_to_an_owner_only_file_without_a_keychain() {
    for keychain in [Some(Arc::new(FakeKeychain::default())), None] {
        let server = MockServer::start().await;
        let developers = Developers::new(&server.uri()).unwrap();
        let (_directory, store) = fixture(&developers.origin());
        let (keys_directory, keys) = key_fixture(&developers.origin(), keychain);
        approved_login(&server).await;
        mount_account(&server).await;
        mount_key_post(
            &server,
            ResponseTemplate::new(201).set_body_json(key_response("key-1", PLAINTEXT)),
        )
        .await;
        let (_, provisioning) = developers
            .login(&store, &keys, "test-machine", true, true)
            .await
            .unwrap();
        assert!(matches!(
            provisioning,
            KeyProvisioning::Provisioned(
                KeyMetadata {
                    location: SecretLocation::File,
                    ..
                },
                _
            )
        ));
        let root = keys_directory.path().join("auth");
        let secret = files_with_extension(&root, "cli-key-secret");
        assert_eq!(secret.len(), 1);
        assert_eq!(
            fs::metadata(&secret[0]).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(
            fs::metadata(&root).unwrap().permissions().mode() & 0o777,
            0o700
        );
        assert_eq!(keys.load_secret().unwrap().as_deref(), Some(PLAINTEXT));
        assert!(
            !fs::read_to_string(&files_with_extension(&root, "cli-key")[0])
                .unwrap()
                .contains(PLAINTEXT)
        );
    }
}

#[tokio::test]
async fn login_succeeds_without_a_key_when_the_platform_has_no_key_route() {
    let server = MockServer::start().await;
    let developers = Developers::new(&server.uri()).unwrap();
    let (_directory, store) = fixture(&developers.origin());
    let keychain = Arc::new(FakeKeychain::available());
    let (_keys_directory, keys) = key_fixture(&developers.origin(), Some(keychain.clone()));
    approved_login(&server).await;
    mount_account(&server).await;
    // Older platforms answer with a non-JSON 404.
    mount_key_post(
        &server,
        ResponseTemplate::new(404).set_body_string("<html>Not Found</html>"),
    )
    .await;
    let (account, provisioning) = developers
        .login(&store, &keys, "test-machine", true, true)
        .await
        .unwrap();
    assert_eq!(account.id, "account-1");
    assert!(matches!(provisioning, KeyProvisioning::Unavailable));
    assert_eq!(provisioning.to_json()["status"], "unavailable");
    assert_eq!(
        store.load().await.unwrap().unwrap().refresh_token,
        "new-refresh"
    );
    assert!(keys.load_metadata().unwrap().is_none());
    assert!(keychain.entries.lock().unwrap().is_empty());
}

#[tokio::test]
async fn login_succeeds_with_a_warning_when_key_provisioning_fails() {
    for (status, body, reason) in [
        (
            500,
            json!({"error":{"code":"INTERNAL","message":"boom"}}),
            "INTERNAL, HTTP 500",
        ),
        (
            403,
            json!({"error":{"code":"SCOPE_REQUIRED","message":"scope"}}),
            "keys:cli scope",
        ),
        (
            401,
            json!({"error":{"code":"AUTH_REQUIRED","message":"auth"}}),
            "AUTH_REQUIRED, HTTP 401",
        ),
    ] {
        let server = MockServer::start().await;
        let developers = Developers::new(&server.uri()).unwrap();
        let (_directory, store) = fixture(&developers.origin());
        let keychain = Arc::new(FakeKeychain::available());
        let (_keys_directory, keys) = key_fixture(&developers.origin(), Some(keychain.clone()));
        approved_login(&server).await;
        mount_account(&server).await;
        mount_key_post(&server, ResponseTemplate::new(status).set_body_json(body)).await;
        let (_, provisioning) = developers
            .login(&store, &keys, "test-machine", true, true)
            .await
            .unwrap();
        let KeyProvisioning::Failed(message) = &provisioning else {
            panic!("expected a provisioning failure for HTTP {status}");
        };
        assert!(message.contains(reason), "{message}");
        assert_eq!(
            store.load().await.unwrap().unwrap().refresh_token,
            "new-refresh"
        );
        assert!(keys.load_metadata().unwrap().is_none());
        assert!(keychain.entries.lock().unwrap().is_empty());
    }
}

#[tokio::test]
async fn login_revokes_and_discards_an_invalid_key_response() {
    let server = MockServer::start().await;
    let developers = Developers::new(&server.uri()).unwrap();
    let (_directory, store) = fixture(&developers.origin());
    let keychain = Arc::new(FakeKeychain::available());
    let (_keys_directory, keys) = key_fixture(&developers.origin(), Some(keychain.clone()));
    approved_login(&server).await;
    mount_account(&server).await;
    mount_key_post(
        &server,
        ResponseTemplate::new(201).set_body_json(key_response("key-1", "Bearer not\nakey")),
    )
    .await;
    Mock::given(method("DELETE"))
        .and(path("/api/cli/keys/key-1"))
        .and(header("authorization", "Bearer new-access"))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;
    let (_, provisioning) = developers
        .login(&store, &keys, "test-machine", true, true)
        .await
        .unwrap();
    assert!(matches!(provisioning, KeyProvisioning::Failed(ref m) if m.contains("was revoked")));
    assert!(keys.load_metadata().unwrap().is_none());
    assert!(keychain.entries.lock().unwrap().is_empty());
}

/// Re-login (previous installation and key `key-old` recorded) where the new
/// key comes back as `key-new`; `delete` answers the DELETE for `key-old`.
async fn relogin_replacing_key(
    server: &MockServer,
    developers: &Developers,
    previous_key: KeyMetadata,
    delete: ResponseTemplate,
) -> (TempDir, KeyStore, KeyProvisioning) {
    let (_directory, store) = fixture(&developers.origin());
    store
        .save(&record(&developers.origin(), now() + 300))
        .await
        .unwrap();
    let keychain = Arc::new(FakeKeychain::available());
    let (keys_directory, keys) = key_fixture(&developers.origin(), Some(keychain.clone()));
    keys.save(previous_key, "thru_live_old_plaintext").unwrap();
    approved_login(server).await;
    mount_account(server).await;
    mount_key_post(
        server,
        ResponseTemplate::new(201).set_body_json(key_response("key-new", PLAINTEXT)),
    )
    .await;
    let root = keys_directory.path().join("auth");
    Mock::given(method("DELETE"))
        .and(path("/api/cli/keys/key-old"))
        .and(header("authorization", "Bearer new-access"))
        .respond_with(move |_: &Request| {
            // The new key is already recorded locally when the old one is revoked.
            let recorded: KeyMetadata = serde_json::from_slice(
                &fs::read(&files_with_extension(&root, "cli-key")[0]).unwrap(),
            )
            .unwrap();
            assert_eq!(recorded.id, "key-new");
            delete.clone()
        })
        .expect(1)
        .mount(server)
        .await;
    Mock::given(method("POST"))
        .and(path("/api/cli/logout"))
        .respond_with(|request: &Request| {
            assert_eq!(forms(request)["refresh_token"], "old-refresh");
            ResponseTemplate::new(200).set_body_json(json!({"success":true}))
        })
        .expect(1)
        .mount(server)
        .await;
    let (_, provisioning) = developers
        .login(&store, &keys, "test-machine", true, true)
        .await
        .unwrap();
    // Whatever happened to the old key, the new key replaces the local record
    // and the previous installation is still logged out.
    assert_eq!(keys.load_metadata().unwrap().unwrap().id, "key-new");
    assert_eq!(keys.load_secret().unwrap().as_deref(), Some(PLAINTEXT));
    assert_eq!(
        store.load().await.unwrap().unwrap().refresh_token,
        "new-refresh"
    );
    (keys_directory, keys, provisioning)
}

#[tokio::test]
async fn relogin_with_a_changed_org_or_machine_revokes_the_previous_key() {
    let changed_machine = |origin: &str| key_metadata(origin, "key-old");
    let changed_org = |origin: &str| KeyMetadata {
        name: "thru-cli: test-machine".into(),
        organization_id: "org-2".into(),
        organization_name: "Previous Org".into(),
        ..key_metadata(origin, "key-old")
    };
    for previous_key in [changed_machine, changed_org] {
        let server = MockServer::start().await;
        let developers = Developers::new(&server.uri()).unwrap();
        let (_keys_directory, _keys, provisioning) = relogin_replacing_key(
            &server,
            &developers,
            previous_key(&developers.origin()),
            ResponseTemplate::new(204),
        )
        .await;
        assert!(matches!(
            &provisioning,
            KeyProvisioning::Provisioned(key, KeyRevocation::Revoked) if key.id == "key-new"
        ));
        assert_eq!(provisioning.to_json()["previous_key"], "revoked");
        // The old key is revoked with the new login, before the previous
        // installation is logged out.
        let requests: Vec<String> = server
            .received_requests()
            .await
            .unwrap()
            .iter()
            .map(|request| format!("{} {}", request.method, request.url.path()))
            .collect();
        assert_eq!(
            requests,
            [
                "POST /api/auth/device/code",
                "POST /api/auth/oauth2/token",
                "GET /api/cli/account",
                "POST /api/cli/keys",
                "DELETE /api/cli/keys/key-old",
                "POST /api/cli/logout",
            ]
        );
    }
}

#[tokio::test]
async fn relogin_warns_when_the_previous_key_is_not_found_and_continues() {
    let server = MockServer::start().await;
    let developers = Developers::new(&server.uri()).unwrap();
    // Another account's key: the server cannot see it, so it is still live.
    let (_keys_directory, _keys, provisioning) = relogin_replacing_key(
        &server,
        &developers,
        key_metadata(&developers.origin(), "key-old"),
        ResponseTemplate::new(404).set_body_json(
            json!({"error":{"code":"KEY_NOT_FOUND","message":"This key is not available."}}),
        ),
    )
    .await;
    assert!(matches!(
        provisioning,
        KeyProvisioning::Provisioned(_, KeyRevocation::Unconfirmed)
    ));
    assert_eq!(provisioning.to_json()["previous_key"], "unconfirmed");
}

#[tokio::test]
async fn relogin_warns_when_revoking_the_previous_key_fails_on_the_network() {
    let server = MockServer::start().await;
    let mut developers = Developers::new(&server.uri()).unwrap();
    developers.client = Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .timeout(Duration::from_millis(500))
        .build()
        .unwrap();
    let (_keys_directory, _keys, provisioning) = relogin_replacing_key(
        &server,
        &developers,
        key_metadata(&developers.origin(), "key-old"),
        ResponseTemplate::new(204).set_delay(Duration::from_secs(5)),
    )
    .await;
    assert!(matches!(
        provisioning,
        KeyProvisioning::Provisioned(_, KeyRevocation::Unconfirmed)
    ));
}

#[tokio::test]
async fn relogin_that_gets_the_same_key_back_sends_no_delete() {
    let server = MockServer::start().await;
    let developers = Developers::new(&server.uri()).unwrap();
    let (_directory, store) = fixture(&developers.origin());
    let keychain = Arc::new(FakeKeychain::available());
    let (_keys_directory, keys) = key_fixture(&developers.origin(), Some(keychain.clone()));
    keys.save(
        key_metadata(&developers.origin(), "key-1"),
        "thru_live_old_plaintext",
    )
    .unwrap();
    approved_login(&server).await;
    mount_account(&server).await;
    mount_key_post(
        &server,
        ResponseTemplate::new(201).set_body_json(key_response("key-1", PLAINTEXT)),
    )
    .await;
    let (_, provisioning) = developers
        .login(&store, &keys, "test-machine", true, true)
        .await
        .unwrap();
    assert!(matches!(
        provisioning,
        KeyProvisioning::Provisioned(_, KeyRevocation::None)
    ));
    assert_eq!(keys.load_secret().unwrap().as_deref(), Some(PLAINTEXT));
    assert!(
        server
            .received_requests()
            .await
            .unwrap()
            .iter()
            .all(|request| request.method.as_str() != "DELETE")
    );
}

#[test]
fn unrevoked_key_warning_names_the_key_and_where_to_revoke_it() {
    let key = key_metadata("https://dev.thru.org", "key-old");
    let warning = unrevoked_key_warning(
        &key,
        &failure("KEY_NOT_FOUND", "This key is not available.", Some(404)),
    );
    assert!(warning.contains("thru_live_old..."), "{warning}");
    assert!(warning.contains("\"Acme Labs\""), "{warning}");
    assert!(warning.contains("KEY_NOT_FOUND, HTTP 404"), "{warning}");
    assert!(warning.contains("Organization settings"), "{warning}");
    let offline = unrevoked_key_warning(&key, &Developers::network_error(false));
    assert!(
        offline.contains("could not contact Thru Developers"),
        "{offline}"
    );
}

#[tokio::test]
async fn login_retries_with_legacy_scopes_when_the_platform_predates_keys_cli() {
    let server = MockServer::start().await;
    let developers = Developers::new(&server.uri()).unwrap();
    let (_directory, store) = fixture(&developers.origin());
    let keychain = Arc::new(FakeKeychain::available());
    let (_keys_directory, keys) = key_fixture(&developers.origin(), Some(keychain.clone()));
    let uri = server.uri();
    // An older platform accepts exactly the legacy scope set and answers
    // anything else with the hook's 400 invalid_request.
    Mock::given(method("POST"))
        .and(path("/api/auth/device/code"))
        .respond_with(move |request: &Request| {
            if forms(request)["scope"] == "profile offline_access faucet:fund" {
                ResponseTemplate::new(200).set_body_json(json!({
                    "device_code":"private-device-code","user_code":"ABCD2345",
                    "verification_uri":format!("{uri}/device"),
                    "expires_in":20,"interval":1,
                }))
            } else {
                ResponseTemplate::new(400).set_body_json(json!({
                    "error":"invalid_request",
                    "error_description":"Invalid CLI authorization request",
                }))
            }
        })
        .expect(2)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/api/auth/oauth2/token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(token_response()))
        .expect(1)
        .mount(&server)
        .await;
    mount_account(&server).await;
    Mock::given(method("POST"))
        .and(path("/api/cli/keys"))
        .respond_with(ResponseTemplate::new(500))
        .expect(0)
        .mount(&server)
        .await;
    let (account, provisioning) = developers
        .login(&store, &keys, "test-machine", true, true)
        .await
        .unwrap();
    assert_eq!(account.id, "account-1");
    assert!(matches!(provisioning, KeyProvisioning::Unavailable));
    assert_eq!(
        store.load().await.unwrap().unwrap().refresh_token,
        "new-refresh"
    );
    let scopes: Vec<String> = server
        .received_requests()
        .await
        .unwrap()
        .iter()
        .filter(|request| request.url.path() == "/api/auth/device/code")
        .map(|request| forms(request)["scope"].clone())
        .collect();
    assert_eq!(
        scopes,
        [
            "profile offline_access faucet:fund keys:cli",
            "profile offline_access faucet:fund",
        ]
    );
    assert!(keys.load_metadata().unwrap().is_none());
    assert!(keychain.entries.lock().unwrap().is_empty());
}

#[tokio::test]
async fn login_retries_legacy_scopes_once_and_reports_other_rejections() {
    for (status, body, retried) in [
        (400, json!({"error":"invalid_scope"}), true),
        (400, json!({"error":"invalid_request"}), true),
        (403, json!({"error":"invalid_request"}), false),
        (400, json!({"error":"unauthorized_client"}), false),
    ] {
        let server = MockServer::start().await;
        let developers = Developers::new(&server.uri()).unwrap();
        let (_directory, store) = fixture(&developers.origin());
        Mock::given(method("POST"))
            .and(path("/api/auth/device/code"))
            .respond_with(ResponseTemplate::new(status).set_body_json(body.clone()))
            .expect(if retried { 2 } else { 1 })
            .mount(&server)
            .await;
        let error = login(&developers, &store).await.err().unwrap();
        assert_eq!(code(&error), body["error"].as_str().unwrap());
        assert!(store.load().await.unwrap().is_none());
    }
}

#[tokio::test]
async fn logout_deletes_the_key_then_clears_it_then_revokes_the_installation() {
    let server = MockServer::start().await;
    let developers = Developers::new(&server.uri()).unwrap();
    let (_directory, store) = fixture(&developers.origin());
    store
        .save(&record(&developers.origin(), now() + 300))
        .await
        .unwrap();
    let keychain = Arc::new(FakeKeychain::available());
    let (keys_directory, keys) = key_fixture(&developers.origin(), Some(keychain.clone()));
    keys.save(key_metadata(&developers.origin(), "key-1"), PLAINTEXT)
        .unwrap();
    let root = keys_directory.path().join("auth");
    let (delete_root, delete_keychain) = (root.clone(), keychain.clone());
    Mock::given(method("DELETE"))
        .and(path("/api/cli/keys/key-1"))
        .and(header("authorization", "Bearer old-access"))
        .respond_with(move |_: &Request| {
            // DELETE happens before the local copy is removed.
            assert_eq!(files_with_extension(&delete_root, "cli-key").len(), 1);
            assert!(!delete_keychain.entries.lock().unwrap().is_empty());
            ResponseTemplate::new(204)
        })
        .expect(1)
        .mount(&server)
        .await;
    let (logout_root, logout_keychain) = (root.clone(), keychain.clone());
    Mock::given(method("POST"))
        .and(path("/api/cli/logout"))
        .respond_with(move |request: &Request| {
            // The key is cleared locally before the token is revoked.
            assert!(files_with_extension(&logout_root, "cli-key").is_empty());
            assert!(logout_keychain.entries.lock().unwrap().is_empty());
            assert_eq!(forms(request)["refresh_token"], "old-refresh");
            ResponseTemplate::new(200).set_body_json(json!({"success":true}))
        })
        .expect(1)
        .mount(&server)
        .await;
    assert_eq!(
        developers.logout(&store, &keys).await.unwrap(),
        (true, KeyRevocation::Revoked)
    );
    assert!(store.load().await.unwrap().is_none());
    assert!(keys.load_metadata().unwrap().is_none());
    assert!(keychain.entries.lock().unwrap().is_empty());
    let paths: Vec<String> = server
        .received_requests()
        .await
        .unwrap()
        .iter()
        .map(|request| request.url.path().to_owned())
        .collect();
    assert_eq!(paths, ["/api/cli/keys/key-1", "/api/cli/logout"]);
}

#[tokio::test]
async fn logout_reports_a_key_the_server_cannot_find_as_unconfirmed() {
    let server = MockServer::start().await;
    let developers = Developers::new(&server.uri()).unwrap();
    let (_directory, store) = fixture(&developers.origin());
    store
        .save(&record(&developers.origin(), now() + 300))
        .await
        .unwrap();
    let (keys_directory, keys) = key_fixture(&developers.origin(), None);
    keys.save(key_metadata(&developers.origin(), "key-1"), PLAINTEXT)
        .unwrap();
    Mock::given(method("DELETE"))
        .and(path("/api/cli/keys/key-1"))
        .respond_with(ResponseTemplate::new(404).set_body_json(
            json!({"error":{"code":"KEY_NOT_FOUND","message":"This key is not available."}}),
        ))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/api/cli/logout"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"success":true})))
        .expect(1)
        .mount(&server)
        .await;
    // The server answers 204 for this account's revoked keys; 404 means the
    // key is not this account's and may still be live, so it is not claimed
    // as revoked. The local copy is still discarded.
    assert_eq!(
        developers.logout(&store, &keys).await.unwrap(),
        (true, KeyRevocation::Unconfirmed)
    );
    assert!(keys.load_metadata().unwrap().is_none());
    assert!(all_file_contents(keys_directory.path()).is_empty());
}

#[tokio::test]
async fn offline_logout_still_clears_the_local_key() {
    let (_listener, developers) = unavailable_target();
    let (_directory, store) = fixture(&developers.origin());
    store
        .save(&record(&developers.origin(), now() + 300))
        .await
        .unwrap();
    let keychain = Arc::new(FakeKeychain::available());
    let (_keys_directory, keys) = key_fixture(&developers.origin(), Some(keychain.clone()));
    keys.save(key_metadata(&developers.origin(), "key-1"), PLAINTEXT)
        .unwrap();
    let error = developers.logout(&store, &keys).await.unwrap_err();
    assert_eq!(code(&error), "REVOCATION_UNCONFIRMED");
    assert!(keys.load_metadata().unwrap().is_none());
    assert!(keychain.entries.lock().unwrap().is_empty());
    assert!(store.load().await.unwrap().is_none());
    assert!(!error.to_string().contains(PLAINTEXT));
}

#[tokio::test]
async fn logout_retries_key_deletion_once_after_refreshing_a_rejected_token() {
    let server = MockServer::start().await;
    let developers = Developers::new(&server.uri()).unwrap();
    let (_directory, store) = fixture(&developers.origin());
    store
        .save(&record(&developers.origin(), now() + 300))
        .await
        .unwrap();
    let (_keys_directory, keys) = key_fixture(&developers.origin(), None);
    keys.save(key_metadata(&developers.origin(), "key-1"), PLAINTEXT)
        .unwrap();
    Mock::given(method("DELETE"))
        .and(path("/api/cli/keys/key-1"))
        .and(header("authorization", "Bearer old-access"))
        .respond_with(ResponseTemplate::new(401).set_body_json(json!({"error":"invalid_token"})))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/api/auth/oauth2/token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(token_response()))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("DELETE"))
        .and(path("/api/cli/keys/key-1"))
        .and(header("authorization", "Bearer new-access"))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/api/cli/logout"))
        .respond_with(|request: &Request| {
            assert_eq!(forms(request)["refresh_token"], "new-refresh");
            ResponseTemplate::new(200).set_body_json(json!({"success":true}))
        })
        .expect(1)
        .mount(&server)
        .await;
    assert_eq!(
        developers.logout(&store, &keys).await.unwrap(),
        (true, KeyRevocation::Revoked)
    );
}

#[test]
fn key_store_is_origin_isolated_validated_and_symlink_safe() {
    let keychain = Arc::new(FakeKeychain::available());
    let (directory, keys) = key_fixture("https://dev.thru.org", Some(keychain.clone()));
    let root = directory.path().join("auth");
    // Nothing recorded and no directory created by reads.
    assert!(keys.load_metadata().unwrap().is_none());
    assert!(keys.load_secret().unwrap().is_none());
    assert!(!root.exists());
    // Invalid keys or metadata are refused.
    assert!(
        keys.save(
            key_metadata("https://dev.thru.org", "key-1"),
            "not-a-thru-key"
        )
        .is_err()
    );
    assert!(
        keys.save(key_metadata("https://dev.thru.org", "../key"), PLAINTEXT)
            .is_err()
    );
    let mut hostile = key_metadata("https://dev.thru.org", "key-1");
    hostile.organization_name = "Acme\u{1b}[2J".into();
    assert!(keys.save(hostile, PLAINTEXT).is_err());
    assert!(keychain.entries.lock().unwrap().is_empty());

    let saved = keys
        .save(key_metadata("https://other.example", "key-1"), PLAINTEXT)
        .unwrap();
    assert_eq!(saved.origin, "https://dev.thru.org");
    let other = KeyStore::new(
        root.clone(),
        "https://dev.staging.example",
        Some(keychain.clone()),
    );
    assert!(other.load_metadata().unwrap().is_none());
    assert!(other.load_secret().unwrap().is_none());

    // Loose permissions and symlinks are refused.
    let metadata = files_with_extension(&root, "cli-key").remove(0);
    fs::set_permissions(&metadata, fs::Permissions::from_mode(0o644)).unwrap();
    assert!(keys.load_metadata().is_err());
    fs::remove_file(&metadata).unwrap();
    let target = directory.path().join("untouched");
    fs::write(&target, "untouched").unwrap();
    std::os::unix::fs::symlink(&target, &metadata).unwrap();
    assert!(keys.load_metadata().is_err());
    assert!(
        keys.save(key_metadata("https://dev.thru.org", "key-2"), PLAINTEXT)
            .is_err()
    );
    assert_eq!(fs::read_to_string(&target).unwrap(), "untouched");
    fs::remove_file(&metadata).unwrap();

    // A secret recorded in the keychain is not silently read from a file.
    keys.save(key_metadata("https://dev.thru.org", "key-3"), PLAINTEXT)
        .unwrap();
    keychain.entries.lock().unwrap().clear();
    assert!(keys.load_secret().is_err());
    keys.clear().unwrap();
    assert!(keys.load_metadata().unwrap().is_none());
}

#[test]
fn key_store_clear_removes_the_secret_wherever_it_is() {
    // Keychain-backed.
    let keychain = Arc::new(FakeKeychain::available());
    let (directory, keys) = key_fixture("https://dev.thru.org", Some(keychain.clone()));
    keys.save(key_metadata("https://dev.thru.org", "key-1"), PLAINTEXT)
        .unwrap();
    keys.clear().unwrap();
    assert!(keychain.entries.lock().unwrap().is_empty());
    assert!(all_file_contents(directory.path()).is_empty());
    // File-backed; clearing never needs the (unavailable) keychain.
    let (directory, keys) = key_fixture(
        "https://dev.thru.org",
        Some(Arc::new(FakeKeychain::default())),
    );
    keys.save(key_metadata("https://dev.thru.org", "key-1"), PLAINTEXT)
        .unwrap();
    assert!(all_file_contents(directory.path()).contains(PLAINTEXT));
    keys.clear().unwrap();
    assert!(all_file_contents(directory.path()).is_empty());
    // Clearing when nothing is stored is a no-op.
    keys.clear().unwrap();
}

#[test]
fn plain_metadata_writes_replace_atomically_and_refuse_symlinks() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path();
    let path = root.join("origin.cli-key");
    storage::write_plain(root, &path, b"first").unwrap();
    storage::write_plain(root, &path, b"second").unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), "second");
    let target = root.join("untouched");
    fs::write(&target, "untouched").unwrap();
    let link = root.join("link.cli-key");
    std::os::unix::fs::symlink(&target, &link).unwrap();
    assert!(storage::write_plain(root, &link, b"hostile").is_err());
    assert_eq!(fs::read_to_string(&target).unwrap(), "untouched");
    // No temporary files are left behind.
    assert_eq!(fs::read_dir(root).unwrap().count(), 3);
}

#[tokio::test]
async fn relogin_without_a_new_key_clears_the_revoked_previous_key() {
    let server = MockServer::start().await;
    let developers = Developers::new(&server.uri()).unwrap();
    let (_directory, store) = fixture(&developers.origin());
    store
        .save(&record(&developers.origin(), now() + 300))
        .await
        .unwrap();
    let keychain = Arc::new(FakeKeychain::available());
    let (_keys_directory, keys) = key_fixture(&developers.origin(), Some(keychain.clone()));
    keys.save(
        key_metadata(&developers.origin(), "key-old"),
        "thru_live_old_plaintext",
    )
    .unwrap();
    approved_login(&server).await;
    mount_account(&server).await;
    mount_key_post(&server, ResponseTemplate::new(500)).await;
    Mock::given(method("POST"))
        .and(path("/api/cli/logout"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "success": true })))
        .expect(1)
        .mount(&server)
        .await;
    let (_, provisioning) = developers
        .login(&store, &keys, "test-machine", true, true)
        .await
        .unwrap();
    assert!(matches!(provisioning, KeyProvisioning::Failed(_)));
    // Logging out the previous installation revoked its key on the server, so
    // the stale local record is gone and RPC calls go unkeyed.
    assert!(keys.load_metadata().unwrap().is_none());
    assert!(keys.load_secret().unwrap().is_none());
}
