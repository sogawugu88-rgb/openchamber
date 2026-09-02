# Taskboard Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add thinking-level selection, searchable project targets, one-time/daily scheduling, strict pre-run editing, and explicit Session Fork or handoff-document context inheritance to Taskboard.

**Architecture:** Stage 1 extends the project-scoped Taskboard task contract and Worker with model variants, schedule gates, daily templates, and pre-run mutations. Stage 2 adds a discriminated session target; Fork and document handoff are created from an authoritative settled source Session, while same-session reuse remains unsupported.

**Tech Stack:** React, Zustand, Zod, Express, Bun, OpenCode SDK v2, Luxon, existing SSE events.

## Global Constraints

- Do not add dependencies.
- Keep project task persistence behind the existing project lock and CAS version checks.
- Use target-project directory configuration without changing the active chat project.
- Keep schedule due checks server-authoritative and duplicate-safe across restarts/processes.
- A failed project, source Session lookup, or handoff write must remain distinct from an empty success.
- Only never-started tasks may be edited or deleted.
- Daily schedules generate new ordinary tasks and retain their non-executable template.
- Do not reuse an existing Session directly; use explicit Fork or handoff document mode.
- All visible UI and accessibility text must be localized in every locale.
- No commit or push is part of this plan unless explicitly requested.

---

### Task 1: Model variant and task mutation rules

**Files:**
- Modify: `packages/ui/src/components/session/TaskboardTaskDialog.tsx`
- Modify: `packages/ui/src/components/views/TaskboardView.tsx`
- Modify: `packages/ui/src/components/views/taskboardViewModel.ts`
- Modify: `packages/ui/src/lib/taskboardApi.ts`
- Modify: `packages/web/server/lib/taskboard/domain.js`
- Modify: `packages/web/server/lib/taskboard/store.js`
- Test: `packages/ui/src/components/views/TaskboardView.test.tsx`
- Test: `packages/ui/src/stores/useTaskboardStore.test.ts`
- Test: `packages/web/server/lib/taskboard/domain.test.js`
- Test: `packages/web/server/lib/taskboard/store.test.js`

- [ ] Write failing tests for variant normalization, variant reset when the model changes, and the predicate `runStatus === 'idle' && sessionId === null && runId === null`.
- [ ] Run the focused UI and server tests and confirm the new assertions fail.
- [ ] Add `variant: string | null` to `TaskboardExecution` and pass it through task creation, update, persistence, and Worker session creation.
- [ ] Render the existing `ThinkingPill` beside the model selector using variants from the selected target project's provider/model.
- [ ] Add edit and delete actions only for never-started tasks; enforce the same rule under the server lock with a distinct `TASK_STARTED` conflict.
- [ ] Reuse `TaskboardTaskDialog` for edit mode while keeping the task project immutable.
- [ ] Run all focused tests and confirm the new behavior passes.

### Task 2: Searchable project picker

**Files:**
- Create: `packages/ui/src/components/taskboard/TaskboardProjectPicker.tsx`
- Modify: `packages/ui/src/components/session/TaskboardTaskDialog.tsx`
- Modify: `packages/ui/src/components/views/TaskboardView.tsx`
- Test: `packages/ui/src/components/taskboard/TaskboardProjectPicker.test.tsx`
- Test: `packages/ui/src/components/views/TaskboardView.test.tsx`

- [ ] Write failing tests for matching project label/path, empty search, and selection without `setActiveProject()`.
- [ ] Run the project-picker tests and confirm they fail before the component exists.
- [ ] Implement the picker with existing Command primitives and `rankByQuery` precedent.
- [ ] Use the picker for the all-project filter and the create dialog; include `all` only in the board filter.
- [ ] Run picker/view tests and confirm all matches are scoped and stable.

### Task 3: One-time and daily scheduling

**Files:**
- Create: `packages/web/server/lib/taskboard/schedule.js`
- Modify: `packages/web/server/lib/taskboard/domain.js`
- Modify: `packages/web/server/lib/taskboard/store.js`
- Modify: `packages/web/server/lib/taskboard/runtime.js`
- Modify: `packages/ui/src/lib/taskboardApi.ts`
- Modify: `packages/ui/src/components/session/TaskboardTaskDialog.tsx`
- Modify: `packages/ui/src/components/views/TaskboardView.tsx`
- Test: `packages/web/server/lib/taskboard/schedule.test.js`
- Test: `packages/web/server/lib/taskboard/domain.test.js`
- Test: `packages/web/server/lib/taskboard/store.test.js`
- Test: `packages/web/server/lib/taskboard/runtime.test.js`
- Test: `packages/ui/src/components/session/TaskboardTaskDialog.test.tsx`
- Test: `packages/ui/src/components/views/TaskboardView.test.tsx`

- [ ] Write failing tests for immediate execution, future one-time execution, manual bypass, daily template materialization, timezone handling, DST invalid times, restart catch-up, and duplicate prevention.
- [ ] Run the schedule/domain/store/runtime tests and confirm the schedule cases fail.
- [ ] Extract a narrow Luxon-based schedule helper supporting `once` and `daily`, with wall-clock date/time and IANA timezone storage.
- [ ] Keep one-time tasks in the workflow columns with a waiting indicator and consume their occurrence atomically during claim.
- [ ] Treat daily tasks as non-executable templates in a separate Plan area; materialize one ordinary task per due occurrence with `scheduleTemplateId` and `scheduledFor` provenance.
- [ ] Apply due checks both during Worker selection and inside lock-protected claim/materialization mutations.
- [ ] Reuse the existing `TimePill`, date picker, timezone options, and localized validation patterns.
- [ ] Run all schedule tests and confirm future, due, manual, restart, and duplicate paths pass.

### Task 4: Aggregate and mutation reconciliation

**Files:**
- Modify: `packages/ui/src/stores/useTaskboardStore.ts`
- Modify: `packages/ui/src/lib/taskboardApi.ts`
- Modify: `packages/ui/src/lib/openchamberEvents.ts` only if affected-project refresh needs a new event case
- Test: `packages/ui/src/stores/useTaskboardStore.test.ts`
- Test: `packages/ui/src/lib/openchamberEvents.test.ts`

- [ ] Add tests proving edit/delete responses update both the project entry and all-project aggregate, while failed updates preserve the prior snapshot.
- [ ] Keep current runtime/project cache identity and update only the affected project after mutations or SSE events.
- [ ] Ensure template materialization and generated occurrence events refresh the aggregate without broad polling fanout.
- [ ] Run the store/event tests and confirm stale, partial, empty, and runtime-switch cases remain correct.

### Task 5: Context target contract and source Session selection

**Files:**
- Modify: `packages/ui/src/lib/taskboardApi.ts`
- Modify: `packages/ui/src/components/session/TaskboardTaskDialog.tsx`
- Modify: `packages/web/server/lib/taskboard/domain.js`
- Modify: `packages/web/server/lib/taskboard/store.js`
- Modify: `packages/web/server/lib/taskboard/runtime.js`
- Modify: `packages/web/server/lib/openchamber-sessions/routes.js`
- Modify: `packages/web/server/index.js`
- Test: `packages/web/server/lib/taskboard/domain.test.js`
- Test: `packages/web/server/lib/taskboard/runtime.test.js`
- Test: `packages/web/server/lib/openchamber-sessions/routes.test.js`
- Test: `packages/ui/src/components/session/TaskboardTaskDialog.test.tsx`

- [ ] Write failing tests for `new`, `fork`, and `handoff` targets, project ownership checks, settled-source checks, and rejection of active Goal/permission/question states.
- [ ] Run the focused tests and confirm the target behavior fails before implementation.
- [ ] Persist a discriminated `sessionTarget` with `mode: 'new'`, `mode: 'fork'`, or `mode: 'handoff'`.
- [ ] Capture a stable source message boundary during task creation and resolve source directory from the authoritative Session record.
- [ ] Fork only the child Session and keep Taskboard completion matching scoped to that child.
- [ ] Generate bounded handoff content under `.openchamber/taskboard/handoffs/` and pass only the document path to the new Session prompt.
- [ ] Reject direct same-session reuse and ambiguous duplicate prompt retries.
- [ ] Run source-session and taskboard runtime tests and confirm all target modes pass.

### Task 6: Localization, documentation, build, and manual verification

**Files:**
- Modify: `packages/ui/src/lib/i18n/messages/*.ts`
- Modify: `packages/web/server/lib/taskboard/DOCUMENTATION.md`
- Modify: `docs/superpowers/specs/2026-09-01-taskboard-operations-design.md`

- [ ] Add localized text for thinking level, project search, scheduling, templates, edit/delete confirmation, context source, Fork, handoff document, and all validation errors.
- [ ] Document schedule ownership, daily template behavior, strict mutation predicate, and context-target safety rules.
- [ ] Run:

```bash
bun run --cwd packages/web test server/lib/taskboard/schedule.test.js server/lib/taskboard/domain.test.js server/lib/taskboard/store.test.js server/lib/taskboard/runtime.test.js server/lib/taskboard/routes.test.js server/lib/openchamber-sessions/routes.test.js
bun test packages/ui/src/components/taskboard/TaskboardProjectPicker.test.tsx packages/ui/src/components/session/TaskboardTaskDialog.test.tsx packages/ui/src/components/views/TaskboardView.test.tsx packages/ui/src/stores/useTaskboardStore.test.ts
bun run type-check:ui
bun run lint:ui
bun run --cwd packages/web type-check
bun run --cwd packages/web lint
bun run --cwd packages/web build
bun run dead-code
```

- [ ] Run `node --check` on changed JavaScript files and `bunx oxlint` on changed TypeScript/JavaScript files.
- [ ] Rebuild and restart the 5173 PM2 service only after source validation; verify its own OpenCode port remains independent.
- [ ] Manually test a task scheduled for 20:00, a daily template, editing/deleting a fresh Todo task, project search, variant selection, Fork, and handoff document creation.
