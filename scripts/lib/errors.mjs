/**
 * Typed error classes used across the digest pipeline.
 *
 * Every error carries a `stage` field that identifies where in the
 * pipeline the error originated. Downstream code (notably the error
 * report mailer) uses this to label the email subject and body.
 *
 * Stage vocabulary (kept loose to allow new stages as the pipeline grows):
 *   config       - missing or malformed env vars
 *   msal-init    - MSAL cache deserialization or account lookup failure
 *   msal-acquire - token acquisition failure (refresh impossible)
 *   graph-auth   - Graph returned 401 / 403
 *   graph-query  - Graph returned 5xx / 429 / timeout / transport error
 *   gmail-config - missing Gmail OAuth credentials
 *   gmail-auth   - Gmail OAuth refresh failure
 *   gmail-send   - Gmail send failure after retries
 *   checkpoint-read  - cannot read existing checkpoint
 *   checkpoint-write - cannot persist checkpoint
 *   template     - report or error-report construction failure
 */

export class BaseStageError extends Error {
  /**
   * @param {string} message
   * @param {string} stage
   */
  constructor(message, stage) {
    super(message);
    this.name = this.constructor.name;
    this.stage = stage;
    // Preserve prototype chain across transpilation targets.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class ConfigError extends BaseStageError {
  constructor(message, stage = 'config') {
    super(message, stage);
  }
}

export class GraphError extends BaseStageError {
  constructor(message, stage = 'graph-query') {
    super(message, stage);
  }
}

export class GmailError extends BaseStageError {
  constructor(message, stage = 'gmail-send') {
    super(message, stage);
  }
}

export class CheckpointError extends BaseStageError {
  constructor(message, stage = 'checkpoint-read') {
    super(message, stage);
  }
}

export class TokenError extends BaseStageError {
  constructor(message, stage = 'msal-acquire') {
    super(message, stage);
  }
}

export class TemplateError extends BaseStageError {
  constructor(message, stage = 'template') {
    super(message, stage);
  }
}
