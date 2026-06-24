#!/usr/bin/env node
/**
 * Weekly digest pipeline.
 *
 * PR1 ran the side-effect-free half of the pipeline and emitted the
 * annotated message list to stdout. PR2 extends it with the side
 * effects that deliver the report:
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
 *   8. Build the multipart/alternative report via templates.mjs.
 *   9. Send the report through Gmail API (sendMail with retry on
 *      transient errors).
 *  10. Mark the reported messages as read via Graph $batch
 *      (mark-read.mjs, batches of 20, 1 retry on transient errors).
 *  11. Update the local checkpoint with the IDs that mark-read
 *      reported as succeeded. The actual `git add`/`git commit`/
 *      `git push` lives in the orchestrator (PR3) — this function
 *      only writes the file.
 *
 * When invoked directly (`node scripts/build-digest.mjs`) it runs the
 * full pipeline and prints the result JSON; when imported by the
 * orchestrator it exports `buildDigest()` for reuse.
 *
 * This file does NOT run `git add`/`git commit`/`git push`. The
 * orchestrator (PR3) uses `buildCommitCheckpoint()` from
 * `checkpoint-commit.mjs` to obtain the data needed for the commit
 * and performs the git operation.
 */

import { pathToFileURL } from 'node:url';
import { loadMsal, acquireTokenSilent } from './lib/msal.mjs';
import { listRecentMessages } from './lib/graph.mjs';
import { detectAlert } from './lib/alerts.mjs';
import {
  readCheckpoint,
  writeCheckpoint,
  reportedIdSet,
  filterNewMessages,
} from './lib/checkpoint.mjs';
import { ConfigError, GraphError, TokenError, GmailError } from './lib/errors.mjs';
import { createLogger } from './lib/logger.mjs';
import {
  formatDateInCOL,
  formatDateRangeInCOL,
  formatTimeInCOL,
  getLastNDays,
} from './lib/timezone.mjs';
import { buildReport } from './lib/templates.mjs';
import { buildGmailClient, sendMail } from './send-gmail.mjs';
import { markAsRead } from './mark-read.mjs';
import { buildCommitCheckpoint } from './checkpoint-commit.mjs';

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
 * Runs the full pipeline (PR2 scope): Graph query → report build →
 * Gmail send → mark-read → checkpoint write. Returns a rich result
 * envelope the orchestrator (PR3) needs to perform the git commit.
 *
 * @param {{
 *   config?: ReturnType<typeof loadConfigFromEnv>,
 *   daysBack?: number,
 *   fetchImpl?: typeof fetch,
 *   checkpointPath?: string,
 *   logger?: ReturnType<typeof createLogger>,
 *   runId?: string,
 *   now?: string,
 *   sendBackoffMs?: number[],
 *   markBackoffMs?: number[],
 *   buildGmailClientImpl?: typeof buildGmailClient,
 *   sendMailImpl?: typeof sendMail,
 *   markAsReadImpl?: typeof markAsRead,
 *   buildReportImpl?: typeof buildReport,
 * }} [opts]
 */
export async function buildDigest(opts = {}) {
  const log = opts.logger || createLogger({ base: { stage: 'build-digest' } });
  const config = opts.config || loadConfigFromEnv();
  const daysBack = Number.isInteger(opts.daysBack) ? opts.daysBack : DEFAULT_DAYS_BACK;
  const runId = opts.runId || process.env.GITHUB_RUN_ID || `local-${Date.now()}`;
  const now = opts.now || new Date().toISOString();
  const _sendGmailClient = opts.buildGmailClientImpl || buildGmailClient;
  const _sendMail = opts.sendMailImpl || sendMail;
  const _markAsRead = opts.markAsReadImpl || markAsRead;
  const _buildReport = opts.buildReportImpl || buildReport;

  log.info('Iniciando digest semanal', {
    account: config.hotmailAddress,
    daysBack,
    runId,
  });

  // Step 4 — read checkpoint (creates empty if absent).
  const checkpoint = await readCheckpoint(opts.checkpointPath);
  const reported = reportedIdSet(checkpoint);
  log.info('Checkpoint leído', { reportedCount: reported.size });

  // Step 3 — MSAL token (used for the Graph call below).
  const app = await loadMsal({
    cacheJson: config.msalTokenCacheJson,
    clientId: config.msalClientId,
  });
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

  const dateRangeCOL = formatDateRangeInCOL(window.from, window.to);
  const dateStrCOL = formatDateInCOL(window.to);

  // No new messages — short-circuit. Do not send, do not mark, do not
  // touch the checkpoint. The orchestrator (PR3) won't commit either.
  if (annotated.length === 0) {
    log.info('Sin mensajes nuevos; no se envía reporte ni se marcan como leídos');
    return {
      messages: [],
      account: config.hotmailAddress,
      window: {
        fromIso: window.from.toISOString(),
        toIso: window.to.toISOString(),
        dateRangeCOL,
        dateStrCOL,
      },
      checkpoint,
      previousCheckpoint: checkpoint,
      totals: {
        fetched: rawMessages.length,
        new: 0,
        alerts: 0,
        sent: false,
        mark: null,
      },
      report: null,
      runId,
    };
  }

  // Step 8 — build the multipart/alternative report.
  const totals = {
    total: annotated.length,
    focused: annotated.filter((m) => (m.inferenceClassification || m.classification) === 'focused').length,
    other: annotated.filter((m) => (m.inferenceClassification || m.classification) === 'other').length,
  };
  const report = _buildReport({
    messages: annotated,
    alerts: annotated.filter((m) => m.isAlert),
    account: config.hotmailAddress,
    dateRange: dateRangeCOL,
    dateStr: dateStrCOL,
    totals,
  });

  // Step 9 — send via Gmail.
  const gmailClient = await _sendGmailClient({
    clientId: config.gmailClientId,
    clientSecret: config.gmailClientSecret,
    refreshToken: config.gmailRefreshToken,
  });
  const sendResult = await _sendMail(gmailClient, {
    from: config.gmailDestination,
    to: config.gmailDestination,
    subject: report.subject,
    html: report.html,
    text: report.text,
    backoffMs: opts.sendBackoffMs,
  });
  log.info('Reporte enviado a Gmail', { messageId: sendResult.messageId });

  // Step 10 — mark as read.
  const messageIds = annotated.map((m) => m.id);
  const markResult = await _markAsRead({
    accessToken,
    userPrincipalName: config.hotmailAddress,
    messageIds,
    onRetry: (attempt, max) => log.warn('Reintentando batch mark-read', { attempt, max }),
    backoffMs: opts.markBackoffMs,
    fetchImpl: opts.fetchImpl,
  });
  log.info('Marcado como leído', {
    succeeded: markResult.succeeded.length,
    failed: markResult.failed.length,
  });

  // Step 11 — checkpoint write. Only the succeeded IDs go in; failed
  // IDs are intentionally left out so the next run retries them.
  let workingCheckpoint = checkpoint;
  let commitPlan = null;
  if (markResult.succeeded.length > 0) {
    commitPlan = buildCommitCheckpoint({
      checkpoint: workingCheckpoint,
      runId,
      newIds: markResult.succeeded,
      now,
    });
    await writeCheckpoint(opts.checkpointPath, commitPlan.checkpoint);
    log.info('Checkpoint local actualizado', {
      newCount: commitPlan.newCount,
    });
  } else {
    log.warn('mark-read no marcó ningún mensaje; checkpoint NO se actualiza');
  }

  return {
    messages: annotated,
    account: config.hotmailAddress,
    window: {
      fromIso: window.from.toISOString(),
      toIso: window.to.toISOString(),
      dateRangeCOL,
      dateStrCOL,
    },
    checkpoint: commitPlan ? commitPlan.checkpoint : checkpoint,
    previousCheckpoint: checkpoint,
    totals: {
      fetched: rawMessages.length,
      new: annotated.length,
      alerts: alertCount,
      sent: true,
      mark: {
        succeeded: markResult.succeeded.length,
        failed: markResult.failed.length,
      },
    },
    report: {
      messageId: sendResult.messageId,
      subject: report.subject,
      html: report.html,
      text: report.text,
    },
    mark: markResult,
    commitPlan: commitPlan
      ? {
          checkpointJson: commitPlan.checkpointJson,
          commitMessage: commitPlan.commitMessage,
          newCount: commitPlan.newCount,
        }
      : null,
    runId,
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
