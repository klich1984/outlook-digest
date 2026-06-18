/**
 * Report and error-report template builders.
 *
 * Pure functions — no I/O, no shared state. Both `buildReport` and
 * `buildErrorReport` return `{ html, text, subject }`. The caller is
 * responsible for passing the messages with alert tagging and the COL
 * timezone already applied.
 *
 * Subject line for the weekly digest:
 *   "Reporte semanal Hotmail — 17 jun 2026"
 *   "🚨 Reporte semanal Hotmail — 17 jun 2026"  (when alerts > 0)
 *
 * HTML uses inline CSS only (Gmail strips <style>). System font stack
 * to avoid font downloads. Max-width 720px for readability.
 *
 * bodyPreview handling per locked decision:
 *   - Normal rows: truncated to 240 chars with "…" suffix.
 *   - Alert "Acciones requeridas" rows: FULL bodyPreview, no truncation.
 *
 * The banner ("⚠️ N alertas críticas detectadas") and the
 * "Acciones requeridas" section both appear ONLY when alerts.length > 0.
 */

const BODY_PREVIEW_MAX = 240;

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function truncate(value, max) {
  if (!value) return '';
  const s = String(value);
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}

function importanceBadge(importance) {
  if (importance === 'high') {
    return '<span style="display:inline-block;font-size:11px;padding:1px 6px;border-radius:3px;background-color:#fce8e6;color:#c5221f;font-weight:500;margin-left:6px;">Alta</span>';
  }
  if (importance === 'low') {
    return '<span style="display:inline-block;font-size:11px;padding:1px 6px;border-radius:3px;background-color:#f1f3f4;color:#5f6368;font-weight:500;margin-left:6px;">Baja</span>';
  }
  return '';
}

function attachmentBadge(hasAttachments) {
  if (!hasAttachments) return '';
  return '<span style="display:inline-block;font-size:11px;padding:1px 6px;border-radius:3px;background-color:#e8f0fe;color:#1967d2;font-weight:500;margin-left:4px;">Adjunto</span>';
}

function classificationLabel(cls) {
  if (cls === 'focused') {
    return '<span style="display:inline-block;font-size:11px;padding:1px 6px;border-radius:3px;background-color:#e6f4ea;color:#1e8e3e;font-weight:500;margin-left:4px;">Prioritario</span>';
  }
  if (cls === 'other') {
    return '<span style="display:inline-block;font-size:11px;padding:1px 6px;border-radius:3px;background-color:#f1f3f4;color:#5f6368;font-weight:500;margin-left:4px;">Otros</span>';
  }
  return '';
}

function hotmailLink(messageId) {
  if (!messageId) return '';
  return `https://outlook.live.com/mail/0/inbox/id/${encodeURIComponent(messageId)}`;
}

function pickSender(msg) {
  const fromAddr = msg?.from?.emailAddress?.address;
  const fromName = msg?.from?.emailAddress?.name;
  return {
    email: msg?.senderEmail || fromAddr || '',
    name: msg?.senderName || fromName || fromAddr || '',
  };
}

function pickSubject(msg) {
  return msg?.subject || '(sin asunto)';
}

function pickImportance(msg) {
  return msg?.importance || 'normal';
}

function pickClassification(msg) {
  return msg?.classification || msg?.inferenceClassification || '';
}

function pickDateLabel(msg) {
  // The orchestrator pre-formats this; fall back to receivedAtCOL or
  // empty string for safety.
  return msg?.dateLabel || '';
}

function messageRowHtml(msg) {
  const { email: senderEmail, name: senderName } = pickSender(msg);
  const subject = pickSubject(msg);
  const importance = pickImportance(msg);
  const classification = pickClassification(msg);
  const receivedAt = msg?.receivedAtCOL || '';
  const previewDisplay = truncate(msg?.bodyPreview || '', BODY_PREVIEW_MAX);
  const messageId = msg?.id || '';
  const link = hotmailLink(messageId);

  return `
<tr>
<td style="padding:10px 0;border-bottom:1px solid #f0f0f0;">
<div style="font-size:13px;font-weight:600;color:#333;">
<a href="mailto:${escapeHtml(senderEmail)}" style="color:#1a73e8;text-decoration:none;">${escapeHtml(senderName)}</a>
${importanceBadge(importance)} ${attachmentBadge(Boolean(msg?.hasAttachments))} ${classificationLabel(classification)}
</div>
<div style="font-size:14px;color:#111;margin:4px 0;">
<strong>${escapeHtml(subject)}</strong>
</div>
<div style="font-size:12px;color:#666;">
${escapeHtml(receivedAt)}
</div>
<div style="font-size:12px;color:#555;margin:6px 0;line-height:1.4;">
${escapeHtml(previewDisplay)}${link ? ` <a href="${link}" style="color:#1a73e8;text-decoration:none;">Abrir en Hotmail</a>` : ''}
</div>
</td>
</tr>`;
}

function alertRowHtml(msg) {
  // Alert "Acciones requeridas" row: FULL bodyPreview, red Hotmail link.
  const { email: senderEmail, name: senderName } = pickSender(msg);
  const subject = pickSubject(msg);
  const importance = pickImportance(msg);
  const receivedAt = msg?.receivedAtCOL || '';
  const fullPreview = msg?.bodyPreview || '';
  const link = hotmailLink(msg?.id || '');

  return `
<tr>
<td style="padding:12px 0;border-bottom:1px solid #fef3c7;">
<div style="font-size:13px;font-weight:600;color:#333;">
<a href="mailto:${escapeHtml(senderEmail)}" style="color:#1a73e8;text-decoration:none;">${escapeHtml(senderName)}</a>
${importanceBadge(importance)}
</div>
<div style="font-size:14px;color:#111;margin:4px 0;">
<strong>${escapeHtml(subject)}</strong>
</div>
<div style="font-size:12px;color:#666;">
${escapeHtml(receivedAt)}
</div>
<div style="font-size:12px;color:#555;margin:6px 0;line-height:1.4;white-space:pre-wrap;">
${escapeHtml(fullPreview)}
</div>
<div style="font-size:12px;margin:4px 0;">
${link ? `<a href="${link}" style="color:#b91c1c;font-weight:500;">Abrir en Hotmail →</a>` : ''}
</div>
</td>
</tr>`;
}

function dateSectionHtml(dateLabel, msgs) {
  return `
<tr><td style="padding:16px 32px 8px;">
<h2 style="margin:0;font-size:16px;font-weight:600;color:#333;">${escapeHtml(dateLabel)}</h2>
</td></tr>
<tr><td style="padding:0 32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${msgs.map(messageRowHtml).join('')}
</table>
</td></tr>`;
}

function alertBannerHtml(alerts) {
  if (!Array.isArray(alerts) || alerts.length === 0) return '';
  const bullets = alerts.map((a) => {
    const subject = a?.subject || '(sin asunto)';
    const sender = a?.senderName || a?.senderEmail || '';
    const link = hotmailLink(a?.id || '');
    const subjectPart = link
      ? `<a href="${link}" style="color:#b91c1c;">${escapeHtml(subject)}</a>`
      : escapeHtml(subject);
    return `<li>${subjectPart} — ${escapeHtml(sender)}</li>`;
  }).join('');

  return `
<tr><td style="padding:16px 32px;background-color:#fef2f2;border-bottom:2px solid #dc2626;">
<table role="presentation" width="100%">
<tr>
<td style="vertical-align:top;padding-right:12px;width:32px;font-size:24px;">⚠️</td>
<td>
<div style="font-size:15px;font-weight:600;color:#991b1b;">
⚠️ ${alerts.length} alerta(s) crítica(s) detectada(s)
</div>
<ul style="margin:8px 0 0;padding:0 0 0 20px;font-size:13px;color:#7f1d1d;">
${bullets}
</ul>
</td>
</tr>
</table>
</td></tr>`;
}

function alertActionSectionHtml(alerts) {
  if (!Array.isArray(alerts) || alerts.length === 0) return '';
  return `
<tr><td style="padding:24px 32px;background-color:#fff7ed;border-bottom:1px solid #fed7aa;">
<h2 style="margin:0;font-size:16px;font-weight:600;color:#9a3412;">Acciones requeridas</h2>
<p style="margin:4px 0 16px;font-size:13px;color:#92400e;">
Los siguientes correos requieren atención inmediata:
</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
${alerts.map(alertRowHtml).join('')}
</table>
</td></tr>`;
}

function messagesByDateHtml(messages) {
  const byDate = new Map();
  for (const m of messages || []) {
    const key = pickDateLabel(m) || 'Sin fecha';
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key).push(m);
  }
  const sortedKeys = [...byDate.keys()].sort((a, b) => {
    if (a === 'Sin fecha') return 1;
    if (b === 'Sin fecha') return -1;
    return b.localeCompare(a); // desc when strings are comparable
  });
  return sortedKeys.map((k) => dateSectionHtml(k, byDate.get(k))).join('');
}

function buildSubject(hasAlerts, dateStr) {
  const prefix = hasAlerts ? '🚨 ' : '';
  return `${prefix}Reporte semanal Hotmail — ${dateStr}`;
}

function buildTextReport({ messages, account, dateRange, totals, alerts }) {
  const lines = [];
  lines.push('Reporte semanal Hotmail');
  lines.push(`Cuenta: ${account || ''} | Periodo: ${dateRange || ''}`);
  lines.push('');
  const t = totals || { total: 0, focused: 0, other: 0 };
  lines.push(`Total: ${t.total} (${t.focused} prioritarios, ${t.other} otros)`);

  if (Array.isArray(alerts) && alerts.length > 0) {
    lines.push('');
    lines.push(`⚠️ ${alerts.length} alerta(s) crítica(s) detectada(s):`);
    for (const a of alerts) {
      const subject = a?.subject || '(sin asunto)';
      const sender = a?.senderName || a?.senderEmail || '';
      lines.push(`  - ${subject} — ${sender}`);
    }
  }

  lines.push('');

  const byDate = new Map();
  for (const m of messages || []) {
    const key = pickDateLabel(m) || 'Sin fecha';
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key).push(m);
  }
  const sortedKeys = [...byDate.keys()].sort((a, b) => {
    if (a === 'Sin fecha') return 1;
    if (b === 'Sin fecha') return -1;
    return b.localeCompare(a);
  });

  for (const dateLabel of sortedKeys) {
    lines.push(dateLabel);
    for (const m of byDate.get(dateLabel)) {
      const { email, name } = pickSender(m);
      lines.push(`  ${name} <${email}>`);
      lines.push(`  Asunto: ${pickSubject(m)}`);
      lines.push(`  Fecha: ${m?.receivedAtCOL || ''}`);
      lines.push(`  ${truncate(m?.bodyPreview || '', BODY_PREVIEW_MAX)}`);
      const link = hotmailLink(m?.id || '');
      if (link) lines.push(`  ${link}`);
    }
    lines.push('');
  }

  if (Array.isArray(messages) && messages.length > 0) {
    lines.push('IDs procesados:');
    for (const m of messages) {
      if (m?.id) lines.push(`  - ${m.id}`);
    }
  }

  return lines.join('\n');
}

/**
 * Builds the weekly digest report.
 *
 * @param {{
 *   messages: Array<object>,
 *   account: string,
 *   dateRange: string,
 *   totals: { total: number, focused: number, other: number },
 *   alerts: Array<object>,
 *   dateStr: string,
 * }} data
 * @returns {{ html: string, text: string, subject: string }}
 */
export function buildReport(data) {
  const messages = Array.isArray(data?.messages) ? data.messages : [];
  const alerts = Array.isArray(data?.alerts) ? data.alerts : [];
  const totals = data?.totals || {
    total: messages.length,
    focused: messages.filter((m) => pickClassification(m) === 'focused').length,
    other: messages.filter((m) => pickClassification(m) === 'other').length,
  };
  const dateStr = data?.dateStr || '';
  const hasAlerts = alerts.length > 0;

  const subject = buildSubject(hasAlerts, dateStr);

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
</head>
<body style="margin:0;padding:0;background-color:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,Cantarell,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6f8;">
<tr><td align="center" style="padding:20px 10px;">
<table role="presentation" width="100%" style="max-width:720px;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">

<tr><td style="background-color:#1a73e8;padding:24px 32px;">
<h1 style="margin:0;font-size:20px;font-weight:600;color:#ffffff;">Reporte semanal Hotmail</h1>
<p style="margin:8px 0 0;font-size:14px;color:#ffffffcc;">
Cuenta: ${escapeHtml(data?.account || '')} &middot; Periodo: ${escapeHtml(data?.dateRange || '')}
</p>
</td></tr>

<tr><td style="padding:24px 32px;border-bottom:1px solid #e0e0e0;">
<table role="presentation" width="100%">
<tr>
<td style="text-align:center;padding:8px;">
<div style="font-size:28px;font-weight:700;color:#1a73e8;">${totals.total}</div>
<div style="font-size:12px;color:#666;">Total no leídos</div>
</td>
<td style="text-align:center;padding:8px;">
<div style="font-size:28px;font-weight:700;color:#34a853;">${totals.focused}</div>
<div style="font-size:12px;color:#666;">Prioritarios</div>
</td>
<td style="text-align:center;padding:8px;">
<div style="font-size:28px;font-weight:700;color:#ea4335;">${totals.other}</div>
<div style="font-size:12px;color:#666;">Otros</div>
</td>
</tr>
</table>
</td></tr>

${alertBannerHtml(alerts)}
${alertActionSectionHtml(alerts)}
${messagesByDateHtml(messages)}

<tr><td style="padding:16px 32px;background-color:#f8f9fa;border-top:1px solid #e0e0e0;">
<p style="margin:0;font-size:11px;color:#999;font-family:Consolas,monospace;">
IDs procesados: ${messages.map((m) => m?.id).filter(Boolean).join(', ')}
</p>
</td></tr>

</table>
</td></tr></table>
</body>
</html>`;

  const text = buildTextReport({
    messages,
    account: data?.account,
    dateRange: data?.dateRange,
    totals,
    alerts,
  });

  return { html, text, subject };
}

function buildErrorHtml({ stage, errorMessage, errorStack, runId, runUrl }) {
  const truncatedStack = (errorStack || '').slice(0, 2048);
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8">
</head>
<body style="margin:0;padding:0;background-color:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Oxygen,Ubuntu,Cantarell,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f6f8;">
<tr><td align="center" style="padding:20px 10px;">
<table role="presentation" width="100%" style="max-width:600px;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">

<tr><td style="background-color:#d93025;padding:20px 24px;">
<h1 style="margin:0;font-size:18px;font-weight:600;color:#ffffff;">ERROR: Reporte semanal Hotmail</h1>
</td></tr>

<tr><td style="padding:24px;">

<div style="margin-bottom:16px;">
<span style="display:inline-block;font-size:12px;padding:4px 12px;border-radius:4px;background-color:#fce8e6;color:#c5221f;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">${escapeHtml(stage || 'unknown')}</span>
</div>

<div style="font-size:14px;color:#333;margin-bottom:16px;font-family:Consolas,monospace;background-color:#f8f9fa;padding:12px;border-radius:4px;border-left:3px solid #d93025;white-space:pre-wrap;">
${escapeHtml(errorMessage || '(sin mensaje)')}
</div>

<div style="font-size:12px;color:#666;margin-bottom:16px;font-family:Consolas,monospace;background-color:#f8f9fa;padding:12px;border-radius:4px;white-space:pre-wrap;word-break:break-all;max-height:200px;overflow-y:auto;">
${escapeHtml(truncatedStack || '(sin stack)')}
</div>

<table role="presentation" style="font-size:13px;color:#333;">
<tr><td style="padding:4px 0;color:#666;">Run ID:</td><td style="padding:4px 8px;font-family:Consolas,monospace;">${escapeHtml(runId || 'n/a')}</td></tr>
<tr><td style="padding:4px 0;color:#666;">URL:</td><td style="padding:4px 8px;"><a href="${escapeHtml(runUrl || '#')}" style="color:#1a73e8;">${escapeHtml(runUrl || 'n/a')}</a></td></tr>
</table>

</td></tr>
</table>
</td></tr></table>
</body>
</html>`;
}

function buildErrorText({ stage, errorMessage, errorStack, runId, runUrl }) {
  const lines = [];
  lines.push('ERROR: Reporte semanal Hotmail');
  lines.push('');
  lines.push(`Stage: ${stage || 'unknown'}`);
  lines.push('');
  lines.push(`Error: ${errorMessage || '(sin mensaje)'}`);
  lines.push('');
  lines.push('Stack:');
  lines.push((errorStack || '(sin stack)').slice(0, 2048));
  lines.push('');
  lines.push(`Run ID: ${runId || 'n/a'}`);
  lines.push(`Run URL: ${runUrl || 'n/a'}`);
  return lines.join('\n');
}

/**
 * Builds the error-report email. Subject includes an ISO timestamp so
 * multiple errors in the same week don't collide in the inbox.
 *
 * @param {{ stage: string, errorMessage: string, errorStack?: string, runId?: string, runUrl?: string, nowIso?: string }} data
 * @returns {{ html: string, text: string, subject: string }}
 */
export function buildErrorReport(data) {
  const nowIso = data?.nowIso || new Date().toISOString();
  const subject = `ERROR: Reporte semanal Hotmail — ${nowIso}`;
  return {
    html: buildErrorHtml(data || {}),
    text: buildErrorText(data || {}),
    subject,
  };
}
