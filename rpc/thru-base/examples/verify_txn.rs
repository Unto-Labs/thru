use std::{env, process};

use bytemuck::from_bytes;
use thru_base::{tn_signature::verify_transaction, txn_lib::WireTxnHdrV1};

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

    if bytes.len() < core::mem::size_of::<WireTxnHdrV1>() {
        eprintln!("transaction too short: {} bytes", bytes.len());
        process::exit(1);
    }

    let hdr: &WireTxnHdrV1 = from_bytes(&bytes[..core::mem::size_of::<WireTxnHdrV1>()]);
    let sig = &hdr.fee_payer_signature;
    let pubkey = &hdr.fee_payer_pubkey;
    let msg = &bytes[64..];

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
