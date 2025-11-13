import { DerivedAccount } from '@/types/account';
import { Body3, Body4, Button, Card, Heading4, Heading5, Input } from '@thru/design-system';
import { useState } from 'react';

interface AccountDetailsProps {
  account: DerivedAccount | null;
  balance: bigint;
  onRename: (newLabel: string) => void;
}

export function AccountDetails({
  account,
  balance,
  onRename,
}: AccountDetailsProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editLabel, setEditLabel] = useState('');
  const [copiedAddress, setCopiedAddress] = useState(false);

  if (!account) {
    return (
      <div className="flex items-center justify-center h-full">
        <Body3 className="text-text-tertiary">Select an account to view details</Body3>
      </div>
    );
  }

  const balanceThru = Number(balance) / 1e9;

  const handleStartEdit = () => {
    setEditLabel(account.label);
    setIsEditing(true);
  };

  const handleSaveEdit = () => {
    if (editLabel.trim() !== account.label) {
      onRename(editLabel.trim());
    }
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditLabel('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveEdit();
    } else if (e.key === 'Escape') {
      handleCancelEdit();
    }
  };

  const handleCopyAddress = async () => {
    try {
      await navigator.clipboard.writeText(account.publicKey);
      setCopiedAddress(true);
      setTimeout(() => setCopiedAddress(false), 2000);
    } catch (err) {
      console.error('Failed to copy address:', err);
    }
  };

  return (
    <div className="flex flex-col h-full space-y-8">
      {/* Account Header Card */}
      <Card variant="default">
        <div className="flex items-center justify-between mb-8">
          {isEditing ? (
            <div className="flex-1 flex items-center gap-3">
              <Input
                type="text"
                value={editLabel}
                onChange={(e) => setEditLabel(e.target.value)}
                onKeyDown={handleKeyDown}
                wrapperClassName="flex-1"
                autoFocus
              />
              <Button onClick={handleSaveEdit} size="sm" variant="primary">
                Save
              </Button>
              <Button onClick={handleCancelEdit} size="sm" variant="ghost">
                Cancel
              </Button>
            </div>
          ) : (
            <>
              <Heading4 className="text-text-primary" bold>{account.label}</Heading4>
              <Button onClick={handleStartEdit} size="sm" variant="ghost">
                Rename
              </Button>
            </>
          )}
        </div>

        {/* Address */}
        <div className="mb-8">
          <Body4 className="block mb-3" bold>Address</Body4>
          <div className="flex items-center gap-3">
            <div className="flex-1 px-4 py-3 bg-surface-higher border border-border-tertiary font-mono text-body-s text-text-secondary truncate">
              {account.publicKey}
            </div>
            <Button
              onClick={handleCopyAddress}
              size="md"
              variant={copiedAddress ? 'secondary' : 'primary'}
              className="whitespace-nowrap"
            >
              {copiedAddress ? 'Copied!' : 'Copy'}
            </Button>
          </div>
        </div>

        {/* Balance */}
        <div>
          <Body4 className="block mb-3" bold>Balance</Body4>
          <div className="flex items-center justify-between">
            <Heading5 className="text-text-primary" bold>
              {balanceThru.toFixed(4)} <span className="text-body-l text-text-tertiary font-normal">THRU</span>
            </Heading5>
          </div>
        </div>
      </Card>
    </div>
  );
}
