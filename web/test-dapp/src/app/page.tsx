"use client";

import { useAccounts, useWallet, WalletAccount } from "@thru/react-sdk";
import { ThruAccountSwitcher } from "@thru/react-ui";
import { useState } from "react";

export default function Home() {
  const { wallet, isConnected, accounts } = useWallet();
  const [selectedAccount, setSelectedAccount] = useState<WalletAccount | null>(null);

  useAccounts({
    onAccountSelect: (account) => {
      setSelectedAccount(account)
    }
  })

  return (
    <>
      <div style={{ position: 'fixed', top: 20, right: 20, zIndex: 999 }}>
        <ThruAccountSwitcher />
      </div>
      <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="w-full max-w-xl rounded-3xl bg-slate-900 shadow-2xl shadow-slate-900/30 border border-slate-800">
          <header className="border-b border-slate-800 px-8 py-6">
            <h1 className="text-2xl font-semibold tracking-tight">Thru Wallet Playground</h1>
            <p className="mt-2 text-sm text-slate-400">
              Connect with the Thru iframe wallet and inspect connected addresses. Transaction helpers
              will be added in a future milestone.
            </p>
          </header>

          <section className="px-8 py-6 space-y-6">
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">
                Connection
              </h2>
              <p className="mt-2 text-sm text-slate-400">
                Status:{" "}
                <span className={isConnected ? "text-emerald-400" : "text-rose-400"}>
                  {isConnected ? "Connected" : "Disconnected"}
                </span>
              </p>
              <p className="text-sm text-slate-400">
                Thru signer available:{" "}
                <span className={isConnected && wallet ? "text-emerald-400" : "text-rose-400"}>
                  {isConnected && wallet ? "Yes" : "No"}
                </span>
              </p>

              <p className="text-sm text-slate-400">
                Selected Account:{" "}
                <span className={isConnected && wallet ? "text-emerald-400" : "text-rose-400"}>
                  {selectedAccount ? selectedAccount.address : null}
                </span>
              </p>



            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">
                Connected Addresses
              </h2>
              {accounts.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">
                  No addresses yet. Connect the Thru wallet to populate this list.
                </p>
              ) : (
                <ul className="mt-3 space-y-2 font-mono text-xs text-slate-300">
                  {accounts.map((account) => (
                    <li
                      key={account.address}
                      className="rounded-lg border border-slate-800 bg-slate-900/80 px-3 py-2"
                    >
                      {account.address}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-4 text-sm text-amber-200">
              Transaction signing examples will be added once the Thru transfer builder is available.
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
