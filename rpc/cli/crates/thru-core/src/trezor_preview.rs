//! What the Thru app on a Trezor Safe 7 shows for a request, computed on the
//! host before the request is sent (plan `specs/trezor/app-tokens-messages-plan.md`,
//! decisions P1 and P2).
//!
//! The functions here are plain: no device, no I/O.  Given what is about to be
//! signed they return the whole review the app will draw, step by step, or
//! `None` when the app will refuse the request without showing anything.  The
//! CLI prints the review to standard error right before the request is sent
//! and adds it to the `--json` output as `trezor_preview`.
//!
//! The app is `no_std` and cannot be linked into the CLI, so the two
//! implementations are tied by tests (risk R7), not by shared code:
//!
//! * The app's shape rules (`trezor/app-thru/src/action.rs`) are applied
//!   again here, and every case of the app's generated fixture
//!   (`tests/fixtures/sign_tx.json`) must give the preview the fixture says.
//! * The app's labels, titles, notes and warnings are the table [`TEXTS`]; the
//!   tests read `translations/en.json` of the app and compare, in both
//!   directions, so a changed or an added text of the app fails the CLI's
//!   test.  The CLI never reads the app's file at run time.
//! * The emulator-level comparison (the screens the device drew against this
//!   review) is a script of `trezor/scripts`; it reads the JSON below.
//!
//! # JSON schema of `trezor_preview`
//!
//! The value is `null` when there is no review (the app refuses the request),
//! else an object.  Every key listed is always present; there are no others.
//!
//! ```text
//! Review  = { "kind":  string,        // "transfer" | "create_account" | "token_transfer"
//!                                     // | "wallet_transfer" | "message" | "eoa_auth"
//!             "steps": [ Step ] }     // in the order the app shows them; never empty
//! Step    = { "name":  string,        // the app's name of the step: the part of the
//!                                     // ButtonRequest name after "thru.thru.org/"
//!             "title": string,        // the title of the step's screen
//!             "items": [ Item ],      // in the order they are drawn
//!             "menus": [ Menu ] }     // in the order of the step's menu; [] if none
//! Item    = Field
//!         | { "type": "note",    "text": string }   // a sentence without a label
//!         | { "type": "warning", "text": string }   // a sentence without a label, drawn as a warning
//! Field   = { "type":  "field",
//!             "label": string,
//!             "value": string,        // "" for an empty message line
//!             "unit":  string | null }  // "THRU" for an amount of THRU: drawn "<value> <unit>"
//! Menu    = { "name":   string,       // the entry of the step's menu
//!             "fields": [ Field ] }   // in the order of the menu's screen
//! ```
//!
//! Whatever is not listed is not part of the review: Core's own navigation,
//! the "hold to confirm" answer and the closing "Transaction signed" screen.
//!
//! One full example per kind is in the tests of this module
//! (`json_of_every_kind`).

use std::fmt::Write as _;

use serde_json::{Value, json};
use thru_base::bootstrap_addresses::NOOP_PROGRAM_BYTES;
use thru_base::signer::EoaAuthKind;
use thru_base::tn_public_address::tn_pubkey_to_address_string;
use thru_ledger::consts::{FEE_WARN_THRESHOLD, THRU_DECIMALS, TXN_HDR_SZ};
use thru_ledger::preview::{TransactionPreview, format_amount, is_text_message, network_label};
use thru_ledger::{CheckedToken, ClearTransfer, TokenHint, TokenIdentity, TransferKind};
use thru_trezor::DerivationPath;

/// Declares the texts of the app's reviews: a constant for each, and the table
/// [`TEXTS`] of `(key in the app's translations/en.json, English text)` that
/// the tests compare with that file.
macro_rules! texts {
    ($($name:ident = $key:literal, $en:literal;)*) => {
        $(const $name: &str = $en;)*
        /// Every fixed text of a review, with the key the app's
        /// `translations/en.json` gives it.  A text the app does not have yet
        /// carries the key the plan's wording suggests; the test then looks
        /// for the text itself.
        #[cfg(test)]
        pub(crate) const TEXTS: &[(&str, &str)] = &[$(($key, $en)),*];
    };
}

texts! {
    ACCOUNT = "thru__account", "Account";
    ACCOUNT_NAME = "thru__account_name", "Thru";
    ADDRESS_TYPE = "thru__address_type", "Address type";
    AMOUNT = "thru__amount", "Amount";
    AMOUNT_BASE_UNITS = "thru__amount_base_units", "Amount (base units)";
    AUTHORITY_INDEX = "thru__authority_index", "Authority index";
    BYTES = "thru__bytes", "bytes";
    CREATE_ACCOUNT = "thru__create_account", "Create account";
    DETAILS = "thru__details", "Details";
    EOA_CREATE_NOTE = "thru__eoa_create_note", "The fee payer can create this account.";
    EOA_CREATE_TITLE = "thru__eoa_create_title", "Authorize account creation";
    EOA_DELETE_NOTE = "thru__eoa_delete_note", "The fee payer can delete this account, or clear its data, while its balance and nonce are zero.";
    EOA_DELETE_TITLE = "thru__eoa_delete_title", "Authorize account deletion";
    EOA_REUSE_NOTE = "thru__eoa_reuse_note", "This authorization does not expire and can be used again.";
    FEE = "thru__fee", "Fee";
    FEE_PAYER = "thru__fee_payer", "Fee payer";
    FROM = "thru__from", "From";
    HIGH_FEE = "thru__high_fee", "The fee is above 0.1 THRU.";
    HIGH_FEE_TITLE = "thru__high_fee_title", "High fee";
    LENGTH = "thru__length", "Length";
    MESSAGE_HASH = "thru__message_hash", "Message hash";
    NETWORK = "thru__network", "Network";
    NONCE = "thru__nonce", "Nonce";
    PATH = "thru__path", "Derivation path";
    RECIPIENT = "thru__recipient", "Recipient";
    SEND = "thru__send", "Send";
    SEND_FROM_WALLET = "thru__send_from_wallet", "Send from wallet";
    SEND_TOKEN = "thru__send_token", "Send token";
    SIGN_MESSAGE = "thru__sign_message", "Sign message";
    SIGNER = "thru__signer", "Signer";
    SUMMARY = "thru__summary", "Summary";
    TICKER = "thru__ticker", "Ticker";
    TOKEN_ACCOUNT_OWNERS = "thru__token_account_owners", "Token account owners";
    TOKEN_ACCOUNTS = "thru__token_accounts", "Token accounts";
    TOKEN_MINT = "thru__token_mint", "Token mint";
    TOKEN_UNKNOWN = "thru__token_unknown", "The transaction does not identify the token.";
    TX_HASH = "thru__tx_hash", "Transaction hash";
    VALID_SLOTS = "thru__valid_slots", "Valid slots";
}

/// Unit of an amount of THRU (the app's `TICKER`; not a translation).
const THRU_UNIT: &str = "THRU";

/// The `flags` bit of a fee payer proof (`TN_TXN_FLAG_HAS_FEE_PAYER_PROOF`).
const FLAG_HAS_FEE_PAYER_PROOF: u8 = 1;

/// The header's two padding bytes.  The device's parser refuses a body in
/// which either is not zero (`pad_nonzero`); the host validation follows the
/// node, which does not look at them.
const HEADER_PAD: std::ops::Range<usize> = 46..48;

/// A fact of a review: a label and its value, with the unit an amount is drawn
/// with.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Field {
    pub label: String,
    pub value: String,
    pub unit: Option<&'static str>,
}

/// One thing drawn on a step's screen.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Item {
    Field(Field),
    /// A sentence without a label.
    Note(String),
    /// A sentence without a label, drawn as a warning.
    Warning(String),
}

/// An entry of a step's menu and the fields on its screen.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Menu {
    pub name: String,
    pub fields: Vec<Field>,
}

/// One step of a review: a screen (or a paged list) the person passes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Step {
    pub name: &'static str,
    pub title: String,
    pub items: Vec<Item>,
    pub menus: Vec<Menu>,
}

/// The whole review of one request.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Review {
    pub kind: &'static str,
    pub steps: Vec<Step>,
}

fn text_field(label: &str, value: impl Into<String>) -> Field {
    Field {
        label: label.to_string(),
        value: value.into(),
        unit: None,
    }
}

fn thru_field(label: &str, value: impl Into<String>) -> Field {
    Field {
        unit: Some(THRU_UNIT),
        ..text_field(label, value)
    }
}

fn address(key: &[u8; 32]) -> String {
    tn_pubkey_to_address_string(key)
}

fn thru(base_units: u64) -> String {
    format_amount(base_units, THRU_DECIMALS)
}

fn item(field: Field) -> Item {
    Item::Field(field)
}

/// The menu "Account": the wallet's name for the account (the four-component
/// path only) and the path.
fn account_menu(path: &DerivationPath) -> Menu {
    let mut fields = Vec::with_capacity(2);
    if path.depth() == 4 {
        let number = u64::from(path.account()) + 1;
        fields.push(text_field(ACCOUNT, format!("{ACCOUNT_NAME} #{number}")));
    }
    fields.push(text_field(PATH, path.to_string()));
    Menu {
        name: ACCOUNT.to_string(),
        fields,
    }
}

fn details_menu(fields: Vec<Field>) -> Menu {
    Menu {
        name: DETAILS.to_string(),
        fields,
    }
}

// ----- transactions -----

/// What a signable transaction does (the app's `Action`, with the wallet
/// transfer of decision W1).
enum Action {
    Transfer {
        recipient: [u8; 32],
        amount: u64,
    },
    CreateAccount,
    Token {
        source: [u8; 32],
        recipient: [u8; 32],
        amount: u64,
        checked: Option<CheckedToken>,
        identity: Option<TokenIdentity>,
    },
    Wallet {
        source: [u8; 32],
        recipient: [u8; 32],
        amount: u64,
        authority_index: u8,
    },
}

/// The proof type of the fee payer proof, which `TransactionPreview` does not
/// carry: the top two bits of the proof header's first word.
#[derive(Clone, Copy, PartialEq, Eq)]
enum ProofType {
    Existing,
    Creation,
    Other,
}

fn proof_type(body: &[u8], p: &TransactionPreview) -> Option<ProofType> {
    let accounts = (usize::from(p.rw_cnt) + usize::from(p.ro_cnt)) * 32;
    let at = TXN_HDR_SZ + accounts + usize::from(p.instr_sz);
    let word = u64::from_le_bytes(body.get(at..at + 8)?.try_into().ok()?);
    Some(match word >> 62 {
        0 => ProofType::Existing,
        2 => ProofType::Creation,
        _ => ProofType::Other,
    })
}

/// The review of the transaction `body` (the bytes the device is sent), signed
/// by `signer` at `path`, with the token hint the CLI sends if any; `None`
/// when the app refuses the request without a screen: a body the host
/// validation rejects, a fee payer that is not `signer`, a hint that does not
/// prove the transaction's token accounts, or a shape the app does not sign
/// (anything but the layouts the CLI builds).  The flags and the proof of the
/// fee payer are read from `body`.
pub fn transaction_review(
    body: &[u8],
    signer: &[u8; 32],
    path: &DerivationPath,
    hint: Option<&TokenHint>,
) -> Option<Review> {
    let p = TransactionPreview::from_body(body).ok()?;
    if &p.fee_payer_key != signer {
        return None;
    }
    if body.get(HEADER_PAD)?.iter().any(|byte| *byte != 0) {
        return None;
    }
    // The hint is proven first; a hint that does not verify is refused
    // whatever the shape is.
    let identity = match hint {
        Some(hint) => Some(thru_ledger::verify_token_hint(body, hint).ok()?),
        None => None,
    };
    let flags = *body.get(1)?;
    let proof = (flags & FLAG_HAS_FEE_PAYER_PROOF != 0)
        .then(|| proof_type(body, &p))
        .flatten();
    let action = classify(&p, flags, proof, identity)?;
    Some(review_of(&action, &p, path))
}

/// The shape rules of the app (`action.rs`, decisions T1 and W1).
fn classify(
    p: &TransactionPreview,
    flags: u8,
    proof: Option<ProofType>,
    identity: Option<TokenIdentity>,
) -> Option<Action> {
    if let Some(t) = &p.transfer {
        // No fee payer proof and no permission to compress accounts.
        if flags != 0 {
            return None;
        }
        return match t.kind {
            TransferKind::Native => native_transfer(p, t),
            TransferKind::Token => token_transfer(p, t, identity),
            TransferKind::Wallet => wallet_transfer(p, t),
        };
    }
    is_account_creation(p, flags, proof).then_some(Action::CreateAccount)
}

/// The transfer `thru transfer` builds: the EOA program's transfer from the fee
/// payer to the single read-write account, and nothing else.
fn native_transfer(p: &TransactionPreview, t: &ClearTransfer) -> Option<Action> {
    if p.rw_cnt != 1
        || p.ro_cnt != 0
        || t.source != p.fee_payer_key
        || t.authority_index.is_some()
        || t.checked.is_some()
        || t.recipient == p.fee_payer_key
    {
        return None;
    }
    Some(Action::Transfer {
        recipient: t.recipient,
        amount: t.amount,
    })
}

/// The transfers `thru token transfer` builds: two read-write token accounts,
/// and for `TransferChecked` the mint as the only read-only account; source
/// and recipient differ.
fn token_transfer(
    p: &TransactionPreview,
    t: &ClearTransfer,
    identity: Option<TokenIdentity>,
) -> Option<Action> {
    let read_only = u16::from(t.checked.is_some());
    if p.rw_cnt != 2
        || p.ro_cnt != read_only
        || t.source == t.recipient
        || t.authority_index.is_some()
    {
        return None;
    }
    Some(Action::Token {
        source: t.source,
        recipient: t.recipient,
        amount: t.amount,
        checked: t.checked,
        identity,
    })
}

/// Decision W1, written from the plan (the app does not have it yet): no
/// read-only account, and the read-write accounts are exactly the ones named:
/// the wallet account and the recipient (two, different), or the wallet
/// account alone when the recipient is the fee payer.
fn wallet_transfer(p: &TransactionPreview, t: &ClearTransfer) -> Option<Action> {
    let authority_index = t.authority_index?;
    let named_ok = if t.recipient == p.fee_payer_key {
        p.rw_cnt == 1
    } else {
        p.rw_cnt == 2 && t.source != t.recipient
    };
    if p.ro_cnt != 0 || t.source == p.fee_payer_key || t.checked.is_some() || !named_ok {
        return None;
    }
    Some(Action::Wallet {
        source: t.source,
        recipient: t.recipient,
        amount: t.amount,
        authority_index,
    })
}

/// The transaction `thru account create` builds: the no-op program, no
/// accounts, no instruction data, no fee, nonce 0, and a CREATION proof for the
/// fee payer.
fn is_account_creation(p: &TransactionPreview, flags: u8, proof: Option<ProofType>) -> bool {
    flags == FLAG_HAS_FEE_PAYER_PROOF
        && proof == Some(ProofType::Creation)
        && p.program_key == NOOP_PROGRAM_BYTES
        && p.rw_cnt == 0
        && p.ro_cnt == 0
        && p.instr_sz == 0
        && p.fee_base_units == 0
        && p.nonce == 0
}

fn review_of(action: &Action, p: &TransactionPreview, path: &DerivationPath) -> Review {
    let network = text_field(NETWORK, network_label(p.chain_id));
    let fee = thru_field(FEE, thru(p.fee_base_units));
    let high_fee = p.fee_base_units > FEE_WARN_THRESHOLD;
    let nonce = text_field(NONCE, p.nonce.to_string());
    let valid_slots = text_field(VALID_SLOTS, p.valid_slots.clone());
    let tx_hash = text_field(TX_HASH, p.transaction_hash.clone());
    let signer = address(&p.fee_payer_key);
    let summary_menu = details_menu(vec![nonce, valid_slots.clone(), tx_hash.clone()]);

    // The steps every transfer has: parties, the warning of a high fee, sums.
    let transfer = |kind: &'static str,
                    name: &'static str,
                    title: &str,
                    parties: Vec<Item>,
                    sums: Vec<Item>| {
        let mut steps = vec![Step {
            name,
            title: title.to_string(),
            items: parties,
            menus: vec![account_menu(path)],
        }];
        if high_fee {
            steps.push(Step {
                name: match name {
                    "transfer" => "transfer/high_fee",
                    "token_transfer" => "token_transfer/high_fee",
                    _ => "wallet_transfer/high_fee",
                },
                title: HIGH_FEE_TITLE.to_string(),
                items: vec![Item::Warning(HIGH_FEE.to_string())],
                menus: Vec::new(),
            });
        }
        steps.push(Step {
            name: match name {
                "transfer" => "transfer/summary",
                "token_transfer" => "token_transfer/summary",
                _ => "wallet_transfer/summary",
            },
            title: SUMMARY.to_string(),
            items: sums,
            menus: vec![summary_menu.clone()],
        });
        Review { kind, steps }
    };

    match action {
        Action::Transfer { recipient, amount } => transfer(
            "transfer",
            "transfer",
            SEND,
            vec![
                item(text_field(FROM, signer.clone())),
                item(text_field(RECIPIENT, address(recipient))),
                item(network),
            ],
            vec![item(thru_field(AMOUNT, thru(*amount))), item(fee)],
        ),
        Action::CreateAccount => Review {
            kind: "create_account",
            steps: vec![Step {
                name: "create_account",
                title: CREATE_ACCOUNT.to_string(),
                items: vec![
                    item(text_field(ACCOUNT, signer)),
                    item(network),
                    item(thru_field(FEE, thru(p.fee_base_units))),
                ],
                // The nonce of an account creation is fixed to 0, so it is
                // not listed.
                menus: vec![account_menu(path), details_menu(vec![valid_slots, tx_hash])],
            }],
        },
        Action::Token {
            source,
            recipient,
            amount,
            checked,
            identity,
        } => {
            // With a proven hint the parties are the owners of the token
            // accounts and the hint names the mint; else the token accounts
            // themselves, and the mint only if the instruction names it.
            let (from, to, mint) = match identity {
                Some(id) => (id.source_owner, id.recipient_owner, Some(id.mint)),
                None => (*source, *recipient, checked.map(|c| c.mint)),
            };
            let mut parties = Vec::with_capacity(8);
            if identity.is_none() {
                parties.push(item(text_field(FEE_PAYER, signer)));
            }
            parties.push(item(text_field(FROM, address(&from))));
            parties.push(item(text_field(RECIPIENT, address(&to))));
            if let Some(mint) = mint {
                parties.push(item(text_field(TOKEN_MINT, address(&mint))));
            }
            let address_type = if identity.is_some() {
                TOKEN_ACCOUNT_OWNERS
            } else {
                TOKEN_ACCOUNTS
            };
            parties.push(item(text_field(ADDRESS_TYPE, address_type)));
            // A plain transfer names no mint; only a proven hint supplies one.
            if mint.is_none() {
                parties.push(Item::Warning(TOKEN_UNKNOWN.to_string()));
            }
            parties.push(item(network));

            let mut sums = Vec::with_capacity(3);
            match checked {
                Some(token) => {
                    let whole = format_amount(*amount, u32::from(token.decimals));
                    sums.push(item(text_field(AMOUNT, whole)));
                    if !token.ticker().is_empty() {
                        sums.push(item(text_field(TICKER, token.ticker())));
                    }
                }
                None => sums.push(item(text_field(AMOUNT_BASE_UNITS, amount.to_string()))),
            }
            sums.push(item(fee));
            transfer(
                "token_transfer",
                "token_transfer",
                SEND_TOKEN,
                parties,
                sums,
            )
        }
        Action::Wallet {
            source,
            recipient,
            amount,
            authority_index,
        } => transfer(
            "wallet_transfer",
            "wallet_transfer",
            SEND_FROM_WALLET,
            vec![
                item(text_field(FEE_PAYER, signer)),
                item(text_field(FROM, address(source))),
                item(text_field(RECIPIENT, address(recipient))),
                item(text_field(AUTHORITY_INDEX, authority_index.to_string())),
                item(network),
            ],
            vec![item(thru_field(AMOUNT, thru(*amount))), item(fee)],
        ),
    }
}

// ----- messages -----

/// The review of a text message signed by `signer` at `path`; `None` when the
/// app refuses the message (anything `is_text_message` does not accept, an
/// empty message and one over 512 bytes included).
///
/// One field per line, named `Message` for a one-line message, else `Line k`,
/// with ` (empty)` for an empty line; the menu "Details" gives the hash and the
/// length of the exact bytes (plan section 5.2).
pub fn message_review(message: &[u8], signer: &[u8; 32], path: &DerivationPath) -> Option<Review> {
    use sha2::{Digest, Sha256};
    if !is_text_message(message) {
        return None;
    }
    // Printable ASCII and line feeds only, so this is lossless.
    let text: String = message.iter().map(|&b| char::from(b)).collect();
    let count = text.matches('\n').count() + 1;
    let mut items = vec![item(text_field(SIGNER, address(signer)))];
    for (index, line) in text.split('\n').enumerate() {
        let mut tag = if count == 1 {
            "Message".to_string()
        } else {
            format!("Line {}", index + 1)
        };
        if line.is_empty() {
            tag.push_str(" (empty)");
        }
        items.push(item(text_field(&tag, line)));
    }
    let hash = hex::encode(Sha256::digest(message));
    Some(Review {
        kind: "message",
        steps: vec![Step {
            name: "message",
            title: SIGN_MESSAGE.to_string(),
            items,
            menus: vec![
                account_menu(path),
                details_menu(vec![
                    text_field(MESSAGE_HASH, hash),
                    text_field(LENGTH, format!("{} {BYTES}", message.len())),
                ]),
            ],
        }],
    })
}

// ----- EOA authorizations -----

/// The review of an EOA authorization of `kind` for `account` (which must be
/// `signer`, the key at `path`) naming `fee_payer`, on chain `chain_id`;
/// `None` when the app refuses it (chain id zero, or an account that is not
/// the key at the path).  Written from plan section 5.4: the app does not have
/// it yet.
pub fn eoa_auth_review(
    kind: EoaAuthKind,
    chain_id: u16,
    fee_payer: &[u8; 32],
    account: &[u8; 32],
    signer: &[u8; 32],
    path: &DerivationPath,
) -> Option<Review> {
    if chain_id == 0 || account != signer {
        return None;
    }
    let (title, note) = match kind {
        EoaAuthKind::Create => (EOA_CREATE_TITLE, EOA_CREATE_NOTE),
        EoaAuthKind::Delete => (EOA_DELETE_TITLE, EOA_DELETE_NOTE),
    };
    Some(Review {
        kind: "eoa_auth",
        steps: vec![Step {
            name: "eoa_auth",
            title: title.to_string(),
            items: vec![
                Item::Note(note.to_string()),
                Item::Note(EOA_REUSE_NOTE.to_string()),
                item(text_field(ACCOUNT, address(account))),
                item(text_field(FEE_PAYER, address(fee_payer))),
                item(text_field(NETWORK, network_label(chain_id))),
            ],
            menus: vec![account_menu(path)],
        }],
    })
}

// ----- rendering -----

impl Field {
    fn to_json(&self) -> Value {
        json!({
            "type": "field",
            "label": self.label,
            "value": self.value,
            "unit": self.unit,
        })
    }

    /// The value as the device draws it: an amount with its unit.
    fn shown_value(&self) -> String {
        match self.unit {
            Some(unit) => format!("{} {unit}", self.value),
            None => self.value.clone(),
        }
    }
}

impl Item {
    fn to_json(&self) -> Value {
        match self {
            Item::Field(field) => field.to_json(),
            Item::Note(text) => json!({ "type": "note", "text": text }),
            Item::Warning(text) => json!({ "type": "warning", "text": text }),
        }
    }
}

impl Review {
    /// The title the printed review is named by: the first step's.
    pub fn title(&self) -> &str {
        self.steps.first().map_or("", |step| step.title.as_str())
    }

    /// The review as the value of `trezor_preview` (schema in the module
    /// documentation).
    pub fn to_json(&self) -> Value {
        json!({
            "kind": self.kind,
            "steps": self.steps.iter().map(|step| json!({
                "name": step.name,
                "title": step.title,
                "items": step.items.iter().map(Item::to_json).collect::<Vec<_>>(),
                "menus": step.menus.iter().map(|menu| json!({
                    "name": menu.name,
                    "fields": menu.fields.iter().map(Field::to_json).collect::<Vec<_>>(),
                })).collect::<Vec<_>>(),
            })).collect::<Vec<_>>(),
        })
    }
}

/// The lines the CLI prints before the Trezor is asked to sign: the device's
/// titles, labels and values in the device's order (the form of
/// `format_ledger_preview`).  A review of several steps names each step; the
/// menus of a step follow its screen.
pub fn format_trezor_preview(review: &Review) -> String {
    let mut out = String::new();
    let _ = writeln!(
        out,
        "Trezor review ({}): your device must show exactly these values",
        review.title()
    );
    let several = review.steps.len() > 1;
    let base = if several { "    " } else { "  " };
    for (number, step) in review.steps.iter().enumerate() {
        if several {
            let _ = writeln!(
                out,
                "  Step {} of {}: {}",
                number + 1,
                review.steps.len(),
                step.title
            );
        }
        let fields: Vec<&Field> = step
            .items
            .iter()
            .filter_map(|item| match item {
                Item::Field(field) => Some(field),
                _ => None,
            })
            .collect();
        let width = label_width(&fields);
        for item in &step.items {
            match item {
                Item::Field(field) => push_field(&mut out, base, field, width),
                Item::Note(text) | Item::Warning(text) => {
                    let _ = writeln!(out, "{base}{text}");
                }
            }
        }
        for menu in &step.menus {
            let _ = writeln!(out, "{base}Menu \"{}\":", menu.name);
            let fields: Vec<&Field> = menu.fields.iter().collect();
            let width = label_width(&fields);
            let indent = format!("{base}  ");
            for field in &fields {
                push_field(&mut out, &indent, field, width);
            }
        }
    }
    out.push_str("  Reject on the device if any value differs.\n");
    out
}

fn label_width(fields: &[&Field]) -> usize {
    fields
        .iter()
        .map(|field| field.label.len() + 1)
        .max()
        .unwrap_or(0)
}

fn push_field(out: &mut String, indent: &str, field: &Field, width: usize) {
    let label = format!("{}:", field.label);
    let line = format!("{indent}{label:<width$} {}", field.shown_value());
    // An empty value (an empty line of a message) leaves no trailing space.
    let _ = writeln!(out, "{}", line.trim_end());
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::{BTreeMap, BTreeSet};
    use thru_base::txn_tools::{EOA_PROGRAM, TransactionBuilder};
    use thru_base::{StateProof, Transaction};

    /// The app's own files, read when this test is built: the English texts and
    /// the fixture generated from the app's code (`trezor/app-thru/src/fixtures.rs`).
    const EN_JSON: &str = include_str!("../../../../../trezor/app-thru/translations/en.json");
    const FIXTURE: &str =
        include_str!("../../../../../trezor/app-thru/tests/fixtures/sign_tx.json");

    fn path0() -> DerivationPath {
        DerivationPath::new(0).unwrap()
    }

    fn key(byte: u8) -> [u8; 32] {
        [byte; 32]
    }

    // ----- fixture parity (P2, unit level) -----

    fn parse_path(text: &str) -> DerivationPath {
        text.parse().unwrap()
    }

    /// The hint of a case, if the CLI could send it: `None` for a hint of the
    /// wrong length or kind, which the CLI's `TokenHint` cannot hold.
    fn decode_hint(hex_text: &str) -> Result<TokenHint, ()> {
        let bytes = hex::decode(hex_text).unwrap();
        if bytes.len() != 129 || bytes[0] != 1 {
            return Err(());
        }
        let part = |i: usize| -> [u8; 32] { bytes[1 + 32 * i..33 + 32 * i].try_into().unwrap() };
        Ok(TokenHint {
            mint: part(0),
            recipient_owner: part(1),
            recipient_seed: part(2),
            source_seed: part(3),
        })
    }

    /// The public key of the fixture wallet at `path`.
    fn wallet_key(mnemonic: &str, path: &str) -> [u8; 32] {
        let components = path.strip_prefix("m/").unwrap().split('/').count();
        if components == 4 {
            let hd: crate::hd::HdPath = path.parse().unwrap();
            let seed = crate::hd::derive_key(mnemonic, hd).unwrap();
            return crate::keys::LoadedKey::from_seed(seed).public_key;
        }
        // The three-component path has no CLI derivation; the fixture names
        // its key in the review of every signed case.
        [0; 32]
    }

    /// Every field of an item list as `(label, value, unit)`.
    fn fields_of(items: &[Item]) -> Vec<(String, String, Option<&'static str>)> {
        items
            .iter()
            .filter_map(|item| match item {
                Item::Field(f) => Some((f.label.clone(), f.value.clone(), f.unit)),
                _ => None,
            })
            .collect()
    }

    fn field_map(items: &[Item]) -> BTreeMap<String, String> {
        fields_of(items)
            .into_iter()
            .map(|(label, value, _)| (label, value))
            .collect()
    }

    fn step<'a>(review: &'a Review, name: &str) -> &'a Step {
        review
            .steps
            .iter()
            .find(|s| s.name == name)
            .unwrap_or_else(|| panic!("no step {name}"))
    }

    fn menu(step: &Step, name: &str) -> BTreeMap<String, String> {
        let menu = step
            .menus
            .iter()
            .find(|m| m.name == name)
            .unwrap_or_else(|| panic!("no menu {name} on {}", step.name));
        menu.fields
            .iter()
            .map(|f| (f.label.clone(), f.value.clone()))
            .collect()
    }

    /// The values of a fixture case's `review` that [`assert_matches_review`]
    /// compares.  `from`, `recipient` and `authority_index` also serve the
    /// wallet transfer, which the fixture does not have yet (see below).
    const REVIEW_KEYS: &[&str] = &[
        "account",
        "account_name",
        "amount",
        "amount_unit",
        "authority_index",
        "fee",
        "from",
        "high_fee",
        "kind",
        "mint",
        "network",
        "nonce",
        "owners",
        "path",
        "recipient",
        "ticker",
        "tx_hash",
        "valid_slots",
    ];

    /// Each value of the fixture's `review` is on the step and under the label
    /// the app uses, and nothing else is on the step.
    fn assert_matches_review(name: &str, review: &Review, shown: &Value) {
        // Every value of the fixture's review is compared below; a value the
        // app adds to it must be compared too, so a new key fails here.
        for key in shown.as_object().unwrap().keys() {
            assert!(
                REVIEW_KEYS.contains(&key.as_str()),
                "{name}: the fixture's review has the new value {key}; compare it here"
            );
        }
        let text = |key: &str| shown[key].as_str().unwrap().to_string();
        let kind = text("kind");
        assert_eq!(review.kind, kind, "{name}");

        let account_menu_of = |step: &Step| {
            let menu = menu(step, "Account");
            let mut want = BTreeMap::new();
            if let Some(account_name) = shown["account_name"].as_str() {
                want.insert("Account".to_string(), account_name.to_string());
            }
            want.insert("Derivation path".to_string(), text("path"));
            assert_eq!(menu, want, "{name}: Account menu");
        };
        let details_of = |step: &Step, with_nonce: bool| {
            let mut want = BTreeMap::new();
            if with_nonce {
                want.insert("Nonce".to_string(), text("nonce"));
            }
            want.insert("Valid slots".to_string(), text("valid_slots"));
            want.insert("Transaction hash".to_string(), text("tx_hash"));
            assert_eq!(menu(step, "Details"), want, "{name}: Details menu");
        };
        let fee_of = |step: &Step| {
            let fee = fields_of(&step.items)
                .into_iter()
                .find(|(label, ..)| label == "Fee")
                .unwrap_or_else(|| panic!("{name}: no Fee"));
            assert_eq!(fee.1, text("fee"), "{name}");
            assert_eq!(fee.2, Some("THRU"), "{name}");
        };

        if kind == "create_account" {
            assert_eq!(review.steps.len(), 1, "{name}");
            let s = &review.steps[0];
            assert_eq!(s.name, "create_account");
            assert_eq!(
                field_map(&s.items),
                BTreeMap::from([
                    ("Account".to_string(), text("account")),
                    ("Network".to_string(), text("network")),
                    ("Fee".to_string(), text("fee")),
                ]),
                "{name}"
            );
            fee_of(s);
            assert_eq!(s.menus.len(), 2, "{name}");
            account_menu_of(s);
            details_of(s, false);
            return;
        }

        let prefix = kind.as_str();
        let high_fee = shown["high_fee"].as_bool().unwrap();
        let names: Vec<&str> = review.steps.iter().map(|s| s.name).collect();
        let mut want_names = vec![prefix.to_string()];
        if high_fee {
            want_names.push(format!("{prefix}/high_fee"));
        }
        want_names.push(format!("{prefix}/summary"));
        assert_eq!(names, want_names, "{name}");

        let first = &review.steps[0];
        account_menu_of(first);
        assert_eq!(first.menus.len(), 1, "{name}");
        let mut parties = field_map(&first.items);
        assert_eq!(parties.remove("Network"), Some(text("network")), "{name}");
        let mut sums = field_map(&step(review, &format!("{prefix}/summary")).items);
        assert_eq!(sums.remove("Fee"), Some(text("fee")), "{name}");
        fee_of(step(review, &format!("{prefix}/summary")));
        details_of(step(review, &format!("{prefix}/summary")), true);

        if high_fee {
            let s = step(review, &format!("{prefix}/high_fee"));
            assert_eq!(s.items, vec![Item::Warning(HIGH_FEE.to_string())], "{name}");
            assert!(s.menus.is_empty(), "{name}");
        }

        if kind == "transfer" {
            assert_eq!(first.title, "Send", "{name}");
            assert_eq!(
                parties,
                BTreeMap::from([
                    ("From".to_string(), text("account")),
                    ("Recipient".to_string(), text("recipient")),
                ]),
                "{name}"
            );
            assert_eq!(
                sums,
                BTreeMap::from([("Amount".to_string(), text("amount"))]),
                "{name}"
            );
            let amount = fields_of(&step(review, "transfer/summary").items)
                .into_iter()
                .find(|(label, ..)| label == "Amount")
                .unwrap();
            assert_eq!(amount.2, Some("THRU"), "{name}");
            return;
        }

        if kind == "wallet_transfer" {
            // Written from plan section 5.3 and decision W2: the fixture has no
            // wallet case yet, so the keys it will use for one are a guess
            // (`from`, `recipient`, `authority_index`), compared when present.
            assert_eq!(first.title, "Send from wallet", "{name}");
            let mut want = BTreeMap::from([("Fee payer".to_string(), text("account"))]);
            for (key, label) in [("from", "From"), ("recipient", "Recipient")] {
                if let Some(value) = shown[key].as_str() {
                    want.insert(label.to_string(), value.to_string());
                }
            }
            if !shown["authority_index"].is_null() {
                let index = shown["authority_index"].to_string();
                want.insert(
                    "Authority index".to_string(),
                    index.trim_matches('"').to_string(),
                );
            }
            for (label, value) in &want {
                assert_eq!(parties.get(label), Some(value), "{name}: {label}");
            }
            assert_eq!(
                parties.len(),
                4,
                "{name}: Fee payer, From, Recipient, Authority index"
            );
            assert_eq!(
                sums.get("Amount"),
                shown["amount"].as_str().map(str::to_string).as_ref()
            );
            return;
        }

        assert_eq!(kind, "token_transfer", "{name}");
        assert_eq!(first.title, "Send token", "{name}");
        let owners = shown["owners"].as_bool().unwrap();
        let mut want = BTreeMap::from([
            ("From".to_string(), text("from")),
            ("Recipient".to_string(), text("recipient")),
            (
                "Address type".to_string(),
                if owners {
                    "Token account owners"
                } else {
                    "Token accounts"
                }
                .to_string(),
            ),
        ]);
        if !owners {
            want.insert("Fee payer".to_string(), text("account"));
        }
        let warnings: Vec<&Item> = first
            .items
            .iter()
            .filter(|i| matches!(i, Item::Warning(_)))
            .collect();
        match shown["mint"].as_str() {
            Some(mint) => {
                want.insert("Token mint".to_string(), mint.to_string());
                assert!(warnings.is_empty(), "{name}");
            }
            None => assert_eq!(
                warnings,
                vec![&Item::Warning(TOKEN_UNKNOWN.to_string())],
                "{name}"
            ),
        }
        assert_eq!(parties, want, "{name}");
        // The signing account's address is on the first screen with the
        // label the app gives it (decision T5).
        let label = if owners { "From" } else { "Fee payer" };
        assert_eq!(parties[label], text("account"), "{name}");

        let mut want_sums = BTreeMap::new();
        if shown["amount_unit"] == "whole" {
            want_sums.insert("Amount".to_string(), text("amount"));
            if !text("ticker").is_empty() {
                want_sums.insert("Ticker".to_string(), text("ticker"));
            }
        } else {
            want_sums.insert("Amount (base units)".to_string(), text("amount"));
        }
        assert_eq!(sums, want_sums, "{name}");
    }

    /// For every case of the app's fixture: a signed case gives a preview
    /// that holds the fixture's review values on the steps and under the
    /// labels the app uses; a refused case gives none.  The file is iterated;
    /// no case is named here, so a case the app adds is picked up.
    #[test]
    fn every_fixture_case_gives_the_fixture_review() {
        let fixture: Value = serde_json::from_str(FIXTURE).unwrap();
        let mnemonic = fixture["mnemonic"].as_str().unwrap();
        let cases = fixture["cases"].as_array().unwrap();
        assert!(cases.len() >= 50, "the fixture shrank to {}", cases.len());
        let (mut signed, mut refused, mut unsendable) = (0, 0, 0);
        for case in cases {
            let name = case["name"].as_str().unwrap();
            let body = hex::decode(case["body_hex"].as_str().unwrap()).unwrap();
            let path_text = case["path"].as_str().unwrap();
            let path = parse_path(path_text);
            let hint = match case["token_hint_hex"].as_str() {
                Some(text) => match decode_hint(text) {
                    Ok(hint) => Some(hint),
                    Err(()) => {
                        // A hint of the wrong length or kind: the CLI cannot
                        // send one, and the app refuses it.
                        assert_ne!(case["outcome"], "signed", "{name}");
                        unsendable += 1;
                        continue;
                    }
                },
                None => None,
            };
            if case["outcome"] == "signed" {
                let shown = &case["review"];
                let mut signer = [0u8; 32];
                thru_base::tn_public_address::tn_public_address_decode(
                    &mut signer,
                    shown["account"].as_str().unwrap().as_bytes(),
                )
                .unwrap();
                if path.depth() == 4 {
                    assert_eq!(signer, wallet_key(mnemonic, path_text), "{name}");
                }
                let review = transaction_review(&body, &signer, &path, hint.as_ref())
                    .unwrap_or_else(|| panic!("{name}: no preview for a signed case"));
                assert_matches_review(name, &review, shown);
                signed += 1;
            } else {
                // The key at the path: the fixture's refusals include a body
                // whose fee payer is another key.
                let signer = wallet_key(mnemonic, path_text);
                assert_ne!(
                    signer, [0; 32],
                    "{name}: refused cases use a four-component path"
                );
                let got = transaction_review(&body, &signer, &path, hint.as_ref());
                assert_eq!(
                    got, None,
                    "{name}: a preview for a refused case ({})",
                    case["outcome"]
                );
                refused += 1;
            }
        }
        assert!(
            signed >= 25 && refused >= 25,
            "{signed} signed, {refused} refused"
        );
        assert!(unsendable >= 1);
    }

    // ----- the app's texts -----

    /// The texts of `translations/en.json`, key to text.
    fn app_texts() -> BTreeMap<String, String> {
        let en: Value = serde_json::from_str(EN_JSON).unwrap();
        en["translations"]
            .as_object()
            .unwrap()
            .iter()
            .map(|(key, text)| (key.clone(), text.as_str().unwrap().to_string()))
            .collect()
    }

    /// Texts of the app that no review carries: the closing screens'.
    const NOT_IN_A_REVIEW: &[&str] = &[
        "thru__signed",
        "thru__message_signed",
        "thru__authorization_signed",
    ];

    /// Every text of a review is the app's, under the key the app gives it, and
    /// every text of the app is one of a review's.
    #[test]
    fn texts_are_the_apps() {
        let app = app_texts();
        let ours: BTreeMap<&str, &str> = TEXTS.iter().copied().collect();
        assert_eq!(ours.len(), TEXTS.len(), "a key twice");

        for (key, text) in TEXTS {
            match app.get(*key) {
                Some(app_text) => assert_eq!(app_text, text, "{key}"),
                None => panic!("{key}: the app has no such text"),
            }
        }
        // Nothing the app says is missing here.
        let mine: BTreeSet<&str> = TEXTS.iter().map(|(_, text)| *text).collect();
        for (key, text) in &app {
            if NOT_IN_A_REVIEW.contains(&key.as_str()) {
                continue;
            }
            assert!(
                mine.contains(text.as_str()),
                "the app has the text {key} = {text:?}, which the preview does not use"
            );
        }
    }

    // ----- builders for the shape tests -----

    const FEE_PAYER: [u8; 32] = [0x22; 32];
    const MINT: [u8; 32] = [0x50; 32];
    const OWNER: [u8; 32] = [0x60; 32];
    const SOURCE_SEED: [u8; 32] = [0x71; 32];
    const RECIPIENT_SEED: [u8; 32] = [0x72; 32];

    fn path1() -> DerivationPath {
        DerivationPath::new_depth3(4).unwrap()
    }

    fn native(to: [u8; 32], amount: u64, fee: u64, nonce: u64) -> Transaction {
        TransactionBuilder::build_transfer(FEE_PAYER, EOA_PROGRAM, to, amount, fee, nonce, 500)
            .unwrap()
    }

    fn body(tx: &Transaction) -> Vec<u8> {
        tx.to_wire_for_signing()
    }

    /// The EOA program's 16-byte transfer: `u32 1`, `u64 amount`, `u16
    /// source`, `u16 recipient`.
    fn native_instruction(amount: u64, source: u16, recipient: u16) -> Vec<u8> {
        let mut data = 1u32.to_le_bytes().to_vec();
        data.extend_from_slice(&amount.to_le_bytes());
        data.extend_from_slice(&source.to_le_bytes());
        data.extend_from_slice(&recipient.to_le_bytes());
        data
    }

    fn review_of(tx: &Transaction) -> Option<Review> {
        transaction_review(&body(tx), &FEE_PAYER, &path0(), None)
    }

    fn token_accounts() -> ([u8; 32], [u8; 32], TokenHint) {
        use thru_ledger::token_account_address;
        let source = token_account_address(&FEE_PAYER, &MINT, &SOURCE_SEED);
        let dest = token_account_address(&OWNER, &MINT, &RECIPIENT_SEED);
        let hint = TokenHint {
            mint: MINT,
            recipient_owner: OWNER,
            recipient_seed: RECIPIENT_SEED,
            source_seed: SOURCE_SEED,
        };
        (source, dest, hint)
    }

    fn plain_token() -> (Transaction, TokenHint) {
        let (source, dest, hint) = token_accounts();
        let tx = TransactionBuilder::build_token_transfer(
            FEE_PAYER,
            thru_base::bootstrap_addresses::TOKEN_PROGRAM_BYTES,
            source,
            dest,
            FEE_PAYER,
            250_000,
            25_000,
            7,
            500,
        )
        .unwrap();
        (tx, hint)
    }

    fn checked_token() -> (Transaction, TokenHint) {
        let (source, dest, hint) = token_accounts();
        let tx = TransactionBuilder::build_token_transfer_checked(
            FEE_PAYER,
            thru_base::bootstrap_addresses::TOKEN_PROGRAM_BYTES,
            source,
            dest,
            MINT,
            1_500_000,
            6,
            b"USDC",
            25_000,
            7,
            500,
        )
        .unwrap();
        (tx, hint)
    }

    /// The 95-byte `Validate` instruction with one `Transfer` child that the
    /// parser decodes as a wallet transfer.
    fn wallet_instruction(wallet: u16, recipient: u16, amount: u64) -> Vec<u8> {
        let mut data = vec![0u8; 95];
        data[0] = 1;
        data[1..3].copy_from_slice(&wallet.to_le_bytes());
        data[72..74].copy_from_slice(&1u16.to_le_bytes());
        data[74..82].copy_from_slice(&13u64.to_le_bytes());
        data[82] = 2;
        data[83..85].copy_from_slice(&wallet.to_le_bytes());
        data[85..87].copy_from_slice(&recipient.to_le_bytes());
        data[87..95].copy_from_slice(&amount.to_le_bytes());
        data
    }

    fn wallet_tx() -> Transaction {
        Transaction::new(
            FEE_PAYER,
            thru_base::bootstrap_addresses::WALLET_PROGRAM_BYTES,
            1000,
            7,
        )
        .with_start_slot(500)
        .with_expiry_after(100)
        .add_rw_account(key(0x40))
        .add_rw_account(key(0x41))
        .with_instructions(wallet_instruction(2, 3, 5))
    }

    fn creation(proof: &StateProof) -> Transaction {
        Transaction::new(FEE_PAYER, NOOP_PROGRAM_BYTES, 0, 0)
            .with_start_slot(500)
            .with_expiry_after(100)
            .with_fee_payer_state_proof(proof)
    }

    fn creation_proof() -> StateProof {
        StateProof::creation(77, [0u8; 32], key(0x11), key(0x22), Vec::new())
    }

    // ----- shape rules -----

    #[test]
    fn the_builders_shapes_have_a_preview() {
        assert!(review_of(&native(key(0x40), 1_500_000_000, 1000, 7)).is_some());
        assert_eq!(
            review_of(&native(key(0x40), 1, 1000, 7)).unwrap().kind,
            "transfer"
        );
        let created = review_of(&creation(&creation_proof())).unwrap();
        assert_eq!(created.kind, "create_account");
        for (tx, hint) in [plain_token(), checked_token()] {
            let body = body(&tx);
            for hint in [None, Some(&hint)] {
                let review = transaction_review(&body, &FEE_PAYER, &path0(), hint).unwrap();
                assert_eq!(review.kind, "token_transfer");
            }
        }
    }

    /// A transfer with a flag set (a fee payer proof, or the permission to
    /// compress accounts) is a shape the app does not sign.
    #[test]
    fn a_transfer_with_a_flag_set_has_no_preview() {
        let base = || native(key(0x40), 5, 1000, 7);
        assert!(review_of(&base()).is_some());
        assert_eq!(review_of(&base().with_may_compress_account()), None);
        let with_creation = base().with_fee_payer_state_proof(&creation_proof());
        assert_eq!(review_of(&with_creation), None);
        let existing = StateProof::existing(9, [0u8; 32], Vec::new());
        let with_existing = base()
            .with_fee_payer_state_proof(&existing)
            .with_fee_payer_account_meta_raw(vec![0u8; 64]);
        assert_eq!(review_of(&with_existing), None);
        // The same for a token transfer, with and without a hint.
        let (tx, hint) = checked_token();
        let flagged = tx.with_may_compress_account();
        for hint in [None, Some(&hint)] {
            assert_eq!(
                transaction_review(&body(&flagged), &FEE_PAYER, &path0(), hint),
                None
            );
        }
    }

    /// An account creation with another proof type than CREATION, or without a
    /// proof, or with a fee or a nonce, is not the transaction `thru account
    /// create` builds.
    #[test]
    fn an_account_creation_with_the_wrong_proof_has_no_preview() {
        let existing = StateProof::existing(9, [0u8; 32], Vec::new());
        let wrong = creation(&existing).with_fee_payer_account_meta_raw(vec![0u8; 64]);
        assert_eq!(review_of(&wrong), None);
        let no_proof = Transaction::new(FEE_PAYER, NOOP_PROGRAM_BYTES, 0, 0).with_expiry_after(100);
        assert_eq!(review_of(&no_proof), None);
        let fee = Transaction::new(FEE_PAYER, NOOP_PROGRAM_BYTES, 1, 0)
            .with_fee_payer_state_proof(&creation_proof());
        assert_eq!(review_of(&fee), None);
        let nonce = Transaction::new(FEE_PAYER, NOOP_PROGRAM_BYTES, 0, 1)
            .with_fee_payer_state_proof(&creation_proof());
        assert_eq!(review_of(&nonce), None);
        // The compress flag next to the proof is not the builder's shape.
        let compress = creation(&creation_proof()).with_may_compress_account();
        assert_eq!(review_of(&compress), None);
        // Another program is not an account creation.
        let other = Transaction::new(FEE_PAYER, key(0x77), 0, 0)
            .with_fee_payer_state_proof(&creation_proof());
        assert_eq!(review_of(&other), None);
    }

    #[test]
    fn what_the_host_or_the_app_refuses_has_no_preview() {
        let tx = native(key(0x40), 5, 1000, 7);
        // Another key than the fee payer.
        assert_eq!(
            transaction_review(&body(&tx), &key(0x33), &path0(), None),
            None
        );
        // A body that is not a transaction.
        assert_eq!(
            transaction_review(&[0u8; 10], &FEE_PAYER, &path0(), None),
            None
        );
        // A transfer to the fee payer itself leaves the account unshown.
        let to_self = native(key(0x40), 5, 1000, 7).with_instructions(native_instruction(5, 0, 0));
        assert_eq!(review_of(&to_self), None);
        // A second read-write account, and a read-only one.
        assert_eq!(
            review_of(&native(key(0x40), 5, 1000, 7).add_rw_account(key(0x41))),
            None
        );
        assert_eq!(
            review_of(&native(key(0x40), 5, 1000, 7).add_r_account(key(0x41))),
            None
        );
    }

    #[test]
    fn nonzero_header_padding_has_no_preview() {
        let canonical = body(&native(key(0x40), 5, 1000, 7));
        assert!(transaction_review(&canonical, &FEE_PAYER, &path0(), None).is_some());
        for offset in HEADER_PAD {
            for value in [1u8, 0x80, 0xff] {
                let mut padded = canonical.clone();
                padded[offset] = value;
                assert_eq!(
                    transaction_review(&padded, &FEE_PAYER, &path0(), None),
                    None,
                    "byte {offset} = {value:#04x}"
                );
            }
        }
        // The same for a shape with a hint: the padding is looked at first.
        let (tx, hint) = checked_token();
        let mut padded = body(&tx);
        assert!(transaction_review(&padded, &FEE_PAYER, &path0(), Some(&hint)).is_some());
        padded[HEADER_PAD.start] = 1;
        assert_eq!(
            transaction_review(&padded, &FEE_PAYER, &path0(), Some(&hint)),
            None
        );
    }

    #[test]
    fn token_transfers_with_another_shape_have_no_preview() {
        let (source, dest, _) = token_accounts();
        // A transfer from an account to itself.
        let same = TransactionBuilder::build_token_transfer(
            FEE_PAYER,
            thru_base::bootstrap_addresses::TOKEN_PROGRAM_BYTES,
            source,
            source,
            FEE_PAYER,
            1,
            0,
            0,
            500,
        )
        .unwrap();
        assert_eq!(review_of(&same), None);
        // A third read-write account, and a read-only one on the plain form.
        let (plain, _) = plain_token();
        assert_eq!(review_of(&plain.clone().add_rw_account(key(0xF0))), None);
        assert_eq!(review_of(&plain.add_r_account(key(0xF0))), None);
        let _ = dest;
    }

    #[test]
    fn a_hint_that_does_not_prove_the_accounts_has_no_preview() {
        let (tx, hint) = checked_token();
        let wrong_owner = TokenHint {
            recipient_owner: key(0x61),
            ..hint
        };
        let wrong_mint = TokenHint {
            mint: key(0x51),
            ..hint
        };
        for bad in [wrong_owner, wrong_mint] {
            assert_eq!(
                transaction_review(&body(&tx), &FEE_PAYER, &path0(), Some(&bad)),
                None
            );
        }
        // A hint with a native transfer.
        let native = native(key(0x40), 5, 1000, 7);
        assert_eq!(
            transaction_review(&body(&native), &FEE_PAYER, &path0(), Some(&hint)),
            None
        );
    }

    #[test]
    fn wallet_transfers_follow_decision_w1() {
        // The wallet account and a third account as the recipient.
        let review = review_of(&wallet_tx()).expect("two read-write accounts");
        assert_eq!(review.kind, "wallet_transfer");
        let names: Vec<&str> = review.steps.iter().map(|s| s.name).collect();
        assert_eq!(names, ["wallet_transfer", "wallet_transfer/summary"]);
        let first = &review.steps[0];
        assert_eq!(first.title, "Send from wallet");
        assert_eq!(
            fields_of(&first.items)
                .iter()
                .map(|(label, ..)| label.as_str())
                .collect::<Vec<_>>(),
            [
                "Fee payer",
                "From",
                "Recipient",
                "Authority index",
                "Network"
            ]
        );
        assert_eq!(field_map(&first.items)["From"], address(&key(0x40)));
        assert_eq!(field_map(&first.items)["Recipient"], address(&key(0x41)));
        assert_eq!(field_map(&first.items)["Authority index"], "0");

        // The recipient is the fee payer: the wallet account alone.
        let to_fee_payer = Transaction::new(
            FEE_PAYER,
            thru_base::bootstrap_addresses::WALLET_PROGRAM_BYTES,
            1000,
            7,
        )
        .with_expiry_after(100)
        .add_rw_account(key(0x40))
        .with_instructions(wallet_instruction(2, 0, 5));
        let review = review_of(&to_fee_payer).expect("the wallet to the fee payer");
        assert_eq!(
            field_map(&review.steps[0].items)["Recipient"],
            address(&FEE_PAYER)
        );

        // One rule at a time.
        assert_eq!(
            review_of(&wallet_tx().with_may_compress_account()),
            None,
            "flag"
        );
        assert_eq!(
            review_of(&wallet_tx().add_r_account(key(0x50))),
            None,
            "read-only"
        );
        assert_eq!(
            review_of(&wallet_tx().add_rw_account(key(0x42))),
            None,
            "extra read-write"
        );
        let two_for_the_fee_payer = to_fee_payer.clone().add_rw_account(key(0x41));
        assert_eq!(
            review_of(&two_for_the_fee_payer),
            None,
            "unnamed read-write"
        );
        let to_itself = Transaction::new(
            FEE_PAYER,
            thru_base::bootstrap_addresses::WALLET_PROGRAM_BYTES,
            1000,
            7,
        )
        .with_expiry_after(100)
        .add_rw_account(key(0x40))
        .with_instructions(wallet_instruction(2, 2, 5));
        assert_eq!(review_of(&to_itself), None, "the wallet to itself");
    }

    // ----- high fee, steps -----

    #[test]
    fn a_high_fee_adds_its_own_step() {
        let at = review_of(&native(key(0x40), 1, FEE_WARN_THRESHOLD, 0)).unwrap();
        assert_eq!(at.steps.len(), 2);
        let above = review_of(&native(key(0x40), 1, FEE_WARN_THRESHOLD + 1, 0)).unwrap();
        let names: Vec<&str> = above.steps.iter().map(|s| s.name).collect();
        assert_eq!(names, ["transfer", "transfer/high_fee", "transfer/summary"]);
        assert_eq!(above.steps[1].title, "High fee");
        assert_eq!(
            above.steps[1].items,
            vec![Item::Warning(HIGH_FEE.to_string())]
        );
        assert!(above.steps[1].menus.is_empty());
    }

    // ----- the account menu -----

    #[test]
    fn the_account_menu_names_the_account_for_the_four_component_path_only() {
        let four = account_menu(&DerivationPath::new(2).unwrap());
        assert_eq!(four.name, "Account");
        assert_eq!(
            four.fields
                .iter()
                .map(|f| (f.label.as_str(), f.value.as_str()))
                .collect::<Vec<_>>(),
            [
                ("Account", "Thru #3"),
                ("Derivation path", "m/44'/8478'/2'/0'")
            ]
        );
        let three = account_menu(&path1());
        assert_eq!(
            three
                .fields
                .iter()
                .map(|f| (f.label.as_str(), f.value.as_str()))
                .collect::<Vec<_>>(),
            [("Derivation path", "m/44'/8478'/4'")]
        );
    }

    // ----- messages (plan section 5.2) -----

    fn lines_of(review: &Review) -> Vec<(String, String)> {
        fields_of(&review.steps[0].items)
            .into_iter()
            .map(|(label, value, _)| (label, value))
            .collect()
    }

    #[test]
    fn a_one_line_message() {
        let review = message_review(b"Hello, Thru!", &FEE_PAYER, &path0()).unwrap();
        assert_eq!(review.kind, "message");
        assert_eq!(review.steps.len(), 1);
        let s = &review.steps[0];
        assert_eq!((s.name, s.title.as_str()), ("message", "Sign message"));
        assert_eq!(
            lines_of(&review),
            [
                ("Signer".to_string(), address(&FEE_PAYER)),
                ("Message".to_string(), "Hello, Thru!".to_string()),
            ]
        );
        assert_eq!(menu(s, "Details")["Length"], "12 bytes");
        assert_eq!(
            menu(s, "Details")["Message hash"],
            sha256_hex(b"Hello, Thru!")
        );
        assert_eq!(menu(s, "Account")["Derivation path"], "m/44'/8478'/0'/0'");
    }

    fn sha256_hex(data: &[u8]) -> String {
        use sha2::{Digest, Sha256};
        hex::encode(Sha256::digest(data))
    }

    /// A line break starts a field of its own; an empty line is a field with an
    /// empty value and `(empty)` in its label.
    #[test]
    fn a_multi_line_message_with_empty_lines() {
        let message = b"line one\n\nthird line\n";
        let review = message_review(message, &FEE_PAYER, &path0()).unwrap();
        let lines = lines_of(&review);
        assert_eq!(
            &lines[1..],
            [
                ("Line 1".to_string(), "line one".to_string()),
                ("Line 2 (empty)".to_string(), String::new()),
                ("Line 3".to_string(), "third line".to_string()),
                ("Line 4 (empty)".to_string(), String::new()),
            ]
        );
        let details = menu(&review.steps[0], "Details");
        assert_eq!(details["Length"], "21 bytes");
        assert_eq!(details["Message hash"], sha256_hex(message));
        // The Ledger's text-mode preview names the lines the same way.
        let ledger = thru_ledger::preview::MessagePreview::new(&FEE_PAYER, message).unwrap();
        let ledger_fields: Vec<(String, String)> = ledger
            .fields()
            .into_iter()
            .map(|(label, value)| (label.into_owned(), value))
            .collect();
        assert_eq!(ledger_fields, lines);
    }

    #[test]
    fn the_longest_messages() {
        let review = message_review(&[b'a'; 512], &FEE_PAYER, &path0()).unwrap();
        assert_eq!(
            lines_of(&review)[1],
            ("Message".to_string(), "a".repeat(512))
        );
        assert_eq!(menu(&review.steps[0], "Details")["Length"], "512 bytes");
        let review = message_review(&[b'\n'; 15], &FEE_PAYER, &path0()).unwrap();
        let lines = lines_of(&review);
        assert_eq!(lines.len(), 17);
        assert_eq!(lines[1].0, "Line 1 (empty)");
        assert_eq!(lines[16].0, "Line 16 (empty)");
    }

    #[test]
    fn a_message_the_app_does_not_sign_has_no_preview() {
        for message in [
            &b""[..],
            &[b'a'; 513],
            "h\u{e9}".as_bytes(),
            b"a\tb",
            b"a  b",
            b"trailing ",
        ] {
            assert_eq!(message_review(message, &FEE_PAYER, &path0()), None);
        }
    }

    // ----- EOA authorizations (plan section 5.4) -----

    #[test]
    fn eoa_authorizations_of_both_kinds() {
        let fee_payer = key(0x33);
        for (kind, title, note) in [
            (
                EoaAuthKind::Create,
                "Authorize account creation",
                "The fee payer can create this account.",
            ),
            (
                EoaAuthKind::Delete,
                "Authorize account deletion",
                "The fee payer can delete this account, or clear its data, while its balance and nonce are zero.",
            ),
        ] {
            let review =
                eoa_auth_review(kind, 2, &fee_payer, &FEE_PAYER, &FEE_PAYER, &path0()).unwrap();
            assert_eq!(review.kind, "eoa_auth");
            assert_eq!(review.steps.len(), 1);
            let s = &review.steps[0];
            assert_eq!((s.name, s.title.as_str()), ("eoa_auth", title));
            assert_eq!(
                s.items,
                vec![
                    Item::Note(note.to_string()),
                    Item::Note(
                        "This authorization does not expire and can be used again.".to_string()
                    ),
                    item(text_field("Account", address(&FEE_PAYER))),
                    item(text_field("Fee payer", address(&fee_payer))),
                    item(text_field("Network", "betanet")),
                ]
            );
            assert_eq!(s.menus.len(), 1);
            assert_eq!(menu(s, "Account")["Account"], "Thru #1");
        }
    }

    #[test]
    fn an_eoa_authorization_the_app_refuses_has_no_preview() {
        let (fee_payer, account) = (key(0x33), FEE_PAYER);
        // Chain id zero.
        assert_eq!(
            eoa_auth_review(
                EoaAuthKind::Create,
                0,
                &fee_payer,
                &account,
                &account,
                &path0()
            ),
            None
        );
        // An account that is not the key at the path.
        assert_eq!(
            eoa_auth_review(
                EoaAuthKind::Create,
                1,
                &fee_payer,
                &key(0x44),
                &account,
                &path0()
            ),
            None
        );
        // The fee payer may be any key, also the account itself.
        assert!(
            eoa_auth_review(
                EoaAuthKind::Create,
                1,
                &account,
                &account,
                &account,
                &path0()
            )
            .is_some()
        );
    }

    // ----- rendering -----

    #[test]
    fn the_printed_review_of_a_token_transfer() {
        let (tx, hint) = checked_token();
        let review = transaction_review(&body(&tx), &FEE_PAYER, &path0(), Some(&hint)).unwrap();
        let printed = format_trezor_preview(&review);
        let want = format!(
            "Trezor review (Send token): your device must show exactly these values\n\
             \x20 Step 1 of 2: Send token\n\
             \x20   From:         {from}\n\
             \x20   Recipient:    {to}\n\
             \x20   Token mint:   {mint}\n\
             \x20   Address type: Token account owners\n\
             \x20   Network:      alphanet\n\
             \x20   Menu \"Account\":\n\
             \x20     Account:         Thru #1\n\
             \x20     Derivation path: m/44'/8478'/0'/0'\n\
             \x20 Step 2 of 2: Summary\n\
             \x20   Amount: 1.5\n\
             \x20   Ticker: USDC\n\
             \x20   Fee:    0.000025 THRU\n\
             \x20   Menu \"Details\":\n\
             \x20     Nonce:            7\n\
             \x20     Valid slots:      500 to 599\n\
             \x20     Transaction hash: {hash}\n\
             \x20 Reject on the device if any value differs.\n",
            from = address(&FEE_PAYER),
            to = address(&OWNER),
            mint = address(&MINT),
            hash = sha256_hex(&body(&tx)),
        );
        assert_eq!(printed, want);
    }

    #[test]
    fn the_printed_review_of_a_message_and_an_authorization() {
        let review = message_review(b"a\n\nb", &FEE_PAYER, &path1()).unwrap();
        let printed = format_trezor_preview(&review);
        assert!(printed.starts_with(
            "Trezor review (Sign message): your device must show exactly these values\n  Signer:"
        ));
        // A one-step review has no step line; an empty line leaves no trailing space.
        assert!(!printed.contains("Step 1"));
        assert!(printed.contains("\n  Line 2 (empty):\n"));
        assert!(printed.ends_with("  Reject on the device if any value differs.\n"));
        assert!(printed.lines().all(|l| l == l.trim_end()));

        let review = eoa_auth_review(
            EoaAuthKind::Create,
            1,
            &key(0x33),
            &FEE_PAYER,
            &FEE_PAYER,
            &path0(),
        )
        .unwrap();
        let printed = format_trezor_preview(&review);
        assert!(printed.starts_with(
            "Trezor review (Authorize account creation): your device must show exactly these values\n  The fee payer can create this account.\n  This authorization does not expire and can be used again.\n  Account:"
        ));
    }

    #[test]
    fn json_of_every_kind() {
        // Native transfer, with a high fee: three steps.
        let review =
            review_of(&native(key(0x40), 1_500_000_000, FEE_WARN_THRESHOLD + 1, 7)).unwrap();
        let hash = sha256_hex(&body(&native(
            key(0x40),
            1_500_000_000,
            FEE_WARN_THRESHOLD + 1,
            7,
        )));
        let account = json!({"name": "Account", "fields": [
            {"type": "field", "label": "Account", "value": "Thru #1", "unit": null},
            {"type": "field", "label": "Derivation path", "value": "m/44'/8478'/0'/0'", "unit": null}]});
        assert_eq!(
            review.to_json(),
            json!({"kind": "transfer", "steps": [
                {"name": "transfer", "title": "Send", "items": [
                    {"type": "field", "label": "From", "value": address(&FEE_PAYER), "unit": null},
                    {"type": "field", "label": "Recipient", "value": address(&key(0x40)), "unit": null},
                    {"type": "field", "label": "Network", "value": "alphanet", "unit": null}],
                 "menus": [account.clone()]},
                {"name": "transfer/high_fee", "title": "High fee", "items": [
                    {"type": "warning", "text": "The fee is above 0.1 THRU."}], "menus": []},
                {"name": "transfer/summary", "title": "Summary", "items": [
                    {"type": "field", "label": "Amount", "value": "1.5", "unit": "THRU"},
                    {"type": "field", "label": "Fee", "value": "0.100000001", "unit": "THRU"}],
                 "menus": [{"name": "Details", "fields": [
                    {"type": "field", "label": "Nonce", "value": "7", "unit": null},
                    {"type": "field", "label": "Valid slots", "value": "500 to 599", "unit": null},
                    {"type": "field", "label": "Transaction hash", "value": hash, "unit": null}]}]}
            ]})
        );

        // Account creation.
        let tx = creation(&creation_proof());
        let review = review_of(&tx).unwrap();
        assert_eq!(
            review.to_json(),
            json!({"kind": "create_account", "steps": [
                {"name": "create_account", "title": "Create account", "items": [
                    {"type": "field", "label": "Account", "value": address(&FEE_PAYER), "unit": null},
                    {"type": "field", "label": "Network", "value": "alphanet", "unit": null},
                    {"type": "field", "label": "Fee", "value": "0", "unit": "THRU"}],
                 "menus": [account.clone(), {"name": "Details", "fields": [
                    {"type": "field", "label": "Valid slots", "value": "500 to 599", "unit": null},
                    {"type": "field", "label": "Transaction hash", "value": sha256_hex(&body(&tx)), "unit": null}]}]}
            ]})
        );

        // Token transfer without a hint, plain form: the warning.
        let (tx, _) = plain_token();
        let review = review_of(&tx).unwrap();
        let (source, dest, _) = token_accounts();
        assert_eq!(
            review.to_json()["steps"][0],
            json!({"name": "token_transfer", "title": "Send token", "items": [
                {"type": "field", "label": "Fee payer", "value": address(&FEE_PAYER), "unit": null},
                {"type": "field", "label": "From", "value": address(&source), "unit": null},
                {"type": "field", "label": "Recipient", "value": address(&dest), "unit": null},
                {"type": "field", "label": "Address type", "value": "Token accounts", "unit": null},
                {"type": "warning", "text": "The transaction does not identify the token."},
                {"type": "field", "label": "Network", "value": "alphanet", "unit": null}],
             "menus": [account.clone()]})
        );

        // Wallet transfer.
        let review = review_of(&wallet_tx()).unwrap();
        assert_eq!(review.to_json()["kind"], "wallet_transfer");
        assert_eq!(
            review.to_json()["steps"][0]["items"][3],
            json!({"type": "field", "label": "Authority index", "value": "0", "unit": null})
        );

        // Message.
        let review = message_review(b"hi\n\nyou", &FEE_PAYER, &path0()).unwrap();
        assert_eq!(
            review.to_json(),
            json!({"kind": "message", "steps": [
                {"name": "message", "title": "Sign message", "items": [
                    {"type": "field", "label": "Signer", "value": address(&FEE_PAYER), "unit": null},
                    {"type": "field", "label": "Line 1", "value": "hi", "unit": null},
                    {"type": "field", "label": "Line 2 (empty)", "value": "", "unit": null},
                    {"type": "field", "label": "Line 3", "value": "you", "unit": null}],
                 "menus": [account.clone(), {"name": "Details", "fields": [
                    {"type": "field", "label": "Message hash", "value": sha256_hex(b"hi\n\nyou"), "unit": null},
                    {"type": "field", "label": "Length", "value": "7 bytes", "unit": null}]}]}
            ]})
        );

        // EOA authorization.
        let review = eoa_auth_review(
            EoaAuthKind::Delete,
            1,
            &key(0x33),
            &FEE_PAYER,
            &FEE_PAYER,
            &path0(),
        )
        .unwrap();
        assert_eq!(
            review.to_json(),
            json!({"kind": "eoa_auth", "steps": [
                {"name": "eoa_auth", "title": "Authorize account deletion", "items": [
                    {"type": "note", "text": "The fee payer can delete this account, or clear its data, while its balance and nonce are zero."},
                    {"type": "note", "text": "This authorization does not expire and can be used again."},
                    {"type": "field", "label": "Account", "value": address(&FEE_PAYER), "unit": null},
                    {"type": "field", "label": "Fee payer", "value": address(&key(0x33)), "unit": null},
                    {"type": "field", "label": "Network", "value": "alphanet", "unit": null}],
                 "menus": [account]}
            ]})
        );
    }
}
