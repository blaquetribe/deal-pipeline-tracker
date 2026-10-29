import type { SelectHTMLAttributes } from 'react';

export function SelectControl({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={['ui-select', className].filter(Boolean).join(' ')}
      data-ui-control="select"
    />
  );
}
