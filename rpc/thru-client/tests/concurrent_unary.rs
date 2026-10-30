//! One client must carry a load-generator fleet's concurrent unary calls.

use std::convert::Infallible;
use std::sync::Arc;
use std::task::{Context, Poll};
use std::time::Duration;
use thru_client::{
    Client,
    proto::{common::v1 as common, core::v1 as core, services::v1 as services},
};
use tokio::sync::Barrier;
use tonic::{
    Request, Response, Status,
    body::Body,
    codegen::{BoxFuture, Service, http},
};

const GENERATORS: usize = 832;

/// Answers GetAccount only once every generator's request has arrived, so the
/// replies reach the client together.
#[derive(Clone)]
struct Query(Arc<Barrier>);

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
        let barrier = self.0.clone();
        Box::pin(async move {
            struct GetAccount(Arc<Barrier>);
            impl tonic::server::UnaryService<services::GetAccountRequest> for GetAccount {
                type Response = core::Account;
                type Future = BoxFuture<Response<Self::Response>, Status>;
                fn call(&mut self, request: Request<services::GetAccountRequest>) -> Self::Future {
                    let barrier = self.0.clone();
                    let address = request.into_inner().address;
                    Box::pin(async move {
                        barrier.wait().await;
                        Ok(Response::new(core::Account {
                            address,
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
            let mut grpc = tonic::server::Grpc::new(tonic_prost::ProstCodec::default());
            Ok(grpc.unary(GetAccount(barrier), request).await)
        })
    }
}

/* Each reply is one DATA frame far below 256 bytes. The client must hold all
of them unread at once without tearing down the shared connection. */
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn fleet_nonce_replies_arriving_together_keep_the_connection() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (shutdown, done) = tokio::sync::oneshot::channel();
    let server = tokio::spawn(async move {
        tonic::transport::Server::builder()
            .add_service(Query(Arc::new(Barrier::new(GENERATORS))))
            .serve_with_incoming_shutdown(
                tokio_stream::wrappers::TcpListenerStream::new(listener),
                async {
                    let _ = done.await;
                },
            )
            .await
            .unwrap();
    });
    let client = Arc::new(
        Client::builder()
            .http_endpoint(format!("http://{address}").parse().unwrap())
            .build()
            .unwrap(),
    );
    let pubkey = thru_base::KeyPair::generate("generator")
        .unwrap()
        .address_string;
    let mut fetches = Vec::with_capacity(GENERATORS);
    /* Requests trickle in so the server reads each as it lands; only the
    replies arrive as a burst. */
    for _ in 0..GENERATORS {
        let client = client.clone();
        let pubkey = pubkey.clone();
        fetches.push(tokio::spawn(async move {
            client.get_account_info(&pubkey, None, None).await
        }));
        tokio::time::sleep(Duration::from_micros(200)).await;
    }
    let mut failures = std::collections::BTreeMap::<String, usize>::new();
    for fetch in fetches {
        if let Err(e) = fetch.await.unwrap() {
            *failures.entry(e.to_string()).or_default() += 1;
        }
    }
    shutdown.send(()).unwrap();
    server.await.unwrap();
    assert!(failures.is_empty(), "nonce fetches failed: {failures:#?}");
}
