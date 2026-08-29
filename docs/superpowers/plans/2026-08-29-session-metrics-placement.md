# Session Metrics Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the live session metrics row outside the rounded Composer and show it directly below the full Composer on desktop and expanded mobile.

**Architecture:** Extract the existing metric formatting and rendering into `SessionMetricsBar`. Keep `ComposerFooter` responsible only for controls, and render the new bar after the shared pill/full Composer wrapper in `ChatInput`, outside the bordered Composer and dictation overlay. Reuse the current `SessionMetrics` data, `showSessionTokenDetails` setting, localization, tooltips, and visibility gate.

**Tech Stack:** React 19, TypeScript, Zustand, existing OpenChamber i18n and Tooltip primitives, Tailwind utility classes, Bun tests with `happy-dom`.

## Global Constraints

- Desktop and expanded mobile render the metrics bar below the Composer; the collapsed mobile pill does not render it.
- Do not change the server report, session metric derivation, persistence, or localized message keys.
- Use semantic theme classes and the existing `chat-input-column`; do not add hardcoded colors, icons, or user-facing strings.
- Do not add dependencies.
- Preserve the full Composer's flex growth, mobile keyboard behavior, and dictation overlay behavior.
- The compact row contains only total tokens, input, output, reasoning, cache, LLM duration, TTFT, cache hit rate, and output speed; it omits tool duration.
- The compact row centers its items and text on desktop and expanded mobile, including wrapped lines.
- Repository policy: do not run Git or GitHub commands, and do not commit, unless the user explicitly requests it.

---

### Task 1: Extract and test the session metrics bar

**Files:**
- Create: `packages/ui/src/components/chat/composer/ui/SessionMetricsBar.tsx`
- Test: `packages/ui/src/components/chat/composer/ui/SessionMetricsBar.test.tsx`

**Interfaces:**
- Consumes: `SessionMetrics` from `packages/ui/src/components/chat/sessionMetrics.ts`, `showSessionTokenDetails` from `useUIStore`, and translated labels from `useI18n()`.
- Produces: `SessionMetricsBar({ sessionMetrics, className? }: SessionMetricsBarProps)` and the existing `data-session-metrics="true"` marker for runtime inspection.

- [ ] **Step 1: Write the failing component test**

Create a happy-dom test that mounts the new component through `I18nProvider`, supplies a complete `SessionMetrics` value, and verifies the selected compact metrics while asserting that model, turn, and step details are omitted. Add a second assertion that the existing setting hides the bar.

```tsx
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
    expect(bar?.textContent).not.toContain('Turns');
    expect(bar?.textContent).not.toContain('Steps');
    expect(bar?.textContent).not.toContain('Tools');
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
```

- [ ] **Step 2: Run the new test and verify it fails for the missing component**

Run from `packages/ui`:

```bash
bun test "src/components/chat/composer/ui/SessionMetricsBar.test.tsx"
```

Expected result before implementation: the test fails because
`SessionMetricsBar.tsx` does not exist. If the test fails for an unrelated
environment or setup error, correct only that test setup and rerun it before
writing the component.

- [ ] **Step 3: Implement the extracted component**

Move the current metric item construction from `ComposerFooter` into the new
component without changing labels or calculations. Keep only the selected
compact metrics in the `metricItems` array. The component should use the
following shape:

```tsx
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { useUIStore } from '@/stores/useUIStore';
import { formatSessionTokenCount, shouldRenderSessionMetrics, type SessionMetrics } from '../../sessionMetrics';

type MetricItem = { display: string; full: string };

export interface SessionMetricsBarProps {
  sessionMetrics?: SessionMetrics;
  className?: string;
}

export function SessionMetricsBar({ sessionMetrics, className }: SessionMetricsBarProps) {
  const { t } = useI18n();
  const showSessionTokenDetails = useUIStore((state) => state.showSessionTokenDetails);

  const formatCount = (value: number): string => value.toLocaleString();
  const formatDuration = (value: number): string => value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;
  const metric = (label: string, value: string, fullValue = value): MetricItem => ({
    display: `${label}: ${value}`,
    full: `${label}: ${fullValue}`,
  });
  const plainMetric = (value: string): MetricItem => ({ display: value, full: value });
  const tokenMetric = (label: string, value: number): MetricItem => metric(label, formatSessionTokenCount(value), formatCount(value));
  const metricItems = sessionMetrics ? [
    sessionMetrics.tokens?.total !== undefined ? tokenMetric(t('chat.sessionMetrics.tokens'), sessionMetrics.tokens.total) : null,
    sessionMetrics.tokens ? tokenMetric(t('contextSidebar.tokens.input'), sessionMetrics.tokens.input) : null,
    sessionMetrics.tokens ? tokenMetric(t('contextSidebar.tokens.output'), sessionMetrics.tokens.output) : null,
    sessionMetrics.tokens ? tokenMetric(t('contextSidebar.tokens.reasoning'), sessionMetrics.tokens.reasoning) : null,
    sessionMetrics.tokens ? tokenMetric(t('chat.sessionMetrics.cacheTokens'), sessionMetrics.tokens.cacheRead + sessionMetrics.tokens.cacheWrite) : null,
    sessionMetrics.llmDurationMs !== undefined ? metric(t('chat.sessionMetrics.llm'), formatDuration(sessionMetrics.llmDurationMs)) : null,
    sessionMetrics.ttftMs !== undefined ? metric(t('chat.sessionMetrics.ttft'), formatDuration(sessionMetrics.ttftMs)) : null,
    sessionMetrics.cacheHitPercent !== undefined ? metric(t('chat.sessionMetrics.cache'), `${sessionMetrics.cacheHitPercent.toFixed(1)}%`) : null,
    sessionMetrics.outputTokensPerSecond !== undefined ? plainMetric(`${sessionMetrics.outputTokensPerSecond.toFixed(1)} ${t('chat.sessionMetrics.speed')}`) : null,
  ].filter((item): item is MetricItem => Boolean(item)) : [];

  if (!shouldRenderSessionMetrics(showSessionTokenDetails, metricItems.length)) return null;

  return (
    <div
      className={cn(
        'flex w-full min-w-0 flex-shrink-0 flex-wrap items-center gap-x-2 gap-y-0.5 px-1 typography-micro text-muted-foreground/70',
        className,
      )}
      data-session-metrics="true"
    >
      {metricItems.map((item, index) => (
        <Tooltip key={`${item.display}-${index}`}>
          <TooltipTrigger asChild>
            <span className="truncate tabular-nums" tabIndex={0} title={item.full} aria-label={item.full}>
              {item.display}
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[min(80vw,32rem)] break-words">
            {item.full}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run the component test and verify it passes**

Run:

```bash
bun test "src/components/chat/composer/ui/SessionMetricsBar.test.tsx"
```

Expected result: both tests pass and the output contains no failures.

### Task 2: Remove metrics from the footer and place them below the Composer

**Files:**
- Modify: `packages/ui/src/components/chat/composer/ui/ComposerFooter.tsx:21-172, 310-313`
- Modify: `packages/ui/src/components/chat/ChatInput.tsx:145, 2929-2964`

**Interfaces:**
- Consumes: `SessionMetricsBar` from Task 1 and the existing `sessionMetrics` value in `ChatInput`.
- Produces: `ComposerFooter` with the same control props as before, except it no longer accepts or renders `sessionMetrics`.

- [ ] **Step 1: Remove metrics-only imports, props, helpers, and markup from `ComposerFooter`**

Delete the `useUIStore`, Tooltip, and session-metric imports. Remove
`sessionMetrics?: SessionMetrics` from `ComposerFooterProps`, remove the
destructured value, restore the footer's outer layout to a single controls row,
and delete the metric formatting helpers and the `[data-session-metrics]` block.
The footer should begin with the controls wrapper in this shape:

```tsx
<div
  className={cn(
    'bg-transparent flex w-full flex-shrink-0',
    footerPaddingClass,
    isMobile ? 'items-center gap-x-1.5' : cn('items-center justify-between', footerGapClass),
  )}
  style={{
    borderBottomLeftRadius: chatInputRadius,
    borderBottomRightRadius: chatInputRadius,
  }}
  data-chat-input-footer="true"
>
```

- [ ] **Step 2: Add the `SessionMetricsBar` import and render it outside the full Composer wrapper**

Add:

```tsx
import { SessionMetricsBar } from './composer/ui/SessionMetricsBar';
```

Remove `sessionMetrics={sessionMetrics}` from the `ComposerFooter` call. After
the shared pill/full wrapper closes at the existing `</div>` before
`DraftPresetChips`, render the bar only for desktop or the expanded mobile
Composer:

```tsx
{(!isMobile || mobileComposerExpanded) ? (
  <SessionMetricsBar sessionMetrics={sessionMetrics} className="mt-1" />
) : null}
```

This location is outside the bordered Composer, outside the mobile wrapper-level
dictation overlay, and still inside `chat-input-column`, so its width and
responsive padding align with the Composer.

- [ ] **Step 3: Run the focused tests and UI type check**

Run from `packages/ui`:

```bash
bun test "src/components/chat/composer/ui/SessionMetricsBar.test.tsx" "src/components/chat/sessionMetrics.test.ts"
bun run type-check
```

Expected result: all focused tests pass and TypeScript reports no errors.

### Task 3: Verify visual behavior and changed-file lint

**Files:**
- Verify: `packages/ui/src/components/chat/ChatInput.tsx`
- Verify: `packages/ui/src/components/chat/composer/ui/ComposerFooter.tsx`
- Verify: `packages/ui/src/components/chat/composer/ui/SessionMetricsBar.tsx`
- Verify: `packages/ui/src/components/chat/composer/ui/SessionMetricsBar.test.tsx`

- [ ] **Step 1: Run changed-file Oxlint**

Run from the worktree root:

```bash
bunx oxlint packages/ui/src/components/chat/ChatInput.tsx packages/ui/src/components/chat/composer/ui/ComposerFooter.tsx packages/ui/src/components/chat/composer/ui/SessionMetricsBar.tsx packages/ui/src/components/chat/composer/ui/SessionMetricsBar.test.tsx
```

Expected result: no new lint findings in the changed files.

- [ ] **Step 2: Check the desktop layout**

Start or use the existing Web development server and inspect a session with
completed metrics. Confirm that:

```text
the rounded Composer ends before the metrics row
the metrics row aligns with the Composer column and wraps without horizontal overflow
the row remains visible while the Composer dictation overlay is active
the setting still hides the row
```

- [ ] **Step 3: Check the mobile layout**

At a mobile viewport, confirm that:

```text
the collapsed pill still has no metrics row
the expanded Composer shows the row immediately below its rounded border
the row wraps within the viewport and does not interfere with the keyboard-safe bottom spacing
the dictation overlay and Composer controls retain their existing positions
```

- [ ] **Step 4: Run the final focused regression test**

Run from `packages/ui`:

```bash
bun test "src/components/chat/composer/ui/SessionMetricsBar.test.tsx" "src/components/chat/sessionMetrics.test.ts"
```

Expected result: all tests pass.
