import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PageHeading } from './page-heading';

describe('PageHeading', () => {
  it('renders a minimal heading without optional sections', () => {
    const { container } = render(<PageHeading title="Deal pipeline" />);

    expect(screen.getByRole('heading', { level: 1, name: 'Deal pipeline' })).toBeVisible();
    expect(container.querySelector('p')).not.toBeInTheDocument();
  });

  it('renders the eyebrow, description, action, and supplied class', () => {
    render(
      <PageHeading
        action={<button>New deal</button>}
        className="mb-0"
        description="Opportunities across the organisation."
        eyebrow="Pipeline"
        title="Deal pipeline"
      />,
    );

    expect(screen.getByText('Pipeline')).toBeVisible();
    expect(screen.getByText('Opportunities across the organisation.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'New deal' })).toBeVisible();
    expect(screen.getByRole('banner')).toHaveClass('mb-0');
  });
});
