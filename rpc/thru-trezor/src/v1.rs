//! The backend for devices of the older Trezor protocol (the Safe 5 and every
//! Trezor before the Safe 7).
//!
//! There is no encryption, no pairing and no credential here: the packets are
//! [`crate::codec_v1`]'s, a connection is a session that [`V1Link::open`]
//! starts, and what the person must confirm they confirm on the device, which
//! shows and asks for everything it signs.
//!
//! This backend is used on the emulator only: `Trezor::connect_probing`, where
//! the backend is chosen, refuses the older protocol on any transport whose
//! [`Transport::is_emulator`] is false, before anything is sent to this module.
//!
//! Every connection sends `Initialize` without a session id, so the device
//! starts a session of its own and no seed of an earlier connection is
//! reused; the wallet the key asks for is therefore always derived fresh,
//! with the passphrase this module gives (see [`Wallet`]).

use prost::Message as _;

use crate::client::{
    CALL_TIMEOUT, ConnectOptions, MAX_BUTTON_REQUESTS, Ui, expect_answer, notify_ui,
};
use crate::codec_v1::{read_message, write_message};
use crate::error::{Result, TrezorError};
use crate::messages::{
    ApplyFlags, ButtonAck, ButtonRequest, Cancel, Failure, Features, GetFeatures, Initialize,
    PassphraseAck, PassphraseRequest, PinMatrixRequest, Success, Wire,
};
use crate::transport::Transport;

/// The wallet a connection opens, from [`ConnectOptions`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Wallet {
    /// The standard wallet: the empty passphrase.
    Standard,
    /// The wallet of a passphrase the person types on the device.
    Passphrase,
}

/// A device of the older protocol with an open session.
pub(crate) struct V1Link<T: Transport> {
    transport: T,
    ui: Box<dyn Ui>,
    wallet: Wallet,
    /// The device's internal model name, from the first `Features`.
    model: Option<String>,
}

impl<T: Transport> V1Link<T> {
    /// Starts a session on a connection whose protocol was found to be the
    /// older one, and makes sure that the wallet `options` ask for is the
    /// wallet this device will derive, or refuses.
    ///
    /// In this order: `Initialize` (a new session), the unlock step
    /// (`ApplyFlags` with no flags, which unlocks the device without
    /// deriving anything), `Features` again (a locked device hides its
    /// passphrase settings), the check of the settings against the wallet.
    /// Nothing that derives a key has been sent when this returns an error.
    pub(crate) fn open(transport: T, options: &ConnectOptions, ui: Box<dyn Ui>) -> Result<Self> {
        let wallet = if options.wants_passphrase_on_device() {
            Wallet::Passphrase
        } else {
            Wallet::Standard
        };
        let mut link = V1Link {
            transport,
            ui,
            wallet,
            model: None,
        };
        let features: Features = link.call(&Initialize {
            session_id: None,
            derive_cardano: None,
        })?;
        if features.bootloader_mode == Some(true) {
            return Err(TrezorError::Unexpected(
                "the Trezor is in bootloader mode and runs no apps; start its firmware".into(),
            ));
        }
        link.model = features.internal_model.clone();

        // An empty device has no seed to derive and cannot be locked; the
        // first request that needs a key fails with the device's own
        // `NotInitialized`.
        if features.initialized == Some(false) {
            return Ok(link);
        }
        let _: Success = link.call(&ApplyFlags { flags: 0 })?;
        let features: Features = link.call(&GetFeatures {})?;
        check_wallet(wallet, &features)?;
        Ok(link)
    }

    /// The device's internal model name (`T3T1`), if it reported one.
    pub(crate) fn model(&self) -> Option<&str> {
        self.model.as_deref()
    }

    /// Sends a message and returns the answer's id and payload. Button
    /// requests are acknowledged on the way (the person confirms on the
    /// device), a passphrase request is answered for the wallet of this
    /// connection, a `Failure` becomes an error.
    pub(crate) fn call_any(&mut self, id: u16, payload: &[u8]) -> Result<(u16, Vec<u8>)> {
        write_message(&mut self.transport, id, payload)?;
        let mut button_requests = 0usize;
        let mut passphrase_requests = 0usize;
        loop {
            let (got_id, data) = read_message(
                &mut self.transport,
                CALL_TIMEOUT,
                "an answer from the device",
                false,
            )?;
            match got_id {
                ButtonRequest::ID => {
                    button_requests += 1;
                    if button_requests > MAX_BUTTON_REQUESTS {
                        return Err(TrezorError::Unexpected(format!(
                            "the device asked for more than {MAX_BUTTON_REQUESTS} confirmations \
                             in one request; giving up"
                        )));
                    }
                    notify_ui(self.ui.as_mut(), &data);
                    write_message(&mut self.transport, ButtonAck::ID, &[])?;
                }
                PassphraseRequest::ID => {
                    passphrase_requests += 1;
                    if passphrase_requests > MAX_BUTTON_REQUESTS {
                        return Err(TrezorError::Unexpected(format!(
                            "the device asked for the passphrase more than \
                             {MAX_BUTTON_REQUESTS} times in one request; giving up"
                        )));
                    }
                    let answer = passphrase_answer(self.wallet);
                    write_message(
                        &mut self.transport,
                        PassphraseAck::ID,
                        &answer.encode_to_vec(),
                    )?;
                }
                PinMatrixRequest::ID => {
                    // Cancel it, so that the device is not left waiting for a
                    // PIN nobody will send, and take its answer off the line.
                    let _ = write_message(&mut self.transport, Cancel::ID, &[]);
                    let _ = read_message(
                        &mut self.transport,
                        std::time::Duration::from_secs(5),
                        "the answer to the cancellation",
                        true,
                    );
                    return Err(TrezorError::Unexpected(
                        "the device asks for the PIN through the computer (a PIN matrix), which \
                         this host does not do; the Trezor Safe 5 takes the PIN on the device"
                            .into(),
                    ));
                }
                Failure::ID => {
                    let failure = Failure::decode(data.as_slice())
                        .map_err(|e| TrezorError::Unexpected(format!("Failure: {e}")))?;
                    return Err(TrezorError::from_failure(failure.code, failure.message));
                }
                _ => return Ok((got_id, data)),
            }
        }
    }

    /// Sends `request` and returns the answer, which must be an `A`.
    pub(crate) fn call<Q: Wire, A: Wire>(&mut self, request: &Q) -> Result<A> {
        let (id, data) = self.call_any(Q::ID, &request.encode_to_vec())?;
        expect_answer::<Q, A>(id, &data)
    }
}

/// The answer to a `PassphraseRequest` for `wallet`: the empty passphrase for
/// the standard wallet; `on_device` and no text for a passphrase wallet (the
/// device refuses both together), so that the person types it on the device
/// and the computer never sees it.
fn passphrase_answer(wallet: Wallet) -> PassphraseAck {
    match wallet {
        Wallet::Standard => PassphraseAck {
            passphrase: Some(String::new()),
            on_device: None,
        },
        Wallet::Passphrase => PassphraseAck {
            passphrase: None,
            on_device: Some(true),
        },
    }
}

/// Whether a device with these settings (read after the unlock step) derives
/// the wallet `wallet` asks for, or why not.
///
/// - the device must be unlocked: a locked one hides its settings, and a
///   device that stays locked after the unlock step is an error;
/// - a standard key on a device set to ask for the passphrase on the device
///   would send the host nothing to answer: refused with the error the
///   Trezor Host Protocol path gives for it;
/// - a passphrase key on a device whose passphrase protection is off would
///   silently open the standard wallet: refused. With protection on, the
///   device asks (`PassphraseRequest`, answered with `on_device`) or, set to
///   ask on the device, asks without a request.
fn check_wallet(wallet: Wallet, features: &Features) -> Result<()> {
    if features.unlocked != Some(true) {
        return Err(TrezorError::DeviceLocked);
    }
    match wallet {
        Wallet::Standard => {
            if features.passphrase_always_on_device == Some(true) {
                return Err(TrezorError::PassphraseOnDeviceOnly);
            }
        }
        Wallet::Passphrase => {
            if features.passphrase_protection != Some(true) {
                return Err(TrezorError::PassphraseProtectionOff);
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn features(unlocked: bool, protection: bool, always: bool) -> Features {
        Features {
            unlocked: Some(unlocked),
            passphrase_protection: Some(protection),
            passphrase_always_on_device: Some(always),
            initialized: Some(true),
            ..Features::default()
        }
    }

    #[test]
    fn the_wallet_table() {
        // (wallet, unlocked, protection, always on device) -> outcome
        use Wallet::{Passphrase, Standard};
        let ok = |w, u, p, a| check_wallet(w, &features(u, p, a)).is_ok();
        // Standard key: protection off, or on and asked by the host.
        assert!(ok(Standard, true, false, false));
        assert!(ok(Standard, true, true, false));
        // Standard key on a device that asks on the device: refused.
        assert!(matches!(
            check_wallet(Standard, &features(true, true, true)),
            Err(TrezorError::PassphraseOnDeviceOnly)
        ));
        // Passphrase key: protection on, asked by the host or on the device.
        assert!(ok(Passphrase, true, true, false));
        assert!(ok(Passphrase, true, true, true));
        // Passphrase key with protection off: refused, with its own error.
        assert!(matches!(
            check_wallet(Passphrase, &features(true, false, false)),
            Err(TrezorError::PassphraseProtectionOff)
        ));
        // Locked, whatever the key: an error (and the settings are not
        // trusted).
        for wallet in [Standard, Passphrase] {
            assert!(matches!(
                check_wallet(wallet, &features(false, true, false)),
                Err(TrezorError::DeviceLocked)
            ));
        }
        // Settings the device did not report are not "off" for a standard key
        // that needs none, and are "off" for a passphrase key.
        let hidden = Features {
            unlocked: Some(true),
            ..Features::default()
        };
        assert!(check_wallet(Standard, &hidden).is_ok());
        assert!(matches!(
            check_wallet(Passphrase, &hidden),
            Err(TrezorError::PassphraseProtectionOff)
        ));
        // A device that does not say whether it is unlocked is locked.
        assert!(matches!(
            check_wallet(Standard, &Features::default()),
            Err(TrezorError::DeviceLocked)
        ));
    }

    #[test]
    fn the_passphrase_answers() {
        let standard = passphrase_answer(Wallet::Standard);
        assert_eq!(hex::encode(standard.encode_to_vec()), "0a00");
        let hidden = passphrase_answer(Wallet::Passphrase);
        assert_eq!(hidden.passphrase, None);
        assert_eq!(hex::encode(hidden.encode_to_vec()), "1801");
    }
}
