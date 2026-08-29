# Token usage details implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persisted Composer token-details toggle and replace calendar-cell numbers with a recent-14-day table and clickable model-level daily details.

**Architecture:** Keep token aggregation in the Web server and extend the existing `/api/openchamber/token-usage` report with timezone-aware daily model buckets. The shared UI receives the expanded typed report, renders the calendar/table/details through one component, and keeps the context-panel request lazy. The Composer reads one persisted UI-store boolean and conditionally renders its existing metrics row.

**Tech Stack:** React 19, TypeScript, Bun tests, Vitest server tests, Express route, Zustand persistence, shared OpenChamber `RuntimeAPIs`, existing `Button`, `Collapsible`, `SettingsSection`, `SettingsCheckboxRow`, and sprite `Icon`.

## Global Constraints

- The token details setting controls only the Composer metrics row below the chat input.
- The setting defaults to enabled and persists through the existing UI settings persistence path.
- The client sends its browser IANA timezone; requests without a timezone fall back to the server timezone.
- The server owns session/message traversal, de-duplication, timezone bucketing, and provider/model aggregation.
- Fetch failure remains distinct from a successful empty report.
- Calendar cells show dates and color intensity only; token numbers appear in the recent-14-day table.
- Clicking a populated date expands that date's provider/model breakdown below the table; clicking it again collapses it.
- Use localized strings, semantic theme tokens, shared settings primitives, and sprite icons.
- Do not add dependencies or run Git/GitHub commands unless the user explicitly requests them.

---

### Task 1: Extend the token usage report contract and server aggregation

**Files:**
- Modify: `packages/ui/src/lib/api/types.ts:793-814`
- Modify: `packages/web/src/api/tokenUsage.ts:70-88`
- Modify: `packages/web/server/lib/opencode/token-usage.js:1-177`
- Modify: `packages/web/server/lib/opencode/token-usage-routes.js:1-50`
- Modify: `packages/web/server/lib/opencode/DOCUMENTATION.md:323-328`
- Test: `packages/web/server/lib/opencode/token-usage.test.js`
- Test: `packages/web/server/lib/opencode/token-usage-routes.test.js`
- Test: `packages/web/src/api/index.test.ts`

**Interfaces:**
- Add `TokenUsageModelBucket` with `providerID`, `modelID`, and the six numeric token fields.
- Add `TokenUsageReport.modelsByDay: Record<string, TokenUsageModelBucket[]>`.
- Keep `TokenUsageAPI.getReport(month?: string, timezone?: string): Promise<TokenUsageReport>`.
- The Web adapter sends query `{ month, timezone }` only when each value is present.
- The server service accepts `getReport({ month, timezone })`, validates the optional timezone, and returns `timezone` equal to the selected IANA zone.

- [ ] **Step 1: Write failing service tests for client-timezone model aggregation**

Add a test fixture with two assistant messages on the same local day but different provider/model pairs and assert:

```js
const report = await service.getReport({ month: '2026-08', timezone: 'Asia/Shanghai' });

expect(report.timezone).toBe('Asia/Shanghai');
expect(report.modelsByDay['2026-08-02']).toEqual([
  { providerID: 'provider-a', modelID: 'model-a', input: 1, output: 2, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 3 },
  { providerID: 'provider-b', modelID: 'model-b', input: 4, output: 5, reasoning: 6, cacheRead: 7, cacheWrite: 8, total: 30 },
]);
```

Also add an invalid-timezone service test that rejects with `Invalid token usage timezone`.

- [ ] **Step 2: Run the service tests and verify the expected failures**

Run: `bun test "server/lib/opencode/token-usage.test.js"`

Expected: FAIL because `modelsByDay` is absent and the service ignores the requested timezone.

- [ ] **Step 3: Implement model grouping at the aggregation owner**

In `normalizeMessage`, preserve the assistant message's provider/model identifiers. In `getReport`, choose `reportTimezone = timezone || getServerTimezone()`, validate it, use it for `todayDate`, `currentMonth`, and each sample date, then maintain:

```js
const modelsByDay = {};

if (date.slice(0, 7) === month) {
  days[date] ??= createBucket();
  addSample(days[date], sample.sample);
  modelsByDay[date] ??= new Map();
  const key = `${sample.providerID}\u0000${sample.modelID}`;
  const modelBucket = modelsByDay[date].get(key) ?? {
    providerID: sample.providerID,
    modelID: sample.modelID,
    ...createBucket(),
  };
  addSample(modelBucket, sample.sample);
  modelsByDay[date].set(key, modelBucket);
}
```

Serialize each date's map as a deterministic array sorted by descending `total`, then `providerID`, then `modelID`. Preserve zero-token fields and omit model groups only when the assistant message has no usable model identity.

- [ ] **Step 4: Implement route and Web adapter timezone forwarding**

Read `req.query.timezone`, reject invalid IANA zones with status `400`, use the selected zone when deriving the default month, and call `getReport` with `{ month, timezone }` when supplied. Update the typed Web adapter with explicit month/timezone branches so omitted query fields are not sent as empty values.

- [ ] **Step 5: Run the contract tests and update documentation**

Run:

```bash
bun test "server/lib/opencode/token-usage.test.js" "server/lib/opencode/token-usage-routes.test.js"
bun test "src/api/index.test.ts"
```

Update the OpenCode module documentation to describe `modelsByDay` and requested-timezone behavior. Expected result: all focused tests pass.

### Task 2: Add the persisted Composer token-details setting

**Files:**
- Modify: `packages/ui/src/stores/useUIStore.ts:807,988,1148,2405-2406`
- Modify: `packages/ui/src/lib/desktop.ts:48-216`
- Modify: `packages/ui/src/lib/persistence.ts:537-630,870-890,1645-1662`
- Modify: `packages/ui/src/components/sections/openchamber/OpenChamberVisualSettings.tsx`
- Modify: `packages/ui/src/components/sections/openchamber/OpenChamberPage.tsx`
- Modify: `packages/ui/src/lib/settings/search.ts`
- Modify: `packages/ui/src/lib/i18n/messages/en.settings.ts`
- Modify: `packages/ui/src/lib/i18n/messages/de.settings.ts`
- Modify: `packages/ui/src/lib/i18n/messages/es.settings.ts`
- Modify: `packages/ui/src/lib/i18n/messages/fr.settings.ts`
- Modify: `packages/ui/src/lib/i18n/messages/ja.settings.ts`
- Modify: `packages/ui/src/lib/i18n/messages/ko.settings.ts`
- Modify: `packages/ui/src/lib/i18n/messages/pl.settings.ts`
- Modify: `packages/ui/src/lib/i18n/messages/pt-BR.settings.ts`
- Modify: `packages/ui/src/lib/i18n/messages/uk.settings.ts`
- Modify: `packages/ui/src/lib/i18n/messages/zh-CN.settings.ts`
- Modify: `packages/ui/src/lib/i18n/messages/zh-TW.settings.ts`
- Modify: `packages/ui/src/components/chat/composer/ui/ComposerFooter.tsx:121-170`
- Test: `packages/ui/src/components/chat/sessionMetrics.test.ts`
- Test: `packages/ui/src/lib/settings/search.test.ts`

**Interfaces:**
- Add `showSessionTokenDetails?: boolean` to `DesktopSettings`.
- Add `showSessionTokenDetails: boolean` to the UI store with default `true` and setter `setShowSessionTokenDetails(value: boolean)`.
- Add `settings.openchamber.visual.field.showSessionTokenDetails` and its accessibility/info keys to every settings locale.
- Add search item `appearance.session-token-details` with page `appearance` and anchor `appearance.session-token-details`.

- [ ] **Step 1: Write a failing settings visibility test**

Add a pure helper or component-level contract proving the metrics row is shown when the setting is true and omitted when false. The assertion must cover all existing metric content as one row gate, not individual metric calculations.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `bun test "src/components/chat/sessionMetrics.test.ts"`

Expected: FAIL because no setting controls Composer metrics.

- [ ] **Step 3: Add the store, persisted setting, and Appearance checkbox**

Use the existing `reportUsage` pattern: materialize default from `useUIStore.getInitialState()`, apply authoritative settings only for booleans, sanitize persisted candidates only for booleans, and add the field to `DesktopSettings`. Render the checkbox in the Appearance settings list using `SettingsCheckboxRow` and `settingsItem="appearance.session-token-details"`.

- [ ] **Step 4: Gate only the Composer metrics row**

Read `showSessionTokenDetails` in `ComposerFooter` and change the existing condition from:

```tsx
{metricItems.length > 0 ? <div data-session-metrics="true">...</div> : null}
```

to:

```tsx
{showSessionTokenDetails && metricItems.length > 0 ? <div data-session-metrics="true">...</div> : null}
```

Do not gate context-panel Token content or Usage-page data.

- [ ] **Step 5: Add localized keys and search registration, then run focused checks**

Add real translations to all settings dictionaries. Add the registry item and verify its page is `appearance`. Run:

```bash
bun test "src/components/chat/sessionMetrics.test.ts" "src/lib/settings/search.test.ts"
bun run type-check:ui
```

### Task 3: Refactor the calendar into calendar, recent-days table, and model details

**Files:**
- Modify: `packages/ui/src/components/sections/usage/TokenUsageCalendar.tsx`
- Modify: `packages/ui/src/components/sections/usage/tokenUsage.ts`
- Modify: `packages/ui/src/components/sections/usage/tokenUsage.test.ts`
- Modify: `packages/ui/src/components/sections/usage/useTokenUsageCalendar.ts`
- Modify: `packages/ui/src/components/sections/usage/useTokenUsageCalendar.test.tsx`
- Modify: `packages/ui/src/lib/api/types.ts` if Task 1 type placement requires no earlier change
- Modify: all `packages/ui/src/lib/i18n/messages/*.ts` dictionaries containing shared UI keys

**Interfaces:**
- `TokenUsageCalendar` receives the expanded `TokenUsageReport` and remains controlled by the existing hook.
- Add pure helpers:
  - `getRecentUsageDays(report, count): string[]`
  - `getSelectedDayModelUsage(report, date): TokenUsageModelBucket[]`
  - `getUsageIntensity(total, maximum): 0 | 1 | 2 | 3 | 4`
- Keep complete numeric values in `title` and accessible labels while using compact display only where a narrow table requires it.

- [ ] **Step 1: Write failing helper tests for recent days and model selection**

Add a report fixture with usage on dates spanning a month boundary and assert:

```ts
expect(getRecentUsageDays(report, 14)).toEqual([
  '2026-08-28',
  '2026-08-27',
  '2026-08-25',
]);
expect(getSelectedDayModelUsage(report, '2026-08-27')).toEqual(report.modelsByDay['2026-08-27']);
```

Assert that an empty date returns `[]` and that the helper never returns more than 14 dates.

- [ ] **Step 2: Run the helper tests and verify the expected failures**

Run: `bun test "src/components/sections/usage/tokenUsage.test.ts"`

Expected: FAIL because the new helpers and report field are not implemented.

- [ ] **Step 3: Implement deterministic recent-day and selection helpers**

Sort keys lexically descending because the API date keys are validated `YYYY-MM-DD` strings. Use the same total values as the calendar intensity calculation. Never infer usage from missing dates.

- [ ] **Step 4: Replace cell token text with date-only intensity cells**

Render each calendar cell as a button only when it has a populated report date. Keep empty/out-of-month cells non-interactive. Use `aria-pressed` for the selected date, shared `Button` styling, and semantic selection tokens. Do not render the existing `formatCalendarTokenCount` spans inside calendar cells.

- [ ] **Step 5: Add the recent-14-day table and inline model details**

Under the calendar, render rows for recent usage dates with date, full/compact total, percentage relative to the recent-day maximum, and a semantic-token color bar. Clicking a row updates `selectedDate`; clicking the selected row clears it. Render model rows below the table, sorted in the API order, with provider/model, total, input, output, reasoning, cache read, and cache write. Empty dates cannot open a detail section.

- [ ] **Step 6: Add localized labels and component behavior tests**

Add keys for recent days, model details, provider/model labels, and accessible date controls in every locale. Test calendar-cell text, table date count, selection replacement, collapse-on-repeat, and model values through the public rendered component behavior. Run:

```bash
bun test "src/components/sections/usage/tokenUsage.test.ts" "src/components/sections/usage/useTokenUsageCalendar.test.tsx"
bun run type-check:ui
```

### Task 4: Integrate the expanded report across Usage and context surfaces

**Files:**
- Modify: `packages/ui/src/components/sections/usage/UsagePage.tsx`
- Modify: `packages/ui/src/components/layout/ContextSidebarTab.tsx`
- Modify: `packages/ui/src/components/sections/usage/TokenUsageCalendar.tsx`
- Modify: `packages/ui/src/components/sections/usage/useTokenUsageCalendar.ts`
- Test: `packages/ui/src/components/sections/usage/useTokenUsageCalendar.test.tsx`

**Interfaces:**
- Usage page keeps eager report loading and settlement refresh behavior.
- Context panel keeps the calendar collapsed by default and passes `enabled={expanded}` to `useTokenUsageCalendar`.
- Both surfaces pass `Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'` through the existing Runtime API.

- [ ] **Step 1: Add a lazy context-panel request assertion**

Extend the hook test so rendering with `enabled={false}` makes zero API calls, opening it makes one call with the browser timezone, and selecting a month reuses the same report state machine.

- [ ] **Step 2: Run the test and verify the lifecycle failure if present**

Run: `bun test "src/components/sections/usage/useTokenUsageCalendar.test.tsx"`

Expected: the new assertion fails until the context usage path is wired to the expanded report behavior.

- [ ] **Step 3: Keep UsagePage refresh semantics while using the shared calendar**

Remove duplicated request state only where the hook now owns it. Preserve refresh-on-settled-session behavior and stale runtime/month guards. Do not add a second model-detail request.

- [ ] **Step 4: Verify context-panel lazy loading and unchanged context details**

Render `ContextTokenUsageCalendar` outside the session-specific token breakdown. Confirm the existing last-assistant-message details remain visible regardless of the Composer setting. Keep VS Code's explicit unsupported API behavior unchanged.

- [ ] **Step 5: Run focused UI tests**

Run:

```bash
bun test "src/components/sections/usage/tokenUsage.test.ts" "src/components/sections/usage/useTokenUsageCalendar.test.tsx" "src/lib/settings/search.test.ts" "src/components/chat/sessionMetrics.test.ts"
bun run type-check:ui
```

### Task 5: Full validation and production runtime check

**Files:**
- Verify all modified files from Tasks 1-4.
- No new source file may remain unreferenced.

- [ ] **Step 1: Run package tests and type checks**

Run:

```bash
bun test "server/lib/opencode/token-usage.test.js" "server/lib/opencode/token-usage-routes.test.js"
bun run type-check:web
```

Expected: all tests pass and both type checks exit successfully.

- [ ] **Step 2: Run changed-file Oxlint**

Run:

```bash
bunx oxlint packages/ui/src/lib/api/types.ts packages/ui/src/stores/useUIStore.ts packages/ui/src/lib/desktop.ts packages/ui/src/lib/persistence.ts packages/ui/src/components/chat/composer/ui/ComposerFooter.tsx packages/ui/src/components/sections/openchamber/OpenChamberVisualSettings.tsx packages/ui/src/components/sections/usage/TokenUsageCalendar.tsx packages/ui/src/components/sections/usage/tokenUsage.ts packages/ui/src/components/sections/usage/useTokenUsageCalendar.ts packages/ui/src/components/layout/ContextSidebarTab.tsx packages/web/src/api/tokenUsage.ts packages/web/server/lib/opencode/token-usage.js packages/web/server/lib/opencode/token-usage-routes.js
```

Fix findings authored by this work. Record pre-existing findings separately; do not mass-fix unrelated code.

- [ ] **Step 3: Run dead-code analysis for new files/exports**

Run: `bun run dead-code`

Inspect the report for the new hook/helper exports. Remove exports that have no consumer unless they are required by tests or an established public module contract.

- [ ] **Step 4: Build the production Web bundle**

Run: `bun run build:web`

Expected: Vite completes successfully and writes the updated assets under `packages/web/dist`.

- [ ] **Step 5: Restart and verify the PM2 service**

Restart `openchamber-token-usage` only after the build completes. Verify with:

```bash
pm2 describe openchamber-token-usage
curl --noproxy '*' -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:5173/
```

Expected: PM2 is `online` and the app returns `200`. Do not use an unauthenticated token endpoint response as a data validation result; `401` is expected without the browser session.
