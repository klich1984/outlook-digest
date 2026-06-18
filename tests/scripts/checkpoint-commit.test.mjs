import { describe, it, expect } from 'vitest';

const FIXED_NOW = '2026-06-17T13:05:00.000Z';

describe('scripts/checkpoint-commit.mjs — public surface', () => {
  it('exports buildCommitCheckpoint as a function', async () => {
    const mod = await import('../../scripts/checkpoint-commit.mjs');
    expect(typeof mod.buildCommitCheckpoint).toBe('function');
  });
});

describe('buildCommitCheckpoint — adding new IDs', () => {
  it('preserves existing IDs in their original order', async () => {
    const { buildCommitCheckpoint } = await import('../../scripts/checkpoint-commit.mjs');
    const checkpoint = {
      version: 1,
      lastRunAt: '2026-06-10T13:00:00.000Z',
      reportedIds: [
        { id: 'A', reportedAt: '2026-06-10T13:05:00.000Z' },
        { id: 'B', reportedAt: '2026-06-11T13:05:00.000Z' },
      ],
    };
    const result = buildCommitCheckpoint({
      checkpoint,
      runId: 'run-1',
      newIds: ['C', 'D'],
      now: FIXED_NOW,
    });
    const ids = result.checkpoint.reportedIds.map((e) => e.id);
    expect(ids).toEqual(['A', 'B', 'C', 'D']);
  });

  it('preserves existing timestamps verbatim', async () => {
    const { buildCommitCheckpoint } = await import('../../scripts/checkpoint-commit.mjs');
    const checkpoint = {
      version: 1,
      lastRunAt: '2026-06-10T13:00:00.000Z',
      reportedIds: [
        { id: 'A', reportedAt: '2026-06-10T13:05:00.000Z' },
        { id: 'B', reportedAt: '2026-06-11T13:05:00.000Z' },
      ],
    };
    const result = buildCommitCheckpoint({
      checkpoint,
      runId: 'run-1',
      newIds: ['C'],
      now: FIXED_NOW,
    });
    expect(result.checkpoint.reportedIds[0]).toEqual({
      id: 'A',
      reportedAt: '2026-06-10T13:05:00.000Z',
    });
    expect(result.checkpoint.reportedIds[1]).toEqual({
      id: 'B',
      reportedAt: '2026-06-11T13:05:00.000Z',
    });
  });

  it('assigns the new IDs the same reportedAt = now', async () => {
    const { buildCommitCheckpoint } = await import('../../scripts/checkpoint-commit.mjs');
    const checkpoint = {
      version: 1,
      lastRunAt: null,
      reportedIds: [],
    };
    const result = buildCommitCheckpoint({
      checkpoint,
      runId: 'run-1',
      newIds: ['C', 'D'],
      now: FIXED_NOW,
    });
    expect(result.checkpoint.reportedIds).toEqual([
      { id: 'C', reportedAt: FIXED_NOW },
      { id: 'D', reportedAt: FIXED_NOW },
    ]);
  });

  it('updates lastRunAt to the current run timestamp', async () => {
    const { buildCommitCheckpoint } = await import('../../scripts/checkpoint-commit.mjs');
    const checkpoint = {
      version: 1,
      lastRunAt: '2026-06-10T13:00:00.000Z',
      reportedIds: [{ id: 'A', reportedAt: '2026-06-10T13:05:00.000Z' }],
    };
    const result = buildCommitCheckpoint({
      checkpoint,
      runId: 'run-1',
      newIds: ['B'],
      now: FIXED_NOW,
    });
    expect(result.checkpoint.lastRunAt).toBe(FIXED_NOW);
  });

  it('returns checkpointJson as a parseable JSON string', async () => {
    const { buildCommitCheckpoint } = await import('../../scripts/checkpoint-commit.mjs');
    const checkpoint = {
      version: 1,
      lastRunAt: null,
      reportedIds: [],
    };
    const result = buildCommitCheckpoint({
      checkpoint,
      runId: 'run-1',
      newIds: ['A'],
      now: FIXED_NOW,
    });
    expect(typeof result.checkpointJson).toBe('string');
    const parsed = JSON.parse(result.checkpointJson);
    expect(parsed.reportedIds[0].id).toBe('A');
    expect(parsed.lastRunAt).toBe(FIXED_NOW);
  });
});

describe('buildCommitCheckpoint — empty newIds', () => {
  it('returns the checkpoint with reportedIds unchanged', async () => {
    const { buildCommitCheckpoint } = await import('../../scripts/checkpoint-commit.mjs');
    const checkpoint = {
      version: 1,
      lastRunAt: '2026-06-10T13:00:00.000Z',
      reportedIds: [
        { id: 'A', reportedAt: '2026-06-10T13:05:00.000Z' },
        { id: 'B', reportedAt: '2026-06-11T13:05:00.000Z' },
      ],
    };
    const result = buildCommitCheckpoint({
      checkpoint,
      runId: 'run-1',
      newIds: [],
      now: FIXED_NOW,
    });
    expect(result.checkpoint.reportedIds).toHaveLength(2);
    expect(result.checkpoint.reportedIds.map((e) => e.id)).toEqual(['A', 'B']);
  });

  it('still updates lastRunAt when newIds is empty (a run did happen)', async () => {
    const { buildCommitCheckpoint } = await import('../../scripts/checkpoint-commit.mjs');
    const checkpoint = {
      version: 1,
      lastRunAt: '2026-06-10T13:00:00.000Z',
      reportedIds: [{ id: 'A', reportedAt: '2026-06-10T13:05:00.000Z' }],
    };
    const result = buildCommitCheckpoint({
      checkpoint,
      runId: 'run-1',
      newIds: [],
      now: FIXED_NOW,
    });
    expect(result.checkpoint.lastRunAt).toBe(FIXED_NOW);
  });

  it('defaults newIds to [] when omitted', async () => {
    const { buildCommitCheckpoint } = await import('../../scripts/checkpoint-commit.mjs');
    const checkpoint = {
      version: 1,
      lastRunAt: null,
      reportedIds: [{ id: 'A' }],
    };
    const result = buildCommitCheckpoint({
      checkpoint,
      runId: 'run-1',
      now: FIXED_NOW,
    });
    expect(result.checkpoint.reportedIds).toHaveLength(1);
  });
});

describe('buildCommitCheckpoint — dedup', () => {
  it('does not duplicate an ID that exists in the checkpoint', async () => {
    const { buildCommitCheckpoint } = await import('../../scripts/checkpoint-commit.mjs');
    const checkpoint = {
      version: 1,
      lastRunAt: '2026-06-10T13:00:00.000Z',
      reportedIds: [{ id: 'A', reportedAt: '2026-06-10T13:05:00.000Z' }],
    };
    const result = buildCommitCheckpoint({
      checkpoint,
      runId: 'run-1',
      newIds: ['A', 'B'],
      now: FIXED_NOW,
    });
    const ids = result.checkpoint.reportedIds.map((e) => e.id);
    expect(ids).toEqual(['A', 'B']);
    // A keeps its original timestamp, not the new one.
    expect(result.checkpoint.reportedIds[0].reportedAt).toBe('2026-06-10T13:05:00.000Z');
  });

  it('does not duplicate an ID that appears multiple times in newIds', async () => {
    const { buildCommitCheckpoint } = await import('../../scripts/checkpoint-commit.mjs');
    const checkpoint = {
      version: 1,
      lastRunAt: null,
      reportedIds: [],
    };
    const result = buildCommitCheckpoint({
      checkpoint,
      runId: 'run-1',
      newIds: ['A', 'B', 'A', 'C', 'B'],
      now: FIXED_NOW,
    });
    const ids = result.checkpoint.reportedIds.map((e) => e.id);
    expect(ids).toEqual(['A', 'B', 'C']);
  });
});

describe('buildCommitCheckpoint — commitMessage', () => {
  it('includes the [skip ci] token', async () => {
    const { buildCommitCheckpoint } = await import('../../scripts/checkpoint-commit.mjs');
    const result = buildCommitCheckpoint({
      checkpoint: { version: 1, lastRunAt: null, reportedIds: [] },
      runId: '1234567890',
      newIds: ['A'],
      now: FIXED_NOW,
    });
    expect(result.commitMessage).toContain('[skip ci]');
  });

  it('includes the runId', async () => {
    const { buildCommitCheckpoint } = await import('../../scripts/checkpoint-commit.mjs');
    const result = buildCommitCheckpoint({
      checkpoint: { version: 1, lastRunAt: null, reportedIds: [] },
      runId: 'run-id-987',
      newIds: ['A'],
      now: FIXED_NOW,
    });
    expect(result.commitMessage).toContain('run-id-987');
  });

  it('includes the count of new IDs', async () => {
    const { buildCommitCheckpoint } = await import('../../scripts/checkpoint-commit.mjs');
    const result = buildCommitCheckpoint({
      checkpoint: { version: 1, lastRunAt: null, reportedIds: [] },
      runId: 'r1',
      newIds: ['A', 'B', 'C'],
      now: FIXED_NOW,
    });
    expect(result.commitMessage).toMatch(/3/);
  });

  it('uses 0 for the count when no new IDs are added', async () => {
    const { buildCommitCheckpoint } = await import('../../scripts/checkpoint-commit.mjs');
    const result = buildCommitCheckpoint({
      checkpoint: { version: 1, lastRunAt: null, reportedIds: [{ id: 'A' }] },
      runId: 'r1',
      newIds: [],
      now: FIXED_NOW,
    });
    expect(result.commitMessage).toMatch(/0/);
  });
});

describe('buildCommitCheckpoint — version preservation', () => {
  it('preserves the version field unchanged', async () => {
    const { buildCommitCheckpoint } = await import('../../scripts/checkpoint-commit.mjs');
    const checkpoint = {
      version: 7,
      lastRunAt: null,
      reportedIds: [],
    };
    const result = buildCommitCheckpoint({
      checkpoint,
      runId: 'r1',
      newIds: ['A'],
      now: FIXED_NOW,
    });
    expect(result.checkpoint.version).toBe(7);
  });

  it('handles checkpoint with missing optional fields', async () => {
    const { buildCommitCheckpoint } = await import('../../scripts/checkpoint-commit.mjs');
    const result = buildCommitCheckpoint({
      checkpoint: {},
      runId: 'r1',
      newIds: ['A'],
      now: FIXED_NOW,
    });
    expect(result.checkpoint.version).toBe(1);
    expect(result.checkpoint.reportedIds).toHaveLength(1);
    expect(result.checkpoint.reportedIds[0].id).toBe('A');
  });
});
