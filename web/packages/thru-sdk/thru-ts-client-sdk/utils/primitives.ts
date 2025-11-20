import { create } from "@bufbuild/protobuf";
import {
    BytesLike,
    Pubkey as PubkeyInput,
    decodeAddress,
    decodeBase64,
    decodeSignature,
    encodeAddress,
    encodeSignature,
    hexToBytes,
    isHexString,
} from "@thru/helpers";

import {
    Pubkey,
    PubkeySchema,
    Signature,
    SignatureSchema,
    TaPubkey,
    TaPubkeySchema,
    TsSignature,
    TsSignatureSchema,
} from "../proto/thru/common/v1/primitives_pb";

const PUBKEY_LENGTH = 32;
const SIGNATURE_LENGTH = 64;
const TA_ADDRESS_LENGTH = 46;
const TS_SIGNATURE_LENGTH = 90;

export type TaAddressInput = string | Uint8Array;
export type TsSignatureInput = string | Uint8Array;

function copyBytes(source: Uint8Array): Uint8Array {
    const bytes = new Uint8Array(source.length);
    bytes.set(source);
    return bytes;
}

function isTaAddress(value: string): boolean {
    return value.startsWith("ta") && value.length === TA_ADDRESS_LENGTH;
}

function isTsSignature(value: string): boolean {
    return value.startsWith("ts") && value.length === TS_SIGNATURE_LENGTH;
}

function ensureExactLength(bytes: Uint8Array, expected: number, field: string): Uint8Array {
    if (bytes.length !== expected) {
        throw new Error(`${field} must contain ${expected} bytes`);
    }
    return copyBytes(bytes);
}

function decodeBase64String(value: string, message: string): Uint8Array {
    try {
        return decodeBase64(value);
    } catch {
        throw new Error(message);
    }
}

function decodeHex(value: string, message: string): Uint8Array {
    try {
        return hexToBytes(value);
    } catch {
        throw new Error(message);
    }
}

export function pubkeyBytesFromInput(value: PubkeyInput, field = "pubkey"): Uint8Array {
    if (value instanceof Uint8Array) {
        return ensureExactLength(value, PUBKEY_LENGTH, field);
    }
    if (typeof value === "string") {
        if (isTaAddress(value)) {
            return ensureExactLength(decodeAddress(value), PUBKEY_LENGTH, field);
        }
        if (isHexString(value)) {
            return ensureExactLength(
                decodeHex(value, `${field} hex string must decode to 32 bytes`),
                PUBKEY_LENGTH,
                field,
            );
        }
        return ensureExactLength(
            decodeBase64String(value, `${field} must be a 32-byte value, ta-address, hex string, or base64 string`),
            PUBKEY_LENGTH,
            field,
        );
    }
    throw new Error(`${field} must be a 32-byte value, ta-address, hex string, or base64 string`);
}

export function signatureBytesFromInput(value: BytesLike, field = "signature"): Uint8Array {
    if (value instanceof Uint8Array) {
        return ensureExactLength(value, SIGNATURE_LENGTH, field);
    }
    if (typeof value === "string") {
        if (isTsSignature(value)) {
            return ensureExactLength(decodeSignature(value), SIGNATURE_LENGTH, field);
        }
        if (isHexString(value)) {
            return ensureExactLength(
                decodeHex(value, `${field} hex string must decode to 64 bytes`),
                SIGNATURE_LENGTH,
                field,
            );
        }
        return ensureExactLength(
            decodeBase64String(
                value,
                `${field} must be provided as Uint8Array, ts-encoded string, hex string, or base64 string`,
            ),
            SIGNATURE_LENGTH,
            field,
        );
    }
    throw new Error(`${field} must be provided as Uint8Array, ts-encoded string, hex string, or base64 string`);
}

export function taAddressStringFromInput(value: TaAddressInput, field = "taPubkey"): string {
    if (typeof value === "string") {
        if (!isTaAddress(value)) {
            throw new Error(`${field} must be a ta-encoded address`);
        }
        return value;
    }
    if (value instanceof Uint8Array) {
        return encodeAddress(ensureExactLength(value, PUBKEY_LENGTH, field));
    }
    throw new Error(`${field} must be provided as a ta-encoded string or 32-byte public key`);
}

export function tsSignatureStringFromInput(value: TsSignatureInput, field = "tsSignature"): string {
    if (typeof value === "string") {
        if (!isTsSignature(value)) {
            throw new Error(`${field} must be a ts-encoded signature`);
        }
        return value;
    }
    if (value instanceof Uint8Array) {
        return encodeSignature(ensureExactLength(value, SIGNATURE_LENGTH, field));
    }
    throw new Error(`${field} must be provided as a ts-encoded string or 64-byte signature`);
}

export function toPubkeyProto(value: PubkeyInput, field = "pubkey"): Pubkey {
    return create(PubkeySchema, { value: pubkeyBytesFromInput(value, field) });
}

export function toSignatureProto(value: BytesLike, field = "signature"): Signature {
    return create(SignatureSchema, { value: signatureBytesFromInput(value, field) });
}

export function toTaPubkeyProto(value: TaAddressInput, field = "taPubkey"): TaPubkey {
    return create(TaPubkeySchema, { value: taAddressStringFromInput(value, field) });
}

export function toTsSignatureProto(value: TsSignatureInput, field = "tsSignature"): TsSignature {
    return create(TsSignatureSchema, { value: tsSignatureStringFromInput(value, field) });
}

export function protoPubkeyToBytes(pubkey?: Pubkey): Uint8Array {
    if (!pubkey?.value || pubkey.value.length !== PUBKEY_LENGTH) {
        return new Uint8Array(PUBKEY_LENGTH);
    }
    return copyBytes(pubkey.value);
}

export function optionalProtoPubkeyToBytes(pubkey?: Pubkey): Uint8Array | undefined {
    if (!pubkey?.value || pubkey.value.length !== PUBKEY_LENGTH) {
        return undefined;
    }
    return copyBytes(pubkey.value);
}

export function protoSignatureToBytes(signature?: Signature): Uint8Array | undefined {
    if (!signature?.value || signature.value.length !== SIGNATURE_LENGTH) {
        return undefined;
    }
    return copyBytes(signature.value);
}

export function protoTaPubkeyToString(value?: TaPubkey): string | undefined {
    return value?.value;
}

export function protoTsSignatureToString(value?: TsSignature): string | undefined {
    return value?.value;
}

export function encodePubkeyToTaAddress(bytes: Uint8Array): string {
    return encodeAddress(ensureExactLength(bytes, PUBKEY_LENGTH, "pubkey"));
}

export function encodeSignatureToTs(signature: Uint8Array): string {
    return encodeSignature(ensureExactLength(signature, SIGNATURE_LENGTH, "signature"));
}

