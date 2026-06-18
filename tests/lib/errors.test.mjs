import { describe, it, expect } from 'vitest';
import {
  BaseStageError,
  ConfigError,
  GraphError,
  GmailError,
  CheckpointError,
  TokenError,
  TemplateError,
} from '../../scripts/lib/errors.mjs';

describe('BaseStageError', () => {
  it('should be an Error subclass', () => {
    const err = new BaseStageError('test', 'stage-name');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(BaseStageError);
  });

  it('should set message property', () => {
    const err = new BaseStageError('Something went wrong', 'test-stage');
    expect(err.message).toBe('Something went wrong');
  });

  it('should set stage property', () => {
    const err = new BaseStageError('msg', 'my-stage');
    expect(err.stage).toBe('my-stage');
  });

  it('should set name to constructor name', () => {
    const err = new BaseStageError('msg', 'stage');
    expect(err.name).toBe('BaseStageError');
  });
});

describe('ConfigError', () => {
  it('should extend BaseStageError', () => {
    const err = new ConfigError('config error');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(BaseStageError);
    expect(err).toBeInstanceOf(ConfigError);
  });

  it('should default to stage "config"', () => {
    const err = new ConfigError('missing env');
    expect(err.stage).toBe('config');
  });

  it('should accept custom stage', () => {
    const err = new ConfigError('bad config', 'custom-stage');
    expect(err.stage).toBe('custom-stage');
  });

  it('should have name "ConfigError"', () => {
    const err = new ConfigError('err');
    expect(err.name).toBe('ConfigError');
  });
});

describe('GraphError', () => {
  it('should extend BaseStageError', () => {
    const err = new GraphError('graph error');
    expect(err).toBeInstanceOf(GraphError);
    expect(err).toBeInstanceOf(BaseStageError);
  });

  it('should default to stage "graph-query"', () => {
    const err = new GraphError('timeout');
    expect(err.stage).toBe('graph-query');
  });

  it('should accept custom stage like "graph-auth"', () => {
    const err = new GraphError('unauthorized', 'graph-auth');
    expect(err.stage).toBe('graph-auth');
  });

  it('should have name "GraphError"', () => {
    const err = new GraphError('err');
    expect(err.name).toBe('GraphError');
  });
});

describe('GmailError', () => {
  it('should extend BaseStageError', () => {
    const err = new GmailError('gmail error');
    expect(err).toBeInstanceOf(GmailError);
    expect(err).toBeInstanceOf(BaseStageError);
  });

  it('should default to stage "gmail-send"', () => {
    const err = new GmailError('send failed');
    expect(err.stage).toBe('gmail-send');
  });

  it('should accept custom stage like "gmail-auth"', () => {
    const err = new GmailError('bad token', 'gmail-auth');
    expect(err.stage).toBe('gmail-auth');
  });

  it('should have name "GmailError"', () => {
    const err = new GmailError('err');
    expect(err.name).toBe('GmailError');
  });
});

describe('CheckpointError', () => {
  it('should extend BaseStageError', () => {
    const err = new CheckpointError('checkpoint error');
    expect(err).toBeInstanceOf(CheckpointError);
    expect(err).toBeInstanceOf(BaseStageError);
  });

  it('should default to stage "checkpoint-read"', () => {
    const err = new CheckpointError('cannot read');
    expect(err.stage).toBe('checkpoint-read');
  });

  it('should accept custom stage like "checkpoint-write"', () => {
    const err = new CheckpointError('cannot write', 'checkpoint-write');
    expect(err.stage).toBe('checkpoint-write');
  });

  it('should have name "CheckpointError"', () => {
    const err = new CheckpointError('err');
    expect(err.name).toBe('CheckpointError');
  });
});

describe('TokenError', () => {
  it('should extend BaseStageError', () => {
    const err = new TokenError('token error');
    expect(err).toBeInstanceOf(TokenError);
    expect(err).toBeInstanceOf(BaseStageError);
  });

  it('should default to stage "msal-acquire"', () => {
    const err = new TokenError('cannot acquire');
    expect(err.stage).toBe('msal-acquire');
  });

  it('should accept custom stage like "msal-init"', () => {
    const err = new TokenError('bad cache', 'msal-init');
    expect(err.stage).toBe('msal-init');
  });

  it('should have name "TokenError"', () => {
    const err = new TokenError('err');
    expect(err.name).toBe('TokenError');
  });
});

describe('TemplateError', () => {
  it('should extend BaseStageError', () => {
    const err = new TemplateError('template error');
    expect(err).toBeInstanceOf(TemplateError);
    expect(err).toBeInstanceOf(BaseStageError);
  });

  it('should default to stage "template"', () => {
    const err = new TemplateError('render failed');
    expect(err.stage).toBe('template');
  });

  it('should have name "TemplateError"', () => {
    const err = new TemplateError('err');
    expect(err.name).toBe('TemplateError');
  });
});

describe('Cross-class instanceof checks', () => {
  it('should NOT have cross-type instanceof', () => {
    expect(new ConfigError('err')).not.toBeInstanceOf(GraphError);
    expect(new GraphError('err')).not.toBeInstanceOf(GmailError);
    expect(new GmailError('err')).not.toBeInstanceOf(CheckpointError);
    expect(new CheckpointError('err')).not.toBeInstanceOf(TokenError);
    expect(new TokenError('err')).not.toBeInstanceOf(TemplateError);
    expect(new TemplateError('err')).not.toBeInstanceOf(ConfigError);
  });

  it('should have stage property on every instance', () => {
    const errors = [
      new ConfigError('e'),
      new GraphError('e'),
      new GmailError('e'),
      new CheckpointError('e'),
      new TokenError('e'),
      new TemplateError('e'),
    ];
    for (const err of errors) {
      expect(err).toHaveProperty('stage');
      expect(typeof err.stage).toBe('string');
    }
  });
});
