# Goal audit failure limit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users configure how many consecutive unavailable or rate-limited Goal audit calls are tolerated before the Goal becomes blocked, while preserving the default limit of 2.

**Architecture:** The web server remains the owner of Goal lifecycle decisions. Settings sanitization supplies a bounded persisted value, and the Goal runtime reads that value at tick time with a fail-closed default. Shared settings state mirrors the server value so the Settings UI can edit it through existing persistence paths.

**Tech Stack:** Node.js ESM, React, Zustand, shared OpenChamber settings runtime, Vitest/Bun tests, existing Settings primitives and i18n.

## Global Constraints

- `sessionGoalAuditFailureLimit` is an integer from `1` through `20`, default `2`.
- An invalid update is rejected without replacing the previous persisted value.
- A missing or invalid stored value resolves to `2`.
- Other Goal terminal conditions remain unchanged.
- User-facing strings use `@/lib/i18n` and are translated in every locale dictionary.
- Do not add dependencies or expose credentials.

---

### Task 1: Add the persisted settings contract

**Files:**
- Modify: `packages/web/server/lib/opencode/settings-helpers.js` near the existing Goal settings sanitization.
- Modify: `packages/web/server/lib/opencode/settings-helpers.test.js` beside Goal settings cases.
- Modify: `packages/ui/src/lib/desktop.ts` in `DesktopSettings`.
- Modify: `packages/ui/src/stores/useUIStore.ts` in the state interface, initial state, setter, and persisted state shape.
- Modify: `packages/ui/src/lib/persistence.ts` in authoritative materialization, hydration, and payload normalization.
- Test: `packages/ui/src/lib/persistence.test.ts` for round-trip behavior if existing settings tests cover the new field.

**Interfaces:**
- Produces sanitized `sessionGoalAuditFailureLimit: number` with the valid range `1..20`.
- Produces a shared `DesktopSettings.sessionGoalAuditFailureLimit?: number` field.
- Produces a UI store value with default `2` and a setter used by the Settings page.

- [ ] **Step 1: Write failing server sanitizer tests.** Add assertions that `1`, `2`, and `20` are accepted, `0`, `21`, fractional, non-finite, and string values are rejected, and `formatSettingsResponse({})` returns the default `2`.

- [ ] **Step 2: Run the focused server test.**

Run: `bun test packages/web/server/lib/opencode/settings-helpers.test.js`

Expected: the new assertions fail because the field is not yet recognized.

- [ ] **Step 3: Implement the sanitizer and response default.** Define one local range/default constant in `settings-helpers.js`; accept only safe integers from `1` through `20`, preserve the existing settings update behavior for unrelated fields, and include the normalized default in formatted responses.

- [ ] **Step 4: Add the shared settings field.** Add the optional field to `DesktopSettings`, default it from `useUIStore.getInitialState()`, hydrate it only when it is a finite integer in range, and include it in the existing persistence serialization and update payload path. Add the store setter beside `setSessionGoalEnabled` and initialize the state to `2`.

- [ ] **Step 5: Run the focused settings tests.**

Run: `bun test packages/web/server/lib/opencode/settings-helpers.test.js packages/ui/src/lib/persistence.test.ts`

Expected: PASS, including valid round-trip and invalid-input behavior.

### Task 2: Make the Goal runtime use the setting

**Files:**
- Modify: `packages/web/server/lib/session-goal/runtime.js` near settings loading and the audit failure branch.
- Modify: `packages/web/server/lib/session-goal/runtime.test.js` beside audit-unavailable tests.
- Modify: `packages/web/server/index.js` only if the existing runtime composition must pass a settings getter; otherwise keep the setting reader inside the Goal runtime.
- Modify: `packages/web/server/lib/session-goal/DOCUMENTATION.md` in the flow and Goal payload/configuration notes.

**Interfaces:**
- `createSessionGoalRuntime` or its existing settings dependency reads `sessionGoalAuditFailureLimit` for each tick.
- The runtime uses `2` when the setting file is missing, malformed, or outside `1..20`.

- [ ] **Step 1: Write failing runtime tests.** Add a test with the default setting where the first unavailable audit continues and the second blocks. Add a test with limit `4` where failures one through three continue and failure four blocks. Add a malformed-setting test that still blocks on failure two.

- [ ] **Step 2: Run the focused Goal tests.**

Run: `bun test packages/web/server/lib/session-goal/runtime.test.js`

Expected: the custom-limit test fails because the runtime still uses the fixed constant.

- [ ] **Step 3: Replace the fixed threshold with validated runtime configuration.** Keep the existing hard maximum of `MAX_AUTO_TURNS = 20`; read the new setting through the server's existing settings path or a narrow injected getter, normalize it to `1..20`, and compare `auditFailStreak` with that value. Keep the existing reason, metadata write ordering, resume behavior, and successful-audit reset.

- [ ] **Step 4: Run the Goal regression tests.**

Run: `bun test packages/web/server/lib/session-goal/runtime.test.js packages/web/server/lib/opencode/settings-helpers.test.js`

Expected: PASS for default, custom, malformed, compaction, resume, blocked-verdict, budget, and continuation-cap cases.

- [ ] **Step 5: Update the owning documentation.** State that audit-unavailable blocking uses the persisted `sessionGoalAuditFailureLimit`, valid range `1..20`, and default `2`; distinguish it from the separate three-verdict blocked streak.

### Task 3: Add the Goal setting UI and localization

**Files:**
- Modify: `packages/ui/src/components/sections/openchamber/OpenChamberVisualSettings.tsx` in the existing Goal section.
- Modify: `packages/ui/src/lib/settings/search.ts` beside the existing Goal entries.
- Modify: `packages/ui/src/lib/i18n/messages/en.settings.ts`.
- Modify: every non-English `packages/ui/src/lib/i18n/messages/*.settings.ts` dictionary.
- Test: the nearest existing Settings component or persistence test file if it already covers OpenChamberVisualSettings controls.

**Interfaces:**
- The control reads `sessionGoalAuditFailureLimit` from `useUIStore` and writes through `updateDesktopSettings` plus the store setter.
- The control is disabled when Session Goals are disabled, matching the existing default-budget control.

- [ ] **Step 1: Add localized keys.** Add label, aria label, and info text describing consecutive audit failures and the `1..20` range to `en.settings.ts` and real translations to all other locale dictionaries.

- [ ] **Step 2: Register the searchable setting.** Add a stable `chat.session-goal-audit-failure-limit` search entry with the matching localized title/description keys and matching `data-settings-item` anchor.

- [ ] **Step 3: Write the control using shared primitives.** Add a `NumberInput` beside the existing Goal controls with `min={1}`, `max={20}`, `step={1}`. Update local/store state only for valid finite integers and persist through the established settings helper. Use the normal quiet save status path and no success toast.

- [ ] **Step 4: Run UI checks.**

Run: `bun test packages/ui/src/lib/persistence.test.ts`

Run: `bunx oxlint packages/ui/src/components/sections/openchamber/OpenChamberVisualSettings.tsx packages/ui/src/lib/persistence.ts packages/ui/src/lib/desktop.ts packages/ui/src/stores/useUIStore.ts`

Expected: PASS, with no new lint findings in authored changes.

### Task 4: Verify the complete contract

- [ ] **Step 1: Run package-focused tests.**

Run: `bun run --cwd packages/web test`

Run: `bun run --cwd packages/ui test`

- [ ] **Step 2: Run type and dead-code checks when imports or exported settings shapes changed.**

Run: `bun run type-check`

Run: `bun run dead-code`

Expected: type checks pass; inspect dead-code output and distinguish pre-existing findings from this change.

- [ ] **Step 3: Re-read Goal and settings documentation and verify the default remains 2.**

Expected: existing users keep their behavior without editing `settings.json`.
