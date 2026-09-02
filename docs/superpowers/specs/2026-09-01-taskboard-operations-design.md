# Taskboard operations and context handoff

## Goal

Improve Taskboard task creation and lifecycle management, then add explicit
context handoff from an existing OpenCode session without allowing unrelated
conversation state to corrupt Taskboard execution.

## Confirmed product decisions

- Task creation can choose the model's thinking level (`variant`).
- Project selection is searchable by project name and directory.
- Start scheduling supports both one-time and daily rules.
- Daily rules generate a new ordinary Taskboard task for each occurrence.
- The original daily rule is shown separately as a non-executable schedule template.
- Only tasks that have never started can be edited or deleted.
- Permission control remains the task-level automatic permission-acceptance toggle.
- `plan` and `build` remain OpenCode Agent choices.
- Context handoff supports both explicit Session Fork and a local Markdown handoff document.
- Direct reuse of the same Session is not supported.

## Stage 1: Task operations

### Execution settings

Extend the task execution object with an optional model variant:

```ts
type TaskboardExecution = {
  providerID: string;
  modelID: string;
  variant: string | null;
  agent: string;
  permissionAutoAccept: boolean;
  goal: null | { objective: string };
};
```

The creation dialog loads model and Agent data from the selected project's
directory. Model variants come from the selected provider/model. Changing the
model clears a variant that is not present on the new model. The server validates
the provider/model/variant combination again immediately before Session creation.

### Searchable projects

The all-project Taskboard remains the default view. Both the board filter and
the creation dialog use a searchable project picker matching project labels and
normalized paths. The picker only changes local Taskboard selection. It never
calls `setActiveProject()` or activates another directory globally.

The creation dialog requires a target project. Model and Agent defaults are
loaded for that project only.

### Scheduling

Taskboard stores a schedule on a task, not in `scheduledTasks[]`:

```ts
type TaskboardSchedule =
  | {
      kind: 'once';
      date: string;
       time: string;
      timezone: string;
      lastScheduledFor: number | null;
    }
  | {
      kind: 'daily';
      time: string;
      timezone: string;
      lastScheduledFor: number | null;
      nextRunAt: number | null;
    };
```

The schedule is `null` for immediate execution. Dates and times are stored as
wall-clock values with an IANA timezone. Luxon resolves due times, including DST
gaps and timezone transitions. The server owns due checks; the browser never
converts a scheduled time to an instant for execution.

One-time tasks remain ordinary workflow tasks. A future one-time task stays
visible with a waiting indicator, becomes eligible at its scheduled instant,
and records the consumed occurrence atomically during claim. `Run now` bypasses
the wait and consumes the pending occurrence so it cannot run a second time.

Daily tasks are schedule templates. They are shown in a separate Plan area and
are excluded from the six workflow columns and normal eligibility. At the due
time, the Worker atomically creates one ordinary task with copied title,
description, labels, priority, execution settings, and a `scheduleTemplateId`
plus `scheduledFor` provenance. The template remains unchanged and advances its
next occurrence. The generated task is then eligible for normal automatic or
manual execution. If auto-run is disabled, it remains in `todo` until the user
runs it.

The existing ten-second Worker poll remains the only scheduler. A due task can
start within one poll interval. Restart recovery catches up a missed one-time
occurrence once and never creates two daily occurrences for the same scheduled
instant. The due check exists both in the Worker selection path and inside the
lock-protected claim/materialization mutation.

Editing a future one-time schedule recalculates its occurrence and clears
consumption. Editing a daily template recalculates its next occurrence. Deleting
a template stops future materialization but does not delete already-generated
ordinary tasks.

### Editing and deleting

The authoritative unstarted predicate is:

```ts
runStatus === 'idle' && sessionId === null && runId === null
```

Only those tasks show edit and delete actions. The server enforces the same
predicate under the existing project lock and version check. A task that was
started and later moved back to `todo` remains non-editable and non-deletable.
Running tasks retain the existing `TASK_RUNNING` response. Previously started
tasks use a distinct conflict response so the UI can explain why the action is
not available.

Editing reuses the creation dialog and preserves the task's project identity.
Deleting requires confirmation and removes only the selected task or schedule
template.

## Stage 2: Context handoff

Task execution receives an explicit target:

```ts
type TaskboardSessionTarget =
  | { mode: 'new' }
  | {
      mode: 'fork';
      sourceSessionId: string;
      sourceMessageId: string;
    }
  | {
      mode: 'handoff';
      sourceSessionId: string;
      handoffPath: string;
    };
```

The source Session picker is searchable and limited to the selected project.
The server resolves the source Session's authoritative directory and requires
it to match the task project. A source must be settled and must not have an
active Goal, pending permission, or pending question.

For `fork`, the server captures a stable source message boundary when the task
is created. At execution time it forks that Session and sends the Taskboard
prompt only to the child. The child Session ID becomes the task's `sessionId`.
The Worker never treats messages added to the source Session as Taskboard output.

For `handoff`, the server writes a bounded Markdown snapshot under
`.openchamber/taskboard/handoffs/` in the target project. The document contains
source metadata, the bounded authoritative conversation context, and explicit
section boundaries marking inherited text as context rather than instructions.
The new Session prompt tells the Agent to read the document before starting.
The handoff path and source Session ID are persisted with the task.

Neither mode implicitly shares a Session. Fork preserves transcript fidelity;
handoff provides a reviewable and filesystem-visible transfer. Neither mode
isolates simultaneous file changes; worktree isolation remains a later option.

## Authority and failure behavior

- Project and task mutations remain project-scoped and use the existing CAS and
  cross-process lock.
- Schedule due state is authoritative only when recorded by the server mutation.
- A failed project read preserves unrelated project boards.
- A malformed schedule, model selection, source Session, or handoff write fails
  explicitly and never becomes an empty or immediately eligible task.
- Ambiguous Session creation is reconciled by the existing Session/run mapping;
  it is never blindly retried into a second Session.
- SSE invalidation continues to carry the affected project ID. The aggregate UI
  refreshes the affected project and preserves unrelated project references.

## Validation

- Domain tests cover variant and schedule normalization, due/consumed rules, and
  daily template materialization.
- Store tests cover locked create/update/delete/materialization and started-task
  rejection.
- Runtime tests cover future skip, due execution, manual bypass, daily
  occurrence creation, restart catch-up, and duplicate prevention.
- Session tests cover variant forwarding, Fork boundary validation, handoff
  writing, and source-state rejection.
- UI tests cover searchable project filtering, variant reset, schedule payloads,
  edit/delete visibility, template display, and context target payloads.
- Package checks include UI/Web type-check, lint, build, focused tests, JS syntax,
  `dead-code`, and target-file `oxlint`.
