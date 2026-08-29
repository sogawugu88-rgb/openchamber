import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { I18nProvider } from '@/lib/i18n';
import { useUIStore } from '@/stores/useUIStore';
import type { SessionMetrics } from '../../sessionMetrics';
import { SessionMetricsBar } from './SessionMetricsBar';

const metrics: SessionMetrics = {
  turns: 2,
  steps: 4,
  model: 'provider-a / model-a',
  tokens: {
    total: 190,
    input: 100,
    output: 50,
    reasoning: 25,
    cacheRead: 10,
    cacheWrite: 5,
  },
  llmDurationMs: 1100,
  toolDurationMs: 3000,
  ttftMs: 5400,
  cacheHitPercent: 94.2,
  outputTokensPerSecond: 50.6,
};

describe('SessionMetricsBar', () => {
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
    useUIStore.setState({ showSessionTokenDetails: true });
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    root.unmount();
    windowInstance.close();
  });

  test('renders formatted session metrics when enabled', async () => {
    root.render(
      <I18nProvider>
        <SessionMetricsBar sessionMetrics={metrics} />
      </I18nProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const bar = host.querySelector('[data-session-metrics="true"]');
    expect(bar?.textContent).toContain('190');
    expect(bar?.textContent).toContain('94.2%');
    expect(bar?.textContent).not.toContain('provider-a / model-a');
    expect(bar?.textContent).not.toContain('Turns');
    expect(bar?.textContent).not.toContain('Steps');
    expect(bar?.textContent).not.toContain('Tools');
    expect(bar?.className).toContain('justify-center');
    expect(bar?.className).toContain('text-center');
  });

  test('does not render when session token details are disabled', async () => {
    useUIStore.setState({ showSessionTokenDetails: false });
    root.render(
      <I18nProvider>
        <SessionMetricsBar sessionMetrics={metrics} />
      </I18nProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(host.querySelector('[data-session-metrics="true"]')).toBeNull();
  });
});
