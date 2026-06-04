/**
 * Create challenge for VALIDATE instruction.
 * SHA256(nonce || account_0 || account_1 || ... || trailing_instruction_bytes)
 */
export async function createValidateChallenge(
  nonce: bigint,
  accountAddresses: string[],
  trailingInstructionData: Uint8Array
): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const accountBytes = accountAddresses.map((address) => {
    return encoder.encode(address);
  });

  const totalSize =
    accountBytes.reduce((sum, bytes) => sum + bytes.length, 8) +
    trailingInstructionData.length;
  const challengeData = new Uint8Array(totalSize);

  let offset = 0;

  // Write nonce as little-endian u64
  let v = nonce;
  for (let i = 0; i < 8; i++) {
    challengeData[offset + i] = Number(v & 0xffn);
    v >>= 8n;
  }
  offset += 8;

  for (const bytes of accountBytes) {
    challengeData.set(bytes, offset);
    offset += bytes.length;
  }

  challengeData.set(trailingInstructionData, offset);

  const hashBuffer = await crypto.subtle.digest('SHA-256', challengeData);
  return new Uint8Array(hashBuffer);
}
