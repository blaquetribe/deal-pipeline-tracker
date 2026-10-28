export type AppEmail =
  | {
      readonly kind: 'verify_email' | 'reset_password';
      readonly link: string;
    }
  | {
      readonly kind: 'invitation';
      readonly link: string;
      readonly tenantName: string;
      readonly inviterEmail: string;
      readonly roleName: string;
    }
  | {
      readonly kind: 'closing_soon_digest';
      readonly deals: readonly {
        readonly dealName: string;
        readonly stage: string;
        readonly amount: string | null;
        readonly currency: string;
        readonly closeDate: string;
        readonly closeTime: string | null;
        readonly timeZone: string;
        readonly thresholdDays?: number;
        readonly overdue?: boolean;
        readonly link: string;
      }[];
    };

export interface RenderedEmail {
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

export function renderAuthEmail(email: AppEmail): RenderedEmail {
  if (email.kind === 'closing_soon_digest') return renderClosingSoonDigest(email);
  const { kind, link } = email;
  const parsedLink = new URL(link);
  if (
    !['http:', 'https:'].includes(parsedLink.protocol) ||
    parsedLink.username ||
    parsedLink.password
  ) {
    throw new Error('Auth email link must use HTTP or HTTPS without credentials');
  }
  const invitation = kind === 'invitation';
  const verification = kind === 'verify_email';
  const subject = invitation
    ? "You're invited to Deal Pipeline Tracker"
    : verification
      ? 'Verify your Deal Pipeline Tracker email'
      : 'Reset your Deal Pipeline Tracker password';
  const action = invitation
    ? 'Accept invitation'
    : verification
      ? 'Verify email address'
      : 'Reset password';
  const expiry = invitation ? '7 days' : verification ? '24 hours' : '1 hour';
  const intro = invitation
    ? `${email.inviterEmail} invited you to join ${email.tenantName} as ${email.roleName}. The organisation name is self-declared.`
    : verification
      ? 'Use this link to verify your email address.'
      : 'Use this link to reset your password.';
  const safeLink = escapeHtml(link);
  const text = [
    invitation ? intro : verification ? 'Verify your email address' : 'Reset your password',
    '',
    `Use this link within ${expiry}:`,
    link,
    '',
    'If you did not request this, you can ignore this message.',
  ].join('\n');
  const invitationDetails = invitation
    ? `<p>${escapeHtml(email.inviterEmail)} invited you to join <strong>${escapeHtml(email.tenantName)}</strong> as ${escapeHtml(email.roleName)}. The organisation name is self-declared.</p>`
    : '';
  const preheader = invitation
    ? `Invitation to join ${email.tenantName}`
    : verification
      ? 'Verify your Deal Pipeline Tracker email address'
      : 'Reset your Deal Pipeline Tracker password';
  const html = `<!doctype html><html><body style="margin:0;background:#f5f6f8;font-family:Arial,sans-serif;color:#172033"><span style="display:none;max-height:0;overflow:hidden">${escapeHtml(preheader)}</span><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f6f8"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff"><tr><td style="padding:32px"><p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase">Deal Pipeline Tracker</p><h1 style="font-size:22px">${action}</h1>${invitationDetails}<p>${invitation ? 'Accept this invitation' : 'Use this link'} within ${expiry}.</p><p><a href="${safeLink}" style="display:inline-block;padding:12px 18px;background:#173b35;color:#fff;text-decoration:none">${action}</a></p><p>If the button does not work, copy this address into your browser:</p><p>${safeLink}</p><p>If you did not request this, you can ignore this message.</p></td></tr></table></td></tr></table></body></html>`;
  return { subject, html, text };
}

function plainText(value: string): string {
  let safe = '';
  for (const character of value) {
    const code = character.charCodeAt(0);
    safe += code < 32 || code === 127 ? ' ' : character;
  }
  return safe.replace(/\s+/g, ' ').trim();
}

function renderClosingSoonDigest(
  email: Extract<AppEmail, { readonly kind: 'closing_soon_digest' }>,
): RenderedEmail {
  if (email.deals.length === 0) throw new Error('Closing-soon digest must include a deal');
  const rows = email.deals.map((deal) => {
    const link = new URL(deal.link);
    if (!['http:', 'https:'].includes(link.protocol) || link.username || link.password) {
      throw new Error('Closing-soon link must use HTTP or HTTPS without credentials');
    }
    const close = `${plainText(deal.closeDate)}${deal.closeTime ? ` ${plainText(deal.closeTime)}` : ''} (${plainText(deal.timeZone)})`;
    const reason = deal.overdue
      ? 'Closing date passed'
      : `Closing in ${deal.thresholdDays ?? 0} days`;
    const amount =
      deal.amount === null
        ? 'Amount not set'
        : `${plainText(deal.amount)} ${plainText(deal.currency)}`;
    const text = [
      plainText(deal.dealName),
      `Stage: ${plainText(deal.stage)}`,
      `Size: ${amount}`,
      `Expected close: ${close}`,
      reason,
      `Open deal: ${link.href}`,
    ].join('\n');
    const html = `<li><h2>${escapeHtml(plainText(deal.dealName))}</h2><p>Stage: ${escapeHtml(plainText(deal.stage))}<br>Size: ${escapeHtml(amount)}<br>Expected close: ${escapeHtml(close)}<br>${escapeHtml(reason)}</p><p><a href="${escapeHtml(link.href)}">Open deal</a></p></li>`;
    return { text, html };
  });
  return {
    subject: 'Deals closing soon',
    text: ['Deals closing soon', '', ...rows.flatMap((row) => [row.text, ''])].join('\n'),
    html: `<!doctype html><html><body><h1>Deals closing soon</h1><p>Here are the closing alerts for your organisation.</p><ul>${rows.map((row) => row.html).join('')}</ul><p>Sign in to view each deal. Your organisation's access rules still apply.</p></body></html>`,
  };
}
