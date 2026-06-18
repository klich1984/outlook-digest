#!/usr/bin/env node
/**
 * CLI entry point for the weekly digest pipeline.
 *
 * PR1 scope: validate environment, call build-digest.mjs, emit the
 * annotated message array as JSON to stdout. Any failure exits
 * non-zero with a structured error JSON on stderr so `npm run dev:dry`
 * surfaces the failure clearly during onboarding.
 *
 * PR3 (orchestrator) will extend this file to:
 *   - Build the report via templates.mjs (send via gmail.mjs).
 *   - Mark messages as read via mark-read.mjs.
 *   - Write the checkpoint + rotate the MSAL cache.
 *   - On failure, send an error-report email via error-report.mjs.
 *
 * Flags:
 *   --dry-run   Run the pipeline but skip any side effects that touch
 *               Gmail or Hotmail (mark-as-read). PR1 already does this
 *               by default since send/mark-read are not wired yet;
 *               the flag is reserved for forward compatibility.
 */

import { buildDigest } from './build-digest.mjs';
import { createLogger } from './lib/logger.mjs';

function parseArgs(argv) {
  return {
    dryRun: argv.includes('--dry-run'),
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const log = createLogger({ base: { stage: 'index', dryRun: args.dryRun } });
  log.info('Iniciando pipeline', { dryRun: args.dryRun });

  // buildDigest already validates the env and surfaces a typed
  // ConfigError when any required variable is missing.
  const result = await buildDigest({ logger: log });
  log.info('Digest construido', {
    messages: result.totals.new,
    alerts: result.totals.alerts,
  });

  process.stdout.write(JSON.stringify(result.messages, null, 2) + '\n');
  process.exit(0);
}

main().catch((err) => {
  const payload = {
    ts: new Date().toISOString(),
    level: 'error',
    stage: err?.stage || 'unknown',
    name: err?.name || 'Error',
    message: err?.message || String(err),
  };
  if (err?.stack) {
    payload.stack = String(err.stack).split('\n').slice(0, 10).join('\n');
  }
  process.stderr.write(JSON.stringify(payload) + '\n');
  process.exit(1);
});
