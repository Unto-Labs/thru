//! A connected Trezor: pairing, one session, and request/answer calls that
//! answer button requests and turn failures into errors.

use std::time::Duration;

use prost::Message as _;
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

use crate::cpace::cpace;
use crate::credentials::{Credential, CredentialStorage, HandshakeKeys, MAX_CREDENTIAL_LEN};
use crate::error::{Result, TrezorError, failure_code};
use crate::messages::{
    ButtonAck, ButtonRequest, Failure, Success, ThpCodeEntryChallenge, ThpCodeEntryCommitment,
    ThpCodeEntryCpaceHostTag, ThpCodeEntryCpaceTrezor, ThpCodeEntrySecret, ThpCreateNewSession,
    ThpCredentialRequest, ThpCredentialResponse, ThpEndRequest, ThpEndResponse, ThpPairingRequest,
    ThpPairingRequestApproved, ThpSelectMethod, Wire, button_request_type, pairing_method,
};
use crate::probe::{PROBE_TIMEOUT, Protocol, probe};
use crate::thp::{DeviceProperties, Link};
use crate::transport::Transport;
use crate::v1::V1Link;

/// How long a call waits for the device. A user may be reading its screen.
pub(crate) const CALL_TIMEOUT: Duration = Duration::from_secs(5 * 60);

/// How many button requests one call answers. A signing review is a handful
/// of screens; without a cap a device (or something posing as one) could keep
/// a call open for ever by asking again before each timeout.
pub(crate) const MAX_BUTTON_REQUESTS: usize = 64;

/// The session this crate creates after pairing.
const SESSION_ID: u8 = 1;
/// Messages of the pairing phase travel on session 0.
const PAIRING_SESSION: u8 = 0;

const MSG_FAILURE: u16 = Failure::ID;
const MSG_BUTTON_REQUEST: u16 = ButtonRequest::ID;

/// The first byte hashed into the code: `ThpPairingMethod.CodeEntry`.
const CODE_ENTRY_DOMAIN: u8 = 2;
/// Length of a code-entry pairing code.
const CODE_LEN: usize = 6;
/// The code is the hash reduced modulo this.
const CODE_MODULUS: u64 = 1_000_000;
/// Bytes of the random challenge the host sends in code-entry pairing.
const CHALLENGE_LEN: usize = 32;

/// How to connect: what the device shows about the host, and what pairing
/// the host may do.
///
/// Skipping pairing, which only a debug firmware or the emulator offers, is a
/// choice of the caller: it exists only when the crate is built with the
/// `emulator` feature, and is off unless [`ConnectOptions::allow_skip_pairing`]
/// turns it on. A device reached over USB must never be given that option.
#[derive(Clone, Debug)]
#[non_exhaustive]
pub struct ConnectOptions {
    host_name: String,
    app_name: String,
    passphrase_on_device: bool,
    #[cfg(feature = "emulator")]
    allow_skip_pairing: bool,
}

impl ConnectOptions {
    /// `host_name` and `app_name` are what the device shows when it asks the
    /// user to allow the connection (for example the machine's name and
    /// `thru`).
    pub fn new(host_name: impl Into<String>, app_name: impl Into<String>) -> Self {
        ConnectOptions {
            host_name: host_name.into(),
            app_name: app_name.into(),
            passphrase_on_device: false,
            #[cfg(feature = "emulator")]
            allow_skip_pairing: false,
        }
    }

    /// Opens the session of a passphrase (hidden) wallet whose passphrase the
    /// person types on the device; the computer never sees it. Off by
    /// default: the session is then the standard wallet, opened with the empty
    /// passphrase.
    ///
    /// On the Trezor Host Protocol the device asks for the passphrase whether
    /// or not passphrase protection is enabled on it. On the older protocol
    /// protection must be on, else the connection is refused with
    /// [`TrezorError::PassphraseProtectionOff`] (the device would open the
    /// standard wallet without asking), and a standard key (this option off)
    /// is refused on a device set to ask on the device
    /// ([`TrezorError::PassphraseOnDeviceOnly`]).
    /// [`Ui::enter_passphrase_on_device`] is called while the person types.
    pub fn passphrase_on_device(mut self, on_device: bool) -> Self {
        self.passphrase_on_device = on_device;
        self
    }

    /// Whether the key asks for the wallet of a passphrase typed on the
    /// device ([`ConnectOptions::passphrase_on_device`]).
    pub(crate) fn wants_passphrase_on_device(&self) -> bool {
        self.passphrase_on_device
    }

    /// The request that creates the session: the empty passphrase, or
    /// `on_device` and no passphrase (the device refuses both together).
    fn session_request(&self) -> ThpCreateNewSession {
        if self.passphrase_on_device {
            ThpCreateNewSession {
                passphrase: None,
                on_device: Some(true),
                derive_cardano: None,
            }
        } else {
            ThpCreateNewSession {
                passphrase: Some(String::new()),
                on_device: None,
                derive_cardano: None,
            }
        }
    }

    /// Lets the connection pair without a code if the device offers that
    /// (the emulator does, a retail device does not). Off by default, and
    /// honoured only on a transport that says it is the emulator
    /// ([`Transport::is_emulator`]): on any other it changes nothing. A
    /// device of the older protocol is not paired at all.
    #[cfg(feature = "emulator")]
    pub fn allow_skip_pairing(mut self, allow: bool) -> Self {
        self.allow_skip_pairing = allow;
        self
    }
}

impl Default for ConnectOptions {
    fn default() -> Self {
        Self::new("thru", "thru")
    }
}

/// What the connection needs from the person at the terminal.
pub trait Ui: Send {
    /// The device waits for the user to confirm on its screen.
    fn confirm_on_device(&mut self) {}

    /// The person types the passphrase on the device (the device sent the
    /// button request for passphrase entry). Defaults to
    /// [`Ui::confirm_on_device`].
    fn enter_passphrase_on_device(&mut self) {
        self.confirm_on_device();
    }

    /// The six digits the device shows during code-entry pairing.
    fn pairing_code(&mut self) -> Result<String>;
}

/// A device of the Trezor Host Protocol with an open channel and a session.
pub(crate) struct ThpTrezor<T: Transport> {
    link: Link<T>,
    ui: Box<dyn Ui>,
    session: u8,
}

impl<T: Transport> ThpTrezor<T> {
    /// Opens a channel on `transport`, pairs if the device does not know this
    /// host, and creates a session: the standard wallet, or, with
    /// [`ConnectOptions::passphrase_on_device`], the wallet of a passphrase
    /// typed on the device.
    ///
    /// Pairing by code entry stores the credential the device issues in
    /// `storage`; the next connection finds it there and does not pair
    /// again.
    pub(crate) fn connect(
        transport: T,
        options: &ConnectOptions,
        storage: &dyn CredentialStorage,
        ui: Box<dyn Ui>,
    ) -> Result<Self> {
        let keys = HandshakeKeys::new(storage.load()?)?;
        // Asked of the transport before it is handed over: the link does not
        // look at what it runs on.
        let transport_is_emulator = transport.is_emulator();
        let link = Link::open(transport, keys)?;
        let mut trezor = ThpTrezor {
            link,
            ui,
            session: PAIRING_SESSION,
        };
        trezor.pair(options, transport_is_emulator, storage)?;
        trezor.link.end_pairing();
        trezor.session = SESSION_ID;
        let _: Success = trezor
            .call(&options.session_request())
            .map_err(TrezorError::into_session_refusal)?;
        Ok(trezor)
    }

    /// The handshake hash of the channel.
    #[cfg(test)]
    pub(crate) fn handshake_hash(&self) -> [u8; 32] {
        self.link.handshake_hash()
    }

    /// What the device said about itself before the handshake.
    pub(crate) fn properties(&self) -> &DeviceProperties {
        self.link.properties()
    }

    /// The pairing phase, up to and including the device's `ThpEndResponse`.
    fn pair(
        &mut self,
        options: &ConnectOptions,
        transport_is_emulator: bool,
        storage: &dyn CredentialStorage,
    ) -> Result<()> {
        if already_paired(self.link.is_paired(), self.link.credential_matched())? {
            let _: ThpEndResponse = self.call_on(PAIRING_SESSION, &ThpEndRequest {})?;
            return Ok(());
        }
        let _: ThpPairingRequestApproved = self.call_on(
            PAIRING_SESSION,
            &ThpPairingRequest {
                host_name: options.host_name.clone(),
                app_name: options.app_name.clone(),
            },
        )?;
        let methods = self.link.properties().pairing_methods.clone();

        #[cfg(feature = "emulator")]
        if skip_pairing_allowed(options.allow_skip_pairing, transport_is_emulator)
            && methods.contains(&pairing_method::SKIP_PAIRING)
        {
            let _: ThpEndResponse = self.call_on(
                PAIRING_SESSION,
                &ThpSelectMethod {
                    selected_pairing_method: pairing_method::SKIP_PAIRING,
                },
            )?;
            return Ok(());
        }

        if methods.contains(&pairing_method::CODE_ENTRY) {
            return self.pair_by_code_entry(storage);
        }
        #[cfg(not(feature = "emulator"))]
        let _ = transport_is_emulator;
        Err(TrezorError::Pairing(
            "the device offers no pairing method this host can do".into(),
        ))
    }

    /// Pairing by the code the device shows, as trezorlib's `CodeEntry`, then
    /// the credential request, then the end of pairing.
    ///
    /// The device commits to a secret; the host sends a random challenge; the
    /// device derives the six digits from the handshake hash, its secret and
    /// the challenge, shows them, and runs CPace with them as the password.
    /// The host types the digits, runs CPace, and proves it knows them with a
    /// tag; only then does the device reveal its secret, and the host checks
    /// that the digits it was given are the ones the secret yields.
    fn pair_by_code_entry(&mut self, storage: &dyn CredentialStorage) -> Result<()> {
        let commitment: ThpCodeEntryCommitment = self.call_on(
            PAIRING_SESSION,
            &ThpSelectMethod {
                selected_pairing_method: pairing_method::CODE_ENTRY,
            },
        )?;

        let mut challenge = [0u8; CHALLENGE_LEN];
        crate::random::fill(&mut challenge)
            .map_err(|e| TrezorError::Pairing(format!("random source failed: {e}")))?;
        let trezor_key: ThpCodeEntryCpaceTrezor = self.call_on(
            PAIRING_SESSION,
            &ThpCodeEntryChallenge {
                challenge: challenge.to_vec(),
            },
        )?;
        let trezor_key = <[u8; 32]>::try_from(trezor_key.cpace_trezor_public_key.as_slice())
            .map_err(|_| TrezorError::Pairing("the device sent a malformed CPace key".into()))?;

        let code = Zeroizing::new(self.ui.pairing_code()?);
        if code.len() != CODE_LEN || !code.bytes().all(|b| b.is_ascii_digit()) {
            return Err(TrezorError::Pairing(format!(
                "the pairing code is {CODE_LEN} digits"
            )));
        }

        let handshake_hash = self.link.handshake_hash();
        let exchange = cpace(code.as_bytes(), &handshake_hash, &trezor_key)
            .map_err(|e| TrezorError::Pairing(e.to_string()))?;
        let tag = code_entry_tag(&exchange.shared_secret);
        let secret: ThpCodeEntrySecret = self
            .call_on(
                PAIRING_SESSION,
                &ThpCodeEntryCpaceHostTag {
                    cpace_host_public_key: exchange.host_public_key.to_vec(),
                    tag,
                },
            )
            .map_err(wrong_code)?;

        if code_entry_commitment(&secret.secret).as_slice() != commitment.commitment.as_slice() {
            return Err(TrezorError::Pairing(
                "the device's secret does not match its commitment".into(),
            ));
        }
        let expected = Zeroizing::new(code_entry_code(&handshake_hash, &secret.secret, &challenge));
        if expected.as_bytes() != code.as_bytes() {
            return Err(TrezorError::Pairing(
                "the code does not belong to this connection".into(),
            ));
        }

        self.request_credential(storage)?;
        let _: ThpEndResponse = self.call_on(PAIRING_SESSION, &ThpEndRequest {})?;
        Ok(())
    }

    /// Asks the device for a credential for this channel's host key and keeps
    /// it in `storage`.
    fn request_credential(&mut self, storage: &dyn CredentialStorage) -> Result<()> {
        let privkey = Zeroizing::new(self.link.host_static_privkey());
        let pubkey = x25519_dalek::x25519(*privkey, x25519_dalek::X25519_BASEPOINT_BYTES);
        let response: ThpCredentialResponse = self.call_on(
            PAIRING_SESSION,
            &ThpCredentialRequest {
                host_static_public_key: pubkey.to_vec(),
                autoconnect: Some(false),
                credential: None,
            },
        )?;
        let trezor_static_pubkey =
            <[u8; 32]>::try_from(response.trezor_static_public_key.as_slice()).map_err(|_| {
                TrezorError::Pairing("the device sent a malformed static key".into())
            })?;
        if response.credential.is_empty() || response.credential.len() > MAX_CREDENTIAL_LEN {
            return Err(TrezorError::Pairing(format!(
                "the credential has {} bytes, this host can keep 1 to {MAX_CREDENTIAL_LEN}",
                response.credential.len()
            )));
        }
        storage.store(&Credential {
            trezor_static_pubkey,
            host_static_privkey: *privkey,
            credential: response.credential,
        })
    }

    /// Sends a message on the current session and returns the answer's id and
    /// payload. Button requests are acknowledged on the way (the user
    /// confirms on the device), a `Failure` becomes an error.
    pub(crate) fn call_any(&mut self, id: u16, payload: &[u8]) -> Result<(u16, Vec<u8>)> {
        self.call_any_on(self.session, id, payload)
    }

    fn call_any_on(&mut self, session: u8, id: u16, payload: &[u8]) -> Result<(u16, Vec<u8>)> {
        self.link.send(session, id, payload)?;
        let mut button_requests = 0usize;
        loop {
            let (got_session, got_id, data) = self
                .link
                .receive(CALL_TIMEOUT, "an answer from the device")?;
            if got_session != session {
                return Err(TrezorError::Unexpected(format!(
                    "message {got_id} for session {got_session}, expected session {session}"
                )));
            }
            match got_id {
                MSG_BUTTON_REQUEST => {
                    button_requests += 1;
                    if button_requests > MAX_BUTTON_REQUESTS {
                        return Err(TrezorError::Unexpected(format!(
                            "the device asked for more than {MAX_BUTTON_REQUESTS} confirmations \
                             in one request; giving up"
                        )));
                    }
                    notify_ui(self.ui.as_mut(), &data);
                    self.link.send(session, ButtonAck::ID, &[])?;
                }
                MSG_FAILURE => {
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
        self.call_on(self.session, request)
    }

    fn call_on<Q: Wire, A: Wire>(&mut self, session: u8, request: &Q) -> Result<A> {
        let (id, data) = self.call_any_on(session, Q::ID, &request.encode_to_vec())?;
        expect_answer::<Q, A>(id, &data)
    }
}

/// The answer `A` to a request `Q`, from the id and payload the device sent;
/// an error if it is another message or cannot be decoded.
pub(crate) fn expect_answer<Q: Wire, A: Wire>(id: u16, data: &[u8]) -> Result<A> {
    if id != A::ID {
        return Err(TrezorError::Unexpected(format!(
            "answer to {} is message {id}, expected {} ({})",
            Q::NAME,
            A::NAME,
            A::ID
        )));
    }
    A::decode(data)
        .map_err(|e| TrezorError::Unexpected(format!("{} could not be decoded: {e}", A::NAME)))
}

/// A connected Trezor, of either wire protocol.
///
/// [`Trezor::connect`] finds out which protocol the device speaks and opens
/// the matching backend: the Trezor Host Protocol (an encrypted channel,
/// pairing, credentials; the Safe 7) or the older protocol (no encryption, no
/// pairing; every Trezor before the Safe 7, the Safe 5 among them, proven on
/// and accepted from the emulator only). Everything above [`Trezor::call`] is the same for both.
pub struct Trezor<T: Transport> {
    inner: Inner<T>,
}

enum Inner<T: Transport> {
    Thp(Box<ThpTrezor<T>>),
    V1(V1Link<T>),
}

impl<T: Transport> Trezor<T> {
    /// Finds the device's protocol, opens a connection on it and gets the
    /// wallet `options` ask for: the standard wallet, or, with
    /// [`ConnectOptions::passphrase_on_device`], the wallet of a passphrase
    /// typed on the device.
    ///
    /// `transport` must be freshly opened and idle: the first thing sent on it
    /// is the older protocol's `Cancel`, which ends a workflow that is
    /// running on a device of that protocol. On the Trezor Host Protocol the
    /// device is paired if it does not know this host, and the credential it
    /// issues is kept in `storage`. A device of the older protocol is not
    /// paired and `storage` is not touched; that protocol is accepted from the
    /// emulator only, and any other transport whose device answers the probe
    /// in it gets [`TrezorError::OlderProtocolRefused`].
    pub fn connect(
        transport: T,
        options: &ConnectOptions,
        storage: &dyn CredentialStorage,
        ui: Box<dyn Ui>,
    ) -> Result<Self> {
        Self::connect_probing(transport, options, storage, ui, PROBE_TIMEOUT)
    }

    /// [`Trezor::connect`] with the probe's timeout given.
    ///
    /// This is the only place that decides which backend a connection gets,
    /// and it decides once, from the probe. The answer to the probe is not
    /// authenticated, so the older protocol (no encryption, no pairing) is
    /// taken on the emulator ([`Transport::is_emulator`]) only: on any other
    /// transport that answer is [`TrezorError::OlderProtocolRefused`], and
    /// nothing is sent after the probe. A failure of either backend is
    /// returned as it is: there is no second attempt with the other protocol,
    /// because an unencrypted retry after a failed encrypted handshake would
    /// be a downgrade.
    pub(crate) fn connect_probing(
        mut transport: T,
        options: &ConnectOptions,
        storage: &dyn CredentialStorage,
        ui: Box<dyn Ui>,
        probe_timeout: Duration,
    ) -> Result<Self> {
        let protocol = probe(&mut transport, probe_timeout)?;
        log::debug!("the Trezor speaks {protocol}");
        let inner = match protocol {
            Protocol::Thp => Inner::Thp(Box::new(ThpTrezor::connect(
                transport, options, storage, ui,
            )?)),
            Protocol::V1 if !transport.is_emulator() => {
                return Err(TrezorError::OlderProtocolRefused);
            }
            Protocol::V1 => Inner::V1(V1Link::open(transport, options, ui)?),
        };
        Ok(Trezor { inner })
    }

    /// Connects on the Trezor Host Protocol without probing: the vector run
    /// records that conversation byte for byte, and the probe is not part of
    /// it.
    #[cfg(test)]
    pub(crate) fn connect_thp(
        transport: T,
        options: &ConnectOptions,
        storage: &dyn CredentialStorage,
        ui: Box<dyn Ui>,
    ) -> Result<Self> {
        Ok(Trezor {
            inner: Inner::Thp(Box::new(ThpTrezor::connect(
                transport, options, storage, ui,
            )?)),
        })
    }

    /// The wire protocol this connection speaks.
    pub fn protocol(&self) -> Protocol {
        match self.inner {
            Inner::Thp(_) => Protocol::Thp,
            Inner::V1(_) => Protocol::V1,
        }
    }

    /// The handshake hash of the channel (Trezor Host Protocol only).
    #[cfg(test)]
    pub(crate) fn handshake_hash(&self) -> [u8; 32] {
        match &self.inner {
            Inner::Thp(thp) => thp.handshake_hash(),
            Inner::V1(_) => panic!("the older protocol has no handshake"),
        }
    }

    /// What the device said about itself before the handshake; only a device
    /// of the Trezor Host Protocol does that.
    pub fn properties(&self) -> Option<&DeviceProperties> {
        match &self.inner {
            Inner::Thp(thp) => Some(thp.properties()),
            Inner::V1(_) => None,
        }
    }

    /// The device's internal model name (`T3W1` for a Safe 7, `T3T1` for a
    /// Safe 5): the device properties on the Trezor Host Protocol,
    /// `Features.internal_model` on the older one. An error if the device did
    /// not report one.
    pub fn device_model(&self) -> Result<&str> {
        let model = match &self.inner {
            Inner::Thp(thp) => Some(thp.properties().internal_model.as_str()),
            Inner::V1(v1) => v1.model(),
        };
        model.filter(|model| !model.is_empty()).ok_or_else(|| {
            TrezorError::Unexpected("the Trezor did not report which model it is".into())
        })
    }

    /// Sends a message and returns the answer's id and payload. Button
    /// requests are acknowledged on the way (the user confirms on the
    /// device), a passphrase request of the older protocol is answered for
    /// the wallet of the connection, a `Failure` becomes an error.
    pub fn call_any(&mut self, id: u16, payload: &[u8]) -> Result<(u16, Vec<u8>)> {
        match &mut self.inner {
            Inner::Thp(thp) => thp.call_any(id, payload),
            Inner::V1(v1) => v1.call_any(id, payload),
        }
    }

    /// Sends `request` and returns the answer, which must be an `A`.
    pub fn call<Q: Wire, A: Wire>(&mut self, request: &Q) -> Result<A> {
        match &mut self.inner {
            Inner::Thp(thp) => thp.call(request),
            Inner::V1(v1) => v1.call(request),
        }
    }
}

/// Tells the person what the device waits for: the passphrase entry for the
/// button request of that code, a confirmation for every other (also for one
/// that cannot be decoded).
pub(crate) fn notify_ui(ui: &mut dyn Ui, button_request: &[u8]) {
    let code = ButtonRequest::decode(button_request)
        .ok()
        .and_then(|request| request.code);
    if code == Some(button_request_type::PASSPHRASE_ENTRY) {
        ui.enter_passphrase_on_device();
    } else {
        ui.confirm_on_device();
    }
}

/// Whether the handshake leaves this host paired, so that pairing is not run.
///
/// The device's pairing state is only a claim. It is believed when a
/// credential stored on this computer matched in the handshake (the device
/// then recognised a key this computer holds). A device that claims a pairing
/// when nothing matched is not believed, and is an error: a genuine device
/// answers "unpaired" to a host key it never issued a credential for.
fn already_paired(device_claims_paired: bool, credential_matched: bool) -> Result<bool> {
    match (device_claims_paired, credential_matched) {
        (true, true) => Ok(true),
        // Not paired as far as the device says; this computer's stored
        // credential, if it matched, is then stale and pairing replaces it.
        (false, _) => Ok(false),
        (true, false) => Err(TrezorError::Pairing(
            "the device claims a pairing this computer has no record of (no stored credential \
             matched); refusing to go on. Pair this device from this computer again, or remove \
             the device's entry for it if the claim is unexpected"
                .into(),
        )),
    }
}

/// Pairing without a code is used only when the caller asked for it and the
/// transport is the emulator's.
#[cfg(feature = "emulator")]
fn skip_pairing_allowed(option_set: bool, transport_is_emulator: bool) -> bool {
    option_set && transport_is_emulator
}

/// What the device answers to a wrong code is `Failure(DataError, "Unexpected
/// Code Entry Tag")` (`core/src/apps/thp/pairing.py`, `_handle_code_entry_cpace`):
/// the CPace tag of a host that typed other digits does not match.
fn wrong_code(error: TrezorError) -> TrezorError {
    match error {
        TrezorError::Failure { code, message }
            if code == failure_code::DATA_ERROR && message.contains("Code Entry Tag") =>
        {
            TrezorError::Pairing(
                "the code is wrong: it is not the one the Trezor shows (pair again and type \
                 the digits of the new screen)"
                    .into(),
            )
        }
        other => other,
    }
}

/// The tag that proves to the device that the host knows the code: the
/// SHA-256 of the CPace shared secret.
pub(crate) fn code_entry_tag(shared_secret: &[u8; 32]) -> Vec<u8> {
    Sha256::digest(shared_secret).to_vec()
}

/// What the device commits to before it shows the code: the SHA-256 of its
/// secret.
pub(crate) fn code_entry_commitment(secret: &[u8]) -> [u8; 32] {
    Sha256::digest(secret).into()
}

/// The six digits the device shows:
/// `SHA-256(0x02 || handshake_hash || secret || challenge)` read as a
/// big-endian integer, modulo 1,000,000, zero-padded.
pub(crate) fn code_entry_code(handshake_hash: &[u8], secret: &[u8], challenge: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update([CODE_ENTRY_DOMAIN]);
    hasher.update(handshake_hash);
    hasher.update(secret);
    hasher.update(challenge);
    let digest = hasher.finalize();
    // Horner's rule one byte at a time: no big integer needed, and the
    // accumulator stays below 1,000,000 * 256.
    let value = digest.iter().fold(0u64, |acc, byte| {
        (acc * 256 + u64::from(*byte)) % CODE_MODULUS
    });
    format!("{value:06}")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Values computed with Python's `hashlib`:
    /// `int.from_bytes(sha256(b"\x02" + hh + secret + challenge).digest(), "big") % 10**6`.
    #[test]
    fn code_matches_python_hashlib() {
        let handshake_hash: Vec<u8> = (0..32).collect();
        let secret: Vec<u8> = (100..116).collect();
        assert_eq!(
            code_entry_code(&handshake_hash, &secret, &[0xA5; 32]),
            "164537"
        );
        // 0x0436 repeated: the code is 742, so it needs its zero padding.
        let challenge = [0x04, 0x36].repeat(16);
        assert_eq!(
            code_entry_code(&handshake_hash, &secret, &challenge),
            "000742"
        );
    }

    #[test]
    fn wrong_code_failure_is_a_pairing_error() {
        let failure = TrezorError::Failure {
            code: failure_code::DATA_ERROR,
            message: "Unexpected Code Entry Tag".into(),
        };
        assert!(matches!(wrong_code(failure), TrezorError::Pairing(m) if m.contains("wrong")));
        // Other failures pass through untouched.
        let other = TrezorError::Failure {
            code: failure_code::DATA_ERROR,
            message: "Invalid CPACE host public key".into(),
        };
        assert!(matches!(wrong_code(other), TrezorError::Failure { .. }));
        assert!(matches!(
            wrong_code(TrezorError::Cancelled),
            TrezorError::Cancelled
        ));
    }

    #[test]
    fn a_paired_claim_counts_only_with_a_matching_stored_credential() {
        // The device says paired and a stored credential matched.
        assert!(already_paired(true, true).expect("believed"));
        // Unpaired: pair, whether or not a stale credential matched.
        assert!(!already_paired(false, false).expect("pair"));
        assert!(!already_paired(false, true).expect("pair again"));
        // Paired claim with nothing on record: an error that says so.
        let error = already_paired(true, false).expect_err("not believed");
        assert!(matches!(
            error,
            TrezorError::Pairing(m) if m.contains("claims a pairing this computer has no record of")
        ));
    }

    #[cfg(feature = "emulator")]
    #[test]
    fn skipping_needs_the_option_and_an_emulator_transport() {
        assert!(skip_pairing_allowed(true, true));
        assert!(!skip_pairing_allowed(true, false));
        assert!(!skip_pairing_allowed(false, true));
        assert!(!skip_pairing_allowed(false, false));
    }

    #[derive(Default)]
    struct RecordingUi {
        calls: Vec<&'static str>,
    }

    impl Ui for RecordingUi {
        fn confirm_on_device(&mut self) {
            self.calls.push("confirm");
        }

        fn enter_passphrase_on_device(&mut self) {
            self.calls.push("passphrase");
        }

        fn pairing_code(&mut self) -> Result<String> {
            unreachable!("no pairing here")
        }
    }

    /// An implementor that knows nothing of passphrases.
    #[derive(Default)]
    struct ConfirmOnlyUi {
        confirmations: usize,
    }

    impl Ui for ConfirmOnlyUi {
        fn confirm_on_device(&mut self) {
            self.confirmations += 1;
        }

        fn pairing_code(&mut self) -> Result<String> {
            unreachable!("no pairing here")
        }
    }

    fn button_request(code: Option<i32>) -> Vec<u8> {
        ButtonRequest {
            code,
            pages: None,
            name: None,
        }
        .encode_to_vec()
    }

    #[test]
    fn only_the_passphrase_entry_code_reaches_the_passphrase_call() {
        let mut ui = RecordingUi::default();
        notify_ui(
            &mut ui,
            &button_request(Some(button_request_type::PASSPHRASE_ENTRY)),
        );
        // SignTx, Other, PinEntry, no code, and bytes that are not a message.
        for request in [
            button_request(Some(8)),
            button_request(Some(1)),
            button_request(Some(20)),
            button_request(None),
            vec![0xff, 0xff],
        ] {
            notify_ui(&mut ui, &request);
        }
        assert_eq!(
            ui.calls,
            [
                "passphrase",
                "confirm",
                "confirm",
                "confirm",
                "confirm",
                "confirm"
            ]
        );
    }

    #[test]
    fn the_passphrase_call_defaults_to_the_confirmation() {
        let mut ui = ConfirmOnlyUi::default();
        notify_ui(
            &mut ui,
            &button_request(Some(button_request_type::PASSPHRASE_ENTRY)),
        );
        notify_ui(&mut ui, &button_request(Some(8)));
        assert_eq!(ui.confirmations, 2);
    }

    #[test]
    fn the_session_request_follows_the_option() {
        let standard = ConnectOptions::default();
        assert!(!standard.passphrase_on_device);
        let request = standard.session_request();
        assert_eq!(hex::encode(request.encode_to_vec()), "0a00");

        let hidden = ConnectOptions::default().passphrase_on_device(true);
        let request = hidden.session_request();
        assert_eq!(request.passphrase, None);
        assert_eq!(hex::encode(request.encode_to_vec()), "1001");

        // Off again: the standard wallet.
        let again = hidden.passphrase_on_device(false);
        assert_eq!(hex::encode(again.session_request().encode_to_vec()), "0a00");
    }

    #[test]
    fn options_default_to_no_skipping() {
        let options = ConnectOptions::default();
        assert_eq!(options.app_name, "thru");
        #[cfg(feature = "emulator")]
        assert!(!options.allow_skip_pairing);
    }

    #[cfg(feature = "emulator")]
    #[test]
    fn skipping_is_an_explicit_choice() {
        let options = ConnectOptions::new("host", "app").allow_skip_pairing(true);
        assert!(options.allow_skip_pairing);
        assert!(!options.allow_skip_pairing(false).allow_skip_pairing);
    }
}
