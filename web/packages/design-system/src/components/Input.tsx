import React from 'react';
import { cn } from '../utils';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
  label?: string;
  wrapperClassName?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, label, id, wrapperClassName, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-');
    const inputRef = React.useRef<HTMLInputElement>(null);

    // Merge refs - support both forwarded ref and internal ref
    React.useImperativeHandle(ref, () => inputRef.current as HTMLInputElement, []);

    const handleWrapperClick = () => {
      inputRef.current?.focus();
    };

    const inputWrapper = (
      <div
        className={cn(
          'border bg-surface-higher p-4 transition-colors cursor-text flex items-center',
          'focus-within:border-border-primary focus-within:bg-golden',
          error
            ? 'border-border-brand bg-surface-brick focus-within:bg-surface-brick'
            : 'border-border-secondary',
          'disabled:bg-surface-disabled disabled:cursor-not-allowed',
          wrapperClassName,
        )}
        onClick={handleWrapperClick}
      >
        <input
          ref={inputRef}
          id={inputId}
          className={cn(
            'w-full bg-transparent outline-none font-sans text-base',
            'text-text-primary placeholder:text-text-tertiary',
            'placeholder:font-mono',
            'disabled:cursor-not-allowed',
            className
          )}
          {...props}
        />
      </div>
    );

    if (label) {
      return (
        <div className="space-y-2">
          <label
            htmlFor={inputId}
            className="block text-sm font-medium text-text-primary"
          >
            {label}
          </label>
          {inputWrapper}
        </div>
      );
    }

    return inputWrapper;
  }
);

Input.displayName = 'Input';

