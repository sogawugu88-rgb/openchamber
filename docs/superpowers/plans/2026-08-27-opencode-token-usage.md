# OpenCode token usage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add server-timezone OpenCode token history, a daily Usage calendar, and current-session composer metrics including output `tokens/s`, then test, push, and publish the fork under a new npm package name.

**Architecture:** The web server owns a focused `/api/openchamber/token-usage` route that reads complete OpenCode session history, parses assistant usage records, and returns a compact aggregate contract. Shared UI consumes that contract through `RuntimeAPIs`, while current-session metrics reuse the existing message/timing projections. The Usage page renders historical totals/calendar and the composer renders only the selected session summary.

**Tech Stack:** Bun, Node.js ESM, Express, OpenCode SDK, React 19, Zustand, TypeScript, Vitest, ESLint/Oxlint, npm.

## Global Constraints

- The OpenCode server is the authority for event data and timezone.
- A calendar day is derived using the server process timezone, not the browser timezone.
- Historical totals include all sessions and all models visible to the connected OpenCode runtime.
- Token total is the sum of input, output, cache-read, and cache-write tokens. Missing components contribute zero. A usage sample is counted once.
- Per-message metric rows are out of scope. The summary appears only below the composer.
- A metric is omitted when its source data is unavailable. Missing data is not rendered as authoritative zero.
- Shared UI must define behavior for web, Electron, VS Code, hosted mobile, and Capacitor mobile.
- User-facing strings go through `@/lib/i18n`; every new key gets a real translation in every dictionary.
- UI colors use semantic theme tokens and controls use shared button/icon primitives.
- Do not add dependencies, expose credentials, store prompt content, or modify `../opencode`.

---

### Task 1: Define and test the token usage aggregate

**Files:**
- Create: `packages/web/server/lib/opencode/token-usage.js`
- Create: `packages/web/server/lib/opencode/token-usage.test.js`
- Modify: `packages/web/server/lib/opencode/DOCUMENTATION.md`

**Interfaces:**
- Consumes: injected `openCodeFetch`, server `process.env.TZ`/runtime timezone, and OpenCode session/message response records.
- Produces: `createTokenUsageService({ openCodeFetch, getServerTimezone })` with `getReport({ month })`, returning `{ timezone, month, today, currentMonth, total, days, fetchedAt }` or throwing on fetch/parse failure.

- [ ] **Step 1: Write failing aggregation tests**
  Add Vitest cases for two sessions and two models, duplicate usage samples, cache components, missing usage, an instant crossing local midnight, selected-month daily buckets, current-month/all-time totals, successful empty history, and rejected malformed records.

- [ ] **Step 2: Run the focused test**
  Run: `bun test packages/web/server/lib/opencode/token-usage.test.js`
  Expected: FAIL because the service module does not exist.

- [ ] **Step 3: Implement the parser and fold**
  Normalize only OpenCode message records at the boundary. Use a stable sample key composed of session/message identity and assistant step when present. Convert finite non-negative token fields only, sum the four disjoint token buckets, derive the local date with the server timezone, and return an empty successful report when the complete source contains no usage.

- [ ] **Step 4: Run focused tests**
  Run: `bun test packages/web/server/lib/opencode/token-usage.test.js`
  Expected: PASS for all aggregation, timezone, duplicate, empty, and malformed-data cases.

- [ ] **Step 5: Update owning documentation**
  Document the route/service contract, date authority, sample de-duplication, and failure-versus-empty behavior in `packages/web/server/lib/opencode/DOCUMENTATION.md`.

- [ ] **Step 6: Commit**
  Run: `git add packages/web/server/lib/opencode/token-usage.js packages/web/server/lib/opencode/token-usage.test.js packages/web/server/lib/opencode/DOCUMENTATION.md && git commit -m "feat(web): aggregate OpenCode token usage"`

### Task 2: Register the OpenChamber route and shared runtime API

**Files:**
- Modify: `packages/web/server/lib/opencode/feature-routes-runtime.js`
- Modify: `packages/web/server/lib/opencode/bootstrap-runtime.js`
- Modify: `packages/web/server/lib/opencode/server-startup-runtime.js` if it is the current source of `openCodeFetch` and server timezone dependencies passed to `setupBaseRoutes`
- Create: `packages/web/server/lib/opencode/token-usage-routes.js`
- Create: `packages/web/server/lib/opencode/token-usage-routes.test.js`
- Modify: `packages/ui/src/lib/api/types.ts`
- Modify: `packages/web/src/api/index.ts`
- Modify: `packages/vscode/webview/api/index.ts`
- Modify: `packages/vscode/webview/api/bridge.ts` only if the local route needs an extension-host bridge

**Interfaces:**
- Consumes: Task 1 `createTokenUsageService`.
- Produces: `TokenUsageReport`, `TokenUsageAPI.getReport(month)`, and `GET /api/openchamber/token-usage?month=YYYY-MM`.

- [ ] **Step 1: Write route and contract tests**
  Assert valid month parsing, default current server month, JSON shape, service failure as non-2xx JSON, and that successful empty data remains a valid report. Add compile-time/runtime tests for web and VS Code API composition, with explicit unsupported behavior where a runtime cannot serve the route.

- [ ] **Step 2: Run focused tests to verify failure**
  Run: `bun test packages/web/server/lib/opencode/token-usage-routes.test.js`
  Expected: FAIL because route and API types are absent.

- [ ] **Step 3: Implement the route**
  Register the explicit OpenChamber route before generic proxy fallback. Validate `month` as `YYYY-MM`, call the injected service, return JSON, and return a clear error status without converting failure to an empty report.

- [ ] **Step 4: Implement runtime API adapters**
  Add the precise shared interface. Web calls `runtimeFetch('/api/openchamber/token-usage', { query: { month } })` and parses the response at the boundary. Electron reuses web. VS Code forwards the OpenChamber local route through its existing webview route path or returns explicit unsupported JSON if that runtime has no server route. Do not hardcode origins or credentials.

- [ ] **Step 5: Run focused validation**
  Run: `bun test packages/web/server/lib/opencode/token-usage-routes.test.js && bun run type-check:ui && bun run type-check:web && bun run vscode:type-check`
  Expected: PASS with the route and all applicable runtime contracts compiling.

- [ ] **Step 6: Commit**
  Run: `git add packages/web/server/lib/opencode packages/ui/src/lib/api/types.ts packages/web/src/api/index.ts packages/vscode/webview/api && git commit -m "feat: expose OpenCode token usage API"`

### Task 3: Add the historical Usage calendar

**Files:**
- Create: `packages/ui/src/components/sections/usage/tokenUsage.ts`
- Create: `packages/ui/src/components/sections/usage/tokenUsage.test.ts`
- Create: `packages/ui/src/components/sections/usage/TokenUsageCalendar.tsx`
- Modify: `packages/ui/src/components/sections/usage/UsagePage.tsx`
- Modify: `packages/ui/src/lib/i18n/messages/en.ts`
- Modify: `packages/ui/src/lib/i18n/messages/zh-CN.ts`
- Modify: every remaining file in `packages/ui/src/lib/i18n/messages/`

**Interfaces:**
- Consumes: `TokenUsageAPI.getReport(month)` and `TokenUsageReport` from Task 2.
- Produces: pure month/calendar helpers and a rendered token summary integrated into the existing Usage page.

- [ ] **Step 1: Write pure helper tests**
  Cover month grid construction, server date-key handling without browser timezone conversion, intensity levels for empty/low/high days, number formatting, and previous/next month boundaries.

- [ ] **Step 2: Run focused tests to verify failure**
  Run: `bun test packages/ui/src/components/sections/usage/tokenUsage.test.ts`
  Expected: FAIL because helper module is absent.

- [ ] **Step 3: Implement pure helpers and calendar**
  Build a fixed seven-column calendar from server-local `YYYY-MM-DD` keys. Keep empty cells stable, calculate intensity from the selected month's maximum, and use semantic classes plus existing shared controls/icons for navigation.

- [ ] **Step 4: Add localized strings**
  Add complete translations for today, this month, total, calendar navigation, no data, loading, retry, and service timezone labels in all locale dictionaries. Keep model/provider names and `tokens/s` literal where appropriate.

- [ ] **Step 5: Integrate the page state**
  Use `useRuntimeAPIs().tokenUsage`, key requests by runtime identity and month, preserve the previous successful report on failure, distinguish loading/error/empty, and reload the current month after a settled usage event with coalescing. Do not let an error clear the existing calendar.

- [ ] **Step 6: Run focused tests and checks**
  Run: `bun test packages/ui/src/components/sections/usage/tokenUsage.test.ts && bun run type-check:ui && bunx oxlint packages/ui/src/components/sections/usage/tokenUsage.ts packages/ui/src/components/sections/usage/TokenUsageCalendar.tsx packages/ui/src/components/sections/usage/UsagePage.tsx`
  Expected: PASS with no new lint findings.

- [ ] **Step 7: Commit**
  Run: `git add packages/ui/src/components/sections/usage packages/ui/src/lib/i18n/messages && git commit -m "feat(ui): show OpenCode token usage calendar"`

### Task 4: Add current-session composer metrics and output speed

**Files:**
- Create: `packages/ui/src/components/chat/sessionMetrics.ts`
- Create: `packages/ui/src/components/chat/sessionMetrics.test.ts`
- Modify: `packages/ui/src/components/layout/ContextSidebarTab.tsx` or the exact existing composer stats owner found during implementation
- Modify: `packages/ui/src/components/chat/ChatInput.tsx` only for placement/wiring if the existing stats owner is not the composer
- Modify: all affected locale dictionaries

**Interfaces:**
- Consumes: authoritative selected-session messages/parts, existing token utilities, and existing timing projections.
- Produces: `deriveSessionMetrics(messages, timing)` returning optional metric groups and a compact footer component/model containing model, token counts, LLM/tool duration, TTFT, cache hit, and `outputTokens / decodeSeconds` as `tokens/s`.

- [ ] **Step 1: Write failing metric tests**
  Cover multiple turns/steps, model display, four token buckets, tool duration, average TTFT, decode-speed arithmetic, zero/absent decode duration, incomplete timing exclusion, cache-hit calculation, and no data returning omitted optional metrics.

- [ ] **Step 2: Run focused tests to verify failure**
  Run: `bun test packages/ui/src/components/chat/sessionMetrics.test.ts`
  Expected: FAIL because the metric module is absent.

- [ ] **Step 3: Implement the pure session fold**
  Reuse the established token and timing semantics. Keep the fold scoped to the selected session, preserve absent-vs-zero meaning, and only calculate `tokens/s` when output tokens and measured decoding seconds are both positive and finite.

- [ ] **Step 4: Integrate below the composer**
  Thread the selected-session metric model into the existing stats line below the input. Use localized labels, existing truncation/tooltip behavior, semantic theme tokens, and no per-message rows. Keep the input/send controls structurally unchanged.

- [ ] **Step 5: Run focused tests and checks**
  Run: `bun test packages/ui/src/components/chat/sessionMetrics.test.ts && bun run type-check:ui && bunx oxlint packages/ui/src/components/chat/sessionMetrics.ts packages/ui/src/components/chat/ChatInput.tsx packages/ui/src/components/layout/ContextSidebarTab.tsx`
  Expected: PASS with no new lint findings.

- [ ] **Step 6: Commit**
  Run: `git add packages/ui/src/components/chat packages/ui/src/components/layout/ContextSidebarTab.tsx packages/ui/src/lib/i18n/messages && git commit -m "feat(ui): show current session model metrics"`

### Task 5: Verify cross-runtime behavior and build artifacts

**Files:**
- Modify only files required by failing checks.
- Review: `packages/mobile/README.md`, `packages/electron/README.md`, `packages/vscode/src/DOCUMENTATION.md`, and affected module docs.

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: validated web, Electron, VS Code, hosted-mobile, and Capacitor-mobile behavior or explicit unsupported behavior.

- [ ] **Step 1: Run focused package checks**
  Run: `bun run type-check:ui && bun run type-check:web && bun run vscode:type-check && bun run lint:ui && bun run lint:web`
  Expected: PASS.

- [ ] **Step 2: Run affected tests**
  Run: `bun run --cwd packages/ui test && bun run --cwd packages/web test && bun run --cwd packages/vscode test`
  Expected: PASS, including the new token aggregation, route, calendar, and session metric suites.

- [ ] **Step 3: Run static and build validation**
  Run: `bunx oxlint packages/ui/src/components/sections/usage packages/ui/src/components/chat packages/web/server/lib/opencode && bun run build:web && bun run build:ui`
  Expected: PASS. Fix only authored findings.

- [ ] **Step 4: Inspect non-blocking dead-code report**
  Run: `bun run dead-code`
  Expected: report reviewed; any newly reported unused export is removed or wired into its consumer.

- [ ] **Step 5: Perform manual UI validation**
  Start the built web server with the repository's documented command, open Usage and a chat session, and verify desktop and mobile widths. Confirm server-local date keys, calendar loading/error/retry, composer placement, and no overlap with send controls. Record that rendering/focus behavior was manually checked because composer docs exclude it from DOM tests.

- [ ] **Step 6: Commit validation fixes**
  Run `git diff --name-only`, confirm every listed file is one of the authored files from Tasks 1-4, then stage each listed path with `git add` and run `git commit -m "test: validate OpenCode usage surfaces"`.

### Task 6: Choose a unique npm package name and publish

**Files:**
- Modify: `packages/web/package.json`
- Modify: `packages/web/README.md` if package/install instructions need the new name
- Modify: root release metadata only if the existing package release scripts require it

**Interfaces:**
- Consumes: validated package from Tasks 1-5 and the npm identity already logged in on the server.
- Produces: one newly named public npm package containing the built web CLI.

- [ ] **Step 1: Check npm identity and candidate names**
  Run `npm whoami`, then query these candidates in order with `npm view openchamber-sogawugu name version --json`, `npm view openchamber-token-metrics name version --json`, and `npm view sogawugu-openchamber name version --json`.
  Expected: authenticated username is returned; choose the first candidate whose registry query returns a not-found response.

- [ ] **Step 2: Set the package name and version**
  Update `packages/web/package.json` with the first verified available name from `openchamber-sogawugu`, `openchamber-token-metrics`, or `sogawugu-openchamber`, update package-local install references, and keep the version aligned with the repository release metadata. Do not use `@openchamber/web` or any existing package name.

- [ ] **Step 3: Build and inspect the tarball**
  Run: `bun run build:web && npm pack --dry-run --workspace packages/web`
  Expected: package contents include `dist`, `server`, `bin`, `public`, `package.json`, and `README.md`, with no credentials or unrelated source files.

- [ ] **Step 4: Publish**
  Run: `npm publish --workspace packages/web --access public`
  Expected: npm reports the exact new package name and version as published.

- [ ] **Step 5: Verify registry metadata**
  Run `npm view openchamber-sogawugu version dist.tarball --json`, `npm view openchamber-token-metrics version dist.tarball --json`, and `npm view sogawugu-openchamber version dist.tarball --json`; the command for the selected package must return the published version and tarball URL.
  Expected: registry returns metadata for exactly the selected package, while the other two names remain unused or unavailable.

- [ ] **Step 6: Commit package metadata**
  Run: `git add packages/web/package.json packages/web/README.md && git commit -m "chore(web): publish fork package"`

### Task 7: Push the implementation to GitHub

**Files:**
- No new files. Push the committed branch to `https://github.com/sogawugu88-rgb/openchamber`.

**Interfaces:**
- Consumes: all commits from Tasks 1-6.
- Produces: remote branch containing the tested implementation and package metadata.

- [ ] **Step 1: Inspect final repository state**
  Run: `git status --short && git diff --check && git log --oneline -10`
  Expected: only intended commits/files are present and diff check is clean.

- [ ] **Step 2: Push**
  Run: `git push origin main`
  Expected: push succeeds to the fork's `main` branch.

- [ ] **Step 3: Verify remote head**
  Run: `git ls-remote origin refs/heads/main`
  Expected: remote SHA matches local `git rev-parse HEAD`.

## Plan self-review

- Historical aggregation, server timezone, all sessions/models, calendar, current-session summary, and `tokens/s` are covered by Tasks 1-4.
- Failure-versus-empty, stale runtime/session state, missing fields, duplicate samples, and partial timing are covered by Tasks 1-4.
- Shared runtime parity and route ordering are covered by Task 2 and Task 5.
- Localization, semantic theming, responsive layout, and manual rendering validation are covered by Tasks 3-5.
- npm uniqueness, dry-run contents, publish, registry verification, GitHub push, and remote-head verification are covered by Tasks 6-7.
- No placeholders or unspecified "handle edge cases" steps remain; every task has concrete files, commands, and expected outcomes.
