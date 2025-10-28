import { DerivedAccount } from '@/types/account';
import { AccountListItem } from './AccountListItem';

interface AccountListProps {
  accounts: DerivedAccount[];
  balances: Map<number, bigint>;
  selectedIndex: number;
  onSelectAccount: (index: number) => void;
  onCreateAccount: () => void;
  isCreating: boolean;
}

export function AccountList({
  accounts,
  balances,
  selectedIndex,
  onSelectAccount,
  onCreateAccount,
  isCreating,
}: AccountListProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="mb-4">
        <button
          onClick={onCreateAccount}
          disabled={isCreating}
          className="w-full px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors font-medium"
        >
          {isCreating ? 'Creating...' : '+ Create Account'}
        </button>
      </div>

      <div className="flex-1 space-y-2 overflow-y-auto">
        {accounts.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <p>No accounts yet</p>
            <p className="text-sm">Click "Create Account" to get started</p>
          </div>
        ) : (
          accounts.map((account) => (
            <AccountListItem
              key={account.index}
              label={account.label}
              publicKey={account.publicKey}
              balance={balances.get(account.index) || 0n}
              isSelected={account.index === selectedIndex}
              onClick={() => onSelectAccount(account.index)}
            />
          ))
        )}
      </div>
    </div>
  );
}
