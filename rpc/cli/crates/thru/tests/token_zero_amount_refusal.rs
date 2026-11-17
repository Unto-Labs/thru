//! A token command that refuses a zero amount reports once: one JSON
//! document on stdout in `--json` mode, one error line on stderr otherwise.
#![cfg(unix)]

use std::path::Path;
use std::process::{Command, Output, Stdio};

/* Each row: the command's key in its JSON output, its arguments with a zero
 * amount, and the refusal message. */
const ZERO_AMOUNT_COMMANDS: [(&str, &[&str], &str); 4] = [
    (
        "token_transfer",
        &["token", "transfer", "a", "b", "0"],
        "Transfer amount must be greater than 0",
    ),
    (
        "token_transfer",
        &["token", "transfer", "a", "b", "0", "--unchecked"],
        "Transfer amount must be greater than 0",
    ),
    (
        "token_mint_to",
        &["token", "mint-to", "mint", "to", "authority", "0"],
        "Mint amount must be greater than 0",
    ),
    (
        "token_burn",
        &["token", "burn", "account", "mint", "authority", "0"],
        "Burn amount must be greater than 0",
    ),
];

/* A zero amount is refused before any key or RPC use, so the run needs no
 * server: nothing listens on the port. */
fn cli(home: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_thru"))
        .args(["--quiet", "--url", "http://127.0.0.1:1"])
        .args(args)
        .env("HOME", home)
        .env("THRU_DEVELOPERS_CREDENTIAL_STORE", "file")
        .env("NO_COLOR", "1")
        .env_remove("THRU_API_KEY")
        .env_remove("THRU_DEVELOPERS_API_KEY")
        .current_dir(home)
        .stdin(Stdio::null())
        .output()
        .expect("run thru")
}

#[test]
fn zero_amount_prints_one_json_document() {
    let home = tempfile::tempdir().unwrap();

    for (operation, command, message) in ZERO_AMOUNT_COMMANDS {
        let mut args = vec!["--json"];
        args.extend(command);
        let output = cli(home.path(), &args);
        let stdout = String::from_utf8_lossy(&output.stdout);

        assert_eq!(output.status.code(), Some(1), "{command:?}: {stdout}");
        /* Parsing fails if a second document follows the first. */
        let report: serde_json::Value = serde_json::from_str(&stdout).unwrap_or_else(|e| {
            panic!("{command:?}: stdout is not one JSON document ({e}):\n{stdout}")
        });
        assert_eq!(
            report,
            serde_json::json!({
                operation: { "status": "failed", "error": message, "error_type": "validation" }
            }),
            "{command:?}"
        );
    }
}

#[test]
fn zero_amount_prints_one_error_line_in_text_mode() {
    let home = tempfile::tempdir().unwrap();

    for (_, command, message) in ZERO_AMOUNT_COMMANDS {
        let output = cli(home.path(), command);
        let stderr = String::from_utf8_lossy(&output.stderr);

        assert_eq!(output.status.code(), Some(1), "{command:?}: {stderr}");
        assert!(output.stdout.is_empty(), "{command:?}: {:?}", output.stdout);
        let errors: Vec<&str> = stderr
            .lines()
            .filter(|line| line.contains("amount must be greater than 0"))
            .collect();
        assert_eq!(
            errors,
            [format!("Error: Validation error: {message}")],
            "{command:?}: {stderr}"
        );
    }
}
