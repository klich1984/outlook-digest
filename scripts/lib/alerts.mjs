/**
 * Security-alert detection for the weekly digest.
 *
 * Three independent criteria are combined with OR (per spec
 * `security-alerts`). Any single match flags the message as an alert;
 * multiple matches are recorded in `matchedCriteria` so the report can
 * show why.
 *
 *   A. Sender address is in SECURITY_DOMAINS (14 hardcoded entries).
 *      The spec lists some entries as bare domains (matched against the
 *      from.emailAddress.address value) and some as full email
 *      addresses (also matched exactly). Exact case-insensitive match.
 *
 *   B. Subject contains any SECURITY_KEYWORD (substring, case
 *      insensitive). 28 bilingual entries (EN + ES).
 *
 *   C. importance field equals "high".
 *
 * Hardcoded by design (locked decision): no external config file. If
 * the lists ever need to change without touching code, the same
 * detectAlert() signature can read from a JSON file without altering
 * callers.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Sender list (14 entries per spec/security-alerts)
// Exact match (case-insensitive) against from.emailAddress.address.
// Some entries are bare domains; some are full email addresses. The spec
// is the source of truth.
// ─────────────────────────────────────────────────────────────────────────────
export const SECURITY_DOMAINS = Object.freeze([
  'accountprotection.microsoft.com',
  'security.microsoft.com',
  'security@apple.com',
  'appleid@id.apple.com',
  'alert@paypal.com',
  'security@paypal.com',
  'alert@google.com',
  'no-reply@accounts.google.com',
  'security@linkedin.com',
  'security@facebookmail.com',
  'alert@twitter.com',
  'security@instagram.com',
  'security@dropbox.com',
  'noreply@github.com',
]);

// ─────────────────────────────────────────────────────────────────────────────
// Subject keyword list (28 entries per spec/security-alerts)
// Substring match (case-insensitive) against the message subject.
// Bilingual (English + Spanish). False positives are accepted by design
// (spec scenario "Falso positivo por coincidencia de palabra clave").
// ─────────────────────────────────────────────────────────────────────────────
export const SECURITY_KEYWORDS = Object.freeze([
  'security alert',
  'alerta de seguridad',
  'verify your account',
  'verifica tu cuenta',
  'unusual sign-in',
  'inicio de sesion inusual',
  'suspicious activity',
  'actividad sospechosa',
  'password reset',
  'restablecimiento de contrasena',
  'account compromised',
  'cuenta comprometida',
  'security update',
  'actualizacion de seguridad',
  'new sign-in',
  'nuevo inicio de sesion',
  'account locked',
  'cuenta bloqueada',
  'unrecognized device',
  'dispositivo no reconocido',
  'sign-in attempt',
  'intento de inicio de sesion',
  'recovery code',
  'codigo de recuperacion',
  'two-factor authentication',
  'autenticacion de dos factores',
  'security breach',
  'violacion de seguridad',
]);

export function getDefaultSecurityDomains() {
  return [...SECURITY_DOMAINS];
}

export function getDefaultSecurityKeywords() {
  return [...SECURITY_KEYWORDS];
}

/**
 * @typedef {{
 *   isAlert: boolean,
 *   matchedCriteria: string[],
 * }} AlertResult
 */

/**
 * Evaluates a message against the three OR criteria.
 *
 * @param {object} message - Graph API message object
 * @param {{ securityDomains?: string[], securityKeywords?: string[] }} [config]
 * @returns {AlertResult}
 */
export function detectAlert(message, config = {}) {
  const domains = config.securityDomains || SECURITY_DOMAINS;
  const keywords = config.securityKeywords || SECURITY_KEYWORDS;
  const matched = [];

  if (message && typeof message === 'object') {
    // Criterion A — sender address exact match.
    const fromAddress = message?.from?.emailAddress?.address;
    if (typeof fromAddress === 'string' && fromAddress.length > 0) {
      const lowerFrom = fromAddress.toLowerCase();
      if (domains.some((d) => typeof d === 'string' && lowerFrom === d.toLowerCase())) {
        matched.push('securityDomain');
      }
    }

    // Criterion B — subject keyword substring match.
    const subject = message?.subject;
    if (typeof subject === 'string' && subject.length > 0) {
      const lowerSubject = subject.toLowerCase();
      if (keywords.some((k) => typeof k === 'string' && lowerSubject.includes(k.toLowerCase()))) {
        matched.push('securityKeyword');
      }
    }

    // Criterion C — importance high.
    if (message.importance === 'high') {
      matched.push('highImportance');
    }
  }

  return {
    isAlert: matched.length > 0,
    matchedCriteria: matched,
  };
}
