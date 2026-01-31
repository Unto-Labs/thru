use std::env;

use serde_json::json;
use thru_base::{KeyPair, tn_tools::Pubkey};
use sha2::{Digest, Sha256};

fn create_program_defined_account_address(owner: &[u8; 32], is_ephemeral: bool, seed: &[u8; 32]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(owner);
    hasher.update(&[if is_ephemeral { 1u8 } else { 0u8 }]);
    hasher.update(seed);
    let hash = hasher.finalize();
    let mut out = [0u8; 32];
    out.copy_from_slice(&hash[..32]);
    out
}

fn pad_seed(seed: &[u8]) -> [u8; 32] {
    let mut padded = [0u8; 32];
    let len = seed.len().min(32);
    padded[..len].copy_from_slice(&seed[..len]);
    padded
}

fn main() {
    let args: Vec<String> = env::args().collect();

    // Modes:
    //   1) No args: generate a fresh keypair
    //   2) --from-hex <64hex>: derive address/pubkey from an existing private key
    //   3) --derive-wthru-mint <token_program_ta> <wthru_program_ta>: print WTHRU mint & vault addresses
    if args.len() >= 2 && args[1] == "--derive-wthru-mint" {
        if args.len() < 4 {
            eprintln!("usage: thru-keygen --derive-wthru-mint <token_program> <wthru_program>");
            std::process::exit(2);
        }
        let token_prog = &args[2];
        let wthru_prog = &args[3];
        let token_pub = Pubkey::new(token_prog.clone())
            .and_then(|p| p.to_bytes().map_err(|e| e.into()))
            .expect("invalid token program pubkey");
        let wthru_pub = Pubkey::new(wthru_prog.clone())
            .and_then(|p| p.to_bytes().map_err(|e| e.into()))
            .expect("invalid wthru program pubkey");

        // mint seed = "wthru" padded to 32
        let mint_seed = pad_seed(b"wthru");
        // derived_seed = sha256(wthru_program || mint_seed)
        let mut hasher = Sha256::new();
        hasher.update(&wthru_pub);
        hasher.update(&mint_seed);
        let hash = hasher.finalize();
        let mut derived_seed = [0u8; 32];
        derived_seed.copy_from_slice(&hash[..32]);
        // mint = create_program_defined_account_address(token_program, false, derived_seed)
        let mint_bytes = create_program_defined_account_address(&token_pub, false, &derived_seed);
        // vault = create_program_defined_account_address(wthru_program, false, pad_seed("vault"))
        let vault_seed = pad_seed(b"vault");
        let vault_bytes = create_program_defined_account_address(&wthru_pub, false, &vault_seed);

        let mint_addr = Pubkey::from_bytes(&mint_bytes).to_string();
        let vault_addr = Pubkey::from_bytes(&vault_bytes).to_string();
        let out = json!({
            "mint": mint_addr,
            "vault": vault_addr,
            "token_program": token_prog,
            "wthru_program": wthru_prog,
        });
        println!("{}", serde_json::to_string_pretty(&out).unwrap());
        return;
    }

    let result = if args.len() >= 3 && args[1] == "--from-hex" {
        let hex_pk = &args[2];
        KeyPair::from_hex_private_key("key", hex_pk)
            .map_err(|e| format!("failed to derive from hex: {}", e))
    } else {
        KeyPair::generate("key").map_err(|e| format!("failed to generate key: {}", e))
    };

    match result {
        Ok(keypair) => {
            let private_key_hex = hex::encode(keypair.private_key);
            let public_key_hex = keypair.public_key_hex();
            let address = keypair.public_key_str();
            let out = json!({
                "private_key_hex": private_key_hex,
                "public_key_hex": public_key_hex,
                "address": address,
            });
            println!("{}", serde_json::to_string_pretty(&out).unwrap());
        }
        Err(err) => {
            eprintln!("{}", err);
            std::process::exit(1);
        }
    }
}
