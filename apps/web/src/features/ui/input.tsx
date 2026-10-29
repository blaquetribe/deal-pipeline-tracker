import type { InputHTMLAttributes } from 'react';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={['ui-input', className].filter(Boolean).join(' ')}
      data-ui-control="input"
    />
  );
}
