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
  const balanceSOL = Number(balance) / 1e9;

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 rounded-lg transition-colors ${
        isSelected
          ? 'bg-blue-100 border-2 border-blue-500'
          : 'bg-white border-2 border-gray-200 hover:border-gray-300'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-gray-900 truncate">{label}</div>
          <div className="text-xs text-gray-500 truncate">
            {publicKey.slice(0, 4)}...{publicKey.slice(-4)}
          </div>
        </div>
        <div className="ml-3 text-right">
          <div className="text-sm font-medium text-gray-900">
            {balanceSOL.toFixed(4)}
          </div>
          <div className="text-xs text-gray-500">SOL</div>
        </div>
      </div>
    </button>
  );
}
