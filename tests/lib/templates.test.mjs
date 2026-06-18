import { describe, it, expect } from 'vitest';
import {
  buildReport,
  buildErrorReport,
} from '../../scripts/lib/templates.mjs';

function makeMsg(overrides = {}) {
  return {
    id: 'msg-001',
    from: { emailAddress: { address: 'sender@example.com', name: 'Sender Name' } },
    subject: 'Test subject',
    receivedAtCOL: '17 jun 2026 10:30 COL',
    bodyPreview: 'This is a preview of the message body content.',
    importance: 'normal',
    inferenceClassification: 'focused',
    hasAttachments: false,
    ...overrides,
  };
}

function makeAlert(overrides = {}) {
  return makeMsg({
    id: 'alert-001',
    from: { emailAddress: { address: 'security@microsoft.com', name: 'Microsoft Security' } },
    subject: 'Security alert: unusual sign-in',
    bodyPreview: 'We detected an unusual sign-in attempt on your account. If this was you, no action needed. If not, please secure your account immediately by changing your password and reviewing your recent activity.',
    importance: 'high',
    ...overrides,
  });
}

describe('escapeHtml', () => {
  it('should handle & < > " \'', async () => {
    const { buildReport } = await import('../../scripts/lib/templates.mjs');
    // escapeHtml is not exported, so we test it indirectly via buildReport output
    const result = buildReport({
      messages: [makeMsg({ subject: 'Hello & <World> with "quotes" and \'single\'', from: { emailAddress: { address: 'a@b.com', name: 'Test&Co' } } })],
      alerts: [],
      account: 'test@hotmail.com',
      dateRange: '10 jun – 17 jun 2026',
      dateStr: '17 jun 2026',
    });
    expect(result.html).toContain('Hello &amp; &lt;World&gt;');
    expect(result.html).toContain('Test&amp;Co');
  });
});

describe('buildSubject', () => {
  it('should prefix with 🚨 when hasAlerts is true', () => {
    const result = buildReport({
      messages: [],
      alerts: [makeAlert()],
      account: 'test@hotmail.com',
      dateRange: '10 jun – 17 jun 2026',
      dateStr: '17 jun 2026',
    });
    expect(result.subject).toBe('🚨 Reporte semanal Hotmail — 17 jun 2026');
  });

  it('should NOT prefix with 🚨 when hasAlerts is false', () => {
    const result = buildReport({
      messages: [makeMsg()],
      alerts: [],
      account: 'test@hotmail.com',
      dateRange: '10 jun – 17 jun 2026',
      dateStr: '17 jun 2026',
    });
    expect(result.subject).toBe('Reporte semanal Hotmail — 17 jun 2026');
  });
});

describe('buildReport — totals', () => {
  it('should compute totals from messages when not provided', () => {
    const focused = makeMsg({ inferenceClassification: 'focused' });
    const other = makeMsg({ id: 'msg-002', inferenceClassification: 'other' });
    const result = buildReport({
      messages: [focused, other],
      alerts: [],
      account: 'test@hotmail.com',
      dateRange: '10 jun – 17 jun 2026',
      dateStr: '17 jun 2026',
    });
    expect(result.html).toContain('>2<'); // total
    expect(result.html).toContain('>1<'); // focused
    expect(result.html).toContain('>1<'); // other
  });

  it('should use provided totals when given', () => {
    const result = buildReport({
      messages: [makeMsg()],
      alerts: [],
      account: 'test@hotmail.com',
      dateRange: '10 jun – 17 jun 2026',
      dateStr: '17 jun 2026',
      totals: { total: 99, focused: 50, other: 49 },
    });
    expect(result.html).toContain('>99<');
    expect(result.html).toContain('>50<');
    expect(result.html).toContain('>49<');
  });

  it('should use classification field when inferenceClassification is absent', () => {
    const msg = makeMsg({ inferenceClassification: undefined, classification: 'focused' });
    const result = buildReport({
      messages: [msg],
      alerts: [],
      account: 'test@hotmail.com',
      dateRange: '10 jun – 17 jun 2026',
      dateStr: '17 jun 2026',
    });
    expect(result.html).toContain('>1<');
  });
});

describe('buildReport — bodyPreview truncation', () => {
  it('should truncate normal message bodyPreview to 240 chars with …', () => {
    const longBody = 'x'.repeat(300);
    const msg = makeMsg({ bodyPreview: longBody });
    const result = buildReport({
      messages: [msg],
      alerts: [],
      account: 'test@hotmail.com',
      dateRange: '10 jun – 17 jun 2026',
      dateStr: '17 jun 2026',
    });
    const truncated = 'x'.repeat(240) + '\u2026';
    expect(result.html).toContain(truncated);
    expect(result.html).not.toContain('x'.repeat(241));
  });

  it('should show full bodyPreview for alerts (no truncation)', () => {
    const longBody = 'y'.repeat(500);
    const alert = makeAlert({ bodyPreview: longBody });
    const result = buildReport({
      messages: [makeMsg()],
      alerts: [alert],
      account: 'test@hotmail.com',
      dateRange: '10 jun – 17 jun 2026',
      dateStr: '17 jun 2026',
    });
    expect(result.html).toContain('y'.repeat(500));
  });

  it('should preserve bodyPreview short enough not to need truncation', () => {
    const shortBody = 'Short message body.';
    const msg = makeMsg({ bodyPreview: shortBody });
    const result = buildReport({
      messages: [msg],
      alerts: [],
      account: 'test@hotmail.com',
      dateRange: '10 jun – 17 jun 2026',
      dateStr: '17 jun 2026',
    });
    expect(result.html).toContain(shortBody);
  });
});

describe('buildReport — alerts sections', () => {
  it('should include banner and "Acciones requeridas" when alerts present', () => {
    const alerts = [
      makeAlert({ id: 'alert-001', subject: 'Security alert 1' }),
      makeAlert({ id: 'alert-002', subject: 'Security alert 2' }),
    ];
    const result = buildReport({
      messages: [makeMsg()],
      alerts,
      account: 'test@hotmail.com',
      dateRange: '10 jun – 17 jun 2026',
      dateStr: '17 jun 2026',
    });
    expect(result.html).toContain('2 alerta(s) crítica(s) detectada(s)');
    expect(result.html).toContain('Acciones requeridas');
    expect(result.html).toContain('Security alert 1');
    expect(result.html).toContain('Security alert 2');
  });

  it('should NOT include banner or "Acciones requeridas" when no alerts', () => {
    const result = buildReport({
      messages: [makeMsg()],
      alerts: [],
      account: 'test@hotmail.com',
      dateRange: '10 jun – 17 jun 2026',
      dateStr: '17 jun 2026',
    });
    expect(result.html).not.toContain('alertas');
    expect(result.html).not.toContain('Acciones requeridas');
  });
});

describe('buildReport — HTML structure', () => {
  it('should contain account and date range in header', () => {
    const result = buildReport({
      messages: [makeMsg()],
      alerts: [],
      account: 'test@hotmail.com',
      dateRange: '10 jun – 17 jun 2026',
      dateStr: '17 jun 2026',
    });
    expect(result.html).toContain('test@hotmail.com');
    expect(result.html).toContain('10 jun');
  });

  it('should contain message subject and sender in normal rows', () => {
    const result = buildReport({
      messages: [makeMsg({ subject: 'Weekly update' })],
      alerts: [],
      account: 'test@hotmail.com',
      dateRange: '10 jun – 17 jun 2026',
      dateStr: '17 jun 2026',
    });
    expect(result.html).toContain('Weekly update');
    expect(result.html).toContain('sender@example.com');
    expect(result.html).toContain('Sender Name');
  });

  it('should contain Abrir en Hotmail link for normal messages', () => {
    const result = buildReport({
      messages: [makeMsg({ id: 'msglongid123' })],
      alerts: [],
      account: 'test@hotmail.com',
      dateRange: '10 jun – 17 jun 2026',
      dateStr: '17 jun 2026',
    });
    expect(result.html).toContain('outlook.live.com/mail/0/inbox/id/msglongid123');
  });

  it('should contain processed IDs in footer', () => {
    const result = buildReport({
      messages: [makeMsg({ id: 'msg-001' }), makeMsg({ id: 'msg-002' })],
      alerts: [],
      account: 'test@hotmail.com',
      dateRange: '10 jun – 17 jun 2026',
      dateStr: '17 jun 2026',
    });
    expect(result.html).toContain('msg-001');
    expect(result.html).toContain('msg-002');
  });
});

describe('buildReport — text report', () => {
  it('should include total and account in text version', () => {
    const result = buildReport({
      messages: [makeMsg(), makeMsg({ id: 'msg-002', inferenceClassification: 'other' })],
      alerts: [],
      account: 'test@hotmail.com',
      dateRange: '10 jun – 17 jun 2026',
      dateStr: '17 jun 2026',
    });
    expect(result.text).toContain('test@hotmail.com');
    expect(result.text).toContain('2 (1 prioritarios');
    expect(result.text).toContain('1 otros)');
  });

  it('should list alert subjects in text version when alerts present', () => {
    const alert = makeAlert({ subject: 'URGENT: Security alert' });
    const result = buildReport({
      messages: [makeMsg()],
      alerts: [alert],
      account: 'test@hotmail.com',
      dateRange: '10 jun – 17 jun 2026',
      dateStr: '17 jun 2026',
    });
    expect(result.text).toContain('1 alerta(s) crítica(s) detectada(s)');
    expect(result.text).toContain('URGENT: Security alert');
  });

  it('should include IDs processed section', () => {
    const result = buildReport({
      messages: [makeMsg({ id: 'msg-final' })],
      alerts: [],
      account: 'test@hotmail.com',
      dateRange: '10 jun – 17 jun 2026',
      dateStr: '17 jun 2026',
    });
    expect(result.text).toContain('msg-final');
    expect(result.text).toContain('IDs procesados');
  });
});

describe('buildReport — edge cases', () => {
  it('should handle empty messages array', () => {
    const result = buildReport({
      messages: [],
      alerts: [],
      account: 'test@hotmail.com',
      dateRange: '10 jun – 17 jun 2026',
      dateStr: '17 jun 2026',
    });
    expect(result.html).toBeTruthy();
    expect(result.text).toBeTruthy();
  });

  it('should handle data with missing optional fields', () => {
    const result = buildReport({});
    expect(result.html).toBeTruthy();
    expect(result.text).toBeTruthy();
    expect(result.subject).toBe('Reporte semanal Hotmail — ');
  });

  it('should render importance badge for high importance', () => {
    const msg = makeMsg({ importance: 'high' });
    const result = buildReport({
      messages: [msg],
      alerts: [],
      account: 'test@hotmail.com',
      dateRange: '10 jun – 17 jun 2026',
      dateStr: '17 jun 2026',
    });
    expect(result.html).toContain('Alta');
  });

  it('should render importance badge for low importance', () => {
    const msg = makeMsg({ importance: 'low' });
    const result = buildReport({
      messages: [msg],
      alerts: [],
      account: 'test@hotmail.com',
      dateRange: '10 jun – 17 jun 2026',
      dateStr: '17 jun 2026',
    });
    expect(result.html).toContain('Baja');
  });

  it('should render attachment badge', () => {
    const msg = makeMsg({ hasAttachments: true });
    const result = buildReport({
      messages: [msg],
      alerts: [],
      account: 'test@hotmail.com',
      dateRange: '10 jun – 17 jun 2026',
      dateStr: '17 jun 2026',
    });
    expect(result.html).toContain('Adjunto');
  });

  it('should render classification labels', () => {
    const focusedMsg = makeMsg({ inferenceClassification: 'focused' });
    const otherMsg = makeMsg({ id: 'msg-002', inferenceClassification: 'other' });
    const result = buildReport({
      messages: [focusedMsg, otherMsg],
      alerts: [],
      account: 'test@hotmail.com',
      dateRange: '10 jun – 17 jun 2026',
      dateStr: '17 jun 2026',
    });
    expect(result.html).toContain('Prioritario');
    expect(result.html).toContain('Otros');
  });

  it('should not render classification badge for unset classification', () => {
    const msg = makeMsg({ inferenceClassification: undefined, classification: undefined });
    const result = buildReport({
      messages: [msg],
      alerts: [],
      account: 'test@hotmail.com',
      dateRange: '10 jun – 17 jun 2026',
      dateStr: '17 jun 2026',
    });
    // The per-message row should NOT have a classification badge span
    expect(result.html).not.toContain('background-color:#e6f4ea;color:#1e8e3e');
    expect(result.html).not.toContain('background-color:#f1f3f4;color:#5f6368');
  });
});

describe('buildReport — date grouping and sort', () => {
  it('should sort dates descending', () => {
    const older = makeMsg({ id: 'old', dateLabel: '16 jun 2026' });
    const newer = makeMsg({ id: 'new', dateLabel: '17 jun 2026' });
    const result = buildReport({
      messages: [older, newer],
      alerts: [],
      account: 'test@hotmail.com',
      dateRange: '10 jun – 17 jun 2026',
      dateStr: '17 jun 2026',
    });
    // newer should appear before older in the HTML
    const newerIdx = result.html.indexOf('17 jun 2026');
    const olderIdx = result.html.indexOf('16 jun 2026');
    expect(newerIdx).toBeLessThan(olderIdx);
  });

  it('should handle messages without dateLabel ("Sin fecha")', () => {
    const dated = makeMsg({ id: 'dated', dateLabel: '17 jun 2026' });
    const nodate = makeMsg({ id: 'nodate', dateLabel: undefined });
    const result = buildReport({
      messages: [dated, nodate],
      alerts: [],
      account: 'test@hotmail.com',
      dateRange: '10 jun – 17 jun 2026',
      dateStr: '17 jun 2026',
    });
    expect(result.html).toContain('Sin fecha');
    // "Sin fecha" group appears after dated groups in sort
    const datedIdx = result.html.indexOf('17 jun 2026');
    const nodateIdx = result.html.indexOf('Sin fecha');
    expect(datedIdx).toBeLessThan(nodateIdx);
  });

  it('should handle "Sin fecha" in text report too', () => {
    const dated = makeMsg({ id: 'dated', dateLabel: '17 jun 2026' });
    const nodate = makeMsg({ id: 'nodate', dateLabel: undefined });
    const result = buildReport({
      messages: [dated, nodate],
      alerts: [],
      account: 'test@hotmail.com',
      dateRange: '10 jun – 17 jun 2026',
      dateStr: '17 jun 2026',
    });
    expect(result.text).toContain('Sin fecha');
  });

  it('should group messages under same date', () => {
    const msg1 = makeMsg({ id: 'a', dateLabel: '17 jun 2026', subject: 'First' });
    const msg2 = makeMsg({ id: 'b', dateLabel: '17 jun 2026', subject: 'Second' });
    const result = buildReport({
      messages: [msg1, msg2],
      alerts: [],
      account: 'test@hotmail.com',
      dateRange: '10 jun – 17 jun 2026',
      dateStr: '17 jun 2026',
    });
    // Both messages under same heading
    const headingIdx = result.html.indexOf('17 jun 2026');
    const firstIdx = result.html.indexOf('First');
    const secondIdx = result.html.indexOf('Second');
    expect(headingIdx).toBeLessThan(firstIdx);
    expect(headingIdx).toBeLessThan(secondIdx);
  });
});

describe('buildErrorReport', () => {
  it('should handle empty errorStack', () => {
    const result = buildErrorReport({
      stage: 'test',
      errorMessage: 'msg',
      errorStack: undefined,
    });
    expect(result.html).toContain('sin stack');
    expect(result.text).toContain('sin stack');
  });
  it('should return html, text, and subject', () => {
    const result = buildErrorReport({
      stage: 'graph-query',
      errorMessage: 'Graph timeout after 30s',
      errorStack: 'Error: timeout\n    at fetchMessages',
      runId: 'run-123',
      runUrl: 'https://github.com/example/actions/runs/123',
    });
    expect(result).toHaveProperty('html');
    expect(result).toHaveProperty('text');
    expect(result).toHaveProperty('subject');
  });

  it('should include stage in error body', () => {
    const result = buildErrorReport({
      stage: 'graph-query',
      errorMessage: 'Graph timeout',
    });
    expect(result.html).toContain('graph-query');
    expect(result.text).toContain('graph-query');
  });

  it('should include error message', () => {
    const result = buildErrorReport({
      stage: 'graph-query',
      errorMessage: 'Graph timeout after 30s',
    });
    expect(result.html).toContain('Graph timeout after 30s');
    expect(result.text).toContain('Graph timeout after 30s');
  });

  it('should use provided nowIso in subject', () => {
    const result = buildErrorReport({
      stage: 'msal-acquire',
      errorMessage: 'Token expired',
      nowIso: '2026-06-17T13:00:00.000Z',
    });
    expect(result.subject).toBe('ERROR: Reporte semanal Hotmail — 2026-06-17T13:00:00.000Z');
  });

  it('should truncate stack to 2048 bytes', () => {
    const longStack = 'x'.repeat(3000);
    const result = buildErrorReport({
      stage: 'test',
      errorMessage: 'err',
      errorStack: longStack,
    });
    expect(result.html).toContain('x'.repeat(2048));
    expect(result.html).not.toContain('x'.repeat(2049));
  });

  it('should handle missing optional fields gracefully', () => {
    const result = buildErrorReport({});
    expect(result.html).toBeTruthy();
    expect(result.text).toBeTruthy();
    expect(result.subject).toContain('ERROR:');
  });

  it('should include Run ID and URL when provided', () => {
    const result = buildErrorReport({
      stage: 'graph-query',
      errorMessage: 'error',
      runId: 'run-456',
      runUrl: 'https://example.com/run/456',
    });
    expect(result.html).toContain('run-456');
    expect(result.html).toContain('example.com/run/456');
  });
});
