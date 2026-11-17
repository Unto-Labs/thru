//! `list_accounts_by_owner` pages through ListAccounts with the owner filter,
//! reads each non-empty account body with GetAccount, and backs off on rate
//! limiting.

use std::convert::Infallible;
use std::sync::{Arc, Mutex};
use std::task::{Context, Poll};
use thru_base::tn_tools::Pubkey;
use thru_client::{
    AccountStateFilter, Client,
    proto::{common::v1 as common, core::v1 as core, services::v1 as services},
};
use tonic::{
    Request, Response, Status,
    body::Body,
    codegen::{BoxFuture, Service, http},
};

const OWNER: [u8; 32] = [7; 32];

fn address(n: u8) -> Vec<u8> {
    vec![n; 32]
}

/// Account body served by GetAccount, keyed by the first address byte.
fn body(n: u8) -> Vec<u8> {
    vec![n, n, n]
}

fn meta_only(n: u8, data_size: u32) -> core::Account {
    core::Account {
        address: Some(common::Pubkey { value: address(n) }),
        meta: Some(core::AccountMeta {
            owner: Some(common::Pubkey {
                value: OWNER.to_vec(),
            }),
            data_size,
            balance: u64::from(n),
            ..Default::default()
        }),
        ..Default::default()
    }
}

#[derive(Default)]
struct Log {
    list_requests: Vec<services::ListAccountsRequest>,
    get_addresses: Vec<Vec<u8>>,
    refusals: usize,
}

/// Serves three ListAccounts pages (the middle one empty, as the node returns
/// when its candidate budget runs out) and GetAccount bodies. Address 4 is
/// deleted before its body is read.
#[derive(Clone, Default)]
struct Query {
    log: Arc<Mutex<Log>>,
    /// Refuse the first ListAccounts call with this status.
    first_list_refusal: Option<(tonic::Code, &'static str)>,
}

impl tonic::server::NamedService for Query {
    const NAME: &'static str = "thru.services.v1.QueryService";
}

struct ListAccounts(Query);

impl tonic::server::UnaryService<services::ListAccountsRequest> for ListAccounts {
    type Response = services::ListAccountsResponse;
    type Future = BoxFuture<Response<Self::Response>, Status>;
    fn call(&mut self, request: Request<services::ListAccountsRequest>) -> Self::Future {
        let request = request.into_inner();
        let mut log = self.0.log.lock().unwrap();
        if let Some((code, message)) = self.0.first_list_refusal
            && log.refusals == 0
        {
            log.refusals += 1;
            return Box::pin(async move { Err(Status::new(code, message)) });
        }
        log.list_requests.push(request.clone());
        let token = request
            .page
            .and_then(|page| page.page_token)
            .unwrap_or_default();
        let (accounts, next) = match token.as_str() {
            "" => (vec![meta_only(1, 0), meta_only(2, 3)], Some("p2")),
            "p2" => (vec![], Some("p3")),
            "p3" => (vec![meta_only(3, 3), meta_only(4, 3)], None),
            other => panic!("unexpected page token {other}"),
        };
        let response = services::ListAccountsResponse {
            accounts,
            page: Some(common::PageResponse {
                next_page_token: next.map(str::to_string),
                total_size: None,
            }),
        };
        Box::pin(async move { Ok(Response::new(response)) })
    }
}

struct GetAccount(Query);

impl tonic::server::UnaryService<services::GetAccountRequest> for GetAccount {
    type Response = core::Account;
    type Future = BoxFuture<Response<Self::Response>, Status>;
    fn call(&mut self, request: Request<services::GetAccountRequest>) -> Self::Future {
        let request = request.into_inner();
        assert_eq!(request.view, Some(core::AccountView::Full as i32));
        let value = request.address.unwrap().value;
        self.0.log.lock().unwrap().get_addresses.push(value.clone());
        let n = value[0];
        Box::pin(async move {
            if n == 4 {
                return Err(Status::not_found("account not found"));
            }
            let mut account = meta_only(n, 3);
            account.data = Some(core::AccountData {
                data: Some(body(n)),
                ..Default::default()
            });
            Ok(Response::new(account))
        })
    }
}

impl Service<http::Request<Body>> for Query {
    type Response = http::Response<Body>;
    type Error = Infallible;
    type Future = BoxFuture<Self::Response, Self::Error>;

    fn poll_ready(&mut self, _: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        Poll::Ready(Ok(()))
    }

    fn call(&mut self, request: http::Request<Body>) -> Self::Future {
        let query = self.clone();
        Box::pin(async move {
            let response = match request.uri().path() {
                "/thru.services.v1.QueryService/ListAccounts" => {
                    tonic::server::Grpc::new(tonic_prost::ProstCodec::default())
                        .unary(ListAccounts(query), request)
                        .await
                }
                "/thru.services.v1.QueryService/GetAccount" => {
                    tonic::server::Grpc::new(tonic_prost::ProstCodec::default())
                        .unary(GetAccount(query), request)
                        .await
                }
                path => panic!("unexpected method {path}"),
            };
            Ok(response)
        })
    }
}

async fn list(
    query: Query,
    limit: Option<usize>,
) -> thru_client::Result<Vec<thru_client::ListedAccount>> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let local = listener.local_addr().unwrap();
    let (shutdown, done) = tokio::sync::oneshot::channel();
    let server = tokio::spawn(async move {
        tonic::transport::Server::builder()
            .add_service(query)
            .serve_with_incoming_shutdown(
                tokio_stream::wrappers::TcpListenerStream::new(listener),
                async {
                    let _ = done.await;
                },
            )
            .await
            .unwrap();
    });
    let client = Client::builder()
        .http_endpoint(format!("http://{local}").parse().unwrap())
        .build()
        .unwrap();
    let result = client
        .list_accounts_by_owner(&Pubkey::from_bytes(&OWNER), limit)
        .await;
    shutdown.send(()).unwrap();
    server.await.unwrap();
    result
}

#[tokio::test]
async fn follows_every_page_and_reads_each_account_body() {
    let query = Query::default();
    let accounts = list(query.clone(), None).await.unwrap();

    let summary: Vec<_> = accounts
        .iter()
        .map(|a| (a.address.to_bytes().unwrap()[0], a.data.clone()))
        .collect();
    /* Address 4 vanished before its body was read, so it is omitted. */
    assert_eq!(summary, vec![(1, vec![]), (2, body(2)), (3, body(3))]);
    for account in &accounts {
        assert_eq!(account.owner, Pubkey::from_bytes(&OWNER));
        assert_eq!(account.account.owner, account.owner);
    }
    assert_eq!(accounts[1].account.balance, 2);

    let log = query.log.lock().unwrap();
    let tokens: Vec<_> = log
        .list_requests
        .iter()
        .map(|r| r.page.clone().unwrap().page_token)
        .collect();
    assert_eq!(
        tokens,
        vec![None, Some("p2".to_string()), Some("p3".to_string())]
    );
    for request in &log.list_requests {
        let filter = request.filter.as_ref().unwrap();
        assert_eq!(
            filter.expression.as_deref(),
            Some("account.meta.owner.value == params.owner_bytes")
        );
        assert_eq!(
            filter.params["owner_bytes"].kind,
            Some(common::filter_param_value::Kind::BytesValue(OWNER.to_vec()))
        );
        assert_eq!(request.page.as_ref().unwrap().page_size, Some(1000));
        assert_eq!(request.view, Some(core::AccountView::Full as i32));
        assert_eq!(request.state, services::AccountStateFilter::Live as i32);
    }
    /* The zero-size account needs no body read. */
    assert_eq!(log.get_addresses, vec![address(2), address(3), address(4)]);
}

#[tokio::test]
async fn stops_at_the_limit() {
    let query = Query::default();
    let accounts = list(query.clone(), Some(1)).await.unwrap();
    assert_eq!(accounts.len(), 1);
    assert_eq!(accounts[0].address, Pubkey::from_bytes(&[1; 32]));

    let log = query.log.lock().unwrap();
    assert_eq!(log.list_requests.len(), 1);
    assert_eq!(
        log.list_requests[0].page.as_ref().unwrap().page_size,
        Some(1)
    );
    assert!(log.get_addresses.is_empty());
}

async fn list_after_refusal(
    code: tonic::Code,
    message: &'static str,
) -> (
    thru_client::Result<Vec<thru_client::ListedAccount>>,
    usize,
    usize,
) {
    let query = Query {
        first_list_refusal: Some((code, message)),
        ..Default::default()
    };
    let result = list(query.clone(), Some(2)).await;
    let log = query.log.lock().unwrap();
    (result, log.refusals, log.list_requests.len())
}

#[tokio::test]
async fn retries_a_rate_limited_page() {
    let (result, refusals, served) =
        list_after_refusal(tonic::Code::Unavailable, "rate limit exceeded").await;
    assert_eq!(result.unwrap().len(), 2);
    assert_eq!((refusals, served), (1, 1));
}

#[tokio::test]
async fn retries_exhausted_listing_capacity() {
    let (result, refusals, served) = list_after_refusal(
        tonic::Code::ResourceExhausted,
        "account listing capacity exhausted; retry later",
    )
    .await;
    assert_eq!(result.unwrap().len(), 2);
    assert_eq!((refusals, served), (1, 1));
}

#[tokio::test]
async fn does_not_retry_an_exceeded_database_budget() {
    let (result, refusals, served) = list_after_refusal(
        tonic::Code::ResourceExhausted,
        "account listing database budget exceeded",
    )
    .await;
    let error = result.unwrap_err().to_string();
    assert!(error.contains("database budget exceeded"), "{error}");
    assert_eq!((refusals, served), (1, 0));
}

/// Smoke test against betanet. Run with
/// `cargo test -p thru-client --test list_accounts -- --ignored --nocapture`.
/// Set `THRU_LIST_STATE=all` or `compressed` to include compressed accounts.
#[tokio::test]
#[ignore = "talks to betanet"]
async fn betanet_lists_manager_program_accounts() {
    let client = Client::builder()
        .http_endpoint("https://rpc.betanet.thru.org".parse().unwrap())
        .build()
        .unwrap();
    let owner = Pubkey::new("taMGRmPoSTkUtF6UlmCIq58K8OYsnXshOMPdobxxHytqmu".to_string()).unwrap();
    let state = match std::env::var("THRU_LIST_STATE").as_deref() {
        Ok("all") => AccountStateFilter::All,
        Ok("compressed") => AccountStateFilter::Compressed,
        _ => AccountStateFilter::Live,
    };
    let accounts = client
        .list_accounts_by_owner_in_state(&owner, state, Some(2))
        .await
        .unwrap();
    assert!(!accounts.is_empty());
    for account in &accounts {
        println!(
            "{} owner={} data_len={} data_size={}",
            account.address,
            account.owner,
            account.data.len(),
            account.account.data_size
        );
        assert_eq!(account.owner, owner);
        assert_eq!(account.data.len() as u64, account.account.data_size);
    }
}
