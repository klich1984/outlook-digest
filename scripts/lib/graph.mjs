/**
 * Microsoft Graph API client for the digest pipeline.
 *
 * Single endpoint used in PR1:
 *   GET /users/{upn}/mailFolders/inbox/messages
 *     ?$filter=receivedDateTime ge {sevenDaysAgo}
 *     &$select=id,subject,sender,from,receivedDateTime,isRead,hasAttachments,
 *              importance,inferenceClassification,bodyPreview,toRecipients
 *     &$top=50
 *
 * Pagination follows @odata.nextLink until either the inbox is
 * exhausted or the defensive 500-message cap is reached (per spec).
 *
 * Errors: 401/403 → GraphError stage=graph-auth (no retry — user must
 * regenerate credentials). Anything else throws GraphError
 * stage=graph-query. Network timeouts use AbortController so a stalled
 * Graph doesn't hang the workflow for the default fetch timeout.
 */

import { GraphError } from './errors.mjs';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';
const PAGE_SIZE = 50;
const MAX_RESULTS = 500;
const REQUEST_TIMEOUT_MS = 30_000;
const MAX_PAGES = Math.ceil(MAX_RESULTS / PAGE_SIZE) + 4; // hard ceiling

/**
 * Fetches recent inbox messages using a rolling N-day window.
 *
 * @param {{
 *   accessToken: string,
 *   userPrincipalName?: string,
 *   daysBack?: number,
 *   select?: string[],
 *   pageSize?: number,
 *   maxResults?: number,
 *   fetchImpl?: typeof fetch,
 * }} opts
 * @returns {Promise<Array<object>>}
 */
export async function listRecentMessages({
  accessToken,
  userPrincipalName = 'me',
  daysBack = 7,
  select = [],
  pageSize = PAGE_SIZE,
  maxResults = MAX_RESULTS,
  fetchImpl,
} = {}) {
  if (!accessToken) {
    throw new GraphError('Falta accessToken para Graph', 'graph-auth');
  }
  const fetcher = fetchImpl || globalThis.fetch;
  if (typeof fetcher !== 'function') {
    throw new GraphError('fetch global no disponible; provee fetchImpl', 'graph-query');
  }

  const since = new Date(Date.now() - daysBack * 86_400_000).toISOString();
  const filter = encodeURIComponent(`receivedDateTime ge ${since}`);
  const selectParam = select.length > 0
    ? `&$select=${encodeURIComponent(select.join(','))}`
    : '';
  const baseUrl = `${GRAPH_BASE}/users/${encodeURIComponent(userPrincipalName)}/mailFolders/inbox/messages`;
  let url = `${baseUrl}?$top=${pageSize}&$filter=${filter}${selectParam}`;

  const messages = [];
  let page = 0;

  while (url && messages.length < maxResults && page < MAX_PAGES) {
    page += 1;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let res;
    try {
      res = await fetcher(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Prefer: 'outlook.body-content-type="text"',
        },
        signal: controller.signal,
      });
    } catch (err) {
      if (err?.name === 'AbortError') {
        throw new GraphError(
          `Graph timeout tras ${REQUEST_TIMEOUT_MS}ms`,
          'graph-query',
        );
      }
      throw new GraphError(
        `Graph transport error: ${err.message || String(err)}`,
        'graph-query',
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      if (res.status === 401 || res.status === 403) {
        throw new GraphError(
          `Graph auth fallo (${res.status}): ${body.slice(0, 200)}`,
          'graph-auth',
        );
      }
      throw new GraphError(
        `Graph request fallo (${res.status}): ${body.slice(0, 200)}`,
        'graph-query',
      );
    }

    const data = await res.json().catch(() => ({}));
    const batch = Array.isArray(data.value) ? data.value : [];
    messages.push(...batch);
    url = data['@odata.nextLink'] || null;
  }

  return messages.slice(0, maxResults);
}

export const _internals = {
  GRAPH_BASE,
  PAGE_SIZE,
  MAX_RESULTS,
  REQUEST_TIMEOUT_MS,
  MAX_PAGES,
};
