'use client';

import { AccountDetails } from '@/components/wallet/AccountDetails';
import { AccountList } from '@/components/wallet/AccountList';
import { useConnectedApps } from '@/hooks/useConnectedApps';
import { useWallet } from '@/hooks/useWallet';
import { Body4, Body5, Button, Card, Heading5 } from '@thru/design-system';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

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
            <Body4 className="text-text-primary">{error}</Body4>
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
    </main>
  );
}
