//! Pointers to a Thru API key for callers who have none: a hint after a
//! rate-limit error, and a one-time note on the first interactive run against
//! an official RPC endpoint. On an interactive terminal both offer to sign in
//! (see [`can_offer_sign_in`]).

use std::io::{BufRead, IsTerminal, Write};

use crate::{
    commands::developers::write_owner_only_file,
    config::{Config, api_key_eligible_endpoint},
    error::CliError,
};

/// Printed after a rate-limit error (as `hint: ...`, or as the `hint` field
/// in `--json` output) when no API key is configured.
pub const RATE_LIMIT_HINT: &str =
    "run `thru auth login`, or set THRU_API_KEY (get a key at https://dev.thru.org/keys?ref=cli)";

/// Printed once per machine; see [`show_no_api_key_note_once`].
pub const NO_API_KEY_NOTE: &str = "note: no API key configured; RPC calls are limited to 10 weighted requests/s per IP. Run `thru auth login` or set THRU_API_KEY for higher limits (https://thru.org/docs/api-ref/rate-limits/).";

/// Marker file in the CLI config directory recording that
/// [`NO_API_KEY_NOTE`] was shown.
pub const NO_API_KEY_NOTICE_MARKER: &str = "no-api-key-notice";

/// The hint to show after `err`: [`RATE_LIMIT_HINT`] for a rate-limit error
/// when no API key is configured, else `None`. `has_api_key` is called only
/// for a rate-limit error, since it may read the stored API key.
pub fn rate_limit_hint(err: &CliError, has_api_key: impl FnOnce() -> bool) -> Option<&'static str> {
    match err {
        CliError::RateLimited { .. } if !has_api_key() => Some(RATE_LIMIT_HINT),
        _ => None,
    }
}

/// Whether to show [`NO_API_KEY_NOTE`]: on an interactive run against an
/// official endpoint with no API key, unless it was shown before.
pub fn should_show_no_api_key_note(
    interactive: bool,
    official_endpoint: bool,
    has_api_key: bool,
    marker_exists: bool,
) -> bool {
    interactive && official_endpoint && !has_api_key && !marker_exists
}

/// Prints [`NO_API_KEY_NOTE`] to stderr when [`should_show_no_api_key_note`]
/// says so, then records that in the marker file so it is never shown again.
/// A marker that cannot be written is ignored: the note shows again next run.
/// Returns whether the note was shown.
pub fn show_no_api_key_note_once(config: &Config, interactive: bool) -> bool {
    if !interactive {
        return false;
    }
    /* Without a config directory there is nowhere to record the note, so
    skip it rather than repeat it on every run. */
    let Ok(dir) = Config::get_config_dir() else {
        return false;
    };
    let marker = dir.join(NO_API_KEY_NOTICE_MARKER);
    if !should_show_no_api_key_note(
        interactive,
        api_key_eligible_endpoint(&config.rpc_base_url, config.insecure),
        config.rpc_auth_token_present(),
        std::fs::symlink_metadata(&marker).is_ok(),
    ) {
        return false;
    }
    eprintln!("{NO_API_KEY_NOTE}");
    let _ = write_owner_only_file(&dir, &marker, b"");
    true
}

/// The question asked after the no-key note and the rate-limit hint.
pub const SIGN_IN_PROMPT: &str = "Sign in now? [Y/n] ";

/// Whether the CLI may ask [`SIGN_IN_PROMPT`]: only when a person can answer
/// and watch (stdin, stdout and stderr are terminals) and output is neither
/// `--json` nor `--quiet`. Never in scripts, pipes or CI: the login prints to
/// stdout, which must not end up in a redirected command's output.
pub fn can_offer_sign_in(
    stdin_tty: bool,
    stdout_tty: bool,
    stderr_tty: bool,
    json: bool,
    quiet: bool,
) -> bool {
    stdin_tty && stdout_tty && stderr_tty && !json && !quiet
}

/// Whether an answer to [`SIGN_IN_PROMPT`] accepts: empty (the default), `y`
/// or `yes` in any case. End of input (`None`) declines.
pub fn accepts_sign_in(answer: Option<&str>) -> bool {
    match answer.map(str::trim) {
        Some(answer) => {
            answer.is_empty()
                || answer.eq_ignore_ascii_case("y")
                || answer.eq_ignore_ascii_case("yes")
        }
        None => false,
    }
}

/// Writes [`SIGN_IN_PROMPT`] to `output` and reads one answer from `input`.
/// A read error counts as end of input.
pub fn ask_sign_in(input: &mut impl BufRead, output: &mut impl Write) -> bool {
    let _ = output.write_all(SIGN_IN_PROMPT.as_bytes());
    let _ = output.flush();
    let mut answer = String::new();
    match input.read_line(&mut answer) {
        Ok(0) | Err(_) => {
            /* End the prompt line so later output starts on its own line. */
            let _ = writeln!(output);
            false
        }
        Ok(_) => accepts_sign_in(Some(&answer)),
    }
}

/// Asks [`SIGN_IN_PROMPT`] on the terminal when [`can_offer_sign_in`] allows
/// it; otherwise declines without prompting.
pub fn offer_sign_in(json: bool, quiet: bool) -> bool {
    can_offer_sign_in(
        std::io::stdin().is_terminal(),
        std::io::stdout().is_terminal(),
        std::io::stderr().is_terminal(),
        json,
        quiet,
    ) && ask_sign_in(&mut std::io::stdin().lock(), &mut std::io::stderr())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sign_in_is_offered_only_to_a_person_at_a_terminal() {
        assert!(can_offer_sign_in(true, true, true, false, false));
        assert!(!can_offer_sign_in(false, true, true, false, false));
        assert!(!can_offer_sign_in(true, false, true, false, false));
        assert!(!can_offer_sign_in(true, true, false, false, false));
        assert!(!can_offer_sign_in(true, true, true, true, false));
        assert!(!can_offer_sign_in(true, true, true, false, true));
    }

    #[test]
    fn sign_in_answer_defaults_to_yes_and_eof_declines() {
        for answer in ["", "\n", "y\n", "Y", " yes ", "YES\r\n"] {
            assert!(accepts_sign_in(Some(answer)), "{answer:?}");
        }
        for answer in ["n", "N\n", "no", "maybe", "yy"] {
            assert!(!accepts_sign_in(Some(answer)), "{answer:?}");
        }
        assert!(!accepts_sign_in(None));
    }

    #[test]
    fn ask_sign_in_prompts_once_and_reads_one_line() {
        let mut output = Vec::new();
        assert!(ask_sign_in(&mut "\nn\n".as_bytes(), &mut output));
        assert_eq!(output, SIGN_IN_PROMPT.as_bytes());
        let mut output = Vec::new();
        assert!(!ask_sign_in(&mut "n\n".as_bytes(), &mut output));
        let mut output = Vec::new();
        assert!(!ask_sign_in(&mut "".as_bytes(), &mut output));
        assert_eq!(output, format!("{SIGN_IN_PROMPT}\n").as_bytes());
    }

    #[test]
    fn note_shows_only_on_first_interactive_keyless_official_run() {
        assert!(should_show_no_api_key_note(true, true, false, false));
        assert!(!should_show_no_api_key_note(false, true, false, false));
        assert!(!should_show_no_api_key_note(true, false, false, false));
        assert!(!should_show_no_api_key_note(true, true, true, false));
        assert!(!should_show_no_api_key_note(true, true, false, true));
    }

    #[test]
    fn hint_only_for_keyless_rate_limit() {
        let rate_limited = CliError::RateLimited {
            message: "rate limit exceeded".into(),
            unkeyed: true,
        };
        assert_eq!(
            rate_limit_hint(&rate_limited, || false),
            Some(RATE_LIMIT_HINT)
        );
        assert_eq!(rate_limit_hint(&rate_limited, || true), None);
        let other = CliError::Rpc("code: 'Internal error'".into());
        assert_eq!(
            rate_limit_hint(&other, || panic!(
                "key looked up for a non-rate-limit error"
            )),
            None
        );
    }

    #[test]
    fn token_presence_matches_what_would_be_sent() {
        let keyless = Config {
            rpc_base_url: "https://rpc.alphanet.thru.org".into(),
            ..Config::default()
        };
        assert!(!keyless.rpc_auth_token_present());
        let env_key = Config {
            env_api_key: Some("thru_env".into()),
            ..keyless.clone()
        };
        assert!(env_key.rpc_auth_token_present());
        /* An environment key is withheld from an unofficial endpoint. */
        let withheld = Config {
            rpc_base_url: "https://other.example".into(),
            ..env_key.clone()
        };
        assert!(!withheld.rpc_auth_token_present());
        let configured = Config {
            auth_token: Some("configured".into()),
            ..withheld
        };
        assert!(configured.rpc_auth_token_present());
    }
}
