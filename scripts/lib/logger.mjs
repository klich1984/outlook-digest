/**
 * Minimal structured JSON logger.
 *
 * Emits one JSON object per line so GH Actions can grep / jq it. The
 * `level` filter is applied in-process — no silent drop after the call
 * site. By default writes `info` and above; override with the
 * `LOG_LEVEL` env var or the `level` option.
 *
 * Example:
 *   const log = createLogger({ stage: 'graph' });
 *   log.info('fetched page', { count: 50, nextLink: null });
 */

const LEVELS = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
});

function resolveMinLevel(option) {
  const fromEnv = process.env.LOG_LEVEL;
  const candidate = (option || fromEnv || 'info').toLowerCase();
  return LEVELS[candidate] || LEVELS.info;
}

/**
 * @param {object} [options]
 * @param {'debug'|'info'|'warn'|'error'} [options.level]
 * @param {Record<string, unknown>} [options.base] - fields merged into every entry
 * @param {string} [options.stream] - 'stdout' or 'stderr' (default: stdout)
 */
export function createLogger(options = {}) {
  const minLevel = resolveMinLevel(options.level);
  const base = options.base || {};
  const streamName = options.stream || 'stdout';
  const stream = streamName === 'stderr' ? process.stderr : process.stdout;

  function emit(level, message, fields) {
    if (LEVELS[level] < minLevel) return;
    const entry = {
      ts: new Date().toISOString(),
      level,
      message,
      ...base,
      ...(fields || {}),
    };
    stream.write(JSON.stringify(entry) + '\n');
  }

  return {
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
  };
}
