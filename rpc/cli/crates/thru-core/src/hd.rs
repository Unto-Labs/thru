//! BIP-39 recovery phrases and SLIP-0010 Ed25519 key derivation on the Thru
//! path `m/44'/8478'/<account>'/<change>'`
//! (`specs/hd-derivation/thru-hd-derivation.md`).
//!
//! Errors never contain phrase words or key material.

use crate::{error::CliError, keys::generate_seed};
use bip39::{Language, Mnemonic};
use hmac::{Hmac, KeyInit, Mac};
use sha2::Sha512;
use std::{
    fmt::{self, Write as _},
    io::{self, Read},
    str::FromStr,
};
use zeroize::Zeroizing;

/// SLIP-44 coin type of Thru.
pub const THRU_COIN_TYPE: u32 = 8478;
const PURPOSE: u32 = 44;
const HARDENED: u32 = 0x8000_0000;
/// Upper bound on a phrase read from a file or stdin. 24 English words with
/// single spaces fit in 215 bytes; this leaves room for stray whitespace.
const MAX_PHRASE_BYTES: usize = 4096;
/// 24 words of at most 8 letters and 23 separating spaces.
const MAX_GENERATED_PHRASE_BYTES: usize = 24 * 8 + 23;

fn invalid(message: impl Into<String>) -> CliError {
    CliError::Validation(message.into())
}

/// A Thru derivation path `m/44'/8478'/<account>'/<change>'`. Every level is
/// hardened; both indices are below 2^31.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HdPath {
    account: u32,
    change: u32,
}

impl HdPath {
    pub fn new(account: u32, change: u32) -> Result<Self, CliError> {
        for (name, index) in [("account", account), ("change", change)] {
            if index >= HARDENED {
                return Err(invalid(format!(
                    "Derivation path {name} index must be below 2^31"
                )));
            }
        }
        Ok(Self { account, change })
    }

    /// `m/44'/8478'/<account>'/0'`.
    pub fn for_account(account: u32) -> Result<Self, CliError> {
        Self::new(account, 0)
    }

    fn components(&self) -> [u32; 4] {
        [PURPOSE, THRU_COIN_TYPE, self.account, self.change].map(|index| index | HARDENED)
    }
}

impl fmt::Display for HdPath {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "m/{PURPOSE}'/{THRU_COIN_TYPE}'/{}'/{}'",
            self.account, self.change
        )
    }
}

impl FromStr for HdPath {
    type Err = CliError;

    /// Parse `m/44'/8478'/<account>'/<change>'`: exactly four hardened
    /// decimal indices without leading zeros.
    fn from_str(text: &str) -> Result<Self, CliError> {
        let usage = || {
            invalid(format!(
                "Derivation path must be m/44'/{THRU_COIN_TYPE}'/<account>'/<change>' with every level hardened"
            ))
        };
        let rest = text.strip_prefix("m/").ok_or_else(usage)?;
        let mut indices = Vec::with_capacity(4);
        for level in rest.split('/') {
            let digits = level.strip_suffix('\'').ok_or_else(usage)?;
            if digits.is_empty()
                || !digits.bytes().all(|byte| byte.is_ascii_digit())
                || (digits.len() > 1 && digits.starts_with('0'))
            {
                return Err(usage());
            }
            let index: u32 = digits.parse().map_err(|_| usage())?;
            if index >= HARDENED {
                return Err(usage());
            }
            indices.push(index);
        }
        match indices[..] {
            [PURPOSE, THRU_COIN_TYPE, account, change] => Self::new(account, change),
            [PURPOSE, coin, _, _] => Err(invalid(format!(
                "Derivation path coin type must be {THRU_COIN_TYPE}', got {coin}'"
            ))),
            _ => Err(usage()),
        }
    }
}

/// A new 24-word English recovery phrase from 256 bits of OS randomness.
pub fn generate_phrase() -> Result<Zeroizing<String>, CliError> {
    let entropy = generate_seed()?;
    let mnemonic = Mnemonic::from_entropy_in(Language::English, entropy.as_ref())
        .map_err(|_| invalid("Could not encode a recovery phrase"))?;
    // Reserve the whole phrase up front: a growing string would free earlier,
    // unwiped copies of it.
    let mut phrase = Zeroizing::new(String::with_capacity(MAX_GENERATED_PHRASE_BYTES));
    write!(phrase, "{mnemonic}").map_err(|_| invalid("Could not encode a recovery phrase"))?;
    Ok(phrase)
}

/// Read a recovery phrase (UTF-8, at most 4 KiB) from a file or stdin into a
/// fixed buffer (as `thru_base::key_file::read_key_file` does), so no
/// reallocation leaves an unwiped copy behind.
pub fn read_phrase(reader: impl Read) -> Result<Zeroizing<String>, CliError> {
    read_phrase_until(reader, false)
}

/// Read the recovery phrase for `--stdin`. At a terminal (Unix), prompt for
/// it on stderr and read one line with echo off, so the phrase never appears
/// on screen or in scrollback; otherwise read the whole input.
pub fn read_phrase_from_stdin() -> Result<Zeroizing<String>, CliError> {
    #[cfg(unix)]
    if std::io::IsTerminal::is_terminal(&std::io::stdin()) {
        return terminal::read_hidden_line();
    }
    read_phrase(std::io::stdin().lock())
}

/// [`read_phrase`]; with `line`, stop after the read that returns a newline
/// (a terminal in canonical mode returns at most one line per read).
fn read_phrase_until(reader: impl Read, line: bool) -> Result<Zeroizing<String>, CliError> {
    let mut raw = Zeroizing::new([0u8; MAX_PHRASE_BYTES + 1]);
    let mut length = 0;
    let mut reader = reader.take(raw.len() as u64);
    while length < raw.len() {
        match reader.read(&mut raw[length..]) {
            Ok(0) => break,
            Ok(count) => {
                length += count;
                if line && raw[length - count..length].contains(&b'\n') {
                    break;
                }
            }
            Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
            Err(error) => {
                return Err(invalid(format!(
                    "Could not read the recovery phrase: {}",
                    error.kind()
                )));
            }
        }
    }
    if length > MAX_PHRASE_BYTES {
        return Err(invalid("Recovery phrase input is larger than 4 KiB"));
    }
    let text = std::str::from_utf8(&raw[..length])
        .map_err(|_| invalid("Recovery phrase is not valid UTF-8"))?;
    Ok(Zeroizing::new(text.to_owned()))
}

/// Echo-free terminal input. Echo is restored when the read returns and, through
/// a temporary handler, when SIGINT, SIGTERM, SIGHUP or SIGQUIT arrives; the
/// handler then re-raises the signal, so it still ends the process.
#[cfg(unix)]
mod terminal {
    use super::{CliError, Zeroizing, invalid, read_phrase_until};
    use std::{
        io::Write,
        mem::MaybeUninit,
        os::fd::AsRawFd,
        sync::atomic::{AtomicBool, Ordering},
    };

    const SIGNALS: [libc::c_int; 4] = [libc::SIGINT, libc::SIGTERM, libc::SIGHUP, libc::SIGQUIT];

    /// The descriptor and settings the signal handler restores. Written only
    /// while `ARMED` is false, before the handlers are installed.
    static mut SAVED: MaybeUninit<(libc::c_int, libc::termios)> = MaybeUninit::uninit();
    static ARMED: AtomicBool = AtomicBool::new(false);

    extern "C" fn restore_and_reraise(signal: libc::c_int) {
        // Only async-signal-safe calls: tcsetattr, signal, raise.
        if ARMED.load(Ordering::SeqCst) {
            // SAFETY: SAVED is initialized before ARMED is set and is not
            // written again until ARMED is cleared.
            let (fd, original) =
                unsafe { &*(&raw const SAVED).cast::<(libc::c_int, libc::termios)>() };
            unsafe { libc::tcsetattr(*fd, libc::TCSANOW, original) };
        }
        unsafe {
            libc::signal(signal, libc::SIG_DFL);
            libc::raise(signal);
        }
    }

    /// Restores the terminal settings, then the previous signal handlers.
    struct EchoOff {
        fd: libc::c_int,
        original: libc::termios,
        previous: [Option<libc::sigaction>; SIGNALS.len()],
    }

    impl Drop for EchoOff {
        fn drop(&mut self) {
            unsafe { libc::tcsetattr(self.fd, libc::TCSANOW, &self.original) };
            ARMED.store(false, Ordering::SeqCst);
            for (signal, previous) in SIGNALS.iter().zip(&self.previous) {
                if let Some(previous) = previous {
                    unsafe { libc::sigaction(*signal, previous, std::ptr::null_mut()) };
                }
            }
        }
    }

    fn echo_off(fd: libc::c_int) -> Result<EchoOff, CliError> {
        let terminal_error = || invalid("Could not turn off terminal echo for the recovery phrase");
        let mut original = MaybeUninit::<libc::termios>::uninit();
        if unsafe { libc::tcgetattr(fd, original.as_mut_ptr()) } != 0 {
            return Err(terminal_error());
        }
        // SAFETY: tcgetattr succeeded and filled the struct.
        let original = unsafe { original.assume_init() };
        if ARMED.load(Ordering::SeqCst) {
            return Err(invalid("A recovery phrase prompt is already active"));
        }
        // SAFETY: not armed, so the signal handler does not read SAVED.
        unsafe { (&raw mut SAVED).write(MaybeUninit::new((fd, original))) };
        ARMED.store(true, Ordering::SeqCst);
        let mut guard = EchoOff {
            fd,
            original,
            previous: [None; SIGNALS.len()],
        };
        for (signal, previous) in SIGNALS.iter().zip(&mut guard.previous) {
            // SAFETY: a zeroed sigaction with an empty mask and no flags is valid.
            let mut action: libc::sigaction = unsafe { std::mem::zeroed() };
            action.sa_sigaction = restore_and_reraise as extern "C" fn(libc::c_int) as usize;
            unsafe { libc::sigemptyset(&mut action.sa_mask) };
            let mut old = MaybeUninit::<libc::sigaction>::uninit();
            if unsafe { libc::sigaction(*signal, &action, old.as_mut_ptr()) } != 0 {
                return Err(terminal_error());
            }
            *previous = Some(unsafe { old.assume_init() });
        }
        let mut hidden = original;
        hidden.c_lflag &= !(libc::ECHO | libc::ECHOE | libc::ECHOK);
        // Still echo the newline, so the cursor leaves the prompt line.
        hidden.c_lflag |= libc::ECHONL;
        // TCSAFLUSH also discards anything typed (and echoed) before the prompt.
        if unsafe { libc::tcsetattr(fd, libc::TCSAFLUSH, &hidden) } != 0 {
            return Err(terminal_error());
        }
        Ok(guard)
    }

    pub(super) fn read_hidden_line() -> Result<Zeroizing<String>, CliError> {
        let stdin = std::io::stdin();
        let _echo_off = echo_off(stdin.as_raw_fd())?;
        let mut stderr = std::io::stderr();
        let _ = write!(
            stderr,
            "Enter the recovery phrase (input is hidden), then press Enter: "
        );
        let _ = stderr.flush();
        read_phrase_until(stdin.lock(), true)
    }
}

/// Validate an English BIP-39 phrase (word list and checksum). As an input
/// convenience, ASCII case and whitespace are not significant (the TypeScript
/// SDK accepts only lowercase words separated by single spaces); the seed is
/// always computed from the canonical words, so any phrase both accept
/// derives the same keys.
fn parse_phrase(phrase: &str) -> Result<Mnemonic, CliError> {
    // English words are ASCII. Lowercase in place in an exact-size copy:
    // Unicode lowercasing can grow the string and free an unwiped copy.
    let mut lowered = Zeroizing::new(phrase.to_owned());
    lowered.make_ascii_lowercase();
    Mnemonic::parse_in(Language::English, lowered.as_str()).map_err(|error| {
        invalid(match error {
            bip39::Error::BadWordCount(count) => {
                format!("Recovery phrase has {count} words; expected 12, 15, 18, 21 or 24")
            }
            bip39::Error::UnknownWord(index) => format!(
                "Recovery phrase word {} is not in the English BIP-39 word list",
                index + 1
            ),
            bip39::Error::InvalidChecksum => {
                "Recovery phrase checksum is invalid; check the words and their order".into()
            }
            _ => "Recovery phrase is invalid".into(),
        })
    })
}

fn hmac_sha512(key: &[u8], parts: &[&[u8]]) -> Zeroizing<[u8; 64]> {
    let mut mac = Hmac::<Sha512>::new_from_slice(key).expect("HMAC takes any key length");
    for part in parts {
        mac.update(part);
    }
    Zeroizing::new(mac.finalize().into_bytes().into())
}

/// SLIP-0010 Ed25519: the 32-byte private key at `path` under a 64-byte
/// BIP-39 seed. Each node is the private key (left half) and chain code
/// (right half) of one HMAC-SHA512 output.
fn derive_slip10(seed: &[u8; 64], path: HdPath) -> Zeroizing<[u8; 32]> {
    let mut node = hmac_sha512(b"ed25519 seed", &[seed]);
    for index in path.components() {
        node = hmac_sha512(&node[32..], &[&[0], &node[..32], &index.to_be_bytes()]);
    }
    let mut key = Zeroizing::new([0u8; 32]);
    key.copy_from_slice(&node[..32]);
    key
}

/// The Ed25519 private key for `phrase` (empty BIP-39 passphrase) at `path`.
pub fn derive_key(phrase: &str, path: HdPath) -> Result<Zeroizing<[u8; 32]>, CliError> {
    let mnemonic = parse_phrase(phrase)?;
    let seed = Zeroizing::new(mnemonic.to_seed(""));
    Ok(derive_slip10(&seed, path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::keys::LoadedKey;
    use serde_json::Value;

    /// Shared with the TypeScript SDK (`specs/hd-derivation/thru-hd-derivation.md`).
    const VECTORS: &str =
        include_str!("../../../../../web/packages/sdk/test/vectors/thru-hd-derivation.json");

    fn vectors() -> Value {
        serde_json::from_str(VECTORS).unwrap()
    }

    #[test]
    fn shared_vectors_match_seed_keys_and_addresses() {
        let vectors = vectors();
        let phrase = vectors["mnemonic"].as_str().unwrap();
        assert_eq!(vectors["passphrase"], "");
        let seed = parse_phrase(phrase).unwrap().to_seed("");
        assert_eq!(hex::encode(seed), vectors["seed"].as_str().unwrap());
        let cases = vectors["vectors"].as_array().unwrap();
        assert!(cases.len() >= 4);
        for case in cases {
            let path: HdPath = case["path"].as_str().unwrap().parse().unwrap();
            let account = case["account"].as_u64().unwrap() as u32;
            let change = case["change"].as_u64().unwrap() as u32;
            assert_eq!(path, HdPath::new(account, change).unwrap());
            assert_eq!(path.to_string(), case["path"].as_str().unwrap());

            let private_key = derive_key(phrase, path).unwrap();
            assert_eq!(
                hex::encode(*private_key),
                case["privateKey"].as_str().unwrap()
            );
            let key = LoadedKey::from_seed(private_key);
            assert_eq!(
                hex::encode(key.public_key),
                case["publicKey"].as_str().unwrap()
            );
            assert_eq!(
                key.address_string.to_string(),
                case["address"].as_str().unwrap()
            );
        }
    }

    /// A 24-word phrase (152 bytes, longer than one SHA-512 block, so PBKDF2
    /// hashes its HMAC key) checked against an independent implementation:
    /// Python `hashlib.pbkdf2_hmac` + `hmac` SLIP-0010. The same code
    /// reproduces the shared vectors and the official BIP-39 "TREZOR" seed
    /// for this phrase.
    #[test]
    fn long_phrase_matches_an_independent_implementation() {
        let phrase = "void come effort suffer camp survey warrior heavy shoot primary clutch crush \
                      open amazing screen patrol group space point ten exist slush involve unfold";
        assert!(phrase.len() > 128);
        let mnemonic = parse_phrase(phrase).unwrap();
        assert_eq!(
            hex::encode(mnemonic.to_seed("")),
            "b873212f885ccffbf4692afcb84bc2e55886de2dfa07d90f5c3c239abc31c0a6\
             ce047e30fd8bf6a281e71389aa82d73df74c7bbfb3b06b4639a5cee775cccd3c"
        );
        assert_eq!(
            hex::encode(mnemonic.to_seed("TREZOR")),
            "01f5bced59dec48e362f2c45b5de68b9fd6c92c6634f44d6d40aab69056506f0\
             e35524a518034ddc1192e1dacd32c1ed3eaa3c3b131c88ed8e7e54c49a5d0998"
        );
        for (path, expected) in [
            (
                HdPath::new(0, 0).unwrap(),
                "9409269c923e9beeee4c860ac110c56799fc8a716f877e34a4d4fb13226b4354",
            ),
            (
                HdPath::new(5, 1).unwrap(),
                "c9dc2301521d3727e6abd258d73d499d9b0aa1059b685668e3c45a3b78c1f027",
            ),
        ] {
            assert_eq!(hex::encode(*derive_key(phrase, path).unwrap()), expected);
        }
    }

    #[test]
    fn phrase_case_and_whitespace_do_not_change_the_key() {
        let phrase = vectors()["mnemonic"].as_str().unwrap().to_owned();
        let path = HdPath::for_account(0).unwrap();
        let expected = derive_key(&phrase, path).unwrap();
        let messy = format!("  {}\n", phrase.to_uppercase().replace(' ', " \t "));
        assert_eq!(*derive_key(&messy, path).unwrap(), *expected);
    }

    #[test]
    fn every_bip39_word_count_is_accepted() {
        for bytes in [16, 20, 24, 28, 32] {
            let entropy = vec![0x5a; bytes];
            let phrase = Mnemonic::from_entropy_in(Language::English, &entropy)
                .unwrap()
                .to_string();
            assert_eq!(phrase.split(' ').count(), bytes * 3 / 4);
            derive_key(&phrase, HdPath::for_account(0).unwrap()).unwrap();
        }
    }

    #[test]
    fn invalid_phrases_are_rejected_without_echoing_words() {
        let words = vectors()["mnemonic"].as_str().unwrap().to_owned();
        let eleven = words.rsplit_once(' ').unwrap().0.to_owned();
        let bad_checksum = format!("{eleven} abandon");
        let unknown = words.replacen("about", "thruxyz", 1);
        let unknown_dotted = words.replacen("about", "ABOUT\u{130}", 1);
        let cases = [
            (eleven.as_str(), "11 words"),
            (bad_checksum.as_str(), "checksum"),
            (unknown.as_str(), "word 12"),
            ("", "0 words"),
            // Non-ASCII is never lowercased into a word list match.
            (unknown_dotted.as_str(), "word 12"),
        ];
        for (phrase, expected) in cases {
            let error = derive_key(phrase, HdPath::for_account(0).unwrap())
                .unwrap_err()
                .to_string();
            assert!(error.contains(expected), "{error}");
            assert!(!error.contains("abandon"), "{error}");
            assert!(!error.contains("thruxyz"), "{error}");
        }
    }

    #[test]
    fn generated_phrases_are_24_valid_distinct_words() {
        let first = generate_phrase().unwrap();
        let second = generate_phrase().unwrap();
        assert_eq!(first.split(' ').count(), 24);
        // Written into the reserved buffer without reallocating.
        assert_eq!(first.capacity(), MAX_GENERATED_PHRASE_BYTES);
        assert_ne!(*first, *second);
        parse_phrase(&first).unwrap();
    }

    #[test]
    fn paths_follow_the_thru_policy() {
        assert_eq!(
            HdPath::for_account(7).unwrap().to_string(),
            "m/44'/8478'/7'/0'"
        );
        assert_eq!(
            "m/44'/8478'/2147483647'/1'".parse::<HdPath>().unwrap(),
            HdPath::new(0x7fff_ffff, 1).unwrap()
        );
        assert!(HdPath::new(HARDENED, 0).is_err());
        assert!(HdPath::new(0, HARDENED).is_err());
        for path in [
            "",
            "m",
            "m/",
            "44'/8478'/0'/0'",
            "M/44'/8478'/0'/0'",
            "m/44'/8478'/0'",
            "m/44'/8478'/0'/0'/0'",
            "m/44'/8478'/0'/0",
            "m/44/8478'/0'/0'",
            "m/44'/8478'/00'/0'",
            "m/44'/8478'/+1'/0'",
            "m/44'/8478'/-1'/0'",
            "m/44'/8478'/2147483648'/0'",
            "m/44'/8478'/0h/0h",
            "m/44'/8478'/0''/0'",
            "m//44'/8478'/0'/0'",
            "m/45'/8478'/0'/0'",
            " m/44'/8478'/0'/0'",
        ] {
            assert!(path.parse::<HdPath>().is_err(), "{path:?} accepted");
        }
        let error = "m/44'/9999'/0'/0'".parse::<HdPath>().unwrap_err();
        assert!(error.to_string().contains("coin type must be 8478'"));
    }

    #[test]
    fn phrase_reader_is_bounded_and_utf8_only() {
        assert_eq!(*read_phrase("a b\n".as_bytes()).unwrap(), "a b\n");
        assert!(read_phrase(vec![b' '; 4097].as_slice()).is_err());
        assert!(read_phrase(vec![b' '; 4096].as_slice()).is_ok());
        assert!(read_phrase([0xff, 0xfe].as_slice()).is_err());

        /// Yields one byte per read, interrupts once, then optionally fails.
        struct Trickle<'a> {
            data: &'a [u8],
            interrupted: bool,
            fail_at_end: bool,
        }
        impl Read for Trickle<'_> {
            fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
                if !self.interrupted {
                    self.interrupted = true;
                    return Err(io::ErrorKind::Interrupted.into());
                }
                match self.data.split_first() {
                    Some((byte, rest)) => {
                        buffer[0] = *byte;
                        self.data = rest;
                        Ok(1)
                    }
                    None if self.fail_at_end => Err(io::Error::other("secret-words")),
                    None => Ok(0),
                }
            }
        }
        let phrase = "abandon about\n".as_bytes();
        let read = read_phrase(Trickle {
            data: phrase,
            interrupted: false,
            fail_at_end: false,
        })
        .unwrap();
        assert_eq!(read.as_bytes(), phrase);
        let error = read_phrase(Trickle {
            data: phrase,
            interrupted: false,
            fail_at_end: true,
        })
        .unwrap_err()
        .to_string();
        assert!(
            !error.contains("secret-words") && !error.contains("abandon"),
            "{error}"
        );
    }
}
