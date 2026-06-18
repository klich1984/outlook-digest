#!/usr/bin/env node
/**
 * Public surface for the Gmail delivery stage of the digest pipeline.
 *
 * This module is a thin re-export over `scripts/lib/gmail.mjs`. The
 * orchestrator (PR3) imports `{ sendMail, buildGmailClient }` from
 * here so the script-level layout of the project stays consistent
 * (one entry file per stage at the top level of `scripts/`) while the
 * actual implementation lives in the `lib/` folder where it can be
 * unit-tested in isolation.
 *
 * Contract — see `openspec/changes/informe-semanal-hotmail/specs/gmail-delivery/spec.md`:
 *   - sendMail(client, { from, to, subject, html, text })
 *       - returns { messageId } on success
 *       - retries once on transient (5xx / 429 / network) errors
 *       - throws GmailError(stage="gmail-auth") on 401/403 (no retry)
 *       - throws GmailError(stage="gmail-send") after retries exhausted
 *       - throws ConfigError(stage="gmail-config") on missing from/to/subject
 */

export { buildGmailClient, sendMail } from './lib/gmail.mjs';
