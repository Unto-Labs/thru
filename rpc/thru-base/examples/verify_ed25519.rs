//! Independent-library check for the mpc-lib interop test: verify a Thru
//! transaction signature with ed25519-dalek.
//!
//! This uses `thru_base::tn_signature::verify_transaction`, which re-derives
//! `M = DST_TXN ‖ SHA-256(body)` from the raw body exactly like the node and
//! then verifies with dalek's `verify_strict` (plus the canonical A/R checks).
//! It is a *foreign* implementation cross-check -- NOT the node's C verifier
//! (that is `tn_verify_txn`, which calls `tn_signature_verify_txn`). Because it
//! is handed the body (not a pre-built M), a wrong DST/hash in the signer would
//! fail here too.
//!
//! Usage:
//!   cargo run -p thru-base --example verify_ed25519 -- body.bin sig.bin pub.raw

use std::fs;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 4 {
        eprintln!("usage: verify_ed25519 <body.bin> <sig.bin(64)> <pub.raw(32)>");
        std::process::exit(2);
    }
    let body = fs::read(&args[1]).expect("read body");
    let sig: [u8; 64] = fs::read(&args[2])
        .expect("read sig")
        .try_into()
        .expect("signature must be exactly 64 bytes (raw R‖S)");
    let pk: [u8; 32] = fs::read(&args[3])
        .expect("read pubkey")
        .try_into()
        .expect("public key must be exactly 32 bytes (raw Ed25519 point)");

    match thru_base::tn_signature::verify_transaction(&body, &sig, &pk) {
        Ok(()) => {
            println!(
                "ed25519-dalek verify_strict (independent library): ACCEPT — re-derived M from body ({} bytes) and accepts",
                body.len()
            );
        }
        Err(e) => {
            eprintln!("ed25519-dalek verify_strict: REJECT — {e:?}");
            std::process::exit(1);
        }
    }
}
