import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TokenUsageReport, RuntimeAPIs } from '@openchamber/ui/lib/api/types';
import type { RuntimeFetchOptions } from '@openchamber/ui/lib/runtime-fetch';

import { createWebAPIs } from './index';

const report: TokenUsageReport = {
  timezone: 'UTC',
  month: '2026-08',
  today: { date: '2026-08-27', input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  currentMonth: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  total: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  days: {},
  fetchedAt: 1,
};

const mockRuntimeFetch = vi.fn(async (_input: string | URL | Request, _init?: RuntimeFetchOptions) => new Response(JSON.stringify(report), { status: 200 }));

const runtimeAPIs: RuntimeAPIs = createWebAPIs({ runtimeFetch: mockRuntimeFetch });

beforeEach(() => {
  mockRuntimeFetch.mockClear();
});

describe('web token usage API', () => {
  it('composes a typed token usage API that fetches the OpenChamber route', async () => {
    await expect(runtimeAPIs.tokenUsage.getReport('2026-08')).resolves.toEqual(report);
    expect(mockRuntimeFetch).toHaveBeenCalledWith('/api/openchamber/token-usage', { query: { month: '2026-08' } });
  });

  it('requests the server default month when no month is selected', async () => {
    await expect(runtimeAPIs.tokenUsage.getReport()).resolves.toEqual(report);
    expect(mockRuntimeFetch).toHaveBeenCalledWith('/api/openchamber/token-usage');
  });

  it('rejects a successful response with a null or malformed report', async () => {
    mockRuntimeFetch.mockResolvedValueOnce(new Response('null', { status: 200 }));

    await expect(runtimeAPIs.tokenUsage.getReport('2026-08')).rejects.toThrow('invalid data format');
  });

  it('rejects a successful response with a malformed report month', async () => {
    mockRuntimeFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ...report, month: '2026-8' }), { status: 200 }));

    await expect(runtimeAPIs.tokenUsage.getReport('2026-08')).rejects.toThrow('invalid data format');
  });

  it('rejects a report with a malformed today date', async () => {
    mockRuntimeFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ...report, today: { ...report.today, date: '2026-8-27' } }), { status: 200 }));

    await expect(runtimeAPIs.tokenUsage.getReport('2026-08')).rejects.toThrow('invalid data format');
  });

  it('rejects a report with a malformed daily date key', async () => {
    mockRuntimeFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ...report, days: { '2026-8-01': report.total } }), { status: 200 }));

    await expect(runtimeAPIs.tokenUsage.getReport('2026-08')).rejects.toThrow('invalid data format');
  });

  it('rejects a daily date key outside the report month', async () => {
    mockRuntimeFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ...report, days: { '2026-07-31': report.total } }), { status: 200 }));

    await expect(runtimeAPIs.tokenUsage.getReport('2026-08')).rejects.toThrow('invalid data format');
  });

  it('rejects a report whose month differs from the requested month', async () => {
    mockRuntimeFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ...report, month: '2026-07' }), { status: 200 }));

    await expect(runtimeAPIs.tokenUsage.getReport('2026-08')).rejects.toThrow('invalid data format');
  });
});
