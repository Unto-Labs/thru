//! Once execution has been observed, query failures must not erase its outcome.

use std::convert::Infallible;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
use std::task::{Context, Poll};
use std::time::Duration;
use thru_client::{
    Client, ClientError,
    proto::{common::v1 as common, core::v1 as core, services::v1 as services},
};
use tonic::{
    Request, Response, Status,
    body::Body,
    codegen::{BoxFuture, Service, http},
};

#[derive(Clone)]
struct Rpc<const QUERY: bool> {
    outcome: services::SendAndTrackTxnResponse,
    query: Result<core::Transaction, Status>,
    submissions: Arc<AtomicUsize>,
}

impl<const QUERY: bool> tonic::server::NamedService for Rpc<QUERY> {
    const NAME: &'static str = if QUERY {
        "thru.services.v1.QueryService"
    } else {
        "thru.services.v1.CommandService"
    };
}

impl<const QUERY: bool> Service<http::Request<Body>> for Rpc<QUERY> {
    type Response = http::Response<Body>;
    type Error = Infallible;
    type Future = BoxFuture<Self::Response, Self::Error>;

    fn poll_ready(&mut self, _: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        Poll::Ready(Ok(()))
    }

    fn call(&mut self, request: http::Request<Body>) -> Self::Future {
        let rpc = self.clone();
        Box::pin(async move {
            if QUERY {
                struct Query(Result<core::Transaction, Status>);
                impl tonic::server::UnaryService<services::GetTransactionRequest> for Query {
                    type Response = core::Transaction;
                    type Future = BoxFuture<Response<Self::Response>, Status>;
                    fn call(
                        &mut self,
                        _: Request<services::GetTransactionRequest>,
                    ) -> Self::Future {
                        let result = self.0.clone();
                        Box::pin(async move { result.map(Response::new) })
                    }
                }
                let mut grpc = tonic::server::Grpc::new(tonic_prost::ProstCodec::default());
                Ok(grpc.unary(Query(rpc.query), request).await)
            } else {
                struct Track(services::SendAndTrackTxnResponse);
                impl tonic::server::ServerStreamingService<services::SendAndTrackTxnRequest> for Track {
                    type Response = services::SendAndTrackTxnResponse;
                    type ResponseStream =
                        tokio_stream::Iter<std::vec::IntoIter<Result<Self::Response, Status>>>;
                    type Future = BoxFuture<Response<Self::ResponseStream>, Status>;
                    fn call(
                        &mut self,
                        _: Request<services::SendAndTrackTxnRequest>,
                    ) -> Self::Future {
                        let result = self.0.clone();
                        Box::pin(
                            async move { Ok(Response::new(tokio_stream::iter(vec![Ok(result)]))) },
                        )
                    }
                }
                rpc.submissions.fetch_add(1, Ordering::Relaxed);
                let mut grpc = tonic::server::Grpc::new(tonic_prost::ProstCodec::default());
                Ok(grpc.server_streaming(Track(rpc.outcome), request).await)
            }
        })
    }
}

async fn execute(
    outcome: services::SendAndTrackTxnResponse,
    query: Result<core::Transaction, Status>,
) -> ClientError {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let submissions = Arc::new(AtomicUsize::new(0));
    let command = Rpc::<false> {
        outcome: outcome.clone(),
        query: query.clone(),
        submissions: submissions.clone(),
    };
    let query_service = Rpc::<true> {
        outcome,
        query,
        submissions: submissions.clone(),
    };
    let (shutdown, done) = tokio::sync::oneshot::channel();
    let server = tokio::spawn(async move {
        tonic::transport::Server::builder()
            .add_service(command)
            .add_service(query_service)
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
    let error = client
        .execute_transaction(&[7; 64], Duration::from_secs(1))
        .await
        .unwrap_err();
    shutdown.send(()).unwrap();
    server.await.unwrap();
    assert_eq!(
        submissions.load(Ordering::Relaxed),
        1,
        "query failures must not resubmit"
    );
    error
}

#[tokio::test]
async fn confirmed_query_miss_retains_signature_and_successful_execution() {
    let outcome = services::SendAndTrackTxnResponse {
        consensus_status: common::ConsensusStatus::LocallyExecuted as i32,
        execution_result: Some(core::TransactionExecutionResult::default()),
        ..Default::default()
    };
    let error = execute(outcome.clone(), Err(Status::not_found("index not ready"))).await;
    match error {
        ClientError::TransactionDetailsUnavailable {
            signature,
            outcome: actual,
            source,
        } => {
            assert_eq!(
                signature,
                thru_base::tn_signature_encoding::tn_signature_to_string(&[7; 64])
            );
            assert_eq!(*actual, outcome);
            assert!(matches!(*source, ClientError::TransactionVerification(_)));
        }
        other => panic!("lost the observed transaction: {other:?}"),
    }
}

#[tokio::test]
async fn query_rpc_error_does_not_erase_streamed_execution_failure() {
    let outcome = services::SendAndTrackTxnResponse {
        execution_result: Some(core::TransactionExecutionResult {
            vm_error: -511,
            fee_payer_expected_nonce: Some(1),
            ..Default::default()
        }),
        ..Default::default()
    };
    let error = execute(outcome.clone(), Err(Status::unavailable("query down"))).await;
    match error {
        ClientError::TransactionDetailsUnavailable {
            outcome: actual,
            source,
            ..
        } => {
            assert_eq!(*actual, outcome);
            assert!(matches!(*source, ClientError::Rpc(_)));
        }
        other => panic!("lost the execution rejection: {other:?}"),
    }
}

#[tokio::test]
async fn malformed_details_do_not_fabricate_an_absent_stream_execution_result() {
    let outcome = services::SendAndTrackTxnResponse {
        consensus_status: common::ConsensusStatus::Finalized as i32,
        ..Default::default()
    };
    let query = core::Transaction {
        slot: Some(42),
        ..Default::default()
    };
    let error = execute(outcome.clone(), Ok(query)).await;
    match error {
        ClientError::TransactionDetailsUnavailable {
            outcome: actual,
            source,
            ..
        } => {
            assert_eq!(*actual, outcome);
            assert!(actual.execution_result.is_none());
            assert!(matches!(*source, ClientError::Rpc(_)));
        }
        other => panic!("lost confirmation on malformed details: {other:?}"),
    }
}
