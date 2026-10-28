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
});
