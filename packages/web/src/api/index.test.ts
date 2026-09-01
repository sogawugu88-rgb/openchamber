import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TokenUsageReport, RuntimeAPIs } from '@openchamber/ui/lib/api/types';

import { createWebAPIs } from './index';

const report: TokenUsageReport = {
  timezone: 'UTC',
  month: '2026-08',
  today: { date: '2026-08-27', input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  currentMonth: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  total: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  days: {},
  modelsByDay: {},
  fetchedAt: 1,
};

const mockRuntimeFetch = vi.fn(async () => new Response(JSON.stringify(report), { status: 200 }));

const runtimeAPIs: RuntimeAPIs = createWebAPIs({ runtimeFetch: mockRuntimeFetch });

beforeEach(() => {
  mockRuntimeFetch.mockClear();
});

describe('web token usage API', () => {
  it('composes a typed token usage API that fetches the OpenChamber route', async () => {
    await expect(runtimeAPIs.tokenUsage.getReport('2026-08', 'Asia/Shanghai')).resolves.toEqual(report);
    expect(mockRuntimeFetch).toHaveBeenCalledWith('/api/openchamber/token-usage', { query: { month: '2026-08', timezone: 'Asia/Shanghai' } });
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

  it('parses provider and model details for each usage date', async () => {
    const model = { providerID: 'provider-a', modelID: 'model-a', input: 2, output: 3, reasoning: 4, cacheRead: 5, cacheWrite: 6, total: 20 };
    mockRuntimeFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      ...report,
      days: { '2026-08-01': { ...report.total, total: 20 } },
      modelsByDay: { '2026-08-01': [model] },
    }), { status: 200 }));

    await expect(runtimeAPIs.tokenUsage.getReport('2026-08')).resolves.toMatchObject({
      modelsByDay: { '2026-08-01': [model] },
    });
  });

  it('rejects malformed provider and model details', async () => {
    mockRuntimeFetch.mockResolvedValueOnce(new Response(JSON.stringify({
      ...report,
      modelsByDay: { '2026-08-01': [{ ...report.total, providerID: 'provider-a' }] },
    }), { status: 200 }));

    await expect(runtimeAPIs.tokenUsage.getReport('2026-08')).rejects.toThrow('invalid data format');
  });
});
