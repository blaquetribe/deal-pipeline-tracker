import { createTransport as createNodemailerTransport } from 'nodemailer';
import type { SendMailOptions } from 'nodemailer';
import { z } from 'zod';

import { renderAuthEmail, type AppEmail } from './templates';

interface SmtpOptions {
  readonly host: string;
  readonly port: number;
  readonly from: string;
  readonly secure?: boolean;
  readonly requireTLS?: boolean;
  readonly user?: string;
  readonly pass?: string;
  readonly timeoutMs?: number;
  readonly createTransport?: (options: SmtpTransportOptions) => {
    sendMail: (message: SendMailOptions) => Promise<unknown>;
  };
}

interface SmtpTransportOptions {
  readonly host: string;
  readonly port: number;
  readonly secure: boolean;
  readonly requireTLS: boolean;
  readonly connectionTimeout: number;
  readonly greetingTimeout: number;
  readonly socketTimeout: number;
  readonly auth?: { readonly user: string; readonly pass: string };
}

export function createSmtpMailer({
  host,
  port,
  from,
  secure = false,
  requireTLS = false,
  user,
  pass,
  timeoutMs = 8000,
  createTransport = (options) => createNodemailerTransport(options),
}: SmtpOptions) {
  const address = z.email();
  address.parse(from);
  if (Boolean(user) !== Boolean(pass))
    throw new Error('SMTP_USER and SMTP_PASS must be configured together');
  if (user && !secure && !requireTLS) throw new Error('SMTP authentication requires TLS');

  const transport = createTransport({
    host,
    port,
    secure,
    requireTLS,
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs,
    ...(user && pass ? { auth: { user, pass } } : {}),
  });

  return {
    async send({ to, ...email }: { readonly to: string } & AppEmail): Promise<void> {
      address.parse(to);
      const rendered = renderAuthEmail(email);
      await transport.sendMail({
        from: { name: 'Deal Pipeline Tracker', address: from },
        to,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      } satisfies SendMailOptions);
    },
  };
}

export type SmtpMailer = ReturnType<typeof createSmtpMailer>;
