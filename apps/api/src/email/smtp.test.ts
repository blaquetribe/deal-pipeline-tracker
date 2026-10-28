import type { SendMailOptions } from 'nodemailer';
import { describe, expect, it, vi } from 'vitest';

import { createSmtpMailer } from './smtp';

function transportFactory() {
  const sendMail = vi.fn<(_message: SendMailOptions) => Promise<unknown>>(async (_message) => ({
    messageId: 'queued',
  }));
  const createTransport = vi.fn<
    NonNullable<Parameters<typeof createSmtpMailer>[0]['createTransport']>
  >(() => ({ sendMail }));
  return { createTransport, sendMail };
}

describe('createSmtpMailer', () => {
  it('configures Mailpit and sends rendered text and HTML', async () => {
    const fake = transportFactory();
    const mailer = createSmtpMailer({
      host: 'mailpit',
      port: 1025,
      from: 'no-reply@example.test',
      createTransport: fake.createTransport,
    });
    await mailer.send({
      to: 'ada@example.test',
      kind: 'verify_email',
      link: 'http://localhost:8080/verify?token=a&name=<Ada>',
    });

    expect(fake.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'mailpit',
        port: 1025,
        secure: false,
        requireTLS: false,
      }),
    );
    expect(fake.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: { name: 'Deal Pipeline Tracker', address: 'no-reply@example.test' },
        to: 'ada@example.test',
        text: expect.stringContaining('token=a&name=<Ada>'),
        html: expect.stringContaining('name=&lt;Ada&gt;'),
      }),
    );
  });

  it('configures authenticated TLS transports', () => {
    const fake = transportFactory();
    createSmtpMailer({
      host: 'smtp.example.test',
      port: 587,
      from: 'no-reply@example.test',
      requireTLS: true,
      user: 'mailer',
      pass: 'secret',
      createTransport: fake.createTransport,
    });
    expect(fake.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        secure: false,
        requireTLS: true,
        auth: { user: 'mailer', pass: 'secret' },
      }),
    );
  });

  it('rejects incomplete credentials and authentication without TLS', () => {
    expect(() =>
      createSmtpMailer({
        host: 'smtp.example.test',
        port: 25,
        from: 'no-reply@example.test',
        user: 'mailer',
      }),
    ).toThrow(/configured together/);
    expect(() =>
      createSmtpMailer({
        host: 'smtp.example.test',
        port: 25,
        from: 'no-reply@example.test',
        user: 'mailer',
        pass: 'secret',
      }),
    ).toThrow(/requires TLS/);
  });

  it('rejects invalid sender and recipient addresses', async () => {
    expect(() =>
      createSmtpMailer({
        host: 'mailpit',
        port: 1025,
        from: 'bad\r\nBcc:evil@example.test',
      }),
    ).toThrow('Invalid email');
    const fake = transportFactory();
    const mailer = createSmtpMailer({
      host: 'mailpit',
      port: 1025,
      from: 'no-reply@example.test',
      createTransport: fake.createTransport,
    });
    await expect(
      mailer.send({
        to: 'bad\r\nBcc:evil@example.test',
        kind: 'verify_email',
        link: 'http://localhost/verify',
      }),
    ).rejects.toThrow('Invalid email');
    expect(fake.sendMail).not.toHaveBeenCalled();
  });
});
