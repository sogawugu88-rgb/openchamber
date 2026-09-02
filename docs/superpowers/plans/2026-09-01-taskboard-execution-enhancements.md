# Taskboard Execution And All-Project Board Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let Taskboard tasks choose a target project's model and Agent, run with an explicit permission and Goal policy, and show every project's tasks in one authoritative board.

**Architecture:** Keep task data and mutations project-scoped, then add one read-only server aggregate endpoint for all projects. The UI defaults to an `all` filter, while creation requires a target project and loads that project's directory-scoped configuration without changing the active chat project.

**Tech Stack:** React, Zustand, Zod, Express, Bun, OpenCode SDK v2, existing SSE event stream.

## Global Constraints

- Do not add dependencies.
- Do not add a global persisted task store or duplicate project task data.
- Do not switch the active chat project to load another project's configuration.
- Do not turn an OpenCode 502/503 or project read failure into an empty success.
- A failed project must not clear unrelated successful project boards.
- `plan` and `build` are OpenCode Agent selections, not a new Taskboard mode field.
- Permissions expose only a task-level automatic permission-acceptance toggle.
- Goal mode requires a separate objective field when enabled.
- Do not add migration or fallback behavior for old tasks without `execution`.
- Web and Desktop support the feature; VS Code remains explicitly unsupported.

## File Map

- Modify `packages/web/server/lib/taskboard/domain.js` for execution normalization and validation.
- Modify `packages/web/server/lib/taskboard/store.js` for execution persistence and mutation payloads.
- Modify `packages/web/server/lib/taskboard/runtime.js` for session execution settings and aggregate reads.
- Modify `packages/web/server/lib/taskboard/routes.js` for `GET /api/openchamber/taskboard`.
- Modify `packages/web/server/lib/openchamber-sessions/routes.js` for separate Goal objectives and pre-prompt permission setup.
- Modify `packages/web/server/index.js` to inject `setSessionAutoAccept` into the session service.
- Modify `packages/ui/src/lib/taskboardApi.ts` for execution payloads and aggregate response schemas.
- Modify `packages/ui/src/stores/useTaskboardStore.ts` for all-project state and partial failures.
- Modify `packages/ui/src/components/session/TaskboardTaskDialog.tsx` for target project and execution controls.
- Modify `packages/ui/src/components/views/TaskboardView.tsx` and `taskboardViewModel.ts` for the unified board and project filter.
- Modify `packages/ui/src/components/sections/agents/ModelSelector.tsx` and `packages/ui/src/components/sections/commands/AgentSelector.tsx` only if needed to accept directory-scoped data.
- Modify every applicable `packages/ui/src/lib/i18n/messages/*.ts` dictionary for new visible and accessible text.
- Modify `packages/web/server/lib/taskboard/DOCUMENTATION.md` for the execution and aggregate contracts.

---

### Task 1: Add task execution configuration

**Files:**
- Modify: `packages/web/server/lib/taskboard/domain.js`
- Modify: `packages/web/server/lib/taskboard/store.js`
- Modify: `packages/web/server/lib/taskboard/runtime.js`
- Modify: `packages/web/server/lib/openchamber-sessions/routes.js`
- Modify: `packages/web/server/index.js`
- Test: `packages/web/server/lib/taskboard/domain.test.js`
- Test: `packages/web/server/lib/taskboard/store.test.js`
- Test: `packages/web/server/lib/taskboard/runtime.test.js`
- Test: `packages/web/server/lib/openchamber-sessions/routes.test.js`

**Interface:** New tasks carry this required execution object:

```ts
type TaskboardExecution = {
  providerID: string;
  modelID: string;
  agent: string;
  permissionAutoAccept: boolean;
  goal: null | { objective: string };
};
```

- [ ] Write tests for valid execution data, invalid model/Agent/Goal data, persistence, and the exact session-service payload.
- [ ] Run `bun test packages/web/server/lib/taskboard/domain.test.js packages/web/server/lib/taskboard/store.test.js packages/web/server/lib/taskboard/runtime.test.js packages/web/server/lib/openchamber-sessions/routes.test.js` and confirm the new assertions fail for missing execution support.
- [ ] Normalize and validate `execution` at the Taskboard boundary. Do not add old-task fallback or migration.
- [ ] Pass `providerID`, `modelID`, and `agent` to `openChamberSessionService.create()` from `taskboard/runtime.js`.
- [ ] Extend session creation with `goalObjective` and use it when creating Goal metadata instead of reusing the task prompt.
- [ ] Inject `setSessionAutoAccept` and call it after Session creation but before `prompt_async`; log and continue if enrollment fails, matching scheduled-task behavior.
- [ ] Run the four backend test files again and require all new tests to pass.

### Task 2: Add the all-project aggregate endpoint

**Files:**
- Modify: `packages/web/server/lib/taskboard/runtime.js`
- Modify: `packages/web/server/lib/taskboard/routes.js`
- Test: `packages/web/server/lib/taskboard/runtime.test.js`
- Test: `packages/web/server/lib/taskboard/routes.test.js`

**Interface:** Add `taskboardRuntime.listAll()` and:

```text
GET /api/openchamber/taskboard
```

Return:

```ts
type TaskboardAggregate = {
  schemaVersion: 1;
  observedAt: number;
  complete: boolean;
  worker: {
    running: boolean;
    projectId: string | null;
    taskId: string | null;
    sessionId: string | null;
  };
  projects: Array<{
    projectId: string;
    name: string;
    path: string;
    state: 'ready' | 'error';
    board: Taskboard | null;
    error: { code: string; message: string } | null;
  }>;
};
```

- [ ] Write tests for all-project success, successful empty boards, one-project failure, project-list failure, and no lease mutation.
- [ ] Run the runtime and route tests and confirm the new aggregate assertions fail before implementation.
- [ ] Read the authoritative project list once using existing project sanitization.
- [ ] Read each project board independently and return explicit per-project errors with `complete: false`.
- [ ] Keep `/api/openchamber/taskboard/status` unchanged and register the new route before generic proxy fallback.
- [ ] Run the focused backend tests and require the aggregate cases to pass.

### Task 3: Load target-project configuration in the creation dialog

**Files:**
- Modify: `packages/ui/src/components/session/TaskboardTaskDialog.tsx`
- Modify: `packages/ui/src/components/sections/agents/ModelSelector.tsx` if directory support is required
- Modify: `packages/ui/src/components/sections/commands/AgentSelector.tsx` if directory support is required
- Modify: `packages/ui/src/stores/useConfigStore.ts` only if an existing selector cannot expose directory-scoped data
- Modify: `packages/ui/src/stores/useAgentsStore.ts` only if an existing selector cannot expose directory-scoped data
- Test: `packages/ui/src/stores/useConfigStore.test.ts`
- Test: `packages/ui/src/components/session/TaskboardTaskDialog.test.tsx` or a pure extracted draft-normalization test

- [ ] Write tests for target-project loading, no active-project mutation, required model/Agent, permission default, Goal objective validation, and the final payload.
- [ ] Run the focused tests and confirm the new dialog behavior is absent.
- [ ] Add a required target-project selector using `useProjectsStore` data.
- [ ] Load target-project providers and Agents with `loadProviders({ directory })` and `loadAgents({ directory })`.
- [ ] Select data with `selectProvidersForDirectory()` and `selectAgentsForDirectory()`; never call `activateDirectory()`.
- [ ] Add model selection, primary Agent selection including `plan` and `build`, automatic permission acceptance, Goal enablement, and required separate objective text.
- [ ] Keep all labels, placeholders, errors, and aria text localized.
- [ ] Run dialog and config-store tests and require all new assertions to pass.

### Task 4: Add aggregate API and runtime-scoped UI state

**Files:**
- Modify: `packages/ui/src/lib/taskboardApi.ts`
- Modify: `packages/ui/src/stores/useTaskboardStore.ts`
- Modify: `packages/ui/src/lib/openchamberEvents.ts` only if existing event handling cannot refresh affected projects
- Test: `packages/ui/src/stores/useTaskboardStore.test.ts`
- Test: `packages/ui/src/lib/openchamberEvents.test.ts`

- [ ] Write tests for aggregate parsing, successful empty boards, partial project errors, runtime reset, affected-project refresh, and mutation routing by `task.projectId`.
- [ ] Run the focused UI tests and confirm the new aggregate behavior fails before implementation.
- [ ] Add Zod schemas for aggregate results and parse the network payload at `taskboardApi.ts`.
- [ ] Add `fetchAllTaskboards()` using `runtimeFetch('/api/openchamber/taskboard')`.
- [ ] Add `loadAll()` while retaining per-project mutation methods and runtime/project cache identity.
- [ ] Preserve successful project data when another project fails; represent failure separately from an authoritative empty board.
- [ ] Refresh only the affected project on `taskboard-updated`; reload the aggregate after reconnect.
- [ ] Run the UI store and event tests and require all new assertions to pass.

### Task 5: Render the unified six-column board

**Files:**
- Modify: `packages/ui/src/components/views/TaskboardView.tsx`
- Modify: `packages/ui/src/components/views/taskboardViewModel.ts`
- Modify: `packages/ui/src/components/layout/MainLayout.tsx` only if the current surface lifecycle blocks the all-project view
- Test: `packages/ui/src/components/views/TaskboardView.test.tsx`

- [ ] Write tests for default `all` mode, project filtering, project labels, action routing, all run statuses, and per-project auto-run controls.
- [ ] Run the view tests and confirm the new all-project assertions fail before implementation.
- [ ] Replace the mandatory single-project load with `all` as the initial filter.
- [ ] Flatten successful project boards into the existing six status columns and decorate cards with project name/path.
- [ ] Render `idle`, `starting`, `running`, `success`, and `error` explicitly, including `lastError` and Session actions.
- [ ] Keep `autoRun` visible and mutable only for a selected project, not for `all`.
- [ ] Keep create, move, delete, run, and open-session actions routed by each task's project ID.
- [ ] Show partial project errors without hiding successful projects.
- [ ] Run the view tests and require all new assertions to pass.

### Task 6: Localization, docs, and full validation

**Files:**
- Modify: `packages/ui/src/lib/i18n/messages/*.ts`
- Modify: `packages/web/server/lib/taskboard/DOCUMENTATION.md`
- Test: all focused Taskboard, session, UI, and config tests

- [ ] Add real translations for project selection, model, Agent, permission, Goal, validation, partial failure, and run-status text in every supported locale.
- [ ] Document the required execution object, aggregate endpoint, project-scoped persistence, and partial failure behavior.
- [ ] Run:

```bash
bun test packages/web/server/lib/taskboard/domain.test.js packages/web/server/lib/taskboard/store.test.js packages/web/server/lib/taskboard/runtime.test.js packages/web/server/lib/taskboard/routes.test.js packages/web/server/lib/openchamber-sessions/routes.test.js
bun test packages/ui/src/stores/useTaskboardStore.test.ts packages/ui/src/components/views/TaskboardView.test.tsx
bun run type-check:ui
bun run lint:ui
bun run --cwd packages/web type-check
bun run --cwd packages/web lint
bun run --cwd packages/web build
bun run dead-code
```

- [ ] Run `bunx oxlint` on every created or substantially modified TypeScript/JavaScript file.
- [ ] Manually test with active project A, create a task for project B, choose its model and `plan`/`build` Agent, enable Goal with a separate objective, and confirm the unified board shows B's execution state.
- [ ] Verify Web/Desktop behavior and confirm VS Code remains explicitly unsupported.

## Self-review

- Model, Agent, permission, Goal, and plan/build selection are covered by Tasks 1 and 3.
- All-project loading, partial failures, and authoritative execution status are covered by Tasks 2, 4, and 5.
- Current-project independence is covered by Tasks 3 and 5.
- Persistence, locks, leases, SSE invalidation, runtime identity, localization, docs, and validation are covered by all six tasks.
- No old-task compatibility branch is included, per the confirmed product decision.
