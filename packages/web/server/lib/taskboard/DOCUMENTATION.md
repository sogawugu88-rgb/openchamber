# Taskboard module

The Taskboard module owns project-scoped work items and the server-side worker
that dispatches eligible tasks to independent OpenCode sessions.

## Ownership

- `domain.js` owns task shape, statuses, priorities, run states, transitions,
  dependency eligibility, and bounded history.
- `store.js` owns taskboard mutations and delegates atomic persistence to
  `projectConfigRuntime`.
- `runtime.js` owns the worker queue, task/session mapping, session result
  inspection, and taskboard invalidation events.
- `routes.js` owns the OpenChamber HTTP routes for board reads and mutations.

Taskboard data is stored under the `taskboard` key in the existing per-project
configuration file. `projectConfigRuntime.mutateTaskboard()` keeps taskboard and
scheduled-task writes behind the same in-process and cross-process lock.

## Workflow

New tasks start in `backlog`. Only `todo` tasks are eligible for automation. The
worker checks blockers, claims a task with its current version, creates one
independent OpenCode session, and records the returned session ID. A successful
assistant turn moves the task to `in_review`; a failed or ambiguous run moves it
to `blocked`. Only a user can move `in_review` to `done`.

The worker has one global active run in this first slice. It polls enabled boards
and can be woken immediately by a task mutation. Before finalizing an idle run it
checks the current session status and matches the latest assistant message to the
latest user message, so a provider continuation cannot be mistaken for a final
failure. Each project also carries a short-lived Worker lease, renewed during the
run, so another OpenChamber process cannot claim a different task in the same
project concurrently. The browser is not required to remain open.

## Routes

- `GET /api/projects/:projectId/taskboard`
- `PUT /api/projects/:projectId/taskboard/settings`
- `POST /api/projects/:projectId/taskboard/tasks`
- `PATCH /api/projects/:projectId/taskboard/tasks/:taskId`
- `DELETE /api/projects/:projectId/taskboard/tasks/:taskId`
- `POST /api/projects/:projectId/taskboard/tasks/:taskId/move`
- `POST /api/projects/:projectId/taskboard/tasks/:taskId/run`
- `GET /api/openchamber/taskboard/status`

The server emits `openchamber:taskboard-updated` through the existing
`/api/openchamber/events` SSE stream. The event contains an affected project ID,
optional task ID, and mutation kind. UI clients reload the complete project
board after receiving it.

## Lifecycle

- Start the runtime after the OpenCode server is ready.
- Stop the runtime before OpenCode shutdown. Stopping clears timers and prevents
  new dispatches without rewriting persisted task status.
- A task run that survives a server restart remains visible with its persisted
  session ID and the new process reattaches its watcher. A claimed task without
  a session ID is moved to `blocked` with a recovery message.

## Validation

Run focused tests with:

```bash
bun test packages/web/server/lib/taskboard/domain.test.js packages/web/server/lib/taskboard/store.test.js packages/web/server/lib/taskboard/runtime.test.js packages/web/server/lib/taskboard/routes.test.js
```
