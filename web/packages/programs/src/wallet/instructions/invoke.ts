export function encodeInvokeInstruction(
  _programPubkey: Uint8Array,
  _instruction: Uint8Array,
): Uint8Array {
  throw new Error(
    'encodeInvokeInstruction is from the legacy wallet ABI. ' +
      'Migrate this flow to encodeValidateInstruction({ targetInstruction }) against the upgraded Wallet Program.',
  );
}
