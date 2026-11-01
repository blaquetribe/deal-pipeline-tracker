import { STAGES } from '@dpt/shared';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StageBadge } from './stage-badge';

describe('StageBadge', () => {
  it('shows the stage as text', () => {
    render(<StageBadge stage="ic_review" />);
    expect(screen.getByText('IC Review')).toBeInTheDocument();
  });

  it.each([...STAGES])('renders a visible label for %s', (stage) => {
    render(<StageBadge stage={stage} />);
    expect(screen.getByText(/\S/)).toBeVisible();
    expect(screen.getByText(/\S/)).toHaveAttribute('data-stage', stage);
    expect(screen.getByText(/\S/).className).toMatch(
      /(?:brand|info|warning|accent|success|surface-subtle)/,
    );
  });
});
