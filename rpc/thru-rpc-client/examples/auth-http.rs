use std::time::Duration;
use thru_rpc_client::{Client, Result};
use url::Url;

#[tokio::main]
async fn main() -> Result<()> {
    let client = Client::builder()
        .http_endpoint(Url::parse("https://api.alphanet.thruput.org/api").unwrap())
        .auth_token(Some("your-api-key-here".to_string()))
        .timeout(Duration::from_secs(30))
        .build();

    // HTTP requests will include the Authorization header automatically
    let version = client.get_version().await?;
    println!("version: {:?}", version);

    Ok(())
}
