import { describe, expect, it } from 'vitest';

import { renderAuthEmail } from './templates';

describe('renderAuthEmail', () => {
  it('produces text and HTML with the right purpose and expiry', () => {
    const verify = renderAuthEmail({
      kind: 'verify_email',
      link: 'http://localhost:8080/verify?token=abc',
    });
    expect(verify.subject).toContain('Verify');
    expect(verify.html).toContain('24 hours');
    expect(verify.text).toContain('http://localhost:8080/verify?token=abc');

    const reset = renderAuthEmail({
      kind: 'reset_password',
      link: 'http://localhost:8080/reset?token=abc',
    });
    expect(reset.subject).toContain('Reset');
    expect(reset.html).toContain('1 hour');
    expect(reset.text).toContain('Reset your password');
  });

  it('escapes every HTML context and leaves the plain-text link readable', () => {
    const email = renderAuthEmail({
      kind: 'verify_email',
      link: 'https://example.test/verify?x=1&name="<script>alert(1)</script>',
    });
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;');
    expect(email.html).toContain('&amp;name=&quot;');
    expect(email.text).toContain('<script>alert(1)</script>');
  });

  it('renders an escaped invitation and rejects unsafe or credentialed links', () => {
    const invitation = renderAuthEmail({
      kind: 'invitation',
      link: 'https://example.test/invite?token=abc',
      tenantName: "CVC <Partners> 'Holdings'",
      inviterEmail: 'owner&admin@example.test',
      roleName: 'Deal "Reviewer"',
    });

    expect(invitation.subject).toContain("You're invited");
    expect(invitation.html).toContain('owner&amp;admin@example.test');
    expect(invitation.html).toContain('CVC &lt;Partners&gt; &#39;Holdings&#39;');
    expect(invitation.html).toContain('Deal &quot;Reviewer&quot;');
    expect(invitation.text).toContain('within 7 days');
    expect(() => renderAuthEmail({ kind: 'verify_email', link: 'javascript:alert(1)' })).toThrow(
      'Auth email link must use HTTP or HTTPS without credentials',
    );
    expect(() =>
      renderAuthEmail({ kind: 'reset_password', link: 'https://user:password@example.test/reset' }),
    ).toThrow('Auth email link must use HTTP or HTTPS without credentials');
  });

  it('renders a generic closing-soon digest with escaped deal details and configured links', () => {
    const digest = renderAuthEmail({
      kind: 'closing_soon_digest',
      deals: [
        {
          dealName: 'Alpha <script>alert(1)</script>\r\nBeta',
          stage: 'due_diligence',
          amount: '9007199254740993',
          currency: 'ZAR',
          closeDate: '2026-11-01',
          closeTime: '12:00:00',
          timeZone: 'Africa/Johannesburg',
          thresholdDays: 5,
          link: 'https://tracker.example/deals/00000000-0000-4000-8000-000000000001',
        },
        {
          dealName: 'Overdue deal',
          stage: 'signed',
          amount: null,
          currency: 'ZAR',
          closeDate: '2026-10-01',
          closeTime: null,
          timeZone: 'Africa/Johannesburg',
          overdue: true,
          link: 'https://tracker.example/deals/00000000-0000-4000-8000-000000000002',
        },
      ],
    });
    expect(digest.subject).toBe('Deals closing soon');
    expect(digest.subject).not.toContain('Alpha');
    expect(digest.html).not.toContain('<script>');
    expect(digest.html).toContain('&lt;script&gt;');
    expect(digest.html).toContain('9007199254740993 ZAR');
    expect(digest.html).toContain('Closing date passed');
    expect(digest.text).toContain('Expected close: 2026-11-01 12:00:00 (Africa/Johannesburg)');
    expect(digest.text).not.toContain('\r');
    expect(() => renderAuthEmail({ kind: 'closing_soon_digest', deals: [] })).toThrow(
      'Closing-soon digest must include a deal',
    );
    expect(() =>
      renderAuthEmail({
        kind: 'closing_soon_digest',
        deals: [
          {
            dealName: 'Unsafe',
            stage: 'sourcing',
            amount: null,
            currency: 'ZAR',
            closeDate: '2026-11-01',
            closeTime: null,
            timeZone: 'UTC',
            link: 'javascript:alert(1)',
          },
        ],
      }),
    ).toThrow('Closing-soon link must use HTTP or HTTPS without credentials');
  });
});
