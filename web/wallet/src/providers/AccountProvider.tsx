'use client';

import type { DerivedAccount } from '@/types/account';
import { isEmbeddedContext, walletDebug } from '@/lib/wallet/utils';
import { NetworkType, WalletManager } from '@/lib/wallet/wallet-manager';
import { useSession } from '@/providers/SessionProvider';
import { usePasskeyAuth } from '@/providers/PasskeyAuthProvider';
import { MANAGER_PROFILE } from '@/lib/fee-payer';
import { resolveThruRpcBaseUrl } from '@/lib/thru-rpc';
import { AddressType } from '@thru/chain-interfaces';
import { AccountStorage } from '@thru/wallet-store';
import { bytesToHex } from '@thru/passkey';
import { decodeAddress, encodeAddress } from '@thru/helpers';
import {
  ConsensusStatus,
  Transaction,
} from '@thru/thru-sdk';
import { StateProofType } from '@thru/proto';
import { createThruClient } from '@thru/thru-sdk/client';
import { hexToBytes } from '@thru/passkey';
import {
  concatenateInstructions,
  createWalletSeed,
  deriveWalletAddress,
  encodeCreateInstruction,
  buildPasskeyReadWriteAccounts,
  PASSKEY_MANAGER_PROGRAM_ADDRESS,
} from '@thru/passkey-manager';
import { uint8ArrayToBase64 } from '@/lib/wallet/utils';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

export interface AccountContextState {
  accounts: DerivedAccount[];
  balances: Map<number, bigint>;
  selectedAccountIndex: number;
  isLoading: boolean;
  createAccount: (
    accountName: string
  ) => Promise<{
    accountName: string;
    address: string;
    signature: string | null;
    vmError: string | null;
    userErrorCode: string | null;
    executionResult: string | null;
  }>;
  renameAccount: (index: number, label: string) => Promise<void>;
  selectAccount: (index: number) => void;
  refreshBalances: () => Promise<void>;
  refreshAccounts: () => Promise<void>;
  loadAccounts: () => Promise<void>;
  loadBalances: (publicKeys: string[]) => Promise<void>;
  getEmbeddedAccountsSnapshot: () => DerivedAccount[];
  setAccounts: React.Dispatch<React.SetStateAction<DerivedAccount[]>>;
  embeddedAccountsRef: React.MutableRefObject<DerivedAccount[]>;
}

export const AccountContext = createContext<AccountContextState | null>(null);

export function useAccounts(): AccountContextState {
  const context = useContext(AccountContext);
  if (!context) {
    throw new Error('useAccounts must be used within AccountProvider');
  }
  return context;
}

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const { isUnlocked, resetLockTimer, network } = useSession();
  const { passkeyPublicKey } = usePasskeyAuth();

  const [accounts, setAccounts] = useState<DerivedAccount[]>([]);
  const [balances, setBalances] = useState<Map<number, bigint>>(new Map());
  const [selectedAccountIndex, setSelectedAccountIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const embeddedAccountsRef = useRef<DerivedAccount[]>([]);

  // Clear accounts on lock
  useEffect(() => {
    if (!isUnlocked) {
      setAccounts([]);
      setBalances(new Map());
      setSelectedAccountIndex(0);
    }
  }, [isUnlocked]);

  const loadBalances = useCallback(
    async (publicKeys: string[]) => {
      try {
        const newBalances = await WalletManager.getBalances(publicKeys, network);
        setBalances(newBalances);
      } catch (error) {
        console.error('Failed to load balances:', error);
      }
    },
    [network]
  );

  const loadAccounts = useCallback(async () => {
    try {
      const loadedAccounts = await WalletManager.getAccounts();
      setAccounts(loadedAccounts);

      if (loadedAccounts.length > 0) {
        await loadBalances(loadedAccounts.map((a) => a.publicKey));
      }
    } catch (error) {
      console.error('Failed to load accounts:', error);
      throw error;
    }
  }, [loadBalances]);

  const getEmbeddedAccountsSnapshot = useCallback(() => {
    return embeddedAccountsRef.current;
  }, []);

  const createAccount = useCallback(
    async (
      accountName: string
    ): Promise<{
      accountName: string;
      address: string;
      signature: string | null;
      vmError: string | null;
      userErrorCode: string | null;
      executionResult: string | null;
    }> => {
      if (!isUnlocked) {
        throw new Error('Wallet is locked');
      }

      if (!passkeyPublicKey) {
        throw new Error('No passkey registered for this profile');
      }

      const enrichCreateAccountError = (
        err: unknown,
        context: {
          signature: string | null;
          vmError: number | string | bigint | null;
          userErrorCode: number | string | bigint | null;
        }
      ): never => {
        if (err && typeof err === 'object') {
          const target = err as Record<string, unknown>;
          target.txSignature = context.signature;
          target.vmError = context.vmError;
          target.userErrorCode = context.userErrorCode;
          throw err;
        }

        const wrapped = new Error(typeof err === 'string' ? err : 'Failed to create account');
        const target = wrapped as unknown as Record<string, unknown>;
        target.txSignature = context.signature;
        target.vmError = context.vmError;
        target.userErrorCode = context.userErrorCode;
        throw wrapped;
      };

      let rawSignature: string | null = null;
      let txSignature: string | null = null;
      let execution: {
        vmError?: number | string;
        userErrorCode?: bigint | number;
        executionResult?: bigint | number;
      } | null = null;

      setIsLoading(true);
      try {
        const trimmedName = accountName.trim();
        if (!trimmedName) {
          throw new Error('Account name is required');
        }

        if (accounts.some((account) => account.path === trimmedName)) {
          throw new Error(`Account name "${trimmedName}" is already used`);
        }

        const nextIndex = await AccountStorage.getNextAccountIndex();
        const accountLabel = trimmedName;
        const walletName = trimmedName;

        const sdk = createThruClient({ baseUrl: resolveThruRpcBaseUrl() });
        const seed = await createWalletSeed(
          walletName,
          passkeyPublicKey.x,
          passkeyPublicKey.y
        );
        const walletAddress = await deriveWalletAddress(seed, PASSKEY_MANAGER_PROGRAM_ADDRESS);
        const walletAddressStr = encodeAddress(walletAddress);

        const feePayerPublicKey = decodeAddress(MANAGER_PROFILE.address);
        const programAddress = decodeAddress(PASSKEY_MANAGER_PROGRAM_ADDRESS);

        const { readWriteAddresses, findAccountIndex } = buildPasskeyReadWriteAccounts(
          [walletAddress],
          feePayerPublicKey,
          programAddress
        );

        const walletAccountIdx = findAccountIndex(walletAddress);
        if (walletAccountIdx < 2) {
          throw new Error(`Wallet account index not found for "${walletName}"`);
        }

        const stateProof = await sdk.proofs.generate({
          proofType: StateProofType.CREATING,
          address: walletAddressStr,
        });

        if (!stateProof.proof || stateProof.proof.length === 0) {
          throw new Error(`Failed to get state proof for wallet "${walletName}"`);
        }

        const fullCreateInstr = encodeCreateInstruction({
          walletAccountIdx,
          authority: {
            tag: 1,
            pubkeyX: passkeyPublicKey.x,
            pubkeyY: passkeyPublicKey.y,
          },
          seed,
          stateProof: stateProof.proof,
        });

        const instructionData = concatenateInstructions([fullCreateInstr]);

        walletDebug('create instruction data', {
          fullCreateInstrLength: fullCreateInstr.length,
          stateProofLength: stateProof.proof.length,
          instructionDataLength: instructionData.length,
          instructionDataHex: bytesToHex(instructionData),
          firstByte: instructionData[0],
        });

        const { rawTransaction } = await sdk.transactions.buildAndSign({
          feePayer: {
            publicKey: feePayerPublicKey,
            privateKey: hexToBytes(MANAGER_PROFILE.privateKeyHex),
          },
          program: PASSKEY_MANAGER_PROGRAM_ADDRESS,
          header: { fee: 0n },
          accounts: { readWrite: readWriteAddresses, readOnly: [] },
          instructionData,
        });

        console.log('[AccountProvider] create account transaction payload', {
          rawTransactionLength: rawTransaction.length,
          rawTransactionHex: bytesToHex(rawTransaction),
          rawTransactionBase64: uint8ArrayToBase64(rawTransaction),
        });

        walletDebug('create raw transaction', {
          rawTransactionLength: rawTransaction.length,
          rawTransactionHex: bytesToHex(rawTransaction),
        });

        try {
          const parsed = Transaction.fromWire(rawTransaction);
          const parsedSignature = parsed.getSignature();
          if (parsedSignature) {
            rawSignature = parsedSignature.toThruFmt();
          }
          walletDebug('create transaction parsed', {
            instructionDataLength: parsed.instructionData?.length ?? 0,
            instructionDataHex: parsed.instructionData ? bytesToHex(parsed.instructionData) : 'none',
            firstByte: parsed.instructionData?.[0],
            signature: rawSignature ?? 'unknown',
          });
        } catch (err) {
          walletDebug('create transaction parse failed', err);
        }

        txSignature = await sdk.transactions.send(rawTransaction);

        let finalized = false;
        for await (const update of sdk.transactions.track(txSignature, { timeoutMs: 60000 })) {
          if (update.executionResult) {
            execution = update.executionResult;
          }

          if (
            update.executionResult ||
            update.statusCode === ConsensusStatus.FINALIZED ||
            update.statusCode === ConsensusStatus.CLUSTER_EXECUTED
          ) {
            finalized = true;
            break;
          }
        }

        const resolvedSignature = txSignature ?? rawSignature;
        if (!finalized) {
          throw new Error(
            `Account creation transaction was not finalized (${resolvedSignature ?? 'unknown'})`
          );
        }

        if (!execution) {
          throw new Error('Account creation failed: missing execution result');
        }

        const toBigInt = (value: bigint | number | string | undefined): bigint => {
          if (value === undefined) return 0n;
          if (typeof value === 'bigint') return value;
          if (typeof value === 'number') return BigInt(value);
          return BigInt(value);
        };

        const vmErrorCode = toBigInt(execution.vmError);
        const executionCode = toBigInt(execution.executionResult);
        const userErrorCode = toBigInt(execution.userErrorCode);

        if (vmErrorCode !== 0n || executionCode !== 0n || userErrorCode !== 0n) {
          throw new Error(
            `Account creation failed (vm_error=${vmErrorCode} execution_result=${executionCode} user_error_code=${userErrorCode})`
          );
        }

        await AccountStorage.saveAccount({
          index: nextIndex,
          label: accountLabel,
          publicKey: walletAddressStr,
          path: walletName,
          createdAt: new Date(),
          addressType: AddressType.THRU,
        });

        await loadAccounts();
        setSelectedAccountIndex(nextIndex);
        resetLockTimer();
        return {
          accountName: walletName,
          address: walletAddressStr,
          signature: resolvedSignature,
          vmError: execution?.vmError !== undefined ? String(execution.vmError) : null,
          userErrorCode: execution?.userErrorCode !== undefined ? execution.userErrorCode.toString() : null,
          executionResult:
            execution?.executionResult !== undefined ? execution.executionResult.toString() : null,
        };
      } catch (err) {
        return enrichCreateAccountError(err, {
          signature: txSignature ?? rawSignature,
          vmError: execution?.vmError ?? null,
          userErrorCode: execution?.userErrorCode ?? null,
        });
      } finally {
        setIsLoading(false);
      }
    },
    [accounts, isUnlocked, loadAccounts, passkeyPublicKey, resetLockTimer]
  );

  const renameAccount = useCallback(async (index: number, label: string): Promise<void> => {
    await WalletManager.renameAccount(index, label);
    setAccounts((prev) =>
      prev.map((acc) => (acc.index === index ? { ...acc, label } : acc))
    );
  }, []);

  const selectAccount = useCallback((index: number) => {
    setSelectedAccountIndex(index);
  }, []);

  const refreshBalances = useCallback(async (): Promise<void> => {
    if (accounts.length === 0) return;

    try {
      const publicKeys = accounts.map((a) => a.publicKey);
      await loadBalances(publicKeys);
    } catch (error) {
      console.error('Failed to refresh balances:', error);
    }
  }, [accounts, loadBalances]);

  const refreshAccounts = useCallback(async (): Promise<void> => {
    try {
      if (isEmbeddedContext() && embeddedAccountsRef.current.length > 0) {
        console.log('[AccountProvider] refreshAccounts using embedded snapshot', {
          count: embeddedAccountsRef.current.length,
        });
        setAccounts(embeddedAccountsRef.current);
        await loadBalances(embeddedAccountsRef.current.map((account) => account.publicKey));
        return;
      }
      await loadAccounts();
    } catch (error) {
      console.error('Failed to refresh accounts:', error);
    }
  }, [loadAccounts, loadBalances]);

  const value: AccountContextState = {
    accounts,
    balances,
    selectedAccountIndex,
    isLoading,
    createAccount,
    renameAccount,
    selectAccount,
    refreshBalances,
    refreshAccounts,
    loadAccounts,
    loadBalances,
    getEmbeddedAccountsSnapshot,
    setAccounts,
    embeddedAccountsRef,
  };

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}
