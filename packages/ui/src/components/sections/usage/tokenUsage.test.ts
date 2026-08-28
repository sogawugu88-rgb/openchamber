import { describe, expect, test } from 'bun:test';
import {
  buildMonthCalendar,
  formatTokenCount,
  getMonthKey,
  isTokenUsageReportCurrent,
  getUsageIntensity,
  hasSettledUsageTransition,
  createTokenUsageRequestCoordinator,
  shouldReloadTokenUsageMonth,
  isTokenUsageRequestCurrent,
} from './tokenUsage';
import type { TokenUsageReport } from '@/lib/api/types';

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

  test('only treats a report as current when runtime and requested month both match', () => {
    const bucket = { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
    const report: TokenUsageReport = {
      timezone: 'UTC',
      month: '2026-01',
      today: { ...bucket, date: '2026-01-01' },
      currentMonth: bucket,
      total: bucket,
      days: {},
      fetchedAt: 0,
    };

    expect(isTokenUsageReportCurrent(report, 'runtime-a', '2026-01', 'runtime-a')).toBe(true);
    expect(isTokenUsageReportCurrent(report, 'runtime-a', '2026-02', 'runtime-a')).toBe(false);
    expect(isTokenUsageReportCurrent(report, 'runtime-a', '2026-01', 'runtime-b')).toBe(false);
  });

  test('recognizes busy and retry transitions into idle or error as settled', () => {
    expect(hasSettledUsageTransition('busy', 'idle')).toBe(true);
    expect(hasSettledUsageTransition('busy', 'error')).toBe(true);
    expect(hasSettledUsageTransition('retry', 'idle')).toBe(true);
    expect(hasSettledUsageTransition('retry', 'error')).toBe(true);
    expect(hasSettledUsageTransition('busy', 'retry')).toBe(false);
    expect(hasSettledUsageTransition('idle', 'idle')).toBe(false);
  });

  test('coalesces settlements while a token usage request is in flight', async () => {
    let resolveRequest: (() => void) | undefined;
    let requestCount = 0;
    const coordinator = createTokenUsageRequestCoordinator(async () => {
      requestCount += 1;
      await new Promise<void>((resolve) => { resolveRequest = resolve; });
    });

    coordinator.request();
    coordinator.request();
    coordinator.request();
    expect(requestCount).toBe(1);

    resolveRequest?.();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(requestCount).toBe(2);
  });

  test('does not reload after adopting the month from the initial server-default report', () => {
    expect(shouldReloadTokenUsageMonth(null, '2026-08')).toBe(false);
    expect(shouldReloadTokenUsageMonth('2026-07', '2026-08')).toBe(true);
  });

  test('rejects a response after the selected month or runtime generation changes', () => {
    expect(isTokenUsageRequestCurrent(4, 4, 'runtime-a', 'runtime-a', '2026-08', '2026-08')).toBe(true);
    expect(isTokenUsageRequestCurrent(4, 5, 'runtime-a', 'runtime-a', '2026-08', '2026-08')).toBe(false);
    expect(isTokenUsageRequestCurrent(4, 4, 'runtime-a', 'runtime-b', '2026-08', '2026-08')).toBe(false);
    expect(isTokenUsageRequestCurrent(4, 4, 'runtime-a', 'runtime-a', '2026-07', '2026-08')).toBe(false);
  });

  test('continues after a rejected coordinated request without leaking a promise rejection', async () => {
    let requestCount = 0;
    const coordinator = createTokenUsageRequestCoordinator(async () => {
      requestCount += 1;
      throw new Error('request failed');
    });

    coordinator.request();
    await Promise.resolve();
    await Promise.resolve();
    coordinator.request();
    await Promise.resolve();
    expect(requestCount).toBe(2);
  });

  test('does not accept a response from an older month or runtime request', () => {
    expect(isTokenUsageRequestCurrent(4, 5, 'runtime-a', 'runtime-a', '2026-08', '2026-08')).toBe(false);
    expect(isTokenUsageRequestCurrent(4, 4, 'runtime-a', 'runtime-b', '2026-08', '2026-08')).toBe(false);
    expect(isTokenUsageRequestCurrent(4, 4, 'runtime-a', 'runtime-a', '2026-07', '2026-08')).toBe(false);
  });
});
