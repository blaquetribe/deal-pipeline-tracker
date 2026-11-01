import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PageHeading } from './page-heading';

describe('PageHeading', () => {
  it('renders a minimal heading without optional sections', () => {
    const { container } = render(<PageHeading title="Deal pipeline" />);

    expect(screen.getByRole('heading', { level: 1, name: 'Deal pipeline' })).toBeVisible();
    expect(container.querySelector('p')).not.toBeInTheDocument();
    expect(container.querySelector('header')).toHaveClass('mb-5', 'pb-4');
  });

  it('renders the eyebrow, description, action, and compact spacing', () => {
    render(
      <PageHeading
        action={<button>New deal</button>}
        description="Opportunities across the organisation."
        eyebrow="Pipeline"
        spacing="compact"
        title="Deal pipeline"
      />,
    );

    expect(screen.getByText('Pipeline')).toBeVisible();
    expect(screen.getByText('Opportunities across the organisation.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'New deal' })).toBeVisible();
    expect(screen.getByRole('banner')).toHaveClass('mb-4', 'pb-4');
  });
});
