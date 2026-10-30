import type { TextareaHTMLAttributes } from 'react';

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={['ui-textarea', className].filter(Boolean).join(' ')}
      data-ui-control="textarea"
    />
  );
}
