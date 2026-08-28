import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

import { registerTokenUsageRoutes } from './token-usage-routes.js';

const emptyReport = (month) => ({
  timezone: 'UTC',
  month,
  today: {
    date: '2026-08-27',
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
  currentMonth: {
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
  total: {
    input: 0,
    output: 0,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  },
  days: {},
  fetchedAt: 1_756_272_000_000,
});

const createApp = ({ service, timezone = 'UTC' }) => {
  const app = express();
  registerTokenUsageRoutes(app, {
    tokenUsageService: service,
    getServerTimezone: () => timezone,
  });
  return app;
};

describe('token usage route', () => {
  it('passes a valid month through and returns the complete report', async () => {
    const report = emptyReport('2026-07');
    const service = { getReport: vi.fn().mockResolvedValue(report) };

    await request(createApp({ service }))
      .get('/api/openchamber/token-usage?month=2026-07')
      .expect(200, report);

    expect(service.getReport).toHaveBeenCalledWith({ month: '2026-07' });
  });

  it('defaults to the current month in the server timezone', async () => {
    vi.useFakeTimers({ now: new Date('2026-08-01T01:30:00Z') });
    const report = emptyReport('2026-07');
    const service = { getReport: vi.fn().mockResolvedValue(report) };

    await request(createApp({ service, timezone: 'America/Los_Angeles' }))
      .get('/api/openchamber/token-usage')
      .expect(200, report);

    expect(service.getReport).toHaveBeenCalledWith({ month: '2026-07' });
    vi.useRealTimers();
  });

  it('rejects an invalid month without calling the service', async () => {
    const service = { getReport: vi.fn() };

    await request(createApp({ service }))
      .get('/api/openchamber/token-usage?month=2026-7')
      .expect(400, { error: 'month must use YYYY-MM format' });

    expect(service.getReport).not.toHaveBeenCalled();
  });

  it('returns a non-2xx JSON error when the service fails', async () => {
    const service = { getReport: vi.fn().mockRejectedValue(new Error('OpenCode unavailable')) };

    await request(createApp({ service }))
      .get('/api/openchamber/token-usage?month=2026-08')
      .expect(502, { error: 'OpenCode unavailable' });
  });

  it('returns a successful empty report without changing its shape', async () => {
    const report = emptyReport('2026-08');
    const service = { getReport: vi.fn().mockResolvedValue(report) };

    const response = await request(createApp({ service }))
      .get('/api/openchamber/token-usage?month=2026-08')
      .expect(200);

    expect(response.body).toEqual(report);
    expect(response.body.days).toEqual({});
    expect(response.body.total.total).toBe(0);
  });
});
