import type { NativeSDK } from "../../NativeSDK";

/** Spin until the SDK exists or `timeout` ms passes. */
export function waitForWallet(
  getWallet: () => NativeSDK | null,
  timeout = 5000,
  interval = 100
): Promise<NativeSDK> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const sdk = getWallet();
      if (sdk) return resolve(sdk);
      if (Date.now() - start > timeout) {
        return reject(new Error('NativeSDK not initialized in time'));
      }
      setTimeout(check, interval);
    };
    check();
  });
}
