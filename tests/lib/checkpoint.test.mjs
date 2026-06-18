import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';

const TMP = path.join(os.tmpdir(), `checkpoint-test-${process.pid}-${Date.now()}`);

async function tmpPath(name = 'checkpoint.json') {
  return path.join(TMP, name);
}

async function ensureTmp() {
  await fs.mkdir(TMP, { recursive: true });
}

async function cleanupTmp() {
  await fs.rm(TMP, { recursive: true, force: true }).catch(() => {});
}

async function readJson(fp) {
  return JSON.parse(await fs.readFile(fp, 'utf8'));
}

beforeEach(async () => {
  await ensureTmp();
});

afterEach(async () => {
  await cleanupTmp();
});

describe('readCheckpoint — absent file', () => {
  it('should return empty checkpoint for missing file', async () => {
    const { readCheckpoint } = await import('../../scripts/lib/checkpoint.mjs');
    const fp = await tmpPath('missing.json');
    const cp = await readCheckpoint(fp);
    expect(cp).toEqual({
      version: 1,
      lastRunAt: null,
      reportedIds: [],
    });
  });

  it('should write an empty checkpoint file when file is absent', async () => {
    const { readCheckpoint } = await import('../../scripts/lib/checkpoint.mjs');
    const fp = await tmpPath('auto-create.json');
    await readCheckpoint(fp);
    const content = await readJson(fp);
    expect(content.version).toBe(1);
    expect(content.lastRunAt).toBeNull();
    expect(content.reportedIds).toEqual([]);
  });
});

describe('readCheckpoint — corrupt file', () => {
  it('should return empty checkpoint for corrupt JSON', async () => {
    const { readCheckpoint } = await import('../../scripts/lib/checkpoint.mjs');
    const fp = await tmpPath('corrupt.json');
    await fs.writeFile(fp, '{invalid json}', 'utf8');
    const cp = await readCheckpoint(fp);
    expect(cp).toEqual({
      version: 1,
      lastRunAt: null,
      reportedIds: [],
    });
  });

  it('should return empty checkpoint for truncated JSON', async () => {
    const { readCheckpoint } = await import('../../scripts/lib/checkpoint.mjs');
    const fp = await tmpPath('truncated.json');
    await fs.writeFile(fp, '{"version":1,"lastRunAt":', 'utf8');
    const cp = await readCheckpoint(fp);
    expect(cp.reportedIds).toEqual([]);
  });
});

describe('readCheckpoint — valid file', () => {
  it('should normalize and return valid checkpoint', async () => {
    const { readCheckpoint } = await import('../../scripts/lib/checkpoint.mjs');
    const fp = await tmpPath('valid.json');
    await fs.writeFile(fp, JSON.stringify({
      version: 1,
      lastRunAt: '2026-06-17T13:00:00.000Z',
      reportedIds: [
        { id: 'AAMkAD1', reportedAt: '2026-06-17T13:05:00.000Z' },
        { id: 'AAMkAD2' },
      ],
    }), 'utf8');
    const cp = await readCheckpoint(fp);
    expect(cp.version).toBe(1);
    expect(cp.lastRunAt).toBe('2026-06-17T13:00:00.000Z');
    expect(cp.reportedIds).toHaveLength(2);
    expect(cp.reportedIds[0].id).toBe('AAMkAD1');
    expect(cp.reportedIds[1].id).toBe('AAMkAD2');
  });

  it('should filter out invalid entries in reportedIds', async () => {
    const { readCheckpoint } = await import('../../scripts/lib/checkpoint.mjs');
    const fp = await tmpPath('mixed.json');
    await fs.writeFile(fp, JSON.stringify({
      version: 1,
      lastRunAt: null,
      reportedIds: [
        { id: 'valid-id' },
        null,
        { id: '' },
        42,
        { notId: true },
      ],
    }), 'utf8');
    const cp = await readCheckpoint(fp);
    // id="" passes typeof string check; null, 42, and missing id are filtered
    expect(cp.reportedIds).toHaveLength(2);
    expect(cp.reportedIds[0].id).toBe('valid-id');
    expect(cp.reportedIds[1].id).toBe('');
  });

  it('should handle non-object data by returning empty', async () => {
    const { readCheckpoint } = await import('../../scripts/lib/checkpoint.mjs');
    const fp = await tmpPath('non-obj.json');
    await fs.writeFile(fp, JSON.stringify([]), 'utf8');
    const cp = await readCheckpoint(fp);
    expect(cp.version).toBe(1);
    expect(cp.reportedIds).toEqual([]);
  });
});

describe('writeCheckpoint', () => {
  it('should write and allow readback', async () => {
    const { writeCheckpoint, readCheckpoint } = await import('../../scripts/lib/checkpoint.mjs');
    const fp = await tmpPath('roundtrip.json');
    const data = {
      version: 1,
      lastRunAt: '2026-06-17T14:00:00.000Z',
      reportedIds: [{ id: 'abc', reportedAt: '2026-06-17T14:05:00.000Z' }],
    };
    await writeCheckpoint(fp, data);
    const readback = await readCheckpoint(fp);
    expect(readback.version).toBe(1);
    expect(readback.lastRunAt).toBe('2026-06-17T14:00:00.000Z');
    expect(readback.reportedIds).toHaveLength(1);
    expect(readback.reportedIds[0].id).toBe('abc');
  });

  it('should normalize data before writing', async () => {
    const { writeCheckpoint, readCheckpoint } = await import('../../scripts/lib/checkpoint.mjs');
    const fp = await tmpPath('normalized.json');
    await writeCheckpoint(fp, { version: 99, lastRunAt: 'bad', reportedIds: [null, { id: 'ok' }, { id: '' }] });
    const readback = await readCheckpoint(fp);
    expect(readback.version).toBe(99);
    expect(readback.lastRunAt).toBe('bad');
    expect(readback.reportedIds).toHaveLength(2);
    expect(readback.reportedIds[0].id).toBe('ok');
    expect(readback.reportedIds[1].id).toBe('');
  });

  it('should throw CheckpointError for null data', async () => {
    const { writeCheckpoint, CheckpointError } = await import('../../scripts/lib/checkpoint.mjs');
    const fp = await tmpPath('null.json');
    await expect(writeCheckpoint(fp, null)).rejects.toThrow(CheckpointError);
  });

  it('should throw CheckpointError for non-object data', async () => {
    const { writeCheckpoint, CheckpointError } = await import('../../scripts/lib/checkpoint.mjs');
    const fp = await tmpPath('string.json');
    await expect(writeCheckpoint(fp, 'bad')).rejects.toThrow(CheckpointError);
  });

  it('should create parent directory if missing', async () => {
    const { writeCheckpoint, readCheckpoint } = await import('../../scripts/lib/checkpoint.mjs');
    const nested = await tmpPath('sub/deep/nested.json');
    await writeCheckpoint(nested, { lastRunAt: null, reportedIds: [] });
    const content = await readJson(nested);
    expect(content.version).toBe(1);
  });
});

describe('filterNewMessages', () => {
  it('should filter out already-reported IDs', async () => {
    const { filterNewMessages } = await import('../../scripts/lib/checkpoint.mjs');
    const messages = [
      { id: 'a' }, { id: 'b' }, { id: 'c' },
    ];
    const reported = new Set(['a', 'c']);
    const result = filterNewMessages(messages, reported);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('b');
  });

  it('should handle Set or array input', async () => {
    const { filterNewMessages } = await import('../../scripts/lib/checkpoint.mjs');
    const messages = [{ id: 'a' }, { id: 'b' }];
    expect(filterNewMessages(messages, ['a'])).toHaveLength(1);
    expect(filterNewMessages(messages, new Set(['b']))).toHaveLength(1);
  });

  it('should return empty array for non-array messages', async () => {
    const { filterNewMessages } = await import('../../scripts/lib/checkpoint.mjs');
    expect(filterNewMessages(null, new Set())).toEqual([]);
    expect(filterNewMessages(undefined, new Set())).toEqual([]);
    expect(filterNewMessages({}, new Set())).toEqual([]);
  });

  it('should filter out messages without string id', async () => {
    const { filterNewMessages } = await import('../../scripts/lib/checkpoint.mjs');
    const messages = [{ id: 'a' }, { id: undefined }, null, { id: 123 }];
    const result = filterNewMessages(messages, new Set());
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a');
  });
});

describe('reportedIdSet', () => {
  it('should build a Set of IDs from checkpoint', async () => {
    const { reportedIdSet } = await import('../../scripts/lib/checkpoint.mjs');
    const cp = {
      reportedIds: [
        { id: 'a' }, { id: 'b' }, { id: 'c' },
      ],
    };
    const set = reportedIdSet(cp);
    expect(set).toBeInstanceOf(Set);
    expect(set.size).toBe(3);
    expect(set.has('a')).toBe(true);
    expect(set.has('b')).toBe(true);
    expect(set.has('c')).toBe(true);
  });

  it('should handle checkpoint with no reportedIds', async () => {
    const { reportedIdSet } = await import('../../scripts/lib/checkpoint.mjs');
    const set = reportedIdSet({});
    expect(set.size).toBe(0);
  });

  it('should handle null checkpoint', async () => {
    const { reportedIdSet } = await import('../../scripts/lib/checkpoint.mjs');
    const set = reportedIdSet(null);
    expect(set.size).toBe(0);
  });

  it('should skip null entries but include empty string ids', async () => {
    const { reportedIdSet } = await import('../../scripts/lib/checkpoint.mjs');
    const cp = {
      reportedIds: [{ id: 'a' }, null, { id: '' }],
    };
    const set = reportedIdSet(cp);
    // id="" passes typeof string check
    expect(set.size).toBe(2);
    expect(set.has('a')).toBe(true);
    expect(set.has('')).toBe(true);
  });
});
