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
const BACKOFF_MS = Object.freeze([2000, 8000]);

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
 * @param {import('googleapis').gmail_v1.Gmail} client
 * @param {{ from: string, to: string, subject: string, html: string, text: string, retryCount?: number }} opts
 * @returns {Promise<{ messageId: string }>}
 */
export async function sendMail(client, { from, to, subject, html, text, retryCount = 2 }) {
  if (!client) throw new GmailError('Cliente Gmail no inicializado', 'gmail-send');
  if (!from || !to || !subject) {
    throw new GmailError('Faltan campos requeridos (from/to/subject)', 'gmail-send');
  }

  const raw = buildRawMessage({ from, to, subject, html, text });
  let lastErr = null;

  for (let attempt = 0; attempt <= retryCount; attempt++) {
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

      if (!transient || attempt >= retryCount) {
        throw new GmailError(
          `Envío Gmail falló (status=${status ?? 'n/a'}): ${err.message || String(err)}`,
          'gmail-send',
        );
      }

      // Backoff before next attempt.
      const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw new GmailError(
    `Envío Gmail falló tras ${retryCount + 1} intentos: ${lastErr?.message || 'sin detalle'}`,
    'gmail-send',
  );
}
