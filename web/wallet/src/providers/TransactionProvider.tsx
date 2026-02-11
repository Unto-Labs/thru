'use client';

import { walletDebug, formatU64Hex, toSignedU64, base64ToUint8Array, uint8ArrayToBase64 } from '@/lib/wallet/utils';
import { useSession } from '@/providers/SessionProvider';
import { usePasskeyAuth } from '@/providers/PasskeyAuthProvider';
import { useAccounts } from '@/providers/AccountProvider';
import { MANAGER_PROFILE } from '@/lib/fee-payer';
import { resolveThruRpcBaseUrl } from '@/lib/thru-rpc';
import { bytesToHex, hexToBytes, signWithPasskey } from '@thru/passkey';
import { decodeAddress, encodeAddress } from '@thru/helpers';
import {
  ConsensusStatus,
  SignatureDomain,
  signWithDomain,
  Transaction,
  type TransactionExecutionResultData,
} from '@thru/thru-sdk';
import { createThruClient } from '@thru/thru-sdk/client';
import { updatePasskeyLastUsed } from '@thru/wallet-store';
import {
  concatenateInstructions,
  createValidateChallenge,
  encodeTransferInstruction,
  encodeValidateInstruction,
  buildPasskeyReadWriteAccounts,
  fetchWalletNonce,
  PASSKEY_MANAGER_PROGRAM_ADDRESS,
} from '@thru/passkey-manager';
import React, { createContext, useCallback, useContext, useState } from 'react';

export interface TransactionContextState {
  isTransactionLoading: boolean;
  sendTransfer: (to: string, amount: bigint) => Promise<{
    signature: string | null;
    vmError: string | null;
    userErrorCode: number | null;
    executionResult: string | null;
  }>;
  signSerializedTransaction: (serializedTransaction: string) => Promise<string>;
}

export const TransactionContext = createContext<TransactionContextState | null>(null);

export function useTransactions(): TransactionContextState {
  const context = useContext(TransactionContext);
  if (!context) {
    throw new Error('useTransactions must be used within TransactionProvider');
  }
  return context;
}

export function TransactionProvider({ children }: { children: React.ReactNode }) {
  const { isUnlocked, resetLockTimer } = useSession();
  const { currentPasskey, passkeyStore, applyPasskeyStoreUpdate } = usePasskeyAuth();
  const { accounts, selectedAccountIndex } = useAccounts();
  const [isTransactionLoading, setIsTransactionLoading] = useState(false);

  const sendTransfer = useCallback(
    async (
      to: string,
      amount: bigint
    ): Promise<{
      signature: string | null;
      vmError: string | null;
      userErrorCode: number | null;
      executionResult: string | null;
    }> => {
      if (!isUnlocked) {
        throw new Error('Wallet is locked');
      }

      if (!currentPasskey) {
        throw new Error('No passkey registered for this profile');
      }

      const selectedAccount = accounts.find((acc) => acc.index === selectedAccountIndex);
      if (!selectedAccount) {
        throw new Error('No account selected');
      }

      const trimmedTo = to.trim();
      if (!trimmedTo) {
        throw new Error('Destination address is required');
      }

      if (amount < 0n) {
        throw new Error('Amount cannot be negative');
      }

      setIsTransactionLoading(true);
      try {
        const sdk = createThruClient({ baseUrl: resolveThruRpcBaseUrl() });
        const feePayerPublicKey = decodeAddress(MANAGER_PROFILE.address);
        const programAddress = decodeAddress(PASSKEY_MANAGER_PROGRAM_ADDRESS);

        const walletAddress = decodeAddress(selectedAccount.publicKey);
        const toAddressBytes = decodeAddress(trimmedTo);

        const { readWriteAddresses, findAccountIndex } = buildPasskeyReadWriteAccounts(
          [walletAddress, toAddressBytes],
          feePayerPublicKey,
          programAddress
        );

        const walletAccountIdx = findAccountIndex(walletAddress);
        if (walletAccountIdx < 2) {
          throw new Error(`Wallet account not found for "${selectedAccount.path || 'account'}"`);
        }

        const toIdx = findAccountIndex(toAddressBytes);
        if (toIdx < 0) {
          throw new Error(`Destination account not found for ${trimmedTo}`);
        }
        if (toIdx === 1) {
          throw new Error(`Destination account cannot be the program address: ${trimmedTo}`);
        }

        walletDebug('transfer account list', {
          feePayer: encodeAddress(feePayerPublicKey),
          program: PASSKEY_MANAGER_PROGRAM_ADDRESS,
          readWriteAddresses,
          walletAccountIdx,
          toIdx,
        });

        const transferInstruction = encodeTransferInstruction({
          walletAccountIdx,
          toAccountIdx: toIdx,
          amount,
        });

        const currentNonce = await fetchWalletNonce(sdk, encodeAddress(walletAddress));

        const accountAddressesTa = [
          encodeAddress(feePayerPublicKey),
          encodeAddress(programAddress),
          ...readWriteAddresses,
        ];
        const trailingInstructionData = concatenateInstructions([transferInstruction]);
        const challenge = await createValidateChallenge(
          currentNonce,
          accountAddressesTa,
          trailingInstructionData
        );

        walletDebug('transfer challenge', {
          nonce: currentNonce.toString(),
          challengeHex: bytesToHex(challenge),
          accountAddressesTa,
          transferTag: transferInstruction[0],
          transferInstructionLength: transferInstruction.length,
        });

        const passkeyResult = await signWithPasskey(
          currentPasskey.credentialId,
          challenge,
          currentPasskey.rpId
        );

        const validateInstruction = encodeValidateInstruction({
          walletAccountIdx,
          authIdx: 0,
          signatureR: passkeyResult.signatureR,
          signatureS: passkeyResult.signatureS,
          authenticatorData: passkeyResult.authenticatorData,
          clientDataJSON: passkeyResult.clientDataJSON,
        });

        const instructionData = concatenateInstructions([validateInstruction, transferInstruction]);

        walletDebug('transfer instructions', {
          validateTag: validateInstruction[0],
          validateInstructionLength: validateInstruction.length,
          instructionDataLength: instructionData.length,
        });
        walletDebug('transfer instruction bytes', {
          validateInstructionHex: bytesToHex(validateInstruction),
          transferInstructionHex: bytesToHex(transferInstruction),
          instructionDataHex: bytesToHex(instructionData),
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

        try {
          const parsed = Transaction.fromWire(rawTransaction);
          walletDebug('transfer transaction accounts', {
            feePayer: parsed.feePayer.toThruFmt(),
            program: parsed.program.toThruFmt(),
            readWrite: parsed.readWriteAccounts.map((account) => account.toThruFmt()),
            readOnly: parsed.readOnlyAccounts.map((account) => account.toThruFmt()),
            instructionDataLength: parsed.instructionData?.length ?? 0,
          });
        } catch (err) {
          walletDebug('transfer transaction parse failed', err);
        }

        let finalized = false;
        let txSignature: string | null = null;
        let execution: TransactionExecutionResultData | null = null;

        txSignature = await sdk.transactions.send(rawTransaction);

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

        if (!finalized) {
          throw new Error(`Transfer transaction was not finalized (${txSignature ?? 'unknown'})`);
        }

        if (execution?.userErrorCode !== undefined) {
          const rawCode =
            typeof execution.userErrorCode === 'bigint'
              ? execution.userErrorCode
              : BigInt(execution.userErrorCode);
          walletDebug('transfer execution result', {
            vmError: execution?.vmError ?? null,
            executionResult: execution?.executionResult ?? null,
            userErrorCode: rawCode.toString(),
            userErrorCodeHex: formatU64Hex(rawCode),
            userErrorCodeSigned: toSignedU64(rawCode).toString(),
          });
        }

        if (passkeyStore) {
          const updated = updatePasskeyLastUsed(passkeyStore, passkeyStore.selectedIndex);
          applyPasskeyStoreUpdate(updated, currentPasskey);
        }

        resetLockTimer();
        return {
          signature: txSignature,
          vmError: execution?.vmError !== undefined ? String(execution.vmError) : null,
          userErrorCode: execution?.userErrorCode !== undefined ? Number(execution.userErrorCode) : null,
          executionResult:
            execution?.executionResult !== undefined ? execution.executionResult.toString() : null,
        };
      } finally {
        setIsTransactionLoading(false);
      }
    },
    [
      accounts,
      applyPasskeyStoreUpdate,
      currentPasskey,
      isUnlocked,
      passkeyStore,
      resetLockTimer,
      selectedAccountIndex,
    ]
  );

  const signSerializedTransaction = useCallback(
    async (serializedTransaction: string): Promise<string> => {
      if (!isUnlocked) {
        throw new Error('Wallet is locked');
      }

      if (!serializedTransaction) {
        throw new Error('Missing serialized transaction payload');
      }

      const payloadBytes = base64ToUint8Array(serializedTransaction);
      const signature = await signWithDomain(
        payloadBytes,
        hexToBytes(MANAGER_PROFILE.privateKeyHex),
        hexToBytes(MANAGER_PROFILE.publicKeyHex),
        SignatureDomain.TXN
      );

      const result = new Uint8Array(signature.length + payloadBytes.length);
      result.set(signature, 0);
      result.set(payloadBytes, signature.length);

      resetLockTimer();
      return uint8ArrayToBase64(result);
    },
    [isUnlocked, resetLockTimer]
  );

  const value: TransactionContextState = {
    isTransactionLoading,
    sendTransfer,
    signSerializedTransaction,
  };

  return <TransactionContext.Provider value={value}>{children}</TransactionContext.Provider>;
}
