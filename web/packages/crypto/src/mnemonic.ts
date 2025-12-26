import { generateMnemonic, validateMnemonic, mnemonicToSeedSync } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';

/**
 * Handles BIP39 mnemonic phrase generation and validation.
 * Uses @scure/bip39 for React Native compatibility (no Buffer dependency).
 */
export class MnemonicGenerator {
  /**
   * Generate a new 12-word mnemonic phrase
   * @returns 12-word mnemonic string
   */
  static generate(): string {
    // 128 bits of entropy = 12 words
    return generateMnemonic(wordlist, 128);
  }

  /**
   * Validate a mnemonic phrase
   * @param phrase - Mnemonic phrase to validate
   * @returns true if valid, false otherwise
   */
  static validate(phrase: string): boolean {
    return validateMnemonic(phrase, wordlist);
  }

  /**
   * Convert mnemonic phrase to seed bytes
   * @param phrase - Valid mnemonic phrase
   * @param passphrase - Optional passphrase for additional security
   * @returns Seed as Uint8Array (64 bytes)
   */
  static toSeed(phrase: string, passphrase: string = ''): Uint8Array {
    if (!this.validate(phrase)) {
      throw new Error('Invalid mnemonic phrase');
    }
    // @scure/bip39 returns Uint8Array directly (no Buffer)
    return mnemonicToSeedSync(phrase, passphrase);
  }

  /**
   * Get the number of words in a mnemonic
   * @param phrase - Mnemonic phrase
   * @returns Number of words
   */
  static getWordCount(phrase: string): number {
    return phrase.trim().split(/\s+/).length;
  }
}
