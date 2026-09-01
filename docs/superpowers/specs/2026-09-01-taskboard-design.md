# Taskboard automation

## Goal

Add a project-scoped taskboard to OpenChamber Web. A user can create work items,
move approved items into a queue, and let a server-owned worker execute one item
per independent OpenCode session. The worker records the execution session and
updates the task through the review stage; the user remains responsible for
final acceptance.

## Decisions

- The taskboard is project-scoped. Every task belongs to an existing OpenChamber
  project and executes in that project's directory.
- Web and Desktop use the feature through the existing shared UI. VS Code and
  mobile surfaces do not expose the board in the first slice.
- A task is eligible for automation only in `todo`. New tasks default to
  `backlog`, so creating a task never starts code execution accidentally.
- Every task run creates or reuses one independent OpenCode session. The first
  slice uses the selected project directory and does not create branches or
  worktrees.
- The server owns task claiming and terminal status updates. Agent output is
  evidence for the run, not authority to skip the review stage.
- Claiming uses the task's positive `version` as compare-and-swap authority.
  A stale claim returns a conflict and never takes over another worker's task.
- Persistence uses the existing project configuration file and its cross-process
  file lock. No database dependency is added for the first slice.
- Taskboard changes are delivered through the existing OpenChamber event SSE
  endpoint. A client always reloads the authoritative project board after
  reconnect or an update event.
- The first worker keeps one active run per process and uses a persisted project
  lease so two OpenChamber processes cannot modify the same project directory at
  the same time.

## Scope

### Included

- Project taskboard storage with task identifiers, status, priority, labels,
  description, run metadata, version, and status history.
- Task create, read, update, delete, move, and manual run APIs.
- Automatic worker polling and event wake-up for enabled project boards.
- Dependency relations represented as `blocks` edges. A task with an unfinished
  blocker is not eligible for execution.
- Independent OpenCode session creation through the existing
  `openChamberSessionService`.
- Session-to-task binding, run result detection, error recording, and
  `in_review` transition after a successful assistant turn.
- Full-page Kanban-style board with project selector, automation toggle, task
  creation, status movement, priority, run state, and open-session action.
- Realtime board refresh and reconnect-safe reload.

### Excluded from the first slice

- GitHub, Jira, or other external task synchronization.
- Branch and worktree creation or automatic merge.
- Comments, attachments, mentions, and task sharing.
- Multiple worker processes running the same task in parallel.
- Agent-created tasks and an agent-facing taskboard tool.
- Automatic transition from `in_review` to `done`.
- A separate SQLite database.

## Data model

The existing per-project config file gains a server-owned `taskboard` section:

```json
{
  "taskboard": {
    "version": 1,
    "nextTaskNumber": 1,
    "autoRun": false,
    "workerLease": null,
    "tasks": [
      {
        "id": "task_<uuid>",
        "identifier": "APP-1",
        "projectId": "app",
        "title": "Implement the next slice",
        "description": "...",
        "status": "todo",
        "priority": "high",
        "labels": [],
        "blockedBy": [],
        "sortOrder": 0,
        "sessionId": null,
        "runId": null,
        "runStatus": "idle",
        "runStartedAt": null,
        "runFinishedAt": null,
        "lastError": null,
        "history": [],
        "version": 1,
        "createdAt": 0,
        "updatedAt": 0
      }
    ]
  }
}
```

The task status values are `backlog`, `todo`, `in_progress`, `in_review`,
`blocked`, `done`, and `canceled`. The server accepts only the intended workflow
transitions:

```text
backlog -> todo | canceled
todo -> in_progress | backlog | canceled
in_progress -> in_review | blocked | todo | canceled
in_review -> done | todo | blocked
blocked -> todo | canceled
done -> todo
canceled -> todo
```

`in_progress` is a worker-owned state. User status controls cannot claim a task;
they must move an approved task to `todo` and let the Worker perform the claim.

`runStatus` is separate from workflow status and is one of `idle`, `starting`,
`running`, `success`, or `error`. A task can remain `in_review` after a run has
finished successfully. `history` contains bounded status and run entries so the
board can explain why a task is blocked without requiring a second API in the
first slice.

## Server architecture

### Storage

`packages/web/server/lib/taskboard/store.js` owns normalization, project file
reads, task mutations, compare-and-swap moves, relation validation, and bounded
history. It delegates the actual project-file lock and atomic write to the
existing `projectConfigRuntime` so scheduled-task writes and taskboard writes
cannot overwrite one another.

`packages/web/server/lib/taskboard/domain.js` owns status, priority, task shape,
transition, dependency, and run-state helpers. It has no filesystem or OpenCode
dependency and is unit-testable in isolation.

### Runtime and worker

`packages/web/server/lib/taskboard/runtime.js` owns the in-memory worker queue
and the mapping from OpenCode session ID to task run. It exposes:

- `start()` and `stop()` for server lifecycle;
- `wake(projectId?)` for immediate dispatch after a task mutation;
- `processPayload(payload, directory)` for global OpenCode events;
- `list(projectId)`, `createTask(projectId, input)`, `updateTask(...)`,
  `moveTask(...)`, `runNow(...)`, and `setAutoRun(...)` for routes.

The worker performs this sequence:

1. List enabled projects whose board has `autoRun` enabled.
2. Read `todo` tasks and ignore tasks with unfinished blockers.
3. Claim one task with its current `version`, setting `in_progress`,
   `runStatus: starting`, and a new `runId`.
4. Create an independent OpenCode session in the project directory and send a
   task-specific prompt containing the identifier, title, description, priority,
   and execution rules.
5. Persist the returned `sessionId` and set `runStatus: running`.
6. Listen for the bound session's authoritative idle/error events. Fetch the
   latest assistant message before deciding the result.
7. On a completed assistant turn without an error, set `runStatus: success` and
   move the task to `in_review`.
8. On an assistant error, timeout, unavailable directory, or ambiguous session
   creation result, set `runStatus: error`, preserve the binding when known, and
   move the task to `blocked` with a bounded history entry.

The worker never moves a task directly to `done`. A restarted server can observe
existing `in_progress` tasks. If a session ID exists it reattaches the watcher; if
the task was claimed before a session ID was persisted it moves the task to
`blocked` with a recovery entry. The board exposes the bound session so the user
can inspect or manually move the task back to `todo` after deciding how to
recover.

The board also stores a short-lived project worker lease. The lease is acquired
under the project lock, renewed while the run is active, and released when the
run settles. A second OpenChamber process can therefore inspect the same board
without claiming another task in the same project, while an expired lease makes
an abandoned worker recoverable.

### Routes and events

Add OpenChamber-owned routes before the generic OpenCode proxy:

- `GET /api/projects/:projectId/taskboard`
- `PUT /api/projects/:projectId/taskboard/settings`
- `POST /api/projects/:projectId/taskboard/tasks`
- `PATCH /api/projects/:projectId/taskboard/tasks/:taskId`
- `DELETE /api/projects/:projectId/taskboard/tasks/:taskId`
- `POST /api/projects/:projectId/taskboard/tasks/:taskId/move`
- `POST /api/projects/:projectId/taskboard/tasks/:taskId/run`
- `GET /api/openchamber/taskboard/status`

The server broadcasts `openchamber:taskboard-updated` with only the project ID,
task ID, and mutation kind. Clients reload the project board instead of applying
partial event payloads.

## UI

The board is a full-page surface matching Archive, Worktrees, and Scheduled
Tasks. It is opened from the session sidebar and closes when a session or draft
is selected.

The first UI contains:

- project selector;
- `Auto-run tasks` toggle;
- `New task` dialog with title, description, priority, labels, and initial
  status;
- columns for `Backlog`, `Todo`, `In progress`, `In review`, `Blocked`, and
  `Done`;
- task cards showing identifier, title, priority, labels, run state, latest
  error, and bound session;
- status movement through explicit controls, not drag-and-drop in the first
  slice;
- a button to open the bound OpenCode session.

The shared taskboard store is keyed by runtime and project ID. It preserves the
last successful board on fetch failure, treats a successful empty board as
authoritative, coalesces reloads, and discards stale responses after a runtime
switch. Event updates only invalidate the affected project.

## Failure handling

- A malformed stored task is skipped during normalization and does not erase
  valid tasks.
- A failed project-board read remains an error and never becomes an empty board.
- A stale task version returns `409` and the UI reloads before retrying once.
- A task whose dependency is not exactly `done` stays in `todo`.
- A duplicate worker claim is rejected by the project write lock and task
  version check.
- A session create response that is ambiguous leaves the task `blocked` instead
  of creating a second session.
- A server shutdown stops new dispatches and clears timers without modifying
  already persisted task status.

## Validation

Server tests cover normalization, transitions, persistence round trips, stale
versions, dependency selection, worker claim/dispatch, session success, session
failure, and shutdown. Shared UI tests cover board loading, mutation rollback,
event invalidation, runtime switching, and task card rendering.

Validation includes focused tests, package type-check and lint, affected builds,
Oxlint on created or substantially changed TypeScript/JavaScript files, and
`bun run dead-code` for new modules and exports.
