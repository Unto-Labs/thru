export function encodeInvokeInstruction(
  _programPubkey: Uint8Array,
  _instruction: Uint8Array,
): Uint8Array {
  throw new Error(
    'encodeInvokeInstruction is from the legacy passkey-manager ABI. ' +
      'Migrate this flow to encodeValidateInstruction({ targetInstruction }) against the upgraded passkey manager.',
  );
}
