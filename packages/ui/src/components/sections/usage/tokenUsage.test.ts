import { describe, expect, test } from 'bun:test';
import {
  buildMonthCalendar,
  formatTokenCount,
  getMonthKey,
  getUsageIntensity,
} from './tokenUsage';

describe('token usage helpers', () => {
  test('builds a fixed seven-column calendar from a month key', () => {
    const cells = buildMonthCalendar('2026-02');

    expect(cells).toHaveLength(42);
    expect(cells.slice(0, 6).every((cell) => cell.dateKey === null)).toBe(true);
    expect(cells[6]?.dateKey).toBe('2026-02-01');
    expect(cells[6]?.day).toBe(1);
    expect(cells[34]?.dateKey).toBe('2026-03-01');
    expect(cells[34]?.day).toBe(1);
    expect(cells[34]?.inMonth).toBe(false);
  });

  test('keeps server date keys on their calendar day without timezone conversion', () => {
    const cells = buildMonthCalendar('2026-01');
    const cell = cells.find((candidate) => candidate.dateKey === '2026-01-31');

    expect(cell?.day).toBe(31);
    expect(cell?.inMonth).toBe(true);
  });

  test('assigns empty, low, and high usage intensity levels from the month maximum', () => {
    expect(getUsageIntensity(0, 100)).toBe(0);
    expect(getUsageIntensity(1, 100)).toBe(1);
    expect(getUsageIntensity(25, 100)).toBe(2);
    expect(getUsageIntensity(75, 100)).toBe(3);
    expect(getUsageIntensity(100, 100)).toBe(4);
    expect(getUsageIntensity(100, 0)).toBe(0);
  });

  test('formats token counts with compact units while keeping small values exact', () => {
    expect(formatTokenCount(0)).toBe('0');
    expect(formatTokenCount(999)).toBe('999');
    expect(formatTokenCount(1_000)).toBe('1k');
    expect(formatTokenCount(1_250_000)).toBe('1.25M');
  });

  test('moves between month boundaries without browser date arithmetic', () => {
    expect(getMonthKey('2026-01', -1)).toBe('2025-12');
    expect(getMonthKey('2026-12', 1)).toBe('2027-01');
  });
});
