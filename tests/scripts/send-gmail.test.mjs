// Mock googleapis so the real Gmail SDK is never loaded in tests. This
// prevents the first `import('../../scripts/send-gmail.mjs')` from
// triggering a 10s+ initialization of the SDK, which caused a flaky
// 5s timeout in the first test of this file.
vi.mock('googleapis', () => ({ default: { google: {} } }));

import { describe, it, expect, vi } from 'vitest';

/**
 * Helper: builds a mock Gmail client whose `users.messages.send` returns
 * a sequence of `behaviors`. Each entry is either a string (treated as
 * a successful messageId) or an Error (treated as a thrown error).
 */
function makeMockClient(behaviors) {
  const send = vi.fn();
  for (const b of behaviors) {
    if (b instanceof Error) {
      send.mockRejectedValueOnce(b);
    } else {
      send.mockResolvedValueOnce({ data: { id: b } });
    }
  }
  return {
    users: {
      messages: { send },
    },
  };
}

const validOpts = () => ({
  from: 'sender@example.com',
  to: 'dest@example.com',
  subject: 'Reporte semanal Hotmail — 17 jun 2026',
  html: '<p>Reporte</p>',
  text: 'Reporte',
  // Disable real backoff in tests so retries are instantaneous.
  backoffMs: [0, 0],
});

describe('sendMail — happy path', () => {
  it('calls send once and resolves with { messageId }', async () => {
    const { sendMail } = await import('../../scripts/send-gmail.mjs');
    const client = makeMockClient(['msg-success-1']);
    const result = await sendMail(client, validOpts());
    expect(client.users.messages.send).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ messageId: 'msg-success-1' });
  });

  it('passes userId="me" and a base64-encoded raw payload to send()', async () => {
    const { sendMail } = await import('../../scripts/send-gmail.mjs');
    const client = makeMockClient(['msg-1']);
    await sendMail(client, validOpts());
    const call = client.users.messages.send.mock.calls[0][0];
    expect(call.userId).toBe('me');
    expect(typeof call.requestBody.raw).toBe('string');
    // raw must be base64url (no +, /, =)
    expect(call.requestBody.raw).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('sendMail — transient retry', () => {
  it('retries once on 503, succeeds on the 2nd attempt', async () => {
    const transient = Object.assign(new Error('Service Unavailable'), { code: 503 });
    const { sendMail } = await import('../../scripts/send-gmail.mjs');
    const client = makeMockClient([transient, 'msg-2']);
    const result = await sendMail(client, validOpts());
    expect(client.users.messages.send).toHaveBeenCalledTimes(2);
    expect(result.messageId).toBe('msg-2');
  });

  it('retries on 429 (rate limit)', async () => {
    const rateLimited = Object.assign(new Error('Too Many Requests'), { code: 429 });
    const { sendMail } = await import('../../scripts/send-gmail.mjs');
    const client = makeMockClient([rateLimited, 'msg-3']);
    const result = await sendMail(client, validOpts());
    expect(client.users.messages.send).toHaveBeenCalledTimes(2);
    expect(result.messageId).toBe('msg-3');
  });

  it('retries on network error (ECONNRESET)', async () => {
    const netErr = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    const { sendMail } = await import('../../scripts/send-gmail.mjs');
    const client = makeMockClient([netErr, 'msg-4']);
    const result = await sendMail(client, validOpts());
    expect(client.users.messages.send).toHaveBeenCalledTimes(2);
    expect(result.messageId).toBe('msg-4');
  });
});

describe('sendMail — permanent failure', () => {
  it('throws GmailError after 2 attempts when transient persists', async () => {
    const transient = Object.assign(new Error('Internal Server Error'), { code: 500 });
    const { sendMail } = await import('../../scripts/send-gmail.mjs');
    const { GmailError } = await import('../../scripts/lib/errors.mjs');
    const client = makeMockClient([transient, transient, transient, transient]);
    let caught;
    try {
      await sendMail(client, validOpts());
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(GmailError);
    expect(caught.stage).toBe('gmail-send');
    expect(client.users.messages.send).toHaveBeenCalledTimes(4);
  });

  it('throws GmailError with stage="gmail-auth" on 401 and does NOT retry', async () => {
    const authErr = Object.assign(new Error('Unauthorized'), { code: 401 });
    const { sendMail } = await import('../../scripts/send-gmail.mjs');
    const { GmailError } = await import('../../scripts/lib/errors.mjs');
    const client = makeMockClient([authErr]);
    let caught;
    try {
      await sendMail(client, validOpts());
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(GmailError);
    expect(caught.stage).toBe('gmail-auth');
    // 401 is not retryable; only 1 attempt.
    expect(client.users.messages.send).toHaveBeenCalledTimes(1);
  });

  it('throws GmailError with stage="gmail-auth" on 403 and does NOT retry', async () => {
    const authErr = Object.assign(new Error('Forbidden'), { code: 403 });
    const { sendMail } = await import('../../scripts/send-gmail.mjs');
    const { GmailError } = await import('../../scripts/lib/errors.mjs');
    const client = makeMockClient([authErr]);
    let caught;
    try {
      await sendMail(client, validOpts());
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(GmailError);
    expect(caught.stage).toBe('gmail-auth');
    expect(client.users.messages.send).toHaveBeenCalledTimes(1);
  });
});

describe('sendMail — validation (ConfigError)', () => {
  it('throws ConfigError with stage="gmail-config" when "to" is missing', async () => {
    const { sendMail } = await import('../../scripts/send-gmail.mjs');
    const { ConfigError } = await import('../../scripts/lib/errors.mjs');
    const client = makeMockClient(['msg']);
    const opts = validOpts();
    opts.to = '';
    let caught;
    try {
      await sendMail(client, opts);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    expect(caught.stage).toBe('gmail-config');
    expect(client.users.messages.send).not.toHaveBeenCalled();
  });

  it('throws ConfigError with stage="gmail-config" when "subject" is missing', async () => {
    const { sendMail } = await import('../../scripts/send-gmail.mjs');
    const { ConfigError } = await import('../../scripts/lib/errors.mjs');
    const client = makeMockClient(['msg']);
    const opts = validOpts();
    opts.subject = '';
    let caught;
    try {
      await sendMail(client, opts);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    expect(caught.stage).toBe('gmail-config');
    expect(client.users.messages.send).not.toHaveBeenCalled();
  });

  it('throws ConfigError with stage="gmail-config" when "from" is missing', async () => {
    const { sendMail } = await import('../../scripts/send-gmail.mjs');
    const { ConfigError } = await import('../../scripts/lib/errors.mjs');
    const client = makeMockClient(['msg']);
    const opts = validOpts();
    opts.from = '';
    let caught;
    try {
      await sendMail(client, opts);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ConfigError);
    expect(caught.stage).toBe('gmail-config');
    expect(client.users.messages.send).not.toHaveBeenCalled();
  });

  it('throws GmailError with stage="gmail-send" when client is null', async () => {
    const { sendMail } = await import('../../scripts/send-gmail.mjs');
    const { GmailError } = await import('../../scripts/lib/errors.mjs');
    let caught;
    try {
      await sendMail(null, validOpts());
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(GmailError);
    expect(caught.stage).toBe('gmail-send');
  });
});
