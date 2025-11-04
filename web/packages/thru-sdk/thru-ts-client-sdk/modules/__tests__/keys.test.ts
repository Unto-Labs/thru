import { describe, expect, it } from "vitest";
import { generateKeyPair } from "../keys";

describe("keys", () => {
  describe("generateKeyPair", () => {
    it("should generate valid keypair", async () => {
      const result = await generateKeyPair();
      
      expect(result).toBeDefined();
      expect(result.address).toBeTruthy();
      expect(result.publicKey).toBeInstanceOf(Uint8Array);
      expect(result.privateKey).toBeInstanceOf(Uint8Array);
    });

    it("should generate 32-byte public key", async () => {
      const result = await generateKeyPair();
      
      expect(result.publicKey.length).toBe(32);
    });

    it("should generate 32-byte private key (Ed25519 seed)", async () => {
      const result = await generateKeyPair();
      
      expect(result.privateKey.length).toBe(32);
    });

    it("should generate address starting with 'ta'", async () => {
      const result = await generateKeyPair();
      
      expect(result.address.startsWith("ta")).toBe(true);
    });

    it("should generate different keypairs on each call", async () => {
      const result1 = await generateKeyPair();
      const result2 = await generateKeyPair();
      
      // All fields should be different (very unlikely to be same)
      expect(result1.address).not.toBe(result2.address);
      expect(result1.publicKey).not.toEqual(result2.publicKey);
      expect(result1.privateKey).not.toEqual(result2.privateKey);
    });

    it("should generate valid Ed25519 keypair format", async () => {
      const result = await generateKeyPair();
      
      // Public key should be 32 bytes
      expect(result.publicKey.length).toBe(32);
      // Private key should be 32 bytes (Ed25519 seed)
      expect(result.privateKey.length).toBe(32);
      // Address should be valid format
      expect(result.address.length).toBeGreaterThan(0);
    });
  });
});

