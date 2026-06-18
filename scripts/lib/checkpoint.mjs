/**
 * Checkpoint persistence for the weekly digest pipeline.
 *
 * The checkpoint stores the IDs of messages already reported so that a
 * re-run on the same day doesn't send a duplicate report. The on-disk
 * format is:
 *
 *   {
 *     "version": 1,
 *     "lastRunAt": "2026-06-17T13:00:00.000Z" | null,
 *     "reportedIds": [
 *       { "id": "AAMkAD...", "reportedAt": "2026-06-17T13:05:00.000Z" }
 *     ]
 *   }
 *
 * Per the spec, the file is committed to the repo with [skip ci] by the
 * GitHub Actions workflow. Local runs write the same file but do not
 * commit it.
 *
 * Concurrency: the spec assumes sequential runs (cron + workflow_dispatch
 * with a concurrency group). No file locking is implemented.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { CheckpointError } from './errors.mjs';

const DEFAULT_VERSION = 1;
const DEFAULT_PATH = 'state/reported-ids.json';

function emptyCheckpoint() {
  return {
    version: DEFAULT_VERSION,
    lastRunAt: null,
    reportedIds: [],
  };
}

function normalize(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return emptyCheckpoint();
  }
  return {
    version: typeof data.version === 'number' ? data.version : DEFAULT_VERSION,
    lastRunAt: typeof data.lastRunAt === 'string' ? data.lastRunAt : null,
    reportedIds: Array.isArray(data.reportedIds)
      ? data.reportedIds.filter((entry) => entry && typeof entry.id === 'string')
      : [],
  };
}

/**
 * Reads the checkpoint from `filePath`. If the file is missing or
 * corrupt, returns a fresh empty checkpoint (the spec treats a missing
 * checkpoint as "first run" and a corrupt one as recoverable).
 *
 * @param {string} [filePath]
 * @returns {Promise<{ version: number, lastRunAt: string|null, reportedIds: Array<{id: string, reportedAt?: string}> }>}
 */
export async function readCheckpoint(filePath = DEFAULT_PATH) {
  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      // First run: bootstrap an empty checkpoint on disk so the next
      // read finds a valid file.
      const fresh = emptyCheckpoint();
      await writeCheckpoint(filePath, fresh);
      return fresh;
    }
    throw new CheckpointError(
      `No se pudo leer el checkpoint: ${err.message}`,
      'checkpoint-read',
    );
  }

  try {
    return normalize(JSON.parse(raw));
  } catch (err) {
    // Corrupt JSON is recoverable per spec; start fresh.
    return emptyCheckpoint();
  }
}

/**
 * Writes the checkpoint atomically using a write-temp + rename. This
 * avoids leaving a half-written file if the process is interrupted.
 *
 * @param {string} [filePath]
 * @param {{ version: number, lastRunAt: string|null, reportedIds: Array<{id: string, reportedAt?: string}> }} checkpoint
 * @returns {Promise<void>}
 */
export async function writeCheckpoint(filePath = DEFAULT_PATH, checkpoint) {
  if (!checkpoint || typeof checkpoint !== 'object') {
    throw new CheckpointError('Checkpoint inválido', 'checkpoint-write');
  }
  const payload = JSON.stringify(normalize(checkpoint), null, 2) + '\n';
  const dir = path.dirname(filePath);
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}`;

  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(tmp, payload, { encoding: 'utf8', mode: 0o644 });
    await fs.rename(tmp, filePath);
  } catch (err) {
    // Best-effort cleanup of the temp file; ignore secondary errors.
    await fs.unlink(tmp).catch(() => {});
    throw new CheckpointError(
      `No se pudo escribir el checkpoint: ${err.message}`,
      'checkpoint-write',
    );
  }
}

/**
 * Filters messages whose `id` is not present in `reportedIds`.
 *
 * @template {{ id: string }} T
 * @param {T[]} messages
 * @param {Set<string>} reportedIds
 * @returns {T[]}
 */
export function filterNewMessages(messages, reportedIds) {
  if (!Array.isArray(messages)) return [];
  if (!(reportedIds instanceof Set)) {
    reportedIds = new Set(reportedIds || []);
  }
  return messages.filter((m) => m && typeof m.id === 'string' && !reportedIds.has(m.id));
}

/**
 * Builds the Set of reported IDs from a checkpoint.
 *
 * @param {{ reportedIds: Array<{id: string}> }} checkpoint
 * @returns {Set<string>}
 */
export function reportedIdSet(checkpoint) {
  const set = new Set();
  if (checkpoint && Array.isArray(checkpoint.reportedIds)) {
    for (const entry of checkpoint.reportedIds) {
      if (entry && typeof entry.id === 'string') set.add(entry.id);
    }
  }
  return set;
}
