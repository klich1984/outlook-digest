#!/usr/bin/env node
/**
 * First slice of the weekly digest pipeline.
 *
 * Runs the steps that don't have side effects beyond the Graph API:
 *
 *   1. Load and validate environment variables (ConfigError if missing).
 *   2. Load the MSAL token cache and acquire an access token silently.
 *   3. Read the local checkpoint (created if absent).
 *   4. Query Microsoft Graph for inbox messages received in the
 *      last `daysBack` days, with the 11 fields the spec requires.
 *   5. Filter out messages whose ID is already in the checkpoint.
 *   6. Run alerts.mjs:detectAlert() on each new message and attach
 *      { isAlert, matchedCriteria } to the message envelope.
 *   7. Annotate each message with COL-formatted fields the report
 *      builder expects (dateLabel, receivedAtCOL, senderEmail, ...).
 *   8. Emit the resulting array as JSON to stdout.
 *
 * PR2 extends this with: Gmail send, mark-read, checkpoint write, and
 * the orchestrator that ties them together. PR1 keeps the surface
 * minimal so the foundation can be reviewed in isolation.
 *
 * When this file is invoked directly (`node scripts/build-digest.mjs`)
 * it runs the full pipeline and prints JSON; when imported by the
 * orchestrator it exports `buildDigest()` for reuse.
 */

import { pathToFileURL } from 'node:url';
import { loadMsal, acquireTokenSilent } from './lib/msal.mjs';
import { listRecentMessages } from './lib/graph.mjs';
import { detectAlert } from './lib/alerts.mjs';
import {
  readCheckpoint,
  reportedIdSet,
  filterNewMessages,
} from './lib/checkpoint.mjs';
import { ConfigError, GraphError, TokenError } from './lib/errors.mjs';
import { createLogger } from './lib/logger.mjs';
import {
  formatDateInCOL,
  formatDateRangeInCOL,
  formatTimeInCOL,
  getLastNDays,
} from './lib/timezone.mjs';

const REQUIRED_ENV = Object.freeze([
  'HOTMAIL_ACCOUNT_ADDRESS',
  'MSAL_TOKEN_CACHE_JSON',
  'GMAIL_OAUTH_CLIENT_ID',
  'GMAIL_OAUTH_CLIENT_SECRET',
  'GMAIL_OAUTH_REFRESH_TOKEN',
  'GMAIL_DESTINATION_ADDRESS',
]);

// Per spec/graph-query: the 11 fields the report needs.
const SELECT_FIELDS = Object.freeze([
  'id',
  'subject',
  'sender',
  'from',
  'receivedDateTime',
  'isRead',
  'hasAttachments',
  'importance',
  'inferenceClassification',
  'bodyPreview',
  'toRecipients',
]);

const DEFAULT_DAYS_BACK = 7;

/**
 * Loads and validates the env vars. Throws ConfigError with the list
 * of missing names so the user can fix all of them in one pass.
 *
 * @param {Record<string, string|undefined>} [env]
 * @returns {{ hotmailAddress: string, msalTokenCacheJson: string, gmailClientId: string, gmailClientSecret: string, gmailRefreshToken: string, gmailDestination: string }}
 */
export function loadConfigFromEnv(env = process.env) {
  const missing = REQUIRED_ENV.filter(
    (k) => !env[k] || String(env[k]).trim() === '',
  );
  if (missing.length > 0) {
    throw new ConfigError(
      `Faltan variables de entorno: ${missing.join(', ')}. Configúralas en .env (ver .env.example).`,
      'config',
    );
  }
  return {
    hotmailAddress: env.HOTMAIL_ACCOUNT_ADDRESS,
    msalTokenCacheJson: env.MSAL_TOKEN_CACHE_JSON,
    gmailClientId: env.GMAIL_OAUTH_CLIENT_ID,
    gmailClientSecret: env.GMAIL_OAUTH_CLIENT_SECRET,
    gmailRefreshToken: env.GMAIL_OAUTH_REFRESH_TOKEN,
    gmailDestination: env.GMAIL_DESTINATION_ADDRESS,
  };
}

/**
 * Decorates a Graph message with the COL-friendly fields the report
 * builder expects (dateLabel, receivedAtCOL, senderEmail, senderName)
 * and the alert evaluation result (isAlert, matchedCriteria).
 *
 * @param {object} message - Raw Graph message
 * @param {{ isAlert: boolean, matchedCriteria: string[] }} alertResult
 * @returns {object}
 */
function annotateMessage(message, alertResult) {
  const received = message?.receivedDateTime
    ? new Date(message.receivedDateTime)
    : null;
  const fromAddr = message?.from?.emailAddress?.address || '';
  const fromName = message?.from?.emailAddress?.name || '';

  return {
    ...message,
    isAlert: alertResult.isAlert,
    matchedCriteria: alertResult.matchedCriteria,
    senderEmail: fromAddr,
    senderName: fromName || fromAddr,
    receivedAtCOL: received
      ? `${formatDateInCOL(received)} · ${formatTimeInCOL(received)}`
      : '',
    dateLabel: received ? formatDateInCOL(received, { long: true }) : '',
  };
}

/**
 * Runs the side-effect-free half of the pipeline. Returns the
 * annotated messages, the original checkpoint, and a `window`
 * descriptor useful for report headers in PR2.
 *
 * @param {{
 *   config?: ReturnType<typeof loadConfigFromEnv>,
 *   daysBack?: number,
 *   fetchImpl?: typeof fetch,
 *   checkpointPath?: string,
 *   logger?: ReturnType<typeof createLogger>,
 * }} [opts]
 */
export async function buildDigest(opts = {}) {
  const log = opts.logger || createLogger({ base: { stage: 'build-digest' } });
  const config = opts.config || loadConfigFromEnv();
  const daysBack = Number.isInteger(opts.daysBack) ? opts.daysBack : DEFAULT_DAYS_BACK;

  log.info('Iniciando digest semanal', {
    account: config.hotmailAddress,
    daysBack,
  });

  // Step 4 — read checkpoint (creates empty if absent).
  const checkpoint = await readCheckpoint(opts.checkpointPath);
  const reported = reportedIdSet(checkpoint);
  log.info('Checkpoint leído', { reportedCount: reported.size });

  // Step 3 — MSAL token (used for the Graph call below).
  const app = await loadMsal({ cacheJson: config.msalTokenCacheJson });
  let accessToken;
  try {
    const result = await acquireTokenSilent(app);
    accessToken = result.accessToken;
    log.info('Token MSAL adquirido', {
      expiresOn: result.expiresOn ? result.expiresOn.toISOString() : null,
    });
  } catch (err) {
    // TokenError covers both missing account and silent-refresh failure.
    log.error('Fallo al adquirir token MSAL', { stage: err.stage || 'msal-acquire' });
    throw err;
  }

  // Step 5 — query Graph with rolling N-day window.
  const window = getLastNDays(daysBack);
  const rawMessages = await listRecentMessages({
    accessToken,
    userPrincipalName: config.hotmailAddress,
    daysBack,
    select: [...SELECT_FIELDS],
    fetchImpl: opts.fetchImpl,
  });
  log.info('Mensajes recibidos de Graph', { count: rawMessages.length });

  // Step 6 — exclude already-reported IDs.
  const newMessages = filterNewMessages(rawMessages, reported);
  log.info('Mensajes nuevos tras filtro de checkpoint', {
    count: newMessages.length,
  });

  // Step 6.5 — alert detection + COL annotation.
  const annotated = newMessages.map((m) =>
    annotateMessage(m, detectAlert(m)),
  );
  const alertCount = annotated.filter((m) => m.isAlert).length;
  log.info('Alertas detectadas', { count: alertCount, total: annotated.length });

  return {
    messages: annotated,
    account: config.hotmailAddress,
    window: {
      fromIso: window.from.toISOString(),
      toIso: window.to.toISOString(),
      dateRangeCOL: formatDateRangeInCOL(window.from, window.to),
    },
    checkpoint,
    totals: {
      fetched: rawMessages.length,
      new: newMessages.length,
      alerts: alertCount,
    },
  };
}

async function runCli() {
  const log = createLogger({ base: { stage: 'cli' } });
  try {
    const config = loadConfigFromEnv();
    const result = await buildDigest({ config, logger: log });
    process.stdout.write(JSON.stringify(result.messages, null, 2) + '\n');
    process.exit(0);
  } catch (err) {
    const payload = {
      ts: new Date().toISOString(),
      level: 'error',
      stage: err instanceof GraphError || err instanceof TokenError || err instanceof ConfigError
        ? err.stage
        : 'unknown',
      name: err.name,
      message: err.message,
    };
    if (err.stack) payload.stack = String(err.stack).split('\n').slice(0, 10).join('\n');
    process.stderr.write(JSON.stringify(payload) + '\n');
    process.exit(1);
  }
}

// Run as CLI when invoked directly (`node scripts/build-digest.mjs`).
// Imports via index.mjs don't trigger this because argv[1] is the
// importing file, not this module's URL.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runCli();
}
