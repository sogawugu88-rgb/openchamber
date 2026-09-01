import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { TokenUsageAPI, TokenUsageReport } from '@/lib/api/types';
import { useTokenUsageCalendar, type UseTokenUsageCalendarResult } from './useTokenUsageCalendar';

const bucket = { input: 1, output: 2, reasoning: 3, cacheRead: 4, cacheWrite: 5, total: 15 };

const reportFor = (month: string): TokenUsageReport => ({
  timezone: 'UTC',
  month,
  today: { ...bucket, date: `${month}-01` },
  currentMonth: bucket,
  total: bucket,
  days: {},
  modelsByDay: {},
  fetchedAt: 1,
});

const waitForReactCommit = async (): Promise<void> => {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

interface HookStateHolder {
  current: UseTokenUsageCalendarResult | null;
}

describe('useTokenUsageCalendar', () => {
  let windowInstance: Window;
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    windowInstance = new Window();
    Object.assign(globalThis, {
      window: windowInstance,
      document: windowInstance.document,
      HTMLElement: windowInstance.HTMLElement,
      Element: windowInstance.Element,
      Node: windowInstance.Node,
      IS_REACT_ACT_ENVIRONMENT: true,
    });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    root.unmount();
    windowInstance.close();
  });

  test('does not request until enabled, then accepts the active month report', async () => {
    const requestedMonths: Array<string | undefined> = [];
    const requestedTimezones: Array<string | undefined> = [];
    const tokenUsage: TokenUsageAPI = {
      getReport: async (month, timezone) => {
        requestedMonths.push(month);
        requestedTimezones.push(timezone);
        return reportFor(month ?? '2026-08');
      },
    };
    let enabled = false;
    const stateHolder: HookStateHolder = { current: null };

    const Probe: React.FC = () => {
      stateHolder.current = useTokenUsageCalendar({ enabled, tokenUsage, runtimeKey: 'runtime-a' });
      return null;
    };

    root.render(<Probe />);
    await waitForReactCommit();
    expect(requestedMonths).toEqual([]);

    enabled = true;
    root.render(<Probe />);
    await waitForReactCommit();

    expect(requestedMonths).toEqual([undefined]);
    expect(requestedTimezones).toEqual([Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC']);
    const state = stateHolder.current;
    if (!state) throw new Error('Hook state was not rendered');
    expect(state.month).toBe('2026-08');
    expect(state.report?.month).toBe('2026-08');
    expect(state.error).toBeNull();
  });
});
