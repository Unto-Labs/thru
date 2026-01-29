use std::{env, process};

use bytemuck::from_bytes;
use thru_base::{tn_signature::verify_transaction, txn_lib::{WireTxnHdrV1, TN_TXN_SIGNATURE_SZ}};

fn main() {
    let mut args = env::args().skip(1);
    let Some(txn_hex) = args.next() else {
        eprintln!("usage: verify_txn <txn-hex>");
        process::exit(1);
    };

    let bytes = match hex::decode(&txn_hex) {
        Ok(b) => b,
        Err(e) => {
            eprintln!("invalid hex: {e}");
            process::exit(1);
        }
    };

    let min_size = core::mem::size_of::<WireTxnHdrV1>() + TN_TXN_SIGNATURE_SZ;
    if bytes.len() < min_size {
        eprintln!("transaction too short: {} bytes (min {})", bytes.len(), min_size);
        process::exit(1);
    }

    let hdr: &WireTxnHdrV1 = from_bytes(&bytes[..core::mem::size_of::<WireTxnHdrV1>()]);
    let sig: &[u8; TN_TXN_SIGNATURE_SZ] = bytes[bytes.len() - TN_TXN_SIGNATURE_SZ..].try_into().unwrap();
    let pubkey = &hdr.fee_payer_pubkey;
    // Message is everything except the trailing signature
    let msg = &bytes[..bytes.len() - TN_TXN_SIGNATURE_SZ];

    match verify_transaction(msg, sig, pubkey) {
        Ok(()) => {
            println!("signature OK for fee payer pubkey {}", hex::encode(pubkey));
            process::exit(0);
        }
        Err(e) => {
            eprintln!("signature verification failed: {e}");
            process::exit(2);
        }
    }
}
