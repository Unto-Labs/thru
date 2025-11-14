import React from 'react';
import { cn } from '../utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', children, disabled, ...props }, ref) => {
    const baseStyles = 'font-semibold transition-colors focus:outline-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';
    
    const variants = {
      primary: 'bg-surface-lower-inverse text-text-primary-inverse hover:bg-surface-higher-inverse focus:bg-surface-higher-inverse',
      secondary: 'bg-surface-brick text-text-primary-inverse hover:opacity-90 focus:opacity-90',
      outline: 'border border-border-primary text-text-primary hover:bg-surface-lower focus:bg-surface-lower',
      ghost: 'text-text-primary hover:bg-surface-lower focus:bg-surface-lower',
    };

    const sizes = {
      sm: 'px-3 py-1.5 text-sm',
      md: 'px-6 py-3 text-base',
      lg: 'px-8 py-4 text-lg',
    };

    return (
      <button
        ref={ref}
        className={cn(baseStyles, variants[variant], sizes[size], className)}
        disabled={disabled}
        {...props}
      >
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';

