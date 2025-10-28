'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@/hooks/useWallet';
import { useConnectedApps } from '@/hooks/useConnectedApps';
import { AccountList } from '@/components/wallet/AccountList';
import { AccountDetails } from '@/components/wallet/AccountDetails';

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
    sendTransfer,
    refreshBalances,
    lockWallet,
    isLoading,
  } = useWallet();
  const {
    connectedApps,
    isLoading: isConnectedAppsLoading,
    refreshConnectedApps,
    revokeConnectedApp,
  } = useConnectedApps();

  const [isSending, setIsSending] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [isRefreshingApps, setIsRefreshingApps] = useState(false);
  const [revokingAppId, setRevokingAppId] = useState<string | null>(null);

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

  const handleRefreshBalance = async () => {
    setIsRefreshing(true);
    try {
      await refreshBalances();
    } catch (err) {
      console.error('Failed to refresh balances:', err);
      setError('Failed to refresh balances');
    } finally {
      setIsRefreshing(false);
    }
  };

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

  const handleCreateAccount = async () => {
    setIsCreating(true);
    setError('');

    try {
      await createAccount();
      setSuccessMessage('Account created successfully!');
      setTimeout(() => setSuccessMessage(''), 3000);

      // Select the newly created account
      const newIndex = accounts.length;
      selectAccount(newIndex);
    } catch (err) {
      console.error('Error creating account:', err);
      setError(err instanceof Error ? err.message : 'Failed to create account');
    } finally {
      setIsCreating(false);
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

  const handleTransfer = async (to: string, amount: bigint) => {
    setIsSending(true);
    setError('');
    setSuccessMessage('');

    try {
      const signature = await sendTransfer(to, amount);
      setSuccessMessage(`Transaction sent! Signature: ${signature.slice(0, 8)}...`);
    } catch (err) {
      console.error('Transfer error:', err);
      setError(err instanceof Error ? err.message : 'Failed to send transaction');
    } finally {
      setIsSending(false);
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
      <main className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-gray-300 border-t-blue-600" />
      </main>
    );
  }

  const selectedAccount = accounts.find((a) => a.index === selectedAccountIndex) || null;
  const selectedBalance = balances.get(selectedAccountIndex) || 0n;

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-3xl font-bold">Thru Wallet</h1>
          <button
            onClick={handleLock}
            className="px-4 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg transition-colors text-sm"
          >
            Lock Wallet
          </button>
        </div>

        {/* Success/Error Messages */}
        {successMessage && (
          <div className="mb-6 bg-green-50 border-2 border-green-200 rounded-lg p-4">
            <p className="text-green-800 text-sm">✓ {successMessage}</p>
          </div>
        )}

        {error && (
          <div className="mb-6 bg-red-50 border-2 border-red-200 rounded-lg p-4">
            <p className="text-red-800 text-sm">{error}</p>
          </div>
        )}

        {/* Main Content - Split Layout */}
        <div className="grid md:grid-cols-3 gap-6">
          {/* Left Side - Account List */}
          <div className="md:col-span-1">
            <div className="bg-gray-100 border-2 border-gray-200 rounded-lg p-4 h-[calc(100vh-200px)] overflow-hidden">
              <AccountList
                accounts={accounts}
                balances={balances}
                selectedIndex={selectedAccountIndex}
                onSelectAccount={selectAccount}
                onCreateAccount={handleCreateAccount}
                isCreating={isCreating}
              />
            </div>
          </div>

          {/* Right Side - Account Details */}
          <div className="md:col-span-2">
            <div className="h-[calc(100vh-200px)] overflow-y-auto">
              <AccountDetails
                account={selectedAccount}
                balance={selectedBalance}
                isRefreshing={isRefreshing}
                onRefresh={handleRefreshBalance}
                onRename={handleRenameAccount}
                onTransfer={handleTransfer}
                isSending={isSending}
              />
            </div>
          </div>
        </div>

        {/* Connected Apps */}
        <div className="mt-6 bg-white border-2 border-gray-200 rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700">Connected dApps</h3>
            <button
              onClick={handleRefreshConnectedApps}
              disabled={isRefreshingApps || isConnectedAppsLoading}
              className="px-2 py-1 text-xs font-medium text-gray-600 border border-gray-300 rounded hover:bg-gray-100 disabled:opacity-50"
            >
              {isRefreshingApps || isConnectedAppsLoading ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>

          {isConnectedAppsLoading && connectedApps.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <div className="w-4 h-4 rounded-full border-2 border-gray-300 border-t-indigo-500 animate-spin" />
              <span>Loading connected apps…</span>
            </div>
          ) : connectedApps.length === 0 ? (
            <p className="text-sm text-gray-500">
              No dApps have been connected to this account yet.
            </p>
          ) : (
            <ul className="divide-y divide-gray-200">
              {connectedApps.map((app) => (
                <li key={`${app.accountId}:${app.appId}`} className="py-3 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-100 text-indigo-700 text-sm font-semibold overflow-hidden">
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
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">
                        {app.metadata.appName}
                      </p>
                      <p className="text-xs text-gray-500 truncate">
                        {app.metadata.appUrl || app.origin}
                      </p>
                      <p className="text-xs text-gray-400">
                        Connected {formatTimestamp(app.connectedAt)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleRevokeConnectedApp(app.appId, app.metadata.appName)}
                      disabled={revokingAppId === app.appId}
                      className="px-3 py-1 text-xs font-medium text-red-600 border border-red-200 rounded hover:bg-red-50 disabled:opacity-50"
                    >
                      {revokingAppId === app.appId ? 'Removing…' : 'Remove'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Network Info */}
        <div className="mt-6 bg-white border-2 border-gray-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Network</h3>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-sm text-gray-600">Localnet (http://127.0.0.1:8899)</span>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Make sure you have a Solana test validator running locally
          </p>
        </div>
      </div>
    </main>
  );
}
