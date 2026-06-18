#!/usr/bin/env node
/**
 * Mark-as-read stage of the digest pipeline.
 *
 * Uses the Microsoft Graph `$batch` endpoint to mark up to 20 messages
 * per HTTP request as read (`PATCH isRead=true`). Per the design,
 * each batch gets at most one retry on transient errors (5xx, 429,
 * network); a permanent sub-request failure (e.g. 404 if the message
 * was already deleted) is reported in the `failed` array without
 * blocking the rest of the run.
 *
 * Public interface (per user spec for PR2):
 *   markAsRead({ accessToken, userPrincipalName, messageIds, onRetry })
 *     -> { succeeded: string[], failed: Array<{ id, error }> }
 *
 *   accessToken        - MSAL access token with Mail.ReadWrite scope
 *   userPrincipalName  - mailbox owner (default: 'me')
 *   messageIds         - array of Graph message IDs to mark
 *   onRetry            - optional callback fired before each backoff
 *                        with (attempt, maxAttempts, error)
 *   batchSize          - messages per $batch (default: 20)
 *   retryCount         - retries per batch (default: 1 → 2 total attempts)
 *   fetchImpl          - override fetch for tests
 *
 * Failure model:
 *   - Missing accessToken → GraphError(stage='graph-auth')
 *   - Whole batch request fails (network / 5xx / 429) → retry; if all
 *     attempts fail, ALL IDs in the batch are returned in `failed`.
 *   - Batch request returns 2xx but a sub-response has a 4xx status
 *     (other than 429) → only that ID is in `failed`. The batch as a
 *     whole is considered successful.
 *   - Batch request returns a non-retryable 4xx (e.g. 400) → whole
 *     batch in `failed` (no retry; the request was malformed).
 */

import { GraphError } from './lib/errors.mjs';

const BATCH_URL = 'https://graph.microsoft.com/v1.0/$batch';
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_RETRY_COUNT = 1;
// Default exponential backoff (ms). Exposed so tests can override.
const DEFAULT_BACKOFF_MS = Object.freeze([1000, 4000]);

function buildPatchUrl(userPrincipalName, messageId) {
  const upn = encodeURIComponent(userPrincipalName);
  const id = encodeURIComponent(messageId);
  if (userPrincipalName === 'me') {
    return `/me/messages/${id}`;
  }
  return `/users/${upn}/messages/${id}`;
}

function buildRequestBody(userPrincipalName, messageIds) {
  return {
    requests: messageIds.map((id, idx) => ({
      id: String(idx),
      method: 'PATCH',
      url: buildPatchUrl(userPrincipalName, id),
      body: { isRead: true },
      headers: { 'Content-Type': 'application/json' },
    })),
  };
}

/**
 * Processes a single batch with retry. Returns the list of succeeded
 * IDs and the list of failed IDs with their error message.
 *
 * @param {{
 *   accessToken: string,
 *   userPrincipalName: string,
 *   batch: string[],
 *   batchSize?: number,
 *   retryCount?: number,
 *   backoffMs?: number[],
 *   onRetry?: (attempt: number, maxAttempts: number, err: Error) => void,
 *   fetchImpl: typeof fetch,
 * }} opts
 */
async function processBatch({
  accessToken,
  userPrincipalName,
  batch,
  retryCount = DEFAULT_RETRY_COUNT,
  backoffMs,
  onRetry,
  fetchImpl,
}) {
  const body = buildRequestBody(userPrincipalName, batch);
  const backoff = Array.isArray(backoffMs) && backoffMs.length > 0 ? backoffMs : DEFAULT_BACKOFF_MS;
  const maxAttempts = retryCount + 1;
  let lastErr = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res;
    try {
      res = await fetchImpl(BATCH_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      // Network-level error → treat as transient.
      lastErr = err;
      if (attempt < maxAttempts) {
        if (typeof onRetry === 'function') {
          try { onRetry(attempt, maxAttempts, err); } catch { /* ignore */ }
        }
        const delay = backoff[Math.min(attempt - 1, backoff.length - 1)];
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      break;
    }

    // Whole-request retryable status (5xx / 429).
    if (RETRYABLE_STATUS.has(res.status)) {
      lastErr = new Error(`Graph $batch request failed: HTTP ${res.status}`);
      if (attempt < maxAttempts) {
        if (typeof onRetry === 'function') {
          try { onRetry(attempt, maxAttempts, lastErr); } catch { /* ignore */ }
        }
        const delay = backoff[Math.min(attempt - 1, backoff.length - 1)];
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      break;
    }

    // Non-retryable 4xx (e.g. 400 Bad Request) → permanent failure
    // for the whole batch. No retry.
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        succeeded: [],
        failed: batch.map((id) => ({
          id,
          error: `Graph $batch falló (HTTP ${res.status}): ${text.slice(0, 200)}`,
        })),
      };
    }

    // 2xx → parse sub-responses and split by status.
    const data = await res.json().catch(() => ({}));
    const responses = Array.isArray(data.responses) ? data.responses : [];
    const byId = new Map(responses.map((r) => [String(r?.id), r]));
    const succeeded = [];
    const failed = [];
    batch.forEach((id, idx) => {
      const sub = byId.get(String(idx));
      if (!sub) {
        failed.push({ id, error: 'No sub-response from Graph' });
        return;
      }
      const status = sub.status;
      if (status >= 200 && status < 300) {
        succeeded.push(id);
      } else {
        failed.push({ id, error: `Sub-request falló (HTTP ${status})` });
      }
    });
    return { succeeded, failed };
  }

  // Reached only when every attempt hit a transient failure.
  return {
    succeeded: [],
    failed: batch.map((id) => ({
      id,
      error: `Graph $batch falló tras ${maxAttempts} intentos: ${lastErr?.message || 'sin detalle'}`,
    })),
  };
}

/**
 * Marks a list of messages as read using Graph batch requests.
 *
 * @param {{
 *   accessToken: string,
 *   userPrincipalName?: string,
 *   messageIds: string[],
 *   onRetry?: (attempt: number, maxAttempts: number, err: Error) => void,
 *   batchSize?: number,
 *   retryCount?: number,
 *   backoffMs?: number[],
 *   fetchImpl?: typeof fetch,
 * }} opts
 * @returns {Promise<{ succeeded: string[], failed: Array<{ id: string, error: string }> }>}
 */
export async function markAsRead({
  accessToken,
  userPrincipalName = 'me',
  messageIds = [],
  onRetry,
  batchSize = DEFAULT_BATCH_SIZE,
  retryCount = DEFAULT_RETRY_COUNT,
  backoffMs,
  fetchImpl,
} = {}) {
  if (!accessToken || typeof accessToken !== 'string') {
    throw new GraphError('Falta accessToken para markAsRead', 'graph-auth');
  }
  if (!Array.isArray(messageIds)) {
    messageIds = [];
  }
  const fetcher = fetchImpl || globalThis.fetch;
  if (typeof fetcher !== 'function') {
    throw new GraphError('fetch global no disponible; provee fetchImpl', 'graph-query');
  }
  if (messageIds.length === 0) {
    return { succeeded: [], failed: [] };
  }

  // Group into batches of `batchSize`.
  const batches = [];
  for (let i = 0; i < messageIds.length; i += batchSize) {
    batches.push(messageIds.slice(i, i + batchSize));
  }

  const succeeded = [];
  const failed = [];
  for (const batch of batches) {
    const out = await processBatch({
      accessToken,
      userPrincipalName,
      batch,
      retryCount,
      backoffMs,
      onRetry,
      fetchImpl: fetcher,
    });
    succeeded.push(...out.succeeded);
    failed.push(...out.failed);
  }

  return { succeeded, failed };
}
