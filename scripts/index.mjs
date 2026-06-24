#!/usr/bin/env node
/**
 * CLI entry point for the weekly digest pipeline.
 *
 * PR3a scope: full orchestrator that wraps build-digest.mjs and adds
 * the missing glue that the build-digest module intentionally leaves
 * to the caller:
 *
 *   - Pre-flight validation of the 6 required env vars (step 2 of
 *     the design). The error is raised BEFORE any network call so a
 *     missing secret surfaces in <1s instead of timing out later.
 *   - Dry-run mode: injects no-op send/mark mocks into buildDigest
 *     so the full pipeline runs end-to-end (token, Graph query,
 *     filter, alerts, report) without touching Gmail or Hotmail,
 *     then writes the rendered report to .local/report-preview.html
 *     for visual inspection.
 *   - Error routing: any stage that throws (token acquisition, Graph
 *     query, report build, Gmail send) sends an error-report email
 *     via the gmail.mjs helpers directly. The subject is prefixed
 *     with "ERROR:" so the failure stands out in the inbox.
 *   - Git commit step (step 12 of the design): when --commit is
 *     passed, runs `git add state/reported-ids.json` followed by
 *     `git commit -m "<commitMessage>"`. Local `dev:once` runs do
 *     NOT pass --commit so the working tree is not touched; the
 *     GitHub Actions workflow (PR3b) is the one that turns the
 *     local checkpoint file into a remote commit with [skip ci].
 *
 * Why no `error-report.mjs`: the original tasks.md referenced a
 * `scripts/error-report.mjs` helper, but the file does not exist in
 * the current tree. We build the error report inline using
 * `buildErrorReport` from `lib/templates.mjs` and send it with the
 * existing `sendMail` helper from `lib/gmail.mjs`. The templates
 * module already produces a self-contained HTML+text body with the
 * required stage / message / stack / runId / runUrl fields.
 *
 * Flags:
 *   --dry-run   Run the pipeline but skip any side effects that touch
 *               Gmail or Hotmail. Writes a report preview to
 *               .local/report-preview.html.
 *   --commit    After a successful run, commit the local checkpoint
 *               file (state/reported-ids.json) with the conventional
 *               "[skip ci]" message. Intended for CI use; local
 *               dev:once runs deliberately leave the commit to the
 *               GitHub Actions workflow so the working tree stays
 *               in sync with the user's manual edits.
 */

import { buildDigest } from './build-digest.mjs'
import { buildGmailClient, sendMail } from './lib/gmail.mjs'
import { buildErrorReport } from './lib/templates.mjs'
import { ConfigError } from './lib/errors.mjs'
import { createLogger } from './lib/logger.mjs'
import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const execFileAsync = promisify(execFileCb)

export const REQUIRED_ENV = Object.freeze([
  'HOTMAIL_ACCOUNT_ADDRESS',
  'MSAL_CLIENT_ID',
  'MSAL_TOKEN_CACHE_JSON',
  'GMAIL_OAUTH_CLIENT_ID',
  'GMAIL_OAUTH_CLIENT_SECRET',
  'GMAIL_OAUTH_REFRESH_TOKEN',
  'GMAIL_DESTINATION_ADDRESS',
])

export const CHECKPOINT_PATH = 'state/reported-ids.json'
export const PREVIEW_PATH = '.local/report-preview.html'

/**
 * Parses the small set of CLI flags this orchestrator understands.
 * Unknown flags are ignored (forward compatibility).
 *
 * @param {string[]} argv
 * @returns {{ dryRun: boolean, commit: boolean }}
 */
export function parseArgs(argv) {
  return {
    dryRun: Array.isArray(argv) && argv.includes('--dry-run'),
    commit: Array.isArray(argv) && argv.includes('--commit'),
  }
}

/**
 * Validates the 6 required env vars and returns a plain-object config
 * the rest of the pipeline consumes. Throws ConfigError with the list
 * of missing names so the user can fix them in one pass.
 *
 * @param {Record<string, string|undefined>} [env]
 * @returns {{
 *   hotmailAddress: string,
 *   msalTokenCacheJson: string,
 *   gmailClientId: string,
 *   gmailClientSecret: string,
 *   gmailRefreshToken: string,
 *   gmailDestination: string,
 * }}
 */
export function validateEnv(env = process.env) {
  const missing = REQUIRED_ENV.filter((k) => !env[k] || String(env[k]).trim() === '')
  if (missing.length > 0) {
    throw new ConfigError(
      `Faltan variables de entorno: ${missing.join(', ')}. Configúralas en .env (ver .env.example).`,
      'config'
    )
  }
  return {
    hotmailAddress: env.HOTMAIL_ACCOUNT_ADDRESS,
    msalClientId: env.MSAL_CLIENT_ID,
    msalTokenCacheJson: env.MSAL_TOKEN_CACHE_JSON,
    gmailClientId: env.GMAIL_OAUTH_CLIENT_ID,
    gmailClientSecret: env.GMAIL_OAUTH_CLIENT_SECRET,
    gmailRefreshToken: env.GMAIL_OAUTH_REFRESH_TOKEN,
    gmailDestination: env.GMAIL_DESTINATION_ADDRESS,
  }
}

/**
 * Builds the runUrl from GitHub Actions env vars when available, or
 * returns 'n/a' for local runs.
 *
 * @returns {string}
 */
function buildRunUrl() {
  const server = process.env.GITHUB_SERVER_URL
  const repo = process.env.GITHUB_REPOSITORY
  const runId = process.env.GITHUB_RUN_ID
  if (server && repo && runId) {
    return `${server}/${repo}/actions/runs/${runId}`
  }
  return 'n/a'
}

/**
 * Sends an error-report email using the gmail.mjs helpers. The
 * subject is prefixed with "ERROR:" so the email stands out in the
 * inbox. The sender and recipient are both GMAIL_DESTINATION_ADDRESS
 * because the user's own inbox is the only place the error
 * notification is useful.
 *
 * Errors thrown by the email send itself are re-raised to the caller
 * (the caller logs them and still returns a non-zero exit code).
 *
 * @param {{
 *   err: Error & { stage?: string },
 *   runId?: string,
 *   config: ReturnType<typeof validateEnv>,
 *   nowIso?: string,
 *   buildGmailClientImpl?: typeof buildGmailClient,
 *   sendMailImpl?: typeof sendMail,
 *   buildErrorReportImpl?: typeof buildErrorReport,
 * }} opts
 */
export async function sendErrorEmail({
  err,
  runId = 'unknown',
  config,
  nowIso = new Date().toISOString(),
  buildGmailClientImpl = buildGmailClient,
  sendMailImpl = sendMail,
  buildErrorReportImpl = buildErrorReport,
}) {
  const stage = err?.stage || 'unknown'
  const errorMessage = err?.message || String(err)
  const errorStack = err?.stack || ''
  const runUrl = buildRunUrl()

  const report = buildErrorReportImpl({
    stage,
    errorMessage,
    errorStack,
    runId,
    runUrl,
    nowIso,
  })

  const client = await buildGmailClientImpl({
    clientId: config.gmailClientId,
    clientSecret: config.gmailClientSecret,
    refreshToken: config.gmailRefreshToken,
  })

  const subject = `ERROR: Reporte semanal Hotmail — ${nowIso}`
  await sendMailImpl(client, {
    from: config.gmailDestination,
    to: config.gmailDestination,
    subject,
    html: report.html,
    text: report.text,
  })
}

/**
 * Runs `git add <checkpointPath> && git commit -m <commitMessage>`.
 * Throws whatever the underlying child_process error looks like
 * (typically an Error with stderr captured). The orchestrator's
 * caller catches the throw and routes an error-report email.
 *
 * @param {{
 *   commitMessage: string,
 *   checkpointPath?: string,
 *   execGitImpl?: typeof execFileAsync,
 * }} opts
 */
export async function commitCheckpoint({
  commitMessage,
  checkpointPath = CHECKPOINT_PATH,
  execGitImpl = execFileAsync,
}) {
  await execGitImpl('git', ['add', checkpointPath])
  await execGitImpl('git', ['commit', '-m', commitMessage])
}

/**
 * Main entry point of the orchestrator. Returns a structured envelope
 * so the CLI wrapper (and the tests) can inspect the outcome without
 * relying on process.exit.
 *
 * @param {{
 *   args: { dryRun?: boolean, commit?: boolean },
 *   env?: Record<string, string|undefined>,
 *   cwd?: string,
 *   buildDigestImpl?: typeof buildDigest,
 *   buildGmailClientImpl?: typeof buildGmailClient,
 *   sendMailImpl?: typeof sendMail,
 *   buildErrorReportImpl?: typeof buildErrorReport,
 *   execGitImpl?: typeof execFileAsync,
 *   mkdirImpl?: typeof mkdir,
 *   writeFileImpl?: typeof writeFile,
 *   previewPath?: string,
 *   checkpointPath?: string,
 *   loggerImpl?: ReturnType<typeof createLogger>,
 * }} [opts]
 * @returns {Promise<{
 *   exitCode: number,
 *   error?: Error,
 *   result?: object,
 *   dryRun?: boolean,
 *   noNewMessages?: boolean,
 *   markTotalFailure?: boolean,
 *   commitFailed?: boolean,
 * }>}
 */
export async function runPipeline(opts = {}) {
  const args = opts.args || {}
  const env = opts.env || process.env
  const cwd = opts.cwd || process.cwd()
  const log =
    opts.loggerImpl || createLogger({ base: { stage: 'index', dryRun: !!args.dryRun } })
  const previewPath = opts.previewPath || PREVIEW_PATH
  const checkpointPath = opts.checkpointPath || CHECKPOINT_PATH

  log.info('Iniciando pipeline', { dryRun: !!args.dryRun, commit: !!args.commit })

  // Step 2 — validate the 6 secrets BEFORE any network call so a
  // missing credential surfaces in <1s with a clear error.
  let config
  try {
    config = validateEnv(env)
  } catch (err) {
    log.error('Validación de entorno falló', {
      stage: err.stage || 'config',
      message: err.message || String(err),
    })
    await trySendErrorEmail({
      err,
      runId: 'unknown',
      config: null,
      log,
      buildGmailClientImpl: opts.buildGmailClientImpl,
      sendMailImpl: opts.sendMailImpl,
      buildErrorReportImpl: opts.buildErrorReportImpl,
    }).catch((sendErr) => {
      // No Gmail creds (we never validated) → only log the failure.
      log.error('No se pudo enviar correo de error (credenciales ausentes)', {
        error: sendErr.message,
      })
    })
    return { exitCode: 1, error: err }
  }

  // Build the buildDigest options. The orchestrator injects no-op
  // implementations for the side effects in dry-run mode so the
  // pipeline runs end-to-end without touching Gmail or Hotmail.
  const buildOpts = {
    config,
    logger: log,
    checkpointPath,
  }
  if (args.dryRun) {
    buildOpts.buildGmailClientImpl = async () => ({ __dryRun: true })
    buildOpts.sendMailImpl = async () => ({ messageId: 'dry-run' })
    buildOpts.markAsReadImpl = async () => ({ succeeded: [], failed: [] })
  }

  // Steps 1-11 of the design live inside buildDigest.
  // Fall back to the real buildDigest when called from the CLI; tests
  // inject a mock via opts.buildDigestImpl.
  const buildDigestFn = opts.buildDigestImpl || buildDigest;
  let result
  try {
    result = await buildDigestFn(buildOpts)
  } catch (err) {
    log.error('Pipeline falló', {
      stage: err.stage || 'unknown',
      message: err.message || String(err),
      stack: err.stack ? String(err.stack).split('\n').slice(0, 5).join('\n') : '',
    })
    await trySendErrorEmail({
      err,
      runId: 'unknown',
      config,
      log,
      buildGmailClientImpl: opts.buildGmailClientImpl,
      sendMailImpl: opts.sendMailImpl,
      buildErrorReportImpl: opts.buildErrorReportImpl,
    })
    return { exitCode: 1, error: err }
  }

  log.info('Pipeline construido', {
    fetched: result.totals?.fetched,
    new: result.totals?.new,
    alerts: result.totals?.alerts,
    sent: result.totals?.sent,
  })

  // Dry-run: write the rendered report to disk for visual inspection.
  // No send / no mark / no commit. Exit 0.
  if (args.dryRun) {
    if (result.report && result.report.html) {
      const absolutePreview = path.isAbsolute(previewPath)
        ? previewPath
        : path.join(cwd, previewPath)
      await opts.mkdirImpl(path.dirname(absolutePreview), { recursive: true })
      await opts.writeFileImpl(absolutePreview, result.report.html, 'utf8')
      log.info('Dry-run completo; vista previa escrita', { path: absolutePreview })
    } else {
      log.info('Dry-run completo; sin reporte para previsualizar', {
        reason: 'no new messages',
      })
    }
    return { exitCode: 0, dryRun: true, result }
  }

  // No new messages: short-circuit. buildDigest already avoided
  // send/mark/checkpoint-write; the orchestrator just needs to skip
  // the commit step. Exit 0 (this is the design's "happy idle" path).
  if (!result.totals || result.totals.new === 0) {
    log.info('Sin mensajes nuevos; sin envío, sin mark-read, sin commit')
    return { exitCode: 0, noNewMessages: true, result }
  }

  // Total mark-read failure: every ID in the batch failed. The
  // checkpoint is intentionally NOT updated (buildDigest handles
  // that), so we route this as an error-report email and exit 1.
  if (
    result.mark &&
    Array.isArray(result.mark.succeeded) &&
    result.mark.succeeded.length === 0 &&
    Array.isArray(result.mark.failed) &&
    result.mark.failed.length > 0
  ) {
    const err = new Error(
      `mark-read falló completamente: ${result.mark.failed.length} IDs no se pudieron marcar`
    )
    err.stage = 'mark-read'
    log.error('mark-read falló completamente', {
      failed: result.mark.failed.length,
    })
    await trySendErrorEmail({
      err,
      runId: result.runId,
      config,
      log,
      buildGmailClientImpl: opts.buildGmailClientImpl,
      sendMailImpl: opts.sendMailImpl,
      buildErrorReportImpl: opts.buildErrorReportImpl,
    })
    return { exitCode: 1, markTotalFailure: true, result }
  }

  // Partial mark-read failure: buildDigest only writes the
  // successful IDs to the checkpoint, which is the correct
  // behaviour (failed IDs will be retried in the next run). The
  // orchestrator logs the failed count and continues.
  if (result.mark && Array.isArray(result.mark.failed) && result.mark.failed.length > 0) {
    log.warn('mark-read parcial', {
      succeeded: result.mark.succeeded.length,
      failed: result.mark.failed.length,
    })
  }

  // Step 12 — git commit + push. Only when --commit is passed.
  // Local `dev:once` runs deliberately skip this so the working
  // tree is not modified; the GitHub Actions workflow (PR3b) is the
  // one that turns the local checkpoint into a remote commit.
  if (args.commit && result.commitPlan) {
    try {
      await commitCheckpoint({
        commitMessage: result.commitPlan.commitMessage,
        checkpointPath,
        execGitImpl: opts.execGitImpl,
      })
      log.info('Checkpoint confirmado en git', {
        newCount: result.commitPlan.newCount,
      })
    } catch (err) {
      const wrapped = new Error(`git commit falló: ${err.message || String(err)}`)
      wrapped.stage = 'checkpoint-commit'
      if (err.stack) wrapped.stack = err.stack
      log.error('git commit falló', { error: wrapped.message })
      await trySendErrorEmail({
        err: wrapped,
        runId: result.runId,
        config,
        log,
        buildGmailClientImpl: opts.buildGmailClientImpl,
        sendMailImpl: opts.sendMailImpl,
        buildErrorReportImpl: opts.buildErrorReportImpl,
      })
      return { exitCode: 1, commitFailed: true, result }
    }
  }

  log.info('Pipeline completo', {
    new: result.totals.new,
    sent: result.totals.sent,
  })
  return { exitCode: 0, result }
}

/**
 * Internal helper that wraps sendErrorEmail with the project's
 * "never crash the pipeline because the error email failed"
 * invariant. Logs the error email failure but never rethrows.
 */
async function trySendErrorEmail({
  err,
  runId,
  config,
  log,
  buildGmailClientImpl,
  sendMailImpl,
  buildErrorReportImpl,
}) {
  if (!config) {
    // We never got the Gmail creds (env validation failed). There is
    // no useful email we can send — the error lives in the GH
    // Actions logs only.
    return
  }
  try {
    await sendErrorEmail({
      err,
      runId,
      config,
      buildGmailClientImpl,
      sendMailImpl,
      buildErrorReportImpl,
    })
  } catch (sendErr) {
    log.error('Falló el envío del correo de error', {
      error: sendErr.message,
      originalStage: err.stage,
    })
  }
}

// ─────────────────────────────────────────────────────────────────
// CLI entry point
// ─────────────────────────────────────────────────────────────────

async function cliMain() {
  const args = parseArgs(process.argv.slice(2))
  try {
    const out = await runPipeline({ args })
    process.exit(out.exitCode)
  } catch (err) {
    const payload = {
      ts: new Date().toISOString(),
      level: 'error',
      stage: err?.stage || 'unknown',
      name: err?.name || 'Error',
      message: err?.message || String(err),
    }
    if (err?.stack) {
      payload.stack = String(err.stack).split('\n').slice(0, 10).join('\n')
    }
    process.stderr.write(JSON.stringify(payload) + '\n')
    process.exit(1)
  }
}

// Run as CLI when invoked directly (`node scripts/index.mjs`).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  cliMain()
}
