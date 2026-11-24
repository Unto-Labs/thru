//! Test-only seams under the channel's cryptography: scripted randomness and
//! a recorder of every AES-GCM encryption.
//!
//! The wrappers delegate to the RustCrypto backend the channel uses
//! (`thp::Crypto`); they change nothing but where the random bytes come from
//! and what is remembered. They exist so that a test can run the real host
//! code against a simulated device with fixed keys and read off the
//! ciphertexts.

use std::cell::{Cell, RefCell};
use std::collections::VecDeque;

use trezor_noise_rust_crypto::{Aes256Gcm, X25519};
use trezor_thp::channel::{Cipher, DH, U8Array};

/// Which side of the channel is running code right now (both run in the
/// test's thread).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Role {
    Host,
    Device,
}

/// One AES-256-GCM encryption.
#[derive(Clone, Debug)]
pub(crate) struct Encryption {
    pub role: Role,
    pub key: [u8; 32],
    pub counter: u64,
    pub ad: Vec<u8>,
    pub plaintext: Vec<u8>,
    /// Ciphertext followed by the 16-byte tag.
    pub ciphertext: Vec<u8>,
}

struct Script {
    queue: VecDeque<(&'static str, Vec<u8>)>,
    consumed: Vec<(&'static str, Vec<u8>)>,
}

thread_local! {
    static LOOKUPS: RefCell<Vec<(Vec<u8>, Vec<u8>)>> = const { RefCell::new(Vec::new()) };
    static SCRIPT: RefCell<Option<Script>> = const { RefCell::new(None) };
    static ROLE: Cell<Role> = const { Cell::new(Role::Host) };
    static ENCRYPTIONS: RefCell<Vec<Encryption>> = const { RefCell::new(Vec::new()) };
}

/// From now on this thread's random requests return `items` in order, each
/// of the length of the request; any request beyond them panics.
pub(crate) fn script_random(items: Vec<(&'static str, Vec<u8>)>) {
    SCRIPT.with(|script| {
        *script.borrow_mut() = Some(Script {
            queue: items.into(),
            consumed: Vec::new(),
        });
    });
}

/// Ends the script and returns what was consumed. Panics if something was
/// left over: the script must match the code's requests exactly.
pub(crate) fn finish_random_script() -> Vec<(&'static str, Vec<u8>)> {
    SCRIPT.with(|script| {
        let script = script.borrow_mut().take().expect("no random script active");
        assert!(
            script.queue.is_empty(),
            "random script not used up: {:?}",
            script
                .queue
                .iter()
                .map(|(label, _)| *label)
                .collect::<Vec<_>>()
        );
        script.consumed
    })
}

/// Fills `dest` from the script if one is active; `false` if none is.
pub(crate) fn take_scripted_random(dest: &mut [u8]) -> bool {
    SCRIPT.with(|script| {
        let mut script = script.borrow_mut();
        let Some(script) = script.as_mut() else {
            return false;
        };
        let (label, bytes) = script
            .queue
            .pop_front()
            .unwrap_or_else(|| panic!("unscripted request for {} random bytes", dest.len()));
        assert_eq!(
            bytes.len(),
            dest.len(),
            "random script item {label} has {} bytes, the code asked for {}",
            bytes.len(),
            dest.len()
        );
        dest.copy_from_slice(&bytes);
        script.consumed.push((label, bytes));
        true
    })
}

/// Runs `body` with `role` as the side that is running.
pub(crate) fn as_role<T>(role: Role, body: impl FnOnce() -> T) -> T {
    let before = ROLE.with(|r| r.replace(role));
    let out = body();
    ROLE.with(|r| r.set(before));
    out
}

/// Remembers what a device presented to the credential lookup: its
/// ephemeral key and its masked static key.
pub(crate) fn note_lookup(ephemeral_pubkey: &[u8], masked_static_pubkey: &[u8]) {
    LOOKUPS.with(|l| {
        l.borrow_mut()
            .push((ephemeral_pubkey.to_vec(), masked_static_pubkey.to_vec()));
    });
}

/// Forgets the recorded lookups.
pub(crate) fn clear_lookups() {
    LOOKUPS.with(|l| l.borrow_mut().clear());
}

/// Every lookup so far, oldest first.
pub(crate) fn lookups() -> Vec<(Vec<u8>, Vec<u8>)> {
    LOOKUPS.with(|l| l.borrow().clone())
}

/// Every encryption so far, oldest first.
pub(crate) fn encryptions() -> Vec<Encryption> {
    ENCRYPTIONS.with(|e| e.borrow().clone())
}

/// Forgets the recorded encryptions.
pub(crate) fn clear_encryptions() {
    ENCRYPTIONS.with(|e| e.borrow_mut().clear());
}

fn record(key: &<Aes256Gcm as Cipher>::Key, counter: u64, ad: &[u8], plaintext: &[u8], out: &[u8]) {
    let mut key_bytes = [0u8; 32];
    key_bytes.copy_from_slice(key.as_slice());
    let role = ROLE.with(Cell::get);
    ENCRYPTIONS.with(|e| {
        e.borrow_mut().push(Encryption {
            role,
            key: key_bytes,
            counter,
            ad: ad.to_vec(),
            plaintext: plaintext.to_vec(),
            ciphertext: out.to_vec(),
        });
    });
}

/// X25519 whose private keys can be scripted.
pub(crate) enum Dh {}

impl DH for Dh {
    type Key = <X25519 as DH>::Key;
    type Pubkey = <X25519 as DH>::Pubkey;
    type Output = <X25519 as DH>::Output;

    fn name() -> &'static str {
        X25519::name()
    }

    fn genkey() -> Self::Key {
        let mut key = [0u8; 32];
        if take_scripted_random(&mut key) {
            Self::Key::from_slice(&key)
        } else {
            X25519::genkey()
        }
    }

    fn pubkey(k: &Self::Key) -> Self::Pubkey {
        X25519::pubkey(k)
    }

    fn dh(k: &Self::Key, pk: &Self::Pubkey) -> Result<Self::Output, ()> {
        X25519::dh(k, pk)
    }
}

/// AES-256-GCM that remembers what it encrypted.
pub(crate) enum Recording {}

impl Cipher for Recording {
    type Key = <Aes256Gcm as Cipher>::Key;

    fn name() -> &'static str {
        Aes256Gcm::name()
    }

    fn encrypt(k: &Self::Key, nonce: u64, ad: &[u8], plaintext: &[u8], out: &mut [u8]) {
        Aes256Gcm::encrypt(k, nonce, ad, plaintext, out);
        record(k, nonce, ad, plaintext, out);
    }

    fn encrypt_in_place(
        k: &Self::Key,
        nonce: u64,
        ad: &[u8],
        in_out: &mut [u8],
        plaintext_len: usize,
    ) -> usize {
        let plaintext = in_out[..plaintext_len].to_vec();
        let len = Aes256Gcm::encrypt_in_place(k, nonce, ad, in_out, plaintext_len);
        record(k, nonce, ad, &plaintext, &in_out[..len]);
        len
    }

    fn decrypt(
        k: &Self::Key,
        nonce: u64,
        ad: &[u8],
        ciphertext: &[u8],
        out: &mut [u8],
    ) -> Result<(), ()> {
        Aes256Gcm::decrypt(k, nonce, ad, ciphertext, out)
    }

    fn decrypt_in_place(
        k: &Self::Key,
        nonce: u64,
        ad: &[u8],
        in_out: &mut [u8],
        ciphertext_len: usize,
    ) -> Result<usize, ()> {
        Aes256Gcm::decrypt_in_place(k, nonce, ad, in_out, ciphertext_len)
    }
}
