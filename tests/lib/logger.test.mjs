import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createLogger } from '../../scripts/lib/logger.mjs';

let stdoutWrite;
let stderrWrite;

beforeEach(() => {
  stdoutWrite = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  stderrWrite = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  stdoutWrite.mockRestore();
  stderrWrite.mockRestore();
  delete process.env.LOG_LEVEL;
});

function parseLastCall(spy) {
  return JSON.parse(spy.mock.calls[spy.mock.calls.length - 1][0]);
}

describe('createLogger — output structure', () => {
  it('should write JSON with ts, level, and message fields', () => {
    const log = createLogger({ level: 'info' });
    log.info('hello world');
    const entry = parseLastCall(stdoutWrite);
    expect(entry).toHaveProperty('ts');
    expect(entry).toHaveProperty('level', 'info');
    expect(entry).toHaveProperty('message', 'hello world');
  });

  it('should produce valid ISO timestamp in ts field', () => {
    const log = createLogger({ level: 'info' });
    log.info('test');
    const entry = parseLastCall(stdoutWrite);
    expect(() => new Date(entry.ts)).not.toThrow();
    expect(new Date(entry.ts).toISOString()).toBe(entry.ts);
  });

  it('should append newline after each entry', () => {
    const log = createLogger({ level: 'info' });
    log.info('test');
    const output = stdoutWrite.mock.calls[0][0];
    expect(output.endsWith('\n')).toBe(true);
  });
});

describe('createLogger — level filter', () => {
  it('should emit info when min level is info', () => {
    const log = createLogger({ level: 'info' });
    log.info('info message');
    expect(stdoutWrite).toHaveBeenCalledTimes(1);
  });

  it('should emit warn when min level is info', () => {
    const log = createLogger({ level: 'info' });
    log.warn('warn message');
    expect(stdoutWrite).toHaveBeenCalledTimes(1);
  });

  it('should emit error when min level is info', () => {
    const log = createLogger({ level: 'info' });
    log.error('error message');
    expect(stdoutWrite).toHaveBeenCalledTimes(1);
  });

  it('should NOT emit debug when min level is info', () => {
    const log = createLogger({ level: 'info' });
    log.debug('debug message');
    expect(stdoutWrite).not.toHaveBeenCalled();
  });

  it('should emit debug when min level is debug', () => {
    const log = createLogger({ level: 'debug' });
    log.debug('debug message');
    expect(stdoutWrite).toHaveBeenCalledTimes(1);
  });

  it('should NOT emit info when min level is error', () => {
    const log = createLogger({ level: 'error' });
    log.info('should not appear');
    expect(stdoutWrite).not.toHaveBeenCalled();
  });

  it('should default to info level when no level provided', () => {
    const log = createLogger();
    log.info('works');
    log.debug('not shown');
    expect(stdoutWrite).toHaveBeenCalledTimes(1);
  });
});

describe('createLogger — base and extra fields', () => {
  it('should merge base fields into every entry', () => {
    const log = createLogger({ level: 'info', base: { stage: 'graph', component: 'fetcher' } });
    log.info('test');
    const entry = parseLastCall(stdoutWrite);
    expect(entry.stage).toBe('graph');
    expect(entry.component).toBe('fetcher');
  });

  it('should merge extra fields from method call', () => {
    const log = createLogger({ level: 'info' });
    log.info('fetched', { count: 50, nextLink: null });
    const entry = parseLastCall(stdoutWrite);
    expect(entry.count).toBe(50);
    expect(entry.nextLink).toBeNull();
  });

  it('should merge base and extra fields together', () => {
    const log = createLogger({ level: 'info', base: { app: 'digest' } });
    log.info('started', { runId: 'abc' });
    const entry = parseLastCall(stdoutWrite);
    expect(entry.app).toBe('digest');
    expect(entry.runId).toBe('abc');
  });

  it('should have extra fields override base fields when keys conflict', () => {
    const log = createLogger({ level: 'info', base: { stage: 'base-stage' } });
    log.info('test', { stage: 'override-stage' });
    const entry = parseLastCall(stdoutWrite);
    expect(entry.stage).toBe('override-stage');
  });
});

describe('createLogger — stream', () => {
  it('should write to stdout by default', () => {
    const log = createLogger({ level: 'info' });
    log.info('stdout test');
    expect(stdoutWrite).toHaveBeenCalled();
    expect(stderrWrite).not.toHaveBeenCalled();
  });

  it('should write to stderr when stream="stderr"', () => {
    const log = createLogger({ level: 'info', stream: 'stderr' });
    log.info('stderr test');
    expect(stderrWrite).toHaveBeenCalled();
    expect(stdoutWrite).not.toHaveBeenCalled();
  });
});

describe('createLogger — LOG_LEVEL env var', () => {
  it('should use LOG_LEVEL env when no level option given', () => {
    process.env.LOG_LEVEL = 'error';
    const log = createLogger();
    log.warn('should not appear');
    expect(stdoutWrite).not.toHaveBeenCalled();
  });

  it('should prefer level option over LOG_LEVEL env', () => {
    process.env.LOG_LEVEL = 'error';
    const log = createLogger({ level: 'debug' });
    log.debug('shown because option overrides env');
    expect(stdoutWrite).toHaveBeenCalledTimes(1);
  });

  it('should handle unknown LOG_LEVEL env value by falling back to info', () => {
    process.env.LOG_LEVEL = 'bogus';
    const log = createLogger();
    log.info('falls back to info');
    log.debug('not shown');
    expect(stdoutWrite).toHaveBeenCalledTimes(1);
  });
});

describe('createLogger — level methods exist', () => {
  it('should expose debug, info, warn, error methods', () => {
    const log = createLogger({ level: 'debug' });
    expect(typeof log.debug).toBe('function');
    expect(typeof log.info).toBe('function');
    expect(typeof log.warn).toBe('function');
    expect(typeof log.error).toBe('function');
  });

  it('should correctly set level on emitted entries', () => {
    const log = createLogger({ level: 'debug' });
    log.debug('d');
    log.info('i');
    log.warn('w');
    log.error('e');
    expect(stdoutWrite).toHaveBeenCalledTimes(4);
    expect(parseLastCall(stdoutWrite).level).toBe('error');
  });
});
