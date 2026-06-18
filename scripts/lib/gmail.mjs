/**
 * Gmail API client + multipart/alternative send helper.
 *
 * Uses the `googleapis` package's prebuilt `gmail_v1` surface. The
 * client is constructed once with a refresh_token (no interactive
 * flow at runtime) and reused for every send.
 *
 * Retries: per design, transient errors (5xx / 429) get up to two
 * retries with exponential backoff (2s, then 8s). Auth errors (401,
 * 403) are NOT retried — they indicate an invalid refresh token that
 * the user must regenerate.
 */

import { google } from 'googleapis';
import { GmailError, ConfigError } from './errors.mjs';

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
// Default exponential backoff between retries (ms). Exposed as an array
// so callers (mainly tests) can override it for fast feedback loops.
const DEFAULT_BACKOFF_MS = Object.freeze([2000, 8000]);
// Default = 1 retry = 2 total attempts (initial + 1 retry). The spec
// states transient errors get retried once before giving up.
const DEFAULT_RETRY_COUNT = 1;

function requireCreds({ clientId, clientSecret, refreshToken }) {
  const missing = [];
  if (!clientId) missing.push('GMAIL_OAUTH_CLIENT_ID');
  if (!clientSecret) missing.push('GMAIL_OAUTH_CLIENT_SECRET');
  if (!refreshToken) missing.push('GMAIL_OAUTH_REFRESH_TOKEN');
  if (missing.length > 0) {
    throw new ConfigError(
      `Faltan credenciales Gmail: ${missing.join(', ')}`,
      'gmail-config',
    );
  }
}

/**
 * Builds an authenticated Gmail client. The returned client is safe
 * to reuse across sendMail() calls within the same process.
 *
 * @param {{ clientId: string, clientSecret: string, refreshToken: string }} opts
 * @returns {Promise<import('googleapis').gmail_v1.Gmail>}
 */
export async function buildGmailClient({ clientId, clientSecret, refreshToken }) {
  requireCreds({ clientId, clientSecret, refreshToken });

  const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
  oauth2.setCredentials({ refresh_token: refreshToken });

  return google.gmail({ version: 'v1', auth: oauth2 });
}

function encodeHeader(value) {
  // RFC 2047 base64 for non-ASCII subjects; ASCII headers go through plain.
  // gmail API expects headers as part of the raw MIME, but encoded-word
  // is safe for ASCII-only subjects too.
  return `=?utf-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

function buildRawMessage({ from, to, subject, html, text }) {
  const boundary = `mixed_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    `MIME-Version: 1.0`,
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    text,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: 7bit',
    '',
    html,
    '',
    `--${boundary}--`,
    '',
  ];
  return Buffer.from(lines.join('\r\n'), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Sends a multipart/alternative email through the Gmail API with
 * retry-on-transient-error. Returns the Gmail message id.
 *
 * Per spec, transient errors (5xx, 429, network) get one retry (2 total
 * attempts) with exponential backoff. Auth errors (401, 403) are NOT
 * retried — they indicate an invalid refresh token that the user must
 * regenerate.
 *
 * @param {import('googleapis').gmail_v1.Gmail} client
 * @param {{
 *   from: string,
 *   to: string,
 *   subject: string,
 *   html: string,
 *   text: string,
 *   retryCount?: number,
 *   backoffMs?: number[],
 *   onRetry?: (attempt: number, maxAttempts: number, err: Error) => void,
 * }} opts
 * @returns {Promise<{ messageId: string }>}
 */
export async function sendMail(
  client,
  { from, to, subject, html, text, retryCount = DEFAULT_RETRY_COUNT, backoffMs, onRetry },
) {
  if (!client) throw new GmailError('Cliente Gmail no inicializado', 'gmail-send');
  if (!from || !to || !subject) {
    // Per design 2.4: missing required fields is a GMAIL_CONFIG_ERROR,
    // not a transient send error. Use ConfigError with stage='gmail-config'
    // so the orchestrator (PR3) can route this to the error-report email.
    throw new ConfigError(
      'Faltan campos requeridos (from/to/subject) en la llamada a sendMail',
      'gmail-config',
    );
  }

  const raw = buildRawMessage({ from, to, subject, html, text });
  const backoff = Array.isArray(backoffMs) && backoffMs.length > 0 ? backoffMs : DEFAULT_BACKOFF_MS;
  const maxAttempts = retryCount + 1;
  let lastErr = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await client.users.messages.send({
        userId: 'me',
        requestBody: { raw },
      });
      if (!res?.data?.id) {
        throw new GmailError('Gmail no devolvió messageId', 'gmail-send');
      }
      return { messageId: res.data.id };
    } catch (err) {
      lastErr = err;

      // googleapis may surface status as err.code (number) or err.response?.status
      const status = err?.code || err?.response?.status;
      if (status === 401 || status === 403) {
        throw new GmailError(
          `Gmail rechazó la autenticación (${status}). El refresh token puede estar revocado; regenera GMAIL_OAUTH_REFRESH_TOKEN.`,
          'gmail-auth',
        );
      }

      const transient =
        (typeof status === 'number' && RETRYABLE_STATUS.has(status)) ||
        err?.name === 'NetworkError' ||
        err?.code === 'ECONNRESET' ||
        err?.code === 'ETIMEDOUT';

      if (!transient || attempt >= maxAttempts) {
        throw new GmailError(
          `Envío Gmail falló (status=${status ?? 'n/a'}): ${err.message || String(err)}`,
          'gmail-send',
        );
      }

      // Notify caller before the backoff (lets tests assert on retries
      // without faking timers).
      if (typeof onRetry === 'function') {
        try { onRetry(attempt, maxAttempts, err); } catch { /* ignore callback errors */ }
      }

      // Backoff before next attempt.
      const delay = backoff[Math.min(attempt - 1, backoff.length - 1)];
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  // Defensive: should be unreachable because the loop either returns or
  // throws. Kept so TypeScript / future edits don't dangle.
  throw new GmailError(
    `Envío Gmail falló tras ${maxAttempts} intentos: ${lastErr?.message || 'sin detalle'}`,
    'gmail-send',
  );
}
