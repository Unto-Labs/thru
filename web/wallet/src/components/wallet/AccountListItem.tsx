import { Body4, Body5, Ui5 } from '@thru/design-system';

interface AccountListItemProps {
  label: string;
  publicKey: string;
  balance: bigint;
  isSelected: boolean;
  onClick: () => void;
}

export function AccountListItem({
  label,
  publicKey,
  balance,
  isSelected,
  onClick,
}: AccountListItemProps) {
  const balanceThru = Number(balance) / 1e9;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-5 py-4 transition-all cursor-pointer ${
        isSelected
          ? 'bg-surface-higher border border-border-primary'
          : 'bg-surface-higher border border-border-tertiary hover:border-border-secondary hover:bg-surface-lower'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <Body4 className={`truncate ${isSelected ? 'text-text-primary' : 'text-text-secondary'}`} bold>
            {label}
          </Body4>
          <Ui5 className="text-text-tertiary truncate mt-0.5">
            {publicKey.slice(0, 6)}...{publicKey.slice(-6)}
          </Ui5>
        </div>
        <div className="ml-2 text-right flex-shrink-0">
          <Body4 className={isSelected ? 'text-text-primary' : 'text-text-secondary'} bold>
            {balanceThru.toFixed(4)}
          </Body4>
          <Body5 className="text-text-tertiary">THRU</Body5>
        </div>
      </div>
    </button>
  );
}
