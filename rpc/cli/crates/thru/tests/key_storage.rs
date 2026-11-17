//! Exercise real CLI processes and signatures; RPC only supplies account/chain metadata.
#![cfg(unix)]

use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::Value;
use std::convert::Infallible;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::process::{Output, Stdio};
use std::task::{Context, Poll};
use std::time::Duration;
use thru_base::tn_tools::Pubkey;
use thru_client::proto::{common::v1 as common, core::v1 as core, services::v1 as services};
use tokio::io::AsyncWriteExt;
use tonic::{
    Request, Response, Status,
    body::Body,
    codegen::{BoxFuture, Service, http},
};

#[derive(Clone)]
struct Query;

impl tonic::server::NamedService for Query {
    const NAME: &'static str = "thru.services.v1.QueryService";
}

impl Service<http::Request<Body>> for Query {
    type Response = http::Response<Body>;
    type Error = Infallible;
    type Future = BoxFuture<Self::Response, Self::Error>;

    fn poll_ready(&mut self, _: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        Poll::Ready(Ok(()))
    }

    fn call(&mut self, request: http::Request<Body>) -> Self::Future {
        Box::pin(async move {
            let mut grpc = tonic::server::Grpc::new(tonic_prost::ProstCodec::default());
            match request.uri().path() {
                "/thru.services.v1.QueryService/GetAccount" => {
                    struct Account;
                    impl tonic::server::UnaryService<services::GetAccountRequest> for Account {
                        type Response = core::Account;
                        type Future = BoxFuture<Response<Self::Response>, Status>;
                        fn call(
                            &mut self,
                            request: Request<services::GetAccountRequest>,
                        ) -> Self::Future {
                            Box::pin(async move {
                                Ok(Response::new(core::Account {
                                    address: request.into_inner().address,
                                    meta: Some(core::AccountMeta {
                                        owner: Some(common::Pubkey { value: vec![0; 32] }),
                                        nonce: 7,
                                        ..Default::default()
                                    }),
                                    ..Default::default()
                                }))
                            })
                        }
                    }
                    Ok(grpc.unary(Account, request).await)
                }
                "/thru.services.v1.QueryService/GetHeight" => {
                    struct Height;
                    impl tonic::server::UnaryService<services::GetHeightRequest> for Height {
                        type Response = services::GetHeightResponse;
                        type Future = BoxFuture<Response<Self::Response>, Status>;
                        fn call(&mut self, _: Request<services::GetHeightRequest>) -> Self::Future {
                            Box::pin(async {
                                Ok(Response::new(services::GetHeightResponse {
                                    finalized: 20,
                                    locally_executed: 20,
                                    cluster_executed: 20,
                                }))
                            })
                        }
                    }
                    let mut grpc = tonic::server::Grpc::new(tonic_prost::ProstCodec::default());
                    Ok(grpc.unary(Height, request).await)
                }
                "/thru.services.v1.QueryService/GetChainInfo" => {
                    struct ChainInfo;
                    impl tonic::server::UnaryService<services::GetChainInfoRequest> for ChainInfo {
                        type Response = services::GetChainInfoResponse;
                        type Future = BoxFuture<Response<Self::Response>, Status>;
                        fn call(
                            &mut self,
                            _: Request<services::GetChainInfoRequest>,
                        ) -> Self::Future {
                            Box::pin(async {
                                Ok(Response::new(services::GetChainInfoResponse {
                                    chain_id: 42,
                                    ..Default::default()
                                }))
                            })
                        }
                    }
                    let mut grpc = tonic::server::Grpc::new(tonic_prost::ProstCodec::default());
                    Ok(grpc.unary(ChainInfo, request).await)
                }
                _ => Ok(http::Response::builder()
                    .status(200)
                    .header("grpc-status", "12")
                    .header("content-type", "application/grpc")
                    .body(Body::empty())
                    .unwrap()),
            }
        })
    }
}

async fn rpc() -> (String, tokio::sync::oneshot::Sender<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let (shutdown, done) = tokio::sync::oneshot::channel();
    tokio::spawn(async move {
        tonic::transport::Server::builder()
            .add_service(Query)
            .serve_with_incoming_shutdown(
                tokio_stream::wrappers::TcpListenerStream::new(listener),
                async {
                    let _ = done.await;
                },
            )
            .await
            .unwrap();
    });
    (url, shutdown)
}

fn cli_command(home: &Path, url: &str, args: &[&str]) -> tokio::process::Command {
    let mut command = tokio::process::Command::new(env!("CARGO_BIN_EXE_thru"));
    command
        .args(["--json", "--quiet", "--url", url])
        .args(args)
        .env("HOME", home)
        .env("THRU_DEVELOPERS_CREDENTIAL_STORE", "file")
        .env_remove("THRU_API_KEY")
        .env_remove("THRU_DEVELOPERS_API_KEY")
        .current_dir(home)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    command
}

async fn cli(home: &Path, url: &str, args: &[&str], input: Option<&str>) -> Output {
    let mut child = cli_command(home, url, args)
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .spawn()
        .unwrap();
    if let Some(input) = input {
        let mut stdin = child.stdin.take().unwrap();
        stdin.write_all(input.as_bytes()).await.unwrap();
    }
    tokio::time::timeout(Duration::from_secs(120), child.wait_with_output())
        .await
        .expect("CLI timed out")
        .unwrap()
}

fn success(output: &Output) -> Value {
    assert!(
        output.status.success(),
        "CLI failed:\nstdout: {}\nstderr: {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}

fn assert_no_seed(output: &Output, seed: &str) {
    assert!(
        !String::from_utf8_lossy(&output.stdout).contains(seed),
        "secret in stdout"
    );
    assert!(
        !String::from_utf8_lossy(&output.stderr).contains(seed),
        "secret in stderr"
    );
}

fn verify_signed(output: &Output, expected_address: &str) -> Vec<u8> {
    let value = success(output);
    let wire = STANDARD
        .decode(
            value["transaction_sign"]["base64_transaction"]
                .as_str()
                .unwrap(),
        )
        .unwrap();
    let (body, signature) = wire.split_at(wire.len() - 64);
    let public_key = Pubkey::new(expected_address.into())
        .unwrap()
        .to_bytes()
        .unwrap();
    assert_eq!(&body[48..80], &public_key);
    thru_base::tn_signature::verify_transaction(body, signature.try_into().unwrap(), &public_key)
        .unwrap();
    wire
}

#[cfg(target_os = "macos")]
fn assert_tree_has_no_seed(root: &Path, seed: &[u8; 32]) {
    let encoded = hex::encode(seed);
    for entry in std::fs::read_dir(root).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            assert_tree_has_no_seed(&path, seed);
        } else {
            let bytes = std::fs::read(path).unwrap();
            assert!(
                !bytes.windows(seed.len()).any(|window| window == seed),
                "raw seed on disk"
            );
            assert!(
                !String::from_utf8_lossy(&bytes)
                    .to_lowercase()
                    .contains(&encoded),
                "hex seed on disk"
            );
        }
    }
}

#[tokio::test]
async fn file_references_sign_without_registration_and_aliases_check_public_metadata() {
    let home = tempfile::tempdir().unwrap();
    std::fs::set_permissions(home.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
    let (url, _shutdown) = rpc().await;
    let seed = hex::encode([5; 32]);
    let path = home.path().join("alice.key");
    std::fs::write(&path, &seed).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
    let address = thru_base::tn_tools::KeyPair::from_hex_private_key("expected", &seed)
        .unwrap()
        .address_string
        .to_string();
    let program = hex::encode([9; 32]);

    // No alias or default registration is needed to sign with a direct file.
    let direct = cli(
        home.path(),
        &url,
        &[
            "txn",
            "sign",
            &program,
            "0102",
            "--fee-payer",
            "./alice.key",
        ],
        None,
    )
    .await;
    let wire = verify_signed(&direct, &address);
    let config_path = home.path().join(".thru/cli/config.yaml");
    let before = std::fs::read(&config_path).unwrap();
    let explicit = cli(
        home.path(),
        &url,
        &[
            "txn",
            "sign",
            &program,
            "0102",
            "--fee-payer",
            "file:alice.key",
        ],
        None,
    )
    .await;
    assert_eq!(verify_signed(&explicit, &address), wire);
    assert_eq!(
        std::fs::read(&config_path).unwrap(),
        before,
        "signing rewrote config"
    );

    let added = cli(
        home.path(),
        &url,
        &["keys", "add", "Alice", "--file", path.to_str().unwrap()],
        None,
    )
    .await;
    assert_eq!(success(&added)["keys"]["public_key"], address);
    assert_no_seed(&added, &seed);
    let alias = cli(
        home.path(),
        &url,
        &["txn", "sign", &program, "0102", "--fee-payer", "ALICE"],
        None,
    )
    .await;
    assert_eq!(verify_signed(&alias, &address), wire);
    assert!(
        !std::fs::read_to_string(&config_path)
            .unwrap()
            .contains(&seed)
    );

    std::fs::write(&path, hex::encode([6; 32])).unwrap();
    let mismatched = cli(
        home.path(),
        &url,
        &["txn", "sign", &program, "0102", "--fee-payer", "alice"],
        None,
    )
    .await;
    assert!(
        !mismatched.status.success(),
        "alias signed with a replaced key"
    );
    std::fs::remove_file(&path).unwrap();
    let public = cli(home.path(), &url, &["keys", "get", "alice"], None).await;
    assert_eq!(success(&public)["keys"]["public_key"], address);
    success(&cli(home.path(), &url, &["getbalance", "alice"], None).await);
    let missing = cli(
        home.path(),
        &url,
        &[
            "txn",
            "sign",
            &program,
            "0102",
            "--fee-payer",
            "./alice.key",
        ],
        None,
    )
    .await;
    assert!(
        !missing.status.success(),
        "missing file fell back to another key"
    );
}

#[tokio::test]
async fn migration_precedes_config_loading_and_preserves_the_signing_identity() {
    let home = tempfile::tempdir().unwrap();
    let (url, _shutdown) = rpc().await;
    let seed = hex::encode([17; 32]);
    let config_dir = home.path().join(".thru/cli");
    std::fs::create_dir_all(&config_dir).unwrap();
    std::fs::set_permissions(&config_dir, std::fs::Permissions::from_mode(0o755)).unwrap();
    let path = config_dir.join("config.yaml");
    std::fs::write(
        &path,
        format!("rpc_base_url: {url}\nkeys:\n  default: '{seed}'\n  'acc:1': '{}'\n  'keychain:legacy': '{}'\n", hex::encode([18; 32]), hex::encode([19; 32])),
    )
    .unwrap();
    let old = std::fs::read(&path).unwrap();
    // Reading tolerates the inline entries and names them, never their seeds.
    let listed = cli(home.path(), &url, &["keys", "list"], None).await;
    assert_no_seed(&listed, &seed);
    assert_eq!(
        success(&listed)["keys"]["unmigrated"],
        serde_json::json!(["acc:1", "default", "keychain:legacy"])
    );
    assert_eq!(
        std::fs::read(&path).unwrap(),
        old,
        "normal load rewrote legacy secrets"
    );

    let migrated = cli(
        home.path(),
        &url,
        &["keys", "migrate", "--store", "file"],
        None,
    )
    .await;
    success(&migrated);
    assert_no_seed(&migrated, &seed);
    assert_eq!(
        std::fs::metadata(&config_dir).unwrap().permissions().mode() & 0o777,
        0o700,
        "migration did not secure the CLI-owned directory"
    );
    for (reference, private_key) in [("acc:1", [18; 32]), ("alias:keychain:legacy", [19; 32])] {
        let expected = thru_base::tn_tools::KeyPair::from_hex_private_key(
            "expected",
            &hex::encode(private_key),
        )
        .unwrap()
        .address_string
        .to_string();
        verify_signed(
            &cli(
                home.path(),
                &url,
                &[
                    "txn",
                    "sign",
                    &hex::encode([9; 32]),
                    "0102",
                    "--fee-payer",
                    reference,
                ],
                None,
            )
            .await,
            &expected,
        );
    }
    let entry = success(&cli(home.path(), &url, &["keys", "get", "default"], None).await);
    let address = thru_base::tn_tools::KeyPair::from_hex_private_key("expected", &seed)
        .unwrap()
        .address_string
        .to_string();
    assert_eq!(entry["keys"]["public_key"], address);
    let program = hex::encode([9; 32]);
    verify_signed(
        &cli(home.path(), &url, &["txn", "sign", &program, "0102"], None).await,
        &address,
    );
    let migrated_config = std::fs::read(&path).unwrap();
    assert!(!String::from_utf8_lossy(&migrated_config).contains(&seed));
    success(
        &cli(
            home.path(),
            &url,
            &["keys", "migrate", "--store", "file"],
            None,
        )
        .await,
    );
    assert_eq!(
        std::fs::read(&path).unwrap(),
        migrated_config,
        "repeated migration rewrote references"
    );
}

#[cfg(target_os = "macos")]
struct KeychainCleanup<'a>(&'a Path);

#[cfg(target_os = "macos")]
impl Drop for KeychainCleanup<'_> {
    fn drop(&mut self) {
        for alias in ["native", "imported"] {
            let _ = std::process::Command::new(env!("CARGO_BIN_EXE_thru"))
                .args(["--json", "--quiet", "keys", "rm", alias, "--delete-secret"])
                .env("HOME", self.0)
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .status();
        }
        let _ = std::process::Command::new("/usr/bin/security")
            .arg("delete-keychain")
            .arg(self.0.join("signing-test.keychain-db"))
            .env("HOME", self.0)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
}

#[cfg(target_os = "macos")]
#[tokio::test]
#[ignore = "explicit opt-in: creates and removes isolated macOS Keychain credentials"]
async fn macos_keychain_generation_import_and_cross_process_signing() {
    let home = tempfile::tempdir().unwrap();
    let _cleanup = KeychainCleanup(home.path());
    std::fs::set_permissions(home.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
    // Security.framework also uses HOME for its user-domain preferences.
    // Give this isolated home its own encrypted Keychain, never the user's.
    // The native setters do not persist preferences unless this directory exists.
    std::fs::create_dir_all(home.path().join("Library/Preferences")).unwrap();
    let keychain_path = home.path().join("signing-test.keychain-db");
    let keychain_path = keychain_path.to_str().unwrap();
    let setup: &[&[&str]] = &[
        &[
            "create-keychain",
            "-p",
            "disposable-test-container",
            keychain_path,
        ],
        &["default-keychain", "-d", "user", "-s", keychain_path],
        &["list-keychains", "-d", "user", "-s", keychain_path],
    ];
    for args in setup {
        let output = std::process::Command::new("/usr/bin/security")
            .args(*args)
            .env("HOME", home.path())
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "isolated Keychain setup failed: {}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    let (url, _shutdown) = rpc().await;
    let generated = cli(
        home.path(),
        &url,
        &["keys", "generate", "native", "--store", "keychain"],
        None,
    )
    .await;
    let generated = success(&generated);
    let reference = generated["keys"]["reference"].as_str().unwrap();
    let address = generated["keys"]["public_key"].as_str().unwrap();
    assert!(reference.starts_with("keychain:"));
    assert!(
        generated["keys"].get("value").is_none(),
        "generation exported a private key"
    );
    let program = hex::encode([9; 32]);
    let signed = cli(
        home.path(),
        &url,
        &["txn", "sign", &program, "0102", "--fee-payer", reference],
        None,
    )
    .await;
    let wire = verify_signed(&signed, address);
    let alias = cli(
        home.path(),
        &url,
        &["txn", "sign", &program, "0102", "--fee-payer", "native"],
        None,
    )
    .await;
    assert_eq!(verify_signed(&alias, address), wire);

    let seed_bytes = [23; 32];
    let seed = hex::encode(seed_bytes);
    let imported = cli(
        home.path(),
        &url,
        &["keys", "add", "imported", "--stdin", "--store", "keychain"],
        Some(&seed),
    )
    .await;
    assert_no_seed(&imported, &seed);
    let imported = success(&imported);
    let expected = thru_base::tn_tools::KeyPair::from_hex_private_key("expected", &seed)
        .unwrap()
        .address_string
        .to_string();
    assert_eq!(imported["keys"]["public_key"], expected);
    let imported_signature = cli(
        home.path(),
        &url,
        &[
            "txn",
            "sign",
            &program,
            "0102",
            "--fee-payer",
            imported["keys"]["reference"].as_str().unwrap(),
        ],
        None,
    )
    .await;
    verify_signed(&imported_signature, &expected);
    assert_no_seed(&imported_signature, &seed);
    assert_tree_has_no_seed(home.path(), &seed_bytes);

    // An item created before address comments existed (no comment) gets one
    // from `keys migrate`; items that already have a comment are left alone.
    let legacy_id = "legacy-comment-test";
    let legacy_address =
        thru_base::tn_tools::KeyPair::from_hex_private_key("legacy", &hex::encode([29; 32]))
            .unwrap()
            .address_string
            .to_string();
    let output = std::process::Command::new("/usr/bin/security")
        .args([
            "add-generic-password",
            "-s",
            "org.thru.cli.signing-keys",
            "-l",
            "org.thru.cli.signing-keys",
            "-a",
            legacy_id,
            "-T",
            env!("CARGO_BIN_EXE_thru"),
            "-X",
            &hex::encode([29; 32]),
            keychain_path,
        ])
        .env("HOME", home.path())
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "legacy item setup failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let config_path = home.path().join(".thru/cli/config.yaml");
    let mut document: serde_yaml::Value =
        serde_yaml::from_str(&std::fs::read_to_string(&config_path).unwrap()).unwrap();
    document["keys"]["legacy"] = serde_yaml::from_str(&format!(
        "{{public_key: {legacy_address}, source: {{type: macos-keychain, id: {legacy_id}}}}}"
    ))
    .unwrap();
    std::fs::write(&config_path, serde_yaml::to_string(&document).unwrap()).unwrap();
    let statuses = |output: &Output| -> std::collections::BTreeMap<String, String> {
        success(output)["keys"]["keychain_comments"]
            .as_array()
            .unwrap()
            .iter()
            .map(|item| {
                (
                    item["reference"].as_str().unwrap().to_owned(),
                    item["status"].as_str().unwrap().to_owned(),
                )
            })
            .collect()
    };
    let legacy_reference = format!("keychain:{legacy_id}");
    let imported_reference = imported["keys"]["reference"].as_str().unwrap();
    let first = statuses(&cli(home.path(), &url, &["keys", "migrate"], None).await);
    assert_eq!(first[&legacy_reference], "added");
    assert_eq!(first[reference], "already_set");
    assert_eq!(first[imported_reference], "already_set");
    let found = std::process::Command::new("/usr/bin/security")
        .args([
            "find-generic-password",
            "-s",
            "org.thru.cli.signing-keys",
            "-a",
            legacy_id,
            keychain_path,
        ])
        .env("HOME", home.path())
        .output()
        .unwrap();
    assert!(
        String::from_utf8_lossy(&found.stdout)
            .contains(&format!("\"icmt\"<blob>=\"{legacy_address}\"")),
        "comment not set: {}",
        String::from_utf8_lossy(&found.stdout)
    );
    let again = statuses(&cli(home.path(), &url, &["keys", "migrate"], None).await);
    assert!(again.values().all(|status| status == "already_set"));
    // The item and its registration still sign.
    verify_signed(
        &cli(
            home.path(),
            &url,
            &["txn", "sign", &program, "0102", "--fee-payer", "legacy"],
            None,
        )
        .await,
        &legacy_address,
    );

    // `keys move`: one file key into the Keychain, then every key into JSON
    // files and back into the Keychain. Old CLI-created copies are deleted.
    let movable = success(&cli(home.path(), &url, &["keys", "generate", "movable"], None).await);
    let movable_file = source_path(&movable);
    let movable_address = movable["keys"]["public_key"].as_str().unwrap().to_owned();
    let moved = success(
        &cli(
            home.path(),
            &url,
            &["keys", "move", "movable", "--to", "keychain"],
            None,
        )
        .await,
    );
    assert!(
        moved["keys"]["moved"][0]["reference"]
            .as_str()
            .unwrap()
            .starts_with("keychain:")
    );
    assert_eq!(moved["keys"]["previous"][0]["status"], "deleted");
    assert!(!movable_file.exists());
    verify_signed(
        &cli(
            home.path(),
            &url,
            &["txn", "sign", &program, "0102", "--fee-payer", "movable"],
            None,
        )
        .await,
        &movable_address,
    );
    let all_moved = |response: &Value, prefix: &str| -> Vec<std::path::PathBuf> {
        let moved = response["keys"]["moved"].as_array().unwrap();
        assert_eq!(moved.len(), 4, "{response}");
        assert!(
            response["keys"]["previous"]
                .as_array()
                .unwrap()
                .iter()
                .all(|previous| previous["status"] == "deleted"),
            "{response}"
        );
        moved
            .iter()
            .map(|item| {
                let reference = item["reference"].as_str().unwrap();
                assert!(reference.starts_with(prefix), "{reference}");
                reference.trim_start_matches("file:").into()
            })
            .collect()
    };
    let to_files = success(
        &cli(
            home.path(),
            &url,
            &["keys", "move", "--all", "--to", "file"],
            None,
        )
        .await,
    );
    let files = all_moved(&to_files, "file:");
    for file in &files {
        let value: Value = serde_json::from_str(&std::fs::read_to_string(file).unwrap()).unwrap();
        assert_eq!(value["version"], 1);
        assert_eq!(value["key_type"], "ed25519");
    }
    verify_signed(
        &cli(
            home.path(),
            &url,
            &["txn", "sign", &program, "0102", "--fee-payer", "imported"],
            None,
        )
        .await,
        &expected,
    );
    let again = success(
        &cli(
            home.path(),
            &url,
            &["keys", "move", "--all", "--to", "file"],
            None,
        )
        .await,
    );
    assert!(again["keys"]["moved"].as_array().unwrap().is_empty());
    let to_keychain = success(
        &cli(
            home.path(),
            &url,
            &["keys", "move", "--all", "--to", "keychain"],
            None,
        )
        .await,
    );
    all_moved(&to_keychain, "keychain:");
    assert!(files.iter().all(|file| !file.exists()));
    verify_signed(
        &cli(
            home.path(),
            &url,
            &["txn", "sign", &program, "0102", "--fee-payer", "movable"],
            None,
        )
        .await,
        &movable_address,
    );

    success(
        &cli(
            home.path(),
            &url,
            &["keys", "rm", "native", "--delete-secret"],
            None,
        )
        .await,
    );
    let missing = cli(
        home.path(),
        &url,
        &["txn", "sign", &program, "0102", "--fee-payer", reference],
        None,
    )
    .await;
    assert!(
        !missing.status.success(),
        "deleted Keychain source fell back or regenerated"
    );
    assert_tree_has_no_seed(home.path(), &seed_bytes);
}

#[tokio::test]
async fn partial_read_only_config_and_owner_only_seed_are_not_rewritten() {
    let home = tempfile::tempdir().unwrap();
    let (url, _shutdown) = rpc().await;
    let config_dir = home.path().join(".thru/cli");
    std::fs::create_dir_all(&config_dir).unwrap();
    let config_path = config_dir.join("config.yaml");
    let document = format!("# preserve my comments\nrpc_base_url: {url}\nkeys: {{}}\n");
    std::fs::write(&config_path, &document).unwrap();
    std::fs::set_permissions(&config_path, std::fs::Permissions::from_mode(0o400)).unwrap();
    std::fs::set_permissions(&config_dir, std::fs::Permissions::from_mode(0o500)).unwrap();
    success(&cli(home.path(), &url, &["keys", "list"], None).await);
    assert_eq!(std::fs::read_to_string(&config_path).unwrap(), document);
    assert_eq!(
        std::fs::metadata(&config_path)
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o400
    );
    assert_eq!(
        std::fs::metadata(&config_dir).unwrap().permissions().mode() & 0o777,
        0o500
    );

    let private_dir = home.path().join("private");
    std::fs::create_dir(&private_dir).unwrap();
    let key_path = private_dir.join("read-only.key");
    let seed = hex::encode([31; 32]);
    std::fs::write(&key_path, &seed).unwrap();
    std::fs::set_permissions(&key_path, std::fs::Permissions::from_mode(0o400)).unwrap();
    std::fs::set_permissions(&private_dir, std::fs::Permissions::from_mode(0o500)).unwrap();
    let expected = thru_base::tn_tools::KeyPair::from_hex_private_key("expected", &seed)
        .unwrap()
        .address_string
        .to_string();
    verify_signed(
        &cli(
            home.path(),
            &url,
            &[
                "txn",
                "sign",
                &hex::encode([9; 32]),
                "0102",
                "--fee-payer",
                key_path.to_str().unwrap(),
            ],
            None,
        )
        .await,
        &expected,
    );
    assert_eq!(std::fs::read_to_string(&config_path).unwrap(), document);
    assert_eq!(
        std::fs::metadata(&key_path).unwrap().permissions().mode() & 0o777,
        0o400
    );
    // Restore only our test directories so TempDir can remove their contents.
    std::fs::set_permissions(&private_dir, std::fs::Permissions::from_mode(0o700)).unwrap();
    std::fs::set_permissions(&config_dir, std::fs::Permissions::from_mode(0o700)).unwrap();
}

fn source_path(response: &Value) -> std::path::PathBuf {
    response["keys"]["source"]["path"].as_str().unwrap().into()
}

#[tokio::test]
async fn generated_key_files_are_json_and_migrate_converts_legacy_managed_files() {
    let home = tempfile::tempdir().unwrap();
    let url = "http://127.0.0.1:1";
    let generated = success(&cli(home.path(), url, &["keys", "generate", "fresh"], None).await);
    let file = source_path(&generated);
    let contents = std::fs::read_to_string(&file).unwrap();
    let value: Value = serde_json::from_str(&contents).unwrap();
    assert_eq!(value["version"], 1);
    assert_eq!(value["key_type"], "ed25519");
    assert_eq!(value["public_key"], generated["keys"]["public_key"]);
    let seed = value["seed"].as_str().unwrap().to_owned();
    assert_eq!(seed.len(), 64);

    // A JSON key file on stdin imports the same key, without echoing it.
    let imported = cli(
        home.path(),
        url,
        &["keys", "add", "copy", "--stdin"],
        Some(&contents),
    )
    .await;
    assert_no_seed(&imported, &seed);
    assert_eq!(
        success(&imported)["keys"]["public_key"],
        generated["keys"]["public_key"]
    );

    // A managed file in the legacy hex format (as older CLIs wrote it) is
    // rewritten as the same JSON by `keys migrate`; already-JSON files are not.
    std::fs::write(&file, &seed).unwrap();
    let migrated = cli(home.path(), url, &["keys", "migrate"], None).await;
    assert_no_seed(&migrated, &seed);
    let migrated = success(&migrated);
    let converted = migrated["keys"]["converted_files"].as_array().unwrap();
    assert_eq!(converted.len(), 1, "{migrated}");
    assert_eq!(converted[0]["status"], "converted");
    assert_eq!(std::fs::read_to_string(&file).unwrap(), contents);
    let again = success(&cli(home.path(), url, &["keys", "migrate"], None).await);
    assert!(again["keys"].get("converted_files").is_none());
}

#[tokio::test]
async fn managed_files_are_reclaimed_without_deleting_shared_or_external_sources() {
    let home = tempfile::tempdir().unwrap();
    std::fs::set_permissions(home.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
    let url = "http://127.0.0.1:1";
    let first = success(
        &cli(
            home.path(),
            url,
            &["keys", "add", "worker", "--stdin"],
            Some(&hex::encode([41; 32])),
        )
        .await,
    );
    let mut current = source_path(&first);
    assert_eq!(first["keys"]["source"]["managed"], true);
    for value in 42..45 {
        let next = success(
            &cli(
                home.path(),
                url,
                &["keys", "add", "worker", "--overwrite", "--stdin"],
                Some(&hex::encode([value; 32])),
            )
            .await,
        );
        assert_eq!(next["keys"]["secret"]["status"], "deleted");
        assert!(!current.exists(), "superseded managed key remained on disk");
        current = source_path(&next);
        let files: Vec<_> = std::fs::read_dir(current.parent().unwrap())
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .collect();
        assert_eq!(
            files,
            vec![current.clone()],
            "orphaned managed signing keys"
        );
    }
    let shared = success(
        &cli(
            home.path(),
            url,
            &["keys", "add", "shared", "--file", current.to_str().unwrap()],
            None,
        )
        .await,
    );
    assert_eq!(shared["keys"]["source"]["managed"], true);
    let removed = success(&cli(home.path(), url, &["keys", "rm", "worker"], None).await);
    assert_eq!(removed["keys"]["secret"]["status"], "retained");
    assert!(
        current.exists(),
        "removed a source still referenced by another alias"
    );
    let removed = success(&cli(home.path(), url, &["keys", "rm", "shared"], None).await);
    assert_eq!(removed["keys"]["secret"]["status"], "deleted");
    assert!(
        !current.exists(),
        "last managed reference did not reclaim its source"
    );

    let external = home.path().join("operator.key");
    let seed = hex::encode([51; 32]);
    std::fs::write(&external, &seed).unwrap();
    std::fs::set_permissions(&external, std::fs::Permissions::from_mode(0o400)).unwrap();
    success(
        &cli(
            home.path(),
            url,
            &[
                "keys",
                "add",
                "operator",
                "--file",
                external.to_str().unwrap(),
            ],
            None,
        )
        .await,
    );
    let replacement = success(
        &cli(
            home.path(),
            url,
            &["keys", "add", "operator", "--overwrite", "--stdin"],
            Some(&hex::encode([52; 32])),
        )
        .await,
    );
    assert_eq!(replacement["keys"]["secret"]["status"], "retained");
    assert_eq!(
        replacement["keys"]["secret"]["reference"],
        format!("file:{}", external.display())
    );
    assert_eq!(std::fs::read_to_string(&external).unwrap(), seed);
    success(&cli(home.path(), url, &["keys", "rm", "operator"], None).await);
    assert!(!source_path(&replacement).exists());
    assert_eq!(std::fs::read_to_string(&external).unwrap(), seed);
}

#[tokio::test]
async fn concurrent_network_and_key_commands_preserve_each_others_changes() {
    let home = tempfile::tempdir().unwrap();
    let url = "http://127.0.0.1:1";
    success(&cli(home.path(), url, &["keys", "list"], None).await);
    for index in 0..4 {
        let alias = format!("signer-{index}");
        let network = format!("network-{index}");
        let key_args = ["keys", "generate", &alias];
        let network_args = ["network", "add", &network, "--url", "http://127.0.0.1:8545"];
        let (key_result, network_result) = tokio::join!(
            cli(home.path(), url, &key_args, None),
            cli(home.path(), url, &network_args, None),
        );
        success(&key_result);
        success(&network_result);
    }
    let raw = std::fs::read_to_string(home.path().join(".thru/cli/config.yaml")).unwrap();
    let document: Value = serde_yaml::from_str(&raw).unwrap();
    for index in 0..4 {
        let alias = format!("signer-{index}");
        let network = format!("network-{index}");
        let entry = success(&cli(home.path(), url, &["keys", "get", &alias], None).await);
        assert_eq!(
            document["keys"][&alias]["public_key"],
            entry["keys"]["public_key"]
        );
        assert!(source_path(&entry).is_file());
        assert_eq!(
            document["networks"][&network]["url"],
            "http://127.0.0.1:8545"
        );
    }
}

#[tokio::test]
async fn failures_identify_references_and_config_fields_without_exposing_seeds() {
    let home = tempfile::tempdir().unwrap();
    let url = "http://127.0.0.1:1";
    let program = hex::encode([9; 32]);
    let missing_default = cli(home.path(), url, &["txn", "sign", &program, "0102"], None).await;
    assert!(!missing_default.status.success());
    let error: Value = serde_json::from_slice(&missing_default.stdout).unwrap();
    assert!(
        error["error"]["message"]
            .as_str()
            .unwrap()
            .contains("keys generate default")
    );
    let missing_alias = cli(
        home.path(),
        url,
        &[
            "txn",
            "sign",
            &program,
            "0102",
            "--fee-payer",
            "operator-typo",
        ],
        None,
    )
    .await;
    assert!(!missing_alias.status.success());
    let error: Value = serde_json::from_slice(&missing_alias.stdout).unwrap();
    assert!(
        error["error"]["message"]
            .as_str()
            .unwrap()
            .contains("operator-typo")
    );
    let missing_destination = cli(home.path(), url, &["getbalance", "recipient-typo"], None).await;
    assert!(!missing_destination.status.success());
    let error: Value = serde_json::from_slice(&missing_destination.stdout).unwrap();
    assert!(
        error["error"]["message"]
            .as_str()
            .unwrap()
            .contains("recipient-typo")
    );
    assert!(
        error["error"]["message"]
            .as_str()
            .unwrap()
            .contains("alias")
    );

    let seed = hex::encode([61; 32]);
    let config_path = home.path().join(".thru/cli/config.yaml");
    std::fs::write(
        &config_path,
        format!("rpc_base_url: {url}\nkeys:\n  default: '{seed}'\ntimeout_seconds: not-a-number\n"),
    )
    .unwrap();
    let invalid = cli(home.path(), url, &["keys", "list"], None).await;
    assert!(!invalid.status.success());
    assert_no_seed(&invalid, &seed);
    // Config-load failures honor --json like command failures do.
    let error: Value = serde_json::from_slice(&invalid.stdout).unwrap();
    let message = error["error"]["message"].as_str().unwrap();
    assert!(message.contains("timeout_seconds"));
    assert!(message.contains("line") && message.contains("column"));
}

#[tokio::test]
async fn legacy_inline_keys_only_block_signing_and_config_writes() {
    let home = tempfile::tempdir().unwrap();
    let url = "http://127.0.0.1:1";
    let directory = home.path().join(".thru/cli");
    std::fs::create_dir_all(&directory).unwrap();
    let path = directory.join("config.yaml");
    let seed = hex::encode([71; 32]);
    let raw = format!("rpc_base_url: {url}\nkeys:\n  default: '{seed}'\n");
    std::fs::write(&path, &raw).unwrap();

    // Commands that never sign keep working.
    for args in [&["keys", "list"][..], &["network"][..]] {
        let output = cli(home.path(), url, args, None).await;
        assert_no_seed(&output, &seed);
        success(&output);
    }

    // Signing with the inline alias and writing the config fail with JSON
    // errors that point at migration; the file is left as it was.
    let program = hex::encode([9; 32]);
    for (args, expected) in [
        (
            &["txn", "sign", program.as_str(), "0102"][..],
            "thru keys migrate",
        ),
        (
            &["network", "add", "spare", "--url", "http://127.0.0.1:2"][..],
            "before changing the config",
        ),
        (
            &["keys", "generate", "other"][..],
            "before changing the config",
        ),
    ] {
        let output = cli(home.path(), url, args, None).await;
        assert!(!output.status.success(), "{args:?} succeeded");
        assert_no_seed(&output, &seed);
        let error: Value = serde_json::from_slice(&output.stdout).unwrap();
        let message = error["error"]["message"].as_str().unwrap();
        assert!(message.contains(expected), "{args:?}: {message}");
    }
    assert_eq!(std::fs::read_to_string(&path).unwrap(), raw);

    // Without --json/--quiet, a one-line notice names the alias on stderr.
    let output = tokio::process::Command::new(env!("CARGO_BIN_EXE_thru"))
        .args(["--url", url, "keys", "list"])
        .env("HOME", home.path())
        .env("THRU_DEVELOPERS_CREDENTIAL_STORE", "file")
        .env_remove("THRU_API_KEY")
        .env_remove("THRU_DEVELOPERS_API_KEY")
        .current_dir(home.path())
        .stdin(Stdio::null())
        .output()
        .await
        .unwrap();
    assert!(output.status.success());
    assert_no_seed(&output, &seed);
    let notice = String::from_utf8_lossy(&output.stderr);
    assert!(
        notice.contains("default") && notice.contains("thru keys migrate"),
        "{notice}"
    );
}

#[tokio::test]
async fn obsolete_positional_seeds_are_never_echoed_by_argument_errors() {
    let home = tempfile::tempdir().unwrap();
    let url = "http://127.0.0.1:1";
    let seed = hex::encode([91; 32]);
    for args in [
        vec!["keys", "add", "worker", &seed],
        vec!["keys", "add", "worker", &seed, "--stdin"],
        vec!["keys", "add", "worker", "--stdin", &seed],
        vec!["keys", "add", "worker", &seed, "--file", "missing.key"],
        vec!["keys", "add", "worker", &seed, "--store", "invalid"],
        vec!["keys", "add", "worker", "--store", "invalid", &seed],
        vec!["keys", "add", "worker", &seed, "--unknown"],
        vec!["keys", "add", "worker", &seed, &seed],
    ] {
        let output = cli(home.path(), url, &args, None).await;
        assert!(!output.status.success());
        assert_no_seed(&output, &seed);
    }
    assert!(!home.path().join(".thru/cli/config.yaml").exists());
}

#[tokio::test]
async fn migration_without_inline_keys_preserves_absent_and_custom_configs() {
    let home = tempfile::tempdir().unwrap();
    let url = "http://127.0.0.1:1";
    let path = home.path().join(".thru/cli/config.yaml");
    let response = success(&cli(home.path(), url, &["keys", "migrate"], None).await);
    assert_eq!(response["keys"]["migrated"], 0);
    assert_eq!(response["keys"]["entries"], serde_json::json!([]));
    assert!(!path.exists());
    assert!(!path.parent().unwrap().join("keys").exists());

    success(&cli(home.path(), url, &["keys", "generate", "worker"], None).await);
    let raw = std::fs::read_to_string(&path).unwrap();
    let raw = format!("# Keep operator comments and formatting.\n{raw}\n# End.\n");
    std::fs::write(&path, &raw).unwrap();
    let before = std::fs::metadata(&path).unwrap().modified().unwrap();
    let response = success(&cli(home.path(), url, &["keys", "migrate"], None).await);
    assert_eq!(response["keys"]["migrated"], 0);
    assert_eq!(std::fs::read_to_string(&path).unwrap(), raw);
    assert_eq!(
        std::fs::metadata(&path).unwrap().modified().unwrap(),
        before
    );
}

#[tokio::test]
async fn get_and_delete_select_literal_legacy_aliases_once() {
    let home = tempfile::tempdir().unwrap();
    let url = "http://127.0.0.1:1";
    let directory = home.path().join(".thru/cli");
    std::fs::create_dir_all(&directory).unwrap();
    let seed = hex::encode([92; 32]);
    let address = thru_base::tn_tools::KeyPair::from_hex_private_key("expected", &seed)
        .unwrap()
        .address_string
        .to_string();
    let aliases = [
        "ordinary",
        "alias:legacy",
        "keychain:legacy",
        "file:legacy",
        &address,
    ];
    let mut raw = format!("rpc_base_url: {url}\nkeys:\n");
    for (index, alias) in aliases.iter().enumerate() {
        raw.push_str(&format!(
            "  '{alias}': '{}'\n",
            hex::encode([92 + index as u8; 32])
        ));
    }
    std::fs::write(directory.join("config.yaml"), raw).unwrap();
    success(&cli(home.path(), url, &["keys", "migrate"], None).await);
    let listed = success(&cli(home.path(), url, &["keys", "list"], None).await);
    for alias in aliases {
        assert!(
            listed["keys"]["entries"]
                .as_array()
                .unwrap()
                .iter()
                .any(|entry| entry["name"] == alias.to_lowercase())
        );
        let selector = format!("alias:{alias}");
        let entry = success(&cli(home.path(), url, &["keys", "get", &selector], None).await);
        assert_eq!(entry["keys"]["name"], alias.to_lowercase());
        let path = source_path(&entry);
        assert!(path.exists());
        let removed = success(
            &cli(
                home.path(),
                url,
                &["keys", "rm", &selector, "--delete-secret"],
                None,
            )
            .await,
        );
        assert_eq!(removed["keys"]["secret"]["status"], "deleted");
        assert!(!path.exists());
    }
}

/// Wait for the child to consume the seed, but keep its stdin open so read_seed
/// is blocked waiting for EOF. Kernel receive-queue state provides the barrier.
async fn blocked_stdin(
    home: &Path,
    url: &str,
    args: &[&str],
    seed: &str,
) -> (tokio::process::Child, std::os::unix::net::UnixStream) {
    use std::io::Write;
    use std::os::fd::{AsRawFd, OwnedFd};
    use std::os::unix::net::UnixStream;

    let (reader, mut writer) = UnixStream::pair().unwrap();
    writer.write_all(seed.as_bytes()).unwrap();
    let stdin = OwnedFd::from(reader.try_clone().unwrap());
    let mut child = cli_command(home, url, args)
        .stdin(Stdio::from(stdin))
        .spawn()
        .unwrap();
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let mut available: libc::c_int = 0;
            assert_eq!(
                unsafe { libc::ioctl(reader.as_raw_fd(), libc::FIONREAD, &mut available) },
                0
            );
            if available == 0 {
                break;
            }
            assert!(
                child.try_wait().unwrap().is_none(),
                "CLI exited before reading stdin"
            );
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("CLI did not consume stdin");
    (child, writer)
}

#[tokio::test]
async fn blocked_stdin_does_not_block_writers_and_losing_import_is_reclaimed() {
    let home = tempfile::tempdir().unwrap();
    let url = "http://127.0.0.1:1";
    success(&cli(home.path(), url, &["keys", "list"], None).await);
    let seed = hex::encode([98; 32]);
    let (child, stdin) = blocked_stdin(
        home.path(),
        url,
        &["keys", "add", "racing", "--stdin"],
        &seed,
    )
    .await;
    let network = tokio::time::timeout(
        Duration::from_secs(10),
        cli(
            home.path(),
            url,
            &["network", "add", "while-reading", "--url", url],
            None,
        ),
    )
    .await
    .expect("blocked stdin retained the config writer lock");
    success(&network);
    let winner = success(&cli(home.path(), url, &["keys", "generate", "racing"], None).await);
    stdin.shutdown(std::net::Shutdown::Write).unwrap();
    let loser = tokio::time::timeout(Duration::from_secs(10), child.wait_with_output())
        .await
        .unwrap()
        .unwrap();
    assert!(!loser.status.success());
    assert_no_seed(&loser, &seed);
    let entry = success(&cli(home.path(), url, &["keys", "get", "racing"], None).await);
    assert_eq!(entry["keys"]["public_key"], winner["keys"]["public_key"]);
    let path = source_path(&winner);
    let files: Vec<_> = std::fs::read_dir(path.parent().unwrap())
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect();
    assert_eq!(files, vec![path]);
    let raw = std::fs::read_to_string(home.path().join(".thru/cli/config.yaml")).unwrap();
    let document: Value = serde_yaml::from_str(&raw).unwrap();
    assert_eq!(document["networks"]["while-reading"]["url"], url);
}

#[tokio::test]
async fn numeric_legacy_seed_requires_original_digits_quoted_before_migration() {
    let home = tempfile::tempdir().unwrap();
    let url = "http://127.0.0.1:1";
    let directory = home.path().join(".thru/cli");
    std::fs::create_dir_all(&directory).unwrap();
    let path = directory.join("config.yaml");
    let seed = "1".repeat(64);
    let raw = format!("keys:\n  default: {seed}\n");
    std::fs::write(&path, &raw).unwrap();

    for args in [&["keys", "list"][..], &["keys", "migrate"][..]] {
        let output = cli(home.path(), url, args, None).await;
        assert!(!output.status.success());
        assert_no_seed(&output, &seed);
        let error = format!(
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(error.contains("quote") && error.contains("ORIGINAL"));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), raw);
    }

    std::fs::write(&path, format!("keys:\n  default: '{seed}'\n")).unwrap();
    success(&cli(home.path(), url, &["keys", "migrate"], None).await);
    let entry = success(&cli(home.path(), url, &["keys", "get", "default"], None).await);
    let expected = thru_base::tn_tools::KeyPair::from_hex_private_key("expected", &seed).unwrap();
    assert_eq!(
        entry["keys"]["public_key"],
        expected.address_string.to_string()
    );
    assert!(!std::fs::read_to_string(path).unwrap().contains(&seed));
}

#[tokio::test]
async fn invalid_network_url_reports_the_parse_reason_without_saving() {
    let home = tempfile::tempdir().unwrap();
    let url = "http://127.0.0.1:1";
    success(&cli(home.path(), url, &["keys", "list"], None).await);
    let path = home.path().join(".thru/cli/config.yaml");
    let before = std::fs::read(&path).unwrap();
    let output = cli(
        home.path(),
        url,
        &["network", "add", "broken", "--url", "not-a-url"],
        None,
    )
    .await;
    assert!(!output.status.success());
    let error: Value = serde_json::from_slice(&output.stdout).unwrap();
    let message = error["error"]["message"].as_str().unwrap();
    assert!(
        message.contains("URL") && message.contains("broken") && message.contains("relative URL")
    );
    assert_eq!(std::fs::read(path).unwrap(), before);
}
