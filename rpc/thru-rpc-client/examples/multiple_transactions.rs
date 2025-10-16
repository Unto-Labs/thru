use base64::Engine;
use std::error::Error;
use thru_rpc_client::ClientBuilder;
use url::Url;

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    // Create a client
    let client = ClientBuilder::new()
        .http_endpoint(Url::parse("http://127.0.0.1:8080")?)
        .build();

    // Example transaction data (base64 encoded)
    let tx1 = base64::engine::general_purpose::STANDARD.decode("dGVzdF90cmFuc2FjdGlvbl8x")?; // "test_transaction_1"
    let tx2 = base64::engine::general_purpose::STANDARD.decode("dGVzdF90cmFuc2FjdGlvbl8y")?; // "test_transaction_2"
    let tx3 = base64::engine::general_purpose::STANDARD.decode("dGVzdF90cmFuc2FjdGlvbl8z")?; // "test_transaction_3"

    println!("Sending single transaction...");
    // Send a single transaction
    match client.send_transaction(&tx1).await {
        Ok(signature) => {
            println!("Single transaction sent successfully:");
            println!("  Signature: {}", signature);
        }
        Err(e) => {
            println!("Failed to send single transaction: {}", e);
        }
    }

    println!("\nSending multiple transactions...");
    // Send multiple transactions
    let transactions = [tx1.as_slice(), tx2.as_slice(), tx3.as_slice()];
    match client.send_transactions(&transactions).await {
        Ok(signatures) => {
            println!("Multiple transactions sent successfully:");
            for (i, signature) in signatures.iter().enumerate() {
                println!("  Transaction {}: {}", i + 1, signature);
            }
            println!("Total transactions sent: {}", signatures.len());
        }
        Err(e) => {
            println!("Failed to send multiple transactions: {}", e);
        }
    }

    Ok(())
}
