//! Reads the Thru public key from a Trezor and has it sign a transaction body
//! a text message or an EOA authorization, through [`TrezorSigner`], to check the host end to end.
//!
//! ```text
//! trezor_check (--emulator ADDR | --usb) --app PATH.tapp [--path PATH]
//!              [--credentials FILE] [--pairing skip|code]
//!              [--passphrase-on-device]                    key [--show]
//! trezor_check ...                                          sign --body-hex HEX
//!                                                           [--token-hint HEX]
//! trezor_check ...                                          sign-message (--text S | --hex H)
//! trezor_check ...                                          sign-eoa-auth --kind create|delete
//!                                                           --chain-id N --fee-payer HEX
//! ```
//!
//! `--passphrase-on-device` opens the session of a passphrase (hidden) wallet
//! whose passphrase is typed on the device (any command).
//!
//! `key` prints `public_key: HEX` and `address: ADDR`; `sign`, `sign-message`
//! and `sign-eoa-auth` print the signature in hex. The account of
//! `sign-eoa-auth` is the device's key; `--fee-payer` is 32 bytes in hex. `--token-hint` is the 129-byte
//! token hint for a token transfer. The path defaults to `m/44'/8478'/0'/0'`.
//!
//! Pairing by `code` (the default) asks for the six digits the device shows,
//! on standard input; the credential the device issues is kept in
//! `--credentials FILE` (in memory only if there is none), and the next run
//! with the same file does not ask again. `--pairing skip` pairs without a
//! code, which only the emulator allows, and only with `--emulator`.
//!
//! The protocol is found by probing the connection, so the same command works
//! against a Safe 7 (the Trezor Host Protocol) and a Safe 5 (the older
//! protocol, accepted from the emulator only: any other transport that answers in
//! it is refused). On the older protocol nothing is paired: the
//! pairing and credential options are not used, and a standard key
//! (without `--passphrase-on-device`) is refused on a device set to ask for
//! the passphrase on the device, while a passphrase key is refused on a
//! device whose passphrase protection is off.
//!
//! With `TREZOR_CHECK_LOG` set (to anything), the log of this crate and of
//! `trezor-thp` (the protocol found, busy answers, retransmissions) goes to
//! standard error.

use std::io::{BufRead, Write};
use std::process::ExitCode;

use thru_base::signer::{EoaAuthKind, Signer};
use thru_trezor::{
    AppImage, ConnectOptions, CredentialStorage, DerivationPath, FileCredentialStorage,
    MemoryCredentialStorage, Result, TOKEN_HINT_LEN, Transport, TrezorError, TrezorSigner,
    UdpTransport, Ui,
};

const DEFAULT_PATH: &str = "m/44'/8478'/0'/0'";

/// Prints log records to standard error (the example has no logger crate).
struct StderrLog;

impl log::Log for StderrLog {
    fn enabled(&self, _: &log::Metadata<'_>) -> bool {
        true
    }

    fn log(&self, record: &log::Record<'_>) {
        eprintln!("[{} {}] {}", record.level(), record.target(), record.args());
    }

    fn flush(&self) {}
}

static LOGGER: StderrLog = StderrLog;

struct Terminal;

impl Ui for Terminal {
    fn confirm_on_device(&mut self) {
        eprintln!("Confirm on the Trezor.");
    }

    fn enter_passphrase_on_device(&mut self) {
        eprintln!("Enter the passphrase on the Trezor.");
    }

    fn pairing_code(&mut self) -> Result<String> {
        eprint!("Code shown on the Trezor: ");
        let _ = std::io::stderr().flush();
        let mut line = String::new();
        std::io::stdin()
            .lock()
            .read_line(&mut line)
            .map_err(|e| TrezorError::Pairing(format!("could not read the code: {e}")))?;
        // The device shows the digits as "123 456".
        Ok(line.chars().filter(|c| !c.is_whitespace()).collect())
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Pairing {
    Skip,
    Code,
}

enum Device {
    Emulator(String),
    #[cfg(feature = "usb")]
    Usb,
}

struct Args {
    device: Device,
    app: String,
    path: String,
    credentials: Option<String>,
    pairing: Pairing,
    passphrase_on_device: bool,
    command: Command,
}

enum Command {
    Key {
        show: bool,
    },
    Sign {
        body: Vec<u8>,
        token_hint: Option<[u8; TOKEN_HINT_LEN]>,
    },
    SignMessage {
        message: Vec<u8>,
    },
    SignEoaAuth {
        kind: EoaAuthKind,
        chain_id: u16,
        fee_payer: [u8; 32],
    },
}

fn parse_args() -> std::result::Result<Args, String> {
    let mut device = None;
    let mut app = None;
    let mut path = DEFAULT_PATH.to_owned();
    let mut credentials = None;
    let mut pairing = Pairing::Code;
    let mut command = None;
    let mut show = false;
    let mut body_hex = None;
    let mut token_hint_hex = None;
    let mut text = None;
    let mut message_hex = None;
    let mut passphrase_on_device = false;
    let mut eoa_kind = None;
    let mut chain_id = None;
    let mut fee_payer_hex = None;
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        let mut value = |name: &str| args.next().ok_or_else(|| format!("{name} needs a value"));
        match arg.as_str() {
            "--emulator" => device = Some(Device::Emulator(value("--emulator")?)),
            #[cfg(feature = "usb")]
            "--usb" => device = Some(Device::Usb),
            "--app" => app = Some(value("--app")?),
            "--path" => path = value("--path")?,
            "--credentials" => credentials = Some(value("--credentials")?),
            "--pairing" => {
                pairing = match value("--pairing")?.as_str() {
                    "skip" => Pairing::Skip,
                    "code" => Pairing::Code,
                    other => return Err(format!("--pairing is skip or code, not {other:?}")),
                }
            }
            "--body-hex" => body_hex = Some(value("--body-hex")?),
            "--token-hint" => token_hint_hex = Some(value("--token-hint")?),
            "--text" => text = Some(value("--text")?),
            "--hex" => message_hex = Some(value("--hex")?),
            "--show" => show = true,
            "--passphrase-on-device" => passphrase_on_device = true,
            "--kind" => eoa_kind = Some(value("--kind")?),
            "--chain-id" => chain_id = Some(value("--chain-id")?),
            "--fee-payer" => fee_payer_hex = Some(value("--fee-payer")?),
            "key" | "sign" | "sign-message" | "sign-eoa-auth" if command.is_none() => {
                command = Some(arg)
            }
            other => return Err(format!("unknown argument {other:?}")),
        }
    }
    let command = match command.as_deref() {
        Some("key") => Command::Key { show },
        Some("sign") => {
            let hex_text = body_hex.ok_or("sign needs --body-hex")?;
            let body = hex::decode(hex_text.trim()).map_err(|e| format!("--body-hex: {e}"))?;
            let token_hint = token_hint_hex
                .map(|text| {
                    let bytes =
                        hex::decode(text.trim()).map_err(|e| format!("--token-hint: {e}"))?;
                    <[u8; TOKEN_HINT_LEN]>::try_from(bytes.as_slice()).map_err(|_| {
                        format!(
                            "--token-hint is {TOKEN_HINT_LEN} bytes, not {}",
                            bytes.len()
                        )
                    })
                })
                .transpose()?;
            Command::Sign { body, token_hint }
        }
        Some("sign-message") => {
            let message = match (text, message_hex) {
                (Some(text), None) => text.into_bytes(),
                (None, Some(hex_text)) => {
                    hex::decode(hex_text.trim()).map_err(|e| format!("--hex: {e}"))?
                }
                _ => return Err("sign-message needs one of --text or --hex".into()),
            };
            Command::SignMessage { message }
        }
        Some("sign-eoa-auth") => {
            let kind = match eoa_kind.as_deref() {
                Some("create") => EoaAuthKind::Create,
                Some("delete") => EoaAuthKind::Delete,
                Some(other) => return Err(format!("--kind is create or delete, not {other:?}")),
                None => return Err("sign-eoa-auth needs --kind create|delete".into()),
            };
            let chain_id = chain_id
                .ok_or("sign-eoa-auth needs --chain-id")?
                .parse::<u16>()
                .map_err(|e| format!("--chain-id is a number of 1 to 65535: {e}"))?;
            let fee_payer = fee_payer_hex.ok_or("sign-eoa-auth needs --fee-payer")?;
            let fee_payer =
                hex::decode(fee_payer.trim()).map_err(|e| format!("--fee-payer: {e}"))?;
            let fee_payer = <[u8; 32]>::try_from(fee_payer.as_slice()).map_err(|_| {
                format!(
                    "--fee-payer is 32 bytes in hex, not {} bytes",
                    fee_payer.len()
                )
            })?;
            Command::SignEoaAuth {
                kind,
                chain_id,
                fee_payer,
            }
        }
        _ => {
            return Err("expected the command key, sign, sign-message or sign-eoa-auth".into());
        }
    };
    let device = device.ok_or("say where the device is: --emulator HOST:PORT or --usb")?;
    // Skipping pairing is the emulator's: a device reached over USB must go
    // through the code.
    if pairing == Pairing::Skip && !matches!(device, Device::Emulator(_)) {
        return Err("--pairing skip is only for --emulator".into());
    }
    Ok(Args {
        device,
        app: app.ok_or("--app PATH is required")?,
        path,
        credentials,
        pairing,
        passphrase_on_device,
        command,
    })
}

/// Opens the transport and the options for it.
fn open(
    device: &Device,
    pairing: Pairing,
    passphrase_on_device: bool,
) -> std::result::Result<(Box<dyn Transport + Send>, ConnectOptions), Box<dyn std::error::Error>> {
    let options =
        ConnectOptions::new("localhost", "trezor_check").passphrase_on_device(passphrase_on_device);
    match device {
        Device::Emulator(addr) => {
            eprintln!(
                "WARNING: talking to an emulator at {addr}, not to a device; its answers are not authenticated."
            );
            let transport = UdpTransport::connect(addr)?;
            // The one place that allows skipping pairing.
            Ok((
                Box::new(transport),
                options.allow_skip_pairing(pairing == Pairing::Skip),
            ))
        }
        #[cfg(feature = "usb")]
        Device::Usb => Ok((Box::new(thru_trezor::UsbTransport::open()?), options)),
    }
}

fn run(args: Args) -> std::result::Result<(), Box<dyn std::error::Error>> {
    let path: DerivationPath = args.path.parse()?;
    let image = AppImage::read(&args.app)?;
    let storage: Box<dyn CredentialStorage> = match &args.credentials {
        Some(file) => Box::new(FileCredentialStorage::new(file)),
        None => Box::new(MemoryCredentialStorage::new()),
    };
    let (transport, options) = open(&args.device, args.pairing, args.passphrase_on_device)?;

    let signer = TrezorSigner::connect(
        transport,
        &options,
        &image,
        path,
        storage.as_ref(),
        Box::new(Terminal),
    )?;
    match args.command {
        Command::Key { show } => {
            if show {
                signer.verify_address_on_device()?;
            }
            println!("public_key: {}", hex::encode(signer.public_key()));
            println!("address: {}", signer.address());
        }
        Command::Sign { body, token_hint } => {
            let signature = match token_hint {
                // The device checks the hint against the body.
                Some(hint) => signer.try_sign_transaction_body_with_token_hint(&body, &hint)?,
                None => signer.sign_transaction_body(&body)?,
            };
            println!("{}", hex::encode(signature));
        }
        Command::SignMessage { message } => {
            let signature = signer.try_sign_message(&message)?;
            println!("{}", hex::encode(signature));
        }
        Command::SignEoaAuth {
            kind,
            chain_id,
            fee_payer,
        } => {
            // The account of the authorization is the device's own key.
            let signature =
                signer.try_sign_eoa_auth(kind, chain_id, &fee_payer, &signer.pubkey())?;
            println!("{}", hex::encode(signature));
        }
    }
    Ok(())
}

fn main() -> ExitCode {
    if std::env::var_os("TREZOR_CHECK_LOG").is_some() {
        let _ = log::set_logger(&LOGGER);
        log::set_max_level(log::LevelFilter::Debug);
    }
    let args = match parse_args() {
        Ok(args) => args,
        Err(message) => {
            eprintln!("error: {message}");
            eprintln!(
                "usage: trezor_check (--emulator HOST:PORT | --usb) --app PATH.tapp [--path PATH] \
                 [--credentials FILE] [--pairing skip|code] [--passphrase-on-device] key [--show] | \
                 sign --body-hex HEX [--token-hint HEX] | sign-message (--text S | --hex H) | \
                 sign-eoa-auth --kind create|delete --chain-id N --fee-payer HEX"
            );
            return ExitCode::from(2);
        }
    };
    match run(args) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("error: {error}");
            ExitCode::FAILURE
        }
    }
}
