//! A slot-pinned read rides out a node whose durable cursor trails the slot.

use std::convert::Infallible;
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::task::{Context, Poll};
use thru_client::{
    Client,
    proto::{common::v1 as common, core::v1 as core, services::v1 as services},
};
use tonic::{
    Request, Response, Status,
    body::Body,
    codegen::{BoxFuture, Service, http},
};

/// Refuses GetAccount the way thrud refuses a slot above its durable cursor
/// for the first `refusals` calls, then answers.
#[derive(Clone)]
struct Query {
    calls: Arc<AtomicUsize>,
    refusals: usize,
}

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
        let query = self.clone();
        Box::pin(async move {
            struct GetAccount(Query);
            impl tonic::server::UnaryService<services::GetAccountRequest> for GetAccount {
                type Response = core::Account;
                type Future = BoxFuture<Response<Self::Response>, Status>;
                fn call(&mut self, request: Request<services::GetAccountRequest>) -> Self::Future {
                    let call = self.0.calls.fetch_add(1, Ordering::SeqCst);
                    let refuse = call < self.0.refusals;
                    let address = request.into_inner().address;
                    Box::pin(async move {
                        if refuse {
                            return Err(Status::failed_precondition(
                                "slot 101 is above the durable cursor 100; retry once the slot is durable",
                            ));
                        }
                        Ok(Response::new(core::Account {
                            address,
                            meta: Some(core::AccountMeta {
                                owner: Some(common::Pubkey { value: vec![0; 32] }),
                                balance: 42,
                                ..Default::default()
                            }),
                            ..Default::default()
                        }))
                    })
                }
            }
            let mut grpc = tonic::server::Grpc::new(tonic_prost::ProstCodec::default());
            Ok(grpc.unary(GetAccount(query), request).await)
        })
    }
}

async fn read_at_slot(
    refusals: usize,
) -> (thru_client::Result<Option<thru_client::Account>>, usize) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let calls = Arc::new(AtomicUsize::new(0));
    let query = Query {
        calls: calls.clone(),
        refusals,
    };
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
        .http_endpoint(format!("http://{address}").parse().unwrap())
        .build()
        .unwrap();
    let pubkey = thru_base::KeyPair::generate("reader")
        .unwrap()
        .address_string;
    let result = client.get_account_at_slot(&pubkey, 101).await;
    shutdown.send(()).unwrap();
    server.await.unwrap();
    (result, calls.load(Ordering::SeqCst))
}

#[tokio::test]
async fn slot_above_the_durable_cursor_is_retried_until_it_is_durable() {
    let (result, calls) = read_at_slot(2).await;
    assert_eq!(result.unwrap().unwrap().balance, 42);
    assert_eq!(calls, 3);
}

#[tokio::test]
async fn a_cursor_that_never_reaches_the_slot_fails_after_a_bounded_retry() {
    let (result, calls) = read_at_slot(usize::MAX).await;
    let error = result.unwrap_err().to_string();
    assert!(error.contains("above the durable cursor"), "{error}");
    assert_eq!(calls, 11);
}
