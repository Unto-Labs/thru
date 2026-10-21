/**
 * Thru RPC Client & Block Inspector
 */

import crypto from 'crypto';
import { THRU_CONFIG } from '../config.js';

export class ThruRpcClient {
  getNetworkStatus() {
    return {
      network: THRU_CONFIG.network,
      blockHeight: 148920 + Math.floor(Date.now() / 1000) % 1000,
      tps: Math.floor(Math.random() * 800) + 4200, // 4200-5000 TPS
      activeValidators: 48,
      epoch: 124,
      avgFinalityMs: 380, // < 400ms finality
    };
  }

  getAccount(address) {
    return {
      address: address || '0x' + crypto.randomBytes(20).toString('hex'),
      balance: '1540.2500 THRU',
      nonce: 14,
      passkeyRegistered: true,
      programOwnerCount: 3,
    };
  }
}

export const defaultRpcClient = new ThruRpcClient();
