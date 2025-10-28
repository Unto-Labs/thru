'use client';

import { useAccounts, useWallet } from '@thru/react-sdk';
import type { CSSProperties } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Logo from '../static/logomark_red.svg';

const containerStyle: CSSProperties = {
    display: 'flex',
    justifyContent: 'flex-end',
    width: 'auto',
    position: 'relative',
    cursor: 'pointer'
};

const dropdownStyle: CSSProperties = {
    position: 'absolute',
    top: 'calc(100% + 8px)',
    right: 0,
    minWidth: 220,
    backgroundColor: '#0f172a',
    borderRadius: 0,
    border: '1px solid rgba(148, 163, 184, 0.2)',
    boxShadow: '0 20px 40px rgba(15, 23, 42, 0.45)',
    padding: '8px 0',
};

const itemStyle: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '10px 16px',
    cursor: 'pointer',
    color: '#e2e8f0',
    fontSize: 14,
};

const iconWrapperStyle: CSSProperties = {
    width: 32,
    height: 32,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#'
};

function formatAddress(address: string | undefined): string {
    if (!address) return 'Unknown';
    if (address.length <= 8) return address;
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
}

export function ThruAccountSwitcher() {
    const { connect, isConnected, isConnecting, selectAccount } = useWallet();
    const { accounts, selectedAccount } = useAccounts();
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement | null>(null);

    const hasAccounts = accounts.length > 0;
    const displayLabel = useMemo(() => {
        if (isConnecting) return 'Connecting...';
        if (!isConnected || !hasAccounts) return 'Connect';
        return formatAddress(selectedAccount?.address ?? accounts[0]?.address);
    }, [isConnecting, isConnected, hasAccounts, selectedAccount, accounts]);

    useEffect(() => {
        if (!isOpen) {
            return;
        }

        const handleClickOutside = (event: MouseEvent) => {
            if (!containerRef.current) return;
            if (!containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    useEffect(() => {
        if (!isConnected) {
            setIsOpen(false);
        }
    }, [isConnected]);

    const handleToggle = useCallback(async () => {
        if (isConnecting) {
            return;
        }

        if (!isConnected) {
            try {
                await connect();
            } catch (error) {
                console.error('[WalletLauncher] Failed to connect wallet:', error);
            }
            return;
        }

        setIsOpen((prev) => !prev);
    }, [connect, isConnected, isConnecting]);

    const handleSelectAccount = useCallback(
        async (account: (typeof accounts)[number]) => {
            try {
                await selectAccount(account);
            } catch (error) {
                console.error('[ThruAccountSwitcher] Failed to select account:', error);
            } finally {
                setIsOpen(false);
            }
        },
        [selectAccount]
    );

    const buttonStyle: CSSProperties = useMemo(() => {
        const connected = isConnected && hasAccounts;
        return {
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 16px',
            borderRadius: 0,
            backgroundColor: connected ? '#0f172a' : '#1f2937',
            color: connected ? '#f8fafc' : '#9ca3af',
            cursor: isConnecting ? 'wait' : 'pointer',
            userSelect: 'none',
            minWidth: 220,
            border: isOpen ? '1px solid #3b82f6' : '1px solid rgba(148, 163, 184, 0.2)',
            boxShadow: '0 12px 30px rgba(15, 23, 42, 0.35)',
            transition: 'border 120ms ease, box-shadow 120ms ease, background-color 120ms ease',
            opacity: connected ? 1 : 0.85,
        } satisfies CSSProperties;
    }, [hasAccounts, isConnected, isConnecting, isOpen]);

    const caretStyle: CSSProperties = useMemo(
        () => ({
            marginLeft: 'auto',
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 120ms ease',
            color: isConnected && hasAccounts ? '#f8fafc' : '#9ca3af',
            fontSize: 12,
        }),
        [hasAccounts, isConnected, isOpen]
    );

    return (
        <div ref={containerRef} style={containerStyle}>
            <div style={buttonStyle} onClick={handleToggle} role="button" aria-haspopup="listbox" aria-expanded={isOpen}>
                <span style={iconWrapperStyle}>
                    <Logo width={'100%'} height={'100%'} />
                </span>
                <span style={{ fontWeight: 600 }}>{displayLabel}</span>
                <span style={caretStyle}>▼</span>
            </div>
            {isOpen && isConnected && hasAccounts ? (
                <div style={dropdownStyle} role="listbox">
                    {accounts.map((account) => {
                        const isSelected =
                            selectedAccount?.address === account.address && selectedAccount?.accountType === account.accountType;
                        return (
                            <div
                                key={`${account.accountType}:${account.address}`}
                                role="option"
                                aria-selected={isSelected}
                                style={{
                                    ...itemStyle,
                                    backgroundColor: isSelected ? 'rgba(59, 130, 246, 0.15)' : 'transparent',
                                    color: isSelected ? '#f8fafc' : '#e2e8f0',
                                }}
                                onClick={() => handleSelectAccount(account)}
                            >
                                <span style={{ ...iconWrapperStyle, width: 28, height: 28 }}>
                                    <Logo width={16} height={16} />
                                </span>
                                <span style={{ fontFamily: 'monospace' }}>{formatAddress(account.address)}</span>
                            </div>
                        );
                    })}
                </div>
            ) : null}
        </div>
    );
}
