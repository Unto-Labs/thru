/**
 * TS SDK consumer of the shared signing conformance corpus
 * (`contrib/test/vectors/signing/`, see its README.md "Consumer contract").
 * The C node is ground truth; every vector there was checked against C.
 *
 * Covered here:
 *   - txn_vectors.json: accept/reject of `body_hex` through the strict parser
 *     (`Transaction.fromWire`), sw_class of rejects, the `fromWire` /
 *     `toWireForSigning` round trip, the decoded header vs `envelope`, the
 *     signing message `M`, RFC 8032 signing with `signer_seed_hex` (both the
 *     raw domain API and `Transaction.sign`, the Rfc8032 scheme), strict
 *     verify-before-attach (`attachTransactionSignature`) and `ts…` encoding.
 *   - message_vectors.json: `signMessage` / `verifyMessage`, including the
 *     32768-byte message limit C applies to both.
 *   - eoa_auth_vectors.json: `buildEOACreateMessage` / `buildEOADeleteMessage`
 *     bytes and their signatures.
 *   - address_vectors.json: `ta…` / `ts…` encode, decode and decode rejects.
 *
 * Where the TS SDK disagrees with C, the vector is listed in an explicit
 * allow-list below with the reason. Each allow-list entry is itself checked:
 * if the SDK is fixed and starts agreeing with C, the test fails so the entry
 * gets removed.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as ed from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha2.js";
import { mnemonicToSeedSync } from "@scure/bip39";

import { Transaction } from "../domain/transactions/Transaction";
import {
    SIGNATURE_CTX_MAX,
    SignatureDomain,
    attachTransactionSignature,
    buildSignedMessage,
    buildTransactionSigningMessage,
    signMessage,
    signWithDomain,
    verifyMessage,
    verifyWithDomain,
} from "../domain/transactions/domain-signing";
import {
    TransactionSigningScheme,
    resolveTransactionSigningScheme,
} from "../domain/transactions/transaction-signing-scheme";
import { buildEOACreateMessage, buildEOADeleteMessage } from "../domain/programs/eoa";
import { Pubkey, Signature } from "../domain/primitives";
import { decodeAddress, encodeAddress } from "../../src/helpers/address";
import { decodeSignature, encodeSignature } from "../../src/helpers/signature";
import { ThruHDWallet } from "../../src/crypto/hdwallet";

/* ------------------------------------------------------------------ */
/* Corpus loading                                                      */
/* ------------------------------------------------------------------ */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../..");
const CORPUS_DIR = resolve(REPO_ROOT, "contrib/test/vectors/signing");

function loadCorpus<T>(file: string): T[] {
    return JSON.parse(readFileSync(resolve(CORPUS_DIR, file), "utf8")) as T[];
}

type Category = "valid" | "reject" | "device_reject";

interface Envelope {
    version: number;
    flags: number;
    chain_id: number;
    fee: string;
    nonce: string;
    start_slot: string;
    expiry_after: number;
    expiry_slot: string;
    cu: number;
    su: number;
    mu: number;
    pad: number;
    fee_payer_addr: string;
    fee_payer_hex: string;
    program_addr: string;
    program_hex: string;
    rw_cnt: number;
    ro_cnt: number;
    instr_sz: number;
    has_fee_payer_proof: boolean;
    may_compress: boolean;
    proof_type: "existing" | "creation" | null;
    proof_slot: string | null;
}

interface TxnVector {
    name: string;
    category: Category;
    reject_reason: string | null;
    sw_class: string | null;
    sw: string | null;
    body_len: number;
    body_hex: string;
    body_sha256_hex: string;
    signer_path: string;
    signer_seed_hex: string;
    signer_pubkey_hex: string;
    signer_addr: string;
    signing_message_hex: string | null;
    signature_hex: string | null;
    signature_ts: string | null;
    wire_hex: string | null;
    envelope: Envelope | null;
}

interface MessageVector {
    name: string;
    category: Category;
    reject_reason: string | null;
    message_len: number;
    message_hex: string;
    message_sha256_hex: string;
    is_printable_ascii: boolean;
    display: "text" | "hash" | null;
    signer_path: string;
    signer_seed_hex: string;
    signer_pubkey_hex: string;
    signing_message_hex: string | null;
    signature_hex: string | null;
}

interface EoaAuthVector {
    name: string;
    category: Category;
    reject_reason: string | null;
    kind: "create" | "delete";
    chain_id: number;
    fee_payer_hex: string;
    fee_payer_addr: string;
    account_hex: string;
    account_addr: string;
    signer_path: string;
    signer_seed_hex: string;
    signer_pubkey_hex: string;
    auth_message_hex: string;
    signature_hex: string | null;
}

interface AddressVector {
    name: string;
    kind: "address" | "signature" | "address_reject" | "signature_reject";
    bytes_hex: string | null;
    encoded: string;
    checksum: number | null;
    decode_error: "bad_length" | "bad_prefix" | "bad_character" | "bad_checksum" | null;
}

const txnVectors = loadCorpus<TxnVector>("txn_vectors.json");
const messageVectors = loadCorpus<MessageVector>("message_vectors.json");
const eoaVectors = loadCorpus<EoaAuthVector>("eoa_auth_vectors.json");
const addressVectors = loadCorpus<AddressVector>("address_vectors.json");

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function hex(h: string): Uint8Array {
    return Uint8Array.from(Buffer.from(h, "hex"));
}

function toHex(b: Uint8Array): string {
    return Buffer.from(b).toString("hex");
}

const SIGNATURE_SIZE = 64;
const U64_MAX = (1n << 64n) - 1n;
const PROOF_SLOT_MASK = (1n << 62n) - 1n;

/** Every corpus key is derived from the BIP-39 "abandon … about" test mnemonic. */
const CORPUS_MNEMONIC =
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

/** sw_class of the error the strict TS parser throws (see Transaction.parseWire). */
function tsSwClass(message: string): string {
    if (/Unsupported transaction version/.test(message)) return "version";
    if (/Unsupported transaction flags/.test(message)) return "flags";
    if (/state proof has unknown type/.test(message)) return "proof_type";
    if (/accounts including fee payer and program/.test(message)) return "too_many_accounts";
    if (/too short|truncated|trailing bytes/.test(message)) return "format";
    return `unclassified: ${message}`;
}

type TsOutcome =
    | { accept: true; txn: Transaction }
    | { accept: false; swClass: string; error: string };

/**
 * Run `body_hex` through the strict TS parser. `Transaction.fromWire` takes a
 * full wire transaction, so a zero signature is appended; it is not part of the
 * body under test (a zero signature is treated as "unsigned" by the parser).
 */
function tsParseBody(body: Uint8Array): TsOutcome {
    const wire = new Uint8Array(body.length + SIGNATURE_SIZE);
    wire.set(body, 0);
    try {
        return { accept: true, txn: Transaction.fromWire(wire) };
    } catch (err) {
        const error = (err as Error).message;
        return { accept: false, swClass: tsSwClass(error), error };
    }
}

/** Hosts and SDKs treat `device_reject` bodies as valid (README "Categories"). */
function hostAccepts(v: { category: Category }): boolean {
    return v.category !== "reject";
}

/* ------------------------------------------------------------------ */
/* Allow-lists: known TS/C disagreements                               */
/* ------------------------------------------------------------------ */

/**
 * Bodies the C node rejects but the strict TS parser (`Transaction.fromWire`)
 * accepts. `Transaction.fromWire` is a structural parser: it checks version,
 * flags, proof type 3, the account-count limit and exact sizing, but it does
 * not run the node's semantic validation (`tn_validate_txn_accounts`, chain id,
 * MTU, UPDATING proofs). These bodies are therefore only rejected on chain.
 */
const TS_ACCEPTS_NODE_REJECT: Record<string, string> = {
    // chain_id == 0: TS does not check CHAIN_ID_ZERO.
    ledger_txn_minimal_chain_id_zero: "no chain_id == 0 check",
    reject_chain_id_zero: "no chain_id == 0 check",
    // body_len > 32704 with consistent sizes: TS has no TN_TXN_MTU check.
    reject_oversize_by_1: "no MTU (32768-byte wire) check",
    // Account layout rules of tn_validate_txn_accounts are not checked by TS.
    reject_rw_unsorted: "no rw sort check",
    reject_ro_unsorted: "no ro sort check",
    reject_rw_duplicate: "no duplicate-account check",
    reject_ro_duplicate: "no duplicate-account check",
    reject_rw_ro_overlap: "no duplicate-account check",
    reject_rw_contains_fee_payer: "no duplicate-account check",
    reject_ro_contains_fee_payer: "no duplicate-account check",
    reject_rw_contains_program: "no duplicate-account check",
    reject_ro_contains_program: "no duplicate-account check",
    reject_fee_payer_is_program: "no duplicate-account check",
    // TS parses an UPDATING (type 1) fee-payer proof; C rejects it.
    reject_proof_type_updating: "UPDATING proof type accepted",
};

/**
 * Rejects where TS agrees on reject but reports a different sw_class.
 * Value: the class TS reports.
 */
const TS_SW_CLASS_DIFFERS: Record<string, { ts: string; why: string }> = {
    // README note 2: 2 + rw + ro > 1024 is always oversize first in C and on
    // the device. TS checks the account count before the size, which is the
    // case the README reserves `too_many_accounts` for.
    reject_oversize_1025_total_accounts: {
        ts: "too_many_accounts",
        why: "TS checks the account count before the size (README note 2)",
    },
};

/**
 * Accepted bodies whose `fromWire` -> `toWireForSigning` round trip is not
 * byte-identical: `Transaction` does not model the header `pad` field (bytes
 * 46..47) and always re-encodes it as zero. The node accepts any pad value
 * (README note 3). Signing these bodies through `Transaction.sign` therefore
 * signs a different body; the raw-body APIs (`buildTransactionSigningMessage`,
 * `signWithDomain`) are byte-exact and are checked for them.
 */
const TS_DROPS_PAD: Record<string, string> = {
    ledger_txn_minimal_pad_nonzero: "pad not modelled by Transaction",
    device_pad_nonzero: "pad not modelled by Transaction",
    device_pad_high_bit: "pad not modelled by Transaction",
};

/* ------------------------------------------------------------------ */
/* Corpus sanity                                                       */
/* ------------------------------------------------------------------ */


/** APDU spec section 8.7, mirrored from thru-ledger-parser::is_text_message. */
function isTextMessage(message: Uint8Array): boolean {
    if (message.length === 0 || message.length > 512) return false;
    let lines = 1;
    let previous = 0;
    let run = 0;
    for (const byte of message) {
        if (byte === 0x0a) {
            if (previous === 0x20 || ++lines > 16) return false;
            previous = 0;
            run = 0;
            continue;
        }
        if (byte < 0x20 || byte > 0x7e) return false;
        if (byte === 0x20) {
            if (previous < 0x21 || previous > 0x7e) return false;
            run++;
        } else {
            run = previous === 0x20 ? run + 1 : 1;
            if (run > 9) return false;
        }
        previous = byte;
    }
    return previous !== 0x20;
}

describe("signing corpus: shape", () => {
    it("loads every corpus file", () => {
        expect(txnVectors.length).toBeGreaterThan(50);
        expect(messageVectors.length).toBeGreaterThan(5);
        expect(eoaVectors.length).toBeGreaterThan(5);
        expect(addressVectors.length).toBeGreaterThan(10);
    });

    it("has unique vector names", () => {
        for (const vs of [txnVectors, messageVectors, eoaVectors, addressVectors] as Array<Array<{ name: string }>>) {
            expect(new Set(vs.map((v) => v.name)).size).toBe(vs.length);
        }
    });

    it("every allow-list entry names an existing vector", () => {
        const txnNames = new Set(txnVectors.map((v) => v.name));
        for (const name of [
            ...Object.keys(TS_ACCEPTS_NODE_REJECT),
            ...Object.keys(TS_SW_CLASS_DIFFERS),
            ...Object.keys(TS_DROPS_PAD),
        ]) {
            expect(txnNames.has(name), name).toBe(true);
        }
    });

    it("signer seeds are the SLIP-10 keys of the corpus mnemonic at signer_path", async () => {
        const seed = mnemonicToSeedSync(CORPUS_MNEMONIC);
        const pairs = new Map<string, string>();
        for (const v of [...txnVectors, ...messageVectors, ...eoaVectors]) {
            pairs.set(v.signer_path, v.signer_seed_hex);
        }
        expect(pairs.size).toBeGreaterThan(0);
        for (const [path, seedHex] of pairs) {
            const account = await ThruHDWallet.getAccountAtPath(seed, path);
            expect(toHex(account.privateKey), path).toBe(seedHex);
        }
    });
});

/* ------------------------------------------------------------------ */
/* txn_vectors.json                                                    */
/* ------------------------------------------------------------------ */

describe("signing corpus: txn accept/reject", () => {
    it.each(txnVectors.map((v) => [v.name, v] as const))("%s", (name, v) => {
        const body = hex(v.body_hex);
        expect(body.length).toBe(v.body_len);
        expect(toHex(sha256(body))).toBe(v.body_sha256_hex);

        const outcome = tsParseBody(body);
        const allowAccept = TS_ACCEPTS_NODE_REJECT[name];

        if (hostAccepts(v)) {
            expect(outcome.accept, outcome.accept ? "" : outcome.error).toBe(true);
            return;
        }

        if (allowAccept !== undefined) {
            // Known disagreement. Fails once TS starts rejecting, so the entry is removed.
            expect(outcome.accept, `allow-listed (${allowAccept}) but TS now rejects`).toBe(true);
            return;
        }

        expect(outcome.accept, "TS accepts a body the node rejects").toBe(false);
        if (outcome.accept) return;

        // README note 1: for `truncated`, only accept/reject is compared.
        if (v.reject_reason === "truncated") return;

        const differs = TS_SW_CLASS_DIFFERS[name];
        if (differs !== undefined) {
            expect(outcome.swClass, differs.why).toBe(differs.ts);
            expect(outcome.swClass, "allow-listed sw_class now matches C").not.toBe(v.sw_class);
            return;
        }
        expect(outcome.swClass, outcome.error).toBe(v.sw_class);
    });

    it("rejects a body whose header alone is missing (no 112-byte header)", () => {
        expect(tsParseBody(new Uint8Array(0)).accept).toBe(false);
    });
});

const acceptedTxnVectors = txnVectors.filter(hostAccepts);
const signedTxnVectors = txnVectors.filter((v) => v.signature_hex !== null);

describe("signing corpus: txn decode", () => {
    it.each(acceptedTxnVectors.map((v) => [v.name, v] as const))("%s round-trips and matches envelope", (name, v) => {
        const outcome = tsParseBody(hex(v.body_hex));
        expect(outcome.accept).toBe(true);
        if (!outcome.accept) return;
        const txn = outcome.txn;
        const e = v.envelope!;
        expect(e).not.toBeNull();

        // Round trip body_hex.
        const reencoded = toHex(txn.toWireForSigning());
        if (TS_DROPS_PAD[name] !== undefined) {
            expect(e.pad).not.toBe(0);
            expect(reencoded, "allow-listed pad mismatch now round-trips").not.toBe(v.body_hex);
            // Everything but the pad bytes round-trips.
            const zeroPad = hex(v.body_hex);
            zeroPad[46] = 0;
            zeroPad[47] = 0;
            expect(reencoded).toBe(toHex(zeroPad));
        } else {
            expect(reencoded).toBe(v.body_hex);
        }

        // Decoded header vs envelope. `pad` is not exposed by Transaction.
        expect(txn.version).toBe(e.version);
        expect(txn.flags).toBe(e.flags);
        expect(txn.chainId).toBe(e.chain_id);
        expect(txn.fee.toString()).toBe(e.fee);
        expect(txn.nonce.toString()).toBe(e.nonce);
        expect(txn.startSlot.toString()).toBe(e.start_slot);
        expect(txn.expiryAfter).toBe(e.expiry_after);
        const expiry = txn.startSlot + BigInt(txn.expiryAfter);
        expect((expiry > U64_MAX ? U64_MAX : expiry).toString()).toBe(e.expiry_slot);
        expect(txn.requestedComputeUnits).toBe(e.cu);
        expect(txn.requestedStateUnits).toBe(e.su);
        expect(txn.requestedMemoryUnits).toBe(e.mu);
        expect(txn.feePayer.toHex()).toBe(e.fee_payer_hex);
        expect(txn.feePayer.toThruFmt()).toBe(e.fee_payer_addr);
        expect(txn.program.toHex()).toBe(e.program_hex);
        expect(txn.program.toThruFmt()).toBe(e.program_addr);
        expect(txn.readWriteAccounts.length).toBe(e.rw_cnt);
        expect(txn.readOnlyAccounts.length).toBe(e.ro_cnt);
        expect(txn.instructionData?.length ?? 0).toBe(e.instr_sz);
        expect((txn.flags & 1) !== 0).toBe(e.has_fee_payer_proof);
        expect((txn.flags & 2) !== 0).toBe(e.may_compress);

        const proof = txn.feePayerStateProof;
        if (e.proof_type === null) {
            expect(proof).toBeUndefined();
            expect(e.proof_slot).toBeNull();
        } else {
            expect(proof).toBeDefined();
            const typeSlot = new DataView(proof!.buffer, proof!.byteOffset, 8).getBigUint64(0, true);
            const type = Number(typeSlot >> 62n);
            expect(type === 0 ? "existing" : type === 2 ? "creation" : `type ${type}`).toBe(e.proof_type);
            expect((typeSlot & PROOF_SLOT_MASK).toString()).toBe(e.proof_slot);
            expect(txn.feePayerAccountMetaRaw !== undefined).toBe(e.proof_type === "existing");
        }

        expect(txn.getSignature()).toBeUndefined();
    });
});

describe("signing corpus: txn signing", () => {
    it("the default transaction signing scheme is RFC 8032", () => {
        expect(resolveTransactionSigningScheme()).toBe(TransactionSigningScheme.Rfc8032);
    });

    it("signature fields are present iff the node accepts body ‖ Ed25519(signer, M)", () => {
        for (const v of txnVectors) {
            const present = v.signature_hex !== null;
            expect(v.signing_message_hex !== null, v.name).toBe(present);
            expect(v.signature_ts !== null, v.name).toBe(present);
            expect(v.wire_hex !== null, v.name).toBe(present);
            if (v.category === "valid") expect(present, v.name).toBe(true);
            if (v.category === "reject") expect(present, v.name).toBe(false);
        }
        expect(signedTxnVectors.length).toBeGreaterThan(20);
    });

    it.each(signedTxnVectors.map((v) => [v.name, v] as const))("%s", async (name, v) => {
        const body = hex(v.body_hex);
        const seed = hex(v.signer_seed_hex);
        const pubkey = hex(v.signer_pubkey_hex);
        expect(toHex(await ed.getPublicKeyAsync(seed))).toBe(v.signer_pubkey_hex);
        expect(encodeAddress(pubkey)).toBe(v.signer_addr);

        // M = "tn_txn_sign_v1__" ‖ SHA-256(body).
        const msg = buildTransactionSigningMessage(body);
        expect(toHex(msg.m)).toBe(v.signing_message_hex);
        expect(toHex(buildSignedMessage(body, SignatureDomain.TXN))).toBe(v.signing_message_hex);
        // The signer of every signed vector is the fee payer.
        expect(toHex(msg.expectedPublicKey)).toBe(v.signer_pubkey_hex);

        // Raw-body RFC 8032 signing.
        const sig = await signWithDomain(body, seed, pubkey, SignatureDomain.TXN);
        expect(toHex(sig)).toBe(v.signature_hex);
        // Stock Ed25519 over M (bring-your-own-signer path).
        expect(toHex(await ed.signAsync(msg.m, seed))).toBe(v.signature_hex);
        expect(await verifyWithDomain(sig, body, pubkey, SignatureDomain.TXN)).toBe(true);

        // ts… encoding.
        expect(encodeSignature(sig)).toBe(v.signature_ts);
        expect(toHex(decodeSignature(v.signature_ts!))).toBe(v.signature_hex);
        expect(Signature.from(sig).toThruFmt()).toBe(v.signature_ts);

        // Strict verify-before-attach.
        const wire = await attachTransactionSignature(msg, sig);
        expect(toHex(wire)).toBe(v.wire_hex);
        const tampered = sig.slice();
        tampered[0] ^= 0x01;
        await expect(attachTransactionSignature(msg, tampered)).rejects.toThrow(/does not verify/);
        // A signature in another domain over the same body does not attach.
        const msgDomainSig = await signMessage(msg.m, seed);
        await expect(attachTransactionSignature(msg, msgDomainSig)).rejects.toThrow(/does not verify/);

        // The signed wire parses back with the signature.
        const parsed = Transaction.fromWire(hex(v.wire_hex!));
        expect(parsed.getSignature()?.toHex()).toBe(v.signature_hex);

        // Transaction.sign (the Rfc8032 scheme used by TransactionBuilder.buildAndSign).
        const outcome = tsParseBody(body);
        expect(outcome.accept).toBe(true);
        if (!outcome.accept) return;
        const txSig = await outcome.txn.sign(seed);
        if (TS_DROPS_PAD[name] !== undefined) {
            // Signs the pad-zeroed body; see TS_DROPS_PAD.
            expect(txSig.toHex()).not.toBe(v.signature_hex);
        } else {
            expect(txSig.toHex()).toBe(v.signature_hex);
            expect(toHex(outcome.txn.toWire())).toBe(v.wire_hex);
        }
    });

    const mismatchVectors = txnVectors.filter((v) => v.reject_reason === "fee_payer_mismatch");

    it("covers fee_payer_mismatch vectors", () => {
        expect(mismatchVectors.length).toBeGreaterThan(0);
    });

    it.each(mismatchVectors.map((v) => [v.name, v] as const))(
        "%s: a signature by a non-fee-payer key is refused",
        async (_name, v) => {
            const body = hex(v.body_hex);
            const seed = hex(v.signer_seed_hex);
            const msg = buildTransactionSigningMessage(body);
            expect(toHex(msg.expectedPublicKey)).toBe(v.envelope!.fee_payer_hex);
            expect(toHex(msg.expectedPublicKey)).not.toBe(v.signer_pubkey_hex);

            const sig = await ed.signAsync(msg.m, seed);
            await expect(attachTransactionSignature(msg, sig)).rejects.toThrow(/fee-payer/);

            const outcome = tsParseBody(body);
            expect(outcome.accept).toBe(true);
            if (!outcome.accept) return;
            await expect(outcome.txn.sign(seed)).rejects.toThrow(/does not match/);
        },
    );
});

/* ------------------------------------------------------------------ */
/* message_vectors.json                                                */
/* ------------------------------------------------------------------ */

function isPrintableAscii(bytes: Uint8Array): boolean {
    return bytes.every((b) => (b >= 0x20 && b <= 0x7e) || b === 0x0a);
}

describe("signing corpus: messages", () => {
    it.each(messageVectors.map((v) => [v.name, v] as const))("%s", async (_name, v) => {
        const message = hex(v.message_hex);
        const seed = hex(v.signer_seed_hex);
        const pubkey = hex(v.signer_pubkey_hex);
        expect(message.length).toBe(v.message_len);
        expect(toHex(sha256(message))).toBe(v.message_sha256_hex);
        expect(isPrintableAscii(message)).toBe(v.is_printable_ascii);

        if (v.category === "reject") {
            expect(v.signature_hex).toBeNull();
            expect(v.reject_reason).toBe("message_too_long");
            expect(message.length).toBeGreaterThan(SIGNATURE_CTX_MAX);
            // Like C: refuse to build M or sign, and refuse to verify even a
            // correct raw Ed25519 signature over DST ‖ message.
            expect(() => buildSignedMessage(message, SignatureDomain.MSG)).toThrow(/exceeds the 32768-byte limit/);
            await expect(signMessage(message, seed, pubkey)).rejects.toThrow(/exceeds the 32768-byte limit/);
            const dst = new TextEncoder().encode("tn_msg_sign_v1__");
            const m = new Uint8Array(dst.length + message.length);
            m.set(dst, 0);
            m.set(message, dst.length);
            const rawSig = await ed.signAsync(m, seed);
            expect(await ed.verifyAsync(rawSig, m, pubkey)).toBe(true);
            expect(await verifyMessage(rawSig, message, pubkey)).toBe(false);
            return;
        }

        // The SDK has no display API; this checks the corpus against the device's
        // text-mode rule (APDU spec section 8.7) so a host UI can rely on it.
        expect(v.display).toBe(isTextMessage(message) ? "text" : "hash");

        // M = "tn_msg_sign_v1__" ‖ message (no pre-hash).
        expect(toHex(buildSignedMessage(message, SignatureDomain.MSG))).toBe(v.signing_message_hex);

        // `empty` is device_reject only; hosts sign it.
        const sig = await signMessage(message, seed, pubkey);
        expect(toHex(sig)).toBe(v.signature_hex);
        expect(toHex(await ed.signAsync(hex(v.signing_message_hex!), seed))).toBe(v.signature_hex);
        expect(await verifyMessage(sig, message, pubkey)).toBe(true);
        // Domain separation: not a transaction signature over the same bytes.
        expect(await verifyWithDomain(sig, message, pubkey, SignatureDomain.TXN)).toBe(false);
        const tampered = sig.slice();
        tampered[63] ^= 0x01;
        expect(await verifyMessage(tampered, message, pubkey)).toBe(false);
    });

    it("txn_signing_message_as_message: the signature does not verify as a transaction signature", async () => {
        const v = messageVectors.find((x) => x.name === "txn_signing_message_as_message");
        expect(v).toBeDefined();
        const m = hex(v!.message_hex);
        expect(m.length).toBe(48);
        expect(new TextDecoder().decode(m.subarray(0, 16))).toBe("tn_txn_sign_v1__");
        // A transaction signature is plain Ed25519 over this exact M.
        expect(ed.verify(hex(v!.signature_hex!), m, hex(v!.signer_pubkey_hex))).toBe(false);
    });
});

/* ------------------------------------------------------------------ */
/* eoa_auth_vectors.json                                               */
/* ------------------------------------------------------------------ */

describe("signing corpus: EOA authorizations", () => {
    it.each(eoaVectors.map((v) => [v.name, v] as const))("%s", async (_name, v) => {
        const feePayer = hex(v.fee_payer_hex);
        const account = hex(v.account_hex);
        expect(encodeAddress(feePayer)).toBe(v.fee_payer_addr);
        expect(encodeAddress(account)).toBe(v.account_addr);

        const build = v.kind === "create" ? buildEOACreateMessage : buildEOADeleteMessage;
        const domain = v.kind === "create" ? SignatureDomain.EOA_CREATE : SignatureDomain.EOA_DELETE;
        const otherDomain = v.kind === "create" ? SignatureDomain.EOA_DELETE : SignatureDomain.EOA_CREATE;

        // Hosts build the message for device_reject entries too (chain 0, other account).
        const auth = build(v.chain_id, feePayer, account);
        expect(toHex(auth)).toBe(v.auth_message_hex);
        expect(auth.length).toBe(82);

        if (v.category === "device_reject") {
            expect(v.signature_hex).toBeNull();
            if (v.reject_reason === "account_mismatch") expect(v.account_hex).not.toBe(v.signer_pubkey_hex);
            if (v.reject_reason === "bad_chain_id") expect(v.chain_id).toBe(0);
            return;
        }

        const seed = hex(v.signer_seed_hex);
        expect(v.account_hex).toBe(v.signer_pubkey_hex);
        // M = DST ‖ chain_id ‖ fee_payer ‖ account, signed raw (no pre-hash).
        const context = auth.subarray(16);
        const sig = await signWithDomain(context, seed, account, domain);
        expect(toHex(sig)).toBe(v.signature_hex);
        expect(toHex(await ed.signAsync(auth, seed))).toBe(v.signature_hex);
        expect(await verifyWithDomain(sig, context, account, domain)).toBe(true);
        // Create and delete signatures never cross-verify.
        expect(await verifyWithDomain(sig, context, account, otherDomain)).toBe(false);
    });
});

/* ------------------------------------------------------------------ */
/* address_vectors.json                                                */
/* ------------------------------------------------------------------ */

/** decode_error class of the error the TS decoders throw. */
function tsDecodeError(message: string): string {
    if (/length/.test(message)) return "bad_length";
    if (/must start with/.test(message)) return "bad_prefix";
    if (/encoding/.test(message)) return "bad_character";
    if (/checksum/.test(message)) return "bad_checksum";
    return `unclassified: ${message}`;
}

describe("signing corpus: addresses and signatures", () => {
    it.each(addressVectors.map((v) => [v.name, v] as const))("%s", (_name, v) => {
        switch (v.kind) {
            case "address": {
                const bytes = hex(v.bytes_hex!);
                expect(bytes.reduce((a, b) => a + b, 0) % 256).toBe(v.checksum);
                expect(encodeAddress(bytes)).toBe(v.encoded);
                expect(v.encoded).toHaveLength(46);
                expect(toHex(decodeAddress(v.encoded))).toBe(v.bytes_hex);
                expect(Pubkey.from(v.encoded).toHex()).toBe(v.bytes_hex);
                expect(Pubkey.from(bytes).toThruFmt()).toBe(v.encoded);
                break;
            }
            case "signature": {
                const bytes = hex(v.bytes_hex!);
                expect(bytes.reduce((a, b) => a + b, 0) % 65536).toBe(v.checksum);
                expect(encodeSignature(bytes)).toBe(v.encoded);
                expect(v.encoded).toHaveLength(90);
                expect(toHex(decodeSignature(v.encoded))).toBe(v.bytes_hex);
                expect(Signature.from(v.encoded).toHex()).toBe(v.bytes_hex);
                break;
            }
            case "address_reject":
            case "signature_reject": {
                const decode = v.kind === "address_reject" ? decodeAddress : decodeSignature;
                let error: string | undefined;
                try {
                    decode(v.encoded);
                } catch (err) {
                    error = (err as Error).message;
                }
                expect(error, "decode accepted a reject vector").toBeDefined();
                expect(tsDecodeError(error!)).toBe(v.decode_error);
                break;
            }
            default:
                throw new Error(`unknown address vector kind: ${String((v as AddressVector).kind)}`);
        }
    });
});
