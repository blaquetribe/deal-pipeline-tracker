import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Input } from './input';
import { SelectControl } from './select-control';
import { Textarea } from './textarea';

describe('shared form controls', () => {
  it('keeps native controls labelled and forwards their standard attributes', () => {
    render(
      <form>
        <label htmlFor="contact-email">Email address</label>
        <Input
          autoComplete="email"
          className="w-full"
          id="contact-email"
          name="email"
          required
          type="email"
        />

        <label htmlFor="deal-stage">Deal stage</label>
        <SelectControl defaultValue="screening" id="deal-stage" name="stage">
          <option value="screening">Screening</option>
        </SelectControl>

        <label htmlFor="deal-summary">Summary</label>
        <Textarea id="deal-summary" maxLength={500} name="summary" />
      </form>,
    );

    const email = screen.getByRole('textbox', { name: 'Email address' });
    expect(email).toHaveAttribute('type', 'email');
    expect(email).toHaveAttribute('autocomplete', 'email');
    expect(email).toHaveAttribute('name', 'email');
    expect(email).toBeRequired();
    expect(email).toHaveClass('ui-input', 'w-full');
    expect(email).toHaveAttribute('data-ui-control', 'input');

    const stage = screen.getByRole('combobox', { name: 'Deal stage' });
    expect(stage).toHaveValue('screening');
    expect(stage).toHaveAttribute('data-ui-control', 'select');

    const summary = screen.getByRole('textbox', { name: 'Summary' });
    expect(summary).toHaveAttribute('maxlength', '500');
    expect(summary).toHaveAttribute('data-ui-control', 'textarea');
  });
});
