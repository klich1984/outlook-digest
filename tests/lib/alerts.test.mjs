import { describe, it, expect } from 'vitest';
import {
  SECURITY_DOMAINS,
  SECURITY_KEYWORDS,
  getDefaultSecurityDomains,
  getDefaultSecurityKeywords,
  detectAlert,
} from '../../scripts/lib/alerts.mjs';

describe('SECURITY_DOMAINS', () => {
  it('should have 14 entries', () => {
    expect(SECURITY_DOMAINS).toHaveLength(14);
  });

  it('should be frozen', () => {
    expect(Object.isFrozen(SECURITY_DOMAINS)).toBe(true);
  });

  it('should contain all expected sender domains/addresses', () => {
    const expected = [
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
    ];
    for (const entry of expected) {
      expect(SECURITY_DOMAINS).toContain(entry);
    }
  });

  it('should contain unique entries', () => {
    expect(new Set(SECURITY_DOMAINS).size).toBe(SECURITY_DOMAINS.length);
  });
});

describe('SECURITY_KEYWORDS', () => {
  it('should have 28 entries', () => {
    expect(SECURITY_KEYWORDS).toHaveLength(28);
  });

  it('should be frozen', () => {
    expect(Object.isFrozen(SECURITY_KEYWORDS)).toBe(true);
  });

  it('should contain all expected bilingual keywords', () => {
    const expected = [
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
    ];
    for (const entry of expected) {
      expect(SECURITY_KEYWORDS).toContain(entry);
    }
  });

  it('should contain unique entries', () => {
    expect(new Set(SECURITY_KEYWORDS).size).toBe(SECURITY_KEYWORDS.length);
  });
});

describe('getDefaultSecurityDomains', () => {
  it('should return a mutable copy of SECURITY_DOMAINS', () => {
    const copy = getDefaultSecurityDomains();
    expect(copy).toEqual(SECURITY_DOMAINS);
    expect(copy).not.toBe(SECURITY_DOMAINS);
    copy.push('test.example.com');
    expect(SECURITY_DOMAINS).toHaveLength(14);
  });
});

describe('getDefaultSecurityKeywords', () => {
  it('should return a mutable copy of SECURITY_KEYWORDS', () => {
    const copy = getDefaultSecurityKeywords();
    expect(copy).toEqual(SECURITY_KEYWORDS);
    expect(copy).not.toBe(SECURITY_KEYWORDS);
    copy.push('test keyword');
    expect(SECURITY_KEYWORDS).toHaveLength(28);
  });
});

function makeMsg(overrides = {}) {
  return {
    from: {
      emailAddress: {
        address: 'newsletter@example.com',
        name: 'Example Newsletter',
      },
    },
    subject: 'Your weekly update',
    importance: 'normal',
    ...overrides,
  };
}

describe('detectAlert — edge inputs', () => {
  it('should return isAlert=false for null message', () => {
    const result = detectAlert(null);
    expect(result.isAlert).toBe(false);
    expect(result.matchedCriteria).toEqual([]);
  });

  it('should return isAlert=false for undefined message', () => {
    const result = detectAlert(undefined);
    expect(result.isAlert).toBe(false);
    expect(result.matchedCriteria).toEqual([]);
  });

  it('should return isAlert=false for non-object message', () => {
    const result = detectAlert('string');
    expect(result.isAlert).toBe(false);
    expect(result.matchedCriteria).toEqual([]);
  });

  it('should return isAlert=false for empty object', () => {
    const result = detectAlert({});
    expect(result.isAlert).toBe(false);
    expect(result.matchedCriteria).toEqual([]);
  });

  it('should handle missing from.emailAddress.address gracefully', () => {
    const result = detectAlert(makeMsg({ from: undefined }));
    expect(result.isAlert).toBe(false);
  });

  it('should handle empty subject string', () => {
    const result = detectAlert(makeMsg({ subject: '' }));
    expect(result.isAlert).toBe(false);
  });
});

describe('detectAlert — Criterion A: domain match', () => {
  it.each([
    'accountprotection.microsoft.com',
    'security.microsoft.com',
    'noreply@github.com',
    'alert@google.com',
  ])('should match security domain: %s', (domain) => {
    const result = detectAlert(makeMsg({
      from: { emailAddress: { address: domain, name: domain } },
    }));
    expect(result.isAlert).toBe(true);
    expect(result.matchedCriteria).toContain('securityDomain');
  });

  it('should be case insensitive for domains', () => {
    const result = detectAlert(makeMsg({
      from: { emailAddress: { address: 'ACCOUNTPROTECTION.MICROSOFT.COM' } },
    }));
    expect(result.isAlert).toBe(true);
    expect(result.matchedCriteria).toContain('securityDomain');
  });

  it('should not match non-security domain', () => {
    const result = detectAlert(makeMsg({
      from: { emailAddress: { address: 'newsletter@example.com' } },
    }));
    expect(result.isAlert).toBe(false);
  });

  it('should not match partial domain (not exact match)', () => {
    const result = detectAlert(makeMsg({
      from: { emailAddress: { address: 'fake.accountprotection.microsoft.com.evil.com' } },
    }));
    expect(result.isAlert).toBe(false);
  });
});

describe('detectAlert — Criterion B: subject keyword match', () => {
  it.each([
    ['security alert', 'Please read this security alert'],
    ['alerta de seguridad', 'ALERTA DE SEGURIDAD importante'],
    ['verify your account', 'Please verify your account now'],
    ['verifica tu cuenta', 'Verifica tu cuenta hoy'],
    ['new sign-in', 'New sign-in from unknown device'],
    ['nuevo inicio de sesion', 'Nuevo inicio de sesion detectado'],
  ])('should match keyword "%s" in subject "%s"', (_keyword, subject) => {
    const result = detectAlert(makeMsg({ subject }));
    expect(result.isAlert).toBe(true);
    expect(result.matchedCriteria).toContain('securityKeyword');
  });

  it('should be case insensitive for keywords', () => {
    const result = detectAlert(makeMsg({ subject: 'SECURITY ALERT: Something' }));
    expect(result.isAlert).toBe(true);
  });

  it('should do substring matching (keyword inside longer text)', () => {
    const result = detectAlert(makeMsg({ subject: 'FW: security alert from IT department' }));
    expect(result.isAlert).toBe(true);
  });

  it('should not match non-security subject', () => {
    const result = detectAlert(makeMsg({ subject: 'Lunch tomorrow?' }));
    expect(result.isAlert).toBe(false);
  });

  it('should NOT flag non-matching subject even with "verify your" prefix (not a full keyword match)', () => {
    const result = detectAlert(makeMsg({
      from: { emailAddress: { address: 'orders@shop.example.com', name: 'Shop' } },
      subject: 'Verify your order shipped',
    }));
    // The keyword is "verify your account", which is NOT a substring
    // of "Verify your order shipped". This documents the actual behavior.
    expect(result.isAlert).toBe(false);
  });
});

describe('detectAlert — Criterion C: high importance', () => {
  it('should match importance=high with no other criteria', () => {
    const result = detectAlert(makeMsg({ importance: 'high' }));
    expect(result.isAlert).toBe(true);
    expect(result.matchedCriteria).toEqual(['highImportance']);
  });

  it('should NOT match importance=normal', () => {
    const result = detectAlert(makeMsg({ importance: 'normal' }));
    expect(result.isAlert).toBe(false);
  });

  it('should NOT match importance=low', () => {
    const result = detectAlert(makeMsg({ importance: 'low' }));
    expect(result.isAlert).toBe(false);
  });

  it('should NOT match missing importance field', () => {
    const result = detectAlert(makeMsg({ importance: undefined }));
    expect(result.isAlert).toBe(false);
  });
});

describe('detectAlert — combined criteria', () => {
  it('should match two criteria and return both in matchedCriteria', () => {
    const result = detectAlert(makeMsg({
      from: { emailAddress: { address: 'accountprotection.microsoft.com' } },
      subject: 'security alert: new sign-in detected',
      importance: 'normal',
    }));
    expect(result.isAlert).toBe(true);
    expect(result.matchedCriteria).toContain('securityDomain');
    expect(result.matchedCriteria).toContain('securityKeyword');
    expect(result.matchedCriteria).not.toContain('highImportance');
  });

  it('should match all three criteria', () => {
    const result = detectAlert(makeMsg({
      from: { emailAddress: { address: 'security@paypal.com' } },
      subject: 'Unusual sign-in attempt on your account',
      importance: 'high',
    }));
    expect(result.isAlert).toBe(true);
    expect(result.matchedCriteria).toHaveLength(3);
    expect(result.matchedCriteria).toContain('securityDomain');
    expect(result.matchedCriteria).toContain('securityKeyword');
    expect(result.matchedCriteria).toContain('highImportance');
  });
});

describe('detectAlert — custom config', () => {
  it('should accept custom securityDomains', () => {
    const result = detectAlert(
      makeMsg({
        from: { emailAddress: { address: 'custom-security@example.com' } },
      }),
      { securityDomains: ['custom-security@example.com'] },
    );
    expect(result.isAlert).toBe(true);
  });

  it('should accept custom securityKeywords', () => {
    const result = detectAlert(
      makeMsg({ subject: 'urgent: custom alert' }),
      { securityKeywords: ['custom alert'] },
    );
    expect(result.isAlert).toBe(true);
  });

  it('should not match default lists when custom lists are given', () => {
    const result = detectAlert(
      makeMsg({
        from: { emailAddress: { address: 'accountprotection.microsoft.com' } },
        subject: 'security alert',
      }),
      { securityDomains: [], securityKeywords: [] },
    );
    expect(result.isAlert).toBe(false);
  });
});
