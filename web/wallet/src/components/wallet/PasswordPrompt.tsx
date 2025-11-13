'use client';

import { Body3, Button, Card, Heading5 } from '@thru/design-system';
import { clsx } from 'clsx';
import { useState } from 'react';

interface PasswordPromptProps {
  title: string;
  description: string;
  onSubmit: (password: string) => void;
  confirmPassword?: boolean;
}

export function PasswordPrompt({
  title,
  description,
  onSubmit,
  confirmPassword = false,
}: PasswordPromptProps) {
  const [password, setPassword] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    if (confirmPassword && password !== confirmPass) {
      setError('Passwords do not match');
      return;
    }

    onSubmit(password);
  };

  return (
    <div className="w-full max-w-md mx-auto">
      <Card variant="default" className="p-8">
        <Heading5 className="text-text-primary mb-2" bold>{title}</Heading5>
        <Body3 className="text-text-secondary mb-6">{description}</Body3>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-primary mb-2">
              Password
            </label>
            <div className="relative">
              <div className="border bg-surface-higher p-4 transition-colors cursor-text flex items-center focus-within:border-border-primary focus-within:bg-golden border-border-secondary">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  autoFocus
                  className="w-full bg-transparent outline-none font-sans text-base text-text-primary placeholder:text-text-tertiary placeholder:font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="ml-2 text-text-tertiary hover:text-text-primary"
                >
                  {showPassword ? '🙈' : '👁️'}
                </button>
              </div>
            </div>
          </div>

          {confirmPassword && (
            <div>
              <label className="block text-sm font-medium text-text-primary mb-2">
                Confirm Password
              </label>
              <div className="relative">
                <div className={clsx(
                  'border bg-surface-higher p-4 transition-colors cursor-text flex items-center focus-within:border-border-primary focus-within:bg-golden',
                  error ? 'border-border-brand bg-surface-brick focus-within:bg-surface-brick' : 'border-border-secondary'
                )}>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPass}
                    onChange={(e) => setConfirmPass(e.target.value)}
                    placeholder="Confirm password"
                    className="w-full bg-transparent outline-none font-sans text-base text-text-primary placeholder:text-text-tertiary placeholder:font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="ml-2 text-text-tertiary hover:text-text-primary"
                  >
                    {showPassword ? '🙈' : '👁️'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="bg-surface-brick border border-border-brand p-3">
              <Body3 className="text-text-primary">{error}</Body3>
            </div>
          )}

          <Button
            type="submit"
            disabled={!password || (confirmPassword && !confirmPass)}
            variant="primary"
            className="w-full"
          >
            Continue
          </Button>
        </form>
      </Card>
    </div>
  );
}
