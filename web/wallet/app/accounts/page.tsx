'use client';

import { AccountDetails } from '@/components/wallet/AccountDetails';
import { AccountList } from '@/components/wallet/AccountList';
import { useConnectedApps } from '@/hooks/useConnectedApps';
import { useWallet } from '@/hooks/useWallet';
import { Body4, Body5, Button, Card, Heading5, Input } from '@thru/design-system';
import { ConnectError } from '@connectrpc/connect';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

const formatCreateAccountError = (err: unknown): string => {
  const connectError = err instanceof ConnectError ? err : null;
  const rawMessage = connectError?.rawMessage ?? connectError?.message;
  const errorContext = err && typeof err === 'object' ? (err as Record<string, unknown>) : null;
  const vmError = errorContext?.vmError ?? null;
  const signature = errorContext?.txSignature ?? null;
  const userErrorCode = errorContext?.userErrorCode ?? null;
  const formatValue = (value: unknown): string => (value == null ? 'Unavailable' : String(value));
  if (rawMessage && rawMessage.toLowerCase().startsWith('transaction rejected')) {
    const base = rawMessage.split(':')[0].trim();
    const sentence = base.endsWith('.') ? base : `${base}.`;
    return `${sentence}\nVM error: ${formatValue(vmError)}\nSignature: ${formatValue(signature)}\nUser error: ${formatValue(userErrorCode)}`;
  }

  if (err instanceof Error) {
    return err.message;
  }

  return 'Failed to create account';
};

export default function AccountsPage() {
  const router = useRouter();
  const {
    isInitialized,
    isUnlocked,
    accounts,
    balances,
    selectedAccountIndex,
    selectAccount,
    createAccount,
    renameAccount,
    lockWallet,
    sendTransfer,
    isLoading,
  } = useWallet();
  const {
    connectedApps,
    isLoading: isConnectedAppsLoading,
    refreshConnectedApps,
    revokeConnectedApp,
  } = useConnectedApps();

  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isRefreshingApps, setIsRefreshingApps] = useState(false);
  const [revokingAppId, setRevokingAppId] = useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newAccountName, setNewAccountName] = useState('');
  const [createResult, setCreateResult] = useState<{
    accountName: string;
    address: string;
    signature: string | null;
    vmError: string | null;
    userErrorCode: string | null;
    executionResult: string | null;
  } | null>(null);
  const [isTransferModalOpen, setIsTransferModalOpen] = useState(false);
  const [transferToAddress, setTransferToAddress] = useState('');
  const [transferAmount, setTransferAmount] = useState('');
  const [isSendingTransfer, setIsSendingTransfer] = useState(false);
  const [transferError, setTransferError] = useState('');
  const [transferResult, setTransferResult] = useState<{
    signature: string | null;
    vmError: string | null;
    userErrorCode: number | null;
    executionResult: string | null;
  } | null>(null);

  // Redirect to home if wallet is locked (but only after initialization)
  useEffect(() => {
    if (isInitialized && !isUnlocked) {
      router.push('/');
    }
  }, [isInitialized, isUnlocked, router]);

  useEffect(() => {
    if (!isUnlocked) {
      return;
    }
    refreshConnectedApps().catch((err) => {
      console.error('Failed to refresh connected apps:', err);
      setError((prev) => prev || 'Failed to refresh connected apps');
    });
  }, [isUnlocked, selectedAccountIndex, refreshConnectedApps]);

  const handleRefreshConnectedApps = async () => {
    setIsRefreshingApps(true);
    try {
      await refreshConnectedApps();
    } catch (err) {
      console.error('Failed to refresh connected apps:', err);
      setError('Failed to refresh connected apps');
    } finally {
      setIsRefreshingApps(false);
    }
  };

  const handleCreateAccount = () => {
    setError('');
    setNewAccountName('');
    setCreateResult(null);
    setIsCreateModalOpen(true);
  };

  const closeCreateModal = () => {
    setIsCreateModalOpen(false);
    setNewAccountName('');
    setCreateResult(null);
    setError('');
  };

  const openTransferModal = () => {
    setTransferToAddress('');
    setTransferAmount('');
    setTransferError('');
    setTransferResult(null);
    setIsTransferModalOpen(true);
  };

  const closeTransferModal = () => {
    setIsTransferModalOpen(false);
    setTransferToAddress('');
    setTransferAmount('');
    setTransferError('');
    setTransferResult(null);
  };

  const handleConfirmCreateAccount = async () => {
    setIsCreating(true);
    setError('');

    try {
      const result = await createAccount(newAccountName);
      setCreateResult(result);
    } catch (err) {
      console.error('Error creating account:', err);
      setError(formatCreateAccountError(err));
    } finally {
      setIsCreating(false);
    }
  };

  const handleSendTransfer = async () => {
    setIsSendingTransfer(true);
    setTransferError('');

    try {
      const amountValue = transferAmount.trim();
      if (!amountValue) {
        throw new Error('Amount is required');
      }

      let amount: bigint;
      try {
        amount = BigInt(amountValue);
      } catch {
        throw new Error('Amount must be a whole number');
      }

      const result = await sendTransfer(transferToAddress.trim(), amount);
      setTransferResult(result);
    } catch (err) {
      console.error('Error sending transfer:', err);
      setTransferError(err instanceof Error ? err.message : 'Failed to send transfer');
    } finally {
      setIsSendingTransfer(false);
    }
  };

  const handleRenameAccount = async (newLabel: string) => {
    try {
      await renameAccount(selectedAccountIndex, newLabel);
      setSuccessMessage('Account renamed successfully!');
      setTimeout(() => setSuccessMessage(''), 3000);
    } catch (err) {
      console.error('Error renaming account:', err);
      setError('Failed to rename account');
    }
  };

  const handleLock = () => {
    lockWallet();
    router.push('/');
  };

  const formatTimestamp = (timestamp: number) =>
    new Date(timestamp).toLocaleString(undefined, {
      hour12: true,
      hour: '2-digit',
      minute: '2-digit',
      month: 'short',
      day: '2-digit',
    });

  const formatExecValue = (value: string | number | bigint | null | undefined, fallback: string) =>
    value == null ? fallback : value.toString();

  const handleRevokeConnectedApp = async (appId: string, appName: string) => {
    setRevokingAppId(appId);
    setError('');
    setSuccessMessage('');
    try {
      await revokeConnectedApp(appId);
      setSuccessMessage(`${appName} disconnected`);
    } catch (err) {
      console.error('Failed to revoke connected app:', err);
      setError('Failed to disconnect app');
    } finally {
      setRevokingAppId(null);
    }
  };

  // Show loading state while initializing
  if (isLoading || !isUnlocked) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-surface-higher">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-border-tertiary border-t-border-brand" />
      </main>
    );
  }

  const selectedAccount = accounts.find((a) => a.index === selectedAccountIndex) || null;
  const selectedBalance = balances.get(selectedAccountIndex) || 0n;

  return (
    <main className="min-h-screen bg-surface-higher p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <img 
              src="/logo/logo-wordmark_solid_red.svg" 
              alt="Thru" 
              className="h-10"
            />
          </div>
          <Button
            onClick={handleLock}
            variant="ghost"
            size="sm"
          >
            Lock Wallet
          </Button>
        </div>

        {/* Success/Error Messages */}
        {successMessage && (
          <div className="mb-8 bg-surface-higher border border-border-tertiary p-4">
            <Body4 className="text-text-primary">✓ {successMessage}</Body4>
          </div>
        )}

        {error && (
          <div className="mb-8 bg-surface-higher border border-border-brand p-4">
            <Body4 className="text-text-primary whitespace-pre-line break-all">{error}</Body4>
          </div>
        )}

        {/* Main Content - Split Layout */}
        <div className="grid md:grid-cols-3 gap-8">
          {/* Left Side - Account List */}
          <div className="md:col-span-1">
            <Card variant="default" className="h-[calc(100vh-200px)] overflow-hidden flex flex-col">
              <AccountList
                accounts={accounts}
                balances={balances}
                selectedIndex={selectedAccountIndex}
                onSelectAccount={selectAccount}
                onCreateAccount={handleCreateAccount}
                isCreating={isCreating}
              />
            </Card>
          </div>

          {/* Right Side - Account Details */}
          <div className="md:col-span-2">
            <div className="h-[calc(100vh-200px)] overflow-y-auto">
              <AccountDetails
                account={selectedAccount}
                balance={selectedBalance}
                onRename={handleRenameAccount}
                onSendTransfer={openTransferModal}
              />
            </div>
          </div>
        </div>

        {/* Connected Apps */}
        <Card variant="default" className="mt-8">
          <div className="flex items-center justify-between mb-4">
            <Heading5 className="text-text-primary" bold>Connected dApps</Heading5>
            <Button
              onClick={handleRefreshConnectedApps}
              disabled={isRefreshingApps || isConnectedAppsLoading}
              variant="outline"
              size="sm"
            >
              {isRefreshingApps || isConnectedAppsLoading ? 'Refreshing…' : 'Refresh'}
            </Button>
          </div>

          {isConnectedAppsLoading && connectedApps.length === 0 ? (
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-full border-2 border-border-tertiary border-t-border-brand animate-spin" />
              <Body4 className="text-text-tertiary">Loading connected apps…</Body4>
            </div>
          ) : connectedApps.length === 0 ? (
            <Body4 className="text-text-tertiary">
              No dApps have been connected to this account yet.
            </Body4>
          ) : (
            <ul className="divide-y divide-border-tertiary">
              {connectedApps.map((app) => (
                <li key={`${app.accountId}:${app.appId}`} className="py-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-lower border-2 border-border-tertiary text-text-primary text-body-s font-semibold overflow-hidden flex-shrink-0">
                      {app.metadata.imageUrl ? (
                        <img
                          src={app.metadata.imageUrl}
                          alt={app.metadata.appName}
                          className="h-full w-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <span>{app.metadata.appName.charAt(0).toUpperCase()}</span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <Body4 className="text-text-primary truncate" bold>
                        {app.metadata.appName}
                      </Body4>
                      <Body5 className="text-text-secondary truncate">
                        {app.metadata.appUrl || app.origin}
                      </Body5>
                      <Body5 className="text-text-tertiary mt-0.5">
                        Connected {formatTimestamp(app.connectedAt)}
                      </Body5>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button
                      onClick={() => handleRevokeConnectedApp(app.appId, app.metadata.appName)}
                      disabled={revokingAppId === app.appId}
                      variant="outline"
                      size="sm"
                      className="text-text-brand border-border-brand hover:bg-surface-brick hover:text-text-primary-inverse"
                    >
                      {revokingAppId === app.appId ? 'Removing…' : 'Remove'}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {isCreateModalOpen && (
        <div className="fixed inset-0 z-[999999] flex items-center justify-center p-4 bg-steel-800/30">
          <Card variant="elevated" className="max-w-md w-full">
            <div className="flex items-center justify-between mb-6">
              <Heading5 className="text-text-primary" bold>Create Account</Heading5>
              <Button
                onClick={closeCreateModal}
                variant="ghost"
                size="sm"
                disabled={isCreating}
                className="p-2"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </Button>
            </div>

            {createResult ? (
              <Body4 className="text-text-secondary mb-6">
                CREATE instruction finalized. Details are shown below.
              </Body4>
            ) : (
              <Body4 className="text-text-secondary mb-6">
                Choose a name for this account. This name is used to derive the account address and cannot be changed.
              </Body4>
            )}

            {createResult ? (
              <div className="mb-6 space-y-4">
                <div>
                  <Body5 className="text-text-tertiary mb-2">Result</Body5>
                  <Body4 className="text-text-primary">Finalized</Body4>
                </div>
                <div>
                  <Body5 className="text-text-tertiary mb-2">Account Name</Body5>
                  <Body4 className="text-text-primary font-mono break-all">
                    {createResult.accountName}
                  </Body4>
                </div>
                <div>
                  <Body5 className="text-text-tertiary mb-2">Address</Body5>
                  <Body4 className="text-text-primary font-mono break-all">
                    {createResult.address}
                  </Body4>
                </div>
                <div>
                  <Body5 className="text-text-tertiary mb-2">Signature</Body5>
                  <Body4 className="text-text-primary font-mono break-all">
                    {createResult.signature ?? 'Unavailable'}
                  </Body4>
                </div>
                <div>
                  <Body5 className="text-text-tertiary mb-2">Execution Result</Body5>
                  <Body4 className="text-text-primary font-mono break-all">
                    {formatExecValue(createResult.executionResult, 'Unavailable')}
                  </Body4>
                </div>
                <div>
                  <Body5 className="text-text-tertiary mb-2">User Error</Body5>
                  <Body4 className="text-text-primary font-mono break-all">
                    {formatExecValue(createResult.userErrorCode, 'None')}
                  </Body4>
                </div>
                <div>
                  <Body5 className="text-text-tertiary mb-2">VM Error</Body5>
                  <Body4 className="text-text-primary font-mono break-all">
                    {formatExecValue(createResult.vmError, 'None')}
                  </Body4>
                </div>
              </div>
            ) : (
              <div className="mb-6">
                <Input
                  type="text"
                  label="Account Name"
                  value={newAccountName}
                  onChange={(e) => setNewAccountName(e.target.value)}
                  placeholder="e.g., Treasury"
                  disabled={isCreating}
                  autoFocus
                />
              </div>
            )}

            {error && (
              <div className="mb-4 p-4 bg-surface-brick border border-border-brand rounded-lg">
                <Body4 className="text-text-primary whitespace-pre-line break-all">{error}</Body4>
              </div>
            )}

            {createResult ? (
              <div className="mb-6">
                <Button
                  onClick={closeCreateModal}
                  variant="primary"
                  className="w-full"
                >
                  OK
                </Button>
              </div>
            ) : (
              <div className="flex gap-3 mb-6">
                <Button
                  onClick={closeCreateModal}
                  variant="outline"
                  disabled={isCreating}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleConfirmCreateAccount}
                  variant="primary"
                  disabled={isCreating || !newAccountName.trim()}
                  className="flex-1"
                >
                  {isCreating ? 'Creating...' : 'Create'}
                </Button>
              </div>
            )}
          </Card>
        </div>
      )}

      {isTransferModalOpen && (
        <div className="fixed inset-0 z-[999999] flex items-center justify-center p-4 bg-steel-800/30">
          <Card variant="elevated" className="max-w-md w-full">
            <div className="flex items-center justify-between mb-6">
              <Heading5 className="text-text-primary" bold>Send Transfer</Heading5>
              <Button
                onClick={closeTransferModal}
                variant="ghost"
                size="sm"
                disabled={isSendingTransfer}
                className="p-2"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </Button>
            </div>

            {transferResult ? (
              <Body4 className="text-text-secondary mb-6">
                Transfer finalized. Details are shown below.
              </Body4>
            ) : (
              <Body4 className="text-text-secondary mb-6">
                Enter the destination address and amount to transfer from this account.
              </Body4>
            )}

            {transferResult ? (
              <div className="mb-6 space-y-4">
                <div>
                  <Body5 className="text-text-tertiary mb-2">Result</Body5>
                  <Body4 className="text-text-primary">Finalized</Body4>
                </div>
                <div>
                  <Body5 className="text-text-tertiary mb-2">Signature</Body5>
                  <Body4 className="text-text-primary font-mono break-all">
                    {transferResult.signature ?? 'Unavailable'}
                  </Body4>
                </div>
                <div>
                  <Body5 className="text-text-tertiary mb-2">Execution Result</Body5>
                  <Body4 className="text-text-primary font-mono break-all">
                    {formatExecValue(transferResult.executionResult, 'Unavailable')}
                  </Body4>
                </div>
                <div>
                  <Body5 className="text-text-tertiary mb-2">User Error</Body5>
                  <Body4 className="text-text-primary font-mono break-all">
                    {formatExecValue(transferResult.userErrorCode, 'None')}
                  </Body4>
                </div>
                <div>
                  <Body5 className="text-text-tertiary mb-2">VM Error</Body5>
                  <Body4 className="text-text-primary font-mono break-all">
                    {formatExecValue(transferResult.vmError, 'None')}
                  </Body4>
                </div>
              </div>
            ) : (
              <div className="mb-6 space-y-4">
                <Input
                  type="text"
                  label="To Address"
                  value={transferToAddress}
                  onChange={(e) => setTransferToAddress(e.target.value)}
                  placeholder="ta..."
                  disabled={isSendingTransfer}
                  autoFocus
                />
                <Input
                  type="text"
                  label="Amount"
                  value={transferAmount}
                  onChange={(e) => setTransferAmount(e.target.value)}
                  placeholder="e.g., 1000000000"
                  disabled={isSendingTransfer}
                />
              </div>
            )}

            {transferError && (
              <div className="mb-4 p-4 bg-surface-brick border border-border-brand rounded-lg">
                <Body4 className="text-text-primary">{transferError}</Body4>
              </div>
            )}

            {transferResult ? (
              <div className="mb-6">
                <Button
                  onClick={closeTransferModal}
                  variant="primary"
                  className="w-full"
                >
                  OK
                </Button>
              </div>
            ) : (
              <div className="flex gap-3 mb-6">
                <Button
                  onClick={closeTransferModal}
                  variant="outline"
                  disabled={isSendingTransfer}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleSendTransfer}
                  variant="primary"
                  disabled={isSendingTransfer || !transferToAddress.trim() || !transferAmount.trim()}
                  className="flex-1"
                >
                  {isSendingTransfer ? 'Sending...' : 'Send'}
                </Button>
              </div>
            )}
          </Card>
        </div>
      )}
    </main>
  );
}
