# Taskboard automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a project-scoped OpenChamber taskboard that claims `todo` tasks and executes each task in an independent OpenCode session.

**Architecture:** Keep taskboard domain and persistence in the Web server. Reuse the existing project configuration lock and OpenCode session orchestration. Add a bounded server worker that claims tasks with task versions, dispatches one session per task, and publishes small invalidation events consumed by a shared UI store.

**Tech Stack:** Node.js ESM, Express, existing OpenCode SDK v2, JSON project configuration, React 19, Zustand, existing OpenChamber SSE and runtime fetch helpers, Vitest/Bun tests.

## Global Constraints

- Do not add dependencies.
- `backlog` is never automatically executable; only `todo` tasks are eligible.
- Every task run uses one independent OpenCode session in the selected project directory.
- The server owns task claiming and terminal workflow status; `done` requires user action.
- `in_progress` is worker-owned; UI status controls must not claim tasks directly.
- Persist task mutations through the existing project configuration lock and atomic write path.
- Web/Desktop are the first supported surfaces; VS Code and mobile remain unchanged.
- A failed read must not be represented as an authoritative empty board.
- Use `runtimeFetch` for shared UI API access and the existing OpenChamber event subscription for invalidation.

---

### Task 1: Define taskboard domain contracts

**Files:**
- Create: `packages/web/server/lib/taskboard/domain.js`
- Test: `packages/web/server/lib/taskboard/domain.test.js`
- Create: `packages/web/server/lib/taskboard/DOCUMENTATION.md`

**Interfaces:**
- Produces `TASK_STATUSES`, `TASK_PRIORITIES`, `RUN_STATUSES`, `normalizeTask`, `normalizeTaskboard`, `canTransitionTaskStatus`, `getEligibleTasks`, and `appendTaskHistory`.
- Later storage and worker code consume only the normalized domain values.

- [ ] **Step 1: Write failing domain tests**

Test status transitions, defaults, malformed task filtering, bounded history, and dependency eligibility. Use pure values such as `todo`, `in_progress`, and `done`; do not access the filesystem.

- [ ] **Step 2: Run the focused test**

Run: `bun test packages/web/server/lib/taskboard/domain.test.js`

Expected: FAIL because `domain.js` does not exist.

- [ ] **Step 3: Implement the pure domain helpers**

Normalize IDs, titles, descriptions, priorities, status, run metadata, and timestamps. Reject self-dependencies and only return tasks whose every blocker has status `done`.

- [ ] **Step 4: Run the focused test again**

Run: `bun test packages/web/server/lib/taskboard/domain.test.js`

Expected: PASS.

- [ ] **Step 5: Document ownership and contracts**

Document the taskboard file shape, state machine, and worker rules in `packages/web/server/lib/taskboard/DOCUMENTATION.md`.

### Task 2: Add project-config taskboard persistence

**Files:**
- Modify: `packages/web/server/lib/projects/project-config.js:347-545, 578-889`
- Modify: `packages/web/server/lib/projects/project-config.test.js`
- Create: `packages/web/server/lib/taskboard/store.js`
- Test: `packages/web/server/lib/taskboard/store.test.js`

**Interfaces:**
- `projectConfigRuntime` exposes `readTaskboard(projectID)` and `mutateTaskboard(projectID, mutate)` through the existing cross-process project lock.
- `createTaskboardStore({ projectConfigRuntime, createId })` exposes `list`, `get`, `create`, `update`, `move`, `remove`, `setAutoRun`, and `claimNext`.

- [ ] **Step 1: Write persistence tests**

Cover missing taskboard data returning a canonical empty board, round-trip writes preserving `scheduledTasks`, create/update/delete, task version increments, stale `claimNext`, and a successful claim that sets `in_progress` and a `runId`.

- [ ] **Step 2: Run the tests to verify failure**

Run: `bun test packages/web/server/lib/taskboard/store.test.js packages/web/server/lib/projects/project-config.test.js`

Expected: FAIL with missing taskboard exports or store functions.

- [ ] **Step 3: Extend project-config without changing scheduled-task behavior**

Preserve unknown config fields, add canonical `taskboard` normalization, and make the atomic writer update only fields supplied by the caller. Keep all writes behind `withProjectWriteLock`.

- [ ] **Step 4: Implement the taskboard store**

Use the domain normalizer for every read and write. `claimNext(projectID, taskID, version, runId)` must re-read under the project lock, require `status === 'todo'` and the exact version, then write one new task version.

- [ ] **Step 5: Run the tests to verify success**

Run: `bun test packages/web/server/lib/taskboard/store.test.js packages/web/server/lib/projects/project-config.test.js`

Expected: PASS with scheduled-task tests unchanged.

### Task 3: Add taskboard routes and worker runtime

**Files:**
- Create: `packages/web/server/lib/taskboard/runtime.js`
- Create: `packages/web/server/lib/taskboard/routes.js`
- Test: `packages/web/server/lib/taskboard/runtime.test.js`
- Test: `packages/web/server/lib/taskboard/routes.test.js`
- Modify: `packages/web/server/lib/opencode/feature-routes-runtime.js:1-200`
- Modify: `packages/web/server/index.js:80-100, 820-930, 1400-1465, 1873-1921`
- Modify: `packages/web/server/lib/opencode/shutdown-runtime.js`

**Interfaces:**
- `createTaskboardRuntime(dependencies)` returns `start`, `stop`, `wake`, `processPayload`, `list`, `createTask`, `updateTask`, `moveTask`, `removeTask`, `runNow`, `setAutoRun`, and `getStatus`.
- `registerTaskboardRoutes(app, dependencies)` owns the `/api/projects/:projectId/taskboard*` routes and `/api/openchamber/taskboard/status`.
- The global event hub calls `taskboardRuntime.processPayload(payload, directory)`.

- [ ] **Step 1: Write worker tests**

Test that an eligible task is claimed once, a new session is created with the task prompt, the session ID is persisted, an idle successful assistant turn moves the task to `in_review`, and an assistant error moves it to `blocked`.

- [ ] **Step 2: Run the worker tests to verify failure**

Run: `bun test packages/web/server/lib/taskboard/runtime.test.js`

Expected: FAIL because the runtime does not exist.

- [ ] **Step 3: Implement runtime orchestration**

Use injected `taskboardStore`, `listProjects`, `openChamberSessionService`, `buildOpenCodeUrl`, and `getOpenCodeAuthHeaders`. Keep a single global active run, map `sessionId` to task run, and wake the worker after mutations. Verify the latest assistant message before finalizing an idle session.

- [ ] **Step 4: Add route handlers**

Validate project/task IDs and JSON bodies at the route boundary. Return `409` for version conflicts, `404` for missing tasks, and preserve the store's distinction between read failure and an empty board.

- [ ] **Step 5: Wire startup, events, routes, and shutdown**

Instantiate the runtime beside `scheduledTasksRuntime`, pass it through `featureRoutesRuntime`, subscribe it to the global message hub, broadcast `openchamber:taskboard-updated`, start it after OpenCode readiness, and stop it during graceful shutdown.

- [ ] **Step 6: Run server tests**

Run: `bun test packages/web/server/lib/taskboard/domain.test.js packages/web/server/lib/taskboard/store.test.js packages/web/server/lib/taskboard/runtime.test.js packages/web/server/lib/taskboard/routes.test.js`

Expected: PASS.

### Task 4: Add shared Taskboard API and state store

**Files:**
- Create: `packages/ui/src/lib/taskboardApi.ts`
- Create: `packages/ui/src/stores/useTaskboardStore.ts`
- Test: `packages/ui/src/stores/useTaskboardStore.test.ts`
- Modify: `packages/ui/src/lib/openchamberEvents.ts`

**Interfaces:**
- `taskboardApi.ts` exports `fetchTaskboard`, `setTaskboardAutoRun`, `createTaskboardTask`, `updateTaskboardTask`, `moveTaskboardTask`, `deleteTaskboardTask`, and `runTaskboardTask`.
- `useTaskboardStore` is keyed by runtime and project ID and exposes `load`, `create`, `update`, `move`, `remove`, `runNow`, and `setAutoRun`.
- `openchamberEvents.ts` emits a typed `taskboard-updated` event with `projectId`, optional `taskId`, and `kind`.

- [ ] **Step 1: Write store tests**

Cover loading a board, preserving the last good board after a failed reload, accepting an authoritative empty board, rolling back a failed optimistic mutation, invalidating only the affected project on an event, and ignoring a stale runtime completion.

- [ ] **Step 2: Run the store tests to verify failure**

Run: `bun test packages/ui/src/stores/useTaskboardStore.test.ts`

Expected: FAIL because the API and store do not exist.

- [ ] **Step 3: Implement the API boundary and event parser**

Use `runtimeFetch` for all routes. Parse the event payload at the boundary and never expose untyped event objects to store consumers.

- [ ] **Step 4: Implement the keyed store**

Track `loading`, `loaded`, `error`, and `data` per project. Capture the runtime identity and request generation before each async request; stale completions must not publish.

- [ ] **Step 5: Run the store tests**

Run: `bun test packages/ui/src/stores/useTaskboardStore.test.ts`

Expected: PASS.

### Task 5: Add the Web/Desktop board surface

**Files:**
- Create: `packages/ui/src/components/views/TaskboardView.tsx`
- Create: `packages/ui/src/components/views/taskboardViewModel.ts`
- Create: `packages/ui/src/components/session/TaskboardTaskDialog.tsx`
- Modify: `packages/ui/src/stores/useUIStore.ts`
- Modify: `packages/ui/src/components/layout/MainLayout.tsx`
- Modify: `packages/ui/src/components/layout/Header.tsx`
- Modify: `packages/ui/src/components/session/SessionSidebar.tsx`
- Modify: `packages/ui/src/components/session/sidebar/shell/SidebarHeader.tsx`
- Modify: `packages/ui/src/lib/i18n/messages/de.ts`
- Modify: `packages/ui/src/lib/i18n/messages/en.ts`
- Modify: `packages/ui/src/lib/i18n/messages/es.ts`
- Modify: `packages/ui/src/lib/i18n/messages/fr.ts`
- Modify: `packages/ui/src/lib/i18n/messages/ja.ts`
- Modify: `packages/ui/src/lib/i18n/messages/ko.ts`
- Modify: `packages/ui/src/lib/i18n/messages/pl.ts`
- Modify: `packages/ui/src/lib/i18n/messages/pt-BR.ts`
- Modify: `packages/ui/src/lib/i18n/messages/uk.ts`
- Modify: `packages/ui/src/lib/i18n/messages/zh-CN.ts`
- Modify: `packages/ui/src/lib/i18n/messages/zh-TW.ts`

**Interfaces:**
- `TaskboardView` reads and mutates only through `useTaskboardStore`.
- `TaskboardTaskDialog` returns a validated task draft to `TaskboardView`.
- `useUIStore` adds `isTaskboardPageOpen` and `setTaskboardPageOpen` alongside the existing full-page surface flags.

- [ ] **Step 1: Write component tests for state rendering**

Test loading, empty, error-with-previous-data, board columns, task status controls, and the auto-run toggle using mocked store state.

- [ ] **Step 2: Run the component tests to verify failure**

Run: `bun test packages/ui/src/components/views/TaskboardView.test.tsx`

Expected: FAIL because the view does not exist.

- [ ] **Step 3: Implement the page and dialog**

Use existing `Button`, `Select`, `Textarea`, `Dialog`, `Icon`, `ErrorBoundary`, and semantic status tokens. Do not add drag-and-drop; explicit status controls keep the first state machine easy to inspect.

- [ ] **Step 4: Wire navigation**

Add a sidebar header action, close the page when a session or draft is selected, show the board title in `Header`, and render it as an absolute full-page surface in `MainLayout` without mounting the chat as active underneath.

- [ ] **Step 5: Add localization**

Add the same taskboard keys to every supported locale dictionary. Use English fallback text only where the repository's locale precedent permits it.

- [ ] **Step 6: Run UI tests**

Run: `bun test packages/ui/src/components/views/TaskboardView.test.tsx packages/ui/src/stores/useTaskboardStore.test.ts`

Expected: PASS.

### Task 6: Integrate, document, and verify

**Files:**
- Modify: `packages/web/server/lib/taskboard/DOCUMENTATION.md`
- Modify: `packages/web/README.md` with the taskboard entry point and automation behavior.
- Modify: `packages/web/server/lib/project-context/runtime.js` to keep its project-config ownership comment accurate.

- [ ] **Step 1: Add the direct operation-path documentation**

Document: create task -> move to `todo` -> enable auto-run -> server claim -> independent session -> automatic `in_review` -> user `done`.

- [ ] **Step 2: Run focused validation**

Run: `bun test packages/web/server/lib/taskboard/domain.test.js packages/web/server/lib/taskboard/store.test.js packages/web/server/lib/taskboard/runtime.test.js packages/web/server/lib/taskboard/routes.test.js`

Expected: PASS.

Run: `bun test packages/ui/src/stores/useTaskboardStore.test.ts packages/ui/src/components/views/TaskboardView.test.tsx`

Expected: PASS.

Run: `bun run type-check:ui`

Expected: exit 0.

Run: `bun run type-check:web`

Expected: exit 0.

Run: `bun run lint:ui`

Expected: exit 0.

Run: `bun run lint:web`

Expected: exit 0.

Run: `bun run build:ui`

Expected: exit 0.

Run: `bun run build:web`

Expected: exit 0.

Run: `bunx oxlint packages/web/server/lib/taskboard packages/web/server/lib/projects/project-config.js packages/web/server/lib/opencode/feature-routes-runtime.js packages/web/server/index.js packages/web/server/lib/opencode/shutdown-runtime.js packages/ui/src/lib/taskboardApi.ts packages/ui/src/stores/useTaskboardStore.ts packages/ui/src/components/views/TaskboardView.tsx packages/ui/src/components/session/TaskboardTaskDialog.tsx packages/ui/src/stores/useUIStore.ts packages/ui/src/components/layout/MainLayout.tsx packages/ui/src/components/layout/Header.tsx packages/ui/src/components/session/SessionSidebar.tsx packages/ui/src/components/session/sidebar/shell/SidebarHeader.tsx packages/ui/src/lib/openchamberEvents.ts packages/ui/src/lib/i18n/messages/de.settings.ts packages/ui/src/lib/i18n/messages/en.settings.ts packages/ui/src/lib/i18n/messages/es.settings.ts packages/ui/src/lib/i18n/messages/fr.settings.ts packages/ui/src/lib/i18n/messages/ja.settings.ts packages/ui/src/lib/i18n/messages/ko.settings.ts packages/ui/src/lib/i18n/messages/pl.settings.ts packages/ui/src/lib/i18n/messages/pt-BR.settings.ts packages/ui/src/lib/i18n/messages/uk.settings.ts packages/ui/src/lib/i18n/messages/zh-CN.settings.ts packages/ui/src/lib/i18n/messages/zh-TW.settings.ts`

Expected: no new findings in authored code; record unrelated baseline findings separately.

Run: `bun run dead-code`

Expected: inspect the non-blocking report for newly added files or exports.

- [ ] **Step 3: Verify the real user path**

Start the Web server, open the Taskboard action, create a `todo` task, enable auto-run, observe the task become `in_progress`, open the generated session, and confirm a successful run becomes `in_review` without the browser remaining open.

- [ ] **Step 4: Record the final worktree state**

Run: `git status --short`

Report the exact changed files, validation results, and any remaining limitation. Do not commit or push unless the user explicitly requests it.
