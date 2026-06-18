import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import {
  getPartsInCOL,
  getNowInCOL,
  formatDateInCOL,
  formatTimeInCOL,
  formatDateRangeInCOL,
  getLastNDays,
  getWeekdayInCOL,
} from '../../scripts/lib/timezone.mjs';

describe('getPartsInCOL', () => {
  it('should convert UTC to COL (UTC-5) correctly', () => {
    const d = new Date('2026-06-17T12:00:00.000Z');
    const parts = getPartsInCOL(d);
    expect(parts.year).toBe(2026);
    expect(parts.month).toBe(6);
    expect(parts.day).toBe(17);
    expect(parts.hour).toBe(7);
    expect(parts.minute).toBe(0);
    expect(parts.weekday).toBe(3);
  });

  it('should handle dates that cross midnight in COL', () => {
    const d = new Date('2026-06-18T04:00:00.000Z');
    const parts = getPartsInCOL(d);
    expect(parts.year).toBe(2026);
    expect(parts.month).toBe(6);
    expect(parts.day).toBe(17);
    expect(parts.hour).toBe(23);
    expect(parts.minute).toBe(0);
  });

  it('should handle dates that cross into next day in COL', () => {
    const d = new Date('2026-06-17T05:00:00.000Z');
    const parts = getPartsInCOL(d);
    expect(parts.year).toBe(2026);
    expect(parts.month).toBe(6);
    expect(parts.day).toBe(17);
    expect(parts.hour).toBe(0);
    expect(parts.minute).toBe(0);
  });

  it('should accept string input', () => {
    const parts = getPartsInCOL('2026-06-17T12:00:00.000Z');
    expect(parts.year).toBe(2026);
    expect(parts.month).toBe(6);
    expect(parts.day).toBe(17);
  });

  it('should accept numeric timestamp input', () => {
    const ts = new Date('2026-06-17T12:00:00.000Z').getTime();
    const parts = getPartsInCOL(ts);
    expect(parts.year).toBe(2026);
    expect(parts.month).toBe(6);
  });

  it('should throw RangeError for invalid date', () => {
    expect(() => getPartsInCOL('not-a-date')).toThrow(RangeError);
  });
});

describe('getNowInCOL', () => {
  it('should return current time parts', () => {
    const parts = getNowInCOL();
    expect(parts).toHaveProperty('year');
    expect(parts).toHaveProperty('month');
    expect(parts).toHaveProperty('day');
    expect(parts).toHaveProperty('hour');
    expect(parts).toHaveProperty('minute');
    expect(parts).toHaveProperty('weekday');
    expect(typeof parts.year).toBe('number');
    expect(typeof parts.month).toBe('number');
    expect(typeof parts.day).toBe('number');
    expect(typeof parts.hour).toBe('number');
    expect(typeof parts.minute).toBe('number');
    expect(typeof parts.weekday).toBe('number');
  });
});

describe('formatDateInCOL', () => {
  it('should format short: "17 jun 2026"', () => {
    const d = new Date('2026-06-17T12:00:00.000Z');
    expect(formatDateInCOL(d)).toBe('17 jun 2026');
  });

  it('should format long: "17 de junio de 2026"', () => {
    const d = new Date('2026-06-17T12:00:00.000Z');
    expect(formatDateInCOL(d, { long: true })).toBe('17 de junio de 2026');
  });

  it('should handle first month: enero', () => {
    const d = new Date('2026-01-15T12:00:00.000Z');
    expect(formatDateInCOL(d)).toBe('15 ene 2026');
  });

  it('should handle last month: diciembre', () => {
    const d = new Date('2026-12-25T12:00:00.000Z');
    expect(formatDateInCOL(d)).toBe('25 dic 2026');
  });
});

describe('formatTimeInCOL', () => {
  it('should format as "HH:MM COL"', () => {
    const d = new Date('2026-06-17T12:00:00.000Z');
    expect(formatTimeInCOL(d)).toBe('07:00 COL');
  });

  it('should pad single-digit hours', () => {
    const d = new Date('2026-06-17T05:00:00.000Z');
    expect(formatTimeInCOL(d)).toBe('00:00 COL');
  });
});

describe('formatDateRangeInCOL', () => {
  it('should format range with en-dash separator', () => {
    const from = new Date('2026-06-10T12:00:00.000Z');
    const to = new Date('2026-06-17T12:00:00.000Z');
    expect(formatDateRangeInCOL(from, to)).toBe('10 jun 2026 – 17 jun 2026');
  });
});

describe('getWeekdayInCOL', () => {
  it('should return Spanish weekday name', () => {
    const d = new Date('2026-06-17T12:00:00.000Z');
    expect(getWeekdayInCOL(d)).toBe('miércoles');
  });

  it('should return lunes for Monday', () => {
    const d = new Date('2026-06-15T12:00:00.000Z');
    expect(getWeekdayInCOL(d)).toBe('lunes');
  });

  it('should return domingo for Sunday', () => {
    const d = new Date('2026-06-21T12:00:00.000Z');
    expect(getWeekdayInCOL(d)).toBe('domingo');
  });

  it('should return sábado for Saturday', () => {
    const d = new Date('2026-06-20T12:00:00.000Z');
    expect(getWeekdayInCOL(d)).toBe('sábado');
  });
});

describe('getLastNDays', () => {
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-17T12:00:00.000Z'));
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  it('should return from and to as Date objects', () => {
    const { from, to } = getLastNDays(7);
    expect(from).toBeInstanceOf(Date);
    expect(to).toBeInstanceOf(Date);
  });

  it('should set to as current time', () => {
    const { to } = getLastNDays(7);
    expect(to.toISOString()).toBe('2026-06-17T12:00:00.000Z');
  });

  it('should set from as N days before', () => {
    const { from } = getLastNDays(7);
    expect(from.toISOString()).toBe('2026-06-10T12:00:00.000Z');
  });

  it('should work with 0 days', () => {
    const { from, to } = getLastNDays(0);
    expect(from.toISOString()).toBe(to.toISOString());
  });
});
