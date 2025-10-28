use thru_rpc_client::{Client, Result};
use url::Url;

#[tokio::main]
async fn main() -> Result<()> {
    let client = Client::builder()
        .ws_endpoint(Some(
            Url::parse("wss://api.alphanet.thruput.org/ws").unwrap(),
        ))
        .auth_token(Some(
            std::env::var("RPC_AUTH_TOKEN").unwrap_or_else(|_| "YOUR_AUTH_TOKEN_HERE".to_string()),
        ))
        .build();

    // Rust client uses Authorization header during WebSocket handshake
    let ws_client = client.websocket().await?;
    let (subscription_id, mut notifications) = ws_client.slot_subscribe().await?;
    println!("subscription id: {:?}", subscription_id);

    Ok(())
}
