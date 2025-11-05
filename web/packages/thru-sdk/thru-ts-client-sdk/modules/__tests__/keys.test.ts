import { describe, expect, it } from "vitest";
import { fromPrivateKey, generateKeyPair } from "../keys";

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

  describe("fromPrivateKey", () => {
    it("should derive public key from private key", async () => {
      const keypair = await generateKeyPair();
      const derivedPublicKey = await fromPrivateKey(keypair.privateKey);
      
      expect(derivedPublicKey).toBeInstanceOf(Uint8Array);
      expect(derivedPublicKey.length).toBe(32);
      expect(derivedPublicKey).toEqual(keypair.publicKey);
    });

    it("should generate 32-byte public key", async () => {
      const keypair = await generateKeyPair();
      const publicKey = await fromPrivateKey(keypair.privateKey);
      
      expect(publicKey.length).toBe(32);
    });

    it("should produce consistent public key for same private key", async () => {
      const keypair = await generateKeyPair();
      const publicKey1 = await fromPrivateKey(keypair.privateKey);
      const publicKey2 = await fromPrivateKey(keypair.privateKey);
      
      expect(publicKey1).toEqual(publicKey2);
    });

    it("should produce different public keys for different private keys", async () => {
      const keypair1 = await generateKeyPair();
      const keypair2 = await generateKeyPair();
      
      const publicKey1 = await fromPrivateKey(keypair1.privateKey);
      const publicKey2 = await fromPrivateKey(keypair2.privateKey);
      
      expect(publicKey1).not.toEqual(publicKey2);
    });

    it("should work with any valid 32-byte private key", async () => {
      // Create a deterministic private key for testing
      const privateKey = new Uint8Array(32);
      privateKey.fill(0x42);
      
      const publicKey = await fromPrivateKey(privateKey);
      
      expect(publicKey).toBeInstanceOf(Uint8Array);
      expect(publicKey.length).toBe(32);
      // Verify it's not all zeros (which would indicate an error)
      const isAllZeros = publicKey.every(byte => byte === 0);
      expect(isAllZeros).toBe(false);
    });

    it("should return a new Uint8Array instance", async () => {
      const keypair = await generateKeyPair();
      const publicKey1 = await fromPrivateKey(keypair.privateKey);
      const publicKey2 = await fromPrivateKey(keypair.privateKey);
      
      // Should be equal but different instances
      expect(publicKey1).toEqual(publicKey2);
      expect(publicKey1).not.toBe(publicKey2);
    });
  });
});

