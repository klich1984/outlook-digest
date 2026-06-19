// Mock googleapis so the real Gmail SDK is never loaded in tests. The
// first `import('../../scripts/index.mjs')` transitively imports
// build-digest.mjs → send-gmail.mjs → lib/gmail.mjs → 'googleapis',
// and a real import can take 10+ seconds on the first run.
vi.mock('googleapis', () => ({ default: { google: {} } }))

import { describe, it, expect, vi, beforeEach } from 'vitest'

const VALID_ENV = Object.freeze({
  HOTMAIL_ACCOUNT_ADDRESS: 'test@outlook.com',
  MSAL_TOKEN_CACHE_JSON: '{}',
  GMAIL_OAUTH_CLIENT_ID: 'test-cid',
  GMAIL_OAUTH_CLIENT_SECRET: 'test-csec',
  GMAIL_OAUTH_REFRESH_TOKEN: 'test-rt',
  GMAIL_DESTINATION_ADDRESS: 'test-dest@gmail.com',
})

/**
 * Builds a full set of dependency mocks for runPipeline. The defaults
 * make every side effect a no-op so individual tests can override the
 * pieces they care about.
 */
function makeDeps(overrides = {}) {
  return {
    buildDigestImpl: vi.fn(),
    buildGmailClientImpl: vi.fn(async () => ({ __mockClient: true })),
    sendMailImpl: vi.fn(async () => ({ messageId: 'mock-message-id' })),
    buildErrorReportImpl: vi.fn(({ stage, errorMessage, runId }) => ({
      subject: `ERROR: ${stage} — ${runId}`,
      html: `<html>stage=${stage}; msg=${errorMessage}</html>`,
      text: `stage=${stage}\nmsg=${errorMessage}\nrunId=${runId}`,
    })),
    execGitImpl: vi.fn(async () => ({ stdout: '', stderr: '' })),
    mkdirImpl: vi.fn(async () => undefined),
    writeFileImpl: vi.fn(async () => undefined),
    loggerImpl: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
    ...overrides,
  }
}

/**
 * A successful buildDigest return value with one message, no mark-read
 * failures, and a commit plan ready to be applied.
 */
function successResult(overrides = {}) {
  return {
    messages: [
      {
        id: 'msg-1',
        subject: 'Test',
        isAlert: false,
        matchedCriteria: [],
        senderEmail: 'a@example.com',
        senderName: 'A',
      },
    ],
    account: 'test@outlook.com',
    window: {
      fromIso: '2026-06-10T00:00:00.000Z',
      toIso: '2026-06-17T00:00:00.000Z',
      dateRangeCOL: '10 jun — 17 jun',
      dateStrCOL: '17 jun',
    },
    checkpoint: {
      version: 1,
      lastRunAt: '2026-06-17T00:00:00.000Z',
      reportedIds: [{ id: 'msg-1' }],
    },
    previousCheckpoint: { version: 1, lastRunAt: null, reportedIds: [] },
    totals: {
      fetched: 1,
      new: 1,
      alerts: 0,
      sent: true,
      mark: { succeeded: 1, failed: 0 },
    },
    report: {
      messageId: 'mock-message-id',
      subject: 'Reporte semanal Hotmail — 17 jun 2026',
      html: '<html><body>Reporte</body></html>',
      text: 'Reporte',
    },
    mark: { succeeded: ['msg-1'], failed: [] },
    commitPlan: {
      checkpointJson: '{"version":1,"reportedIds":[{"id":"msg-1"}]}\n',
      commitMessage:
        'chore(mail-digest): checkpoint 1 nuevos mensajes [skip ci]\n\nRun ID: run-1',
      newCount: 1,
    },
    runId: 'run-1',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('parseArgs', () => {
  it('dryRun is false when --dry-run is absent', async () => {
    const { parseArgs } = await import('../../scripts/index.mjs')
    expect(parseArgs([])).toEqual({ dryRun: false, commit: false })
  })

  it('dryRun is true when --dry-run is present', async () => {
    const { parseArgs } = await import('../../scripts/index.mjs')
    expect(parseArgs(['--dry-run'])).toEqual({ dryRun: true, commit: false })
  })

  it('commit is true when --commit is present', async () => {
    const { parseArgs } = await import('../../scripts/index.mjs')
    expect(parseArgs(['--commit'])).toEqual({ dryRun: false, commit: true })
  })

  it('dryRun and commit are both true when both flags are present', async () => {
    const { parseArgs } = await import('../../scripts/index.mjs')
    expect(parseArgs(['--dry-run', '--commit'])).toEqual({ dryRun: true, commit: true })
  })

  it('ignores unknown flags', async () => {
    const { parseArgs } = await import('../../scripts/index.mjs')
    expect(parseArgs(['--unknown'])).toEqual({ dryRun: false, commit: false })
  })
})

describe('validateEnv', () => {
  it('returns the config object when all 6 env vars are present', async () => {
    const { validateEnv } = await import('../../scripts/index.mjs')
    const config = validateEnv(VALID_ENV)
    expect(config).toEqual({
      hotmailAddress: 'test@outlook.com',
      msalTokenCacheJson: '{}',
      gmailClientId: 'test-cid',
      gmailClientSecret: 'test-csec',
      gmailRefreshToken: 'test-rt',
      gmailDestination: 'test-dest@gmail.com',
    })
  })

  it('throws ConfigError when a single env var is missing', async () => {
    const { validateEnv } = await import('../../scripts/index.mjs')
    const { ConfigError } = await import('../../scripts/lib/errors.mjs')
    const env = { ...VALID_ENV }
    delete env.GMAIL_OAUTH_CLIENT_ID
    let caught
    try {
      validateEnv(env)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(ConfigError)
    expect(caught.stage).toBe('config')
    expect(caught.message).toContain('GMAIL_OAUTH_CLIENT_ID')
  })

  it('lists every missing env var in the error message', async () => {
    const { validateEnv } = await import('../../scripts/index.mjs')
    const env = { ...VALID_ENV }
    delete env.HOTMAIL_ACCOUNT_ADDRESS
    delete env.GMAIL_OAUTH_REFRESH_TOKEN
    let caught
    try {
      validateEnv(env)
    } catch (err) {
      caught = err
    }
    expect(caught.message).toContain('HOTMAIL_ACCOUNT_ADDRESS')
    expect(caught.message).toContain('GMAIL_OAUTH_REFRESH_TOKEN')
  })

  it('treats empty-string env vars as missing', async () => {
    const { validateEnv } = await import('../../scripts/index.mjs')
    const env = { ...VALID_ENV, MSAL_TOKEN_CACHE_JSON: '   ' }
    let caught
    try {
      validateEnv(env)
    } catch (err) {
      caught = err
    }
    expect(caught).toBeDefined()
    expect(caught.stage).toBe('config')
  })
})

describe('runPipeline — env validation at start (AC: validates 6 env vars)', () => {
  it('throws ConfigError before calling buildDigest when an env var is missing', async () => {
    const { runPipeline } = await import('../../scripts/index.mjs')
    const deps = makeDeps()
    const env = { ...VALID_ENV }
    delete env.MSAL_TOKEN_CACHE_JSON
    const out = await runPipeline({ args: {}, env, ...deps })
    expect(out.exitCode).toBe(1)
    expect(deps.buildDigestImpl).not.toHaveBeenCalled()
  })

  it('calls buildDigest when all 6 env vars are present', async () => {
    const { runPipeline } = await import('../../scripts/index.mjs')
    const deps = makeDeps({
      buildDigestImpl: vi.fn(async () => successResult()),
    })
    const out = await runPipeline({ args: {}, env: VALID_ENV, ...deps })
    expect(deps.buildDigestImpl).toHaveBeenCalledTimes(1)
    expect(out.exitCode).toBe(0)
  })
})

describe('runPipeline — full success (AC: send + mark + checkpoint written)', () => {
  it('returns exitCode 0 and does not send an error email', async () => {
    const { runPipeline } = await import('../../scripts/index.mjs')
    const deps = makeDeps({
      buildDigestImpl: vi.fn(async () => successResult()),
    })
    const out = await runPipeline({ args: {}, env: VALID_ENV, ...deps })
    expect(out.exitCode).toBe(0)
    expect(deps.buildGmailClientImpl).not.toHaveBeenCalled()
    expect(deps.sendMailImpl).not.toHaveBeenCalled()
  })

  it('does NOT commit the checkpoint when --commit is not passed (local dev:once)', async () => {
    const { runPipeline } = await import('../../scripts/index.mjs')
    const deps = makeDeps({
      buildDigestImpl: vi.fn(async () => successResult()),
    })
    await runPipeline({ args: {}, env: VALID_ENV, ...deps })
    expect(deps.execGitImpl).not.toHaveBeenCalled()
  })
})

describe('runPipeline — acquisition failure (AC: error email, exit 1, no side effects)', () => {
  it('sends error email via gmail.mjs and returns exit 1 when buildDigest throws TokenError', async () => {
    const { runPipeline } = await import('../../scripts/index.mjs')
    const { TokenError } = await import('../../scripts/lib/errors.mjs')
    const deps = makeDeps({
      buildDigestImpl: vi.fn(async () => {
        throw new TokenError('MSAL falló', 'msal-acquire')
      }),
    })
    const out = await runPipeline({ args: {}, env: VALID_ENV, ...deps })
    expect(out.exitCode).toBe(1)
    expect(deps.buildGmailClientImpl).toHaveBeenCalledTimes(1)
    expect(deps.sendMailImpl).toHaveBeenCalledTimes(1)
  })

  it('error email subject contains the "ERROR:" prefix', async () => {
    const { runPipeline } = await import('../../scripts/index.mjs')
    const { TokenError } = await import('../../scripts/lib/errors.mjs')
    const sendMailImpl = vi.fn(async () => ({ messageId: 'err-1' }))
    const deps = makeDeps({
      buildDigestImpl: vi.fn(async () => {
        throw new TokenError('MSAL falló', 'msal-acquire')
      }),
      sendMailImpl,
    })
    await runPipeline({ args: {}, env: VALID_ENV, ...deps })
    const sentArgs = sendMailImpl.mock.calls[0][1]
    expect(sentArgs.subject).toMatch(/^ERROR:/)
  })

  it('error email is sent to GMAIL_DESTINATION_ADDRESS', async () => {
    const { runPipeline } = await import('../../scripts/index.mjs')
    const { GraphError } = await import('../../scripts/lib/errors.mjs')
    const sendMailImpl = vi.fn(async () => ({ messageId: 'err-2' }))
    const deps = makeDeps({
      buildDigestImpl: vi.fn(async () => {
        throw new GraphError('Graph timeout', 'graph-query')
      }),
      sendMailImpl,
    })
    await runPipeline({ args: {}, env: VALID_ENV, ...deps })
    const sentArgs = sendMailImpl.mock.calls[0][1]
    expect(sentArgs.to).toBe(VALID_ENV.GMAIL_DESTINATION_ADDRESS)
    expect(sentArgs.from).toBe(VALID_ENV.GMAIL_DESTINATION_ADDRESS)
  })

  it('does not commit when buildDigest throws (no side effects)', async () => {
    const { runPipeline } = await import('../../scripts/index.mjs')
    const { TokenError } = await import('../../scripts/lib/errors.mjs')
    const deps = makeDeps({
      buildDigestImpl: vi.fn(async () => {
        throw new TokenError('MSAL falló', 'msal-acquire')
      }),
    })
    await runPipeline({ args: { commit: true }, env: VALID_ENV, ...deps })
    expect(deps.execGitImpl).not.toHaveBeenCalled()
  })

  it('still returns exit 1 when the error email itself fails', async () => {
    const { runPipeline } = await import('../../scripts/index.mjs')
    const { TokenError } = await import('../../scripts/lib/errors.mjs')
    const deps = makeDeps({
      buildDigestImpl: vi.fn(async () => {
        throw new TokenError('MSAL falló', 'msal-acquire')
      }),
      sendMailImpl: vi.fn(async () => {
        throw new Error('Gmail send failed')
      }),
    })
    const out = await runPipeline({ args: {}, env: VALID_ENV, ...deps })
    expect(out.exitCode).toBe(1)
  })
})

describe('runPipeline — mark-read partial failure (AC: failed IDs reported, checkpoint updated with succeeded)', () => {
  it('returns exit 0 when some mark-read succeeds and some fails', async () => {
    const { runPipeline } = await import('../../scripts/index.mjs')
    const result = successResult({
      mark: { succeeded: ['msg-1'], failed: [{ id: 'msg-2', error: '404' }] },
      totals: {
        fetched: 2,
        new: 2,
        alerts: 0,
        sent: true,
        mark: { succeeded: 1, failed: 1 },
      },
    })
    const deps = makeDeps({
      buildDigestImpl: vi.fn(async () => result),
    })
    const out = await runPipeline({ args: {}, env: VALID_ENV, ...deps })
    expect(out.exitCode).toBe(0)
  })

  it('does NOT send an error email for partial mark-read failure', async () => {
    const { runPipeline } = await import('../../scripts/index.mjs')
    const result = successResult({
      mark: { succeeded: ['msg-1'], failed: [{ id: 'msg-2', error: '404' }] },
    })
    const deps = makeDeps({
      buildDigestImpl: vi.fn(async () => result),
    })
    await runPipeline({ args: {}, env: VALID_ENV, ...deps })
    expect(deps.sendMailImpl).not.toHaveBeenCalled()
  })

  it('logs a warning with the failed ID count', async () => {
    const { runPipeline } = await import('../../scripts/index.mjs')
    const result = successResult({
      mark: { succeeded: ['msg-1'], failed: [{ id: 'msg-2', error: '404' }] },
    })
    const deps = makeDeps({
      buildDigestImpl: vi.fn(async () => result),
    })
    await runPipeline({ args: {}, env: VALID_ENV, ...deps })
    const warnCalls = deps.loggerImpl.warn.mock.calls
    const hasFailedWarn = warnCalls.some(([, fields]) => fields?.failed !== undefined)
    expect(hasFailedWarn).toBe(true)
  })
})

describe('runPipeline — mark-read total failure', () => {
  it('sends error email and returns exit 1 when ALL mark-read failed', async () => {
    const { runPipeline } = await import('../../scripts/index.mjs')
    const result = successResult({
      mark: { succeeded: [], failed: [{ id: 'msg-1', error: '503' }] },
      totals: {
        fetched: 1,
        new: 1,
        alerts: 0,
        sent: true,
        mark: { succeeded: 0, failed: 1 },
      },
      commitPlan: null,
    })
    const deps = makeDeps({
      buildDigestImpl: vi.fn(async () => result),
    })
    const out = await runPipeline({ args: {}, env: VALID_ENV, ...deps })
    expect(out.exitCode).toBe(1)
    expect(deps.sendMailImpl).toHaveBeenCalledTimes(1)
  })

  it('does NOT commit when mark-read total failure', async () => {
    const { runPipeline } = await import('../../scripts/index.mjs')
    const result = successResult({
      mark: { succeeded: [], failed: [{ id: 'msg-1', error: '503' }] },
      commitPlan: null,
    })
    const deps = makeDeps({
      buildDigestImpl: vi.fn(async () => result),
    })
    await runPipeline({ args: { commit: true }, env: VALID_ENV, ...deps })
    expect(deps.execGitImpl).not.toHaveBeenCalled()
  })
})

describe('runPipeline — commit failure (AC: error email, checkpoint local updated but not remote)', () => {
  it('sends error email and returns exit 1 when git commit throws', async () => {
    const { runPipeline } = await import('../../scripts/index.mjs')
    const deps = makeDeps({
      buildDigestImpl: vi.fn(async () => successResult()),
      execGitImpl: vi.fn(async () => {
        throw new Error('git commit failed: permission denied')
      }),
    })
    const out = await runPipeline({ args: { commit: true }, env: VALID_ENV, ...deps })
    expect(out.exitCode).toBe(1)
    expect(deps.sendMailImpl).toHaveBeenCalledTimes(1)
  })

  it('error email subject includes the "ERROR:" prefix on commit failure', async () => {
    const { runPipeline } = await import('../../scripts/index.mjs')
    const sendMailImpl = vi.fn(async () => ({ messageId: 'err-3' }))
    const deps = makeDeps({
      buildDigestImpl: vi.fn(async () => successResult()),
      execGitImpl: vi.fn(async () => {
        throw new Error('git push failed')
      }),
      sendMailImpl,
    })
    await runPipeline({ args: { commit: true }, env: VALID_ENV, ...deps })
    const sentArgs = sendMailImpl.mock.calls[0][1]
    expect(sentArgs.subject).toMatch(/^ERROR:/)
  })

  it('does NOT commit when --commit flag is not passed', async () => {
    const { runPipeline } = await import('../../scripts/index.mjs')
    const deps = makeDeps({
      buildDigestImpl: vi.fn(async () => successResult()),
    })
    await runPipeline({ args: {}, env: VALID_ENV, ...deps })
    expect(deps.execGitImpl).not.toHaveBeenCalled()
  })

  it('returns exit 0 when --commit is passed and commit succeeds', async () => {
    const { runPipeline } = await import('../../scripts/index.mjs')
    const deps = makeDeps({
      buildDigestImpl: vi.fn(async () => successResult()),
      execGitImpl: vi.fn(async () => ({ stdout: '', stderr: '' })),
    })
    const out = await runPipeline({ args: { commit: true }, env: VALID_ENV, ...deps })
    expect(out.exitCode).toBe(0)
    expect(deps.execGitImpl).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['add', 'state/reported-ids.json'])
    )
    expect(deps.execGitImpl).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['commit'])
    )
  })
})

describe('runPipeline — no new messages (AC: exit 0, no send, no mark, no commit)', () => {
  it('returns exit 0 when buildDigest reports 0 new messages', async () => {
    const { runPipeline } = await import('../../scripts/index.mjs')
    const deps = makeDeps({
      buildDigestImpl: vi.fn(async () =>
        successResult({
          messages: [],
          report: null,
          mark: undefined,
          commitPlan: null,
          totals: { fetched: 0, new: 0, alerts: 0, sent: false, mark: null },
        })
      ),
    })
    const out = await runPipeline({ args: {}, env: VALID_ENV, ...deps })
    expect(out.exitCode).toBe(0)
  })

  it('does NOT call buildGmailClient or sendMail when there are no new messages', async () => {
    const { runPipeline } = await import('../../scripts/index.mjs')
    const deps = makeDeps({
      buildDigestImpl: vi.fn(async () =>
        successResult({
          messages: [],
          report: null,
          mark: undefined,
          commitPlan: null,
          totals: { fetched: 0, new: 0, alerts: 0, sent: false, mark: null },
        })
      ),
    })
    await runPipeline({ args: {}, env: VALID_ENV, ...deps })
    // buildDigest already injected mocks for the dry-run-like path, so
    // these would only be called by the error email path. Neither
    // should be invoked.
    expect(deps.buildGmailClientImpl).not.toHaveBeenCalled()
    expect(deps.sendMailImpl).not.toHaveBeenCalled()
  })

  it('does NOT commit when there are no new messages (even with --commit)', async () => {
    const { runPipeline } = await import('../../scripts/index.mjs')
    const deps = makeDeps({
      buildDigestImpl: vi.fn(async () =>
        successResult({
          messages: [],
          report: null,
          mark: undefined,
          commitPlan: null,
          totals: { fetched: 0, new: 0, alerts: 0, sent: false, mark: null },
        })
      ),
    })
    await runPipeline({ args: { commit: true }, env: VALID_ENV, ...deps })
    expect(deps.execGitImpl).not.toHaveBeenCalled()
  })

  it('does NOT send an error email for the no-new-messages case', async () => {
    const { runPipeline } = await import('../../scripts/index.mjs')
    const deps = makeDeps({
      buildDigestImpl: vi.fn(async () =>
        successResult({
          messages: [],
          report: null,
          mark: undefined,
          commitPlan: null,
          totals: { fetched: 0, new: 0, alerts: 0, sent: false, mark: null },
        })
      ),
    })
    await runPipeline({ args: {}, env: VALID_ENV, ...deps })
    expect(deps.sendMailImpl).not.toHaveBeenCalled()
  })
})

describe('runPipeline — dry-run (AC: preview saved, no send, no mark, no commit)', () => {
  it('writes the report preview to .local/report-preview.html', async () => {
    const { runPipeline } = await import('../../scripts/index.mjs')
    const writeFileImpl = vi.fn(async () => undefined)
    const mkdirImpl = vi.fn(async () => undefined)
    const deps = makeDeps({
      buildDigestImpl: vi.fn(async () => successResult()),
      writeFileImpl,
      mkdirImpl,
    })
    const out = await runPipeline({ args: { dryRun: true }, env: VALID_ENV, ...deps })
    expect(out.exitCode).toBe(0)
    expect(writeFileImpl).toHaveBeenCalledTimes(1)
    const call = writeFileImpl.mock.calls[0]
    expect(call[0]).toMatch(/report-preview\.html$/)
    expect(call[1]).toContain('<html>')
  })

  it('creates the .local directory before writing the preview', async () => {
    const { runPipeline } = await import('../../scripts/index.mjs')
    const writeFileImpl = vi.fn(async () => undefined)
    const mkdirImpl = vi.fn(async () => undefined)
    const deps = makeDeps({
      buildDigestImpl: vi.fn(async () => successResult()),
      writeFileImpl,
      mkdirImpl,
    })
    await runPipeline({ args: { dryRun: true }, env: VALID_ENV, ...deps })
    expect(mkdirImpl).toHaveBeenCalledTimes(1)
    const call = mkdirImpl.mock.calls[0]
    expect(call[0]).toMatch(/\.local$/)
    expect(call[1]).toEqual({ recursive: true })
  })

  it('injects no-op side-effect mocks into buildDigest during dry-run', async () => {
    const { runPipeline } = await import('../../scripts/index.mjs')
    const buildDigestImpl = vi.fn(async () => successResult())
    const deps = makeDeps({
      buildDigestImpl,
      writeFileImpl: vi.fn(async () => undefined),
      mkdirImpl: vi.fn(async () => undefined),
    })
    await runPipeline({ args: { dryRun: true }, env: VALID_ENV, ...deps })
    const buildOpts = buildDigestImpl.mock.calls[0][0]
    expect(typeof buildOpts.sendMailImpl).toBe('function')
    expect(typeof buildOpts.markAsReadImpl).toBe('function')
    expect(typeof buildOpts.buildGmailClientImpl).toBe('function')
    // The injected mocks should be no-ops: they should resolve with
    // success shapes and not throw.
    await expect(buildOpts.sendMailImpl({}, {})).resolves.toBeDefined()
    await expect(buildOpts.markAsReadImpl({})).resolves.toEqual({
      succeeded: [],
      failed: [],
    })
  })

  it('does NOT call real buildGmailClient or sendMail during dry-run', async () => {
    const { runPipeline } = await import('../../scripts/index.mjs')
    const deps = makeDeps({
      buildDigestImpl: vi.fn(async () => successResult()),
      writeFileImpl: vi.fn(async () => undefined),
      mkdirImpl: vi.fn(async () => undefined),
    })
    await runPipeline({ args: { dryRun: true }, env: VALID_ENV, ...deps })
    expect(deps.buildGmailClientImpl).not.toHaveBeenCalled()
    expect(deps.sendMailImpl).not.toHaveBeenCalled()
  })

  it('does NOT commit during dry-run', async () => {
    const { runPipeline } = await import('../../scripts/index.mjs')
    const deps = makeDeps({
      buildDigestImpl: vi.fn(async () => successResult()),
      writeFileImpl: vi.fn(async () => undefined),
      mkdirImpl: vi.fn(async () => undefined),
    })
    await runPipeline({ args: { dryRun: true, commit: true }, env: VALID_ENV, ...deps })
    expect(deps.execGitImpl).not.toHaveBeenCalled()
  })

  it('does NOT write a preview file when there are no new messages', async () => {
    const { runPipeline } = await import('../../scripts/index.mjs')
    const writeFileImpl = vi.fn(async () => undefined)
    const deps = makeDeps({
      buildDigestImpl: vi.fn(async () =>
        successResult({
          messages: [],
          report: null,
          mark: undefined,
          commitPlan: null,
          totals: { fetched: 0, new: 0, alerts: 0, sent: false, mark: null },
        })
      ),
      writeFileImpl,
      mkdirImpl: vi.fn(async () => undefined),
    })
    await runPipeline({ args: { dryRun: true }, env: VALID_ENV, ...deps })
    expect(writeFileImpl).not.toHaveBeenCalled()
  })
})

describe('runPipeline — dev:once local complete (AC: Graph + Gmail + mark + checkpoint, no commit)', () => {
  it('runs buildDigest normally (no dry-run mocks) and returns exit 0', async () => {
    const { runPipeline } = await import('../../scripts/index.mjs')
    const buildDigestImpl = vi.fn(async () => successResult())
    const deps = makeDeps({ buildDigestImpl })
    const out = await runPipeline({ args: {}, env: VALID_ENV, ...deps })
    expect(out.exitCode).toBe(0)
    // buildDigest was called without injected mocks
    const buildOpts = buildDigestImpl.mock.calls[0][0]
    expect(buildOpts.sendMailImpl).toBeUndefined()
    expect(buildOpts.markAsReadImpl).toBeUndefined()
  })

  it('passes the loaded config object to buildDigest', async () => {
    const { runPipeline } = await import('../../scripts/index.mjs')
    const buildDigestImpl = vi.fn(async () => successResult())
    const deps = makeDeps({ buildDigestImpl })
    await runPipeline({ args: {}, env: VALID_ENV, ...deps })
    const buildOpts = buildDigestImpl.mock.calls[0][0]
    expect(buildOpts.config).toEqual({
      hotmailAddress: VALID_ENV.HOTMAIL_ACCOUNT_ADDRESS,
      msalTokenCacheJson: VALID_ENV.MSAL_TOKEN_CACHE_JSON,
      gmailClientId: VALID_ENV.GMAIL_OAUTH_CLIENT_ID,
      gmailClientSecret: VALID_ENV.GMAIL_OAUTH_CLIENT_SECRET,
      gmailRefreshToken: VALID_ENV.GMAIL_OAUTH_REFRESH_TOKEN,
      gmailDestination: VALID_ENV.GMAIL_DESTINATION_ADDRESS,
    })
  })
})

describe('runPipeline — error email does not crash the pipeline', () => {
  it('returns exit 1 even when the error email itself throws', async () => {
    const { runPipeline } = await import('../../scripts/index.mjs')
    const { ConfigError } = await import('../../scripts/lib/errors.mjs')
    const deps = makeDeps({
      buildDigestImpl: vi.fn(async () => {
        throw new ConfigError('Falta env', 'config')
      }),
      buildGmailClientImpl: vi.fn(async () => {
        throw new Error('client init failed')
      }),
    })
    const out = await runPipeline({ args: {}, env: VALID_ENV, ...deps })
    expect(out.exitCode).toBe(1)
  })
})
