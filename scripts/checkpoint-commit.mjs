#!/usr/bin/env node
/**
 * Checkpoint update + git commit planning for the digest pipeline.
 *
 * This module is intentionally side-effect-free: it does NOT touch
 * the filesystem and it does NOT execute any git command. It receives
 * the current checkpoint and the freshly reported message IDs, merges
 * them, and returns:
 *
 *   - the new in-memory checkpoint
 *   - the JSON serialization the caller should write to
 *     state/reported-ids.json
 *   - the conventional-commits message the caller should pass to
 *     `git commit -m`
 *
 * The orchestrator (PR3) does the I/O:
 *   1. readCheckpoint() — load existing file
 *   2. buildCommitCheckpoint({ checkpoint, runId, newIds }) — merge
 *   3. writeCheckpoint() — persist the file atomically
 *   4. git add state/reported-ids.json && git commit -m "..." && git push
 *
 * Why no I/O here: keeping the merge pure makes it trivial to test
 * (the spec calls out order preservation, dedup, and commit message
 * content as testable behaviors) and lets the orchestrator control
 * when the file is actually written — critical because the checkpoint
 * MUST NOT be persisted if the send/mark steps failed.
 *
 * Contract — see `openspec/changes/informe-semanal-hotmail/specs/checkpoint/spec.md`:
 *   - reportedIds: append new IDs (in order) only if not already present.
 *     Existing entries keep their original `reportedAt` timestamp.
 *   - lastRunAt: updated to the current run timestamp.
 *   - commitMessage: contains `[skip ci]` and the runId so the next
 *     CI run on push does not re-trigger the workflow.
 */

const DEFAULT_VERSION = 1;
const CHECKPOINT_FILE = 'state/reported-ids.json';

function normalizeCheckpoint(checkpoint) {
  if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint)) {
    return { version: DEFAULT_VERSION, lastRunAt: null, reportedIds: [] };
  }
  return {
    version: typeof checkpoint.version === 'number' ? checkpoint.version : DEFAULT_VERSION,
    lastRunAt: typeof checkpoint.lastRunAt === 'string' ? checkpoint.lastRunAt : null,
    reportedIds: Array.isArray(checkpoint.reportedIds)
      ? checkpoint.reportedIds
          .filter((entry) => entry && typeof entry.id === 'string')
          .map((entry) => ({ id: entry.id, reportedAt: entry.reportedAt }))
      : [],
  };
}

/**
 * Build a conventional-commits style commit message for the checkpoint
 * update. Always includes `[skip ci]` and the runId.
 *
 * @param {{ newCount: number, runId: string }} opts
 * @returns {string}
 */
function renderCommitMessage({ newCount, runId }) {
  const noun = newCount === 1 ? 'mensaje' : 'mensajes';
  return [
    `chore(mail-digest): checkpoint ${newCount} nuevos ${noun} [skip ci]`,
    '',
    `Run ID: ${runId}`,
    `Updated file: ${CHECKPOINT_FILE}`,
  ].join('\n');
}

/**
 * Merges new reported IDs into the existing checkpoint, dedupes, and
 * returns the new in-memory state plus the data the orchestrator
 * needs to commit (JSON payload + commit message).
 *
 * @param {{
 *   checkpoint: { version?: number, lastRunAt?: string|null, reportedIds?: Array<{id: string, reportedAt?: string}> },
 *   runId: string,
 *   newIds?: string[],
 *   now?: string,
 * }} opts
 * @returns {{
 *   checkpoint: { version: number, lastRunAt: string|null, reportedIds: Array<{id: string, reportedAt?: string}> },
 *   checkpointJson: string,
 *   commitMessage: string,
 *   newCount: number,
 * }}
 */
export function buildCommitCheckpoint({ checkpoint, runId, newIds, now } = {}) {
  if (!runId || typeof runId !== 'string') {
    throw new TypeError('buildCommitCheckpoint: `runId` is required');
  }
  const base = normalizeCheckpoint(checkpoint);
  const timestamp = now || new Date().toISOString();
  const additions = Array.isArray(newIds) ? newIds.filter((id) => typeof id === 'string' && id.length > 0) : [];

  // Build a Set of IDs already present so we can dedup both within the
  // existing list and within the new additions.
  const seen = new Set();
  const merged = [];

  for (const entry of base.reportedIds) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    merged.push({
      id: entry.id,
      reportedAt: entry.reportedAt || timestamp,
    });
  }
  for (const id of additions) {
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push({ id, reportedAt: timestamp });
  }

  const updated = {
    version: base.version,
    lastRunAt: timestamp,
    reportedIds: merged,
  };
  const checkpointJson = JSON.stringify(updated, null, 2) + '\n';
  const newCount = additions.filter((id) => !base.reportedIds.some((e) => e.id === id)).length;

  return {
    checkpoint: updated,
    checkpointJson,
    commitMessage: renderCommitMessage({ newCount, runId }),
    newCount,
  };
}
