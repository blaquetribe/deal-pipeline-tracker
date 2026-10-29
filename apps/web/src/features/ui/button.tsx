import type { ButtonHTMLAttributes } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';
export type ButtonSize = 'small' | 'default';

export function Button({
  variant = 'secondary',
  size = 'default',
  className,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'size'> & {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
}) {
  return (
    <button
      {...props}
      className={['ui-button', className].filter(Boolean).join(' ')}
      data-size={size}
      data-ui-button=""
      data-variant={variant}
    />
  );
}
