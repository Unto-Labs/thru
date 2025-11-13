import { DerivedAccount } from '@/types/account';
import { Body3, Body4, Button } from '@thru/design-system';
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
      <div className="mb-6">
        <Button
          onClick={onCreateAccount}
          disabled={isCreating}
          variant="primary"
          size="md"
          className="w-full"
        >
          {isCreating ? 'Creating...' : '+ Create Account'}
        </Button>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto">
        {accounts.length === 0 ? (
          <div className="text-center py-8">
            <Body3 className="text-text-tertiary">No accounts yet</Body3>
            <Body4 className="text-text-tertiary mt-1">Click "Create Account" to get started</Body4>
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
