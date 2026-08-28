import { describe, expect, it, vi } from 'vitest';
import type { TokenUsageReport, RuntimeAPIs } from '@openchamber/ui/lib/api/types';

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

vi.mock('@openchamber/ui/lib/runtime-fetch', () => ({
  runtimeFetch: vi.fn(async () => new Response(JSON.stringify(report), { status: 200 })),
}));

const runtimeAPIs: RuntimeAPIs = createWebAPIs();

describe('web token usage API', () => {
  it('composes a typed token usage API that fetches the OpenChamber route', async () => {
    await expect(runtimeAPIs.tokenUsage.getReport('2026-08')).resolves.toEqual(report);
  });
});
