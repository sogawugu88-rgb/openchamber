import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { I18nProvider } from '@/lib/i18n';
import type { TokenUsageReport } from '@/lib/api/types';
import { TokenUsageCalendar } from './TokenUsageCalendar';

const bucket = { input: 100, output: 50, reasoning: 25, cacheRead: 10, cacheWrite: 5, total: 190 };

const report: TokenUsageReport = {
  timezone: 'UTC',
  month: '2026-08',
  today: { ...bucket, date: '2026-08-28' },
  currentMonth: bucket,
  total: bucket,
  days: {
    '2026-08-01': bucket,
    '2026-08-02': { ...bucket, total: 80 },
  },
  modelsByDay: {
    '2026-08-01': [
      { providerID: 'provider-a', modelID: 'model-a', input: 60, output: 20, reasoning: 10, cacheRead: 5, cacheWrite: 5, total: 100 },
      { providerID: 'provider-b', modelID: 'model-b', input: 40, output: 30, reasoning: 15, cacheRead: 5, cacheWrite: 0, total: 90 },
    ],
  },
  fetchedAt: 1,
};

describe('TokenUsageCalendar', () => {
  let windowInstance: Window;
  let host: HTMLDivElement;
  let root: Root;

  const waitForReactCommit = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

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

  test('shows date-only calendar cells and a recent usage table', async () => {
    root.render(
      <I18nProvider>
        <TokenUsageCalendar
          month="2026-08"
          report={report}
          loading={false}
          onMonthChange={() => {}}
          onRetry={() => {}}
          error={null}
        />
      </I18nProvider>,
    );
    await waitForReactCommit();

    const dateButton = host.querySelector('[data-token-date="2026-08-01"]');
    expect(dateButton?.textContent?.trim()).toBe('1');
    expect(host.querySelector('[data-token-usage-recent-days]')).not.toBeNull();
    expect(host.querySelectorAll('[data-token-usage-day]')).toHaveLength(2);
    expect(Array.from(host.querySelectorAll('[role="columnheader"]')).map((header) => header.textContent?.trim())).not.toContain('Share');
  });

  test('expands the selected date model details and collapses on repeat', async () => {
    root.render(
      <I18nProvider>
        <TokenUsageCalendar
          month="2026-08"
          report={report}
          loading={false}
          onMonthChange={() => {}}
          onRetry={() => {}}
          error={null}
        />
      </I18nProvider>,
    );
    await waitForReactCommit();

    const dateRow = host.querySelector('[data-token-usage-day="2026-08-01"]');
    if (!(dateRow instanceof HTMLElement)) throw new Error('Recent usage row was not rendered');
    dateRow.click();
    await waitForReactCommit();

    expect(host.querySelector('[data-token-model-details]')?.textContent).toContain('provider-a / model-a');
    expect(host.querySelector('[data-token-model-details]')?.textContent).toContain('provider-b / model-b');
    expect(host.querySelector('[data-token-model-details]')?.textContent).toContain('53%');
    expect(host.querySelector('[data-token-model-details]')?.textContent).toContain('47%');

    dateRow.click();
    await waitForReactCommit();
    expect(host.querySelector('[data-token-model-details]')).toBeNull();
  });
});
