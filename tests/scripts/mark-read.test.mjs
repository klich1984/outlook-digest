import { describe, it, expect, vi } from 'vitest';

/**
 * Helper: builds a mock fetch implementation that returns a sequence of
 * `behaviors` (one per call). Each entry is either:
 *   - { status, responses }  → resolves with a $batch response
 *   - { status, body }       → resolves with a non-2xx Graph response
 *   - Error                  → throws (network / 5xx)
 *
 * Tracks the number of calls and captures the request bodies so tests
 * can assert on the Graph $batch payload structure.
 */
function makeMockFetch(behaviors) {
  const calls = [];
  let i = 0;
  const fetch = vi.fn(async (url, init) => {
    calls.push({ url, init });
    const behavior = behaviors[i++];
    if (behavior instanceof Error) throw behavior;
    return {
      ok: behavior.status >= 200 && behavior.status < 300,
      status: behavior.status,
      json: async () => behavior.json ?? { responses: behavior.responses ?? [] },
      text: async () => behavior.body ?? '',
    };
  });
  return { fetch, calls };
}

function makeOkResponse(subResponses) {
  return { status: 200, json: { responses: subResponses } };
}

function makeErrorResponse(status, body = 'fail') {
  return { status, body };
}

describe('scripts/mark-read.mjs — public surface', () => {
  it('exports markAsRead as a function', async () => {
    const mod = await import('../../scripts/mark-read.mjs');
    expect(typeof mod.markAsRead).toBe('function');
  });
});

describe('markAsRead — happy path', () => {
  it('1 message → 1 fetch call, 1 succeeded, 0 failed', async () => {
    const { markAsRead } = await import('../../scripts/mark-read.mjs');
    const { fetch, calls } = makeMockFetch([
      makeOkResponse([{ id: '0', status: 200, body: { isRead: true } }]),
    ]);
    const result = await markAsRead({
      accessToken: 'tok',
      messageIds: ['m1'],
      fetchImpl: fetch,
    });
    expect(calls).toHaveLength(1);
    expect(result.succeeded).toEqual(['m1']);
    expect(result.failed).toEqual([]);
  });
});

describe('markAsRead — batch boundaries', () => {
  it('20 messages → 1 batch', async () => {
    const { markAsRead } = await import('../../scripts/mark-read.mjs');
    const ids = Array.from({ length: 20 }, (_, i) => `m${i}`);
    const subResponses = ids.map((_, i) => ({ id: String(i), status: 200 }));
    const { fetch, calls } = makeMockFetch([makeOkResponse(subResponses)]);
    const result = await markAsRead({
      accessToken: 'tok',
      messageIds: ids,
      batchSize: 20,
      fetchImpl: fetch,
    });
    expect(calls).toHaveLength(1);
    // The batch body should contain exactly 20 sub-requests.
    const body = JSON.parse(calls[0].init.body);
    expect(body.requests).toHaveLength(20);
    expect(result.succeeded).toEqual(ids);
    expect(result.failed).toEqual([]);
  });

  it('21 messages → 2 batches (20 + 1)', async () => {
    const { markAsRead } = await import('../../scripts/mark-read.mjs');
    const ids = Array.from({ length: 21 }, (_, i) => `m${i}`);
    const first = Array.from({ length: 20 }, (_, i) => ({ id: String(i), status: 200 }));
    const second = [{ id: '0', status: 200 }];
    const { fetch, calls } = makeMockFetch([
      makeOkResponse(first),
      makeOkResponse(second),
    ]);
    const result = await markAsRead({
      accessToken: 'tok',
      messageIds: ids,
      batchSize: 20,
      fetchImpl: fetch,
    });
    expect(calls).toHaveLength(2);
    const body1 = JSON.parse(calls[0].init.body);
    const body2 = JSON.parse(calls[1].init.body);
    expect(body1.requests).toHaveLength(20);
    expect(body2.requests).toHaveLength(1);
    expect(result.succeeded).toEqual(ids);
    expect(result.failed).toEqual([]);
  });

  it('40 messages → 2 batches (20 + 20)', async () => {
    const { markAsRead } = await import('../../scripts/mark-read.mjs');
    const ids = Array.from({ length: 40 }, (_, i) => `m${i}`);
    const subRes = (offset, n) =>
      Array.from({ length: n }, (_, i) => ({ id: String(i + offset), status: 200 }));
    const { fetch, calls } = makeMockFetch([
      makeOkResponse(subRes(0, 20)),
      makeOkResponse(subRes(0, 20)),
    ]);
    await markAsRead({
      accessToken: 'tok',
      messageIds: ids,
      batchSize: 20,
      fetchImpl: fetch,
    });
    expect(calls).toHaveLength(2);
    const body1 = JSON.parse(calls[0].init.body);
    const body2 = JSON.parse(calls[1].init.body);
    expect(body1.requests).toHaveLength(20);
    expect(body2.requests).toHaveLength(20);
  });
});

describe('markAsRead — retry per batch', () => {
  it('retries once on 503, succeeds on the 2nd attempt', async () => {
    const { markAsRead } = await import('../../scripts/mark-read.mjs');
    const transient = Object.assign(new Error('Service Unavailable'), { code: 503 });
    const { fetch, calls } = makeMockFetch([
      transient,
      makeOkResponse([{ id: '0', status: 200 }]),
    ]);
    const result = await markAsRead({
      accessToken: 'tok',
      messageIds: ['m1'],
      backoffMs: [0, 0],
      fetchImpl: fetch,
    });
    expect(calls).toHaveLength(2);
    expect(result.succeeded).toEqual(['m1']);
    expect(result.failed).toEqual([]);
  });

  it('fails the batch after 2 attempts when 503 persists', async () => {
    const { markAsRead } = await import('../../scripts/mark-read.mjs');
    const transient = Object.assign(new Error('Internal Server Error'), { code: 500 });
    const { fetch, calls } = makeMockFetch([transient, transient]);
    const result = await markAsRead({
      accessToken: 'tok',
      messageIds: ['m1', 'm2', 'm3'],
      backoffMs: [0, 0],
      fetchImpl: fetch,
    });
    expect(calls).toHaveLength(2);
    expect(result.succeeded).toEqual([]);
    expect(result.failed).toEqual([
      { id: 'm1', error: expect.any(String) },
      { id: 'm2', error: expect.any(String) },
      { id: 'm3', error: expect.any(String) },
    ]);
  });

  it('invokes onRetry callback with attempt and maxAttempts', async () => {
    const { markAsRead } = await import('../../scripts/mark-read.mjs');
    const transient = Object.assign(new Error('Boom'), { code: 503 });
    const { fetch } = makeMockFetch([transient, makeOkResponse([{ id: '0', status: 200 }])]);
    const onRetry = vi.fn();
    await markAsRead({
      accessToken: 'tok',
      messageIds: ['m1'],
      onRetry,
      backoffMs: [0, 0],
      fetchImpl: fetch,
    });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(1, 2, expect.any(Error));
  });
});

describe('markAsRead — partial failure', () => {
  it('one batch has all IDs fail, others succeed → failed IDs returned', async () => {
    const { markAsRead } = await import('../../scripts/mark-read.mjs');
    // 25 messages: first batch (20) OK, second batch (5) request fails twice.
    const ids = Array.from({ length: 25 }, (_, i) => `m${i}`);
    const firstOk = Array.from({ length: 20 }, (_, i) => ({ id: String(i), status: 200 }));
    const transient = Object.assign(new Error('Boom'), { code: 503 });
    const { fetch, calls } = makeMockFetch([
      makeOkResponse(firstOk),
      transient,
      transient, // retry also fails
    ]);
    const result = await markAsRead({
      accessToken: 'tok',
      messageIds: ids,
      batchSize: 20,
      backoffMs: [0, 0],
      fetchImpl: fetch,
    });
    expect(calls).toHaveLength(3); // 1 first batch + 2 attempts on second batch
    expect(result.succeeded).toEqual(Array.from({ length: 20 }, (_, i) => `m${i}`));
    expect(result.failed).toEqual([
      { id: 'm20', error: expect.any(String) },
      { id: 'm21', error: expect.any(String) },
      { id: 'm22', error: expect.any(String) },
      { id: 'm23', error: expect.any(String) },
      { id: 'm24', error: expect.any(String) },
    ]);
  });

  it('sub-response 404 marks specific ID as failed, rest succeed', async () => {
    const { markAsRead } = await import('../../scripts/mark-read.mjs');
    const { fetch, calls } = makeMockFetch([
      // 3 IDs, but id="1" returns 404
      makeOkResponse([
        { id: '0', status: 200, body: { isRead: true } },
        { id: '1', status: 404, body: { error: { message: 'Not found' } } },
        { id: '2', status: 200, body: { isRead: true } },
      ]),
    ]);
    const result = await markAsRead({
      accessToken: 'tok',
      messageIds: ['a', 'b', 'c'],
      fetchImpl: fetch,
    });
    expect(calls).toHaveLength(1);
    expect(result.succeeded).toEqual(['a', 'c']);
    expect(result.failed).toEqual([{ id: 'b', error: expect.stringMatching(/404/) }]);
  });
});

describe('markAsRead — empty input', () => {
  it('0 messages → 0 calls, returns { succeeded: [], failed: [] }', async () => {
    const { markAsRead } = await import('../../scripts/mark-read.mjs');
    const { fetch, calls } = makeMockFetch([]);
    const result = await markAsRead({
      accessToken: 'tok',
      messageIds: [],
      fetchImpl: fetch,
    });
    expect(calls).toHaveLength(0);
    expect(result.succeeded).toEqual([]);
    expect(result.failed).toEqual([]);
  });
});

describe('markAsRead — request shape', () => {
  it('POSTs to Graph $batch with bearer token and PATCH requests for isRead=true', async () => {
    const { markAsRead } = await import('../../scripts/mark-read.mjs');
    const { fetch, calls } = makeMockFetch([
      makeOkResponse([{ id: '0', status: 200 }, { id: '1', status: 200 }]),
    ]);
    await markAsRead({
      accessToken: 'tok-123',
      userPrincipalName: 'me',
      messageIds: ['m1', 'm2'],
      fetchImpl: fetch,
    });
    const call = calls[0];
    expect(call.url).toBe('https://graph.microsoft.com/v1.0/$batch');
    expect(call.init.method).toBe('POST');
    expect(call.init.headers.Authorization).toBe('Bearer tok-123');
    expect(call.init.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(call.init.body);
    expect(body.requests).toHaveLength(2);
    for (const req of body.requests) {
      expect(req.method).toBe('PATCH');
      expect(req.body).toEqual({ isRead: true });
      // PATCH url may be relative or absolute; both forms must point
      // to the right message under the given user.
      expect(req.url).toMatch(/^\/me\/messages\//);
    }
  });

  it('uses userPrincipalName in the PATCH url when provided', async () => {
    const { markAsRead } = await import('../../scripts/mark-read.mjs');
    const { fetch, calls } = makeMockFetch([
      makeOkResponse([{ id: '0', status: 200 }]),
    ]);
    await markAsRead({
      accessToken: 'tok',
      userPrincipalName: 'user-alias',
      messageIds: ['m1'],
      fetchImpl: fetch,
    });
    const body = JSON.parse(calls[0].init.body);
    // The PATCH url may be relative or absolute; both forms must point
    // to the right message under the given user.
    expect(body.requests[0].url).toContain('/users/user-alias/messages/m1');
  });
});
