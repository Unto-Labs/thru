//! Only isolated files and loopback mock servers are used; no user credentials.
#![cfg(unix)]
use super::*;
use crate::cli::{Cli, Commands, FaucetCommands, FaucetWithdrawCommands};
use clap::Parser;
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
    assert!(developers.logout(&store).await.unwrap());
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
    let error = developers.logout(&store).await.unwrap_err();
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
    assert_eq!(
        developers.login(&store, true, true).await.unwrap().id,
        "account-1"
    );
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
    let error = developers.login(&store, true, true).await.err().unwrap();
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
    assert!(developers.login(&store, true, true).await.is_err());
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
    let result = developers.login(&store, true, true).await;
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
    let error = developers.login(&store, true, true).await.err().unwrap();
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
    let credentials = developers.authorize(true, true).await.unwrap();
    assert_eq!(credentials.refresh_token, "new-refresh");
    let times = sequence.times.lock().unwrap();
    assert!(times[0].duration_since(started) >= Duration::from_millis(950));
    assert!(times[1].duration_since(times[0]) >= Duration::from_millis(950));
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
