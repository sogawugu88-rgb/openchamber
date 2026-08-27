import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTokenUsageService } from './token-usage.js';

const bucket = (values = {}) => ({
  input: 0,
  output: 0,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
  total: 0,
  ...values,
});

const assistant = ({ sessionID, id, completed, providerID, modelID, step, tokens }) => {
  const info = {
    id,
    sessionID,
    role: 'assistant',
    providerID,
    modelID,
    time: { completed },
  };
  if (step !== undefined) info.step = step;
  if (tokens !== undefined) info.tokens = tokens;
  return { info, parts: [] };
};

const createService = (responses, timezone = 'UTC') => {
  const openCodeFetch = vi.fn(async (path) => {
    if (!(path in responses)) throw new Error(`Unexpected path: ${path}`);
    return responses[path];
  });
  return {
    service: createTokenUsageService({
      openCodeFetch,
      getServerTimezone: () => timezone,
    }),
    openCodeFetch,
  };
};

afterEach(() => {
  vi.useRealTimers();
});

describe('token usage service', () => {
  it('aggregates two sessions and models, de-duplicates samples, and folds cache components', async () => {
    const { service } = createService({
      '/session': [
        { id: 'session-1' },
        { id: 'session-2' },
      ],
      '/session/session-1/message': [
        assistant({
          sessionID: 'session-1', id: 'message-1', completed: '2026-08-01T10:00:00Z',
          providerID: 'one', modelID: 'alpha', step: 1,
          tokens: { input: 10, output: 4, reasoning: 2, cache: { read: 3, write: 1 } },
        }),
        assistant({
          sessionID: 'session-1', id: 'message-1', completed: '2026-08-01T10:00:00Z',
          providerID: 'one', modelID: 'alpha', step: 1,
          tokens: { input: 10, output: 4, reasoning: 2, cache: { read: 3, write: 1 } },
        }),
      ],
      '/session/session-2/message': [assistant({
        sessionID: 'session-2', id: 'message-2', completed: '2026-08-02T10:00:00Z',
        providerID: 'two', modelID: 'beta', step: 2,
        tokens: { input: 20, output: 5, reasoning: 1, cache: { read: 6, write: 2 } },
      })],
    });

    const report = await service.getReport({ month: '2026-08' });

    expect(report).toMatchObject({
      timezone: 'UTC',
      month: '2026-08',
      total: bucket({ input: 30, output: 9, reasoning: 3, cacheRead: 9, cacheWrite: 3, total: 54 }),
      currentMonth: bucket({ input: 30, output: 9, reasoning: 3, cacheRead: 9, cacheWrite: 3, total: 54 }),
      days: {
        '2026-08-01': bucket({ input: 10, output: 4, reasoning: 2, cacheRead: 3, cacheWrite: 1, total: 20 }),
        '2026-08-02': bucket({ input: 20, output: 5, reasoning: 1, cacheRead: 6, cacheWrite: 2, total: 34 }),
      },
    });
    expect(report.today).toMatchObject({ date: expect.any(String), ...bucket() });
    expect(report.fetchedAt).toEqual(expect.any(Number));
  });

  it('ignores missing usage and clamps invalid token fields to zero', async () => {
    const { service } = createService({
      '/session': [{ id: 'session-1' }],
      '/session/session-1/message': [
        assistant({ sessionID: 'session-1', id: 'without-usage', completed: '2026-08-01T10:00:00Z' }),
        assistant({
          sessionID: 'session-1', id: 'with-usage', completed: '2026-08-01T11:00:00Z',
          tokens: { input: -1, output: 2, reasoning: Number.NaN, cache: { read: Infinity, write: 3 } },
        }),
      ],
    });

    await expect(service.getReport({ month: '2026-08' })).resolves.toMatchObject({
      total: bucket({ output: 2, cacheWrite: 3, total: 5 }),
    });
  });

  it('uses the server timezone for today and daily buckets across local midnight', async () => {
    vi.useFakeTimers({ now: new Date('2026-08-02T00:30:00Z') });
    const { service } = createService({
      '/session': [{ id: 'session-1' }],
      '/session/session-1/message': [assistant({
        sessionID: 'session-1', id: 'message-1', completed: '2026-08-01T23:30:00Z',
        tokens: { input: 1, output: 1 },
      })],
    }, 'America/Los_Angeles');

    const report = await service.getReport({ month: '2026-08' });

    expect(report.today.date).toBe('2026-08-01');
    expect(report.days).toEqual({
      '2026-08-01': bucket({ input: 1, output: 1, total: 2 }),
    });
  });

  it('limits daily buckets to the selected month while retaining all-time and current-month totals', async () => {
    vi.useFakeTimers({ now: new Date('2026-08-15T12:00:00Z') });
    const { service } = createService({
      '/session': [{ id: 'session-1' }],
      '/session/session-1/message': [
        assistant({ sessionID: 'session-1', id: 'july', completed: '2026-07-31T12:00:00Z', tokens: { input: 7 } }),
        assistant({ sessionID: 'session-1', id: 'august', completed: '2026-08-03T12:00:00Z', tokens: { output: 8 } }),
      ],
    });

    await expect(service.getReport({ month: '2026-07' })).resolves.toMatchObject({
      currentMonth: bucket({ output: 8, total: 8 }),
      total: bucket({ input: 7, output: 8, total: 15 }),
      days: { '2026-07-31': bucket({ input: 7, total: 7 }) },
    });
  });

  it('returns a successful empty report for complete history without usage', async () => {
    const { service } = createService({ '/session': [] });

    await expect(service.getReport({ month: '2026-08' })).resolves.toMatchObject({
      total: bucket(),
      currentMonth: bucket(),
      days: {},
    });
  });

  it('rejects fetch failures and malformed source records', async () => {
    const failed = createService({ '/session': Promise.reject(new Error('offline')) });
    await expect(failed.service.getReport({ month: '2026-08' })).rejects.toThrow('offline');

    const malformed = createService({ '/session': { data: [] } });
    await expect(malformed.service.getReport({ month: '2026-08' })).rejects.toThrow(/session/i);
  });
});
